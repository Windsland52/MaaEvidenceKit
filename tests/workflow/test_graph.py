from __future__ import annotations

import asyncio
from pathlib import Path
from typing import cast

from pydantic import JsonValue

from maa_diagnostic_expert.contracts.domain import (
    AnalysisRequest,
    ArtifactInput,
    ArtifactKind,
    Conclusion,
    ContractModel,
    DiagnosisDraft,
    DiagnosisStatus,
    DiagnosticEvent,
    DiagnosticEventKind,
)
from maa_diagnostic_expert.reasoning.prompts import StubReasoningBackend
from maa_diagnostic_expert.reasoning.protocol import ReasoningContext
from maa_diagnostic_expert.workflow.graph import DiagnosticWorkflow


def _supported_preflight() -> dict[str, JsonValue]:
    return {
        "schema_version": "mde-mla-preflight/v1",
        "mla_schema_version": "mla-preflight/v1",
        "compatibility": {
            "status": "supported",
            "reason": "notify_events_parsed",
            "parser_version": "test-parser",
            "task_count": 1,
            "event_count": 3,
            "node_statistic_count": 1,
            "recognition_statistic_count": 0,
        },
        "framework": {
            "status": "single",
            "versions": ["v5.11.1"],
            "sessions": [],
        },
        "warnings": [],
    }


def _empty_runtime_inspection() -> dict[str, JsonValue]:
    return {
        "schema_version": "mla-runtime-inspection/v1",
        "sessions": [],
        "unscoped_tasks": [],
        "failures": [],
        "outcomes": [],
        "signals": [],
        "warnings": [],
    }


def _runtime_with_failure() -> dict[str, JsonValue]:
    base = _empty_runtime_inspection()
    base["failures"] = [
        {
            "session_id": "s1",
            "execution_id": "exec-1",
            "task_id": 1,
            "task_name": "LoginTask",
            "failure_id": "fail-1",
            "kind": "next_list_timeout",
            "node_id": 10,
            "node_name": "LoginButton",
            "started_at": "2024-01-01T00:00:00Z",
            "ended_at": "2024-01-01T00:00:05Z",
            "error_images": [],
            "vision_images": [],
            "evidence": {
                "path": "maafw.log",
                "local_line": 100,
                "timestamp": "2024-01-01T00:00:00Z",
                "source": "maafw.log",
            },
        }
    ]
    return base


class _ToolCaller:
    def __init__(
        self,
        preflight: dict[str, JsonValue] | None = None,
        runtime: dict[str, JsonValue] | None = None,
    ) -> None:
        self._preflight = preflight if preflight is not None else _supported_preflight()
        self._runtime = runtime if runtime is not None else _empty_runtime_inspection()
        self.calls: list[tuple[str, dict[str, JsonValue]]] = []

    def call(self, name: str, arguments: dict[str, JsonValue]) -> dict[str, JsonValue]:
        self.calls.append((name, arguments))
        if name == "mla.runtime-inspection":
            return self._runtime
        return self._preflight


class _InventingReasoningSession:
    async def reason[ResultT: ContractModel](
        self, context: ReasoningContext, result_type: type[ResultT]
    ) -> ResultT:
        del context, result_type
        return cast(
            ResultT,
            DiagnosisDraft(
                status=DiagnosisStatus.COMPLETE,
                summary="Invented diagnosis.",
                conclusions=[
                    Conclusion(
                        statement="Invented conclusion.",
                        evidence_ids=["ev:invented"],
                        confidence=1,
                    )
                ],
            ),
        )

    async def close(self) -> None:
        pass


class _InventingReasoningBackend:
    async def start(self, *, run_id: str) -> _InventingReasoningSession:
        del run_id
        return _InventingReasoningSession()


class _FailingReasoningBackend:
    async def start(self, *, run_id: str) -> _InventingReasoningSession:
        del run_id
        raise RuntimeError("model unavailable")


