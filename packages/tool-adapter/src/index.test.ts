import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";

import {
  handleRequest,
  type MlaPreflightResult,
  type MseProjectPreflightResult
} from "./index.js";

const temporaryRoots: string[] = [];

after(async () => {
  await Promise.all(
    temporaryRoots.map((root) => rm(root, { recursive: true, force: true }))
  );
});

test("tools/list exposes MLA and MSE deterministic tools", async () => {
  const response = await handleRequest({
    id: "list-1",
    apiVersion: "tool-adapter/v1",
    method: "tools/list"
  });

  assert.equal(response.ok, true);
  const result = response.result as { tools: Array<{ name: string }> };
  assert.deepEqual(result.tools.map((tool) => tool.name), [
    "mla.preflight",
    "mla.runtime-inspection",
    "mse.project-preflight",
    "mse.resolve-tasks"
  ]);
});

test("mse.project-preflight loads interface resource combinations read-only", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "mde-mse-adapter-"));
  temporaryRoots.push(root);
  const assets = path.join(root, "assets");
  const pipeline = path.join(assets, "resource", "base", "pipeline");
  await mkdir(pipeline, { recursive: true });
  await writeFile(
    path.join(assets, "interface.json"),
    JSON.stringify({
      controller: [{ name: "Adb" }],
      resource: [{ name: "Official", path: ["resource/base"], controller: ["Adb"] }],
      task: [{ name: "Combat", entry: "Start" }]
    }),
    "utf8"
  );
  await writeFile(
    path.join(pipeline, "combat.json"),
    JSON.stringify({ Start: { next: ["MissingNode"] } }),
    "utf8"
  );

  const response = await handleRequest({
    id: "mse-1",
    apiVersion: "tool-adapter/v1",
    method: "tools/call",
    params: {
      name: "mse.project-preflight",
      arguments: { path: root }
    }
  });

  assert.equal(response.ok, true);
  const result = response.result as MseProjectPreflightResult;
  assert.equal(result.schema_version, "mde-mse-project-preflight/v1");
  assert.equal(result.compatibility.status, "supported");
  assert.deepEqual(result.controllers, ["Adb"]);
  assert.deepEqual(result.resources, ["Official"]);
  assert.deepEqual(result.task_bindings, [{ name: "Combat", entry: "Start" }]);
  assert.equal(result.configurations[0]?.pipeline_file_count, 1);
  assert.equal(result.configurations[0]?.task_count, 1);
  assert.equal(result.configurations_truncated, false);
  assert.ok(result.diagnostics.some((item) => item.type === "unknown-task"));
});

test("mse.resolve-tasks returns MaaFramework definitions and effective config", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "mde-mse-resolve-"));
  temporaryRoots.push(root);
  const assets = path.join(root, "assets");
  const pipeline = path.join(assets, "resource", "base", "pipeline");
  await mkdir(pipeline, { recursive: true });
  await writeFile(
    path.join(assets, "interface.json"),
    JSON.stringify({
      controller: [{ name: "Adb" }],
      resource: [{ name: "Official", path: ["resource/base"], controller: ["Adb"] }]
    }),
    "utf8"
  );
  await writeFile(
    path.join(pipeline, "combat.json"),
    JSON.stringify({
      Start: {
        recognition: "OCR",
        expected: ["Start"],
        replace: [["5tart", "Start"]],
        next: ["Done"]
      },
      Done: { recognition: "DirectHit" }
    }, null, 2),
    "utf8"
  );

  const response = await handleRequest({
    id: "mse-resolve-1",
    apiVersion: "tool-adapter/v1",
    method: "tools/call",
    params: {
      name: "mse.resolve-tasks",
      arguments: { path: root, tasks: ["Start"] }
    }
  });

  assert.equal(response.ok, true);
  const result = response.result as {
    resolutions: Array<{
      found: boolean;
      effective_config: Record<string, unknown>;
      definitions: Array<{ line: number }>;
      references: Array<{ kind: string; target: string }>;
    }>;
  };
  assert.equal(result.resolutions.length, 1);
  assert.equal(result.resolutions[0]?.found, true);
  assert.equal(result.resolutions[0]?.effective_config["recognition"], "OCR");
  assert.equal(result.resolutions[0]?.definitions[0]?.line, 2);
  assert.ok(
    result.resolutions[0]?.references.some(
      (item) => item.kind === "task.next" && item.target === "Done"
    )
  );
});

