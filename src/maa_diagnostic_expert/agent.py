from collections.abc import AsyncIterator
from typing import Protocol

from .domain import (
    AnalysisRequest,
    ContractModel,
    DiagnosisResult,
    DiagnosticEvent,
    ReasoningRequest,
)


class DiagnosticAgent(Protocol):
    """Framework-independent public interface implemented by the future LangGraph runtime."""

    async def diagnose(self, request: AnalysisRequest) -> DiagnosisResult: ...

    def stream(self, request: AnalysisRequest) -> AsyncIterator[DiagnosticEvent]: ...

    async def cancel(self, run_id: str) -> None: ...


class ReasoningSession(Protocol):
    """Model-facing session controlled by the Python diagnostic workflow."""

    async def reason[ResultT: ContractModel](
        self, request: ReasoningRequest, result_type: type[ResultT]
    ) -> ResultT: ...

    async def close(self) -> None: ...


class ReasoningBackend(Protocol):
    """Creates reasoning sessions without owning diagnostic workflow policy."""

    async def start(self, *, run_id: str) -> ReasoningSession: ...
