from __future__ import annotations

from enum import StrEnum
from pathlib import Path

from pydantic import BaseModel, ConfigDict, Field, model_validator


class ContractModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class ArtifactKind(StrEnum):
    FILE = "file"
    DIRECTORY = "directory"
    ARCHIVE = "archive"


class ArtifactInput(ContractModel):
    path: Path
    kind: ArtifactKind


def _new_artifact_inputs() -> list[ArtifactInput]:
    return []


class AnalysisRequest(ContractModel):
    issue: str | None = None
    artifacts: list[ArtifactInput] = Field(default_factory=_new_artifact_inputs)
    project_root: Path | None = None
    revision: str | None = None
    question: str | None = None

    @model_validator(mode="after")
    def require_an_input(self) -> AnalysisRequest:
        if not self.issue and not self.artifacts and not self.question:
            raise ValueError("At least one of issue, artifacts, or question is required")
        return self


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
