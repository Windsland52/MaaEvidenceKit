from __future__ import annotations

import asyncio
import os
import shutil
import subprocess
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


def _git(repository: Path, *arguments: str) -> str:
    result = subprocess.run(
        ["git", "-C", str(repository), *arguments],
        check=True,
        capture_output=True,
        text=True,
    )
    return result.stdout.strip()


def _make_git_repository(tmp_path: Path) -> Path:
    repository = tmp_path / "repo"
    repository.mkdir()
    subprocess.run(["git", "init"], cwd=repository, check=True, capture_output=True)
    _git(repository, "config", "user.email", "mde@example.invalid")
    _git(repository, "config", "user.name", "MDE Test")
    (repository / "tracked.txt").write_text("before\n", encoding="utf-8")
    _git(repository, "add", "tracked.txt")
    _git(repository, "commit", "-m", "initial")
    return repository


def _configure_external_diff_sentinel(repository: Path, tmp_path: Path, sentinel: Path) -> None:
    script = tmp_path / f"external_diff_{sentinel.stem}.sh"
    script.write_text(
        f"#!/bin/sh\nprintf 'external diff ran' > '{sentinel.as_posix()}'\nexit 0\n",
        encoding="utf-8",
    )
    if os.name != "nt":
        script.chmod(0o755)
    _git(repository, "config", "diff.external", script.as_posix())


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


@pytest.mark.parametrize(
    ("arguments", "decision"),
    [
        (("--version",), CommandPolicyDecision.ALLOW),
        (("status", "--short"), CommandPolicyDecision.ALLOW),
        (("--no-pager", "status", "--short"), CommandPolicyDecision.ALLOW),
        (("branch",), CommandPolicyDecision.ALLOW),
        (("branch", "--show-current"), CommandPolicyDecision.ALLOW),
        (("diff", "--stat", "HEAD~1", "HEAD"), CommandPolicyDecision.ALLOW),
        (("log", "-1", "--oneline"), CommandPolicyDecision.ALLOW),
        (("show", "--stat", "HEAD"), CommandPolicyDecision.ALLOW),
        (("diff", "--", "--output=sentinel"), CommandPolicyDecision.ALLOW),
        (("grep", "-n", "failure", "--", "src"), CommandPolicyDecision.ALLOW),
        (("ls-files", "--cached"), CommandPolicyDecision.ALLOW),
        (("rev-parse", "--verify", "HEAD"), CommandPolicyDecision.ALLOW),
        (("tag", "--list", "v*"), CommandPolicyDecision.ALLOW),
        (("tag", "--list", "--sort=version:refname", "v*"), CommandPolicyDecision.ALLOW),
        (("tag", "--list", "--sort=refname"), CommandPolicyDecision.ALLOW),
        (("diff", "--output=sentinel", "HEAD"), CommandPolicyDecision.REQUIRE_APPROVAL),
        (("log", "--output", "sentinel"), CommandPolicyDecision.REQUIRE_APPROVAL),
        (("show", "--ext-diff", "HEAD"), CommandPolicyDecision.REQUIRE_APPROVAL),
        (("show", "--textconv", "HEAD:tracked.txt"), CommandPolicyDecision.REQUIRE_APPROVAL),
        (("grep", "-O", "failure"), CommandPolicyDecision.REQUIRE_APPROVAL),
        (("grep", "--open-files-in-pager=cat", "failure"), CommandPolicyDecision.REQUIRE_APPROVAL),
        (("grep", "--textconv", "failure"), CommandPolicyDecision.REQUIRE_APPROVAL),
        (("grep", "--ext-grep", "failure"), CommandPolicyDecision.REQUIRE_APPROVAL),
        (("branch", "--show-current", "-d", "main"), CommandPolicyDecision.REQUIRE_APPROVAL),
        (("branch", "-m", "renamed"), CommandPolicyDecision.REQUIRE_APPROVAL),
        (("branch", "--edit-description"), CommandPolicyDecision.REQUIRE_APPROVAL),
        (("branch", "--set-upstream-to=origin/main"), CommandPolicyDecision.REQUIRE_APPROVAL),
        (
            ("tag", "--list", "--format=%(contents:signature)"),
            CommandPolicyDecision.REQUIRE_APPROVAL,
        ),
        (
            ("tag", "--list", "--format", "%(signature:grade)"),
            CommandPolicyDecision.REQUIRE_APPROVAL,
        ),
        (("log", "--show-signature", "-1"), CommandPolicyDecision.REQUIRE_APPROVAL),
        (("show", "--pretty=%G? %h", "HEAD"), CommandPolicyDecision.REQUIRE_APPROVAL),
        (("log", "--pretty=mde", "-1"), CommandPolicyDecision.REQUIRE_APPROVAL),
        (("log", "--format=%h %s", "-1"), CommandPolicyDecision.REQUIRE_APPROVAL),
        (("log", "--format", "%GK %s"), CommandPolicyDecision.REQUIRE_APPROVAL),
        (("status", "--help"), CommandPolicyDecision.REQUIRE_APPROVAL),
        (("--help",), CommandPolicyDecision.REQUIRE_APPROVAL),
        (("-c", "core.pager=cat", "status"), CommandPolicyDecision.REQUIRE_APPROVAL),
        (("-C", ".", "status"), CommandPolicyDecision.REQUIRE_APPROVAL),
        (("--config-env=core.fsmonitor=FS", "status"), CommandPolicyDecision.REQUIRE_APPROVAL),
        (("--exec-path=.", "status"), CommandPolicyDecision.REQUIRE_APPROVAL),
        (("--git-dir=.git", "status"), CommandPolicyDecision.REQUIRE_APPROVAL),
        (("--work-tree=.", "status"), CommandPolicyDecision.REQUIRE_APPROVAL),
        (("--paginate", "status"), CommandPolicyDecision.REQUIRE_APPROVAL),
        (("status", "--no-pager"), CommandPolicyDecision.REQUIRE_APPROVAL),
        (("--no-pager", "--no-pager", "status"), CommandPolicyDecision.REQUIRE_APPROVAL),
        (("status", "--porc"), CommandPolicyDecision.REQUIRE_APPROVAL),
    ],
)
def test_safe_git_policy_uses_positive_argv_grammar(
    tmp_path: Path,
    arguments: tuple[str, ...],
    decision: CommandPolicyDecision,
) -> None:
    policy = CommandPolicy(CommandToolMode.SAFE)

    assert policy.evaluate(_process(tmp_path, "git", *arguments)).decision is decision


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