test("mse.project-preflight rejects parent traversal resource paths", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "mde-mse-traversal-"));
  const outside = await mkdtemp(path.join(os.tmpdir(), "mde-mse-secret-"));
  temporaryRoots.push(root, outside);
  const assets = path.join(root, "assets");
  await mkdir(path.join(outside, "pipeline"), { recursive: true });
  await mkdir(assets, { recursive: true });
  await writeFile(
    path.join(assets, "interface.json"),
    JSON.stringify({
      controller: [{ name: "Adb" }],
      resource: [{
        name: "Escaped",
        path: [path.relative(assets, outside).replaceAll(path.sep, "/")],
        controller: ["Adb"]
      }]
    }),
    "utf8"
  );
  await writeFile(
    path.join(outside, "pipeline", "secret.json"),
    JSON.stringify({ SECRET_MARKER_SHOULD_NOT_LEAK: {} }),
    "utf8"
  );

  const response = await handleRequest({
    id: "mse-traversal-1",
    apiVersion: "tool-adapter/v1",
    method: "tools/call",
    params: {
      name: "mse.project-preflight",
      arguments: { path: root }
    }
  });

  assert.equal(response.ok, false);
  assert.equal(response.error?.code, "TOOL_EXECUTION_FAILED");
  assert.match(response.error?.message ?? "", /escaped the configured project root/u);
  assert.doesNotMatch(
    JSON.stringify(response),
    /SECRET_MARKER_SHOULD_NOT_LEAK/u
  );
});

test("mse.resolve-tasks rejects absolute resource paths outside the project", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "mde-mse-absolute-"));
  const outside = await mkdtemp(path.join(os.tmpdir(), "mde-mse-secret-"));
  temporaryRoots.push(root, outside);
  await mkdir(path.join(outside, "pipeline"), { recursive: true });
  await writeFile(
    path.join(root, "interface.json"),
    JSON.stringify({
      controller: [{ name: "Adb" }],
      resource: [{ name: "Escaped", path: [outside], controller: ["Adb"] }]
    }),
    "utf8"
  );
  await writeFile(
    path.join(outside, "pipeline", "secret.json"),
    JSON.stringify({ SECRET_MARKER_SHOULD_NOT_LEAK: {} }),
    "utf8"
  );

  const response = await handleRequest({
    id: "mse-absolute-1",
    apiVersion: "tool-adapter/v1",
    method: "tools/call",
    params: {
      name: "mse.resolve-tasks",
      arguments: { path: root, tasks: ["SECRET_MARKER_SHOULD_NOT_LEAK"] }
    }
  });

  assert.equal(response.ok, false);
  assert.equal(response.error?.code, "TOOL_EXECUTION_FAILED");
  assert.match(response.error?.message ?? "", /escaped the configured project root/u);
  assert.doesNotMatch(
    JSON.stringify(response),
    /SECRET_MARKER_SHOULD_NOT_LEAK/u
  );
});

test("mse.project-preflight does not treat missing in-root resources as escapes", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "mde-mse-missing-resource-"));
  temporaryRoots.push(root);
  const assets = path.join(root, "assets");
  await mkdir(assets, { recursive: true });
  await writeFile(path.join(assets, "not-a-directory"), "not a directory", "utf8");
  await writeFile(
    path.join(assets, "interface.json"),
    JSON.stringify({
      controller: [{ name: "Adb" }],
      resource: [{
        name: "Incomplete",
        path: ["missing/resource", "not-a-directory/child"],
        controller: ["Adb"]
      }]
    }),
    "utf8"
  );

  const response = await handleRequest({
    id: "mse-missing-resource-1",
    apiVersion: "tool-adapter/v1",
    method: "tools/call",
    params: {
      name: "mse.project-preflight",
      arguments: { path: root }
    }
  });

  assert.equal(response.ok, true);
  assert.doesNotMatch(
    JSON.stringify(response),
    /escaped the configured project root/u
  );
});

