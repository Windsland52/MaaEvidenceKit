from __future__ import annotations

import asyncio
import sys
from pathlib import Path

import pytest
from pydantic import ValidationError

from maa_diagnostic_expert.contracts.command import (
    CommandApprovalDecision,
    CommandApprovalOutcome,
    CommandApprovalResponse,
    CommandApprovalStatus,
    CommandExecutionStatus,
    CommandToolMode,
    ProcessCommandRequest,
)
from maa_diagnostic_expert.reasoning.tools.command import (
    CommandExecutor,
    CommandExecutorConfig,
)
from maa_diagnostic_expert.workflow.command_approval import CommandApprovalWorkflow


def _executor(tmp_path: Path, mode: CommandToolMode) -> CommandExecutor:
    return CommandExecutor(
        CommandExecutorConfig(
            mode=mode,
            allowed_roots=(tmp_path,),
            output_directory=tmp_path / "command-output",
        )
    )


def _python_request(tmp_path: Path, script: str) -> ProcessCommandRequest:
    return ProcessCommandRequest(
        executable=sys.executable,
        arguments=["-c", script],
        cwd=tmp_path,
    )


def test_trusted_command_finishes_without_approval(tmp_path: Path) -> None:
    workflow = CommandApprovalWorkflow(_executor(tmp_path, CommandToolMode.TRUSTED))

    outcome = asyncio.run(workflow.submit(_python_request(tmp_path, "print('trusted-ok')")))

    assert outcome.status is CommandApprovalStatus.FINISHED
    assert outcome.approval is None
    assert outcome.response is None
    assert outcome.execution is not None
    assert outcome.execution.status is CommandExecutionStatus.COMPLETED
    assert outcome.execution.stdout_preview == "trusted-ok"
    assert not outcome.execution.approved


def test_safe_command_pauses_and_replays_exact_request_after_approval(
    tmp_path: Path,
) -> None:
    workflow = CommandApprovalWorkflow(_executor(tmp_path, CommandToolMode.SAFE))
    request = _python_request(tmp_path, "print('approved-ok')")

    pending = asyncio.run(workflow.submit(request))

    assert pending.status is CommandApprovalStatus.AWAITING_APPROVAL
    assert pending.approval is not None
    assert pending.approval.pending_execution.request == request
    assert pending.approval.pending_execution.status is CommandExecutionStatus.APPROVAL_REQUIRED
    finished = asyncio.run(
        workflow.resume(
            CommandApprovalResponse(
                approval_id=pending.approval_id,
                decision=CommandApprovalDecision.APPROVE,
            )
        )
    )

    assert finished.status is CommandApprovalStatus.FINISHED
    assert finished.approval == pending.approval
    assert finished.response is not None
    assert finished.execution is not None
    assert finished.execution.request == request
    assert finished.execution.status is CommandExecutionStatus.COMPLETED
    assert finished.execution.stdout_preview == "approved-ok"
    assert finished.execution.approved


def test_rejection_resumes_without_executing_command(tmp_path: Path) -> None:
    marker = tmp_path / "should-not-exist.txt"
    workflow = CommandApprovalWorkflow(_executor(tmp_path, CommandToolMode.SAFE))
    request = _python_request(
        tmp_path,
        "from pathlib import Path; Path('should-not-exist.txt').write_text('ran')",
    )
    pending = asyncio.run(workflow.submit(request))

    rejected = asyncio.run(
        workflow.resume(
            CommandApprovalResponse(
                approval_id=pending.approval_id,
                decision=CommandApprovalDecision.REJECT,
                reason="The command is unnecessary.",
            )
        )
    )

    assert rejected.status is CommandApprovalStatus.REJECTED
    assert rejected.response is not None
    assert rejected.response.reason == "The command is unnecessary."
    assert rejected.execution is None
    assert not marker.exists()


def test_disabled_command_finishes_as_denied_without_approval(tmp_path: Path) -> None:
    workflow = CommandApprovalWorkflow(_executor(tmp_path, CommandToolMode.DISABLED))

    outcome = asyncio.run(workflow.submit(_python_request(tmp_path, "print('never')")))

    assert outcome.status is CommandApprovalStatus.FINISHED
    assert outcome.approval is None
    assert outcome.execution is not None
    assert outcome.execution.status is CommandExecutionStatus.DENIED


def test_completed_approval_cannot_be_resumed_twice(tmp_path: Path) -> None:
    workflow = CommandApprovalWorkflow(_executor(tmp_path, CommandToolMode.SAFE))
    pending = asyncio.run(workflow.submit(_python_request(tmp_path, "print('once')")))
    response = CommandApprovalResponse(
        approval_id=pending.approval_id,
        decision=CommandApprovalDecision.REJECT,
    )
    asyncio.run(workflow.resume(response))

    with pytest.raises(ValueError, match="No command approval is pending"):
        asyncio.run(workflow.resume(response))


def test_approval_outcome_rejects_mismatched_response_id(tmp_path: Path) -> None:
    workflow = CommandApprovalWorkflow(_executor(tmp_path, CommandToolMode.SAFE))
    pending = asyncio.run(workflow.submit(_python_request(tmp_path, "print('pending')")))
    assert pending.approval is not None

    with pytest.raises(ValidationError, match="response ID must match"):
        CommandApprovalOutcome(
            approval_id=pending.approval_id,
            status=CommandApprovalStatus.REJECTED,
            approval=pending.approval,
            response=CommandApprovalResponse(
                approval_id="different",
                decision=CommandApprovalDecision.REJECT,
            ),
        )


def test_approval_response_cannot_replace_pending_command(tmp_path: Path) -> None:
    workflow = CommandApprovalWorkflow(_executor(tmp_path, CommandToolMode.SAFE))
    pending = asyncio.run(workflow.submit(_python_request(tmp_path, "print('original')")))

    response_fields = CommandApprovalResponse.model_json_schema()["properties"]

    assert "request" not in response_fields
    assert "command" not in response_fields
    assert pending.approval is not None
    pending_request = pending.approval.pending_execution.request
    assert isinstance(pending_request, ProcessCommandRequest)
    assert pending_request.arguments[-1] == "print('original')"
