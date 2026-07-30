from __future__ import annotations

from collections.abc import AsyncIterator
from dataclasses import dataclass, field
from typing import Protocol

from maa_diagnostic_expert.contracts.domain import (
    AnalysisRequest,
    ContractModel,
    DiagnosisResult,
    DiagnosticEvent,
    Evidence,
    ReasoningRequest,
)
from maa_diagnostic_expert.contracts.workflow import IncidentComparison, IncidentSelection

from .evidence_budget import bound_model_evidence


@dataclass(frozen=True, slots=True)
class ReasoningContext:
    """Resolved reasoning context with a bounded model-facing evidence projection.

    The authoritative evidence ledger stays outside this object. Construction
    selects a bounded copy for model consumption and records any omissions or
    content truncation in the instruction. ``followup_instruction`` is sent as
    a separate user message so a correction can preserve the original model
    request as a cacheable prefix. The serializable audit record is produced
    via ``to_request`` and includes both instructions.
    """

    stage: str
    instruction: str
    evidence: list[Evidence] = field(default_factory=list[Evidence])
    incident_selection: IncidentSelection | None = None
    incident_comparison: IncidentComparison | None = None
    followup_instruction: str | None = None
    available_evidence_count: int = field(init=False)
    omitted_evidence_count: int = field(init=False)
    truncated_evidence_count: int = field(init=False)

    def __post_init__(self) -> None:
        selection = bound_model_evidence(self.evidence)
        object.__setattr__(self, "evidence", selection.evidence)
        object.__setattr__(self, "available_evidence_count", selection.available_count)
        object.__setattr__(self, "omitted_evidence_count", selection.omitted_count)
        object.__setattr__(self, "truncated_evidence_count", selection.truncated_count)
        if selection.omitted_count or selection.truncated_count:
            note = (
                "Model evidence budget: "
                f"received {len(selection.evidence)} of {selection.available_count} records; "
                f"omitted={selection.omitted_count}; "
                f"content_truncated={selection.truncated_count}. "
                "This is a bounded view of the authoritative evidence ledger. Do not infer "
                "that omitted content is absent from the inspected artifacts."
            )
            object.__setattr__(self, "instruction", f"{self.instruction}\n\n{note}")

    def to_request(self) -> ReasoningRequest:
        instruction = self.instruction
        if self.followup_instruction is not None:
            instruction = f"{instruction}\n\nFollow-up instruction:\n{self.followup_instruction}"
        return ReasoningRequest(
            stage=self.stage,
            instruction=instruction,
            evidence_ids=[item.id for item in self.evidence],
        )


class DiagnosticAgent(Protocol):
    """Framework-independent public interface implemented by the future LangGraph runtime."""

    async def diagnose(self, request: AnalysisRequest) -> DiagnosisResult: ...

    def stream(self, request: AnalysisRequest) -> AsyncIterator[DiagnosticEvent]: ...

    async def cancel(self, run_id: str) -> None: ...


class ReasoningSession(Protocol):
    """Model-facing session controlled by the Python diagnostic workflow."""

    async def reason[ResultT: ContractModel](
        self, context: ReasoningContext, result_type: type[ResultT]
    ) -> ResultT: ...

    async def close(self) -> None: ...


class ReasoningBackend(Protocol):
    """Creates reasoning sessions without owning diagnostic workflow policy."""

    async def start(self, *, run_id: str) -> ReasoningSession: ...
