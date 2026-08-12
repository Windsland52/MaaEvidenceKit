import { mkdtemp, open, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, expect, test, vi } from "vitest";

const sentry = vi.hoisted(() => ({
  captureFeedback: vi.fn(() => "feedback-event-id"),
  captureMessage: vi.fn(),
  flush: vi.fn<(timeout: number) => Promise<boolean>>(async (_timeout) => true),
  getClient: vi.fn(() => ({ on: vi.fn() })),
  init: vi.fn(),
  withScope: vi.fn((callback: (scope: { addEventProcessor: (processor: unknown) => void }) => string) =>
    callback({ addEventProcessor: vi.fn() })),
}));

const installation = vi.hoisted(() => ({
  getOrCreateInstallationId: vi.fn(async () => "a".repeat(64)),
  removeInstallationIdentity: vi.fn(async () => undefined),
}));

vi.mock("@sentry/node", () => sentry);
vi.mock("../../src/feedback/installation.js", () => installation);

import {
  getTelemetryStatus,
  operationalTelemetryEligible,
  previewFeedback,
  setTelemetryEnabled,
} from "../../src/index.js";
import { scrubFeedbackEvent } from "../../src/feedback/sentry.js";
import {
  classifyOperationalError,
  OPERATIONAL_TELEMETRY_FLUSH_TIMEOUT_MS,
  OPERATIONAL_TELEMETRY_SCHEMA_VERSION,
  sendOperationalTelemetry,
} from "../../src/feedback/sentry.js";
import type { ScrubbableFeedbackEvent } from "../../src/feedback/sentry.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

test("telemetry is enabled by default and can be disabled", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "mek-config-"));
  temporaryRoots.push(root);
  expect(await getTelemetryStatus(root)).toBe("enabled");
  await setTelemetryEnabled(false, root);
  expect(await getTelemetryStatus(root)).toBe("disabled");
  await setTelemetryEnabled(true, root);
  expect(await getTelemetryStatus(root)).toBe("enabled");
});

test("operational telemetry is on by default and can be opted out", () => {
  expect(operationalTelemetryEligible({})).toBe(true);
  expect(operationalTelemetryEligible({ CI: "true" })).toBe(true);
  expect(operationalTelemetryEligible({ MAA_EVIDENCE_TELEMETRY: "0" })).toBe(false);
  expect(operationalTelemetryEligible({ MAA_EVIDENCE_TELEMETRY: "1" })).toBe(true);
});

test("operational telemetry uses a bounded flush budget", async () => {
  await sendOperationalTelemetry({
    command: "mla.inspect",
    component: "mla",
    status: "ok",
    durationMs: 12,
    counts: { evidenceCount: 12 },
  });

  expect(OPERATIONAL_TELEMETRY_FLUSH_TIMEOUT_MS).toBe(200);
  expect(OPERATIONAL_TELEMETRY_SCHEMA_VERSION).toBe("2");
  const flushTimeout = sentry.flush.mock.calls.at(-1)?.[0] as number | undefined;
  expect(flushTimeout).toBeDefined();
  expect(flushTimeout).toBeGreaterThanOrEqual(0);
  expect(flushTimeout).toBeLessThanOrEqual(OPERATIONAL_TELEMETRY_FLUSH_TIMEOUT_MS);
  expect(sentry.captureMessage).toHaveBeenCalledWith("maa-evidence.command", expect.objectContaining({
    level: "info",
    user: { id: "a".repeat(64) },
    tags: expect.objectContaining({
      duration_bucket: "lt_100ms",
      evidence_bucket: "10_to_99",
      telemetry_schema: "2",
    }),
  }));
  expect(sentry.init).toHaveBeenCalledWith(expect.objectContaining({
    environment: "production",
    release: "maa-evidence-kit@0.3.2",
    skipOpenTelemetrySetup: true,
  }));

  const beforeSend = sentry.init.mock.calls.at(-1)?.[0]?.beforeSend as
    | ((event: Record<string, unknown>) => Record<string, unknown>)
    | undefined;
  expect(beforeSend).toBeDefined();
  const scrubbed = beforeSend?.({
    message: "maa-evidence.command",
    user: { id: "a".repeat(64), username: "private-user", email: "private@example.com" },
    request: { url: "file:///private" },
    contexts: { trace: { trace_id: "private-trace" } },
    tags: { command: "mla.inspect", private_tag: "private" },
    extra: { duration_ms: 12, private_path: "C:/private" },
  });
  expect(scrubbed).toMatchObject({
    message: "maa-evidence.command",
    user: { id: "a".repeat(64) },
    tags: { command: "mla.inspect" },
    extra: { duration_ms: 12 },
  });
  expect(scrubbed).not.toHaveProperty("request");
  expect(scrubbed).not.toHaveProperty("contexts");
  expect(beforeSend?.({
    message: "maa-evidence.command",
    user: { id: "invalid", username: "private-user" },
  })).not.toHaveProperty("user");
});

