import type {
  RecognitionActivitySignal,
  RecognitionOccurrenceSample,
  RepeatedNodeOccurrenceSample,
  RepeatedNodeSequenceSignal,
  RuntimeEvidencePosition,
  RuntimeFailure,
  RuntimeInspection,
  RuntimeMetricDistribution,
  RuntimeOutcome,
  RuntimeSession,
  RuntimeSignal,
  RuntimeTaskExecution,
  RuntimeTaskStatistics
} from "@windsland52/maa-log-tools";

type MlaRuntimeEvidencePosition = {
  timestamp: string | null;
  source: string | null;
  path: string | null;
  local_line: number | null;
};

type MlaRuntimeEvidenceRange = {
  start: MlaRuntimeEvidencePosition;
  end: MlaRuntimeEvidencePosition;
};

type MlaRuntimeMetricDistribution = {
  count: number;
  minimum: number;
  p50: number;
  p95: number;
  maximum: number;
  average: number;
};

type MlaRuntimeScope = {
  session_id: string | null;
  execution_id: string;
  task_id: number;
  task_name: string;
};

type MlaRuntimeFailure = MlaRuntimeScope & {
  failure_id: string;
  kind: "next_list_timeout" | "action_failed";
  node_id: number;
  node_name: string;
  started_at: string;
  ended_at: string | null;
  error_images: string[];
  vision_images: string[];
  evidence: MlaRuntimeEvidencePosition;
};

type MlaRuntimeOutcome = MlaRuntimeScope & {
  outcome_id: string;
  kind: "pipeline_node" | "task";
  status: "failed" | "running";
  node_id: number | null;
  node_name: string | null;
  direct_failure_ids: string[];
  evidence: MlaRuntimeEvidencePosition;
};

type MlaRecognitionOccurrenceSample = {
  node_id: number;
  started_at: string;
  ended_at: string | null;
  attempt_count: number;
  unsuccessful_attempts: number;
  terminal_match: string | null;
  evidence: MlaRuntimeEvidenceRange;
};

type MlaRuntimeSignalPriorityReason =
  | "timeout"
  | "unmatched_terminal"
  | "high_mixed_results"
  | "high_unsuccessful_attempts"
  | "high_occurrence_count"
  | "related_to_direct_failure"
  | "still_repeating_at_log_end"
  | "high_repeat_count"
  | "long_duration"
  | "incomplete_repetition";

type MlaRecognitionActivitySignal = MlaRuntimeScope & {
  signal_id: string;
  kind: "recognition_activity";
  pipeline_node_name: string;
  next_list: Array<{ name: string; anchor: boolean; jump_back: boolean }>;
  occurrence_count: number;
  occurrences_with_mixed_results: number;
  terminal_outcomes: {
    matched: number;
    timeout: number;
    running: number;
    unmatched: number;
  };
  terminal_matches: Array<{ name: string; count: number }>;
  candidate_statistics: Array<{
    name: string;
    evaluation_count: number;
    matched_attempt_count: number;
    unsuccessful_attempt_count: number;
    running_attempt_count: number;
    terminal_match_count: number;
  }>;
  unmapped_attempt_count: number;
  attempts: MlaRuntimeMetricDistribution;
  unsuccessful_attempts: MlaRuntimeMetricDistribution;
  duration_ms: MlaRuntimeMetricDistribution;
  representatives: {
    first: MlaRecognitionOccurrenceSample;
    worst: MlaRecognitionOccurrenceSample;
    last: MlaRecognitionOccurrenceSample;
  };
  priority: "high" | "normal" | "low";
  priority_reasons: MlaRuntimeSignalPriorityReason[];
};

type MlaRepeatedNodeRepresentative = {
  pattern: string[];
  first_seen_at: string;
  last_seen_at: string;
  repeat_count: number;
  duration_ms: number;
  termination: "left_pattern" | "task_ended" | "still_repeating_at_log_end";
  evidence: MlaRuntimeEvidencePosition;
};

type MlaRepeatedNodeSequenceSignal = MlaRuntimeScope & {
  signal_id: string;
  kind: "repeated_node" | "repeated_node_cycle";
  pattern: string[];
  segment_count: number;
  total_repeat_count: number;
  maximum_repeat_count: number;
  duration_ms: MlaRuntimeMetricDistribution;
  terminations: {
    left_pattern: number;
    task_ended: number;
    still_repeating_at_log_end: number;
  };
  representatives: {
    first: MlaRepeatedNodeRepresentative;
    longest: MlaRepeatedNodeRepresentative;
    last: MlaRepeatedNodeRepresentative;
  };
  detector: {
    name: "repeated-completed-node-sequence";
    version: 1;
    minimum_repeats: number;
    maximum_pattern_length: 8;
  };
  priority: "high" | "normal" | "low";
  priority_reasons: MlaRuntimeSignalPriorityReason[];
};

