import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { expect, test } from "vitest";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

type StaticImport = { specifier: string; typeOnly: boolean };

/**
 * Static imports of one module, as source text.
 *
 * A CLI command that never inspects anything must not pay for the inspection engine, so the entry
 * point is checked rather than trusted: one convenience import of the SDK facade adds about a second
 * to every invocation, and nothing else in the suite would notice.
 */
async function staticImports(relativePath: string): Promise<StaticImport[]> {
  const source = await readFile(path.join(repositoryRoot, relativePath), "utf8");
  const imports: StaticImport[] = [];
  for (const match of source.matchAll(/^import\s+(type\s+)?[^;]*?from\s+"([^"]+)";/gmu)) {
    imports.push({ specifier: match[2] as string, typeOnly: match[1] !== undefined });
  }
  return imports;
}

test("the CLI entry point does not import the SDK facade or Sentry at startup", async () => {
  const imports = await staticImports("src/cli/main.ts");
  const valueImports = imports.filter((entry) => !entry.typeOnly).map((entry) => entry.specifier);
  expect(valueImports).not.toContain("../index.js");
  expect(valueImports).not.toContain("../feedback/sentry.js");
  // The type-only import is the shape that keeps the barrel out of the runtime graph.
  expect(imports).toContainEqual({ specifier: "../index.js", typeOnly: true });
});

test("the feedback module imports the Sentry client only when it reports something", async () => {
  const imports = await staticImports("src/feedback/sentry.ts");
  expect(imports.map((entry) => entry.specifier)).not.toContain("@sentry/node");
  // The client is loaded through one memoized dynamic import, not a static one.
  const source = await readFile(path.join(repositoryRoot, "src/feedback/sentry.ts"), "utf8");
  expect(source).toContain('import("@sentry/node")');
});
