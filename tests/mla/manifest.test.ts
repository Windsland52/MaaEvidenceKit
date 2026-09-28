import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, stat, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, expect, test } from "vitest";

import {
  discoverArtifacts,
  inspectMla,
  inspectMlaManifest,
  manifestDocument,
  manifestRows,
  renderCoverageManifest,
  type ManifestRow,
} from "../../src/index.js";
import { applyDigestResults, digestArtifacts } from "../../src/mla/content-digest.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function mkroot(prefix: string): Promise<string> {
  const created = await mkdtemp(path.join(os.tmpdir(), prefix));
  temporaryRoots.push(created);
  return created;
}

type CorpusFile = { relativePath: string; content: string | Uint8Array };

async function writeCorpus(root: string, files: readonly CorpusFile[]): Promise<void> {
  for (const file of files) {
    const target = path.join(root, ...file.relativePath.split("/"));
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, file.content);
  }
}

function rowFor(rows: readonly ManifestRow[], relativePath: string): ManifestRow {
  const row = rows.find((candidate) => candidate.path === relativePath);
  if (row === undefined) {
    throw new Error("No manifest row for " + relativePath + "; rows: " + rows.map((item) => item.path).join(", "));
  }
  return row;
}

const GENERATED_AT = "2026-09-26T18:50:00.000Z";

/** One real 1x1 PNG, so an image artifact carries bytes discovery recognizes by signature. */
const PNG_TINY = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

/** Rotation names and their name boundaries, oldest first. */
const ROTATIONS = [
  "maafw.bak.2026.09.26-18.27.41.257.log",
  "maafw.bak.2026.09.26-18.32.12.395.log",
  "maafw.bak.2026.09.26-18.35.46.392.log",
  "maafw.bak.2026.09.26-18.38.06.897.log",
  "maafw.bak.2026.09.26-18.42.09.422.log",
] as const;

const BOUNDARIES = [
  "2026-09-26T18:27:41.257",
  "2026-09-26T18:32:12.395",
  "2026-09-26T18:35:46.392",
  "2026-09-26T18:38:06.897",
  "2026-09-26T18:42:09.422",
] as const;

/** Five rotations plus the active file in the root, and one second family in a subdirectory. */
function rotationCorpus(): CorpusFile[] {
  return [
    ...ROTATIONS.map((name, offset) => ({ relativePath: name, content: "rotation " + offset + "\n" })),
    { relativePath: "maafw.log", content: "active\n" },
    { relativePath: "logs/maafw.log", content: "second family\n" },
  ];
}

/** A small corpus shaped like an extracted issue archive: logs, images, config, and unsupported files. */
function manifestCorpus(): CorpusFile[] {
  return [
    ...ROTATIONS.map((name, offset) => ({
      relativePath: name,
      content: "[2026-09-26 18:2" + offset + ":00.000][INF][Px1][Tx2][test] rotation " + offset + "\n",
    })),
    { relativePath: "maafw.log", content: "[2026-09-26 18:45:00.000][INF][Px1][Tx2][test] active\n" },
    { relativePath: "logs/maafw.log", content: "not a framework log\n" },
    { relativePath: "config/maa_option.json", content: "{}\n" },
    { relativePath: "record/ElasticGoodsPrices.json", content: "{}\n" },
    { relativePath: "go-service.log", content: "service log line\n" },
    { relativePath: "notes.txt", content: "hand written notes\n" },
    { relativePath: "on_error/2026.09.26-18.23.20.650_AutoDeliveryDeliveryMissionNotFound.png", content: PNG_TINY },
    { relativePath: "on_error/2026.09.26-18.42.09.355_AutoSellShipEnterStockRedistribution.png", content: PNG_TINY },
    { relativePath: "interface.json", content: "{}\n" },
    { relativePath: "resource/pipeline/AutoDelivery.json", content: "{}\n" },
    { relativePath: "logs.part1of3.zip", content: "part 1\n" },
    { relativePath: "logs.part3of3.zip", content: "part 3\n" },
  ];
}

function eventLine(timestamp: string, message: string, details: Record<string, unknown>): string {
  return "[" + timestamp + "][INF][Px1][Tx2][test] !!!OnEventNotify!!! [handle=1] [msg=" + message
    + "] [details=" + JSON.stringify(details) + "]";
}

/** A framework log big enough that parsing it costs far more than inventorying and digesting it. */
function largeLog(taskCount: number): string {
  const lines: string[] = [];
  for (let index = 1; index <= taskCount; index += 1) {
    const minute = String(Math.floor(index / 60) % 60).padStart(2, "0");
    const second = String(index % 60).padStart(2, "0");
    const stamp = "2026-07-19 10:" + minute + ":" + second;
    lines.push(eventLine(stamp + ".000", "Tasker.Task.Starting", {
      task_id: index, entry: "Combat", hash: "h" + index, uuid: "u" + index,
    }));
    lines.push(eventLine(stamp + ".100", "Node.Action.Succeeded", {
      action_id: index, focus: null, name: "Click", task_id: index,
    }));
  }
  return lines.join("\n") + "\n";
}

