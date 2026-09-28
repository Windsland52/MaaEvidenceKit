#!/usr/bin/env node
/**
 * Acceptance check for the L1 coverage manifest against a real corpus.
 *
 * Usage: node scripts/bench/verify-manifest.mjs <corpus-dir> [cli-path]
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const corpus = process.argv[2];
const cli = process.argv[3] ?? "dist/cli/main.js";
if (corpus === undefined) {
  console.error("usage: verify-manifest.mjs <corpus-dir> [cli-path]");
  process.exit(2);
}
const env = { ...process.env, MAA_EVIDENCE_TELEMETRY: "0", MAA_EVIDENCE_AUTO_UPDATE: "0" };
const runBytes = (args) => execFileSync(process.execPath, [cli, ...args], { encoding: "utf8", env, maxBuffer: 1 << 30 });
const lines = [];
const report = (label, detail) => lines.push(`${label}: ${detail}`);

// #1 one command, all artifacts, all fields, within both budgets
const pretty = runBytes(["mla", "inspect", corpus, "--format", "manifest"]);
const compact = runBytes(["mla", "inspect", corpus, "--format", "manifest-compact"]);
const doc = JSON.parse(pretty);
report("1. artifacts", `${doc.artifacts.length} rows`);
report("1. pretty bytes", `${Buffer.byteLength(pretty.trim())} (budget 8192)`);
report("1. compact bytes", `${Buffer.byteLength(compact.trim())} (budget 7168)`);
const missing = doc.artifacts.filter((row) => row.sha256 === null);
report("1. rows without sha256", `${missing.length}`);
report("1. row key union", [...new Set(doc.artifacts.flatMap((row) => Object.keys(row)))].sort().join(","));

// #2 five timestamped rotations with rotationIndex, plus the active file
const rotations = doc.artifacts.filter((row) => row.rotation !== undefined);
report("2. rotation rows", rotations.map((row) => `${row.rotation.family}#${row.rotation.index}=${row.path}`).join(" "));

// #3 manifest alone names the q1 root-cause artifact, with no content parsing
const instant = Date.parse("2026-09-26T18:42:09.390");
const covering = doc.artifacts.filter((row) => row.timeCoverage !== undefined
  && (row.timeCoverage.from === null || Date.parse(row.timeCoverage.from) <= instant)
  && (row.timeCoverage.to !== null && instant <= Date.parse(row.timeCoverage.to)));
report("3. extraction", doc.input.extraction);
report("3. artifacts covering 18:42:09.390", covering.map((row) => row.path).join(","));
report("3. unique", String(covering.length === 1));

// #4 coverage distinguishes read from discovered
report("4. coverage", JSON.stringify(doc.coverage));

// #5 skipped rows keep a reason; no network anywhere in this run
const skipped = doc.artifacts.filter((row) => row.status === "skipped");
report("5. skipped with a reason", `${skipped.filter((row) => typeof row.reason === "string" && row.reason.length > 0).length}/${skipped.length}`);

// #6 determinism, and both entry points agree on everything a corpus manifest states
const again = JSON.parse(runBytes(["mla", "inspect", corpus, "--format", "manifest"]));
const strip = (value) => { const copy = { ...value }; delete copy.generatedAt; return JSON.stringify(copy); };
report("6. two runs identical modulo generatedAt", String(strip(doc) === strip(again)));

// Independent corroboration: the corpus really holds this many files with these bytes.
const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
  entry.isDirectory() ? walk(path.join(dir, entry.name)) : [path.join(dir, entry.name)]);
const files = walk(corpus);
const totalBytes = files.reduce((sum, file) => sum + statSync(file).size, 0);
report("corpus", `${files.length} files / ${totalBytes} B`);
const sample = doc.artifacts.find((row) => row.path === "maafw.log");
if (sample !== undefined) {
  const digest = createHash("sha256").update(readFileSync(path.join(corpus, "maafw.log"))).digest("hex");
  report("corpus maafw.log sha256 matches", String(sample.sha256 === digest));
}

console.log(lines.join("\n"));
