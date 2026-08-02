import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, expect, test } from "vitest";

import { discoverArtifacts } from "../../src/index.js";

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
  await writeFile(path.join(root, "logs.part1of3.zip"), "part 1", "utf8");
  await writeFile(path.join(root, "logs.part3of3.zip"), "part 3", "utf8");

  const discovery = await discoverArtifacts(root);

  expect(discovery.artifacts.find((item) => item.relativePath === "runtime.txt")?.kind).toBe("maa_log");
  expect(discovery.artifacts.find((item) => item.relativePath === "notes.md")?.status).toBe("skipped");
  expect(discovery.missingEvidence).toEqual(expect.arrayContaining([
    expect.objectContaining({ code: "multipart_archive_part_missing" }),
  ]));
});
