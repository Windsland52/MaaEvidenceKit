from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import Field, field_validator, model_validator

from .domain import ContractModel, DiagnosisStatus


def _new_strings() -> list[str]:
    return []


def _new_indexes() -> list[int]:
    return []


class BenchmarkEvidenceRequirement(ContractModel):
    evidence_id: str = Field(min_length=1)
    kind: str = Field(min_length=1)
    source_ref: str = Field(min_length=1)
    description: str = Field(min_length=1)
    line_start: int | None = Field(default=None, ge=1)
    line_end: int | None = Field(default=None, ge=1)

    @model_validator(mode="after")
    def validate_line_range(self) -> BenchmarkEvidenceRequirement:
        if self.line_end is not None and self.line_start is None:
            raise ValueError("Benchmark evidence line_end requires line_start")
        if self.line_start is not None and self.line_end is not None:
            if self.line_end < self.line_start:
                raise ValueError("Benchmark evidence line_end must not precede line_start")
        return self


class BenchmarkProvenance(ContractModel):
    kind: str = Field(min_length=1)
    source_ref: str = Field(min_length=1)
    description: str = Field(min_length=1)


class BenchmarkPayload(ContractModel):
    sha256: str = Field(pattern=r"^[0-9a-f]{64}$")
    media_type: str = Field(min_length=1)
    size_bytes: int = Field(ge=0)
    label: str = Field(min_length=1)


class BenchmarkIssueSnapshot(ContractModel):
    issue_url: str = Field(pattern=r"^https://github\.com/[^/]+/[^/]+/issues/[0-9]+$")
    snapshot_revision: str = Field(pattern=r"^[0-9a-f]{64}$")
    payload: BenchmarkPayload

    @model_validator(mode="after")
    def validate_snapshot_hash(self) -> BenchmarkIssueSnapshot:
        if self.snapshot_revision != self.payload.sha256:
            raise ValueError("Benchmark issue snapshot revision must match its payload SHA-256")
        return self


class BenchmarkArtifact(ContractModel):
    artifact_id: str = Field(pattern=r"^[0-9a-f]{64}$")
    source_url: str = Field(pattern=r"^https://github\.com/")
    filename: str = Field(min_length=1)
    payload: BenchmarkPayload
    captured_at: datetime
    privacy_review: Literal["pass"]
    redistribution: Literal["download_only", "redistributable"]
    required: bool


