import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { maaEvidenceConfigDirectory } from "../config.js";

export const INSTALLATION_IDENTITY_SCHEMA_VERSION = "maa-evidence-installation/v1" as const;

type InstallationIdentity = {
  schemaVersion: typeof INSTALLATION_IDENTITY_SCHEMA_VERSION;
  seed: string;
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

function identityPath(directory?: string): string {
  return path.join(directory ?? maaEvidenceConfigDirectory(), "installation.json");
}

function parseIdentity(contents: string): InstallationIdentity | undefined {
  try {
    const parsed: unknown = JSON.parse(contents);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return undefined;
    const record = parsed as Record<string, unknown>;
    if (
      record["schemaVersion"] !== INSTALLATION_IDENTITY_SCHEMA_VERSION
      || typeof record["seed"] !== "string"
      || !UUID_PATTERN.test(record["seed"])
    ) {
      return undefined;
    }
    return record as InstallationIdentity;
  } catch {
    return undefined;
  }
}

async function readIdentity(file: string): Promise<InstallationIdentity | undefined> {
  try {
    return parseIdentity(await readFile(file, "utf8"));
  } catch {
    return undefined;
  }
}

async function createIdentity(file: string): Promise<InstallationIdentity> {
  const identity: InstallationIdentity = {
    schemaVersion: INSTALLATION_IDENTITY_SCHEMA_VERSION,
    seed: randomUUID(),
  };
  await mkdir(path.dirname(file), { recursive: true });
  try {
    const handle = await open(file, "wx", 0o600);
    try {
      await handle.writeFile(`${JSON.stringify(identity, null, 2)}\n`, "utf8");
    } finally {
      await handle.close();
    }
    return identity;
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    const existing = await readIdentity(file);
    if (existing !== undefined) return existing;
    await writeFile(file, `${JSON.stringify(identity, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    return identity;
  }
}

function deriveInstallationId(seed: string): string {
  return createHash("sha256")
    .update("maa-evidence-kit-installation-v1\0", "utf8")
    .update(seed, "utf8")
    .digest("hex");
}

export async function getOrCreateInstallationId(directory?: string): Promise<string> {
  const file = identityPath(directory);
  const identity = await readIdentity(file) ?? await createIdentity(file);
  return deriveInstallationId(identity.seed);
}

export async function removeInstallationIdentity(directory?: string): Promise<void> {
  await rm(identityPath(directory), { force: true });
}
