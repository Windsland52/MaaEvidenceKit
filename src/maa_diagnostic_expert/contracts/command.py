from __future__ import annotations

from datetime import datetime
from enum import StrEnum
from pathlib import Path
from typing import Annotated, Literal

from pydantic import Field, field_validator

from .domain import ContractModel


class CommandToolMode(StrEnum):
    DISABLED = "disabled"
    SAFE = "safe"
    TRUSTED = "trusted"


class CommandKind(StrEnum):
    PROCESS = "process"
    SHELL = "shell"


class CommandPolicyDecision(StrEnum):
    ALLOW = "allow"
    REQUIRE_APPROVAL = "require_approval"
    DENY = "deny"


class CommandExecutionStatus(StrEnum):
    COMPLETED = "completed"
    FAILED = "failed"
    TIMED_OUT = "timed_out"
    APPROVAL_REQUIRED = "approval_required"
    DENIED = "denied"
    EXECUTION_ERROR = "execution_error"


class ProcessCommandRequest(ContractModel):
    api_version: Literal["process-command-request/v1"] = "process-command-request/v1"
    kind: Literal[CommandKind.PROCESS] = CommandKind.PROCESS
    executable: str = Field(min_length=1, max_length=1024)
    arguments: list[str] = Field(default_factory=list, max_length=256)
    cwd: Path
    timeout_seconds: float = Field(default=60, gt=0, le=3600)
    max_output_bytes: int = Field(default=100_000, ge=1024, le=10_000_000)
    max_output_lines: int = Field(default=2000, ge=10, le=100_000)

    @field_validator("executable")
    @classmethod
    def normalize_executable(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("Process executable must not be blank")
        return normalized


class ShellCommandRequest(ContractModel):
    api_version: Literal["shell-command-request/v1"] = "shell-command-request/v1"
    kind: Literal[CommandKind.SHELL] = CommandKind.SHELL
    command: str = Field(min_length=1, max_length=100_000)
    cwd: Path
    timeout_seconds: float = Field(default=60, gt=0, le=3600)
    max_output_bytes: int = Field(default=100_000, ge=1024, le=10_000_000)
    max_output_lines: int = Field(default=2000, ge=10, le=100_000)

    @field_validator("command")
    @classmethod
    def reject_blank_command(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("Shell command must not be blank")
        return value


CommandRequest = Annotated[
    ProcessCommandRequest | ShellCommandRequest,
    Field(discriminator="kind"),
]


class CommandPolicyResult(ContractModel):
    api_version: Literal["command-policy-result/v1"] = "command-policy-result/v1"
    decision: CommandPolicyDecision
    reason: str = Field(min_length=1)
    matched_rule: str | None = None


class CommandExecutionResult(ContractModel):
    api_version: Literal["command-execution-result/v1"] = "command-execution-result/v1"
    execution_id: str = Field(min_length=1)
    request: CommandRequest
    policy: CommandPolicyResult
    approved: bool = False
    status: CommandExecutionStatus
    command_display: str = Field(min_length=1)
    started_at: datetime
    finished_at: datetime
    duration_ms: int = Field(ge=0)
    exit_code: int | None = None
    stdout_preview: str = ""
    stderr_preview: str = ""
    stdout_path: Path | None = None
    stderr_path: Path | None = None
    stdout_truncated: bool = False
    stderr_truncated: bool = False
    error: str | None = None
