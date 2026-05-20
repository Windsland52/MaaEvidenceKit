import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import fg from "fast-glob";
import { z } from "zod";

import {
  CorpusCatalogSchema,
  CorpusPrepareInputSchema,
  CorpusPrepareResultSchema,
  CorpusSearchInputSchema,
  CorpusSearchResultSchema,
  type CorpusCatalog,
  type CorpusPrepareInput,
  type CorpusPrepareResult,
  type CorpusSearchInput,
  type CorpusSearchResult,
  type CorpusSummary,
  type PreparedCorpusSummary
} from "../models/corpus.js";
import type { RetrievalHit } from "../models/retrieval.js";

export type LocalCorpusDefinition = {
  id: string;
  name: string;
  description: string;
  rootPaths: string[];
  includeGlobs: string[];
  tags: string[];
};

type SearchLocalCorporaOptions = {
  workspaceRoot?: string;
  bundledCorporaRoot?: string;
  corpora?: LocalCorpusDefinition[];
};

type PrepareBuiltinCorporaOptions = SearchLocalCorporaOptions;

type ResolvedCorpusFile = {
  absolutePath: string;
  relativePath: string;
};

type SnippetMatch = {
  score: number;
  snippet: string;
  section?: string;
  title?: string;
  lineStart: number;
  lineEnd: number;
};

type PreparedCorpusChunk = {
  id: string;
  path: string;
  title: string;
  section?: string;
  lineStart: number;
  lineEnd: number;
  snippet: string;
  searchText: string;
  tags: string[];
};

type PreparedCorpusIndex = {
  apiVersion: "corpus-index/v1";
  corpusId: string;
  generatedAt: string;
  fileCount: number;
  chunkCount: number;
  chunks: PreparedCorpusChunk[];
};

const PreparedCorpusChunkSchema = z.object({
  id: z.string().min(1),
  path: z.string().min(1),
  title: z.string().min(1),
  section: z.string().min(1).optional(),
  lineStart: z.int().positive(),
  lineEnd: z.int().positive(),
  snippet: z.string().min(1),
  searchText: z.string().min(1),
  tags: z.array(z.string().min(1)).default([])
});

const PreparedCorpusIndexSchema = z.object({
  apiVersion: z.literal("corpus-index/v1"),
  corpusId: z.string().min(1),
  generatedAt: z.string().min(1),
  fileCount: z.int().nonnegative(),
  chunkCount: z.int().nonnegative(),
  chunks: z.array(PreparedCorpusChunkSchema).default([])
});

const MAX_SNIPPET_LINES = 3;
const MAX_MARKDOWN_CHUNK_LINES = 18;
const MAX_GENERIC_CHUNK_LINES = 20;

export const BuiltinCorpusDefinitions: readonly LocalCorpusDefinition[] = [
  {
    id: "maafw-docs",
    name: "MaaFramework Docs",
    description: "Local MaaFramework reference documentation mirrored under sample/MaaFramework.",
    rootPaths: [
      "sample/MaaFramework/docs/zh_cn",
      "sample/MaaFramework/docs/en_us"
    ],
    includeGlobs: ["*.md"],
    tags: ["maafw", "framework", "docs"]
  },
  {
    id: "diagnostic-guides",
    name: "Diagnostic Guides",
    description: "Project design and diagnostic workflow guides maintained inside this repository.",
    rootPaths: ["docs"],
    includeGlobs: [
      "core-domain-model.md",
      "monorepo-architecture.md",
      "package-boundaries.md",
      "quickstart-log-analysis.md"
    ],
    tags: ["docs", "diagnostic", "guides"]
  },
  {
    id: "repo-docs",
    name: "Repository Docs",
    description: "Markdown documentation stored under the repository docs directory.",
    rootPaths: ["docs"],
    includeGlobs: ["**/*.md"],
    tags: ["docs", "repo"]
  },
  {
    id: "repo-examples",
    name: "Repository Examples",
    description: "Example inputs and walkthroughs stored under the repository examples directory.",
    rootPaths: ["examples"],
    includeGlobs: ["**/*.md", "**/*.json"],
    tags: ["examples", "repo"]
  }
] as const;

