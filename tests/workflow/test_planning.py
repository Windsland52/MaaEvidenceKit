from __future__ import annotations

import json
import os
import subprocess
from pathlib import Path

import pytest
from pydantic import ValidationError

from maa_diagnostic_expert.contracts.domain import (
    AnalysisRequest,
    ArtifactInput,
    ArtifactKind,
    EvidenceQuery,
    PreparedAnalysis,
    RevisionResolutionStatus,
    SourceRevisionBackend,
    SourceRole,
    SourceSnapshot,
)
from maa_diagnostic_expert.contracts.workflow import (
    AnalysisRelevance,
    BranchDecision,
    BranchDisposition,
    EvidenceResearchPlan,
    FixCandidate,
    FixCandidatePlan,
    FixMethod,
    FixPlanningStatus,
    FixScope,
    IncidentCandidate,
    IncidentSelection,
    IncidentSelectionStatus,
    InvestigationBranch,
    KnowledgeResearchPlan,
    SourceGuidance,
    SourceResearchPlan,
    SourceResearchStatus,
    SourceSearchQuery,
    VerificationMethod,
    VerificationPlan,
    VerificationPlanningStatus,
    VerificationPlanSet,
)
from maa_diagnostic_expert.discovery.preparation import prepare_analysis
from maa_diagnostic_expert.workflow.planning import plan_initial_investigation


def _git(repository: Path, *arguments: str) -> str:
    return subprocess.run(
        ["git", "-C", str(repository), *arguments],
        check=True,
        capture_output=True,
        encoding="utf-8",
    ).stdout.strip()


def _decision(prepared: PreparedAnalysis, branch: InvestigationBranch) -> BranchDecision:
    return plan_initial_investigation(prepared).decision_for(branch)


def test_plan_runs_mla_when_directory_contains_log(tmp_path: Path) -> None:
    debug = tmp_path / "debug"
    debug.mkdir()
    (debug / "maafw.log").write_text("log", encoding="utf-8")
    prepared = prepare_analysis(
        AnalysisRequest(
            question="What happened?",
            artifacts=[ArtifactInput(path=debug, kind=ArtifactKind.DIRECTORY)],
        )
    )

    mla = _decision(prepared, InvestigationBranch.MLA_GLOBAL_OVERVIEW)

    assert mla.disposition is BranchDisposition.RUN
    assert mla.relevance is AnalysisRelevance.USEFUL


def test_plan_skips_mla_for_image_only_directory(tmp_path: Path) -> None:
    debug = tmp_path / "debug"
    debug.mkdir()
    (debug / "on_error.png").write_bytes(b"image")
    prepared = prepare_analysis(
        AnalysisRequest(
            question="What does the failure screenshot show?",
            artifacts=[ArtifactInput(path=debug, kind=ArtifactKind.DIRECTORY)],
        )
    )

    mla = _decision(prepared, InvestigationBranch.MLA_GLOBAL_OVERVIEW)

    assert mla.disposition is BranchDisposition.SKIP
    assert mla.relevance is AnalysisRelevance.NOT_RELEVANT


def test_plan_skips_mla_for_directory_discovered_zip_without_mla_log(
    tmp_path: Path,
) -> None:
    debug = tmp_path / "debug"
    debug.mkdir()
    (debug / "debug.zip").write_bytes(b"zip")
    prepared = prepare_analysis(
        AnalysisRequest(
            question="What happened?",
            artifacts=[ArtifactInput(path=debug, kind=ArtifactKind.DIRECTORY)],
        )
    )

    mla = _decision(prepared, InvestigationBranch.MLA_GLOBAL_OVERVIEW)

    assert mla.disposition is BranchDisposition.SKIP
    assert mla.relevance is AnalysisRelevance.NOT_RELEVANT


def test_plan_runs_mla_for_explicit_zip_without_mla_log(tmp_path: Path) -> None:
    archive = tmp_path / "debug.zip"
    archive.write_bytes(b"zip")
    prepared = prepare_analysis(
        AnalysisRequest(
            question="What happened?",
            artifacts=[ArtifactInput(path=archive, kind=ArtifactKind.ARCHIVE)],
        )
    )

    mla = _decision(prepared, InvestigationBranch.MLA_GLOBAL_OVERVIEW)

    assert mla.disposition is BranchDisposition.RUN
    assert mla.relevance is AnalysisRelevance.USEFUL


