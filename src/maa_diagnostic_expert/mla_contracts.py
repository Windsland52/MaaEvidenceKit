from __future__ import annotations

from enum import StrEnum
from typing import Annotated, Literal

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


# ---------------------------------------------------------------------------
# Runtime inspection contracts (mla-runtime-inspection/v1)
# ---------------------------------------------------------------------------


class MlaRuntimeEvidencePosition(ContractModel):
    timestamp: str | None = None
    source: str | None = None
    path: str | None = None
    local_line: int | None = Field(default=None, ge=1)


class MlaRuntimeEvidenceRange(ContractModel):
    start: MlaRuntimeEvidencePosition
    end: MlaRuntimeEvidencePosition


class MlaRuntimeMetricDistribution(ContractModel):
    count: int = Field(ge=0)
    minimum: float = Field(ge=0)
    p50: float = Field(ge=0)
    p95: float = Field(ge=0)
    maximum: float = Field(ge=0)
    average: float = Field(ge=0)


class MlaRuntimeFailureKind(StrEnum):
    NEXT_LIST_TIMEOUT = "next_list_timeout"
    ACTION_FAILED = "action_failed"


class MlaRuntimeOutcomeKind(StrEnum):
    PIPELINE_NODE = "pipeline_node"
    TASK = "task"


class MlaRuntimeOutcomeStatus(StrEnum):
    FAILED = "failed"
    RUNNING = "running"


class MlaRuntimeTaskStatus(StrEnum):
    RUNNING = "running"
    SUCCEEDED = "succeeded"
    FAILED = "failed"


class MlaRuntimeTaskCompleteness(StrEnum):
    COMPLETE = "complete"
    OPEN_AT_LOG_END = "open_at_log_end"


class MlaRuntimeSignalPriority(StrEnum):
    HIGH = "high"
    NORMAL = "normal"
    LOW = "low"


class MlaRuntimeSignalPriorityReason(StrEnum):
    TIMEOUT = "timeout"
    UNMATCHED_TERMINAL = "unmatched_terminal"
    HIGH_MIXED_RESULTS = "high_mixed_results"
    HIGH_UNSUCCESSFUL_ATTEMPTS = "high_unsuccessful_attempts"
    HIGH_OCCURRENCE_COUNT = "high_occurrence_count"
    RELATED_TO_DIRECT_FAILURE = "related_to_direct_failure"
    STILL_REPEATING_AT_LOG_END = "still_repeating_at_log_end"
    HIGH_REPEAT_COUNT = "high_repeat_count"
    LONG_DURATION = "long_duration"
    INCOMPLETE_REPETITION = "incomplete_repetition"


class _MlaRuntimeScope(ContractModel):
    session_id: str | None = None
    execution_id: str = Field(min_length=1)
    task_id: int = Field(ge=0)
    task_name: str = Field(min_length=1)


class MlaRuntimeFailure(_MlaRuntimeScope):
    failure_id: str = Field(min_length=1)
    kind: MlaRuntimeFailureKind
    node_id: int = Field(ge=0)
    node_name: str = Field(min_length=1)
    started_at: str = Field(min_length=1)
    ended_at: str | None = None
    error_images: list[str] = Field(default_factory=list)
    vision_images: list[str] = Field(default_factory=list)
    evidence: MlaRuntimeEvidencePosition


class MlaRuntimeOutcome(_MlaRuntimeScope):
    outcome_id: str = Field(min_length=1)
    kind: MlaRuntimeOutcomeKind
    status: MlaRuntimeOutcomeStatus
    node_id: int | None = Field(default=None, ge=0)
    node_name: str | None = None
    direct_failure_ids: list[str] = Field(default_factory=list)
    evidence: MlaRuntimeEvidencePosition


class MlaRecognitionNextListEntry(ContractModel):
    name: str = Field(min_length=1)
    anchor: bool
    jump_back: bool


class MlaRecognitionTerminalOutcomes(ContractModel):
    matched: int = Field(ge=0)
    timeout: int = Field(ge=0)
    running: int = Field(ge=0)
    unmatched: int = Field(ge=0)


class MlaRecognitionTerminalMatch(ContractModel):
    name: str = Field(min_length=1)
    count: int = Field(ge=0)


