from __future__ import annotations

import asyncio
import os
import secrets
import shlex
import signal
import subprocess
import time
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path

from maa_diagnostic_expert.contracts.command import (
    CommandExecutionResult,
    CommandExecutionStatus,
    CommandPolicyDecision,
    CommandPolicyResult,
    CommandRequest,
    CommandToolMode,
    ProcessCommandRequest,
    ShellCommandRequest,
)

_BASE_ENVIRONMENT = (
    "APPDATA",
    "HOME",
    "LANG",
    "LC_ALL",
    "LOCALAPPDATA",
    "PATH",
    "PATHEXT",
    "SYSTEMROOT",
    "TEMP",
    "TMP",
    "USERPROFILE",
    "WINDIR",
)
_GH_ENVIRONMENT = ("GH_ENTERPRISE_TOKEN", "GH_HOST", "GH_TOKEN", "GITHUB_TOKEN")
_SAFE_GIT_COMMANDS = {
    "branch",
    "diff",
    "grep",
    "log",
    "ls-files",
    "rev-parse",
    "show",
    "status",
    "tag",
}
_GIT_GLOBAL_OPTIONS_REQUIRING_APPROVAL = (
    "-c",
    "-C",
    "--config-env",
    "--exec-path",
    "--git-dir",
    "--work-tree",
    "--paginate",
)
_GIT_OPTIONS_REQUIRING_APPROVAL = (
    "-O",
    "--ext-diff",
    "--ext-grep",
    "--help",
    "--open-files-in-pager",
    "--output",
    "--show-signature",
    "--textconv",
)
_GIT_HARDENING_CONFIG = (
    "core.fsmonitor=false",
    f"core.hooksPath={os.devnull}",
    "core.pager=cat",
    "core.untrackedCache=false",
    "diff.external=",
    "format.pretty=medium",
    "interactive.diffFilter=",
    "log.showSignature=false",
    "pager.branch=false",
    "pager.diff=false",
    "pager.grep=false",
    "pager.log=false",
    "pager.show=false",
    "pager.status=false",
    "pager.tag=false",
)
_GIT_HARDENING_ENVIRONMENT = {
    "GIT_NO_LAZY_FETCH": "1",
    "GIT_OPTIONAL_LOCKS": "0",
    "GIT_PAGER": "cat",
}
_GIT_DIFF_FLAGS = frozenset(
    {
        "--cached",
        "--check",
        "--name-only",
        "--name-status",
        "--no-patch",
        "--numstat",
        "--patch",
        "--raw",
        "--shortstat",
        "--staged",
        "--stat",
        "--summary",
        "-p",
    }
)
_GIT_DIFF_VALUE_OPTIONS = frozenset({"--unified"})
_GIT_LOG_SHOW_FLAGS = frozenset(
    {
        "--all",
        "--date-order",
        "--decorate",
        "--name-only",
        "--name-status",
        "--no-decorate",
        "--no-patch",
        "--numstat",
        "--oneline",
        "--patch",
        "--raw",
        "--reverse",
        "--shortstat",
        "--stat",
        "--summary",
        "--topo-order",
        "-p",
    }
)
_GIT_LOG_SHOW_VALUE_OPTIONS = frozenset(
    {
        "--author",
        "--date",
        "--grep",
        "--max-count",
        "--since",
        "--until",
        "-n",
    }
)
_GIT_GREP_FLAGS = frozenset(
    {
        "--count",
        "--files-with-matches",
        "--files-without-match",
        "--fixed-strings",
        "--ignore-case",
        "--line-number",
        "--name-only",
        "--perl-regexp",
        "--untracked",
        "-E",
        "-F",
        "-I",
        "-L",
        "-P",
        "-i",
        "-l",
        "-n",
    }
)
_GIT_LS_FILES_FLAGS = frozenset(
    {
        "--cached",
        "--deleted",
        "--exclude-standard",
        "--ignored",
        "--modified",
        "--others",
        "--stage",
        "--unmerged",
        "-s",
        "-z",
    }
)
_GIT_REV_PARSE_FLAGS = frozenset(
    {
        "--abbrev-ref",
        "--is-bare-repository",
        "--is-inside-work-tree",
        "--show-cdup",
        "--show-prefix",
        "--show-toplevel",
        "--symbolic-full-name",
        "--verify",
    }
)
_GIT_REV_PARSE_VALUE_OPTIONS = frozenset({"--short"})
_GIT_STATUS_FLAGS = frozenset(
    {
        "--ahead-behind",
        "--branch",
        "--ignored",
        "--no-ahead-behind",
        "--porcelain",
        "--short",
        "--show-stash",
        "--untracked-files",
        "-b",
        "-s",
    }
)
_GIT_TAG_FLAGS = frozenset({"--list", "-l"})
_GIT_TAG_VALUE_OPTIONS = frozenset({"--sort"})
_SAFE_GH_COMMANDS = {
    "issue": {"list", "status", "view"},
    "pr": {"checks", "diff", "list", "status", "view"},
    "release": {"list", "view"},
    "repo": {"list", "view"},
    "run": {"list", "view", "watch"},
}
_GH_API_WRITE_ARGUMENTS = {
    "--field",
    "--input",
    "--method",
    "--raw-field",
    "-F",
    "-f",
    "-X",
}


