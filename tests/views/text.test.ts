import { expect, test } from "vitest";

import {
  EVIDENCE_SCHEMA_VERSION,
  renderEvidence,
  renderEvidenceSearch,
  renderEvidenceWindow,
  renderText,
  type Evidence,
  type EvidenceWindow,
  type EvidenceSearchResult,
  type InspectionResult,
} from "../../src/index.js";

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

test("renders one evidence record with its complete deterministic data", () => {
  const item = evidence(1, "mla.recognition_detail");
  item.data = { text: "NEW", score: 0.91 };

  const text = renderEvidence(item, "text");
  expect(text).toContain("ID: evidence-1");
  expect(text).toContain("Source: maafw.log:2");
  expect(text).toContain('"text": "NEW"');
  expect(JSON.parse(renderEvidence(item, "json"))).toEqual(item);
});

test("renders an evidence window as text without changing its JSON shape", () => {
  const window: EvidenceWindow = {
    schemaVersion: "maa-evidence-window/v1",
    artifactId: "artifact-1",
    path: "maafw.log",
    evidenceId: "evidence-1",
    startLine: 1,
    endLine: 2,
    text: "1: first\n2: second",
    truncated: false,
  };

  expect(renderEvidenceWindow(window, "text")).toContain("Lines: 1-2");
  expect(JSON.parse(renderEvidenceWindow(window, "json"))).toEqual(window);
});

test("renders a bounded evidence search index as text", () => {
  const result: EvidenceSearchResult = {
    schemaVersion: "maa-evidence-search/v1",
    query: { kinds: ["mla.recognition_detail"], limit: 20 },
    totalMatches: 2,
    returned: 1,
    truncated: true,
    evidence: [{
      id: "evidence-1",
      kind: "mla.recognition_detail",
      summary: "OCR observation",
      source: { artifactId: "artifact-1", path: "maafw.log", line: 10 },
      nodeMatches: [{
        node: "NestedLeaf",
        relation: "recognition_descendant",
        path: ["NestedAnd", "NestedLeaf"],
      }],
    }],
  };

  const text = renderEvidenceSearch(result, "text");
  expect(text).toContain("1 returned / 2 total (truncated)");
  expect(text).toContain("evidence-1 [mla.recognition_detail]");
  expect(text).toContain("NestedLeaf (recognition_descendant: NestedAnd -> NestedLeaf)");
});
