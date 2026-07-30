from __future__ import annotations

import json
from collections.abc import Mapping
from datetime import datetime
from enum import StrEnum
from pathlib import Path
from typing import Annotated, Literal, cast

from pydantic import AliasChoices, ConfigDict, Field, field_validator, model_validator

from .command import (
    CommandApprovalOutcome,
    CommandApprovalStatus,
    CommandExecutionStatus,
    CommandRequest,
)
from .domain import (
    ContractModel,
    Evidence,
    EvidenceQuery,
    JsonValue,
    MissingEvidence,
    SourceRole,
)

_Rationale = Annotated[
    str,
    Field(
        min_length=1,
        validation_alias=AliasChoices("rationale", "rational"),
        serialization_alias="rationale",
    ),
]
_SOURCE_CODE_SUFFIXES = (
    ".c",
    ".cc",
    ".cpp",
    ".cs",
    ".go",
    ".h",
    ".hpp",
    ".js",
    ".jsx",
    ".py",
    ".rs",
    ".ts",
    ".tsx",
)


def _parse_json_array(value: object) -> object:
    if not isinstance(value, str):
        return value
    try:
        decoded = cast(object, json.loads(value))
    except json.JSONDecodeError:
        return value
    return cast(list[object], decoded) if isinstance(decoded, list) else value


def _status_collection_json_schema(
    *,
    active_status: StrEnum,
    inactive_status: StrEnum,
    collection: str,
) -> dict[str, JsonValue]:
    return {
        "allOf": [
            {
                "if": {
                    "properties": {"status": {"const": active_status.value}},
                    "required": ["status"],
                },
                "then": {
                    "properties": {collection: {"minItems": 1}},
                    "required": [collection],
                },
            },
            {
                "if": {
                    "properties": {"status": {"const": inactive_status.value}},
                    "required": ["status"],
                },
                "then": {
                    "properties": {collection: {"maxItems": 0}},
                    "required": [collection],
                },
            },
        ]
    }


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
    selected_candidate_id: str | None = Field(
        default=None,
        description=(
            "Copy the complete selected candidate_id exactly, including prefixes such as "
            "'incident:'."
        ),
    )
    relevant_candidate_ids: list[str] = Field(
        default_factory=_new_strings,
        description=(
            "Copy complete candidate_id values exactly, including prefixes such as 'incident:'."
        ),
    )
    evidence_ids: list[str] = Field(
        default_factory=_new_strings,
        description="Copy only complete evidence_ids listed for the referenced candidates.",
    )
    rationale: _Rationale
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
    rationale: _Rationale
    evidence_ids: list[str] = Field(
        min_length=1,
        validation_alias=AliasChoices("evidence_ids", "evidence_id"),
        serialization_alias="evidence_ids",
    )
    regression_risks: list[str] = Field(default_factory=_new_strings)
    verification_steps: list[str] = Field(min_length=1)

    @field_validator("evidence_ids", mode="before")
    @classmethod
    def normalize_evidence_ids(cls, value: object) -> object:
        parsed = _parse_json_array(value)
        return [parsed] if isinstance(parsed, str) and parsed else parsed

    @field_validator("regression_risks", "verification_steps", mode="before")
    @classmethod
    def parse_json_encoded_fix_lists(cls, value: object) -> object:
        return _parse_json_array(value)

    @field_validator("evidence_ids", "regression_risks", "verification_steps")
    @classmethod
    def validate_unique_fix_items(cls, value: list[str]) -> list[str]:
        if len(value) != len(set(value)):
            raise ValueError("Fix candidate list items must be unique")
        return value

    @model_validator(mode="after")
    def validate_code_method_scope(self) -> FixCandidate:
        expected_scopes = {
            FixMethod.PROJECT_CODE: FixScope.PROJECT,
            FixMethod.GUI_CODE: FixScope.GUI,
            FixMethod.FRAMEWORK_CODE: FixScope.FRAMEWORK,
        }
        expected_scope = expected_scopes.get(self.method)
        if expected_scope is not None and self.scope is not expected_scope:
            raise ValueError(
                f"Fix method '{self.method.value}' requires scope '{expected_scope.value}'"
            )
        pipeline_methods = {
            FixMethod.ROI,
            FixMethod.ONLY_REC,
            FixMethod.EXPECTED_REPLACE,
            FixMethod.COLOR_FILTER,
        }
        if self.method in pipeline_methods and self.scope in {
            FixScope.GUI,
            FixScope.FRAMEWORK,
            FixScope.DEPENDENCY,
        }:
            raise ValueError(
                f"Pipeline fix method '{self.method.value}' cannot use scope '{self.scope.value}'"
            )
        target = self.target.casefold()
        code_target_markers = (*_SOURCE_CODE_SUFFIXES, "()", "::")
        if self.method is FixMethod.CONFIGURATION and any(
            marker in target for marker in code_target_markers
        ):
            raise ValueError(
                "Configuration fixes must target a configuration field or file, not a source "
                "code path or callable symbol"
            )
        return self


