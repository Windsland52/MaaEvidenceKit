from __future__ import annotations

import hashlib
from dataclasses import dataclass

from maa_diagnostic_expert.contracts.domain import (
    Evidence,
    EvidenceReliability,
    EvidenceRole,
)
from maa_diagnostic_expert.contracts.workflow import (
    FixExecutionOutcome,
    FixExecutionStatus,
    FixFileChange,
    FixFileState,
    FixVerificationCheck,
    FixVerificationCheckKind,
    FixVerificationDraft,
    FixVerificationResult,
    VerificationStatus,
)
from maa_diagnostic_expert.reasoning.prompts import build_fix_verification_context
from maa_diagnostic_expert.reasoning.protocol import ReasoningBackend


def _command_evidence_id(execution: FixExecutionOutcome) -> str:
    return f"fix-exec:{execution.command_outcome.approval_id}:command"


def _file_change_evidence_id(execution: FixExecutionOutcome, path: str) -> str:
    digest = hashlib.sha256(f"{execution.command_outcome.approval_id}|{path}".encode()).hexdigest()[
        :20
    ]
    return f"fix-exec:{execution.command_outcome.approval_id}:file:{digest}"


def synthesize_fix_execution_evidence(execution: FixExecutionOutcome) -> list[Evidence]:
    """Convert immutable command and before/after facts into verification evidence."""
    evidence: list[Evidence] = []
    command = execution.command_outcome.execution
    if command is not None:
        evidence.append(
            Evidence(
                id=_command_evidence_id(execution),
                kind="fix_command_execution",
                source_component="fix-execution",
                source_path=str(command.request.cwd),
                content=(
                    f"status={command.status.value}; exit_code={command.exit_code}; "
                    f"approved={command.approved}; error={command.error or 'none'}\n"
                    f"stdout:\n{command.stdout_preview}\n"
                    f"stderr:\n{command.stderr_preview}"
                ),
                role=EvidenceRole.CONTEXT,
                reliability=EvidenceReliability.PRIMARY,
            )
        )
    for change in execution.file_changes:
        if change.after is None:
            continue
        evidence.append(_file_change_evidence(execution, change))
    return evidence


def _file_change_evidence(
    execution: FixExecutionOutcome,
    change: FixFileChange,
) -> Evidence:
    after = change.after
    if after is None:
        raise ValueError("File change evidence requires an after snapshot")
    preview = after.content_preview
    return Evidence(
        id=_file_change_evidence_id(execution, change.path),
        kind="fix_file_change",
        source_component="fix-execution",
        source_path=str(execution.request.command.cwd / change.path),
        content=(
            f"path={change.path}; changed={str(change.changed).lower()}; "
            f"before_state={change.before.state.value}; after_state={after.state.value}; "
            f"before_sha256={change.before.sha256 or 'none'}; "
            f"after_sha256={after.sha256 or 'none'}; "
            f"after_size={after.size_bytes if after.size_bytes is not None else 'unknown'}; "
            f"preview_truncated={str(after.content_truncated).lower()}\n"
            f"after_content_preview:\n{preview}"
        ),
        role=EvidenceRole.CONTEXT,
        reliability=EvidenceReliability.PRIMARY,
    )


def collect_fix_verification_evidence(
    execution: FixExecutionOutcome,
    additional: list[Evidence],
) -> list[Evidence]:
    ledger: dict[str, Evidence] = {}
    ordered: list[Evidence] = []
    for item in [*synthesize_fix_execution_evidence(execution), *additional]:
        existing = ledger.get(item.id)
        if existing is not None:
            if existing != item:
                raise ValueError(f"Conflicting fix verification evidence ID: {item.id}")
            continue
        ledger[item.id] = item
        ordered.append(item)
    return ordered


