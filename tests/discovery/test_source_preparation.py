import hashlib
import json
import subprocess
from pathlib import Path

import pytest

from maa_diagnostic_expert.contracts.domain import (
    AnalysisRequest,
    RevisionResolutionStatus,
    SourceInput,
    SourceRevisionBackend,
    SourceRole,
    SourceSnapshot,
)
from maa_diagnostic_expert.discovery.preparation import prepare_analysis
from maa_diagnostic_expert.discovery.source_preparation import (
    source_snapshot_matches_checkout,
)


def _git(repository: Path, *arguments: str) -> str:
    return subprocess.run(
        ["git", "-C", str(repository), *arguments],
        check=True,
        capture_output=True,
        encoding="utf-8",
    ).stdout.strip()


def _init_project_repository(repository: Path) -> str:
    subprocess.run(["git", "init", str(repository)], check=True, capture_output=True)
    _git(repository, "config", "user.email", "mde@example.invalid")
    _git(repository, "config", "user.name", "MDE Test")
    (repository / "interface.json").write_text("{}", encoding="utf-8")
    _git(repository, "add", "interface.json")
    _git(repository, "commit", "-m", "first")
    return _git(repository, "rev-parse", "HEAD")


def _write_catalog_snapshot(path: Path, revision: str) -> None:
    readme = path / "README.md"
    readme.write_text("", encoding="utf-8")
    manifest = {
        "api_version": "maa-llm-wiki-catalog/v1",
        "wiki_revision": revision,
        "working_tree_clean": True,
        "sources": [
            {
                "source_id": "maafw",
                "version": "v1",
                "revision": revision,
            }
        ],
        "files": [
            {
                "path": "README.md",
                "size_bytes": 0,
                "sha256": hashlib.sha256(b"").hexdigest(),
            }
        ],
    }
    (path / "catalog-manifest.json").write_text(
        json.dumps(manifest),
        encoding="utf-8",
    )


