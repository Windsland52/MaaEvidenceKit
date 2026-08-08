import type { TimeRange } from "../evidence/index.js";

const TIMESTAMP_PATTERN = /^\[([^\]]+)\]/;
const CONTEXT_API_OVERRIDE_MARKER = "][MaaContextOverridePipeline]";
const CONTEXT_OVERRIDE_MARKER = "][MaaNS::TaskNS::Context::override_pipeline]";
const TASK_SUBMISSION_MARKER = "][MaaNS::Tasker::post_task]";
const TASK_UPDATE_MARKER = "][MaaNS::Tasker::override_pipeline]";
const RESOURCE_OVERRIDE_MARKER = "][MaaNS::ResourceNS::ResourceMgr::override_pipeline]";

type JsonRecord = Record<string, unknown>;

type OverrideOriginCandidate = {
  canonicalOverride: string;
  entry: string | null;
  mergedLine: number;
  origin: "task_submission" | "task_update";
  patches: JsonRecord[];
  taskId: number | null;
  timestamp: string;
};

type ContextOverrideCandidate = {
  canonicalOverride: string;
  contextId: string;
  mergedLine: number;
  patches: JsonRecord[];
  timestamp: string;
};

type ContextApiOverrideCandidate = Omit<ContextOverrideCandidate, "contextId">;

export type MlaPipelineOverrideObservation = {
  sequence: number;
  scope: "context" | "resource" | "task";
  origin: "context" | "resource" | "task_submission" | "task_update";
  taskAssociation: "task_id" | "entry_only" | "none";
  taskId: number | null;
  taskName: string | null;
  contextScopeId: string | null;
  nodeNames: string[];
  patches: JsonRecord[];
  timestamp: string;
  mergedLine: number;
};

export type MlaPipelineOverrideExtraction = {
  observations: MlaPipelineOverrideObservation[];
  malformedLines: number;
};

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (isRecord(value)) {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function parsePipelineOverride(line: string): { patches: JsonRecord[]; canonicalOverride: string } | null {
  const marker = "[pipeline_override=";
  const start = line.lastIndexOf(marker);
  if (start < 0) return null;
  const payloadStart = start + marker.length;
  const opening = line[payloadStart];
  if (opening !== "{" && opening !== "[") return null;
  let depth = 0;
  let escaped = false;
  let inString = false;
  let payloadEnd = -1;
  for (let index = payloadStart; index < line.length; index += 1) {
    const character = line[index];
    if (character === undefined) break;
    if (inString) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === "\"") inString = false;
      continue;
    }
    if (character === "\"") {
      inString = true;
      continue;
    }
    if (character === "{" || character === "[") depth += 1;
    else if (character === "}" || character === "]") depth -= 1;
    if (depth === 0) {
      payloadEnd = index + 1;
      break;
    }
  }
  if (payloadEnd < 0 || line[payloadEnd] !== "]") return null;
  const payload = line.slice(payloadStart, payloadEnd);
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload) as unknown;
  } catch {
    return null;
  }
  const patches = Array.isArray(parsed) ? parsed : [parsed];
  if (!patches.every(isRecord)) return null;
  return { patches, canonicalOverride: canonicalJson(parsed) };
}

function bracketValue(line: string, name: string): string | null {
  const marker = `[${name}=`;
  const start = line.indexOf(marker);
  if (start < 0) return null;
  const end = line.indexOf("]", start + marker.length);
  if (end < 0) return null;
  return line.slice(start + marker.length, end);
}

function timestampOf(line: string): string | null {
  return TIMESTAMP_PATTERN.exec(line)?.[1] ?? null;
}

function timestampWithin(timestamp: string, range: TimeRange | undefined): boolean {
  if (range === undefined) return true;
  const value = Date.parse(timestamp);
  if (!Number.isFinite(value)) return false;
  if (range.from !== undefined && value < Date.parse(range.from)) return false;
  if (range.to !== undefined && value > Date.parse(range.to)) return false;
  return true;
}

