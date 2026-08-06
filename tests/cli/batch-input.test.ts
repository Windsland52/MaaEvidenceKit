import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, expect, test } from "vitest";

import { readBatchRequests } from "../../src/cli/batch-input.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function requestFile(value: unknown): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "mek-batch-input-"));
  temporaryRoots.push(root);
  const file = path.join(root, "requests.json");
  await writeFile(file, JSON.stringify(value), "utf8");
  return file;
}

test("validates batch request JSON at the CLI boundary", async () => {
  const file = await requestFile([
    { id: "find", operation: "search", query: { kinds: ["mla.task"], limit: 10 } },
    { operation: "view", evidenceId: "evidence-1" },
    { operation: "window", query: { artifactId: "artifact-1", line: 5, before: 2 } },
  ]);

  await expect(readBatchRequests(file)).resolves.toEqual([
    { id: "find", operation: "search", query: { kinds: ["mla.task"], limit: 10 } },
    { operation: "view", evidenceId: "evidence-1" },
    { operation: "window", query: { artifactId: "artifact-1", line: 5, before: 2 } },
  ]);
});

test("rejects unknown fields and invalid request shapes", async () => {
  const unknownField = await requestFile([{ operation: "search", query: {}, path: "secret" }]);
  const invalidQuery = await requestFile([{ operation: "window", query: { before: "2" } }]);
  const missingId = await requestFile([{ operation: "view" }]);

  await expect(readBatchRequests(unknownField)).rejects.toThrow("unknown field: path");
  await expect(readBatchRequests(invalidQuery)).rejects.toThrow("before must be an integer");
  await expect(readBatchRequests(missingId)).rejects.toThrow("evidenceId is required");
});
