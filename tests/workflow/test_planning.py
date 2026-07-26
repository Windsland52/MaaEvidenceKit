from __future__ import annotations

import subprocess
from pathlib import Path

import pytest
from pydantic import ValidationError

from maa_diagnostic_expert.contracts.domain import (
    AnalysisRequest,
    ArtifactInput,
    ArtifactKind,
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
    FixCandidate,
    FixMethod,
    FixScope,
    IncidentCandidate,
    IncidentSelection,
    IncidentSelectionStatus,
    InvestigationBranch,
    SourceGuidance,
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


def test_plan_exposes_unimplemented_dump_branch(tmp_path: Path) -> None:
    dump = tmp_path / "client.dmp"
    dump.write_bytes(b"dump")
    prepared = prepare_analysis(
        AnalysisRequest(
            question="Why did the client crash?",
            artifacts=[ArtifactInput(path=dump, kind=ArtifactKind.FILE)],
        )
    )

    crash = _decision(prepared, InvestigationBranch.CRASH_PREFLIGHT)

    assert crash.disposition is BranchDisposition.DEFERRED
    assert crash.relevance is AnalysisRelevance.REQUIRED


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

    assert mse.disposition is BranchDisposition.RUN
    assert mse.relevance is AnalysisRelevance.USEFUL


def test_plan_skips_mse_when_resolved_revision_is_not_checked_out(tmp_path: Path) -> None:
    (tmp_path / "interface.json").write_text("{}", encoding="utf-8")
    prepared = PreparedAnalysis(
        request=AnalysisRequest(issue="Project task fails."),
        source_snapshots=[
            SourceSnapshot(
                source_id="project",
                role=SourceRole.PROJECT,
                path=tmp_path,
                revision_backend=SourceRevisionBackend.GIT,
                requested_revision="v1",
                resolved_revision="old",
                current_revision="new",
                resolution_status=RevisionResolutionStatus.RESOLVED,
            )
        ],
    )

    mse = _decision(prepared, InvestigationBranch.MSE_PROJECT_PREFLIGHT)

    assert mse.disposition is BranchDisposition.SKIP


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
