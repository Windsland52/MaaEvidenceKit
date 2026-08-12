import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";

import {
  EVIDENCE_SCHEMA_VERSION,
  artifactId,
  relativePortablePath,
  type Artifact,
  type InspectionResult,
  type InspectionWarning,
  type MissingEvidence,
} from "../evidence/index.js";

export const REPO_DOCS_KIND = "repo_docs" as const;

const MAX_AGENTS_FILES = 4;
const MAX_AGENTS_FILE_BYTES = 12 * 1024;
const MAX_SKILLS = 50;
const MAX_SKILL_FRONTMATTER_BYTES = 8 * 1024;
const MAX_SKILL_DESCRIPTION_CHARACTERS = 500;
const SKILL_DIRECTORIES = [".agents/skills", ".claude/skills", "skills"];
const SKIPPED_DIRECTORIES = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  ".venv",
  ".cache",
  "tmp",
]);

export type RepositoryDocFile = {
  relativePath: string;
  sizeBytes: number;
  lineCount: number;
  truncated: boolean;
  text: string;
};

export type RepositorySkillEntry = {
  relativePath: string;
  sizeBytes: number;
  name: string;
  description: string;
  descriptionTruncated: boolean;
};

export type RepositoryDocsDetails = {
  inputRoot: string;
  agentsFiles: RepositoryDocFile[];
  skills: RepositorySkillEntry[];
  agentsFilesTruncated: boolean;
  skillsTruncated: boolean;
};

export type RepositoryDocsResult = InspectionResult<RepositoryDocsDetails> & { kind: typeof REPO_DOCS_KIND };

async function isDirectory(target: string): Promise<boolean> {
  try {
    return (await stat(target)).isDirectory();
  } catch {
    return false;
  }
}

async function findAgentsFiles(root: string): Promise<string[]> {
  const found: string[] = [];
  const stack: string[] = [root];
  while (stack.length > 0 && found.length < MAX_AGENTS_FILES) {
    const directory = stack.pop()!;
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (found.length >= MAX_AGENTS_FILES) break;
      if (entry.isDirectory()) {
        if (!SKIPPED_DIRECTORIES.has(entry.name)) stack.push(path.join(directory, entry.name));
      } else if (entry.name.toLowerCase() === "agents.md") {
        found.push(path.join(directory, entry.name));
      }
    }
  }
  return found;
}

