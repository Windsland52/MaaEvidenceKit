import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, expect, test } from "vitest";

import { contentDigest } from "../../src/mla/content-digest.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function root(): Promise<string> {
  const created = await mkdtemp(path.join(os.tmpdir(), "mek-digest-"));
  temporaryRoots.push(created);
  return created;
}

test("digests identical bytes identically and different bytes differently", async () => {
  const directory = await root();
  const first = path.join(directory, "a.png");
  const second = path.join(directory, "b.png");
  const other = path.join(directory, "c.png");
  await writeFile(first, Buffer.from("same-bytes", "utf8"));
  await writeFile(second, Buffer.from("same-bytes", "utf8"));
  await writeFile(other, Buffer.from("different-bytes", "utf8"));

  const firstResult = await contentDigest(first);
  const secondResult = await contentDigest(second);
  const otherResult = await contentDigest(other);

  expect(firstResult).toEqual({
    ok: true,
    digest: expect.stringMatching(/^sha256:[0-9a-f]{64}$/u),
    sizeBytes: 10,
  });
  expect(secondResult).toEqual(firstResult);
  expect(otherResult.ok).toBe(true);
  if (firstResult.ok && otherResult.ok) expect(otherResult.digest).not.toBe(firstResult.digest);
});

test("reports an empty file as empty instead of hashing it", async () => {
  const directory = await root();
  const file = path.join(directory, "empty.png");
  await writeFile(file, new Uint8Array());

  expect(await contentDigest(file)).toEqual({ ok: false, reason: "empty", sizeBytes: 0 });
});

test("reports an absent or unreadable path without throwing", async () => {
  const directory = await root();
  const missing = path.join(directory, "does-not-exist.png");

  expect(await contentDigest(missing)).toEqual({ ok: false, reason: "unreadable" });
});

test("digests a file larger than one chunk read", async () => {
  const directory = await root();
  const file = path.join(directory, "large.bin");
  const size = 3 * 1024 * 1024 + 17;
  await writeFile(file, Buffer.alloc(size, 7));

  const result = await contentDigest(file);
  expect(result.ok).toBe(true);
  if (result.ok) expect(result.sizeBytes).toBe(size);
});
