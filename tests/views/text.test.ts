import { expect, test } from "vitest";

import { EVIDENCE_SCHEMA_VERSION, renderText, type Evidence, type InspectionResult } from "../../src/index.js";

function evidence(index: number, kind: string, priority?: "high" | "normal" | "low"): Evidence {
  return {
    id: `evidence-${index}`,
    kind,
    summary: `Evidence ${index}`,
    source: { artifactId: "artifact-1", path: "maafw.log", line: index + 1 },
    data: priority === undefined ? {} : { priority },
  };
}

test("keeps high-priority runtime signals in the bounded text evidence view", () => {
  const result: InspectionResult = {
    schemaVersion: EVIDENCE_SCHEMA_VERSION,
    kind: "combined",
    generatedAt: "2026-08-03T00:00:00.000Z",
    input: { path: "C:/materials" },
    artifacts: [],
    evidence: [
      ...Array.from({ length: 200 }, (_, index) => evidence(index, "mla.task")),
      evidence(200, "mla.signal", "high"),
    ],
    missingEvidence: [],
    warnings: [],
    statistics: {},
    details: {},
  };

  const text = renderText(result);

  expect(text).toContain("evidence-200 [mla.signal]");
  expect(text).not.toContain("evidence-199 [mla.task]");
});
