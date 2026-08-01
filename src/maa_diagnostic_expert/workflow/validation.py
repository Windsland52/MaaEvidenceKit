from __future__ import annotations

import re
from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from pathlib import Path

from maa_diagnostic_expert.contracts.domain import (
    DiagnosisDraft,
    DiagnosisResult,
    DiagnosisStatus,
    Evidence,
    MissingEvidence,
    PreparedAnalysis,
    SourceRole,
)
from maa_diagnostic_expert.contracts.workflow import (
    FixCandidatePlan,
    FixMethod,
    FixPlanningStatus,
    IncidentCorrelationDraft,
    IncidentSelection,
    IncidentSelectionStatus,
    VerificationPlanningStatus,
    VerificationPlanSet,
)
from maa_diagnostic_expert.inspection.configuration_keys import (
    ConfigurationKeyIndex,
    extract_configuration_keys,
    matching_configuration_identifiers,
    source_configuration_identifier_sets,
)
from maa_diagnostic_expert.inspection.log_overview import (
    LogOverviewCollection,
    collect_log_overview_missing_evidence,
)
from maa_diagnostic_expert.inspection.models import DeterministicInspection

_NON_CITABLE_EVIDENCE_KINDS = {"wiki_navigation_match"}
_CODE_FIX_SOURCE_ROLES = {
    FixMethod.PROJECT_CODE: SourceRole.PROJECT,
    FixMethod.GUI_CODE: SourceRole.GUI,
    FixMethod.FRAMEWORK_CODE: SourceRole.MAA_FRAMEWORK,
}
_EXPLICIT_CODE_SYMBOL = re.compile(
    r"\b(?:class|function|method|symbol)\s+([A-Za-z_$][A-Za-z0-9_$]*)",
    re.IGNORECASE,
)


def _versioned_source_file_identity(evidence: Evidence) -> tuple[str, str] | None:
    """Return a stable component/file key without assigning meaning to a repository layout."""
    if not evidence.source_component.startswith("source:"):
        return None
    locator_parts = evidence.source_path.split(":", maxsplit=2)
    if len(locator_parts) != 3 or locator_parts[0] != "git":
        return None
    return (
        evidence.source_component,
        locator_parts[2].replace("\\", "/").casefold(),
    )


@dataclass(frozen=True, slots=True)
class ConfigurationEvidenceBridge:
    """One lexical source/configuration dependency backed by two evidence records."""

    source_evidence_id: str
    configuration_evidence_id: str
    identifiers: frozenset[str]


def configuration_evidence_bridges(
    evidence: Iterable[Evidence],
    configuration_paths: set[Path],
) -> list[ConfigurationEvidenceBridge]:
    """Find exact source/configuration evidence pairs and their shared identifiers."""
    items = list(evidence)
    source_identifiers = source_configuration_identifier_sets(items)
    configuration_identifiers = {
        item.id: set(extract_configuration_keys(item.content))
        for item in items
        if item.kind == "text_line_window"
        and Path(item.source_path).resolve() in configuration_paths
    }
    bridges: list[ConfigurationEvidenceBridge] = []
    for source_id, identifiers in source_identifiers.items():
        for configuration_id, keys in configuration_identifiers.items():
            if shared := identifiers.intersection(keys):
                bridges.append(
                    ConfigurationEvidenceBridge(
                        source_evidence_id=source_id,
                        configuration_evidence_id=configuration_id,
                        identifiers=frozenset(shared),
                    )
                )
    return bridges


def configuration_bridge_evidence_ids(
    evidence: Iterable[Evidence],
    configuration_paths: set[Path],
) -> tuple[set[str], set[str]]:
    """Find source and artifact evidence that establish one configuration dependency."""
    bridges = configuration_evidence_bridges(evidence, configuration_paths)
    return (
        {bridge.source_evidence_id for bridge in bridges},
        {bridge.configuration_evidence_id for bridge in bridges},
    )


def requires_configuration_evidence(
    evidence: Iterable[Evidence],
    configuration_index: ConfigurationKeyIndex,
) -> bool:
    """Return whether source behavior depends on an uninspected configuration value."""
    items = list(evidence)
    if not configuration_index:
        return False
    matches = matching_configuration_identifiers(items, configuration_index)
    if not matches:
        return False
    _, configuration_ids = configuration_bridge_evidence_ids(
        items,
        set(matches),
    )
    return not configuration_ids


