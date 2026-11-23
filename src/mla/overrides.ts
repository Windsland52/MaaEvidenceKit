import type { TimeRange } from "../evidence/index.js";

const TIMESTAMP_PATTERN = /^\[([^\]]+)\]/;
const CONTEXT_API_OVERRIDE_MARKER = "][MaaContextOverridePipeline]";
const CONTEXT_OVERRIDE_MARKER = "][MaaNS::TaskNS::Context::override_pipeline]";
const TASK_SUBMISSION_MARKER = "][MaaNS::Tasker::post_task]";
const TASK_UPDATE_MARKER = "][MaaNS::Tasker::override_pipeline]";
const RESOURCE_OVERRIDE_MARKER = "][MaaNS::ResourceNS::ResourceMgr::override_pipeline]";
const CONTEXT_OVERRIDE_SYMBOL = "MaaNS::TaskNS::Context::override_pipeline";

/**
 * Match a log marker the way MaaFramework actually writes it.
 *
 * MaaFramework records the same override under more than one marker form across builds and log
 * levels, and both forms appear in real material:
 *
 * - `][MaaNS::TaskNS::Context::override_pipeline]` (bare symbol), and
 * - `][virtual bool MaaNS::TaskNS::Context::override_pipeline(const json::value &)]` (C++ signature).
 *
 * Matching only the bare form extracted nothing from a log that contained 159 signature-form lines,
 * which is the failure this tolerance fixes.
 *
 * A third form is deliberately not extracted: the agent reverse-request path logs
 * `AgentClient::handle_context_override_pipeline` with a `_ContextOverridePipelineReverseRequest`
 * payload. That payload does carry real patches, but extracting it would add no information: every
 * patch it carries is already extracted verbatim from the corresponding Context-marker lines. On
 * three real logs every reverse payload was byte-identical to an already-extracted patch
 * (31/31, 26/26, 66/66 bodies; 18/18, 13/13, 17/17 node names covered), so parsing it would only
 * duplicate records. Those lines are still counted by the activity detector, so they stay visible
 * as an explicit extraction gap rather than disappearing.
 */
function hasMarker(line: string, bareMarker: string, symbol: string): boolean {
  return line.includes(bareMarker) || line.includes(`][virtual bool ${symbol}(`);
}

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
  /**
   * Line-local entry from this override record (typically `post_task [entry=...]`).
   * The MLA engine keeps this name as-is and only fills unnamed records from a unique
   * kernel interval, so `source.task` can match `mla.recognition_detail` without rewriting
   * an observed entry.
   */
  taskName: string | null;
  contextScopeId: string | null;
  nodeNames: string[];
  patchPaths: string[];
  patchPathsTruncated: boolean;
  patches: JsonRecord[];
  timestamp: string;
  mergedLine: number;
};

export type MlaPipelineOverrideExtraction = {
  observations: MlaPipelineOverrideObservation[];
  malformedLines: number;
  /**
   * Override-shaped lines seen, including the ones every marker parser above missed. A newer or
   * differently named MaaFramework override log line still lands here, which is what makes a
   * complete extraction miss detectable instead of silent.
   */
  activityLines: number;
};

/**
 * Whether a log line looks like it carries a pipeline override, without depending on any known
 * marker name or format.
 *
 * This exists to make a complete extraction miss detectable. The marker in a real log line is a
 * source symbol (`][MaaNS::TaskNS::Context::override_pipeline]`) or an API name
 * (`][MaaContextOverridePipeline]`), and a newer MaaFramework build is free to rename either, so
 * the detector matches the `override_pipeline` token in a bracketed position instead of an exact
 * marker. Two deliberate limits keep it from over-counting:
 *
 * - the line must carry a timestamp, so a bare JSON patch payload is not a candidate;
 * - the token must appear inside brackets. This does not exclude every payload: a patches array
 *   written as `[{"override_pipeline": ...}]` contains the token in a bracketed position and is
 *   counted. That direction is safe, because the count is only used to decide whether an empty
 *   extraction should raise a warning, so over-counting can only make the warning fire more often,
 *   never suppress a real miss. The token is also matched without a word boundary, so a renamed
 *   symbol such as `future_override_pipeline` still counts.
 *
 * The count is a lower bound on override-bearing lines and is not a record count: a task submission
 * that carries an override is counted even though it yields no override observation of its own.
 */
