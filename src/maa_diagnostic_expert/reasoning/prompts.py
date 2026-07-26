from __future__ import annotations

from pathlib import Path
from typing import cast

from maa_diagnostic_expert.contracts.domain import (
    Conclusion,
    ContractModel,
    DiagnosisDraft,
    DiagnosisResult,
    DiagnosisStatus,
    Evidence,
    EvidenceReliability,
    EvidenceRole,
    MissingEvidence,
    PreparedAnalysis,
    SourceRole,
)
from maa_diagnostic_expert.contracts.workflow import (
    EvidenceResearchPlan,
    FixCandidate,
    FixCandidatePlan,
    FixExecutionOutcome,
    FixPlanningStatus,
    IncidentComparison,
    IncidentCorrelationDraft,
    IncidentSelection,
    IncidentSelectionStatus,
    KnowledgeResearchPlan,
    SourceResearchPlan,
    SourceResearchStatus,
    VerificationPlan,
    VerificationPlanningStatus,
    VerificationPlanSet,
)
from maa_diagnostic_expert.inspection.adaptive_evidence import available_evidence_query_paths

from .evidence_budget import render_model_evidence_item
from .protocol import ReasoningContext

_REASONING_RELIABILITY_ORDER: dict[EvidenceReliability, int] = {
    EvidenceReliability.PRIMARY: 0,
    EvidenceReliability.SECONDARY: 1,
    EvidenceReliability.CONTEXT: 2,
}

_REASONING_ROLE_ORDER: dict[EvidenceRole, int] = {
    EvidenceRole.FAILURE: 0,
    EvidenceRole.SIGNAL: 1,
    EvidenceRole.CONTEXT: 2,
}


def order_evidence_for_reasoning(evidence: list[Evidence]) -> list[Evidence]:
    """Order direct failures before signals and context, then by provenance quality."""
    return sorted(
        evidence,
        key=lambda item: (
            _REASONING_ROLE_ORDER[item.role],
            _REASONING_RELIABILITY_ORDER[item.reliability],
            item.id,
        ),
    )


def _evidence_counts(evidence: list[Evidence]) -> dict[str, int]:
    counts = {level.value: 0 for level in EvidenceReliability}
    for item in evidence:
        counts[item.reliability.value] += 1
    return counts


def _role_counts(evidence: list[Evidence]) -> dict[str, int]:
    counts = {role.value: 0 for role in EvidenceRole}
    for item in evidence:
        counts[item.role.value] += 1
    return counts


def build_reported_context(issue: str | None, question: str | None) -> str:
    """Preserve the reported symptom and diagnostic question as distinct model inputs."""
    parts: list[str] = []
    if issue:
        parts.append(f"Reported issue:\n{issue}")
    if question:
        parts.append(f"Diagnostic question:\n{question}")
    if not parts:
        raise ValueError("Reported context requires an issue or diagnostic question")
    return "\n\n".join(parts)


def _render_incident_candidates(selection: IncidentSelection, limit: int = 20) -> list[str]:
    lines = [
        "",
        f"Deterministic incident selection: {selection.status.value}; "
        f"candidates={len(selection.candidates)}.",
    ]
    for candidate in selection.candidates[:limit]:
        scope = candidate.task_name or candidate.session_id or "unscoped log occurrence"
        lines.append(
            f"- {candidate.candidate_id}: {scope}; confidence={candidate.confidence}; "
            f"time={candidate.started_at or 'unknown'}..{candidate.ended_at or 'unknown'}; "
            f"evidence={', '.join(candidate.evidence_ids)}; "
            f"reasons={'; '.join(candidate.reasons)}"
        )
    if len(selection.candidates) > limit:
        lines.append(
            f"- {len(selection.candidates) - limit} additional lower-priority candidate(s) "
            "remain in the deterministic inspection."
        )
    return lines


def _render_missing_evidence(
    label: str,
    missing_evidence: list[MissingEvidence],
) -> list[str]:
    items: list[MissingEvidence] = []
    for item in missing_evidence:
        if item not in items:
            items.append(item)
    if not items:
        return []
    return [
        f"{label} missing evidence: " + "; ".join(f"{item.code}: {item.message}" for item in items)
    ]


