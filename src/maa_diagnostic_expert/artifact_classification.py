from __future__ import annotations

import re
from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol

from .domain import (
    ArtifactAvailability,
    ArtifactMediaKind,
    ArtifactRecord,
    PreparedAnalysis,
)
from .workflow_contracts import (
    ArtifactSourceClassification,
    ArtifactSourceInventory,
    ArtifactSourceKind,
)

_SAMPLE_BYTES = 64 * 1024
_MAA_LINE = re.compile(
    r"\[\d{4}-\d{2}-\d{2} [^\]]+\]"
    r"\[(?:TRC|DBG|INF|WRN|ERR|FTL)\]"
    r"\[Px\d+\]\[Tx\d+\]\[[^\]]+\]"
)


@dataclass(frozen=True, slots=True)
class LogClassificationMatch:
    source_kind: ArtifactSourceKind
    confidence: float
    signals: tuple[str, ...]


class LogSourceProfile(Protocol):
    """Optional project/GUI adapter for a known log format."""

    @property
    def profile_id(self) -> str: ...

    def classify(self, path: Path, sample: str) -> LogClassificationMatch | None: ...


def _bounded_sample(path: Path) -> str:
    """Read a bounded head/tail sample without loading a large log into memory."""
    with path.open("rb") as handle:
        head = handle.read(_SAMPLE_BYTES // 2)
        handle.seek(0, 2)
        size = handle.tell()
        if size <= _SAMPLE_BYTES:
            handle.seek(len(head))
            payload = head + handle.read()
        else:
            handle.seek(-(_SAMPLE_BYTES // 2), 2)
            payload = head + b"\n[MDE SAMPLE GAP]\n" + handle.read(_SAMPLE_BYTES // 2)
    return payload.decode("utf-8", errors="replace")


def _maa_filename(path: Path) -> bool:
    name = path.name.lower()
    return name in {"maa.log", "maa.bak.log"} or (
        name.startswith("maafw.") and name.endswith(".log")
    )


def _maa_match(path: Path, sample: str) -> LogClassificationMatch | None:
    signals: list[str] = []
    if _maa_filename(path):
        signals.append("maa_framework_filename")
    if "[Logger] MAA Process Start" in sample:
        signals.append("maa_process_start")
    formatted_lines = len(_MAA_LINE.findall(sample))
    if formatted_lines >= 2:
        signals.append("maa_framework_line_format")
    if not signals:
        return None
    confidence = 0.99 if "maa_process_start" in signals else 0.9
    if signals == ["maa_framework_filename"]:
        confidence = 0.8
    return LogClassificationMatch(
        source_kind=ArtifactSourceKind.MAA_FRAMEWORK,
        confidence=confidence,
        signals=tuple(signals),
    )


def _custom_directory_match(path: Path) -> LogClassificationMatch | None:
    if "custom" not in {part.lower() for part in path.parts[:-1]}:
        return None
    return LogClassificationMatch(
        source_kind=ArtifactSourceKind.CUSTOM,
        confidence=0.75,
        signals=("custom_directory",),
    )


def _best_profile_match(
    path: Path,
    sample: str,
    profiles: Sequence[LogSourceProfile],
) -> tuple[str, LogClassificationMatch] | None:
    matches = [
        (profile.profile_id, match)
        for profile in profiles
        if (match := profile.classify(path, sample)) is not None
    ]
    if not matches:
        return None
    return max(matches, key=lambda item: (item[1].confidence, item[0]))


def _classify_log(
    artifact: ArtifactRecord,
    profiles: Sequence[LogSourceProfile],
) -> ArtifactSourceClassification:
    try:
        sample = _bounded_sample(artifact.path)
    except OSError as error:
        return ArtifactSourceClassification(
            artifact_id=artifact.id,
            path=artifact.path,
            source_kind=ArtifactSourceKind.UNKNOWN,
            confidence=0,
            classifier_id="core/unreadable",
            signals=[f"sample_read_failed:{type(error).__name__}"],
        )

    maa = _maa_match(artifact.path, sample)
    if maa is not None:
        return ArtifactSourceClassification(
            artifact_id=artifact.id,
            path=artifact.path,
            source_kind=maa.source_kind,
            confidence=maa.confidence,
            classifier_id="core/maa-framework",
            signals=list(maa.signals),
        )

    profile = _best_profile_match(artifact.path, sample, profiles)
    if profile is not None:
        profile_id, match = profile
        return ArtifactSourceClassification(
            artifact_id=artifact.id,
            path=artifact.path,
            source_kind=match.source_kind,
            confidence=match.confidence,
            classifier_id=f"profile/{profile_id}",
            signals=list(match.signals),
        )

    custom = _custom_directory_match(artifact.path)
    if custom is not None:
        return ArtifactSourceClassification(
            artifact_id=artifact.id,
            path=artifact.path,
            source_kind=custom.source_kind,
            confidence=custom.confidence,
            classifier_id="core/custom-directory",
            signals=list(custom.signals),
        )

    return ArtifactSourceClassification(
        artifact_id=artifact.id,
        path=artifact.path,
        source_kind=ArtifactSourceKind.UNKNOWN,
        confidence=0,
        classifier_id="core/unknown",
        signals=["no_known_log_signature"],
    )


def classify_artifact_sources(
    prepared: PreparedAnalysis,
    profiles: Sequence[LogSourceProfile] = (),
) -> ArtifactSourceInventory:
    classifications = [
        _classify_log(artifact, profiles)
        for artifact in prepared.artifacts
        if artifact.availability is ArtifactAvailability.AVAILABLE
        and artifact.media_kind is ArtifactMediaKind.LOG
    ]
    return ArtifactSourceInventory(classifications=classifications)