async function findSkillFiles(root: string): Promise<string[]> {
  const found: string[] = [];
  for (const directoryName of SKILL_DIRECTORIES) {
    const base = path.join(root, directoryName);
    let entries;
    try {
      entries = await readdir(base, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (found.length >= MAX_SKILLS) break;
      if (!entry.isDirectory()) continue;
      const skillMarkdown = path.join(base, entry.name, "SKILL.md");
      try {
        if ((await stat(skillMarkdown)).isFile()) found.push(skillMarkdown);
      } catch {
        // A skill directory without SKILL.md is not part of the inventory.
      }
    }
  }
  return found;
}

async function readBoundedText(target: string, maxBytes: number): Promise<{ text: string; truncated: boolean }> {
  const buffer = await readFile(target);
  if (buffer.length <= maxBytes) return { text: buffer.toString("utf8"), truncated: false };
  return { text: buffer.subarray(0, maxBytes).toString("utf8"), truncated: true };
}

function parseSkillFrontmatter(text: string): { name?: string; description?: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (match === null) return {};
  let name: string | undefined;
  let description: string | undefined;
  let continuation: "description" | null = null;
  for (const rawLine of match[1]!.split(/\r?\n/)) {
    const keyMatch = /^([a-zA-Z_][a-zA-Z0-9_-]*)\s*:\s*(.*)$/.exec(rawLine);
    if (keyMatch !== null) {
      const key = keyMatch[1]!;
      const value = keyMatch[2]!.trim();
      if (key === "name") {
        name = value.length === 0 ? undefined : value;
        continuation = null;
      } else if (key === "description") {
        description = value;
        continuation = "description";
      } else {
        continuation = null;
      }
      continue;
    }
    if (continuation === "description" && description !== undefined && description.length > 0) {
      description += `\n${rawLine.trim()}`;
    }
  }
  return {
    ...(name === undefined ? {} : { name }),
    ...(description === undefined ? {} : { description }),
  };
}

export async function inspectRepositoryDocs(sourceRoot: string): Promise<RepositoryDocsResult> {
  const resolved = path.resolve(sourceRoot);
  if (!await isDirectory(resolved)) {
    throw new Error(`Repository docs source is not a directory: ${resolved}`);
  }

  const agentsPaths = await findAgentsFiles(resolved);
  const skillPaths = await findSkillFiles(resolved);
  const agentsFiles: RepositoryDocFile[] = [];
  const skills: RepositorySkillEntry[] = [];
  const artifacts: Artifact[] = [];
  const warnings: InspectionWarning[] = [];
  const missingEvidence: MissingEvidence[] = [];

  for (const filePath of agentsPaths) {
    const relativePath = relativePortablePath(resolved, filePath);
    const fileInfo = await stat(filePath);
    const { text, truncated } = await readBoundedText(filePath, MAX_AGENTS_FILE_BYTES);
    agentsFiles.push({
      relativePath,
      sizeBytes: fileInfo.size,
      lineCount: text.split(/\r?\n/).length,
      truncated,
      text,
    });
    artifacts.push({
      id: artifactId(relativePath),
      path: filePath,
      relativePath,
      kind: "other",
      status: "available",
      sizeBytes: fileInfo.size,
    });
  }

  for (const skillPath of skillPaths) {
    const relativePath = relativePortablePath(resolved, skillPath);
    const fileInfo = await stat(skillPath);
    const { text } = await readBoundedText(skillPath, MAX_SKILL_FRONTMATTER_BYTES);
    const frontmatter = parseSkillFrontmatter(text);
    const rawDescription = frontmatter.description ?? "";
    const descriptionTruncated = rawDescription.length > MAX_SKILL_DESCRIPTION_CHARACTERS;
    skills.push({
      relativePath,
      sizeBytes: fileInfo.size,
      name: frontmatter.name ?? path.basename(path.dirname(skillPath)),
      description: rawDescription.slice(0, MAX_SKILL_DESCRIPTION_CHARACTERS),
      descriptionTruncated,
    });
    artifacts.push({
      id: artifactId(relativePath),
      path: skillPath,
      relativePath,
      kind: "other",
      status: "available",
      sizeBytes: fileInfo.size,
    });
  }

  const agentsFilesTruncated = agentsPaths.length >= MAX_AGENTS_FILES;
  const skillsTruncated = skillPaths.length >= MAX_SKILLS;
  if (agentsFilesTruncated) {
    warnings.push({
      code: "repo_docs_agents_truncated",
      message: `AGENTS.md inventory truncated at ${MAX_AGENTS_FILES} files.`,
    });
  }
  if (skillsTruncated) {
    warnings.push({
      code: "repo_docs_skills_truncated",
      message: `Skill inventory truncated at ${MAX_SKILLS} entries.`,
    });
  }

  return {
    schemaVersion: EVIDENCE_SCHEMA_VERSION,
    kind: REPO_DOCS_KIND,
    generatedAt: new Date().toISOString(),
    input: { path: resolved },
    artifacts,
    evidence: [],
    missingEvidence,
    warnings,
    statistics: {
      agentsFilesFound: agentsFiles.length,
      skillsFound: skills.length,
      agentsFilesTruncated: agentsFilesTruncated ? 1 : 0,
      skillsTruncated: skillsTruncated ? 1 : 0,
      docsBytes: [...agentsFiles, ...skills].reduce((total, item) => total + item.sizeBytes, 0),
    },
    details: {
      inputRoot: resolved,
      agentsFiles,
      skills,
      agentsFilesTruncated,
      skillsTruncated,
    },
  };
}