def render_instruction(
    reported_context: str,
    evidence: list[Evidence],
    incident_selection: IncidentSelection | None = None,
    incident_correlation: IncidentCorrelationDraft | None = None,
    incident_comparison: IncidentComparison | None = None,
    prepared_missing_evidence: list[MissingEvidence] | None = None,
) -> str:
    """Render the reasoning instruction for the diagnostic stage."""
    counts = _evidence_counts(evidence)
    role_counts = _role_counts(evidence)
    lines = [
        "You are a MaaFramework diagnostic expert. Analyze the provided runtime",
        "evidence and produce a structured diagnosis.",
        "",
        "Reported diagnostic context:",
        reported_context,
        "",
        "Evidence reliability levels:",
        "- primary: a directly observed fact from an authoritative source",
        "- secondary: a deterministic derived or aggregated fact",
        "- context: contextual guidance, configuration, or summaries",
        "",
        "Evidence diagnostic roles:",
        "- failure: a directly observed runtime failure or failed runtime outcome",
        "- signal: a warning, anomaly, or static diagnostic that still needs correlation",
        "- context: versions, configuration, source guidance, and other background facts",
        "",
        f"Evidence available: {len(evidence)} items "
        f"(primary={counts[EvidenceReliability.PRIMARY.value]}, "
        f"secondary={counts[EvidenceReliability.SECONDARY.value]}, "
        f"context={counts[EvidenceReliability.CONTEXT.value]}; "
        f"failure={role_counts[EvidenceRole.FAILURE.value]}, "
        f"signal={role_counts[EvidenceRole.SIGNAL.value]}, "
        f"diagnostic_context={role_counts[EvidenceRole.CONTEXT.value]}).",
        "",
        "Rules:",
        "1. Every conclusion MUST cite at least one evidence ID from the evidence list.",
        "2. Separate the reported symptom, the observed failure mechanism,",
        "   and the suspected trigger.",
        "3. A framework-level success event does not prove business success.",
        "4. If primary evidence is insufficient to form a confident diagnosis,",
        "   set status to 'insufficient_evidence'.",
        "5. Do not invent evidence IDs; only reference IDs present in the evidence list.",
        "6. Incident candidates are leads, not proof that they match the reported symptom.",
        "7. Respect the validated incident correlation: prioritize a selected candidate, keep",
        "   ambiguous candidates separate, and do not present not-found candidates as the",
        "   reported incident.",
        "8. Treat source_guidance evidence as scoped instructions for source investigation,",
        "   not as proof of a runtime failure or root cause.",
        "9. Wiki navigation matches may guide investigation but MUST NOT be cited by a",
        "   conclusion; cite the original documentation or source passage instead.",
    ]
    lines.extend(
        _render_missing_evidence(
            "Prepared",
            prepared_missing_evidence or [],
        )
    )
    if incident_selection is not None:
        lines.extend(_render_incident_candidates(incident_selection))
        lines.extend(
            _render_missing_evidence(
                "Selection",
                incident_selection.missing_evidence,
            )
        )
    if incident_correlation is not None:
        lines.extend(
            [
                "",
                f"Model incident correlation: {incident_correlation.status.value}; "
                f"selected={incident_correlation.selected_candidate_id or 'none'}; "
                f"relevant={', '.join(incident_correlation.relevant_candidate_ids) or 'none'}.",
                f"Correlation rationale: {incident_correlation.rationale}",
                "The correlation is interpretation, so diagnosis conclusions must still cite "
                "the underlying evidence IDs.",
            ]
        )
    if incident_comparison is not None:
        lines.extend(
            [
                "",
                f"Deterministic actual/expected comparison: {incident_comparison.status.value}.",
                (
                    "Comparison findings describe evidence availability and observed "
                    "runtime/configuration relationships; they are not root-cause conclusions."
                ),
            ]
        )
        for finding in incident_comparison.findings:
            lines.append(
                f"- {finding.kind.value}: {finding.statement} "
                f"observed={', '.join(finding.observed_evidence_ids) or 'none'}; "
                f"expected={', '.join(finding.expected_evidence_ids) or 'none'}"
            )
        for expected in incident_comparison.expected_tasks:
            lines.append(
                f"- expected task {expected.task_name} from {expected.source_id}: "
                f"variants={expected.found_variants}; "
                f"recognition={', '.join(expected.recognition_types) or 'unspecified'}; "
                f"action={', '.join(expected.action_types) or 'unspecified'}; "
                f"next={', '.join(expected.next_targets) or 'none'}"
            )
        lines.extend(
            _render_missing_evidence(
                "Comparison",
                incident_comparison.missing_evidence,
            )
        )
    return "\n".join(lines)