class FixPlanningStatus(StrEnum):
    PROPOSED = "proposed"
    SKIP = "skip"


_FIX_CANDIDATE_PLAN_JSON_SCHEMA = _status_collection_json_schema(
    active_status=FixPlanningStatus.PROPOSED,
    inactive_status=FixPlanningStatus.SKIP,
    collection="candidates",
)


class FixCandidatePlan(ContractModel):
    """A bounded set of evidence-backed repair proposals, never an execution request."""

    model_config = ConfigDict(json_schema_extra=_FIX_CANDIDATE_PLAN_JSON_SCHEMA)

    api_version: Literal["fix-candidate-plan/v1"] = "fix-candidate-plan/v1"
    status: FixPlanningStatus
    candidates: list[FixCandidate] = Field(
        default_factory=list[FixCandidate],
        max_length=3,
        description=(
            "Use one to three candidates when status is 'proposed'; use an empty list when "
            "status is 'skip'."
        ),
    )
    rationale: _Rationale

    @model_validator(mode="before")
    @classmethod
    def wrap_flattened_candidate(cls, value: object) -> object:
        """Repair one candidate emitted at the plan tool-call level."""
        if not isinstance(value, Mapping):
            return value
        data = cast(Mapping[str, object], value)
        candidate_keys = {
            "fix_id",
            "target",
            "scope",
            "method",
            "rationale",
            "rational",
            "evidence_ids",
            "evidence_id",
            "regression_risks",
            "verification_steps",
        }
        allowed_keys = candidate_keys | {"api_version", "status", "candidates"}
        required_keys = {"fix_id", "target", "scope", "method", "verification_steps"}
        status = data.get("status")
        candidates = data.get("candidates")
        if (
            status not in {None, FixPlanningStatus.PROPOSED, FixPlanningStatus.PROPOSED.value}
            or candidates not in (None, "")
            or not required_keys.issubset(data)
            or set(data) - allowed_keys
        ):
            return data
        candidate = {key: item for key, item in data.items() if key in candidate_keys}
        rationale = data.get("rationale", data.get("rational"))
        return {
            "api_version": "fix-candidate-plan/v1",
            "status": "proposed",
            "candidates": [candidate],
            "rationale": rationale,
        }

    @model_validator(mode="after")
    def validate_plan(self) -> FixCandidatePlan:
        fix_ids = [candidate.fix_id for candidate in self.candidates]
        if len(fix_ids) != len(set(fix_ids)):
            raise ValueError("Fix candidate IDs must be unique")
        if self.status is FixPlanningStatus.PROPOSED and not self.candidates:
            raise ValueError("A proposed fix plan requires at least one candidate")
        if self.status is FixPlanningStatus.SKIP and self.candidates:
            raise ValueError("A skipped fix plan cannot contain candidates")
        return self


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
    api_version: Literal["verification-plan/v2"] = "verification-plan/v2"
    fix_id: str = Field(min_length=1)
    methods: list[VerificationMethod] = Field(min_length=1)
    steps: list[str] = Field(min_length=1)
    business_milestones: list[str] = Field(min_length=1)
    regression_checks: list[str] = Field(default_factory=_new_strings)

    @field_validator(
        "methods",
        "steps",
        "business_milestones",
        "regression_checks",
        mode="before",
    )
    @classmethod
    def parse_json_encoded_verification_lists(cls, value: object) -> object:
        return _parse_json_array(value)

    @field_validator("methods")
    @classmethod
    def validate_unique_verification_methods(
        cls, value: list[VerificationMethod]
    ) -> list[VerificationMethod]:
        if len(value) != len(set(value)):
            raise ValueError("Verification methods must be unique")
        return value

    @field_validator("steps", "business_milestones", "regression_checks")
    @classmethod
    def validate_unique_verification_items(cls, value: list[str]) -> list[str]:
        if any(not item.strip() for item in value):
            raise ValueError("Verification plan items must not be blank")
        if len(value) != len(set(value)):
            raise ValueError("Verification plan list items must be unique")
        return value