def test_plan_runs_built_in_dump_branch(tmp_path: Path) -> None:
    dump = tmp_path / "client.dmp"
    dump.write_bytes(b"dump")
    prepared = prepare_analysis(
        AnalysisRequest(
            question="Why did the client crash?",
            artifacts=[ArtifactInput(path=dump, kind=ArtifactKind.FILE)],
        )
    )

    crash = _decision(prepared, InvestigationBranch.CRASH_PREFLIGHT)

    assert crash.disposition is BranchDisposition.RUN
    assert crash.relevance is AnalysisRelevance.REQUIRED


def test_plan_detects_a_dump_alias_when_the_canonical_path_is_text(tmp_path: Path) -> None:
    canonical = tmp_path / "aaa.txt"
    dump_alias = tmp_path / "zzz.dmp"
    canonical.write_bytes(b"dump")
    try:
        os.link(canonical, dump_alias)
    except OSError as error:
        pytest.skip(f"Hard links are unavailable on this filesystem: {error}")
    prepared = prepare_analysis(
        AnalysisRequest(
            question="Inspect the crash.",
            artifacts=[
                ArtifactInput(path=canonical, kind=ArtifactKind.FILE),
                ArtifactInput(path=dump_alias, kind=ArtifactKind.FILE),
            ],
        )
    )

    crash = _decision(prepared, InvestigationBranch.CRASH_PREFLIGHT)

    assert crash.disposition is BranchDisposition.RUN
    assert crash.relevance is AnalysisRelevance.REQUIRED


def test_plan_does_not_treat_a_directory_with_dump_suffix_as_a_dump(tmp_path: Path) -> None:
    directory = tmp_path / "logs.dmp"
    directory.mkdir()
    prepared = prepare_analysis(
        AnalysisRequest(
            question="Inspect the directory.",
            artifacts=[ArtifactInput(path=directory, kind=ArtifactKind.DIRECTORY)],
        )
    )

    crash = _decision(prepared, InvestigationBranch.CRASH_PREFLIGHT)

    assert crash.disposition is BranchDisposition.SKIP
    assert crash.relevance is AnalysisRelevance.NOT_RELEVANT


def test_plan_exposes_mse_when_project_revision_is_resolved(tmp_path: Path) -> None:
    assets = tmp_path / "assets"
    assets.mkdir()
    (assets / "interface.json").write_text("{}", encoding="utf-8")
    subprocess.run(["git", "init", str(tmp_path)], check=True, capture_output=True)
    _git(tmp_path, "config", "user.email", "mde@example.invalid")
    _git(tmp_path, "config", "user.name", "MDE Test")
    _git(tmp_path, "add", "assets/interface.json")
    _git(tmp_path, "commit", "-m", "first")
    revision = _git(tmp_path, "rev-parse", "HEAD")
    request = AnalysisRequest(question="Inspect the project configuration.")
    prepared = PreparedAnalysis(
        request=request,
        source_snapshots=[
            SourceSnapshot(
                source_id="project",
                role=SourceRole.PROJECT,
                path=tmp_path,
                revision_backend=SourceRevisionBackend.GIT,
                requested_revision=revision,
                resolved_revision=revision,
                current_revision=revision,
                resolution_status=RevisionResolutionStatus.RESOLVED,
            )
        ],
    )

    mse = _decision(prepared, InvestigationBranch.MSE_PROJECT_PREFLIGHT)
    project_source = _decision(prepared, InvestigationBranch.PROJECT_SOURCE)

    assert mse.disposition is BranchDisposition.RUN
    assert mse.relevance is AnalysisRelevance.USEFUL
    assert project_source.disposition is BranchDisposition.RUN
    assert project_source.relevance is AnalysisRelevance.USEFUL


