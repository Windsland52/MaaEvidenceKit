import { opendir, stat } from "node:fs/promises";
import path from "node:path";

import {
  UsageError,
  isMissingPathError,
  relativePortablePath,
  type InspectionWarning,
} from "../evidence/index.js";

const MAX_SCANNED_FILES = 10_000;
const MAX_PROJECTS = 8;
/**
 * How many skipped link entries to name in a warning. MEK never follows a link, so the warning is
 * the only record that a project could sit behind one; a small bound keeps the message readable
 * while still naming the omissions in a deterministic, sorted order.
 */
const MAX_REPORTED_SKIPPED_LINKS = 10;
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

export type MseProjectCandidate = {
  projectRoot: string;
  interfacePath: string;
};

export type MseProjectDiscovery = {
  projects: MseProjectCandidate[];
  warnings: InspectionWarning[];
};

async function existingInterface(projectRoot: string): Promise<string | null> {
  for (const candidate of [
    path.join(projectRoot, "interface.json"),
    path.join(projectRoot, "interface.jsonc"),
    path.join(projectRoot, "assets", "interface.json"),
    path.join(projectRoot, "assets", "interface.jsonc"),
  ]) {
    try {
      if ((await stat(candidate)).isFile()) return candidate;
    } catch {
      // Continue through conventional candidates.
    }
  }
  return null;
}

function rootForInterface(interfacePath: string): string {
  const parent = path.dirname(interfacePath);
  return path.basename(parent).toLowerCase() === "assets" ? path.dirname(parent) : parent;
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
    code: "mse_project_links_skipped",
    message: `Skipped ${sorted.length} symbolic link or junction ${sorted.length === 1 ? "entry" : "entries"}`
      + " during MSE project discovery; MEK does not follow links, so their targets were not scanned: "
      + `${listed.join(", ")}${more}.`,
  };
}

export async function discoverMseProjects(inputPath: string): Promise<MseProjectDiscovery> {
  const resolved = path.resolve(inputPath);
  let metadata;
  try {
    metadata = await stat(resolved);
  } catch (error: unknown) {
    if (isMissingPathError(error)) throw new UsageError(`Input path not found: ${resolved}`);
    throw error;
  }
  const initialRoot = metadata.isDirectory() ? resolved : path.dirname(resolved);
  const direct = await existingInterface(initialRoot);
  if (direct !== null) {
    return { projects: [{ projectRoot: initialRoot, interfacePath: direct }], warnings: [] };
  }

  const interfaces: string[] = [];
  const skippedLinks: string[] = [];
  const queue = [initialRoot];
  let scannedFiles = 0;
  let scanTruncated = false;
  while (queue.length > 0 && !scanTruncated) {
    const directoryPath = queue.shift();
    if (directoryPath === undefined) break;
    const directory = await opendir(directoryPath);
    for await (const entry of directory) {
      const target = path.join(directoryPath, entry.name);
      if (entry.isSymbolicLink()) {
        // A link is never followed, so this path is recorded rather than traversed.
        skippedLinks.push(relativePortablePath(initialRoot, target));
        continue;
      }
      if (entry.isDirectory()) {
        if (!IGNORED_DIRECTORIES.has(entry.name.toLowerCase())) queue.push(target);
        continue;
      }
      if (!entry.isFile()) continue;
      scannedFiles += 1;
      if (scannedFiles > MAX_SCANNED_FILES) {
        scanTruncated = true;
        break;
      }
      if (["interface.json", "interface.jsonc"].includes(entry.name.toLowerCase())) {
        interfaces.push(target);
      }
    }
  }
  const unique = new Map<string, MseProjectCandidate>();
  for (const interfacePath of interfaces.sort((left, right) => left.localeCompare(right))) {
    const projectRoot = rootForInterface(interfacePath);
    unique.set(projectRoot.toLowerCase(), { projectRoot, interfacePath });
  }
  const allProjects = [...unique.values()];
  const warnings: InspectionWarning[] = [];
  if (scanTruncated) {
    warnings.push({
      code: "mse_project_scan_truncated",
      message: `MSE project discovery stopped after ${MAX_SCANNED_FILES} files.`,
    });
  }
  if (allProjects.length > MAX_PROJECTS) {
    warnings.push({
      code: "mse_project_list_truncated",
      message: `MSE inspection is limited to the first ${MAX_PROJECTS} discovered projects.`,
    });
  }
  if (skippedLinks.length > 0) warnings.push(skippedLinksWarning(skippedLinks));
  return { projects: allProjects.slice(0, MAX_PROJECTS), warnings };
}
