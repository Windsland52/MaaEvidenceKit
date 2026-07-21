from __future__ import annotations

from pathlib import Path

import pytest
from pydantic import ValidationError

from maa_diagnostic_expert.domain import (
    AnalysisRequest,
    ArtifactInput,
    ArtifactKind,
    PreparedAnalysis,
    RevisionResolutionStatus,
    SourceRole,
    SourceSnapshot,
)
from maa_diagnostic_expert.preparation import prepare_analysis
from maa_diagnostic_expert.workflow_contracts import (
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
from maa_diagnostic_expert.workflow_planning import plan_initial_investigation


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
    request = AnalysisRequest(question="Inspect the project configuration.")
    prepared = PreparedAnalysis(
        request=request,
        source_snapshots=[
            SourceSnapshot(
                source_id="project",
                role=SourceRole.PROJECT,
                path=tmp_path,
                resolved_revision="abc123",
                current_revision="abc123",
                resolution_status=RevisionResolutionStatus.RESOLVED,
            )
        ],
    )

    mse = _decision(prepared, InvestigationBranch.MSE_PROJECT_PREFLIGHT)

    assert mse.disposition is BranchDisposition.DEFERRED
    assert mse.relevance is AnalysisRelevance.USEFUL


def test_incident_selection_requires_known_unique_candidate() -> None:
    candidate = IncidentCandidate(candidate_id="incident-1", confidence=0.8)
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
