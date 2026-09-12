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

test("accepts a view driven by search parameters instead of an evidence ID", async () => {
  const file = await requestFile([
    { id: "fact", operation: "view", query: { nodes: ["EatCandyStart"], kinds: ["mla.action_detail"] } },
  ]);

  await expect(readBatchRequests(file)).resolves.toEqual([
    {
      id: "fact",
      operation: "view",
      query: { nodes: ["EatCandyStart"], kinds: ["mla.action_detail"] },
    },
  ]);
});

test("rejects a view that mixes an evidence ID with a query", async () => {
  const both = await requestFile([
    { operation: "view", evidenceId: "evidence-1", query: { kinds: ["mla.task"] } },
  ]);

  await expect(readBatchRequests(both)).rejects.toThrow("must use either evidenceId or query, not both");
});

test("rejects unknown fields and invalid request shapes", async () => {
  const unknownField = await requestFile([{ operation: "search", query: {}, path: "secret" }]);
  const invalidQuery = await requestFile([{ operation: "window", query: { before: "2" } }]);
  const missingId = await requestFile([{ operation: "view" }]);
  const unknownViewField = await requestFile([{ operation: "view", evidenceId: "evidence-1", node: "X" }]);

  await expect(readBatchRequests(unknownField)).rejects.toThrow("unknown field: path");
  await expect(readBatchRequests(invalidQuery)).rejects.toThrow("before must be an integer");
  await expect(readBatchRequests(missingId)).rejects.toThrow("evidenceId or batch request 1.query is required");
  await expect(readBatchRequests(unknownViewField)).rejects.toThrow("unknown field: node");
});
