import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, expect, test, vi } from "vitest";

import { runWithAutomaticUpdates } from "../../src/cli/auto-update.js";
import { MAA_EVIDENCE_VERSION } from "../../src/version.js";

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
    isInteractive: () => true,
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
    isInteractive: () => true,
    runCommand,
  })).resolves.toBe(0);
  expect(fetchLatestVersion).not.toHaveBeenCalled();
  expect(runCommand).not.toHaveBeenCalled();
});

test("a newer registry version receives the original command through an exact npm handoff", async () => {
  const directory = await temporaryConfigDirectory();
  const calls: Array<{ args: string[]; inheritStdio: boolean; timeoutMs?: number }> = [];
  const environments: NodeJS.ProcessEnv[] = [];
  const runCommand = vi.fn(async (args: string[], options: { inheritStdio: boolean; timeoutMs?: number; environment: NodeJS.ProcessEnv }) => {
    calls.push({
      args,
      inheritStdio: options.inheritStdio,
      ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
    });
    environments.push(options.environment);
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
    isInteractive: () => true,
    now: () => new Date("2026-08-09T12:00:00.000Z"),
    runCommand,
    runSkillCommand,
  })).resolves.toBe(7);
  expect(runLocal).not.toHaveBeenCalled();
  expect(calls).toHaveLength(2);
  expect(calls[0]?.args).toContain("--package=maa-evidence-kit@0.2.0");
  expect(calls[0]?.args).toContain("--loglevel=error");
  // The probe and the handoff run under the alias bin: a same-name global shim would otherwise
  // answer for the pinned version on exactly the machines that need the update.
  expect(calls[0]?.args[calls[0]?.args.indexOf("--") + 1]).toBe("maa-evidence-probe");
  // The probe is ours, so it is captured and bounded.
  expect(calls[0]?.inheritStdio).toBe(false);
  expect(calls[0]?.timeoutMs).toBeDefined();
  // The handoff is the caller's command: it owns both streams and must not be killed by us.
  expect(calls[1]?.args.slice(-2)).toEqual(["inspect", "materials"]);
  expect(calls[1]?.args[calls[1]?.args.indexOf("--") + 1]).toBe("maa-evidence-probe");
  expect(calls[1]?.inheritStdio).toBe(true);
  expect(calls[1]?.timeoutMs).toBeUndefined();
  // The child learns the base version so it can disclose the handoff on stderr.
  expect(environments[1]?.MAA_EVIDENCE_UPDATE_HANDOFF).toBe("1");
  expect(environments[1]?.MAA_EVIDENCE_UPDATE_HANDOFF_FROM).toBe("0.1.1");
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
    isInteractive: () => true,
    runSkillCommand,
  })).resolves.toBe(5);
  expect(fetchLatestVersion).not.toHaveBeenCalled();
  expect(runSkillCommand).toHaveBeenCalledOnce();
});

test("a handed-off command names its actual version and its origin on stderr", async () => {
  const diagnostics: string[] = [];
  const runLocal = vi.fn(async () => 0);

  await expect(runWithAutomaticUpdates(["--version"], runLocal, {
    currentVersion: MAA_EVIDENCE_VERSION,
    environment: {
      MAA_EVIDENCE_UPDATE_HANDOFF: "1",
      MAA_EVIDENCE_UPDATE_HANDOFF_FROM: "0.7.0",
    },
    isInteractive: () => false,
    writeDiagnostic: (message: string) => diagnostics.push(message),
  })).resolves.toBe(0);
  // The line rides on stderr before anything runs, `--version` included, so a mixed install
  // cannot pass its handed-off answer off as the global install's feature level.
  expect(diagnostics.join("\n")).toContain(
    `running ${MAA_EVIDENCE_VERSION} (handed off from 0.7.0)`,
  );
  expect(diagnostics.join("\n")).toContain("the global install may still be at 0.7.0.");
  expect(runLocal).toHaveBeenCalledWith(["--version"]);
});