function taskMetadata(lines: readonly string[]): {
  contextTaskIds: Map<string, Set<number>>;
  taskNames: Map<number, Set<string>>;
} {
  const contextTaskIds = new Map<string, Set<number>>();
  const taskNames = new Map<number, Set<string>>();
  for (const line of lines) {
    const contextMatch = /"context_id":"([0-9A-Fa-f]+)"/.exec(line);
    const taskMatch = /"task_id":(\d+)/.exec(line);
    if (contextMatch?.[1] !== undefined && taskMatch?.[1] !== undefined) {
      const taskId = Number(taskMatch[1]);
      if (Number.isSafeInteger(taskId)) {
        const ids = contextTaskIds.get(contextMatch[1]) ?? new Set<number>();
        ids.add(taskId);
        contextTaskIds.set(contextMatch[1], ids);
      }
    }
    if (taskMatch?.[1] === undefined) continue;
    const entryMatch = /"entry":"([^"]+)"/.exec(line);
    if (entryMatch?.[1] === undefined) continue;
    const taskId = Number(taskMatch[1]);
    if (!Number.isSafeInteger(taskId)) continue;
    const names = taskNames.get(taskId) ?? new Set<string>();
    names.add(entryMatch[1]);
    taskNames.set(taskId, names);
  }
  return { contextTaskIds, taskNames };
}

function exactSingle<T>(values: Set<T> | undefined): T | null {
  if (values === undefined || values.size !== 1) return null;
  return values.values().next().value as T;
}

function matchingOrigin(
  context: ContextOverrideCandidate,
  candidates: readonly OverrideOriginCandidate[],
): OverrideOriginCandidate | null {
  const matches = candidates.filter((candidate) =>
    candidate.mergedLine < context.mergedLine
    && context.mergedLine - candidate.mergedLine <= 8
    && timestampDistanceMs(candidate.timestamp, context.timestamp) <= 50
    && candidate.canonicalOverride === context.canonicalOverride
  );
  return matches.sort((left, right) => right.mergedLine - left.mergedLine)[0] ?? null;
}

function timestampDistanceMs(earlier: string, later: string): number {
  const earlierValue = Date.parse(earlier);
  const laterValue = Date.parse(later);
  if (!Number.isFinite(earlierValue) || !Number.isFinite(laterValue) || laterValue < earlierValue) {
    return Number.POSITIVE_INFINITY;
  }
  return laterValue - earlierValue;
}

function nodeNames(patches: readonly JsonRecord[]): string[] {
  return [...new Set(patches.flatMap((patch) => Object.keys(patch)))].sort((left, right) =>
    left.localeCompare(right)
  );
}