def test_plan_runs_focused_source_research_for_current_project(tmp_path: Path) -> None:
    (tmp_path / "interface.json").write_text("{}", encoding="utf-8")
    subprocess.run(["git", "init", str(tmp_path)], check=True, capture_output=True)
    _git(tmp_path, "config", "user.email", "mde@example.invalid")
    _git(tmp_path, "config", "user.name", "MDE Test")
    _git(tmp_path, "add", "interface.json")
    _git(tmp_path, "commit", "-m", "project")
    revision = _git(tmp_path, "rev-parse", "HEAD")
    prepared = PreparedAnalysis(
        request=AnalysisRequest(question="Inspect the current project."),
        source_snapshots=[
            SourceSnapshot(
                source_id="project",
                role=SourceRole.PROJECT,
                path=tmp_path,
                revision_backend=SourceRevisionBackend.GIT,
                current_revision=revision,
                resolution_status=RevisionResolutionStatus.NOT_REQUESTED,
            )
        ],
    )

    project_source = _decision(prepared, InvestigationBranch.PROJECT_SOURCE)

    assert project_source.disposition is BranchDisposition.RUN


def test_plan_defers_general_source_search_without_supported_focus(
    tmp_path: Path,
) -> None:
    (tmp_path / "README.md").write_text("project", encoding="utf-8")
    subprocess.run(["git", "init", str(tmp_path)], check=True, capture_output=True)
    _git(tmp_path, "config", "user.email", "mde@example.invalid")
    _git(tmp_path, "config", "user.name", "MDE Test")
    _git(tmp_path, "add", "README.md")
    _git(tmp_path, "commit", "-m", "project")
    revision = _git(tmp_path, "rev-parse", "HEAD")
    prepared = PreparedAnalysis(
        request=AnalysisRequest(question="Inspect the project."),
        source_snapshots=[
            SourceSnapshot(
                source_id="project",
                role=SourceRole.PROJECT,
                path=tmp_path,
                revision_backend=SourceRevisionBackend.GIT,
                current_revision=revision,
                resolution_status=RevisionResolutionStatus.NOT_REQUESTED,
            )
        ],
    )

    project_source = _decision(prepared, InvestigationBranch.PROJECT_SOURCE)

    assert project_source.disposition is BranchDisposition.DEFERRED
    assert "general source search remains deferred" in project_source.reason


def test_plan_runs_version_matched_framework_implementation_search(tmp_path: Path) -> None:
    (tmp_path / "src").mkdir()
    (tmp_path / "src" / "Tasker.cpp").write_text("void run_task();", encoding="utf-8")
    subprocess.run(["git", "init", str(tmp_path)], check=True, capture_output=True)
    _git(tmp_path, "config", "user.email", "mde@example.invalid")
    _git(tmp_path, "config", "user.name", "MDE Test")
    _git(tmp_path, "add", ".")
    _git(tmp_path, "commit", "-m", "framework")
    revision = _git(tmp_path, "rev-parse", "HEAD")
    prepared = PreparedAnalysis(
        request=AnalysisRequest(question="Inspect framework behavior."),
        source_snapshots=[
            SourceSnapshot(
                source_id="framework",
                role=SourceRole.MAA_FRAMEWORK,
                path=tmp_path,
                revision_backend=SourceRevisionBackend.GIT,
                current_revision=revision,
                resolution_status=RevisionResolutionStatus.NOT_REQUESTED,
            )
        ],
    )

    decision = _decision(prepared, InvestigationBranch.FRAMEWORK_SOURCE)

    assert decision.disposition is BranchDisposition.RUN
    assert decision.relevance is AnalysisRelevance.USEFUL
    assert "implementation source" in decision.reason


