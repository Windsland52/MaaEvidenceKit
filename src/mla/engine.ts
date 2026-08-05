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
  type EvidenceSource,
  type InspectionResult,
  type TimeRange,
} from "../evidence/index.js";
import { discoverArtifacts } from "./discovery.js";
import { translateRuntimeInspection, type MlaRuntimeInspectionResult } from "./translate.js";

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
};

type RecognitionDetailShape = {
  all?: unknown;
  best?: unknown;
  filtered?: unknown;
};

type RecognitionDetailSample = RecognitionDetailCandidate & {
  timestamp: string;
  mergedLine: number | null;
};

export type MlaRecognitionDetail = {
  algorithm: string;
  node: string;
  status: "succeeded" | "failed";
  occurrenceCount: number;
  textCounts: Array<{ text: string; count: number }>;
  score: {
    count: number;
    minimum: number;
    p50: number;
    p95: number;
    maximum: number;
    average: number;
  } | null;
  representatives: {
    first: RecognitionDetailSample;
    worst: RecognitionDetailSample | null;
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

function addRuntimeEvidence(
  ledger: EvidenceLedger,
  runtime: MlaRuntimeInspectionResult,
  artifacts: readonly Artifact[],
  inputPath: string,
): void {
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
    for (const task of session.tasks) addTaskEvidence(ledger, task, artifacts, inputPath);
  }
  for (const task of runtime.unscoped_tasks) addTaskEvidence(ledger, task, artifacts, inputPath);
  for (const failure of runtime.failures) {
    ledger.add(
      "mla.failure",
      `Node ${failure.node_name} reported ${failure.kind} in task ${failure.task_name}.`,
      evidenceSource(artifacts, inputPath, failure.evidence, {
        task: failure.task_name,
        node: failure.node_name,
      }),
      failure,
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
  }
}

function addTaskEvidence(
  ledger: EvidenceLedger,
  task: RuntimeTask,
  artifacts: readonly Artifact[],
  inputPath: string,
): void {
  ledger.add(
    "mla.task",
    `Task ${task.name} was ${task.status}${task.completeness === "open_at_log_end" ? " when the log ended" : ""}.`,
    evidenceSource(artifacts, inputPath, task.evidence.start, { task: task.name }),
    task,
  );
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
    if (task.statistics.next_list_timeouts > 0) observed.push("next_list_timeout");
    if (task.statistics.action_failures > 0) observed.push("action_failure");
    for (const signal of signalsByTask.get(task.execution_id) ?? []) {
      if (signal.kind === "repeated_node" || signal.kind === "repeated_node_cycle") {
        stillRepeatingAtLogEnd += signal.terminations.still_repeating_at_log_end;
      }
    }
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

function addRecognitionDetailEvidence(
  ledger: EvidenceLedger,
  detail: MlaRecognitionDetail,
  artifacts: readonly Artifact[],
  inputPath: string,
): void {
  const textSummary = detail.textCounts.length > 0
    ? ` texts=${detail.textCounts.slice(0, 3).map((item) => JSON.stringify(item.text)).join(", ")}`
    : "";
  const scoreSummary = detail.score === null
    ? ""
    : ` score=${detail.score.minimum.toFixed(4)}..${detail.score.maximum.toFixed(4)}`;
  const summary = `Recognition ${detail.node} ${detail.status} (${detail.algorithm}) x${detail.occurrenceCount}${textSummary}${scoreSummary}`;
  const representative = detail.representatives.worst ?? detail.representatives.first;
  ledger.add(
    "mla.recognition_detail",
    summary,
    evidenceSource(
      artifacts,
      inputPath,
      {
        timestamp: representative.timestamp,
        path: null,
        local_line: representative.mergedLine,
      },
      { node: detail.node },
    ),
    detail,
  );
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

export function countPossibleMirroredTaskGroups(runtime: MlaRuntimeInspectionResult): number {
  const groups = new Map<string, Set<string>>();
  const tasks = [...runtime.sessions.flatMap((session) => session.tasks), ...runtime.unscoped_tasks];
  for (const task of tasks) {
    const fingerprint = JSON.stringify([
      task.task_id,
      task.name,
      task.hash,
      task.uuid,
      task.status,
      task.started_at,
      task.ended_at,
    ]);
    const separator = task.execution_id.indexOf(":");
    const targetNamespace = separator === -1
      ? task.execution_id
      : task.execution_id.slice(0, separator);
    const namespaces = groups.get(fingerprint) ?? new Set<string>();
    namespaces.add(targetNamespace);
    groups.set(fingerprint, namespaces);
  }
  return [...groups.values()].filter((namespaces) => namespaces.size > 1).length;
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

function candidateFromUnknown(value: unknown): RecognitionDetailCandidate | null {
  if (!isRecord(value)) return null;
  const box = value["box"];
  const score = value["score"];
  const text = value["text"];
  const candidate: RecognitionDetailCandidate = {};
  if (Array.isArray(box) && box.length === 4 && box.every((item) => typeof item === "number")) {
    candidate.box = box as [number, number, number, number];
  }
  if (typeof score === "number") candidate.score = score;
  if (typeof text === "string") candidate.text = text;
  return Object.keys(candidate).length === 0 ? null : candidate;
}

function candidatesFromUnknown(value: unknown): RecognitionDetailCandidate[] {
  if (!Array.isArray(value)) return [];
  return value.map(candidateFromUnknown).filter((item): item is RecognitionDetailCandidate => item !== null);
}

function percentile(sorted: number[], ratio: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1));
  return sorted[index] ?? 0;
}

function extractRecognitionDetails(
  analyzed: Awaited<ReturnType<typeof analyzeLogContent>>,
): MlaRecognitionDetail[] {
  const groups = new Map<string, {
    algorithm: string;
    node: string;
    status: "succeeded" | "failed";
    count: number;
    texts: Map<string, number>;
    scores: number[];
    samples: RecognitionDetailSample[];
  }>();
  for (const event of analyzed.events) {
    if (event.message !== "Node.Recognition.Succeeded" && event.message !== "Node.Recognition.Failed") continue;
    const payload = event.details;
    if (!isRecord(payload)) continue;
    const recoDetails = payload["reco_details"];
    if (!isRecord(recoDetails)) continue;
    const algorithm = recoDetails["algorithm"];
    if (typeof algorithm !== "string") continue;
    const node = recoDetails["name"];
    if (typeof node !== "string") continue;
    const detail = recoDetails["detail"];
    if (!isRecord(detail)) continue;
    const shape = detail as RecognitionDetailShape;
    const all = candidatesFromUnknown(shape.all);
    if (all.length === 0) continue;
    const status = event.message === "Node.Recognition.Succeeded" ? "succeeded" : "failed";
    if (status === "succeeded" && algorithm !== "OCR") continue;
    const key = `${node}|${algorithm}|${status}`;
    const group = groups.get(key) ?? {
      algorithm,
      node,
      status,
      count: 0,
      texts: new Map<string, number>(),
      scores: [],
      samples: [],
    };
    group.count += 1;
    for (const candidate of all) {
      if (candidate.text !== undefined) {
        group.texts.set(candidate.text, (group.texts.get(candidate.text) ?? 0) + 1);
      }
      if (candidate.score !== undefined) {
        group.scores.push(candidate.score);
      }
    }
    group.samples.push({
      ...all[0],
      timestamp: event.timestamp,
      mergedLine: event._lineNumber ?? null,
    });
    groups.set(key, group);
  }
  return [...groups.values()].sort((left, right) =>
    [left.node, left.algorithm, left.status].join("|").localeCompare(
      [right.node, right.algorithm, right.status].join("|"),
    ),
  ).map((group) => {
    const sortedScores = [...group.scores].sort((left, right) => left - right);
    const score = sortedScores.length === 0
      ? null
      : {
        count: sortedScores.length,
        minimum: sortedScores[0] ?? 0,
        p50: percentile(sortedScores, 0.5),
        p95: percentile(sortedScores, 0.95),
        maximum: sortedScores[sortedScores.length - 1] ?? 0,
        average: sortedScores.reduce((total, item) => total + item, 0) / sortedScores.length,
      };
    const samples = group.samples;
    const first = samples[0] as RecognitionDetailSample;
    const worst = score === null
      ? null
      : [...samples].sort((left, right) =>
        (left.score ?? Infinity) - (right.score ?? Infinity)
      )[0] ?? null;
    return {
      algorithm: group.algorithm,
      node: group.node,
      status: group.status,
      occurrenceCount: group.count,
      textCounts: [...group.texts.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([text, count]) => ({ text, count })),
      score,
      representatives: { first, worst },
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
  let analyzed;
  if (target.kind === "directory") {
    const extracted = await loadNodeLogDirectory(target.path, focus === undefined ? {} : { focus });
    if (extracted === null) return null;
    sourceSegments = [...extracted.sourceSegments];
    analyzed = await analyzeLogContent({
      content: extracted.content,
      errorImages: extracted.errorImages,
      visionImages: extracted.visionImages,
      waitFreezesImages: extracted.waitFreezesImages,
    });
  } else {
    const content = await readNodeTextFileContent(target.path);
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
  return {
    target,
    runtime: namespaceRuntime(runtime, target.namespace),
    recognitionDetails: extractRecognitionDetails(analyzed),
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
  const discovery = await discoverArtifacts(resolvedPath);
  const focus = focusFromOptions(options);
  const targets = await selectMlaTargets(
    resolvedPath,
    metadata.isDirectory(),
    discovery.artifacts,
    focus !== undefined,
  );
  const loadedTargets: LoadedMlaTarget[] = [];
  const targetMissingEvidence = [];
  const coveredFiles = new Set<string>();
  const imageMapsByDirectory = buildImageMapsByLogDirectory(targets, discovery.artifacts);
  for (const target of targets) {
    if (target.kind === "file" && coveredFiles.has(pathKey(target.path))) continue;
    try {
      const imageDirectory = target.kind === "directory" ? target.path : path.dirname(target.path);
      const loaded = await loadMlaTarget(
        target,
        discovery.artifacts,
        focus,
        options.timeRange,
        imageMapsByDirectory.get(pathKey(imageDirectory)),
      );
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
  const possibleMirroredTaskGroups = countPossibleMirroredTaskGroups(runtime);
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
      loaded.artifacts,
      loaded.target.path,
    );
    for (const detail of loaded.recognitionDetails) {
      addRecognitionDetailEvidence(ledger, detail, loaded.artifacts, loaded.target.path);
    }
  }
  for (const anomaly of taskAnomalies) {
    const task = tasksByExecution.get(anomaly.executionId);
    if (task === undefined) continue;
    addTaskAnomalyEvidence(ledger, anomaly, task, discovery.artifacts, resolvedPath);
  }
  const evidence = ledger.values();
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
        message: `Selected ${signalFocus.selection.selected} of ${signalFocus.selection.total} runtime signals using MLA priorities and per-task highlights; request all signals explicitly for exhaustive output.`,
      }]),
    ...(possibleMirroredTaskGroups === 0
      ? []
      : [{
        code: "mla_possible_mirrored_tasks",
        message: `Observed ${possibleMirroredTaskGroups} groups of field-identical tasks across the selected logs; counts remain observations because separate instances cannot be safely deduplicated without correlation evidence.`,
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
      possibleMirroredTaskGroups,
      failures: runtime.failures.length,
      outcomes: runtime.outcomes.length,
      taskAnomalies: taskAnomalies.length,
      signals: runtime.signals.length,
      signalsTotal: signalFocus.selection.total,
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
      },
    },
  };
}