def render_evidence_block(evidence: list[Evidence]) -> str:
    """Render evidence records as a text block for model consumption."""
    if not evidence:
        return "(no evidence available)"
    return "\n\n".join(render_model_evidence_item(item) for item in evidence)


def build_reasoning_context(
    reported_context: str,
    evidence: list[Evidence],
    incident_selection: IncidentSelection | None = None,
    incident_correlation: IncidentCorrelationDraft | None = None,
    incident_comparison: IncidentComparison | None = None,
    prepared_missing_evidence: list[MissingEvidence] | None = None,
) -> ReasoningContext:
    """Build a reasoning context with evidence ordered for model consumption."""
    ordered = order_evidence_for_reasoning(evidence)
    return ReasoningContext(
        stage="diagnose",
        instruction=render_instruction(
            reported_context,
            ordered,
            incident_selection,
            incident_correlation,
            incident_comparison,
            prepared_missing_evidence=prepared_missing_evidence,
        ),
        evidence=ordered,
        incident_selection=incident_selection,
        incident_comparison=incident_comparison,
    )


def build_evidence_research_context(
    reported_context: str,
    evidence: list[Evidence],
    prepared: PreparedAnalysis,
    *,
    round_number: int,
    max_rounds: int,
) -> ReasoningContext:
    paths = available_evidence_query_paths(prepared)
    lines = [
        "Decide whether focused raw artifact windows are needed before diagnosis.",
        "Return a bounded evidence research plan, not a diagnosis.",
        "",
        "Reported diagnostic context:",
        reported_context,
        f"Adaptive evidence round: {round_number} of {max_rounds}.",
        "Available text artifact paths:",
        *(f"- {path}" for path in paths),
        "",
        "Rules:",
        "1. Use only an exact path listed above.",
        "2. Request at most three windows and at most 400 lines per window.",
        "3. Use focused line ranges supported by current evidence; do not request whole logs.",
        "4. Use skip when current evidence is sufficient or no focused window is justified.",
        "5. Query results are evidence, not automatic root-cause conclusions.",
    ]
    return ReasoningContext(
        stage="plan_evidence_research",
        instruction="\n".join(lines),
        evidence=order_evidence_for_reasoning(evidence),
    )


def build_incident_correlation_context(
    reported_context: str,
    evidence: list[Evidence],
    selection: IncidentSelection,
) -> ReasoningContext:
    candidate_evidence_ids = {
        evidence_id for candidate in selection.candidates for evidence_id in candidate.evidence_ids
    }
    focused_evidence = order_evidence_for_reasoning(
        [item for item in evidence if item.id in candidate_evidence_ids]
    )
    lines = [
        "Correlate the reported Maa issue with deterministic incident candidates.",
        "Return a structured incident correlation draft.",
        "",
        "Reported diagnostic context:",
        reported_context,
        "",
        "Rules:",
        "1. Select a candidate only when the reported symptom, task/time context, and candidate",
        "   evidence align; a runtime failure alone does not prove it is the reported problem.",
        "2. Use ambiguous when multiple candidates remain plausible or the report is too vague.",
        "3. Use not_found when none of the candidates plausibly matches the report.",
        "4. Reference only candidate IDs and evidence IDs listed below.",
        "5. Candidate confidence is evidence-strength ranking, not diagnosis correctness.",
    ]
    lines.extend(_render_incident_candidates(selection, limit=len(selection.candidates)))
    return ReasoningContext(
        stage="correlate_incident",
        instruction="\n".join(lines),
        evidence=focused_evidence,
        incident_selection=selection,
    )


