from __future__ import annotations

import hashlib
import re
from collections import Counter, deque
from enum import StrEnum
from pathlib import Path

from pydantic import Field

from maa_diagnostic_expert.contracts.domain import (
    ContractModel,
    Evidence,
    EvidenceReliability,
    EvidenceRole,
    MissingEvidence,
    PreparedAnalysis,
)
from maa_diagnostic_expert.contracts.workflow import ArtifactSourceInventory, ArtifactSourceKind

MAX_SCAN_BYTES = 256 * 1024 * 1024
MAX_LINE_BYTES = 64 * 1024
MAX_OCCURRENCES_PER_LOG = 40
_EDGE_OCCURRENCES = MAX_OCCURRENCES_PER_LOG // 2

_BRACKETED_TIMESTAMP = re.compile(r"^\[(\d{4}-\d{2}-\d{2} [^\]]+)\]")
_PLAIN_TIMESTAMP = re.compile(r"^(\d{4}-\d{2}-\d{2}[ T][0-9:.+Z-]+)")
_JSON_TIMESTAMP = re.compile(r'"time"\s*:\s*"([^"]+)"')
_BRACKETED_LEVEL = re.compile(r"\[(TRC|DBG|INF|WRN|ERR|FTL)\]")
_JSON_LEVEL = re.compile(
    r'"level"\s*:\s*"(trace|debug|info|warn|warning|error|fatal|critical)"', re.I
)
_WORD_LEVEL = re.compile(r"\b(TRACE|DEBUG|INFO|WARN|WARNING|ERROR|FATAL|CRITICAL)\b")


class LogSeverity(StrEnum):
    TRACE = "trace"
    DEBUG = "debug"
    INFO = "info"
    WARNING = "warning"
    ERROR = "error"
    CRITICAL = "critical"
    UNKNOWN = "unknown"


class LogOverviewStatus(StrEnum):
    COMPLETE = "complete"
    TRUNCATED = "truncated"
    UNREADABLE = "unreadable"


class LogSeverityCount(ContractModel):
    severity: LogSeverity
    count: int = Field(ge=1)


class LogOccurrence(ContractModel):
    line_number: int = Field(ge=1)
    byte_offset: int = Field(ge=0)
    timestamp_text: str | None = None
    severity: LogSeverity
    excerpt: str = Field(min_length=1, max_length=1000)
    line_truncated: bool = False


def _new_severity_counts() -> list[LogSeverityCount]:
    return []


def _new_log_occurrences() -> list[LogOccurrence]:
    return []


class LogArtifactOverview(ContractModel):
    artifact_id: str = Field(min_length=1)
    path: Path
    source_kind: ArtifactSourceKind
    status: LogOverviewStatus
    scanned_bytes: int = Field(ge=0)
    scanned_lines: int = Field(ge=0)
    first_timestamp_text: str | None = None
    last_timestamp_text: str | None = None
    severity_counts: list[LogSeverityCount] = Field(default_factory=_new_severity_counts)
    notable_occurrences: list[LogOccurrence] = Field(default_factory=_new_log_occurrences)
    oversized_line_count: int = Field(default=0, ge=0)
    omitted_occurrence_count: int = Field(default=0, ge=0)
    error_message: str | None = None


def _new_log_artifact_overviews() -> list[LogArtifactOverview]:
    return []


class LogOverviewCollection(ContractModel):
    api_version: str = "log-overview/v1"
    overviews: list[LogArtifactOverview] = Field(default_factory=_new_log_artifact_overviews)


def _timestamp(line: str) -> str | None:
    for pattern in (_BRACKETED_TIMESTAMP, _PLAIN_TIMESTAMP, _JSON_TIMESTAMP):
        if match := pattern.search(line[:2048]):
            return match.group(1)
    return None


