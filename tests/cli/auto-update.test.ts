import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, expect, test, vi } from "vitest";

import { runWithAutomaticUpdates } from "../../src/cli/auto-update.js";

const roots: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map(async (root) => {
    await import("node:fs/promises").then(({ rm }) => rm(root, { recursive: true, force: true }));
  }));
});

async function temporaryConfigDirectory(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "maa-evidence-updates-"));
  roots.push(root);
  return root;
}

test("disabled automatic updates run the local CLI without network or subprocesses", async () => {
  const fetchLatestVersion = vi.fn<() => Promise<string | undefined>>();
  const runCommand = vi.fn();
  const runLocal = vi.fn(async () => 4);

  await expect(runWithAutomaticUpdates(["--version"], runLocal, {
    environment: { MAA_EVIDENCE_AUTO_UPDATE: "0" },
    fetchLatestVersion,
    runCommand,
  })).resolves.toBe(4);
  expect(fetchLatestVersion).not.toHaveBeenCalled();
  expect(runCommand).not.toHaveBeenCalled();
  expect(runLocal).toHaveBeenCalledWith(["--version"]);
});

test("CI disables automatic updates unless explicitly enabled", async () => {
  const fetchLatestVersion = vi.fn<() => Promise<string | undefined>>();
  const runCommand = vi.fn();
  const runLocal = vi.fn(async () => 0);

  await expect(runWithAutomaticUpdates(["inspect", "materials"], runLocal, {
    environment: { CI: "true" },
    fetchLatestVersion,
    runCommand,
  })).resolves.toBe(0);
  expect(fetchLatestVersion).not.toHaveBeenCalled();
  expect(runCommand).not.toHaveBeenCalled();
});

test("a newer registry version receives the original command through an exact npm handoff", async () => {
  const directory = await temporaryConfigDirectory();
  const calls: Array<{ args: string[]; inheritStdio: boolean }> = [];
  const runCommand = vi.fn(async (args: string[], options: { inheritStdio: boolean }) => {
    calls.push({ args, inheritStdio: options.inheritStdio });
    if (args.at(-1) === "--version") {
      return { spawned: true, exitCode: 0, stdout: "0.2.0\n", stderr: "" };
    }
    return { spawned: true, exitCode: 7, stdout: "", stderr: "" };
  });
  const runSkillCommand = vi.fn(async (args: string[], options: { inheritStdio: boolean }) => {
    calls.push({ args, inheritStdio: options.inheritStdio });
    return { spawned: true, exitCode: 0, stdout: "Already up to date.\n", stderr: "" };
  });
  const runLocal = vi.fn(async () => 0);

  await expect(runWithAutomaticUpdates(["inspect", "materials"], runLocal, {
    configDirectory: directory,
    currentVersion: "0.1.1",
    environment: {},
    fetchLatestVersion: async () => "0.2.0",
    now: () => new Date("2026-08-09T12:00:00.000Z"),
    runCommand,
    runSkillCommand,
  })).resolves.toBe(7);
  expect(runLocal).not.toHaveBeenCalled();
  expect(calls).toHaveLength(2);
  expect(calls[0]?.args).toContain("--package=maa-evidence-kit@0.2.0");
  expect(calls[0]?.inheritStdio).toBe(false);
  expect(calls[1]?.args.slice(-2)).toEqual(["inspect", "materials"]);
  expect(calls[1]?.inheritStdio).toBe(true);
  expect(runSkillCommand).not.toHaveBeenCalled();
});

test("the handed-off runtime skips a second registry check and synchronizes its Skill", async () => {
  const directory = await temporaryConfigDirectory();
  const fetchLatestVersion = vi.fn<() => Promise<string | undefined>>();
  const runSkillCommand = vi.fn(async () => ({
    spawned: true,
    exitCode: 0,
    stdout: "Already up to date.\n",
    stderr: "",
  }));
  const runLocal = vi.fn(async () => 5);

  await expect(runWithAutomaticUpdates(["inspect", "materials"], runLocal, {
    configDirectory: directory,
    currentVersion: "0.2.0",
    environment: { MAA_EVIDENCE_UPDATE_HANDOFF: "1" },
    fetchLatestVersion,
    runSkillCommand,
  })).resolves.toBe(5);
  expect(fetchLatestVersion).not.toHaveBeenCalled();
  expect(runSkillCommand).toHaveBeenCalledOnce();
});

