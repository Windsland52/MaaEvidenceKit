import { expect, test } from "vitest";

import {
  EVIDENCE_SCHEMA_VERSION,
  MAX_FIELD_TRUNCATION_FIELDS,
  buildCompleteness,
  isInspectionResult,
  summarizeFieldTruncation,
  type Evidence,
} from "../../src/index.js";

function evidence(data: unknown): Evidence {
  return {
    id: "evidence-1",
    kind: "mla.recognition_detail",
    summary: "One recognition record.",
    source: { artifactId: "artifact-1", path: "maafw.log", line: 1 },
    data,
  };
}

const emptyDimensions = {
  signals: { mode: "complete" as const, selected: 0, total: 0 },
  actionDetails: { selected: 0, total: 0 },
  pipelineOverrides: { selected: 0, total: 0 },
};

test("derives each dimension's mode and downgraded flag from selected and total", () => {
  const completeness = buildCompleteness({
    signals: { mode: "focused", selected: 348, total: 1936 },
    actionDetails: { selected: 500, total: 4319 },
    pipelineOverrides: { selected: 866, total: 866 },
    evidence: [],
  });

  expect(completeness).toEqual({
    signals: { mode: "focused", selected: 348, total: 1936, downgraded: true },
    actionDetails: { mode: "sampled", selected: 500, total: 4319, downgraded: true },
    pipelineOverrides: { mode: "complete", selected: 866, total: 866, downgraded: false },
    fieldTruncation: { any: false, total: 0, byField: [], omitted: 0 },
    anyDowngraded: true,
  });
});

test("a complete report says complete in every dimension and is not downgraded", () => {
  const completeness = buildCompleteness({
    signals: { mode: "complete", selected: 5, total: 5 },
    actionDetails: { selected: 2, total: 2 },
    pipelineOverrides: { selected: 1, total: 1 },
    evidence: [],
  });

  expect(completeness.signals.mode).toBe("complete");
  expect(completeness.actionDetails.mode).toBe("complete");
  expect(completeness.pipelineOverrides.mode).toBe("complete");
  expect(completeness.anyDowngraded).toBe(false);
  expect(completeness.fieldTruncation.any).toBe(false);
});

test("counts record-level *Truncated booleans at any depth and ignores other values", () => {
  const summary = summarizeFieldTruncation([
    evidence({
      bestTruncated: true,
      patchPathsTruncated: false,
      samplesTruncated: true,
      // `truncated` does not end in "Truncated" and a non-boolean value is not a flag.
      textCountSummary: { truncated: true },
      weirdTruncated: "yes",
      candidateStages: [{ bestTruncated: false }, { bestTruncated: true }],
    }),
  ]);

  expect(summary).toEqual({
    any: true,
    total: 5,
    byField: [
      { field: "bestTruncated", total: 3, truncatedTrue: 2 },
      { field: "patchPathsTruncated", total: 1, truncatedTrue: 0 },
      { field: "samplesTruncated", total: 1, truncatedTrue: 1 },
    ],
    omitted: 0,
  });
});

test("bounds the per-field list and counts the fields it omits", () => {
  const data: Record<string, unknown> = {};
  for (let index = 0; index < 12; index += 1) {
    data[`field${String(index).padStart(2, "0")}Truncated`] = false;
  }

  const summary = summarizeFieldTruncation([evidence(data)]);

  expect(summary.total).toBe(12);
  expect(summary.byField).toHaveLength(MAX_FIELD_TRUNCATION_FIELDS);
  expect(summary.omitted).toBe(2);
  expect(summary.any).toBe(false);
  // Equal counts sort by field name, so the listing is deterministic.
  expect(summary.byField[0]?.field).toBe("field00Truncated");
  expect(summary.byField[9]?.field).toBe("field09Truncated");
});

test("a report saved before the completeness block stays a valid inspection", () => {
  const legacy = {
    schemaVersion: EVIDENCE_SCHEMA_VERSION,
    kind: "mla",
    generatedAt: "2026-09-01T00:00:00.000Z",
    input: { path: "C:/materials" },
    artifacts: [],
    evidence: [],
    missingEvidence: [],
    warnings: [],
    statistics: {},
    details: {},
  };

  expect(isInspectionResult(legacy)).toBe(true);
  // The optional field is not required for validity.
  expect("completeness" in legacy).toBe(false);
  expect(buildCompleteness({ ...emptyDimensions, evidence: [] }).anyDowngraded).toBe(false);
});
