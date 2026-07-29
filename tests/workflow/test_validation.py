from __future__ import annotations

from pathlib import Path

import pytest
from pydantic import ValidationError

from maa_diagnostic_expert.contracts.domain import (
    AnalysisRequest,
    Conclusion,
    DiagnosisDraft,
    DiagnosisResult,
    DiagnosisStatus,
    Evidence,
    EvidenceRole,
    MissingEvidence,
    PreparedAnalysis,
    SourceRole,
)
from maa_diagnostic_expert.contracts.workflow import (
    ArtifactSourceKind,
    FixCandidate,
    FixCandidatePlan,
    FixMethod,
    FixPlanningStatus,
    FixScope,
    IncidentCandidate,
    IncidentComparison,
    IncidentComparisonStatus,
    IncidentCorrelationDraft,
    IncidentSelection,
    IncidentSelectionStatus,
    VerificationMethod,
    VerificationPlan,
    VerificationPlanningStatus,
    VerificationPlanSet,
)
from maa_diagnostic_expert.inspection.log_overview import (
    LogArtifactOverview,
    LogOverviewCollection,
    LogOverviewStatus,
)
from maa_diagnostic_expert.inspection.models import DeterministicInspection
from maa_diagnostic_expert.workflow.validation import (
    collect_deterministic_missing_evidence,
    finalize_diagnosis_draft,
    validate_fix_candidate_plan,
    validate_incident_correlation,
    validate_result_against_inspection,
    validate_verification_plan_set,
)


def _evidence(content: str = "observed failure") -> Evidence:
    return Evidence(
        id="ev:known",
        kind="runtime_failure",
        source_component="mla:runtime-inspection",
        source_path="C:/logs/maafw.log",
        content=content,
        line_start=10,
        line_end=10,
        role=EvidenceRole.FAILURE,
    )


def _inspection(*, missing: bool = False) -> DeterministicInspection:
    prepared = PreparedAnalysis(
        request=AnalysisRequest(question="Diagnose the failure."),
        missing_evidence=(
            [MissingEvidence(code="required_log", message="Required log is missing.")]
            if missing
            else []
        ),
    )
    return DeterministicInspection(
        prepared=prepared,
        synthesized_evidence=[_evidence()],
    )


def _fix_plan(evidence_id: str = "ev:known") -> FixCandidatePlan:
    return FixCandidatePlan(
        status=FixPlanningStatus.PROPOSED,
        rationale="The observed failure has a focused configuration target.",
        candidates=[
            FixCandidate(
                fix_id="fix-1",
                target="pipeline.json:LoginButton.expected",
                scope=FixScope.NODE,
                method=FixMethod.EXPECTED_REPLACE,
                rationale="Normalize the observed OCR variant.",
                evidence_ids=[evidence_id],
                regression_risks=["A broad replacement could accept unrelated text."],
                verification_steps=["Replay the failure screenshot."],
            )
        ],
    )


def _verification_plan(*, regression_checks: list[str] | None = None) -> VerificationPlanSet:
    return VerificationPlanSet(
        status=VerificationPlanningStatus.PLANNED,
        rationale="Verify the target milestone and regression risk.",
        plans=[
            VerificationPlan(
                fix_id="fix-1",
                methods=[VerificationMethod.RUNTIME_EXECUTION],
                steps=["Replay the affected task."],
                business_milestones=["The affected task reaches its expected completion state."],
                regression_checks=(
                    ["The adjacent OCR variant remains accepted."]
                    if regression_checks is None
                    else regression_checks
                ),
            )
        ],
    )


def _draft(evidence_id: str = "ev:known") -> DiagnosisDraft:
    return DiagnosisDraft(
        status=DiagnosisStatus.COMPLETE,
        summary="The task failed.",
        conclusions=[
            Conclusion(
                statement="A runtime failure was observed.",
                evidence_ids=[evidence_id],
                confidence=1,
            )
        ],
    )


