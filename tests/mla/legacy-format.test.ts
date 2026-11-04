import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, expect, test } from "vitest";

import { inspectMla } from "../../src/index.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const PROCESS_HEADER = (version: string): string[] => [
  "[2026-07-19 10:00:00.000][DBG][Px1][Tx1][Logger] MAA Process Start",
  `[2026-07-19 10:00:00.001][DBG][Px1][Tx1][Logger] Version ${version}`,
];

/**
 * Mirrors the v4.x writer: an entry line carries the notify symbols and the message payload, and a
 * matching leave line repeats the symbol without a payload. Neither is the v5+ `!!!OnEventNotify!!!`
 * form the analyzer parses, so both lines are legacy-format markers only.
 */
function legacyNotification(timestamp: string, message: string): string[] {
  const position = `[Px1][Tx1][Utils/MessageNotifier.hpp][L19][MaaNS::MessageNotifier::notify]`;
  return [
    `[${timestamp}][DBG]${position} [notify_=000001C7FFB10FC0] [notify_trans_arg_=000001C79954ADB0] [msg=${message}] [details={"task_id":1,"entry":"Alpha"}]`,
    `[${timestamp}][TRC]${position} | leave, 0ms`,
  ];
}

function v5Event(timestamp: string, message: string, details: Record<string, unknown>): string {
  return `[${timestamp}][INF][Px1][Tx2][test] !!!OnEventNotify!!! [handle=1] [msg=${message}] [details=${JSON.stringify(details)}]`;
}

async function writeLog(root: string, name: string, lines: readonly string[]): Promise<string> {
  const log = path.join(root, name);
  await writeFile(log, lines.join("\n"), "utf8");
  return log;
}

test("warns about unparsed legacy v4.x MessageNotifier task events when no task was extracted", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "mek-mla-legacy-format-"));
  temporaryRoots.push(root);
  const log = await writeLog(root, "maa.log", [
    ...PROCESS_HEADER("v4.5.6"),
    ...legacyNotification("2026-07-19 10:01:00.000", "Tasker.Task.Starting"),
    ...legacyNotification("2026-07-19 10:01:05.000", "Tasker.Task.Succeeded"),
  ]);

  const result = await inspectMla(log);

  expect(result.statistics["tasks"]).toBe(0);
  const warning = result.warnings.find((item) => item.code === "mla_legacy_log_format_unsupported");
  expect(warning?.message).toBe(
    "Found 4 legacy-format v4.x MaaFramework log markers in 1 selected log target "
      + "(maa.log (v4.5.6)). v4.x MessageNotifier-style task events are not parsed by the current "
      + "framework log analyzer, so the task events this material contains were not extracted into "
      + "tasks. This is a format limitation, not proof that the run had no tasks: supplying v5+ logs "
      + "or upgrading MaaFramework is what produces task-level evidence.",
  );
  expect(result.missingEvidence.some((item) => item.code === "mla_legacy_log_format_unsupported"))
    .toBe(false);
  expect(result.details.selection.frameworkVersions).toEqual({
    status: "single",
    versions: ["v4.5.6"],
  });
  expect(result.details.selection.logGroups).toEqual([{
    label: "maa.log",
    versions: ["v4.5.6"],
    status: "single",
    sessions: 1,
    tasks: 0,
    legacyEventMarkers: 4,
  }]);
  expect(result.details.selection.logGroupsOmitted).toBeUndefined();
});

test("does not warn for v5-format logs and reports zero legacy markers", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "mek-mla-v5-format-"));
  temporaryRoots.push(root);
  const log = await writeLog(root, "maa.log", [
    ...PROCESS_HEADER("v5.12.2"),
    v5Event("2026-07-19 10:01:00.000", "Tasker.Task.Starting", {
      task_id: 1, entry: "Alpha", hash: "h1", uuid: "u1",
    }),
    v5Event("2026-07-19 10:01:01.000", "Tasker.Task.Succeeded", {
      task_id: 1, entry: "Alpha", hash: "h1", uuid: "u1",
    }),
  ]);

  const result = await inspectMla(log);

  expect(result.statistics["tasks"]).toBe(1);
  expect(result.warnings.some((item) => item.code === "mla_legacy_log_format_unsupported")).toBe(false);
  expect(result.missingEvidence.some((item) => item.code === "mla_legacy_log_format_unsupported"))
    .toBe(false);
  expect(result.details.selection.frameworkVersions).toEqual({
    status: "single",
    versions: ["v5.12.2"],
  });
  expect(result.details.selection.logGroups).toEqual([{
    label: "maa.log",
    versions: ["v5.12.2"],
    status: "single",
    sessions: 1,
    tasks: 1,
    legacyEventMarkers: 0,
  }]);
});

