from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from maa_diagnostic_expert.contracts.domain import (
    ArtifactAvailability,
    ArtifactKind,
    ArtifactMediaKind,
    ArtifactOrigin,
    ArtifactRecord,
    PreparedAnalysis,
)
from maa_diagnostic_expert.contracts.workflow import (
    ArtifactSourceInventory,
    ArtifactSourceKind,
)


@dataclass(frozen=True, slots=True)
class MlaArtifactTarget:
    artifact_id: str
    path: Path


def _is_explicit_origin(origin: ArtifactOrigin) -> bool:
    return origin.input_path == origin.path


def _points_to_record(record: ArtifactRecord, path: Path) -> bool:
    try:
        return path.samefile(record.path)
    except OSError:
        return path.resolve() == record.path.resolve()


def mla_artifact_target_is_current(
    target: MlaArtifactTarget,
    artifact: ArtifactRecord,
) -> bool:
    """Return whether a selected alias still identifies its prepared artifact."""
    if target.artifact_id != artifact.id:
        return False
    if artifact.availability is not ArtifactAvailability.AVAILABLE:
        return False
    if not any(origin.path == target.path for origin in artifact.all_origins()):
        return False
    return _points_to_record(artifact, target.path)


def _is_within_directory(path: Path, directory: Path) -> bool:
    resolved_path = path.resolve()
    resolved_directory = directory.resolve()
    return resolved_path == resolved_directory or resolved_path.is_relative_to(resolved_directory)


def _outermost_directory_targets(
    prepared: PreparedAnalysis,
    maa_artifact_ids: set[str],
) -> list[MlaArtifactTarget]:
    artifacts_by_id = {artifact.id: artifact for artifact in prepared.artifacts}
    maa_directory_origins: set[Path] = set()
    for artifact_id in maa_artifact_ids:
        artifact = artifacts_by_id.get(artifact_id)
        if artifact is None:
            continue
        for origin in artifact.all_origins():
            if (
                origin.kind is ArtifactKind.DIRECTORY
                or origin.media_kind is not ArtifactMediaKind.LOG
            ):
                continue
            if origin.input_path != origin.path:
                maa_directory_origins.add(origin.input_path)

    directory_candidates: list[MlaArtifactTarget] = []
    for artifact in prepared.artifacts:
        if artifact.availability is not ArtifactAvailability.AVAILABLE:
            continue
        for origin in artifact.all_origins():
            if (
                origin.kind is ArtifactKind.DIRECTORY
                and _is_explicit_origin(origin)
                and origin.path in maa_directory_origins
            ):
                directory_candidates.append(
                    MlaArtifactTarget(artifact_id=artifact.id, path=origin.path)
                )

    selected: list[MlaArtifactTarget] = []
    for candidate in sorted(
        directory_candidates,
        key=lambda item: (len(item.path.resolve().parts), str(item.path).lower()),
    ):
        if any(_is_within_directory(candidate.path, existing.path) for existing in selected):
            continue
        selected.append(candidate)
    return selected


def _explicit_mla_log_targets(
    prepared: PreparedAnalysis,
    maa_artifact_ids: set[str],
    selected_directories: list[MlaArtifactTarget],
) -> list[MlaArtifactTarget]:
    targets: list[MlaArtifactTarget] = []
    for artifact in prepared.artifacts:
        if artifact.id not in maa_artifact_ids:
            continue
        if artifact.availability is not ArtifactAvailability.AVAILABLE:
            continue
        explicit_log_origins = [
            origin
            for origin in artifact.all_origins()
            if origin.kind is not ArtifactKind.DIRECTORY
            and origin.media_kind is ArtifactMediaKind.LOG
            and _is_explicit_origin(origin)
        ]
        if not explicit_log_origins:
            continue
        origin = min(explicit_log_origins, key=lambda item: str(item.path).lower())
        if any(
            log_origin.media_kind is ArtifactMediaKind.LOG
            and _is_within_directory(log_origin.path, directory.path)
            for log_origin in artifact.all_origins()
            for directory in selected_directories
        ):
            continue
        targets.append(MlaArtifactTarget(artifact_id=artifact.id, path=origin.path))
    return targets


def _explicit_zip_targets(prepared: PreparedAnalysis) -> list[MlaArtifactTarget]:
    targets: list[MlaArtifactTarget] = []
    seen_artifacts: set[str] = set()
    for artifact in prepared.artifacts:
        if artifact.availability is not ArtifactAvailability.AVAILABLE:
            continue
        for origin in sorted(artifact.all_origins(), key=lambda item: str(item.path).lower()):
            if artifact.id in seen_artifacts:
                break
            if (
                origin.kind is not ArtifactKind.DIRECTORY
                and origin.media_kind is ArtifactMediaKind.ARCHIVE
                and origin.path.suffix.lower() == ".zip"
                and _is_explicit_origin(origin)
            ):
                targets.append(MlaArtifactTarget(artifact_id=artifact.id, path=origin.path))
                seen_artifacts.add(artifact.id)
    return targets


def select_mla_artifact_targets(
    prepared: PreparedAnalysis,
    inventory: ArtifactSourceInventory,
) -> list[MlaArtifactTarget]:
    """Select physical artifacts that should be inspected by MaaLogAnalyzer."""
    maa_artifact_ids = {
        classification.artifact_id
        for classification in inventory.classifications
        if classification.source_kind is ArtifactSourceKind.MAA_FRAMEWORK
    }
    directory_targets = _outermost_directory_targets(prepared, maa_artifact_ids)
    log_targets = _explicit_mla_log_targets(prepared, maa_artifact_ids, directory_targets)
    zip_targets = _explicit_zip_targets(prepared)

    targets: list[MlaArtifactTarget] = []
    seen: set[tuple[str, Path]] = set()
    for target in [*directory_targets, *log_targets, *zip_targets]:
        key = (target.artifact_id, target.path)
        if key in seen:
            continue
        targets.append(target)
        seen.add(key)
    return targets