def build_source_research_context(
    reported_context: str,
    evidence: list[Evidence],
    incident_comparison: IncidentComparison,
    source_ids: list[str],
) -> ReasoningContext:
    comparison_evidence_ids = {
        evidence_id
        for finding in incident_comparison.findings
        for evidence_id in [
            *finding.observed_evidence_ids,
            *finding.expected_evidence_ids,
        ]
    }
    focused = order_evidence_for_reasoning(
        [
            item
            for item in evidence
            if item.id in comparison_evidence_ids
            or item.kind
            in {
                "source_guidance",
                "mse_task_resolution",
                "mse_task_not_found",
            }
        ]
    )
    lines = [
        "Plan a bounded search of version-matched Maa implementation source.",
        "Return a structured source research plan, not a diagnosis.",
        "",
        "Reported diagnostic context:",
        reported_context,
        f"Available project/GUI/framework source IDs: {', '.join(source_ids)}",
        f"Actual/expected comparison status: {incident_comparison.status.value}",
        "",
        "Rules:",
        "1. Use only the listed source IDs.",
        "2. Search for concrete task/node names, configuration fields, custom log terms,",
        "   implementation symbols, or documentation concepts supported by current evidence.",
        "3. Terms are literal case-sensitive strings; use separate queries for alternatives.",
        "4. Paths are optional relative file or directory hints, not glob patterns.",
        "5. Do not use absolute paths, parent traversal, or .git paths.",
        "6. Keep the plan small: at most five queries and only searches that could distinguish",
        "   plausible explanations or locate relevant project behavior.",
        "7. Use skip when focused source search is unlikely to add useful evidence.",
        "8. Applicable source_guidance evidence must be respected when choosing paths for its",
        "   project source; GUI/MaaFramework queries may search implementation files.",
    ]
    return ReasoningContext(
        stage="plan_source_research",
        instruction="\n".join(lines),
        evidence=focused,
        incident_comparison=incident_comparison,
    )


def build_knowledge_research_context(
    reported_context: str,
    evidence: list[Evidence],
    incident_comparison: IncidentComparison,
    sources: list[tuple[str, SourceRole]],
) -> ReasoningContext:
    comparison_evidence_ids = {
        evidence_id
        for finding in incident_comparison.findings
        for evidence_id in [
            *finding.observed_evidence_ids,
            *finding.expected_evidence_ids,
        ]
    }
    focused = order_evidence_for_reasoning(
        [
            item
            for item in evidence
            if item.id in comparison_evidence_ids
            or item.kind
            in {
                "mse_task_resolution",
                "mse_task_not_found",
                "source_search_match",
            }
        ]
    )
    rendered_sources = ", ".join(f"{source_id} ({role.value})" for source_id, role in sources)
    lines = [
        "Plan a bounded search of explicit version-matched Maa documentation sources.",
        "Return a structured knowledge research plan, not a diagnosis.",
        "",
        "Reported diagnostic context:",
        reported_context,
        f"Available knowledge sources: {rendered_sources}",
        f"Actual/expected comparison status: {incident_comparison.status.value}",
        "",
        "Rules:",
        "1. Use only the listed source IDs.",
        "2. Search for concrete MaaFramework concepts, pipeline fields, lifecycle semantics,",
        "   or diagnostic guidance needed to interpret the current evidence.",
        "3. Terms are literal case-sensitive strings; use separate queries for alternatives.",
        "4. Paths are optional relative file or directory hints, not glob patterns.",
        "5. Do not use absolute paths, parent traversal, or .git paths.",
        "6. Keep the plan small: at most five queries; use skip when documents are unlikely",
        "   to change the diagnosis or repair choice.",
        "7. documentation and maa_framework results are original context that may be cited.",
        "8. wiki results are navigation only; they cannot support a conclusion directly.",
        "9. maa_framework searches are limited to docs/doc/documentation directories and",
        "   README files; framework implementation requires a separate source branch.",
    ]
    return ReasoningContext(
        stage="plan_knowledge_research",
        instruction="\n".join(lines),
        evidence=focused,
        incident_comparison=incident_comparison,
    )