def validate_configuration_bridge_citation(
    draft: DiagnosisDraft,
    evidence: Iterable[Evidence],
    configuration_paths: set[Path],
) -> None:
    """Require one conclusion to connect dependent source to effective configuration."""
    if draft.status is not DiagnosisStatus.COMPLETE:
        return
    bridges = configuration_evidence_bridges(
        evidence,
        configuration_paths,
    )
    if not bridges:
        return
    if any(
        bridge.source_evidence_id in conclusion.evidence_ids
        and bridge.configuration_evidence_id in conclusion.evidence_ids
        for conclusion in draft.conclusions
        for bridge in bridges
    ):
        return
    raise ValueError(
        "A complete diagnosis of configuration-dependent source behavior must include one "
        "conclusion citing both version-matched source evidence and the queried configuration "
        "artifact evidence"
    )


def validate_fix_configuration_bridge(
    plan: FixCandidatePlan,
    draft: DiagnosisDraft,
    evidence: Iterable[Evidence],
    configuration_paths: set[Path],
) -> None:
    """Keep code repairs tied to configuration evidence used by the diagnosed trigger."""
    source_ids, configuration_ids = configuration_bridge_evidence_ids(
        evidence,
        configuration_paths,
    )
    required_configuration_ids = {
        evidence_id
        for conclusion in draft.conclusions
        if set(conclusion.evidence_ids).intersection(source_ids)
        for evidence_id in conclusion.evidence_ids
        if evidence_id in configuration_ids
    }
    if not required_configuration_ids:
        return
    code_methods = {
        FixMethod.PROJECT_CODE,
        FixMethod.GUI_CODE,
        FixMethod.FRAMEWORK_CODE,
    }
    for candidate in plan.candidates:
        if candidate.method in code_methods and not set(candidate.evidence_ids).intersection(
            required_configuration_ids
        ):
            raise ValueError(
                f"Code fix candidate '{candidate.fix_id}' must cite configuration evidence "
                "used by the diagnosed source/configuration trigger"
            )


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


def validate_fix_candidate_plan(
    plan: FixCandidatePlan,
    draft: DiagnosisDraft,
    evidence: Iterable[Evidence],
    source_roles: Mapping[str, SourceRole] | None = None,
) -> FixCandidatePlan:
    """Reject repair proposals that outrun the validated diagnostic evidence."""
    if plan.status is FixPlanningStatus.SKIP:
        return plan
    if draft.status is not DiagnosisStatus.COMPLETE:
        raise ValueError("Fix candidates require a complete evidence-backed diagnosis")
    ledger = {item.id: item for item in evidence}
    diagnosis_ids = {
        evidence_id for conclusion in draft.conclusions for evidence_id in conclusion.evidence_ids
    }
    for candidate in plan.candidates:
        referenced_ids = set(candidate.evidence_ids)
        unknown_ids = referenced_ids - set(ledger)
        if unknown_ids:
            unknown = ", ".join(sorted(unknown_ids))
            raise ValueError(f"Fix candidate references unknown evidence IDs: {unknown}")
        _reject_non_citable_evidence(referenced_ids, ledger)
        if not referenced_ids.intersection(diagnosis_ids):
            raise ValueError(
                f"Fix candidate '{candidate.fix_id}' must cite diagnosis conclusion evidence"
            )
        expected_source_role = _CODE_FIX_SOURCE_ROLES.get(candidate.method)
        if expected_source_role is None:
            continue
        diagnostic_source_evidence = [
            ledger[evidence_id]
            for evidence_id in referenced_ids
            if ledger[evidence_id].kind == "source_search_match"
        ]
        if not diagnostic_source_evidence:
            raise ValueError(
                f"Code fix candidate '{candidate.fix_id}' must cite version-matched source evidence"
            )
        diagnosed_files = {
            identity
            for item in diagnostic_source_evidence
            if (identity := _versioned_source_file_identity(item)) is not None
        }
        available_update_ids = {
            item.id
            for item in ledger.values()
            if item.kind == "source_update_match"
            and _versioned_source_file_identity(item) in diagnosed_files
        }
        if available_update_ids and not referenced_ids.intersection(available_update_ids):
            raise ValueError(
                f"Code fix candidate '{candidate.fix_id}' must assess and cite a Git-confirmed "
                "descendant change from the same diagnosed source file"
            )
        source_evidence = [
            ledger[evidence_id]
            for evidence_id in referenced_ids
            if ledger[evidence_id].kind in {"source_search_match", "source_update_match"}
        ]
        explicit_symbols = {
            match.group(1).casefold() for match in _EXPLICIT_CODE_SYMBOL.finditer(candidate.target)
        }
        source_content = "\n".join(item.content for item in source_evidence).casefold()
        unknown_symbols = {symbol for symbol in explicit_symbols if symbol not in source_content}
        if unknown_symbols:
            raise ValueError(
                f"Code fix candidate '{candidate.fix_id}' references source symbols absent from "
                "its cited evidence: " + ", ".join(sorted(unknown_symbols))
            )
        if source_roles is None:
            continue
        matching_role = any(
            item.source_component.startswith("source:")
            and source_roles.get(item.source_component.removeprefix("source:"))
            is expected_source_role
            for item in diagnostic_source_evidence
        )
        if not matching_role:
            raise ValueError(
                f"Code fix candidate '{candidate.fix_id}' must cite source evidence from "
                f"role '{expected_source_role.value}'"
            )
    return plan


