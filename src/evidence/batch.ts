import { searchEvidence, type EvidenceSearchQuery, type EvidenceSearchResult } from "./search.js";
import type { Evidence, InspectionResult } from "./types.js";
import { queryEvidenceWindow, type EvidenceWindow, type EvidenceWindowQuery } from "./window.js";

export const EVIDENCE_BATCH_SCHEMA_VERSION = "maa-evidence-batch/v1" as const;

export const MAX_EVIDENCE_BATCH_REQUESTS = 100;

export type EvidenceBatchRequest =
  | { id?: string; operation: "search"; query?: EvidenceSearchQuery }
  | { id?: string; operation: "view"; evidenceId: string }
  | { id?: string; operation: "window"; query: EvidenceWindowQuery };

export type EvidenceBatchResultItem =
  | { id?: string; operation: "search"; result: EvidenceSearchResult }
  | { id?: string; operation: "view"; result: Evidence }
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
      case "view":
        return {
          ...identity,
          operation: "view",
          result: evidenceById(inspection, request.evidenceId),
        };
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