def build_fix_candidate_context(
    reported_context: str,
    evidence: list[Evidence],
    diagnosis: DiagnosisDraft | DiagnosisResult,
    incident_comparison: IncidentComparison,
) -> ReasoningContext:
    """Build the model request for bounded, evidence-backed repair proposals."""
    lines = [
        "Propose a bounded set of minimal repair candidates for the completed diagnosis.",
        "Return repair proposals only; do not claim that any change was applied or verified.",
        "",
        "Reported diagnostic context:",
        reported_context,
        f"Diagnosis status: {diagnosis.status.value}",
        f"Diagnosis summary: {diagnosis.summary}",
        "Diagnosis conclusions:",
        *(
            f"- {conclusion.statement}; confidence={conclusion.confidence}; "
            f"evidence={', '.join(conclusion.evidence_ids)}"
            for conclusion in diagnosis.conclusions
        ),
        f"Actual/expected comparison status: {incident_comparison.status.value}",
        "",
        "Rules:",
        "1. Propose at most three candidates and prefer one minimal, stable change.",
        "2. Every candidate must cite known evidence IDs, including evidence cited by a",
        "   diagnosis conclusion. Evidence supports a proposal; it does not prove the fix.",
        "3. Target the first observed divergence and name a precise node, file, symbol,",
        "   configuration field, dependency, GUI component, or framework component.",
        "4. Record concrete regression risks and verification steps for every candidate.",
        "5. Do not execute commands, write files, or report a repair as completed.",
        "6. Use skip if the diagnosis is insufficient or no evidence-backed target exists.",
        "7. For OCR configuration, prefer ROI/only_rec corrections, then expected/replace,",
        "   then evidence-backed color_filter; avoid model changes as a default mature fix.",
        "8. Framework-level success is not a business milestone; verification must cover",
        "   the reported outcome and relevant adjacent regression scenarios.",
        "9. Wiki navigation evidence cannot directly support a repair candidate.",
    ]
    return ReasoningContext(
        stage="propose_fix",
        instruction="\n".join(lines),
        evidence=order_evidence_for_reasoning(evidence),
        incident_comparison=incident_comparison,
    )


def build_verification_plan_context(
    reported_context: str,
    evidence: list[Evidence],
    fix_candidates: FixCandidatePlan,
) -> ReasoningContext:
    """Build pre-execution checks for every validated repair candidate."""
    lines = [
        "Create a concrete pre-execution verification plan for each repair candidate.",
        "Return plans only; do not execute a repair or claim any check has passed.",
        "",
        "Reported diagnostic context:",
        reported_context,
        "Validated repair candidates:",
    ]
    for candidate in fix_candidates.candidates:
        lines.extend(
            [
                f"- {candidate.fix_id}: target={candidate.target}; "
                f"scope={candidate.scope.value}; method={candidate.method.value}",
                f"  rationale={candidate.rationale}",
                f"  suggested_steps={'; '.join(candidate.verification_steps)}",
                f"  regression_risks={'; '.join(candidate.regression_risks) or 'none recorded'}",
            ]
        )
    lines.extend(
        [
            "",
            "Rules:",
            "1. Return exactly one plan for every listed fix ID and no unknown fix IDs.",
            "2. Give ordered, concrete steps and at least one explicit business milestone.",
            "3. A MaaFramework success event alone is not a business milestone. Check the",
            "   reported user-visible task outcome or another explicit task milestone.",
            "4. Cover every recorded regression risk with adjacent or representative checks.",
            "5. Prefer offline screenshot/static checks when they can prove the change; use",
            "   runtime execution or manual observation when offline evidence is insufficient.",
            "6. Keep verification read-only at this stage. Do not write files or run commands.",
            "7. Do not mark checks passed, failed, or unavailable; this is planning only.",
            "8. Include applicable required checks listed by source_guidance evidence.",
        ]
    )
    return ReasoningContext(
        stage="plan_verification",
        instruction="\n".join(lines),
        evidence=order_evidence_for_reasoning(evidence),
    )


