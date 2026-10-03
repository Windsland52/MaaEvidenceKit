import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Extract one released version's CHANGELOG.md section as GitHub release notes. The section heading
 * must carry a date ("## [0.9.1] - 2026-10-01"), so a bare "## [Unreleased]" can never be mistaken
 * for a released version.
 */
export function extractReleaseNotes(changelog, version) {
  const lines = changelog.split(/\r?\n/);
  const heading = new RegExp(`^## \\[${version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\] - \\S+`);
  const start = lines.findIndex((line) => heading.test(line));
  if (start === -1) {
    throw new Error(`no "## [${version}] - <date>" section`);
  }
  const body = [];
  for (const line of lines.slice(start + 1)) {
    // A section ends at the next section heading or at the comparison-link block at the file
    // bottom, so the oldest released section does not swallow the link definitions after it.
    if (line.startsWith("## [") || line.startsWith("[")) {
      break;
    }
    body.push(line);
  }
  const notes = body.join("\n").trim();
  if (notes.length === 0) {
    throw new Error(`section for ${version} is empty`);
  }
  return notes;
}

async function main() {
  const [rawVersion, changelogPath] = process.argv.slice(2);
  if (rawVersion === undefined) {
    console.error("Usage: node scripts/release-notes.mjs <version> [changelog]");
    process.exitCode = 1;
    return;
  }
  const version = rawVersion.replace(/^v/, "");
  const source = changelogPath ?? path.join(repositoryRoot, "CHANGELOG.md");
  try {
    const notes = extractReleaseNotes(await readFile(source, "utf8"), version);
    process.stdout.write(`${notes}\n`);
  } catch (error) {
    console.error(`${path.basename(source)}: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}

const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  await main();
}