test("operational errors use bounded categories and fingerprints without messages", async () => {
  await sendOperationalTelemetry({
    command: "window",
    component: "window",
    status: "error",
    durationMs: 1_500,
    errorCategory: "invalid_input",
    errorStage: "evidence_query",
  });

  expect(sentry.captureMessage).toHaveBeenLastCalledWith("maa-evidence.command", expect.objectContaining({
    fingerprint: ["maa-evidence.command", "window", "invalid_input"],
    tags: expect.objectContaining({
      duration_bucket: "1s_to_10s",
      error_category: "invalid_input",
      error_stage: "evidence_query",
    }),
  }));
  expect(classifyOperationalError(Object.assign(new Error("private path"), { code: "ENOENT" })))
    .toBe("input_not_found");
  expect(classifyOperationalError(new SyntaxError("private input"))).toBe("invalid_input");
  expect(classifyOperationalError(new Error("private failure"))).toBe("operation_failed");
});

test("feedback scrubbing removes SDK-added host context", () => {
  const event = {
    type: "feedback",
    contexts: {
      feedback: { message: "expected user content" },
      runtime: { name: "node", version: "local-version" },
      trace: { trace_id: "local-trace" },
    },
    server_name: "private-machine-name",
    tags: { component: "mla", runtime: "node local-version" },
    extra: {
      attachment_count: 1,
      recognition_pipeline_references: 2,
      repo_docs_agents_documents: 1,
      repo_docs_agents_omitted: 2,
      repo_docs_skill_files: 14,
      repo_docs_skill_files_omitted: 3,
      private_path: "C:/secret",
    },
    user: { username: "private-user" },
  } as unknown as ScrubbableFeedbackEvent;

  scrubFeedbackEvent(event);

  expect(event.server_name).toBeUndefined();
  expect(event.user).toBeUndefined();
  expect(event.contexts).toEqual({ feedback: { message: "expected user content" } });
  expect(event.tags).toEqual({ component: "mla" });
  expect(event.extra).toEqual({
    attachment_count: 1,
    recognition_pipeline_references: 2,
    repo_docs_agents_documents: 1,
    repo_docs_agents_omitted: 2,
    repo_docs_skill_files: 14,
    repo_docs_skill_files_omitted: 3,
  });
});

test("feedback previews original material without uploading it", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "mek-feedback-"));
  temporaryRoots.push(root);
  const log = path.join(root, "maafw.log");
  await writeFile(log, "potentially sensitive content", "utf8");

  const preview = await previewFeedback({
    message: "MLA omitted the task transition I needed.",
    component: "mla",
    attachmentPaths: [log],
  });

  expect(preview.attachments).toEqual([
    expect.objectContaining({ filename: "maafw.log", large: false }),
  ]);
  expect(preview.warnings.join(" ")).toContain("private data");
});

test("feedback accepts only the four severity categories", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "mek-feedback-category-"));
  temporaryRoots.push(root);
  const log = path.join(root, "maafw.log");
  await writeFile(log, "content", "utf8");

  const blocker = await previewFeedback({
    message: "CLI crashes on startup.",
    category: "blocker",
    attachmentPaths: [log],
  });
  expect(blocker.category).toBe("blocker");

  const implicit = await previewFeedback({ message: "default category" });
  expect(implicit.category).toBe("other");

  await expect(previewFeedback({ message: "bad", category: "nope" as never })).rejects.toThrow(
    "Unknown feedback category",
  );
});

test("feedback rejects material beyond Sentry's uncompressed event limit", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "mek-feedback-limit-"));
  temporaryRoots.push(root);
  const attachment = path.join(root, "oversized.log");
  const handle = await open(attachment, "w");
  await handle.truncate(200_000_001);
  await handle.close();

  await expect(previewFeedback({ message: "gap", attachmentPaths: [attachment] })).rejects.toThrow(
    "200 MB",
  );
});