test("the current runtime updates the managed global Skill once per version", async () => {
  const directory = await temporaryConfigDirectory();
  const environments: NodeJS.ProcessEnv[] = [];
  const runSkillCommand = vi.fn(async (_args: string[], options: {
    environment: NodeJS.ProcessEnv;
    inheritStdio: boolean;
  }) => {
    environments.push(options.environment);
    return {
      spawned: true,
      exitCode: 0,
      stdout: "Already up to date.\n",
      stderr: "",
    };
  });
  const fetchLatestVersion = vi.fn(async () => "0.2.0");
  const runLocal = vi.fn(async () => 0);
  const options = {
    configDirectory: directory,
    currentVersion: "0.2.0",
    environment: {},
    fetchLatestVersion,
    now: () => new Date("2026-08-09T12:00:00.000Z"),
    runSkillCommand,
  };

  await expect(runWithAutomaticUpdates(["mla", "inspect", "logs"], runLocal, options)).resolves.toBe(0);
  await expect(runWithAutomaticUpdates(["view", "--input", "result.json"], runLocal, options)).resolves.toBe(0);

  expect(fetchLatestVersion).toHaveBeenCalledTimes(1);
  expect(runSkillCommand).toHaveBeenCalledOnce();
  const commands = runSkillCommand.mock.calls.map(([args]) => args as string[]);
  expect(commands[0]).toContain("--package=skills@1.5.22");
  expect(commands[0]).toContain("--global");
  expect(
    environments.every((environment) => environment["DISABLE_TELEMETRY"] === "1"),
  ).toBe(true);
  const state = JSON.parse(
    await readFile(path.join(directory, "updates.json"), "utf8"),
  ) as Record<string, unknown>;
  expect(state["latestVersion"]).toBe("0.2.0");
  expect(state["skillSyncVersion"]).toBe("0.2.0");
});

test("registry and Skill updater failures fall back to the local CLI", async () => {
  const directory = await temporaryConfigDirectory();
  const diagnostics: string[] = [];
  const runSkillCommand = vi.fn(async () => ({
    spawned: false,
    exitCode: null,
    stdout: "",
    stderr: "",
  }));
  const runLocal = vi.fn(async () => 3);

  const options = {
    configDirectory: directory,
    currentVersion: "0.2.0",
    environment: {},
    fetchLatestVersion: async () => undefined,
    now: () => new Date("2026-08-09T12:00:00.000Z"),
    runSkillCommand,
    writeDiagnostic: (message: string) => diagnostics.push(message),
  };
  await expect(
    runWithAutomaticUpdates(["mse", "inspect", "project"], runLocal, options),
  ).resolves.toBe(3);
  await expect(
    runWithAutomaticUpdates(["mse", "inspect", "project"], runLocal, options),
  ).resolves.toBe(3);
  expect(runLocal).toHaveBeenCalledTimes(2);
  expect(runSkillCommand).toHaveBeenCalledOnce();
  expect(diagnostics.join("\n")).toContain("continuing with the installed Skill");
});

test("an active updater lock lets concurrent commands use the local runtime immediately", async () => {
  const directory = await temporaryConfigDirectory();
  await writeFile(path.join(directory, "updates.lock"), "another-process\n", "utf8");
  const fetchLatestVersion = vi.fn<() => Promise<string | undefined>>();
  const runCommand = vi.fn();
  const runLocal = vi.fn(async () => 6);

  await expect(runWithAutomaticUpdates(["view", "--input", "result.json"], runLocal, {
    configDirectory: directory,
    environment: {},
    fetchLatestVersion,
    now: () => new Date(),
    runCommand,
  })).resolves.toBe(6);
  expect(fetchLatestVersion).not.toHaveBeenCalled();
  expect(runCommand).not.toHaveBeenCalled();
});
