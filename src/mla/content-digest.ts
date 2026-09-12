import { createHash } from "node:crypto";
import { open } from "node:fs/promises";

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