async function elapsed(operation: () => Promise<unknown>): Promise<number> {
  const startedAt = performance.now();
  await operation();
  return performance.now() - startedAt;
}

test("short-circuits after discovery, selecting and loading nothing", async () => {
  const root = await mkroot("mek-manifest-short-circuit-");
  await writeCorpus(root, manifestCorpus());

  const result = await inspectMlaManifest(root);

  expect(result.schemaVersion).toBe("maa-evidence/v1");
  expect(result.kind).toBe("mla");
  expect(result.details).toEqual({ extraction: "not-run" });
  expect(result.evidence).toEqual([]);
  expect(result.statistics["selectedArtifacts"]).toBe(0);
  expect(result.artifacts.every((artifact) => artifact.status !== "selected")).toBe(true);

  // Everything discovered is available rather than selected, so the manifest reports coverage.
  expect(result.artifacts.filter((artifact) => artifact.kind === "maa_log").map((artifact) => artifact.status))
    .toEqual(Array.from({ length: 7 }, () => "available"));
  expect(result.coverage).toMatchObject({
    artifacts: result.artifacts.length,
    readForRuntimeFacts: 0,
    notRead: result.artifacts.length,
  });

  const document = manifestDocument(result, { extraction: "not-run", generatedAt: GENERATED_AT });
  expect(document.coverage.selected).toBe(0);
  expect(document.coverage.readForRuntimeFacts).toBe(0);
  expect(document.coverage.skipped).toBe(document.artifacts.filter((row) => row.status === "skipped").length);
  expect(document.artifacts).toHaveLength(result.artifacts.length);
});

test("costs far less than a full inspection of the same corpus", async () => {
  const root = await mkroot("mek-manifest-short-circuit-speed-");
  await writeCorpus(root, [{ relativePath: "maafw.log", content: largeLog(4000) }]);

  // Best of two: the manifest path costs a few milliseconds, so a single sample would turn this into
  // a scheduling assertion instead of the magnitude assertion it is meant to be. The full inspection
  // is measured once, which is the larger and therefore conservative side of the comparison.
  const warmManifest = await elapsed(() => inspectMlaManifest(root));
  const manifestStarted = performance.now();
  const manifest = await inspectMlaManifest(root);
  const manifestMilliseconds = Math.min(warmManifest, performance.now() - manifestStarted);
  const fullStarted = performance.now();
  const full = await inspectMla(root);
  const fullMilliseconds = performance.now() - fullStarted;

  expect(manifest.details.extraction).toBe("not-run");
  expect(manifest.evidence).toEqual([]);
  expect(manifest.coverage?.readForRuntimeFacts).toBe(0);
  // The full inspection did the work the short circuit exists to defer.
  expect(full.coverage?.readForRuntimeFacts).toBe(1);
  expect(full.evidence.length).toBeGreaterThan(0);
  expect(fullMilliseconds).toBeGreaterThanOrEqual(2 * manifestMilliseconds);
});

test("reports each rotation as a family member with a monotonic name-derived window", async () => {
  const root = await mkroot("mek-manifest-rotation-");
  await writeCorpus(root, rotationCorpus());

  const result = await inspectMlaManifest(root);
  const rows = manifestRows(result.artifacts, result.input.path);
  const family = path.basename(root);

  ROTATIONS.forEach((name, offset) => {
    expect(rowFor(rows, name).rotation).toEqual({ family, index: offset + 1 });
    expect(rowFor(rows, name).timeCoverage).toEqual({
      basis: "rotation-filename",
      from: offset === 0 ? null : BOUNDARIES[offset - 1],
      to: BOUNDARIES[offset],
      fromKnown: offset > 0,
      toKnown: true,
    });
  });

  const active = rowFor(rows, "maafw.log");
  expect(active.rotation).toEqual({ family, index: ROTATIONS.length + 1 });
  expect(active.timeCoverage).toEqual({
    basis: "rotation-filename",
    from: BOUNDARIES[BOUNDARIES.length - 1],
    to: null,
    fromKnown: true,
    toKnown: false,
  });

  // A second directory with its own active file is a second family, starting at index 1.
  const second = rowFor(rows, "logs/maafw.log");
  expect(second.rotation).toEqual({ family: "logs", index: 1 });
  expect(second.timeCoverage).toEqual({
    basis: "rotation-filename",
    from: null,
    to: null,
    fromKnown: false,
    toKnown: false,
  });

  // The document reports the same membership it prints in the rows.
  const document = manifestDocument(result, { extraction: "not-run", generatedAt: GENERATED_AT });
  expect(document.coverage.rotations).toEqual({
    families: 2,
    members: 7,
    timestampedMembers: 5,
    readMembers: 0,
  });
});

