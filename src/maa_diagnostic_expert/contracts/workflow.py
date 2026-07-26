from __future__ import annotations

from datetime import datetime
from enum import StrEnum
from pathlib import Path
from typing import Literal

from pydantic import Field, field_validator, model_validator

from .domain import ContractModel, MissingEvidence, SourceRole


class RuntimeComponent(StrEnum):
    PROJECT = "project"
    GUI = "gui"
    MAA_FRAMEWORK = "maa_framework"


class ArtifactSourceKind(StrEnum):
    MAA_FRAMEWORK = "maa_framework"
    GUI = "gui"
    CUSTOM = "custom"
    UNKNOWN = "unknown"


class ArtifactSourceClassification(ContractModel):
    artifact_id: str = Field(min_length=1)
    path: Path
    source_kind: ArtifactSourceKind
    confidence: float = Field(ge=0, le=1)
    classifier_id: str = Field(min_length=1)
    signals: list[str] = Field(min_length=1)


def _new_artifact_classifications() -> list[ArtifactSourceClassification]:
    return []


class ArtifactSourceInventory(ContractModel):
    api_version: Literal["artifact-source-inventory/v1"] = "artifact-source-inventory/v1"
    classifications: list[ArtifactSourceClassification] = Field(
        default_factory=_new_artifact_classifications
    )

    @model_validator(mode="after")
    def require_unique_artifacts(self) -> ArtifactSourceInventory:
        artifact_ids = [item.artifact_id for item in self.classifications]
        if len(artifact_ids) != len(set(artifact_ids)):
            raise ValueError("Artifact source classifications must be unique by artifact ID")
        return self


class VersionObservationKind(StrEnum):
    OBSERVED = "observed"
    RESOLVED = "resolved"
    USER_DECLARED = "user_declared"


class RuntimeVersionObservation(ContractModel):
    component: RuntimeComponent
    version: str = Field(min_length=1)
    kind: VersionObservationKind
    source_ref: str = Field(min_length=1)
    line_number: int | None = Field(default=None, ge=1)
    evidence_id: str | None = None
    session_id: str | None = None
    observed_at: datetime | None = None
    confidence: float = Field(ge=0, le=1)


def _new_version_observations() -> list[RuntimeVersionObservation]:
    return []


class RuntimeIdentity(ContractModel):
    """Version observations remain scoped to their source and optional session."""

    api_version: Literal["runtime-identity/v1"] = "runtime-identity/v1"
    versions: list[RuntimeVersionObservation] = Field(default_factory=_new_version_observations)

    @model_validator(mode="after")
    def require_unique_evidence_ids(self) -> RuntimeIdentity:
        evidence_ids = [item.evidence_id for item in self.versions if item.evidence_id is not None]
        if len(evidence_ids) != len(set(evidence_ids)):
            raise ValueError("Runtime version evidence IDs must be unique")
        return self


class IncidentSelectionStatus(StrEnum):
    SELECTED = "selected"
    AMBIGUOUS = "ambiguous"
    NOT_FOUND = "not_found"


def _new_strings() -> list[str]:
    return []


class IncidentCandidate(ContractModel):
    candidate_id: str = Field(min_length=1)
    session_id: str | None = None
    task_id: int | None = None
    task_name: str | None = None
    node_name: str | None = None
    started_at: datetime | None = None
    ended_at: datetime | None = None
    confidence: float = Field(ge=0, le=1)
    evidence_ids: list[str] = Field(min_length=1)
    reasons: list[str] = Field(min_length=1)

    @model_validator(mode="after")
    def require_unique_evidence_ids(self) -> IncidentCandidate:
        if len(self.evidence_ids) != len(set(self.evidence_ids)):
            raise ValueError("Incident candidate evidence IDs must be unique")
        return self


def _new_incident_candidates() -> list[IncidentCandidate]:
    return []


def _new_missing_evidence() -> list[MissingEvidence]:
    return []


class IncidentSelection(ContractModel):
    api_version: Literal["incident-selection/v2"] = "incident-selection/v2"
    status: IncidentSelectionStatus
    candidates: list[IncidentCandidate] = Field(default_factory=_new_incident_candidates)
    selected_candidate_id: str | None = None
    missing_evidence: list[MissingEvidence] = Field(default_factory=_new_missing_evidence)

    @model_validator(mode="after")
    def validate_selection(self) -> IncidentSelection:
        candidate_ids = [candidate.candidate_id for candidate in self.candidates]
        if len(candidate_ids) != len(set(candidate_ids)):
            raise ValueError("Incident candidate IDs must be unique")
        if self.status is IncidentSelectionStatus.SELECTED:
            if self.selected_candidate_id not in set(candidate_ids):
                raise ValueError("Selected incident must reference a known candidate")
        elif self.selected_candidate_id is not None:
            raise ValueError("Only a selected incident may set selected_candidate_id")
        return self


