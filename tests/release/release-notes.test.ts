import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { expect, test } from "vitest";

const repositoryRoot = path.resolve(import.meta.dirname, "..", "..");
const script = path.join(repositoryRoot, "scripts", "release-notes.mjs");

function runScript(args: string[]) {
  const result = spawnSync(process.execPath, [script, ...args], { encoding: "utf8" });
  return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

const fixture = `# Changelog

## [Unreleased]

## [0.9.1] - 2026-10-01

### Changed

- First change.

- Second change.

## [0.9.0] - 2026-09-29

### Added

- Older change.

[Unreleased]: https://example.com/compare/v0.9.1...HEAD
[0.9.1]: https://example.com/compare/v0.9.0...v0.9.1
[0.9.0]: https://example.com/compare/v0.8.0...v0.9.0
`;

/**
 * The publish workflow turns a `v<version>` tag into a GitHub Release whose notes are exactly that
 * version's CHANGELOG.md section, extracted by `scripts/release-notes.mjs`. A wrong boundary here
 * publishes another version's entries or the comparison-link block, so the extraction is pinned by
 * fixtures and the script's failure modes (missing or empty section) must be errors, not empty
 * notes that silently reach the release page.
 */
test("release-notes extracts one version's section without headings or link definitions", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "maa-evidence-release-notes-"));
  try {
    const changelog = path.join(directory, "CHANGELOG.md");
    await writeFile(changelog, fixture, "utf8");
    const extracted = runScript(["0.9.1", changelog]);
    expect(extracted.status).toBe(0);
    expect(extracted.stderr).toBe("");
    expect(extracted.stdout).toBe("### Changed\n\n- First change.\n\n- Second change.\n");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("release-notes stops before the comparison-link block of the oldest section", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "maa-evidence-release-notes-"));
  try {
    const changelog = path.join(directory, "CHANGELOG.md");
    await writeFile(changelog, fixture, "utf8");
    const extracted = runScript(["0.9.0", changelog]);
    expect(extracted.status).toBe(0);
    expect(extracted.stdout).toBe("### Added\n\n- Older change.\n");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("release-notes fails on a missing version or an empty section", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "maa-evidence-release-notes-"));
  try {
    const changelog = path.join(directory, "CHANGELOG.md");
    await writeFile(changelog, fixture, "utf8");
    const missing = runScript(["0.8.0", changelog]);
    expect(missing.status).toBe(1);
    expect(missing.stdout).toBe("");
    expect(missing.stderr).toContain('no "## [0.8.0] - <date>" section');

    await writeFile(changelog, `${fixture}\n## [0.8.0] - 2026-08-01\n\n## [0.7.0] - 2026-07-01\n`, "utf8");
    const empty = runScript(["0.8.0", changelog]);
    expect(empty.status).toBe(1);
    expect(empty.stdout).toBe("");
    expect(empty.stderr).toContain("section for 0.8.0 is empty");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

/**
 * RELEASING.md requires the changelog section to exist before tagging, and the publish workflow
 * extracts it from the tag itself. Asserting it for the manifest's own version turns a forgotten
 * section into a CI failure instead of a failed tag publish.
 */
test("the current package version has a non-empty changelog section", async () => {
  const manifest = JSON.parse(await readFile(path.join(repositoryRoot, "package.json"), "utf8")) as {
    version: string;
  };
  const extracted = runScript([manifest.version]);
  expect(extracted.status).toBe(0);
  expect(extracted.stdout.trim()).not.toBe("");
});
