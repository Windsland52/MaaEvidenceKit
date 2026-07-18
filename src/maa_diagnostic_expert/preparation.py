from __future__ import annotations

import hashlib
import subprocess
from datetime import UTC, datetime
from pathlib import Path

from .domain import (
    AnalysisRequest,
    ArtifactAvailability,
    ArtifactInput,
    ArtifactKind,
    ArtifactMediaKind,
    ArtifactRecord,
    MissingEvidence,
    PreparedAnalysis,
    RevisionResolutionStatus,
    SourceSnapshot,
)
from .inputs import resolve_project_root

MAX_DISCOVERED_FILES = 10_000

_ARCHIVE_SUFFIXES = (".zip", ".7z", ".rar", ".tar", ".gz", ".tgz")
_CONFIGURATION_SUFFIXES = (".json", ".jsonc", ".yaml", ".yml", ".toml", ".ini")
_DUMP_SUFFIXES = (".dmp", ".dump", ".core")
_IMAGE_SUFFIXES = (".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp")
_LOG_SUFFIXES = (".log", ".jsonl")
_TEXT_SUFFIXES = (".txt", ".md", ".csv")


def _artifact_id(input_path: Path, path: Path) -> str:
    digest = hashlib.sha256(f"{input_path}|{path}".encode()).hexdigest()[:20]
    return f"artifact:{digest}"


def _media_kind(path: Path) -> ArtifactMediaKind:
    name = path.name.lower()
    if name.endswith(_LOG_SUFFIXES):
        return ArtifactMediaKind.LOG
    if name.endswith(_CONFIGURATION_SUFFIXES):
        return ArtifactMediaKind.CONFIGURATION
    if name.endswith(_ARCHIVE_SUFFIXES):
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
        id=_artifact_id(input_path, path),
        input_path=input_path,
        path=path,
        kind=kind,
        media_kind=_media_kind(path),
        availability=availability,
        size_bytes=size_bytes,
        modified_at=modified_at,
    )


def _expected_path_type_matches(artifact: ArtifactInput, path: Path) -> bool:
    if artifact.kind is ArtifactKind.DIRECTORY:
        return path.is_dir()
    return path.is_file()


def _discover_artifact(
    artifact: ArtifactInput,
) -> tuple[list[ArtifactRecord], list[MissingEvidence]]:
    input_path = artifact.path.expanduser().resolve()
    if not input_path.exists():
        return (
            [
                _record(
                    input_path=input_path,
                    path=input_path,
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
                kind=kind,
                availability=ArtifactAvailability.AVAILABLE,
            )
        )
        discovered += 1
    return records, missing


def _git_revision(project_root: Path, revision: str) -> str | None:
    try:
        completed = subprocess.run(
            ["git", "-C", str(project_root), "rev-parse", "--verify", f"{revision}^{{commit}}"],
            capture_output=True,
            check=False,
            encoding="utf-8",
            timeout=5,
        )
    except (OSError, subprocess.SubprocessError):
        return None
    resolved = completed.stdout.strip()
    return resolved if completed.returncode == 0 and resolved else None


def _source_snapshot(
    project_root: Path | None, requested_revision: str | None
) -> SourceSnapshot | None:
    if project_root is None:
        return None
    current_revision = _git_revision(project_root, "HEAD")
    if current_revision is None:
        status = RevisionResolutionStatus.NOT_A_GIT_REPOSITORY
        resolved_revision = None
    elif requested_revision is None:
        status = RevisionResolutionStatus.NOT_REQUESTED
        resolved_revision = None
    else:
        resolved_revision = _git_revision(project_root, requested_revision)
        status = (
            RevisionResolutionStatus.RESOLVED
            if resolved_revision is not None
            else RevisionResolutionStatus.UNRESOLVED
        )
    return SourceSnapshot(
        project_root=project_root,
        requested_revision=requested_revision,
        resolved_revision=resolved_revision,
        current_revision=current_revision,
        resolution_status=status,
    )


def prepare_analysis(request: AnalysisRequest) -> PreparedAnalysis:
    project_root = resolve_project_root(request.project_root)
    normalized_request = request.model_copy(update={"project_root": project_root})
    records: list[ArtifactRecord] = []
    missing: list[MissingEvidence] = []
    for artifact in request.artifacts:
        artifact_records, artifact_missing = _discover_artifact(artifact)
        records.extend(artifact_records)
        missing.extend(artifact_missing)

    snapshot = _source_snapshot(project_root, request.revision)
    if request.issue and not request.artifacts:
        missing.append(
            MissingEvidence(
                code="diagnostic_artifacts_missing",
                message="The issue has no supplied logs, dumps, screenshots, or configuration.",
            )
        )
    if request.issue and project_root is None:
        missing.append(
            MissingEvidence(
                code="project_source_missing",
                message="Issue diagnosis requires an explicit Maa project source path.",
            )
        )
    elif request.issue and request.revision is None:
        missing.append(
            MissingEvidence(
                code="issue_revision_unresolved",
                message="The issue-time source revision has not been supplied or resolved.",
                source_path=project_root,
            )
        )
    elif (
        snapshot is not None
        and request.revision is not None
        and snapshot.resolution_status is not RevisionResolutionStatus.RESOLVED
    ):
        missing.append(
            MissingEvidence(
                code="requested_revision_unresolved",
                message=(
                    "The requested source revision is not available in the supplied repository."
                ),
                source_path=project_root,
            )
        )

    unique_records = {record.id: record for record in records}
    return PreparedAnalysis(
        request=normalized_request,
        artifacts=list(unique_records.values()),
        source_snapshot=snapshot,
        missing_evidence=missing,
    )
