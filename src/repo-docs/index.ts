import { lstat, open, readdir, realpath } from "node:fs/promises";
import path from "node:path";

import {
  EVIDENCE_SCHEMA_VERSION,
  EvidenceLedger,
  artifactId,
  relativePortablePath,
  type Artifact,
  type EvidenceSource,
  type InspectionResult,
  type InspectionWarning,
} from "../evidence/index.js";

export const REPO_DOCS_KIND = "repo_docs" as const;

export const REPO_DOCS_LIMITS = {
  maxScannedEntries: 50_000,
  maxAgentsDocuments: 64,
  maxAgentsDocumentBytes: 64 * 1024,
  maxSkillFiles: 256,
  maxRepositoryDepth: 32,
  maxSkillDepth: 8,
} as const;

const SKILL_ROOTS = [".agents/skills", ".claude/skills", "skills"] as const;
const SKIPPED_DIRECTORIES = new Set([
  ".git",
  ".hg",
  ".svn",
  "node_modules",
  "dist",
  "build",
  ".venv",
  ".cache",
  "__pycache__",
  "tmp",
]);

export type RepositoryAgentsDocumentEvidence = {
  fileSizeBytes: number;
  returnedBytes: number;
  returnedLines: number;
  truncated: boolean;
  endsMidLine: boolean;
  text: string;
};

export type RepositorySkillFileEvidence = {
  fileSizeBytes: number;
  skillRoot: typeof SKILL_ROOTS[number];
  directoryDepth: number;
};

export type RepositoryDocsDetails = {
  agentsDocumentEvidenceIds: string[];
  skillFileEvidenceIds: string[];
  limits: typeof REPO_DOCS_LIMITS;
  scan: {
    scannedEntries: number;
    truncated: boolean;
    omissionsUnknown: boolean;
    agentsDocumentsOmitted: number;
    skillFilesOmitted: number;
  };
};

export type RepositoryDocsResult = InspectionResult<RepositoryDocsDetails> & { kind: typeof REPO_DOCS_KIND };

type Candidate = {
  absolutePath: string;
  relativePath: string;
} & (
  | { category: "agents" }
  | { category: "skill"; skillRoot: typeof SKILL_ROOTS[number]; directoryDepth: number }
);

type RejectedEntry = {
  absolutePath: string;
  relativePath: string;
  kind: Artifact["kind"];
  reason: string;
};

type PathValidation =
  | { ok: true; realPath: string; sizeBytes: number; dev: number; ino: number }
  | { ok: false; reason: string };

type ScanResult = {
  candidates: Candidate[];
  rejected: RejectedEntry[];
  scannedEntries: number;
  scanTruncated: boolean;
  depthLimitedDirectories: number;
  unreadableDirectories: number;
};

function comparePath(left: string, right: string): number {
  return left === right ? 0 : left < right ? -1 : 1;
}

