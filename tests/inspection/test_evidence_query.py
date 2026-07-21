import subprocess
from pathlib import Path

import pytest

from maa_diagnostic_expert.contracts.domain import (
    AnalysisRequest,
    EvidenceQuery,
    SourceInput,
    SourceRole,
)
from maa_diagnostic_expert.discovery.preparation import prepare_analysis
from maa_diagnostic_expert.inspection.evidence_query import query_evidence


def _git(repository: Path, *arguments: str) -> str:
    completed = subprocess.run(
        ["git", "-C", str(repository), *arguments],
        check=True,
        capture_output=True,
        encoding="utf-8",
    )
    return completed.stdout.strip()


def _initialize_repository(repository: Path) -> None:
    repository.mkdir()
    _git(repository, "init")
    _git(repository, "config", "user.name", "MDE Test")
    _git(repository, "config", "user.email", "mde-test@example.invalid")


def _commit_all(repository: Path, message: str) -> str:
    _git(repository, "add", ".")
    _git(repository, "commit", "-m", message)
    return _git(repository, "rev-parse", "HEAD")


def test_query_evidence_attributes_the_most_specific_source(tmp_path: Path) -> None:
    project_root = tmp_path / "project"
    framework_root = project_root / "deps" / "MaaFramework"
    framework_root.mkdir(parents=True)
    source_file = framework_root / "PipelineTask.cpp"
    source_file.write_text("one\ntwo\nthree\n", encoding="utf-8")
    prepared = prepare_analysis(
        AnalysisRequest(
            question="Inspect version-matched framework source.",
            sources=[
                SourceInput(
                    source_id="project",
                    role=SourceRole.PROJECT,
                    path=project_root,
                ),
                SourceInput(
                    source_id="maa-framework",
                    role=SourceRole.MAA_FRAMEWORK,
                    path=framework_root,
                ),
            ],
        )
    )

    window = query_evidence(
        prepared,
        EvidenceQuery(
            source_path=source_file,
            line_start=2,
            line_end=2,
            reason="Inspect the framework implementation.",
        ),
    )

    assert window.evidence.source_component == "source:maa-framework"


def test_query_evidence_rejects_git_metadata_in_every_source(tmp_path: Path) -> None:
    project_root = tmp_path / "project"
    git_dir = project_root / ".git"
    git_dir.mkdir(parents=True)
    git_config = git_dir / "config"
    git_config.write_text("secret", encoding="utf-8")
    prepared = prepare_analysis(
        AnalysisRequest(
            question="Inspect the project.",
            sources=[
                SourceInput(
                    source_id="project",
                    role=SourceRole.PROJECT,
                    path=project_root,
                )
            ],
        )
    )

    with pytest.raises(ValueError, match="Git metadata"):
        query_evidence(
            prepared,
            EvidenceQuery(
                source_path=git_config,
                line_start=1,
                line_end=1,
                reason="This path must remain unauthorized.",
            ),
        )


def test_query_evidence_reads_the_requested_historical_revision(tmp_path: Path) -> None:
    repository = tmp_path / "repository"
    _initialize_repository(repository)
    component = repository / "component"
    component.mkdir()
    source_file = component / "PipelineTask.cpp"
    source_file.write_text("historical line\n", encoding="utf-8")
    historical_revision = _commit_all(repository, "historical source")
    source_file.write_text("current line\n", encoding="utf-8")
    _commit_all(repository, "current source")
    prepared = prepare_analysis(
        AnalysisRequest(
            question="Inspect historical source.",
            sources=[
                SourceInput(
                    source_id="project",
                    role=SourceRole.PROJECT,
                    path=component,
                    revision=historical_revision,
                )
            ],
        )
    )

    window = query_evidence(
        prepared,
        EvidenceQuery(
            source_path=source_file,
            line_start=1,
            line_end=1,
            reason="Read the issue-time implementation.",
        ),
    )

    assert window.evidence.content == "historical line"
    assert window.evidence.source_path == (f"git:project@{historical_revision}:PipelineTask.cpp")


def test_query_evidence_ignores_dirty_worktree_content_for_a_revision(tmp_path: Path) -> None:
    repository = tmp_path / "repository"
    _initialize_repository(repository)
    source_file = repository / "pipeline.json"
    source_file.write_text('{"value": "committed"}\n', encoding="utf-8")
    revision = _commit_all(repository, "committed source")
    prepared = prepare_analysis(
        AnalysisRequest(
            question="Inspect committed source.",
            sources=[
                SourceInput(
                    source_id="project",
                    role=SourceRole.PROJECT,
                    path=repository,
                    revision=revision,
                )
            ],
        )
    )
    source_file.write_text('{"value": "dirty"}\n', encoding="utf-8")

    window = query_evidence(
        prepared,
        EvidenceQuery(
            source_path=source_file,
            line_start=1,
            line_end=1,
            reason="Exclude dirty worktree changes.",
        ),
    )

    assert window.evidence.content == '{"value": "committed"}'


def test_query_evidence_rejects_a_file_missing_from_the_revision(tmp_path: Path) -> None:
    repository = tmp_path / "repository"
    _initialize_repository(repository)
    tracked_file = repository / "README.md"
    tracked_file.write_text("base\n", encoding="utf-8")
    revision = _commit_all(repository, "base source")
    later_file = repository / "later.json"
    later_file.write_text("later\n", encoding="utf-8")
    prepared = prepare_analysis(
        AnalysisRequest(
            question="Inspect historical source.",
            sources=[
                SourceInput(
                    source_id="project",
                    role=SourceRole.PROJECT,
                    path=repository,
                    revision=revision,
                )
            ],
        )
    )

    with pytest.raises(ValueError, match="not present at revision"):
        query_evidence(
            prepared,
            EvidenceQuery(
                source_path=later_file,
                line_start=1,
                line_end=1,
                reason="This file did not exist at the requested revision.",
            ),
        )
