import type { EvidenceWindow } from "../evidence/index.js";

export type EvidenceWindowFormat = "json" | "text";

export function renderEvidenceWindow(
  window: EvidenceWindow,
  format: EvidenceWindowFormat = "json",
): string {
  if (format === "json") return JSON.stringify(window, null, 2);
  return [
    "Evidence window",
    `Evidence: ${window.evidenceId ?? "not specified"}`,
    `Artifact: ${window.artifactId} (${window.path})`,
    `Lines: ${window.startLine}-${window.endLine}${window.truncated ? " (truncated)" : ""}`,
    "",
    window.text,
  ].join("\n");
}
