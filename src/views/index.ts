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
export {
  VIEW_DEFAULT_MAX_CHARACTERS,
  VIEW_DEFAULT_MAX_LINES,
  VIEW_MAX_CHARACTERS,
  VIEW_MAX_LINES,
  boundText,
  budgetInteger,
  type BoundedText,
  type TextBudget,
} from "./bounds.js";
export { renderJson } from "./json.js";
export { parseFields, selectFields } from "./select.js";
export { renderMermaid } from "./mermaid.js";
export { renderEvidenceSearch, type EvidenceSearchFormat } from "./search.js";
export {
  INSPECTION_SUMMARY_SCHEMA_VERSION,
  renderInspectionSummary,
  summarizeInspection,
  type InspectionEvidenceKindCount,
  type InspectionSummary,
  type SummaryFormat,
} from "./summary.js";
export { renderText } from "./text.js";
export {
  TASK_TIMELINE_SCHEMA_VERSION,
  renderTaskTimeline,
  taskTimeline,
  type TaskTimelineEntry,
  type TaskTimelineEvent,
  type TaskTimelineFormat,
  type TaskTimelineOptions,
  type TaskTimelineTask,
  type TaskTimelineView,
} from "./timeline.js";
export { renderEvidenceWindow, type EvidenceWindowFormat } from "./window.js";
