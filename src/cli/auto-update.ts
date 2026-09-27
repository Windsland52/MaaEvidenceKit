import { mkdir, open, readFile, readdir, rename, stat, unlink, writeFile, type FileHandle } from "node:fs/promises";
import path from "node:path";

import spawn from "cross-spawn";
import { gt, prerelease, valid } from "semver";

import { maaEvidenceConfigDirectory } from "../config.js";
import { MAA_EVIDENCE_VERSION } from "../version.js";

const UPDATE_STATE_SCHEMA_VERSION = "maa-evidence-updates/v1" as const;
const UPDATE_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
const UPDATE_REQUEST_TIMEOUT_MS = 1500;
const UPDATE_LOCK_STALE_MS = 10 * 60 * 1000;
const UPDATE_SUBPROCESS_TIMEOUT_MS = 2 * 60 * 1000;
const DEBUG_NPM_VERSION_TIMEOUT_MS = 10_000;
const HANDOFF_MARKER_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const CAPTURE_LIMIT_CHARACTERS = 64 * 1024;
const REGISTRY_LATEST_URL = "https://registry.npmjs.org/maa-evidence-kit/latest";
const REGISTRY_PACKUMENT_URL = "https://registry.npmjs.org/maa-evidence-kit";
const PACKUMENT_ACCEPT = "application/vnd.npm.install-v1+json";
const SKILLS_CLI_VERSION = "1.5.22";
const HANDOFF_ENVIRONMENT_KEY = "MAA_EVIDENCE_UPDATE_HANDOFF";
const HANDOFF_FROM_ENVIRONMENT_KEY = "MAA_EVIDENCE_UPDATE_HANDOFF_FROM";
const HANDOFF_MARKER_ENVIRONMENT_KEY = "MAA_EVIDENCE_UPDATE_HANDOFF_MARKER";
const PROBE_ENVIRONMENT_KEY = "MAA_EVIDENCE_UPDATE_PROBE";
const DEBUG_ENVIRONMENT_KEY = "MAA_EVIDENCE_DEBUG";
const AUTO_UPDATE_ENVIRONMENT_KEY = "MAA_EVIDENCE_AUTO_UPDATE";

/**
 * The bin name the update probe and the version handoff run under.
 *
 * The alias exists because a probe under the `maa-evidence` name was observed answering a stale
 * global shim (a host with 0.6.0 installed printed the stale 0.6.0 twice for a newer-version
 * probe), exactly on the machines that need an update. How npm produced that answer was never
 * pinned down - under the measured rules below the pinned copy usually wins when it ships the
 * name - but the alias removes the whole class: no release older than the alias ships a
 * `maa-evidence-probe` bin, so a legacy global shim cannot answer for this name under any of them.
 *
 * The alias bin and the alias-using probe ship in the same release on purpose, and the bin has to
 * stay in the package map for every later release: a parent whose code probes this name always
 * targets a version newer than itself, so the target only ships the bin while this holds. Dropping
 * or renaming the bin while older alias-using releases are still live would dead-end their probes
 * on bin-less targets - a hard probe failure wherever no shim answers.
 *
 * The alias is defense in depth, not the correctness argument: npm's command-name resolution is an
 * uncontrolled variable (measured on npm 10-12: the pinned copy answers when it ships the name,
 * PATH is consulted when it does not, and a failed install is a hard error), so the handoff is
 * verified by the marker the child writes, and a wrong or missing marker falls back to the behind
 * hint regardless of how the name resolved. One measured exception, relevant only to dev checkouts:
 * when the current directory's own package.json matches the probed name@version, npm exec skips
 * the scratch install and resolves through the inherited PATH instead.
 */
const PROBE_BIN = "maa-evidence-probe";

/** Commands whose whole purpose is local, version-exact behavior: never worth an update detour. */
const UPDATE_EXEMPT_COMMANDS = new Set(["telemetry", "feedback", "skill"]);

