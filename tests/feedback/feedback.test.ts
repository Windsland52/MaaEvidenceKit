import { mkdtemp, open, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, expect, test } from "vitest";

import {
  getTelemetryStatus,
  operationalTelemetryEligible,
  previewFeedback,
  setTelemetryEnabled,
} from "../../src/index.js";
import { scrubFeedbackEvent } from "../../src/feedback/sentry.js";
import type { ScrubbableFeedbackEvent } from "../../src/feedback/sentry.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

test("telemetry remains undecided until explicitly enabled or disabled", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "mek-config-"));
  temporaryRoots.push(root);
  expect(await getTelemetryStatus(root)).toBe("undecided");
  await setTelemetryEnabled(true, root);
  expect(await getTelemetryStatus(root)).toBe("enabled");
  await setTelemetryEnabled(false, root);
  expect(await getTelemetryStatus(root)).toBe("disabled");
});

test("operational telemetry is ineligible in CI and non-interactive use", () => {
  expect(operationalTelemetryEligible({}, true, true)).toBe(true);
  expect(operationalTelemetryEligible({ CI: "true" }, true, true)).toBe(false);
  expect(operationalTelemetryEligible({}, false, true)).toBe(false);
  expect(operationalTelemetryEligible({}, true, undefined)).toBe(false);
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
    extra: { attachment_count: 1, private_path: "C:/secret" },
    user: { username: "private-user" },
  } as unknown as ScrubbableFeedbackEvent;

  scrubFeedbackEvent(event);

  expect(event.server_name).toBeUndefined();
  expect(event.user).toBeUndefined();
  expect(event.contexts).toEqual({ feedback: { message: "expected user content" } });
  expect(event.tags).toEqual({ component: "mla" });
  expect(event.extra).toEqual({ attachment_count: 1 });
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
