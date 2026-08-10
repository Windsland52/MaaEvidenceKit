import { access, stat } from "node:fs/promises";
import path from "node:path";

import {
  analyzeLogContent,
  buildRuntimeInspection,
  extractFrameworkSessions,
  loadFrameworkLogSources,
  loadNodeLogDirectory,
  readNodeTextFileContent,
  type LogBundleFocus,
  type SourceSegment,
} from "@windsland52/maa-log-tools";

import {
  EVIDENCE_SCHEMA_VERSION,
  EvidenceLedger,
  artifactId,
  parseTimestamp,
  portablePath,
  type Artifact,
  type Evidence,
  type EvidenceSource,
  type InspectionResult,
  type TimeRange,
} from "../evidence/index.js";
import { profileStage, profileStageSync } from "../profiling.js";
import { discoverArtifacts } from "./discovery.js";
import {
  extractPipelineOverrides,
  type MlaPipelineOverrideObservation,
} from "./overrides.js";
import { translateRuntimeInspection, type MlaRuntimeInspectionResult } from "./translate.js";

const MAX_ACTION_DETAILS = 500;
const MAX_PIPELINE_OVERRIDES = 500;
const MAX_FAILURE_CONTEXT_TASKS = 5;
const MAX_FAILURE_CONTEXT_FAILURES = 5;

type RuntimeTask = MlaRuntimeInspectionResult["sessions"][number]["tasks"][number];
type RuntimePosition = {
  timestamp: string | null;
  path: string | null;
  local_line: number | null;
};

type RecognitionDetailCandidate = {
  box?: [number, number, number, number];
  score?: number;
  text?: string;
  count?: number;
  label?: string;
  clsIndex?: number;
};

type RecognitionChildSummary = {
  name: string | null;
  algorithm: string | null;
  box: [number, number, number, number] | null;
  allCount: number | null;
  filteredCount: number | null;
  best: RecognitionDetailCandidate | null;
};

type RecognitionDetailShape =
  | { kind: "none" }
  | { kind: "candidate_list"; all: RecognitionDetailCandidate[]; filtered: RecognitionDetailCandidate[]; best: RecognitionDetailCandidate | null }
  | { kind: "child_array"; children: RecognitionChildSummary[] }
  | { kind: "unknown" };

type RecognitionDescendantSummary = {
  path: string[];
  name: string | null;
  algorithm: string | null;
  allCount: number;
  filteredCount: number;
  best: RecognitionDetailCandidate | null;
};

type RecognitionDetailSample = RecognitionDetailCandidate & {
  timestamp: string;
  mergedLine: number | null;
  source?: EvidenceSource;
};

export type MlaRecognitionDetailCandidate = RecognitionDetailCandidate;
export type MlaRecognitionDetailSample = RecognitionDetailSample;

export type MlaRecognitionTextCountSummary = {
  observations: number;
  unique: number;
  returned: number;
  truncated: boolean;
};

type RecognitionScoreDistribution = {
  count: number;
  minimum: number;
  p50: number;
  p95: number;
  maximum: number;
  average: number;
};

export type MlaRecognitionCandidateStage = {
  candidateCount: number;
  textCounts: Array<{ text: string; count: number }>;
  textCountSummary: MlaRecognitionTextCountSummary;
  score: RecognitionScoreDistribution | null;
  samples: MlaRecognitionDetailSample[];
  samplesTruncated: boolean;
};

export type MlaRecognitionDetail = {
  algorithm: string;
  node: string;
  status: "succeeded" | "failed";
  occurrenceCount: number;
  textCounts: Array<{ text: string; count: number }>;
  textCountSummary: MlaRecognitionTextCountSummary;
  score: RecognitionScoreDistribution | null;
  representatives: {
    first: RecognitionDetailSample;
    worst: RecognitionDetailSample | null;
  };
  detailShape: "candidate_list" | "child_array" | "none" | "unknown" | "mixed";
  candidateCounts: {
    all: { count: number; minimum: number; maximum: number; average: number } | null;
    filtered: { count: number; minimum: number; maximum: number; average: number } | null;
    bestPresent: number;
  } | null;
  candidateStages: {
    all: MlaRecognitionCandidateStage;
    filtered: MlaRecognitionCandidateStage;
    best: MlaRecognitionCandidateStage;
  } | null;
  best: RecognitionDetailSample[];
  bestTruncated: boolean;
  childRecognition: Array<{
    name: string | null;
    algorithm: string | null;
    occurrenceCount: number;
    allCount: number | null;
    filteredCount: number | null;
  }>;
  childRecognitionTotal: number;
  childRecognitionTruncated: boolean;
  descendantRecognition?: Array<{
    path: string[];
    name: string | null;
    algorithm: string | null;
    occurrenceCount: number;
    allCount: number;
    filteredCount: number;
    best: MlaRecognitionDetailSample[];
    bestTruncated: boolean;
  }>;
  descendantRecognitionTruncated?: boolean;
};

export type MlaActionDetailSample = {
  box: [number, number, number, number] | null;
  detail: unknown;
  taskId: number | null;
  timestamp: string;
  mergedLine: number | null;
  source?: EvidenceSource;
};

export type MlaActionDetail = {
  action: string;
  node: string;
  status: "succeeded" | "failed";
  occurrenceCount: number;
  taskId: number | null;
  representatives: {
    first: MlaActionDetailSample;
    last: MlaActionDetailSample;
  };
};

export type MlaTaskAnomaly = {
  executionId: string;
  taskId: number;
  taskName: string;
  status: "succeeded";
  observed: string[];
  nextListTimeouts: number;
  actionFailures: number;
  stillRepeatingAtLogEnd: number;
  allEvaluationsFailed: number;
};

export type MlaCycleExitCandidate = {
  node: string;
  evaluationCount: number;
  matchedAttemptCount: number;
  unsuccessfulAttemptCount: number;
  terminalMatchCount: number;
};

export function cycleExitCandidates(
  runtime: MlaRuntimeInspectionResult,
  signal: MlaRuntimeInspectionResult["signals"][number],
): MlaCycleExitCandidate[] {
  if (signal.kind === "recognition_activity") return [];
  const byNode = new Map<string, MlaCycleExitCandidate[]>();
  for (const candidate of runtime.signals) {
    if (candidate.kind !== "recognition_activity" || candidate.execution_id !== signal.execution_id) continue;
    byNode.set(candidate.pipeline_node_name, candidate.candidate_statistics.map((item) => ({
      node: item.name,
      evaluationCount: item.evaluation_count,
      matchedAttemptCount: item.matched_attempt_count,
      unsuccessfulAttemptCount: item.unsuccessful_attempt_count,
      terminalMatchCount: item.terminal_match_count,
    })));
  }

  return [...new Set(signal.pattern.flatMap((node) => byNode.get(node) ?? []))]
    .filter((candidate) =>
      candidate.evaluationCount > 0
      && candidate.matchedAttemptCount === 0
      && candidate.terminalMatchCount === 0,
    );
}

export type MlaCycleCandidateOutcome = {
  cycleSignalId: string;
  pipelineNode: string;
  candidate: string;
  evaluationCount: number;
  matchedAttemptCount: number;
  unsuccessfulAttemptCount: number;
  runningAttemptCount: number;
  terminalMatchCount: number;
  persistentFailure: boolean;
  evidence: {
    timestamp: string | null;
    source: string | null;
    path: string | null;
    local_line: number | null;
  };
  relatedRecognition?: MlaBlockerRelatedRecognition;
};

export type MlaBlockerRelatedRecognition = {
  recognitionEvidenceId: string;
  algorithm: string;
  status: "succeeded" | "failed";
  detailShape: "candidate_list" | "child_array" | "none" | "unknown" | "mixed";
  score: number | null;
  text: string | null;
  count: number | null;
  label: string | null;
  childRecognition?: {
    name: string | null;
    algorithm: string | null;
    occurrenceCount: number;
  };
  timestamp: string;
};

function recognitionDetailTimestamp(item: Evidence): string {
  const sourceTimestamp = item.source.timestamp;
  if (typeof sourceTimestamp === "string" && sourceTimestamp.length > 0) return sourceTimestamp;
  const data = item.data as {
    representatives?: { first?: { timestamp?: string }; worst?: { timestamp?: string } };
    best?: Array<{ timestamp?: string }>;
  } | undefined;
  return data?.best?.[0]?.timestamp
    ?? data?.representatives?.first?.timestamp
    ?? data?.representatives?.worst?.timestamp
    ?? "";
}

function latestBlockerRecognitionSnapshot(related: readonly Evidence[]): MlaBlockerRelatedRecognition | undefined {
  const sorted = [...related].sort((left, right) =>
    recognitionDetailTimestamp(right).localeCompare(recognitionDetailTimestamp(left)),
  );
  const latest = sorted[0];
  if (latest === undefined) return undefined;
  const data = latest.data as MlaRecognitionDetail | undefined;
  if (data === undefined) return undefined;
  const best = data.best[0];
  const child = data.childRecognition === undefined ? undefined : data.childRecognition[0];
  return {
    recognitionEvidenceId: latest.id,
    algorithm: data.algorithm,
    status: data.status,
    detailShape: data.detailShape,
    score: best?.score ?? null,
    text: best?.text ?? null,
    count: best?.count ?? null,
    label: best?.label ?? null,
    ...(child === undefined
      ? {}
      : {
        childRecognition: {
          name: child.name,
          algorithm: child.algorithm,
          occurrenceCount: child.occurrenceCount,
        },
      }),
    timestamp: recognitionDetailTimestamp(latest),
  };
}

export function correlateCycleBlockers(evidence: readonly Evidence[]): Evidence[] {
  const recognitionByNode = new Map<string, Evidence[]>();
  for (const item of evidence) {
    if (item.kind !== "mla.recognition_detail") continue;
    const node = (item.data as { node?: string } | undefined)?.node;
    if (node === undefined) continue;
    const list = recognitionByNode.get(node) ?? [];
    list.push(item);
    recognitionByNode.set(node, list);
  }
  if (recognitionByNode.size === 0) return [...evidence];
  return evidence.map((item) => {
    if (item.kind !== "mla.cycle_exit_blocker") return item;
    const candidate = (item.data as { candidate?: string } | undefined)?.candidate;
    if (candidate === undefined) return item;
    const related = recognitionByNode.get(candidate);
    if (related === undefined) return item;
    const snapshot = latestBlockerRecognitionSnapshot(related);
    if (snapshot === undefined) return item;
    return {
      ...item,
      data: {
        ...(item.data as Record<string, unknown>),
        ...(item.data as MlaCycleCandidateOutcome).relatedRecognition === undefined
          ? { relatedRecognition: snapshot }
          : {},
      },
    };
  });
}

export function cycleCandidateOutcomes(
  runtime: MlaRuntimeInspectionResult,
  signal: MlaRuntimeInspectionResult["signals"][number],
): MlaCycleCandidateOutcome[] {
  if (signal.kind === "recognition_activity") return [];
  const byNode = new Map<string, MlaCycleCandidateOutcome[]>();
  for (const candidate of runtime.signals) {
    if (candidate.kind !== "recognition_activity" || candidate.execution_id !== signal.execution_id) continue;
    const occurrence = candidate.representatives.worst?.evidence.start ?? candidate.representatives.first.evidence.start;
    byNode.set(candidate.pipeline_node_name, candidate.candidate_statistics.map((item) => ({
      cycleSignalId: signal.signal_id,
      pipelineNode: candidate.pipeline_node_name,
      candidate: item.name,
      evaluationCount: item.evaluation_count,
      matchedAttemptCount: item.matched_attempt_count,
      unsuccessfulAttemptCount: item.unsuccessful_attempt_count,
      runningAttemptCount: item.running_attempt_count,
      terminalMatchCount: item.terminal_match_count,
      persistentFailure: item.evaluation_count > 0
        && item.matched_attempt_count === 0
        && item.terminal_match_count === 0,
      evidence: {
        timestamp: occurrence.timestamp,
        source: occurrence.source,
        path: occurrence.path,
        local_line: occurrence.local_line,
      },
    })));
  }
  return [...new Map(signal.pattern.flatMap((node) => byNode.get(node) ?? []).map((item) => [
    `${item.pipelineNode}|${item.candidate}`,
    item,
  ])).values()].filter((item) => item.evaluationCount > 0)
    .sort((left, right) => left.candidate.localeCompare(right.candidate));
}