def _make_directory_with_log(tmp_path: Path) -> Path:
    debug_path = tmp_path / "debug"
    debug_path.mkdir()
    (debug_path / "maafw.log").write_text("log content", encoding="utf-8")
    return debug_path


def _request(path: Path) -> AnalysisRequest:
    return AnalysisRequest(
        question="Diagnose the log.",
        artifacts=[ArtifactInput(path=path, kind=ArtifactKind.DIRECTORY)],
    )


def _collect_events(
    workflow: DiagnosticWorkflow, request: AnalysisRequest
) -> list[DiagnosticEvent]:
    async def _collect() -> list[DiagnosticEvent]:
        return [event async for event in workflow.stream(request)]

    return asyncio.run(_collect())


def test_diagnose_produces_complete_result_with_failure(tmp_path: Path) -> None:
    debug_path = _make_directory_with_log(tmp_path)
    caller = _ToolCaller(runtime=_runtime_with_failure())
    workflow = DiagnosticWorkflow(caller, StubReasoningBackend())

    result = asyncio.run(workflow.diagnose(_request(debug_path)))

    assert result.status is DiagnosisStatus.COMPLETE
    assert len(result.conclusions) == 1
    conclusion = result.conclusions[0]
    evidence_ids = {e.id for e in result.evidence}
    assert set(conclusion.evidence_ids).issubset(evidence_ids)


def test_diagnose_returns_insufficient_without_failures(tmp_path: Path) -> None:
    debug_path = _make_directory_with_log(tmp_path)
    caller = _ToolCaller(runtime=_empty_runtime_inspection())
    workflow = DiagnosticWorkflow(caller, StubReasoningBackend())

    result = asyncio.run(workflow.diagnose(_request(debug_path)))

    assert result.status is DiagnosisStatus.INSUFFICIENT_EVIDENCE
    assert result.conclusions == []


def test_workflow_rejects_model_invented_evidence_ids(tmp_path: Path) -> None:
    debug_path = _make_directory_with_log(tmp_path)
    caller = _ToolCaller(runtime=_runtime_with_failure())
    workflow = DiagnosticWorkflow(caller, _InventingReasoningBackend())

    events = _collect_events(workflow, _request(debug_path))

    assert events[-1].kind is DiagnosticEventKind.RUN_FAILED
    assert events[-1].stage == "validate"
    assert workflow.result is not None
    assert workflow.result.status is DiagnosisStatus.FAILED
    assert "unknown evidence IDs" in workflow.result.summary


def test_workflow_routes_reasoning_errors_to_failed_result(tmp_path: Path) -> None:
    debug_path = _make_directory_with_log(tmp_path)
    caller = _ToolCaller(runtime=_runtime_with_failure())
    workflow = DiagnosticWorkflow(caller, _FailingReasoningBackend())

    events = _collect_events(workflow, _request(debug_path))

    assert events[-1].kind is DiagnosticEventKind.RUN_FAILED
    assert events[-1].stage == "reason"
    assert workflow.result is not None
    assert workflow.result.status is DiagnosisStatus.FAILED
    assert workflow.result.evidence
    assert "model unavailable" in workflow.result.summary


def test_stream_emits_events_in_order(tmp_path: Path) -> None:
    debug_path = _make_directory_with_log(tmp_path)
    caller = _ToolCaller(runtime=_runtime_with_failure())
    workflow = DiagnosticWorkflow(caller, StubReasoningBackend())

    events = _collect_events(workflow, _request(debug_path))

    kinds = [event.kind for event in events]
    completed_stages = [
        event.stage for event in events if event.kind is DiagnosticEventKind.STAGE_COMPLETED
    ]
    assert kinds[0] is DiagnosticEventKind.RUN_STARTED
    assert DiagnosticEventKind.STAGE_STARTED in kinds
    assert DiagnosticEventKind.STAGE_COMPLETED in kinds
    assert DiagnosticEventKind.MODEL_REQUESTED in kinds
    assert DiagnosticEventKind.MODEL_COMPLETED in kinds
    assert completed_stages == [
        "prepare",
        "classify_artifacts",
        "plan_overview",
        "inspect",
        "identify_runtime",
        "synthesize",
        "identify_incident",
        "validate",
    ]
    assert kinds[-1] is DiagnosticEventKind.RUN_COMPLETED
    assert workflow.result is not None
    assert workflow.result.status is DiagnosisStatus.COMPLETE