def test_plan_runs_version_matched_gui_implementation_search(tmp_path: Path) -> None:
    (tmp_path / "src").mkdir()
    (tmp_path / "src" / "MainWindow.ts").write_text("export class MainWindow {}", encoding="utf-8")
    subprocess.run(["git", "init", str(tmp_path)], check=True, capture_output=True)
    _git(tmp_path, "config", "user.email", "mde@example.invalid")
    _git(tmp_path, "config", "user.name", "MDE Test")
    _git(tmp_path, "add", ".")
    _git(tmp_path, "commit", "-m", "gui")
    revision = _git(tmp_path, "rev-parse", "HEAD")
    prepared = PreparedAnalysis(
        request=AnalysisRequest(question="Inspect GUI behavior."),
        source_snapshots=[
            SourceSnapshot(
                source_id="gui",
                role=SourceRole.GUI,
                path=tmp_path,
                revision_backend=SourceRevisionBackend.GIT,
                current_revision=revision,
                resolution_status=RevisionResolutionStatus.NOT_REQUESTED,
            )
        ],
    )

    decision = _decision(prepared, InvestigationBranch.GUI_SOURCE)

    assert decision.disposition is BranchDisposition.RUN
    assert decision.relevance is AnalysisRelevance.USEFUL
    assert "GUI implementation source" in decision.reason


def test_plan_defers_focused_source_research_for_maa_syntax(tmp_path: Path) -> None:
    (tmp_path / "interface.json").write_text("{}", encoding="utf-8")
    (tmp_path / "src" / "MaaCore").mkdir(parents=True)
    (tmp_path / "src" / "MaaCore" / "CMakeLists.txt").write_text(
        "# MaaCore",
        encoding="utf-8",
    )
    subprocess.run(["git", "init", str(tmp_path)], check=True, capture_output=True)
    _git(tmp_path, "config", "user.email", "mde@example.invalid")
    _git(tmp_path, "config", "user.name", "MDE Test")
    _git(tmp_path, "add", ".")
    _git(tmp_path, "commit", "-m", "maa-project")
    revision = _git(tmp_path, "rev-parse", "HEAD")
    prepared = PreparedAnalysis(
        request=AnalysisRequest(question="Inspect the current project."),
        source_snapshots=[
            SourceSnapshot(
                source_id="project",
                role=SourceRole.PROJECT,
                path=tmp_path,
                revision_backend=SourceRevisionBackend.GIT,
                current_revision=revision,
                resolution_status=RevisionResolutionStatus.NOT_REQUESTED,
            )
        ],
    )

    mse = _decision(prepared, InvestigationBranch.MSE_PROJECT_PREFLIGHT)
    project_source = _decision(prepared, InvestigationBranch.PROJECT_SOURCE)

    assert mse.disposition is BranchDisposition.RUN
    assert project_source.disposition is BranchDisposition.DEFERRED


def test_plan_skips_mse_when_resolved_revision_is_not_checked_out(tmp_path: Path) -> None:
    (tmp_path / "interface.json").write_text("{}", encoding="utf-8")
    subprocess.run(["git", "init", str(tmp_path)], check=True, capture_output=True)
    _git(tmp_path, "config", "user.email", "mde@example.invalid")
    _git(tmp_path, "config", "user.name", "MDE Test")
    _git(tmp_path, "add", "interface.json")
    _git(tmp_path, "commit", "-m", "old")
    old_revision = _git(tmp_path, "rev-parse", "HEAD")
    (tmp_path / "README.md").write_text("new checkout", encoding="utf-8")
    _git(tmp_path, "add", "README.md")
    _git(tmp_path, "commit", "-m", "new")
    current_revision = _git(tmp_path, "rev-parse", "HEAD")
    prepared = PreparedAnalysis(
        request=AnalysisRequest(issue="Project task fails."),
        source_snapshots=[
            SourceSnapshot(
                source_id="project",
                role=SourceRole.PROJECT,
                path=tmp_path,
                revision_backend=SourceRevisionBackend.GIT,
                requested_revision=old_revision,
                resolved_revision=old_revision,
                current_revision=current_revision,
                resolution_status=RevisionResolutionStatus.RESOLVED,
            )
        ],
    )

    mse = _decision(prepared, InvestigationBranch.MSE_PROJECT_PREFLIGHT)
    project_source = _decision(prepared, InvestigationBranch.PROJECT_SOURCE)

    assert mse.disposition is BranchDisposition.SKIP
    assert project_source.disposition is BranchDisposition.DEFERRED


