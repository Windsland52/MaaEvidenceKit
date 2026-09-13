import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, expect, test } from "vitest";

import {
  inspectMse,
  queryEvidenceWindow,
  renderMermaid,
  renderText,
  resolveMse,
} from "../../src/index.js";

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
  const resolvedOnly = await resolveMse(root, {
    tasks: ["Start"],
    controller: "Adb",
    resource: "Official",
    includeReferencers: false,
  });
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
  expect(resolvedOnly.details.mode).toBe("resolution");
  expect(resolvedOnly.details.projects[0]?.resolution.requested_tasks).toEqual(["Start"]);
  expect(resolvedOnly.details.projects[0]?.graph.edges).toEqual(expect.arrayContaining([
    expect.objectContaining({ kind: "task.next" }),
  ]));
  expect(resolvedOnly.evidence.some((item) => item.kind === "mse.task_definition")).toBe(true);
  expect(resolvedOnly.evidence.some((item) => item.kind === "mse.reference")).toBe(true);
  expect(resolvedOnly.evidence.some((item) => item.kind === "mse.interface")).toBe(false);
  expect(resolvedOnly.evidence.some((item) => item.kind === "mse.task_binding")).toBe(false);
  expect(resolvedOnly.artifacts.every((artifact) => artifact.kind === "pipeline")).toBe(true);
  expect(renderText(resolvedOnly)).toContain("[task.next] Done");
  const definition = resolvedOnly.evidence.find((item) => item.kind === "mse.task_definition");
  expect(definition).toBeDefined();
  const definitionWindow = await queryEvidenceWindow(resolvedOnly, {
    evidenceId: definition?.id ?? "",
    before: 0,
    after: 1,
  });
  expect(definitionWindow.text).toContain("Start");
});

test("requires focused tasks and reports unresolved definitions in lightweight resolution", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "mek-mse-resolve-missing-"));
  temporaryRoots.push(root);
  const assets = path.join(root, "assets");
  await mkdir(path.join(assets, "resource", "base", "pipeline"), { recursive: true });
  await writeFile(path.join(assets, "interface.json"), JSON.stringify({
    controller: [{ name: "Adb" }],
    resource: [{ name: "Official", path: ["resource/base"], controller: ["Adb"] }],
  }), "utf8");

  await expect(resolveMse(root, { tasks: [] })).rejects.toThrow("at least one task");
  const result = await resolveMse(root, {
    tasks: ["Missing"],
    controller: "Adb",
    resource: "Official",
    includeReferencers: false,
  });
  expect(result.missingEvidence).toEqual(expect.arrayContaining([
    expect.objectContaining({ code: "mse_task_definition_missing" }),
  ]));
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
  const withoutReferencers = await inspectMse(root, {
    tasks: ["Mid"],
    depth: 1,
    includeReferencers: false,
  });
  const graph = result.details.projects[0]?.graph;
  const focusedGraph = withoutReferencers.details.projects[0]?.graph;

  expect(graph?.nodes.map((node) => node.name).sort()).toEqual(["Done", "Mid", "Start"]);
  expect(graph?.edges.some((edge) => edge.kind === "task.next" && edge.from.includes("Start") && edge.to.includes("Mid")))
    .toBe(true);
  expect(graph?.edges.some((edge) => edge.kind === "task.next" && edge.from.includes("Mid") && edge.to.includes("Done")))
    .toBe(true);
  expect(focusedGraph?.nodes.map((node) => node.name).sort()).toEqual(["Done", "Mid"]);
  expect(withoutReferencers.details.selection.includeReferencers).toBe(false);
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

test("states that a project behind a linked directory was not selected", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "mek-mse-links-"));
  temporaryRoots.push(root);
  const outside = await mkdtemp(path.join(os.tmpdir(), "mek-mse-links-target-"));
  temporaryRoots.push(outside);
  const outsideAssets = path.join(outside, "assets");
  await mkdir(path.join(outsideAssets, "resource", "base", "pipeline"), { recursive: true });
  await writeFile(path.join(outsideAssets, "interface.json"), JSON.stringify({
    controller: [{ name: "Adb" }],
    resource: [{ name: "Official", path: ["resource/base"], controller: ["Adb"] }],
    task: [{ name: "Combat", entry: "Start" }],
  }), "utf8");
  await writeFile(path.join(outsideAssets, "resource", "base", "pipeline", "combat.json"), JSON.stringify({
    Start: { recognition: "DirectHit", next: ["Done"] },
    Done: { recognition: "DirectHit" },
  }, null, 2), "utf8");
  // The type argument is ignored on POSIX, where this is a real symlink.
  await symlink(outside, path.join(root, "source"), "junction");

  const result = await inspectMse(root, { tasks: ["Start"] });
  const warning = result.warnings.find((item) => item.code === "mse_project_links_skipped");

  expect(warning?.message).toBe(
    "Skipped 1 symbolic link or junction entry during MSE project discovery;"
    + " MEK does not follow links, so their targets were not scanned: source.",
  );
  expect(result.warnings.filter((item) => item.code === "mse_project_links_skipped")).toHaveLength(1);
  expect(result.details.projects).toEqual([]);
  // The input path itself is not a link, so the existing missing-evidence behavior is unchanged.
  expect(result.missingEvidence).toEqual(expect.arrayContaining([
    expect.objectContaining({ code: "mse_project_missing" }),
  ]));
});

test("reports no skipped-link warning for a project selected directly at the root", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "mek-mse-no-links-"));
  temporaryRoots.push(root);
  await writeFile(path.join(root, "interface.json"), JSON.stringify({
    controller: [{ name: "Adb" }],
    resource: [{ name: "Official", path: ["resource/base"], controller: ["Adb"] }],
  }), "utf8");

  const result = await inspectMse(root);

  expect(result.warnings.map((item) => item.code)).not.toContain("mse_project_links_skipped");
});

test("keeps the MSE skipped-link warning byte-stable across repeated inspections", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "mek-mse-links-stable-"));
  temporaryRoots.push(root);
  const outside = await mkdtemp(path.join(os.tmpdir(), "mek-mse-links-stable-target-"));
  temporaryRoots.push(outside);
  await writeFile(path.join(outside, "interface.json"), "{}", "utf8");
  await symlink(outside, path.join(root, "zeta"), "junction");
  await symlink(outside, path.join(root, "alpha"), "junction");

  const first = await inspectMse(root);
  const second = await inspectMse(root);
  const firstMessage = first.warnings.find((item) => item.code === "mse_project_links_skipped")?.message;

  expect(firstMessage).toBe(
    "Skipped 2 symbolic link or junction entries during MSE project discovery;"
    + " MEK does not follow links, so their targets were not scanned: alpha, zeta.",
  );
  expect(second.warnings.find((item) => item.code === "mse_project_links_skipped")?.message)
    .toBe(firstMessage);
});
