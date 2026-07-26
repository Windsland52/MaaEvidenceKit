from __future__ import annotations

import subprocess
from pathlib import Path
from typing import Literal

from maa_diagnostic_expert.contracts.domain import (
    AnalysisRequest,
    MissingEvidence,
    RevisionResolutionStatus,
    SourceInput,
    SourceRevisionBackend,
    SourceRole,
    SourceSnapshot,
)
from maa_diagnostic_expert.contracts.knowledge import WikiCatalogKind
from maa_diagnostic_expert.knowledge.catalog import (
    is_catalog_snapshot,
    resolve_wiki_catalog,
    snapshot_revision,
)

from .inputs import resolve_project_root

type _GitWorktreeState = Literal["clean", "dirty", "unresolved"]


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


def _git_worktree_state(repository: Path) -> _GitWorktreeState:
    try:
        completed = subprocess.run(
            [
                "git",
                "--no-optional-locks",
                "-C",
                str(repository),
                "-c",
                "core.fsmonitor=false",
                "status",
                "--porcelain=v1",
                "--untracked-files=all",
                "--ignore-submodules=none",
                "--",
                ".",
            ],
            capture_output=True,
            check=False,
            encoding="utf-8",
            timeout=5,
        )
    except (OSError, subprocess.SubprocessError):
        return "unresolved"
    if completed.returncode != 0:
        return "unresolved"
    return "dirty" if completed.stdout.strip() else "clean"


def _live_catalog_revision(snapshot: SourceSnapshot) -> str | None:
    if snapshot.revision_backend is not SourceRevisionBackend.WIKI_CATALOG:
        return None
    if not is_catalog_snapshot(snapshot.path):
        return None
    try:
        status = resolve_wiki_catalog(snapshot.path)
    except (OSError, ValueError):
        return None
    if status.kind is not WikiCatalogKind.BUNDLE_SNAPSHOT:
        return None
    return status.wiki_revision


def _catalog_snapshot_matches_checkout(snapshot: SourceSnapshot) -> bool:
    live_revision = _live_catalog_revision(snapshot)
    expected_revision = _snapshot_object_revision(snapshot, require_requested_revision=False)
    return (
        live_revision is not None
        and expected_revision is not None
        and expected_revision == live_revision
    )


