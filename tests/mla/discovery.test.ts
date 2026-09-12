import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, expect, test } from "vitest";

import { discoverArtifacts } from "../../src/index.js";
import { measureDirectoryEntries } from "../../src/mla/discovery.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

test("discovers Maa logs while reporting unsupported and missing multipart materials", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "mek-discovery-"));
  temporaryRoots.push(root);
  await writeFile(
    path.join(root, "runtime.txt"),
    [
      "[2026-04-08 00:01:02.001][INF][Px1][Tx2][test] first",
      "[2026-04-08 00:01:02.002][DBG][Px1][Tx2][test] second",
    ].join("\n"),
    "utf8",
  );
  await writeFile(path.join(root, "notes.md"), "not supported", "utf8");
  await writeFile(
    path.join(root, "attachment-without-extension"),
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]),
  );
  await writeFile(path.join(root, "logs.part1of3.zip"), "part 1", "utf8");
  await writeFile(path.join(root, "logs.part3of3.zip"), "part 3", "utf8");

  const discovery = await discoverArtifacts(root);

  expect(discovery.artifacts.find((item) => item.relativePath === "runtime.txt")?.kind).toBe("maa_log");
  expect(discovery.artifacts.find((item) => item.relativePath === "attachment-without-extension")).toMatchObject({
    kind: "image",
    status: "available",
  });
  expect(discovery.artifacts.find((item) => item.relativePath === "notes.md")?.status).toBe("skipped");
  expect(discovery.missingEvidence).toEqual(expect.arrayContaining([
    expect.objectContaining({ code: "multipart_archive_part_missing" }),
  ]));
});

// @windsland52/maa-log-tools 2.0.0 dropped the upstream archive entry-count limit, so MEK's own
// scan bound is the only entry-count guard left on a discovered directory. Pin the reported bound
// fields so a future upstream or local change to that limit fails here instead of silently
// widening how much of a directory an inspection walks.
test("reports the scanned-file bound instead of relying on an upstream entry-count limit", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "mek-discovery-bound-"));
  temporaryRoots.push(root);
  for (const name of ["a.txt", "b.txt", "c.txt"]) {
    await writeFile(path.join(root, name), "[2026-04-08 00:01:02.001][INF][Px1][Tx2][test] line", "utf8");
  }

  const discovery = await discoverArtifacts(root);

  expect(discovery.scannedFileCount).toBe(3);
  expect(discovery.omittedOtherFileCount).toBe(0);
  expect(discovery.warnings.map((warning) => warning.code)).not.toContain("artifact_scan_truncated");
});

test("describes omitted unsupported files so a harness knows what to read itself", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "mek-discovery-omitted-"));
  temporaryRoots.push(root);
  await writeFile(path.join(root, "maafw.log"), [
    "[2026-04-08 00:01:02.001][INF][Px1][Tx2][test] first",
    "[2026-04-08 00:01:02.002][DBG][Px1][Tx2][test] second",
  ].join("\n"), "utf8");
  // 201 unsupported files plus the reported bound of 200: two files are omitted. Discovery sorts by
  // full path, so `note-200.bin` and `zz-package.json` are the two dropped, in that order.
  const names = Array.from({ length: 201 }, (_, index) => `note-${String(index).padStart(3, "0")}.bin`);
  for (const [index, name] of names.entries()) {
    await writeFile(path.join(root, name), `payload-${index}`, "utf8");
  }
  await writeFile(path.join(root, "zz-package.json"), "{}", "utf8");

  const discovery = await discoverArtifacts(root);

  expect(discovery.omittedOtherFileCount).toBe(2);
  expect(discovery.omittedUnsupportedFiles.map((item) => item.relativePath))
    .toEqual(["note-200.bin", "zz-package.json"]);
  const omitted = discovery.omittedUnsupportedFiles[0];
  expect(omitted?.sizeBytes).toBe(Buffer.byteLength("payload-200", "utf8"));
  expect(omitted?.modifiedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u);

  const warning = discovery.warnings.find((item) => item.code === "unsupported_artifact_list_truncated");
  expect(warning?.message).toContain("2 unsupported files were omitted");
  expect(warning?.message).toContain("the first 2 are described in omittedUnsupportedFiles");
  // The reported MaaFramework log is unaffected by the omissions.
  expect(discovery.artifacts.find((item) => item.relativePath === "maafw.log")?.kind).toBe("maa_log");
});

test("reports no omitted-file inventory when nothing is omitted", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "mek-discovery-nothing-omitted-"));
  temporaryRoots.push(root);
  await writeFile(path.join(root, "notes.md"), "not supported", "utf8");

  const discovery = await discoverArtifacts(root);

  expect(discovery.omittedOtherFileCount).toBe(0);
  expect(discovery.omittedUnsupportedFiles).toEqual([]);
  expect(discovery.warnings.some((item) => item.code === "unsupported_artifact_list_truncated"))
    .toBe(false);
});

test("bounds how many files a directory may contribute before a combined directory read", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "mek-directory-budget-"));
  temporaryRoots.push(root);
  await mkdir(path.join(root, "nested"), { recursive: true });
  await writeFile(path.join(root, "a.txt"), "a", "utf8");
  await writeFile(path.join(root, "b.txt"), "b", "utf8");
  await writeFile(path.join(root, "nested", "c.txt"), "c", "utf8");

  await expect(measureDirectoryEntries(root, 3)).resolves.toEqual({ countedFiles: 3, exceeded: false });
  await expect(measureDirectoryEntries(root, 2)).resolves.toEqual({ countedFiles: 3, exceeded: true });
});
