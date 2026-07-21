from __future__ import annotations

from datetime import datetime
from enum import StrEnum

from pydantic import Field, model_validator

from .domain import ContractModel, SourceRole


class RuntimeComponent(StrEnum):
    PROJECT = "project"
    GUI = "gui"
    MAA_FRAMEWORK = "maa_framework"


class VersionObservationKind(StrEnum):
    OBSERVED = "observed"
    RESOLVED = "resolved"
    USER_DECLARED = "user_declared"


class RuntimeVersionObservation(ContractModel):
    component: RuntimeComponent
    version: str = Field(min_length=1)
    kind: VersionObservationKind
    source_ref: str = Field(min_length=1)
    evidence_id: str | None = None
    session_id: str | None = None
    observed_at: datetime | None = None
    confidence: float = Field(ge=0, le=1)


def _new_version_observations() -> list[RuntimeVersionObservation]:
    return []


class RuntimeIdentity(ContractModel):
    """Version observations remain scoped to their source and optional session."""

    api_version: str = "runtime-identity/v1"
    versions: list[RuntimeVersionObservation] = Field(default_factory=_new_version_observations)


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
    started_at: datetime | None = None
    ended_at: datetime | None = None
    confidence: float = Field(ge=0, le=1)
    evidence_ids: list[str] = Field(default_factory=_new_strings)
    reasons: list[str] = Field(default_factory=_new_strings)


def _new_incident_candidates() -> list[IncidentCandidate]:
    return []


class IncidentSelection(ContractModel):
    api_version: str = "incident-selection/v1"
    status: IncidentSelectionStatus
    candidates: list[IncidentCandidate] = Field(default_factory=_new_incident_candidates)
    selected_candidate_id: str | None = None
    missing_evidence: list[str] = Field(default_factory=_new_strings)

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

    api_version: str = "investigation-plan/v1"
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
    api_version: str = "fix-candidate/v1"
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
    api_version: str = "verification-plan/v1"
    fix_id: str = Field(min_length=1)
    methods: list[VerificationMethod] = Field(min_length=1)
    business_milestones: list[str] = Field(min_length=1)
    regression_checks: list[str] = Field(default_factory=_new_strings)


class SourceGuidance(ContractModel):
    """AGENTS.md guidance resolved for one repository revision and target path."""

    api_version: str = "source-guidance/v1"
    source_id: str = Field(min_length=1)
    source_role: SourceRole
    revision: str | None = None
    target_path: str = Field(min_length=1)
    guidance_refs: list[str] = Field(default_factory=_new_strings)
    required_checks: list[str] = Field(default_factory=_new_strings)
