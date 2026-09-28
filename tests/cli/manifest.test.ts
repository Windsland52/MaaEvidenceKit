import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, expect, test, vi } from "vitest";

import { main } from "../../src/cli/main.js";
import {
  MANIFEST_SCHEMA_VERSION,
  renderCoverageManifest,
  type InspectionResult,
  type ManifestDocument,
} from "../../src/index.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function mkroot(prefix: string): Promise<string> {
  const created = await mkdtemp(path.join(os.tmpdir(), prefix));
  temporaryRoots.push(created);
  return created;
}

function event(timestamp: string, message: string, details: Record<string, unknown>): string {
  return "[" + timestamp + "][INF][Px1][Tx2][test] !!!OnEventNotify!!! [handle=1] [msg=" + message
    + "] [details=" + JSON.stringify(details) + "]";
}

/** One corpus small enough that its manifest rows can be asserted literally. */
async function corpus(prefix: string): Promise<string> {
  const root = await mkroot(prefix);
  await mkdir(path.join(root, "logs"), { recursive: true });
  await writeFile(path.join(root, "maafw.bak.2026.09.26-18.27.41.257.log"), event(
    "2026-09-26 18:27:41.257",
    "Tasker.Task.Starting",
    { task_id: 1, entry: "Combat", hash: "h1", uuid: "u1" },
  ) + "\n", "utf8");
  await writeFile(path.join(root, "maafw.log"), event(
    "2026-09-26 18:45:00.000",
    "Tasker.Task.Failed",
    { task_id: 2, entry: "Combat", hash: "h2", uuid: "u2" },
  ) + "\n", "utf8");
  await writeFile(path.join(root, "notes.txt"), "hand written notes\n", "utf8");
  return root;
}

/** Run the CLI in process and capture both streams, the way the other CLI tests do. */
async function run(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  let stdout = "";
  let stderr = "";
  vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    stdout += String(chunk);
    return true;
  });
  vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
    stderr += String(chunk);
    return true;
  });
  try {
    return { code: await main(args), stdout, stderr };
  } finally {
    vi.restoreAllMocks();
  }
}

function manifest(output: string): ManifestDocument {
  const parsed = JSON.parse(output) as ManifestDocument;
  expect(parsed.schemaVersion).toBe(MANIFEST_SCHEMA_VERSION);
  return parsed;
}

test("mla inspect --format manifest prints the discovery-state document and stops there", async () => {
  const root = await corpus("mek-cli-manifest-");
  const store = await mkroot("mek-cli-manifest-store-");

  const pretty = await run(["mla", "inspect", root, "--format", "manifest"]);
  expect(pretty.code).toBe(0);
  expect(pretty.stderr).toBe("");

  const document = manifest(pretty.stdout);
  expect(document.input).toEqual({ path: root, extraction: "not-run" });
  expect(document.root).toBe(".");
  expect(document.artifacts.map((row) => row.path)).toEqual([
    "maafw.bak.2026.09.26-18.27.41.257.log",
    "maafw.log",
    "notes.txt",
  ]);
  // Nothing was selected: the document states coverage, not extraction results.
  expect(document.coverage.selected).toBe(0);
  expect(document.coverage.readForRuntimeFacts).toBe(0);
  expect(document.coverage.rotations).toEqual({ families: 1, members: 2, timestampedMembers: 1, readMembers: 0 });
  // The root-level family is labelled by the root directory, not by the portable relative path.
  expect(document.artifacts.find((row) => row.path === "maafw.log")?.rotation)
    .toEqual({ family: path.basename(root), index: 2 });

  const compact = await run(["mla", "inspect", root, "--format", "manifest-compact"]);
  expect(compact.code).toBe(0);
  expect(compact.stdout.trimEnd().split("\n")).toHaveLength(1);
  const parsed = { ...manifest(compact.stdout) } as Partial<ManifestDocument>;
  delete parsed.generatedAt;
  const parsedPretty = { ...manifest(pretty.stdout) } as Partial<ManifestDocument>;
  delete parsedPretty.generatedAt;
  expect(parsed).toEqual(parsedPretty);

  const outputPath = path.join(store, "manifest.json");
  const toFile = await run(["mla", "inspect", root, "--format", "manifest", "--output", outputPath]);
  expect(toFile.code).toBe(0);
  expect(toFile.stdout).toBe("");
  const written = await readFile(outputPath, "utf8");
  expect(written.endsWith("\n")).toBe(true);
  expect(manifest(written).artifacts).toEqual(document.artifacts);
});

