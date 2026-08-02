import type { InspectionResult } from "../evidence/index.js";

export function renderJson(result: InspectionResult, pretty = true): string {
  return JSON.stringify(result, null, pretty ? 2 : 0);
}