def test_plan_runs_knowledge_research_for_explicit_documentation(tmp_path: Path) -> None:
    (tmp_path / "README.md").write_text("OCR documentation", encoding="utf-8")
    subprocess.run(["git", "init", str(tmp_path)], check=True, capture_output=True)
    _git(tmp_path, "config", "user.email", "mde@example.invalid")
    _git(tmp_path, "config", "user.name", "MDE Test")
    _git(tmp_path, "add", "README.md")
    _git(tmp_path, "commit", "-m", "documentation")
    revision = _git(tmp_path, "rev-parse", "HEAD")
    prepared = PreparedAnalysis(
        request=AnalysisRequest(question="How does OCR replace work?"),
        source_snapshots=[
            SourceSnapshot(
                source_id="maafw-docs",
                role=SourceRole.DOCUMENTATION,
                path=tmp_path,
                revision_backend=SourceRevisionBackend.GIT,
                current_revision=revision,
                resolution_status=RevisionResolutionStatus.NOT_REQUESTED,
            )
        ],
    )

    knowledge = _decision(prepared, InvestigationBranch.KNOWLEDGE_RESEARCH)

    assert knowledge.disposition is BranchDisposition.RUN
    assert knowledge.relevance is AnalysisRelevance.USEFUL


def test_incident_selection_requires_known_unique_candidate() -> None:
    candidate = IncidentCandidate(
        candidate_id="incident-1",
        confidence=0.8,
        evidence_ids=["evidence-1"],
        reasons=["A source-backed failure was observed."],
    )
    selected = IncidentSelection(
        status=IncidentSelectionStatus.SELECTED,
        candidates=[candidate],
        selected_candidate_id="incident-1",
    )

    assert selected.selected_candidate_id == "incident-1"

    with pytest.raises(ValidationError, match="known candidate"):
        IncidentSelection(
            status=IncidentSelectionStatus.SELECTED,
            candidates=[candidate],
            selected_candidate_id="unknown",
        )


def test_standalone_workflow_contracts_are_versioned() -> None:
    fix = FixCandidate(
        fix_id="fix-1",
        target="pipeline.json:RecognizeStage",
        scope=FixScope.NODE,
        method=FixMethod.EXPECTED_REPLACE,
        rationale="Normalize one observed OCR variant.",
        evidence_ids=["evidence-1"],
        verification_steps=["Replay the captured screenshot."],
    )
    guidance = SourceGuidance(
        source_id="project",
        source_role=SourceRole.PROJECT,
        revision="abc123",
        target_path="assets/resource/pipeline.json",
    )

    assert fix.api_version == "fix-candidate/v1"
    assert guidance.api_version == "source-guidance/v1"