function isWithinRoot(rootReal: string, candidateReal: string): boolean {
  const relative = path.relative(rootReal, candidateReal);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function skillLocation(relativePath: string): {
  skillRoot: typeof SKILL_ROOTS[number];
  directoryDepth: number;
} | null {
  const normalized = relativePath.replaceAll("\\", "/");
  const lower = normalized.toLowerCase();
  for (const skillRoot of SKILL_ROOTS) {
    const prefix = `${skillRoot.toLowerCase()}/`;
    if (!lower.startsWith(prefix) || path.posix.basename(lower) !== "skill.md") continue;
    const parent = path.posix.dirname(normalized.slice(prefix.length));
    return {
      skillRoot,
      directoryDepth: parent === "." ? 0 : parent.split("/").length,
    };
  }
  return null;
}

async function validatePath(rootReal: string, target: string, expected: "file" | "directory"): Promise<PathValidation> {
  try {
    const metadata = await lstat(target);
    if (metadata.isSymbolicLink()) return { ok: false, reason: "repo_docs_symbolic_link" };
    if (expected === "file" ? !metadata.isFile() : !metadata.isDirectory()) {
      return { ok: false, reason: "repo_docs_unsupported_entry_type" };
    }
    const targetReal = await realpath(target);
    if (!isWithinRoot(rootReal, targetReal)) return { ok: false, reason: "repo_docs_path_outside_root" };
    return {
      ok: true,
      realPath: targetReal,
      sizeBytes: metadata.size,
      dev: metadata.dev,
      ino: metadata.ino,
    };
  } catch {
    return { ok: false, reason: "repo_docs_unreadable" };
  }
}

function rejectedEntry(
  absolutePath: string,
  relativePath: string,
  kind: Artifact["kind"],
  reason: string,
): RejectedEntry {
  return { absolutePath, relativePath, kind, reason };
}

async function scanRepository(rootReal: string): Promise<ScanResult> {
  const candidates: Candidate[] = [];
  const rejected: RejectedEntry[] = [];
  const queue: Array<{ absolutePath: string; relativePath: string; depth: number }> = [{
    absolutePath: rootReal,
    relativePath: "",
    depth: 0,
  }];
  let scannedEntries = 0;
  let scanTruncated = false;
  let depthLimitedDirectories = 0;
  let unreadableDirectories = 0;

  while (queue.length > 0 && !scanTruncated) {
    queue.sort((left, right) => comparePath(left.relativePath, right.relativePath));
    const directory = queue.shift();
    if (directory === undefined) break;
    const validation = await validatePath(rootReal, directory.absolutePath, "directory");
    if (!validation.ok) {
      unreadableDirectories += 1;
      rejected.push(rejectedEntry(
        directory.absolutePath,
        directory.relativePath || ".",
        "directory",
        validation.reason,
      ));
      continue;
    }

    let entries;
    try {
      entries = await readdir(directory.absolutePath, { withFileTypes: true });
    } catch {
      unreadableDirectories += 1;
      rejected.push(rejectedEntry(
        directory.absolutePath,
        directory.relativePath || ".",
        "directory",
        "repo_docs_unreadable",
      ));
      continue;
    }
    entries.sort((left, right) => comparePath(left.name.normalize("NFC"), right.name.normalize("NFC")));

    for (const entry of entries) {
      if (scannedEntries >= REPO_DOCS_LIMITS.maxScannedEntries) {
        scanTruncated = true;
        break;
      }
      scannedEntries += 1;
      const absolutePath = path.join(directory.absolutePath, entry.name);
      const relativePath = relativePortablePath(rootReal, absolutePath).normalize("NFC");

      if (entry.isSymbolicLink()) {
        rejected.push(rejectedEntry(absolutePath, relativePath, "other", "repo_docs_symbolic_link"));
        continue;
      }
      if (entry.isDirectory()) {
        if (SKIPPED_DIRECTORIES.has(entry.name.toLowerCase())) continue;
        const depth = directory.depth + 1;
        if (depth > REPO_DOCS_LIMITS.maxRepositoryDepth) {
          depthLimitedDirectories += 1;
          rejected.push(rejectedEntry(absolutePath, relativePath, "directory", "repo_docs_repository_depth_limit"));
          continue;
        }
        queue.push({ absolutePath, relativePath, depth });
        continue;
      }
      if (!entry.isFile()) continue;
      if (entry.name.toLowerCase() === "agents.md") {
        candidates.push({ category: "agents", absolutePath, relativePath });
      }
      const location = skillLocation(relativePath);
      if (location !== null) {
        if (location.directoryDepth > REPO_DOCS_LIMITS.maxSkillDepth) {
          rejected.push(rejectedEntry(absolutePath, relativePath, "other", "repo_docs_skill_depth_limit"));
        } else {
          candidates.push({ category: "skill", absolutePath, relativePath, ...location });
        }
      }
    }
  }

  return {
    candidates: candidates.sort((left, right) => comparePath(left.relativePath, right.relativePath)),
    rejected,
    scannedEntries,
    scanTruncated,
    depthLimitedDirectories,
    unreadableDirectories,
  };
}

function completeUtf8PrefixLength(buffer: Buffer): number {
  if (buffer.length === 0) return 0;
  let leadIndex = buffer.length - 1;
  while (leadIndex >= 0 && ((buffer[leadIndex] ?? 0) & 0xc0) === 0x80) leadIndex -= 1;
  if (leadIndex < 0) return 0;
  const lead = buffer[leadIndex] ?? 0;
  const expected = lead < 0x80 ? 1 : lead < 0xe0 ? 2 : lead < 0xf0 ? 3 : lead < 0xf8 ? 4 : 1;
  const available = buffer.length - leadIndex;
  return available < expected ? leadIndex : buffer.length;
}

function countReturnedLines(text: string): number {
  if (text.length === 0) return 0;
  const newlines = text.match(/\r\n|\r|\n/g)?.length ?? 0;
  return newlines + (/\r\n$|[\r\n]$/.test(text) ? 0 : 1);
}

async function readAgentsDocument(
  rootReal: string,
  target: string,
): Promise<{ ok: true; data: RepositoryAgentsDocumentEvidence } | { ok: false; reason: string }> {
  const before = await validatePath(rootReal, target, "file");
  if (!before.ok) return before;
  let handle;
  try {
    handle = await open(target, "r");
    const opened = await handle.stat();
    if (!opened.isFile() || opened.dev !== before.dev || opened.ino !== before.ino) {
      return { ok: false, reason: "repo_docs_file_changed_during_read" };
    }
    const requestedBytes = Math.min(opened.size, REPO_DOCS_LIMITS.maxAgentsDocumentBytes);
    const buffer = Buffer.alloc(requestedBytes);
    let bytesRead = 0;
    while (bytesRead < requestedBytes) {
      const chunk = await handle.read(buffer, bytesRead, requestedBytes - bytesRead, bytesRead);
      if (chunk.bytesRead === 0) break;
      bytesRead += chunk.bytesRead;
    }
    const afterHandle = await handle.stat();
    const afterPath = await validatePath(rootReal, target, "file");
    if (
      !afterPath.ok
      || afterHandle.dev !== before.dev
      || afterHandle.ino !== before.ino
      || afterPath.dev !== before.dev
      || afterPath.ino !== before.ino
      || afterHandle.size !== opened.size
      || afterHandle.mtimeMs !== opened.mtimeMs
    ) {
      return { ok: false, reason: "repo_docs_file_changed_during_read" };
    }
    const readBuffer = buffer.subarray(0, bytesRead);
    const completeBytes = completeUtf8PrefixLength(readBuffer);
    const text = readBuffer.subarray(0, completeBytes).toString("utf8");
    const truncated = afterHandle.size > completeBytes;
    return {
      ok: true,
      data: {
        fileSizeBytes: afterHandle.size,
        returnedBytes: completeBytes,
        returnedLines: countReturnedLines(text),
        truncated,
        endsMidLine: truncated && text.length > 0 && !/[\r\n]$/.test(text),
        text,
      },
    };
  } catch {
    return { ok: false, reason: "repo_docs_unreadable" };
  } finally {
    await handle?.close();
  }
}

function artifactForCandidate(candidate: Candidate, sizeBytes: number): Artifact {
  return {
    id: artifactId(candidate.relativePath),
    path: candidate.absolutePath,
    relativePath: candidate.relativePath,
    kind: "other",
    status: "selected",
    sizeBytes,
  };
}

function sourceForArtifact(artifact: Artifact, line?: number, endLine?: number): EvidenceSource {
  return {
    artifactId: artifact.id,
    path: artifact.relativePath,
    ...(line === undefined ? {} : { line }),
    ...(endLine === undefined ? {} : { endLine }),
  };
}

function rejectionArtifact(entry: RejectedEntry): Artifact {
  return {
    id: artifactId(entry.relativePath),
    path: entry.absolutePath,
    relativePath: entry.relativePath,
    kind: entry.kind,
    status: "skipped",
    reason: entry.reason,
  };
}

function warningForRejected(reason: string, count: number): InspectionWarning {
  return {
    code: reason,
    message: `${count} repository entr${count === 1 ? "y was" : "ies were"} skipped (${reason}).`,
  };
}

export async function inspectRepositoryDocs(sourceRoot: string): Promise<RepositoryDocsResult> {
  const resolved = path.resolve(sourceRoot);
  let rootMetadata;
  try {
    rootMetadata = await lstat(resolved);
  } catch {
    throw new Error(`Repository docs source is not a directory: ${resolved}`);
  }
  if (rootMetadata.isSymbolicLink() || !rootMetadata.isDirectory()) {
    throw new Error(`Repository docs source is not a non-symbolic directory: ${resolved}`);
  }
  const rootReal = await realpath(resolved);
  const scan = await scanRepository(rootReal);
  const agentsCandidates = scan.candidates.filter((item) => item.category === "agents");
  const skillCandidates = scan.candidates.filter((item): item is Candidate & { category: "skill" } =>
    item.category === "skill");
  const selectedAgents = agentsCandidates.slice(0, REPO_DOCS_LIMITS.maxAgentsDocuments);
  const selectedSkills = skillCandidates.slice(0, REPO_DOCS_LIMITS.maxSkillFiles);
  const agentsDocumentsOmitted = Math.max(0, agentsCandidates.length - selectedAgents.length);
  const skillFilesOmitted = Math.max(0, skillCandidates.length - selectedSkills.length);
  const omissionsUnknown = scan.scanTruncated || scan.depthLimitedDirectories > 0 || scan.unreadableDirectories > 0;

  const ledger = new EvidenceLedger();
  const artifactMap = new Map<string, Artifact>();
  const rejectedCounts = new Map<string, number>();
  const addRejected = (entry: RejectedEntry): void => {
    artifactMap.set(entry.relativePath, rejectionArtifact(entry));
    rejectedCounts.set(entry.reason, (rejectedCounts.get(entry.reason) ?? 0) + 1);
  };
  for (const entry of scan.rejected) addRejected(entry);
  for (const candidate of agentsCandidates.slice(REPO_DOCS_LIMITS.maxAgentsDocuments)) {
    artifactMap.set(candidate.relativePath, {
      id: artifactId(candidate.relativePath),
      path: candidate.absolutePath,
      relativePath: candidate.relativePath,
      kind: "other",
      status: "skipped",
      reason: "repo_docs_agents_file_limit",
    });
  }
  for (const candidate of skillCandidates.slice(REPO_DOCS_LIMITS.maxSkillFiles)) {
    artifactMap.set(candidate.relativePath, {
      id: artifactId(candidate.relativePath),
      path: candidate.absolutePath,
      relativePath: candidate.relativePath,
      kind: "other",
      status: "skipped",
      reason: "repo_docs_skill_file_limit",
    });
  }

  const agentsDocumentEvidenceIds: string[] = [];
  const skillFileEvidenceIds: string[] = [];
  let agentsDocumentsTruncated = 0;
  for (const candidate of selectedAgents) {
    const read = await readAgentsDocument(rootReal, candidate.absolutePath);
    if (!read.ok) {
      addRejected(rejectedEntry(candidate.absolutePath, candidate.relativePath, "other", read.reason));
      continue;
    }
    const artifact = artifactForCandidate(candidate, read.data.fileSizeBytes);
    artifactMap.set(candidate.relativePath, artifact);
    if (read.data.truncated) agentsDocumentsTruncated += 1;
    const evidence = ledger.add(
      "repo_docs.agents_document",
      `Repository instructions document ${candidate.relativePath}${read.data.truncated ? " (truncated)" : ""}.`,
      sourceForArtifact(artifact, 1, Math.max(1, read.data.returnedLines)),
      read.data,
    );
    agentsDocumentEvidenceIds.push(evidence.id);
  }

  for (const candidate of selectedSkills) {
    const validation = await validatePath(rootReal, candidate.absolutePath, "file");
    if (!validation.ok) {
      addRejected(rejectedEntry(candidate.absolutePath, candidate.relativePath, "other", validation.reason));
      continue;
    }
    const artifact = artifactForCandidate(candidate, validation.sizeBytes);
    artifactMap.set(candidate.relativePath, artifact);
    const evidence = ledger.add<RepositorySkillFileEvidence>(
      "repo_docs.skill_file",
      `Repository skill file ${candidate.relativePath}.`,
      sourceForArtifact(artifact),
      {
        fileSizeBytes: validation.sizeBytes,
        skillRoot: candidate.skillRoot,
        directoryDepth: candidate.directoryDepth,
      },
    );
    skillFileEvidenceIds.push(evidence.id);
  }

  const warnings: InspectionWarning[] = [...rejectedCounts.entries()]
    .sort(([left], [right]) => comparePath(left, right))
    .map(([reason, count]) => warningForRejected(reason, count));
  if (scan.scanTruncated) {
    warnings.push({
      code: "repo_docs_scan_truncated",
      message: `Repository documentation discovery stopped after ${REPO_DOCS_LIMITS.maxScannedEntries} entries; additional omissions are unknown.`,
    });
  }
  if (agentsDocumentsOmitted > 0 || omissionsUnknown) {
    warnings.push({
      code: "repo_docs_agents_truncated",
      message: `${agentsDocumentsOmitted} discovered AGENTS.md file(s) were omitted by the ${REPO_DOCS_LIMITS.maxAgentsDocuments}-file limit${omissionsUnknown ? "; additional omissions may be unknown" : ""}.`,
    });
  }
  if (skillFilesOmitted > 0 || omissionsUnknown) {
    warnings.push({
      code: "repo_docs_skills_truncated",
      message: `${skillFilesOmitted} discovered SKILL.md file(s) were omitted by the ${REPO_DOCS_LIMITS.maxSkillFiles}-file limit${omissionsUnknown ? "; additional omissions may be unknown" : ""}.`,
    });
  }

  const artifacts = [...artifactMap.values()].sort((left, right) =>
    comparePath(left.relativePath, right.relativePath));
  const evidence = ledger.values();
  return {
    schemaVersion: EVIDENCE_SCHEMA_VERSION,
    kind: REPO_DOCS_KIND,
    generatedAt: new Date().toISOString(),
    input: { path: rootReal },
    artifacts,
    evidence,
    missingEvidence: [],
    warnings,
    statistics: {
      scannedEntries: scan.scannedEntries,
      agentsDocumentsFound: agentsCandidates.length,
      agentsDocumentsSelected: agentsDocumentEvidenceIds.length,
      agentsDocumentsTruncated,
      agentsDocumentsOmitted,
      skillFilesFound: skillCandidates.length,
      skillFilesSelected: skillFileEvidenceIds.length,
      skillFilesOmitted,
      scanTruncated: scan.scanTruncated ? 1 : 0,
      omissionsUnknown: omissionsUnknown ? 1 : 0,
    },
    details: {
      agentsDocumentEvidenceIds,
      skillFileEvidenceIds,
      limits: REPO_DOCS_LIMITS,
      scan: {
        scannedEntries: scan.scannedEntries,
        truncated: scan.scanTruncated,
        omissionsUnknown,
        agentsDocumentsOmitted,
        skillFilesOmitted,
      },
    },
  };
}