test("mla inspect --format manifest refuses options only extraction could honor", async () => {
  const root = await corpus("mek-cli-manifest-options-");

  for (const option of [["--summary"], ["--all-signals"], ["--keyword", "Combat"]]) {
    const result = await run(["mla", "inspect", root, "--format", "manifest", ...option]);
    expect(result.code).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("--format manifest short-circuits before extraction");
    expect(result.stderr).toContain(option[0] as string);
  }
});

test("view --format manifest refuses a query or a budget instead of ignoring them", async () => {
  const root = await corpus("mek-cli-manifest-view-options-");
  const store = await mkroot("mek-cli-manifest-view-options-store-");
  const reportPath = path.join(store, "report.json");
  expect((await run(["mla", "inspect", root, "--output", reportPath])).code).toBe(0);

  const evidenceId = await run(["view", "--input", reportPath, "--format", "manifest", "--evidence-id", "evidence-1"]);
  expect(evidenceId.code).toBe(1);
  expect(evidenceId.stdout).toBe("");
  expect(evidenceId.stderr).toContain("--evidence-id applies to json and text");

  for (const option of [["--max-lines", "10"], ["--max-characters", "100"]]) {
    const truncated = await run(["view", "--input", reportPath, "--format", "manifest", ...option]);
    expect(truncated.code).toBe(1);
    expect(truncated.stdout).toBe("");
    expect(truncated.stderr).toContain("is never truncated");
  }
});

test("view --format manifest renders a saved report after its corpus is deleted", async () => {
  const root = await corpus("mek-cli-manifest-detached-");
  const store = await mkroot("mek-cli-manifest-detached-store-");
  const reportPath = path.join(store, "report.json");

  const saved = await run(["mla", "inspect", root, "--output", reportPath]);
  expect(saved.code).toBe(0);
  const report = JSON.parse(await readFile(reportPath, "utf8")) as InspectionResult;
  // The saved report is a real extraction: it read at least one artifact for runtime facts.
  expect(report.artifacts.some((artifact) => artifact.status === "selected")).toBe(true);
  expect(report.coverage?.readForRuntimeFacts ?? 0).toBeGreaterThan(0);

  const before = await run(["view", "--input", reportPath, "--format", "manifest"]);
  // The manifest branch is reached before --format is resolved as a ViewFormat, because a manifest
  // is a separate output family: see the ordering of outputFormat() in runView.
  expect({ code: before.code, stderr: before.stderr }).toEqual({ code: 0, stderr: "" });
  const document = manifest(before.stdout);
  expect(document.input.extraction).toBe("reported");
  // The document root stays the portable "." even when the report names the corpus it came from.
  expect(document.root).toBe(".");
  expect(document.input.path).toBe(root);
  // Rendering from a report labels the root family exactly as the inspection did: the inspected
  // directory's own name, not its parent's and not the file's.
  expect(document.artifacts.find((row) => row.path === "maafw.log")?.rotation)
    .toEqual({ family: path.basename(root), index: 2 });
  // The renderer never reads the corpus, so the direct call reproduces the command byte for byte.
  expect(before.stdout).toBe(renderCoverageManifest(report, {
    format: "json",
    extraction: "reported",
    generatedAt: report.generatedAt,
  }) + "\n");
  const rows = document.artifacts;

  await rm(root, { recursive: true, force: true });
  await expect(stat(root)).rejects.toThrow();

  const after = await run(["view", "--input", reportPath, "--format", "manifest"]);
  expect(after.code).toBe(0);
  expect(after.stdout).toBe(before.stdout);
  expect(manifest(after.stdout).artifacts).toEqual(rows);

  // The compact face of the same renderer is reachable from a report too, and matches the pretty one.
  const compact = await run(["view", "--input", reportPath, "--format", "manifest-compact"]);
  expect(compact.code).toBe(0);
  expect(compact.stdout.trimEnd().split("\n")).toHaveLength(1);
  expect(JSON.parse(compact.stdout)).toEqual(JSON.parse(after.stdout));
});
