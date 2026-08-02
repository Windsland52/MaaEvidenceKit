import { readFile, stat } from "node:fs/promises";
import path from "node:path";

import { sendSentryFeedback } from "./sentry.js";

const LARGE_ATTACHMENT_WARNING_BYTES = 20 * 1024 * 1024;
const MAX_UNCOMPRESSED_ATTACHMENTS_BYTES = 200 * 1000 * 1000;

export type FeedbackAttachmentPreview = {
  path: string;
  filename: string;
  sizeBytes: number;
  large: boolean;
};

export type FeedbackPreview = {
  category: "extraction-gap";
  component: "mla" | "mse" | "discovery" | "views" | "other";
  message: string;
  attachments: FeedbackAttachmentPreview[];
  totalAttachmentBytes: number;
  warnings: string[];
};

export type FeedbackRequest = {
  message: string;
  component?: FeedbackPreview["component"];
  attachmentPaths?: string[];
};

export async function previewFeedback(request: FeedbackRequest): Promise<FeedbackPreview> {
  const message = request.message.trim();
  if (message.length === 0) throw new Error("Feedback message must not be empty.");
  if (message.length > 10_000) throw new Error("Feedback message must not exceed 10,000 characters.");
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
  if (totalAttachmentBytes > MAX_UNCOMPRESSED_ATTACHMENTS_BYTES) {
    throw new Error(
      "The selected attachments exceed Sentry's 200 MB uncompressed attachment limit per event.",
    );
  }
  const warnings = [
    ...(attachments.length === 0
      ? []
      : ["Attachments are uploaded as selected and may contain account names, tokens, paths, screenshots, or other private data."]),
    ...(attachments.some((item) => item.large)
      ? ["At least one attachment is 20 MB or larger. This is a quota warning, not a MEK rejection limit."]
      : []),
    ...(attachments.length === 0
      ? []
      : ["Sentry also rejects compressed requests above 40 MB; highly incompressible attachments may fail even below the 200 MB uncompressed limit."]),
  ];
  return {
    category: "extraction-gap",
    component: request.component ?? "other",
    message,
    attachments,
    totalAttachmentBytes,
    warnings,
  };
}

export async function submitFeedback(preview: FeedbackPreview): Promise<string> {
  const attachments = await Promise.all(preview.attachments.map(async (item) => ({
    filename: item.filename,
    data: await readFile(item.path),
  })));
  return sendSentryFeedback({
    message: preview.message,
    category: preview.category,
    component: preview.component,
    attachments,
    attachmentBytes: preview.totalAttachmentBytes,
  });
}
