from __future__ import annotations

from datetime import datetime
from enum import StrEnum
from pathlib import Path

from pydantic import BaseModel, ConfigDict, Field, JsonValue, model_validator


class ContractModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class ArtifactKind(StrEnum):
    FILE = "file"
    DIRECTORY = "directory"
    ARCHIVE = "archive"


class ArtifactAvailability(StrEnum):
    AVAILABLE = "available"
    MISSING = "missing"
    TYPE_MISMATCH = "type_mismatch"
    UNREADABLE = "unreadable"


class ArtifactMediaKind(StrEnum):
    LOG = "log"
    CONFIGURATION = "configuration"
    ARCHIVE = "archive"
    IMAGE = "image"
    DUMP = "dump"
    TEXT = "text"
    OTHER = "other"


class ArtifactInput(ContractModel):
    path: Path
    kind: ArtifactKind


def _new_artifact_inputs() -> list[ArtifactInput]:
    return []


class SourceRole(StrEnum):
    PROJECT = "project"
    MAA_FRAMEWORK = "maa_framework"
    GUI = "gui"
    AGENT = "agent"
    AUXILIARY = "auxiliary"


class SourceInput(ContractModel):
    source_id: str = Field(min_length=1)
    role: SourceRole
    path: Path
    revision: str | None = None


def _new_source_inputs() -> list[SourceInput]:
    return []


class AnalysisRequest(ContractModel):
    api_version: str = "analysis-request/v2"
    issue: str | None = None
    artifacts: list[ArtifactInput] = Field(default_factory=_new_artifact_inputs)
    sources: list[SourceInput] = Field(default_factory=_new_source_inputs)
    question: str | None = None

    @model_validator(mode="after")
    def require_an_input(self) -> AnalysisRequest:
        if not self.issue and not self.artifacts and not self.question:
            raise ValueError("At least one of issue, artifacts, or question is required")
        source_ids = [source.source_id for source in self.sources]
        if len(source_ids) != len(set(source_ids)):
            raise ValueError("Source IDs must be unique")
        return self


class ArtifactRecord(ContractModel):
    id: str = Field(min_length=1)
    input_path: Path
    path: Path
    kind: ArtifactKind
    media_kind: ArtifactMediaKind
    availability: ArtifactAvailability
    size_bytes: int | None = Field(default=None, ge=0)
    modified_at: datetime | None = None


class RevisionResolutionStatus(StrEnum):
    NOT_REQUESTED = "not_requested"
    RESOLVED = "resolved"
    UNRESOLVED = "unresolved"
    NOT_A_GIT_REPOSITORY = "not_a_git_repository"

    PATH_MISSING = "path_missing"
    NOT_A_DIRECTORY = "not_a_directory"


class SourceSnapshot(ContractModel):
    source_id: str = Field(min_length=1)
    role: SourceRole
    path: Path
    requested_revision: str | None = None
    resolved_revision: str | None = None
    current_revision: str | None = None
    resolution_status: RevisionResolutionStatus


class MissingEvidence(ContractModel):
    code: str = Field(min_length=1)
    message: str = Field(min_length=1)
    source_id: str | None = None
    source_path: Path | None = None
    required: bool = True


class EvidenceReliability(StrEnum):
    PRIMARY = "primary"
    SECONDARY = "secondary"
    CONTEXT = "context"


class Evidence(ContractModel):
    id: str = Field(min_length=1)
    kind: str = Field(min_length=1)
    source_component: str = Field(min_length=1)
    source_path: str = Field(min_length=1)
    content: str = Field(min_length=1)
    line_start: int | None = Field(default=None, ge=1)
    line_end: int | None = Field(default=None, ge=1)
    task_id: int | None = None
    reliability: EvidenceReliability = EvidenceReliability.PRIMARY

    @model_validator(mode="after")
    def validate_line_range(self) -> Evidence:
        if self.line_start is not None and self.line_end is not None:
            if self.line_end < self.line_start:
                raise ValueError("line_end must be greater than or equal to line_start")
        return self


def _new_artifact_records() -> list[ArtifactRecord]:
    return []


