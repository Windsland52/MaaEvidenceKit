import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, expect, test } from "vitest";

import {
  PACKAGED_SKILL_ENTRY,
  checkPackagedSkill,
  installPackagedSkill,
  loadPackagedSkill,
  readPackagedSkillFile,
} from "../../src/skills/index.js";
import { MAA_EVIDENCE_VERSION } from "../../src/version.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "mek-skill-"));
  roots.push(root);
  return root;
}

test("the packaged Skill reports the version of the package it ships in", async () => {
  const skill = await loadPackagedSkill();
  expect(skill.entry).toBe(PACKAGED_SKILL_ENTRY);
  expect(skill.version).toBe(MAA_EVIDENCE_VERSION);
  // The payload states no version of its own, so no release has to edit it.
  const entry = await readPackagedSkillFile(skill, PACKAGED_SKILL_ENTRY);
  expect(entry).not.toMatch(/^MEK v/mu);
});

test("the packaged Skill lists every file with a stable digest", async () => {
  const skill = await loadPackagedSkill();
  const paths = skill.files.map((file) => file.path);
  expect(paths).toEqual([...paths].sort((left, right) => left.localeCompare(right)));
  expect(paths).toContain(PACKAGED_SKILL_ENTRY);
  expect(paths).toContain("references/full-guide.md");
  for (const file of skill.files) {
    expect(file.bytes).toBeGreaterThan(0);
    expect(file.sha256).toMatch(/^[0-9a-f]{64}$/u);
  }
  expect((await loadPackagedSkill()).files).toEqual(skill.files);
});

test("reading an unlisted Skill document fails with the available list", async () => {
  const skill = await loadPackagedSkill();
  await expect(readPackagedSkillFile(skill, "references/missing.md")).rejects.toThrow(
    /Available: agents\/openai\.yaml/u,
  );
});

test("installing writes the exact packaged bytes under the named directory", async () => {
  const root = await temporaryRoot();
  const skill = await loadPackagedSkill();
  const result = await installPackagedSkill(skill, root);

  expect(result.installedDirectory).toBe(path.join(root, "maa-evidence"));
  expect(result.version).toBe(MAA_EVIDENCE_VERSION);
  expect(result.files).toEqual(skill.files.map((file) => file.path));
  for (const file of skill.files) {
    const installed = await readFile(path.join(result.installedDirectory, ...file.path.split("/")));
    expect(createHash("sha256").update(installed).digest("hex")).toBe(file.sha256);
  }
});

test("installing refuses to write through a symbolic link", async (context) => {
  const root = await temporaryRoot();
  const outside = await temporaryRoot();
  const installed = path.join(root, "maa-evidence");
  await mkdir(installed, { recursive: true });
  await writeFile(path.join(outside, PACKAGED_SKILL_ENTRY), "kept\n", "utf8");
  try {
    await symlink(path.join(outside, PACKAGED_SKILL_ENTRY), path.join(installed, PACKAGED_SKILL_ENTRY));
  } catch {
    // Creating a symbolic link needs privileges on some Windows setups; the guard itself is
    // exercised wherever the platform allows the fixture.
    context.skip();
    return;
  }

  await expect(installPackagedSkill(await loadPackagedSkill(), root)).rejects.toThrow(/symbolic link/u);
  expect(await readFile(path.join(outside, PACKAGED_SKILL_ENTRY), "utf8")).toBe("kept\n");
});

test("checking a fresh install reports a byte-for-byte match", async () => {
  const root = await temporaryRoot();
  const skill = await loadPackagedSkill();
  await installPackagedSkill(skill, root);

  const check = await checkPackagedSkill(skill, root);
  expect(check.installed).toBe(true);
  expect(check.match).toBe(true);
  expect(check.version).toBe(MAA_EVIDENCE_VERSION);
  expect(check.files.every((file) => file.status === "same")).toBe(true);
  expect(check.extraFiles).toEqual([]);
});