def build_fix_execution_context(
    reported_context: str,
    evidence: list[Evidence],
    candidate: FixCandidate,
    verification: VerificationPlan,
    allowed_roots: list[Path],
) -> ReasoningContext:
    """Translate a user-selected candidate into one exact, still-unapproved command."""
    focused = order_evidence_for_reasoning(
        [
            item
            for item in evidence
            if item.id in candidate.evidence_ids
            or item.kind in {"source_guidance", "source_search_match"}
        ]
    )
    lines = [
        "Translate the explicitly selected repair candidate into one exact command request.",
        "Return a request only. Do not execute it or claim that it is approved or successful.",
        "",
        "Reported diagnostic context:",
        reported_context,
        f"Selected fix: {candidate.fix_id}",
        f"Target: {candidate.target}",
        f"Scope/method: {candidate.scope.value}/{candidate.method.value}",
        f"Rationale: {candidate.rationale}",
        f"Evidence: {', '.join(candidate.evidence_ids)}",
        f"Verification steps: {'; '.join(verification.steps)}",
        "Allowed working-directory roots:",
        *(f"- {root.resolve()}" for root in allowed_roots),
        "",
        "Rules:",
        "1. Preserve the selected fix_id exactly and produce one process or shell command.",
        "2. Use a cwd at or below an exact allowed root. Do not use cwd to broaden scope.",
        "3. List every expected changed path relative to cwd; do not traverse parents or .git.",
        "4. Apply only the selected minimal repair. Do not bundle refactors or unrelated cleanup.",
        "5. Respect applicable source_guidance evidence, including repository structure.",
        "6. Do not push, publish, modify remote issues, change branches, or commit changes.",
        "7. Prefer a process request without a shell when it can express the exact operation.",
        "8. Approval is owned by the harness. Never include or infer an approval flag.",
        "9. The command will be approved separately and its completion will not prove the fix.",
    ]
    return ReasoningContext(
        stage="plan_fix_execution",
        instruction="\n".join(lines),
        evidence=focused,
    )


def build_fix_verification_context(
    execution: FixExecutionOutcome,
    evidence: list[Evidence],
) -> ReasoningContext:
    """Build an evidence-only post-execution repair assessment request."""
    plan = execution.verification_plan
    lines = [
        "Assess the executed repair against every planned verification requirement.",
        "Return a verification draft only. Do not invent evidence or run more commands.",
        "",
        f"Fix ID: {execution.request.fix_id}",
        f"Command execution status: {execution.status.value}",
        "Expected changed paths:",
        *(f"- {path}" for path in execution.request.expected_changed_paths),
        "Verification steps:",
        *(f"- {step}" for step in plan.steps),
        "Business milestones:",
        *(f"- {milestone}" for milestone in plan.business_milestones),
        "Regression checks:",
        *(f"- {check}" for check in plan.regression_checks),
        "",
        "Rules:",
        "1. Return exactly one check for every path, step, business milestone, and regression",
        "   requirement above, preserving each requirement string exactly.",
        "2. Passed and failed checks must cite only supplied evidence IDs. Use unavailable and",
        "   record missing evidence when the supplied evidence cannot prove an outcome.",
        "3. Command exit code 0 proves only that the command completed, not that files changed,",
        "   validation steps passed, or the repair works.",
        "4. A MaaFramework success/task summary is not business-success evidence. A passed",
        "   business milestone must cite explicit business_milestone evidence.",
        "5. A passed file-change check requires deterministic before/after change evidence.",
        "6. Mark the overall result passed only when every check passes; failed when any check",
        "   fails; otherwise use unavailable.",
        "7. Do not use current source or configuration to rewrite what pre-fix evidence showed.",
    ]
    return ReasoningContext(
        stage="verify_fix",
        instruction="\n".join(lines),
        evidence=order_evidence_for_reasoning(evidence),
    )


def _stub_diagnose(context: ReasoningContext) -> DiagnosisDraft:
    """Produce a deterministic diagnosis from the evidence without a model.

    Groups direct failure evidence into conclusions. Returns an insufficient-evidence
    result when no directly observed runtime failure exists.
    """
    failures = [item for item in context.evidence if item.role is EvidenceRole.FAILURE]
    if not failures:
        return DiagnosisDraft(
            status=DiagnosisStatus.INSUFFICIENT_EVIDENCE,
            summary="No directly observed runtime failures were found in the inspected evidence.",
            conclusions=[],
            missing_evidence=[],
        )
    conclusions: list[Conclusion] = []
    for item in failures:
        first_line = item.content.splitlines()[0] if item.content else item.kind
        conclusions.append(
            Conclusion(
                statement=f"Observed {item.kind}: {first_line}",
                evidence_ids=[item.id],
                confidence=0.85,
            )
        )
    return DiagnosisDraft(
        status=DiagnosisStatus.COMPLETE,
        summary=(
            f"Identified {len(failures)} directly observed runtime failure(s) "
            f"across {len(context.evidence)} evidence items."
        ),
        conclusions=conclusions,
        missing_evidence=[],
    )