function resolveRepoRoot(): string {
  return path.resolve(fileURLToPath(new URL("../../../../", import.meta.url)));
}

function resolveDefaultBundledCorporaRoot(): string {
  return path.resolve(fileURLToPath(new URL("../../corpora", import.meta.url)));
}

function toCorpusSummary(definition: LocalCorpusDefinition): CorpusSummary {
  return {
    id: definition.id,
    name: definition.name,
    description: definition.description,
    rootPaths: [...definition.rootPaths],
    includeGlobs: [...definition.includeGlobs],
    tags: [...definition.tags]
  };
}

function normalizePath(input: string): string {
  return input.split(path.sep).join("/");
}

function resolveSelectedCorpora(
  allCorpora: readonly LocalCorpusDefinition[],
  corpusIds: string[]
): LocalCorpusDefinition[] {
  if (corpusIds.length === 0) {
    return [...allCorpora];
  }

  const selected: LocalCorpusDefinition[] = [];
  for (const corpusId of corpusIds) {
    const corpus = allCorpora.find((item) => item.id === corpusId);
    if (!corpus) {
      throw new Error(`Unknown corpus: ${corpusId}`);
    }

    selected.push(corpus);
  }

  return selected;
}

function tokenizeQuery(query: string): string[] {
  const tokens = query.toLowerCase().match(/[\p{L}\p{N}_-]+/gu) ?? [];
  return [...new Set(tokens)];
}

function countOccurrences(text: string, needle: string): number {
  if (!needle) {
    return 0;
  }

  let count = 0;
  let fromIndex = 0;
  while (true) {
    const index = text.indexOf(needle, fromIndex);
    if (index < 0) {
      return count;
    }

    count += 1;
    fromIndex = index + needle.length;
  }
}

function scoreText(text: string, query: string, tokens: string[]): number {
  const normalized = text.toLowerCase();
  let score = 0;

  if (query.length > 0 && normalized.includes(query)) {
    score += 12;
  }

  for (const token of tokens) {
    const occurrences = countOccurrences(normalized, token);
    if (occurrences > 0) {
      score += 3 + Math.min(occurrences - 1, 3);
    }
  }

  return score;
}

function collapseSnippet(lines: string[]): string {
  return lines
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join("\n");
}

function findNearestHeading(lines: string[], index: number): string | undefined {
  for (let cursor = index; cursor >= 0; cursor -= 1) {
    const match = /^\s{0,3}#{1,6}\s+(.+?)\s*$/.exec(lines[cursor]);
    if (match?.[1]) {
      return match[1].trim();
    }
  }

  return undefined;
}

function findDocumentTitle(lines: string[], fallback: string): string {
  for (const line of lines) {
    const match = /^\s{0,3}#{1,6}\s+(.+?)\s*$/.exec(line);
    if (match?.[1]) {
      return match[1].trim();
    }
  }

  return fallback;
}

function findBestSnippet(content: string, query: string, fallbackTitle: string): SnippetMatch | null {
  const tokens = tokenizeQuery(query);
  const normalizedQuery = query.trim().toLowerCase();
  const lines = content.split(/\r?\n/);
  const title = findDocumentTitle(lines, fallbackTitle);

  let bestMatch: SnippetMatch | null = null;

  for (let index = 0; index < lines.length; index += 1) {
    const windowStart = Math.max(0, index - 1);
    const windowEnd = Math.min(lines.length, windowStart + MAX_SNIPPET_LINES);
    const snippetLines = lines.slice(windowStart, windowEnd);
    const snippet = collapseSnippet(snippetLines);
    if (!snippet) {
      continue;
    }

    const score = scoreText(snippet, normalizedQuery, tokens);
    if (score <= 0) {
      continue;
    }

    const currentMatch: SnippetMatch = {
      score,
      snippet,
      section: findNearestHeading(lines, index),
      title,
      lineStart: windowStart + 1,
      lineEnd: windowEnd
    };

    if (
      bestMatch === null ||
      currentMatch.score > bestMatch.score ||
      (currentMatch.score === bestMatch.score && currentMatch.lineStart < bestMatch.lineStart)
    ) {
      bestMatch = currentMatch;
    }
  }

  return bestMatch;
}

