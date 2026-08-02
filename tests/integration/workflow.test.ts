import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, expect, test } from "vitest";

import { main } from "../../src/cli/main.js";
import { inspect, inspectMla, setTelemetryEnabled } from "../../src/index.js";

const temporaryRoots: string[] = [];
const originalConfigDirectory = process.env["MAA_EVIDENCE_CONFIG_DIR"];

afterEach(async () => {
  if (originalConfigDirectory === undefined) delete process.env["MAA_EVIDENCE_CONFIG_DIR"];
  else process.env["MAA_EVIDENCE_CONFIG_DIR"] = originalConfigDirectory;
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function event(timestamp: string, message: string, details: Record<string, unknown>): string {
  return `[${timestamp}][INF][Px1][Tx2][test] !!!OnEventNotify!!! [handle=1] [msg=${message}] [details=${JSON.stringify(details)}]`;
}

async function createCombinedFixture(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "mek-workflow-"));
  temporaryRoots.push(root);
  await writeFile(path.join(root, "maafw.log"), [
    "[2026-07-19 10:00:00.000][DBG][Px1][Tx1][Logger] MAA Process Start",
    "[2026-07-19 10:00:00.001][DBG][Px1][Tx1][Logger] Version v5.12.2",
    event("2026-07-19 10:01:00.000", "Tasker.Task.Starting", {
      task_id: 1, entry: "Start", hash: "h1", uuid: "u1",
    }),
    event("2026-07-19 10:01:01.000", "Node.PipelineNode.Starting", {
      task_id: 1, node_id: 11, name: "Start",
    }),
    event("2026-07-19 10:01:02.000", "Node.PipelineNode.Succeeded", {
      task_id: 1, node_id: 11, name: "Start",
    }),
    event("2026-07-19 10:01:03.000", "Tasker.Task.Succeeded", {
      task_id: 1, entry: "Start", hash: "h1", uuid: "u1",
    }),
  ].join("\n"), "utf8");
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
  }), "utf8");
  return root;
}

test("combined inspection chooses only the deterministic adapters present", async () => {
  const root = await createCombinedFixture();
  const result = await inspect(root);

  expect(result.details.mla).not.toBeNull();
  expect(result.details.mse).not.toBeNull();
  expect(result.evidence.some((item) => item.kind.startsWith("mla."))).toBe(true);
  expect(result.evidence.some((item) => item.kind.startsWith("mse."))).toBe(true);
  expect(result.statistics.adapters).toBe(2);
});

test("CLI writes JSON inspection and can query a cited source window", async () => {
  const root = await createCombinedFixture();
  const configDirectory = path.join(root, "config");
  process.env["MAA_EVIDENCE_CONFIG_DIR"] = configDirectory;
  await setTelemetryEnabled(false, configDirectory);
  const inspectionPath = path.join(root, "inspection.json");
  const windowPath = path.join(root, "window.json");

  expect(await main(["inspect", root, "--format", "json", "--output", inspectionPath])).toBe(0);
  const inspection = JSON.parse(await readFile(inspectionPath, "utf8")) as {
    schemaVersion: string;
    evidence: Array<{ id: string; source: { line?: number } }>;
  };
  const cited = inspection.evidence.find((item) => item.source.line !== undefined);
  expect(inspection.schemaVersion).toBe("maa-evidence/v1");
  expect(cited).toBeDefined();
  expect(await main([
    "window",
    "--input",
    inspectionPath,
    "--evidence-id",
    cited?.id ?? "",
    "--before",
    "1",
    "--after",
    "1",
    "--output",
    windowPath,
  ])).toBe(0);
  const window = JSON.parse(await readFile(windowPath, "utf8")) as { text: string };
  expect(window.text).toContain("MAA Process Start");
});

test("MLA rejects archives because extraction belongs to the harness", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "mek-archive-"));
  temporaryRoots.push(root);
  const archive = path.join(root, "issue.zip");
  await writeFile(archive, "not a real archive", "utf8");
  await expect(inspectMla(archive)).rejects.toThrow("calling harness");
});