test("aggregates versions across targets without dropping the legacy group", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "mek-mla-mixed-format-"));
  temporaryRoots.push(root);
  await writeLog(root, "maa-v4.5.3.log", [
    ...PROCESS_HEADER("v4.5.3"),
    ...legacyNotification("2026-07-19 10:01:00.000", "Tasker.Task.Starting"),
  ]);
  await writeLog(root, "maa-v5.2.2.log", [
    ...PROCESS_HEADER("v5.2.2"),
    v5Event("2026-07-19 10:02:00.000", "Tasker.Task.Starting", {
      task_id: 2, entry: "Beta", hash: "h2", uuid: "u2",
    }),
    v5Event("2026-07-19 10:02:01.000", "Tasker.Task.Succeeded", {
      task_id: 2, entry: "Beta", hash: "h2", uuid: "u2",
    }),
  ]);

  const result = await inspectMla(root);

  expect(result.statistics["tasks"]).toBe(1);
  expect(result.details.selection.frameworkVersions).toEqual({
    status: "multiple",
    versions: ["v4.5.3", "v5.2.2"],
  });
  expect(result.details.selection.logGroups).toEqual([
    {
      label: "maa-v4.5.3.log",
      versions: ["v4.5.3"],
      status: "single",
      sessions: 1,
      tasks: 0,
      legacyEventMarkers: 2,
    },
    {
      label: "maa-v5.2.2.log",
      versions: ["v5.2.2"],
      status: "single",
      sessions: 1,
      tasks: 1,
      legacyEventMarkers: 0,
    },
  ]);
  // A parsed task exists somewhere in the material, so the empty task counter is not explained by
  // the legacy format.
  expect(result.warnings.some((item) => item.code === "mla_legacy_log_format_unsupported")).toBe(false);
});

test("caps reported log groups at 20 and reports the omitted count", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "mek-mla-log-group-cap-"));
  temporaryRoots.push(root);
  await mkdir(root, { recursive: true });
  for (let index = 0; index < 21; index += 1) {
    const name = `run-${String(index).padStart(2, "0")}.log`;
    await writeLog(root, name, [
      ...PROCESS_HEADER("v5.12.2"),
      v5Event(`2026-07-19 10:${String(index).padStart(2, "0")}:00.000`, "Tasker.Task.Starting", {
        task_id: index + 1, entry: `Task${index}`, hash: `h${index}`, uuid: `u${index}`,
      }),
      v5Event(`2026-07-19 10:${String(index).padStart(2, "0")}:01.000`, "Tasker.Task.Succeeded", {
        task_id: index + 1, entry: `Task${index}`, hash: `h${index}`, uuid: `u${index}`,
      }),
    ]);
  }

  const result = await inspectMla(root);

  expect(result.details.selection.logGroups).toHaveLength(20);
  expect(result.details.selection.logGroups.map((group) => group.label)).toEqual(
    Array.from({ length: 20 }, (_, index) => `run-${String(index).padStart(2, "0")}.log`),
  );
  expect(result.details.selection.logGroupsOmitted).toBe(1);
});

test("does not claim a legacy-format limitation for a timed inspection", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "mek-mla-legacy-window-"));
  temporaryRoots.push(root);
  const log = await writeLog(root, "maa.log", [
    ...PROCESS_HEADER("v4.5.6"),
    ...legacyNotification("2026-07-19 10:01:00.000", "Tasker.Task.Starting"),
  ]);

  // The window keeps the session boundary but no task; the legacy-format verdict describes the
  // whole material, so it must not fire here even though the task counter is 0.
  const windowed = await inspectMla(log, {
    timeRange: { from: "2026-07-19T10:00:00.000", to: "2026-07-19T10:00:01.000" },
  });

  expect(windowed.warnings.some((item) => item.code === "mla_legacy_log_format_unsupported"))
    .toBe(false);
  // The untimed inspection of the same material does fire.
  const untimed = await inspectMla(log);
  expect(untimed.warnings.some((item) => item.code === "mla_legacy_log_format_unsupported"))
    .toBe(true);
});
