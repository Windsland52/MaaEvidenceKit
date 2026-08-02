import { createReadStream } from "node:fs";
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
  if (["image", "directory", "archive_part"].includes(artifact.kind)) {
    throw new Error(`Evidence windows require a text artifact, received ${artifact.kind}.`);
  }
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
  const stream = createReadStream(artifact.path, { encoding: "utf8" });
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
