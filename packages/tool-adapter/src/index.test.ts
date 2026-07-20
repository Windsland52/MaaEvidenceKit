import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";

import { handleRequest, type MlaPreflightResult } from "./index.js";

const temporaryRoots: string[] = [];

after(async () => {
  await Promise.all(
    temporaryRoots.map((root) => rm(root, { recursive: true, force: true }))
  );
});

test("tools/list exposes mla.preflight and mla.runtime-inspection", async () => {
  const response = await handleRequest({
    id: "list-1",
    apiVersion: "tool-adapter/v1",
    method: "tools/list"
  });

  assert.equal(response.ok, true);
  const result = response.result as { tools: Array<{ name: string }> };
  assert.deepEqual(result.tools.map((tool) => tool.name), [
    "mla.preflight",
    "mla.runtime-inspection"
  ]);
});

test("mla.preflight returns version sessions from a core log", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "mde-mla-adapter-"));
  temporaryRoots.push(root);
  const logPath = path.join(root, "maafw.log");
  await writeFile(
    logPath,
    [
      "[2026-07-19 10:00:00.000][DBG][Px1][Tx1][Logger] MAA Process Start",
      "[2026-07-19 10:00:00.001][DBG][Px1][Tx1][Logger] Version v5.11.1",
      "[2026-07-19 10:00:01.000][INF][Px1][Tx1][Tasker] no notify event"
    ].join("\n"),
    "utf8"
  );

  const response = await handleRequest({
    id: "preflight-1",
    apiVersion: "tool-adapter/v1",
    method: "tools/call",
    params: {
      name: "mla.preflight",
      arguments: { path: logPath }
    }
  });

  assert.equal(response.ok, true);
  const result = response.result as MlaPreflightResult;
  assert.equal(result.schema_version, "mde-mla-preflight/v1");
  assert.equal(result.compatibility.status, "unsupported");
  assert.deepEqual(result.framework.versions, ["v5.11.1"]);
  assert.equal(result.framework.sessions.length, 1);
  assert.equal(result.framework.sessions[0]?.version, "v5.11.1");
  assert.equal(result.framework.sessions[0]?.version_evidence[0]?.line, 2);
});

test("mla.preflight validates arguments", async () => {
  const response = await handleRequest({
    id: "preflight-invalid",
    apiVersion: "tool-adapter/v1",
    method: "tools/call",
    params: {
      name: "mla.preflight",
      arguments: { path: "" }
    }
  });

  assert.equal(response.ok, false);
  assert.equal(response.error?.code, "INVALID_TOOL_ARGUMENTS");
});

test("mla.runtime-inspection returns snake_case structured output", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "mde-mla-runtime-"));
  temporaryRoots.push(root);
  const logPath = path.join(root, "maafw.log");
  await writeFile(
    logPath,
    [
      "[2026-07-19 10:00:00.000][DBG][Px1][Tx1][Logger] MAA Process Start",
      "[2026-07-19 10:00:00.001][DBG][Px1][Tx1][Logger] Version v5.11.1",
      "[2026-07-19 10:00:01.000][INF][Px1][Tx1][Tasker] no notify event"
    ].join("\n"),
    "utf8"
  );

  const response = await handleRequest({
    id: "runtime-1",
    apiVersion: "tool-adapter/v1",
    method: "tools/call",
    params: {
      name: "mla.runtime-inspection",
      arguments: { path: logPath }
    }
  });

  assert.equal(response.ok, true);
  const result = response.result as Record<string, unknown>;
  assert.equal(result.schema_version, "mla-runtime-inspection/v1");
  assert.ok(Array.isArray(result.sessions));
  assert.ok(Array.isArray(result.failures));
  assert.ok(Array.isArray(result.outcomes));
  assert.ok(Array.isArray(result.signals));
  assert.ok(Array.isArray(result.warnings));
});

test("mla.runtime-inspection validates arguments", async () => {
  const response = await handleRequest({
    id: "runtime-invalid",
    apiVersion: "tool-adapter/v1",
    method: "tools/call",
    params: {
      name: "mla.runtime-inspection",
      arguments: { path: "" }
    }
  });

  assert.equal(response.ok, false);
  assert.equal(response.error?.code, "INVALID_TOOL_ARGUMENTS");
});
