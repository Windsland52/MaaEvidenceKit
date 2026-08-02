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

export type MlaInspectOptions = {
  timeRange?: TimeRange;
  keywords?: string[];
};

export type MlaInspectionDetails = {
  runtime: MlaRuntimeInspectionResult;
  selection: {
    requestedTimeRange?: TimeRange;
    keywords: string[];
    loadingGranularity: "matched_files" | "single_file" | "multiple_bundles";
    targets: string[];
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
    const representative = signal.representatives.first;
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
      signal,
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
  sourceSegments: SourceSegment[];
  artifacts: Artifact[];
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

async function selectMlaTargets(
  resolvedPath: string,
  inputIsDirectory: boolean,
  artifacts: readonly Artifact[],
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
  const targets: MlaTarget[] = [];
  for (const [directory, group] of [...byDirectory.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    const useDirectory = group.some((artifact) => isMainLog(artifact.path))
      && (directory !== resolvedPath || !projectRoot);
    const candidates = useDirectory
      ? [{ path: directory, kind: "directory" as const }]
      : group
        .sort((left, right) => left.path.localeCompare(right.path))
        .map((artifact) => ({ path: artifact.path, kind: "file" as const }));
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

function namespaceRuntime(
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

async function loadMlaTarget(
  target: MlaTarget,
  artifacts: readonly Artifact[],
  focus: LogBundleFocus | undefined,
  timeRange: TimeRange | undefined,
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
    sourceSegments = [{
      source: `file:${portablePath(target.path)}`,
      path: path.basename(target.path),
      startLine: 1,
      lineCount: (content.match(/\n/g) ?? []).length + 1,
    }];
    analyzed = await analyzeLogContent({ content });
  }
  const runtime = filterRuntime(
    translateRuntimeInspection(buildRuntimeInspection(analyzed, framework, sourceSegments)),
    timeRange,
  );
  return {
    target,
    runtime: namespaceRuntime(runtime, target.namespace),
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
  );
  const loadedTargets: LoadedMlaTarget[] = [];
  const targetMissingEvidence = [];
  for (const target of targets) {
    try {
      const loaded = await loadMlaTarget(target, discovery.artifacts, focus, options.timeRange);
      if (loaded === null) {
        targetMissingEvidence.push({
          code: "mla_target_empty",
          message: `MLA selected no analyzable content from ${target.label}.`,
          path: target.path,
        });
      } else {
        loadedTargets.push(loaded);
      }
    } catch (error: unknown) {
      targetMissingEvidence.push({
        code: "mla_target_unreadable",
        message: `MLA could not inspect ${target.label}: ${error instanceof Error ? error.message : String(error)}`,
        path: target.path,
      });
    }
  }
  const runtime = loadedTargets.length === 0
    ? emptyRuntime(["No analyzable MaaFramework log content was selected."])
    : mergeRuntimes(loadedTargets);
  const loadingGranularity = targets.length > 1
    ? "multiple_bundles" as const
    : targets[0]?.kind === "file"
      ? "single_file" as const
      : "matched_files" as const;
  const ledger = new EvidenceLedger();
  for (const loaded of loadedTargets) {
    addRuntimeEvidence(ledger, loaded.runtime, loaded.artifacts, loaded.target.path);
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
      failures: runtime.failures.length,
      outcomes: runtime.outcomes.length,
      signals: runtime.signals.length,
      evidence: evidence.length,
    },
    details: {
      runtime,
      selection: {
        ...(options.timeRange === undefined ? {} : { requestedTimeRange: options.timeRange }),
        keywords: focus?.keywords ?? [],
        loadingGranularity,
        targets: targets.map((target) => target.label),
      },
    },
  };
}
