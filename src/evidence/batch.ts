import { searchEvidence, type EvidenceSearchQuery, type EvidenceSearchResult } from "./search.js";
import type { Evidence, InspectionResult } from "./types.js";
import { queryEvidenceWindow, type EvidenceWindow, type EvidenceWindowQuery } from "./window.js";

export const EVIDENCE_BATCH_SCHEMA_VERSION = "maa-evidence-batch/v1" as const;

export const MAX_EVIDENCE_BATCH_REQUESTS = 100;

export type EvidenceBatchRequest =
  | { id?: string; operation: "search"; query?: EvidenceSearchQuery }
  | { id?: string; operation: "view"; evidenceId: string }
  /**
   * Render the first evidence matching a search query. A batch cannot consume an ID returned by an
   * earlier request in the same batch, so this is how a caller views a fact it has just described
   * with search parameters without paying a second round trip.
   */
  | { id?: string; operation: "view"; query: EvidenceSearchQuery }
  | { id?: string; operation: "window"; query: EvidenceWindowQuery };

export type EvidenceBatchResultItem =
  | { id?: string; operation: "search"; result: EvidenceSearchResult }
  | {
    id?: string;
    operation: "view";
    result: Evidence;
    /** Matches the query produced, before the first one was selected. Absent for an ID lookup. */
    matchCount?: number;
  }
  | { id?: string; operation: "window"; result: EvidenceWindow };

export type EvidenceBatchResult = {
  schemaVersion: typeof EVIDENCE_BATCH_SCHEMA_VERSION;
  results: EvidenceBatchResultItem[];
};

function evidenceById(inspection: InspectionResult, evidenceId: string): Evidence {
  const evidence = inspection.evidence.find((item) => item.id === evidenceId);
  if (evidence === undefined) throw new Error(`Unknown evidence ID: ${evidenceId}`);
  return evidence;
}

/**
 * Resolve the first evidence matching a query. An empty result is an error rather than an empty
 * view: the caller asked for a specific fact, and silently answering with nothing would hide that
 * the query described no record. The returned match count reports how many matched, so a caller can
 * tell a unique hit from an arbitrary first pick.
 */
function evidenceByQuery(
  inspection: InspectionResult,
  query: EvidenceSearchQuery,
): { evidence: Evidence; matchCount: number } {
  const matches = searchEvidence(inspection, query);
  const first = matches.evidence[0];
  if (first === undefined) {
    throw new Error("View query matched no evidence.");
  }
  const evidence = inspection.evidence.find((item) => item.id === first.id);
  if (evidence === undefined) throw new Error(`Unknown evidence ID: ${first.id}`);
  return { evidence, matchCount: matches.totalMatches };
}

export async function queryEvidenceBatch(
  inspection: InspectionResult,
  requests: readonly EvidenceBatchRequest[],
): Promise<EvidenceBatchResult> {
  if (requests.length < 1 || requests.length > MAX_EVIDENCE_BATCH_REQUESTS) {
    throw new Error(`batch requires 1 through ${MAX_EVIDENCE_BATCH_REQUESTS} requests.`);
  }
  const results = await Promise.all(requests.map(async (request): Promise<EvidenceBatchResultItem> => {
    const identity = request.id === undefined ? {} : { id: request.id };
    switch (request.operation) {
      case "search":
        return {
          ...identity,
          operation: "search",
          result: searchEvidence(inspection, request.query),
        };
      case "view": {
        if ("evidenceId" in request) {
          return {
            ...identity,
            operation: "view",
            result: evidenceById(inspection, request.evidenceId),
          };
        }
        const resolved = evidenceByQuery(inspection, request.query);
        return {
          ...identity,
          operation: "view",
          result: resolved.evidence,
          matchCount: resolved.matchCount,
        };
      }
      case "window":
        return {
          ...identity,
          operation: "window",
          result: await queryEvidenceWindow(inspection, request.query),
        };
    }
  }));
  return { schemaVersion: EVIDENCE_BATCH_SCHEMA_VERSION, results };
}
