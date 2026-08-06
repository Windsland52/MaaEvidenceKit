import type { Evidence } from "../evidence/index.js";

export type EvidenceViewFormat = "json" | "text";

function sourceLocation(evidence: Evidence): string {
  const source = evidence.source;
  const line = source.line === undefined
    ? ""
    : source.endLine === undefined ? `:${source.line}` : `:${source.line}-${source.endLine}`;
  const qualifiers = [
    source.timestamp === undefined ? undefined : `timestamp=${source.timestamp}`,
    source.task === undefined ? undefined : `task=${source.task}`,
    source.node === undefined ? undefined : `node=${source.node}`,
  ].filter((value): value is string => value !== undefined);
  return `${source.path}${line}${qualifiers.length === 0 ? "" : ` (${qualifiers.join(", ")})`}`;
}

export function renderEvidence(evidence: Evidence, format: EvidenceViewFormat = "json"): string {
  if (format === "json") return JSON.stringify(evidence, null, 2);
  const data = JSON.stringify(evidence.data, null, 2) ?? "undefined";
  return [
    "Evidence",
    `ID: ${evidence.id}`,
    `Kind: ${evidence.kind}`,
    `Summary: ${evidence.summary}`,
    `Source: ${sourceLocation(evidence)}`,
    "Data:",
    data,
  ].join("\n");
}

export function evidenceById(
  records: readonly Evidence[],
  evidenceId: string,
): Evidence {
  const record = records.find((item) => item.id === evidenceId);
  if (record === undefined) throw new Error(`Unknown evidence ID: ${evidenceId}`);
  return record;
}
