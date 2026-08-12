export {
  getTelemetryStatus,
  promptForTelemetryConsent,
  setTelemetryEnabled,
  telemetryConfigDirectory,
  TELEMETRY_CONFIG_SCHEMA_VERSION,
  type TelemetryStatus,
} from "./config.js";
export {
  previewFeedback,
  submitFeedback,
  type FeedbackAttachmentPreview,
  type FeedbackCategory,
  type FeedbackPreview,
  type FeedbackRequest,
} from "./report.js";
export { operationalTelemetryEligible, recordOperationalTelemetry } from "./telemetry.js";
export type {
  OperationalCounts,
  OperationalErrorCategory,
  OperationalErrorStage,
} from "./sentry.js";