@dataclass(frozen=True, slots=True)
class CommandExecutorConfig:
    mode: CommandToolMode = CommandToolMode.SAFE
    allowed_roots: tuple[Path, ...] = field(default_factory=tuple)
    output_directory: Path = Path("tmp") / "command-output"
    inherited_environment: tuple[str, ...] = _BASE_ENVIRONMENT

    def __post_init__(self) -> None:
        if not self.allowed_roots:
            raise ValueError(
                "Command executor requires at least one allowed working-directory root"
            )


@dataclass(frozen=True, slots=True)
class _CapturedOutput:
    preview: str
    path: Path | None
    truncated: bool


class CommandPolicy:
    def __init__(self, mode: CommandToolMode = CommandToolMode.SAFE) -> None:
        self.mode = mode

    def evaluate(self, request: CommandRequest) -> CommandPolicyResult:
        if self.mode is CommandToolMode.DISABLED:
            return CommandPolicyResult(
                decision=CommandPolicyDecision.DENY,
                reason="Command tools are disabled by configuration.",
                matched_rule="mode:disabled",
            )
        if self.mode is CommandToolMode.TRUSTED:
            return CommandPolicyResult(
                decision=CommandPolicyDecision.ALLOW,
                reason="Trusted mode allows command execution without approval.",
                matched_rule="mode:trusted",
            )
        if isinstance(request, ShellCommandRequest):
            return CommandPolicyResult(
                decision=CommandPolicyDecision.REQUIRE_APPROVAL,
                reason="Safe mode requires approval for complete shell command strings.",
                matched_rule="safe:shell",
            )
        matched_rule = _safe_process_rule(request)
        if matched_rule is not None:
            return CommandPolicyResult(
                decision=CommandPolicyDecision.ALLOW,
                reason="Safe mode recognized a read-only process command.",
                matched_rule=matched_rule,
            )
        return CommandPolicyResult(
            decision=CommandPolicyDecision.REQUIRE_APPROVAL,
            reason="Safe mode did not recognize this process command as read-only.",
            matched_rule="safe:unrecognized",
        )


def _executable_name(executable: str) -> str:
    name = Path(executable).name.lower()
    return name.removesuffix(".exe")


