from __future__ import annotations

import asyncio
import sys
from collections.abc import Callable
from pathlib import Path
from typing import cast

import pytest
from pydantic import ValidationError

from maa_diagnostic_expert.contracts.command import (
    CommandApprovalDecision,
    CommandApprovalResponse,
    CommandToolMode,
    ProcessCommandRequest,
)
from maa_diagnostic_expert.contracts.domain import (
    ContractModel,
    Evidence,
    EvidenceReliability,
    EvidenceRole,
)
from maa_diagnostic_expert.contracts.workflow import (
    FixCandidate,
    FixCandidatePlan,
    FixExecutionOutcome,
    FixExecutionRequest,
    FixMethod,
    FixPlanningStatus,
    FixScope,
    FixVerificationCheck,
    FixVerificationCheckKind,
    FixVerificationDraft,
    VerificationMethod,
    VerificationPlan,
    VerificationPlanningStatus,
    VerificationPlanSet,
    VerificationStatus,
)
from maa_diagnostic_expert.reasoning.protocol import ReasoningContext
from maa_diagnostic_expert.reasoning.tools.command import (
    CommandExecutor,
    CommandExecutorConfig,
)
from maa_diagnostic_expert.workflow.command_approval import CommandApprovalWorkflow
from maa_diagnostic_expert.workflow.fix_execution import FixExecutionWorkflow
from maa_diagnostic_expert.workflow.fix_verification import FixVerificationWorkflow


def _fixes() -> FixCandidatePlan:
    return FixCandidatePlan(
        status=FixPlanningStatus.PROPOSED,
        rationale="A focused configuration repair is supported.",
        candidates=[
            FixCandidate(
                fix_id="fix-1",
                target="config.txt",
                scope=FixScope.PROJECT,
                method=FixMethod.CONFIGURATION,
                rationale="Change only the failed setting.",
                evidence_ids=["ev:failure"],
                regression_risks=["The adjacent behavior might regress."],
                verification_steps=["Inspect the file and replay the task."],
            )
        ],
    )


def _verification_plan() -> VerificationPlanSet:
    return VerificationPlanSet(
        status=VerificationPlanningStatus.PLANNED,
        rationale="Verify the file, task milestone, and adjacent behavior.",
        plans=[
            VerificationPlan(
                fix_id="fix-1",
                methods=[
                    VerificationMethod.STATIC_CONFIGURATION,
                    VerificationMethod.RUNTIME_EXECUTION,
                ],
                steps=["Inspect config.txt.", "Replay the affected task."],
                business_milestones=["The task reaches the user-visible ready state."],
                regression_checks=["The adjacent task still reaches its ready state."],
            )
        ],
    )


def _execution_workflow(tmp_path: Path) -> FixExecutionWorkflow:
    command = CommandApprovalWorkflow(
        CommandExecutor(
            CommandExecutorConfig(
                mode=CommandToolMode.TRUSTED,
                allowed_roots=(tmp_path,),
                output_directory=tmp_path / "command-output",
            )
        )
    )
    return FixExecutionWorkflow(command)


def _execution_request(tmp_path: Path, script: str) -> FixExecutionRequest:
    return FixExecutionRequest(
        fix_id="fix-1",
        command=ProcessCommandRequest(
            executable=sys.executable,
            arguments=["-c", script],
            cwd=tmp_path,
        ),
        rationale="Apply only the selected setting change.",
        expected_changed_paths=["config.txt"],
    )


def _submit_and_decide(
    tmp_path: Path,
    script: str,
    decision: CommandApprovalDecision,
) -> FixExecutionOutcome:
    workflow = _execution_workflow(tmp_path)
    pending = asyncio.run(
        workflow.submit(
            _execution_request(tmp_path, script),
            fixes=_fixes(),
            verification=_verification_plan(),
        )
    )
    return asyncio.run(
        workflow.resume(
            CommandApprovalResponse(
                approval_id=pending.command_outcome.approval_id,
                decision=decision,
            )
        )
    )


type _DraftFactory = Callable[[ReasoningContext], FixVerificationDraft]


