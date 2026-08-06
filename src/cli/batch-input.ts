import { readFile } from "node:fs/promises";

import type {
  EvidenceBatchRequest,
  EvidenceSearchQuery,
  EvidenceWindowQuery,
  TimeRange,
} from "../evidence/index.js";
import { MAX_EVIDENCE_BATCH_REQUESTS } from "../evidence/index.js";

function objectValue(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be a JSON object.`);
  }
  return value as Record<string, unknown>;
}

function knownKeys(record: Record<string, unknown>, allowed: readonly string[], label: string): void {
  const unknown = Object.keys(record).find((key) => !allowed.includes(key));
  if (unknown !== undefined) throw new Error(`${label} contains unknown field: ${unknown}.`);
}

function optionalString(record: Record<string, unknown>, key: string, label: string): string | undefined {
  const value = record[key];
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${label}.${key} must be a non-empty string.`);
  }
  return value;
}

function optionalInteger(record: Record<string, unknown>, key: string, label: string): number | undefined {
  const value = record[key];
  if (value === undefined) return undefined;
  if (!Number.isInteger(value)) throw new Error(`${label}.${key} must be an integer.`);
  return value as number;
}

function optionalStrings(record: Record<string, unknown>, key: string, label: string): string[] | undefined {
  const value = record[key];
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error(`${label}.${key} must be an array of strings.`);
  }
  return value as string[];
}

function parseTimeRange(value: unknown, label: string): TimeRange | undefined {
  if (value === undefined) return undefined;
  const record = objectValue(value, label);
  knownKeys(record, ["from", "to"], label);
  const from = optionalString(record, "from", label);
  const to = optionalString(record, "to", label);
  return {
    ...(from === undefined ? {} : { from }),
    ...(to === undefined ? {} : { to }),
  };
}

function parseSearchQuery(value: unknown, label: string): EvidenceSearchQuery | undefined {
  if (value === undefined) return undefined;
  const record = objectValue(value, label);
  knownKeys(record, ["artifactIds", "kinds", "nodes", "tasks", "text", "timeRange", "limit"], label);
  const artifactIds = optionalStrings(record, "artifactIds", label);
  const kinds = optionalStrings(record, "kinds", label);
  const nodes = optionalStrings(record, "nodes", label);
  const tasks = optionalStrings(record, "tasks", label);
  const text = optionalStrings(record, "text", label);
  const timeRange = parseTimeRange(record["timeRange"], `${label}.timeRange`);
  const limit = optionalInteger(record, "limit", label);
  return {
    ...(artifactIds === undefined ? {} : { artifactIds }),
    ...(kinds === undefined ? {} : { kinds }),
    ...(nodes === undefined ? {} : { nodes }),
    ...(tasks === undefined ? {} : { tasks }),
    ...(text === undefined ? {} : { text }),
    ...(timeRange === undefined ? {} : { timeRange }),
    ...(limit === undefined ? {} : { limit }),
  };
}

function parseWindowQuery(value: unknown, label: string): EvidenceWindowQuery {
  const record = objectValue(value, label);
  knownKeys(
    record,
    ["evidenceId", "artifactId", "line", "before", "after", "maxLines", "maxCharacters"],
    label,
  );
  const evidenceId = optionalString(record, "evidenceId", label);
  const artifactId = optionalString(record, "artifactId", label);
  const line = optionalInteger(record, "line", label);
  const before = optionalInteger(record, "before", label);
  const after = optionalInteger(record, "after", label);
  const maxLines = optionalInteger(record, "maxLines", label);
  const maxCharacters = optionalInteger(record, "maxCharacters", label);
  return {
    ...(evidenceId === undefined ? {} : { evidenceId }),
    ...(artifactId === undefined ? {} : { artifactId }),
    ...(line === undefined ? {} : { line }),
    ...(before === undefined ? {} : { before }),
    ...(after === undefined ? {} : { after }),
    ...(maxLines === undefined ? {} : { maxLines }),
    ...(maxCharacters === undefined ? {} : { maxCharacters }),
  };
}

function parseRequest(value: unknown, index: number): EvidenceBatchRequest {
  const label = `batch request ${index + 1}`;
  const record = objectValue(value, label);
  const operation = record["operation"];
  const id = optionalString(record, "id", label);
  const identity = id === undefined ? {} : { id };
  if (operation === "search") {
    knownKeys(record, ["id", "operation", "query"], label);
    const query = parseSearchQuery(record["query"], `${label}.query`);
    return { ...identity, operation, ...(query === undefined ? {} : { query }) };
  }
  if (operation === "view") {
    knownKeys(record, ["id", "operation", "evidenceId"], label);
    const evidenceId = optionalString(record, "evidenceId", label);
    if (evidenceId === undefined) throw new Error(`${label}.evidenceId is required.`);
    return { ...identity, operation, evidenceId };
  }
  if (operation === "window") {
    knownKeys(record, ["id", "operation", "query"], label);
    return { ...identity, operation, query: parseWindowQuery(record["query"], `${label}.query`) };
  }
  throw new Error(`${label}.operation must be search, view, or window.`);
}

export async function readBatchRequests(file: string): Promise<EvidenceBatchRequest[]> {
  const parsed: unknown = JSON.parse(await readFile(file, "utf8"));
  if (!Array.isArray(parsed)) throw new Error("Batch request input must be a JSON array.");
  if (parsed.length < 1 || parsed.length > MAX_EVIDENCE_BATCH_REQUESTS) {
    throw new Error(`batch requires 1 through ${MAX_EVIDENCE_BATCH_REQUESTS} requests.`);
  }
  return parsed.map((value, index) => parseRequest(value, index));
}