def _safe_process_rule(request: ProcessCommandRequest) -> str | None:
    if "/" in request.executable or "\\" in request.executable:
        return None
    executable = _executable_name(request.executable)
    arguments = request.arguments
    if executable == "rg":
        if "--pre" in arguments or any(argument.startswith("--pre=") for argument in arguments):
            return None
        return "safe:rg"
    if executable == "git":
        return _safe_git_rule(arguments)
    if executable != "gh":
        return None
    if arguments == ["--version"]:
        return "safe:gh-version"
    if not arguments:
        return None
    if arguments[0] == "api":
        if any(argument in _GH_API_WRITE_ARGUMENTS for argument in arguments[1:]):
            method_index = next(
                (
                    index
                    for index, argument in enumerate(arguments[1:], start=1)
                    if argument in {"--method", "-X"}
                ),
                None,
            )
            if (
                method_index is not None
                and method_index + 1 < len(arguments)
                and arguments[method_index + 1].upper() == "GET"
                and not any(
                    argument in {"--field", "--input", "--raw-field", "-F", "-f"}
                    for argument in arguments[1:]
                )
            ):
                return "safe:gh-api-get"
            return None
        return "safe:gh-api-get"
    if len(arguments) < 2:
        return None
    operations = _SAFE_GH_COMMANDS.get(arguments[0])
    if operations is not None and arguments[1] in operations:
        return f"safe:gh-{arguments[0]}-{arguments[1]}"
    return None


def _safe_git_rule(arguments: Sequence[str]) -> str | None:
    git_arguments = list(arguments)
    if git_arguments and git_arguments[0] == "--no-pager":
        if git_arguments.count("--no-pager") > 1:
            return None
        git_arguments = git_arguments[1:]
    elif "--no-pager" in git_arguments:
        return None
    if git_arguments == ["--version"]:
        return "safe:git-version"
    if not git_arguments:
        return None
    if _git_arguments_require_approval(git_arguments):
        return None
    command = git_arguments[0]
    if command not in _SAFE_GIT_COMMANDS:
        return None
    command_arguments = git_arguments[1:]
    allowed = {
        "branch": _safe_git_branch,
        "diff": _safe_git_diff,
        "grep": _safe_git_grep,
        "log": _safe_git_log_show,
        "ls-files": _safe_git_ls_files,
        "rev-parse": _safe_git_rev_parse,
        "show": _safe_git_log_show,
        "status": _safe_git_status,
        "tag": _safe_git_tag,
    }[command](command_arguments)
    if not allowed:
        return None
    return f"safe:git-{command}"


def _git_arguments_require_approval(arguments: Sequence[str]) -> bool:
    for argument in arguments:
        if argument == "--":
            return False
        if (
            argument == "--help"
            or _matches_git_option(argument, _GIT_GLOBAL_OPTIONS_REQUIRING_APPROVAL)
            or _matches_git_option(argument, _GIT_OPTIONS_REQUIRING_APPROVAL)
        ):
            return True
    return False


def _matches_git_option(argument: str, option_names: Sequence[str]) -> bool:
    return any(
        argument == option
        or argument.startswith(f"{option}=")
        or (option in {"-c", "-C", "-O"} and argument.startswith(option) and argument != "-")
        for option in option_names
    )


def _safe_git_branch(arguments: Sequence[str]) -> bool:
    return list(arguments) in ([], ["--show-current"])


def _safe_git_diff(arguments: Sequence[str]) -> bool:
    return _only_known_git_options(
        arguments,
        flags=_GIT_DIFF_FLAGS,
        value_options=_GIT_DIFF_VALUE_OPTIONS,
    )


def _safe_git_log_show(arguments: Sequence[str]) -> bool:
    return _only_known_git_options(
        arguments,
        flags=_GIT_LOG_SHOW_FLAGS,
        value_options=_GIT_LOG_SHOW_VALUE_OPTIONS,
        numeric_short_option=True,
    )


def _safe_git_grep(arguments: Sequence[str]) -> bool:
    return _only_known_git_options(arguments, flags=_GIT_GREP_FLAGS, value_options=frozenset())


def _safe_git_ls_files(arguments: Sequence[str]) -> bool:
    return _only_known_git_options(
        arguments,
        flags=_GIT_LS_FILES_FLAGS,
        value_options=frozenset(),
    )


