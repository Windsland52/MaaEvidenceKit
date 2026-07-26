from __future__ import annotations

import asyncio
import sys
from pathlib import Path
from typing import cast

import pytest
from pydantic import ValidationError

from maa_diagnostic_expert.contracts.command import (
    CommandApprovalDecision,
    CommandApprovalResponse,
    CommandExecutionStatus,
    CommandToolMode,
    ProcessCommandRequest,
)
from maa_diagnostic_expert.contracts.domain import ContractModel, Evidence, EvidenceRole
from maa_diagnostic_expert.contracts.workflow import (
    FixCandidate,
    FixCandidatePlan,
    FixExecutionRequest,
    FixExecutionStatus,
    FixFileSnapshot,
    FixFileState,
    FixMethod,
    FixPlanningStatus,
    FixScope,
    VerificationMethod,
    VerificationPlan,
    VerificationPlanningStatus,
    VerificationPlanSet,
)
from maa_diagnostic_expert.reasoning.protocol import ReasoningContext
from maa_diagnostic_expert.reasoning.tools.command import (
    CommandExecutor,
    CommandExecutorConfig,
)
from maa_diagnostic_expert.workflow.command_approval import CommandApprovalWorkflow
from maa_diagnostic_expert.workflow.fix_execution import FixExecutionWorkflow


def _fixes() -> FixCandidatePlan:
    return FixCandidatePlan(
        status=FixPlanningStatus.PROPOSED,
        rationale="A focused project change is supported.",
        candidates=[
            FixCandidate(
                fix_id="fix-1",
                target="config.txt",
                scope=FixScope.PROJECT,
                method=FixMethod.CONFIGURATION,
                rationale="Replace only the failing setting.",
                evidence_ids=["ev:failure"],
                regression_risks=["The adjacent setting could regress."],
                verification_steps=["Read the updated setting and replay the task."],
            )
        ],
    )


def _verification() -> VerificationPlanSet:
    return VerificationPlanSet(
        status=VerificationPlanningStatus.PLANNED,
        rationale="Verify both the setting and user-visible task outcome.",
        plans=[
            VerificationPlan(
                fix_id="fix-1",
                methods=[
                    VerificationMethod.STATIC_CONFIGURATION,
                    VerificationMethod.RUNTIME_EXECUTION,
                ],
                steps=["Read config.txt.", "Replay the affected task."],
                business_milestones=["The affected task reaches its completion milestone."],
                regression_checks=["The adjacent setting still behaves as before."],
            )
        ],
    )


def _request(tmp_path: Path, script: str, *, fix_id: str = "fix-1") -> FixExecutionRequest:
    return FixExecutionRequest(
        fix_id=fix_id,
        command=ProcessCommandRequest(
            executable=sys.executable,
            arguments=["-c", script],
            cwd=tmp_path,
        ),
        rationale="Apply only the selected configuration repair.",
        expected_changed_paths=["config.txt"],
    )


def _command_workflow(tmp_path: Path) -> CommandApprovalWorkflow:
    executor = CommandExecutor(
        CommandExecutorConfig(
            mode=CommandToolMode.TRUSTED,
            allowed_roots=(tmp_path,),
            output_directory=tmp_path / "command-output",
        )
    )
    return CommandApprovalWorkflow(executor)


class _FixExecutionSession:
    def __init__(self, request: FixExecutionRequest, contexts: list[ReasoningContext]) -> None:
        self.request = request
        self.contexts = contexts

    async def reason[ResultT: ContractModel](
        self,
        context: ReasoningContext,
        result_type: type[ResultT],
    ) -> ResultT:
        self.contexts.append(context)
        if result_type is not FixExecutionRequest:
            raise TypeError(result_type.__name__)
        return cast(ResultT, self.request)

    async def close(self) -> None:
        pass


class _FixExecutionBackend:
    def __init__(self, request: FixExecutionRequest) -> None:
        self.request = request
        self.contexts: list[ReasoningContext] = []

    async def start(self, *, run_id: str) -> _FixExecutionSession:
        del run_id
        return _FixExecutionSession(self.request, self.contexts)


def test_model_planned_fix_waits_for_exact_explicit_approval(tmp_path: Path) -> None:
    marker = tmp_path / "config.txt"
    request = _request(
        tmp_path,
        "from pathlib import Path; Path('config.txt').write_text('fixed')",
    )
    backend = _FixExecutionBackend(request)
    workflow = FixExecutionWorkflow(_command_workflow(tmp_path), backend)
    evidence = [
        Evidence(
            id="ev:failure",
            kind="runtime_failure",
            source_component="test",
            source_path="agent.log",
            content="setting failed",
            role=EvidenceRole.FAILURE,
        )
    ]

    pending = asyncio.run(
        workflow.plan_and_submit(
            run_id="run-fix",
            reported_context="The selected task failed.",
            evidence=evidence,
            fixes=_fixes(),
            verification=_verification(),
            fix_id="fix-1",
        )
    )

    assert pending.status is FixExecutionStatus.AWAITING_APPROVAL
    assert not marker.exists()
    [pending_change] = pending.file_changes
    assert pending_change.before.state.value == "missing"
    assert pending_change.after is None
    assert pending.command_outcome.approval is not None
    assert (
        pending.command_outcome.approval.pending_execution.policy.matched_rule
        == "workflow:explicit-approval"
    )
    assert backend.contexts[0].stage == "plan_fix_execution"
    assert "Never include or infer an approval flag" in backend.contexts[0].instruction

    completed = asyncio.run(
        workflow.resume(
            CommandApprovalResponse(
                approval_id=pending.command_outcome.approval_id,
                decision=CommandApprovalDecision.APPROVE,
            )
        )
    )

    assert completed.status is FixExecutionStatus.COMMAND_COMPLETED
    assert marker.read_text(encoding="utf-8") == "fixed"
    assert completed.command_outcome.execution is not None
    assert completed.command_outcome.execution.request == request.command
    assert completed.command_outcome.execution.approved
    [completed_change] = completed.file_changes
    assert completed_change.changed is True
    assert completed_change.after is not None
    assert completed_change.after.content_preview == "fixed"


