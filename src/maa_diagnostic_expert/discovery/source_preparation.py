from __future__ import annotations

import subprocess
from pathlib import Path

from maa_diagnostic_expert.contracts.domain import (
    AnalysisRequest,
    MissingEvidence,
    RevisionResolutionStatus,
    SourceInput,
    SourceRole,
    SourceSnapshot,
)

from .inputs import resolve_project_root


def _git_revision(repository: Path, revision: str) -> str | None:
    try:
        completed = subprocess.run(
            ["git", "-C", str(repository), "rev-parse", "--verify", f"{revision}^{{commit}}"],
            capture_output=True,
            check=False,
            encoding="utf-8",
            timeout=5,
        )
    except (OSError, subprocess.SubprocessError):
        return None
    resolved = completed.stdout.strip()
    return resolved if completed.returncode == 0 and resolved else None


def _normalize_sources(request: AnalysisRequest) -> list[SourceInput]:
    sources = [
        source.model_copy(update={"path": source.path.expanduser().resolve()})
        for source in request.sources
    ]
    if any(source.role is SourceRole.PROJECT for source in sources):
        return sources

    cwd_project = resolve_project_root(None)
    if cwd_project is None:
        return sources
    if any(source.source_id == "project" for source in sources):
        raise ValueError("The implicit cwd project conflicts with source ID 'project'")
    sources.append(SourceInput(source_id="project", role=SourceRole.PROJECT, path=cwd_project))
    return sources


def _snapshot(source: SourceInput) -> SourceSnapshot:
    source_path = source.path
    current_revision: str | None = None
    resolved_revision: str | None = None
    if not source_path.exists():
        status = RevisionResolutionStatus.PATH_MISSING
    elif not source_path.is_dir():
        status = RevisionResolutionStatus.NOT_A_DIRECTORY
    else:
        current_revision = _git_revision(source_path, "HEAD")
        if current_revision is None:
            status = RevisionResolutionStatus.NOT_A_GIT_REPOSITORY
        elif source.revision is None:
            status = RevisionResolutionStatus.NOT_REQUESTED
        else:
            resolved_revision = _git_revision(source_path, source.revision)
            status = (
                RevisionResolutionStatus.RESOLVED
                if resolved_revision is not None
                else RevisionResolutionStatus.UNRESOLVED
            )
    return SourceSnapshot(
        source_id=source.source_id,
        role=source.role,
        path=source_path,
        requested_revision=source.revision,
        resolved_revision=resolved_revision,
        current_revision=current_revision,
        resolution_status=status,
    )


def _missing_evidence(snapshot: SourceSnapshot, *, issue_diagnosis: bool) -> list[MissingEvidence]:
    missing: list[MissingEvidence] = []
    if snapshot.resolution_status is RevisionResolutionStatus.PATH_MISSING:
        missing.append(
            MissingEvidence(
                code="source_path_missing",
                message=f"Source '{snapshot.source_id}' path does not exist.",
                source_id=snapshot.source_id,
                source_path=snapshot.path,
            )
        )
    elif snapshot.resolution_status is RevisionResolutionStatus.NOT_A_DIRECTORY:
        missing.append(
            MissingEvidence(
                code="source_path_not_directory",
                message=f"Source '{snapshot.source_id}' path is not a directory.",
                source_id=snapshot.source_id,
                source_path=snapshot.path,
            )
        )

    versioned_role = snapshot.role in {
        SourceRole.PROJECT,
        SourceRole.MAA_FRAMEWORK,
        SourceRole.GUI,
        SourceRole.AGENT,
    }
    if issue_diagnosis and versioned_role and snapshot.requested_revision is None:
        missing.append(
            MissingEvidence(
                code="issue_revision_unresolved",
                message=(
                    f"Issue-time revision for source '{snapshot.source_id}' has not been supplied."
                ),
                source_id=snapshot.source_id,
                source_path=snapshot.path,
            )
        )
    elif (
        snapshot.requested_revision is not None
        and snapshot.resolution_status is not RevisionResolutionStatus.RESOLVED
    ):
        missing.append(
            MissingEvidence(
                code="requested_revision_unresolved",
                message=(
                    f"Revision '{snapshot.requested_revision}' for source "
                    f"'{snapshot.source_id}' is not available."
                ),
                source_id=snapshot.source_id,
                source_path=snapshot.path,
            )
        )
    return missing


def prepare_sources(
    request: AnalysisRequest,
) -> tuple[list[SourceInput], list[SourceSnapshot], list[MissingEvidence]]:
    sources = _normalize_sources(request)
    snapshots = [_snapshot(source) for source in sources]
    missing = [
        item
        for snapshot in snapshots
        for item in _missing_evidence(snapshot, issue_diagnosis=request.issue is not None)
    ]
    if request.issue and not any(source.role is SourceRole.PROJECT for source in sources):
        missing.append(
            MissingEvidence(
                code="project_source_missing",
                message="Issue diagnosis requires an explicit Maa project source path.",
            )
        )
    return sources, snapshots, missing