type MlaRuntimeSignal =
  | MlaRecognitionActivitySignal
  | MlaRepeatedNodeSequenceSignal;

type MlaRuntimeTaskStatistics = {
  node_executions: number;
  succeeded_nodes: number;
  failed_nodes: number;
  running_nodes: number;
  recognition_attempts: number;
  unsuccessful_recognition_attempts: number;
  node_executions_with_recognition: number;
  node_executions_with_mixed_recognition_results: number;
  recognition_activity_groups: number;
  maximum_recognition_attempts_per_node: number;
  maximum_unsuccessful_recognition_attempts_per_node: number;
  action_attempts: number;
  action_failures: number;
  next_list_timeouts: number;
  error_image_references: number;
  unique_error_images: number;
  vision_image_references: number;
  unique_vision_images: number;
};

type MlaRuntimeTaskExecution = {
  execution_id: string;
  task_id: number;
  name: string;
  hash: string;
  uuid: string;
  status: "running" | "succeeded" | "failed";
  completeness: "complete" | "open_at_log_end";
  started_at: string;
  ended_at: string | null;
  observed_duration_ms: number | null;
  first_node: string | null;
  last_node: string | null;
  statistics: MlaRuntimeTaskStatistics;
  direct_failure_ids: string[];
  outcome_ids: string[];
  signal_ids: string[];
  signal_highlights: {
    recognition_activity: string[];
    repetitions: string[];
  };
  evidence: MlaRuntimeEvidenceRange;
};

type MlaRuntimeLogPosition = {
  source: string;
  path: string;
  line: number;
  timestamp: string | null;
};

type MlaRuntimeSession = {
  session_id: string;
  start_kind: "process_start" | "partial_file";
  framework_status: "resolved" | "missing_version" | "conflict";
  framework_version: string | null;
  versions: string[];
  start: MlaRuntimeLogPosition;
  end: MlaRuntimeLogPosition;
  tasks: MlaRuntimeTaskExecution[];
  summary: {
    task_executions: number;
    succeeded_tasks: number;
    failed_tasks: number;
    running_tasks: number;
    direct_failures: number;
    next_list_timeouts: number;
    action_failures: number;
    signals: number;
  };
};

export type MlaRuntimeInspectionResult = {
  schema_version: "mla-runtime-inspection/v1";
  sessions: MlaRuntimeSession[];
  unscoped_tasks: MlaRuntimeTaskExecution[];
  failures: MlaRuntimeFailure[];
  outcomes: MlaRuntimeOutcome[];
  signals: MlaRuntimeSignal[];
  warnings: string[];
};

const copyEvidencePosition = (
  position: RuntimeEvidencePosition
): MlaRuntimeEvidencePosition => ({
  timestamp: position.timestamp,
  source: position.source,
  path: position.path,
  local_line: position.localLine
});

const copyEvidenceRange = (
  range: { start: RuntimeEvidencePosition; end: RuntimeEvidencePosition }
): MlaRuntimeEvidenceRange => ({
  start: copyEvidencePosition(range.start),
  end: copyEvidencePosition(range.end)
});

const copyMetricDistribution = (
  distribution: RuntimeMetricDistribution
): MlaRuntimeMetricDistribution => ({
  count: distribution.count,
  minimum: distribution.minimum,
  p50: distribution.p50,
  p95: distribution.p95,
  maximum: distribution.maximum,
  average: distribution.average
});

const copyScope = (
  scope: RuntimeFailure | RuntimeOutcome | RuntimeSignal
): MlaRuntimeScope => ({
  session_id: scope.sessionId,
  execution_id: scope.executionId,
  task_id: scope.taskId,
  task_name: scope.taskName
});

const copyFailure = (failure: RuntimeFailure): MlaRuntimeFailure => ({
  ...copyScope(failure),
  failure_id: failure.failureId,
  kind: failure.kind,
  node_id: failure.nodeId,
  node_name: failure.nodeName,
  started_at: failure.startedAt,
  ended_at: failure.endedAt,
  error_images: [...failure.errorImages],
  vision_images: [...failure.visionImages],
  evidence: copyEvidencePosition(failure.evidence)
});

