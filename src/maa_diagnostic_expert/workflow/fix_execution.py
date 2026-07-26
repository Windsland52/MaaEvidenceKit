from __future__ import annotations

import hashlib
import os
from dataclasses import dataclass, field
from pathlib import Path

from maa_diagnostic_expert.contracts.command import (
    CommandApprovalOutcome,
    CommandApprovalResponse,
    CommandApprovalStatus,
    CommandExecutionStatus,
    CommandPolicyDecision,
)
from maa_diagnostic_expert.contracts.domain import Evidence
from maa_diagnostic_expert.contracts.workflow import (
    FixCandidate,
    FixCandidatePlan,
    FixExecutionOutcome,
    FixExecutionRequest,
    FixExecutionStatus,
    FixFileChange,
    FixFileSnapshot,
    FixFileState,
    FixPlanningStatus,
    VerificationPlan,
    VerificationPlanningStatus,
    VerificationPlanSet,
)
from maa_diagnostic_expert.reasoning.prompts import build_fix_execution_context
from maa_diagnostic_expert.reasoning.protocol import ReasoningBackend

from .command_approval import CommandApprovalWorkflow


@dataclass(frozen=True, slots=True)
class _SelectedFix:
    candidate: FixCandidate
    verification: VerificationPlan


@dataclass
class FixExecutionWorkflow:
    """Plan and execute one selected repair through mandatory human approval."""

    command_workflow: CommandApprovalWorkflow
    reasoning_backend: ReasoningBackend | None = None
    _pending: dict[
        str,
        tuple[FixExecutionRequest, _SelectedFix, list[FixFileChange]],
    ] = field(
        default_factory=dict[
            str,
            tuple[FixExecutionRequest, _SelectedFix, list[FixFileChange]],
        ],
        init=False,
        repr=False,
    )

    async def plan_and_submit(
        self,
        *,
        run_id: str,
        reported_context: str,
        evidence: list[Evidence],
        fixes: FixCandidatePlan,
        verification: VerificationPlanSet,
        fix_id: str,
    ) -> FixExecutionOutcome:
        if self.reasoning_backend is None:
            raise RuntimeError("fix execution planning requires a reasoning backend")
        selected = _select_fix(fixes, verification, fix_id)
        context = build_fix_execution_context(
            reported_context,
            evidence,
            selected.candidate,
            selected.verification,
            list(self.command_workflow.executor.config.allowed_roots),
        )
        session = await self.reasoning_backend.start(run_id=run_id)
        try:
            request = await session.reason(context, FixExecutionRequest)
        finally:
            await session.close()
        if request.fix_id != fix_id:
            raise ValueError("Fix execution request changed the selected fix ID")
        return await self.submit(request, fixes=fixes, verification=verification)

    async def submit(
        self,
        request: FixExecutionRequest,
        *,
        fixes: FixCandidatePlan,
        verification: VerificationPlanSet,
    ) -> FixExecutionOutcome:
        selected = _select_fix(fixes, verification, request.fix_id)
        if not _baseline_capture_allowed(self.command_workflow, request):
            command = await self.command_workflow.submit(
                request.command,
                require_approval=True,
            )
            baseline = _uncaptured_baseline(request)
            return _build_outcome(request, selected, command, baseline)
        baseline = _capture_baseline(request)
        command = await self.command_workflow.submit(
            request.command,
            require_approval=True,
        )
        if command.status is CommandApprovalStatus.AWAITING_APPROVAL:
            self._pending[command.approval_id] = (request, selected, baseline)
        return _build_outcome(request, selected, command, baseline)

    async def resume(self, response: CommandApprovalResponse) -> FixExecutionOutcome:
        pending = self._pending.get(response.approval_id)
        if pending is None:
            raise ValueError(f"No fix execution is pending for '{response.approval_id}'")
        request, selected, baseline = pending
        command = await self.command_workflow.resume(response)
        if command.status is not CommandApprovalStatus.AWAITING_APPROVAL:
            del self._pending[response.approval_id]
        return _build_outcome(request, selected, command, baseline)


def _select_fix(
    fixes: FixCandidatePlan,
    verification: VerificationPlanSet,
    fix_id: str,
) -> _SelectedFix:
    if fixes.status is not FixPlanningStatus.PROPOSED:
        raise ValueError("Fix execution requires proposed repair candidates")
    if verification.status is not VerificationPlanningStatus.PLANNED:
        raise ValueError("Fix execution requires a pre-execution verification plan")
    candidates = {candidate.fix_id: candidate for candidate in fixes.candidates}
    candidate = candidates.get(fix_id)
    if candidate is None:
        raise ValueError(f"Unknown selected fix ID: {fix_id}")
    plans = {plan.fix_id: plan for plan in verification.plans}
    plan = plans.get(fix_id)
    if plan is None:
        raise ValueError(f"Selected fix has no verification plan: {fix_id}")
    return _SelectedFix(candidate=candidate, verification=plan)