def _safe_git_rev_parse(arguments: Sequence[str]) -> bool:
    return _only_known_git_options(
        arguments,
        flags=_GIT_REV_PARSE_FLAGS,
        value_options=_GIT_REV_PARSE_VALUE_OPTIONS,
    )


def _safe_git_status(arguments: Sequence[str]) -> bool:
    return _only_known_git_options(
        arguments,
        flags=_GIT_STATUS_FLAGS,
        value_options=frozenset(),
    )


def _safe_git_tag(arguments: Sequence[str]) -> bool:
    if not arguments:
        return True
    list_mode = False
    index = 0
    while index < len(arguments):
        argument = arguments[index]
        if argument == "--":
            return list_mode
        if not argument.startswith("-"):
            if not list_mode:
                return False
            index += 1
            continue
        if argument in _GIT_TAG_FLAGS:
            list_mode = True
            index += 1
            continue
        value = _option_value(argument, arguments, index, _GIT_TAG_VALUE_OPTIONS)
        if value is None:
            return False
        index += 1 if "=" in argument else 2
    return True


def _only_known_git_options(
    arguments: Sequence[str],
    *,
    flags: frozenset[str],
    value_options: frozenset[str],
    numeric_short_option: bool = False,
) -> bool:
    index = 0
    while index < len(arguments):
        argument = arguments[index]
        if argument == "--":
            return True
        if not argument.startswith("-"):
            index += 1
            continue
        if numeric_short_option and argument[1:].isdigit():
            index += 1
            continue
        if argument in flags:
            index += 1
            continue
        value = _option_value(argument, arguments, index, value_options)
        if value is None:
            return False
        index += 1 if "=" in argument else 2
    return True


def _option_value(
    argument: str,
    arguments: Sequence[str],
    index: int,
    option_names: frozenset[str],
) -> str | None:
    for option in option_names:
        if argument == option:
            if index + 1 >= len(arguments):
                return None
            return arguments[index + 1]
        if argument.startswith(f"{option}="):
            return argument.removeprefix(f"{option}=")
    return None


