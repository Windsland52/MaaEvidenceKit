from __future__ import annotations

import asyncio
import os
import sys
from pathlib import Path

import pytest

from maa_diagnostic_expert.contracts.command import (
    CommandExecutionStatus,
    CommandPolicyDecision,
    CommandToolMode,
    ProcessCommandRequest,
    ShellCommandRequest,
)
from maa_diagnostic_expert.reasoning.tools.command import (
    CommandExecutor,
    CommandExecutorConfig,
    CommandPolicy,
)


def _process(tmp_path: Path, executable: str = "gh", *arguments: str) -> ProcessCommandRequest:
    return ProcessCommandRequest(
        executable=executable,
        arguments=list(arguments),
        cwd=tmp_path,
    )


def test_safe_policy_allows_read_only_commands_and_requires_approval_for_writes(
    tmp_path: Path,
) -> None:
    policy = CommandPolicy(CommandToolMode.SAFE)

    assert (
        policy.evaluate(_process(tmp_path, "gh", "issue", "view", "123")).decision
        is CommandPolicyDecision.ALLOW
    )
    assert (
        policy.evaluate(_process(tmp_path, "gh", "api", "-X", "GET", "repos/a/b")).decision
        is CommandPolicyDecision.ALLOW
    )
    assert (
        policy.evaluate(_process(tmp_path, "git", "show", "HEAD")).decision
        is CommandPolicyDecision.ALLOW
    )
    assert (
        policy.evaluate(_process(tmp_path, "rg", "failure", ".")).decision
        is CommandPolicyDecision.ALLOW
    )
    assert (
        policy.evaluate(_process(tmp_path, "rg", "--pre", "dangerous", ".")).decision
        is CommandPolicyDecision.REQUIRE_APPROVAL
    )
    assert (
        policy.evaluate(
            _process(tmp_path, str(tmp_path / "gh.exe"), "issue", "view", "123")
        ).decision
        is CommandPolicyDecision.REQUIRE_APPROVAL
    )
    assert (
        policy.evaluate(_process(tmp_path, "gh", "issue", "edit", "123")).decision
        is CommandPolicyDecision.REQUIRE_APPROVAL
    )
    assert (
        policy.evaluate(_process(tmp_path, "gh", "api", "-X", "POST", "repos/a/b/issues")).decision
        is CommandPolicyDecision.REQUIRE_APPROVAL
    )


def test_modes_handle_shell_and_unrecognized_processes(tmp_path: Path) -> None:
    shell = ShellCommandRequest(command="echo hello", cwd=tmp_path)
    process = _process(tmp_path, sys.executable, "--version")

    assert (
        CommandPolicy(CommandToolMode.SAFE).evaluate(shell).decision
        is CommandPolicyDecision.REQUIRE_APPROVAL
    )
    assert (
        CommandPolicy(CommandToolMode.SAFE).evaluate(process).decision
        is CommandPolicyDecision.REQUIRE_APPROVAL
    )
    assert (
        CommandPolicy(CommandToolMode.TRUSTED).evaluate(shell).decision
        is CommandPolicyDecision.ALLOW
    )
    assert (
        CommandPolicy(CommandToolMode.DISABLED).evaluate(process).decision
        is CommandPolicyDecision.DENY
    )


def test_executor_requires_an_explicit_working_directory_root() -> None:
    with pytest.raises(ValueError, match="at least one allowed"):
        CommandExecutorConfig()


def test_executor_returns_approval_required_without_starting_process(tmp_path: Path) -> None:
    executor = CommandExecutor(
        CommandExecutorConfig(
            mode=CommandToolMode.SAFE,
            allowed_roots=(tmp_path,),
            output_directory=tmp_path / "output",
        )
    )

    result = asyncio.run(executor.execute(_process(tmp_path, sys.executable, "--version")))

    assert result.status is CommandExecutionStatus.APPROVAL_REQUIRED
    assert result.exit_code is None
    assert not (tmp_path / "output").exists()


