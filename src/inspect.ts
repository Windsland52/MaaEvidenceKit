import path from "node:path";

import {
  EVIDENCE_SCHEMA_VERSION,
  type Artifact,
  type Evidence,
  type InspectionResult,
} from "./evidence/index.js";
import { discoverArtifacts, inspectMla, type MlaInspectOptions, type MlaInspectionResult } from "./mla/index.js";
import { discoverMseProjects, inspectMse, type MseInspectOptions, type MseInspectionResult } from "./mse/index.js";

export type InspectOptions = {
  mla?: MlaInspectOptions | false;
  mse?: MseInspectOptions | false;
};

export type CombinedInspectionDetails = {
  mla: MlaInspectionResult | null;
  mse: MseInspectionResult | null;
};

export type CombinedInspectionResult = InspectionResult<CombinedInspectionDetails> & {
  kind: "combined";
};

function mergeArtifacts(groups: readonly Artifact[][]): Artifact[] {
  const artifacts = new Map<string, Artifact>();
  for (const artifact of groups.flat()) {
    const resolved = path.resolve(artifact.path);
    const key = process.platform === "win32" ? resolved.toLowerCase() : resolved;
    const current = artifacts.get(key);
    if (current === undefined || (current.status !== "selected" && artifact.status === "selected")) {
      artifacts.set(key, artifact);
    }
  }
  return [...artifacts.values()].sort((left, right) => left.relativePath.localeCompare(right.relativePath));
}

function mergeEvidence(groups: readonly Evidence[][]): Evidence[] {
  const evidence = new Map<string, Evidence>();
  for (const item of groups.flat()) {
    const current = evidence.get(item.id);
    if (current !== undefined && JSON.stringify(current) !== JSON.stringify(item)) {
      throw new Error(`Evidence ID collision: ${item.id}`);
    }
    evidence.set(item.id, item);
  }
  return [...evidence.values()];
}

export async function inspect(
  inputPath: string,
  options: InspectOptions = {},
): Promise<CombinedInspectionResult> {
  const resolvedPath = path.resolve(inputPath);
  const [artifactDiscovery, mseDiscovery] = await Promise.all([
    discoverArtifacts(resolvedPath),
    discoverMseProjects(resolvedPath),
  ]);
  const shouldInspectMla = options.mla !== false
    && artifactDiscovery.artifacts.some((artifact) => artifact.kind === "maa_log");
  const shouldInspectMse = options.mse !== false && mseDiscovery.projects.length > 0;
  const [mla, mse] = await Promise.all([
    shouldInspectMla ? inspectMla(resolvedPath, options.mla || {}) : Promise.resolve(null),
    shouldInspectMse ? inspectMse(resolvedPath, options.mse || {}) : Promise.resolve(null),
  ]);
  const componentResults = [mla, mse].filter((item) => item !== null);
  const artifacts = componentResults.length === 0
    ? artifactDiscovery.artifacts
    : mergeArtifacts(componentResults.map((item) => item.artifacts));
  const evidence = mergeEvidence(componentResults.map((item) => item.evidence));
  const missingEvidence = componentResults.flatMap((item) => item.missingEvidence);
  if (!shouldInspectMla) {
    missingEvidence.push({
      code: "maa_framework_log_not_selected",
      message: "No detected MaaFramework log selected the MLA adapter.",
      path: resolvedPath,
    });
  }
  if (!shouldInspectMse) {
    missingEvidence.push({
      code: "mse_project_not_selected",
      message: "No detected Maa project selected the MSE adapter.",
      path: resolvedPath,
    });
  }
  return {
    schemaVersion: EVIDENCE_SCHEMA_VERSION,
    kind: "combined",
    generatedAt: new Date().toISOString(),
    input: {
      path: resolvedPath,
      ...(mla?.input.timeRange === undefined ? {} : { timeRange: mla.input.timeRange }),
    },
    artifacts,
    evidence,
    missingEvidence,
    warnings: [
      ...artifactDiscovery.warnings,
      ...componentResults.flatMap((item) => item.warnings),
    ],
    statistics: {
      scannedFiles: artifactDiscovery.scannedFileCount,
      adapters: componentResults.length,
      evidence: evidence.length,
      mlaEvidence: mla?.evidence.length ?? 0,
      mseEvidence: mse?.evidence.length ?? 0,
    },
    details: { mla, mse },
  };
}
