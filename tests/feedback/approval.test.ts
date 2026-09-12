import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, expect, test } from "vitest";

import {
  createApprovalToken,
  feedbackPayloadDigest,
  readApprovalToken,
  writeApprovalToken,
} from "../../src/feedback/index.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function temporaryFile(label: string): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), `mek-approval-${label}-`));
  temporaryRoots.push(root);
  return path.join(root, "token.json");
}

const payload = {
  message: "MLA does not flag byte-identical on_error images.",
  category: "suggestion",
  component: "mla",
  attachments: [{ filename: "maafw.log", sizeBytes: 1024 }],
};

test("round-trips an approval token for the payload it approves", async () => {
  const file = await temporaryFile("roundtrip");
  const now = new Date("2026-09-12T00:00:00.000Z");
  const token = createApprovalToken({ ...payload, now });

  expect(token.schemaVersion).toBe("maa-evidence-feedback-approval/v1");
  expect(token.payloadDigest).toBe(feedbackPayloadDigest(payload));
  expect(token.expiresAt).toBe("2026-09-12T00:15:00.000Z");

  await writeApprovalToken(file, token);
  const read = await readApprovalToken(file, payload, new Date("2026-09-12T00:10:00.000Z"));
  expect(read.token).toBe(token.token);
  expect(read.payloadDigest).toBe(token.payloadDigest);
});

test("binds the approval to the exact payload", async () => {
  const file = await temporaryFile("bind");
  const now = new Date("2026-09-12T00:00:00.000Z");
  await writeApprovalToken(file, createApprovalToken({ ...payload, now }));
  const later = new Date("2026-09-12T00:05:00.000Z");

  // Different message, category, component, or attachment set must not reuse the approval.
  await expect(readApprovalToken(file, { ...payload, message: "Something else" }, later))
    .rejects.toThrow("does not match this feedback payload");
  await expect(readApprovalToken(file, { ...payload, category: "bug" }, later))
    .rejects.toThrow("does not match this feedback payload");
  await expect(readApprovalToken(file, { ...payload, component: "mse" }, later))
    .rejects.toThrow("does not match this feedback payload");
  await expect(readApprovalToken(file, {
    ...payload,
    attachments: [{ filename: "maafw.log", sizeBytes: 1024 }, { filename: "extra.png", sizeBytes: 5 }],
  }, later)).rejects.toThrow("does not match this feedback payload");
  // Attachment order is not part of the approval identity.
  await expect(readApprovalToken(file, payload, later)).resolves.toBeDefined();
});

test("refuses an expired approval instead of falling back to prompting", async () => {
  const file = await temporaryFile("expired");
  await writeApprovalToken(file, createApprovalToken({
    ...payload,
    now: new Date("2026-09-12T00:00:00.000Z"),
  }));

  await expect(readApprovalToken(file, payload, new Date("2026-09-12T00:15:00.000Z")))
    .rejects.toThrow("Approval token expired");
  await expect(readApprovalToken(file, payload, new Date("2026-09-12T00:16:00.000Z")))
    .rejects.toThrow("run \"feedback approve\" again");
});

test("rejects missing, malformed, and unsupported approval tokens", async () => {
  const missing = await temporaryFile("missing");
  await expect(readApprovalToken(missing, payload)).rejects.toThrow("Approval token not found");

  const malformed = await temporaryFile("malformed");
  await writeFile(malformed, "not json", "utf8");
  await expect(readApprovalToken(malformed, payload)).rejects.toThrow("not valid JSON");

  const wrongSchema = await temporaryFile("schema");
  await writeFile(wrongSchema, JSON.stringify({
    schemaVersion: "maa-evidence-feedback-approval/v2",
    token: "x",
    expiresAt: "2030-01-01T00:00:00.000Z",
    payloadDigest: feedbackPayloadDigest(payload),
  }), "utf8");
  await expect(readApprovalToken(wrongSchema, payload)).rejects.toThrow("unsupported schemaVersion");

  const incomplete = await temporaryFile("incomplete");
  await writeFile(incomplete, JSON.stringify({ schemaVersion: "maa-evidence-feedback-approval/v1" }), "utf8");
  await expect(readApprovalToken(incomplete, payload)).rejects.toThrow("missing required fields");

  const badDate = await temporaryFile("baddate");
  await writeFile(badDate, JSON.stringify({
    schemaVersion: "maa-evidence-feedback-approval/v1",
    token: "x",
    expiresAt: "not-a-date",
    payloadDigest: feedbackPayloadDigest(payload),
  }), "utf8");
  await expect(readApprovalToken(badDate, payload)).rejects.toThrow("unreadable expiresAt");
});