def validate_verification_plan_set(
    verification: VerificationPlanSet,
    fixes: FixCandidatePlan,
) -> VerificationPlanSet:
    """Require one concrete, risk-aware verification plan per repair candidate."""
    if fixes.status is FixPlanningStatus.SKIP:
        if verification.status is not VerificationPlanningStatus.SKIP:
            raise ValueError("Verification must be skipped when no fix candidates exist")
        return verification
    if verification.status is not VerificationPlanningStatus.PLANNED:
        raise ValueError("Every proposed fix candidate requires a verification plan")
    candidates = {candidate.fix_id: candidate for candidate in fixes.candidates}
    plan_ids = {plan.fix_id for plan in verification.plans}
    unknown_ids = plan_ids - set(candidates)
    if unknown_ids:
        unknown = ", ".join(sorted(unknown_ids))
        raise ValueError(f"Verification plans reference unknown fix IDs: {unknown}")
    missing_ids = set(candidates) - plan_ids
    if missing_ids:
        missing = ", ".join(sorted(missing_ids))
        raise ValueError(f"Fix candidates are missing verification plans: {missing}")
    for plan in verification.plans:
        candidate = candidates[plan.fix_id]
        if candidate.regression_risks and not plan.regression_checks:
            raise ValueError(
                f"Verification plan for '{plan.fix_id}' must cover recorded regression risks"
            )
    return verification


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


def collect_deterministic_missing_evidence(
    inspection: DeterministicInspection | None = None,
    prepared: PreparedAnalysis | None = None,
    log_overviews: LogOverviewCollection | None = None,
) -> list[MissingEvidence]:
    """Collect deterministic missing-evidence facts from every inspection ledger."""
    if inspection is None:
        return [
            *(prepared.missing_evidence if prepared else ()),
            *collect_log_overview_missing_evidence(log_overviews or LogOverviewCollection()),
        ]
    return [
        *inspection.prepared.missing_evidence,
        *inspection.incident_selection.missing_evidence,
        *inspection.incident_comparison.missing_evidence,
    ]


def collect_missing_evidence_codes(
    inspection: DeterministicInspection | None = None,
    prepared: PreparedAnalysis | None = None,
    model_missing: Iterable[str] = (),
    incident_correlation: IncidentCorrelationDraft | None = None,
    log_overviews: LogOverviewCollection | None = None,
) -> list[str]:
    """Return result-level missing-evidence codes without dropping deterministic facts."""
    deterministic_codes = [
        item.code
        for item in collect_deterministic_missing_evidence(inspection, prepared, log_overviews)
    ]
    correlation_missing = (
        incident_correlation.missing_evidence if incident_correlation is not None else []
    )
    return list(dict.fromkeys([*deterministic_codes, *model_missing, *correlation_missing]))


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
    combined_missing = collect_missing_evidence_codes(
        inspection,
        model_missing=draft.missing_evidence,
        incident_correlation=incident_correlation,
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

    required_missing = {
        item.code for item in collect_deterministic_missing_evidence(inspection) if item.required
    }
    omitted_missing = required_missing - set(result.missing_evidence)
    if omitted_missing:
        omitted = ", ".join(sorted(omitted_missing))
        raise ValueError(f"Diagnosis result omits required missing evidence: {omitted}")
    return result