class VerificationPlanningStatus(StrEnum):
    PLANNED = "planned"
    SKIP = "skip"


_VERIFICATION_PLAN_SET_JSON_SCHEMA = _status_collection_json_schema(
    active_status=VerificationPlanningStatus.PLANNED,
    inactive_status=VerificationPlanningStatus.SKIP,
    collection="plans",
)


class VerificationPlanSet(ContractModel):
    """Pre-execution verification plans paired with validated fix candidates."""

    model_config = ConfigDict(json_schema_extra=_VERIFICATION_PLAN_SET_JSON_SCHEMA)

    api_version: Literal["verification-plan-set/v1"] = "verification-plan-set/v1"
    status: VerificationPlanningStatus
    plans: list[VerificationPlan] = Field(
        default_factory=list[VerificationPlan],
        max_length=3,
        description=(
            "Use one to three plans when status is 'planned'; use an empty list when status "
            "is 'skip'."
        ),
    )
    rationale: _Rationale

    @model_validator(mode="before")
    @classmethod
    def wrap_flattened_verification_plan(cls, value: object) -> object:
        """Repair one verification plan emitted at the plan-set tool-call level."""
        if not isinstance(value, Mapping):
            return value
        data = cast(Mapping[str, object], value)
        plan_keys = {
            "fix_id",
            "methods",
            "steps",
            "business_milestones",
            "regression_checks",
        }
        allowed_keys = plan_keys | {
            "api_version",
            "plans",
            "rationale",
            "rational",
        }
        required_keys = {"fix_id", "methods", "steps", "business_milestones"}
        if "status" in data or not required_keys.issubset(data) or set(data) - allowed_keys:
            return data
        plan = {key: item for key, item in data.items() if key in plan_keys}
        rationale = data.get("rationale", data.get("rational"))
        return {
            "api_version": "verification-plan-set/v1",
            "status": "planned",
            "plans": [plan],
            "rationale": rationale,
        }

    @model_validator(mode="after")
    def validate_plan_set(self) -> VerificationPlanSet:
        fix_ids = [plan.fix_id for plan in self.plans]
        if len(fix_ids) != len(set(fix_ids)):
            raise ValueError("Verification plan fix IDs must be unique")
        if self.status is VerificationPlanningStatus.PLANNED and not self.plans:
            raise ValueError("A planned verification set requires at least one plan")
        if self.status is VerificationPlanningStatus.SKIP and self.plans:
            raise ValueError("A skipped verification set cannot contain plans")
        return self


class FixExecutionRequest(ContractModel):
    """One selected fix translated into one exact command pending human approval."""

    api_version: Literal["fix-execution-request/v1"] = "fix-execution-request/v1"
    fix_id: str = Field(min_length=1)
    command: CommandRequest
    rationale: _Rationale
    expected_changed_paths: list[str] = Field(min_length=1, max_length=20)

    @field_validator("expected_changed_paths")
    @classmethod
    def validate_changed_paths(cls, value: list[str]) -> list[str]:
        normalized = [item.strip().replace("\\", "/") for item in value]
        for item in normalized:
            path = Path(item)
            if (
                not item
                or path.is_absolute()
                or ".." in path.parts
                or any(part.casefold() == ".git" for part in path.parts)
            ):
                raise ValueError(
                    "Expected changed paths must be relative and cannot traverse parents or .git"
                )
        if len(normalized) != len(set(normalized)):
            raise ValueError("Expected changed paths must be unique")
        return normalized