def test_executor_runs_process_and_filters_environment(tmp_path: Path) -> None:
    executor = CommandExecutor(
        CommandExecutorConfig(
            mode=CommandToolMode.TRUSTED,
            allowed_roots=(tmp_path,),
            output_directory=tmp_path / "output",
            inherited_environment=("PATH",),
        ),
        environ={"PATH": os.environ.get("PATH", ""), "MDE_SECRET": "hidden"},
    )
    request = _process(
        tmp_path,
        sys.executable,
        "-c",
        "import os; print(os.environ.get('MDE_SECRET', 'missing'))",
    )

    result = asyncio.run(executor.execute(request))

    assert result.status is CommandExecutionStatus.COMPLETED
    assert result.stdout_preview == "missing"
    assert result.exit_code == 0
    assert result.stdout_path is None
    assert result.stderr_path is None


def test_executor_captures_failure_timeout_and_truncated_output(tmp_path: Path) -> None:
    executor = CommandExecutor(
        CommandExecutorConfig(
            mode=CommandToolMode.TRUSTED,
            allowed_roots=(tmp_path,),
            output_directory=tmp_path / "output",
        )
    )
    failed = asyncio.run(
        executor.execute(
            _process(tmp_path, sys.executable, "-c", "import sys; print('bad'); sys.exit(7)")
        )
    )
    timed_out = asyncio.run(
        executor.execute(
            ProcessCommandRequest(
                executable=sys.executable,
                arguments=["-c", "import time; time.sleep(5)"],
                cwd=tmp_path,
                timeout_seconds=0.05,
            )
        )
    )
    truncated = asyncio.run(
        executor.execute(
            ProcessCommandRequest(
                executable=sys.executable,
                arguments=["-c", "print('x' * 5000)"],
                cwd=tmp_path,
                max_output_bytes=1024,
            )
        )
    )

    assert failed.status is CommandExecutionStatus.FAILED
    assert failed.exit_code == 7
    assert timed_out.status is CommandExecutionStatus.TIMED_OUT
    assert truncated.status is CommandExecutionStatus.COMPLETED
    assert truncated.stdout_truncated
    assert truncated.stdout_path is not None
    assert truncated.stdout_path.is_file()
    assert len(truncated.stdout_preview.encode()) <= 1024


def test_executor_denies_cwd_outside_allowed_roots(tmp_path: Path) -> None:
    allowed = tmp_path / "allowed"
    outside = tmp_path / "outside"
    allowed.mkdir()
    outside.mkdir()
    executor = CommandExecutor(
        CommandExecutorConfig(
            mode=CommandToolMode.TRUSTED,
            allowed_roots=(allowed,),
            output_directory=tmp_path / "output",
        )
    )

    result = asyncio.run(executor.execute(_process(outside, sys.executable, "--version")))

    assert result.status is CommandExecutionStatus.DENIED
    assert result.policy.matched_rule == "cwd:outside-allowed-roots"


def test_safe_shell_runs_only_after_approval(tmp_path: Path) -> None:
    executor = CommandExecutor(
        CommandExecutorConfig(
            mode=CommandToolMode.SAFE,
            allowed_roots=(tmp_path,),
            output_directory=tmp_path / "output",
        )
    )
    command = "Write-Output shell-ok" if os.name == "nt" else "printf shell-ok"
    request = ShellCommandRequest(command=command, cwd=tmp_path)

    pending = asyncio.run(executor.execute(request))
    executed = asyncio.run(executor.execute(request, approved=True))

    assert pending.status is CommandExecutionStatus.APPROVAL_REQUIRED
    assert executed.status is CommandExecutionStatus.COMPLETED
    assert executed.stdout_preview == "shell-ok"
    assert executed.approved


def test_cancelling_execution_terminates_the_process_task(tmp_path: Path) -> None:
    executor = CommandExecutor(
        CommandExecutorConfig(
            mode=CommandToolMode.TRUSTED,
            allowed_roots=(tmp_path,),
            output_directory=tmp_path / "output",
        )
    )
    request = _process(
        tmp_path,
        sys.executable,
        "-c",
        "import time; time.sleep(30)",
    )

    async def cancel() -> None:
        task = asyncio.create_task(executor.execute(request))
        await asyncio.sleep(0.1)
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task

    asyncio.run(cancel())
