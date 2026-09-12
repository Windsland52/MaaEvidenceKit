import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, expect, test } from "vitest";

import { materializeGitRef } from "../../src/mse/git-source.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function temporary(label: string): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), `mek-gitref-${label}-`));
  temporaryRoots.push(root);
  return root;
}

function git(cwd: string, args: readonly string[], input?: string): string {
  return execFileSync("git", args as string[], {
    cwd,
    encoding: "utf8",
    windowsHide: true,
    ...(input === undefined ? {} : { input }),
  });
}

async function repository(): Promise<{ root: string; first: string; second: string }> {
  const root = await temporary("repo");
  git(root, ["init", "-q"]);
  git(root, ["config", "user.email", "test@example.invalid"]);
  git(root, ["config", "user.name", "Tester"]);
  git(root, ["config", "commit.gpgsign", "false"]);
  await mkdir(path.join(root, "assets"), { recursive: true });
  await writeFile(path.join(root, "assets", "interface.json"), '{"name":"OLD"}', "utf8");
  git(root, ["add", "-A"]);
  git(root, ["commit", "-q", "-m", "first"]);
  const first = git(root, ["rev-parse", "HEAD"]).trim();
  await writeFile(path.join(root, "assets", "interface.json"), '{"name":"NEW"}', "utf8");
  git(root, ["add", "-A"]);
  git(root, ["commit", "-q", "-m", "second"]);
  const second = git(root, ["rev-parse", "HEAD"]).trim();
  return { root, first, second };
}

test("reads project content at a ref without touching the working tree", async () => {
  const { root, first, second } = await repository();

  const atFirst = await materializeGitRef(root, first);
  temporaryRoots.push(atFirst.root);

  expect(atFirst.commit).toBe(first);
  expect(atFirst.fileCount).toBe(1);
  expect(await readFile(path.join(atFirst.path, "assets", "interface.json"), "utf8"))
    .toBe('{"name":"OLD"}');

  // The working tree still holds the later commit and HEAD did not move.
  expect(await readFile(path.join(root, "assets", "interface.json"), "utf8")).toBe('{"name":"NEW"}');
  expect(git(root, ["rev-parse", "HEAD"]).trim()).toBe(second);
});

test("resolves a symbolic ref and a subdirectory input", async () => {
  const { root, second } = await repository();

  const atHead = await materializeGitRef(path.join(root, "assets"), "HEAD");
  temporaryRoots.push(atHead.root);

  expect(atHead.commit).toBe(second);
  expect(path.basename(atHead.path)).toBe("assets");
  expect(await readFile(path.join(atHead.path, "interface.json"), "utf8")).toBe('{"name":"NEW"}');
});

test("skips symbolic links instead of materializing their target path as file content", async () => {
  const { root } = await repository();
  // Git stores a symlink as a blob holding the target path. Creating one on disk is not portable
  // (Windows needs a privilege), so write the blob and register it with mode 120000 through the
  // index, which is exactly how git records a link.
  const blob = git(root, ["hash-object", "-w", "--stdin"], "interface.json").trim();
  git(root, ["update-index", "--add", "--cacheinfo", "120000", blob, "assets/link.json"]);
  git(root, ["commit", "-q", "-m", "add a symbolic link"]);

  const materialized = await materializeGitRef(path.join(root, "assets"), "HEAD");
  temporaryRoots.push(materialized.root);

  expect(git(root, ["ls-tree", "-r", "HEAD"]).split("\n").find((line) => line.includes("link.json")))
    .toContain("120000");
  expect(materialized.skippedSymlinks).toEqual(["assets/link.json"]);
  // The link is not written at all, so nothing can load it as if it were a real file.
  await expect(readFile(path.join(materialized.path, "link.json"), "utf8")).rejects.toThrow();
  // The regular file is still materialized alongside the skipped link.
  expect(await readFile(path.join(materialized.path, "interface.json"), "utf8")).toBe('{"name":"NEW"}');
});

test("rejects an unresolvable ref, an option-like ref, and a path absent at the ref", async () => {
  const { root } = await repository();

  await expect(materializeGitRef(root, "no-such-ref")).rejects.toThrow("could not resolve");
  // A ref that starts with `-` would reach git as an option, so it is rejected before use.
  await expect(materializeGitRef(root, "--upload-pack=touch")).rejects.toThrow("Invalid --git-ref value");
  await expect(materializeGitRef(path.join(root, "absent"), "HEAD")).rejects.toThrow("does not exist");
});

test("rejects a path outside any repository", async () => {
  const outside = await temporary("outside");
  await expect(materializeGitRef(outside, "HEAD")).rejects.toThrow("requires a git checkout");
});