def test_workflow_records_missing_evidence_when_adapter_fails(tmp_path: Path) -> None:
    from maa_diagnostic_expert.interfaces.tool_adapter import ToolAdapterInvocationError

    class _FailingCaller:
        def call(self, name: str, arguments: dict[str, JsonValue]) -> dict[str, JsonValue]:
            raise ToolAdapterInvocationError("adapter unavailable")

    debug_path = _make_directory_with_log(tmp_path)
    workflow = DiagnosticWorkflow(_FailingCaller(), StubReasoningBackend())

    events = _collect_events(workflow, _request(debug_path))
    kinds = [event.kind for event in events]

    assert kinds[-1] is DiagnosticEventKind.RUN_COMPLETED
    assert workflow.result is not None
    assert workflow.result.status is DiagnosisStatus.INSUFFICIENT_EVIDENCE
    assert "mla_preflight_failed" in workflow.result.missing_evidence


def test_cancel_before_inspection_produces_failed(tmp_path: Path) -> None:
    debug_path = _make_directory_with_log(tmp_path)
    caller = _ToolCaller(runtime=_runtime_with_failure())
    workflow = DiagnosticWorkflow(caller, StubReasoningBackend())

    asyncio.run(workflow.cancel(workflow.run_id))

    result = asyncio.run(workflow.diagnose(_request(debug_path)))

    assert result.status is DiagnosisStatus.FAILED


def test_run_id_is_deterministic_when_provided(tmp_path: Path) -> None:
    debug_path = _make_directory_with_log(tmp_path)
    caller = _ToolCaller(runtime=_runtime_with_failure())
    workflow = DiagnosticWorkflow(caller, StubReasoningBackend(), run_id="fixed-run-id")

    assert workflow.run_id == "fixed-run-id"

    events = _collect_events(workflow, _request(debug_path))
    assert all(event.run_id == "fixed-run-id" for event in events)


def test_workflow_skips_mla_when_only_image_is_supplied(tmp_path: Path) -> None:
    image = tmp_path / "on_error.png"
    image.write_bytes(b"image")
    caller = _ToolCaller()
    workflow = DiagnosticWorkflow(caller, StubReasoningBackend())
    request = AnalysisRequest(
        question="Inspect the failure screenshot.",
        artifacts=[ArtifactInput(path=image, kind=ArtifactKind.FILE)],
    )

    events = _collect_events(workflow, request)

    assert caller.calls == []
    assert any(event.stage == "inspect" and "skipped" in event.message for event in events)
    assert workflow.result is not None
    assert workflow.result.status is DiagnosisStatus.INSUFFICIENT_EVIDENCE


def test_workflow_does_not_send_custom_log_to_mla(tmp_path: Path) -> None:
    custom = tmp_path / "custom"
    custom.mkdir()
    log = custom / "agent.log"
    log.write_text("custom agent event\n", encoding="utf-8")
    caller = _ToolCaller()
    workflow = DiagnosticWorkflow(caller, StubReasoningBackend())
    request = AnalysisRequest(
        question="Inspect the custom agent failure.",
        artifacts=[ArtifactInput(path=log, kind=ArtifactKind.FILE)],
    )

    events = _collect_events(workflow, request)

    assert caller.calls == []
    assert any(
        event.stage == "classify_artifacts" and event.data["custom"] == 1 for event in events
    )
    assert any(event.stage == "overview_logs" for event in events)
    assert any(event.stage == "synthesize" and event.data.get("evidence") == 1 for event in events)
