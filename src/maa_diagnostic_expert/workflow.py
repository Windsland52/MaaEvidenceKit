from __future__ import annotations

import secrets
from collections.abc import AsyncIterator
from dataclasses import dataclass, field
from datetime import UTC, datetime

from .agent import ReasoningBackend, ReasoningContext
from .domain import (
    AnalysisRequest,
    DiagnosisResult,
    DiagnosisStatus,
    DiagnosticEvent,
    DiagnosticEventKind,
    Evidence,
    JsonValue,
)
from .inspection import DeterministicInspection, ToolCaller, inspect_analysis
from .reasoning import build_reasoning_context

_DEFAULT_QUESTION = "Diagnose the runtime failures and their likely causes."


def _new_run_id() -> str:
    return secrets.token_hex(8)


def _assemble_evidence(inspection: DeterministicInspection) -> list[Evidence]:
    """Merge prepared and synthesized evidence, deduplicated by ID."""
    seen: set[str] = set()
    evidence: list[Evidence] = []
    for item in inspection.prepared.evidence:
        if item.id not in seen:
            seen.add(item.id)
            evidence.append(item)
    for item in inspection.synthesized_evidence:
        if item.id not in seen:
            seen.add(item.id)
            evidence.append(item)
    return evidence


def _finalize_result(
    result: DiagnosisResult,
    evidence: list[Evidence],
    inspection: DeterministicInspection,
) -> DiagnosisResult:
    """Attach available evidence and missing-evidence codes to the model result.

    Reconstructs the DiagnosisResult so the evidence-reference validator runs.
    """
    store = {item.id: item for item in evidence}
    merged = {item.id: item for item in result.evidence}
    referenced = {
        evidence_id for conclusion in result.conclusions for evidence_id in conclusion.evidence_ids
    }
    for evidence_id in referenced:
        if evidence_id not in merged and evidence_id in store:
            merged[evidence_id] = store[evidence_id]
    missing_codes = [item.code for item in inspection.prepared.missing_evidence]
    combined_missing = list(dict.fromkeys([*result.missing_evidence, *missing_codes]))
    return DiagnosisResult(
        status=result.status,
        summary=result.summary,
        evidence=list(merged.values()),
        conclusions=result.conclusions,
        missing_evidence=combined_missing,
    )


@dataclass
class DiagnosticWorkflow:
    """Orchestrates the end-to-end diagnostic pipeline.

    The pipeline runs: prepare -> inspect -> synthesize evidence ->
    reason -> validate. Deterministic stages (prepare, inspect, synthesize)
    run synchronously; the reasoning stage is delegated to a pluggable
    ReasoningBackend so the workflow stays model-agnostic.

    After a run completes (via ``diagnose`` or by exhausting ``stream``),
    the produced result is available through the ``result`` property.
    """

    tool_caller: ToolCaller
    reasoning_backend: ReasoningBackend
    run_id: str = field(default_factory=_new_run_id)
    _cancelled: set[str] = field(default_factory=set[str], init=False, repr=False)
    _result: DiagnosisResult | None = field(default=None, init=False, repr=False)

    @property
    def result(self) -> DiagnosisResult | None:
        """Result produced by the most recent run, or None if not finished."""
        return self._result

    async def cancel(self, run_id: str) -> None:
        self._cancelled.add(run_id)

    async def diagnose(self, request: AnalysisRequest) -> DiagnosisResult:
        self._result = None
        async for _ in self._run(request):
            pass
        if self._result is None:
            raise RuntimeError("diagnostic workflow did not produce a result")
        return self._result

    def stream(self, request: AnalysisRequest) -> AsyncIterator[DiagnosticEvent]:
        self._result = None
        return self._run(request)

    async def _run(self, request: AnalysisRequest) -> AsyncIterator[DiagnosticEvent]:
        sequence = 0

        def emit(
            kind: DiagnosticEventKind,
            stage: str,
            message: str,
            data: dict[str, JsonValue] | None = None,
        ) -> DiagnosticEvent:
            nonlocal sequence
            event = DiagnosticEvent(
                run_id=self.run_id,
                sequence=sequence,
                occurred_at=datetime.now(UTC),
                kind=kind,
                stage=stage,
                message=message,
                data=data or {},
            )
            sequence += 1
            return event

        yield emit(
            DiagnosticEventKind.RUN_STARTED,
            "workflow",
            "Started diagnostic workflow",
            {"run_id": self.run_id},
        )

        evidence: list[Evidence] = []
        inspection: DeterministicInspection | None = None
        try:
            if self.run_id in self._cancelled:
                raise RuntimeError("workflow cancelled before inspection")

            yield emit(
                DiagnosticEventKind.STAGE_STARTED,
                "inspect",
                "Running deterministic inspection",
            )
            inspection = inspect_analysis(request, self.tool_caller)
            evidence = _assemble_evidence(inspection)
            yield emit(
                DiagnosticEventKind.STAGE_COMPLETED,
                "inspect",
                "Deterministic inspection complete",
                {
                    "artifacts": len(inspection.mla_runtime_inspections),
                    "evidence": len(evidence),
                    "missing": len(inspection.prepared.missing_evidence),
                },
            )
            if evidence:
                yield emit(
                    DiagnosticEventKind.EVIDENCE_ADDED,
                    "inspect",
                    f"Synthesized {len(evidence)} evidence items",
                    {"count": len(evidence)},
                )

            if self.run_id in self._cancelled:
                raise RuntimeError("workflow cancelled before reasoning")

            question = request.question or _DEFAULT_QUESTION
            context: ReasoningContext = build_reasoning_context(question, evidence)

            yield emit(
                DiagnosticEventKind.MODEL_REQUESTED,
                "reason",
                "Requesting diagnostic reasoning",
                {"evidence_count": len(evidence)},
            )
            session = await self.reasoning_backend.start(run_id=self.run_id)
            try:
                result = await session.reason(context, DiagnosisResult)
            finally:
                await session.close()
            yield emit(
                DiagnosticEventKind.MODEL_COMPLETED,
                "reason",
                "Diagnostic reasoning complete",
                {"conclusions": len(result.conclusions)},
            )

            final = _finalize_result(result, evidence, inspection)
            self._result = final
            yield emit(
                DiagnosticEventKind.RUN_COMPLETED,
                "workflow",
                "Diagnostic workflow complete",
                {
                    "status": final.status.value,
                    "conclusions": len(final.conclusions),
                    "evidence": len(final.evidence),
                },
            )
        except Exception as error:  # noqa: BLE001
            message = f"Workflow failed: {error}"
            stage = "reason" if inspection is not None else "inspect"
            self._result = DiagnosisResult(
                status=DiagnosisStatus.FAILED,
                summary=message,
                evidence=evidence,
                conclusions=[],
            )
            yield emit(
                DiagnosticEventKind.RUN_FAILED,
                stage,
                message,
                {"error_type": type(error).__name__},
            )