async function resolveCorpusFiles(
  workspaceRoot: string,
  definition: LocalCorpusDefinition
): Promise<ResolvedCorpusFile[]> {
  const resolvedFiles = new Map<string, ResolvedCorpusFile>();

  for (const rootPath of definition.rootPaths) {
    const absoluteRoot = path.resolve(workspaceRoot, rootPath);
    const matches = await fg(definition.includeGlobs, {
      cwd: absoluteRoot,
      onlyFiles: true,
      unique: true
    });

    for (const match of matches) {
      const relativePath = normalizePath(path.join(rootPath, match));
      resolvedFiles.set(relativePath, {
        absolutePath: path.resolve(absoluteRoot, match),
        relativePath
      });
    }
  }

  return [...resolvedFiles.values()].sort((left, right) => {
    return left.relativePath.localeCompare(right.relativePath);
  });
}

function createChunk(
  corpusId: string,
  relativePath: string,
  title: string,
  section: string | undefined,
  lineStart: number,
  lineEnd: number,
  lines: string[],
  tags: string[]
): PreparedCorpusChunk | null {
  const snippet = collapseSnippet(lines);
  if (!snippet) {
    return null;
  }

  return {
    id: `${corpusId}:${relativePath}:${lineStart}`,
    path: relativePath,
    title,
    section,
    lineStart,
    lineEnd,
    snippet,
    searchText: [title, section ?? "", snippet].filter((item) => item.length > 0).join("\n"),
    tags
  };
}

