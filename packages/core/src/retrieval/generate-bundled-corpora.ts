import { copyFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { prepareBuiltinCorpora } from "./local.js";

const repoRoot = path.resolve(fileURLToPath(new URL("../../../../", import.meta.url)));
const bundledCorporaRoot = path.resolve(fileURLToPath(new URL("../../corpora", import.meta.url)));

await prepareBuiltinCorpora(
  {
    apiVersion: "corpus-prepare/v1",
    corpusIds: ["maafw-docs"],
    force: true
  },
  {
    workspaceRoot: repoRoot
  }
);

await mkdir(bundledCorporaRoot, { recursive: true });
await copyFile(
  path.resolve(repoRoot, ".cache", "corpora", "maafw-docs.json"),
  path.resolve(bundledCorporaRoot, "maafw-docs.json")
);

console.log("Generated bundled corpus: maafw-docs");
