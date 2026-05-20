import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  prepareBuiltinCorpora,
  searchLocalCorpora,
  type LocalCorpusDefinition
} from "../retrieval/local.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map(async (tempDir) => {
      await import("node:fs/promises").then(({ rm }) => rm(tempDir, { recursive: true, force: true }));
    })
  );
});

describe("local retrieval", () => {
  it("searches a local corpus deterministically", async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "maa-diagnostic-core-"));
    tempDirs.push(workspaceRoot);

    await mkdir(path.join(workspaceRoot, "docs"), { recursive: true });
    await writeFile(
      path.join(workspaceRoot, "docs", "guide.md"),
      [
        "# Runtime Discovery",
        "",
        "Use describe-runtime before invoking analysis commands.",
        "Search local corpus can discover repo docs.",
        "",
        "## Profiles",
        "list-builtin-profiles returns the available profile ids."
      ].join("\n"),
      "utf8"
    );

    const corpora: LocalCorpusDefinition[] = [
      {
        id: "test-guides",
        name: "Test Guides",
        description: "Temporary corpus used by unit tests.",
        rootPaths: ["docs"],
        includeGlobs: ["**/*.md"],
        tags: ["test"]
      }
    ];

    const result = await searchLocalCorpora(
      {
        apiVersion: "retrieval-query/v1",
        query: "describe-runtime analysis commands",
        corpusIds: ["test-guides"],
        limit: 3
      },
      {
        workspaceRoot,
        corpora
      }
    );

    expect(result.apiVersion).toBe("retrieval-result/v1");
    expect(result.corpusIds).toEqual(["test-guides"]);
    expect(result.stats.corpusCount).toBe(1);
    expect(result.stats.fileCount).toBe(1);
    expect(result.hits).toHaveLength(1);
    expect(result.hits[0]?.path).toBe("docs/guide.md");
    expect(result.hits[0]?.snippet).toContain("describe-runtime");
  });

  it("prepares and reuses a local corpus index", async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "maa-diagnostic-core-"));
    tempDirs.push(workspaceRoot);

    await mkdir(path.join(workspaceRoot, "docs"), { recursive: true });
    await writeFile(
      path.join(workspaceRoot, "docs", "runtime.md"),
      [
        "# Runtime",
        "",
        "ProjectInterfaceV2 documents interface.json and task option semantics.",
        "Search results should be served from the prepared corpus cache."
      ].join("\n"),
      "utf8"
    );

    const corpora: LocalCorpusDefinition[] = [
      {
        id: "test-guides",
        name: "Test Guides",
        description: "Temporary corpus used by unit tests.",
        rootPaths: ["docs"],
        includeGlobs: ["**/*.md"],
        tags: ["test"]
      }
    ];

    const prepared = await prepareBuiltinCorpora(
      {
        apiVersion: "corpus-prepare/v1",
        corpusIds: ["test-guides"],
        force: true
      },
      {
        workspaceRoot,
        corpora
      }
    );

    const result = await searchLocalCorpora(
      {
        apiVersion: "retrieval-query/v1",
        query: "ProjectInterfaceV2 interface.json",
        corpusIds: ["test-guides"],
        limit: 3
      },
      {
        workspaceRoot,
        corpora
      }
    );

    expect(prepared.prepared).toHaveLength(1);
    expect(prepared.prepared[0]?.cachePath).toBe(".cache/corpora/test-guides.json");
    expect(prepared.prepared[0]?.chunkCount).toBeGreaterThan(0);
    expect(result.hits[0]?.metadata.prepared).toBe("true");
  });

  it("uses a bundled corpus index when no prepared cache exists", async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "maa-diagnostic-core-"));
    tempDirs.push(workspaceRoot);

    const bundledCorporaRoot = path.join(workspaceRoot, "bundled-corpora");
    await mkdir(bundledCorporaRoot, { recursive: true });
    await writeFile(
      path.join(bundledCorporaRoot, "test-guides.json"),
      `${JSON.stringify({
        apiVersion: "corpus-index/v1",
        corpusId: "test-guides",
        generatedAt: "2026-05-20T00:00:00.000Z",
        fileCount: 1,
        chunkCount: 1,
        chunks: [
          {
            id: "test-guides:offline.md:1",
            path: "offline.md",
            title: "Offline Guides",
            lineStart: 1,
            lineEnd: 2,
            snippet: "ProjectInterfaceV2 documentation is available from the bundled offline index.",
            searchText: "Offline Guides\nProjectInterfaceV2 documentation is available from the bundled offline index.",
            tags: ["test", "bundled"]
          }
        ]
      }, null, 2)}\n`,
      "utf8"
    );

    const corpora: LocalCorpusDefinition[] = [
      {
        id: "test-guides",
        name: "Test Guides",
        description: "Temporary corpus used by unit tests.",
        rootPaths: ["docs"],
        includeGlobs: ["**/*.md"],
        tags: ["test"]
      }
    ];

    const result = await searchLocalCorpora(
      {
        apiVersion: "retrieval-query/v1",
        query: "ProjectInterfaceV2 offline index",
        corpusIds: ["test-guides"],
        limit: 3
      },
      {
        workspaceRoot,
        bundledCorporaRoot,
        corpora
      }
    );

    expect(result.stats.fileCount).toBe(1);
    expect(result.hits).toHaveLength(1);
    expect(result.hits[0]?.metadata.indexSource).toBe("bundled");
    expect(result.hits[0]?.metadata.bundled).toBe("true");
  });
});