const copyOutcome = (outcome: RuntimeOutcome): MlaRuntimeOutcome => ({
  ...copyScope(outcome),
  outcome_id: outcome.outcomeId,
  kind: outcome.kind,
  status: outcome.status,
  node_id: outcome.nodeId,
  node_name: outcome.nodeName,
  direct_failure_ids: [...outcome.directFailureIds],
  evidence: copyEvidencePosition(outcome.evidence)
});

const copyRecognitionOccurrence = (
  occurrence: RecognitionOccurrenceSample
): MlaRecognitionOccurrenceSample => ({
  node_id: occurrence.nodeId,
  started_at: occurrence.startedAt,
  ended_at: occurrence.endedAt,
  attempt_count: occurrence.attemptCount,
  unsuccessful_attempts: occurrence.unsuccessfulAttempts,
  terminal_match: occurrence.terminalMatch,
  evidence: copyEvidenceRange(occurrence.evidence)
});

const copyRecognitionSignal = (
  signal: RecognitionActivitySignal
): MlaRecognitionActivitySignal => ({
  ...copyScope(signal),
  signal_id: signal.signalId,
  kind: signal.kind,
  pipeline_node_name: signal.pipelineNodeName,
  next_list: signal.nextList.map((item) => ({
    name: item.name,
    anchor: item.anchor,
    jump_back: item.jumpBack
  })),
  occurrence_count: signal.occurrenceCount,
  occurrences_with_mixed_results: signal.occurrencesWithMixedResults,
  terminal_outcomes: {
    matched: signal.terminalOutcomes.matched,
    timeout: signal.terminalOutcomes.timeout,
    running: signal.terminalOutcomes.running,
    unmatched: signal.terminalOutcomes.unmatched
  },
  terminal_matches: signal.terminalMatches.map((item) => ({
    name: item.name,
    count: item.count
  })),
  candidate_statistics: signal.candidateStatistics.map((item) => ({
    name: item.name,
    evaluation_count: item.evaluationCount,
    matched_attempt_count: item.matchedAttemptCount,
    unsuccessful_attempt_count: item.unsuccessfulAttemptCount,
    running_attempt_count: item.runningAttemptCount,
    terminal_match_count: item.terminalMatchCount
  })),
  unmapped_attempt_count: signal.unmappedAttemptCount,
  attempts: copyMetricDistribution(signal.attempts),
  unsuccessful_attempts: copyMetricDistribution(signal.unsuccessfulAttempts),
  duration_ms: copyMetricDistribution(signal.durationMs),
  representatives: {
    first: copyRecognitionOccurrence(signal.representatives.first),
    worst: copyRecognitionOccurrence(signal.representatives.worst),
    last: copyRecognitionOccurrence(signal.representatives.last)
  },
  priority: signal.priority,
  priority_reasons: [...signal.priorityReasons]
});

const copyRepeatedNodeOccurrence = (
  occurrence: RepeatedNodeOccurrenceSample
): MlaRepeatedNodeRepresentative => ({
  pattern: [...occurrence.pattern],
  first_seen_at: occurrence.firstSeenAt,
  last_seen_at: occurrence.lastSeenAt,
  repeat_count: occurrence.repeatCount,
  duration_ms: occurrence.durationMs,
  termination: occurrence.termination,
  evidence: copyEvidencePosition(occurrence.evidence)
});

const copyRepeatedNodeSignal = (
  signal: RepeatedNodeSequenceSignal
): MlaRepeatedNodeSequenceSignal => ({
  ...copyScope(signal),
  signal_id: signal.signalId,
  kind: signal.kind,
  pattern: [...signal.pattern],
  segment_count: signal.segmentCount,
  total_repeat_count: signal.totalRepeatCount,
  maximum_repeat_count: signal.maximumRepeatCount,
  duration_ms: copyMetricDistribution(signal.durationMs),
  terminations: {
    left_pattern: signal.terminations.leftPattern,
    task_ended: signal.terminations.taskEnded,
    still_repeating_at_log_end: signal.terminations.stillRepeatingAtLogEnd
  },
  representatives: {
    first: copyRepeatedNodeOccurrence(signal.representatives.first),
    longest: copyRepeatedNodeOccurrence(signal.representatives.longest),
    last: copyRepeatedNodeOccurrence(signal.representatives.last)
  },
  detector: {
    name: signal.detector.name,
    version: signal.detector.version,
    minimum_repeats: signal.detector.minimumRepeats,
    maximum_pattern_length: signal.detector.maximumPatternLength
  },
  priority: signal.priority,
  priority_reasons: [...signal.priorityReasons]
});

