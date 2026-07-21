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
from maa_diagnostic_expert.contracts.workflow import IncidentSelection

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
    ]
    if incident_selection is not None:
        lines.extend(_render_incident_candidates(incident_selection))
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
) -> ReasoningContext:
    """Build a reasoning context with evidence ordered for model consumption."""
    ordered = order_evidence_for_reasoning(evidence)
    return ReasoningContext(
        stage="diagnose",
        instruction=render_instruction(question, ordered, incident_selection),
        evidence=ordered,
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
