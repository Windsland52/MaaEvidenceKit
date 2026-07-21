import subprocess
from pathlib import Path

import pytest
from pydantic import ValidationError

from maa_diagnostic_expert.contracts.domain import (
    AnalysisRequest,
    EvidenceReliability,
    SourceInput,
    SourceRole,
)
from maa_diagnostic_expert.contracts.workflow import (
    SourceResearchPlan,
    SourceResearchStatus,
    SourceSearchQuery,
)
from maa_diagnostic_expert.discovery.preparation import prepare_analysis
from maa_diagnostic_expert.inspection.models import DeterministicInspection
from maa_diagnostic_expert.inspection.source_search import (
    execute_source_research,
    synthesize_source_search_evidence,
)


def _git(repository: Path, *arguments: str) -> str:
    completed = subprocess.run(
        ["git", "-C", str(repository), *arguments],
        check=True,
        capture_output=True,
        encoding="utf-8",
    )
    return completed.stdout.strip()


def _repository(tmp_path: Path) -> tuple[Path, str]:
    repository = tmp_path / "project"
    repository.mkdir()
    _git(repository, "init")
    _git(repository, "config", "user.name", "MDE Test")
    _git(repository, "config", "user.email", "mde-test@example.invalid")
    source = repository / "src"
    source.mkdir()
    (source / "login.py").write_text(
        "def LoginButton():\n    return 'committed'\n",
        encoding="utf-8",
    )
    _git(repository, "add", ".")
    _git(repository, "commit", "-m", "source")
    return repository, _git(repository, "rev-parse", "HEAD")


def _inspection(repository: Path, revision: str) -> DeterministicInspection:
    prepared = prepare_analysis(
        AnalysisRequest(
            question="Inspect login behavior.",
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
    return DeterministicInspection(prepared=prepared)


def _plan(term: str) -> SourceResearchPlan:
    return SourceResearchPlan(
        status=SourceResearchStatus.RUN,
        rationale="Locate the implementation named by runtime evidence.",
        queries=[
            SourceSearchQuery(
                query_id="login-symbol",
                source_id="project",
                terms=[term],
                paths=["src"],
                reason="Inspect the login task implementation.",
                context_lines=1,
                max_results=5,
            )
        ],
    )


def test_source_search_reads_requested_revision_not_dirty_worktree(
    tmp_path: Path,
) -> None:
    repository, revision = _repository(tmp_path)
    inspection = _inspection(repository, revision)
    (repository / "src" / "login.py").write_text(
        "def LoginButton():\n    return 'dirty'\n",
        encoding="utf-8",
    )

    inspection = execute_source_research(inspection, _plan("LoginButton"))
    evidence = synthesize_source_search_evidence(inspection.source_search_matches)

    [match] = inspection.source_search_matches
    assert match.relative_path == "src/login.py"
    assert "committed" in match.content
    assert "dirty" not in match.content
    assert match.source_locator == (f"git:project@{revision}:src/login.py")
    assert len(evidence) == 1
    assert evidence[0].reliability is EvidenceReliability.SECONDARY


def test_source_search_records_no_matches(tmp_path: Path) -> None:
    repository, revision = _repository(tmp_path)

    inspection = execute_source_research(
        _inspection(repository, revision),
        _plan("MissingSymbol"),
    )

    assert inspection.source_search_matches == []
    assert "source_search_no_matches" in {
        item.code for item in inspection.prepared.missing_evidence
    }


def test_source_search_records_query_truncation(tmp_path: Path) -> None:
    repository, revision = _repository(tmp_path)
    (repository / "src" / "login.py").write_text(
        "\n".join(f"LoginButton_{index}" for index in range(4)) + "\n",
        encoding="utf-8",
    )
    _git(repository, "add", ".")
    _git(repository, "commit", "-m", "more matches")
    revision = _git(repository, "rev-parse", "HEAD")
    plan = _plan("LoginButton").model_copy(
        update={"queries": [_plan("LoginButton").queries[0].model_copy(update={"max_results": 2})]}
    )

    inspection = execute_source_research(
        _inspection(repository, revision),
        plan,
    )

    assert len(inspection.source_search_matches) == 2
    assert "source_search_query_truncated" in {
        item.code for item in inspection.prepared.missing_evidence
    }


def test_source_search_treats_paths_as_literal(tmp_path: Path) -> None:
    repository, revision = _repository(tmp_path)
    literal_directory = repository / "src[a]"
    literal_directory.mkdir()
    (literal_directory / "expected.py").write_text(
        "LoginButton = 'literal'\n",
        encoding="utf-8",
    )
    pattern_match_directory = repository / "srca"
    pattern_match_directory.mkdir()
    (pattern_match_directory / "unexpected.py").write_text(
        "LoginButton = 'pattern match'\n",
        encoding="utf-8",
    )
    _git(repository, "add", ".")
    _git(repository, "commit", "-m", "wildcard directory")
    revision = _git(repository, "rev-parse", "HEAD")
    plan = _plan("LoginButton").model_copy(
        update={
            "queries": [_plan("LoginButton").queries[0].model_copy(update={"paths": ["src[a]"]})]
        }
    )

    inspection = execute_source_research(
        _inspection(repository, revision),
        plan,
    )

    assert [match.relative_path for match in inspection.source_search_matches] == [
        "src[a]/expected.py"
    ]


def test_source_search_records_total_truncation(tmp_path: Path) -> None:
    repository, revision = _repository(tmp_path)
    (repository / "src" / "login.py").write_text(
        "\n".join(f"SearchTermA SearchTermB SearchTermC {index}" for index in range(21)) + "\n",
        encoding="utf-8",
    )
    _git(repository, "add", ".")
    _git(repository, "commit", "-m", "many matches")
    revision = _git(repository, "rev-parse", "HEAD")
    queries = [
        SourceSearchQuery(
            query_id=f"query-{index}",
            source_id="project",
            terms=[term],
            paths=["src"],
            reason="Exercise the global result limit.",
            context_lines=0,
            max_results=20,
        )
        for index, term in enumerate(
            ["SearchTermA", "SearchTermB", "SearchTermC"],
            start=1,
        )
    ]
    plan = SourceResearchPlan(
        status=SourceResearchStatus.RUN,
        rationale="Exercise the global result limit.",
        queries=queries,
    )

    inspection = execute_source_research(
        _inspection(repository, revision),
        plan,
    )

    assert len(inspection.source_search_matches) == 50
    assert "source_search_truncated" in {item.code for item in inspection.prepared.missing_evidence}


def test_source_search_query_rejects_parent_traversal() -> None:
    with pytest.raises(ValidationError, match="cannot traverse"):
        SourceSearchQuery(
            query_id="invalid",
            source_id="project",
            terms=["LoginButton"],
            paths=["../other"],
            reason="Invalid path.",
        )