def _incident_selection() -> IncidentSelection:
    return IncidentSelection(
        status=IncidentSelectionStatus.AMBIGUOUS,
        candidates=[
            IncidentCandidate(
                candidate_id="incident-1",
                confidence=0.9,
                evidence_ids=["ev:known"],
                reasons=["A direct failure was observed."],
            )
        ],
    )


def test_fix_candidate_plan_accepts_diagnosis_backed_evidence() -> None:
    plan = _fix_plan()

    assert validate_fix_candidate_plan(plan, _draft(), [_evidence()]) is plan


def test_fix_candidate_plan_rejects_unknown_evidence() -> None:
    with pytest.raises(ValueError, match="unknown evidence IDs"):
        validate_fix_candidate_plan(_fix_plan("ev:invented"), _draft(), [_evidence()])


def test_fix_candidate_plan_requires_diagnosis_conclusion_evidence() -> None:
    supporting = _evidence().model_copy(update={"id": "ev:supporting"})

    with pytest.raises(ValueError, match="must cite diagnosis conclusion evidence"):
        validate_fix_candidate_plan(
            _fix_plan("ev:supporting"),
            _draft(),
            [_evidence(), supporting],
        )


def test_fix_candidate_plan_rejects_navigation_only_evidence() -> None:
    wiki = _evidence().model_copy(
        update={
            "id": "ev:wiki",
            "kind": "wiki_navigation_match",
            "role": EvidenceRole.CONTEXT,
        }
    )

    with pytest.raises(ValueError, match="navigation-only evidence IDs"):
        validate_fix_candidate_plan(_fix_plan("ev:wiki"), _draft("ev:wiki"), [wiki])


def test_fix_candidate_plan_requires_complete_diagnosis() -> None:
    diagnosis = DiagnosisDraft(
        status=DiagnosisStatus.INSUFFICIENT_EVIDENCE,
        summary="No direct failure was observed.",
    )

    with pytest.raises(ValueError, match="complete evidence-backed diagnosis"):
        validate_fix_candidate_plan(_fix_plan(), diagnosis, [_evidence()])


def test_code_fix_candidate_requires_versioned_source_from_its_component() -> None:
    source = Evidence(
        id="ev:mxu-source",
        kind="source_search_match",
        source_component="source:mxu",
        source_path="git:mxu@abc:src/components/Toolbar.tsx",
        content="if (await maaService.isWorkstationLocked()) { return false; }",
        role=EvidenceRole.CONTEXT,
    )
    draft = DiagnosisDraft(
        status=DiagnosisStatus.COMPLETE,
        summary="The GUI lock guard blocks task startup.",
        conclusions=[
            Conclusion(
                statement="The GUI applies the lock guard before controller selection.",
                evidence_ids=[source.id],
                confidence=0.9,
            )
        ],
    )

    def code_plan(method: FixMethod) -> FixCandidatePlan:
        return FixCandidatePlan(
            status=FixPlanningStatus.PROPOSED,
            rationale="The versioned source identifies the code target.",
            candidates=[
                FixCandidate(
                    fix_id="fix-lock-guard",
                    target="src/components/Toolbar.tsx:isWorkstationLocked",
                    scope=(FixScope.GUI if method is FixMethod.GUI_CODE else FixScope.FRAMEWORK),
                    method=method,
                    rationale="Scope the guard to desktop controllers.",
                    evidence_ids=[source.id],
                    verification_steps=["Test ADB and desktop controllers while locked."],
                )
            ],
        )

    assert (
        validate_fix_candidate_plan(
            code_plan(FixMethod.GUI_CODE),
            draft,
            [source],
            {"mxu": SourceRole.GUI},
        ).status
        is FixPlanningStatus.PROPOSED
    )
    with pytest.raises(ValueError, match="role 'maa_framework'"):
        validate_fix_candidate_plan(
            code_plan(FixMethod.FRAMEWORK_CODE),
            draft,
            [source],
            {"mxu": SourceRole.GUI},
        )

    without_source = source.model_copy(update={"kind": "text_line_window"})
    with pytest.raises(ValueError, match="version-matched source evidence"):
        validate_fix_candidate_plan(
            code_plan(FixMethod.GUI_CODE),
            draft,
            [without_source],
            {"mxu": SourceRole.GUI},
        )


