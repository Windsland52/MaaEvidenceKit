import { parseTimestamp } from "./provenance.js";
import type { Evidence, EvidenceSource, InspectionResult, TimeRange } from "./types.js";

export const EVIDENCE_SEARCH_SCHEMA_VERSION = "maa-evidence-search/v1" as const;

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 500;

export type EvidenceSearchQuery = {
  artifactIds?: readonly string[];
  kinds?: readonly string[];
  nodes?: readonly string[];
  tasks?: readonly string[];
  text?: readonly string[];
  timeRange?: TimeRange;
  limit?: number;
};

export type EvidenceSearchItem = {
  id: string;
  kind: string;
  summary: string;
  source: EvidenceSource;
  nodeMatches?: EvidenceSearchNodeMatch[];
};

export type EvidenceSearchNodeMatch = {
  node: string;
  relation: "source" | "recognition_child" | "recognition_descendant";
  path?: string[];
};

export type EvidenceSearchResult = {
  schemaVersion: typeof EVIDENCE_SEARCH_SCHEMA_VERSION;
  query: EvidenceSearchQuery;
  totalMatches: number;
  returned: number;
  truncated: boolean;
  evidence: EvidenceSearchItem[];
};

function normalizedValues(values: readonly string[] | undefined, field: string): string[] {
  if (values === undefined) return [];
  const normalized = values.map((value) => value.trim());
  if (normalized.some((value) => value.length === 0)) throw new Error(`${field} values must not be empty.`);
  return [...new Set(normalized)];
}

function boundedLimit(value: number | undefined): number {
  if (value === undefined) return DEFAULT_LIMIT;
  if (!Number.isInteger(value) || value < 1 || value > MAX_LIMIT) {
    throw new Error(`limit must be an integer from 1 through ${MAX_LIMIT}.`);
  }
  return value;
}

function parsedTimeRange(range: TimeRange | undefined): { from?: number; to?: number } | undefined {
  if (range === undefined) return undefined;
  const from = range.from === undefined ? undefined : parseTimestamp(range.from, "timeRange.from");
  const to = range.to === undefined ? undefined : parseTimestamp(range.to, "timeRange.to");
  if (from !== undefined && to !== undefined && from > to) {
    throw new Error("timeRange.from must not be later than timeRange.to.");
  }
  return {
    ...(from === undefined ? {} : { from }),
    ...(to === undefined ? {} : { to }),
  };
}

function withinTimeRange(timestamp: string | undefined, range: { from?: number; to?: number } | undefined): boolean {
  if (range === undefined) return true;
  if (timestamp === undefined) return false;
  const value = Date.parse(timestamp);
  if (!Number.isFinite(value)) return false;
  if (range.from !== undefined && value < range.from) return false;
  if (range.to !== undefined && value > range.to) return false;
  return true;
}

function collectSearchValues(value: unknown, output: string[]): void {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    output.push(String(value));
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectSearchValues(item, output);
    return;
  }
  if (typeof value !== "object" || value === null) return;
  for (const item of Object.values(value)) collectSearchValues(item, output);
}

function searchableText(evidence: Evidence): string {
  const values = [evidence.kind, evidence.summary];
  collectSearchValues(evidence.source, values);
  collectSearchValues(evidence.data, values);
  return values.join("\n").toLowerCase();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactNodeMatches(evidence: Evidence, requestedNodes: readonly string[]): EvidenceSearchNodeMatch[] {
  if (requestedNodes.length === 0) return [];
  const requested = new Set(requestedNodes);
  const matches = new Map<string, EvidenceSearchNodeMatch>();
  const add = (match: EvidenceSearchNodeMatch): void => {
    if (requested.has(match.node) && !matches.has(match.node)) matches.set(match.node, match);
  };
  if (evidence.source.node !== undefined) {
    add({ node: evidence.source.node, relation: "source" });
  }
  if (evidence.kind === "mla.recognition_detail" && isRecord(evidence.data)) {
    const children = evidence.data["childRecognition"];
    if (Array.isArray(children)) {
      for (const child of children) {
        if (!isRecord(child) || typeof child["name"] !== "string") continue;
        add({ node: child["name"], relation: "recognition_child", path: [child["name"]] });
      }
    }
    const descendants = evidence.data["descendantRecognition"];
    if (Array.isArray(descendants)) {
      for (const descendant of descendants) {
        if (!isRecord(descendant) || typeof descendant["name"] !== "string") continue;
        const recognitionPath = Array.isArray(descendant["path"])
          ? descendant["path"].filter((item): item is string => typeof item === "string")
          : [];
        add({
          node: descendant["name"],
          relation: recognitionPath.length <= 1 ? "recognition_child" : "recognition_descendant",
          ...(recognitionPath.length === 0 ? {} : { path: recognitionPath }),
        });
      }
    }
  }
  return requestedNodes.flatMap((node) => {
    const match = matches.get(node);
    return match === undefined ? [] : [match];
  });
}

export function searchEvidence(
  inspection: InspectionResult,
  query: EvidenceSearchQuery = {},
): EvidenceSearchResult {
  const artifactIds = normalizedValues(query.artifactIds, "artifactIds");
  const kinds = normalizedValues(query.kinds, "kinds");
  const nodes = normalizedValues(query.nodes, "nodes");
  const tasks = normalizedValues(query.tasks, "tasks");
  const text = normalizedValues(query.text, "text");
  const loweredText = text.map((value) => value.toLowerCase());
  const range = parsedTimeRange(query.timeRange);
  const limit = boundedLimit(query.limit);
  const matches = inspection.evidence.flatMap((evidence) => {
    if (artifactIds.length > 0 && !artifactIds.includes(evidence.source.artifactId)) return [];
    if (kinds.length > 0 && !kinds.includes(evidence.kind)) return [];
    const nodeMatches = exactNodeMatches(evidence, nodes);
    if (nodes.length > 0 && nodeMatches.length === 0) return [];
    if (tasks.length > 0 && (evidence.source.task === undefined || !tasks.includes(evidence.source.task))) return [];
    if (!withinTimeRange(evidence.source.timestamp, range)) return [];
    if (loweredText.length > 0) {
      const haystack = searchableText(evidence);
      if (!loweredText.every((term) => haystack.includes(term))) return [];
    }
    return [{ evidence, nodeMatches }];
  });
  const selected = matches.slice(0, limit).map(({ evidence, nodeMatches }) => ({
    id: evidence.id,
    kind: evidence.kind,
    summary: evidence.summary,
    source: evidence.source,
    ...(nodeMatches.length === 0 ? {} : { nodeMatches }),
  }));
  const normalizedQuery: EvidenceSearchQuery = {
    ...(artifactIds.length === 0 ? {} : { artifactIds }),
    ...(kinds.length === 0 ? {} : { kinds }),
    ...(nodes.length === 0 ? {} : { nodes }),
    ...(tasks.length === 0 ? {} : { tasks }),
    ...(text.length === 0 ? {} : { text }),
    ...(query.timeRange === undefined ? {} : { timeRange: query.timeRange }),
    limit,
  };
  return {
    schemaVersion: EVIDENCE_SEARCH_SCHEMA_VERSION,
    query: normalizedQuery,
    totalMatches: matches.length,
    returned: selected.length,
    truncated: selected.length < matches.length,
    evidence: selected,
  };
}