test("a plain command and an unprefixed handoff print no version line", async () => {
  const diagnostics: string[] = [];
  const runLocal = vi.fn(async () => 0);
  const base = {
    currentVersion: MAA_EVIDENCE_VERSION,
    isInteractive: () => false,
    writeDiagnostic: (message: string) => diagnostics.push(message),
  };

  await expect(runWithAutomaticUpdates(["--version"], runLocal, {
    ...base,
    environment: {},
  })).resolves.toBe(0);
  await expect(runWithAutomaticUpdates(["--version"], runLocal, {
    ...base,
    // The handoff marker without a base version cannot describe anything.
    environment: { MAA_EVIDENCE_UPDATE_HANDOFF: "1" },
  })).resolves.toBe(0);
  expect(diagnostics).toHaveLength(0);
  expect(runLocal).toHaveBeenCalledTimes(2);
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
    isInteractive: () => true,
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
    isInteractive: () => true,
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
    isInteractive: () => true,
    now: () => new Date(),
    runCommand,
  })).resolves.toBe(6);
  expect(fetchLatestVersion).not.toHaveBeenCalled();
  expect(runCommand).not.toHaveBeenCalled();
});

test("a non-interactive caller never checks the registry, probes, or synchronizes the Skill", async () => {
  const directory = await temporaryConfigDirectory();
  const fetchLatestVersion = vi.fn(async () => "0.2.0");
  const runCommand = vi.fn();
  const runSkillCommand = vi.fn();
  const runLocal = vi.fn(async () => 8);

  await expect(runWithAutomaticUpdates(["mla", "inspect", "logs"], runLocal, {
    configDirectory: directory,
    currentVersion: "0.1.1",
    environment: {},
    fetchLatestVersion,
    isInteractive: () => false,
    runCommand,
    runSkillCommand,
  })).resolves.toBe(8);
  expect(fetchLatestVersion).not.toHaveBeenCalled();
  expect(runCommand).not.toHaveBeenCalled();
  expect(runSkillCommand).not.toHaveBeenCalled();
  expect(runLocal).toHaveBeenCalledWith(["mla", "inspect", "logs"]);
});

test("an explicit opt-in updates without an interactive terminal", async () => {
  const directory = await temporaryConfigDirectory();
  const runSkillCommand = vi.fn(async () => ({
    spawned: true,
    exitCode: 0,
    stdout: "",
    stderr: "",
  }));
  const fetchLatestVersion = vi.fn(async () => "0.2.0");
  const runLocal = vi.fn(async () => 9);

  await expect(runWithAutomaticUpdates(["view", "--input", "result.json"], runLocal, {
    configDirectory: directory,
    currentVersion: "0.2.0",
    environment: { MAA_EVIDENCE_AUTO_UPDATE: "1" },
    fetchLatestVersion,
    isInteractive: () => false,
    runSkillCommand,
  })).resolves.toBe(9);
  expect(fetchLatestVersion).toHaveBeenCalledOnce();
  expect(runSkillCommand).toHaveBeenCalledOnce();
});

test("a failed probe is not repeated until its suppression window expires", async () => {
  const directory = await temporaryConfigDirectory();
  const runCommand = vi.fn(async () => ({
    spawned: true,
    exitCode: 0,
    stdout: "0.1.0\n",
    stderr: "",
  }));
  const runLocal = vi.fn(async () => 2);
  let now = new Date("2026-08-09T12:00:00.000Z");
  const options = {
    configDirectory: directory,
    currentVersion: "0.1.1",
    environment: {},
    fetchLatestVersion: async () => "0.2.0",
    countReleasesBehind: async () => undefined,
    isInteractive: () => true,
    now: () => now,
    runCommand,
    runSkillCommand: async () => ({ spawned: true, exitCode: 0, stdout: "", stderr: "" }),
    writeDiagnostic: () => undefined,
  };

  await expect(runWithAutomaticUpdates(["inspect", "materials"], runLocal, options)).resolves.toBe(2);
  expect(runCommand).toHaveBeenCalledOnce();

  now = new Date("2026-08-09T18:00:00.000Z");
  await expect(runWithAutomaticUpdates(["inspect", "materials"], runLocal, options)).resolves.toBe(2);
  expect(runCommand).toHaveBeenCalledOnce();

  now = new Date("2026-08-10T18:00:00.000Z");
  await expect(runWithAutomaticUpdates(["inspect", "materials"], runLocal, options)).resolves.toBe(2);
  expect(runCommand).toHaveBeenCalledTimes(2);
});

