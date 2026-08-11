import { open, opendir, realpath, stat } from "node:fs/promises";
import path from "node:path";

import { artifactId, relativePortablePath } from "../evidence/index.js";
import type { Artifact, InspectionWarning, MissingEvidence } from "../evidence/index.js";

const SAMPLE_BYTES = 64 * 1024;
const MAX_SCANNED_FILES = 10_000;
const MAX_REPORTED_OTHER_FILES = 200;
const IGNORED_DIRECTORIES = new Set([
  ".git",
  ".hg",
  ".svn",
  ".venv",
  "node_modules",
  "dist",
  "build",
  "__pycache__",
]);
const MAA_LINE =
  /\[\d{4}-\d{2}-\d{2} [^\]]+\]\[(?:TRC|DBG|INF|WRN|ERR|FTL)\]\[Px\d+\]\[Tx\d+\]\[[^\]]+\]/g;
const NUMBERED_ARCHIVE = /^(.*?part)(\d+)(?:[._-]?of[._-]?(\d+))?(\.(?:zip|7z|rar|tar(?:\.gz)?|tgz))$/i;
const SPLIT_ARCHIVE = /^(.*)\.(z|r)(\d{2,})$/i;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export type ArtifactDiscovery = {
  root: string;
  artifacts: Artifact[];
  missingEvidence: MissingEvidence[];
  warnings: InspectionWarning[];
  scannedFileCount: number;
  omittedOtherFileCount: number;
};

async function boundedSample(file: string): Promise<string> {
  const handle = await open(file, "r");
  try {
    const metadata = await handle.stat();
    const headSize = Math.min(Math.ceil(SAMPLE_BYTES / 2), metadata.size);
    const head = Buffer.alloc(headSize);
    await handle.read(head, 0, headSize, 0);
    if (metadata.size <= SAMPLE_BYTES) {
      const tailSize = metadata.size - headSize;
      if (tailSize <= 0) return head.toString("utf8");
      const tail = Buffer.alloc(tailSize);
      await handle.read(tail, 0, tailSize, headSize);
      return Buffer.concat([head, tail]).toString("utf8");
    }
    const tailSize = Math.floor(SAMPLE_BYTES / 2);
    const tail = Buffer.alloc(tailSize);
    await handle.read(tail, 0, tailSize, metadata.size - tailSize);
    return `${head.toString("utf8")}\n[MAA EVIDENCE SAMPLE GAP]\n${tail.toString("utf8")}`;
  } finally {
    await handle.close();
  }
}

async function hasSupportedImageSignature(file: string): Promise<boolean> {
  const handle = await open(file, "r");
  try {
    const header = Buffer.alloc(12);
    const { bytesRead } = await handle.read(header, 0, header.length, 0);
    if (bytesRead >= PNG_SIGNATURE.length && header.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
      return true;
    }
    if (bytesRead >= 3 && header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff) return true;
    if (bytesRead >= 6 && ["GIF87a", "GIF89a"].includes(header.toString("ascii", 0, 6))) return true;
    if (bytesRead >= 2 && header.toString("ascii", 0, 2) === "BM") return true;
    return bytesRead >= 12
      && header.toString("ascii", 0, 4) === "RIFF"
      && header.toString("ascii", 8, 12) === "WEBP";
  } finally {
    await handle.close();
  }
}

function isMaaFilename(file: string): boolean {
  const name = path.basename(file).toLowerCase();
  return (
    name === "maa.log"
    || name === "maa.bak.log"
    || (name.startsWith("maafw.") && name.endsWith(".log"))
  );
}

async function classifyFile(file: string): Promise<Artifact["kind"]> {
  const name = path.basename(file).toLowerCase();
  if (NUMBERED_ARCHIVE.test(name) || SPLIT_ARCHIVE.test(name)) return "archive_part";
  if (["interface.json", "interface.jsonc"].includes(name)) return "interface";
  if (/\.(?:png|jpe?g|webp|bmp)$/i.test(name)) return "image";
  if (/\.jsonc?$/i.test(name) && /(?:pipeline|resource|task)/i.test(file)) return "pipeline";
  if (await hasSupportedImageSignature(file)) return "image";
  if (!name.endsWith(".log") && !name.endsWith(".txt")) return "other";
  if (isMaaFilename(file)) return "maa_log";
  const sample = await boundedSample(file);
  if (sample.includes("[Logger] MAA Process Start")) return "maa_log";
  if ((sample.match(MAA_LINE) ?? []).length >= 2) return "maa_log";
  return "log";
}

async function collectFiles(root: string): Promise<{ files: string[]; truncated: boolean }> {
  const rootReal = await realpath(root);
  const files: string[] = [];
  const queue = [root];
  let truncated = false;
  while (queue.length > 0 && !truncated) {
    const current = queue.shift();
    if (current === undefined) break;
    const directory = await opendir(current);
    for await (const entry of directory) {
      if (entry.isSymbolicLink()) continue;
      const target = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (!IGNORED_DIRECTORIES.has(entry.name.toLowerCase())) queue.push(target);
        continue;
      }
      if (!entry.isFile()) continue;
      const targetReal = await realpath(target);
      const relative = path.relative(rootReal, targetReal);
      if (relative.startsWith("..") || path.isAbsolute(relative)) continue;
      files.push(target);
      if (files.length >= MAX_SCANNED_FILES) {
        truncated = true;
        break;
      }
    }
  }
  return { files: files.sort((left, right) => left.localeCompare(right)), truncated };
}

