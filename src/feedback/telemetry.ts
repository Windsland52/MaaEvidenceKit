import { getTelemetryStatus } from "./config.js";
import { sendOperationalTelemetry, type OperationalTelemetry } from "./sentry.js";
import { profileStage } from "../profiling.js";

export function operationalTelemetryEligible(
  environment: NodeJS.ProcessEnv = process.env,
): boolean {
  return environment["MAA_EVIDENCE_TELEMETRY"] !== "0";
}

export async function recordOperationalTelemetry(event: OperationalTelemetry): Promise<void> {
  if (!operationalTelemetryEligible()) return;
  if ((await profileStage("telemetry.config", () => getTelemetryStatus())) === "disabled") return;
  try {
    await profileStage("telemetry.send", () => sendOperationalTelemetry(event));
  } catch {
    // Telemetry must never change command success or failure.
  }
}
