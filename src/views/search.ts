import type { EvidenceSearchResult } from "../evidence/index.js";

export type EvidenceSearchFormat = "json" | "text";

export function renderEvidenceSearch(result: EvidenceSearchResult, format: EvidenceSearchFormat = "json"): string {
  if (format === "json") return JSON.stringify(result, null, 2);
  const lines = [
    "Evidence search",
    `Matches: ${result.returned} returned / ${result.totalMatches} total${result.truncated ? " (truncated)" : ""}`,
  ];
  for (const evidence of result.evidence) {
    const location = evidence.source.line === undefined
      ? evidence.source.path
      : `${evidence.source.path}:${evidence.source.line}`;
    lines.push(`- ${evidence.id} [${evidence.kind}] ${evidence.summary} (${location})`);
  }
  if (result.evidence.length === 0) lines.push("- No matching evidence records");
  return lines.join("\n");
}
