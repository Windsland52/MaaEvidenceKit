import { parseTimestamp } from "./provenance.js";
import type { Evidence, EvidenceSource, InspectionResult, TimeRange } from "./types.js";

export const EVIDENCE_SEARCH_SCHEMA_VERSION = "maa-evidence-search/v1" as const;

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 500;

export type EvidenceSearchQuery = {
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

function searchableText(evidence: Evidence): string {
  return JSON.stringify({
    kind: evidence.kind,
    summary: evidence.summary,
    source: evidence.source,
    data: evidence.data,
  }).toLowerCase();
}

export function searchEvidence(
  inspection: InspectionResult,
  query: EvidenceSearchQuery = {},
): EvidenceSearchResult {
  const kinds = normalizedValues(query.kinds, "kinds");
  const nodes = normalizedValues(query.nodes, "nodes");
  const tasks = normalizedValues(query.tasks, "tasks");
  const text = normalizedValues(query.text, "text");
  const loweredText = text.map((value) => value.toLowerCase());
  const range = parsedTimeRange(query.timeRange);
  const limit = boundedLimit(query.limit);
  const matches = inspection.evidence.filter((evidence) => {
    if (kinds.length > 0 && !kinds.includes(evidence.kind)) return false;
    if (nodes.length > 0 && (evidence.source.node === undefined || !nodes.includes(evidence.source.node))) return false;
    if (tasks.length > 0 && (evidence.source.task === undefined || !tasks.includes(evidence.source.task))) return false;
    if (!withinTimeRange(evidence.source.timestamp, range)) return false;
    if (loweredText.length > 0) {
      const haystack = searchableText(evidence);
      if (!loweredText.every((term) => haystack.includes(term))) return false;
    }
    return true;
  });
  const selected = matches.slice(0, limit).map((evidence) => ({
    id: evidence.id,
    kind: evidence.kind,
    summary: evidence.summary,
    source: evidence.source,
  }));
  const normalizedQuery: EvidenceSearchQuery = {
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
