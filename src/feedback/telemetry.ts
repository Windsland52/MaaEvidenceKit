import { getTelemetryStatus } from "./config.js";
import { sendOperationalTelemetry, type OperationalTelemetry } from "./sentry.js";

export function operationalTelemetryEligible(
  environment: NodeJS.ProcessEnv = process.env,
  stdinIsTTY: boolean | undefined = process.stdin.isTTY,
  stderrIsTTY: boolean | undefined = process.stderr.isTTY,
): boolean {
  return environment["CI"] === undefined && stdinIsTTY === true && stderrIsTTY === true;
}

export async function recordOperationalTelemetry(event: OperationalTelemetry): Promise<void> {
  if (!operationalTelemetryEligible()) return;
  if (await getTelemetryStatus() !== "enabled") return;
  try {
    await sendOperationalTelemetry(event);
  } catch {
    // Telemetry must never change command success or failure.
  }
}
