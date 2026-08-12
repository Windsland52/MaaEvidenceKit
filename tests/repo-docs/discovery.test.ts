import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, expect, test } from "vitest";

import {
  REPO_DOCS_LIMITS,
  inspectRepositoryDocs,
  queryEvidenceWindow,
  renderText,
  type RepositoryAgentsDocumentEvidence,
  type RepositorySkillFileEvidence,
} from "../../src/index.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function temporaryRoot(label = "repo-docs"): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), `mek-${label}-`));
  temporaryRoots.push(root);
  return root;
}

test("exports sorted AGENTS.md facts through the evidence ledger", async () => {
  const root = await temporaryRoot();
  await writeFile(path.join(root, "AGENTS.md"), "root instructions\nline two", "utf8");
  await mkdir(path.join(root, "agent", "go-service"), { recursive: true });
  await writeFile(path.join(root, "agent", "go-service", "AGENTS.md"), "module notes", "utf8");
  await mkdir(path.join(root, "node_modules"), { recursive: true });
  await writeFile(path.join(root, "node_modules", "AGENTS.md"), "ignored", "utf8");

  const result = await inspectRepositoryDocs(root);
  const documents = result.evidence.filter((item) => item.kind === "repo_docs.agents_document");

  expect(result.kind).toBe("repo_docs");
  expect(documents.map((item) => item.source.path)).toEqual(["AGENTS.md", "agent/go-service/AGENTS.md"]);
  expect(documents[0]?.source).toMatchObject({ line: 1, endLine: 2 });
  expect(documents[0]?.data).toEqual({
    fileSizeBytes: 26,
    returnedBytes: 26,
    returnedLines: 2,
    truncated: false,
    endsMidLine: false,
    text: "root instructions\nline two",
  });
  expect(result.details.agentsDocumentEvidenceIds).toEqual(documents.map((item) => item.id));
  expect(result.artifacts.map((artifact) => artifact.relativePath)).toEqual([
    "AGENTS.md",
    "agent/go-service/AGENTS.md",
  ]);
  expect(result.artifacts.every((artifact) => artifact.status === "selected")).toBe(true);
  expect(renderText(result)).toContain(`- AGENTS.md (${documents[0]?.id})`);
  expect(renderText(result)).not.toContain("root instructions");
});

test("reads AGENTS.md within the byte cap without splitting UTF-8", async () => {
  const root = await temporaryRoot();
  const prefix = "x".repeat(REPO_DOCS_LIMITS.maxAgentsDocumentBytes - 1);
  await writeFile(path.join(root, "AGENTS.md"), `${prefix}界tail`, "utf8");

  const result = await inspectRepositoryDocs(root);
  const evidence = result.evidence.find((item) => item.kind === "repo_docs.agents_document");
  const data = evidence?.data as RepositoryAgentsDocumentEvidence | undefined;

  expect(data).toMatchObject({
    fileSizeBytes: REPO_DOCS_LIMITS.maxAgentsDocumentBytes + 6,
    returnedBytes: REPO_DOCS_LIMITS.maxAgentsDocumentBytes - 1,
    returnedLines: 1,
    truncated: true,
    endsMidLine: true,
  });
  expect(data?.text).toBe(prefix);
  expect(data?.text).not.toContain("�");
  expect(result.statistics["agentsDocumentsTruncated"]).toBe(1);
});

test("keeps path identity portable while content facts change", async () => {
  const leftRoot = await temporaryRoot("repo-docs-left");
  const rightRoot = await temporaryRoot("repo-docs-right");
  await writeFile(path.join(leftRoot, "AGENTS.md"), "left content", "utf8");
  await writeFile(path.join(rightRoot, "AGENTS.md"), "right content", "utf8");

  const [left, right] = await Promise.all([
    inspectRepositoryDocs(leftRoot),
    inspectRepositoryDocs(rightRoot),
  ]);

  expect(left.artifacts[0]?.id).toBe(right.artifacts[0]?.id);
  expect(left.evidence[0]?.id).not.toBe(right.evidence[0]?.id);
});

