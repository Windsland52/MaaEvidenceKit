import { opendir, stat } from "node:fs/promises";
import path from "node:path";

import type { InspectionWarning } from "../evidence/index.js";

const MAX_SCANNED_FILES = 10_000;
const MAX_PROJECTS = 8;
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

export async function discoverMseProjects(inputPath: string): Promise<MseProjectDiscovery> {
  const resolved = path.resolve(inputPath);
  const metadata = await stat(resolved);
  const initialRoot = metadata.isDirectory() ? resolved : path.dirname(resolved);
  const direct = await existingInterface(initialRoot);
  if (direct !== null) {
    return { projects: [{ projectRoot: initialRoot, interfacePath: direct }], warnings: [] };
  }

  const interfaces: string[] = [];
  const queue = [initialRoot];
  let scannedFiles = 0;
  let scanTruncated = false;
  while (queue.length > 0 && !scanTruncated) {
    const directoryPath = queue.shift();
    if (directoryPath === undefined) break;
    const directory = await opendir(directoryPath);
    for await (const entry of directory) {
      if (entry.isSymbolicLink()) continue;
      const target = path.join(directoryPath, entry.name);
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
  return { projects: allProjects.slice(0, MAX_PROJECTS), warnings };
}