class FixExecutionStatus(StrEnum):
    AWAITING_APPROVAL = "awaiting_approval"
    COMMAND_COMPLETED = "command_completed"
    REJECTED = "rejected"
    COMMAND_FAILED = "command_failed"


class FixFileState(StrEnum):
    MISSING = "missing"
    FILE = "file"
    DIRECTORY = "directory"
    UNREADABLE = "unreadable"
    OUTSIDE_CWD = "outside_cwd"


class FixFileSnapshot(ContractModel):
    state: FixFileState
    size_bytes: int | None = Field(default=None, ge=0)
    sha256: str | None = Field(default=None, pattern=r"^[0-9a-f]{64}$")
    content_preview: str = ""
    content_truncated: bool = False
    error: str | None = None

    @model_validator(mode="after")
    def validate_state(self) -> FixFileSnapshot:
        if self.state is FixFileState.FILE:
            if self.size_bytes is None or self.sha256 is None:
                raise ValueError("File snapshots require a size and SHA-256 digest")
            if self.error is not None:
                raise ValueError("Readable file snapshots cannot contain an error")
            return self
        if self.size_bytes is not None or self.sha256 is not None or self.content_preview:
            raise ValueError("Non-file snapshots cannot contain file content metadata")
        if self.content_truncated:
            raise ValueError("Only file snapshots can contain truncated content")
        if self.state in {FixFileState.UNREADABLE, FixFileState.OUTSIDE_CWD}:
            if self.error is None:
                raise ValueError("Unavailable file snapshots require an error")
        elif self.error is not None:
            raise ValueError("Missing and directory snapshots cannot contain an error")
        return self


class FixFileChange(ContractModel):
    path: str = Field(min_length=1)
    before: FixFileSnapshot
    after: FixFileSnapshot | None = None
    changed: bool | None = None

    @model_validator(mode="after")
    def validate_change(self) -> FixFileChange:
        if self.after is None and self.changed is not None:
            raise ValueError("A pending file change cannot declare whether it changed")
        if self.after is not None and self.changed is None:
            raise ValueError("A completed file change must declare whether it changed")
        if self.after is not None and self.changed != (self.before != self.after):
            raise ValueError("File change status must match the before and after snapshots")
        return self


class FixExecutionOutcome(ContractModel):
    """Audited command outcome; command completion is not repair verification."""

    api_version: Literal["fix-execution-outcome/v2"] = "fix-execution-outcome/v2"
    status: FixExecutionStatus
    request: FixExecutionRequest
    candidate: FixCandidate
    verification_plan: VerificationPlan
    command_outcome: CommandApprovalOutcome
    file_changes: list[FixFileChange] = Field(min_length=1, max_length=20)

    @model_validator(mode="after")
    def validate_outcome(self) -> FixExecutionOutcome:
        if self.request.fix_id != self.candidate.fix_id:
            raise ValueError("Fix execution request must match its candidate")
        if self.verification_plan.fix_id != self.candidate.fix_id:
            raise ValueError("Fix execution verification plan must match its candidate")
        change_paths = [change.path for change in self.file_changes]
        if change_paths != self.request.expected_changed_paths:
            raise ValueError("Fix execution file changes must match expected changed paths")
        if self.command_outcome.approval is not None:
            pending_request = self.command_outcome.approval.pending_execution.request
            if pending_request != self.request.command:
                raise ValueError("Fix execution approval must contain the exact requested command")
        execution = self.command_outcome.execution
        if execution is not None and execution.request != self.request.command:
            raise ValueError("Fix execution must replay the exact requested command")
        if self.status is FixExecutionStatus.AWAITING_APPROVAL:
            if self.command_outcome.status is not CommandApprovalStatus.AWAITING_APPROVAL:
                raise ValueError("Awaiting fix execution requires a pending command approval")
            if any(change.after is not None for change in self.file_changes):
                raise ValueError("Pending fix execution cannot contain after snapshots")
        elif self.status is FixExecutionStatus.REJECTED:
            if self.command_outcome.status is not CommandApprovalStatus.REJECTED:
                raise ValueError("Rejected fix execution requires a rejected command")
            if any(change.after is not None for change in self.file_changes):
                raise ValueError("Rejected fix execution cannot contain after snapshots")
        elif self.command_outcome.status is not CommandApprovalStatus.FINISHED or execution is None:
            raise ValueError("Terminal fix execution requires a terminal command result")
        elif any(change.after is None for change in self.file_changes):
            raise ValueError("Terminal fix execution requires after snapshots")
        elif self.status is FixExecutionStatus.COMMAND_COMPLETED:
            if execution.status is not CommandExecutionStatus.COMPLETED:
                raise ValueError("Completed fix execution requires a completed command")
        elif execution.status is CommandExecutionStatus.COMPLETED:
            raise ValueError("Failed fix execution cannot contain a completed command")
        return self