const copySignal = (signal: RuntimeSignal): MlaRuntimeSignal => {
  switch (signal.kind) {
    case "recognition_activity":
      return copyRecognitionSignal(signal);
    case "repeated_node":
    case "repeated_node_cycle":
      return copyRepeatedNodeSignal(signal);
  }
};

const copyTaskStatistics = (
  statistics: RuntimeTaskStatistics
): MlaRuntimeTaskStatistics => ({
  node_executions: statistics.nodeExecutions,
  succeeded_nodes: statistics.succeededNodes,
  failed_nodes: statistics.failedNodes,
  running_nodes: statistics.runningNodes,
  recognition_attempts: statistics.recognitionAttempts,
  unsuccessful_recognition_attempts: statistics.unsuccessfulRecognitionAttempts,
  node_executions_with_recognition: statistics.nodeExecutionsWithRecognition,
  node_executions_with_mixed_recognition_results:
    statistics.nodeExecutionsWithMixedRecognitionResults,
  recognition_activity_groups: statistics.recognitionActivityGroups,
  maximum_recognition_attempts_per_node:
    statistics.maximumRecognitionAttemptsPerNode,
  maximum_unsuccessful_recognition_attempts_per_node:
    statistics.maximumUnsuccessfulRecognitionAttemptsPerNode,
  action_attempts: statistics.actionAttempts,
  action_failures: statistics.actionFailures,
  next_list_timeouts: statistics.nextListTimeouts,
  error_image_references: statistics.errorImageReferences,
  unique_error_images: statistics.uniqueErrorImages,
  vision_image_references: statistics.visionImageReferences,
  unique_vision_images: statistics.uniqueVisionImages
});

const copyTask = (task: RuntimeTaskExecution): MlaRuntimeTaskExecution => ({
  execution_id: task.executionId,
  task_id: task.taskId,
  name: task.name,
  hash: task.hash,
  uuid: task.uuid,
  status: task.status,
  completeness: task.completeness,
  started_at: task.startedAt,
  ended_at: task.endedAt,
  observed_duration_ms: task.observedDurationMs,
  first_node: task.firstNode,
  last_node: task.lastNode,
  statistics: copyTaskStatistics(task.statistics),
  direct_failure_ids: [...task.directFailureIds],
  outcome_ids: [...task.outcomeIds],
  signal_ids: [...task.signalIds],
  signal_highlights: {
    recognition_activity: [...task.signalHighlights.recognitionActivity],
    repetitions: [...task.signalHighlights.repetitions]
  },
  evidence: copyEvidenceRange(task.evidence)
});

const copySession = (session: RuntimeSession): MlaRuntimeSession => ({
  session_id: session.sessionId,
  start_kind: session.startKind,
  framework_status: session.frameworkStatus,
  framework_version: session.frameworkVersion,
  versions: [...session.versions],
  start: {
    source: session.start.source,
    path: session.start.path,
    line: session.start.line,
    timestamp: session.start.timestamp
  },
  end: {
    source: session.end.source,
    path: session.end.path,
    line: session.end.line,
    timestamp: session.end.timestamp
  },
  tasks: session.tasks.map(copyTask),
  summary: {
    task_executions: session.summary.taskExecutions,
    succeeded_tasks: session.summary.succeededTasks,
    failed_tasks: session.summary.failedTasks,
    running_tasks: session.summary.runningTasks,
    direct_failures: session.summary.directFailures,
    next_list_timeouts: session.summary.nextListTimeouts,
    action_failures: session.summary.actionFailures,
    signals: session.summary.signals
  }
});

export const translateRuntimeInspection = (
  inspection: RuntimeInspection
): MlaRuntimeInspectionResult => ({
  schema_version: inspection.schemaVersion,
  sessions: inspection.sessions.map(copySession),
  unscoped_tasks: inspection.unscopedTasks.map(copyTask),
  failures: inspection.failures.map(copyFailure),
  outcomes: inspection.outcomes.map(copyOutcome),
  signals: inspection.signals.map(copySignal),
  warnings: [...inspection.warnings]
});
