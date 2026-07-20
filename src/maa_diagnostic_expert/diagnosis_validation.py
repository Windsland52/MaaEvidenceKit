from __future__ import annotations

from collections.abc import Iterable

from .domain import DiagnosisDraft, DiagnosisResult, Evidence
from .inspection import DeterministicInspection


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
    cited_evidence = [item for item in authoritative if item.id in referenced_ids]
    deterministic_missing = [item.code for item in inspection.prepared.missing_evidence]
    combined_missing = list(dict.fromkeys([*draft.missing_evidence, *deterministic_missing]))
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

    required_missing = {item.code for item in inspection.prepared.missing_evidence if item.required}
    omitted_missing = required_missing - set(result.missing_evidence)
    if omitted_missing:
        omitted = ", ".join(sorted(omitted_missing))
        raise ValueError(f"Diagnosis result omits required missing evidence: {omitted}")
    return result