def _build_outcome(
    request: FixExecutionRequest,
    selected: _SelectedFix,
    command: CommandApprovalOutcome,
    baseline: list[FixFileChange],
) -> FixExecutionOutcome:
    if command.status is CommandApprovalStatus.AWAITING_APPROVAL:
        status = FixExecutionStatus.AWAITING_APPROVAL
    elif command.status is CommandApprovalStatus.REJECTED:
        status = FixExecutionStatus.REJECTED
    elif (
        command.execution is not None
        and command.execution.status is CommandExecutionStatus.COMPLETED
    ):
        status = FixExecutionStatus.COMMAND_COMPLETED
    else:
        status = FixExecutionStatus.COMMAND_FAILED
    file_changes = (
        baseline
        if status in {FixExecutionStatus.AWAITING_APPROVAL, FixExecutionStatus.REJECTED}
        or all(change.after is not None for change in baseline)
        else _capture_after(request, baseline)
    )
    return FixExecutionOutcome(
        status=status,
        request=request,
        candidate=selected.candidate,
        verification_plan=selected.verification,
        command_outcome=command,
        file_changes=file_changes,
    )


_MAX_FILE_PREVIEW_BYTES = 40_000


def _baseline_capture_allowed(
    command_workflow: CommandApprovalWorkflow,
    request: FixExecutionRequest,
) -> bool:
    executor = command_workflow.executor
    if executor.policy.evaluate(request.command).decision is CommandPolicyDecision.DENY:
        return False
    cwd = request.command.cwd.expanduser().resolve()
    roots = tuple(path.expanduser().resolve() for path in executor.config.allowed_roots)
    return cwd.is_dir() and any(cwd.is_relative_to(root) for root in roots)


def _uncaptured_baseline(request: FixExecutionRequest) -> list[FixFileChange]:
    return [
        FixFileChange(
            path=relative,
            before=_uncaptured_snapshot(),
            after=_uncaptured_snapshot(),
            changed=False,
        )
        for relative in request.expected_changed_paths
    ]


def _uncaptured_snapshot() -> FixFileSnapshot:
    return FixFileSnapshot(
        state=FixFileState.UNREADABLE,
        error="Snapshots were not captured because the command request was denied.",
    )


def _capture_baseline(request: FixExecutionRequest) -> list[FixFileChange]:
    cwd = request.command.cwd.expanduser().resolve()
    changes = [
        FixFileChange(path=relative, before=_snapshot_path(cwd, relative))
        for relative in request.expected_changed_paths
    ]
    outside = [change.path for change in changes if change.before.state is FixFileState.OUTSIDE_CWD]
    if outside:
        raise ValueError(
            "Expected changed paths resolve outside the command cwd: " + ", ".join(outside)
        )
    return changes


def _capture_after(
    request: FixExecutionRequest,
    baseline: list[FixFileChange],
) -> list[FixFileChange]:
    cwd = request.command.cwd.expanduser().resolve()
    completed: list[FixFileChange] = []
    for change in baseline:
        after = _snapshot_path(cwd, change.path)
        completed.append(
            FixFileChange(
                path=change.path,
                before=change.before,
                after=after,
                changed=change.before != after,
            )
        )
    return completed


def _snapshot_path(cwd: Path, relative: str) -> FixFileSnapshot:
    lexical = cwd.joinpath(*Path(relative).parts)
    try:
        resolved = lexical.resolve()
    except OSError as error:
        return FixFileSnapshot(state=FixFileState.UNREADABLE, error=str(error))
    if not resolved.is_relative_to(cwd):
        return FixFileSnapshot(
            state=FixFileState.OUTSIDE_CWD,
            error="The expected changed path resolves outside the command cwd.",
        )
    if not os.path.lexists(lexical):
        return FixFileSnapshot(state=FixFileState.MISSING)
    if resolved.is_dir():
        return FixFileSnapshot(state=FixFileState.DIRECTORY)
    if not resolved.is_file():
        return FixFileSnapshot(
            state=FixFileState.UNREADABLE,
            error="The expected changed path is not a regular file.",
        )
    digest = hashlib.sha256()
    preview = bytearray()
    size = 0
    try:
        with resolved.open("rb") as handle:
            while chunk := handle.read(1024 * 1024):
                digest.update(chunk)
                size += len(chunk)
                remaining = _MAX_FILE_PREVIEW_BYTES + 1 - len(preview)
                if remaining > 0:
                    preview.extend(chunk[:remaining])
    except OSError as error:
        return FixFileSnapshot(state=FixFileState.UNREADABLE, error=str(error))
    truncated = len(preview) > _MAX_FILE_PREVIEW_BYTES
    bounded = bytes(preview[:_MAX_FILE_PREVIEW_BYTES])
    content = "" if b"\x00" in bounded else bounded.decode("utf-8", errors="replace")
    return FixFileSnapshot(
        state=FixFileState.FILE,
        size_bytes=size,
        sha256=digest.hexdigest(),
        content_preview=content,
        content_truncated=truncated,
    )
