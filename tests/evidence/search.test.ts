import { expect, test } from "vitest";

import {
  EVIDENCE_SCHEMA_VERSION,
  searchEvidence,
  type Evidence,
  type InspectionResult,
} from "../../src/index.js";

function inspection(evidence: Evidence[]): InspectionResult {
  return {
    schemaVersion: EVIDENCE_SCHEMA_VERSION,
    kind: "mla",
    generatedAt: "2026-08-06T00:00:00.000Z",
    input: { path: "C:/logs" },
    artifacts: [],
    evidence,
    missingEvidence: [],
    warnings: [],
    statistics: {},
    details: {},
  };
}

test("searches deterministic evidence fields and returns a bounded index", () => {
  const result = inspection([
    {
      id: "evidence-1",
      kind: "mla.recognition_detail",
      summary: "OCR observation",
      source: {
        artifactId: "artifact-1",
        path: "maafw.log",
        line: 10,
        timestamp: "2026-08-06T12:37:40.000Z",
        task: "DailyRewardStart",
        node: "DailyProtocolSwitchWeeklyMission",
      },
      data: { best: { text: "NEW", score: 0.91 } },
    },
    {
      id: "evidence-2",
      kind: "mla.recognition_detail",
      summary: "Other observation",
      source: {
        artifactId: "artifact-1",
        path: "maafw.log",
        line: 20,
        timestamp: "2026-08-06T12:40:00.000Z",
        task: "OtherTask",
        node: "OtherNode",
      },
      data: { best: { text: "claim" } },
    },
  ]);

  const search = searchEvidence(result, {
    kinds: ["mla.recognition_detail"],
    nodes: ["DailyProtocolSwitchWeeklyMission"],
    tasks: ["DailyRewardStart"],
    text: ["new", "0.91"],
    timeRange: {
      from: "2026-08-06T12:37:00.000Z",
      to: "2026-08-06T12:38:00.000Z",
    },
    limit: 1,
  });

  expect(search.totalMatches).toBe(1);
  expect(search.returned).toBe(1);
  expect(search.truncated).toBe(false);
  expect(search.evidence).toEqual([{
    id: "evidence-1",
    kind: "mla.recognition_detail",
    summary: "OCR observation",
    source: result.evidence[0]?.source,
  }]);
  expect(search.evidence[0]).not.toHaveProperty("data");
});

test("reports truncation and rejects invalid search bounds", () => {
  const result = inspection(Array.from({ length: 3 }, (_, index) => ({
    id: `evidence-${index}`,
    kind: "test",
    summary: `Evidence ${index}`,
    source: { artifactId: "artifact-1", path: "maafw.log", line: index + 1 },
    data: {},
  })));

  const search = searchEvidence(result, { limit: 2 });
  expect(search.totalMatches).toBe(3);
  expect(search.returned).toBe(2);
  expect(search.truncated).toBe(true);
  expect(() => searchEvidence(result, { limit: 501 })).toThrow("limit");
  expect(() => searchEvidence(result, { text: ["  "] })).toThrow("must not be empty");
});
