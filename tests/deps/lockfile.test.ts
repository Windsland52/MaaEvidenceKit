import { readFile } from "node:fs/promises";
import path from "node:path";

import { expect, test } from "vitest";

const repositoryRoot = path.resolve(import.meta.dirname, "..", "..");

/**
 * pnpm resolves an import specifier from `package.json` first and only checks the lockfile against
 * the installed tree, so a stale lockfile can pass `pnpm install --frozen-lockfile` locally while
 * failing on a clean CI checkout. That happened once: a merge resolved a lockfile conflict by taking
 * the incoming branch's file, which left three bumped packages pinned to their old versions.
 *
 * This pins the invariant instead: every dependency's lockfile specifier must equal the manifest
 * specifier, which is what CI's frozen install actually requires.
 */
test("pnpm-lock.yaml matches every package.json specifier", async () => {
  const [manifest, lockfile] = await Promise.all([
    readFile(path.join(repositoryRoot, "package.json"), "utf8"),
    readFile(path.join(repositoryRoot, "pnpm-lock.yaml"), "utf8"),
  ]);
  const parsed = JSON.parse(manifest) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  const declared = { ...parsed.dependencies, ...parsed.devDependencies };

  // pnpm quotes lockfile keys only when the name needs it, so accept either form.
  const importerBlock = lockfile.split("\npackages:")[0] ?? "";
  const mismatches: string[] = [];
  for (const [name, version] of Object.entries(declared)) {
    const pattern = new RegExp(
      `^\\s+'?${name.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}'?:\\n\\s+specifier: (\\S+)\\n\\s+version: (\\S+)`,
      "mu",
    );
    const match = pattern.exec(importerBlock);
    if (match === null) {
      mismatches.push(`${name}: absent from the lockfile`);
      continue;
    }
    if (match[1] !== version) {
      mismatches.push(`${name}: lockfile specifier ${match[1]} but package.json declares ${version}`);
    } else if (!match[2]?.startsWith(version)) {
      mismatches.push(`${name}: lockfile resolved ${match[2] ?? "?"} but package.json declares ${version}`);
    }
  }

  expect(Object.keys(declared).length).toBeGreaterThan(0);
  expect(mismatches).toEqual([]);
});
