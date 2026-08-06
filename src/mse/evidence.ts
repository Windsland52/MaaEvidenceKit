import path from "node:path";

import {
  artifactId,
  relativePortablePath,
  type Artifact,
  type EvidenceLedger,
  type EvidenceSource,
} from "../evidence/index.js";
import type { MseTaskResolutionResult } from "./engine.js";

export function mseSourceFor(
  artifacts: Artifact[],
  inputRoot: string,
  projectRoot: string,
  sourcePath: string,
  line?: number,
  node?: string,
): EvidenceSource {
  const absolute = path.resolve(projectRoot, sourcePath);
  const relativePath = relativePortablePath(inputRoot, absolute);
  const comparableRelativePath = process.platform === "win32" ? relativePath.toLowerCase() : relativePath;
  let artifact = artifacts.find((item) => {
    const candidate = process.platform === "win32" ? item.relativePath.toLowerCase() : item.relativePath;
    return candidate === comparableRelativePath;
  });
  if (artifact === undefined) {
    artifact = {
      id: artifactId(relativePath),
      path: absolute,
      relativePath,
      kind: sourcePath.toLowerCase().includes("interface") ? "interface" : "pipeline",
      status: "selected",
    };
    artifacts.push(artifact);
  }
  return {
    artifactId: artifact.id,
    path: artifact.relativePath,
    ...(line === undefined ? {} : { line }),
    ...(node === undefined ? {} : { node }),
  };
}

export function addMseResolutionEvidence(
  ledger: EvidenceLedger,
  artifacts: Artifact[],
  inputRoot: string,
  projectRoot: string,
  resolution: MseTaskResolutionResult,
): void {
  for (const task of resolution.resolutions) {
    for (const definition of task.definitions) {
      ledger.add(
        "mse.task_definition",
        `Pipeline task ${task.name} is defined for controller ${task.controller ?? "default"} and resource ${task.resource ?? "default"}.`,
        mseSourceFor(artifacts, inputRoot, projectRoot, definition.source_path, definition.line, task.name),
        {
          name: task.name,
          controller: task.controller,
          resource: task.resource,
          rawConfig: definition.raw_config,
          effectiveConfig: task.effective_config,
        },
      );
    }
    for (const reference of task.references) {
      ledger.add(
        "mse.reference",
        `Pipeline task ${task.name} references ${reference.target} through ${reference.kind}.`,
        mseSourceFor(artifacts, inputRoot, projectRoot, reference.source_path, reference.line, task.name),
        {
          from: task.name,
          to: reference.target,
          kind: reference.kind,
          controller: task.controller,
          resource: task.resource,
        },
      );
    }
  }
}