test("mse.project-preflight rejects symlinked resource directory escapes", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "mde-mse-symlink-"));
  const outside = await mkdtemp(path.join(os.tmpdir(), "mde-mse-secret-"));
  temporaryRoots.push(root, outside);
  const resourceParent = path.join(root, "resource");
  const linkedResource = path.join(resourceParent, "linked");
  await mkdir(resourceParent, { recursive: true });
  await mkdir(path.join(outside, "pipeline"), { recursive: true });
  try {
    await symlink(outside, linkedResource, "junction");
  } catch {
    t.skip("platform does not permit creating a test directory symlink");
    return;
  }
  await writeFile(
    path.join(root, "interface.json"),
    JSON.stringify({
      controller: [{ name: "Adb" }],
      resource: [{ name: "Linked", path: ["resource/linked"], controller: ["Adb"] }]
    }),
    "utf8"
  );
  await writeFile(
    path.join(outside, "pipeline", "secret.json"),
    JSON.stringify({ SECRET_MARKER_SHOULD_NOT_LEAK: {} }),
    "utf8"
  );

  const response = await handleRequest({
    id: "mse-symlink-1",
    apiVersion: "tool-adapter/v1",
    method: "tools/call",
    params: {
      name: "mse.project-preflight",
      arguments: { path: root }
    }
  });

  assert.equal(response.ok, false);
  assert.equal(response.error?.code, "TOOL_EXECUTION_FAILED");
  assert.match(response.error?.message ?? "", /escaped the configured project root/u);
  assert.doesNotMatch(
    JSON.stringify(response),
    /SECRET_MARKER_SHOULD_NOT_LEAK/u
  );
});

test("mse tools reject symlinked interface discovery outside the project", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "mde-mse-interface-link-"));
  const outside = await mkdtemp(path.join(os.tmpdir(), "mde-mse-secret-"));
  temporaryRoots.push(root, outside);
  const linkedAssets = path.join(root, "assets");
  await writeFile(
    path.join(outside, "interface.json"),
    JSON.stringify({
      controller: [{ name: "Adb" }],
      task: [{ name: "SECRET_MARKER_SHOULD_NOT_LEAK", entry: "Start" }]
    }),
    "utf8"
  );
  try {
    await symlink(outside, linkedAssets, "junction");
  } catch {
    t.skip("platform does not permit creating a test directory symlink");
    return;
  }

  const calls = [
    {
      id: "mse-interface-link-preflight",
      name: "mse.project-preflight",
      arguments: { path: root }
    },
    {
      id: "mse-interface-link-resolve",
      name: "mse.resolve-tasks",
      arguments: { path: root, tasks: ["SECRET_MARKER_SHOULD_NOT_LEAK"] }
    }
  ];
  for (const call of calls) {
    const response = await handleRequest({
      id: call.id,
      apiVersion: "tool-adapter/v1",
      method: "tools/call",
      params: {
        name: call.name,
        arguments: call.arguments
      }
    });

    assert.equal(response.ok, false);
    assert.equal(response.error?.code, "TOOL_EXECUTION_FAILED");
    assert.match(response.error?.message ?? "", /escaped the configured project root/u);
    assert.doesNotMatch(
      JSON.stringify(response),
      /SECRET_MARKER_SHOULD_NOT_LEAK/u
    );
  }
});

test("mse.project-preflight rejects MaaAssistantArknights mode", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "mde-mse-maa-"));
  temporaryRoots.push(root);
  await mkdir(path.join(root, "src", "MaaCore"), { recursive: true });
  await writeFile(path.join(root, "interface.json"), "{}", "utf8");

  const response = await handleRequest({
    id: "mse-maa-1",
    apiVersion: "tool-adapter/v1",
    method: "tools/call",
    params: {
      name: "mse.project-preflight",
      arguments: { path: root }
    }
  });

  assert.equal(response.ok, true);
  const result = response.result as MseProjectPreflightResult;
  assert.equal(result.syntax_mode, "maa_unsupported");
  assert.equal(result.compatibility.status, "unsupported");
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
