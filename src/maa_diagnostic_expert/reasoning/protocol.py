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


@dataclass(frozen=True, slots=True)
class ReasoningContext:
    """Resolved reasoning context: instruction plus full evidence content.

    Carries the evidence records (with content) that a reasoning session
    should consider, alongside the stage name and instruction text. The
    serializable audit record is produced via ``to_request``.
    """

    stage: str
    instruction: str
    evidence: list[Evidence] = field(default_factory=list[Evidence])
    incident_selection: IncidentSelection | None = None
    incident_comparison: IncidentComparison | None = None

    def to_request(self) -> ReasoningRequest:
        return ReasoningRequest(
            stage=self.stage,
            instruction=self.instruction,
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