def test_safe_git_approval_required_does_not_write_output_file(tmp_path: Path) -> None:
    repository = _make_git_repository(tmp_path)
    sentinel = repository / "sentinel.diff"
    executor = CommandExecutor(
        CommandExecutorConfig(
            mode=CommandToolMode.SAFE,
            allowed_roots=(tmp_path,),
            output_directory=tmp_path / "output",
        )
    )

    result = asyncio.run(
        executor.execute(_process(repository, "git", "diff", f"--output={sentinel}", "HEAD"))
    )

    assert result.status is CommandExecutionStatus.APPROVAL_REQUIRED
    assert not sentinel.exists()


@pytest.mark.skipif(os.name != "nt", reason="Windows implicitly searches the child cwd")
def test_safe_git_execution_does_not_resolve_git_from_untrusted_cwd(tmp_path: Path) -> None:
    repository = tmp_path / "repo"
    repository.mkdir()
    shutil.copy2(sys.executable, repository / "git.exe")
    executor = CommandExecutor(
        CommandExecutorConfig(
            mode=CommandToolMode.SAFE,
            allowed_roots=(tmp_path,),
            output_directory=tmp_path / "output",
        )
    )

    result = asyncio.run(executor.execute(_process(repository, "git", "--version")))

    assert result.status is CommandExecutionStatus.COMPLETED
    assert result.stdout_preview.startswith("git version ")


def test_safe_git_execution_disables_configured_external_diff(tmp_path: Path) -> None:
    repository = _make_git_repository(tmp_path)
    sentinel = tmp_path / "external-diff-ran.txt"
    _configure_external_diff_sentinel(repository, tmp_path, sentinel)
    (repository / "tracked.txt").write_text("after\n", encoding="utf-8")
    executor = CommandExecutor(
        CommandExecutorConfig(
            mode=CommandToolMode.SAFE,
            allowed_roots=(tmp_path,),
            output_directory=tmp_path / "output",
        )
    )

    result = asyncio.run(executor.execute(_process(repository, "git", "diff", "--", "tracked.txt")))

    assert result.status is CommandExecutionStatus.COMPLETED
    assert "-before" in result.stdout_preview
    assert "+after" in result.stdout_preview
    assert not sentinel.exists()


