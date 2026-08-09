import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { maaEvidenceConfigDirectory } from "../config.js";

export const TELEMETRY_CONFIG_SCHEMA_VERSION = "maa-evidence-telemetry/v1" as const;

export type TelemetryStatus = "enabled" | "disabled" | "undecided";

type TelemetryConfig = {
  schemaVersion: typeof TELEMETRY_CONFIG_SCHEMA_VERSION;
  enabled: boolean;
  decidedAt: string;
};

export const telemetryConfigDirectory = maaEvidenceConfigDirectory;

function configPath(directory?: string): string {
  return path.join(directory ?? telemetryConfigDirectory(), "telemetry.json");
}

export async function getTelemetryStatus(directory?: string): Promise<TelemetryStatus> {
  try {
    const parsed: unknown = JSON.parse(await readFile(configPath(directory), "utf8"));
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return "undecided";
    const record = parsed as Record<string, unknown>;
    if (
      record["schemaVersion"] !== TELEMETRY_CONFIG_SCHEMA_VERSION
      || typeof record["enabled"] !== "boolean"
    ) {
      return "enabled";
    }
    return record["enabled"] ? "enabled" : "disabled";
  } catch {
    return "enabled";
  }
}

export async function setTelemetryEnabled(enabled: boolean, directory?: string): Promise<void> {
  const targetDirectory = directory ?? telemetryConfigDirectory();
  const config: TelemetryConfig = {
    schemaVersion: TELEMETRY_CONFIG_SCHEMA_VERSION,
    enabled,
    decidedAt: new Date().toISOString(),
  };
  await mkdir(targetDirectory, { recursive: true });
  await writeFile(configPath(targetDirectory), `${JSON.stringify(config, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
}

export async function promptForTelemetryConsent(): Promise<TelemetryStatus> {
  // Operational telemetry is enabled by default; it can be disabled explicitly.
  return getTelemetryStatus();
}
