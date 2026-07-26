from __future__ import annotations

import hashlib
import os
from collections import defaultdict
from datetime import UTC, datetime
from pathlib import Path

from maa_diagnostic_expert.contracts.domain import (
    AnalysisRequest,
    ArtifactAvailability,
    ArtifactInput,
    ArtifactKind,
    ArtifactMediaKind,
    ArtifactOrigin,
    ArtifactRecord,
    MissingEvidence,
    PreparedAnalysis,
)

from .archive_parts import (
    collect_multipart_archive_missing_evidence,
    is_multipart_archive_path,
)
from .evidence_completeness import collect_artifact_completeness_missing_evidence
from .source_preparation import prepare_sources

MAX_DISCOVERED_FILES = 10_000

_ARCHIVE_SUFFIXES = (".zip", ".7z", ".rar", ".tar", ".gz", ".tgz")
_CONFIGURATION_SUFFIXES = (".json", ".jsonc", ".yaml", ".yml", ".toml", ".ini")
_DUMP_SUFFIXES = (".dmp", ".dump", ".core")
_IMAGE_SUFFIXES = (".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp")
_LOG_SUFFIXES = (".log", ".jsonl")
_TEXT_SUFFIXES = (".txt", ".md", ".csv")


def _lexical_absolute(path: Path) -> Path:
    expanded = path.expanduser()
    if expanded.is_absolute():
        return expanded
    return Path.cwd() / expanded


def _artifact_id(path: Path) -> str:
    digest = hashlib.sha256(str(path).encode()).hexdigest()[:20]
    return f"artifact:{digest}"


def _media_kind(path: Path) -> ArtifactMediaKind:
    name = path.name.lower()
    if name.endswith(_LOG_SUFFIXES):
        return ArtifactMediaKind.LOG
    if name.endswith(_CONFIGURATION_SUFFIXES):
        return ArtifactMediaKind.CONFIGURATION
    if name.endswith(_ARCHIVE_SUFFIXES) or is_multipart_archive_path(path):
        return ArtifactMediaKind.ARCHIVE
    if name.endswith(_IMAGE_SUFFIXES):
        return ArtifactMediaKind.IMAGE
    if name.endswith(_DUMP_SUFFIXES):
        return ArtifactMediaKind.DUMP
    if name.endswith(_TEXT_SUFFIXES):
        return ArtifactMediaKind.TEXT
    return ArtifactMediaKind.OTHER


def _record(
    *,
    input_path: Path,
    path: Path,
    origin_input_path: Path,
    origin_path: Path,
    kind: ArtifactKind,
    availability: ArtifactAvailability,
) -> ArtifactRecord:
    size_bytes: int | None = None
    modified_at: datetime | None = None
    if availability is ArtifactAvailability.AVAILABLE:
        try:
            stat = path.stat()
            size_bytes = stat.st_size if path.is_file() else None
            modified_at = datetime.fromtimestamp(stat.st_mtime, tz=UTC)
        except OSError:
            availability = ArtifactAvailability.UNREADABLE
    return ArtifactRecord(
        id=_artifact_id(path),
        input_path=input_path,
        path=path,
        kind=kind,
        media_kind=_media_kind(path),
        availability=availability,
        size_bytes=size_bytes,
        modified_at=modified_at,
        origins=[
            ArtifactOrigin(
                input_path=origin_input_path,
                path=origin_path,
                kind=kind,
                media_kind=_media_kind(origin_path),
            )
        ],
    )


def _expected_path_type_matches(artifact: ArtifactInput, path: Path) -> bool:
    if artifact.kind is ArtifactKind.DIRECTORY:
        return path.is_dir()
    return path.is_file()