def _stub_correlate(context: ReasoningContext) -> IncidentCorrelationDraft:
    selection = context.incident_selection
    if selection is None or not selection.candidates:
        return IncidentCorrelationDraft(
            status=IncidentSelectionStatus.NOT_FOUND,
            rationale="No deterministic incident candidates were available for correlation.",
        )
    candidate_ids = [candidate.candidate_id for candidate in selection.candidates]
    evidence_ids = list(
        dict.fromkeys(
            evidence_id
            for candidate in selection.candidates
            for evidence_id in candidate.evidence_ids
        )
    )
    return IncidentCorrelationDraft(
        status=IncidentSelectionStatus.AMBIGUOUS,
        relevant_candidate_ids=candidate_ids,
        evidence_ids=evidence_ids,
        rationale=(
            "The deterministic stub preserves all candidates because it cannot correlate "
            "free-form reported context."
        ),
        missing_evidence=["model_incident_correlation_unavailable"],
    )


def _stub_plan_source_research() -> SourceResearchPlan:
    return SourceResearchPlan(
        status=SourceResearchStatus.SKIP,
        rationale=("The deterministic stub cannot choose semantic source search terms."),
    )


def _stub_plan_knowledge_research() -> KnowledgeResearchPlan:
    return KnowledgeResearchPlan(
        status=SourceResearchStatus.SKIP,
        rationale=("The deterministic stub cannot choose semantic documentation search terms."),
    )


def _stub_plan_evidence_research() -> EvidenceResearchPlan:
    return EvidenceResearchPlan(
        status=SourceResearchStatus.SKIP,
        rationale="The deterministic stub does not request additional raw evidence.",
    )


def _stub_plan_fix_candidates() -> FixCandidatePlan:
    return FixCandidatePlan(
        status=FixPlanningStatus.SKIP,
        rationale="The deterministic stub does not propose semantic repair candidates.",
    )


def _stub_plan_verification() -> VerificationPlanSet:
    return VerificationPlanSet(
        status=VerificationPlanningStatus.SKIP,
        rationale="The deterministic stub has no repair candidates to verify.",
    )


class StubReasoningSession:
    """Deterministic reasoning session for testing without a model."""

    def __init__(self, run_id: str) -> None:
        self._run_id = run_id
        self._closed = False
        self.last_context: ReasoningContext | None = None

    @property
    def run_id(self) -> str:
        return self._run_id

    @property
    def closed(self) -> bool:
        return self._closed

    async def reason[ResultT: ContractModel](
        self, context: ReasoningContext, result_type: type[ResultT]
    ) -> ResultT:
        if self._closed:
            raise RuntimeError("reasoning session is closed")
        self.last_context = context
        if result_type is DiagnosisDraft:
            return cast(ResultT, _stub_diagnose(context))
        if result_type is IncidentCorrelationDraft:
            return cast(ResultT, _stub_correlate(context))
        if result_type is SourceResearchPlan:
            return cast(ResultT, _stub_plan_source_research())
        if result_type is KnowledgeResearchPlan:
            return cast(ResultT, _stub_plan_knowledge_research())
        if result_type is EvidenceResearchPlan:
            return cast(ResultT, _stub_plan_evidence_research())
        if result_type is FixCandidatePlan:
            return cast(ResultT, _stub_plan_fix_candidates())
        if result_type is VerificationPlanSet:
            return cast(ResultT, _stub_plan_verification())
        raise TypeError(f"Stub backend cannot produce {result_type.__name__}")

    async def close(self) -> None:
        self._closed = True


class StubReasoningBackend:
    """Creates deterministic reasoning sessions for testing without a model."""

    def __init__(self) -> None:
        self.last_session: StubReasoningSession | None = None
        self.sessions: list[StubReasoningSession] = []

    async def start(self, *, run_id: str) -> StubReasoningSession:
        session = StubReasoningSession(run_id)
        self.last_session = session
        self.sessions.append(session)
        return session


def make_stub_backend() -> StubReasoningBackend:
    """Factory for the deterministic stub reasoning backend."""
    return StubReasoningBackend()