test("a failed npm probe reports its output only when debugging is requested", async () => {
  const directory = await temporaryConfigDirectory();
  const runCommand = vi.fn(async () => ({
    spawned: true,
    exitCode: 0,
    stdout: "0.1.0\n",
    stderr: "npm error 404 Not Found - maa-evidence-kit@0.2.0\n",
  }));
  const runLocal = vi.fn(async () => 0);
  const base = {
    configDirectory: directory,
    currentVersion: "0.1.1",
    fetchLatestVersion: async () => "0.2.0",
    countReleasesBehind: async () => undefined,
    isInteractive: () => true,
    now: () => new Date("2026-08-09T12:00:00.000Z"),
    runCommand,
    runSkillCommand: async () => ({ spawned: true, exitCode: 0, stdout: "", stderr: "" }),
  };

  const quiet: string[] = [];
  await expect(runWithAutomaticUpdates(["inspect", "materials"], runLocal, {
    ...base,
    environment: {},
    writeDiagnostic: (message: string) => quiet.push(message),
  })).resolves.toBe(0);
  expect(quiet.join("\n")).toContain("could not be prepared");
  expect(quiet.join("\n")).toContain(
    "install is behind (running 0.1.1, latest 0.2.0); run: npm i -g maa-evidence-kit@0.2.0",
  );
  expect(quiet.join("\n")).not.toContain("npm error 404");

  const debug: string[] = [];
  await expect(runWithAutomaticUpdates(["inspect", "materials"], runLocal, {
    ...base,
    // A fresh config directory: the first run remembered this failed probe for 24 hours.
    configDirectory: await temporaryConfigDirectory(),
    environment: { MAA_EVIDENCE_DEBUG: "1" },
    writeDiagnostic: (message: string) => debug.push(message),
  })).resolves.toBe(0);
  expect(debug.join("\n")).toContain("npm error 404");
});

test("a shadowed probe states the way out once and stays quiet until its window expires", async () => {
  const directory = await temporaryConfigDirectory();
  const diagnostics: string[] = [];
  const runCommand = vi.fn(async () => ({
    // Whatever version the probe pins, the command name answers with the stale copy: the shape of
    // a machine where an old global install shadows npm exec's command-name resolution.
    spawned: true,
    exitCode: 0,
    stdout: "0.8.0\n",
    stderr: "",
  }));
  const runLocal = vi.fn(async () => 2);
  let now = new Date("2026-09-27T12:00:00.000Z");
  const options = {
    configDirectory: directory,
    currentVersion: "0.8.0",
    environment: {},
    fetchLatestVersion: async () => "0.9.0",
    countReleasesBehind: async () => 1,
    isInteractive: () => true,
    now: () => now,
    runCommand,
    runSkillCommand: async () => ({ spawned: true, exitCode: 0, stdout: "", stderr: "" }),
    writeDiagnostic: (message: string) => diagnostics.push(message),
  };

  await expect(runWithAutomaticUpdates(["inspect", "materials"], runLocal, options)).resolves.toBe(2);
  await expect(runWithAutomaticUpdates(["inspect", "materials"], runLocal, options)).resolves.toBe(2);
  // One paid attempt, one hint: the failure is remembered for the whole window instead of paying
  // the probe again on every call.
  expect(runCommand).toHaveBeenCalledOnce();
  expect(diagnostics.filter((message) => message.includes("install is"))).toHaveLength(1);
  expect(diagnostics.join("\n")).toContain(
    "install is 1 release behind (running 0.8.0, latest 0.9.0); run: npm i -g maa-evidence-kit@0.9.0",
  );

  diagnostics.length = 0;
  now = new Date("2026-09-28T12:00:00.001Z");
  await expect(runWithAutomaticUpdates(["inspect", "materials"], runLocal, options)).resolves.toBe(2);
  expect(runCommand).toHaveBeenCalledTimes(2);
  expect(diagnostics.filter((message) => message.includes("install is"))).toHaveLength(1);
});

