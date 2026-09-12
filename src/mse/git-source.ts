import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { UsageError } from "../evidence/index.js";

const run = promisify(execFile);

/** Cap the total bytes written for one ref so a huge repository cannot exhaust the disk silently. */
const MAX_MATERIALIZED_BYTES = 512 * 1024 * 1024;

/**
 * Materialized ref content is inspection output, not scratch: artifact paths point into it and
 * `window` reads it after the process exits, so it must outlive the run and cannot be deleted on
 * exit. Retention is therefore bounded rather than immediate: every materialization prunes
 * directories older than this window, and a caller may also dispose of one explicitly.
 */
const MATERIALIZATION_PREFIX = "mek-git-ref-";
export const MATERIALIZATION_MAX_AGE_MS = 60 * 60 * 1000;
/** Extra safety net: never keep more than this many materializations even if all are recent. */
export const MATERIALIZATION_KEEP_NEWEST = 4;

/**
 * A git ref never starts with `-`, so rejecting that keeps a ref from being read as an option by the
 * `git` processes below.
 */
const SAFE_REF = /^[^-][^\s]*$/u;

export type GitSourceMaterialization = {
  /** Temporary directory holding the checked-out ref content, laid out like the working tree. */
  root: string;
  /** Commit the ref resolved to. Reported so a result never claims a moving ref resolved differently. */
  commit: string;
  /** Path inside `root` corresponding to the requested input path. */
  path: string;
  fileCount: number;
  bytes: number;
  /** Repository-relative paths of submodule entries that were not materialized. */
  skippedSubmodules: string[];
  /** Repository-relative paths of symlink entries that were not materialized. */
  skippedSymlinks: string[];
  /** Remove this materialized tree. Safe to call once the inspection output is no longer needed. */
  cleanup: () => Promise<void>;
};

/**
 * Remove materialized git-ref trees that are no longer worth keeping.
 *
 * Retention exists because a materialized tree cannot be deleted when the process exits: the
 * inspection reports artifact paths inside it and `window` reads them afterwards. Without pruning,
 * every `--git-ref` run would leave a full copy of the project behind. Pruning only touches
 * directories MEK created (recognized by prefix) and never reports a failure to the caller, since a
 * concurrent run may be using one of them.
 */
export async function pruneGitRefMaterializations(options: {
  directory?: string;
  now?: number;
  maxAgeMs?: number;
  keepNewest?: number;
} = {}): Promise<{ removed: string[]; kept: number }> {
  const directory = options.directory ?? tmpdir();
  const now = options.now ?? Date.now();
  const maxAgeMs = options.maxAgeMs ?? MATERIALIZATION_MAX_AGE_MS;
  const keepNewest = options.keepNewest ?? MATERIALIZATION_KEEP_NEWEST;
  let names: string[];
  try {
    names = await readdir(directory);
  } catch {
    return { removed: [], kept: 0 };
  }
  const candidates: Array<{ path: string; mtimeMs: number }> = [];
  for (const name of names) {
    if (!name.startsWith(MATERIALIZATION_PREFIX)) continue;
    const full = path.join(directory, name);
    try {
      const metadata = await stat(full);
      if (metadata.isDirectory()) candidates.push({ path: full, mtimeMs: metadata.mtimeMs });
    } catch {
      // A directory that vanished mid-scan needs no action.
    }
  }
  candidates.sort((left, right) => right.mtimeMs - left.mtimeMs);
  const removed: string[] = [];
  let kept = 0;
  for (const [index, candidate] of candidates.entries()) {
    const tooOld = now - candidate.mtimeMs > maxAgeMs;
    const beyondNewest = index >= keepNewest;
    if (!tooOld && !beyondNewest) {
      kept += 1;
      continue;
    }
    try {
      await rm(candidate.path, { recursive: true, force: true });
      removed.push(candidate.path);
    } catch {
      // Keep going: one stuck directory must not block pruning the rest.
    }
  }
  return { removed, kept };
}

function git(cwd: string, args: readonly string[]): Promise<string> {
  return run("git", args, { cwd, maxBuffer: 64 * 1024 * 1024, windowsHide: true })
    .then((result) => result.stdout);
}

/** Read one git object as raw bytes so binary files are not corrupted by text decoding. */
function gitBytes(cwd: string, args: readonly string[]): Promise<Buffer> {
  return run("git", args, {
    cwd,
    maxBuffer: MAX_MATERIALIZED_BYTES,
    windowsHide: true,
    encoding: "buffer",
  }).then((result) => result.stdout);
}

async function optionalGit(cwd: string, args: readonly string[]): Promise<string | null> {
  try {
    return await git(cwd, args);
  } catch {
    return null;
  }
}

/**
 * List the tracked files under `prefix` at `commit`, as `{ mode, relativePath }`.
 *
 * Two entry kinds are reported back rather than materialized:
 *
 * - submodules (mode 160000), whose content is not in this object database, so materializing them
 *   would silently produce an empty directory that looks like a project with missing files;
 * - symlinks (mode 120000), whose blob holds the link target path. Writing that blob to a regular
 *   file would replace a link with a text file containing a path, which is not what the ref means,
 *   and any resource loaded through it would then be wrong rather than absent.
 */