def _snapshot_object_revision(
    snapshot: SourceSnapshot,
    *,
    require_requested_revision: bool,
) -> str | None:
    if require_requested_revision and snapshot.requested_revision is None:
        return None
    if snapshot.requested_revision is not None:
        if snapshot.resolution_status is not RevisionResolutionStatus.RESOLVED:
            return None
        return snapshot.resolved_revision
    if snapshot.resolution_status is not RevisionResolutionStatus.NOT_REQUESTED:
        return None
    return snapshot.current_revision


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
    revision_backend = SourceRevisionBackend.UNKNOWN
    current_revision: str | None = None
    resolved_revision: str | None = None
    if not source_path.exists():
        status = RevisionResolutionStatus.PATH_MISSING
    elif not source_path.is_dir():
        status = RevisionResolutionStatus.NOT_A_DIRECTORY
    else:
        catalog_revision = (
            snapshot_revision(source_path) if source.role is SourceRole.WIKI else None
        )
        current_revision = catalog_revision or _git_revision(source_path, "HEAD")
        if catalog_revision is not None:
            revision_backend = SourceRevisionBackend.WIKI_CATALOG
            if source.revision is None:
                status = RevisionResolutionStatus.NOT_REQUESTED
            elif source.revision == catalog_revision:
                resolved_revision = catalog_revision
                status = RevisionResolutionStatus.RESOLVED
            else:
                status = RevisionResolutionStatus.UNRESOLVED
        elif current_revision is None:
            status = RevisionResolutionStatus.NOT_A_GIT_REPOSITORY
        else:
            revision_backend = SourceRevisionBackend.GIT
            if source.revision is None:
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
        revision_backend=revision_backend,
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
        SourceRole.DOCUMENTATION,
        SourceRole.WIKI,
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
    elif (
        snapshot.requested_revision is not None
        and snapshot.resolved_revision != snapshot.current_revision
    ):
        missing.append(
            MissingEvidence(
                code="requested_revision_not_checked_out",
                message=(
                    f"Resolved revision for source '{snapshot.source_id}' is not the "
                    "currently checked-out revision."
                ),
                source_id=snapshot.source_id,
                source_path=snapshot.path,
            )
        )
    elif (
        snapshot.requested_revision is not None
        and snapshot.revision_backend is SourceRevisionBackend.WIKI_CATALOG
    ):
        if not _catalog_snapshot_matches_checkout(snapshot):
            missing.append(
                MissingEvidence(
                    code="requested_revision_worktree_state_unresolved",
                    message=(
                        f"Catalog snapshot revision for source '{snapshot.source_id}' could "
                        "not be confirmed at the requested revision."
                    ),
                    source_id=snapshot.source_id,
                    source_path=snapshot.path,
                )
            )
    elif (
        snapshot.requested_revision is not None
        and snapshot.revision_backend is SourceRevisionBackend.GIT
    ):
        worktree_state = _git_worktree_state(snapshot.path)
        if worktree_state == "dirty":
            missing.append(
                MissingEvidence(
                    code="requested_revision_worktree_dirty",
                    message=(
                        f"Source '{snapshot.source_id}' has uncommitted worktree changes "
                        "at the requested revision."
                    ),
                    source_id=snapshot.source_id,
                    source_path=snapshot.path,
                )
            )
        elif worktree_state == "unresolved":
            missing.append(
                MissingEvidence(
                    code="requested_revision_worktree_state_unresolved",
                    message=(
                        f"Worktree cleanliness for source '{snapshot.source_id}' could "
                        "not be determined at the requested revision."
                    ),
                    source_id=snapshot.source_id,
                    source_path=snapshot.path,
                )
            )
    elif snapshot.requested_revision is not None:
        missing.append(
            MissingEvidence(
                code="requested_revision_worktree_state_unresolved",
                message=(
                    f"Revision backend for source '{snapshot.source_id}' could not be determined."
                ),
                source_id=snapshot.source_id,
                source_path=snapshot.path,
            )
        )
    return missing


def source_snapshot_supports_object_read(
    snapshot: SourceSnapshot,
    *,
    require_requested_revision: bool,
) -> bool:
    """Return whether a captured Git object or Wiki catalog is still readable."""
    revision = _snapshot_object_revision(
        snapshot,
        require_requested_revision=require_requested_revision,
    )
    if revision is None:
        return False
    if snapshot.revision_backend is SourceRevisionBackend.WIKI_CATALOG:
        return _live_catalog_revision(snapshot) == revision
    if snapshot.revision_backend is SourceRevisionBackend.GIT:
        return _git_revision(snapshot.path, revision) == revision
    return False


def source_snapshot_object_revision(
    snapshot: SourceSnapshot,
    *,
    require_requested_revision: bool,
) -> str | None:
    """Return the immutable revision selected for object-backed reads, if usable."""
    if not source_snapshot_supports_object_read(
        snapshot,
        require_requested_revision=require_requested_revision,
    ):
        return None
    return _snapshot_object_revision(
        snapshot,
        require_requested_revision=require_requested_revision,
    )


def source_snapshot_matches_checkout(
    snapshot: SourceSnapshot,
    *,
    require_requested_revision: bool,
) -> bool:
    """Return whether direct worktree reads observe the intended revision."""
    revision = _snapshot_object_revision(
        snapshot,
        require_requested_revision=require_requested_revision,
    )
    if revision is None:
        return False
    if snapshot.requested_revision is not None and snapshot.current_revision != revision:
        return False
    if snapshot.revision_backend is SourceRevisionBackend.WIKI_CATALOG:
        return _catalog_snapshot_matches_checkout(snapshot)
    if snapshot.revision_backend is not SourceRevisionBackend.GIT:
        return False
    if snapshot.requested_revision is None:
        return True
    return (
        _git_revision(snapshot.path, "HEAD") == revision
        and _git_worktree_state(snapshot.path) == "clean"
    )


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