class IncidentCorrelationDraft(ContractModel):
    """Model interpretation that references deterministic incident candidates."""

    api_version: Literal["incident-correlation-draft/v1"] = "incident-correlation-draft/v1"
    status: IncidentSelectionStatus
    selected_candidate_id: str | None = None
    relevant_candidate_ids: list[str] = Field(default_factory=_new_strings)
    evidence_ids: list[str] = Field(default_factory=_new_strings)
    rationale: str = Field(min_length=1)
    missing_evidence: list[str] = Field(default_factory=_new_strings)

    @model_validator(mode="after")
    def validate_draft_shape(self) -> IncidentCorrelationDraft:
        if len(self.relevant_candidate_ids) != len(set(self.relevant_candidate_ids)):
            raise ValueError("Relevant incident candidate IDs must be unique")
        if len(self.evidence_ids) != len(set(self.evidence_ids)):
            raise ValueError("Incident correlation evidence IDs must be unique")
        if self.status is IncidentSelectionStatus.SELECTED:
            if self.selected_candidate_id is None:
                raise ValueError("Selected incident correlation requires a candidate ID")
            if self.selected_candidate_id not in self.relevant_candidate_ids:
                raise ValueError("Selected candidate must also be relevant")
            if not self.evidence_ids:
                raise ValueError("Selected incident correlation requires evidence")
        elif self.selected_candidate_id is not None:
            raise ValueError("Only selected incident correlation may set a candidate ID")
        if self.status is IncidentSelectionStatus.AMBIGUOUS:
            if not self.relevant_candidate_ids:
                raise ValueError("Ambiguous incident correlation requires relevant candidates")
            if not self.evidence_ids:
                raise ValueError("Ambiguous incident correlation requires evidence")
        if self.status is IncidentSelectionStatus.NOT_FOUND and self.relevant_candidate_ids:
            raise ValueError("Not-found incident correlation cannot mark candidates relevant")
        return self


class IncidentComparisonStatus(StrEnum):
    COMPLETE = "complete"
    PARTIAL = "partial"
    UNAVAILABLE = "unavailable"


class IncidentComparisonFindingKind(StrEnum):
    ACTUAL_AND_EXPECTED_AVAILABLE = "actual_and_expected_available"
    EXPECTED_TASK_NOT_FOUND = "expected_task_not_found"
    ACTUAL_EXECUTION_ONLY = "actual_execution_only"
    NEXT_LIST_TIMEOUT_AT_RESOLVED_NODE = "next_list_timeout_at_resolved_node"
    ACTION_FAILURE_AT_RESOLVED_NODE = "action_failure_at_resolved_node"
    RECOGNITION_ACTIVITY_AT_RESOLVED_NODE = "recognition_activity_at_resolved_node"
    REPETITION_AT_RESOLVED_NODE = "repetition_at_resolved_node"


class IncidentObservedExecution(ContractModel):
    candidate_id: str = Field(min_length=1)
    session_id: str | None = None
    task_id: int | None = None
    task_name: str | None = None
    node_name: str | None = None
    failure_kinds: list[str] = Field(default_factory=_new_strings)
    outcome_kinds: list[str] = Field(default_factory=_new_strings)
    signal_kinds: list[str] = Field(default_factory=_new_strings)
    evidence_ids: list[str] = Field(default_factory=_new_strings)


class IncidentExpectedTask(ContractModel):
    source_id: str = Field(min_length=1)
    task_name: str = Field(min_length=1)
    found_variants: int = Field(ge=0)
    controllers: list[str] = Field(default_factory=_new_strings)
    resources: list[str] = Field(default_factory=_new_strings)
    recognition_types: list[str] = Field(default_factory=_new_strings)
    action_types: list[str] = Field(default_factory=_new_strings)
    next_targets: list[str] = Field(default_factory=_new_strings)
    evidence_ids: list[str] = Field(default_factory=_new_strings)


class IncidentComparisonFinding(ContractModel):
    kind: IncidentComparisonFindingKind
    statement: str = Field(min_length=1)
    observed_evidence_ids: list[str] = Field(default_factory=_new_strings)
    expected_evidence_ids: list[str] = Field(default_factory=_new_strings)


