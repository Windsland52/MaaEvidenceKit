import * as Sentry from "@sentry/node";

import { MAA_EVIDENCE_VERSION } from "../version.js";
import { getOrCreateInstallationId } from "./installation.js";

const DEFAULT_SENTRY_DSN =
  "https://ed349e23de6a10cf40c71af3ec19c730@o4511840769277952.ingest.us.sentry.io/4511840804929536";
export const OPERATIONAL_TELEMETRY_FLUSH_TIMEOUT_MS = 200;
export const OPERATIONAL_TELEMETRY_SCHEMA_VERSION = "2" as const;
const ALLOWED_TAGS = new Set([
  "arch",
  "category",
  "command",
  "component",
  "duration_bucket",
  "error_category",
  "error_stage",
  "evidence_bucket",
  "mek_version",
  "node_major",
  "platform",
  "status",
  "telemetry_schema",
]);
const ALLOWED_EXTRA = new Set([
  "attachment_bytes",
  "attachment_count",
  "duration_ms",
  "evidence_count",
  "mla_evidence_count",
  "mse_evidence_count",
  "adapters",
  "signals_total",
  "recognition_details",
  "cycle_exit_blockers",
  "task_anomalies",
  "possible_mirrored_task_groups",
  "recognition_pipeline_references",
  "repo_docs_agents_documents",
  "repo_docs_agents_omitted",
  "repo_docs_agents_truncated",
  "repo_docs_skill_files",
  "repo_docs_skill_files_omitted",
  "repo_docs_scan_truncated",
  "runtime_node_resolution_omitted",
]);
let initialized = false;

const INSTALLATION_ID_PATTERN = /^[0-9a-f]{64}$/u;

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
    environment: "production",
    release: `maa-evidence-kit@${MAA_EVIDENCE_VERSION}`,
    sendClientReports: false,
    sendDefaultPii: false,
    serverName: "maa-evidence-cli",
    skipOpenTelemetrySetup: true,
    tracesSampleRate: 0,
    beforeSend(event) {
      const installationId = event.message === "maa-evidence.command"
        && typeof event.user?.id === "string"
        && INSTALLATION_ID_PATTERN.test(event.user.id)
        ? event.user.id
        : undefined;
      if (installationId === undefined) delete event.user;
      else event.user = { id: installationId };
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

export type OperationalCounts = {
  evidenceCount?: number;
  mlaEvidenceCount?: number;
  mseEvidenceCount?: number;
  adapters?: number;
  signalsTotal?: number;
  recognitionDetails?: number;
  cycleExitBlockers?: number;
  taskAnomalies?: number;
  possibleMirroredTaskGroups?: number;
  recognitionPipelineReferences?: number;
  repoDocsAgentsDocuments?: number;
  repoDocsAgentsOmitted?: number;
  repoDocsAgentsTruncated?: number;
  repoDocsSkillFiles?: number;
  repoDocsSkillFilesOmitted?: number;
  repoDocsScanTruncated?: number;
  runtimeNodeResolutionOmitted?: number;
};

export type OperationalTelemetry = {
  command: string;
  status: "ok" | "error";
  durationMs: number;
  component?: "mla" | "mse" | "combined" | "view" | "window" | "search" | "batch" | "repo-docs";
  counts?: OperationalCounts;
  errorCategory?: OperationalErrorCategory;
  errorStage?: OperationalErrorStage;
};

export type OperationalErrorCategory =
  | "input_not_found"
  | "invalid_input"
  | "permission_denied"
  | "resource_limit"
  | "operation_failed";

export type OperationalErrorStage = "inspection" | "evidence_query" | "repository_scan";

function errnoCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) return undefined;
  return typeof error.code === "string" ? error.code : undefined;
}

export function classifyOperationalError(error: unknown): OperationalErrorCategory {
  const code = errnoCode(error);
  if (code === "ENOENT" || code === "ENOTDIR") return "input_not_found";
  if (code === "EACCES" || code === "EPERM") return "permission_denied";
  if (["EMFILE", "ENFILE", "ENOSPC"].includes(code ?? "")) return "resource_limit";
  if (error instanceof SyntaxError || error instanceof RangeError) return "invalid_input";
  return "operation_failed";
}

function durationBucket(durationMs: number): string {
  if (durationMs < 100) return "lt_100ms";
  if (durationMs < 1_000) return "100ms_to_1s";
  if (durationMs < 10_000) return "1s_to_10s";
  return "gte_10s";
}