test("a handoff that cannot start hints once per window without caching the probe as failed", async () => {
  const directory = await temporaryConfigDirectory();
  const diagnostics: string[] = [];
  const runCommand = vi.fn(async (args: string[]) =>
    args.at(-1) === "--version"
      ? { spawned: true, exitCode: 0, stdout: "0.9.0\n", stderr: "" }
      : { spawned: false, exitCode: null, stdout: "", stderr: "" });
  const runLocal = vi.fn(async () => 0);
  const options = {
    configDirectory: directory,
    currentVersion: "0.8.0",
    environment: {},
    fetchLatestVersion: async () => "0.9.0",
    countReleasesBehind: async () => 2,
    isInteractive: () => true,
    now: () => new Date("2026-09-27T12:00:00.000Z"),
    runCommand,
    runSkillCommand: async () => ({ spawned: true, exitCode: 0, stdout: "", stderr: "" }),
    writeDiagnostic: (message: string) => diagnostics.push(message),
  };

  await expect(runWithAutomaticUpdates(["inspect", "materials"], runLocal, options)).resolves.toBe(1);
  await expect(runWithAutomaticUpdates(["inspect", "materials"], runLocal, options)).resolves.toBe(1);
  // The probe succeeded, so no probe-failure cache exists; the hint's own timestamp is what keeps
  // the second failed handoff from repeating it.
  expect(diagnostics.filter((message) => message.includes("install is"))).toHaveLength(1);
  expect(diagnostics.join("\n")).toContain(
    "install is 2 releases behind (running 0.8.0, latest 0.9.0); run: npm i -g maa-evidence-kit@0.9.0",
  );
  expect(runLocal).not.toHaveBeenCalled();
});

test("a runtime ahead of the published version does not install the published Skill", async () => {
  const directory = await temporaryConfigDirectory();
  const runSkillCommand = vi.fn(async () => ({
    spawned: true,
    exitCode: 0,
    stdout: "",
    stderr: "",
  }));
  const runLocal = vi.fn(async () => 0);

  await expect(runWithAutomaticUpdates(["inspect", "materials"], runLocal, {
    configDirectory: directory,
    currentVersion: "0.3.0",
    environment: {},
    fetchLatestVersion: async () => "0.2.0",
    isInteractive: () => true,
    now: () => new Date("2026-08-09T12:00:00.000Z"),
    runSkillCommand,
  })).resolves.toBe(0);
  expect(runSkillCommand).not.toHaveBeenCalled();
  const state = JSON.parse(
    await readFile(path.join(directory, "updates.json"), "utf8"),
  ) as Record<string, unknown>;
  expect(state["skillSyncVersion"]).toBeUndefined();
});

test("local Skill inspection never detours through the updater", async () => {
  const directory = await temporaryConfigDirectory();
  const fetchLatestVersion = vi.fn(async () => "0.2.0");
  const runCommand = vi.fn();
  const runLocal = vi.fn(async () => 0);

  await expect(runWithAutomaticUpdates(["skill", "--print"], runLocal, {
    configDirectory: directory,
    currentVersion: "0.1.1",
    environment: {},
    fetchLatestVersion,
    isInteractive: () => true,
    runCommand,
  })).resolves.toBe(0);
  expect(fetchLatestVersion).not.toHaveBeenCalled();
  expect(runCommand).not.toHaveBeenCalled();
});