test("derives time coverage from file names even when modification times disagree", async () => {
  const equalRoot = await mkroot("mek-manifest-mtime-equal-");
  const scrambledRoot = await mkroot("mek-manifest-mtime-scrambled-");
  const corpus = rotationCorpus();
  await writeCorpus(equalRoot, corpus);
  await writeCorpus(scrambledRoot, corpus);
  const absolute = (root: string, relativePath: string): string => path.join(root, ...relativePath.split("/"));

  // Extraction stamps every extracted file with one time, so every mtime here is identical.
  const extractionTime = new Date("2026-09-27T02:15:00.000Z");
  for (const file of corpus) {
    await utimes(absolute(equalRoot, file.relativePath), extractionTime, extractionTime);
  }
  // The second corpus holds the same bytes with the mtimes reversed: the newest rotation name
  // carries the oldest modification time, so an mtime-derived boundary would invert the chain.
  const reversed = [...ROTATIONS].reverse();
  for (const [offset, name] of reversed.entries()) {
    const stamp = new Date(Date.UTC(2026, 8, 27, offset, 0, 0));
    await utimes(absolute(scrambledRoot, name), stamp, stamp);
    await utimes(absolute(scrambledRoot, "maafw.log"), stamp, stamp);
  }

  // The trap is armed: one corpus has a single mtime, the other contradicts the name order.
  expect((await stat(absolute(equalRoot, "maafw.log"))).mtimeMs)
    .toBe((await stat(absolute(equalRoot, ROTATIONS[0]))).mtimeMs);
  expect((await stat(absolute(scrambledRoot, reversed[0] as string))).mtimeMs)
    .toBeLessThan((await stat(absolute(scrambledRoot, reversed[reversed.length - 1] as string))).mtimeMs);

  const equalRows = manifestRows((await inspectMlaManifest(equalRoot)).artifacts, "corpus");
  const scrambledRows = manifestRows((await inspectMlaManifest(scrambledRoot)).artifacts, "corpus");

  expect(JSON.stringify(scrambledRows)).toBe(JSON.stringify(equalRows));
  // The boundaries are still the ones the names carry, not whatever the filesystem reported.
  expect(rowFor(equalRows, ROTATIONS[1]).timeCoverage).toEqual({
    basis: "rotation-filename",
    from: BOUNDARIES[0],
    to: BOUNDARIES[1],
    fromKnown: true,
    toKnown: true,
  });
  expect(rowFor(equalRows, "maafw.log").timeCoverage?.from).toBe(BOUNDARIES[BOUNDARIES.length - 1]);
});

test("keeps the manifest inside its frozen size budgets", async () => {
  const root = await mkroot("mek-manifest-budget-");
  await writeCorpus(root, manifestCorpus());

  const result = await inspectMlaManifest(root);
  const options = { extraction: "not-run", generatedAt: GENERATED_AT } as const;
  const pretty = renderCoverageManifest(result, options);
  const compact = renderCoverageManifest(result, { ...options, format: "compact" });

  expect(result.artifacts).toHaveLength(17);
  expect(Buffer.byteLength(pretty, "utf8")).toBeLessThanOrEqual(8192);
  expect(Buffer.byteLength(compact, "utf8")).toBeLessThanOrEqual(7168);
  expect(Buffer.byteLength(compact, "utf8")).toBeLessThan(Buffer.byteLength(pretty, "utf8"));
  expect(compact).not.toContain("\n");
  expect(JSON.parse(compact)).toEqual(JSON.parse(pretty));
});

