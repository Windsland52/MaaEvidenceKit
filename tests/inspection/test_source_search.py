import subprocess
from pathlib import Path

import pytest
from pydantic import ValidationError

from maa_diagnostic_expert.contracts.domain import (
    AnalysisRequest,
    EvidenceReliability,
    SourceInput,
    SourceRevisionBackend,
    SourceRole,
)
from maa_diagnostic_expert.contracts.workflow import (
    KnowledgeResearchPlan,
    SourceResearchPlan,
    SourceResearchStatus,
    SourceSearchQuery,
)
from maa_diagnostic_expert.discovery.preparation import prepare_analysis
from maa_diagnostic_expert.inspection.models import DeterministicInspection
from maa_diagnostic_expert.inspection.source_search import (
    execute_knowledge_research,
    execute_source_research,
    synthesize_knowledge_search_evidence,
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


def _wiki_repository(
    tmp_path: Path,
    *,
    original_revision: str,
    original_path: str = "src/login.py",
) -> tuple[Path, str]:
    repository = tmp_path / "wiki"
    repository.mkdir()
    _git(repository, "init")
    _git(repository, "config", "user.name", "MDE Test")
    _git(repository, "config", "user.email", "mde-test@example.invalid")
    (repository / "guide.md").write_text(
        "- LoginButton: inspect the original implementation. "
        f"[`{original_path}`](https://github.com/example/project/blob/"
        f"{original_revision}/{original_path})\n",
        encoding="utf-8",
    )
    _git(repository, "add", ".")
    _git(repository, "commit", "-m", "wiki navigation")
    return repository, _git(repository, "rev-parse", "HEAD")


def _wiki_knowledge_inspection(
    original: Path,
    original_revision: str,
    wiki: Path,
    wiki_revision: str,
) -> DeterministicInspection:
    prepared = prepare_analysis(
        AnalysisRequest(
            question="Inspect login behavior.",
            sources=[
                SourceInput(
                    source_id="framework",
                    role=SourceRole.MAA_FRAMEWORK,
                    path=original,
                    revision=original_revision,
                ),
                SourceInput(
                    source_id="wiki",
                    role=SourceRole.WIKI,
                    path=wiki,
                    revision=wiki_revision,
                ),
            ],
        )
    )
    return DeterministicInspection(prepared=prepared)


def _wiki_plan() -> KnowledgeResearchPlan:
    return KnowledgeResearchPlan(
        status=SourceResearchStatus.RUN,
        rationale="Use the Wiki to locate the original implementation.",
        queries=[
            SourceSearchQuery(
                query_id="wiki-login",
                source_id="wiki",
                terms=["LoginButton"],
                paths=["guide.md"],
                reason="Locate the version-pinned original source.",
                context_lines=0,
                max_results=5,
            )
        ],
    )


def _inspection(
    repository: Path,
    revision: str,
    role: SourceRole = SourceRole.PROJECT,
) -> DeterministicInspection:
    prepared = prepare_analysis(
        AnalysisRequest(
            question="Inspect login behavior.",
            sources=[
                SourceInput(
                    source_id="project",
                    role=role,
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


def test_source_search_matches_identifiers_case_insensitively(tmp_path: Path) -> None:
    repository, revision = _repository(tmp_path)

    inspection = execute_source_research(
        _inspection(repository, revision),
        _plan("loginbutton"),
    )

    [match] = inspection.source_search_matches
    assert "LoginButton" in match.content
    assert match.matched_terms == ["loginbutton"]


def test_source_search_prioritizes_rarer_terms_before_result_truncation(
    tmp_path: Path,
) -> None:
    repository, _ = _repository(tmp_path)
    (repository / "src" / "a_noise.py").write_text(
        "\n".join(f"screen_state_{index}" for index in range(8)) + "\n",
        encoding="utf-8",
    )
    (repository / "src" / "z_relevant.py").write_text(
        "def isWorkstationLocked(): pass\n",
        encoding="utf-8",
    )
    _git(repository, "add", ".")
    _git(repository, "commit", "-m", "search ranking")
    revision = _git(repository, "rev-parse", "HEAD")
    query = SourceSearchQuery(
        query_id="rank-specific-term",
        source_id="project",
        terms=["screen", "workstationlocked"],
        paths=["src"],
        reason="Prefer the distinctive implementation identifier.",
        context_lines=0,
        max_results=2,
    )

    inspection = execute_source_research(
        _inspection(repository, revision),
        SourceResearchPlan(
            status=SourceResearchStatus.RUN,
            rationale="Exercise relevance ranking before truncation.",
            queries=[query],
        ),
    )

    assert inspection.source_search_matches[0].relative_path == "src/z_relevant.py"
    assert inspection.source_search_matches[0].matched_terms == ["workstationlocked"]


def test_source_search_follows_concrete_identifiers_to_call_sites(tmp_path: Path) -> None:
    repository, _ = _repository(tmp_path)
    (repository / "src" / "service.py").write_text(
        "def is_workstation_locked():\n    return True\n",
        encoding="utf-8",
    )
    (repository / "src" / "toolbar.py").write_text(
        "if isWorkstationLocked():\n    cancel_start()\n",
        encoding="utf-8",
    )
    _git(repository, "add", ".")
    _git(repository, "commit", "-m", "identifier references")
    revision = _git(repository, "rev-parse", "HEAD")
    query = SourceSearchQuery(
        query_id="follow-lock-symbol",
        source_id="project",
        terms=["lock"],
        paths=["src/service.py"],
        reason="Find the lock check and its callers.",
        context_lines=0,
        max_results=5,
    )

    inspection = execute_source_research(
        _inspection(repository, revision),
        SourceResearchPlan(
            status=SourceResearchStatus.RUN,
            rationale="Follow the concrete lock-check identifier.",
            queries=[query],
        ),
    )

    assert {match.relative_path for match in inspection.source_search_matches} >= {
        "src/service.py",
        "src/toolbar.py",
    }
    assert "source_search_identifier_followup" in {
        item.code for item in inspection.prepared.missing_evidence
    }


def test_source_search_reads_requested_revision_when_head_has_advanced(
    tmp_path: Path,
) -> None:
    repository, revision = _repository(tmp_path)
    (repository / "src" / "login.py").write_text(
        "def NewLoginButton():\n    return 'new'\n",
        encoding="utf-8",
    )
    _git(repository, "add", ".")
    _git(repository, "commit", "-m", "new source")

    inspection = execute_source_research(
        _inspection(repository, revision),
        _plan("LoginButton"),
    )

    [match] = inspection.source_search_matches
    assert "committed" in match.content
    assert "requested_revision_not_checked_out" in {
        item.code for item in inspection.prepared.missing_evidence
    }


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


def test_source_search_deduplicates_overlapping_context_windows(tmp_path: Path) -> None:
    repository, _ = _repository(tmp_path)
    (repository / "src" / "login.py").write_text(
        "LoginButton first\nLoginButton adjacent\n\n\n\nLoginButton distant\n",
        encoding="utf-8",
    )
    _git(repository, "add", ".")
    _git(repository, "commit", "-m", "overlapping matches")
    revision = _git(repository, "rev-parse", "HEAD")
    query = (
        _plan("LoginButton").queries[0].model_copy(update={"context_lines": 1, "max_results": 5})
    )

    inspection = execute_source_research(
        _inspection(repository, revision),
        SourceResearchPlan(
            status=SourceResearchStatus.RUN,
            rationale="Deduplicate overlapping source windows.",
            queries=[query],
        ),
    )

    assert [match.line for match in inspection.source_search_matches] == [1, 6]


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


def test_implementation_source_search_relaxes_zero_match_path_hints(
    tmp_path: Path,
) -> None:
    repository, revision = _repository(tmp_path)
    plan = _plan("LoginButton").model_copy(
        update={
            "queries": [
                _plan("LoginButton")
                .queries[0]
                .model_copy(update={"paths": ["invented/source/directory"]})
            ]
        }
    )

    inspection = execute_source_research(
        _inspection(repository, revision),
        plan,
    )

    assert [match.relative_path for match in inspection.source_search_matches] == ["src/login.py"]
    assert "source_search_paths_relaxed" in {
        item.code for item in inspection.prepared.missing_evidence
    }


def test_knowledge_search_does_not_relax_document_path_hints(tmp_path: Path) -> None:
    repository, revision = _repository(tmp_path)
    query = _plan("LoginButton").queries[0].model_copy(update={"paths": ["invented/docs"]})
    plan = KnowledgeResearchPlan(
        status=SourceResearchStatus.RUN,
        rationale="Keep knowledge search within the planned documentation path.",
        queries=[query],
    )

    inspection = execute_knowledge_research(
        _inspection(repository, revision, SourceRole.DOCUMENTATION),
        plan,
    )

    assert inspection.knowledge_search_matches == []
    assert "source_search_paths_relaxed" not in {
        item.code for item in inspection.prepared.missing_evidence
    }


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


@pytest.mark.parametrize(
    ("role", "expected_kind"),
    [
        (SourceRole.DOCUMENTATION, "knowledge_document_match"),
        (SourceRole.WIKI, "wiki_navigation_match"),
    ],
)
def test_knowledge_search_classifies_document_and_wiki_evidence(
    tmp_path: Path,
    role: SourceRole,
    expected_kind: str,
) -> None:
    repository, revision = _repository(tmp_path)
    source_plan = _plan("LoginButton")
    plan = KnowledgeResearchPlan(
        status=SourceResearchStatus.RUN,
        rationale="Find relevant documentation.",
        queries=source_plan.queries,
    )

    inspection = execute_knowledge_research(
        _inspection(repository, revision, role),
        plan,
    )
    evidence = synthesize_knowledge_search_evidence(inspection.knowledge_search_matches)

    assert len(inspection.knowledge_search_matches) == 1
    assert inspection.prepared.source_snapshots[0].revision_backend is SourceRevisionBackend.GIT
    assert inspection.source_search_matches == []
    assert evidence[0].kind == expected_kind
    assert evidence[0].reliability is EvidenceReliability.CONTEXT


def test_source_and_knowledge_searches_namespace_the_same_window(
    tmp_path: Path,
) -> None:
    repository, _ = _repository(tmp_path)
    docs = repository / "docs"
    docs.mkdir()
    (docs / "locking.md").write_text(
        "LockScreen prevents scheduled task startup.\n",
        encoding="utf-8",
    )
    _git(repository, "add", ".")
    _git(repository, "commit", "-m", "documentation")
    revision = _git(repository, "rev-parse", "HEAD")
    query = SourceSearchQuery(
        query_id="lock-screen",
        source_id="project",
        terms=["LockScreen"],
        paths=["docs"],
        reason="Inspect the lock-screen behavior.",
        context_lines=0,
    )
    inspection = _inspection(repository, revision, SourceRole.MAA_FRAMEWORK)
    inspection = execute_source_research(
        inspection,
        SourceResearchPlan(
            status=SourceResearchStatus.RUN,
            queries=[query],
            rationale="Search implementation source.",
        ),
    )
    inspection = execute_knowledge_research(
        inspection,
        KnowledgeResearchPlan(
            status=SourceResearchStatus.RUN,
            queries=[query],
            rationale="Search documentation.",
        ),
    )

    [source_match] = inspection.source_search_matches
    [knowledge_match] = inspection.knowledge_search_matches
    assert source_match.source_locator == knowledge_match.source_locator
    assert source_match.content == knowledge_match.content
    assert source_match.evidence_id != knowledge_match.evidence_id
    assert synthesize_source_search_evidence([source_match])[0].kind == "source_search_match"
    assert (
        synthesize_knowledge_search_evidence([knowledge_match])[0].kind
        == "knowledge_document_match"
    )


def test_wiki_navigation_resolves_revision_matched_original_source(tmp_path: Path) -> None:
    original, original_revision = _repository(tmp_path)
    wiki, wiki_revision = _wiki_repository(
        tmp_path,
        original_revision=original_revision,
    )

    inspection = execute_knowledge_research(
        _wiki_knowledge_inspection(
            original,
            original_revision,
            wiki,
            wiki_revision,
        ),
        _wiki_plan(),
    )
    evidence = synthesize_knowledge_search_evidence(inspection.knowledge_search_matches)

    assert {match.source_role for match in inspection.knowledge_search_matches} == {
        SourceRole.WIKI,
        SourceRole.MAA_FRAMEWORK,
    }
    original_match = next(
        match
        for match in inspection.knowledge_search_matches
        if match.source_role is SourceRole.MAA_FRAMEWORK
    )
    assert original_match.relative_path == "src/login.py"
    assert original_match.source_locator == (f"git:framework@{original_revision}:src/login.py")
    assert "committed" in original_match.content
    assert {item.kind for item in evidence} == {
        "wiki_navigation_match",
        "knowledge_document_match",
    }


def test_wiki_navigation_does_not_fall_back_to_newer_source_revision(
    tmp_path: Path,
) -> None:
    original, linked_revision = _repository(tmp_path)
    wiki, wiki_revision = _wiki_repository(
        tmp_path,
        original_revision=linked_revision,
    )
    (original / "src" / "login.py").write_text(
        "def NewLoginButton():\n    return 'new'\n",
        encoding="utf-8",
    )
    _git(original, "add", ".")
    _git(original, "commit", "-m", "new source")
    current_revision = _git(original, "rev-parse", "HEAD")

    inspection = execute_knowledge_research(
        _wiki_knowledge_inspection(
            original,
            current_revision,
            wiki,
            wiki_revision,
        ),
        _wiki_plan(),
    )

    assert [match.source_role for match in inspection.knowledge_search_matches] == [SourceRole.WIKI]
    assert "wiki_original_source_unavailable" in {
        item.code for item in inspection.prepared.missing_evidence
    }


@pytest.mark.parametrize(
    "original_path",
    [
        "src/login.py?ref=main",
        "src/%2E%2E/secrets.txt",
    ],
)
def test_wiki_navigation_rejects_unpinned_or_traversing_original_locator(
    tmp_path: Path,
    original_path: str,
) -> None:
    original, original_revision = _repository(tmp_path)
    wiki, wiki_revision = _wiki_repository(
        tmp_path,
        original_revision=("main" if "ref=main" in original_path else original_revision),
        original_path=original_path,
    )

    inspection = execute_knowledge_research(
        _wiki_knowledge_inspection(
            original,
            original_revision,
            wiki,
            wiki_revision,
        ),
        _wiki_plan(),
    )

    assert [match.source_role for match in inspection.knowledge_search_matches] == [SourceRole.WIKI]
    assert "wiki_original_locator_unavailable" in {
        item.code for item in inspection.prepared.missing_evidence
    }


def test_knowledge_search_rejects_project_source(tmp_path: Path) -> None:
    repository, revision = _repository(tmp_path)
    source_plan = _plan("LoginButton")
    plan = KnowledgeResearchPlan(
        status=SourceResearchStatus.RUN,
        rationale="Project source is not a knowledge input.",
        queries=source_plan.queries,
    )

    inspection = execute_knowledge_research(
        _inspection(repository, revision),
        plan,
    )

    assert inspection.knowledge_search_matches == []
    assert "knowledge_search_source_unavailable" in {
        item.code for item in inspection.prepared.missing_evidence
    }


def test_knowledge_search_rejects_framework_implementation_path(
    tmp_path: Path,
) -> None:
    repository, revision = _repository(tmp_path)
    source_plan = _plan("LoginButton")
    plan = KnowledgeResearchPlan(
        status=SourceResearchStatus.RUN,
        rationale="Framework implementation is not documentation.",
        queries=source_plan.queries,
    )

    inspection = execute_knowledge_research(
        _inspection(repository, revision, SourceRole.MAA_FRAMEWORK),
        plan,
    )

    assert inspection.knowledge_search_matches == []
    assert "knowledge_search_path_unavailable" in {
        item.code for item in inspection.prepared.missing_evidence
    }
