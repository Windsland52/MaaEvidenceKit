import { expect, test } from "vitest";

import {
  EVIDENCE_SCHEMA_VERSION,
  INSPECTION_SUMMARY_SCHEMA_VERSION,
  renderInspectionSummary,
  summarizeInspection,
  type InspectionResult,
} from "../../src/index.js";

function result(): InspectionResult {
  return {
    schemaVersion: EVIDENCE_SCHEMA_VERSION,
    kind: "mla",
    generatedAt: "2026-09-01T00:00:00.000Z",
    input: { path: "C:/materials", timeRange: { from: "2026-09-01T20:12:00.000Z" } },
    artifacts: [
      {
        id: "artifact-1",
        path: "C:/materials/maafw.log",
        relativePath: "maafw.log",
        kind: "maa_log",
        status: "selected",
      },
      {
        id: "artifact-2",
        path: "C:/materials/custom/2026-09-01.log",
        relativePath: "custom/2026-09-01.log",
        kind: "log",
        status: "available",
      },
    ],
    evidence: [
      {
        id: "evidence-1",
        kind: "mla.action_detail",
        summary: "Action EatCandyStart succeeded (Click) x1.",
        source: { artifactId: "artifact-1", path: "maafw.log", line: 10 },
        data: {},
      },
      {
        id: "evidence-2",
        kind: "mla.action_detail",
        summary: "Action EatCandyStart succeeded (Click) x2.",
        source: { artifactId: "artifact-1", path: "maafw.log", line: 20 },
        data: {},
      },
      {
        id: "evidence-3",
        kind: "mla.pipeline_override",
        summary: "Observed task submission pipeline override for 7 nodes.",
        source: { artifactId: "artifact-1", path: "maafw.log", line: 30 },
        data: {},
      },
      {
        id: "evidence-4",
        kind: "mla.task_anomaly",
        summary: "Task Combat succeeded with anomalies: all_evaluations_failed.",
        source: { artifactId: "artifact-1", path: "maafw.log", line: 40 },
        data: {},
      },
      {
        id: "evidence-5",
        kind: "mla.outcome",
        summary: "Task Combat was failed.",
        source: { artifactId: "artifact-1", path: "maafw.log", line: 50 },
        data: { status: "failed" },
      },
      {
        id: "evidence-6",
        kind: "mla.outcome",
        summary: "Task Collect was success.",
        source: { artifactId: "artifact-1", path: "maafw.log", line: 60 },
        data: { status: "success" },
      },
      {
        id: "evidence-7",
        kind: "mla.signal",
        summary: "Observed repeated node sequence Move → Eat.",
        source: { artifactId: "artifact-1", path: "maafw.log", line: 70 },
        data: { kind: "repeated_node" },
      },
      {
        id: "evidence-8",
        kind: "mla.signal",
        summary: "Recognition activity for node Eat.",
        source: { artifactId: "artifact-1", path: "maafw.log", line: 80 },
        data: { kind: "recognition_activity" },
      },
      {
        id: "evidence-9",
        kind: "mla.failure",
        summary: "Node Eat failed.",
        source: { artifactId: "artifact-1", path: "maafw.log", line: 90 },
        data: {},
      },
      {
        id: "evidence-10",
        kind: "mla.failure_context",
        summary: "Failure context for node Eat.",
        source: { artifactId: "artifact-1", path: "maafw.log", line: 91 },
        data: {},
      },
    ],
    missingEvidence: [],
    warnings: [{ code: "mla_signals_focused", message: "Selected 403 of 935 runtime signals." }],
    statistics: { scannedFiles: 15, evidence: 3 },
    details: { enormous: "x".repeat(10_000) },
  };
}

test("reduces an inspection to bounded summary blocks with the available evidence kinds", () => {
  const summary = summarizeInspection(result());

  expect(summary.schemaVersion).toBe(INSPECTION_SUMMARY_SCHEMA_VERSION);
  expect(summary.evidenceCount).toBe(10);
  expect(summary.evidenceKinds).toEqual([
    { kind: "mla.action_detail", count: 2 },
    { kind: "mla.failure", count: 1 },
    { kind: "mla.failure_context", count: 1 },
    { kind: "mla.outcome", count: 2 },
    { kind: "mla.pipeline_override", count: 1 },
    { kind: "mla.signal", count: 2 },
    { kind: "mla.task_anomaly", count: 1 },
  ]);
  expect(summary.artifacts).toHaveLength(2);
  expect(summary.warnings).toHaveLength(1);
  expect(summary).not.toHaveProperty("evidence");
  expect(summary).not.toHaveProperty("details");
});

