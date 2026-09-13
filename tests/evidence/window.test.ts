import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, test } from "vitest";

import {
  EVIDENCE_SCHEMA_VERSION,
  artifactId,
  queryEvidenceWindow,
  type InspectionResult,
} from "../../src/index.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const WINDOW_FIELDS = [
  "artifactId",
  "endLine",
  "path",
  "schemaVersion",
  "startLine",
  "text",
  "truncated",
];

async function inspectionFor(lines: readonly string[]): Promise<InspectionResult> {
  const root = await mkdtemp(path.join(os.tmpdir(), "mek-window-"));
  temporaryRoots.push(root);
  await mkdir(root, { recursive: true });
  const file = path.join(root, "maafw.log");
  await writeFile(file, lines.join("\n"), "utf8");
  const artifact = {
    id: artifactId("maafw.log"),
    path: file,
    relativePath: "maafw.log",
    kind: "maa_log" as const,
    status: "selected" as const,
  };
  return {
    schemaVersion: EVIDENCE_SCHEMA_VERSION,
    kind: "mla",
    generatedAt: new Date(0).toISOString(),
    input: { path: root },
    artifacts: [artifact],
    evidence: [],
    missingEvidence: [],
    warnings: [],
    statistics: {},
    details: {},
  };
}

describe("evidence window character bounds", () => {
  test("cuts the first candidate line instead of returning an inverted empty range", async () => {
    // Reported reproduction: focus line 3498 with 50 lines of context starts at line 3448,
    // whose rendered "3448: ..." line alone exceeds the 120 character budget.
    const longLine = "z".repeat(400);
    const lines = Array.from({ length: 3549 }, (_unused, index) => (
      index + 1 === 3448 ? longLine : `entry-${index + 1}`
    ));
    const inspection = await inspectionFor(lines);
    const query = {
      artifactId: artifactId("maafw.log"),
      line: 3498,
      before: 50,
      after: 50,
      maxLines: 4,
      maxCharacters: 120,
    };

    const window = await queryEvidenceWindow(inspection, query);

    expect(window.startLine).toBe(3448);
    expect(window.startLine).toBeLessThanOrEqual(window.endLine);
    expect(window.endLine).toBe(3448);
    expect(window.text.length).toBeGreaterThan(0);
    expect(window.text.length).toBeLessThanOrEqual(120);
    expect(window.truncated).toBe(true);
    // The window may shorten a rendered line, but it must never invent characters.
    expect(window.text).toBe(`3448: ${longLine}`.slice(0, window.text.length));

    // Same request, same bytes: repeated runs stay identical.
    expect(await queryEvidenceWindow(inspection, query)).toEqual(window);
  });

  test("includes several complete short lines unchanged", async () => {
    const inspection = await inspectionFor(["one", "two", "three", "four", "five"]);

    const window = await queryEvidenceWindow(inspection, {
      artifactId: artifactId("maafw.log"),
      line: 3,
      before: 1,
      after: 1,
    });

    expect(window.startLine).toBe(2);
    expect(window.endLine).toBe(4);
    expect(window.text).toBe("2: two\n3: three\n4: four");
    expect(window.truncated).toBe(false);
    expect(window.schemaVersion).toBe("maa-evidence-window/v1");
    expect(Object.keys(window).sort()).toEqual(WINDOW_FIELDS);
  });

  test("keeps a single character when the budget allows exactly one", async () => {
    const inspection = await inspectionFor(["one", "two", "three"]);

    const window = await queryEvidenceWindow(inspection, {
      artifactId: artifactId("maafw.log"),
      line: 2,
      before: 0,
      after: 2,
      maxLines: 4,
      maxCharacters: 1,
    });

    expect(window.startLine).toBe(2);
    expect(window.startLine).toBeLessThanOrEqual(window.endLine);
    expect(window.endLine).toBe(2);
    expect(window.text.length).toBeLessThanOrEqual(1);
    expect(window.text.length).toBeGreaterThan(0);
    expect(window.text).toBe("2: two".slice(0, window.text.length));
    expect(window.truncated).toBe(true);
  });

  test("drops a later non-fitting line whole once an earlier line was included", async () => {
    // "1: alpha" fits together with its separator, "2: bbb..." does not: the cut applies only
    // to the first candidate line, so the later line keeps the all-or-nothing behavior.
    const longLine = "b".repeat(100);
    const inspection = await inspectionFor(["alpha", longLine, "gamma"]);

    const window = await queryEvidenceWindow(inspection, {
      artifactId: artifactId("maafw.log"),
      line: 2,
      before: 1,
      after: 1,
      maxLines: 4,
      maxCharacters: 15,
    });

    expect(window.startLine).toBe(1);
    expect(window.endLine).toBe(1);
    expect(window.text).toBe("1: alpha");
    expect(window.truncated).toBe(true);
  });

  test("keeps the empty window when no line exists at or after requestedStart", async () => {
    const inspection = await inspectionFor(["one", "two", "three"]);

    const window = await queryEvidenceWindow(inspection, {
      artifactId: artifactId("maafw.log"),
      line: 99,
      before: 1,
      after: 1,
    });

    expect(window.startLine).toBe(98);
    expect(window.endLine).toBe(97);
    expect(window.text).toBe("");
    expect(window.truncated).toBe(false);
  });

  test("stays inside every small character budget without inventing content", async () => {
    const longLine = "z".repeat(60);
    const inspection = await inspectionFor([longLine, "second"]);
    const fullWindow = `1: ${longLine}\n2: second`;

    for (let maxCharacters = 1; maxCharacters <= 100; maxCharacters += 1) {
      const window = await queryEvidenceWindow(inspection, {
        artifactId: artifactId("maafw.log"),
        line: 1,
        before: 0,
        after: 1,
        maxLines: 4,
        maxCharacters,
      });

      expect(window.startLine).toBe(1);
      expect(window.startLine).toBeLessThanOrEqual(window.endLine);
      expect(window.text.length).toBeGreaterThan(0);
      expect(window.text.length).toBeLessThanOrEqual(maxCharacters);
      expect(fullWindow.startsWith(window.text)).toBe(true);
      expect(window.truncated).toBe(window.text !== fullWindow);
    }
  });
});
