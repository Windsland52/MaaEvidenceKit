from __future__ import annotations

from collections.abc import Iterable

from maa_diagnostic_expert.contracts.domain import DiagnosisDraft, DiagnosisResult, Evidence
from maa_diagnostic_expert.contracts.workflow import (
    IncidentCorrelationDraft,
    IncidentSelection,
    IncidentSelectionStatus,
)
from maa_diagnostic_expert.inspection.models import DeterministicInspection

_NON_CITABLE_EVIDENCE_KINDS = {"wiki_navigation_match"}


def _reject_non_citable_evidence(
    referenced_ids: set[str],
    ledger: dict[str, Evidence],
) -> None:
    non_citable = {
        evidence_id
        for evidence_id in referenced_ids
        if evidence_id in ledger and ledger[evidence_id].kind in _NON_CITABLE_EVIDENCE_KINDS
    }
    if non_citable:
        invalid = ", ".join(sorted(non_citable))
        raise ValueError(
            "Diagnosis conclusions cannot cite navigation-only evidence IDs: " + invalid
        )


def validate_incident_correlation(
    draft: IncidentCorrelationDraft,
    selection: IncidentSelection,
) -> IncidentCorrelationDraft:
    """Reject candidate or evidence references not backed by deterministic inspection."""
    candidates = {candidate.candidate_id: candidate for candidate in selection.candidates}
    referenced_candidate_ids = set(draft.relevant_candidate_ids)
    if draft.selected_candidate_id is not None:
        referenced_candidate_ids.add(draft.selected_candidate_id)
    unknown_candidates = referenced_candidate_ids - set(candidates)
    if unknown_candidates:
        unknown = ", ".join(sorted(unknown_candidates))
        raise ValueError(f"Incident correlation references unknown candidate IDs: {unknown}")

    if draft.status is IncidentSelectionStatus.NOT_FOUND:
        allowed_evidence_ids = {
            evidence_id
            for candidate in selection.candidates
            for evidence_id in candidate.evidence_ids
        }
    else:
        allowed_evidence_ids = {
            evidence_id
            for candidate_id in draft.relevant_candidate_ids
            for evidence_id in candidates[candidate_id].evidence_ids
        }
    unknown_evidence = set(draft.evidence_ids) - allowed_evidence_ids
    if unknown_evidence:
        unknown = ", ".join(sorted(unknown_evidence))
        raise ValueError(f"Incident correlation references unrelated evidence IDs: {unknown}")

    if draft.selected_candidate_id is not None:
        selected_evidence = set(candidates[draft.selected_candidate_id].evidence_ids)
        if not selected_evidence.intersection(draft.evidence_ids):
            raise ValueError("Selected incident correlation must cite selected candidate evidence")
    return draft


def collect_inspection_evidence(
    inspection: DeterministicInspection,
    additional: Iterable[Evidence] = (),
) -> list[Evidence]:
    """Build an authoritative evidence ledger and reject conflicting IDs."""
    ledger: dict[str, Evidence] = {}
    ordered: list[Evidence] = []
    candidates = [
        *inspection.prepared.evidence,
        *inspection.synthesized_evidence,
        *additional,
    ]
    for item in candidates:
        existing = ledger.get(item.id)
        if existing is not None:
            if existing != item:
                raise ValueError(f"Conflicting authoritative evidence ID: {item.id}")
            continue
        ledger[item.id] = item
        ordered.append(item)
    return ordered


def finalize_diagnosis_draft(
    draft: DiagnosisDraft,
    inspection: DeterministicInspection,
    incident_correlation: IncidentCorrelationDraft | None = None,
) -> DiagnosisResult:
    """Attach only authoritative, cited evidence to a model-produced draft."""
    authoritative = collect_inspection_evidence(inspection)
    ledger = {item.id: item for item in authoritative}
    referenced_ids = {
        evidence_id for conclusion in draft.conclusions for evidence_id in conclusion.evidence_ids
    }
    unknown_ids = referenced_ids - set(ledger)
    if unknown_ids:
        unknown = ", ".join(sorted(unknown_ids))
        raise ValueError(f"Diagnosis draft references unknown evidence IDs: {unknown}")
    _reject_non_citable_evidence(referenced_ids, ledger)
    cited_evidence = [item for item in authoritative if item.id in referenced_ids]
    deterministic_missing = [item.code for item in inspection.prepared.missing_evidence]
    correlation_missing = (
        incident_correlation.missing_evidence if incident_correlation is not None else []
    )
    combined_missing = list(
        dict.fromkeys([*draft.missing_evidence, *correlation_missing, *deterministic_missing])
    )
    return DiagnosisResult(
        status=draft.status,
        summary=draft.summary,
        evidence=cited_evidence,
        conclusions=draft.conclusions,
        missing_evidence=combined_missing,
    )


def validate_result_against_inspection(
    result: DiagnosisResult,
    inspection: DeterministicInspection,
    additional: Iterable[Evidence] = (),
) -> DiagnosisResult:
    """Validate result evidence against an authoritative inspection ledger."""
    authoritative = collect_inspection_evidence(inspection, additional)
    ledger = {item.id: item for item in authoritative}
    for item in result.evidence:
        expected = ledger.get(item.id)
        if expected is None:
            raise ValueError(f"Diagnosis result contains unknown evidence ID: {item.id}")
        if expected != item:
            raise ValueError(f"Diagnosis result altered authoritative evidence: {item.id}")

    referenced_ids = {
        evidence_id for conclusion in result.conclusions for evidence_id in conclusion.evidence_ids
    }
    _reject_non_citable_evidence(referenced_ids, ledger)

    required_missing = {item.code for item in inspection.prepared.missing_evidence if item.required}
    omitted_missing = required_missing - set(result.missing_evidence)
    if omitted_missing:
        omitted = ", ".join(sorted(omitted_missing))
        raise ValueError(f"Diagnosis result omits required missing evidence: {omitted}")
    return result
