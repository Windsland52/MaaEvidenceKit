import { expect, test } from "vitest";

import {
  EVIDENCE_SCHEMA_VERSION,
  boundInspection,
  evidenceRecordContribution,
  isInspectionResult,
  measureReportBytes,
  type Artifact,
  type Evidence,
  type InspectionResult,
} from "../../src/index.js";

const artifact: Artifact = {
  id: "artifact-1",
  path: "C:/materials/maafw.log",
  relativePath: "maafw.log",
  kind: "maa_log",
  status: "selected",
};

function record(id: string, kind: string, data: unknown, padding: string): Evidence {
  return {
    id,
    kind,
    summary: `Record ${id} ${padding}`,
    source: { artifactId: artifact.id, path: artifact.relativePath, line: 1 },
    data,
  };
}

function inspection(details: Record<string, unknown> = {}): InspectionResult {
  const evidence: Evidence[] = [
    record("evidence-failure-1", "mla.failure", { status: "failed" }, "x".repeat(200)),
    record("evidence-session-1", "mla.session", { frameworkVersion: "v5.12.2" }, "x".repeat(200)),
    record("evidence-task-1", "mla.task", { name: "Combat" }, "x".repeat(200)),
  ];
  for (let index = 0; index < 20; index += 1) {
    evidence.push(record(`evidence-recognition-${index}`, "mla.recognition_detail", {
      algorithm: "TemplateMatch",
      bestTruncated: false,
    }, "y".repeat(600)));
  }
  for (let index = 0; index < 10; index += 1) {
    evidence.push(record(`evidence-action-${index}`, "mla.action_detail", {
      status: index === 0 ? "failed" : "succeeded",
    }, "z".repeat(300)));
  }
  for (let index = 0; index < 5; index += 1) {
    evidence.push(record(`evidence-override-${index}`, "mla.pipeline_override", {
      taskAssociation: index === 0 ? "task_id" : "none",
    }, "o".repeat(200)));
  }
  evidence.push(record("evidence-signal-repeat", "mla.signal", { kind: "repeated_node" }, "r".repeat(200)));
  for (let index = 0; index < 5; index += 1) {
    evidence.push(record(`evidence-signal-activity-${index}`, "mla.signal", {
      kind: "recognition_activity",
    }, "a".repeat(200)));
  }

  return {
    schemaVersion: EVIDENCE_SCHEMA_VERSION,
    kind: "mla",
    generatedAt: "2026-09-01T00:00:00.000Z",
    input: { path: "C:/materials" },
    artifacts: [artifact],
    evidence,
    missingEvidence: [],
    warnings: [],
    statistics: { evidence: evidence.length },
    details: {
      runtime: {
        signals: Array.from({ length: 5 }, (_, index) => ({ signal_id: `signal-${index}`, padding: "s".repeat(400) })),
        sessions: [],
        unscoped_tasks: [],
        failures: [],
        outcomes: [],
        warnings: [],
      },
      taskTimelines: Array.from({ length: 5 }, (_, index) => ({ name: `task-${index}`, entries: [] })),
      mirrorGroups: Array.from({ length: 3 }, () => ({ artifactIds: [artifact.id] })),
      selection: { signals: { mode: "focused", total: 5, selected: 5 } },
      ...details,
    },
  };
}

function jsonBytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value, null, 2), "utf8");
}

test("measures the same rendering the JSON view writes", () => {
  const result = inspection();
  expect(measureReportBytes(result)).toBe(jsonBytes(result));
});

test("record contributions add up to the measured difference for a whole kind", () => {
  const result = inspection();
  const kind = "mla.recognition_detail";
  const records = result.evidence.filter((item) => item.kind === kind);
  const emptied: InspectionResult = {
    ...result,
    evidence: result.evidence.filter((item) => item.kind !== kind),
  };
  const measured = measureReportBytes(result) - measureReportBytes(emptied);
  const predicted = records.reduce((sum, item) => sum + evidenceRecordContribution(item), 0);
  expect(predicted).toBe(measured);

  // A subset prediction is exact too, which is what the thinning step relies on.
  const half = records.slice(0, 7);
  const subset: InspectionResult = {
    ...result,
    evidence: [...result.evidence.filter((item) => item.kind !== kind), ...half],
  };
  const subsetPredicted = measureReportBytes(emptied)
    + half.reduce((sum, item) => sum + evidenceRecordContribution(item), 0);
  expect(subsetPredicted).toBe(measureReportBytes(subset));
});

