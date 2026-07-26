from __future__ import annotations

from dataclasses import dataclass, field

from maa_diagnostic_expert.contracts.command import (
    CommandApprovalOutcome,
    CommandApprovalResponse,
    CommandApprovalStatus,
    CommandExecutionStatus,
)
from maa_diagnostic_expert.contracts.domain import Evidence
from maa_diagnostic_expert.contracts.workflow import (
    FixCandidate,
    FixCandidatePlan,
    FixExecutionOutcome,
    FixExecutionRequest,
    FixExecutionStatus,
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
    _pending: dict[str, tuple[FixExecutionRequest, _SelectedFix]] = field(
        default_factory=dict[str, tuple[FixExecutionRequest, _SelectedFix]],
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
        command = await self.command_workflow.submit(
            request.command,
            require_approval=True,
        )
        if command.status is CommandApprovalStatus.AWAITING_APPROVAL:
            self._pending[command.approval_id] = (request, selected)
        return _build_outcome(request, selected, command)

    async def resume(self, response: CommandApprovalResponse) -> FixExecutionOutcome:
        pending = self._pending.get(response.approval_id)
        if pending is None:
            raise ValueError(f"No fix execution is pending for '{response.approval_id}'")
        request, selected = pending
        command = await self.command_workflow.resume(response)
        if command.status is not CommandApprovalStatus.AWAITING_APPROVAL:
            del self._pending[response.approval_id]
        return _build_outcome(request, selected, command)


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
    return FixExecutionOutcome(
        status=status,
        request=request,
        candidate=selected.candidate,
        verification_plan=selected.verification,
        command_outcome=command,
    )