def _new_prepared_evidence() -> list[Evidence]:
    return []


def _new_missing_evidence() -> list[MissingEvidence]:
    return []


def _new_source_snapshots() -> list[SourceSnapshot]:
    return []


class PreparedAnalysis(ContractModel):
    api_version: str = "prepared-analysis/v2"
    request: AnalysisRequest
    artifacts: list[ArtifactRecord] = Field(default_factory=_new_artifact_records)
    source_snapshots: list[SourceSnapshot] = Field(default_factory=_new_source_snapshots)
    evidence: list[Evidence] = Field(default_factory=_new_prepared_evidence)
    missing_evidence: list[MissingEvidence] = Field(default_factory=_new_missing_evidence)


class EvidenceQuery(ContractModel):
    source_path: Path
    line_start: int = Field(ge=1)
    line_end: int = Field(ge=1)
    reason: str = Field(min_length=1)

    @model_validator(mode="after")
    def validate_line_range(self) -> EvidenceQuery:
        if self.line_end < self.line_start:
            raise ValueError("line_end must be greater than or equal to line_start")
        if self.line_end - self.line_start + 1 > 400:
            raise ValueError("Evidence queries are limited to 400 lines")
        return self


class EvidenceWindow(ContractModel):
    api_version: str = "evidence-window/v1"
    evidence: Evidence
    requested_line_start: int = Field(ge=1)
    requested_line_end: int = Field(ge=1)
    has_more_before: bool
    has_more_after: bool
    truncated: bool = False


class Conclusion(ContractModel):
    statement: str = Field(min_length=1)
    evidence_ids: list[str] = Field(min_length=1)
    confidence: float = Field(ge=0, le=1)


class DiagnosisStatus(StrEnum):
    COMPLETE = "complete"
    INSUFFICIENT_EVIDENCE = "insufficient_evidence"
    NOT_APPLICABLE = "not_applicable"
    FAILED = "failed"


def _new_evidence_items() -> list[Evidence]:
    return []


def _new_conclusions() -> list[Conclusion]:
    return []


class DiagnosisResult(ContractModel):
    api_version: str = "diagnosis/v2"
    status: DiagnosisStatus
    summary: str = Field(min_length=1)
    evidence: list[Evidence] = Field(default_factory=_new_evidence_items)
    conclusions: list[Conclusion] = Field(default_factory=_new_conclusions)
    missing_evidence: list[str] = Field(default_factory=list)

    @model_validator(mode="after")
    def require_known_evidence_references(self) -> DiagnosisResult:
        known_ids = {item.id for item in self.evidence}
        referenced_ids = {
            evidence_id
            for conclusion in self.conclusions
            for evidence_id in conclusion.evidence_ids
        }
        unknown_ids = referenced_ids - known_ids
        if unknown_ids:
            unknown = ", ".join(sorted(unknown_ids))
            raise ValueError(f"Conclusions reference unknown evidence IDs: {unknown}")
        return self


class DiagnosticEventKind(StrEnum):
    RUN_STARTED = "run_started"
    STAGE_STARTED = "stage_started"
    STAGE_COMPLETED = "stage_completed"
    EVIDENCE_ADDED = "evidence_added"
    MODEL_REQUESTED = "model_requested"
    MODEL_COMPLETED = "model_completed"
    RUN_COMPLETED = "run_completed"
    RUN_FAILED = "run_failed"


def _new_event_data() -> dict[str, JsonValue]:
    return {}


class DiagnosticEvent(ContractModel):
    api_version: str = "diagnostic-event/v1"
    run_id: str = Field(min_length=1)
    sequence: int = Field(ge=0)
    occurred_at: datetime
    kind: DiagnosticEventKind
    stage: str = Field(min_length=1)
    message: str = Field(min_length=1)
    data: dict[str, JsonValue] = Field(default_factory=_new_event_data)


def _new_reasoning_evidence_ids() -> list[str]:
    return []


class ReasoningRequest(ContractModel):
    stage: str = Field(min_length=1)
    instruction: str = Field(min_length=1)
    evidence_ids: list[str] = Field(default_factory=_new_reasoning_evidence_ids)