test("a budget the report already fits returns it untouched, byte for byte", () => {
  const result = inspection();
  const budget = measureReportBytes(result) + 1;

  const bound = boundInspection(result, budget);

  expect(bound.result).toBe(result);
  expect(bound.reduction).toBeUndefined();
  expect(measureReportBytes(bound.result)).toBe(measureReportBytes(result));
});

test("an oversized report loses whole entries in ladder order and keeps protected evidence", () => {
  const result = inspection();
  const budget = 5000;
  const bound = boundInspection(result, budget);

  expect(bound.reduction).toBeDefined();
  expect(bound.reduction?.maxBytes).toBe(budget);
  expect(bound.reduction?.actualBytes).toBe(measureReportBytes(bound.result));
  expect(bound.reduction?.actualBytes).toBeLessThanOrEqual(budget);
  // The first ladder step is the duplicated details projection.
  expect(bound.reduction?.steps[0]?.id).toBe("details.runtime.signals");
  expect(bound.reduction?.dropped.items).toBe(
    bound.reduction?.steps.reduce((total, step) => total + step.removedItems, 0),
  );
  expect(bound.reduction?.dropped.bytes).toBe(
    bound.reduction?.steps.reduce((total, step) => total + step.removedBytes, 0),
  );
  // details.runtime.signals is emptied before any evidence is thinned.
  const details = bound.result.details as { runtime: { signals: unknown[] } };
  expect(details.runtime.signals).toEqual([]);

  const keptIds = new Set(bound.result.evidence.map((item) => item.id));
  for (const protectedId of ["evidence-failure-1", "evidence-session-1", "evidence-task-1", "evidence-signal-repeat"]) {
    expect(keptIds.has(protectedId)).toBe(true);
  }
  // Everything that remains is a verbatim subset of the original, in the original order.
  const originals = new Map(result.evidence.map((item) => [item.id, item]));
  const keptOrder = bound.result.evidence.map((item) => item.id);
  expect(keptOrder).toEqual(result.evidence.map((item) => item.id).filter((id) => keptIds.has(id)));
  for (const item of bound.result.evidence) {
    expect(item).toEqual(originals.get(item.id));
  }
  // The result stays a valid inspection document.
  expect(isInspectionResult(bound.result)).toBe(true);
  // The input object is never mutated.
  expect(result.reduction).toBeUndefined();
});

test("a budget the protected set cannot satisfy is reported instead of silently dropping evidence", () => {
  const result = inspection();
  const bound = boundInspection(result, 100);

  expect(bound.reduction?.budgetUnsatisfied).toBe(true);
  const keptIds = bound.result.evidence.map((item) => item.id);
  expect(keptIds).toContain("evidence-failure-1");
  expect(keptIds).toContain("evidence-signal-repeat");
  // Only the unprotected evidence was removed.
  expect(keptIds.every((id) => !id.startsWith("evidence-recognition-"))).toBe(true);
  expect(isInspectionResult(bound.result)).toBe(true);
});

test("thins the MLA half of a combined report without touching the MSE half", () => {
  const combined: InspectionResult = {
    ...inspection(),
    kind: "combined",
    details: {
      mla: {
        runtime: {
          signals: Array.from({ length: 3 }, (_, index) => ({
            signal_id: `signal-${index}`,
            padding: "s".repeat(4000),
          })),
        },
        taskTimelines: [{ name: "task-1", entries: [] }],
      },
      mse: { projects: [{ path: "C:/project" }], staticDiagnostics: [] },
    },
  };

  const bound = boundInspection(combined, 8000);

  expect(bound.reduction).toBeDefined();
  expect(bound.reduction?.steps[0]?.id).toBe("details.runtime.signals");
  const details = bound.result.details as {
    mla: { runtime: { signals: unknown[] } };
    mse: { projects: unknown[] };
  };
  expect(details.mla.runtime.signals).toEqual([]);
  expect(details.mse.projects).toEqual([{ path: "C:/project" }]);
});