class _VerificationSession:
    def __init__(self, factory: _DraftFactory, contexts: list[ReasoningContext]) -> None:
        self.factory = factory
        self.contexts = contexts

    async def reason[ResultT: ContractModel](
        self,
        context: ReasoningContext,
        result_type: type[ResultT],
    ) -> ResultT:
        if result_type is not FixVerificationDraft:
            raise TypeError(result_type.__name__)
        self.contexts.append(context)
        return cast(ResultT, self.factory(context))

    async def close(self) -> None:
        pass


class _VerificationBackend:
    def __init__(self, factory: _DraftFactory) -> None:
        self.factory = factory
        self.contexts: list[ReasoningContext] = []

    async def start(self, *, run_id: str) -> _VerificationSession:
        del run_id
        return _VerificationSession(self.factory, self.contexts)


def _passed_draft(context: ReasoningContext) -> FixVerificationDraft:
    file_evidence = next(item for item in context.evidence if item.kind == "fix_file_change")
    business = next(item for item in context.evidence if item.kind == "business_milestone")
    regression = next(item for item in context.evidence if item.kind == "regression_observation")
    return FixVerificationDraft(
        fix_id="fix-1",
        status=VerificationStatus.PASSED,
        summary="The file changed and all runtime milestones passed.",
        checks=[
            FixVerificationCheck(
                kind=FixVerificationCheckKind.FILE_CHANGE,
                requirement="config.txt",
                status=VerificationStatus.PASSED,
                statement="The expected file changed.",
                evidence_ids=[file_evidence.id],
            ),
            FixVerificationCheck(
                kind=FixVerificationCheckKind.STEP,
                requirement="Inspect config.txt.",
                status=VerificationStatus.PASSED,
                statement="The updated file contains the selected value.",
                evidence_ids=[file_evidence.id],
            ),
            FixVerificationCheck(
                kind=FixVerificationCheckKind.STEP,
                requirement="Replay the affected task.",
                status=VerificationStatus.PASSED,
                statement="The task replay reached its target state.",
                evidence_ids=[business.id],
            ),
            FixVerificationCheck(
                kind=FixVerificationCheckKind.BUSINESS_MILESTONE,
                requirement="The task reaches the user-visible ready state.",
                status=VerificationStatus.PASSED,
                statement="The user-visible ready state was observed.",
                evidence_ids=[business.id],
            ),
            FixVerificationCheck(
                kind=FixVerificationCheckKind.REGRESSION,
                requirement="The adjacent task still reaches its ready state.",
                status=VerificationStatus.PASSED,
                statement="The adjacent task retained its ready state.",
                evidence_ids=[regression.id],
            ),
        ],
    )


def _observation(
    evidence_id: str,
    kind: str,
    content: str,
) -> Evidence:
    return Evidence(
        id=evidence_id,
        kind=kind,
        source_component="runtime-replay",
        source_path="replay.log",
        content=content,
        role=EvidenceRole.CONTEXT,
        reliability=EvidenceReliability.PRIMARY,
    )


def test_fix_verification_requires_file_business_and_regression_evidence(
    tmp_path: Path,
) -> None:
    (tmp_path / "config.txt").write_text("old", encoding="utf-8")
    execution = _submit_and_decide(
        tmp_path,
        "from pathlib import Path; Path('config.txt').write_text('new')",
        CommandApprovalDecision.APPROVE,
    )
    backend = _VerificationBackend(_passed_draft)
    workflow = FixVerificationWorkflow(backend)

    result = asyncio.run(
        workflow.verify(
            run_id="verify-1",
            execution=execution,
            additional_evidence=[
                _observation(
                    "ev:business",
                    "business_milestone",
                    "The task displayed its ready state.",
                ),
                _observation(
                    "ev:regression",
                    "regression_observation",
                    "The adjacent task displayed its ready state.",
                ),
            ],
        )
    )

    assert result.status is VerificationStatus.PASSED
    assert all(check.status is VerificationStatus.PASSED for check in result.checks)
    assert {item.kind for item in result.evidence} == {
        "fix_file_change",
        "business_milestone",
        "regression_observation",
    }
    [change] = execution.file_changes
    assert change.changed is True
    assert change.after is not None
    assert change.before.sha256 != change.after.sha256
    assert backend.contexts[0].stage == "verify_fix"