def test_fix_candidate_plan_requires_bounded_unique_candidates() -> None:
    candidate = FixCandidate(
        fix_id="fix-1",
        target="pipeline.json:RecognizeStage.expected",
        scope=FixScope.NODE,
        method=FixMethod.EXPECTED_REPLACE,
        rationale="Normalize one observed OCR variant.",
        evidence_ids=["evidence-1"],
        verification_steps=["Replay the captured screenshot."],
    )
    plan = FixCandidatePlan(
        status=FixPlanningStatus.PROPOSED,
        candidates=[candidate],
        rationale="A focused configuration repair is supported.",
    )

    assert plan.api_version == "fix-candidate-plan/v1"

    flattened = FixCandidatePlan.model_validate(
        {
            "api_version": "fix-candidate/v1",
            "candidates": "",
            "fix_id": "fix-flat",
            "target": "src/components/Toolbar.tsx",
            "scope": "gui",
            "method": "gui_code",
            "rationale": "The provider flattened one candidate into the plan call.",
            "evidence_id": "evidence-1",
            "regression_risks": json.dumps(["Desktop capture must remain guarded."]),
            "verification_steps": json.dumps(["Test desktop and ADB controllers."]),
        }
    )
    assert flattened.status is FixPlanningStatus.PROPOSED
    [flattened_candidate] = flattened.candidates
    assert flattened_candidate.fix_id == "fix-flat"
    assert flattened_candidate.evidence_ids == ["evidence-1"]
    assert flattened_candidate.regression_risks == ["Desktop capture must remain guarded."]

    flattened_with_status = FixCandidatePlan.model_validate(
        {
            **flattened.model_dump(mode="json", exclude={"candidates"}),
            "candidates": "",
            "fix_id": "fix-flat-with-status",
            "target": "src/components/Toolbar.tsx",
            "scope": "gui",
            "method": "gui_code",
            "evidence_id": "evidence-1",
            "verification_steps": ["Test desktop and ADB controllers."],
        }
    )
    assert flattened_with_status.status is FixPlanningStatus.PROPOSED
    assert flattened_with_status.candidates[0].fix_id == "fix-flat-with-status"

    with pytest.raises(ValidationError):
        FixCandidatePlan.model_validate(
            {
                **flattened.model_dump(mode="json"),
                "unexpected_provider_field": "must remain forbidden",
            }
        )

    with pytest.raises(ValidationError, match="IDs must be unique"):
        FixCandidatePlan(
            status=FixPlanningStatus.PROPOSED,
            candidates=[candidate, candidate],
            rationale="Duplicate candidates.",
        )
    with pytest.raises(ValidationError, match="cannot contain candidates"):
        FixCandidatePlan(
            status=FixPlanningStatus.SKIP,
            candidates=[candidate],
            rationale="Invalid skipped plan.",
        )

    with pytest.raises(ValidationError, match="requires scope 'gui'"):
        FixCandidate.model_validate(
            {
                **candidate.model_dump(mode="json"),
                "scope": FixScope.FRAMEWORK,
                "method": FixMethod.GUI_CODE,
            }
        )

    with pytest.raises(ValidationError, match="not a source code path"):
        FixCandidate(
            fix_id="invalid-config-code-target",
            target="src/components/Toolbar.tsx",
            scope=FixScope.GUI,
            method=FixMethod.CONFIGURATION,
            rationale="A source file is not a configuration-only target.",
            evidence_ids=["evidence-1"],
            verification_steps=["Test the target."],
        )
    with pytest.raises(ValidationError, match="callable symbol"):
        FixCandidate(
            fix_id="invalid-config-callable-target",
            target="Toolbar.startInstance() / scheduleService trigger path",
            scope=FixScope.NODE,
            method=FixMethod.CONFIGURATION,
            rationale="Changing a source symbol is not a configuration-only repair.",
            evidence_ids=["evidence-1"],
            verification_steps=["Test the target."],
        )
    with pytest.raises(ValidationError, match="Source code targets require"):
        FixCandidate(
            fix_id="invalid-pipeline-code-target",
            target="src/components/Toolbar.tsx / isWorkstationLocked check",
            scope=FixScope.NODE,
            method=FixMethod.EXPECTED_REPLACE,
            rationale="A pipeline replacement method cannot edit GUI source code.",
            evidence_ids=["evidence-1"],
            verification_steps=["Test the target."],
        )

    with pytest.raises(ValidationError, match="cannot use scope 'framework'"):
        FixCandidate(
            fix_id="invalid-pipeline-scope",
            target="src-tauri/src/commands/system.rs",
            scope=FixScope.FRAMEWORK,
            method=FixMethod.EXPECTED_REPLACE,
            rationale="Pipeline replacement is not a framework source edit.",
            evidence_ids=["evidence-1"],
            verification_steps=["Test the target."],
        )


