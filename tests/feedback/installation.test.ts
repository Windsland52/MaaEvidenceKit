import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, expect, test } from "vitest";

import {
  getOrCreateInstallationId,
  removeInstallationIdentity,
} from "../../src/feedback/installation.js";
import { getTelemetryStatus, setTelemetryEnabled } from "../../src/feedback/config.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

test("installation identity is random, stable, local, and uploaded only as a derivative", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "mek-installation-"));
  temporaryRoots.push(root);

  const first = await getOrCreateInstallationId(root);
  const second = await getOrCreateInstallationId(root);
  const local = await readFile(path.join(root, "installation.json"), "utf8");

  expect(first).toBe(second);
  expect(first).toMatch(/^[0-9a-f]{64}$/u);
  expect(local).not.toContain(first);
  expect(JSON.parse(local)).toMatchObject({ schemaVersion: "maa-evidence-installation/v1" });
});

test("removing an installation identity causes a new identity to be generated", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "mek-installation-"));
  temporaryRoots.push(root);

  const before = await getOrCreateInstallationId(root);
  await removeInstallationIdentity(root);
  const after = await getOrCreateInstallationId(root);

  expect(after).not.toBe(before);
});

test("disabling telemetry removes the installation identity", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "mek-installation-"));
  temporaryRoots.push(root);

  const before = await getOrCreateInstallationId(root);
  await setTelemetryEnabled(false, root);
  expect(await getTelemetryStatus(root)).toBe("disabled");

  await setTelemetryEnabled(true, root);
  const after = await getOrCreateInstallationId(root);
  expect(after).not.toBe(before);
});
