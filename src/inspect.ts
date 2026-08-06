import path from "node:path";

import {
  EVIDENCE_SCHEMA_VERSION,
  EvidenceLedger,
  type Artifact,
  type Evidence,
  type InspectionResult,
  type InspectionWarning,
} from "./evidence/index.js";
import { discoverArtifacts, inspectMla, type MlaInspectOptions, type MlaInspectionResult } from "./mla/index.js";
import { discoverMseProjects, inspectMse, type MseInspectOptions, type MseInspectionResult } from "./mse/index.js";
import { profileStage, profileStageSync } from "./profiling.js";

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

type PipelineDefinitionEvidence = {
  sourcePath: string;
  line: number;
  column: number;
  controller: string | null;
  resource: string | null;
};

type PipelineReferenceEvidenceData = {
  failureId: string;
  failureKind: string;
  node: string;
  task: string;
  pipelineFound: boolean;
  pipelineControllers: string[];
  pipelineResources: string[];
  pipelineDefinitions: PipelineDefinitionEvidence[];
};

type MlaFailureDetails = {
  node_name?: string;
  task_name?: string;
  failure_id?: string;
};

function addPipelineReferences(
  ledger: EvidenceLedger,
  mla: MlaInspectionResult,
  mse: MseInspectionResult,
): Set<string> {
  const graphNodes = new Map<string, Array<{
    found: boolean;
    controller: string | null;
    resource: string | null;
    definitions: PipelineDefinitionEvidence[];
  }>>();
  for (const project of mse.details.projects) {
    for (const node of project.graph.nodes) {
      const group = graphNodes.get(node.name) ?? [];
      group.push({
        found: node.found,
        controller: node.controller,
        resource: node.resource,
        definitions: node.definitions.map((definition) => ({
          sourcePath: definition.source_path,
          line: definition.line,
          column: definition.column,
          controller: node.controller,
          resource: node.resource,
        })),
      });
      graphNodes.set(node.name, group);
    }
  }
  const unfoundNodes = new Set<string>();
  for (const failure of mla.evidence) {
    if (failure.kind !== "mla.failure") continue;
    const data = failure.data as MlaFailureDetails | undefined;
    const node = data?.node_name;
    if (node === undefined || data === undefined) continue;
    const pipelineNodes = graphNodes.get(node) ?? [];
    const foundNodes = pipelineNodes.filter((item) => item.found);
    const pipelineFound = foundNodes.length > 0;
    const controllers = [...new Set(foundNodes.map((item) => item.controller).filter((item): item is string => item !== null))];
    const resources = [...new Set(foundNodes.map((item) => item.resource).filter((item): item is string => item !== null))];
    const pipelineDefinitions = [...new Map(
      foundNodes.flatMap((item) => item.definitions).map((definition) => [
        `${definition.sourcePath}:${definition.line}:${definition.column}:${definition.controller ?? ""}:${definition.resource ?? ""}`,
        definition,
      ]),
    ).values()].sort((left, right) =>
      [left.sourcePath, left.line, left.column, left.controller ?? "", left.resource ?? ""].join("|")
        .localeCompare([right.sourcePath, right.line, right.column, right.controller ?? "", right.resource ?? ""].join("|")),
    );
    if (!pipelineFound) unfoundNodes.add(node);
    const payload: PipelineReferenceEvidenceData = {
      failureId: data.failure_id ?? failure.id,
      failureKind: failure.kind,
      node,
      task: data.task_name ?? "",
      pipelineFound,
      pipelineControllers: controllers,
      pipelineResources: resources,
      pipelineDefinitions,
    };
    ledger.add(
      "combined.pipeline_reference",
      pipelineFound
        ? `Failure node ${node} exists in the MSE pipeline.`
        : `Failure node ${node} was not found in the MSE pipeline.`,
      {
        artifactId: failure.source.artifactId,
        path: failure.source.path,
        ...(failure.source.line === undefined ? {} : { line: failure.source.line }),
        ...(failure.source.timestamp === undefined ? {} : { timestamp: failure.source.timestamp }),
        ...(data.task_name === undefined
          ? {}
          : { task: data.task_name }),
        node,
      },
      payload,
    );
  }
  return unfoundNodes;
}

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
  const [artifactDiscovery, mseDiscovery] = await profileStage("combined.discovery", () => Promise.all([
    discoverArtifacts(resolvedPath),
    discoverMseProjects(resolvedPath),
  ]));
  const shouldInspectMla = options.mla !== false
    && artifactDiscovery.artifacts.some((artifact) => artifact.kind === "maa_log");
  const shouldInspectMse = options.mse !== false && mseDiscovery.projects.length > 0;
  const mla = shouldInspectMla ? await inspectMla(resolvedPath, options.mla || {}) : null;
  const failureNodes = shouldInspectMse && mla !== null
    ? [...new Set(mla.evidence
      .filter((item) => item.kind === "mla.failure")
      .map((item) => (item.data as MlaFailureDetails | undefined)?.node_name)
      .filter((item): item is string => item !== undefined))]
    : [];
  const mseOption = options.mse === false ? undefined : options.mse;
  const mseTasks = failureNodes.length > 0 ? failureNodes : mseOption?.tasks;
  const mse = shouldInspectMse ? await inspectMse(resolvedPath, {
    ...(mseOption),
    ...(mseTasks === undefined ? {} : { tasks: mseTasks }),
  }) : null;
  const componentResults = [mla, mse].filter((item) => item !== null);
  const artifacts = profileStageSync("combined.materialization", () =>
    componentResults.length === 0
      ? artifactDiscovery.artifacts
      : mergeArtifacts(componentResults.map((item) => item.artifacts)));
  const mergedEvidence = profileStageSync("combined.materialization", () =>
    mergeEvidence(componentResults.map((item) => item.evidence)));
  const combinedLedger = new EvidenceLedger();
  const combinedWarnings: InspectionWarning[] = [];
  if (mla !== null && mse !== null) {
    const unfoundNodes = profileStageSync("combined.correlation", () =>
      addPipelineReferences(combinedLedger, mla, mse));
    if (unfoundNodes.size > 0) {
      combinedWarnings.push({
        code: "combined.pipeline_reference_missing",
        message: `Runtime failure nodes were not found in the MSE pipeline: ${[...unfoundNodes].sort().join(", ")}.`,
      });
    }
  }
  const evidence = [...mergedEvidence, ...combinedLedger.values()];
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
      ...combinedWarnings,
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