type UpdateState = {
  schemaVersion: typeof UPDATE_STATE_SCHEMA_VERSION;
  checkedAt?: string;
  latestVersion?: string;
  /**
   * The last version whose npm probe failed, and when. Without this a probe that keeps failing
   * (for example when `npm exec` resolves a different global binary) would pay its full
   * subprocess cost on every single invocation.
   */
  probeAttemptedVersion?: string;
  probeAttemptedAt?: string;
  /**
   * The last time the behind hint was printed. The hint is the caller's one clear way out when the
   * running install cannot be replaced this round, so it is throttled on its own clock: it can
   * also fire from the handoff path, which a successful probe does not put behind the probe
   * failure cache.
   */
  behindHintAt?: string;
  skillSyncVersion?: string;
  skillSyncAttemptedAt?: string;
  skillSyncAttemptedVersion?: string;
};

/**
 * What a handed-off command records about itself before anything runs. The parent compares
 * `version` against the handoff target after the command exits; the other fields are context for a
 * human inspecting the file. Versions, a process ID, and a timestamp only - never uploaded.
 */
type HandoffMarker = {
  version: string;
  base?: string;
  pid: number;
  timestamp: string;
};

/** What the parent learns from the marker after the handed-off command exits. */
type HandoffOutcome = {
  spawned: boolean;
  exitCode: number | null;
  /** The version the marker recorded, or undefined when the marker is missing or unreadable. */
  ranVersion: string | undefined;
};

type CommandOptions = {
  environment: NodeJS.ProcessEnv;
  /**
   * Forward the child's stdout and stderr instead of capturing them.
   *
   * Only the version handoff uses this: that child is the caller's own command running from another
   * install, so its streams are the caller's streams. Its diagnostics must arrive in real time and
   * unmodified - a handed-off command that fails has to look exactly like a local failure - and
   * npm's own `notice` lines are suppressed with `--loglevel=error` so inheriting stderr stays
   * clean. Capturing them here instead would silently swallow every error the handed-off command
   * prints.
   */
  inheritStdio: boolean;
  timeoutMs?: number;
};

type CommandResult = {
  spawned: boolean;
  exitCode: number | null;
  stdout: string;
  stderr: string;
};

type AutoUpdateDependencies = {
  configDirectory?: string;
  currentVersion?: string;
  /**
   * Count the stable releases between the running version and the published latest, for the
   * behind hint. Defaults to the registry packument fetch; any failure returns undefined.
   */
  countReleasesBehind?: (
    currentVersion: string,
    latestVersion: string,
  ) => Promise<number | undefined>;
  environment?: NodeJS.ProcessEnv;
  fetchLatestVersion?: () => Promise<string | undefined>;
  /**
   * Whether this invocation may spend time on update work. Defaults to the real stdout TTY check,
   * so an agent or a piped command never pays for a probe it did not ask for.
   */
  isInteractive?: () => boolean;
  now?: () => Date;
  runCommand?: (args: string[], options: CommandOptions) => Promise<CommandResult>;
  runSkillCommand?: (args: string[], options: CommandOptions) => Promise<CommandResult>;
  writeDiagnostic?: (message: string) => void;
};

function updateStatePath(directory: string): string {
  return path.join(directory, "updates.json");
}

function updateLockPath(directory: string): string {
  return path.join(directory, "updates.lock");
}

function handoffMarkerPath(directory: string, now: Date): string {
  return path.join(directory, `handoff-${process.pid}-${now.getTime()}.json`);
}

/**
 * Only files of this exact parent-generated shape are ever swept - the marker, or a child's
 * temporary file that a death between write and rename left behind. Nothing else in the config
 * directory is touched.
 */
const HANDOFF_MARKER_FILE = /^handoff-\d+-\d+\.json(?:\.\d+\.tmp)?$/;

async function acquireUpdateLock(
  directory: string,
  now: Date,
): Promise<(() => Promise<void>) | undefined> {
  await mkdir(directory, { recursive: true }).catch(() => undefined);
  const lockPath = updateLockPath(directory);
  let handle: FileHandle;
  try {
    handle = await open(lockPath, "wx", 0o600);
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") return undefined;
    try {
      const lockStat = await stat(lockPath);
      if (now.getTime() - lockStat.mtimeMs < UPDATE_LOCK_STALE_MS) return undefined;
      await unlink(lockPath);
      handle = await open(lockPath, "wx", 0o600);
    } catch {
      return undefined;
    }
  }
  await handle.writeFile(`${process.pid}\n`, "utf8").catch(() => undefined);
  let released = false;
  return async () => {
    if (released) return;
    released = true;
    await handle.close().catch(() => undefined);
    await unlink(lockPath).catch(() => undefined);
  };
}