def _severity(line: str) -> LogSeverity:
    prefix = line[:2048]
    match = _BRACKETED_LEVEL.search(prefix)
    if match is None:
        match = _JSON_LEVEL.search(prefix)
    if match is None:
        match = _WORD_LEVEL.search(prefix)
    if match is None:
        return LogSeverity.UNKNOWN
    return {
        "trc": LogSeverity.TRACE,
        "trace": LogSeverity.TRACE,
        "dbg": LogSeverity.DEBUG,
        "debug": LogSeverity.DEBUG,
        "inf": LogSeverity.INFO,
        "info": LogSeverity.INFO,
        "wrn": LogSeverity.WARNING,
        "warn": LogSeverity.WARNING,
        "warning": LogSeverity.WARNING,
        "err": LogSeverity.ERROR,
        "error": LogSeverity.ERROR,
        "ftl": LogSeverity.CRITICAL,
        "fatal": LogSeverity.CRITICAL,
        "critical": LogSeverity.CRITICAL,
    }[match.group(1).lower()]


def _excerpt(payload: bytes) -> str:
    text = payload.decode("utf-8", errors="replace").strip()
    return text[:1000] or "<empty log line>"


def _remember_occurrence(
    first: list[LogOccurrence],
    last: deque[LogOccurrence],
    occurrence: LogOccurrence,
) -> None:
    if len(first) < _EDGE_OCCURRENCES:
        first.append(occurrence)
    else:
        last.append(occurrence)


def _scan_log(path: Path, artifact_id: str, source_kind: ArtifactSourceKind) -> LogArtifactOverview:
    counts: Counter[LogSeverity] = Counter()
    first_occurrences: list[LogOccurrence] = []
    last_occurrences: deque[LogOccurrence] = deque(maxlen=_EDGE_OCCURRENCES)
    notable_count = 0
    line_number = 0
    oversized_lines = 0
    first_timestamp: str | None = None
    last_timestamp: str | None = None
    truncated = False

    try:
        with path.open("rb") as handle:
            while handle.tell() < MAX_SCAN_BYTES:
                byte_offset = handle.tell()
                read_limit = min(
                    MAX_LINE_BYTES + 1,
                    MAX_SCAN_BYTES - byte_offset + 1,
                )
                payload = handle.readline(read_limit)
                if not payload:
                    break
                line_number += 1
                oversized_line = len(payload) > MAX_LINE_BYTES
                line_truncated = oversized_line
                prefix = payload[:MAX_LINE_BYTES]
                if oversized_line:
                    oversized_lines += 1
                while payload and not payload.endswith(b"\n"):
                    if handle.tell() >= MAX_SCAN_BYTES:
                        truncated = True
                        line_truncated = True
                        break
                    continuation_limit = min(
                        MAX_LINE_BYTES + 1,
                        MAX_SCAN_BYTES - handle.tell() + 1,
                    )
                    payload = handle.readline(continuation_limit)
                line = prefix.decode("utf-8", errors="replace")
                timestamp = _timestamp(line)
                if timestamp is not None:
                    first_timestamp = first_timestamp or timestamp
                    last_timestamp = timestamp
                severity = _severity(line)
                counts[severity] += 1
                if severity in {LogSeverity.WARNING, LogSeverity.ERROR, LogSeverity.CRITICAL}:
                    notable_count += 1
                    _remember_occurrence(
                        first_occurrences,
                        last_occurrences,
                        LogOccurrence(
                            line_number=line_number,
                            byte_offset=byte_offset,
                            timestamp_text=timestamp,
                            severity=severity,
                            excerpt=_excerpt(prefix),
                            line_truncated=line_truncated,
                        ),
                    )
                if truncated:
                    break
            scanned_bytes = handle.tell()
            if path.stat().st_size > scanned_bytes:
                truncated = True
    except OSError as error:
        return LogArtifactOverview(
            artifact_id=artifact_id,
            path=path,
            source_kind=source_kind,
            status=LogOverviewStatus.UNREADABLE,
            scanned_bytes=0,
            scanned_lines=0,
            error_message=f"{type(error).__name__}: {error}",
        )

    notable = [*first_occurrences]
    known_lines = {item.line_number for item in notable}
    notable.extend(item for item in last_occurrences if item.line_number not in known_lines)
    severity_counts = [
        LogSeverityCount(severity=severity, count=count)
        for severity, count in sorted(counts.items())
    ]
    return LogArtifactOverview(
        artifact_id=artifact_id,
        path=path,
        source_kind=source_kind,
        status=LogOverviewStatus.TRUNCATED if truncated else LogOverviewStatus.COMPLETE,
        scanned_bytes=scanned_bytes,
        scanned_lines=line_number,
        first_timestamp_text=first_timestamp,
        last_timestamp_text=last_timestamp,
        severity_counts=severity_counts,
        notable_occurrences=notable,
        oversized_line_count=oversized_lines,
        omitted_occurrence_count=max(0, notable_count - len(notable)),
    )


