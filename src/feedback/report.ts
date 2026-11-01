import { createHash } from "node:crypto";
import { readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const LARGE_ATTACHMENT_WARNING_BYTES = 20 * 1024 * 1024;
const MAX_ATTACHMENTS_BYTES = 200 * 1000 * 1000;

export const FEEDBACK_BUNDLE_SCHEMA_VERSION = "maa-evidence-feedback/v1" as const;

export type FeedbackAttachmentPreview = {
  path: string;
  filename: string;
  sizeBytes: number;
  large: boolean;
};

export type FeedbackCategory = "blocker" | "bug" | "suggestion" | "other";

export type FeedbackComponent = "mla" | "mse" | "discovery" | "views" | "other";

export type FeedbackPreview = {
  category: FeedbackCategory;
  component: FeedbackComponent;
  message: string;
  attachments: FeedbackAttachmentPreview[];
  totalAttachmentBytes: number;
  warnings: string[];
};

export type FeedbackRequest = {
  message: string;
  category?: FeedbackCategory;
  component?: FeedbackComponent;
  attachmentPaths?: string[];
};

export type FeedbackBundleAttachment = FeedbackAttachmentPreview & {
  /** Digest of the bytes the recipient will receive, so both sides can compare them. */
  sha256: string;
};

export type FeedbackBundle = {
  schemaVersion: typeof FEEDBACK_BUNDLE_SCHEMA_VERSION;
  generatedAt: string;
  mekVersion: string;
  category: FeedbackCategory;
  component: FeedbackComponent;
  message: string;
  attachments: FeedbackBundleAttachment[];
  totalAttachmentBytes: number;
  warnings: string[];
};

export async function previewFeedback(request: FeedbackRequest): Promise<FeedbackPreview> {
  const message = request.message.trim();
  if (message.length === 0) throw new Error("Feedback message must not be empty.");
  if (message.length > 10_000) throw new Error("Feedback message must not exceed 10,000 characters.");
  const category = request.category ?? "other";
  if (!["blocker", "bug", "suggestion", "other"].includes(category)) {
    throw new Error(`Unknown feedback category: ${category}`);
  }
  const attachments: FeedbackAttachmentPreview[] = [];
  for (const rawPath of new Set(request.attachmentPaths ?? [])) {
    const resolved = path.resolve(rawPath);
    const metadata = await stat(resolved);
    if (!metadata.isFile()) throw new Error(`Feedback attachment is not a file: ${resolved}`);
    attachments.push({
      path: resolved,
      filename: path.basename(resolved),
      sizeBytes: metadata.size,
      large: metadata.size >= LARGE_ATTACHMENT_WARNING_BYTES,
    });
  }
  const totalAttachmentBytes = attachments.reduce((total, item) => total + item.sizeBytes, 0);
  if (totalAttachmentBytes > MAX_ATTACHMENTS_BYTES) {
    throw new Error("The selected attachments exceed the 200 MB bundle limit.");
  }
  const warnings = [
    ...(attachments.length === 0
      ? []
      : [
        "The bundle lists attachments by path and digest; MEK never copies, reads into the report, or uploads them. Add them to whatever channel you use yourself.",
        "Attachments may contain account names, tokens, paths, screenshots, or other private data. Review them before sending anything.",
      ]),
    ...(attachments.some((item) => item.large)
      ? ["At least one attachment is 20 MB or larger; check that the receiving channel accepts it."]
      : []),
  ];
  return {
    category,
    component: request.component ?? "other",
    message,
    attachments,
    totalAttachmentBytes,
    warnings,
  };
}

/**
 * Write a self-describing bundle for a human to send through a channel they choose.
 *
 * Nothing leaves the machine here: the file names the attachments and their digests so the
 * recipient can confirm they received the same bytes.
 */
export async function writeFeedbackBundle(
  preview: FeedbackPreview,
  outputPath: string,
  options: { version: string; now?: Date },
): Promise<FeedbackBundle> {
  const attachments: FeedbackBundleAttachment[] = [];
  for (const attachment of preview.attachments) {
    const bytes = await readFile(attachment.path);
    attachments.push({
      ...attachment,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    });
  }
  const bundle: FeedbackBundle = {
    schemaVersion: FEEDBACK_BUNDLE_SCHEMA_VERSION,
    generatedAt: (options.now ?? new Date()).toISOString(),
    mekVersion: options.version,
    category: preview.category,
    component: preview.component,
    message: preview.message,
    attachments,
    totalAttachmentBytes: preview.totalAttachmentBytes,
    warnings: preview.warnings,
  };
  await writeFile(outputPath, `${JSON.stringify(bundle, null, 2)}\n`, "utf8");
  return bundle;
}