class BenchmarkCase(ContractModel):
    """Observation-cutoff manifest; payloads remain external and hash-addressed."""

    schema_version: Literal["1.0.0"] = "1.0.0"
    case_id: str = Field(pattern=r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
    source_candidate_id: str = Field(min_length=1)
    project_id: str = Field(min_length=1)
    repository: str = Field(pattern=r"^[^/\s]+/[^/\s]+$")
    issue_number: int = Field(ge=1)
    tier: Literal["gold", "silver"]
    split: Literal["stable", "development", "holdout"]
    difficulty: Literal["l1", "l2", "l3"]
    observation_cutoff: datetime
    annotation_cutoff: datetime
    visible_issue_snapshot: BenchmarkIssueSnapshot
    visible_artifacts: list[BenchmarkArtifact] = Field(min_length=1)
    issue_source_revision: str = Field(pattern=r"^[0-9a-f]{40}$")
    tasks: list[Literal["diagnose_at_report_time"]] = Field(min_length=1)
    coverage_tags: list[str] = Field(min_length=1)

    @model_validator(mode="after")
    def validate_case(self) -> BenchmarkCase:
        if self.annotation_cutoff < self.observation_cutoff:
            raise ValueError("Benchmark annotation cutoff cannot precede observation cutoff")
        artifact_ids = [item.artifact_id for item in self.visible_artifacts]
        if len(artifact_ids) != len(set(artifact_ids)):
            raise ValueError("Benchmark artifact IDs must be unique")
        if len(self.tasks) != len(set(self.tasks)):
            raise ValueError("Benchmark tasks must be unique")
        if len(self.coverage_tags) != len(set(self.coverage_tags)):
            raise ValueError("Benchmark coverage tags must be unique")
        return self


class BenchmarkAnnotation(ContractModel):
    """Gold annotation kept outside the system-under-test input surface."""

    schema_version: Literal["1.0.0"] = "1.0.0"
    case_id: str = Field(min_length=1)
    reported_symptom: str = Field(min_length=1)
    observed_mechanism: str = Field(min_length=1)
    initiating_trigger: str = Field(min_length=1)
    root_cause: str = Field(min_length=1)
    required_evidence: list[BenchmarkEvidenceRequirement] = Field(min_length=1)
    required_absences: list[str] = Field(default_factory=_new_strings)
    acceptable_conclusions: list[str] = Field(min_length=1)
    forbidden_claims: list[str] = Field(default_factory=_new_strings)
    missing_evidence: list[str] = Field(default_factory=_new_strings)
    fix_direction: str = Field(min_length=1)
    provenance: list[BenchmarkProvenance] = Field(min_length=1)
    annotators: list[str] = Field(min_length=1)
    adjudication: str = Field(min_length=1)

    @field_validator(
        "required_absences",
        "acceptable_conclusions",
        "forbidden_claims",
        "missing_evidence",
        "annotators",
    )
    @classmethod
    def validate_unique_strings(cls, value: list[str]) -> list[str]:
        if any(not item.strip() for item in value):
            raise ValueError("Benchmark annotation list items must not be blank")
        if len(value) != len(set(value)):
            raise ValueError("Benchmark annotation list items must be unique")
        return value

    @model_validator(mode="after")
    def validate_evidence_ids(self) -> BenchmarkAnnotation:
        evidence_ids = [item.evidence_id for item in self.required_evidence]
        if len(evidence_ids) != len(set(evidence_ids)):
            raise ValueError("Benchmark required evidence IDs must be unique")
        return self


class BenchmarkJudgmentDraft(ContractModel):
    """Judge-model output; Python validates every reference before scoring."""

    api_version: Literal["benchmark-judgment-draft/v1"] = "benchmark-judgment-draft/v1"
    case_id: str = Field(min_length=1)
    covered_required_evidence_ids: list[str] = Field(default_factory=_new_strings)
    matched_acceptable_conclusion_indexes: list[int] = Field(default_factory=_new_indexes)
    matched_required_absence_indexes: list[int] = Field(default_factory=_new_indexes)
    violated_forbidden_claim_indexes: list[int] = Field(default_factory=_new_indexes)
    acknowledged_missing_evidence_indexes: list[int] = Field(default_factory=_new_indexes)
    separates_diagnostic_layers: bool
    citations_traceable: bool
    rationale: str = Field(min_length=1)

    @field_validator(
        "covered_required_evidence_ids",
        "matched_acceptable_conclusion_indexes",
        "matched_required_absence_indexes",
        "violated_forbidden_claim_indexes",
        "acknowledged_missing_evidence_indexes",
    )
    @classmethod
    def validate_unique_references[ItemT](cls, value: list[ItemT]) -> list[ItemT]:
        if len(value) != len(set(value)):
            raise ValueError("Benchmark judgment references must be unique")
        return value


class BenchmarkMetrics(ContractModel):
    required_evidence_coverage: float = Field(ge=0, le=1)
    acceptable_conclusion_coverage: float = Field(ge=0, le=1)
    required_absence_coverage: float = Field(ge=0, le=1)
    missing_evidence_coverage: float = Field(ge=0, le=1)
    diagnostic_layer_score: float = Field(ge=0, le=1)
    citation_traceability_score: float = Field(ge=0, le=1)
    forbidden_claim_penalty: float = Field(ge=0, le=1)


class BenchmarkRubricCounts(ContractModel):
    required_evidence: int = Field(ge=1)
    acceptable_conclusions: int = Field(ge=1)
    required_absences: int = Field(ge=0)
    forbidden_claims: int = Field(ge=0)
    missing_evidence: int = Field(ge=0)


class BenchmarkResult(ContractModel):
    api_version: Literal["benchmark-result/v1"] = "benchmark-result/v1"
    case_id: str = Field(min_length=1)
    diagnosis_sha256: str = Field(pattern=r"^[0-9a-f]{64}$")
    diagnosis_status: DiagnosisStatus
    judgment: BenchmarkJudgmentDraft
    rubric_counts: BenchmarkRubricCounts
    metrics: BenchmarkMetrics
    score: float = Field(ge=0, le=1)
    pass_threshold: float = Field(ge=0, le=1)
    passed: bool

    @model_validator(mode="after")
    def validate_identity(self) -> BenchmarkResult:
        if self.case_id != self.judgment.case_id:
            raise ValueError("Benchmark result and judgment case IDs must match")
        counts = self.rubric_counts
        references = (
            (
                self.judgment.matched_acceptable_conclusion_indexes,
                counts.acceptable_conclusions,
            ),
            (self.judgment.matched_required_absence_indexes, counts.required_absences),
            (self.judgment.violated_forbidden_claim_indexes, counts.forbidden_claims),
            (
                self.judgment.acknowledged_missing_evidence_indexes,
                counts.missing_evidence,
            ),
        )
        if len(self.judgment.covered_required_evidence_ids) > counts.required_evidence:
            raise ValueError("Benchmark result covers more required evidence than the rubric")
        if any(
            any(index < 0 or index >= length for index in indexes) for indexes, length in references
        ):
            raise ValueError("Benchmark result contains an out-of-range rubric index")
        expected_metrics = BenchmarkMetrics(
            required_evidence_coverage=_coverage(
                len(self.judgment.covered_required_evidence_ids), counts.required_evidence
            ),
            acceptable_conclusion_coverage=_coverage(
                len(self.judgment.matched_acceptable_conclusion_indexes),
                counts.acceptable_conclusions,
            ),
            required_absence_coverage=_coverage(
                len(self.judgment.matched_required_absence_indexes), counts.required_absences
            ),
            missing_evidence_coverage=_coverage(
                len(self.judgment.acknowledged_missing_evidence_indexes), counts.missing_evidence
            ),
            diagnostic_layer_score=float(self.judgment.separates_diagnostic_layers),
            citation_traceability_score=float(self.judgment.citations_traceable),
            forbidden_claim_penalty=min(
                1.0, 0.25 * len(self.judgment.violated_forbidden_claim_indexes)
            ),
        )
        if self.metrics != expected_metrics:
            raise ValueError("Benchmark result metrics do not match judgment references")
        base_score = (
            0.30 * expected_metrics.required_evidence_coverage
            + 0.30 * expected_metrics.acceptable_conclusion_coverage
            + 0.10 * expected_metrics.required_absence_coverage
            + 0.10 * expected_metrics.missing_evidence_coverage
            + 0.10 * expected_metrics.diagnostic_layer_score
            + 0.10 * expected_metrics.citation_traceability_score
        )
        expected_score = round(max(0.0, base_score - expected_metrics.forbidden_claim_penalty), 6)
        if self.score != expected_score:
            raise ValueError("Benchmark result score does not match its metrics")
        expected_pass = (
            self.diagnosis_status is DiagnosisStatus.COMPLETE
            and not self.judgment.violated_forbidden_claim_indexes
            and self.score >= self.pass_threshold
        )
        if self.passed != expected_pass:
            raise ValueError("Benchmark pass decision does not match score and diagnosis status")
        return self


def _coverage(matched: int, total: int) -> float:
    return 1.0 if total == 0 else matched / total
