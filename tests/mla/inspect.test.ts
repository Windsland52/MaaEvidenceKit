import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, expect, test } from "vitest";

import { inspectMla, renderText } from "../../src/index.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function event(timestamp: string, message: string, details: Record<string, unknown>): string {
  return `[${timestamp}][INF][Px1][Tx2][test] !!!OnEventNotify!!! [handle=1] [msg=${message}] [details=${JSON.stringify(details)}]`;
}

test("extracts source-backed runtime facts and filters them by time", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "mek-mla-"));
  temporaryRoots.push(root);
  const log = path.join(root, "maafw.log");
  await writeFile(log, [
    "[2026-07-19 10:00:00.000][DBG][Px1][Tx1][Logger] MAA Process Start",
    "[2026-07-19 10:00:00.001][DBG][Px1][Tx1][Logger] Version v5.12.2",
    event("2026-07-19 10:01:00.000", "Tasker.Task.Starting", {
      task_id: 1, entry: "First", hash: "h1", uuid: "u1",
    }),
    event("2026-07-19 10:01:01.000", "Node.PipelineNode.Starting", {
      task_id: 1, node_id: 11, name: "FirstNode",
    }),
    event("2026-07-19 10:01:02.000", "Node.PipelineNode.Succeeded", {
      task_id: 1, node_id: 11, name: "FirstNode",
    }),
    event("2026-07-19 10:01:03.000", "Tasker.Task.Succeeded", {
      task_id: 1, entry: "First", hash: "h1", uuid: "u1",
    }),
    event("2026-07-19 11:01:00.000", "Tasker.Task.Starting", {
      task_id: 2, entry: "Second", hash: "h2", uuid: "u2",
    }),
    event("2026-07-19 11:01:01.000", "Node.PipelineNode.Starting", {
      task_id: 2, node_id: 21, name: "SecondNode",
    }),
    event("2026-07-19 11:01:02.000", "Node.PipelineNode.Failed", {
      task_id: 2, node_id: 21, name: "SecondNode",
    }),
    event("2026-07-19 11:01:03.000", "Tasker.Task.Failed", {
      task_id: 2, entry: "Second", hash: "h2", uuid: "u2",
    }),
  ].join("\n"), "utf8");

  const complete = await inspectMla(log);
  const focused = await inspectMla(log, {
    timeRange: { from: "2026-07-19 10:00:00", to: "2026-07-19 10:10:00" },
  });

  expect(complete.details.runtime.sessions[0]?.tasks.map((task) => task.name)).toEqual([
    "First",
    "Second",
  ]);
  expect(focused.details.runtime.sessions[0]?.tasks.map((task) => task.name)).toEqual(["First"]);
  expect(focused.evidence.every((item) => item.source.artifactId === focused.artifacts[0]?.id)).toBe(true);
  expect(focused.evidence.some((item) => item.kind === "mla.task")).toBe(true);
  expect(focused.warnings.some((item) => item.code === "mla_time_window_file_granularity")).toBe(true);
  expect(renderText(focused)).toContain("First: succeeded");
  expect(renderText(focused)).not.toContain("Second: failed");
});

test("selects and merges independent log bundles from a project directory", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "mek-mla-project-"));
  temporaryRoots.push(root);
  const debug = path.join(root, "debug");
  await mkdir(path.join(root, "node_modules", "unrelated"), { recursive: true });
  await mkdir(debug);
  await writeFile(path.join(root, "package.json"), "{}", "utf8");
  const logWithTask = (time: string, taskName: string, taskId: number): string => [
    `[2026-07-19 ${time}:00.000][DBG][Px1][Tx1][Logger] MAA Process Start`,
    `[2026-07-19 ${time}:00.001][DBG][Px1][Tx1][Logger] Version v5.12.2`,
    event(`2026-07-19 ${time}:01.000`, "Tasker.Task.Starting", {
      task_id: taskId, entry: taskName, hash: `h${taskId}`, uuid: `u${taskId}`,
    }),
    event(`2026-07-19 ${time}:02.000`, "Tasker.Task.Succeeded", {
      task_id: taskId, entry: taskName, hash: `h${taskId}`, uuid: `u${taskId}`,
    }),
  ].join("\n");
  await writeFile(path.join(root, "maafw.log"), logWithTask("10:00", "RootTask", 1), "utf8");
  await writeFile(path.join(debug, "maafw.log"), logWithTask("11:00", "DebugTask", 1), "utf8");

  const result = await inspectMla(root);
  const tasks = result.details.runtime.sessions.flatMap((session) => session.tasks.map((task) => task.name));
  const sessionIds = result.details.runtime.sessions.map((session) => session.session_id);
  const artifactIds = new Set(result.artifacts.map((artifact) => artifact.id));

  expect(result.details.selection.loadingGranularity).toBe("multiple_bundles");
  expect(result.details.selection.targets).toEqual(["maafw.log", "debug"]);
  expect(tasks).toEqual(expect.arrayContaining(["RootTask", "DebugTask"]));
  expect(new Set(sessionIds).size).toBe(sessionIds.length);
  expect(result.evidence.every((item) => artifactIds.has(item.source.artifactId))).toBe(true);
  expect(result.artifacts.filter((artifact) => artifact.status === "selected")).toHaveLength(2);
});