def test_verification_plan_set_covers_every_fix_and_regression_risk() -> None:
    verification = _verification_plan()

    assert validate_verification_plan_set(verification, _fix_plan()) is verification


def test_verification_plan_set_rejects_missing_fix_plan() -> None:
    verification = _verification_plan().model_copy(update={"plans": []})

    with pytest.raises(ValueError, match="missing verification plans"):
        validate_verification_plan_set(verification, _fix_plan())


def test_verification_plan_set_rejects_unknown_fix_id() -> None:
    [plan] = _verification_plan().plans
    verification = _verification_plan().model_copy(
        update={"plans": [plan.model_copy(update={"fix_id": "fix-invented"})]}
    )

    with pytest.raises(ValueError, match="unknown fix IDs"):
        validate_verification_plan_set(verification, _fix_plan())


def test_verification_plan_set_requires_regression_coverage() -> None:
    with pytest.raises(ValueError, match="must cover recorded regression risks"):
        validate_verification_plan_set(
            _verification_plan(regression_checks=[]),
            _fix_plan(),
        )


def test_verification_plan_set_skips_when_fix_planning_skips() -> None:
    fixes = FixCandidatePlan(
        status=FixPlanningStatus.SKIP,
        rationale="No fix candidate exists.",
    )
    verification = VerificationPlanSet(
        status=VerificationPlanningStatus.SKIP,
        rationale="No fix candidate exists.",
    )

    assert validate_verification_plan_set(verification, fixes) is verification


def test_finalize_draft_attaches_only_authoritative_evidence() -> None:
    result = finalize_diagnosis_draft(_draft(), _inspection())

    assert result.evidence == [_evidence()]


def test_finalize_draft_rejects_model_invented_evidence_id() -> None:
    with pytest.raises(ValueError, match="unknown evidence IDs"):
        finalize_diagnosis_draft(_draft("ev:invented"), _inspection())


def test_finalize_draft_rejects_wiki_navigation_citation() -> None:
    wiki = Evidence(
        id="ev:wiki",
        kind="wiki_navigation_match",
        source_component="source:wiki",
        source_path="git:wiki@abc:topics/ocr.md",
        content="See the original MaaFramework OCR documentation.",
        role=EvidenceRole.CONTEXT,
    )
    inspection = _inspection().model_copy(update={"synthesized_evidence": [_evidence(), wiki]})

    with pytest.raises(ValueError, match="navigation-only evidence IDs"):
        finalize_diagnosis_draft(_draft("ev:wiki"), inspection)


def test_validation_rejects_altered_authoritative_evidence() -> None:
    result = DiagnosisResult(
        status=DiagnosisStatus.COMPLETE,
        summary="The task failed.",
        evidence=[_evidence("model-altered content")],
        conclusions=_draft().conclusions,
    )

    with pytest.raises(ValueError, match="altered authoritative evidence"):
        validate_result_against_inspection(result, _inspection())


def test_validation_rejects_host_invented_evidence() -> None:
    invented = _evidence("invented content").model_copy(update={"id": "ev:invented"})
    result = DiagnosisResult(
        status=DiagnosisStatus.COMPLETE,
        summary="Invented diagnosis.",
        evidence=[invented],
        conclusions=[
            Conclusion(
                statement="Invented conclusion.",
                evidence_ids=[invented.id],
                confidence=1,
            )
        ],
    )

    with pytest.raises(ValueError, match="unknown evidence ID"):
        validate_result_against_inspection(result, _inspection())


