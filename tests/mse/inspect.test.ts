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

test("expands execution paths recursively and separates on_error references", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "mek-mse-expand-"));
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
    Start: { recognition: "DirectHit", next: ["Mid"], on_error: ["Fail"] },
    Mid: { recognition: "DirectHit", next: ["Done"] },
    Done: { recognition: "DirectHit" },
    Fail: { recognition: "DirectHit" },
  }, null, 2), "utf8");

  const shallow = await inspectMse(root, { tasks: ["Start"], depth: 1 });
  const deep = await inspectMse(root, { tasks: ["Start"], depth: 2 });
  const shallowGraph = shallow.details.projects[0]?.graph;
  const deepGraph = deep.details.projects[0]?.graph;
  const shallowResolution = shallow.details.projects[0]?.resolution;
  const deepResolution = deep.details.projects[0]?.resolution;

  expect(shallowResolution?.resolutions.map((task) => task.name).sort()).toEqual(["Fail", "Mid", "Start"]);
  expect(deepResolution?.resolutions.map((task) => task.name).sort()).toEqual(["Done", "Fail", "Mid", "Start"]);
  expect(shallowGraph?.nodes.map((node) => node.name).sort()).toEqual(["Done", "Fail", "Mid", "Start"]);
  expect(shallowGraph?.edges.some((edge) => edge.kind === "task.next" && edge.to.includes("Mid"))).toBe(true);
  expect(shallowGraph?.edges.some((edge) => edge.kind === "task.on_error" && edge.to.includes("Fail"))).toBe(true);

  expect(deepGraph?.nodes.map((node) => node.name).sort()).toEqual(["Done", "Fail", "Mid", "Start"]);
  expect(deepGraph?.edges.some((edge) => edge.kind === "task.next" && edge.to.includes("Done"))).toBe(true);
  expect(deepGraph?.nodes.find((node) => node.name === "Done")?.found).toBe(true);
  expect(deep?.details.selection.depth).toBe(2);
});

test("finds reverse execution references for a failure node", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "mek-mse-reverse-"));
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
    Start: { recognition: "DirectHit", next: ["Mid"] },
    Mid: { recognition: "DirectHit", next: ["Done"] },
    Done: { recognition: "DirectHit" },
  }, null, 2), "utf8");

  const result = await inspectMse(root, { tasks: ["Mid"], depth: 1 });
  const graph = result.details.projects[0]?.graph;

  expect(graph?.nodes.map((node) => node.name).sort()).toEqual(["Done", "Mid", "Start"]);
  expect(graph?.edges.some((edge) => edge.kind === "task.next" && edge.from.includes("Start") && edge.to.includes("Mid")))
    .toBe(true);
  expect(graph?.edges.some((edge) => edge.kind === "task.next" && edge.from.includes("Mid") && edge.to.includes("Done")))
    .toBe(true);
});

test("exposes node summaries including custom recognition and custom action", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "mek-mse-node-summary-"));
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
    Start: {
      desc: "entry",
      recognition: "Custom",
      custom_recognition: "EntryRecognition",
      action: "Custom",
      custom_action: "EntryAction",
      next: ["Done"],
    },
    Done: { recognition: "DirectHit" },
  }, null, 2), "utf8");

  const result = await inspectMse(root, { tasks: ["Start"], depth: 1 });
  const graph = result.details.projects[0]?.graph;
  const start = graph?.nodes.find((node) => node.name === "Start");

  expect(start).toMatchObject({
    desc: "entry",
    recognition: "Custom",
    customRecognition: "EntryRecognition",
    action: "Custom",
    customAction: "EntryAction",
  });
});