def test_prepare_uses_cwd_only_when_it_is_a_maa_project(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    assets = tmp_path / "assets"
    assets.mkdir()
    (assets / "interface.json").write_text("{}", encoding="utf-8")
    monkeypatch.chdir(tmp_path)

    prepared = prepare_analysis(AnalysisRequest(question="Inspect this Maa project."))

    assert len(prepared.source_snapshots) == 1
    snapshot = prepared.source_snapshots[0]
    assert snapshot.source_id == "project"
    assert snapshot.role is SourceRole.PROJECT
    assert snapshot.path == tmp_path.resolve()


def test_prepare_reports_each_invalid_source_path(tmp_path: Path) -> None:
    missing_path = tmp_path / "missing-framework"
    file_path = tmp_path / "project.json"
    file_path.write_text("{}", encoding="utf-8")

    prepared = prepare_analysis(
        AnalysisRequest(
            question="Resolve the source inputs.",
            sources=[
                SourceInput(
                    source_id="maa-framework",
                    role=SourceRole.MAA_FRAMEWORK,
                    path=missing_path,
                    revision="v5.11.1",
                ),
                SourceInput(
                    source_id="project",
                    role=SourceRole.PROJECT,
                    path=file_path,
                    revision="v2.19.0",
                ),
            ],
        )
    )

    statuses = {
        snapshot.source_id: snapshot.resolution_status for snapshot in prepared.source_snapshots
    }
    assert statuses == {
        "maa-framework": RevisionResolutionStatus.PATH_MISSING,
        "project": RevisionResolutionStatus.NOT_A_DIRECTORY,
    }
    assert {item.code for item in prepared.missing_evidence} == {
        "requested_revision_unresolved",
        "source_path_missing",
        "source_path_not_directory",
    }


def test_issue_source_must_be_checked_out_at_resolved_revision(tmp_path: Path) -> None:
    snapshot = SourceSnapshot(
        source_id="project",
        role=SourceRole.PROJECT,
        path=tmp_path,
        revision_backend=SourceRevisionBackend.GIT,
        requested_revision="v1",
        resolved_revision="old",
        current_revision="new",
        resolution_status=RevisionResolutionStatus.RESOLVED,
    )

    assert not source_snapshot_matches_checkout(
        snapshot,
        require_requested_revision=True,
    )


def test_issue_documentation_requires_explicit_revision(tmp_path: Path) -> None:
    prepared = prepare_analysis(
        AnalysisRequest(
            issue="Interpret behavior from the issue-time documentation.",
            sources=[
                SourceInput(
                    source_id="docs",
                    role=SourceRole.DOCUMENTATION,
                    path=tmp_path,
                )
            ],
        )
    )

    assert any(
        item.code == "issue_revision_unresolved" and item.source_id == "docs"
        for item in prepared.missing_evidence
    )


def test_requested_revision_clean_worktree_is_usable(tmp_path: Path) -> None:
    revision = _init_project_repository(tmp_path)

    prepared = prepare_analysis(
        AnalysisRequest(
            issue="The project revision failed.",
            sources=[
                SourceInput(
                    source_id="project",
                    role=SourceRole.PROJECT,
                    path=tmp_path,
                    revision=revision,
                )
            ],
        )
    )

    assert not {
        item.code
        for item in prepared.missing_evidence
        if item.code.startswith("requested_revision_")
    }
    assert prepared.source_snapshots[0].revision_backend is SourceRevisionBackend.GIT
    assert source_snapshot_matches_checkout(
        prepared.source_snapshots[0],
        require_requested_revision=True,
    )


def test_requested_revision_rejects_tracked_worktree_modification(tmp_path: Path) -> None:
    revision = _init_project_repository(tmp_path)
    (tmp_path / "interface.json").write_text('{"task":[]}', encoding="utf-8")

    prepared = prepare_analysis(
        AnalysisRequest(
            issue="The project revision failed.",
            sources=[
                SourceInput(
                    source_id="project",
                    role=SourceRole.PROJECT,
                    path=tmp_path,
                    revision=revision,
                )
            ],
        )
    )

    assert "requested_revision_worktree_dirty" in {item.code for item in prepared.missing_evidence}
    assert not source_snapshot_matches_checkout(
        prepared.source_snapshots[0],
        require_requested_revision=True,
    )


@pytest.mark.parametrize("relative_path", ["pipeline.json", "AGENTS.md"])
def test_requested_revision_rejects_untracked_relevant_source_file(
    tmp_path: Path,
    relative_path: str,
) -> None:
    revision = _init_project_repository(tmp_path)
    (tmp_path / relative_path).write_text("{}", encoding="utf-8")

    prepared = prepare_analysis(
        AnalysisRequest(
            issue="The project revision failed.",
            sources=[
                SourceInput(
                    source_id="project",
                    role=SourceRole.PROJECT,
                    path=tmp_path,
                    revision=revision,
                )
            ],
        )
    )

    assert "requested_revision_worktree_dirty" in {item.code for item in prepared.missing_evidence}
    assert not source_snapshot_matches_checkout(
        prepared.source_snapshots[0],
        require_requested_revision=True,
    )


def test_project_source_with_catalog_manifest_still_requires_clean_worktree(
    tmp_path: Path,
) -> None:
    revision = _init_project_repository(tmp_path)
    _write_catalog_snapshot(tmp_path, "a" * 40)

    prepared = prepare_analysis(
        AnalysisRequest(
            issue="The project revision failed.",
            sources=[
                SourceInput(
                    source_id="project",
                    role=SourceRole.PROJECT,
                    path=tmp_path,
                    revision=revision,
                )
            ],
        )
    )

    assert "requested_revision_worktree_dirty" in {item.code for item in prepared.missing_evidence}
    assert prepared.source_snapshots[0].revision_backend is SourceRevisionBackend.GIT
    assert not source_snapshot_matches_checkout(
        prepared.source_snapshots[0],
        require_requested_revision=True,
    )


def test_requested_revision_ignores_ignored_worktree_files(tmp_path: Path) -> None:
    revision = _init_project_repository(tmp_path)
    (tmp_path / ".gitignore").write_text("node_modules/\n.venv/\n", encoding="utf-8")
    _git(tmp_path, "add", ".gitignore")
    _git(tmp_path, "commit", "-m", "ignore local dependencies")
    revision = _git(tmp_path, "rev-parse", "HEAD")
    ignored_file = tmp_path / "node_modules" / "pkg" / "index.js"
    ignored_file.parent.mkdir(parents=True)
    ignored_file.write_text("module.exports = {}", encoding="utf-8")

    prepared = prepare_analysis(
        AnalysisRequest(
            issue="The project revision failed.",
            sources=[
                SourceInput(
                    source_id="project",
                    role=SourceRole.PROJECT,
                    path=tmp_path,
                    revision=revision,
                )
            ],
        )
    )

    assert not {
        item.code
        for item in prepared.missing_evidence
        if item.code.startswith("requested_revision_")
    }
    assert source_snapshot_matches_checkout(
        prepared.source_snapshots[0],
        require_requested_revision=True,
    )


def test_wiki_catalog_snapshot_rechecks_live_manifest_revision(tmp_path: Path) -> None:
    revision = "a" * 40
    _write_catalog_snapshot(tmp_path, revision)
    snapshot = SourceSnapshot(
        source_id="wiki",
        role=SourceRole.WIKI,
        path=tmp_path,
        revision_backend=SourceRevisionBackend.WIKI_CATALOG,
        requested_revision=revision,
        resolved_revision=revision,
        current_revision=revision,
        resolution_status=RevisionResolutionStatus.RESOLVED,
    )

    assert source_snapshot_matches_checkout(
        snapshot,
        require_requested_revision=True,
    )

    _write_catalog_snapshot(tmp_path, "b" * 40)

    assert not source_snapshot_matches_checkout(
        snapshot,
        require_requested_revision=True,
    )

    (tmp_path / "catalog-manifest.json").unlink()

    assert not source_snapshot_matches_checkout(
        snapshot,
        require_requested_revision=True,
    )

    (tmp_path / "catalog-manifest.json").write_text("{", encoding="utf-8")

    assert not source_snapshot_matches_checkout(
        snapshot,
        require_requested_revision=True,
    )


def test_wiki_catalog_snapshot_does_not_fallback_to_git_when_manifest_is_deleted(
    tmp_path: Path,
) -> None:
    subprocess.run(["git", "init", str(tmp_path)], check=True, capture_output=True)
    _git(tmp_path, "config", "user.email", "mde@example.invalid")
    _git(tmp_path, "config", "user.name", "MDE Test")
    (tmp_path / "README.md").write_text("", encoding="utf-8")
    _git(tmp_path, "add", "README.md")
    _git(tmp_path, "commit", "-m", "catalog content")
    revision = _git(tmp_path, "rev-parse", "HEAD")
    _write_catalog_snapshot(tmp_path, revision)
    snapshot = SourceSnapshot(
        source_id="wiki",
        role=SourceRole.WIKI,
        path=tmp_path,
        revision_backend=SourceRevisionBackend.WIKI_CATALOG,
        requested_revision=revision,
        resolved_revision=revision,
        current_revision=revision,
        resolution_status=RevisionResolutionStatus.RESOLVED,
    )

    assert source_snapshot_matches_checkout(
        snapshot,
        require_requested_revision=True,
    )

    (tmp_path / "catalog-manifest.json").unlink()

    assert not source_snapshot_matches_checkout(
        snapshot,
        require_requested_revision=True,
    )


def test_requested_revision_rejects_unresolved_worktree_state(tmp_path: Path) -> None:
    worktree = tmp_path / "worktree"
    bare_repository = tmp_path / "source.git"
    revision = _init_project_repository(worktree)
    subprocess.run(
        ["git", "clone", "--bare", str(worktree), str(bare_repository)],
        check=True,
        capture_output=True,
    )

    prepared = prepare_analysis(
        AnalysisRequest(
            issue="The documentation revision failed.",
            sources=[
                SourceInput(
                    source_id="docs",
                    role=SourceRole.DOCUMENTATION,
                    path=bare_repository,
                    revision=revision,
                )
            ],
        )
    )

    assert "requested_revision_worktree_state_unresolved" in {
        item.code for item in prepared.missing_evidence
    }
    assert not source_snapshot_matches_checkout(
        prepared.source_snapshots[0],
        require_requested_revision=True,
    )


def test_requested_revision_rechecks_live_head_after_preparation(tmp_path: Path) -> None:
    revision = _init_project_repository(tmp_path)
    prepared = prepare_analysis(
        AnalysisRequest(
            issue="The project revision failed.",
            sources=[
                SourceInput(
                    source_id="project",
                    role=SourceRole.PROJECT,
                    path=tmp_path,
                    revision=revision,
                )
            ],
        )
    )
    (tmp_path / "interface.json").write_text('{"task":[]}', encoding="utf-8")
    _git(tmp_path, "add", "interface.json")
    _git(tmp_path, "commit", "-m", "second")

    assert not source_snapshot_matches_checkout(
        prepared.source_snapshots[0],
        require_requested_revision=True,
    )


def test_requested_revision_rechecks_live_dirty_worktree_after_preparation(
    tmp_path: Path,
) -> None:
    revision = _init_project_repository(tmp_path)
    prepared = prepare_analysis(
        AnalysisRequest(
            issue="The project revision failed.",
            sources=[
                SourceInput(
                    source_id="project",
                    role=SourceRole.PROJECT,
                    path=tmp_path,
                    revision=revision,
                )
            ],
        )
    )
    (tmp_path / "AGENTS.md").write_text("local instructions", encoding="utf-8")

    assert not source_snapshot_matches_checkout(
        prepared.source_snapshots[0],
        require_requested_revision=True,
    )


def test_prepare_reports_resolved_revision_that_is_not_checked_out(tmp_path: Path) -> None:
    first_revision = _init_project_repository(tmp_path)
    (tmp_path / "interface.json").write_text('{"task":[]}', encoding="utf-8")
    _git(tmp_path, "add", "interface.json")
    _git(tmp_path, "commit", "-m", "second")

    prepared = prepare_analysis(
        AnalysisRequest(
            issue="The old project revision failed.",
            sources=[
                SourceInput(
                    source_id="project",
                    role=SourceRole.PROJECT,
                    path=tmp_path,
                    revision=first_revision,
                )
            ],
        )
    )

    assert "requested_revision_not_checked_out" in {item.code for item in prepared.missing_evidence}