class CommandExecutor:
    def __init__(
        self,
        config: CommandExecutorConfig,
        *,
        environ: Mapping[str, str] | None = None,
    ) -> None:
        self.config = config
        self.policy = CommandPolicy(config.mode)
        self._environ = os.environ if environ is None else environ
        self._roots = tuple(path.expanduser().resolve() for path in config.allowed_roots)

    async def execute(
        self,
        request: CommandRequest,
        *,
        approved: bool = False,
        require_approval: bool = False,
    ) -> CommandExecutionResult:
        execution_id = secrets.token_hex(8)
        started_at = datetime.now(UTC)
        started = time.monotonic()
        policy = self.policy.evaluate(request)
        command_display = _command_display(request)
        cwd_error = self._validate_cwd(request.cwd)
        if cwd_error is not None:
            policy = CommandPolicyResult(
                decision=CommandPolicyDecision.DENY,
                reason=cwd_error,
                matched_rule="cwd:outside-allowed-roots",
            )
        elif require_approval and policy.decision is not CommandPolicyDecision.DENY:
            policy = CommandPolicyResult(
                decision=CommandPolicyDecision.REQUIRE_APPROVAL,
                reason="The calling workflow requires explicit approval for this command.",
                matched_rule="workflow:explicit-approval",
            )
        if policy.decision is CommandPolicyDecision.DENY:
            return _non_execution_result(
                execution_id,
                request,
                policy,
                approved,
                CommandExecutionStatus.DENIED,
                command_display,
                started_at,
                started,
                policy.reason,
            )
        if policy.decision is CommandPolicyDecision.REQUIRE_APPROVAL and not approved:
            return _non_execution_result(
                execution_id,
                request,
                policy,
                approved,
                CommandExecutionStatus.APPROVAL_REQUIRED,
                command_display,
                started_at,
                started,
                policy.reason,
            )
        return await self._run(
            execution_id,
            request,
            policy,
            approved,
            command_display,
            started_at,
            started,
        )

    def _validate_cwd(self, cwd: Path) -> str | None:
        resolved = cwd.expanduser().resolve()
        if not resolved.is_dir():
            return f"Command working directory is not an existing directory: {resolved}"
        if not any(resolved.is_relative_to(root) for root in self._roots):
            return f"Command working directory is outside configured roots: {resolved}"
        return None

    async def _run(
        self,
        execution_id: str,
        request: CommandRequest,
        policy: CommandPolicyResult,
        approved: bool,
        command_display: str,
        started_at: datetime,
        started: float,
    ) -> CommandExecutionResult:
        cwd = request.cwd.expanduser().resolve()
        harden_git = _should_harden_git_execution(request, policy)
        environment = self._environment(request, harden_git=harden_git)
        try:
            program, arguments = _program_and_arguments(request, harden_git=harden_git)
            process = await asyncio.create_subprocess_exec(
                program,
                *arguments,
                cwd=cwd,
                env=environment,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                start_new_session=os.name != "nt",
                creationflags=(subprocess.CREATE_NEW_PROCESS_GROUP if os.name == "nt" else 0),
            )
        except OSError as error:
            return _non_execution_result(
                execution_id,
                request,
                policy,
                approved,
                CommandExecutionStatus.EXECUTION_ERROR,
                command_display,
                started_at,
                started,
                str(error),
            )

        output_directory = self.config.output_directory.expanduser().resolve()
        output_directory.mkdir(parents=True, exist_ok=True)
        stdout_task = asyncio.create_task(
            _capture_output(
                process.stdout,
                output_directory / f"{execution_id}.stdout.log",
                request.max_output_bytes,
                request.max_output_lines,
            )
        )
        stderr_task = asyncio.create_task(
            _capture_output(
                process.stderr,
                output_directory / f"{execution_id}.stderr.log",
                request.max_output_bytes,
                request.max_output_lines,
            )
        )
        timed_out = False
        try:
            await asyncio.wait_for(process.wait(), timeout=request.timeout_seconds)
        except TimeoutError:
            timed_out = True
            _terminate_process(process)
            await process.wait()
        except asyncio.CancelledError:
            _terminate_process(process)
            await process.wait()
            await asyncio.gather(stdout_task, stderr_task)
            raise
        stdout, stderr = await asyncio.gather(stdout_task, stderr_task)
        if timed_out:
            status = CommandExecutionStatus.TIMED_OUT
            error = f"Command timed out after {request.timeout_seconds:g} seconds."
        elif process.returncode == 0:
            status = CommandExecutionStatus.COMPLETED
            error = None
        else:
            status = CommandExecutionStatus.FAILED
            error = f"Command exited with code {process.returncode}."
        finished_at = datetime.now(UTC)
        return CommandExecutionResult(
            execution_id=execution_id,
            request=request,
            policy=policy,
            approved=approved,
            status=status,
            command_display=command_display,
            started_at=started_at,
            finished_at=finished_at,
            duration_ms=max(0, round((time.monotonic() - started) * 1000)),
            exit_code=process.returncode,
            stdout_preview=stdout.preview,
            stderr_preview=stderr.preview,
            stdout_path=stdout.path,
            stderr_path=stderr.path,
            stdout_truncated=stdout.truncated,
            stderr_truncated=stderr.truncated,
            error=error,
        )

    def _environment(self, request: CommandRequest, *, harden_git: bool = False) -> dict[str, str]:
        names = list(self.config.inherited_environment)
        if (
            isinstance(request, ProcessCommandRequest)
            and _executable_name(request.executable) == "gh"
        ):
            names.extend(_GH_ENVIRONMENT)
        environment = {
            name: value for name in names if (value := self._environ.get(name)) is not None
        }
        if harden_git:
            environment.update(_GIT_HARDENING_ENVIRONMENT)
        return environment