export function extractPipelineOverrides(
  content: string,
  timeRange?: TimeRange,
): MlaPipelineOverrideExtraction {
  const lines = content.split(/\r?\n/);
  const { contextTaskIds, taskNames } = taskMetadata(lines);
  const origins: OverrideOriginCandidate[] = [];
  const contexts: ContextOverrideCandidate[] = [];
  const contextApiInputs: ContextApiOverrideCandidate[] = [];
  const resources: Array<{
    mergedLine: number;
    patches: JsonRecord[];
    timestamp: string;
  }> = [];
  let malformedLines = 0;

  for (const [index, line] of lines.entries()) {
    const timestamp = timestampOf(line);
    if (timestamp === null) continue;
    const mergedLine = index + 1;
    if (
      (line.includes(TASK_SUBMISSION_MARKER) || line.includes(TASK_UPDATE_MARKER))
      && line.includes("[pipeline_override=")
    ) {
      const parsed = parsePipelineOverride(line);
      if (parsed === null) {
        malformedLines += 1;
        continue;
      }
      const isSubmission = line.includes(TASK_SUBMISSION_MARKER);
      const rawTaskId = isSubmission ? null : bracketValue(line, "task_id");
      const taskId = rawTaskId === null ? null : Number(rawTaskId);
      origins.push({
        canonicalOverride: parsed.canonicalOverride,
        entry: isSubmission ? bracketValue(line, "entry") : null,
        mergedLine,
        origin: isSubmission ? "task_submission" : "task_update",
        patches: parsed.patches,
        taskId: taskId !== null && Number.isSafeInteger(taskId) ? taskId : null,
        timestamp,
      });
      continue;
    }
    if (line.includes(CONTEXT_OVERRIDE_MARKER)) {
      const parsed = parsePipelineOverride(line);
      const contextId = bracketValue(line, "getptr()");
      if (parsed === null || contextId === null) {
        malformedLines += 1;
        continue;
      }
      if (parsed.patches.every((patch) => Object.keys(patch).length === 0)) continue;
      contexts.push({ ...parsed, contextId, mergedLine, timestamp });
      continue;
    }
    if (line.includes(CONTEXT_API_OVERRIDE_MARKER) && line.includes("[pipeline_override=")) {
      const parsed = parsePipelineOverride(line);
      if (parsed === null) {
        malformedLines += 1;
        continue;
      }
      if (parsed.patches.every((patch) => Object.keys(patch).length === 0)) continue;
      contextApiInputs.push({ ...parsed, mergedLine, timestamp });
      continue;
    }
    if (line.includes(RESOURCE_OVERRIDE_MARKER)) {
      const parsed = parsePipelineOverride(line);
      if (parsed === null) {
        malformedLines += 1;
        continue;
      }
      if (parsed.patches.every((patch) => Object.keys(patch).length === 0)) continue;
      resources.push({ mergedLine, patches: parsed.patches, timestamp });
    }
  }

  const contextOrdinals = new Map<string, string>();
  for (const context of contexts) {
    if (!contextOrdinals.has(context.contextId)) {
      contextOrdinals.set(context.contextId, `context-${contextOrdinals.size + 1}`);
    }
  }

  const observations: MlaPipelineOverrideObservation[] = [];
  const matchedOriginLines = new Set<number>();
  const matchedContextApiInputLines = new Set<number>();
  for (const resource of resources) {
    if (!timestampWithin(resource.timestamp, timeRange)) continue;
    observations.push({
      sequence: resource.mergedLine,
      scope: "resource",
      origin: "resource",
      taskAssociation: "none",
      taskId: null,
      taskName: null,
      contextScopeId: null,
      nodeNames: nodeNames(resource.patches),
      patches: resource.patches,
      timestamp: resource.timestamp,
      mergedLine: resource.mergedLine,
    });
  }
  for (const context of contexts) {
    if (!timestampWithin(context.timestamp, timeRange)) continue;
    const origin = matchingOrigin(context, origins);
    if (origin !== null) matchedOriginLines.add(origin.mergedLine);
    const contextApiInput = contextApiInputs
      .filter((candidate) =>
        candidate.mergedLine < context.mergedLine
        && context.mergedLine - candidate.mergedLine <= 8
        && timestampDistanceMs(candidate.timestamp, context.timestamp) <= 50
        && candidate.canonicalOverride === context.canonicalOverride
      )
      .sort((left, right) => right.mergedLine - left.mergedLine)[0] ?? null;
    if (contextApiInput !== null) matchedContextApiInputLines.add(contextApiInput.mergedLine);
    const mappedTaskId = exactSingle(contextTaskIds.get(context.contextId));
    const taskId = origin?.taskId ?? mappedTaskId;
    const mappedTaskName = taskId === null ? null : exactSingle(taskNames.get(taskId));
    const taskName = origin?.entry ?? mappedTaskName;
    observations.push({
      sequence: context.mergedLine,
      scope: "context",
      origin: origin?.origin ?? "context",
      taskAssociation: taskId !== null ? "task_id" : taskName !== null ? "entry_only" : "none",
      taskId,
      taskName,
      contextScopeId: contextOrdinals.get(context.contextId) ?? null,
      nodeNames: nodeNames(context.patches),
      patches: context.patches,
      timestamp: context.timestamp,
      mergedLine: context.mergedLine,
    });
  }
  for (const origin of origins) {
    if (matchedOriginLines.has(origin.mergedLine) || !timestampWithin(origin.timestamp, timeRange)) continue;
    if (origin.patches.every((patch) => Object.keys(patch).length === 0)) continue;
    const taskName = origin.entry
      ?? (origin.taskId === null ? null : exactSingle(taskNames.get(origin.taskId)));
    observations.push({
      sequence: origin.mergedLine,
      scope: "task",
      origin: origin.origin,
      taskAssociation: origin.taskId !== null ? "task_id" : taskName !== null ? "entry_only" : "none",
      taskId: origin.taskId,
      taskName,
      contextScopeId: null,
      nodeNames: nodeNames(origin.patches),
      patches: origin.patches,
      timestamp: origin.timestamp,
      mergedLine: origin.mergedLine,
    });
  }
  for (const contextApiInput of contextApiInputs) {
    if (
      matchedContextApiInputLines.has(contextApiInput.mergedLine)
      || !timestampWithin(contextApiInput.timestamp, timeRange)
    ) continue;
    observations.push({
      sequence: contextApiInput.mergedLine,
      scope: "context",
      origin: "context",
      taskAssociation: "none",
      taskId: null,
      taskName: null,
      contextScopeId: null,
      nodeNames: nodeNames(contextApiInput.patches),
      patches: contextApiInput.patches,
      timestamp: contextApiInput.timestamp,
      mergedLine: contextApiInput.mergedLine,
    });
  }
  observations.sort((left, right) => left.mergedLine - right.mergedLine);
  return { observations, malformedLines };
}