function createMarkdownChunks(
  corpusId: string,
  relativePath: string,
  content: string,
  tags: string[]
): PreparedCorpusChunk[] {
  const lines = content.split(/\r?\n/);
  const chunks: PreparedCorpusChunk[] = [];
  let documentTitle = findDocumentTitle(lines, path.basename(relativePath));
  let currentSection: string | undefined;
  let buffer: string[] = [];
  let bufferStart = 1;

  const flush = (lineEnd: number) => {
    const chunk = createChunk(
      corpusId,
      relativePath,
      documentTitle,
      currentSection,
      bufferStart,
      lineEnd,
      buffer,
      tags
    );
    if (chunk) {
      chunks.push(chunk);
    }
    buffer = [];
    bufferStart = lineEnd + 1;
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const headingMatch = /^\s{0,3}(#{1,6})\s+(.+?)\s*$/.exec(line);
    if (headingMatch) {
      if (buffer.length > 0) {
        flush(index);
      }

      const level = headingMatch[1].length;
      const heading = headingMatch[2].trim();
      if (level === 1) {
        documentTitle = heading;
        currentSection = undefined;
      }
      else {
        currentSection = heading;
      }
    }

    buffer.push(line);
    if (buffer.length >= MAX_MARKDOWN_CHUNK_LINES) {
      flush(index + 1);
    }
  }

  if (buffer.length > 0) {
    flush(lines.length);
  }

  return chunks;
}

function createGenericChunks(
  corpusId: string,
  relativePath: string,
  content: string,
  tags: string[]
): PreparedCorpusChunk[] {
  const lines = content.split(/\r?\n/);
  const chunks: PreparedCorpusChunk[] = [];
  const title = path.basename(relativePath);

  for (let index = 0; index < lines.length; index += MAX_GENERIC_CHUNK_LINES) {
    const slice = lines.slice(index, index + MAX_GENERIC_CHUNK_LINES);
    const chunk = createChunk(
      corpusId,
      relativePath,
      title,
      undefined,
      index + 1,
      index + slice.length,
      slice,
      tags
    );
    if (chunk) {
      chunks.push(chunk);
    }
  }

  return chunks;
}

function createChunksForFile(
  corpusId: string,
  relativePath: string,
  content: string,
  tags: string[]
): PreparedCorpusChunk[] {
  if (relativePath.toLowerCase().endsWith(".md")) {
    return createMarkdownChunks(corpusId, relativePath, content, tags);
  }

  return createGenericChunks(corpusId, relativePath, content, tags);
}

function resolveCorpusCachePath(workspaceRoot: string, corpusId: string): string {
  return path.resolve(workspaceRoot, ".cache", "corpora", `${corpusId}.json`);
}

function resolveBundledCorpusPath(bundledCorporaRoot: string, corpusId: string): string {
  return path.resolve(bundledCorporaRoot, `${corpusId}.json`);
}

async function readPreparedCorpus(
  workspaceRoot: string,
  corpusId: string
): Promise<PreparedCorpusIndex | null> {
  try {
    const content = await readFile(resolveCorpusCachePath(workspaceRoot, corpusId), "utf8");
    return PreparedCorpusIndexSchema.parse(JSON.parse(content));
  }
  catch {
    return null;
  }
}

async function readBundledCorpus(
  bundledCorporaRoot: string,
  corpusId: string
): Promise<PreparedCorpusIndex | null> {
  try {
    const content = await readFile(resolveBundledCorpusPath(bundledCorporaRoot, corpusId), "utf8");
    return PreparedCorpusIndexSchema.parse(JSON.parse(content));
  }
  catch {
    return null;
  }
}

async function prepareCorpus(
  workspaceRoot: string,
  definition: LocalCorpusDefinition,
  force: boolean
): Promise<PreparedCorpusSummary> {
  const cachePath = resolveCorpusCachePath(workspaceRoot, definition.id);
  if (!force) {
    const existing = await readPreparedCorpus(workspaceRoot, definition.id);
    if (existing) {
      return {
        corpusId: definition.id,
        cachePath: normalizePath(path.relative(workspaceRoot, cachePath)),
        fileCount: existing.fileCount,
        chunkCount: existing.chunkCount
      };
    }
  }

  const files = await resolveCorpusFiles(workspaceRoot, definition);
  const chunks: PreparedCorpusChunk[] = [];

  for (const file of files) {
    const content = await readFile(file.absolutePath, "utf8");
    chunks.push(...createChunksForFile(definition.id, file.relativePath, content, definition.tags));
  }

  const index: PreparedCorpusIndex = {
    apiVersion: "corpus-index/v1",
    corpusId: definition.id,
    generatedAt: new Date().toISOString(),
    fileCount: files.length,
    chunkCount: chunks.length,
    chunks
  };

  await mkdir(path.dirname(cachePath), { recursive: true });
  await writeFile(cachePath, `${JSON.stringify(index, null, 2)}\n`, "utf8");

  return {
    corpusId: definition.id,
    cachePath: normalizePath(path.relative(workspaceRoot, cachePath)),
    fileCount: files.length,
    chunkCount: chunks.length
  };
}

function toRetrievalHit(
  corpusId: string,
  relativePath: string,
  match: SnippetMatch,
  tags: string[] = []
): RetrievalHit {
  return {
    id: `${corpusId}:${relativePath}:${match.lineStart}`,
    corpus: corpusId,
    path: relativePath,
    title: match.title,
    section: match.section,
    score: Number(match.score.toFixed(2)),
    snippet: match.snippet,
    tags,
    metadata: {
      lineStart: String(match.lineStart),
      lineEnd: String(match.lineEnd)
    }
  };
}

function searchIndexedCorpus(
  index: PreparedCorpusIndex,
  query: string,
  source: "prepared" | "bundled"
): RetrievalHit[] {
  const tokens = tokenizeQuery(query);
  const normalizedQuery = query.trim().toLowerCase();
  const hits: RetrievalHit[] = [];

  for (const chunk of index.chunks) {
    const score = scoreText(chunk.searchText, normalizedQuery, tokens);
    if (score <= 0) {
      continue;
    }

    hits.push({
      id: chunk.id,
      corpus: index.corpusId,
      path: chunk.path,
      title: chunk.title,
      section: chunk.section,
      score: Number(score.toFixed(2)),
      snippet: chunk.snippet,
      tags: chunk.tags,
      metadata: {
        lineStart: String(chunk.lineStart),
        lineEnd: String(chunk.lineEnd),
        indexSource: source,
        ...(source === "prepared" ? { prepared: "true" } : { bundled: "true" })
      }
    });
  }

  return hits;
}

export function buildCorpusCatalog(
  corpora: readonly LocalCorpusDefinition[] = BuiltinCorpusDefinitions
): CorpusCatalog {
  return CorpusCatalogSchema.parse({
    apiVersion: "corpus-catalog/v1",
    corpora: corpora.map(toCorpusSummary)
  });
}

export function listBuiltinCorpora(): CorpusSummary[] {
  return buildCorpusCatalog().corpora;
}

export async function prepareBuiltinCorpora(
  input: CorpusPrepareInput,
  options: PrepareBuiltinCorporaOptions = {}
): Promise<CorpusPrepareResult> {
  const parsedInput = CorpusPrepareInputSchema.parse(input);
  const workspaceRoot = options.workspaceRoot ?? resolveRepoRoot();
  const corpora = resolveSelectedCorpora(
    options.corpora ?? BuiltinCorpusDefinitions,
    parsedInput.corpusIds
  );

  const prepared = await Promise.all(
    corpora.map((corpus) => prepareCorpus(workspaceRoot, corpus, parsedInput.force))
  );

  return CorpusPrepareResultSchema.parse({
    apiVersion: "corpus-prepare-result/v1",
    prepared
  });
}

export async function searchLocalCorpora(
  input: CorpusSearchInput,
  options: SearchLocalCorporaOptions = {}
): Promise<CorpusSearchResult> {
  const parsedInput = CorpusSearchInputSchema.parse(input);
  const workspaceRoot = options.workspaceRoot ?? resolveRepoRoot();
  const bundledCorporaRoot = options.bundledCorporaRoot ?? resolveDefaultBundledCorporaRoot();
  const corpora = resolveSelectedCorpora(
    options.corpora ?? BuiltinCorpusDefinitions,
    parsedInput.corpusIds
  );

  const hits: RetrievalHit[] = [];
  let fileCount = 0;

  for (const corpus of corpora) {
    const prepared = await readPreparedCorpus(workspaceRoot, corpus.id);
    if (prepared) {
      fileCount += prepared.fileCount;
      hits.push(...searchIndexedCorpus(prepared, parsedInput.query, "prepared"));
      continue;
    }

    const bundled = await readBundledCorpus(bundledCorporaRoot, corpus.id);
    if (bundled) {
      fileCount += bundled.fileCount;
      hits.push(...searchIndexedCorpus(bundled, parsedInput.query, "bundled"));
      continue;
    }

    const files = await resolveCorpusFiles(workspaceRoot, corpus);
    fileCount += files.length;

    for (const file of files) {
      const content = await readFile(file.absolutePath, "utf8");
      const match = findBestSnippet(
        content,
        parsedInput.query,
        path.basename(file.relativePath)
      );
      if (!match) {
        continue;
      }

      hits.push(toRetrievalHit(corpus.id, file.relativePath, match, corpus.tags));
    }
  }

  hits.sort((left, right) => {
    if (left.score !== right.score) {
      return right.score - left.score;
    }

    if (left.corpus !== right.corpus) {
      return left.corpus.localeCompare(right.corpus);
    }

    if (left.path !== right.path) {
      return left.path.localeCompare(right.path);
    }

    return String(left.metadata.lineStart).localeCompare(String(right.metadata.lineStart));
  });

  return CorpusSearchResultSchema.parse({
    apiVersion: "retrieval-result/v1",
    query: parsedInput.query,
    corpusIds: corpora.map((corpus) => corpus.id),
    hits: hits.slice(0, parsedInput.limit),
    stats: {
      corpusCount: corpora.length,
      fileCount,
      hitCount: hits.length
    }
  });
}
