import subprocess
from pathlib import Path

import pytest

from maa_diagnostic_expert.contracts.domain import (
    AnalysisRequest,
    RevisionResolutionStatus,
    SourceInput,
    SourceRole,
    SourceSnapshot,
)
from maa_diagnostic_expert.discovery.preparation import prepare_analysis
from maa_diagnostic_expert.discovery.source_preparation import (
    source_snapshot_matches_checkout,
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
        requested_revision="v1",
        resolved_revision="old",
        current_revision="new",
        resolution_status=RevisionResolutionStatus.RESOLVED,
    )

    assert not source_snapshot_matches_checkout(
        snapshot,
        require_requested_revision=True,
    )


def test_prepare_reports_resolved_revision_that_is_not_checked_out(tmp_path: Path) -> None:
    subprocess.run(["git", "init", str(tmp_path)], check=True, capture_output=True)
    subprocess.run(
        ["git", "-C", str(tmp_path), "config", "user.email", "mde@example.invalid"],
        check=True,
    )
    subprocess.run(
        ["git", "-C", str(tmp_path), "config", "user.name", "MDE Test"],
        check=True,
    )
    interface = tmp_path / "interface.json"
    interface.write_text("{}", encoding="utf-8")
    subprocess.run(["git", "-C", str(tmp_path), "add", "interface.json"], check=True)
    subprocess.run(
        ["git", "-C", str(tmp_path), "commit", "-m", "first"],
        check=True,
        capture_output=True,
    )
    first_revision = subprocess.run(
        ["git", "-C", str(tmp_path), "rev-parse", "HEAD"],
        check=True,
        capture_output=True,
        encoding="utf-8",
    ).stdout.strip()
    interface.write_text('{"task":[]}', encoding="utf-8")
    subprocess.run(["git", "-C", str(tmp_path), "add", "interface.json"], check=True)
    subprocess.run(
        ["git", "-C", str(tmp_path), "commit", "-m", "second"],
        check=True,
        capture_output=True,
    )

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
