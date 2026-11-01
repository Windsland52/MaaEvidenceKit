import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, test } from "vitest";

import {
  FEEDBACK_BUNDLE_SCHEMA_VERSION,
  previewFeedback,
  writeFeedbackBundle,
} from "../../src/feedback/index.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function temporaryFile(name: string, content: string): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "mek-feedback-"));
  temporaryRoots.push(root);
  const file = path.join(root, name);
  await writeFile(file, content, "utf8");
  return file;
}

describe("feedback preview", () => {
  test("rejects an empty message, an unknown category, and a missing attachment", async () => {
    await expect(previewFeedback({ message: "   " })).rejects.toThrow(/must not be empty/u);
    await expect(previewFeedback({ message: "x", category: "blocker" })).resolves.toMatchObject({
      category: "blocker",
    });
    await expect(
      previewFeedback({ message: "x", category: "nope" as never }),
    ).rejects.toThrow(/Unknown feedback category/u);
    await expect(
      previewFeedback({ message: "x", attachmentPaths: ["/definitely/not/here.log"] }),
    ).rejects.toThrow();
  });

  test("warns that attachments stay local and are never read into the bundle", async () => {
    const attachment = await temporaryFile("maafw.log", "line\n");

    const preview = await previewFeedback({ message: "gap", attachmentPaths: [attachment] });

    expect(preview.attachments).toHaveLength(1);
    expect(preview.attachments[0]).toMatchObject({ filename: "maafw.log", sizeBytes: 5, large: false });
    expect(preview.warnings.join("\n")).toMatch(/never copies, reads into the report, or uploads/u);
    expect(preview.warnings.join("\n")).toMatch(/private data/u);
  });
});

describe("feedback bundle", () => {
  test("writes a self-describing manifest with the attachment digest", async () => {
    const attachment = await temporaryFile("maafw.log", "alpha\n");
    const out = path.join(path.dirname(attachment), "feedback.json");
    const preview = await previewFeedback({
      message: "recognition_detail misses the task",
      category: "bug",
      component: "mla",
      attachmentPaths: [attachment],
    });

    const bundle = await writeFeedbackBundle(preview, out, {
      version: "9.9.9",
      now: new Date("2026-07-19T10:00:00.000Z"),
    });
    const written = JSON.parse(await readFile(out, "utf8")) as typeof bundle;

    expect(written).toEqual(bundle);
    expect(written.schemaVersion).toBe(FEEDBACK_BUNDLE_SCHEMA_VERSION);
    expect(written.mekVersion).toBe("9.9.9");
    expect(written.generatedAt).toBe("2026-07-19T10:00:00.000Z");
    expect(written.category).toBe("bug");
    expect(written.component).toBe("mla");
    expect(written.message).toBe("recognition_detail misses the task");
    expect(written.attachments).toHaveLength(1);
    expect(written.attachments[0]?.sha256).toBe(
      createHash("sha256").update("alpha\n").digest("hex"),
    );
    // The digest is what lets the recipient confirm they received the same bytes.
    expect(written.attachments[0]?.sizeBytes).toBe(6);
  });

  test("does not embed attachment bytes", async () => {
    const attachment = await temporaryFile("big.log", "x".repeat(1024));
    const out = path.join(path.dirname(attachment), "feedback.json");
    const preview = await previewFeedback({ message: "gap", attachmentPaths: [attachment] });

    await writeFeedbackBundle(preview, out, { version: "0.0.0" });
    const raw = await readFile(out, "utf8");

    expect(raw.length).toBeLessThan(2048);
    expect(raw).not.toContain("x".repeat(64));
  });
});