test("hashes artifact bytes itself and names every digest it cannot take", async () => {
  const root = await mkroot("mek-manifest-digest-");
  await writeCorpus(root, [
    { relativePath: "maafw.log", content: "[2026-07-19 10:00:00.000][INF][Px1][Tx2][test] a\n" },
    { relativePath: "empty.log", content: "" },
  ]);

  const result = await inspectMlaManifest(root);
  const rows = manifestRows(result.artifacts, root);

  // A zero-byte file has no bytes to describe, so it carries a named absence instead of a digest.
  expect(rowFor(rows, "empty.log")).toMatchObject({ sizeBytes: 0, sha256: null, digestStatus: "empty" });

  // A file with content carries the digest of those bytes, computed here independently.
  const bytes = await readFile(path.join(root, "maafw.log"));
  const expected = createHash("sha256").update(bytes).digest("hex");
  const logRow = rowFor(rows, "maafw.log");
  expect(logRow.sha256).toBe(expected);
  expect(logRow.sha256).toMatch(/^[0-9a-f]{64}$/u);
  expect(logRow).not.toHaveProperty("digestStatus");

  // The same discipline at the unit the manifest reads its digests from.
  const discovery = await discoverArtifacts(root);
  const applied = applyDigestResults(discovery.artifacts, await digestArtifacts(discovery.artifacts));
  const emptyArtifact = applied.find((item) => item.relativePath === "empty.log");
  expect(emptyArtifact?.contentDigest).toBeUndefined();
  expect(emptyArtifact?.digestStatus).toBe("empty");
  const logArtifact = applied.find((item) => item.relativePath === "maafw.log");
  expect(logArtifact?.contentDigest).toBe("sha256:" + expected);
  expect(logArtifact?.digestStatus).toBeUndefined();
});

test("recomputes a digest from the bytes instead of reusing an earlier value", async () => {
  const root = await mkroot("mek-manifest-digest-changed-");
  const file = path.join(root, "maafw.log");
  await writeFile(file, "first\n", "utf8");
  const before = rowFor(manifestRows((await inspectMlaManifest(root)).artifacts, root), "maafw.log");

  await writeFile(file, "second, longer\n", "utf8");
  const after = rowFor(manifestRows((await inspectMlaManifest(root)).artifacts, root), "maafw.log");

  expect(before.sha256).toBe(createHash("sha256").update("first\n").digest("hex"));
  expect(after.sha256).toBe(createHash("sha256").update("second, longer\n").digest("hex"));
  expect(after.sha256).not.toBe(before.sha256);
});

test("reports equal digests for equal bytes and different digests for different bytes", async () => {
  const root = await mkroot("mek-manifest-digest-equality-");
  const other = Buffer.from(PNG_TINY);
  other[other.length - 1] = (other[other.length - 1] ?? 0) ^ 0xff;
  await writeCorpus(root, [
    { relativePath: "on_error/a.png", content: PNG_TINY },
    { relativePath: "on_error/b.png", content: PNG_TINY },
    { relativePath: "on_error/c.png", content: other },
  ]);

  const rows = manifestRows((await inspectMlaManifest(root)).artifacts, root);
  const first = rowFor(rows, "on_error/a.png").sha256;
  expect(first).toMatch(/^[0-9a-f]{64}$/u);
  expect(rowFor(rows, "on_error/b.png").sha256).toBe(first);
  expect(rowFor(rows, "on_error/c.png").sha256).not.toBe(first);
});

test("keeps a file no adapter supports in the rows with a non-empty reason", async () => {
  const root = await mkroot("mek-manifest-skipped-");
  await writeCorpus(root, [
    { relativePath: "maafw.log", content: "[2026-07-19 10:00:00.000][INF][Px1][Tx2][test] a\n" },
    { relativePath: "notes.txt", content: "hand written notes\n" },
    { relativePath: "prices.json", content: "{}\n" },
  ]);

  const document = manifestDocument(await inspectMlaManifest(root), {
    extraction: "not-run",
    generatedAt: GENERATED_AT,
  });

  expect(document.artifacts).toHaveLength(3);
  for (const name of ["notes.txt", "prices.json"]) {
    const row = rowFor(document.artifacts, name);
    expect(row.status).toBe("skipped");
    expect(row.reason ?? "").not.toBe("");
  }
  expect(document.coverage.skipped).toBe(document.artifacts.filter((row) => row.status === "skipped").length);
});

test("renders a saved report after its corpus is gone", async () => {
  const root = await mkroot("mek-manifest-detached-");
  const store = await mkroot("mek-manifest-detached-store-");
  await writeCorpus(root, manifestCorpus());

  const inspection = await inspectMlaManifest(root);
  const reportPath = path.join(store, "report.json");
  await writeFile(reportPath, JSON.stringify(inspection, null, 2), "utf8");
  const options = { extraction: "reported", generatedAt: inspection.generatedAt } as const;
  const before = renderCoverageManifest(inspection, options);

  await rm(root, { recursive: true, force: true });
  await expect(stat(root)).rejects.toThrow();

  const restored = JSON.parse(await readFile(reportPath, "utf8")) as typeof inspection;
  const after = renderCoverageManifest(restored, { extraction: "reported", generatedAt: restored.generatedAt });

  expect(after).toBe(before);
  expect(JSON.parse(after)).toEqual(JSON.parse(before));
  expect((JSON.parse(after) as { artifacts: unknown[] }).artifacts).toEqual(JSON.parse(before).artifacts);
});
