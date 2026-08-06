import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, expect, test } from "vitest";

import {
  EVIDENCE_SCHEMA_VERSION,
  artifactId,
  queryEvidenceBatch,
  type InspectionResult,
} from "../../src/index.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

test("runs search, view, and window requests against one inspection in request order", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "mek-batch-"));
  temporaryRoots.push(root);
  const file = path.join(root, "maafw.log");
  await writeFile(file, ["one", "observed NEW", "three"].join("\n"), "utf8");
  const artifact = {
    id: artifactId("maafw.log"),
    path: file,
    relativePath: "maafw.log",
    kind: "maa_log" as const,
    status: "selected" as const,
  };
  const inspection: InspectionResult = {
    schemaVersion: EVIDENCE_SCHEMA_VERSION,
    kind: "mla",
    generatedAt: "2026-08-06T00:00:00.000Z",
    input: { path: root },
    artifacts: [artifact],
    evidence: [{
      id: "evidence-ocr",
      kind: "mla.recognition_detail",
      summary: "OCR observation",
      source: { artifactId: artifact.id, path: artifact.relativePath, line: 2, node: "Reward" },
      data: { best: { text: "NEW", score: 0.92 } },
    }],
    missingEvidence: [],
    warnings: [],
    statistics: {},
    details: {},
  };

  const batch = await queryEvidenceBatch(inspection, [
    { id: "find", operation: "search", query: { nodes: ["Reward"] } },
    { id: "fact", operation: "view", evidenceId: "evidence-ocr" },
    { id: "context", operation: "window", query: { evidenceId: "evidence-ocr", before: 1, after: 1 } },
  ]);

  expect(batch.schemaVersion).toBe("maa-evidence-batch/v1");
  expect(batch.results.map((item) => [item.id, item.operation])).toEqual([
    ["find", "search"],
    ["fact", "view"],
    ["context", "window"],
  ]);
  expect(batch.results[0]?.result).toMatchObject({ totalMatches: 1, returned: 1 });
  expect(batch.results[1]?.result).toMatchObject({ id: "evidence-ocr", data: { best: { text: "NEW" } } });
  expect(batch.results[2]?.result).toMatchObject({ startLine: 1, endLine: 3 });
});

test("rejects empty, oversized, and unresolved batches", async () => {
  const inspection: InspectionResult = {
    schemaVersion: EVIDENCE_SCHEMA_VERSION,
    kind: "mla",
    generatedAt: "2026-08-06T00:00:00.000Z",
    input: { path: "C:/logs" },
    artifacts: [],
    evidence: [],
    missingEvidence: [],
    warnings: [],
    statistics: {},
    details: {},
  };

  await expect(queryEvidenceBatch(inspection, [])).rejects.toThrow("1 through 100");
  await expect(queryEvidenceBatch(
    inspection,
    Array.from({ length: 101 }, () => ({ operation: "search" as const })),
  )).rejects.toThrow("1 through 100");
  await expect(queryEvidenceBatch(inspection, [
    { operation: "view", evidenceId: "evidence-missing" },
  ])).rejects.toThrow("Unknown evidence ID");
});
