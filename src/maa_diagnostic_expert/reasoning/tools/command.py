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
        if arguments == ["--version"]:
            return "safe:git-version"
        filtered = [argument for argument in arguments if argument != "--no-pager"]
        if filtered and filtered[0] in _SAFE_GIT_COMMANDS:
            if filtered[0] == "branch" and len(filtered) > 1 and filtered[1] != "--show-current":
                return None
            if filtered[0] == "tag" and len(filtered) > 1 and filtered[1] not in {"--list", "-l"}:
                return None
            return f"safe:git-{filtered[0]}"
        return None
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
        environment = self._environment(request)
        try:
            program, arguments = _program_and_arguments(request)
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

    def _environment(self, request: CommandRequest) -> dict[str, str]:
        names = list(self.config.inherited_environment)
        if (
            isinstance(request, ProcessCommandRequest)
            and _executable_name(request.executable) == "gh"
        ):
            names.extend(_GH_ENVIRONMENT)
        return {name: value for name in names if (value := self._environ.get(name)) is not None}


def _program_and_arguments(request: CommandRequest) -> tuple[str, Sequence[str]]:
    if isinstance(request, ProcessCommandRequest):
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