function isOverrideActivityLine(line: string): boolean {
  if (timestampOf(line) === null) return false;
  // No word boundary before the token: an upstream rename such as `future_override_pipeline`
  // still counts, which is exactly the case this detector exists to catch.
  return /\[[^\]]*override_pipeline/u.test(line);
}

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

function recordContextTaskId(line: string, contextTaskIds: Map<string, Set<number>>): void {
  const contextMatch = /"context_id":"([0-9A-Fa-f]+)"/.exec(line);
  const taskMatch = /"task_id":(\d+)/.exec(line);
  if (contextMatch?.[1] === undefined || taskMatch?.[1] === undefined) return;
  const taskId = Number(taskMatch[1]);
  if (!Number.isSafeInteger(taskId)) return;
  const ids = contextTaskIds.get(contextMatch[1]) ?? new Set<number>();
  ids.add(taskId);
  contextTaskIds.set(contextMatch[1], ids);
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

const MAX_PATCH_PATHS = 200;
const MAX_PATCH_PATH_DEPTH = 8;

type PatchPathCollection = {
  paths: Set<string>;
  truncated: boolean;
};

function collectPatchPaths(value: unknown, prefix: string, depth: number, output: PatchPathCollection): void {
  if (!isRecord(value) || depth >= MAX_PATCH_PATH_DEPTH || Object.keys(value).length === 0) {
    if (prefix.length === 0) return;
    if (output.paths.size >= MAX_PATCH_PATHS && !output.paths.has(prefix)) {
      output.truncated = true;
      return;
    }
    output.paths.add(prefix);
    return;
  }
  for (const key of Object.keys(value)) {
    collectPatchPaths(value[key], prefix.length === 0 ? key : `${prefix}.${key}`, depth + 1, output);
  }
}

/**
 * Flatten every overridden field into a dotted `Node.field.subfield` path. Override payloads carry
 * their meaning in object keys, which evidence text search deliberately does not index, so the paths
 * are exported as ordinary string values instead.
 */
function patchPathFields(
  patches: readonly JsonRecord[],
): { patchPaths: string[]; patchPathsTruncated: boolean } {
  const output: PatchPathCollection = { paths: new Set<string>(), truncated: false };
  for (const patch of patches) collectPatchPaths(patch, "", 0, output);
  return {
    patchPaths: [...output.paths].sort((left, right) => left.localeCompare(right)),
    patchPathsTruncated: output.truncated,
  };
}

type PendingOverrideOrigin = Omit<OverrideOriginCandidate, "mergedLine"> & {
  sourceKey: string;
  localLine: number;
};

type PendingContextOverride = Omit<ContextOverrideCandidate, "mergedLine"> & {
  sourceKey: string;
  localLine: number;
};

type PendingContextApiOverride = Omit<ContextApiOverrideCandidate, "mergedLine"> & {
  sourceKey: string;
  localLine: number;
};

type PendingResourceOverride = {
  sourceKey: string;
  localLine: number;
  patches: JsonRecord[];
  timestamp: string;
};

/**
 * Incremental override extraction for material that must stay split across sources.
 *
 * A 2GB+ directory is parsed from one lazy source per file, so MEK cannot hand the merged string to
 * `extractPipelineOverrides` (that string does not exist). The scanner records each candidate with
 * its source key and source-local line, then `finish` maps those to the merged line numbers the
 * evidence ledger already uses. Overrides that pair a context line in one file with the task line
 * that introduced it in another still match, because the mapping and matching happen only after
 * every source was scanned.
 */
export interface PipelineOverrideScanner {
  /** Scan one source's content, recording candidates against its source-local line numbers. */
  scan(content: string, sourceKey: string): number;
  /**
   * Resolve source-local lines to merged lines and produce the observations.
   *
   * `startLineOf` returns the merged line where that source begins; the default of 1 suits a
   * single source whose local lines are already merged lines.
   */
  finish(
    timeRange?: TimeRange,
    startLineOf?: (sourceKey: string) => number,
  ): MlaPipelineOverrideExtraction;
}

export function createPipelineOverrideScanner(): PipelineOverrideScanner {
  const origins: PendingOverrideOrigin[] = [];
  const contexts: PendingContextOverride[] = [];
  const contextApiInputs: PendingContextApiOverride[] = [];
  const resources: PendingResourceOverride[] = [];
  const contextTaskIds = new Map<string, Set<number>>();
  let activityLines = 0;
  let malformedLines = 0;

  const scanLine = (line: string, sourceKey: string, localLine: number): void => {
    if (isOverrideActivityLine(line)) activityLines += 1;
    recordContextTaskId(line, contextTaskIds);
    const timestamp = timestampOf(line);
    if (timestamp === null) return;
    if (
      (line.includes(TASK_SUBMISSION_MARKER) || line.includes(TASK_UPDATE_MARKER))
      && line.includes("[pipeline_override=")
    ) {
      const parsed = parsePipelineOverride(line);
      if (parsed === null) {
        malformedLines += 1;
        return;
      }
      const isSubmission = line.includes(TASK_SUBMISSION_MARKER);
      const rawTaskId = isSubmission ? null : bracketValue(line, "task_id");
      const taskId = rawTaskId === null ? null : Number(rawTaskId);
      origins.push({
        canonicalOverride: parsed.canonicalOverride,
        entry: isSubmission ? bracketValue(line, "entry") : null,
        origin: isSubmission ? "task_submission" : "task_update",
        patches: parsed.patches,
        taskId: taskId !== null && Number.isSafeInteger(taskId) ? taskId : null,
        timestamp,
        sourceKey,
        localLine,
      });
      return;
    }
    if (hasMarker(line, CONTEXT_OVERRIDE_MARKER, CONTEXT_OVERRIDE_SYMBOL)) {
      const parsed = parsePipelineOverride(line);
      const contextId = bracketValue(line, "getptr()");
      if (parsed === null || contextId === null) {
        malformedLines += 1;
        return;
      }
      if (parsed.patches.every((patch) => Object.keys(patch).length === 0)) return;
      contexts.push({ ...parsed, contextId, timestamp, sourceKey, localLine });
      return;
    }
    if (line.includes(CONTEXT_API_OVERRIDE_MARKER) && line.includes("[pipeline_override=")) {
      const parsed = parsePipelineOverride(line);
      if (parsed === null) {
        malformedLines += 1;
        return;
      }
      if (parsed.patches.every((patch) => Object.keys(patch).length === 0)) return;
      contextApiInputs.push({ ...parsed, timestamp, sourceKey, localLine });
      return;
    }
    if (line.includes(RESOURCE_OVERRIDE_MARKER)) {
      const parsed = parsePipelineOverride(line);
      if (parsed === null) {
        malformedLines += 1;
        return;
      }
      if (parsed.patches.every((patch) => Object.keys(patch).length === 0)) return;
      resources.push({ localLine, patches: parsed.patches, timestamp, sourceKey });
    }
  };

  const scan = (content: string, sourceKey: string): number => {
    let localLine = 0;
    let start = 0;
    for (;;) {
      const newline = content.indexOf("\n", start);
      const end = newline === -1 ? content.length : newline;
      let line = content.slice(start, end);
      if (line.endsWith("\r")) line = line.slice(0, -1);
      localLine += 1;
      scanLine(line, sourceKey, localLine);
      if (newline === -1) return localLine;
      start = newline + 1;
    }
  };

  const finish = (
    timeRange?: TimeRange,
    startLineOf: (sourceKey: string) => number = () => 1,
  ): MlaPipelineOverrideExtraction => {
    const mergedLineOf = (candidate: { sourceKey: string; localLine: number }): number =>
      startLineOf(candidate.sourceKey) + candidate.localLine - 1;
    const locatedOrigins: OverrideOriginCandidate[] = origins
      .map((origin) => ({ ...origin, mergedLine: mergedLineOf(origin) }))
      .sort((left, right) => left.mergedLine - right.mergedLine);
    const locatedContexts: ContextOverrideCandidate[] = contexts
      .map((context) => ({ ...context, mergedLine: mergedLineOf(context) }))
      .sort((left, right) => left.mergedLine - right.mergedLine);
    const locatedContextApiInputs: ContextApiOverrideCandidate[] = contextApiInputs
      .map((contextApiInput) => ({ ...contextApiInput, mergedLine: mergedLineOf(contextApiInput) }))
      .sort((left, right) => left.mergedLine - right.mergedLine);
    const locatedResources = resources
      .map((resource) => ({
        mergedLine: mergedLineOf(resource),
        patches: resource.patches,
        timestamp: resource.timestamp,
      }))
      .sort((left, right) => left.mergedLine - right.mergedLine);

    const contextOrdinals = new Map<string, string>();
    for (const context of locatedContexts) {
      if (!contextOrdinals.has(context.contextId)) {
        contextOrdinals.set(context.contextId, `context-${contextOrdinals.size + 1}`);
      }
    }

    const observations: MlaPipelineOverrideObservation[] = [];
    const matchedOriginLines = new Set<number>();
    const matchedContextApiInputLines = new Set<number>();
    for (const resource of locatedResources) {
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
        ...patchPathFields(resource.patches),
        patches: resource.patches,
        timestamp: resource.timestamp,
        mergedLine: resource.mergedLine,
      });
    }
    for (const context of locatedContexts) {
      if (!timestampWithin(context.timestamp, timeRange)) continue;
      const origin = matchingOrigin(context, locatedOrigins);
      if (origin !== null) matchedOriginLines.add(origin.mergedLine);
      const contextApiInput = locatedContextApiInputs
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
      const taskName = origin?.entry ?? null;
      observations.push({
        sequence: context.mergedLine,
        scope: "context",
        origin: origin?.origin ?? "context",
        taskAssociation: taskId !== null ? "task_id" : taskName !== null ? "entry_only" : "none",
        taskId,
        taskName,
        contextScopeId: contextOrdinals.get(context.contextId) ?? null,
        nodeNames: nodeNames(context.patches),
        ...patchPathFields(context.patches),
        patches: context.patches,
        timestamp: context.timestamp,
        mergedLine: context.mergedLine,
      });
    }
    for (const origin of locatedOrigins) {
      if (matchedOriginLines.has(origin.mergedLine) || !timestampWithin(origin.timestamp, timeRange)) continue;
      if (origin.patches.every((patch) => Object.keys(patch).length === 0)) continue;
      const taskName = origin.entry;
      observations.push({
        sequence: origin.mergedLine,
        scope: "task",
        origin: origin.origin,
        taskAssociation: origin.taskId !== null ? "task_id" : taskName !== null ? "entry_only" : "none",
        taskId: origin.taskId,
        taskName,
        contextScopeId: null,
        nodeNames: nodeNames(origin.patches),
        ...patchPathFields(origin.patches),
        patches: origin.patches,
        timestamp: origin.timestamp,
        mergedLine: origin.mergedLine,
      });
    }
    for (const contextApiInput of locatedContextApiInputs) {
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
        ...patchPathFields(contextApiInput.patches),
        patches: contextApiInput.patches,
        timestamp: contextApiInput.timestamp,
        mergedLine: contextApiInput.mergedLine,
      });
    }
    observations.sort((left, right) => left.mergedLine - right.mergedLine);
    return { observations, malformedLines, activityLines };
  };

  return { scan, finish };
}

/**
 * Extract overrides from one already-materialized string.
 *
 * Directory inspection with more than one source uses `createPipelineOverrideScanner` instead, so
 * no caller has to build the merged string this function needs.
 */
export function extractPipelineOverrides(
  content: string,
  timeRange?: TimeRange,
): MlaPipelineOverrideExtraction {
  const scanner = createPipelineOverrideScanner();
  scanner.scan(content, "");
  return scanner.finish(timeRange, () => 1);
}