def test_rejected_fix_execution_has_no_side_effect(tmp_path: Path) -> None:
    marker = tmp_path / "config.txt"
    workflow = FixExecutionWorkflow(_command_workflow(tmp_path))
    pending = asyncio.run(
        workflow.submit(
            _request(
                tmp_path,
                "from pathlib import Path; Path('config.txt').write_text('unexpected')",
            ),
            fixes=_fixes(),
            verification=_verification(),
        )
    )

    rejected = asyncio.run(
        workflow.resume(
            CommandApprovalResponse(
                approval_id=pending.command_outcome.approval_id,
                decision=CommandApprovalDecision.REJECT,
                reason="Do not change this checkout.",
            )
        )
    )

    assert rejected.status is FixExecutionStatus.REJECTED
    assert rejected.command_outcome.execution is None
    assert not marker.exists()


def test_nonzero_command_is_not_reported_as_completed_fix(tmp_path: Path) -> None:
    workflow = FixExecutionWorkflow(_command_workflow(tmp_path))
    pending = asyncio.run(
        workflow.submit(
            _request(tmp_path, "raise SystemExit(7)"),
            fixes=_fixes(),
            verification=_verification(),
        )
    )

    failed = asyncio.run(
        workflow.resume(
            CommandApprovalResponse(
                approval_id=pending.command_outcome.approval_id,
                decision=CommandApprovalDecision.APPROVE,
            )
        )
    )

    assert failed.status is FixExecutionStatus.COMMAND_FAILED
    assert failed.command_outcome.execution is not None
    assert failed.command_outcome.execution.status is CommandExecutionStatus.FAILED


def test_fix_execution_requires_known_selected_fix(tmp_path: Path) -> None:
    workflow = FixExecutionWorkflow(_command_workflow(tmp_path))

    with pytest.raises(ValueError, match="Unknown selected fix ID"):
        asyncio.run(
            workflow.submit(
                _request(tmp_path, "print('no-op')", fix_id="fix-invented"),
                fixes=_fixes(),
                verification=_verification(),
            )
        )


def test_model_cannot_change_explicitly_selected_fix_id(tmp_path: Path) -> None:
    backend = _FixExecutionBackend(
        _request(tmp_path, "print('not submitted')", fix_id="fix-invented")
    )
    workflow = FixExecutionWorkflow(_command_workflow(tmp_path), backend)

    with pytest.raises(ValueError, match="changed the selected fix ID"):
        asyncio.run(
            workflow.plan_and_submit(
                run_id="run-fix",
                reported_context="The selected task failed.",
                evidence=[],
                fixes=_fixes(),
                verification=_verification(),
                fix_id="fix-1",
            )
        )


def test_fix_execution_denies_cwd_outside_configured_roots(tmp_path: Path) -> None:
    allowed = tmp_path / "allowed"
    outside = tmp_path / "outside"
    allowed.mkdir()
    outside.mkdir()
    workflow = FixExecutionWorkflow(_command_workflow(allowed))

    outcome = asyncio.run(
        workflow.submit(
            _request(outside, "print('not executed')"),
            fixes=_fixes(),
            verification=_verification(),
        )
    )

    assert outcome.status is FixExecutionStatus.COMMAND_FAILED
    assert outcome.command_outcome.approval is None
    assert outcome.command_outcome.execution is not None
    assert outcome.command_outcome.execution.status is CommandExecutionStatus.DENIED
    [change] = outcome.file_changes
    assert change.changed is False
    assert change.before.state is FixFileState.UNREADABLE
    assert change.before.error is not None
    assert "not captured" in change.before.error


def test_execution_request_rejects_path_traversal(tmp_path: Path) -> None:
    with pytest.raises(ValidationError, match="cannot traverse parents"):
        FixExecutionRequest(
            fix_id="fix-1",
            command=ProcessCommandRequest(
                executable=sys.executable,
                arguments=["--version"],
                cwd=tmp_path,
            ),
            rationale="Invalid changed path.",
            expected_changed_paths=["../outside.txt"],
        )


def test_file_snapshot_state_requires_matching_metadata() -> None:
    with pytest.raises(ValidationError, match="require a size and SHA-256"):
        FixFileSnapshot(state=FixFileState.FILE)

    with pytest.raises(ValidationError, match="cannot contain file content metadata"):
        FixFileSnapshot(
            state=FixFileState.MISSING,
            content_preview="invented content",
        )

    with pytest.raises(ValidationError, match="require an error"):
        FixFileSnapshot(state=FixFileState.OUTSIDE_CWD)