class MlaRecognitionCandidateStatistic(ContractModel):
    name: str = Field(min_length=1)
    evaluation_count: int = Field(ge=0)
    matched_attempt_count: int = Field(ge=0)
    unsuccessful_attempt_count: int = Field(ge=0)
    running_attempt_count: int = Field(ge=0)
    terminal_match_count: int = Field(ge=0)


class MlaRecognitionOccurrenceSample(ContractModel):
    node_id: int = Field(ge=0)
    started_at: str = Field(min_length=1)
    ended_at: str | None = None
    attempt_count: int = Field(ge=0)
    unsuccessful_attempts: int = Field(ge=0)
    terminal_match: str | None = None
    evidence: MlaRuntimeEvidenceRange


class MlaRecognitionRepresentatives(ContractModel):
    first: MlaRecognitionOccurrenceSample
    worst: MlaRecognitionOccurrenceSample
    last: MlaRecognitionOccurrenceSample


def _new_recognition_next_list() -> list[MlaRecognitionNextListEntry]:
    return []


def _new_recognition_terminal_matches() -> list[MlaRecognitionTerminalMatch]:
    return []


def _new_recognition_candidate_statistics() -> list[MlaRecognitionCandidateStatistic]:
    return []


def _new_signal_priority_reasons() -> list[MlaRuntimeSignalPriorityReason]:
    return []


class MlaRecognitionActivitySignal(_MlaRuntimeScope):
    signal_id: str = Field(min_length=1)
    kind: Literal["recognition_activity"]
    pipeline_node_name: str = Field(min_length=1)
    next_list: list[MlaRecognitionNextListEntry] = Field(default_factory=_new_recognition_next_list)
    occurrence_count: int = Field(ge=0)
    occurrences_with_mixed_results: int = Field(ge=0)
    terminal_outcomes: MlaRecognitionTerminalOutcomes
    terminal_matches: list[MlaRecognitionTerminalMatch] = Field(
        default_factory=_new_recognition_terminal_matches,
    )
    candidate_statistics: list[MlaRecognitionCandidateStatistic] = Field(
        default_factory=_new_recognition_candidate_statistics,
    )
    unmapped_attempt_count: int = Field(ge=0)
    attempts: MlaRuntimeMetricDistribution
    unsuccessful_attempts: MlaRuntimeMetricDistribution
    duration_ms: MlaRuntimeMetricDistribution
    representatives: MlaRecognitionRepresentatives
    priority: MlaRuntimeSignalPriority
    priority_reasons: list[MlaRuntimeSignalPriorityReason] = Field(
        default_factory=_new_signal_priority_reasons
    )


class MlaRepeatedNodeRepresentative(ContractModel):
    first_seen_at: str = Field(min_length=1)
    last_seen_at: str = Field(min_length=1)
    repeat_count: int = Field(ge=0)
    evidence: MlaRuntimeEvidencePosition
    pattern: list[str] = Field(default_factory=list)
    duration_ms: float = Field(default=0.0, ge=0)
    termination: str | None = Field(default=None)


class MlaRepeatedNodeRepresentatives(ContractModel):
    first: MlaRepeatedNodeRepresentative
    longest: MlaRepeatedNodeRepresentative
    last: MlaRepeatedNodeRepresentative


class MlaRepeatedNodeTerminations(ContractModel):
    left_pattern: int = Field(ge=0)
    task_ended: int = Field(ge=0)
    still_repeating_at_log_end: int = Field(ge=0)


class MlaRepeatedNodeDetector(ContractModel):
    name: Literal["repeated-completed-node-sequence"]
    version: int = Field(ge=1)
    minimum_repeats: int = Field(ge=1)
    maximum_pattern_length: int = Field(ge=1)


class MlaRepeatedNodeSequenceSignal(_MlaRuntimeScope):
    signal_id: str = Field(min_length=1)
    kind: Literal["repeated_node", "repeated_node_cycle"]
    pattern: list[str] = Field(min_length=1)
    segment_count: int = Field(ge=0)
    total_repeat_count: int = Field(ge=0)
    maximum_repeat_count: int = Field(ge=0)
    duration_ms: MlaRuntimeMetricDistribution
    terminations: MlaRepeatedNodeTerminations
    representatives: MlaRepeatedNodeRepresentatives
    detector: MlaRepeatedNodeDetector
    priority: MlaRuntimeSignalPriority
    priority_reasons: list[MlaRuntimeSignalPriorityReason] = Field(
        default_factory=_new_signal_priority_reasons
    )


