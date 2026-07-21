from __future__ import annotations

import pytest
from pydantic import ValidationError

from maa_diagnostic_expert.contracts.domain import (
    AnalysisRequest,
    Conclusion,
    DiagnosisDraft,
    DiagnosisResult,
    DiagnosisStatus,
    Evidence,
    MissingEvidence,
    PreparedAnalysis,
)
from maa_diagnostic_expert.contracts.workflow import (
    IncidentCandidate,
    IncidentCorrelationDraft,
    IncidentSelection,
    IncidentSelectionStatus,
)
from maa_diagnostic_expert.inspection.models import DeterministicInspection
from maa_diagnostic_expert.workflow.validation import (
    finalize_diagnosis_draft,
    validate_incident_correlation,
    validate_result_against_inspection,
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


def test_finalize_draft_attaches_only_authoritative_evidence() -> None:
    result = finalize_diagnosis_draft(_draft(), _inspection())

    assert result.evidence == [_evidence()]


def test_finalize_draft_rejects_model_invented_evidence_id() -> None:
    with pytest.raises(ValueError, match="unknown evidence IDs"):
        finalize_diagnosis_draft(_draft("ev:invented"), _inspection())


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