def test_safe_git_execution_ignores_configured_pretty_alias(tmp_path: Path) -> None:
    repository = _make_git_repository(tmp_path)
    _git(repository, "config", "pretty.mde", "format:MDE-SENTINEL-%h")
    _git(repository, "config", "format.pretty", "mde")
    executor = CommandExecutor(
        CommandExecutorConfig(
            mode=CommandToolMode.SAFE,
            allowed_roots=(tmp_path,),
            output_directory=tmp_path / "output",
        )
    )

    result = asyncio.run(executor.execute(_process(repository, "git", "log", "-1")))

    assert result.status is CommandExecutionStatus.COMPLETED
    assert result.stdout_preview.startswith("commit ")
    assert "MDE-SENTINEL" not in result.stdout_preview


def test_trusted_git_execution_preserves_model_arguments_and_environment(tmp_path: Path) -> None:
    repository = _make_git_repository(tmp_path)
    sentinel = tmp_path / "trusted-external-diff-ran.txt"
    _configure_external_diff_sentinel(repository, tmp_path, sentinel)
    (repository / "tracked.txt").write_text("after\n", encoding="utf-8")
    executor = CommandExecutor(
        CommandExecutorConfig(
            mode=CommandToolMode.TRUSTED,
            allowed_roots=(tmp_path,),
            output_directory=tmp_path / "output",
        )
    )

    result = asyncio.run(executor.execute(_process(repository, "git", "diff", "--", "tracked.txt")))

    assert result.status is CommandExecutionStatus.COMPLETED
    assert sentinel.read_text(encoding="utf-8") == "external diff ran"


def test_approved_git_execution_preserves_model_arguments_and_environment(tmp_path: Path) -> None:
    repository = _make_git_repository(tmp_path)
    sentinel = tmp_path / "approved-external-diff-ran.txt"
    _configure_external_diff_sentinel(repository, tmp_path, sentinel)
    (repository / "tracked.txt").write_text("after\n", encoding="utf-8")
    executor = CommandExecutor(
        CommandExecutorConfig(
            mode=CommandToolMode.SAFE,
            allowed_roots=(tmp_path,),
            output_directory=tmp_path / "output",
        )
    )

    result = asyncio.run(
        executor.execute(
            _process(repository, "git", "diff", "--ext-diff", "--", "tracked.txt"),
            approved=True,
        )
    )

    assert result.status is CommandExecutionStatus.COMPLETED
    assert sentinel.read_text(encoding="utf-8") == "external diff ran"


def test_safe_git_execution_disables_configured_fsmonitor_hook(tmp_path: Path) -> None:
    repository = _make_git_repository(tmp_path)
    sentinel = tmp_path / "fsmonitor-hook-ran.txt"
    script = tmp_path / "fsmonitor_hook.sh"
    script.write_text(
        "#!/bin/sh\n"
        f"printf 'fsmonitor hook ran' > '{sentinel.as_posix()}'\n"
        "printf 'builtin:fake-token\\n'\n",
        encoding="utf-8",
    )
    if os.name != "nt":
        script.chmod(0o755)
    _git(repository, "config", "core.fsmonitor", script.as_posix())
    executor = CommandExecutor(
        CommandExecutorConfig(
            mode=CommandToolMode.SAFE,
            allowed_roots=(tmp_path,),
            output_directory=tmp_path / "output",
        )
    )

    result = asyncio.run(executor.execute(_process(repository, "git", "status", "--short")))

    assert result.status is CommandExecutionStatus.COMPLETED
    assert not sentinel.exists()


def test_safe_git_status_does_not_perform_optional_index_writes(tmp_path: Path) -> None:
    repository = _make_git_repository(tmp_path)
    index = repository / ".git" / "index"
    before_index = index.read_bytes()
    (repository / "untracked.txt").write_text("local\n", encoding="utf-8")
    executor = CommandExecutor(
        CommandExecutorConfig(
            mode=CommandToolMode.SAFE,
            allowed_roots=(tmp_path,),
            output_directory=tmp_path / "output",
        )
    )

    result = asyncio.run(executor.execute(_process(repository, "git", "status", "--short")))

    assert result.status is CommandExecutionStatus.COMPLETED
    assert "?? untracked.txt" in result.stdout_preview
    assert index.read_bytes() == before_index
    assert not (repository / ".git" / "index.lock").exists()


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