def validate_fix_verification_draft(
    draft: FixVerificationDraft,
    execution: FixExecutionOutcome,
    evidence: list[Evidence],
) -> FixVerificationDraft:
    if draft.fix_id != execution.request.fix_id:
        raise ValueError("Fix verification changed the executed fix ID")
    expected = _expected_requirements(execution)
    actual = [(check.kind, check.requirement) for check in draft.checks]
    if len(actual) != len(set(actual)):
        raise ValueError("Fix verification checks must be unique")
    missing = set(expected) - set(actual)
    unknown = set(actual) - set(expected)
    if missing:
        raise ValueError("Fix verification omitted requirements: " + _format_requirements(missing))
    if unknown:
        raise ValueError("Fix verification invented requirements: " + _format_requirements(unknown))
    ledger = {item.id: item for item in evidence}
    changes = {change.path: change for change in execution.file_changes}
    for check in draft.checks:
        referenced = set(check.evidence_ids)
        unknown_evidence = referenced - set(ledger)
        if unknown_evidence:
            raise ValueError(
                "Fix verification references unknown evidence IDs: "
                + ", ".join(sorted(unknown_evidence))
            )
        if check.status is not VerificationStatus.PASSED:
            continue
        if check.kind is FixVerificationCheckKind.FILE_CHANGE:
            change = changes[check.requirement]
            expected_id = _file_change_evidence_id(execution, check.requirement)
            after_state = change.after.state if change.after is not None else None
            if (
                change.changed is not True
                or after_state not in {FixFileState.FILE, FixFileState.MISSING}
                or expected_id not in referenced
            ):
                raise ValueError(
                    f"Passed file-change check lacks changed-file evidence: {check.requirement}"
                )
        if check.kind in {
            FixVerificationCheckKind.STEP,
            FixVerificationCheckKind.REGRESSION,
        } and all(
            ledger[evidence_id].kind == "fix_command_execution" for evidence_id in referenced
        ):
            raise ValueError(
                "Passed verification steps and regressions require evidence beyond "
                "command completion"
            )
        if check.kind is FixVerificationCheckKind.BUSINESS_MILESTONE and not any(
            ledger[evidence_id].kind == "business_milestone" for evidence_id in referenced
        ):
            raise ValueError(
                "Passed business milestones require explicit business_milestone evidence"
            )
    return draft


def finalize_fix_verification(
    draft: FixVerificationDraft,
    execution: FixExecutionOutcome,
    evidence: list[Evidence],
) -> FixVerificationResult:
    validate_fix_verification_draft(draft, execution, evidence)
    referenced = {evidence_id for check in draft.checks for evidence_id in check.evidence_ids}
    return FixVerificationResult(
        fix_id=draft.fix_id,
        status=draft.status,
        summary=draft.summary,
        checks=draft.checks,
        evidence=[item for item in evidence if item.id in referenced],
    )


@dataclass(frozen=True, slots=True)
class FixVerificationWorkflow:
    reasoning_backend: ReasoningBackend

    async def verify(
        self,
        *,
        run_id: str,
        execution: FixExecutionOutcome,
        additional_evidence: list[Evidence],
    ) -> FixVerificationResult:
        evidence = collect_fix_verification_evidence(execution, additional_evidence)
        if execution.status is not FixExecutionStatus.COMMAND_COMPLETED:
            draft = _unavailable_draft(execution)
        else:
            context = build_fix_verification_context(execution, evidence)
            session = await self.reasoning_backend.start(run_id=run_id)
            try:
                draft = await session.reason(context, FixVerificationDraft)
            finally:
                await session.close()
        return finalize_fix_verification(draft, execution, evidence)


def _expected_requirements(
    execution: FixExecutionOutcome,
) -> list[tuple[FixVerificationCheckKind, str]]:
    plan = execution.verification_plan
    return [
        *(
            (FixVerificationCheckKind.FILE_CHANGE, path)
            for path in execution.request.expected_changed_paths
        ),
        *((FixVerificationCheckKind.STEP, step) for step in plan.steps),
        *(
            (FixVerificationCheckKind.BUSINESS_MILESTONE, milestone)
            for milestone in plan.business_milestones
        ),
        *((FixVerificationCheckKind.REGRESSION, check) for check in plan.regression_checks),
    ]


def _unavailable_draft(execution: FixExecutionOutcome) -> FixVerificationDraft:
    return FixVerificationDraft(
        fix_id=execution.request.fix_id,
        status=VerificationStatus.UNAVAILABLE,
        summary="Repair verification is unavailable because the fix command did not complete.",
        checks=[
            FixVerificationCheck(
                kind=kind,
                requirement=requirement,
                status=VerificationStatus.UNAVAILABLE,
                statement="The fix command did not complete, so this check was not run.",
                missing_evidence=["fix_command_not_completed"],
            )
            for kind, requirement in _expected_requirements(execution)
        ],
    )


def _format_requirements(
    requirements: set[tuple[FixVerificationCheckKind, str]],
) -> str:
    return ", ".join(
        f"{kind.value}:{requirement}"
        for kind, requirement in sorted(
            requirements,
            key=lambda item: (item[0].value, item[1]),
        )
    )