async function readUpdateState(directory: string): Promise<UpdateState> {
  try {
    const value: unknown = JSON.parse(await readFile(updateStatePath(directory), "utf8"));
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return { schemaVersion: UPDATE_STATE_SCHEMA_VERSION };
    }
    const record = value as Record<string, unknown>;
    if (record["schemaVersion"] !== UPDATE_STATE_SCHEMA_VERSION) {
      return { schemaVersion: UPDATE_STATE_SCHEMA_VERSION };
    }
    return {
      schemaVersion: UPDATE_STATE_SCHEMA_VERSION,
      ...(typeof record["checkedAt"] === "string" ? { checkedAt: record["checkedAt"] } : {}),
      ...(typeof record["latestVersion"] === "string"
        ? { latestVersion: record["latestVersion"] }
        : {}),
      ...(typeof record["probeAttemptedVersion"] === "string"
        ? { probeAttemptedVersion: record["probeAttemptedVersion"] }
        : {}),
      ...(typeof record["probeAttemptedAt"] === "string"
        ? { probeAttemptedAt: record["probeAttemptedAt"] }
        : {}),
      ...(typeof record["behindHintAt"] === "string"
        ? { behindHintAt: record["behindHintAt"] }
        : {}),
      ...(typeof record["skillSyncVersion"] === "string"
        ? { skillSyncVersion: record["skillSyncVersion"] }
        : {}),
      ...(typeof record["skillSyncAttemptedAt"] === "string"
        ? { skillSyncAttemptedAt: record["skillSyncAttemptedAt"] }
        : {}),
      ...(typeof record["skillSyncAttemptedVersion"] === "string"
        ? { skillSyncAttemptedVersion: record["skillSyncAttemptedVersion"] }
        : {}),
    };
  } catch {
    return { schemaVersion: UPDATE_STATE_SCHEMA_VERSION };
  }
}