function evidenceBucket(evidenceCount: number): string {
  if (evidenceCount === 0) return "0";
  if (evidenceCount < 10) return "1_to_9";
  if (evidenceCount < 100) return "10_to_99";
  if (evidenceCount < 1_000) return "100_to_999";
  return "gte_1000";
}

export async function sendOperationalTelemetry(event: OperationalTelemetry): Promise<void> {
  const startedAt = performance.now();
  const installationId = await getOrCreateInstallationId();
  initializeSentry();
  Sentry.captureMessage("maa-evidence.command", {
    level: event.status === "ok" ? "info" : "error",
    user: { id: installationId },
    ...(event.status === "error"
      ? { fingerprint: ["maa-evidence.command", event.command, event.errorCategory ?? "operation_failed"] }
      : {}),
    tags: {
      command: event.command,
      status: event.status,
      component: event.component ?? "other",
      telemetry_schema: OPERATIONAL_TELEMETRY_SCHEMA_VERSION,
      duration_bucket: durationBucket(event.durationMs),
      ...(event.counts?.evidenceCount === undefined
        ? {}
        : { evidence_bucket: evidenceBucket(event.counts.evidenceCount) }),
      ...(event.errorCategory === undefined ? {} : { error_category: event.errorCategory }),
      ...(event.errorStage === undefined ? {} : { error_stage: event.errorStage }),
      mek_version: MAA_EVIDENCE_VERSION,
      platform: process.platform,
      arch: process.arch,
      node_major: process.versions.node.split(".")[0] ?? "unknown",
    },
    extra: {
      duration_ms: Math.round(event.durationMs),
      ...(event.counts?.evidenceCount === undefined ? {} : { evidence_count: event.counts.evidenceCount }),
      ...(event.counts?.mlaEvidenceCount === undefined ? {} : { mla_evidence_count: event.counts.mlaEvidenceCount }),
      ...(event.counts?.mseEvidenceCount === undefined ? {} : { mse_evidence_count: event.counts.mseEvidenceCount }),
      ...(event.counts?.adapters === undefined ? {} : { adapters: event.counts.adapters }),
      ...(event.counts?.signalsTotal === undefined ? {} : { signals_total: event.counts.signalsTotal }),
      ...(event.counts?.recognitionDetails === undefined ? {} : { recognition_details: event.counts.recognitionDetails }),
      ...(event.counts?.cycleExitBlockers === undefined ? {} : { cycle_exit_blockers: event.counts.cycleExitBlockers }),
      ...(event.counts?.taskAnomalies === undefined ? {} : { task_anomalies: event.counts.taskAnomalies }),
      ...(event.counts?.possibleMirroredTaskGroups === undefined ? {} : { possible_mirrored_task_groups: event.counts.possibleMirroredTaskGroups }),
      ...(event.counts?.recognitionPipelineReferences === undefined ? {} : { recognition_pipeline_references: event.counts.recognitionPipelineReferences }),
      ...(event.counts?.repoDocsAgentsDocuments === undefined ? {} : { repo_docs_agents_documents: event.counts.repoDocsAgentsDocuments }),
      ...(event.counts?.repoDocsAgentsOmitted === undefined ? {} : { repo_docs_agents_omitted: event.counts.repoDocsAgentsOmitted }),
      ...(event.counts?.repoDocsAgentsTruncated === undefined ? {} : { repo_docs_agents_truncated: event.counts.repoDocsAgentsTruncated }),
      ...(event.counts?.repoDocsSkillFiles === undefined ? {} : { repo_docs_skill_files: event.counts.repoDocsSkillFiles }),
      ...(event.counts?.repoDocsSkillFilesOmitted === undefined ? {} : { repo_docs_skill_files_omitted: event.counts.repoDocsSkillFilesOmitted }),
      ...(event.counts?.repoDocsScanTruncated === undefined ? {} : { repo_docs_scan_truncated: event.counts.repoDocsScanTruncated }),
      ...(event.counts?.runtimeNodeResolutionOmitted === undefined ? {} : { runtime_node_resolution_omitted: event.counts.runtimeNodeResolutionOmitted }),
    },
  });
  const remainingMs = Math.max(0, OPERATIONAL_TELEMETRY_FLUSH_TIMEOUT_MS - (performance.now() - startedAt));
  await Sentry.flush(Math.ceil(remainingMs));
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