class FixVerificationCheckKind(StrEnum):
    FILE_CHANGE = "file_change"
    STEP = "step"
    BUSINESS_MILESTONE = "business_milestone"
    REGRESSION = "regression"


class FixVerificationCheck(ContractModel):
    kind: FixVerificationCheckKind
    requirement: str = Field(min_length=1)
    status: VerificationStatus
    statement: str = Field(min_length=1)
    evidence_ids: list[str] = Field(default_factory=_new_strings)
    missing_evidence: list[str] = Field(default_factory=_new_strings)

    @model_validator(mode="after")
    def validate_check(self) -> FixVerificationCheck:
        if self.status is VerificationStatus.PLANNED:
            raise ValueError("Verification results cannot remain planned")
        if self.status in {VerificationStatus.PASSED, VerificationStatus.FAILED}:
            if not self.evidence_ids:
                raise ValueError("Passed or failed verification checks require evidence")
        elif not self.missing_evidence:
            raise ValueError("Unavailable verification checks require missing evidence")
        if len(self.evidence_ids) != len(set(self.evidence_ids)):
            raise ValueError("Verification check evidence IDs must be unique")
        return self


class FixVerificationDraft(ContractModel):
    """Model assessment without authority to create verification evidence."""

    api_version: Literal["fix-verification-draft/v1"] = "fix-verification-draft/v1"
    fix_id: str = Field(min_length=1)
    status: VerificationStatus
    summary: str = Field(min_length=1)
    checks: list[FixVerificationCheck] = Field(min_length=1)

    @model_validator(mode="after")
    def validate_draft(self) -> FixVerificationDraft:
        _validate_fix_verification_status(self.status, self.checks)
        return self


class FixVerificationResult(ContractModel):
    api_version: Literal["fix-verification-result/v1"] = "fix-verification-result/v1"
    fix_id: str = Field(min_length=1)
    status: VerificationStatus
    summary: str = Field(min_length=1)
    checks: list[FixVerificationCheck] = Field(min_length=1)
    evidence: list[Evidence] = Field(default_factory=list[Evidence])

    @model_validator(mode="after")
    def validate_result(self) -> FixVerificationResult:
        evidence_ids = [item.id for item in self.evidence]
        if len(evidence_ids) != len(set(evidence_ids)):
            raise ValueError("Fix verification evidence IDs must be unique")
        referenced = {evidence_id for check in self.checks for evidence_id in check.evidence_ids}
        unknown = referenced - set(evidence_ids)
        if unknown:
            raise ValueError(
                "Fix verification checks reference unknown evidence IDs: "
                + ", ".join(sorted(unknown))
            )
        _validate_fix_verification_status(self.status, self.checks)
        return self