def test_framework_success_summary_cannot_prove_business_milestone(
    tmp_path: Path,
) -> None:
    (tmp_path / "config.txt").write_text("old", encoding="utf-8")
    execution = _submit_and_decide(
        tmp_path,
        "from pathlib import Path; Path('config.txt').write_text('new')",
        CommandApprovalDecision.APPROVE,
    )

    def framework_only(context: ReasoningContext) -> FixVerificationDraft:
        draft = _passed_draft(
            ReasoningContext(
                stage=context.stage,
                instruction=context.instruction,
                evidence=[
                    *context.evidence,
                    _observation(
                        "ev:business",
                        "business_milestone",
                        "Temporary placeholder.",
                    ),
                    _observation(
                        "ev:regression",
                        "regression_observation",
                        "Temporary placeholder.",
                    ),
                ],
            )
        )
        framework = next(item for item in context.evidence if item.kind == "task_execution_summary")
        checks = [
            check.model_copy(update={"evidence_ids": [framework.id]})
            if check.kind is FixVerificationCheckKind.BUSINESS_MILESTONE
            or check.requirement == "Replay the affected task."
            else check
            for check in draft.checks
        ]
        return draft.model_copy(update={"checks": checks})

    workflow = FixVerificationWorkflow(_VerificationBackend(framework_only))

    with pytest.raises(ValueError, match="explicit business_milestone evidence"):
        asyncio.run(
            workflow.verify(
                run_id="verify-framework",
                execution=execution,
                additional_evidence=[
                    _observation(
                        "ev:framework",
                        "task_execution_summary",
                        "status: succeeded",
                    ),
                    _observation(
                        "ev:regression",
                        "regression_observation",
                        "The adjacent task passed.",
                    ),
                ],
            )
        )


def test_unchanged_expected_file_cannot_pass_change_check(tmp_path: Path) -> None:
    (tmp_path / "config.txt").write_text("same", encoding="utf-8")
    execution = _submit_and_decide(
        tmp_path,
        "print('no file change')",
        CommandApprovalDecision.APPROVE,
    )
    workflow = FixVerificationWorkflow(_VerificationBackend(_passed_draft))

    with pytest.raises(ValueError, match="lacks changed-file evidence"):
        asyncio.run(
            workflow.verify(
                run_id="verify-unchanged",
                execution=execution,
                additional_evidence=[
                    _observation("ev:business", "business_milestone", "Ready."),
                    _observation("ev:regression", "regression_observation", "Stable."),
                ],
            )
        )


def test_directory_replacement_cannot_pass_file_change_check(tmp_path: Path) -> None:
    (tmp_path / "config.txt").write_text("old", encoding="utf-8")
    execution = _submit_and_decide(
        tmp_path,
        "from pathlib import Path; Path('config.txt').unlink(); Path('config.txt').mkdir()",
        CommandApprovalDecision.APPROVE,
    )
    workflow = FixVerificationWorkflow(_VerificationBackend(_passed_draft))

    with pytest.raises(ValueError, match="lacks changed-file evidence"):
        asyncio.run(
            workflow.verify(
                run_id="verify-directory",
                execution=execution,
                additional_evidence=[
                    _observation("ev:business", "business_milestone", "Ready."),
                    _observation("ev:regression", "regression_observation", "Stable."),
                ],
            )
        )


def test_command_completion_alone_cannot_pass_verification_step(tmp_path: Path) -> None:
    (tmp_path / "config.txt").write_text("old", encoding="utf-8")
    execution = _submit_and_decide(
        tmp_path,
        "from pathlib import Path; Path('config.txt').write_text('new')",
        CommandApprovalDecision.APPROVE,
    )

    def command_only_step(context: ReasoningContext) -> FixVerificationDraft:
        draft = _passed_draft(context)
        command = next(item for item in context.evidence if item.kind == "fix_command_execution")
        checks = [
            check.model_copy(update={"evidence_ids": [command.id]})
            if check.kind is FixVerificationCheckKind.STEP
            and check.requirement == "Replay the affected task."
            else check
            for check in draft.checks
        ]
        return draft.model_copy(update={"checks": checks})

    workflow = FixVerificationWorkflow(_VerificationBackend(command_only_step))

    with pytest.raises(ValueError, match="evidence beyond command completion"):
        asyncio.run(
            workflow.verify(
                run_id="verify-command-only",
                execution=execution,
                additional_evidence=[
                    _observation("ev:business", "business_milestone", "Ready."),
                    _observation("ev:regression", "regression_observation", "Stable."),
                ],
            )
        )


