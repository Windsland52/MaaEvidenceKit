from __future__ import annotations

from enum import StrEnum

from pydantic import Field

from .domain import ContractModel


class MlaCompatibilityStatus(StrEnum):
    SUPPORTED = "supported"
    UNSUPPORTED = "unsupported"


class MlaFrameworkStatus(StrEnum):
    NONE = "none"
    SINGLE = "single"
    MULTIPLE = "multiple"
    CONFLICT = "conflict"


class MlaSessionStartKind(StrEnum):
    PROCESS_START = "process_start"
    PARTIAL_FILE = "partial_file"


class MlaSessionStatus(StrEnum):
    RESOLVED = "resolved"
    MISSING_VERSION = "missing_version"
    CONFLICT = "conflict"


class MlaLogPosition(ContractModel):
    source: str = Field(min_length=1)
    path: str = Field(min_length=1)
    line: int = Field(ge=1)
    timestamp: str | None = None


class MlaVersionEvidence(MlaLogPosition):
    version: str = Field(min_length=1)


def _new_versions() -> list[str]:
    return []


def _new_version_evidence() -> list[MlaVersionEvidence]:
    return []


class MlaFrameworkSession(ContractModel):
    session_id: str = Field(min_length=1)
    start_kind: MlaSessionStartKind
    status: MlaSessionStatus
    version: str | None = None
    versions: list[str] = Field(default_factory=_new_versions)
    start: MlaLogPosition
    end: MlaLogPosition
    version_evidence: list[MlaVersionEvidence] = Field(default_factory=_new_version_evidence)


class MlaCompatibility(ContractModel):
    status: MlaCompatibilityStatus
    reason: str = Field(min_length=1)
    parser_version: str | None = None
    task_count: int = Field(ge=0)
    event_count: int = Field(ge=0)
    node_statistic_count: int = Field(ge=0)
    recognition_statistic_count: int = Field(ge=0)


def _new_sessions() -> list[MlaFrameworkSession]:
    return []


class MlaFrameworkSummary(ContractModel):
    status: MlaFrameworkStatus
    versions: list[str] = Field(default_factory=_new_versions)
    sessions: list[MlaFrameworkSession] = Field(default_factory=_new_sessions)


def _new_warnings() -> list[str]:
    return []


class MlaPreflightResult(ContractModel):
    schema_version: str = "mde-mla-preflight/v1"
    mla_schema_version: str = Field(min_length=1)
    compatibility: MlaCompatibility
    framework: MlaFrameworkSummary
    warnings: list[str] = Field(default_factory=_new_warnings)