def test_validation_accepts_explicit_additional_evidence() -> None:
    additional = Evidence(
        id="ev:window",
        kind="text_line_window",
        source_component="diagnostic-artifact",
        source_path="C:/logs/maafw.log",
        content="raw line",
        line_start=20,
        line_end=20,
        role=EvidenceRole.CONTEXT,
    )
    result = DiagnosisResult(
        status=DiagnosisStatus.COMPLETE,
        summary="Raw context confirms the failure.",
        evidence=[additional],
        conclusions=[
            Conclusion(statement="Raw failure line.", evidence_ids=[additional.id], confidence=1)
        ],
    )

    assert validate_result_against_inspection(result, _inspection(), [additional]) is result


def test_validation_requires_deterministic_missing_evidence_codes() -> None:
    result = finalize_diagnosis_draft(_draft(), _inspection(missing=True)).model_copy(
        update={"missing_evidence": []}
    )

    with pytest.raises(ValueError, match="omits required missing evidence"):
        validate_result_against_inspection(result, _inspection(missing=True))


def test_finalize_draft_preserves_selection_and_comparison_missing_codes() -> None:
    inspection = _inspection().model_copy(
        update={
            "incident_selection": IncidentSelection(
                status=IncidentSelectionStatus.NOT_FOUND,
                missing_evidence=[
                    MissingEvidence(
                        code="incident_candidates_not_found",
                        message="No runtime incident candidate was found.",
                    )
                ],
            ),
            "incident_comparison": IncidentComparison(
                status=IncidentComparisonStatus.UNAVAILABLE,
                missing_evidence=[
                    MissingEvidence(
                        code="incident_comparison_candidate_unavailable",
                        message="No candidate was available for comparison.",
                    )
                ],
            ),
        }
    )
    draft = _draft().model_copy(
        update={"missing_evidence": ["incident_candidates_not_found", "model_requested_dump"]}
    )

    result = finalize_diagnosis_draft(draft, inspection)

    assert result.missing_evidence == [
        "incident_candidates_not_found",
        "incident_comparison_candidate_unavailable",
        "model_requested_dump",
    ]


def test_validation_requires_selection_and_comparison_missing_codes() -> None:
    inspection = _inspection().model_copy(
        update={
            "incident_selection": IncidentSelection(
                status=IncidentSelectionStatus.NOT_FOUND,
                missing_evidence=[
                    MissingEvidence(
                        code="incident_candidates_not_found",
                        message="No runtime incident candidate was found.",
                    )
                ],
            ),
            "incident_comparison": IncidentComparison(
                status=IncidentComparisonStatus.UNAVAILABLE,
                missing_evidence=[
                    MissingEvidence(
                        code="incident_comparison_candidate_unavailable",
                        message="No candidate was available for comparison.",
                    )
                ],
            ),
        }
    )
    result = finalize_diagnosis_draft(_draft(), inspection).model_copy(
        update={"missing_evidence": ["incident_candidates_not_found"]}
    )

    with pytest.raises(ValueError, match="incident_comparison_candidate_unavailable"):
        validate_result_against_inspection(result, inspection)


def test_validation_allows_optional_deterministic_missing_code_to_be_omitted() -> None:
    inspection = _inspection().model_copy(
        update={
            "incident_selection": IncidentSelection(
                status=IncidentSelectionStatus.AMBIGUOUS,
                candidates=_incident_selection().candidates,
                missing_evidence=[
                    MissingEvidence(
                        code="incident_candidates_truncated",
                        message="Lower-priority candidates were omitted.",
                        required=False,
                    )
                ],
            )
        }
    )
    result = finalize_diagnosis_draft(_draft(), inspection).model_copy(
        update={"missing_evidence": []}
    )

    assert validate_result_against_inspection(result, inspection) is result


def test_default_unexecuted_incident_ledgers_do_not_emit_missing_codes() -> None:
    assert collect_deterministic_missing_evidence(_inspection()) == []


