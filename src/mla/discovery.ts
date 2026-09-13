import { open, opendir, realpath, stat } from "node:fs/promises";
import path from "node:path";

import { artifactId, relativePortablePath } from "../evidence/index.js";
import type { Artifact, InspectionWarning, MissingEvidence } from "../evidence/index.js";

const SAMPLE_BYTES = 64 * 1024;
const MAX_SCANNED_FILES = 10_000;
const MAX_REPORTED_OTHER_FILES = 200;
/**
 * How many omitted unsupported files to describe. Omitted files are never classified, so this list
 * is what tells a harness which files to look at itself; a small bound keeps the output readable
 * while still naming the first omissions in discovery order.
 */
export const MAX_REPORTED_OMITTED_FILES = 20;
/**
 * How many skipped link entries to name in a warning. MEK never follows a link, so the warning is
 * the only record that material behind one was left out; a small bound keeps the message readable
 * while still naming the omissions in a deterministic, sorted order.
 */
const MAX_REPORTED_SKIPPED_LINKS = 10;
export const MAX_DIRECTORY_ENTRIES = 10_000;
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

export type DirectoryEntryBudget = {
  countedFiles: number;
  exceeded: boolean;
};

/**
 * A file that discovery saw but did not classify or parse. MEK states what it omitted so a harness
 * can decide to inspect the file itself; it deliberately makes no claim about the file's contents
 * or meaning, which is what keeps unsupported material inside the harness's responsibility.
 */
export type OmittedUnsupportedFile = {
  relativePath: string;
  sizeBytes: number;
  /** Last modification time in ISO 8601. A deterministic file-system fact, not a parsed event time. */
  modifiedAt: string;
};

export type ArtifactDiscovery = {
  root: string;
  artifacts: Artifact[];
  missingEvidence: MissingEvidence[];
  warnings: InspectionWarning[];
  scannedFileCount: number;
  omittedOtherFileCount: number;
  /** Bounded description of the omitted files, in discovery order. */
  omittedUnsupportedFiles: OmittedUnsupportedFile[];
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

async function collectFiles(
  root: string,
): Promise<{ files: string[]; skippedLinks: string[]; truncated: boolean }> {
  const rootReal = await realpath(root);
  const files: string[] = [];
  const skippedLinks: string[] = [];
  const queue = [root];
  let truncated = false;
  while (queue.length > 0 && !truncated) {
    const current = queue.shift();
    if (current === undefined) break;
    const directory = await opendir(current);
    for await (const entry of directory) {
      const target = path.join(current, entry.name);
      if (entry.isSymbolicLink()) {
        // A link is never followed, so this path is recorded rather than traversed.
        skippedLinks.push(relativePortablePath(rootReal, target));
        continue;
      }
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
  return {
    files: files.sort((left, right) => left.localeCompare(right)),
    skippedLinks,
    truncated,
  };
}

/**
 * Describe the link entries discovery refused to follow. Paths are sorted so the message does not
 * depend on traversal order, and the list is bounded so a directory full of links stays readable.
 */
function skippedLinksWarning(skippedLinks: readonly string[]): InspectionWarning {
  const sorted = [...skippedLinks].sort((left, right) => left.localeCompare(right));
  const listed = sorted.slice(0, MAX_REPORTED_SKIPPED_LINKS);
  const remaining = sorted.length - listed.length;
  const more = remaining > 0 ? ` (+${remaining} more)` : "";
  return {
    code: "artifact_links_skipped",
    message: `Skipped ${sorted.length} symbolic link or junction ${sorted.length === 1 ? "entry" : "entries"}`
      + " during artifact discovery; MEK does not follow links, so their targets were not scanned: "
      + `${listed.join(", ")}${more}.`,
  };
}

/**
 * Bound how many files a directory may contribute before it is handed to the upstream directory
 * loader. `@windsland52/maa-log-tools` 2.0.0 removed its own entry-count limit, so this walk is the
 * only entry-count guard left on that path. It stops as soon as the limit is passed and therefore
 * never enumerates more than `limit + 1` files. Unlike artifact discovery it ignores no directory,
 * because the bound must reflect the whole traversal the loader would perform.
 */
export async function measureDirectoryEntries(
  root: string,
  limit: number = MAX_DIRECTORY_ENTRIES,
): Promise<DirectoryEntryBudget> {
  const queue = [root];
  let countedFiles = 0;
  while (queue.length > 0) {
    const current = queue.shift();
    if (current === undefined) break;
    const directory = await opendir(current);
    for await (const entry of directory) {
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        queue.push(path.join(current, entry.name));
        continue;
      }
      if (!entry.isFile()) continue;
      countedFiles += 1;
      if (countedFiles > limit) return { countedFiles, exceeded: true };
    }
  }
  return { countedFiles, exceeded: false };
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
    : { files: [resolved], skippedLinks: [], truncated: false };
  const artifacts: Artifact[] = [];
  let omittedOtherFileCount = 0;
  let reportedOtherFiles = 0;
  const omittedUnsupportedFiles: OmittedUnsupportedFile[] = [];
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
      if (omittedUnsupportedFiles.length < MAX_REPORTED_OMITTED_FILES) {
        // Metadata only: the file is not sampled, so this costs one stat and makes no content claim.
        omittedUnsupportedFiles.push({
          relativePath: relativePortablePath(root, file),
          sizeBytes: fileMetadata.size,
          modifiedAt: fileMetadata.mtime.toISOString(),
        });
      }
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
      message: `${omittedOtherFileCount} unsupported files were omitted from the artifact list`
        + `${omittedUnsupportedFiles.length === 0
          ? "."
          : `; the first ${omittedUnsupportedFiles.length} are described in omittedUnsupportedFiles with path, size, and modification time. MEK did not classify or parse them, so inspect them directly if an issue may depend on their contents.`}`,
    });
  }
  if (collected.skippedLinks.length > 0) warnings.push(skippedLinksWarning(collected.skippedLinks));
  return {
    root,
    artifacts,
    missingEvidence: findMissingArchiveParts(artifacts),
    warnings,
    scannedFileCount: collected.files.length,
    omittedOtherFileCount,
    omittedUnsupportedFiles,
  };
}
