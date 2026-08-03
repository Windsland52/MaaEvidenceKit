import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, expect, test } from "vitest";

import { inspectMse, renderMermaid, renderText } from "../../src/index.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

test("loads a public MSE project and exposes task relations as evidence", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "mek-mse-"));
  temporaryRoots.push(root);
  const assets = path.join(root, "assets");
  const pipeline = path.join(assets, "resource", "base", "pipeline");
  await mkdir(pipeline, { recursive: true });
  await writeFile(path.join(assets, "interface.json"), JSON.stringify({
    controller: [{ name: "Adb" }],
    resource: [{ name: "Official", path: ["resource/base"], controller: ["Adb"] }],
    task: [{ name: "Combat", entry: "Start" }],
  }), "utf8");
  await writeFile(path.join(pipeline, "combat.json"), JSON.stringify({
    Start: { recognition: "DirectHit", next: ["Done"] },
    Done: { recognition: "DirectHit" },
  }, null, 2), "utf8");

  const result = await inspectMse(root, { tasks: ["Start"] });
  const preflightOnly = await inspectMse(root);
  const graph = result.details.projects[0]?.graph;

  expect(result.details.projects[0]?.preflight.compatibility.status).toBe("supported");
  expect(result.details.projects[0]?.resolution?.requested_tasks).toEqual(["Start"]);
  expect(graph?.edges).toEqual(expect.arrayContaining([
    expect.objectContaining({ kind: "task.next" }),
  ]));
  expect(result.evidence.some((item) => item.kind === "mse.reference")).toBe(true);
  expect(renderText(result)).toContain("[task.next] Done");
  expect(renderMermaid(result)).toContain("flowchart TD");
  expect(preflightOnly.details.projects[0]?.resolution).toBeNull();
  expect(preflightOnly.details.projects[0]?.graph).toEqual({ nodes: [], edges: [] });
  expect(preflightOnly.evidence.some((item) => item.kind === "mse.task_binding")).toBe(true);
  expect(preflightOnly.evidence.some((item) => item.kind === "mse.task_definition")).toBe(false);
});
