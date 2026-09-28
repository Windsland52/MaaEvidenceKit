import { createHash } from "node:crypto";
import { open } from "node:fs/promises";
import path from "node:path";

import type { Artifact } from "../evidence/index.js";

/** Hash chunk size. Bounded so a large image never has to be buffered whole. */
const DIGEST_CHUNK_BYTES = 1024 * 1024;

/**
 * Refuse to digest anything larger than this. Byte-identical screenshots run around 1 MiB; a cap
 * keeps an accidental multi-gigabyte file from turning one inspection into a long read, and the
 * omission is reported instead of being silently treated as "not identical".
 */
export const MAX_CONTENT_DIGEST_BYTES = 256 * 1024 * 1024;

export const CONTENT_DIGEST_ALGORITHM = "sha256" as const;

export type ContentDigestResult =
  | { ok: true; digest: string; sizeBytes: number }
  | { ok: false; reason: "unreadable" | "too_large" | "empty"; sizeBytes?: number };

/**
 * Compute a streaming SHA-256 digest of a file's bytes.
 *
 * This is a deterministic equality fact about file content, not a semantic judgement: two files
 * either have the same bytes or they do not. It deliberately says nothing about visual similarity.
 */
export async function contentDigest(file: string): Promise<ContentDigestResult> {
  let handle;
  try {
    handle = await open(file, "r");
  } catch {
    return { ok: false, reason: "unreadable" };
  }
  try {
    const metadata = await handle.stat();
    if (metadata.size === 0) return { ok: false, reason: "empty", sizeBytes: 0 };
    if (metadata.size > MAX_CONTENT_DIGEST_BYTES) {
      return { ok: false, reason: "too_large", sizeBytes: metadata.size };
    }
    const hash = createHash(CONTENT_DIGEST_ALGORITHM);
    const buffer = Buffer.alloc(Math.min(DIGEST_CHUNK_BYTES, metadata.size));
    let position = 0;
    for (;;) {
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, position);
      if (bytesRead === 0) break;
      hash.update(buffer.subarray(0, bytesRead));
      position += bytesRead;
    }
    if (position !== metadata.size) {
      // The file changed size while it was being read; do not report a digest for unknown content.
      return { ok: false, reason: "unreadable", sizeBytes: metadata.size };
    }
    return { ok: true, digest: `${CONTENT_DIGEST_ALGORITHM}:${hash.digest("hex")}`, sizeBytes: metadata.size };
  } catch {
    return { ok: false, reason: "unreadable" };
  } finally {
    await handle.close().catch(() => undefined);
  }
}

/**
 * Identity key for correlating a digest result with the artifact record it came from. Windows paths
 * are case-insensitive, so the key normalizes them the same way the artifact id does.
 */
export function contentDigestKey(target: string): string {
  const resolved = path.resolve(target);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

/**
 * Digest every artifact once, streaming.
 *
 * Coverage is deliberately total: a manifest or a report that carries some digests and not others
 * makes "does this record have a digest?" depend on window and adapter decisions instead of on the
 * content, which is a non-deterministic contract. Files that cannot be digested stay in the result
 * with their failure reason rather than being silently treated as absent or distinct.
 */
export async function digestArtifacts(
  artifacts: readonly Artifact[],
): Promise<Map<string, ContentDigestResult>> {
  const digests = new Map<string, ContentDigestResult>();
  const entries = [...artifacts]
    .sort((left, right) => left.relativePath.localeCompare(right.relativePath));
  for (const artifact of entries) {
    digests.set(contentDigestKey(artifact.path), await contentDigest(artifact.path));
  }
  return digests;
}

/**
 * Attach digest results back onto artifact records: a successful digest becomes `contentDigest`, a
 * failed one becomes an explicit `digestStatus`. Nothing is invented for a file that could not be
 * read — the absence stays named, never treated as equality or existence.
 */
export function applyDigestResults(
  artifacts: readonly Artifact[],
  digestResults: ReadonlyMap<string, ContentDigestResult>,
): Artifact[] {
  return artifacts.map((artifact) => {
    const result = digestResults.get(contentDigestKey(artifact.path));
    if (result === undefined) return artifact;
    if (result.ok) return { ...artifact, contentDigest: result.digest };
    return { ...artifact, digestStatus: result.reason };
  });
}
