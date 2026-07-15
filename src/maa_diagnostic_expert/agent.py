from collections.abc import AsyncIterator
from typing import Protocol

from .domain import AnalysisRequest, DiagnosisResult


class DiagnosticEvent(Protocol):
    """Marker protocol for future streamed diagnostic lifecycle events."""


class DiagnosticAgent(Protocol):
    """Framework-independent public interface implemented by the future LangGraph runtime."""

    async def diagnose(self, request: AnalysisRequest) -> DiagnosisResult: ...

    def stream(self, request: AnalysisRequest) -> AsyncIterator[DiagnosticEvent]: ...

    async def cancel(self, run_id: str) -> None: ...
