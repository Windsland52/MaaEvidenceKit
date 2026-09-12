import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { readFile, unlink, writeFile } from "node:fs/promises";

import { UsageError } from "../evidence/index.js";

/** Tokens are short-lived: approval is for one submission, not a standing grant. */
const TOKEN_TTL_MS = 15 * 60 * 1000;
const TOKEN_SCHEMA_VERSION = "maa-evidence-feedback-approval/v1" as const;

export type ApprovalTokenFile = {
  schemaVersion: typeof TOKEN_SCHEMA_VERSION;
  /** Opaque random value; only its presence is checked, never logged. */
  token: string;
  /** ISO 8601 instant after which the approval no longer applies. */
  expiresAt: string;
  /**
   * Digest of the approved payload. A submission whose preview does not reproduce this digest is
   * refused, so the human's approval covers exactly the content they saw.
   */
  payloadDigest: string;
};

/**
 * Digest the parts of a preview that a human approving it actually reviews: the message, the
 * category, the component, and each attachment's name and size. Attachment *bytes* are deliberately
 * not covered: the payload digest binds the submission to what the approver read, and every upload
 * still passes the unchanged `beforeSend` scrubbing, so a same-size file swapped in after approval
 * cannot change the message that was approved. The digest exists to stop an approval being reused
 * for different words or a different attachment set, not to attest file contents.
 *
 * The digest is unkeyed. It is not a signature: it makes an approval unforgeable for different
 * content, but it does not authenticate who approved, so it is a policy gate rather than a
 * cryptographic boundary. See PRIVACY.md.
 */
export function feedbackPayloadDigest(input: {
  message: string;
  category: string;
  component: string;
  attachments: readonly { filename: string; sizeBytes: number }[];
}): string {
  const canonical = JSON.stringify({
    message: input.message,
    category: input.category,
    component: input.component,
    attachments: [...input.attachments]
      .map((attachment) => ({ filename: attachment.filename, sizeBytes: attachment.sizeBytes }))
      .sort((left, right) => left.filename.localeCompare(right.filename)),
  });
  return createHash("sha256").update(canonical).digest("hex");
}

export function createApprovalToken(input: {
  message: string;
  category: string;
  component: string;
  attachments: readonly { filename: string; sizeBytes: number }[];
  now?: Date;
}): ApprovalTokenFile {
  const now = input.now ?? new Date();
  return {
    schemaVersion: TOKEN_SCHEMA_VERSION,
    token: randomBytes(32).toString("hex"),
    expiresAt: new Date(now.getTime() + TOKEN_TTL_MS).toISOString(),
    payloadDigest: feedbackPayloadDigest(input),
  };
}

export async function writeApprovalToken(path: string, token: ApprovalTokenFile): Promise<void> {
  await writeFile(path, `${JSON.stringify(token, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
}

function constantTimeEquals(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left, "utf8");
  const rightBytes = Buffer.from(right, "utf8");
  if (leftBytes.length !== rightBytes.length) return false;
  return timingSafeEqual(leftBytes, rightBytes);
}

/**
 * Read and validate an approval token against the payload about to be submitted.
 *
 * Every failure is an explicit refusal rather than a silent downgrade to the interactive path: a
 * caller that asked for token-based submission either holds a valid approval or does not submit.
 */
export async function readApprovalToken(
  path: string,
  payload: {
    message: string;
    category: string;
    component: string;
    attachments: readonly { filename: string; sizeBytes: number }[];
  },
  now: Date = new Date(),
): Promise<ApprovalTokenFile> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch {
    throw new UsageError(`Approval token not found: ${path}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new UsageError(`Approval token is not valid JSON: ${path}`);
  }
  const record = parsed as Partial<ApprovalTokenFile> | null;
  if (record === null || typeof record !== "object") {
    throw new UsageError(`Approval token has an unexpected shape: ${path}`);
  }
  if (record.schemaVersion !== TOKEN_SCHEMA_VERSION) {
    throw new UsageError(`Approval token has an unsupported schemaVersion: ${String(record.schemaVersion)}`);
  }
  if (typeof record.token !== "string" || typeof record.expiresAt !== "string"
    || typeof record.payloadDigest !== "string") {
    throw new UsageError(`Approval token is missing required fields: ${path}`);
  }
  const expiresAt = Date.parse(record.expiresAt);
  if (Number.isNaN(expiresAt)) {
    throw new UsageError(`Approval token has an unreadable expiresAt: ${path}`);
  }
  if (expiresAt <= now.getTime()) {
    throw new UsageError(
      `Approval token expired at ${record.expiresAt}; run "feedback approve" again in a real terminal.`,
    );
  }
  const expected = feedbackPayloadDigest(payload);
  if (!constantTimeEquals(record.payloadDigest, expected)) {
    throw new UsageError(
      "Approval token does not match this feedback payload; approve exactly the message, category, component, and attachments being submitted.",
    );
  }
  return record as ApprovalTokenFile;
}

/**
 * Validate an approval token and remove it, so one approval authorizes exactly one submission.
 *
 * The token is deleted before the upload is attempted. Consuming first is deliberate: if the
 * upload fails, the approval is spent and the caller must approve again, which is the safe
 * direction. Deleting afterwards would leave a window in which a failed or interrupted run still
 * holds a replayable approval.
 */
export async function consumeApprovalToken(
  path: string,
  payload: {
    message: string;
    category: string;
    component: string;
    attachments: readonly { filename: string; sizeBytes: number }[];
  },
  now: Date = new Date(),
): Promise<ApprovalTokenFile> {
  const token = await readApprovalToken(path, payload, now);
  try {
    await unlink(path);
  } catch (error: unknown) {
    throw new UsageError(
      `Approval token could not be consumed at ${path}: ${error instanceof Error ? error.message : String(error)}. `
      + "Refusing to submit, because the approval must not remain replayable.",
    );
  }
  return token;
}