def test_verification_plan_set_requires_unique_fix_plans() -> None:
    verification = VerificationPlan(
        fix_id="fix-1",
        methods=[VerificationMethod.STATIC_CONFIGURATION],
        steps=["Validate the updated pipeline configuration."],
        business_milestones=["The target task reaches the expected next node."],
        regression_checks=["The adjacent recognition variant still works."],
    )
    plans = VerificationPlanSet(
        status=VerificationPlanningStatus.PLANNED,
        plans=[verification],
        rationale="The candidate has static and business-level checks.",
    )

    assert verification.api_version == "verification-plan/v2"
    assert plans.api_version == "verification-plan-set/v1"

    flattened = VerificationPlanSet.model_validate(
        {
            "api_version": "verification-plan/v2",
            "plans": "",
            "fix_id": "fix-1",
            "methods": json.dumps(["runtime_execution"]),
            "steps": json.dumps(["Run the scheduled task while Windows is locked."]),
            "business_milestones": json.dumps(["The ADB task starts on schedule."]),
            "regression_checks": json.dumps(
                ["The desktop controller remains blocked while locked."]
            ),
            "rationale": "The provider flattened one verification plan into the set call.",
        }
    )
    assert flattened.status is VerificationPlanningStatus.PLANNED
    [flattened_plan] = flattened.plans
    assert flattened_plan.fix_id == "fix-1"
    assert flattened_plan.methods == [VerificationMethod.RUNTIME_EXECUTION]
    assert flattened_plan.regression_checks == [
        "The desktop controller remains blocked while locked."
    ]

    with pytest.raises(ValidationError, match="fix IDs must be unique"):
        VerificationPlanSet(
            status=VerificationPlanningStatus.PLANNED,
            plans=[verification, verification],
            rationale="Duplicate plans.",
        )
    with pytest.raises(ValidationError, match="cannot contain plans"):
        VerificationPlanSet(
            status=VerificationPlanningStatus.SKIP,
            plans=[verification],
            rationale="Invalid skipped set.",
        )
    with pytest.raises(ValidationError, match="must not be blank"):
        VerificationPlan(
            fix_id="fix-1",
            methods=[VerificationMethod.MANUAL_OBSERVATION],
            steps=[" "],
            business_milestones=["The user-visible task succeeds."],
        )


def test_evidence_research_plan_requires_bounded_unique_queries(tmp_path: Path) -> None:
    query = EvidenceQuery(
        source_path=tmp_path / "debug.log",
        line_start=10,
        line_end=20,
        reason="Inspect the failure boundary.",
    )
    plan = EvidenceResearchPlan(
        status=SourceResearchStatus.RUN,
        queries=[query],
        rationale="A focused raw window can distinguish the failure mechanism.",
    )

    assert plan.api_version == "evidence-research-plan/v1"

    provider_typo = EvidenceResearchPlan.model_validate(
        {
            "status": "skip",
            "queries": [],
            "rational": "The provider used a known rationale field spelling variant.",
        }
    )
    assert provider_typo.rationale.startswith("The provider")
    assert provider_typo.model_dump()["rationale"] == provider_typo.rationale
    assert "rational" not in provider_typo.model_dump()

    encoded_queries = EvidenceResearchPlan.model_validate(
        {
            "status": "run",
            "queries": json.dumps([query.model_dump(mode="json")]),
            "rationale": "The provider JSON-encoded the array argument once.",
        }
    )
    assert encoded_queries.queries == [query]

    with pytest.raises(ValidationError, match="valid list"):
        EvidenceResearchPlan.model_validate(
            {
                "status": "run",
                "queries": json.dumps({"query": query.model_dump(mode="json")}),
                "rationale": "An object must not be accepted as an array.",
            }
        )

    with pytest.raises(ValidationError, match="must be unique"):
        EvidenceResearchPlan(
            status=SourceResearchStatus.RUN,
            queries=[query, query],
            rationale="Duplicate query.",
        )
    with pytest.raises(ValidationError, match="cannot contain queries"):
        EvidenceResearchPlan(
            status=SourceResearchStatus.SKIP,
            queries=[query],
            rationale="Invalid skipped plan.",
        )


@pytest.mark.parametrize("plan_type", [SourceResearchPlan, KnowledgeResearchPlan])
def test_source_plan_accepts_json_encoded_query_array(
    plan_type: type[SourceResearchPlan] | type[KnowledgeResearchPlan],
) -> None:
    query = SourceSearchQuery(
        query_id="retry-warning",
        source_id="gui",
        terms=["retry budget exhausted"],
        reason="Locate the observed worker warning.",
    )

    plan = plan_type.model_validate(
        {
            "status": "run",
            "queries": json.dumps([query.model_dump(mode="json")]),
            "rationale": "The provider JSON-encoded the array argument once.",
        }
    )

    assert plan.queries == [query]
