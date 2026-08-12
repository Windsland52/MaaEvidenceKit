import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, expect, test } from "vitest";

import { inspectRepositoryDocs } from "../../src/index.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "mek-repo-docs-"));
  temporaryRoots.push(root);
  return root;
}

test("inventories root and nested AGENTS.md with full bounded text", async () => {
  const root = await temporaryRoot();
  await writeFile(
    path.join(root, "AGENTS.md"),
    Array.from({ length: 100 }, (_, index) => `line ${index + 1}`).join("\n"),
    "utf8",
  );
  await mkdir(path.join(root, "agent", "go-service"), { recursive: true });
  await writeFile(path.join(root, "agent", "go-service", "AGENTS.md"), "module notes", "utf8");
  await mkdir(path.join(root, "node_modules"), { recursive: true });
  await writeFile(path.join(root, "node_modules", "AGENTS.md"), "ignored", "utf8");

  const result = await inspectRepositoryDocs(root);

  expect(result.kind).toBe("repo_docs");
  expect(result.details.agentsFiles.map((file) => file.relativePath)).toEqual([
    "AGENTS.md",
    "agent/go-service/AGENTS.md",
  ]);
  expect(result.details.agentsFiles[0]).toMatchObject({ lineCount: 100, truncated: false });
  expect(result.details.agentsFiles[0]?.text).toContain("line 100");
  expect(result.artifacts.map((artifact) => artifact.relativePath)).toEqual([
    "AGENTS.md",
    "agent/go-service/AGENTS.md",
  ]);
});

test("truncates oversized AGENTS.md at the byte cap", async () => {
  const root = await temporaryRoot();
  await writeFile(path.join(root, "AGENTS.md"), "x".repeat(13 * 1024), "utf8");

  const result = await inspectRepositoryDocs(root);

  expect(result.details.agentsFiles[0]).toMatchObject({ truncated: true });
  expect(result.details.agentsFiles[0]?.text.length).toBeLessThanOrEqual(12 * 1024);
});

test("indexes skills from .agents, .claude, and skills roots with frontmatter", async () => {
  const root = await temporaryRoot();
  const skillBodies: Array<[string, string]> = [
    [".agents/skills/maaend-issue-log-analysis/SKILL.md", "---\nname: maaend-issue-log-analysis\ndescription: 分析 MaaEnd 公开 Issue。\n---\n\n# Guide"],
    [".claude/skills/go-service-guide/SKILL.md", "---\nname: go-service-guide\ndescription: Go service structure notes.\n---\n\n# Go"],
    ["skills/pipeline-guide/SKILL.md", "---\nname: pipeline-guide\ndescription: |\n  Pipeline layout notes.\n  Second line.\n---\n\n# Pipeline"],
  ];
  for (const [relativePath, body] of skillBodies) {
    const target = path.join(root, relativePath);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, body, "utf8");
  }

  const result = await inspectRepositoryDocs(root);

  expect(result.details.skills.map((skill) => skill.name)).toEqual([
    "maaend-issue-log-analysis",
    "go-service-guide",
    "pipeline-guide",
  ]);
  expect(result.details.skills[0]).toMatchObject({
    relativePath: ".agents/skills/maaend-issue-log-analysis/SKILL.md",
    description: "分析 MaaEnd 公开 Issue。",
    descriptionTruncated: false,
  });
  expect(result.details.skills[2]?.description).toBe("|\nPipeline layout notes.\nSecond line.");
  expect(result.artifacts.map((artifact) => artifact.relativePath)).toEqual([
    ".agents/skills/maaend-issue-log-analysis/SKILL.md",
    ".claude/skills/go-service-guide/SKILL.md",
    "skills/pipeline-guide/SKILL.md",
  ]);
});

test("falls back to the skill directory name when frontmatter has no name", async () => {
  const root = await temporaryRoot();
  const target = path.join(root, ".agents", "skills", "fallback-skill", "SKILL.md");
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, "# no frontmatter here", "utf8");

  const result = await inspectRepositoryDocs(root);

  expect(result.details.skills[0]).toMatchObject({
    name: "fallback-skill",
    description: "",
  });
});

test("rejects a source path that is not a directory", async () => {
  const root = await temporaryRoot();
  await writeFile(path.join(root, "file.txt"), "not a directory", "utf8");

  await expect(inspectRepositoryDocs(path.join(root, "file.txt"))).rejects.toThrow("not a directory");
});