export function cycleExitBlockers(
  runtime: MlaRuntimeInspectionResult,
  signal: MlaRuntimeInspectionResult["signals"][number],
): MlaCycleCandidateOutcome[] {
  return cycleCandidateOutcomes(runtime, signal).filter((item) => item.persistentFailure);
}

export type MlaInspectOptions = {
  timeRange?: TimeRange;
  keywords?: string[];
  includeAllSignals?: boolean;
};

export type MlaInspectionDetails = {
  runtime: MlaRuntimeInspectionResult;
  selection: {
    requestedTimeRange?: TimeRange;
    keywords: string[];
    loadingGranularity: "matched_files" | "single_file" | "multiple_bundles";
    targets: string[];
    signals: {
      mode: "focused" | "all";
      total: number;
      selected: number;
    };
    pipelineOverrides: {
      total: number;
      selected: number;
      malformedLines: number;
    };
  };
};

export type MlaInspectionResult = InspectionResult<MlaInspectionDetails> & { kind: "mla" };

function validateTimeRange(range: TimeRange | undefined): void {
  if (range?.from !== undefined) parseTimestamp(range.from, "timeRange.from");
  if (range?.to !== undefined) parseTimestamp(range.to, "timeRange.to");
  if (
    range?.from !== undefined
    && range.to !== undefined
    && Date.parse(range.from) > Date.parse(range.to)
  ) {
    throw new Error("timeRange.from must not be later than timeRange.to.");
  }
}

function focusFromOptions(options: MlaInspectOptions): LogBundleFocus | undefined {
  const focus: LogBundleFocus = {};
  if (options.keywords !== undefined && options.keywords.length > 0) {
    focus.keywords = [...new Set(options.keywords.map((item) => item.trim()).filter(Boolean))];
  }
  if (options.timeRange?.from !== undefined) focus.started_after = options.timeRange.from;
  if (options.timeRange?.to !== undefined) focus.started_before = options.timeRange.to;
  return Object.keys(focus).length === 0 ? undefined : focus;
}

function timestampWithin(timestamp: string | null, range: TimeRange | undefined): boolean {
  if (range === undefined || timestamp === null) return range === undefined;
  const value = Date.parse(timestamp);
  if (!Number.isFinite(value)) return false;
  if (range.from !== undefined && value < Date.parse(range.from)) return false;
  if (range.to !== undefined && value > Date.parse(range.to)) return false;
  return true;
}

function overlapsRange(start: string, end: string | null, range: TimeRange | undefined): boolean {
  if (range === undefined) return true;
  const startValue = Date.parse(start);
  const endValue = end === null ? startValue : Date.parse(end);
  if (!Number.isFinite(startValue) || !Number.isFinite(endValue)) return false;
  if (range.from !== undefined && endValue < Date.parse(range.from)) return false;
  if (range.to !== undefined && startValue > Date.parse(range.to)) return false;
  return true;
}

function filterRuntime(
  runtime: MlaRuntimeInspectionResult,
  range: TimeRange | undefined,
): MlaRuntimeInspectionResult {
  if (range === undefined) return runtime;
  const tasks = [...runtime.sessions.flatMap((session) => session.tasks), ...runtime.unscoped_tasks]
    .filter((task) => overlapsRange(task.started_at, task.ended_at, range));
  const executionIds = new Set(tasks.map((task) => task.execution_id));
  const sessions = runtime.sessions.flatMap((session) => {
    const selectedTasks = session.tasks.filter((task) => executionIds.has(task.execution_id));
    const boundaryWithin =
      timestampWithin(session.start.timestamp, range) || timestampWithin(session.end.timestamp, range);
    if (selectedTasks.length === 0 && !boundaryWithin) return [];
    return [{ ...session, tasks: selectedTasks }];
  });
  return {
    ...runtime,
    sessions,
    unscoped_tasks: runtime.unscoped_tasks.filter((task) => executionIds.has(task.execution_id)),
    failures: runtime.failures.filter(
      (failure) => executionIds.has(failure.execution_id) && timestampWithin(failure.evidence.timestamp, range),
    ),
    outcomes: runtime.outcomes.filter(
      (outcome) => executionIds.has(outcome.execution_id) && timestampWithin(outcome.evidence.timestamp, range),
    ),
    signals: runtime.signals.filter((signal) => executionIds.has(signal.execution_id)),
  };
}

