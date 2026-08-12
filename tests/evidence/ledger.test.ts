import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, test } from "vitest";

import {
  EVIDENCE_SCHEMA_VERSION,
  EvidenceLedger,
  artifactId,
  queryEvidenceWindow,
  type InspectionResult,
} from "../../src/index.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("evidence ledger", () => {
  test("generates stable IDs and deduplicates identical evidence", () => {
    const first = new EvidenceLedger();
    const second = new EvidenceLedger();
    const source = { artifactId: "artifact-a", path: "maafw.log", line: 2 };
    const left = first.add("mla.session", "session", source, { version: "v5.12.2" });
    const duplicate = first.add("mla.session", "changed display text", source, { version: "v5.12.2" });
    const right = second.add("mla.session", "session", source, { version: "v5.12.2" });

    expect(duplicate.id).toBe(left.id);
    expect(right.id).toBe(left.id);
    expect(first.values()).toHaveLength(1);
    expect(artifactId("debug\\maafw.log")).toBe(artifactId("debug/maafw.log"));
    expect(artifactId("logs/MAA.log")).not.toBe(artifactId("logs/maa.log"));
  });

  test("reads a bounded source window only from an inventoried artifact", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "mek-window-"));
    temporaryRoots.push(root);
    await mkdir(root, { recursive: true });
    const file = path.join(root, "maafw.log");
    await writeFile(file, ["one", "two", "three", "four", "five"].join("\n"), "utf8");
    const artifact = {
      id: artifactId("maafw.log"),
      path: file,
      relativePath: "maafw.log",
      kind: "maa_log" as const,
      status: "selected" as const,
    };
    const result: InspectionResult = {
      schemaVersion: EVIDENCE_SCHEMA_VERSION,
      kind: "mla",
      generatedAt: new Date(0).toISOString(),
      input: { path: root },
      artifacts: [artifact],
      evidence: [{
        id: "evidence-line-three",
        kind: "test",
        summary: "line three",
        source: { artifactId: artifact.id, path: artifact.relativePath, line: 3 },
        data: {},
      }],
      missingEvidence: [],
      warnings: [],
      statistics: {},
      details: {},
    };

    const window = await queryEvidenceWindow(result, {
      evidenceId: "evidence-line-three",
      before: 1,
      after: 1,
    });

    expect(window.startLine).toBe(2);
    expect(window.endLine).toBe(4);
    expect(window.text).toBe("2: two\n3: three\n4: four");
    await expect(queryEvidenceWindow(result, { artifactId: "unknown" })).rejects.toThrow(
      "Unknown artifact ID",
    );
    const skipped: InspectionResult = {
      ...result,
      artifacts: [{ ...artifact, status: "skipped", reason: "not_authorized" }],
    };
    await expect(queryEvidenceWindow(skipped, { artifactId: artifact.id })).rejects.toThrow(
      "authorized readable artifact",
    );
  });
});