def test_verification_rejects_omitted_requirement(tmp_path: Path) -> None:
    (tmp_path / "config.txt").write_text("old", encoding="utf-8")
    execution = _submit_and_decide(
        tmp_path,
        "from pathlib import Path; Path('config.txt').write_text('new')",
        CommandApprovalDecision.APPROVE,
    )

    def omit_regression(context: ReasoningContext) -> FixVerificationDraft:
        draft = _passed_draft(context)
        checks = [
            check for check in draft.checks if check.kind is not FixVerificationCheckKind.REGRESSION
        ]
        return draft.model_copy(update={"checks": checks})

    workflow = FixVerificationWorkflow(_VerificationBackend(omit_regression))

    with pytest.raises(ValueError, match="omitted requirements"):
        asyncio.run(
            workflow.verify(
                run_id="verify-omitted",
                execution=execution,
                additional_evidence=[
                    _observation("ev:business", "business_milestone", "Ready."),
                    _observation("ev:regression", "regression_observation", "Stable."),
                ],
            )
        )


def test_verification_rejects_unknown_evidence_id(tmp_path: Path) -> None:
    (tmp_path / "config.txt").write_text("old", encoding="utf-8")
    execution = _submit_and_decide(
        tmp_path,
        "from pathlib import Path; Path('config.txt').write_text('new')",
        CommandApprovalDecision.APPROVE,
    )

    def invent_evidence(context: ReasoningContext) -> FixVerificationDraft:
        draft = _passed_draft(context)
        checks = [
            check.model_copy(update={"evidence_ids": ["ev:invented"]})
            if check.kind is FixVerificationCheckKind.REGRESSION
            else check
            for check in draft.checks
        ]
        return draft.model_copy(update={"checks": checks})

    workflow = FixVerificationWorkflow(_VerificationBackend(invent_evidence))

    with pytest.raises(ValueError, match="unknown evidence IDs"):
        asyncio.run(
            workflow.verify(
                run_id="verify-invented",
                execution=execution,
                additional_evidence=[
                    _observation("ev:business", "business_milestone", "Ready."),
                    _observation("ev:regression", "regression_observation", "Stable."),
                ],
            )
        )


def test_verification_status_must_match_check_statuses() -> None:
    with pytest.raises(ValidationError, match="requires every check to pass"):
        FixVerificationDraft(
            fix_id="fix-1",
            status=VerificationStatus.PASSED,
            summary="The result is inconsistent.",
            checks=[
                FixVerificationCheck(
                    kind=FixVerificationCheckKind.STEP,
                    requirement="Replay the affected task.",
                    status=VerificationStatus.UNAVAILABLE,
                    statement="No replay evidence was available.",
                    missing_evidence=["runtime_replay"],
                )
            ],
        )


def test_rejected_execution_produces_unavailable_checks_without_model(
    tmp_path: Path,
) -> None:
    (tmp_path / "config.txt").write_text("old", encoding="utf-8")
    execution = _submit_and_decide(
        tmp_path,
        "from pathlib import Path; Path('config.txt').write_text('new')",
        CommandApprovalDecision.REJECT,
    )

    def should_not_run(context: ReasoningContext) -> FixVerificationDraft:
        raise AssertionError(f"model should not run: {context.stage}")

    result = asyncio.run(
        FixVerificationWorkflow(_VerificationBackend(should_not_run)).verify(
            run_id="verify-rejected",
            execution=execution,
            additional_evidence=[],
        )
    )

    assert result.status is VerificationStatus.UNAVAILABLE
    assert all(check.status is VerificationStatus.UNAVAILABLE for check in result.checks)
    assert all(check.missing_evidence == ["fix_command_not_completed"] for check in result.checks)
    assert result.evidence == []