def _new_observed_executions() -> list[IncidentObservedExecution]:
    return []


def _new_expected_tasks() -> list[IncidentExpectedTask]:
    return []


def _new_comparison_findings() -> list[IncidentComparisonFinding]:
    return []


class IncidentComparison(ContractModel):
    api_version: Literal["incident-comparison/v2"] = "incident-comparison/v2"
    status: IncidentComparisonStatus
    candidate_ids: list[str] = Field(default_factory=_new_strings)
    observed_executions: list[IncidentObservedExecution] = Field(
        default_factory=_new_observed_executions
    )
    expected_tasks: list[IncidentExpectedTask] = Field(default_factory=_new_expected_tasks)
    findings: list[IncidentComparisonFinding] = Field(default_factory=_new_comparison_findings)
    missing_evidence: list[MissingEvidence] = Field(default_factory=_new_missing_evidence)


class InvestigationBranch(StrEnum):
    GUI_LOG_OVERVIEW = "gui_log_overview"
    CUSTOM_LOG_OVERVIEW = "custom_log_overview"
    MLA_GLOBAL_OVERVIEW = "mla_global_overview"
    MSE_PROJECT_PREFLIGHT = "mse_project_preflight"
    CRASH_PREFLIGHT = "crash_preflight"
    PROJECT_SOURCE = "project_source"
    GUI_SOURCE = "gui_source"
    FRAMEWORK_SOURCE = "framework_source"
    KNOWLEDGE_RESEARCH = "knowledge_research"


class BranchDisposition(StrEnum):
    RUN = "run"
    SKIP = "skip"
    UNAVAILABLE = "unavailable"
    DEFERRED = "deferred"


class AnalysisRelevance(StrEnum):
    REQUIRED = "required"
    USEFUL = "useful"
    NOT_RELEVANT = "not_relevant"
    UNAVAILABLE = "unavailable"
    UNDETERMINED = "undetermined"


class BranchDecision(ContractModel):
    branch: InvestigationBranch
    disposition: BranchDisposition
    relevance: AnalysisRelevance
    reason: str = Field(min_length=1)


def _new_branch_decisions() -> list[BranchDecision]:
    return []


class InvestigationPlan(ContractModel):
    """Deterministic plan for available, skipped, and not-yet-implemented branches."""

    api_version: Literal["investigation-plan/v1"] = "investigation-plan/v1"
    decisions: list[BranchDecision] = Field(default_factory=_new_branch_decisions)

    @model_validator(mode="after")
    def require_unique_branches(self) -> InvestigationPlan:
        branches = [decision.branch for decision in self.decisions]
        if len(branches) != len(set(branches)):
            raise ValueError("Investigation plan branches must be unique")
        return self

    def decision_for(self, branch: InvestigationBranch) -> BranchDecision:
        for decision in self.decisions:
            if decision.branch is branch:
                return decision
        raise KeyError(f"Investigation plan has no decision for {branch.value}")


class FixScope(StrEnum):
    NODE = "node"
    PIPELINE = "pipeline"
    PROJECT = "project"
    GUI = "gui"
    FRAMEWORK = "framework"
    DEPENDENCY = "dependency"


class FixMethod(StrEnum):
    CONFIGURATION = "configuration"
    ROI = "roi"
    ONLY_REC = "only_rec"
    EXPECTED_REPLACE = "expected_replace"
    COLOR_FILTER = "color_filter"
    PROJECT_CODE = "project_code"
    GUI_CODE = "gui_code"
    FRAMEWORK_CODE = "framework_code"
    MODEL_CHANGE = "model_change"


class FixCandidate(ContractModel):
    api_version: Literal["fix-candidate/v1"] = "fix-candidate/v1"
    fix_id: str = Field(min_length=1)
    target: str = Field(min_length=1)
    scope: FixScope
    method: FixMethod
    rationale: str = Field(min_length=1)
    evidence_ids: list[str] = Field(min_length=1)
    regression_risks: list[str] = Field(default_factory=_new_strings)
    verification_steps: list[str] = Field(min_length=1)


class VerificationMethod(StrEnum):
    OFFLINE_SCREENSHOT = "offline_screenshot"
    STATIC_CONFIGURATION = "static_configuration"
    RUNTIME_EXECUTION = "runtime_execution"
    MANUAL_OBSERVATION = "manual_observation"