function findMissingArchiveParts(artifacts: readonly Artifact[]): MissingEvidence[] {
  const byDirectory = new Map<string, Artifact[]>();
  for (const artifact of artifacts.filter((item) => item.kind === "archive_part")) {
    const directory = path.dirname(artifact.path);
    const items = byDirectory.get(directory) ?? [];
    items.push(artifact);
    byDirectory.set(directory, items);
  }
  const missing: MissingEvidence[] = [];
  for (const items of byDirectory.values()) {
    const numberedGroups = new Map<string, Array<{ index: number; total?: number; artifact: Artifact }>>();
    const splitGroups = new Map<string, Array<{ index: number; marker: string; artifact: Artifact }>>();
    for (const artifact of items) {
      const name = path.basename(artifact.path);
      const numbered = NUMBERED_ARCHIVE.exec(name);
      if (numbered !== null && numbered[1] !== undefined && numbered[2] !== undefined) {
        const key = `${numbered[1].toLowerCase()}${numbered[4]?.toLowerCase() ?? ""}`;
        const records = numberedGroups.get(key) ?? [];
        const totalText = numbered[3];
        records.push({
          index: Number(numbered[2]),
          ...(totalText === undefined ? {} : { total: Number(totalText) }),
          artifact,
        });
        numberedGroups.set(key, records);
        continue;
      }
      const split = SPLIT_ARCHIVE.exec(name);
      if (split !== null && split[1] !== undefined && split[2] !== undefined && split[3] !== undefined) {
        const key = `${split[1].toLowerCase()}.${split[2].toLowerCase()}`;
        const records = splitGroups.get(key) ?? [];
        records.push({ index: Number(split[3]), marker: split[2].toLowerCase(), artifact });
        splitGroups.set(key, records);
      }
    }
    for (const records of numberedGroups.values()) {
      const observed = new Set(records.map((item) => item.index));
      const declared = records.flatMap((item) => (item.total === undefined ? [] : [item.total]));
      const maximum = Math.max(...records.map((item) => item.index), ...declared);
      const start = observed.has(0) ? 0 : 1;
      const absent = Array.from({ length: maximum - start + 1 }, (_, offset) => offset + start)
        .filter((index) => !observed.has(index));
      if (absent.length > 0) {
        missing.push({
          code: "multipart_archive_part_missing",
          message: `Multipart archive is missing part numbers ${absent.join(", ")}.`,
          ...(records[0] === undefined ? {} : { path: records[0].artifact.path }),
        });
      }
    }
    for (const records of splitGroups.values()) {
      const start = records[0]?.marker === "r" ? 0 : 1;
      const observed = new Set(records.map((item) => item.index));
      const maximum = Math.max(...observed);
      const absent = Array.from({ length: maximum - start + 1 }, (_, offset) => offset + start)
        .filter((index) => !observed.has(index));
      if (absent.length > 0) {
        missing.push({
          code: "multipart_archive_part_missing",
          message: `Split archive is missing part numbers ${absent.join(", ")}.`,
          ...(records[0] === undefined ? {} : { path: records[0].artifact.path }),
        });
      }
    }
  }
  return missing;
}

export async function discoverArtifacts(inputPath: string): Promise<ArtifactDiscovery> {
  const resolved = path.resolve(inputPath);
  const metadata = await stat(resolved);
  const root = metadata.isDirectory() ? resolved : path.dirname(resolved);
  const collected = metadata.isDirectory()
    ? await collectFiles(resolved)
    : { files: [resolved], truncated: false };
  const artifacts: Artifact[] = [];
  let omittedOtherFileCount = 0;
  let reportedOtherFiles = 0;
  for (const file of collected.files) {
    let fileMetadata;
    let kind: Artifact["kind"];
    try {
      fileMetadata = await stat(file);
      kind = await classifyFile(file);
    } catch (error: unknown) {
      const relativePath = relativePortablePath(root, file);
      artifacts.push({
        id: artifactId(relativePath),
        path: file,
        relativePath,
        kind: "other",
        status: "unreadable",
        reason: error instanceof Error ? error.message : String(error),
      });
      continue;
    }
    if (kind === "other" && reportedOtherFiles >= MAX_REPORTED_OTHER_FILES) {
      omittedOtherFileCount += 1;
      continue;
    }
    if (kind === "other") reportedOtherFiles += 1;
    const relativePath = relativePortablePath(root, file);
    artifacts.push({
      id: artifactId(relativePath),
      path: file,
      relativePath,
      kind,
      status: kind === "other" || kind === "log" ? "skipped" : "available",
      sizeBytes: fileMetadata.size,
      ...(kind === "other" || kind === "log"
        ? { reason: "No supported deterministic Maa evidence adapter selected this file." }
        : {}),
    });
  }
  const warnings: InspectionWarning[] = [];
  if (collected.truncated) {
    warnings.push({
      code: "artifact_scan_truncated",
      message: `Artifact discovery stopped after ${MAX_SCANNED_FILES} files.`,
    });
  }
  if (omittedOtherFileCount > 0) {
    warnings.push({
      code: "unsupported_artifact_list_truncated",
      message: `${omittedOtherFileCount} unsupported files were omitted from the artifact list.`,
    });
  }
  return {
    root,
    artifacts,
    missingEvidence: findMissingArchiveParts(artifacts),
    warnings,
    scannedFileCount: collected.files.length,
    omittedOtherFileCount,
  };
}