function normalizeCandidate(value: string): string {
  const normalized = portablePath(value).replace(/^\.\//, "");
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

function artifactForPosition(
  artifacts: readonly Artifact[],
  inputPath: string,
  positionPath: string | null,
): Artifact {
  const candidate = normalizeCandidate(positionPath ?? path.basename(inputPath));
  const match = artifacts.find((item) => {
    const relative = normalizeCandidate(item.relativePath);
    return relative === candidate || relative.endsWith(`/${candidate}`) || candidate.endsWith(`/${relative}`);
  });
  if (match !== undefined) return match;
  const knownArtifact = artifacts.find((item) => item.kind === "maa_log") ?? artifacts[0];
  if (knownArtifact !== undefined) return knownArtifact;
  const fallbackPath = positionPath ?? inputPath;
  return {
    id: artifactId(candidate),
    path: fallbackPath,
    relativePath: portablePath(fallbackPath),
    kind: "maa_log",
    status: "selected",
  };
}

function imageArtifactForReference(
  artifacts: readonly Artifact[],
  reference: string,
): Artifact | undefined {
  const candidate = normalizeCandidate(reference.startsWith("file:") ? reference.slice(5) : reference);
  return artifacts.find((item) => {
    if (item.kind !== "image") return false;
    const relative = normalizeCandidate(item.relativePath);
    const absolute = normalizeCandidate(item.path);
    return relative === candidate || absolute === candidate || candidate.endsWith(`/${relative}`);
  });
}

function evidenceSource(
  artifacts: readonly Artifact[],
  inputPath: string,
  position: RuntimePosition,
  scope?: { task?: string; node?: string },
): EvidenceSource {
  const artifact = artifactForPosition(artifacts, inputPath, position.path);
  return {
    artifactId: artifact.id,
    path: artifact.relativePath,
    ...(position.local_line === null ? {} : { line: position.local_line }),
    ...(position.timestamp === null ? {} : { timestamp: position.timestamp }),
    ...(scope?.task === undefined ? {} : { task: scope.task }),
    ...(scope?.node === undefined ? {} : { node: scope.node }),
  };
}

function addPipelineOverrideEvidence(
  ledger: EvidenceLedger,
  observation: MlaPipelineOverrideObservation,
  artifacts: readonly Artifact[],
  inputPath: string,
  sourceSegments: readonly SourceSegment[],
): void {
  const position = positionForMergedLine(
    sourceSegments,
    observation.timestamp,
    observation.mergedLine,
  );
  const nodeDescription = observation.nodeNames.length === 1
    ? observation.nodeNames[0]
    : `${observation.nodeNames.length} nodes`;
  ledger.add(
    "mla.pipeline_override",
    `Observed ${observation.origin.replaceAll("_", " ")} pipeline override for ${nodeDescription}.`,
    evidenceSource(artifacts, inputPath, position, {
      ...(observation.taskName === null ? {} : { task: observation.taskName }),
      ...(observation.nodeNames.length === 1 ? { node: observation.nodeNames[0] } : {}),
    }),
    {
      sequence: observation.sequence,
      scope: observation.scope,
      origin: observation.origin,
      taskAssociation: observation.taskAssociation,
      taskId: observation.taskId,
      taskName: observation.taskName,
      contextScopeId: observation.contextScopeId,
      nodeNames: observation.nodeNames,
      patches: observation.patches,
    },
  );
}

function addRuntimeEvidence(
  ledger: EvidenceLedger,
  runtime: MlaRuntimeInspectionResult,
  artifacts: readonly Artifact[],
  inputPath: string,
): void {
  const taskEvidenceIds = new Map<string, string>();
  const taskSessionIds = new Map<string, string | null>();
  for (const session of runtime.sessions) {
    ledger.add(
      "mla.session",
      session.framework_version === null
        ? `Observed MaaFramework session ${session.session_id} without a resolved version.`
        : `Observed MaaFramework ${session.framework_version} session ${session.session_id}.`,
      evidenceSource(artifacts, inputPath, {
        path: session.start.path,
        local_line: session.start.line,
        timestamp: session.start.timestamp,
      }),
      {
        sessionId: session.session_id,
        startKind: session.start_kind,
        frameworkStatus: session.framework_status,
        frameworkVersion: session.framework_version,
        versions: session.versions,
      },
    );
    for (const task of session.tasks) {
      taskEvidenceIds.set(task.execution_id, addTaskEvidence(ledger, task, artifacts, inputPath).id);
      taskSessionIds.set(task.execution_id, session.session_id);
    }
  }
  for (const task of runtime.unscoped_tasks) {
    taskEvidenceIds.set(task.execution_id, addTaskEvidence(ledger, task, artifacts, inputPath).id);
    taskSessionIds.set(task.execution_id, null);
  }
  const failureEvidenceIds = new Map<string, string>();
  const failureImageEvidenceIds = new Map<string, string[]>();
  for (const failure of runtime.failures) {
    const imageReferences = [...failure.error_images, ...failure.vision_images];
    for (const imageRef of imageReferences) {
      const imagePath = imageRef.startsWith("file:") ? imageRef.slice(5) : imageRef;
      const imageArtifact = imageArtifactForReference(artifacts, imageRef);
      const imageEvidence = ledger.add(
        "mla.failure_image",
        `Failure ${failure.node_name} references image ${imagePath}.`,
        imageArtifact === undefined
          ? evidenceSource(artifacts, inputPath, {
            timestamp: failure.evidence.timestamp,
            path: imagePath,
            local_line: null,
          }, {
            task: failure.task_name,
            node: failure.node_name,
          })
          : {
            artifactId: imageArtifact.id,
            path: imageArtifact.relativePath,
            ...(failure.evidence.timestamp === null ? {} : { timestamp: failure.evidence.timestamp }),
            task: failure.task_name,
            node: failure.node_name,
          },
        {
          failureId: failure.failure_id,
          imagePath,
          kind: failure.error_images.includes(imageRef) ? "error" : "vision",
          taskId: failure.task_id,
          taskName: failure.task_name,
          timestamp: failure.evidence.timestamp,
        },
      );
      const imageIds = failureImageEvidenceIds.get(failure.failure_id) ?? [];
      imageIds.push(imageEvidence.id);
      failureImageEvidenceIds.set(failure.failure_id, imageIds);
    }
    const failureEvidence = ledger.add(
      "mla.failure",
      `Node ${failure.node_name} reported ${failure.kind} in task ${failure.task_name}.`,
      evidenceSource(artifacts, inputPath, failure.evidence, {
        task: failure.task_name,
        node: failure.node_name,
      }),
      failure,
    );
    failureEvidenceIds.set(failure.failure_id, failureEvidence.id);
  }
  for (const failure of runtime.failures) {
    addFailureContextEvidence(
      ledger,
      runtime,
      failure,
      taskEvidenceIds,
      taskSessionIds,
      failureEvidenceIds,
      failureImageEvidenceIds,
      artifacts,
      inputPath,
    );
  }
  for (const outcome of runtime.outcomes) {
    ledger.add(
      "mla.outcome",
      `${outcome.kind === "task" ? "Task" : "Pipeline node"} ${outcome.node_name ?? outcome.task_name} was ${outcome.status}.`,
      evidenceSource(artifacts, inputPath, outcome.evidence, {
        task: outcome.task_name,
        ...(outcome.node_name === null ? {} : { node: outcome.node_name }),
      }),
      outcome,
    );
  }
  for (const signal of runtime.signals) {
    const representative = signal.kind === "recognition_activity"
      ? signal.representatives.worst
      : signal.representatives.longest;
    const position = "started_at" in representative
      ? representative.evidence.start
      : representative.evidence;
    ledger.add(
      "mla.signal",
      signal.kind === "recognition_activity"
        ? `Observed ${signal.occurrence_count} recognition occurrences for ${signal.pipeline_node_name}.`
        : `Observed repeated node sequence ${signal.pattern.join(" → ")}.`,
      evidenceSource(artifacts, inputPath, position, {
        task: signal.task_name,
        ...(signal.kind === "recognition_activity" ? { node: signal.pipeline_node_name } : {}),
      }),
      signal.kind === "recognition_activity"
        ? {
          signalId: signal.signal_id,
          kind: signal.kind,
          pipelineNodeName: signal.pipeline_node_name,
          priority: signal.priority,
          priorityReasons: signal.priority_reasons,
          occurrenceCount: signal.occurrence_count,
          occurrencesWithMixedResults: signal.occurrences_with_mixed_results,
          terminalOutcomes: signal.terminal_outcomes,
          terminalMatches: signal.terminal_matches,
          candidateStatistics: signal.candidate_statistics,
          attempts: signal.attempts,
          unsuccessfulAttempts: signal.unsuccessful_attempts,
          durationMs: signal.duration_ms,
          representative,
        }
        : {
          signalId: signal.signal_id,
          kind: signal.kind,
          priority: signal.priority,
          priorityReasons: signal.priority_reasons,
          pattern: signal.pattern,
          segmentCount: signal.segment_count,
          totalRepeatCount: signal.total_repeat_count,
          maximumRepeatCount: signal.maximum_repeat_count,
          durationMs: signal.duration_ms,
          terminations: signal.terminations,
          representative,
          exitCandidates: cycleExitCandidates(runtime, signal),
        },
    );
    if (signal.kind !== "recognition_activity") {
      const outcomes = cycleCandidateOutcomes(runtime, signal);
      for (const outcome of outcomes) {
        ledger.add(
          "mla.cycle_candidate_outcome",
          outcome.persistentFailure
            ? `Candidate ${outcome.candidate} was evaluated ${outcome.evaluationCount} times without matching inside cycle ${signal.pattern.join(" → ")}.`
            : `Candidate ${outcome.candidate} matched ${outcome.matchedAttemptCount} of ${outcome.evaluationCount} evaluations inside cycle ${signal.pattern.join(" → ")}.`,
          evidenceSource(artifacts, inputPath, outcome.evidence, {
            task: signal.task_name,
            node: outcome.pipelineNode,
          }),
          outcome,
        );
      }
      for (const blocker of cycleExitBlockers(runtime, signal)) {
        ledger.add(
          "mla.cycle_exit_blocker",
          `Candidate ${blocker.candidate} prevented cycle exit after ${blocker.evaluationCount} evaluations without a match inside cycle ${signal.pattern.join(" → ")}.`,
          evidenceSource(artifacts, inputPath, blocker.evidence, {
            task: signal.task_name,
            node: blocker.pipelineNode,
          }),
          blocker,
        );
      }
    }
  }
}

function addTaskEvidence(
  ledger: EvidenceLedger,
  task: RuntimeTask,
  artifacts: readonly Artifact[],
  inputPath: string,
): Evidence<RuntimeTask> {
  return ledger.add(
    "mla.task",
    `Task ${task.name} was ${task.status}${task.completeness === "open_at_log_end" ? " when the log ended" : ""}.`,
    evidenceSource(artifacts, inputPath, task.evidence.start, { task: task.name }),
    task,
  );
}

type RuntimeFailure = MlaRuntimeInspectionResult["failures"][number];

function failureContextTask(task: RuntimeTask, taskEvidenceId: string | undefined): Record<string, unknown> {
  return {
    executionId: task.execution_id,
    taskId: task.task_id,
    taskName: task.name,
    status: task.status,
    completeness: task.completeness,
    startedAt: task.started_at,
    endedAt: task.ended_at,
    firstNode: task.first_node,
    lastNode: task.last_node,
    ...(taskEvidenceId === undefined ? {} : { taskEvidenceId }),
  };
}

function addFailureContextEvidence(
  ledger: EvidenceLedger,
  runtime: MlaRuntimeInspectionResult,
  failure: RuntimeFailure,
  taskEvidenceIds: ReadonlyMap<string, string>,
  taskSessionIds: ReadonlyMap<string, string | null>,
  failureEvidenceIds: ReadonlyMap<string, string>,
  failureImageEvidenceIds: ReadonlyMap<string, string[]>,
  artifacts: readonly Artifact[],
  inputPath: string,
): void {
  const sessionId = taskSessionIds.get(failure.execution_id) ?? failure.session_id;
  const scopedTasks = sessionId === null
    ? runtime.unscoped_tasks
    : runtime.sessions.find((session) => session.session_id === sessionId)?.tasks ?? [];
  const currentTask = scopedTasks.find((task) => task.execution_id === failure.execution_id);
  const otherTasks = scopedTasks.filter((task) => task.execution_id !== failure.execution_id);
  const preceding = otherTasks
    .filter((task) => task.ended_at !== null && task.ended_at <= failure.started_at)
    .sort((left, right) => left.started_at.localeCompare(right.started_at));
  const concurrent = otherTasks
    .filter((task) => task.started_at <= failure.started_at && (task.ended_at === null || task.ended_at > failure.started_at))
    .sort((left, right) => left.started_at.localeCompare(right.started_at));
  const following = otherTasks
    .filter((task) => task.started_at > failure.started_at)
    .sort((left, right) => left.started_at.localeCompare(right.started_at));
  const selectedPreceding = preceding.slice(-MAX_FAILURE_CONTEXT_TASKS);
  const selectedConcurrent = concurrent.slice(-MAX_FAILURE_CONTEXT_TASKS);
  const selectedFollowing = following.slice(0, MAX_FAILURE_CONTEXT_TASKS);
  const scopedFailures = runtime.failures
    .filter((item) => (taskSessionIds.get(item.execution_id) ?? item.session_id) === sessionId)
    .sort((left, right) => left.started_at.localeCompare(right.started_at));
  const failureIndex = scopedFailures.findIndex((item) => item.failure_id === failure.failure_id);
  const nearbyStart = Math.min(
    Math.max(0, failureIndex - Math.floor(MAX_FAILURE_CONTEXT_FAILURES / 2)),
    Math.max(0, scopedFailures.length - MAX_FAILURE_CONTEXT_FAILURES),
  );
  const nearbyFailures = scopedFailures
    .slice(nearbyStart, nearbyStart + MAX_FAILURE_CONTEXT_FAILURES)
    .map((item, index) => ({
      relation: item.failure_id === failure.failure_id
        ? "current"
        : nearbyStart + index < failureIndex ? "preceding" : "following",
      failureId: item.failure_id,
      failureEvidenceId: failureEvidenceIds.get(item.failure_id) ?? null,
      taskId: item.task_id,
      taskName: item.task_name,
      nodeName: item.node_name,
      kind: item.kind,
      startedAt: item.started_at,
      endedAt: item.ended_at,
      imageEvidenceIds: failureImageEvidenceIds.get(item.failure_id) ?? [],
    }));
  const precedingNames = selectedPreceding.map((task) => task.name);
  const summary = precedingNames.length === 0
    ? `Failure context for ${failure.node_name} has no completed preceding task in the selected runtime scope.`
    : `Failure context for ${failure.node_name} follows ${precedingNames.join(" -> ")}.`;
  ledger.add(
    "mla.failure_context",
    summary,
    evidenceSource(artifacts, inputPath, failure.evidence, {
      task: failure.task_name,
      node: failure.node_name,
    }),
    {
      failureId: failure.failure_id,
      failureEvidenceId: failureEvidenceIds.get(failure.failure_id) ?? null,
      sessionId,
      currentTask: currentTask === undefined ? null : failureContextTask(currentTask, taskEvidenceIds.get(currentTask.execution_id)),
      precedingTasks: selectedPreceding.map((task) => failureContextTask(task, taskEvidenceIds.get(task.execution_id))),
      concurrentTasks: selectedConcurrent.map((task) => failureContextTask(task, taskEvidenceIds.get(task.execution_id))),
      followingTasks: selectedFollowing.map((task) => failureContextTask(task, taskEvidenceIds.get(task.execution_id))),
      nearbyFailures,
      counts: {
        precedingTasks: preceding.length,
        concurrentTasks: concurrent.length,
        followingTasks: following.length,
        sessionFailures: scopedFailures.length,
      },
      truncated: {
        precedingTasks: preceding.length > selectedPreceding.length,
        concurrentTasks: concurrent.length > selectedConcurrent.length,
        followingTasks: following.length > selectedFollowing.length,
        nearbyFailures: scopedFailures.length > nearbyFailures.length,
      },
    },
  );
}

function addPossibleMirroredTaskEvidence(
  ledger: EvidenceLedger,
  groups: readonly MlaPossibleMirroredTaskGroup[],
  loadedTargets: readonly LoadedMlaTarget[],
  artifacts: readonly Artifact[],
  inputPath: string,
): void {
  const targetForMember = (member: MlaPossibleMirroredTaskMember): LoadedMlaTarget | undefined =>
    loadedTargets.find((target) => target.target.namespace === member.namespace);
  const sourceArtifactForMember = (
    member: MlaPossibleMirroredTaskMember,
    positionPath: string | null,
  ): Artifact | undefined => {
    const target = targetForMember(member);
    return target === undefined
      ? undefined
      : artifactForPosition(target.artifacts, target.target.path, positionPath);
  };
  for (const group of groups) {
    const first = group.members[0];
    if (first === undefined) continue;
    const firstArtifact = sourceArtifactForMember(first, first.source.start.path);
    const members = group.members.map((member) => {
      const startArtifact = sourceArtifactForMember(member, member.source.start.path);
      const endArtifact = sourceArtifactForMember(member, member.source.end.path);
      return {
        ...member,
        source: {
          start: {
            ...member.source.start,
            path: startArtifact?.relativePath ?? member.source.start.path,
          },
          end: {
            ...member.source.end,
            path: endArtifact?.relativePath ?? member.source.end.path,
          },
        },
      };
    });
    const data = { ...group, members };
    ledger.add(
      "mla.possible_mirrored_task_group",
      `Observed possible mirrored task ${group.fingerprint.name} across namespaces ${group.namespaces.join(", ")}; instances remain unmerged observations.`,
      firstArtifact === undefined
        ? evidenceSource(artifacts, inputPath, {
          path: first.source.start.path,
          local_line: first.source.start.line,
          timestamp: first.source.start.timestamp,
        }, { task: group.fingerprint.name })
        : {
          artifactId: firstArtifact.id,
          path: firstArtifact.relativePath,
          ...(first.source.start.line === null ? {} : { line: first.source.start.line }),
          ...(first.source.start.timestamp === null ? {} : { timestamp: first.source.start.timestamp }),
          task: group.fingerprint.name,
        },
      data,
    );
  }
}

export function summarizeTaskAnomalies(runtime: MlaRuntimeInspectionResult): MlaTaskAnomaly[] {
  const signalsByTask = new Map<string, MlaRuntimeInspectionResult["signals"]>();
  for (const signal of runtime.signals) {
    const group = signalsByTask.get(signal.execution_id) ?? [];
    group.push(signal);
    signalsByTask.set(signal.execution_id, group);
  }
  const tasks = [...runtime.sessions.flatMap((session) => session.tasks), ...runtime.unscoped_tasks];
  const anomalies: MlaTaskAnomaly[] = [];
  for (const task of tasks) {
    if (task.status !== "succeeded") continue;
    const observed: string[] = [];
    let stillRepeatingAtLogEnd = 0;
    let allEvaluationsFailed = 0;
    if (task.statistics.next_list_timeouts > 0) observed.push("next_list_timeout");
    if (task.statistics.action_failures > 0) observed.push("action_failure");
    for (const signal of signalsByTask.get(task.execution_id) ?? []) {
      if (signal.kind === "repeated_node" || signal.kind === "repeated_node_cycle") {
        stillRepeatingAtLogEnd += signal.terminations.still_repeating_at_log_end;
        for (const outcome of cycleCandidateOutcomes(runtime, signal)) {
          if (
            outcome.evaluationCount > 0
            && outcome.unsuccessfulAttemptCount === outcome.evaluationCount
            && outcome.runningAttemptCount === 0
          ) {
            allEvaluationsFailed += 1;
          }
        }
      }
    }
    if (allEvaluationsFailed > 0) observed.push("all_evaluations_failed");
    if (
      stillRepeatingAtLogEnd > 0
      && (task.statistics.next_list_timeouts > 0 || task.statistics.action_failures > 0)
    ) {
      observed.push("still_repeating_at_log_end");
    }
    if (observed.length === 0) continue;
    anomalies.push({
      executionId: task.execution_id,
      taskId: task.task_id,
      taskName: task.name,
      status: "succeeded",
      observed,
      nextListTimeouts: task.statistics.next_list_timeouts,
      actionFailures: task.statistics.action_failures,
      stillRepeatingAtLogEnd,
      allEvaluationsFailed,
    });
  }
  return anomalies.sort((left, right) => left.executionId.localeCompare(right.executionId));
}

function addTaskAnomalyEvidence(
  ledger: EvidenceLedger,
  anomaly: MlaTaskAnomaly,
  task: RuntimeTask,
  artifacts: readonly Artifact[],
  inputPath: string,
): void {
  ledger.add(
    "mla.task_anomaly",
    `Task ${anomaly.taskName} succeeded with anomalies: ${anomaly.observed.join(", ")}.`,
    evidenceSource(artifacts, inputPath, task.evidence.start, { task: anomaly.taskName }),
    anomaly,
  );
}

function candidateSummaryText(candidate: RecognitionDetailCandidate | undefined): string {
  if (candidate === undefined) return "";
  const parts: string[] = [];
  if (candidate.score !== undefined) parts.push(`score=${candidate.score.toFixed(4)}`);
  if (candidate.text !== undefined) parts.push(JSON.stringify(candidate.text));
  if (candidate.count !== undefined) parts.push(`count=${candidate.count}`);
  if (candidate.label !== undefined) parts.push(`label=${candidate.label}`);
  return parts.join(" ");
}

function addRecognitionDetailEvidence(
  ledger: EvidenceLedger,
  detail: MlaRecognitionDetail,
  artifacts: readonly Artifact[],
  inputPath: string,
  sourceSegments: readonly SourceSegment[],
): void {
  const textSummary = detail.textCounts.length > 0
    ? ` texts=${detail.textCounts.slice(0, 3).map((item) => JSON.stringify(item.text)).join(", ")}`
    : "";
  const scoreSummary = detail.score === null
    ? ""
    : ` score=${detail.score.minimum.toFixed(4)}..${detail.score.maximum.toFixed(4)}`;
  const filteredSummary = detail.candidateCounts === null || detail.candidateCounts?.filtered === null
    ? ""
    : ` filtered=${detail.candidateCounts?.filtered?.average.toFixed(1)}`;
  const bestSummary = detail.best.length > 0
    ? ` best=${candidateSummaryText(detail.best[0])}`
    : "";
  const childSummary = detail.childRecognition.length > 0
    ? ` children=${detail.childRecognitionTotal}${detail.childRecognitionTruncated ? " (truncated)" : ""}`
    : "";
  const summary = `Recognition ${detail.node} ${detail.status} (${detail.algorithm}) x${detail.occurrenceCount}${textSummary}${scoreSummary}${filteredSummary}${bestSummary}${childSummary}`;
  const representative = detail.representatives.worst ?? detail.representatives.first;
  const sourceForSample = (sample: RecognitionDetailSample): EvidenceSource | undefined => {
    if (sample.mergedLine === null) return undefined;
    const position = positionForMergedLine(sourceSegments, sample.timestamp, sample.mergedLine);
    if (position.path === null || position.local_line === null) return undefined;
    return evidenceSource(artifacts, inputPath, position, { node: detail.node });
  };
  const withSampleSource = (sample: RecognitionDetailSample): RecognitionDetailSample => {
    const source = sourceForSample(sample);
    return source === undefined ? sample : { ...sample, source };
  };
  const detailWithSources: MlaRecognitionDetail = {
    ...detail,
    representatives: {
      first: withSampleSource(detail.representatives.first),
      worst: detail.representatives.worst === null ? null : withSampleSource(detail.representatives.worst),
    },
    best: detail.best.map(withSampleSource),
    ...(detail.descendantRecognition === undefined
      ? {}
      : {
        descendantRecognition: detail.descendantRecognition.map((descendant) => ({
          ...descendant,
          best: descendant.best.map(withSampleSource),
        })),
      }),
    candidateStages: detail.candidateStages === null
      ? null
      : {
        all: {
          ...detail.candidateStages.all,
          samples: detail.candidateStages.all.samples.map(withSampleSource),
        },
        filtered: {
          ...detail.candidateStages.filtered,
          samples: detail.candidateStages.filtered.samples.map(withSampleSource),
        },
        best: {
          ...detail.candidateStages.best,
          samples: detail.candidateStages.best.samples.map(withSampleSource),
        },
      },
  };
  ledger.add(
    "mla.recognition_detail",
    summary,
    evidenceSource(
      artifacts,
      inputPath,
      positionForMergedLine(sourceSegments, representative.timestamp, representative.mergedLine),
      { node: detail.node },
    ),
    detailWithSources,
  );
}

function addActionDetailEvidence(
  ledger: EvidenceLedger,
  detail: MlaActionDetail,
  artifacts: readonly Artifact[],
  inputPath: string,
  sourceSegments: readonly SourceSegment[],
): void {
  const sourceForSample = (sample: MlaActionDetailSample): EvidenceSource | undefined => {
    if (sample.mergedLine === null) return undefined;
    const position = positionForMergedLine(sourceSegments, sample.timestamp, sample.mergedLine);
    if (position.path === null || position.local_line === null) return undefined;
    return evidenceSource(artifacts, inputPath, position, { node: detail.node });
  };
  const withSource = (sample: MlaActionDetailSample): MlaActionDetailSample => {
    const source = sourceForSample(sample);
    return source === undefined ? sample : { ...sample, source };
  };
  const first = withSource(detail.representatives.first);
  const last = withSource(detail.representatives.last);
  const detailWithSources: MlaActionDetail = {
    ...detail,
    representatives: { first, last },
  };
  ledger.add(
    "mla.action_detail",
    `Action ${detail.node} ${detail.status} (${detail.action}) x${detail.occurrenceCount}`
      + `${detail.taskId === null ? "" : ` task=${detail.taskId}`}.`,
    evidenceSource(
      artifacts,
      inputPath,
      positionForMergedLine(
        sourceSegments,
        detail.representatives.first.timestamp,
        detail.representatives.first.mergedLine,
      ),
      { node: detail.node },
    ),
    detailWithSources,
  );
}

function positionForMergedLine(
  sourceSegments: readonly SourceSegment[],
  timestamp: string,
  mergedLine: number | null,
): RuntimePosition {
  if (mergedLine === null) return { timestamp, path: null, local_line: null };
  const segment = sourceSegments.find((item) =>
    mergedLine >= item.startLine && mergedLine < item.startLine + item.lineCount
  );
  if (segment === undefined) return { timestamp, path: null, local_line: null };
  return {
    timestamp,
    path: segment.path,
    local_line: mergedLine - segment.startLine + 1,
  };
}

function emptyRuntime(warnings: string[] = []): MlaRuntimeInspectionResult {
  return {
    schema_version: "mla-runtime-inspection/v1",
    sessions: [],
    unscoped_tasks: [],
    failures: [],
    outcomes: [],
    signals: [],
    warnings,
  };
}

type MlaTarget = {
  path: string;
  kind: "directory" | "file";
  label: string;
  namespace: string;
};

type LoadedMlaTarget = {
  target: MlaTarget;
  runtime: MlaRuntimeInspectionResult;
  recognitionDetails: MlaRecognitionDetail[];
  actionDetails: MlaActionDetail[];
  actionDetailsTotal: number;
  actionOccurrences: number;
  pipelineOverrides: MlaPipelineOverrideObservation[];
  pipelineOverridesTotal: number;
  pipelineOverrideMalformedLines: number;
  sourceSegments: SourceSegment[];
  artifacts: Artifact[];
};

type MlaImageMaps = {
  errorImages: Map<string, string>;
  visionImages: Map<string, string>;
  waitFreezesImages: Map<string, string>;
};

const PROJECT_MARKERS = [
  "interface.json",
  "interface.jsonc",
  "package.json",
  "pyproject.toml",
  "assets/interface.json",
  "assets/interface.jsonc",
  ".git",
  "node_modules",
  "src",
];

async function pathExists(candidate: string): Promise<boolean> {
  try {
    await access(candidate);
    return true;
  } catch {
    return false;
  }
}

async function looksLikeProjectRoot(root: string): Promise<boolean> {
  const markers = await Promise.all(PROJECT_MARKERS.map((marker) => pathExists(path.join(root, marker))));
  return markers.some(Boolean);
}

function isMainLog(file: string): boolean {
  const name = path.basename(file).toLowerCase();
  return name === "maa.log" || name === "maafw.log";
}

function targetLabel(root: string, target: string, inputIsDirectory: boolean): string {
  if (!inputIsDirectory) return path.basename(target);
  const relative = portablePath(path.relative(root, target));
  return relative === "" ? "." : relative;
}

function pathKey(target: string): string {
  const resolved = path.resolve(target);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function segmentPath(target: MlaTarget, segment: SourceSegment): string {
  if (path.isAbsolute(segment.path)) return segment.path;
  const base = target.kind === "directory" ? target.path : path.dirname(target.path);
  return path.resolve(base, segment.path);
}

function isPathInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function imageKey(
  fileName: string,
  pattern: RegExp,
): string | null {
  const match = fileName.match(pattern);
  if (match === null) return null;
  const timestamp = match[1];
  const milliseconds = match[2];
  const suffix = match[3];
  if (timestamp === undefined || milliseconds === undefined || suffix === undefined) return null;
  return `${timestamp}.${milliseconds.padEnd(3, "0")}_${suffix}`;
}

function buildImageMapsByLogDirectory(
  targets: readonly MlaTarget[],
  artifacts: readonly Artifact[],
): Map<string, MlaImageMaps> {
  const directories = [...new Set(targets.map((target) =>
    path.resolve(target.kind === "directory" ? target.path : path.dirname(target.path))
  ))];
  const result = new Map(directories.map((directory) => [pathKey(directory), {
    errorImages: new Map<string, string>(),
    visionImages: new Map<string, string>(),
    waitFreezesImages: new Map<string, string>(),
  }]));
  for (const artifact of artifacts) {
    if (artifact.kind !== "image") continue;
    const imagePath = path.resolve(artifact.path);
    const directory = directories
      .filter((candidate) => isPathInside(candidate, imagePath))
      .sort((left, right) => right.length - left.length)[0];
    if (directory === undefined) continue;
    const maps = result.get(pathKey(directory));
    if (maps === undefined) continue;
    const relative = portablePath(path.relative(directory, imagePath));
    const segments = relative.toLowerCase().split("/");
    const fileName = path.basename(imagePath);
    const reference = `file:${portablePath(imagePath)}`;
    if (segments.includes("on_error") && fileName.toLowerCase().endsWith(".png")) {
      const key = imageKey(fileName, /^(\d{4}\.\d{2}\.\d{2}-\d{2}\.\d{2}\.\d{2})\.(\d{1,3})_(.+)\.png$/u);
      if (key !== null) maps.errorImages.set(key, reference);
    }
    if (segments.includes("vision") && fileName.toLowerCase().endsWith(".jpg")) {
      const visionKey = imageKey(fileName, /^(\d{4}\.\d{2}\.\d{2}-\d{2}\.\d{2}\.\d{2})\.(\d{1,3})_(.+_\d{9,})\.jpg$/iu);
      if (visionKey !== null) maps.visionImages.set(visionKey, reference);
      const waitKey = imageKey(fileName, /^(\d{4}\.\d{2}\.\d{2}-\d{2}\.\d{2}\.\d{2})\.(\d{1,3})_(.+_wait_freezes)\.jpg$/iu);
      if (waitKey !== null) maps.waitFreezesImages.set(waitKey, reference);
    }
  }
  return result;
}

async function selectMlaTargets(
  resolvedPath: string,
  inputIsDirectory: boolean,
  artifacts: readonly Artifact[],
  avoidRecursiveDirectoryTargets: boolean,
): Promise<MlaTarget[]> {
  if (!inputIsDirectory) {
    const label = targetLabel(resolvedPath, resolvedPath, false);
    return [{ path: resolvedPath, kind: "file", label, namespace: artifactId(`mla-target:${label}`) }];
  }

  const logs = artifacts.filter((artifact) => artifact.kind === "maa_log");
  const byDirectory = new Map<string, Artifact[]>();
  for (const artifact of logs) {
    const directory = path.dirname(artifact.path);
    const group = byDirectory.get(directory) ?? [];
    group.push(artifact);
    byDirectory.set(directory, group);
  }
  const projectRoot = await looksLikeProjectRoot(resolvedPath);
  const logDirectories = [...byDirectory.keys()];
  const targets: MlaTarget[] = [];
  for (const [directory, group] of [...byDirectory.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    const containsNestedLogDirectory = logDirectories.some((candidate) =>
      candidate !== directory && isPathInside(directory, candidate)
    );
    const useDirectory = group.some((artifact) => isMainLog(artifact.path))
      && (directory !== resolvedPath || !projectRoot)
      && !(avoidRecursiveDirectoryTargets && containsNestedLogDirectory);
    const files = group
      .sort((left, right) => left.path.localeCompare(right.path))
      .map((artifact) => ({ path: artifact.path, kind: "file" as const }));
    const candidates = useDirectory
      ? [{ path: directory, kind: "directory" as const }, ...files]
      : files;
    for (const candidate of candidates) {
      const label = targetLabel(resolvedPath, candidate.path, true);
      targets.push({
        ...candidate,
        label,
        namespace: artifactId(`mla-target:${label}`),
      });
    }
  }
  return targets;
}

export function namespaceRuntime(
  runtime: MlaRuntimeInspectionResult,
  namespace: string,
): MlaRuntimeInspectionResult {
  const scoped = (identifier: string): string => `${namespace}:${identifier}`;
  const task = (item: RuntimeTask): RuntimeTask => ({
    ...item,
    execution_id: scoped(item.execution_id),
    direct_failure_ids: item.direct_failure_ids.map(scoped),
    outcome_ids: item.outcome_ids.map(scoped),
    signal_ids: item.signal_ids.map(scoped),
    signal_highlights: {
      recognition_activity: item.signal_highlights.recognition_activity.map(scoped),
      repetitions: item.signal_highlights.repetitions.map(scoped),
    },
  });
  return {
    ...runtime,
    sessions: runtime.sessions.map((session) => ({
      ...session,
      session_id: scoped(session.session_id),
      tasks: session.tasks.map(task),
    })),
    unscoped_tasks: runtime.unscoped_tasks.map(task),
    failures: runtime.failures.map((failure) => ({
      ...failure,
      session_id: failure.session_id === null ? null : scoped(failure.session_id),
      execution_id: scoped(failure.execution_id),
      failure_id: scoped(failure.failure_id),
    })),
    outcomes: runtime.outcomes.map((outcome) => ({
      ...outcome,
      session_id: outcome.session_id === null ? null : scoped(outcome.session_id),
      execution_id: scoped(outcome.execution_id),
      outcome_id: scoped(outcome.outcome_id),
      direct_failure_ids: outcome.direct_failure_ids.map(scoped),
    })),
    signals: runtime.signals.map((signal) => ({
      ...signal,
      session_id: signal.session_id === null ? null : scoped(signal.session_id),
      execution_id: scoped(signal.execution_id),
      signal_id: scoped(signal.signal_id),
    })),
  };
}

function projectRuntimeSignals(
  runtime: MlaRuntimeInspectionResult,
  selectedIds: ReadonlySet<string>,
): MlaRuntimeInspectionResult {
  const task = (item: RuntimeTask): RuntimeTask => ({
    ...item,
    signal_ids: item.signal_ids.filter((identifier) => selectedIds.has(identifier)),
    signal_highlights: {
      recognition_activity: item.signal_highlights.recognition_activity.filter((identifier) =>
        selectedIds.has(identifier)
      ),
      repetitions: item.signal_highlights.repetitions.filter((identifier) =>
        selectedIds.has(identifier)
      ),
    },
  });
  const sessions = runtime.sessions.map((session) => {
    const tasks = session.tasks.map(task);
    return {
      ...session,
      tasks,
      summary: {
        ...session.summary,
        signals: tasks.reduce((total, item) => total + item.signal_ids.length, 0),
      },
    };
  });
  return {
    ...runtime,
    sessions,
    unscoped_tasks: runtime.unscoped_tasks.map(task),
    signals: runtime.signals.filter((signal) => selectedIds.has(signal.signal_id)),
  };
}

export function focusRuntimeSignals(
  runtime: MlaRuntimeInspectionResult,
  includeAllSignals: boolean,
): {
  runtime: MlaRuntimeInspectionResult;
  selection: MlaInspectionDetails["selection"]["signals"];
} {
  const allSignalIds = new Set(runtime.signals.map((signal) => signal.signal_id));
  const selectedIds = new Set<string>();
  if (includeAllSignals) {
    for (const identifier of allSignalIds) selectedIds.add(identifier);
  } else {
    const tasks = [...runtime.sessions.flatMap((session) => session.tasks), ...runtime.unscoped_tasks];
    for (const task of tasks) {
      for (const identifier of [
        ...task.signal_highlights.recognition_activity,
        ...task.signal_highlights.repetitions,
      ]) {
        if (allSignalIds.has(identifier)) selectedIds.add(identifier);
      }
    }
    for (const signal of runtime.signals) {
      if (signal.priority === "high") selectedIds.add(signal.signal_id);
    }
  }
  return {
    runtime: projectRuntimeSignals(runtime, selectedIds),
    selection: {
      mode: includeAllSignals ? "all" : "focused",
      total: runtime.signals.length,
      selected: selectedIds.size,
    },
  };
}

export type MlaSignalCounts = {
  total: number;
  recognitionOccurrences: number;
  repeatedNodeSegments: number;
  repeatedNodeTotalRepeatCount: number;
};

export type MlaPossibleMirroredTaskMember = {
  executionId: string;
  namespace: string;
  taskId: number;
  name: string;
  hash: string;
  uuid: string;
  status: RuntimeTask["status"];
  startedAt: string;
  endedAt: string | null;
  source: {
    start: {
      path: string | null;
      line: number | null;
      timestamp: string | null;
    };
    end: {
      path: string | null;
      line: number | null;
      timestamp: string | null;
    };
  };
};

export type MlaPossibleMirroredTaskGroup = {
  fingerprint: {
    taskId: number;
    name: string;
    hash: string;
    uuid: string;
    status: RuntimeTask["status"];
    startedAt: string;
    endedAt: string | null;
  };
  namespaces: string[];
  memberCount: number;
  members: MlaPossibleMirroredTaskMember[];
};

export function countRuntimeSignals(runtime: MlaRuntimeInspectionResult): MlaSignalCounts {
  let recognitionOccurrences = 0;
  let repeatedNodeSegments = 0;
  let repeatedNodeTotalRepeatCount = 0;
  for (const signal of runtime.signals) {
    if (signal.kind === "recognition_activity") {
      recognitionOccurrences += signal.occurrence_count;
    } else {
      repeatedNodeSegments += 1;
      repeatedNodeTotalRepeatCount += signal.total_repeat_count;
    }
  }
  return {
    total: runtime.signals.length,
    recognitionOccurrences,
    repeatedNodeSegments,
    repeatedNodeTotalRepeatCount,
  };
}

function taskNamespace(executionId: string): string {
  const separator = executionId.indexOf(":");
  return separator === -1 ? executionId : executionId.slice(0, separator);
}

function possibleMirroredTaskFingerprint(task: RuntimeTask): string {
  return JSON.stringify([
    task.task_id,
    task.name,
    task.hash,
    task.uuid,
    task.status,
    task.started_at,
    task.ended_at,
  ]);
}

export function findPossibleMirroredTaskGroups(
  runtime: MlaRuntimeInspectionResult,
): MlaPossibleMirroredTaskGroup[] {
  const groups = new Map<string, RuntimeTask[]>();
  const tasks = [...runtime.sessions.flatMap((session) => session.tasks), ...runtime.unscoped_tasks];
  for (const task of tasks) {
    const fingerprint = possibleMirroredTaskFingerprint(task);
    const members = groups.get(fingerprint) ?? [];
    members.push(task);
    groups.set(fingerprint, members);
  }
  return [...groups.values()]
    .map((members) => {
      const first = members[0];
      if (first === undefined) return null;
      const namespaces = [...new Set(members.map((task) => taskNamespace(task.execution_id)))].sort((left, right) =>
        left.localeCompare(right),
      );
      if (namespaces.length <= 1) return null;
      return {
        fingerprint: {
          taskId: first.task_id,
          name: first.name,
          hash: first.hash,
          uuid: first.uuid,
          status: first.status,
          startedAt: first.started_at,
          endedAt: first.ended_at,
        },
        namespaces,
        memberCount: members.length,
        members: members.map((task) => ({
          executionId: task.execution_id,
          namespace: taskNamespace(task.execution_id),
          taskId: task.task_id,
          name: task.name,
          hash: task.hash,
          uuid: task.uuid,
          status: task.status,
          startedAt: task.started_at,
          endedAt: task.ended_at,
          source: {
            start: {
              path: task.evidence.start.path,
              line: task.evidence.start.local_line,
              timestamp: task.evidence.start.timestamp,
            },
            end: {
              path: task.evidence.end.path,
              line: task.evidence.end.local_line,
              timestamp: task.evidence.end.timestamp,
            },
          },
        })),
      } satisfies MlaPossibleMirroredTaskGroup;
    })
    .filter((group): group is MlaPossibleMirroredTaskGroup => group !== null)
    .sort((left, right) => JSON.stringify(left.fingerprint).localeCompare(JSON.stringify(right.fingerprint)));
}

export function countPossibleMirroredTaskGroups(runtime: MlaRuntimeInspectionResult): number {
  return findPossibleMirroredTaskGroups(runtime).length;
}

function mergeRuntimes(items: readonly LoadedMlaTarget[]): MlaRuntimeInspectionResult {
  return {
    schema_version: "mla-runtime-inspection/v1",
    sessions: items.flatMap((item) => item.runtime.sessions),
    unscoped_tasks: items.flatMap((item) => item.runtime.unscoped_tasks),
    failures: items.flatMap((item) => item.runtime.failures),
    outcomes: items.flatMap((item) => item.runtime.outcomes),
    signals: items.flatMap((item) => item.runtime.signals),
    warnings: items.flatMap((item) =>
      item.runtime.warnings.map((warning) => `[${item.target.label}] ${warning}`),
    ),
  };
}

function targetArtifacts(target: MlaTarget, artifacts: readonly Artifact[]): Artifact[] {
  if (target.kind === "file") {
    return artifacts.filter((artifact) => path.resolve(artifact.path) === target.path);
  }
  return artifacts.filter((artifact) => path.dirname(path.resolve(artifact.path)) === target.path);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function candidateBox(value: unknown): [number, number, number, number] | null {
  if (!Array.isArray(value) || value.length !== 4 || !value.every((item) => typeof item === "number")) {
    return null;
  }
  return value as [number, number, number, number];
}

function extractActionDetails(
  analyzed: Awaited<ReturnType<typeof analyzeLogContent>>,
  timeRange: TimeRange | undefined,
): MlaActionDetail[] {
  const groups = new Map<string, {
    action: string;
    node: string;
    status: "succeeded" | "failed";
    taskId: number | null;
    samples: MlaActionDetailSample[];
  }>();
  for (const event of analyzed.events) {
    if (event.message !== "Node.Action.Succeeded" && event.message !== "Node.Action.Failed") continue;
    if (!timestampWithin(event.timestamp, timeRange)) continue;
    if (!isRecord(event.details)) continue;
    const actionDetails = event.details["action_details"];
    if (!isRecord(actionDetails)) continue;
    const action = actionDetails["action"];
    if (typeof action !== "string" || action.length === 0) continue;
    const detailName = actionDetails["name"];
    const payloadName = event.details["name"];
    const node = typeof detailName === "string" && detailName.length > 0
      ? detailName
      : typeof payloadName === "string" && payloadName.length > 0 ? payloadName : null;
    if (node === null) continue;
    const status = event.message === "Node.Action.Succeeded" ? "succeeded" : "failed";
    const taskId = typeof event.details["task_id"] === "number" ? event.details["task_id"] : null;
    const key = JSON.stringify([node, action, status, taskId]);
    const group = groups.get(key) ?? {
      action,
      node,
      status,
      taskId,
      samples: [],
    };
    group.samples.push({
      box: candidateBox(actionDetails["box"]),
      detail: actionDetails["detail"] ?? null,
      taskId,
      timestamp: event.timestamp,
      mergedLine: event._lineNumber ?? null,
    });
    groups.set(key, group);
  }
  return [...groups.values()].sort((left, right) =>
    (left.samples[0]?.timestamp ?? "").localeCompare(right.samples[0]?.timestamp ?? "")
    || (left.samples[0]?.mergedLine ?? 0) - (right.samples[0]?.mergedLine ?? 0)
    || [left.node, left.action, left.status, left.taskId ?? ""].join("|").localeCompare(
      [right.node, right.action, right.status, right.taskId ?? ""].join("|"),
    )
  ).map((group) => ({
    action: group.action,
    node: group.node,
    status: group.status,
    occurrenceCount: group.samples.length,
    taskId: group.taskId,
    representatives: {
      first: group.samples[0] as MlaActionDetailSample,
      last: group.samples[group.samples.length - 1] as MlaActionDetailSample,
    },
  }));
}

function boundedActionDetails(details: readonly MlaActionDetail[]): MlaActionDetail[] {
  if (details.length <= MAX_ACTION_DETAILS) return [...details];
  return Array.from({ length: MAX_ACTION_DETAILS }, (_, index) => {
    const sourceIndex = Math.floor(index * (details.length - 1) / (MAX_ACTION_DETAILS - 1));
    return details[sourceIndex] as MlaActionDetail;
  });
}

function boundedPipelineOverrides(
  observations: readonly MlaPipelineOverrideObservation[],
): MlaPipelineOverrideObservation[] {
  if (observations.length <= MAX_PIPELINE_OVERRIDES) return [...observations];
  const taskAssociated = observations.filter((item) => item.taskAssociation === "task_id");
  const unscoped = observations.filter((item) => item.taskAssociation !== "task_id");
  const selected = taskAssociated.length >= MAX_PIPELINE_OVERRIDES
    ? Array.from({ length: MAX_PIPELINE_OVERRIDES }, (_, index) => {
      const sourceIndex = Math.floor(index * (taskAssociated.length - 1) / (MAX_PIPELINE_OVERRIDES - 1));
      return taskAssociated[sourceIndex] as MlaPipelineOverrideObservation;
    })
    : [
      ...taskAssociated,
      ...Array.from({ length: MAX_PIPELINE_OVERRIDES - taskAssociated.length }, (_, index) => {
        const sourceIndex = Math.floor(
          index * (unscoped.length - 1) / (MAX_PIPELINE_OVERRIDES - taskAssociated.length - 1 || 1),
        );
        return unscoped[sourceIndex] as MlaPipelineOverrideObservation;
      }),
    ];
  return [...new Map(selected.map((item) => [item.mergedLine, item])).values()]
    .sort((left, right) => left.mergedLine - right.mergedLine);
}

function candidateFromUnknown(value: unknown): RecognitionDetailCandidate | null {
  if (!isRecord(value)) return null;
  const candidate: RecognitionDetailCandidate = {};
  const box = candidateBox(value["box"]);
  if (box !== null) candidate.box = box;
  if (typeof value["score"] === "number") candidate.score = value["score"];
  if (typeof value["text"] === "string") candidate.text = value["text"];
  if (typeof value["count"] === "number") candidate.count = value["count"];
  if (typeof value["label"] === "string") candidate.label = value["label"];
  if (typeof value["cls_index"] === "number") candidate.clsIndex = value["cls_index"];
  return Object.keys(candidate).length === 0 ? null : candidate;
}

function candidatesFromUnknown(value: unknown): RecognitionDetailCandidate[] {
  if (!Array.isArray(value)) return [];
  return value.map(candidateFromUnknown).filter((item): item is RecognitionDetailCandidate => item !== null);
}

function bestFromUnknown(value: unknown): RecognitionDetailCandidate | null {
  return candidateFromUnknown(value);
}

function parseRecognitionDetail(detail: unknown): RecognitionDetailShape {
  if (detail === null || detail === undefined) return { kind: "none" };
  if (Array.isArray(detail)) {
    return {
      kind: "child_array",
      children: detail.filter(isRecord).map((child) => {
        const childShape = parseRecognitionDetail(child["detail"]);
        return {
          name: typeof child["name"] === "string" ? child["name"] : null,
          algorithm: typeof child["algorithm"] === "string" ? child["algorithm"] : null,
          box: candidateBox(child["box"]),
          allCount: childShape.kind === "candidate_list" ? childShape.all.length : null,
          filteredCount: childShape.kind === "candidate_list" ? childShape.filtered.length : null,
          best: childShape.kind === "candidate_list" ? childShape.best : null,
        };
      }),
    };
  }
  if (!isRecord(detail)) return { kind: "unknown" };
  const all = candidatesFromUnknown(detail["all"]);
  const filtered = candidatesFromUnknown(detail["filtered"]);
  const best = bestFromUnknown(detail["best"]);
  if (
    all.length > 0
    || filtered.length > 0
    || best !== null
    || Array.isArray(detail["all"])
    || Array.isArray(detail["filtered"])
  ) {
    return { kind: "candidate_list", all, filtered, best };
  }
  return { kind: "unknown" };
}

const MAX_DESCENDANT_RECOGNITIONS = 16;
const MAX_DESCENDANT_RECOGNITION_DEPTH = 6;
const MAX_DESCENDANT_BEST_SAMPLES = 3;
const MAX_CHILD_RECOGNITIONS = 8;
const MAX_RECOGNITION_STAGE_SAMPLES = 3;
const MAX_RECOGNITION_TEXT_COUNTS = 64;

function collectDescendantRecognitions(detail: unknown): {
  items: RecognitionDescendantSummary[];
  truncated: boolean;
} {
  const items: RecognitionDescendantSummary[] = [];
  let truncated = false;
  const visit = (value: unknown, parentPath: readonly string[], depth: number): void => {
    if (!Array.isArray(value)) return;
    if (depth >= MAX_DESCENDANT_RECOGNITION_DEPTH) {
      if (value.some(isRecord)) truncated = true;
      return;
    }
    for (const [index, child] of value.entries()) {
      if (!isRecord(child)) continue;
      const name = typeof child["name"] === "string" ? child["name"] : null;
      const algorithm = typeof child["algorithm"] === "string" ? child["algorithm"] : null;
      const segment = name ?? algorithm ?? `child-${index + 1}`;
      const currentPath = [...parentPath, segment];
      const childShape = parseRecognitionDetail(child["detail"]);
      if (childShape.kind === "candidate_list") {
        if (items.length >= MAX_DESCENDANT_RECOGNITIONS) {
          truncated = true;
          continue;
        }
        items.push({
          path: currentPath,
          name,
          algorithm,
          allCount: childShape.all.length,
          filteredCount: childShape.filtered.length,
          best: childShape.best,
        });
      } else if (childShape.kind === "child_array") {
        visit(child["detail"], currentPath, depth + 1);
      }
    }
  };
  visit(detail, [], 0);
  return { items, truncated };
}

function uniqueCandidates<T extends object>(candidates: readonly T[]): T[] {
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    const key = JSON.stringify(candidate);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function lengthStats(values: number[]): { count: number; minimum: number; maximum: number; average: number } {
  return {
    count: values.length,
    minimum: values.length === 0 ? 0 : Math.min(...values),
    maximum: values.length === 0 ? 0 : Math.max(...values),
    average: values.length === 0 ? 0 : values.reduce((total, item) => total + item, 0) / values.length,
  };
}

function percentile(sorted: number[], ratio: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1));
  return sorted[index] ?? 0;
}

function scoreDistribution(scores: readonly number[]): RecognitionScoreDistribution | null {
  if (scores.length === 0) return null;
  const sorted = [...scores].sort((left, right) => left - right);
  return {
    count: sorted.length,
    minimum: sorted[0] ?? 0,
    p50: percentile(sorted, 0.5),
    p95: percentile(sorted, 0.95),
    maximum: sorted[sorted.length - 1] ?? 0,
    average: sorted.reduce((total, item) => total + item, 0) / sorted.length,
  };
}

type RecognitionCandidateStageAccumulator = {
  candidateCount: number;
  texts: Map<string, number>;
  scores: number[];
  samples: RecognitionDetailSample[];
};

function emptyCandidateStage(): RecognitionCandidateStageAccumulator {
  return { candidateCount: 0, texts: new Map<string, number>(), scores: [], samples: [] };
}

function addCandidateStageSamples(
  stage: RecognitionCandidateStageAccumulator,
  candidates: readonly RecognitionDetailCandidate[],
  timestamp: string,
  mergedLine: number | null,
): void {
  stage.candidateCount += candidates.length;
  for (const candidate of candidates) {
    if (candidate.text !== undefined) {
      stage.texts.set(candidate.text, (stage.texts.get(candidate.text) ?? 0) + 1);
    }
    if (candidate.score !== undefined) stage.scores.push(candidate.score);
    if (stage.samples.length < MAX_RECOGNITION_STAGE_SAMPLES + 1) {
      stage.samples.push({ ...candidate, timestamp, mergedLine });
    }
  }
}

function summarizeTextCounts(texts: ReadonlyMap<string, number>): {
  textCounts: Array<{ text: string; count: number }>;
  textCountSummary: MlaRecognitionTextCountSummary;
} {
  const entries = [...texts.entries()].sort(
    ([leftText, leftCount], [rightText, rightCount]) => rightCount - leftCount || leftText.localeCompare(rightText),
  );
  const selected = entries.slice(0, MAX_RECOGNITION_TEXT_COUNTS);
  return {
    textCounts: selected.map(([text, count]) => ({ text, count })),
    textCountSummary: {
      observations: entries.reduce((total, [, count]) => total + count, 0),
      unique: entries.length,
      returned: selected.length,
      truncated: entries.length > selected.length,
    },
  };
}

function candidateStageSummary(stage: RecognitionCandidateStageAccumulator): MlaRecognitionCandidateStage {
  const texts = summarizeTextCounts(stage.texts);
  return {
    candidateCount: stage.candidateCount,
    ...texts,
    score: scoreDistribution(stage.scores),
    samples: stage.samples.slice(0, MAX_RECOGNITION_STAGE_SAMPLES),
    samplesTruncated: stage.candidateCount > MAX_RECOGNITION_STAGE_SAMPLES,
  };
}

function extractRecognitionDetails(
  analyzed: Awaited<ReturnType<typeof analyzeLogContent>>,
  timeRange: TimeRange | undefined,
): MlaRecognitionDetail[] {
  const groups = new Map<string, {
    algorithm: string;
    node: string;
    status: "succeeded" | "failed";
    count: number;
    detailShapes: Set<string>;
    texts: Map<string, number>;
    scores: number[];
    allLengths: number[];
    filteredLengths: number[];
    bestPresentCount: number;
    bestSamples: RecognitionDetailSample[];
    samples: RecognitionDetailSample[];
    candidateStages: {
      all: RecognitionCandidateStageAccumulator;
      filtered: RecognitionCandidateStageAccumulator;
      best: RecognitionCandidateStageAccumulator;
    };
    childRecognition: Map<string, {
      name: string | null;
      algorithm: string | null;
      count: number;
      allLengths: number[];
      filteredLengths: number[];
    }>;
    descendantRecognition: Map<string, {
      path: string[];
      name: string | null;
      algorithm: string | null;
      count: number;
      allLengths: number[];
      filteredLengths: number[];
       bestSamples: MlaRecognitionDetailSample[];
    }>;
    descendantRecognitionTruncated: boolean;
  }>();
  for (const event of analyzed.events) {
    if (event.message !== "Node.Recognition.Succeeded" && event.message !== "Node.Recognition.Failed") continue;
    if (!timestampWithin(event.timestamp, timeRange)) continue;
    const payload = event.details;
    if (!isRecord(payload)) continue;
    const recoDetails = payload["reco_details"];
    if (!isRecord(recoDetails)) continue;
    const algorithm = recoDetails["algorithm"];
    if (typeof algorithm !== "string") continue;
    const node = recoDetails["name"];
    if (typeof node !== "string") continue;
    const shape = parseRecognitionDetail(recoDetails["detail"]);
    if (shape.kind === "none" || shape.kind === "unknown") continue;
    if (shape.kind === "child_array" && shape.children.length === 0) continue;
    const status = event.message === "Node.Recognition.Succeeded" ? "succeeded" : "failed";
    const key = `${node}|${algorithm}|${status}`;
    const group = groups.get(key) ?? {
      algorithm,
      node,
      status,
      count: 0,
      detailShapes: new Set<string>(),
      texts: new Map<string, number>(),
      scores: [],
      allLengths: [],
      filteredLengths: [],
      bestPresentCount: 0,
      bestSamples: [],
      samples: [],
      candidateStages: {
        all: emptyCandidateStage(),
        filtered: emptyCandidateStage(),
        best: emptyCandidateStage(),
      },
      childRecognition: new Map<string, {
        name: string | null;
        algorithm: string | null;
        count: number;
        allLengths: number[];
        filteredLengths: number[];
      }>(),
      descendantRecognition: new Map<string, {
        path: string[];
        name: string | null;
        algorithm: string | null;
        count: number;
        allLengths: number[];
        filteredLengths: number[];
         bestSamples: MlaRecognitionDetailSample[];
      }>(),
      descendantRecognitionTruncated: false,
    };
    group.count += 1;
    group.detailShapes.add(shape.kind);
    if (shape.kind === "candidate_list") {
      group.allLengths.push(shape.all.length);
      group.filteredLengths.push(shape.filtered.length);
      if (shape.best !== null) group.bestPresentCount += 1;
      const mergedLine = event._lineNumber ?? null;
      addCandidateStageSamples(group.candidateStages.all, shape.all, event.timestamp, mergedLine);
      addCandidateStageSamples(group.candidateStages.filtered, shape.filtered, event.timestamp, mergedLine);
      addCandidateStageSamples(
        group.candidateStages.best,
        shape.best === null ? [] : [shape.best],
        event.timestamp,
        mergedLine,
      );
      const selected = shape.best ?? shape.filtered[0] ?? shape.all[0] ?? null;
      if (selected?.text !== undefined) {
        group.texts.set(selected.text, (group.texts.get(selected.text) ?? 0) + 1);
      }
      if (selected?.score !== undefined) group.scores.push(selected.score);
      group.samples.push({
        ...selected,
        timestamp: event.timestamp,
        mergedLine,
      });
      if (shape.best !== null) {
        group.bestSamples.push({
          ...shape.best,
          timestamp: event.timestamp,
          mergedLine,
        });
      }
    } else {
      for (const child of shape.children) {
        const childKey = `${child.algorithm ?? ""}|${child.name ?? ""}`;
        const entry = group.childRecognition.get(childKey) ?? {
          name: child.name,
          algorithm: child.algorithm,
          count: 0,
          allLengths: [],
          filteredLengths: [],
        };
        entry.count += 1;
        if (child.allCount !== null) entry.allLengths.push(child.allCount);
        if (child.filteredCount !== null) entry.filteredLengths.push(child.filteredCount);
        group.childRecognition.set(childKey, entry);
      }
      const descendants = collectDescendantRecognitions(recoDetails["detail"]);
      if (descendants.truncated) group.descendantRecognitionTruncated = true;
      for (const descendant of descendants.items) {
        const descendantKey = JSON.stringify([descendant.path, descendant.algorithm]);
        const entry = group.descendantRecognition.get(descendantKey) ?? {
          path: descendant.path,
          name: descendant.name,
          algorithm: descendant.algorithm,
          count: 0,
          allLengths: [],
          filteredLengths: [],
          bestSamples: [],
        };
        entry.count += 1;
        entry.allLengths.push(descendant.allCount);
        entry.filteredLengths.push(descendant.filteredCount);
        if (descendant.best !== null) {
          entry.bestSamples.push({
            ...descendant.best,
            timestamp: event.timestamp,
            mergedLine: event._lineNumber ?? null,
          });
        }
        group.descendantRecognition.set(descendantKey, entry);
      }
      group.samples.push({ timestamp: event.timestamp, mergedLine: event._lineNumber ?? null });
    }
    groups.set(key, group);
  }
  return [...groups.values()].sort((left, right) =>
    [left.node, left.algorithm, left.status].join("|").localeCompare(
      [right.node, right.algorithm, right.status].join("|"),
    ),
  ).map((group) => {
    const score = scoreDistribution(group.scores);
    const samples = group.samples;
    const first = samples[0] as RecognitionDetailSample;
    const worst = score === null
      ? null
      : [...samples].sort((left, right) =>
        (left.score ?? Infinity) - (right.score ?? Infinity)
      )[0] ?? null;
    const detailShape = group.detailShapes.size === 1
      ? [...group.detailShapes][0] as MlaRecognitionDetail["detailShape"]
      : "mixed" as const;
    const descendantEntries = [...group.descendantRecognition.values()]
      .sort((left, right) => JSON.stringify(left.path).localeCompare(JSON.stringify(right.path)));
    const descendantRecognition = descendantEntries.slice(0, MAX_DESCENDANT_RECOGNITIONS).map((entry) => {
      const uniqueBest = uniqueCandidates(entry.bestSamples);
      return {
        path: entry.path,
        name: entry.name,
        algorithm: entry.algorithm,
        occurrenceCount: entry.count,
        allCount: lengthStats(entry.allLengths).average,
        filteredCount: lengthStats(entry.filteredLengths).average,
        best: uniqueBest.slice(0, MAX_DESCENDANT_BEST_SAMPLES),
        bestTruncated: uniqueBest.length > MAX_DESCENDANT_BEST_SAMPLES,
      };
    });
    const texts = summarizeTextCounts(group.texts);
    return {
      algorithm: group.algorithm,
      node: group.node,
      status: group.status,
      occurrenceCount: group.count,
      ...texts,
      score,
      representatives: { first, worst },
      detailShape,
      candidateCounts: group.allLengths.length === 0 && group.filteredLengths.length === 0
        ? null
        : {
          all: group.allLengths.length === 0 ? null : lengthStats(group.allLengths),
          filtered: group.filteredLengths.length === 0 ? null : lengthStats(group.filteredLengths),
          bestPresent: group.bestPresentCount,
        },
      candidateStages: group.allLengths.length === 0 && group.filteredLengths.length === 0
        ? null
        : {
          all: candidateStageSummary(group.candidateStages.all),
          filtered: candidateStageSummary(group.candidateStages.filtered),
          best: candidateStageSummary(group.candidateStages.best),
        },
      best: group.bestSamples.slice(0, 3),
      bestTruncated: group.bestSamples.length > 3,
      childRecognition: [...group.childRecognition.values()].slice(0, MAX_CHILD_RECOGNITIONS).map((entry) => ({
        name: entry.name,
        algorithm: entry.algorithm,
        occurrenceCount: entry.count,
        allCount: entry.allLengths.length === 0 ? null : lengthStats(entry.allLengths).average,
        filteredCount: entry.filteredLengths.length === 0 ? null : lengthStats(entry.filteredLengths).average,
      })),
      childRecognitionTotal: group.childRecognition.size,
      childRecognitionTruncated: group.childRecognition.size > MAX_CHILD_RECOGNITIONS,
      ...(descendantRecognition.length === 0 && !group.descendantRecognitionTruncated
        ? {}
        : {
          descendantRecognition,
          descendantRecognitionTruncated:
            group.descendantRecognitionTruncated || descendantEntries.length > MAX_DESCENDANT_RECOGNITIONS,
        }),
    };
  });
}

async function loadMlaTarget(
  target: MlaTarget,
  artifacts: readonly Artifact[],
  focus: LogBundleFocus | undefined,
  timeRange: TimeRange | undefined,
  imageMaps: MlaImageMaps | undefined,
): Promise<LoadedMlaTarget | null> {
  const framework = extractFrameworkSessions(await loadFrameworkLogSources(target.path));
  let sourceSegments: SourceSegment[];
  let content: string;
  let analyzed;
  if (target.kind === "directory") {
    const extracted = await loadNodeLogDirectory(target.path, focus === undefined ? {} : { focus });
    if (extracted === null) return null;
    content = extracted.content;
    sourceSegments = [...extracted.sourceSegments];
    analyzed = await analyzeLogContent({
      content,
      errorImages: extracted.errorImages,
      visionImages: extracted.visionImages,
      waitFreezesImages: extracted.waitFreezesImages,
    });
  } else {
    content = await readNodeTextFileContent(target.path);
    if (
      focus?.keywords !== undefined
      && focus.keywords.length > 0
      && !focus.keywords.some((keyword) => content.includes(keyword))
    ) {
      return null;
    }
    sourceSegments = [{
      source: `file:${portablePath(target.path)}`,
      path: path.basename(target.path),
      startLine: 1,
      lineCount: (content.match(/\n/g) ?? []).length + 1,
    }];
    analyzed = await analyzeLogContent({ content, ...imageMaps });
  }
  const runtime = filterRuntime(
    translateRuntimeInspection(buildRuntimeInspection(analyzed, framework, sourceSegments)),
    timeRange,
  );
  if (
    timeRange !== undefined
    && runtime.sessions.length === 0
    && runtime.unscoped_tasks.length === 0
    && runtime.failures.length === 0
    && runtime.outcomes.length === 0
    && runtime.signals.length === 0
  ) {
    return null;
  }
  const allActionDetails = extractActionDetails(analyzed, timeRange);
  const pipelineOverrideExtraction = extractPipelineOverrides(content, timeRange);
  const pipelineOverrides = boundedPipelineOverrides(pipelineOverrideExtraction.observations);
  return {
    target,
    runtime: namespaceRuntime(runtime, target.namespace),
    recognitionDetails: extractRecognitionDetails(analyzed, timeRange),
    actionDetails: boundedActionDetails(allActionDetails),
    actionDetailsTotal: allActionDetails.length,
    actionOccurrences: allActionDetails.reduce((total, detail) => total + detail.occurrenceCount, 0),
    pipelineOverrides,
    pipelineOverridesTotal: pipelineOverrideExtraction.observations.length,
    pipelineOverrideMalformedLines: pipelineOverrideExtraction.malformedLines,
    sourceSegments,
    artifacts: targetArtifacts(target, artifacts),
  };
}

export async function inspectMla(
  inputPath: string,
  options: MlaInspectOptions = {},
): Promise<MlaInspectionResult> {
  validateTimeRange(options.timeRange);
  const resolvedPath = path.resolve(inputPath);
  const metadata = await stat(resolvedPath);
  if (!metadata.isDirectory() && resolvedPath.toLowerCase().endsWith(".zip")) {
    throw new Error("Archive extraction belongs to the calling harness; pass the extracted directory.");
  }
  const discovery = await profileStage("mla.discovery", () => discoverArtifacts(resolvedPath));
  const focus = focusFromOptions(options);
  const targets = await profileStage("mla.target_selection", () => selectMlaTargets(
    resolvedPath,
    metadata.isDirectory(),
    discovery.artifacts,
    focus !== undefined,
  ));
  const loadedTargets: LoadedMlaTarget[] = [];
  const targetMissingEvidence: MlaInspectionResult["missingEvidence"] = [];
  const coveredFiles = new Set<string>();
  const imageMapsByDirectory = buildImageMapsByLogDirectory(targets, discovery.artifacts);
  for (const target of targets) {
    if (target.kind === "file" && coveredFiles.has(pathKey(target.path))) continue;
    try {
      const imageDirectory = target.kind === "directory" ? target.path : path.dirname(target.path);
      const loaded = await profileStage("mla.load_parse", () => loadMlaTarget(
        target,
        discovery.artifacts,
        focus,
        options.timeRange,
        imageMapsByDirectory.get(pathKey(imageDirectory)),
      ));
      if (loaded === null) {
        if (focus === undefined) {
          targetMissingEvidence.push({
            code: "mla_target_empty",
            message: `MLA selected no analyzable content from ${target.label}.`,
            path: target.path,
          });
        }
      } else {
        loadedTargets.push(loaded);
        if (target.kind === "file") {
          coveredFiles.add(pathKey(target.path));
        } else {
          for (const segment of loaded.sourceSegments) {
            coveredFiles.add(pathKey(segmentPath(target, segment)));
          }
        }
      }
    } catch (error: unknown) {
      targetMissingEvidence.push({
        code: "mla_target_unreadable",
        message: `MLA could not inspect ${target.label}: ${error instanceof Error ? error.message : String(error)}`,
        path: target.path,
      });
    }
  }
  return profileStageSync("mla.evidence_materialization", () => {
  const completeRuntime = loadedTargets.length === 0
    ? emptyRuntime(["No analyzable MaaFramework log content was selected."])
    : mergeRuntimes(loadedTargets);
  const taskAnomalies = summarizeTaskAnomalies(completeRuntime);
  const tasksByExecution = new Map<string, RuntimeTask>();
  for (const task of [
    ...completeRuntime.sessions.flatMap((session) => session.tasks),
    ...completeRuntime.unscoped_tasks,
  ]) {
    tasksByExecution.set(task.execution_id, task);
  }
  const signalFocus = focusRuntimeSignals(completeRuntime, options.includeAllSignals === true);
  const runtime = signalFocus.runtime;
  const completeSignalCounts = countRuntimeSignals(completeRuntime);
  const focusedSignalCounts = countRuntimeSignals(runtime);
  const possibleMirroredTaskGroups = findPossibleMirroredTaskGroups(runtime);
  const selectedSignalIds = new Set(runtime.signals.map((signal) => signal.signal_id));
  const loadingGranularity = loadedTargets.length > 1
    ? "multiple_bundles" as const
    : loadedTargets[0]?.target.kind === "file"
      ? "single_file" as const
      : "matched_files" as const;
  const ledger = new EvidenceLedger();
  for (const loaded of loadedTargets) {
    addRuntimeEvidence(
      ledger,
      projectRuntimeSignals(loaded.runtime, selectedSignalIds),
      [...loaded.artifacts, ...discovery.artifacts],
      loaded.target.path,
    );
    for (const detail of loaded.recognitionDetails) {
      addRecognitionDetailEvidence(
        ledger,
        detail,
        loaded.artifacts,
        loaded.target.path,
        loaded.sourceSegments,
      );
    }
    for (const detail of loaded.actionDetails) {
      addActionDetailEvidence(
        ledger,
        detail,
        loaded.artifacts,
        loaded.target.path,
        loaded.sourceSegments,
      );
    }
    for (const observation of loaded.pipelineOverrides) {
      addPipelineOverrideEvidence(
        ledger,
        observation,
        loaded.artifacts,
        loaded.target.path,
        loaded.sourceSegments,
      );
    }
  }
  addPossibleMirroredTaskEvidence(
    ledger,
    possibleMirroredTaskGroups,
    loadedTargets,
    discovery.artifacts,
    resolvedPath,
  );
  for (const anomaly of taskAnomalies) {
    const task = tasksByExecution.get(anomaly.executionId);
    if (task === undefined) continue;
    addTaskAnomalyEvidence(ledger, anomaly, task, discovery.artifacts, resolvedPath);
  }
  const evidence = correlateCycleBlockers(ledger.values());
  const selectedArtifactIds = new Set(evidence.map((item) => item.source.artifactId));
  for (const loaded of loadedTargets) {
    for (const segment of loaded.sourceSegments) {
      selectedArtifactIds.add(
        artifactForPosition(loaded.artifacts, loaded.target.path, segment.path).id,
      );
    }
  }
  const referencedImagePaths = new Set(runtime.failures.flatMap((failure) => [
    ...failure.error_images,
    ...failure.vision_images,
  ]).flatMap((reference) => reference.startsWith("file:") ? [pathKey(reference.slice(5))] : []));
  for (const artifact of discovery.artifacts) {
    if (artifact.kind === "image" && referencedImagePaths.has(pathKey(artifact.path))) {
      selectedArtifactIds.add(artifact.id);
    }
  }
  const artifacts = discovery.artifacts.map((artifact) =>
    selectedArtifactIds.has(artifact.id)
      ? { ...artifact, status: "selected" as const, reason: undefined }
      : artifact,
  ).map(({ reason, ...artifact }) => reason === undefined ? artifact : { ...artifact, reason });
  const pipelineOverridesTotal = loadedTargets.reduce(
    (total, target) => total + target.pipelineOverridesTotal,
    0,
  );
  const pipelineOverridesSelected = loadedTargets.reduce(
    (total, target) => total + target.pipelineOverrides.length,
    0,
  );
  const pipelineOverrideMalformedLines = loadedTargets.reduce(
    (total, target) => total + target.pipelineOverrideMalformedLines,
    0,
  );
  const missingEvidence = [...discovery.missingEvidence, ...targetMissingEvidence];
  if (!discovery.artifacts.some((artifact) => artifact.kind === "maa_log")) {
    missingEvidence.push({
      code: "maa_framework_log_missing",
      message: "No MaaFramework log was detected in the supplied input.",
      path: resolvedPath,
    });
  }
  if (loadedTargets.length === 0 || evidence.length === 0) {
    missingEvidence.push({
      code: options.timeRange === undefined ? "mla_evidence_missing" : "mla_time_window_empty",
      message: options.timeRange === undefined
        ? "MLA did not produce runtime evidence from the supplied input."
        : "MLA did not produce runtime evidence within the requested time range.",
      path: resolvedPath,
    });
  }
  const warnings = [
    ...discovery.warnings,
    ...runtime.warnings.map((message) => ({ code: "mla_warning", message })),
    ...(options.timeRange === undefined
      ? []
      : [{
        code: "mla_time_window_file_granularity",
        message: "MLA narrows directory loading to matching files, then MEK filters facts to the requested time range; a matched file may still be read in full.",
      }]),
    ...(signalFocus.selection.selected === signalFocus.selection.total
      ? []
      : [{
        code: "mla_signals_focused",
        message: `Selected ${signalFocus.selection.selected} of ${signalFocus.selection.total} runtime signals using MLA priorities and per-task highlights; request all signals explicitly for exhaustive output. Complete totals are available in statistics: signalsTotal, recognitionOccurrences, repeatedNodeSegments, repeatedNodeTotalRepeatCount.`,
      }]),
    ...(possibleMirroredTaskGroups.length === 0
      ? []
      : [{
        code: "mla_possible_mirrored_tasks",
        message: `Observed ${possibleMirroredTaskGroups.length} groups of field-identical tasks across the selected logs; counts remain observations because separate instances cannot be safely deduplicated without correlation evidence.`,
      }]),
    ...loadedTargets.flatMap((target) =>
      target.actionDetails.length === target.actionDetailsTotal
        ? []
        : [{
          code: "mla_action_details_truncated",
          message: `Selected ${target.actionDetails.length} of ${target.actionDetailsTotal} action-detail groups from ${target.target.label} using evenly spaced chronological samples.`,
        }]
    ),
    ...loadedTargets.flatMap((target) =>
      target.pipelineOverrides.length === target.pipelineOverridesTotal
        ? []
        : [{
          code: "mla_pipeline_overrides_truncated",
          message: `Selected ${target.pipelineOverrides.length} of ${target.pipelineOverridesTotal} non-empty pipeline override observations from ${target.target.label}; task-associated observations were prioritized before chronological sampling.`,
        }]
    ),
    ...(pipelineOverrideMalformedLines === 0
      ? []
      : [{
        code: "mla_pipeline_override_parse_incomplete",
        message: `${pipelineOverrideMalformedLines} MaaFramework override log lines could not be parsed as complete JSON; runtime override evidence is incomplete.`,
      }]),
  ];
  return {
    schemaVersion: EVIDENCE_SCHEMA_VERSION,
    kind: "mla",
    generatedAt: new Date().toISOString(),
    input: {
      path: resolvedPath,
      ...(options.timeRange === undefined ? {} : { timeRange: options.timeRange }),
    },
    artifacts,
    evidence,
    missingEvidence,
    warnings,
    statistics: {
      scannedFiles: discovery.scannedFileCount,
      selectedArtifacts: artifacts.filter((artifact) => artifact.status === "selected").length,
      sessions: runtime.sessions.length,
      tasks: runtime.sessions.reduce((total, session) => total + session.tasks.length, 0)
        + runtime.unscoped_tasks.length,
      possibleMirroredTaskGroups: possibleMirroredTaskGroups.length,
      failures: runtime.failures.length,
      outcomes: runtime.outcomes.length,
      taskAnomalies: taskAnomalies.length,
      signals: focusedSignalCounts.total,
      signalsTotal: completeSignalCounts.total,
      recognitionOccurrences: completeSignalCounts.recognitionOccurrences,
      recognitionOccurrencesFocused: focusedSignalCounts.recognitionOccurrences,
      actionOccurrences: loadedTargets.reduce((total, target) => total + target.actionOccurrences, 0),
      actionDetails: loadedTargets.reduce((total, target) => total + target.actionDetails.length, 0),
      actionDetailsTotal: loadedTargets.reduce((total, target) => total + target.actionDetailsTotal, 0),
      pipelineOverrides: pipelineOverridesSelected,
      pipelineOverridesTotal,
      repeatedNodeSegments: completeSignalCounts.repeatedNodeSegments,
      repeatedNodeSegmentsFocused: focusedSignalCounts.repeatedNodeSegments,
      repeatedNodeTotalRepeatCount: completeSignalCounts.repeatedNodeTotalRepeatCount,
      repeatedNodeTotalRepeatCountFocused: focusedSignalCounts.repeatedNodeTotalRepeatCount,
      evidence: evidence.length,
    },
    details: {
      runtime,
      selection: {
        ...(options.timeRange === undefined ? {} : { requestedTimeRange: options.timeRange }),
        keywords: focus?.keywords ?? [],
        loadingGranularity,
        targets: loadedTargets.map((item) => item.target.label),
        signals: signalFocus.selection,
        pipelineOverrides: {
          total: pipelineOverridesTotal,
          selected: pipelineOverridesSelected,
          malformedLines: pipelineOverrideMalformedLines,
        },
      },
    },
  };
  });
}