class VerificationStatus(StrEnum):
    PLANNED = "planned"
    PASSED = "passed"
    FAILED = "failed"
    UNAVAILABLE = "unavailable"


class VerificationPlan(ContractModel):
    api_version: Literal["verification-plan/v1"] = "verification-plan/v1"
    fix_id: str = Field(min_length=1)
    methods: list[VerificationMethod] = Field(min_length=1)
    business_milestones: list[str] = Field(min_length=1)
    regression_checks: list[str] = Field(default_factory=_new_strings)


class SourceGuidance(ContractModel):
    """AGENTS.md guidance resolved for one repository revision and target path."""

    api_version: Literal["source-guidance/v1"] = "source-guidance/v1"
    source_id: str = Field(min_length=1)
    source_role: SourceRole
    revision: str | None = None
    target_path: str = Field(min_length=1)
    guidance_refs: list[str] = Field(default_factory=_new_strings)
    required_checks: list[str] = Field(default_factory=_new_strings)


class SourceResearchStatus(StrEnum):
    RUN = "run"
    SKIP = "skip"


class SourceSearchQuery(ContractModel):
    query_id: str = Field(min_length=1)
    source_id: str = Field(min_length=1)
    terms: list[str] = Field(min_length=1, max_length=8)
    paths: list[str] = Field(default_factory=_new_strings, max_length=8)
    reason: str = Field(min_length=1)
    context_lines: int = Field(default=12, ge=0, le=40)
    max_results: int = Field(default=10, ge=1, le=20)

    @field_validator("terms")
    @classmethod
    def validate_terms(cls, value: list[str]) -> list[str]:
        normalized_terms = [term.strip() for term in value]
        if any(
            not term or "\n" in term or "\r" in term or len(term) > 200 for term in normalized_terms
        ):
            raise ValueError(
                "Source search terms must be non-empty single-line strings up to 200 characters"
            )
        if len(normalized_terms) != len(set(normalized_terms)):
            raise ValueError("Source search terms must be unique")
        return normalized_terms

    @field_validator("paths")
    @classmethod
    def validate_paths(cls, value: list[str]) -> list[str]:
        normalized_paths = [path.strip().replace("\\", "/") for path in value]
        for path in normalized_paths:
            candidate = Path(path)
            if (
                not path
                or len(path) > 300
                or candidate.is_absolute()
                or ".." in candidate.parts
                or any(part.casefold() == ".git" for part in candidate.parts)
            ):
                raise ValueError(
                    "Source search paths must be relative, at most 300 characters, "
                    "and cannot traverse parents or .git"
                )
        if len(normalized_paths) != len(set(normalized_paths)):
            raise ValueError("Source search paths must be unique")
        return normalized_paths


def _new_source_search_queries() -> list[SourceSearchQuery]:
    return []


class SourceResearchPlan(ContractModel):
    api_version: Literal["source-research-plan/v1"] = "source-research-plan/v1"
    status: SourceResearchStatus
    queries: list[SourceSearchQuery] = Field(
        default_factory=_new_source_search_queries,
        max_length=5,
    )
    rationale: str = Field(min_length=1)

    @model_validator(mode="after")
    def validate_plan(self) -> SourceResearchPlan:
        query_ids = [query.query_id for query in self.queries]
        if len(query_ids) != len(set(query_ids)):
            raise ValueError("Source search query IDs must be unique")
        if self.status is SourceResearchStatus.RUN and not self.queries:
            raise ValueError("A running source research plan requires at least one query")
        if self.status is SourceResearchStatus.SKIP and self.queries:
            raise ValueError("A skipped source research plan cannot contain queries")
        return self


class KnowledgeResearchPlan(ContractModel):
    api_version: Literal["knowledge-research-plan/v1"] = "knowledge-research-plan/v1"
    status: SourceResearchStatus
    queries: list[SourceSearchQuery] = Field(
        default_factory=_new_source_search_queries,
        max_length=5,
    )
    rationale: str = Field(min_length=1)

    @model_validator(mode="after")
    def validate_plan(self) -> KnowledgeResearchPlan:
        query_ids = [query.query_id for query in self.queries]
        if len(query_ids) != len(set(query_ids)):
            raise ValueError("Knowledge search query IDs must be unique")
        if self.status is SourceResearchStatus.RUN and not self.queries:
            raise ValueError("A running knowledge research plan requires at least one query")
        if self.status is SourceResearchStatus.SKIP and self.queries:
            raise ValueError("A skipped knowledge research plan cannot contain queries")
        return self