test("keeps the rendered summary far smaller than the full inspection document", () => {
  const inspection = result();
  const summary = renderInspectionSummary(inspection, "json");

  expect(summary.length).toBeLessThan(JSON.stringify(inspection).length);
  expect(summary).not.toContain("enormous");
  expect(JSON.parse(summary)).toMatchObject({ evidenceCount: 10 });
});

test("renders a text summary that names artifacts, evidence kinds, and warnings", () => {
  const text = renderInspectionSummary(result(), "text");

  expect(text).toContain("MaaEvidenceKit mla inspection summary");
  expect(text).toContain("Artifacts: 1 selected / 2 reported");
  expect(text).toContain("artifact-2 [log/available] custom/2026-09-01.log");
  expect(text).toContain("- mla.pipeline_override: 1");
  expect(text).toContain("Notable evidence:");
  expect(text).toContain("- mla.failure_context: 1");
  expect(text).toContain("  - evidence-10: Failure context for node Eat.");
  expect(text).toContain("- mla.failure: 1");
  expect(text).toContain("  - evidence-9: Node Eat failed.");
  expect(text).toContain("- mla.outcome: 2");
  expect(text).toContain("  - evidence-5: Task Combat was failed.");
  expect(text).toContain("- mla.signal: 1");
  expect(text).toContain("[mla_signals_focused]");
});

test("embeds identities for notable evidence with failures first and a bounded list", () => {
  const summary = summarizeInspection(result());
  expect(summary.notableEvidence.map((entry) => entry.kind)).toEqual([
    "mla.failure_context",
    "mla.failure",
    "mla.task_anomaly",
    "mla.outcome",
    "mla.signal",
  ]);
  expect(summary.notableEvidence.find((entry) => entry.kind === "mla.failure_context")).toEqual({
    kind: "mla.failure_context",
    total: 1,
    omitted: 0,
    identities: [{ id: "evidence-10", summary: "Failure context for node Eat." }],
  });
  expect(summary.notableEvidence.find((entry) => entry.kind === "mla.failure")).toEqual({
    kind: "mla.failure",
    total: 1,
    omitted: 0,
    identities: [{ id: "evidence-9", summary: "Node Eat failed." }],
  });
  const outcome = summary.notableEvidence.find((entry) => entry.kind === "mla.outcome");
  expect(outcome).toEqual({
    kind: "mla.outcome",
    total: 2,
    omitted: 0,
    identities: [
      { id: "evidence-5", summary: "Task Combat was failed." },
      { id: "evidence-6", summary: "Task Collect was success." },
    ],
  });
  expect(summary.notableEvidence.find((entry) => entry.kind === "mla.signal")).toEqual({
    kind: "mla.signal",
    total: 1,
    omitted: 0,
    identities: [{ id: "evidence-7", summary: "Observed repeated node sequence Move → Eat." }],
  });
  expect(summary.notableEvidence.find((entry) => entry.kind === "mla.task_anomaly")).toEqual({
    kind: "mla.task_anomaly",
    total: 1,
    omitted: 0,
    identities: [
      { id: "evidence-4", summary: "Task Combat succeeded with anomalies: all_evaluations_failed." },
    ],
  });
});

test("caps notable identities at ten and reports the omitted remainder", () => {
  const base = result();
  const inspection: InspectionResult = {
    ...base,
    evidence: Array.from({ length: 12 }, (_, index) => ({
      id: `outcome-${index + 1}`,
      kind: "mla.outcome",
      summary: `Task T${index + 1} was failed.`,
      source: { artifactId: "artifact-1", path: "maafw.log", line: index + 1 },
      data: { status: "failed" },
    })),
  };

  const summary = summarizeInspection(inspection);
  const outcome = summary.notableEvidence.find((entry) => entry.kind === "mla.outcome");
  expect(outcome?.total).toBe(12);
  expect(outcome?.identities).toHaveLength(10);
  expect(outcome?.omitted).toBe(2);
  expect(outcome?.identities[0]).toEqual({ id: "outcome-1", summary: "Task T1 was failed." });
});
