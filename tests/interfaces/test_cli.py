from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator
from datetime import UTC, datetime
from pathlib import Path
from typing import cast

import pytest

from maa_diagnostic_expert.contracts.domain import (
    AnalysisRequest,
    DiagnosisResult,
    DiagnosisStatus,
    DiagnosticEvent,
    DiagnosticEventKind,
)
from maa_diagnostic_expert.contracts.workflow import (
    FixCandidatePlan,
    FixPlanningStatus,
    VerificationPlanningStatus,
    VerificationPlanSet,
)
from maa_diagnostic_expert.inspection.tooling import ToolCaller
from maa_diagnostic_expert.interfaces import cli
from maa_diagnostic_expert.interfaces.cli import build_parser, main, stream_to_file
from maa_diagnostic_expert.reasoning.protocol import ReasoningBackend
from maa_diagnostic_expert.workflow.graph import DiagnosticWorkflow


class _PausingWorkflow:
    def __init__(self) -> None:
        self.paused = asyncio.Event()
        self.release = asyncio.Event()
        self.result: DiagnosisResult | None = None

    def stream(self, request: AnalysisRequest) -> AsyncIterator[DiagnosticEvent]:
        del request
        return self._events()

    async def _events(self) -> AsyncIterator[DiagnosticEvent]:
        yield DiagnosticEvent(
            run_id="run-flush",
            sequence=0,
            occurred_at=datetime.now(UTC),
            kind=DiagnosticEventKind.RUN_STARTED,
            stage="workflow",
            message="Started diagnostic workflow",
        )
        self.paused.set()
        await self.release.wait()
        self.result = DiagnosisResult(
            status=DiagnosisStatus.INSUFFICIENT_EVIDENCE,
            summary="No evidence was supplied.",
        )


class _FailedWorkflow:
    fix_candidate_plan = None
    verification_plan_set = None

    async def diagnose(self, request: AnalysisRequest) -> DiagnosisResult:
        del request
        return DiagnosisResult(
            status=DiagnosisStatus.FAILED,
            summary="Workflow failed at the original diagnostic stage.",
        )


def _failed_workflow_factory(
    *,
    tool_caller: ToolCaller,
    reasoning_backend: ReasoningBackend,
) -> _FailedWorkflow:
    del tool_caller, reasoning_backend
    return _FailedWorkflow()


def test_diagnose_accepts_separate_fix_plan_output() -> None:
    args = build_parser().parse_args(
        [
            "diagnose",
            "--request",
            "request.json",
            "--fix-plan",
            "fix-plan.json",
        ]
    )

    assert args.command == "diagnose"
    assert args.request == Path("request.json")
    assert args.fix_plan == Path("fix-plan.json")


def test_event_stream_flushes_each_event_while_workflow_is_running(tmp_path: Path) -> None:
    async def run_test() -> None:
        workflow = _PausingWorkflow()
        events_path = tmp_path / "events.jsonl"
        task = asyncio.create_task(
            stream_to_file(
                cast(DiagnosticWorkflow, workflow),
                AnalysisRequest(question="Inspect the failure."),
                events_path,
            )
        )

        await workflow.paused.wait()
        assert "Started diagnostic workflow" in events_path.read_text(encoding="utf-8")
        workflow.release.set()
        result = await task
        assert result.status is DiagnosisStatus.INSUFFICIENT_EVIDENCE

    asyncio.run(run_test())


def test_diagnose_writes_fix_plan_output(tmp_path: Path) -> None:
    request_path = tmp_path / "request.json"
    diagnosis_path = tmp_path / "diagnosis.json"
    fix_plan_path = tmp_path / "fix-plan.json"
    verification_plan_path = tmp_path / "verification-plan.json"
    request_path.write_text(
        AnalysisRequest(question="Diagnose without artifacts.").model_dump_json(),
        encoding="utf-8",
    )

    exit_code = main(
        [
            "diagnose",
            "--request",
            str(request_path),
            "--fix-plan",
            str(fix_plan_path),
            "--verification-plan",
            str(verification_plan_path),
            "--output",
            str(diagnosis_path),
        ]
    )

    diagnosis = DiagnosisResult.model_validate_json(diagnosis_path.read_text(encoding="utf-8"))
    fix_plan = FixCandidatePlan.model_validate_json(fix_plan_path.read_text(encoding="utf-8"))
    verification_plan = VerificationPlanSet.model_validate_json(
        verification_plan_path.read_text(encoding="utf-8")
    )
    assert exit_code == 0
    assert diagnosis.summary
    assert fix_plan.status is FixPlanningStatus.SKIP
    assert verification_plan.status is VerificationPlanningStatus.SKIP


def test_failed_diagnosis_is_not_hidden_by_missing_optional_plans(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    request_path = tmp_path / "request.json"
    diagnosis_path = tmp_path / "diagnosis.json"
    fix_plan_path = tmp_path / "fix-plan.json"
    verification_plan_path = tmp_path / "verification-plan.json"
    request_path.write_text(
        AnalysisRequest(question="Diagnose the failure.").model_dump_json(),
        encoding="utf-8",
    )
    monkeypatch.setattr(cli, "DiagnosticWorkflow", _failed_workflow_factory)

    exit_code = main(
        [
            "diagnose",
            "--request",
            str(request_path),
            "--fix-plan",
            str(fix_plan_path),
            "--verification-plan",
            str(verification_plan_path),
            "--output",
            str(diagnosis_path),
        ]
    )

    diagnosis = DiagnosisResult.model_validate_json(diagnosis_path.read_text(encoding="utf-8"))
    assert exit_code == 0
    assert diagnosis.status is DiagnosisStatus.FAILED
    assert not fix_plan_path.exists()
    assert not verification_plan_path.exists()