async function listTree(
  cwd: string,
  commit: string,
  prefix: string,
): Promise<Array<{ mode: string; relativePath: string }>> {
  const args = ["ls-tree", "-r", "-z", "--full-tree", commit];
  if (prefix !== "") args.push("--", prefix);
  const output = await git(cwd, args);
  const entries: Array<{ mode: string; relativePath: string }> = [];
  for (const record of output.split("\0")) {
    if (record === "") continue;
    const tab = record.indexOf("\t");
    if (tab < 0) continue;
    const meta = record.slice(0, tab).split(" ");
    entries.push({ mode: meta[0] ?? "", relativePath: record.slice(tab + 1) });
  }
  return entries;
}

/**
 * Find the nearest existing ancestor of `target`. `git rev-parse` needs an existing working
 * directory, and an input path may name a file or directory that exists only at the ref, so the
 * repository lookup has to start from a directory that is actually present.
 */
async function existingAncestor(target: string): Promise<string> {
  let current = target;
  for (;;) {
    if ((await optionalGit(current, ["rev-parse", "--show-toplevel"])) !== null) return current;
    const parent = path.dirname(current);
    if (parent === current) return target;
    current = parent;
  }
}

/**
 * Materialize a git ref into a temporary tree and return the path to inspect.
 *
 * The ref content is extracted from the object database into a scratch directory, so an issue-time
 * source can be inspected without checking anything out into the caller's working tree. This is the
 * opposite of silently substituting current source: the result records the resolved commit, and the
 * caller can cite it.
 *
 * Only tracked files are materialized. Untracked and ignored files in the working tree are not part
 * of the commit and therefore cannot appear at the ref.
 */
export async function materializeGitRef(
  inputPath: string,
  ref: string,
): Promise<GitSourceMaterialization> {
  if (!SAFE_REF.test(ref)) {
    throw new UsageError(`Invalid --git-ref value: ${ref}`);
  }
  // Bounded retention: drop materializations from earlier runs before adding another one.
  await pruneGitRefMaterializations();
  const resolved = path.resolve(inputPath);
  const probe = await existingAncestor(resolved);
  const repositoryRoot = await optionalGit(probe, ["rev-parse", "--show-toplevel"]);
  if (repositoryRoot === null) {
    throw new UsageError(`--git-ref requires a git checkout, but no repository contains ${resolved}.`);
  }
  const root = repositoryRoot.trim();
  const commitOutput = await optionalGit(root, ["rev-parse", "--verify", `${ref}^{commit}`]);
  if (commitOutput === null) {
    throw new UsageError(`--git-ref could not resolve ${ref} to a commit in ${root}.`);
  }
  const commit = commitOutput.trim();

  const relative = path.relative(root, resolved).split(path.sep).join("/");
  if (relative.startsWith("..")) {
    throw new UsageError(`${resolved} is outside the repository at ${root}.`);
  }
  const prefix = relative === "" || relative === "." ? "" : relative;
  if (prefix !== "") {
    const exists = await optionalGit(root, ["cat-file", "-e", `${commit}:${prefix}`]);
    if (exists === null) {
      throw new UsageError(`Path ${prefix} does not exist at ${ref} (${commit.slice(0, 12)}).`);
    }
  }

  const allEntries = await listTree(root, commit, prefix);
  const submodules = allEntries.filter((entry) => entry.mode === "160000");
  const symlinks = allEntries.filter((entry) => entry.mode === "120000");
  const entries = allEntries.filter((entry) => entry.mode !== "160000" && entry.mode !== "120000");
  if (entries.length === 0) {
    throw new UsageError(`No materializable tracked files found at ${prefix === "" ? "/" : prefix} in ${ref}.`);
  }

  const destination = await mkdtemp(path.join(tmpdir(), MATERIALIZATION_PREFIX));
  const cleanup = async (): Promise<void> => {
    await rm(destination, { recursive: true, force: true });
  };
  try {
    let bytes = 0;
    for (const entry of entries) {
      const buffer = await gitBytes(root, ["show", `${commit}:${entry.relativePath}`]);
      bytes += buffer.byteLength;
      if (bytes > MAX_MATERIALIZED_BYTES) {
        throw new UsageError(
          `--git-ref refused to materialize more than ${MAX_MATERIALIZED_BYTES} bytes at ${ref}.`,
        );
      }
      // `relativePath` is repository-relative with forward slashes. Keep the full repository-relative
      // path so the materialized tree mirrors the repository layout; the requested prefix is then just
      // a path inside it, which keeps `result.path` and the written files consistent.
      const target = path.join(destination, entry.relativePath.replaceAll("/", path.sep));
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, buffer);
    }

    return {
      root: destination,
      commit,
      path: path.join(destination, ...prefix.split("/").filter((part) => part !== "")),
      fileCount: entries.length,
      skippedSubmodules: submodules.map((entry) => entry.relativePath),
      skippedSymlinks: symlinks.map((entry) => entry.relativePath),
      bytes,
      cleanup,
    };
  } catch (error: unknown) {
    // A failed materialization must not leave a partial tree behind.
    await cleanup().catch(() => undefined);
    throw error;
  }
}
