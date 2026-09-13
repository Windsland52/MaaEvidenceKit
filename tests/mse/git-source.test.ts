import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, expect, test } from "vitest";

import { materializeGitRef, pruneGitRefMaterializations } from "../../src/mse/git-source.js";

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

test("prunes only old materializations and keeps the newest ones", async () => {
  const directory = await temporary("prune");
  const now = Date.now();
  const stale = ["mek-git-ref-old1", "mek-git-ref-old2"];
  const fresh = ["mek-git-ref-new1", "mek-git-ref-new2"];
  for (const name of [...stale, ...fresh]) {
    await mkdir(path.join(directory, name), { recursive: true });
  }
  // Unrelated directories must never be touched, even when they are old.
  await mkdir(path.join(directory, "someone-elses-data"), { recursive: true });
  const oldTime = new Date(now - 4 * 60 * 60 * 1000);
  for (const name of stale) {
    await utimes(path.join(directory, name), oldTime, oldTime);
  }

  const result = await pruneGitRefMaterializations({
    directory,
    now,
    maxAgeMs: 60 * 60 * 1000,
    keepNewest: 4,
  });

  expect(result.removed.sort()).toEqual(
    stale.map((name) => path.join(directory, name)).sort(),
  );
  expect(result.kept).toBe(2);
  const remaining = (await readdir(directory, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  expect(remaining).toEqual([...fresh, "someone-elses-data"].sort());
});

test("caps how many materializations are retained even when all are recent", async () => {
  const directory = await temporary("prune-cap");
  const now = Date.now();
  for (const [index, name] of ["a", "b", "c"].entries()) {
    const full = path.join(directory, `mek-git-ref-${name}`);
    await mkdir(full, { recursive: true });
    const time = new Date(now - (3 - index) * 1000);
    await utimes(full, time, time);
  }

  const result = await pruneGitRefMaterializations({ directory, now, keepNewest: 2 });

  expect(result.kept).toBe(2);
  expect(result.removed).toEqual([path.join(directory, "mek-git-ref-a")]);
});

test("disposes a materialized tree on request and leaves nothing behind on failure", async () => {
  const { root } = await repository();

  const materialized = await materializeGitRef(root, "HEAD");
  expect(await readdir(materialized.root)).toContain("assets");
  await materialized.cleanup();
  await expect(readdir(materialized.root)).rejects.toThrow();

  // A materialization that fails part-way must not leave a partial tree in tmp.
  const before = (await readdir(os.tmpdir())).filter((name) => name.startsWith("mek-git-ref-"));
  await expect(materializeGitRef(path.join(root, "absent"), "HEAD")).rejects.toThrow("does not exist");
  const after = (await readdir(os.tmpdir())).filter((name) => name.startsWith("mek-git-ref-"));
  expect(after.length).toBe(before.length);
});

test("reads many files in one batch stream without corrupting binary content", async () => {
  const { root } = await repository();
  // Binary bytes exercise the framing: a frame length must be respected exactly, and content must
  // not be decoded as text. A zero byte and a trailing newline are the cases that break naive parsing.
  const binary = Buffer.from([0x00, 0x01, 0xfe, 0xff, 0x0a, 0x00, 0x7f, 0x0a]);
  await mkdir(path.join(root, "assets", "nested"), { recursive: true });
  const expected = new Map<string, Buffer>();
  for (const [name, body] of [
    ["assets/one.bin", binary],
    ["assets/nested/two.bin", Buffer.from("no trailing newline", "utf8")],
    ["assets/nested/three.txt", Buffer.from("has\nnewlines\n", "utf8")],
  ] as const) {
    await writeFile(path.join(root, name), body);
    expected.set(name, body);
  }
  git(root, ["add", "-A"]);
  git(root, ["commit", "-q", "-m", "add mixed content"]);

  const materialized = await materializeGitRef(root, "HEAD");
  temporaryRoots.push(materialized.root);

  expect(materialized.fileCount).toBe(expected.size + 1);
  for (const [name, body] of expected) {
    const written = await readFile(path.join(materialized.root, name));
    expect(written.equals(body)).toBe(true);
  }
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