test("checking reports each kind of drift separately from files the payload does not ship", async () => {
  const root = await temporaryRoot();
  const skill = await loadPackagedSkill();
  await installPackagedSkill(skill, root);
  const installed = path.join(root, "maa-evidence");
  await writeFile(path.join(installed, PACKAGED_SKILL_ENTRY), "older text\n", "utf8");
  await rm(path.join(installed, "references", "sentry.md"));
  await writeFile(path.join(installed, "PROVENANCE.md"), "agent metadata\n", "utf8");

  const check = await checkPackagedSkill(skill, root);
  expect(check.match).toBe(false);
  expect(check.files.find((file) => file.path === PACKAGED_SKILL_ENTRY))
    .toMatchObject({ status: "different" });
  expect(check.files.find((file) => file.path === "references/sentry.md"))
    .toMatchObject({ status: "missing" });
  expect(check.files.find((file) => file.path === "references/reporting.md"))
    .toMatchObject({ status: "same" });
  // Extra files are reported but are not drift: agents add their own metadata next to SKILL.md.
  expect(check.extraFiles).toEqual(["PROVENANCE.md"]);
  expect(check.files.find((file) => file.path === PACKAGED_SKILL_ENTRY)?.installedSha256)
    .toMatch(/^[0-9a-f]{64}$/u);
});

test("checking follows a directory symlink instead of calling the install absent", async (context) => {
  const canonical = await temporaryRoot();
  const agent = await temporaryRoot();
  const skill = await loadPackagedSkill();
  await installPackagedSkill(skill, canonical);
  try {
    await symlink(path.join(canonical, "maa-evidence"), path.join(agent, "maa-evidence"), "dir");
  } catch {
    context.skip();
    return;
  }

  const check = await checkPackagedSkill(skill, agent);
  expect(check.installed).toBe(true);
  expect(check.match).toBe(true);
});

test("checking an absent install says so instead of throwing", async () => {
  const root = await temporaryRoot();
  const check = await checkPackagedSkill(await loadPackagedSkill(), root);

  expect(check.installed).toBe(false);
  expect(check.match).toBe(false);
  expect(check.files.every((file) => file.status === "missing")).toBe(true);
});

test("installing refuses a pre-existing directory link instead of writing through it", async (context) => {
  const root = await temporaryRoot();
  const outside = await temporaryRoot();
  await mkdir(path.join(root, "maa-evidence"), { recursive: true });
  try {
    await symlink(outside, path.join(root, "maa-evidence", "references"), "dir");
  } catch {
    context.skip();
    return;
  }

  await expect(installPackagedSkill(await loadPackagedSkill(), root))
    .rejects.toThrow(/Refusing to write through a symbolic link/u);
  // The guard exists so a prepared link cannot redirect payload writes outside the chosen directory.
  expect(await readdir(outside)).toEqual([]);
});

test("checking reports a link where the install should be instead of a filesystem error", async (context) => {
  const root = await temporaryRoot();
  const target = path.join(root, "a-file");
  await writeFile(target, "not a skill\n", "utf8");
  await mkdir(path.join(root, "maa-evidence"));
  await rm(path.join(root, "maa-evidence"), { recursive: true });
  try {
    await symlink(target, path.join(root, "maa-evidence"));
  } catch {
    context.skip();
    return;
  }

  const check = await checkPackagedSkill(await loadPackagedSkill(), root);
  expect(check.installed).toBe(false);
  expect(check.match).toBe(false);
  expect(check.files.every((file) => file.status === "missing")).toBe(true);
});

test("checking reports a link inside the installed copy without failing", async (context) => {
  const root = await temporaryRoot();
  const elsewhere = path.join(root, "elsewhere.md");
  await writeFile(elsewhere, "agent-managed\n", "utf8");
  const skill = await loadPackagedSkill();
  await installPackagedSkill(skill, root);
  const installed = path.join(root, "maa-evidence");
  await rm(path.join(installed, "references", "sentry.md"));
  try {
    await symlink(elsewhere, path.join(installed, "references", "sentry.md"));
  } catch {
    context.skip();
    return;
  }

  const check = await checkPackagedSkill(skill, root);
  expect(check.match).toBe(false);
  // A link whose target does not hold the packaged bytes is different, not an error.
  expect(check.files.find((file) => file.path === "references/sentry.md"))
    .toMatchObject({ status: "different" });
  expect(check.files.find((file) => file.path === PACKAGED_SKILL_ENTRY))
    .toMatchObject({ status: "same" });
});