MlaRuntimeSignal = Annotated[
    MlaRecognitionActivitySignal | MlaRepeatedNodeSequenceSignal,
    Field(discriminator="kind"),
]


class MlaRuntimeTaskStatistics(ContractModel):
    node_executions: int = Field(ge=0)
    succeeded_nodes: int = Field(ge=0)
    failed_nodes: int = Field(ge=0)
    running_nodes: int = Field(ge=0)
    recognition_attempts: int = Field(ge=0)
    unsuccessful_recognition_attempts: int = Field(ge=0)
    node_executions_with_recognition: int = Field(ge=0)
    node_executions_with_mixed_recognition_results: int = Field(ge=0)
    recognition_activity_groups: int = Field(ge=0)
    maximum_recognition_attempts_per_node: int = Field(ge=0)
    maximum_unsuccessful_recognition_attempts_per_node: int = Field(ge=0)
    action_attempts: int = Field(ge=0)
    action_failures: int = Field(ge=0)
    next_list_timeouts: int = Field(ge=0)
    error_image_references: int = Field(ge=0)
    unique_error_images: int = Field(ge=0)
    vision_image_references: int = Field(ge=0)
    unique_vision_images: int = Field(ge=0)


class MlaRuntimeSignalHighlights(ContractModel):
    recognition_activity: list[str] = Field(default_factory=list)
    repetitions: list[str] = Field(default_factory=list)


class MlaRuntimeTaskExecution(ContractModel):
    execution_id: str = Field(min_length=1)
    task_id: int = Field(ge=0)
    name: str = Field(min_length=1)
    hash: str
    uuid: str
    status: MlaRuntimeTaskStatus
    completeness: MlaRuntimeTaskCompleteness
    started_at: str = Field(min_length=1)
    ended_at: str | None = None
    observed_duration_ms: float | None = Field(default=None, ge=0)
    first_node: str | None = None
    last_node: str | None = None
    statistics: MlaRuntimeTaskStatistics
    direct_failure_ids: list[str] = Field(default_factory=list)
    outcome_ids: list[str] = Field(default_factory=list)
    signal_ids: list[str] = Field(default_factory=list)
    signal_highlights: MlaRuntimeSignalHighlights
    evidence: MlaRuntimeEvidenceRange


class MlaRuntimeSessionSummary(ContractModel):
    task_executions: int = Field(ge=0)
    succeeded_tasks: int = Field(ge=0)
    failed_tasks: int = Field(ge=0)
    running_tasks: int = Field(ge=0)
    direct_failures: int = Field(ge=0)
    next_list_timeouts: int = Field(ge=0)
    action_failures: int = Field(ge=0)
    signals: int = Field(ge=0)


def _new_runtime_tasks() -> list[MlaRuntimeTaskExecution]:
    return []


class MlaRuntimeSession(ContractModel):
    session_id: str = Field(min_length=1)
    start_kind: MlaSessionStartKind
    framework_status: MlaSessionStatus
    framework_version: str | None = None
    versions: list[str] = Field(default_factory=list)
    start: MlaLogPosition
    end: MlaLogPosition
    tasks: list[MlaRuntimeTaskExecution] = Field(default_factory=_new_runtime_tasks)
    summary: MlaRuntimeSessionSummary


def _new_runtime_sessions() -> list[MlaRuntimeSession]:
    return []


def _new_runtime_failures() -> list[MlaRuntimeFailure]:
    return []


def _new_runtime_outcomes() -> list[MlaRuntimeOutcome]:
    return []


def _new_runtime_signals() -> list[MlaRuntimeSignal]:
    return []


def _new_runtime_unscoped_tasks() -> list[MlaRuntimeTaskExecution]:
    return []


class MlaRuntimeInspectionResult(ContractModel):
    schema_version: str = "mla-runtime-inspection/v1"
    sessions: list[MlaRuntimeSession] = Field(default_factory=_new_runtime_sessions)
    failures: list[MlaRuntimeFailure] = Field(default_factory=_new_runtime_failures)
    outcomes: list[MlaRuntimeOutcome] = Field(default_factory=_new_runtime_outcomes)
    signals: list[MlaRuntimeSignal] = Field(default_factory=_new_runtime_signals)
    unscoped_tasks: list[MlaRuntimeTaskExecution] = Field(
        default_factory=_new_runtime_unscoped_tasks,
    )
    warnings: list[str] = Field(default_factory=_new_warnings)
