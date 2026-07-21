from __future__ import annotations

from typing import cast

from maa_diagnostic_expert.contracts.domain import (
    Conclusion,
    ContractModel,
    DiagnosisDraft,
    DiagnosisStatus,
    Evidence,
    EvidenceReliability,
)
from maa_diagnostic_expert.contracts.workflow import (
    IncidentComparison,
    IncidentCorrelationDraft,
    IncidentSelection,
    IncidentSelectionStatus,
)

from .protocol import ReasoningContext

_REASONING_RELIABILITY_ORDER: dict[EvidenceReliability, int] = {
    EvidenceReliability.PRIMARY: 0,
    EvidenceReliability.SECONDARY: 1,
    EvidenceReliability.CONTEXT: 2,
}


def order_evidence_for_reasoning(evidence: list[Evidence]) -> list[Evidence]:
    """Order evidence so primary findings appear before context."""
    return sorted(
        evidence,
        key=lambda item: (_REASONING_RELIABILITY_ORDER[item.reliability], item.id),
    )


def _evidence_counts(evidence: list[Evidence]) -> dict[str, int]:
    counts = {level.value: 0 for level in EvidenceReliability}
    for item in evidence:
        counts[item.reliability.value] += 1
    return counts


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


def render_instruction(
    question: str,
    evidence: list[Evidence],
    incident_selection: IncidentSelection | None = None,
    incident_correlation: IncidentCorrelationDraft | None = None,
    incident_comparison: IncidentComparison | None = None,
) -> str:
    """Render the reasoning instruction for the diagnostic stage."""
    counts = _evidence_counts(evidence)
    lines = [
        "You are a MaaFramework diagnostic expert. Analyze the provided runtime",
        "evidence and produce a structured diagnosis.",
        "",
        f"Diagnostic question: {question}",
        "",
        "Evidence reliability levels:",
        "- primary: directly observed failures and failed outcomes",
        "- secondary: derived signals (recognition activity, repeated nodes)",
        "- context: task and session execution summaries",
        "",
        f"Evidence available: {len(evidence)} items "
        f"(primary={counts[EvidenceReliability.PRIMARY.value]}, "
        f"secondary={counts[EvidenceReliability.SECONDARY.value]}, "
        f"context={counts[EvidenceReliability.CONTEXT.value]}).",
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
    ]
    if incident_selection is not None:
        lines.extend(_render_incident_candidates(incident_selection))
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
        if incident_comparison.missing_evidence:
            lines.append(
                "Comparison missing evidence: " + "; ".join(incident_comparison.missing_evidence)
            )
    return "\n".join(lines)


def render_evidence_block(evidence: list[Evidence]) -> str:
    """Render evidence records as a text block for model consumption."""
    if not evidence:
        return "(no evidence available)"
    blocks: list[str] = []
    for item in evidence:
        header = f"[{item.id}] ({item.reliability.value}/{item.kind})"
        body = item.content
        if item.line_start is not None:
            if item.line_end is not None and item.line_end != item.line_start:
                loc = f"lines {item.line_start}-{item.line_end}"
            else:
                loc = f"line {item.line_start}"
            body = f"location: {item.source_path} {loc}\n{body}"
        blocks.append(f"{header}\n{body}")
    return "\n\n".join(blocks)


def build_reasoning_context(
    question: str,
    evidence: list[Evidence],
    incident_selection: IncidentSelection | None = None,
    incident_correlation: IncidentCorrelationDraft | None = None,
    incident_comparison: IncidentComparison | None = None,
) -> ReasoningContext:
    """Build a reasoning context with evidence ordered for model consumption."""
    ordered = order_evidence_for_reasoning(evidence)
    return ReasoningContext(
        stage="diagnose",
        instruction=render_instruction(
            question,
            ordered,
            incident_selection,
            incident_correlation,
            incident_comparison,
        ),
        evidence=ordered,
        incident_selection=incident_selection,
        incident_comparison=incident_comparison,
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
        f"Reported context: {reported_context}",
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


def _stub_diagnose(context: ReasoningContext) -> DiagnosisDraft:
    """Produce a deterministic diagnosis from the evidence without a model.

    Groups primary evidence (failures and failed outcomes) into conclusions.
    Returns an insufficient-evidence result when no primary evidence exists.
    """
    primary = [item for item in context.evidence if item.reliability is EvidenceReliability.PRIMARY]
    if not primary:
        return DiagnosisDraft(
            status=DiagnosisStatus.INSUFFICIENT_EVIDENCE,
            summary="No primary runtime failures were found in the inspected logs.",
            conclusions=[],
            missing_evidence=[],
        )
    conclusions: list[Conclusion] = []
    for item in primary:
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
            f"Identified {len(primary)} primary runtime failure(s) "
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
