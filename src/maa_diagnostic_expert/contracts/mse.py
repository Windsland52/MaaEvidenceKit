from enum import StrEnum
from pathlib import Path

from pydantic import Field, JsonValue

from .domain import ContractModel


def _new_strings() -> list[str]:
    return []


class MseCompatibilityStatus(StrEnum):
    SUPPORTED = "supported"
    PARTIAL = "partial"
    UNSUPPORTED = "unsupported"


class MseCompatibility(ContractModel):
    status: MseCompatibilityStatus
    reason: str = Field(min_length=1)


class MseTaskBinding(ContractModel):
    name: str = Field(min_length=1)
    entry: str | None = None


class MseConfigurationSummary(ContractModel):
    controller: str | None = None
    resource: str | None = None
    resource_paths: list[str] = Field(default_factory=_new_strings)
    task_count: int = Field(ge=0)
    pipeline_file_count: int = Field(ge=0)
    diagnostic_count: int = Field(ge=0)
    error_count: int = Field(ge=0)
    warning_count: int = Field(ge=0)


class MseDiagnostic(ContractModel):
    type: str = Field(min_length=1)
    level: str = Field(pattern="^(warning|error)$")
    source_path: str = Field(min_length=1)
    line: int = Field(ge=1)
    column: int = Field(ge=1)
    length: int = Field(ge=0)
    message: str = Field(min_length=1)
    controller: str | None = None
    resource: str | None = None


class MseProjectPreflightResult(ContractModel):
    schema_version: str = "mde-mse-project-preflight/v1"
    project_root: Path
    interface_path: str | None = None
    syntax_mode: str = Field(pattern="^(maafw|maa_unsupported)$")
    compatibility: MseCompatibility
    controllers: list[str] = Field(default_factory=_new_strings)
    resources: list[str] = Field(default_factory=_new_strings)
    task_bindings: list[MseTaskBinding] = Field(default_factory=list[MseTaskBinding])
    configurations: list[MseConfigurationSummary] = Field(
        default_factory=list[MseConfigurationSummary]
    )
    configurations_truncated: bool = False
    diagnostics: list[MseDiagnostic] = Field(default_factory=list[MseDiagnostic])
    diagnostics_truncated: bool = False
    warnings: list[str] = Field(default_factory=_new_strings)


class MseTaskDefinition(ContractModel):
    source_path: str = Field(min_length=1)
    line: int = Field(ge=1)
    column: int = Field(ge=1)
    raw_config: dict[str, JsonValue] = Field(default_factory=dict[str, JsonValue])


class MseTaskReference(ContractModel):
    kind: str = Field(min_length=1)
    target: str = Field(min_length=1)
    source_path: str = Field(min_length=1)
    line: int = Field(ge=1)
    column: int = Field(ge=1)


class MseResolvedTask(ContractModel):
    name: str = Field(min_length=1)
    controller: str | None = None
    resource: str | None = None
    found: bool
    definitions: list[MseTaskDefinition] = Field(default_factory=list[MseTaskDefinition])
    effective_config: dict[str, JsonValue] = Field(default_factory=dict[str, JsonValue])
    references: list[MseTaskReference] = Field(default_factory=list[MseTaskReference])


class MseTaskResolutionResult(ContractModel):
    schema_version: str = "mde-mse-task-resolution/v1"
    project_root: Path
    interface_path: str | None = None
    compatibility: MseCompatibility
    requested_tasks: list[str] = Field(min_length=1)
    resolutions: list[MseResolvedTask] = Field(default_factory=list[MseResolvedTask])
    configurations_truncated: bool = False
    warnings: list[str] = Field(default_factory=_new_strings)