def _program_and_arguments(
    request: CommandRequest,
    *,
    harden_git: bool = False,
) -> tuple[str, Sequence[str]]:
    if isinstance(request, ProcessCommandRequest):
        if harden_git:
            return request.executable, _hardened_git_arguments(request.arguments)
        return request.executable, request.arguments
    if os.name == "nt":
        return (
            "powershell.exe",
            [
                "-NoLogo",
                "-NoProfile",
                "-NonInteractive",
                "-Command",
                request.command,
            ],
        )
    return os.environ.get("SHELL", "/bin/sh"), ["-lc", request.command]


def _should_harden_git_execution(
    request: CommandRequest,
    policy: CommandPolicyResult,
) -> bool:
    return (
        isinstance(request, ProcessCommandRequest)
        and _executable_name(request.executable) == "git"
        and policy.decision is CommandPolicyDecision.ALLOW
        and policy.matched_rule is not None
        and policy.matched_rule.startswith("safe:git-")
    )


def _hardened_git_arguments(arguments: Sequence[str]) -> list[str]:
    hardened_arguments: list[str] = []
    for item in _GIT_HARDENING_CONFIG:
        hardened_arguments.extend(("-c", item))
    hardened_arguments.append("--no-pager")
    if arguments and arguments[0] == "--no-pager":
        arguments = arguments[1:]
    if arguments and arguments[0] in {"diff", "log", "show"}:
        return [
            *hardened_arguments,
            arguments[0],
            "--no-ext-diff",
            "--no-textconv",
            *arguments[1:],
        ]
    return [*hardened_arguments, *arguments]


def _command_display(request: CommandRequest) -> str:
    if isinstance(request, ShellCommandRequest):
        return request.command
    values = [request.executable, *request.arguments]
    if os.name == "nt":
        return subprocess.list2cmdline(values)
    return shlex.join(values)


def _terminate_process(process: asyncio.subprocess.Process) -> None:
    if process.returncode is not None:
        return
    if os.name != "nt":
        try:
            os.killpg(process.pid, signal.SIGKILL)
            return
        except ProcessLookupError:
            return
        except OSError:
            pass
    if process.returncode is None:
        process.kill()


async def _capture_output(
    stream: asyncio.StreamReader | None,
    path: Path,
    max_bytes: int,
    max_lines: int,
) -> _CapturedOutput:
    if stream is None:
        return _CapturedOutput(preview="", path=None, truncated=False)
    tail = bytearray()
    total_bytes = 0
    with path.open("wb") as handle:
        while chunk := await stream.read(64 * 1024):
            handle.write(chunk)
            total_bytes += len(chunk)
            tail.extend(chunk)
            if len(tail) > max_bytes * 2:
                del tail[: len(tail) - max_bytes * 2]
    text = bytes(tail).decode("utf-8", errors="replace")
    lines = text.splitlines()
    line_truncated = len(lines) > max_lines
    if line_truncated:
        lines = lines[-max_lines:]
    preview = "\n".join(lines)
    encoded = preview.encode("utf-8")
    byte_truncated = total_bytes > max_bytes or len(encoded) > max_bytes
    if len(encoded) > max_bytes:
        preview = encoded[-max_bytes:].decode("utf-8", errors="replace")
    truncated = byte_truncated or line_truncated
    if not truncated:
        path.unlink(missing_ok=True)
        return _CapturedOutput(preview=preview, path=None, truncated=False)
    return _CapturedOutput(preview=preview, path=path, truncated=True)


def _non_execution_result(
    execution_id: str,
    request: CommandRequest,
    policy: CommandPolicyResult,
    approved: bool,
    status: CommandExecutionStatus,
    command_display: str,
    started_at: datetime,
    started: float,
    error: str,
) -> CommandExecutionResult:
    finished_at = datetime.now(UTC)
    return CommandExecutionResult(
        execution_id=execution_id,
        request=request,
        policy=policy,
        approved=approved,
        status=status,
        command_display=command_display,
        started_at=started_at,
        finished_at=finished_at,
        duration_ms=max(0, round((time.monotonic() - started) * 1000)),
        error=error,
    )