def _discover_artifact(
    artifact: ArtifactInput,
) -> tuple[list[ArtifactRecord], list[MissingEvidence]]:
    origin_input_path = _lexical_absolute(artifact.path)
    input_path = origin_input_path.resolve()
    if not input_path.exists():
        return (
            [
                _record(
                    input_path=input_path,
                    path=input_path,
                    origin_input_path=origin_input_path,
                    origin_path=origin_input_path,
                    kind=artifact.kind,
                    availability=ArtifactAvailability.MISSING,
                )
            ],
            [
                MissingEvidence(
                    code="artifact_missing",
                    message="The requested artifact path does not exist.",
                    source_path=input_path,
                )
            ],
        )
    if not _expected_path_type_matches(artifact, input_path):
        return (
            [
                _record(
                    input_path=input_path,
                    path=input_path,
                    origin_input_path=origin_input_path,
                    origin_path=origin_input_path,
                    kind=artifact.kind,
                    availability=ArtifactAvailability.TYPE_MISMATCH,
                )
            ],
            [
                MissingEvidence(
                    code="artifact_type_mismatch",
                    message=f"Expected artifact kind {artifact.kind.value}.",
                    source_path=input_path,
                )
            ],
        )

    records = [
        _record(
            input_path=input_path,
            path=input_path,
            origin_input_path=origin_input_path,
            origin_path=origin_input_path,
            kind=artifact.kind,
            availability=ArtifactAvailability.AVAILABLE,
        )
    ]
    missing: list[MissingEvidence] = []
    if artifact.kind is not ArtifactKind.DIRECTORY:
        return records, missing

    discovered = 0
    for child in sorted(input_path.rglob("*"), key=lambda item: str(item).lower()):
        if not child.is_file():
            continue
        origin_child = origin_input_path / child.relative_to(input_path)
        resolved_child = child.resolve()
        if not resolved_child.is_relative_to(input_path):
            missing.append(
                MissingEvidence(
                    code="artifact_symlink_outside_root",
                    message="A linked artifact points outside the explicit artifact directory.",
                    source_path=child,
                )
            )
            continue
        if discovered >= MAX_DISCOVERED_FILES:
            missing.append(
                MissingEvidence(
                    code="artifact_inventory_truncated",
                    message=f"Artifact inventory exceeded {MAX_DISCOVERED_FILES} files.",
                    source_path=input_path,
                )
            )
            break
        kind = (
            ArtifactKind.ARCHIVE
            if _media_kind(resolved_child) is ArtifactMediaKind.ARCHIVE
            else ArtifactKind.FILE
        )
        records.append(
            _record(
                input_path=input_path,
                path=resolved_child,
                origin_input_path=origin_input_path,
                origin_path=origin_child,
                kind=kind,
                availability=ArtifactAvailability.AVAILABLE,
            )
        )
        discovered += 1
    return records, missing


def _physical_identity(record: ArtifactRecord) -> tuple[str, str] | tuple[str, int, int]:
    if record.availability is ArtifactAvailability.AVAILABLE:
        try:
            stat = record.path.stat()
        except OSError:
            pass
        else:
            if stat.st_ino:
                return ("stat", stat.st_dev, stat.st_ino)
    return ("path", os.path.normcase(str(record.path.resolve())))


def _record_sort_key(record: ArtifactRecord) -> tuple[str, str, str, str, str, str]:
    return (
        os.path.normcase(str(record.path)),
        str(record.path),
        os.path.normcase(str(record.input_path)),
        str(record.input_path),
        record.kind.value,
        record.media_kind.value,
    )


def _origin_sort_key(origin: ArtifactOrigin) -> tuple[str, str, str, str, str, str]:
    return (
        os.path.normcase(str(origin.path)),
        str(origin.path),
        os.path.normcase(str(origin.input_path)),
        str(origin.input_path),
        origin.kind.value,
        origin.media_kind.value,
    )


def _deduplicate_origins(origins: list[ArtifactOrigin]) -> list[ArtifactOrigin]:
    by_key: dict[tuple[str, str, str, str], ArtifactOrigin] = {}
    for origin in origins:
        key = (
            str(origin.input_path),
            str(origin.path),
            origin.kind.value,
            origin.media_kind.value,
        )
        by_key.setdefault(key, origin)
    return sorted(by_key.values(), key=_origin_sort_key)


def _deduplicate_records(records: list[ArtifactRecord]) -> list[ArtifactRecord]:
    grouped: defaultdict[tuple[str, str] | tuple[str, int, int], list[ArtifactRecord]] = (
        defaultdict(list)
    )
    for record in records:
        grouped[_physical_identity(record)].append(record)

    unique_records: list[ArtifactRecord] = []
    for group in grouped.values():
        canonical = min(group, key=_record_sort_key)
        origins = _deduplicate_origins(
            [origin for record in group for origin in record.all_origins()]
        )
        unique_records.append(
            canonical.model_copy(
                update={
                    "id": _artifact_id(canonical.path),
                    "origins": origins,
                }
            )
        )
    return sorted(unique_records, key=_record_sort_key)


def prepare_analysis(request: AnalysisRequest) -> PreparedAnalysis:
    sources, snapshots, source_missing = prepare_sources(request)
    normalized_request = request.model_copy(update={"sources": sources})
    records: list[ArtifactRecord] = []
    missing = list(source_missing)
    for artifact in request.artifacts:
        artifact_records, artifact_missing = _discover_artifact(artifact)
        records.extend(artifact_records)
        missing.extend(artifact_missing)

    if request.issue and not request.artifacts:
        missing.append(
            MissingEvidence(
                code="diagnostic_artifacts_missing",
                message="The issue has no supplied logs, dumps, screenshots, or configuration.",
            )
        )

    unique_records = _deduplicate_records(records)
    return PreparedAnalysis(
        request=normalized_request,
        artifacts=unique_records,
        source_snapshots=snapshots,
        missing_evidence=[
            *missing,
            *collect_multipart_archive_missing_evidence(unique_records),
            *collect_artifact_completeness_missing_evidence(unique_records),
        ],
    )
