import type { InspectionResult } from "../evidence/index.js";

import { renderJson } from "./json.js";
import { renderMermaid } from "./mermaid.js";
import { renderText } from "./text.js";

export type ViewFormat = "json" | "text" | "mermaid";

export type ViewOptions = {
  format?: ViewFormat;
  pretty?: boolean;
};

export function view(result: InspectionResult, options: ViewOptions = {}): string {
  switch (options.format ?? "text") {
    case "json":
      return renderJson(result, options.pretty ?? true);
    case "text":
      return renderText(result);
    case "mermaid":
      return renderMermaid(result);
  }
}

export { evidenceById, renderEvidence, type EvidenceViewFormat } from "./evidence.js";
export { renderJson } from "./json.js";
export { renderMermaid } from "./mermaid.js";
export { renderEvidenceSearch, type EvidenceSearchFormat } from "./search.js";
export { renderText } from "./text.js";
export { renderEvidenceWindow, type EvidenceWindowFormat } from "./window.js";