test("recursively inventories skill structure without parsing skill contents", async () => {
  const root = await temporaryRoot();
  const bodies: Array<[string, string]> = [
    [".agents/skills/one/SKILL.md", "---\nname: ignored-one\ndescription: ignored\n---"],
    [".claude/skills/group/two/SKILL.md", "not frontmatter"],
    ["skills/a/b/three/SKILL.md", "---\ndescription: |\n  also ignored\n---"],
  ];
  for (const [relativePath, body] of bodies) {
    const target = path.join(root, relativePath);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, body, "utf8");
  }

  const result = await inspectRepositoryDocs(root);
  const skills = result.evidence.filter((item) => item.kind === "repo_docs.skill_file");

  expect(skills.map((item) => item.source.path)).toEqual(bodies.map(([relativePath]) => relativePath));
  expect(skills.map((item) => item.data)).toEqual([
    { fileSizeBytes: 46, skillRoot: ".agents/skills", directoryDepth: 1 },
    { fileSizeBytes: 15, skillRoot: ".claude/skills", directoryDepth: 2 },
    { fileSizeBytes: 37, skillRoot: "skills", directoryDepth: 3 },
  ] satisfies RepositorySkillFileEvidence[]);
  expect(JSON.stringify(result)).not.toContain("ignored-one");
  expect(result.details.skillFileEvidenceIds).toEqual(skills.map((item) => item.id));
});

test("reports exact discovered-file omissions at fixed list limits", async () => {
  const root = await temporaryRoot();
  for (let index = 0; index <= REPO_DOCS_LIMITS.maxAgentsDocuments; index += 1) {
    const directory = path.join(root, `module-${String(index).padStart(3, "0")}`);
    await mkdir(directory);
    await writeFile(path.join(directory, "AGENTS.md"), `document ${index}`, "utf8");
  }

  const result = await inspectRepositoryDocs(root);

  expect(result.statistics).toMatchObject({
    agentsDocumentsFound: REPO_DOCS_LIMITS.maxAgentsDocuments + 1,
    agentsDocumentsSelected: REPO_DOCS_LIMITS.maxAgentsDocuments,
    agentsDocumentsOmitted: 1,
    omissionsUnknown: 0,
  });
  expect(result.warnings).toContainEqual(expect.objectContaining({ code: "repo_docs_agents_truncated" }));
  expect(result.details.scan).toMatchObject({ agentsDocumentsOmitted: 1, omissionsUnknown: false });
  expect(result.artifacts).toContainEqual(expect.objectContaining({
    status: "skipped",
    reason: "repo_docs_agents_file_limit",
  }));
});

test("does not follow a linked directory outside the checkout", async () => {
  const root = await temporaryRoot("repo-docs-root");
  const outside = await temporaryRoot("repo-docs-outside");
  await writeFile(path.join(outside, "AGENTS.md"), "outside secret", "utf8");
  await symlink(outside, path.join(root, "linked"), "junction");

  const result = await inspectRepositoryDocs(root);

  expect(result.evidence).toHaveLength(0);
  expect(result.artifacts).toContainEqual(expect.objectContaining({
    relativePath: "linked",
    status: "skipped",
    reason: "repo_docs_symbolic_link",
  }));
  expect(JSON.stringify(result)).not.toContain("outside secret");
  expect(result.warnings).toContainEqual(expect.objectContaining({ code: "repo_docs_symbolic_link" }));
});

test("revalidates a selected path before a later evidence window", async () => {
  const root = await temporaryRoot("repo-docs-root");
  const outside = await temporaryRoot("repo-docs-outside");
  const agentsPath = path.join(root, "AGENTS.md");
  await writeFile(agentsPath, "original", "utf8");
  await writeFile(path.join(outside, "AGENTS.md"), "outside secret", "utf8");
  const result = await inspectRepositoryDocs(root);
  const evidence = result.evidence[0];
  expect(evidence).toBeDefined();
  await rm(agentsPath);
  await symlink(path.join(outside, "AGENTS.md"), agentsPath, "file");

  await expect(queryEvidenceWindow(result, { evidenceId: evidence!.id })).rejects.toThrow(
    "do not follow symbolic",
  );
});

test("allows an explicit bounded window into an inventoried skill file", async () => {
  const root = await temporaryRoot();
  const target = path.join(root, "skills", "project-guide", "SKILL.md");
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, "line one\nline two", "utf8");
  const result = await inspectRepositoryDocs(root);
  const skill = result.evidence.find((item) => item.kind === "repo_docs.skill_file");
  expect(skill).toBeDefined();

  const window = await queryEvidenceWindow(result, {
    evidenceId: skill!.id,
    line: 1,
    before: 0,
    after: 1,
  });

  expect(window.text).toBe("1: line one\n2: line two");
});

test("rejects a source path that is not a non-symbolic directory", async () => {
  const root = await temporaryRoot();
  const file = path.join(root, "file.txt");
  await writeFile(file, "not a directory", "utf8");

  await expect(inspectRepositoryDocs(file)).rejects.toThrow("not a non-symbolic directory");
});