def test_collect_deterministic_missing_evidence_includes_log_overview_fallback() -> None:
    missing = collect_deterministic_missing_evidence(
        prepared=PreparedAnalysis(request=AnalysisRequest(question="Diagnose")),
        log_overviews=LogOverviewCollection(
            overviews=[
                LogArtifactOverview(
                    artifact_id="custom-log",
                    path=Path("C:/logs/agent.log"),
                    source_kind=ArtifactSourceKind.CUSTOM,
                    status=LogOverviewStatus.TRUNCATED,
                    scanned_bytes=64,
                    scanned_lines=1,
                ),
                LogArtifactOverview(
                    artifact_id="gui-log",
                    path=Path("C:/logs/gui.log"),
                    source_kind=ArtifactSourceKind.GUI,
                    status=LogOverviewStatus.UNREADABLE,
                    scanned_bytes=0,
                    scanned_lines=0,
                    error_message="PermissionError: denied",
                ),
            ]
        ),
    )

    assert [item.code for item in missing] == [
        "log_overview_truncated",
        "log_overview_unreadable",
    ]
    assert missing[0].required is False
    assert missing[1].required is True


def test_collect_deterministic_missing_evidence_preserves_structured_entries() -> None:
    inspection = _inspection(missing=True).model_copy(
        update={
            "incident_selection": IncidentSelection(
                status=IncidentSelectionStatus.NOT_FOUND,
                missing_evidence=[
                    MissingEvidence(
                        code="required_log",
                        message="Duplicate code from incident selection.",
                        required=False,
                    )
                ],
            )
        }
    )

    missing = collect_deterministic_missing_evidence(inspection)

    assert [item.code for item in missing] == ["required_log", "required_log"]
    assert missing[0].required is True
    assert missing[1].required is False


def test_incident_correlation_accepts_known_candidate_and_evidence() -> None:
    draft = IncidentCorrelationDraft(
        status=IncidentSelectionStatus.SELECTED,
        selected_candidate_id="incident-1",
        relevant_candidate_ids=["incident-1"],
        evidence_ids=["ev:known"],
        rationale="The task and failure match the report.",
    )

    assert validate_incident_correlation(draft, _incident_selection()) is draft


def test_selected_incident_correlation_requires_evidence() -> None:
    with pytest.raises(ValidationError, match="requires evidence"):
        IncidentCorrelationDraft(
            status=IncidentSelectionStatus.SELECTED,
            selected_candidate_id="incident-1",
            relevant_candidate_ids=["incident-1"],
            rationale="The candidate appears to match, but no evidence was cited.",
        )


def test_ambiguous_incident_correlation_requires_relevant_candidates() -> None:
    with pytest.raises(ValidationError, match="requires relevant candidates"):
        IncidentCorrelationDraft(
            status=IncidentSelectionStatus.AMBIGUOUS,
            evidence_ids=["ev:known"],
            rationale="The report is ambiguous, but no candidate was retained.",
        )


def test_incident_correlation_rejects_unknown_candidate() -> None:
    draft = IncidentCorrelationDraft(
        status=IncidentSelectionStatus.AMBIGUOUS,
        relevant_candidate_ids=["incident-invented"],
        evidence_ids=["ev:known"],
        rationale="An invented candidate was referenced.",
    )

    with pytest.raises(ValueError, match="unknown candidate IDs"):
        validate_incident_correlation(draft, _incident_selection())


def test_incident_correlation_rejects_unrelated_evidence() -> None:
    draft = IncidentCorrelationDraft(
        status=IncidentSelectionStatus.SELECTED,
        selected_candidate_id="incident-1",
        relevant_candidate_ids=["incident-1"],
        evidence_ids=["ev:invented"],
        rationale="An invented evidence ID was referenced.",
    )

    with pytest.raises(ValueError, match="unrelated evidence IDs"):
        validate_incident_correlation(draft, _incident_selection())