def _validate_fix_verification_status(
    status: VerificationStatus,
    checks: list[FixVerificationCheck],
) -> None:
    statuses = {check.status for check in checks}
    if status is VerificationStatus.PASSED and statuses != {VerificationStatus.PASSED}:
        raise ValueError("Passed fix verification requires every check to pass")
    if status is VerificationStatus.FAILED and VerificationStatus.FAILED not in statuses:
        raise ValueError("Failed fix verification requires a failed check")
    if status is VerificationStatus.UNAVAILABLE and (
        VerificationStatus.FAILED in statuses or VerificationStatus.UNAVAILABLE not in statuses
    ):
        raise ValueError(
            "Unavailable fix verification requires an unavailable check and no failed checks"
        )
    if status is VerificationStatus.PLANNED:
        raise ValueError("Fix verification results cannot remain planned")


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
    source_id: str = Field(
        min_length=1,
        description=(
            "Copy an available source_id exactly; do not substitute a source role such as "
            "'maa_framework', 'documentation', or 'wiki'."
        ),
    )
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


_SOURCE_RESEARCH_PLAN_JSON_SCHEMA = _status_collection_json_schema(
    active_status=SourceResearchStatus.RUN,
    inactive_status=SourceResearchStatus.SKIP,
    collection="queries",
)


class SourceResearchPlan(ContractModel):
    model_config = ConfigDict(json_schema_extra=_SOURCE_RESEARCH_PLAN_JSON_SCHEMA)

    api_version: Literal["source-research-plan/v1"] = "source-research-plan/v1"
    status: SourceResearchStatus
    queries: list[SourceSearchQuery] = Field(
        default_factory=_new_source_search_queries,
        max_length=5,
        description=(
            "Use one to five queries when status is 'run'; use an empty list when status is 'skip'."
        ),
    )
    rationale: _Rationale

    @field_validator("queries", mode="before")
    @classmethod
    def parse_json_encoded_queries(cls, value: object) -> object:
        """Accept a provider tool call that JSON-encodes its array argument once."""
        return _parse_json_array(value)

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
    model_config = ConfigDict(json_schema_extra=_SOURCE_RESEARCH_PLAN_JSON_SCHEMA)

    api_version: Literal["knowledge-research-plan/v1"] = "knowledge-research-plan/v1"
    status: SourceResearchStatus
    queries: list[SourceSearchQuery] = Field(
        default_factory=_new_source_search_queries,
        max_length=5,
        description=(
            "Use one to five queries when status is 'run'; use an empty list when status is 'skip'."
        ),
    )
    rationale: _Rationale

    @field_validator("queries", mode="before")
    @classmethod
    def parse_json_encoded_queries(cls, value: object) -> object:
        """Accept a provider tool call that JSON-encodes its array argument once."""
        return _parse_json_array(value)

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


class EvidenceResearchPlan(ContractModel):
    """A bounded request for focused windows from authorized diagnostic artifacts."""

    model_config = ConfigDict(json_schema_extra=_SOURCE_RESEARCH_PLAN_JSON_SCHEMA)

    api_version: Literal["evidence-research-plan/v1"] = "evidence-research-plan/v1"
    status: SourceResearchStatus
    queries: list[EvidenceQuery] = Field(
        default_factory=list[EvidenceQuery],
        max_length=3,
        description=(
            "Use one to three queries when status is 'run'; use an empty list when status is "
            "'skip'."
        ),
    )
    rationale: _Rationale

    @field_validator("queries", mode="before")
    @classmethod
    def parse_json_encoded_queries(cls, value: object) -> object:
        """Accept a provider tool call that JSON-encodes its array argument once."""
        return _parse_json_array(value)

    @model_validator(mode="after")
    def validate_plan(self) -> EvidenceResearchPlan:
        query_keys = [
            (str(query.source_path), query.line_start, query.line_end) for query in self.queries
        ]
        if len(query_keys) != len(set(query_keys)):
            raise ValueError("Evidence research queries must be unique")
        if self.status is SourceResearchStatus.RUN and not self.queries:
            raise ValueError("A running evidence research plan requires at least one query")
        if self.status is SourceResearchStatus.SKIP and self.queries:
            raise ValueError("A skipped evidence research plan cannot contain queries")
        return self
