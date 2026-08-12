import { createReadStream, type ReadStream } from "node:fs";
import { lstat, open, realpath, type FileHandle } from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline";

import type { InspectionResult } from "./types.js";

export const EVIDENCE_WINDOW_SCHEMA_VERSION = "maa-evidence-window/v1" as const;

export type EvidenceWindowQuery = {
  evidenceId?: string;
  artifactId?: string;
  line?: number;
  before?: number;
  after?: number;
  maxLines?: number;
  maxCharacters?: number;
};

export type EvidenceWindow = {
  schemaVersion: typeof EVIDENCE_WINDOW_SCHEMA_VERSION;
  artifactId: string;
  path: string;
  evidenceId?: string;
  startLine: number;
  endLine: number;
  text: string;
  truncated: boolean;
};

function boundedInteger(value: number | undefined, fallback: number, minimum: number, maximum: number): number {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`Expected an integer from ${minimum} through ${maximum}, received ${value}.`);
  }
  return value;
}

type AuthorizedFileIdentity = { dev: number; ino: number; size: number; mtimeMs: number };

async function authorizeRepositoryDocsArtifact(
  inspection: InspectionResult,
  artifactPath: string,
): Promise<AuthorizedFileIdentity> {
  const [rootMetadata, artifactMetadata] = await Promise.all([
    lstat(inspection.input.path),
    lstat(artifactPath),
  ]);
  if (rootMetadata.isSymbolicLink() || !rootMetadata.isDirectory()) {
    throw new Error("Repository documentation windows require the original non-symbolic checkout root.");
  }
  if (artifactMetadata.isSymbolicLink() || !artifactMetadata.isFile()) {
    throw new Error("Repository documentation windows do not follow symbolic or non-file artifacts.");
  }
  const [rootReal, artifactReal] = await Promise.all([
    realpath(inspection.input.path),
    realpath(artifactPath),
  ]);
  const relative = path.relative(rootReal, artifactReal);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Repository documentation artifact resolves outside the inventoried checkout.");
  }
  return {
    dev: artifactMetadata.dev,
    ino: artifactMetadata.ino,
    size: artifactMetadata.size,
    mtimeMs: artifactMetadata.mtimeMs,
  };
}

function sameIdentity(left: AuthorizedFileIdentity, right: AuthorizedFileIdentity): boolean {
  return left.dev === right.dev
    && left.ino === right.ino
    && left.size === right.size
    && left.mtimeMs === right.mtimeMs;
}

export async function queryEvidenceWindow(
  inspection: InspectionResult,
  query: EvidenceWindowQuery,
): Promise<EvidenceWindow> {
  const evidence = query.evidenceId === undefined
    ? undefined
    : inspection.evidence.find((item) => item.id === query.evidenceId);
  if (query.evidenceId !== undefined && evidence === undefined) {
    throw new Error(`Unknown evidence ID: ${query.evidenceId}`);
  }
  const targetArtifactId = query.artifactId ?? evidence?.source.artifactId;
  if (targetArtifactId === undefined) {
    throw new Error("window requires evidenceId or artifactId.");
  }
  const artifact = inspection.artifacts.find((item) => item.id === targetArtifactId);
  if (artifact === undefined) throw new Error(`Unknown artifact ID: ${targetArtifactId}`);
  if (artifact.status === "skipped" || artifact.status === "unreadable") {
    throw new Error(`Evidence windows require an authorized readable artifact, received status ${artifact.status}.`);
  }
  if (["image", "directory", "archive_part"].includes(artifact.kind)) {
    throw new Error(`Evidence windows require a text artifact, received ${artifact.kind}.`);
  }
  const repositoryDocsIdentity = inspection.kind === "repo_docs"
    ? await authorizeRepositoryDocsArtifact(inspection, artifact.path)
    : undefined;
  const before = boundedInteger(query.before, 20, 0, 200);
  const after = boundedInteger(query.after, 20, 0, 200);
  const maxLines = boundedInteger(query.maxLines, 400, 1, 400);
  const maxCharacters = boundedInteger(query.maxCharacters, 40_000, 1, 40_000);
  const focusLine = boundedInteger(query.line ?? evidence?.source.line, 1, 1, Number.MAX_SAFE_INTEGER);
  const requestedStart = Math.max(1, focusLine - before);
  const requestedEnd = Math.min(requestedStart + maxLines - 1, focusLine + after);
  const output: string[] = [];
  let characters = 0;
  let currentLine = 0;
  let endLine = requestedStart - 1;
  let truncated = false;
  let repositoryDocsHandle: FileHandle | undefined;
  let stream: ReadStream;
  if (repositoryDocsIdentity === undefined) {
    stream = createReadStream(artifact.path, { encoding: "utf8" });
  } else {
    repositoryDocsHandle = await open(artifact.path, "r");
    const openedIdentity = await repositoryDocsHandle.stat();
    if (!sameIdentity(repositoryDocsIdentity, openedIdentity)) {
      await repositoryDocsHandle.close();
      throw new Error("Repository documentation artifact changed before its evidence window was read.");
    }
    stream = repositoryDocsHandle.createReadStream({ encoding: "utf8", autoClose: false });
  }
  const reader = createInterface({ input: stream, crlfDelay: Infinity });
  try {
    for await (const line of reader) {
      currentLine += 1;
      if (currentLine < requestedStart) continue;
      if (currentLine > requestedEnd) break;
      const rendered = `${currentLine}: ${line}`;
      if (characters + rendered.length + 1 > maxCharacters) {
        truncated = true;
        break;
      }
      output.push(rendered);
      characters += rendered.length + 1;
      endLine = currentLine;
    }
  } finally {
    reader.close();
    stream.destroy();
    await repositoryDocsHandle?.close();
  }
  if (repositoryDocsIdentity !== undefined) {
    const afterRead = await authorizeRepositoryDocsArtifact(inspection, artifact.path);
    if (!sameIdentity(repositoryDocsIdentity, afterRead)) {
      throw new Error("Repository documentation artifact changed while the evidence window was read.");
    }
  }
  if (endLine < requestedEnd && currentLine > endLine) truncated = true;
  return {
    schemaVersion: EVIDENCE_WINDOW_SCHEMA_VERSION,
    artifactId: artifact.id,
    path: artifact.relativePath,
    ...(evidence === undefined ? {} : { evidenceId: evidence.id }),
    startLine: requestedStart,
    endLine,
    text: output.join("\n"),
    truncated,
  };
}