def build_log_overviews(
    prepared: PreparedAnalysis,
    inventory: ArtifactSourceInventory,
) -> LogOverviewCollection:
    artifacts = {artifact.id: artifact for artifact in prepared.artifacts}
    overviews: list[LogArtifactOverview] = []
    for classification in inventory.classifications:
        if classification.source_kind not in {ArtifactSourceKind.GUI, ArtifactSourceKind.CUSTOM}:
            continue
        artifact = artifacts.get(classification.artifact_id)
        if artifact is None:
            continue
        overviews.append(_scan_log(artifact.path, artifact.id, classification.source_kind))
    return LogOverviewCollection(overviews=overviews)


def collect_log_overview_missing_evidence(
    collection: LogOverviewCollection,
) -> list[MissingEvidence]:
    missing: list[MissingEvidence] = []
    for overview in collection.overviews:
        if overview.status is LogOverviewStatus.UNREADABLE:
            missing.append(
                MissingEvidence(
                    code="log_overview_unreadable",
                    message=overview.error_message or "The classified log could not be read.",
                    source_path=overview.path,
                )
            )
        elif overview.status is LogOverviewStatus.TRUNCATED:
            missing.append(
                MissingEvidence(
                    code="log_overview_truncated",
                    message=(
                        f"Log overview stopped after {overview.scanned_bytes} bytes; "
                        "focused evidence queries may still read the supplied artifact."
                    ),
                    source_path=overview.path,
                    required=False,
                )
            )
    return missing


def _evidence_id(kind: str, path: Path, discriminator: str) -> str:
    digest = hashlib.sha256(f"{kind}|{path}|{discriminator}".encode()).hexdigest()[:20]
    return f"evidence:log-overview:{digest}"


def log_overview_summary_evidence_id(overview: LogArtifactOverview) -> str:
    return _evidence_id("summary", overview.path, overview.artifact_id)


def log_occurrence_evidence_id(overview: LogArtifactOverview, occurrence: LogOccurrence) -> str:
    return _evidence_id(
        occurrence.severity,
        overview.path,
        f"{occurrence.byte_offset}|{occurrence.excerpt}",
    )


def synthesize_log_overview_evidence(collection: LogOverviewCollection) -> list[Evidence]:
    evidence: list[Evidence] = []
    for overview in collection.overviews:
        counts = (
            ", ".join(f"{item.severity}={item.count}" for item in overview.severity_counts)
            or "none"
        )
        evidence.append(
            Evidence(
                id=log_overview_summary_evidence_id(overview),
                kind="log_overview_summary",
                source_component=f"log-overview:{overview.source_kind.value}",
                source_path=str(overview.path),
                content=(
                    f"status={overview.status}; scanned_lines={overview.scanned_lines}; "
                    f"scanned_bytes={overview.scanned_bytes}; "
                    f"time_range={overview.first_timestamp_text or 'unknown'}.."
                    f"{overview.last_timestamp_text or 'unknown'}; severities={counts}; "
                    f"oversized_lines={overview.oversized_line_count}; "
                    f"omitted_occurrences={overview.omitted_occurrence_count}"
                ),
                role=EvidenceRole.CONTEXT,
                reliability=EvidenceReliability.CONTEXT,
            )
        )
        for occurrence in overview.notable_occurrences:
            evidence.append(
                Evidence(
                    id=log_occurrence_evidence_id(overview, occurrence),
                    kind=f"log_occurrence:{occurrence.severity}",
                    source_component=f"log-overview:{overview.source_kind.value}",
                    source_path=str(overview.path),
                    content=(
                        f"byte_offset={occurrence.byte_offset}; "
                        f"timestamp={occurrence.timestamp_text or 'unknown'}; "
                        f"line_truncated={occurrence.line_truncated}\n{occurrence.excerpt}"
                    ),
                    line_start=occurrence.line_number,
                    line_end=occurrence.line_number,
                    role=EvidenceRole.SIGNAL,
                    reliability=EvidenceReliability.PRIMARY,
                )
            )
    return evidence