async function writeUpdateState(directory: string, state: UpdateState): Promise<void> {
  try {
    await mkdir(directory, { recursive: true });
    await writeFile(updateStatePath(directory), `${JSON.stringify(state, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
  } catch {
    // Update bookkeeping must never block evidence extraction.
  }
}

function fresh(timestamp: string | undefined, now: Date): boolean {
  if (timestamp === undefined) return false;
  const checkedAt = Date.parse(timestamp);
  const age = now.getTime() - checkedAt;
  return Number.isFinite(checkedAt) && age >= 0 && age < UPDATE_CHECK_INTERVAL_MS;
}

/**
 * Record that the behind hint is about to print, and report whether this invocation owns it.
 *
 * The handoff runs for minutes with the lock released, and the handed-off child writes the state
 * file under its own lock (Skill sync), so the caller's snapshot is stale by the time the handoff
 * returns: writing it back from memory would clobber the child's fields with pre-handoff values.
 * This re-acquires the lock and re-reads, which keeps every `updates.json` write-back serialized.
 * When another process holds the lock, the write and the hint are both skipped for this
 * invocation - the lock holder owns the window, and update bookkeeping must never block evidence
 * extraction.
 */
async function recordBehindHint(directory: string, now: Date): Promise<boolean> {
  const releaseLock = await acquireUpdateLock(directory, now);
  if (releaseLock === undefined) return false;
  try {
    const state = await readUpdateState(directory);
    if (fresh(state.behindHintAt, now)) return false;
    await writeUpdateState(directory, { ...state, behindHintAt: now.toISOString() });
    return true;
  } finally {
    await releaseLock();
  }
}

function stableVersion(value: unknown): value is string {
  return typeof value === "string" && valid(value) !== null && prerelease(value) === null;
}

async function fetchLatestStableVersion(): Promise<string | undefined> {
  try {
    const response = await fetch(REGISTRY_LATEST_URL, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(UPDATE_REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) return undefined;
    const value: unknown = await response.json();
    if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
    const version = (value as Record<string, unknown>)["version"];
    return stableVersion(version) ? version : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Count the stable releases between the running version and the published latest.
 *
 * The `/latest` endpoint names the newest version but not the ones between it and the running one,
 * so the count comes from the abridged packument, fetched only on the failure path the hint is
 * printed on. Anything that goes wrong - network, timeout, an unexpected document - leaves the
 * count unknown and the hint drops the number instead of blocking the caller.
 */
async function countReleasesFromRegistry(
  currentVersion: string,
  latestVersion: string,
): Promise<number | undefined> {
  try {
    const response = await fetch(REGISTRY_PACKUMENT_URL, {
      headers: { accept: PACKUMENT_ACCEPT },
      signal: AbortSignal.timeout(UPDATE_REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) return undefined;
    const value: unknown = await response.json();
    if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
    const versions = (value as Record<string, unknown>)["versions"];
    if (typeof versions !== "object" || versions === null || Array.isArray(versions)) {
      return undefined;
    }
    let count = 0;
    for (const version of Object.keys(versions as Record<string, unknown>)) {
      if (stableVersion(version) && gt(version, currentVersion) && !gt(version, latestVersion)) {
        count += 1;
      }
    }
    return count;
  } catch {
    return undefined;
  }
}

/**
 * One line on stderr telling the caller how to leave the stale install behind.
 *
 * Only version numbers and the exact fix command - no paths, no arguments - and never stdout: the
 * command's machine-readable output must stay untouched whether or not an update was attempted.
 */
function behindHint(
  releasesBehind: number | undefined,
  currentVersion: string,
  latestVersion: string,
): string {
  const behind = releasesBehind === undefined
    ? "behind"
    : `${releasesBehind} release${releasesBehind === 1 ? "" : "s"} behind`;
  return `maa-evidence: install is ${behind} (running ${currentVersion}, latest ${latestVersion}); `
    + `run: npm i -g maa-evidence-kit@${latestVersion}\n`;
}

async function runProgram(
  executable: string,
  args: string[],
  options: CommandOptions,
): Promise<CommandResult> {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    let timeout: NodeJS.Timeout | undefined;
    const child = spawn(executable, args, {
      env: options.environment,
      stdio: options.inheritStdio ? ["ignore", "inherit", "inherit"] : ["ignore", "pipe", "pipe"],
    });
    child.stdout?.on("data", (chunk: Buffer | string) => {
      stdout += chunk.toString().slice(0, CAPTURE_LIMIT_CHARACTERS - stdout.length);
    });
    child.stderr?.on("data", (chunk: Buffer | string) => {
      stderr += chunk.toString().slice(0, CAPTURE_LIMIT_CHARACTERS - stderr.length);
    });
    child.once("error", () => {
      if (settled) return;
      settled = true;
      if (timeout !== undefined) clearTimeout(timeout);
      resolve({ spawned: false, exitCode: null, stdout, stderr });
    });
    child.once("close", (exitCode) => {
      if (settled) return;
      settled = true;
      if (timeout !== undefined) clearTimeout(timeout);
      resolve({ spawned: true, exitCode, stdout, stderr });
    });
    if (options.timeoutMs !== undefined) {
      timeout = setTimeout(() => child.kill(), options.timeoutMs);
      timeout.unref();
    }
  });
}

async function runNpm(args: string[], options: CommandOptions): Promise<CommandResult> {
  return runProgram("npm", args, options);
}

/**
 * Run one exact package version through npm.
 *
 * `--loglevel=error` is what keeps this quiet: npm prints `npm notice run ...` lines to stderr for
 * every `exec`, and those lines must never reach a caller as if MEK had written them. With the
 * wrapper's log level raised, the only stderr left is a real failure - npm's or the child's.
 */
function npmExec(packageSpecification: string, executable: string, args: string[]): string[] {
  return [
    "exec",
    "--yes",
    "--loglevel=error",
    `--package=${packageSpecification}`,
    "--",
    executable,
    ...args,
  ];
}

/**
 * Decide whether this invocation may spend time on update work.
 *
 * The npm probe and handoff cost seconds of subprocess time each (measured 4-6 s per `npm exec`
 * call on Windows), so they stay behind an interactive terminal or an explicit
 * `MAA_EVIDENCE_AUTO_UPDATE=1`. An agent, a harness, or anything with a redirected stdout is not
 * asking to be updated, and previously paid that cost on every single command.
 */
function updatesEnabled(
  args: string[],
  environment: NodeJS.ProcessEnv,
  interactive: boolean,
): boolean {
  if (environment[PROBE_ENVIRONMENT_KEY] === "1") return false;
  if (environment[AUTO_UPDATE_ENVIRONMENT_KEY] === "0") return false;
  if (args.length === 0 || args.includes("--help") || args.includes("-h")) return false;
  if (UPDATE_EXEMPT_COMMANDS.has(args[0] ?? "")) return false;
  if (environment[AUTO_UPDATE_ENVIRONMENT_KEY] === "1") return true;
  if (environment["CI"] !== undefined) return false;
  return interactive;
}

function debugEnabled(environment: NodeJS.ProcessEnv): boolean {
  return environment[DEBUG_ENVIRONMENT_KEY] === "1";
}

/**
 * Name the version that is actually executing when this process is an update handoff.
 *
 * The handoff runs the pinned release's command while the global install stays behind, and the
 * SKILL's first step is `--version`, so the stdout answer alone cannot tell a mixed install from
 * an up-to-date one. One stderr line, versions only, printed before any command runs - including
 * `--version`, whose stdout contract stays the bare version string. A child older than the
 * base-version marker never sees it, and an equal version means there is nothing to disclose.
 */
function reportHandoff(environment: NodeJS.ProcessEnv, diagnostic: (message: string) => void): void {
  if (environment[HANDOFF_ENVIRONMENT_KEY] !== "1") return;
  const baseVersion = environment[HANDOFF_FROM_ENVIRONMENT_KEY];
  if (baseVersion === undefined || baseVersion === MAA_EVIDENCE_VERSION) return;
  diagnostic(
    `maa-evidence: running ${MAA_EVIDENCE_VERSION} (handed off from ${baseVersion}); `
    + `the global install may still be at ${baseVersion}.\n`,
  );
}

/**
 * Record, before any gate, which version is actually executing a handed-off command.
 *
 * npm's command-name resolution is an uncontrolled variable, so the parent cannot tell from the
 * spawn alone whether the pinned copy or a shadowed install answered; this marker is the fact the
 * parent reads after the command exits. The write is atomic (temporary file plus rename inside the
 * config directory) and every failure is ignored: update bookkeeping must never block evidence
 * extraction. A child that predates marker verification writes nothing, which the parent reads as
 * "unverified" - the safety net for a shadowed legacy global executing the handoff silently.
 */
export async function writeHandoffMarker(environment: NodeJS.ProcessEnv): Promise<void> {
  const markerPath = environment[HANDOFF_MARKER_ENVIRONMENT_KEY];
  if (
    environment[HANDOFF_ENVIRONMENT_KEY] !== "1"
    || markerPath === undefined
    || markerPath === ""
  ) {
    return;
  }
  const base = environment[HANDOFF_FROM_ENVIRONMENT_KEY];
  const marker: HandoffMarker = {
    version: MAA_EVIDENCE_VERSION,
    ...(base === undefined ? {} : { base }),
    pid: process.pid,
    timestamp: new Date().toISOString(),
  };
  const temporaryPath = `${markerPath}.${process.pid}.tmp`;
  try {
    await writeFile(temporaryPath, `${JSON.stringify(marker)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    await rename(temporaryPath, markerPath);
  } catch {
    await unlink(temporaryPath).catch(() => undefined);
  }
}

/**
 * Whether the npm-published Skill can be assumed to match this running version.
 *
 * `skills update` installs whatever npm publishes, while the state file records the *running*
 * version. Syncing from npm while this runtime is ahead of (a dev checkout) or behind (a failed
 * handoff) the published version would install a Skill from a different release and then claim it
 * was current, which is how an installed Skill silently drifted one version behind.
 */
function skillSyncMatchesRuntime(running: string, publishedLatest: string | undefined): boolean {
  if (publishedLatest === undefined) return true;
  return publishedLatest === running;
}

async function latestVersion(
  state: UpdateState,
  directory: string,
  now: Date,
  fetchVersion: () => Promise<string | undefined>,
): Promise<{ latest: string | undefined; state: UpdateState }> {
  if (fresh(state.checkedAt, now)) {
    return {
      latest: stableVersion(state.latestVersion) ? state.latestVersion : undefined,
      state,
    };
  }
  const resolved = await fetchVersion();
  const nextState: UpdateState = {
    ...state,
    checkedAt: now.toISOString(),
    ...(resolved === undefined ? {} : { latestVersion: resolved }),
  };
  await writeUpdateState(directory, nextState);
  return {
    latest: resolved ?? (stableVersion(state.latestVersion) ? state.latestVersion : undefined),
    state: nextState,
  };
}

async function synchronizeSkill(
  state: UpdateState,
  directory: string,
  currentVersion: string,
  now: Date,
  environment: NodeJS.ProcessEnv,
  command: (args: string[], options: CommandOptions) => Promise<CommandResult>,
  diagnostic: (message: string) => void,
): Promise<void> {
  if (state.skillSyncVersion === currentVersion) return;
  if (
    state.skillSyncAttemptedVersion === currentVersion
    && fresh(state.skillSyncAttemptedAt, now)
  ) {
    return;
  }

  const attemptedState: UpdateState = {
    ...state,
    skillSyncAttemptedAt: now.toISOString(),
    skillSyncAttemptedVersion: currentVersion,
  };
  await writeUpdateState(directory, attemptedState);
  const skillsEnvironment = { ...environment, DISABLE_TELEMETRY: "1" };
  const result = await command(
    npmExec(`skills@${SKILLS_CLI_VERSION}`, "skills", [
      "update",
      "maa-evidence",
      "--global",
      "--yes",
    ]),
    {
      environment: skillsEnvironment,
      inheritStdio: false,
      timeoutMs: UPDATE_SUBPROCESS_TIMEOUT_MS,
    },
  );
  if (!result.spawned || result.exitCode !== 0) {
    diagnostic(
      "maa-evidence: automatic global Skill update failed; continuing with the installed Skill.\n",
    );
    return;
  }
  await writeUpdateState(directory, {
    ...attemptedState,
    skillSyncVersion: currentVersion,
  });
}

/**
 * Name the npm that ran a failed probe, for the debug diagnostic only.
 *
 * Command-name resolution is npm behavior and it drifts between npm releases, so the shape of a
 * probe failure depends on which npm is on PATH; recording its version next to the captured output
 * turns a one-off "the probe answered something else" report into a reproducible one. Version
 * number only, stderr only, never telemetry.
 */
async function npmVersionLabel(
  environment: NodeJS.ProcessEnv,
  command: (args: string[], options: CommandOptions) => Promise<CommandResult>,
): Promise<string> {
  const result = await command(["--version"], {
    environment,
    inheritStdio: false,
    timeoutMs: DEBUG_NPM_VERSION_TIMEOUT_MS,
  });
  const version = result.stdout.trim();
  return result.spawned && version !== "" ? `npm ${version}` : "npm version unavailable";
}

async function probeVersion(
  version: string,
  environment: NodeJS.ProcessEnv,
  command: (args: string[], options: CommandOptions) => Promise<CommandResult>,
  diagnostic: (message: string) => void,
): Promise<boolean> {
  const packageSpecification = `maa-evidence-kit@${version}`;
  const probeEnvironment = { ...environment, [PROBE_ENVIRONMENT_KEY]: "1" };
  // The probe runs under the alias bin, not `maa-evidence`: an existing global shim wins npm
  // exec's command-name resolution and would answer with the stale version, which is exactly the
  // machine state the updater exists for.
  const probe = await command(
    npmExec(packageSpecification, PROBE_BIN, ["--version"]),
    {
      environment: probeEnvironment,
      inheritStdio: false,
      timeoutMs: UPDATE_SUBPROCESS_TIMEOUT_MS,
    },
  );
  const matched = probe.spawned && probe.exitCode === 0 && probe.stdout.trim() === version;
  // The probe's output is npm's, so it is captured rather than shown; a failing probe is the one
  // case where reading it is the only way to learn why the update never happens. The npm version
  // rides along because resolution behavior drifts between npm releases.
  if (!matched && debugEnabled(environment)) {
    const npmVersion = await npmVersionLabel(environment, command);
    diagnostic(
      `maa-evidence: update probe output for ${version} (${npmVersion}):\n`
      + `${probe.stdout}${probe.stderr}`,
    );
  }
  return matched;
}

async function readHandoffMarkerVersion(markerPath: string): Promise<string | undefined> {
  try {
    const value: unknown = JSON.parse(await readFile(markerPath, "utf8"));
    if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
    const version = (value as Record<string, unknown>)["version"];
    return typeof version === "string" && version !== "" ? version : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Delete handoff markers left by parents that died before reading theirs.
 *
 * Runs under the update lock at the start of an update pass. Only files matching the exact
 * parent-generated shape are considered; anything else in the config directory stays untouched.
 */
async function sweepStaleHandoffMarkers(directory: string, now: Date): Promise<void> {
  let entries: string[];
  try {
    entries = await readdir(directory);
  } catch {
    return;
  }
  for (const entry of entries) {
    if (!HANDOFF_MARKER_FILE.test(entry)) continue;
    const markerPath = path.join(directory, entry);
    try {
      const markerStat = await stat(markerPath);
      if (now.getTime() - markerStat.mtimeMs >= HANDOFF_MARKER_MAX_AGE_MS) {
        await unlink(markerPath).catch(() => undefined);
      }
    } catch {
      // Gone or unreadable between readdir and stat: nothing left to clean.
    }
  }
}

/**
 * Run the caller's command through the pinned release and report what actually executed.
 *
 * The base version rides along so the child can disclose which version is executing; the marker
 * path rides along so the child can record it. No timeout: this child is the caller's command, and
 * an inspection that legitimately runs for minutes must not be killed by the updater. The probe
 * and the Skill sync, whose commands are ours, keep their budget. The child runs under the alias
 * bin for the same reason the probe does: under the `maa-evidence` name, a shadowing global
 * install would answer instead of the pinned version. The alias is best effort - the marker is
 * what turns "which version ran" into a parent-verifiable fact.
 */
async function handOffToVersion(
  version: string,
  baseVersion: string,
  args: string[],
  environment: NodeJS.ProcessEnv,
  command: (args: string[], options: CommandOptions) => Promise<CommandResult>,
  directory: string,
  now: Date,
): Promise<HandoffOutcome> {
  const markerPath = handoffMarkerPath(directory, now);
  const handoffEnvironment = {
    ...environment,
    [HANDOFF_ENVIRONMENT_KEY]: "1",
    [HANDOFF_FROM_ENVIRONMENT_KEY]: baseVersion,
    [HANDOFF_MARKER_ENVIRONMENT_KEY]: markerPath,
  };
  const handoff = await command(
    npmExec(`maa-evidence-kit@${version}`, PROBE_BIN, args),
    { environment: handoffEnvironment, inheritStdio: true },
  );
  const ranVersion = await readHandoffMarkerVersion(markerPath);
  // The marker exists for exactly this one verdict: read once, then delete.
  await unlink(markerPath).catch(() => undefined);
  return { spawned: handoff.spawned, exitCode: handoff.exitCode, ranVersion };
}

export async function runWithAutomaticUpdates(
  args: string[],
  runLocal: (args: string[]) => Promise<number>,
  dependencies: AutoUpdateDependencies = {},
): Promise<number> {
  const environment = dependencies.environment ?? process.env;
  const diagnostic = dependencies.writeDiagnostic
    ?? ((message: string) => process.stderr.write(message));
  // Before any gate: a handed-off command records which version is actually executing, so the
  // parent can verify the handoff no matter how npm resolved the command name.
  await writeHandoffMarker(environment);
  // Before any gating: a handed-off command discloses the version that actually runs even when it
  // would never be allowed to spend time on update work itself.
  reportHandoff(environment, diagnostic);
  const interactive = (dependencies.isInteractive ?? (() => process.stdout.isTTY === true))();
  if (!updatesEnabled(args, environment, interactive)) return runLocal(args);

  const currentVersion = dependencies.currentVersion ?? MAA_EVIDENCE_VERSION;
  const now = (dependencies.now ?? (() => new Date()))();
  const directory = dependencies.configDirectory ?? maaEvidenceConfigDirectory(environment);
  const command = dependencies.runCommand ?? runNpm;
  const skillCommand = dependencies.runSkillCommand ?? runNpm;
  const countReleasesBehind = dependencies.countReleasesBehind ?? countReleasesFromRegistry;
  const releaseLock = await acquireUpdateLock(directory, now);
  if (releaseLock === undefined) return runLocal(args);

  try {
    await sweepStaleHandoffMarkers(directory, now);
    let state = await readUpdateState(directory);
    let publishedLatest: string | undefined;
    if (environment[HANDOFF_ENVIRONMENT_KEY] !== "1") {
      const resolved = await latestVersion(
        state,
        directory,
        now,
        dependencies.fetchLatestVersion ?? fetchLatestStableVersion,
      );
      state = resolved.state;
      publishedLatest = resolved.latest;
      if (
        resolved.latest !== undefined
        && valid(currentVersion) !== null
        && gt(resolved.latest, currentVersion)
      ) {
        const probedRecently = state.probeAttemptedVersion === resolved.latest
          && fresh(state.probeAttemptedAt, now);
        if (!probedRecently) {
          if (await probeVersion(resolved.latest, environment, command, diagnostic)) {
            await releaseLock();
            const handoff = await handOffToVersion(
              resolved.latest,
              currentVersion,
              args,
              environment,
              command,
              directory,
              now,
            );
            // Verified delivery: the marker names the target, so the pinned copy really ran and
            // the command's exit code is the whole answer.
            if (handoff.spawned && handoff.ranVersion === resolved.latest) {
              return handoff.exitCode ?? 1;
            }
            if (!handoff.spawned) {
              diagnostic(
                `maa-evidence: version ${resolved.latest} was prepared but could not be started.\n`,
              );
            } else if (handoff.ranVersion === undefined) {
              // No marker: the child predates marker verification - the shape of a shadowed legacy
              // global answering npm exec's command name - or died before writing one.
              diagnostic(
                `maa-evidence: could not verify which version the handed-off command ran.\n`,
              );
            } else {
              diagnostic(
                `maa-evidence: the handed-off command ran ${handoff.ranVersion}, not ${resolved.latest}.\n`,
              );
            }
            const hintDue = await recordBehindHint(directory, now);
            if (hintDue) {
              diagnostic(behindHint(
                await countReleasesBehind(currentVersion, resolved.latest),
                currentVersion,
                resolved.latest,
              ));
            }
            return handoff.exitCode ?? 1;
          }
          // Remember the failure only: a version that probed successfully is handed off now, so a
          // later invocation must still be allowed to try again.
          state = {
            ...state,
            probeAttemptedAt: now.toISOString(),
            probeAttemptedVersion: resolved.latest,
          };
          // The probe-failure cache already bounds this branch to once per window; the hint keeps
          // its own timestamp so the handoff path above is bounded the same way.
          const hintDue = !fresh(state.behindHintAt, now);
          if (hintDue) state = { ...state, behindHintAt: now.toISOString() };
          await writeUpdateState(directory, state);
          diagnostic(
            `maa-evidence: version ${resolved.latest} is available but could not be prepared; continuing with ${currentVersion}.\n`,
          );
          if (hintDue) {
            diagnostic(behindHint(
              await countReleasesBehind(currentVersion, resolved.latest),
              currentVersion,
              resolved.latest,
            ));
          }
        }
      }
    }

    if (skillSyncMatchesRuntime(currentVersion, publishedLatest)) {
      await synchronizeSkill(
        state,
        directory,
        currentVersion,
        now,
        environment,
        skillCommand,
        diagnostic,
      );
    }
    await releaseLock();
    return runLocal(args);
  } finally {
    await releaseLock();
  }
}
