import { execFile, spawn } from "node:child_process";
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
 *
 * A directory is removed only when it is both older than `maxAgeMs` and beyond the `keepNewest`
 * count, so a concurrent run is never pruned out from under itself simply because several
 * materializations exist.
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
    // Both conditions must hold. Deleting on `beyondNewest` alone would remove a recent tree that a
    // concurrent run is still inspecting, which its own artifact paths depend on; age alone bounds
    // disk use, so the count is only an extra guard against a burst of same-age materializations.
    if (!tooOld || !beyondNewest) {
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

/**
 * Read several git objects in one `git cat-file --batch` stream.
 *
 * `--batch` frames each object as `<oid> <type> <size>\n<content>\n`, in request order, so responses
 * are matched by position rather than parsed as text. Using one stream instead of one `git show`
 * process per file matters: a real project holds thousands of files, and a process per file makes
 * materialization take minutes.
 */
function readObjects(cwd: string, specs: readonly string[]): Promise<Buffer[]> {
  return new Promise((resolve, reject) => {
    const child = spawn("git", ["cat-file", "--batch"], { cwd, windowsHide: true });
    const chunks: Buffer[] = [];
    let settled = false;
    const fail = (error: Error): void => {
      if (settled) return;
      settled = true;
      child.kill();
      reject(error);
    };
    child.on("error", fail);
    child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      if (code !== 0) {
        reject(new Error(`git cat-file --batch exited with ${String(code)}`));
        return;
      }
      try {
        resolve(splitBatchFrames(Buffer.concat(chunks), specs.length));
      } catch (error: unknown) {
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
    child.stdin.on("error", fail);
    child.stdin.end(`${specs.join("\n")}\n`);
  });
}

/** Split `git cat-file --batch` output into exactly `expected` contents, matched by position. */
function splitBatchFrames(output: Buffer, expected: number): Buffer[] {
  const contents: Buffer[] = [];
  let offset = 0;
  for (let index = 0; index < expected; index += 1) {
    const newline = output.indexOf(0x0a, offset);
    if (newline < 0) throw new Error("git cat-file output ended before the header of an object.");
    const header = output.subarray(offset, newline).toString("utf8").trim();
    // A missing object is reported as `<spec> missing` rather than as a frame with a size.
    if (header.endsWith(" missing")) {
      throw new UsageError(`Object not found in the repository: ${header.slice(0, -" missing".length)}`);
    }
    const size = Number(header.split(" ")[2]);
    if (!Number.isSafeInteger(size) || size < 0) {
      throw new Error(`git cat-file returned an unreadable header: ${header}`);
    }
    const start = newline + 1;
    const end = start + size;
    if (end > output.length) throw new Error("git cat-file output ended before an object's content.");
    contents.push(output.subarray(start, end));
    // Each frame's content is followed by a single newline that is not part of the object.
    offset = end + 1;
  }
  return contents;
}

async function optionalGit(cwd: string, args: readonly string[]): Promise<string | null> {
  try {
    return await git(cwd, args);
  } catch {
    return null;
  }
}

/**
 * List the tracked files under `prefix` at `commit`, as `{ mode, sizeBytes, relativePath }`.
 *
 * `ls-tree -l` reports each blob's size, which lets the caller enforce the byte cap from metadata
 * instead of after the content is already in memory.
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
): Promise<Array<{ mode: string; sizeBytes: number; relativePath: string }>> {
  const args = ["ls-tree", "-r", "-l", "-z", "--full-tree", commit];
  if (prefix !== "") args.push("--", prefix);
  const output = await git(cwd, args);
  const entries: Array<{ mode: string; sizeBytes: number; relativePath: string }> = [];
  for (const record of output.split("\0")) {
    if (record === "") continue;
    const tab = record.indexOf("\t");
    if (tab < 0) continue;
    // `<mode> <type> <oid> <size>\t<path>`; committed entries always report a size.
    const meta = record.slice(0, tab).split(/\s+/u);
    const relativePath = record.slice(tab + 1);
    // A newline in a path cannot be sent over the `cat-file --batch` line protocol unambiguously,
    // so refuse it rather than risk reading the wrong object. Git permits such paths, but they cannot
    // be reproduced in a portable test fixture (`git update-index --cacheinfo` rejects them and
    // Windows forbids the filename), so this guard is defensive and intentionally untested.
    if (relativePath.includes("\n") || relativePath.includes("\r")) {
      throw new UsageError(
        `Refusing to materialize ${relativePath.split(/[\r\n]/u)[0]}: a tracked path contains a line break, which the git batch protocol cannot address unambiguously.`,
      );
    }
    entries.push({
      mode: meta[0] ?? "",
      sizeBytes: Number(meta[3] ?? "0"),
      relativePath,
    });
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
  // Enforce the byte cap from `ls-tree -l` metadata, before any content is buffered. Reading the
  // stream first would let a large ref exhaust memory before the cap could reject it, which is the
  // opposite of what the cap is for.
  let plannedBytes = 0;
  for (const entry of entries) {
    if (!Number.isSafeInteger(entry.sizeBytes) || entry.sizeBytes < 0) {
      throw new UsageError(`git ls-tree reported an unreadable size for ${entry.relativePath} at ${ref}.`);
    }
    plannedBytes += entry.sizeBytes;
    if (plannedBytes > MAX_MATERIALIZED_BYTES) {
      throw new UsageError(
        `--git-ref refused to materialize more than ${MAX_MATERIALIZED_BYTES} bytes at ${ref}`,
      );
    }
  }

  const destination = await mkdtemp(path.join(tmpdir(), MATERIALIZATION_PREFIX));
  const cleanup = async (): Promise<void> => {
    await rm(destination, { recursive: true, force: true });
  };
  try {
    // One `git cat-file --batch` stream instead of one `git show` process per file: a real project
    // holds thousands of files, and a process per file makes materialization take minutes.
    const contents = await readObjects(root, entries.map((entry) => `${commit}:${entry.relativePath}`));
    let bytes = 0;
    for (const [index, entry] of entries.entries()) {
      const buffer = contents[index];
      if (buffer === undefined) {
        throw new UsageError(`git cat-file returned no content for ${entry.relativePath} at ${ref}.`);
      }
      bytes += buffer.byteLength;
      // `relativePath` is repository-relative with forward slashes. Keep the full repository-relative
      // path so the materialized tree mirrors the repository layout; the requested prefix is then just
      // a path inside it, which keeps `result.path` and the written files consistent.
      const target = path.join(destination, entry.relativePath.replaceAll("/", path.sep));
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, buffer);
    }
    if (bytes > MAX_MATERIALIZED_BYTES) {
      // The metadata pre-check should have caught this; keep the guard in case a blob changed between
      // the two git commands rather than writing an over-cap tree.
      throw new UsageError(
        `--git-ref refused to materialize more than ${MAX_MATERIALIZED_BYTES} bytes at ${ref}`,
      );
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
