import * as Sentry from "@sentry/node";

import { MAA_EVIDENCE_VERSION } from "../version.js";

const DEFAULT_SENTRY_DSN =
  "https://ed349e23de6a10cf40c71af3ec19c730@o4511840769277952.ingest.us.sentry.io/4511840804929536";
const ALLOWED_TAGS = new Set([
  "arch",
  "category",
  "command",
  "component",
  "mek_version",
  "node_major",
  "platform",
  "status",
]);
const ALLOWED_EXTRA = new Set(["attachment_bytes", "attachment_count", "duration_ms"]);
let initialized = false;

function removeDisallowed(input: Record<string, unknown> | undefined, allowed: ReadonlySet<string>): void {
  if (input === undefined) return;
  for (const key of Object.keys(input)) {
    if (!allowed.has(key)) delete input[key];
  }
}

export type ScrubbableFeedbackEvent = {
  contexts: { feedback: Record<string, unknown>; [key: string]: unknown };
  user?: unknown;
  request?: unknown;
  breadcrumbs?: unknown;
  server_name?: unknown;
  modules?: unknown;
  exception?: unknown;
  threads?: unknown;
  tags?: Record<string, unknown>;
  extra?: Record<string, unknown>;
};

export function scrubFeedbackEvent(event: ScrubbableFeedbackEvent): void {
  const feedback = event.contexts.feedback;
  delete event.user;
  delete event.request;
  delete event.breadcrumbs;
  delete event.server_name;
  delete event.modules;
  delete event.exception;
  delete event.threads;
  event.contexts = { feedback };
  removeDisallowed(event.tags, ALLOWED_TAGS);
  removeDisallowed(event.extra, ALLOWED_EXTRA);
}

function initializeSentry(): void {
  if (initialized) return;
  initialized = true;
  Sentry.init({
    dsn: process.env["MAA_EVIDENCE_SENTRY_DSN"] ?? DEFAULT_SENTRY_DSN,
    defaultIntegrations: false,
    sendClientReports: false,
    sendDefaultPii: false,
    serverName: "maa-evidence-cli",
    tracesSampleRate: 0,
    beforeSend(event) {
      delete event.user;
      delete event.request;
      delete event.breadcrumbs;
      delete event.contexts;
      delete event.server_name;
      delete event.modules;
      delete event.exception;
      delete event.threads;
      event.message = "maa-evidence.command";
      removeDisallowed(event.tags, ALLOWED_TAGS);
      removeDisallowed(event.extra, ALLOWED_EXTRA);
      return event;
    },
  });
  Sentry.getClient()?.on("beforeSendFeedback", scrubFeedbackEvent);
}

export type OperationalTelemetry = {
  command: string;
  status: "ok" | "error";
  durationMs: number;
  component?: "mla" | "mse" | "combined" | "view" | "window";
};

export async function sendOperationalTelemetry(event: OperationalTelemetry): Promise<void> {
  initializeSentry();
  Sentry.captureMessage("maa-evidence.command", {
    level: event.status === "ok" ? "info" : "error",
    tags: {
      command: event.command,
      status: event.status,
      component: event.component ?? "other",
      mek_version: MAA_EVIDENCE_VERSION,
      platform: process.platform,
      arch: process.arch,
      node_major: process.versions.node.split(".")[0] ?? "unknown",
    },
    extra: { duration_ms: Math.round(event.durationMs) },
  });
  await Sentry.flush(1_000);
}

export type SentryFeedback = {
  message: string;
  category: string;
  component: string;
  attachments: Array<{ filename: string; data: Uint8Array; contentType?: string }>;
  attachmentBytes: number;
};

export async function sendSentryFeedback(feedback: SentryFeedback): Promise<string> {
  initializeSentry();
  const eventId = Sentry.withScope((scope) => {
    scope.addEventProcessor((event) => {
      if (event.type === "feedback" && event.contexts?.["feedback"] !== undefined) {
        scrubFeedbackEvent(event as unknown as ScrubbableFeedbackEvent);
      }
      return event;
    });
    return Sentry.captureFeedback(
      {
        message: feedback.message,
        source: "maa-evidence-cli",
        tags: {
          category: feedback.category,
          component: feedback.component,
          mek_version: MAA_EVIDENCE_VERSION,
        },
      },
      {
        attachments: feedback.attachments,
        data: {
          attachment_count: feedback.attachments.length,
          attachment_bytes: feedback.attachmentBytes,
        },
      },
    );
  });
  await Sentry.flush(10_000);
  return eventId;
}
