import path from "node:path";

import {
  EVIDENCE_SCHEMA_VERSION,
  EvidenceLedger,
  relativePortablePath,
  type Artifact,
  type Evidence,
  type InspectionResult,
  type InspectionWarning,
} from "./evidence/index.js";
import { discoverArtifacts, inspectMla, type MlaInspectOptions, type MlaInspectionResult } from "./mla/index.js";
import {
  discoverMseProjects,
  inspectMse,
  type MseInspectOptions,
  type MseInspectionResult,
  type MseResolvedTask,
} from "./mse/index.js";
import { profileStage, profileStageSync } from "./profiling.js";

const MAX_COMBINED_RUNTIME_MSE_NODES = 128;

export type InspectOptions = {
  mla?: MlaInspectOptions | false;
  mse?: MseInspectOptions | false;
};

export type CombinedInspectionDetails = {
  mla: MlaInspectionResult | null;
  mse: MseInspectionResult | null;
  correlation: {
    runtimeNodes: {
      total: number;
      selected: number;
      omitted: number;
      failureNodes: number;
      recognitionOnlyNodes: number;
    };
  };
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
  staticResolutionStatus: StaticResolutionStatus;
  incompleteReasons: string[];
};

type MlaFailureDetails = {
  node_name?: string;
  task_name?: string;
  failure_id?: string;
};

type MlaRecognitionDetails = {
  algorithm?: string;
  node?: string;
  occurrenceCount?: number;
  status?: "succeeded" | "failed";
};

type RuntimeMseNodeSelection = {
  tasks: string[];
  total: number;
  selected: number;
  omitted: number;
  failureNodes: number;
  recognitionOnlyNodes: number;
};

type RecognitionPipelineConfiguration = {
  controller: string | null;
  resource: string | null;
  recognition: unknown | null;
  customRecognition: unknown | null;
  definitions: PipelineDefinitionEvidence[];
  definitionEvidenceIds: string[];
  definitionLinksComplete: boolean;
};

type RecognitionPipelineReferenceEvidenceData = {
  recognitionEvidenceId: string;
  node: string;
  algorithm: string;
  status: "succeeded" | "failed";
  occurrenceCount: number;
  pipelineFound: boolean;
  pipelineControllers: string[];
  pipelineResources: string[];
  staticConfigurations: RecognitionPipelineConfiguration[];
  staticResolutionStatus: StaticResolutionStatus;
  incompleteReasons: string[];
};

type StaticResolutionStatus = "found" | "found_partial" | "not_found" | "incomplete";

type CorrelationResolutionIssues = {
  notFoundNodes: Set<string>;
  incompleteNodes: Set<string>;
};

type MseTaskDefinitionDetails = {
  name?: string;
  controller?: string | null;
  resource?: string | null;
};

type ResolvedTaskConfiguration = {
  projectRoot: string;
  task: MseResolvedTask;
};

function taskDefinitionEvidenceKey(
  name: string,
  controller: string | null,
  resource: string | null,
  sourcePath: string,
  line: number,
): string {
  return JSON.stringify([name, controller, resource, sourcePath, line]);
}

function mseStaticResolutionIncompleteReasons(mse: MseInspectionResult): string[] {
  const reasons = new Set<string>();
  if (mse.details.projects.some((project) => project.resolution?.configurations_truncated === true)) {
    reasons.add("controller_resource_configurations_truncated");
  }
  for (const warning of mse.warnings) {
    if (warning.code === "mse_project_scan_truncated" || warning.code === "mse_project_list_truncated") {
      reasons.add(warning.code);
    }
    if (warning.code === "mse_task_resolution_truncated") {
      reasons.add("mse_task_resolution_truncated");
    }
  }
  return [...reasons].sort();
}

function staticResolutionStatus(found: boolean, incompleteReasons: readonly string[]): StaticResolutionStatus {
  if (found) return incompleteReasons.length === 0 ? "found" : "found_partial";
  return incompleteReasons.length === 0 ? "not_found" : "incomplete";
}

function selectRuntimeNodesForMse(mla: MlaInspectionResult | null): RuntimeMseNodeSelection {
  if (mla === null) {
    return { tasks: [], total: 0, selected: 0, omitted: 0, failureNodes: 0, recognitionOnlyNodes: 0 };
  }
  const failures = new Set<string>();
  const recognitions = new Map<string, { failedOccurrences: number; occurrenceCount: number }>();
  for (const item of mla.evidence) {
    if (item.kind === "mla.failure") {
      const node = (item.data as MlaFailureDetails | undefined)?.node_name;
      if (node !== undefined) failures.add(node);
      continue;
    }
    if (item.kind !== "mla.recognition_detail") continue;
    const data = item.data as MlaRecognitionDetails | undefined;
    if (data?.node === undefined) continue;
    const current = recognitions.get(data.node) ?? { failedOccurrences: 0, occurrenceCount: 0 };
    current.occurrenceCount += data.occurrenceCount ?? 0;
    if (data.status === "failed") current.failedOccurrences += data.occurrenceCount ?? 0;
    recognitions.set(data.node, current);
  }
  const recognitionNodes = [...recognitions.entries()]
    .filter(([node]) => !failures.has(node))
    .sort(([leftNode, left], [rightNode, right]) =>
      right.failedOccurrences - left.failedOccurrences
      || right.occurrenceCount - left.occurrenceCount
      || leftNode.localeCompare(rightNode),
    )
    .map(([node]) => node);
  const candidates = [...failures].sort((left, right) => left.localeCompare(right)).concat(recognitionNodes);
  const tasks = candidates.slice(0, MAX_COMBINED_RUNTIME_MSE_NODES);
  return {
    tasks,
    total: candidates.length,
    selected: tasks.length,
    omitted: candidates.length - tasks.length,
    failureNodes: failures.size,
    recognitionOnlyNodes: recognitionNodes.length,
  };
}

function pipelineDefinitions(task: MseResolvedTask): PipelineDefinitionEvidence[] {
  return task.definitions.map((definition) => ({
    sourcePath: definition.source_path,
    line: definition.line,
    column: definition.column,
    controller: task.controller,
    resource: task.resource,
  }));
}

function addPipelineReferences(
  ledger: EvidenceLedger,
  mla: MlaInspectionResult,
  mse: MseInspectionResult,
  selectedRuntimeNodes: ReadonlySet<string>,
  staticIncompleteReasons: readonly string[],
): CorrelationResolutionIssues {
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
  const notFoundNodes = new Set<string>();
  const incompleteNodes = new Set<string>();
  for (const failure of mla.evidence) {
    if (failure.kind !== "mla.failure") continue;
    const data = failure.data as MlaFailureDetails | undefined;
    const node = data?.node_name;
    if (node === undefined || data === undefined) continue;
    if (!selectedRuntimeNodes.has(node)) continue;
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
    const resolutionStatus = staticResolutionStatus(pipelineFound, staticIncompleteReasons);
    if (resolutionStatus === "not_found") notFoundNodes.add(node);
    if (resolutionStatus === "incomplete" || resolutionStatus === "found_partial") incompleteNodes.add(node);
    const payload: PipelineReferenceEvidenceData = {
      failureId: data.failure_id ?? failure.id,
      failureKind: failure.kind,
      node,
      task: data.task_name ?? "",
      pipelineFound,
      pipelineControllers: controllers,
      pipelineResources: resources,
      pipelineDefinitions,
      staticResolutionStatus: resolutionStatus,
      incompleteReasons: [...staticIncompleteReasons],
    };
    ledger.add(
      "combined.pipeline_reference",
      resolutionStatus === "incomplete"
        ? `Failure node ${node} could not be conclusively resolved in the incomplete MSE static scope.`
        : pipelineFound
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
  return { notFoundNodes, incompleteNodes };
}

function addRecognitionPipelineReferences(
  ledger: EvidenceLedger,
  mla: MlaInspectionResult,
  mse: MseInspectionResult,
  selectedRuntimeNodes: ReadonlySet<string>,
  staticIncompleteReasons: readonly string[],
): CorrelationResolutionIssues {
  const definitionEvidenceIds = new Map<string, string[]>();
  for (const evidence of mse.evidence) {
    if (evidence.kind !== "mse.task_definition") continue;
    const data = evidence.data as MseTaskDefinitionDetails | undefined;
    if (
      data?.name === undefined
      || data.controller === undefined
      || data.resource === undefined
      || evidence.source.line === undefined
    ) continue;
    const key = taskDefinitionEvidenceKey(
      data.name,
      data.controller,
      data.resource,
      evidence.source.path,
      evidence.source.line,
    );
    const ids = definitionEvidenceIds.get(key) ?? [];
    ids.push(evidence.id);
    definitionEvidenceIds.set(key, ids);
  }
  const configurationsByNode = new Map<string, ResolvedTaskConfiguration[]>();
  for (const project of mse.details.projects) {
    for (const task of project.resolution?.resolutions ?? []) {
      const configurations = configurationsByNode.get(task.name) ?? [];
      configurations.push({ projectRoot: project.projectRoot, task });
      configurationsByNode.set(task.name, configurations);
    }
  }
  const notFoundNodes = new Set<string>();
  const incompleteNodes = new Set<string>();
  for (const recognition of mla.evidence) {
    if (recognition.kind !== "mla.recognition_detail") continue;
    const data = recognition.data as MlaRecognitionDetails | undefined;
    if (
      data?.node === undefined
      || data.algorithm === undefined
      || data.status === undefined
      || data.occurrenceCount === undefined
    ) continue;
    if (!selectedRuntimeNodes.has(data.node)) continue;
    const configurations = (configurationsByNode.get(data.node) ?? []).filter((item) => item.task.found);
    const pipelineFound = configurations.length > 0;
    const staticConfigurations = configurations.map(({ projectRoot, task }) => {
      const definitionIds = task.definitions.map((definition) =>
        definitionEvidenceIds.get(taskDefinitionEvidenceKey(
          task.name,
          task.controller,
          task.resource,
          relativePortablePath(mse.input.path, path.resolve(projectRoot, definition.source_path)),
          definition.line,
        )) ?? []
      );
      return {
        controller: task.controller,
        resource: task.resource,
        recognition: task.effective_config["recognition"] ?? null,
        customRecognition: task.effective_config["custom_recognition"] ?? null,
        definitions: pipelineDefinitions(task),
        definitionEvidenceIds: [...new Set(definitionIds.flat())].sort(),
        definitionLinksComplete: definitionIds.every((ids) => ids.length > 0),
      };
    }).sort((left, right) =>
      [left.controller ?? "", left.resource ?? "", JSON.stringify(left.definitionEvidenceIds)]
        .join("|")
        .localeCompare([right.controller ?? "", right.resource ?? "", JSON.stringify(right.definitionEvidenceIds)].join("|")),
    );
    const incompleteReasons = [...staticIncompleteReasons];
    if (staticConfigurations.some((configuration) => !configuration.definitionLinksComplete)) {
      incompleteReasons.push("definition_evidence_link_missing");
    }
    const resolutionStatus = staticResolutionStatus(pipelineFound, incompleteReasons);
    if (resolutionStatus === "not_found") notFoundNodes.add(data.node);
    if (resolutionStatus === "incomplete" || resolutionStatus === "found_partial") {
      incompleteNodes.add(data.node);
    }
    const payload: RecognitionPipelineReferenceEvidenceData = {
      recognitionEvidenceId: recognition.id,
      node: data.node,
      algorithm: data.algorithm,
      status: data.status,
      occurrenceCount: data.occurrenceCount,
      pipelineFound,
      pipelineControllers: [...new Set(configurations.map((item) => item.task.controller)
        .filter((item): item is string => item !== null))].sort(),
      pipelineResources: [...new Set(configurations.map((item) => item.task.resource)
        .filter((item): item is string => item !== null))].sort(),
      staticConfigurations,
      staticResolutionStatus: resolutionStatus,
      incompleteReasons,
    };
    ledger.add(
      "combined.recognition_pipeline_reference",
      resolutionStatus === "incomplete"
        ? `Recognition node ${data.node} (${data.algorithm}, ${data.status}) could not be conclusively resolved in the incomplete MSE static scope.`
        : pipelineFound
        ? `Recognition node ${data.node} (${data.algorithm}, ${data.status}) exists in the MSE pipeline.`
        : `Recognition node ${data.node} (${data.algorithm}, ${data.status}) was not found in the MSE pipeline.`,
      {
        artifactId: recognition.source.artifactId,
        path: recognition.source.path,
        ...(recognition.source.line === undefined ? {} : { line: recognition.source.line }),
        ...(recognition.source.timestamp === undefined ? {} : { timestamp: recognition.source.timestamp }),
        ...(recognition.source.task === undefined ? {} : { task: recognition.source.task }),
        node: data.node,
      },
      payload,
    );
  }
  return { notFoundNodes, incompleteNodes };
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
  const runtimeNodeSelection = shouldInspectMse ? selectRuntimeNodesForMse(mla) : selectRuntimeNodesForMse(null);
  const mseOption = options.mse === false ? undefined : options.mse;
  const mseTasks = runtimeNodeSelection.selected > 0 ? runtimeNodeSelection.tasks : mseOption?.tasks;
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
  if (runtimeNodeSelection.omitted > 0) {
    combinedWarnings.push({
      code: "combined.runtime_node_resolution_truncated",
      message: `Selected ${runtimeNodeSelection.selected} of ${runtimeNodeSelection.total} unique runtime nodes for MSE correlation; failure nodes were prioritized, followed by failed recognition occurrences and total recognition occurrences.`,
    });
  }
  if (mla !== null && mse !== null) {
    const selectedRuntimeNodes = new Set(runtimeNodeSelection.tasks);
    const staticIncompleteReasons = mseStaticResolutionIncompleteReasons(mse);
    const { failureIssues, recognitionIssues } = profileStageSync("combined.correlation", () => ({
      failureIssues: addPipelineReferences(
        combinedLedger,
        mla,
        mse,
        selectedRuntimeNodes,
        staticIncompleteReasons,
      ),
      recognitionIssues: addRecognitionPipelineReferences(
        combinedLedger,
        mla,
        mse,
        selectedRuntimeNodes,
        staticIncompleteReasons,
      ),
    }));
    if (failureIssues.notFoundNodes.size > 0) {
      combinedWarnings.push({
        code: "combined.pipeline_reference_missing",
        message: `Runtime failure nodes were not found in the MSE pipeline: ${[...failureIssues.notFoundNodes].sort().join(", ")}.`,
      });
    }
    if (failureIssues.incompleteNodes.size > 0) {
      combinedWarnings.push({
        code: "combined.pipeline_reference_incomplete",
        message: `Runtime failure-node static resolution was incomplete for: ${[...failureIssues.incompleteNodes].sort().join(", ")}.`,
      });
    }
    if (recognitionIssues.notFoundNodes.size > 0) {
      combinedWarnings.push({
        code: "combined.recognition_pipeline_reference_missing",
        message: `Runtime recognition nodes were not found in the MSE pipeline: ${[...recognitionIssues.notFoundNodes].sort().join(", ")}.`,
      });
    }
    if (recognitionIssues.incompleteNodes.size > 0) {
      combinedWarnings.push({
        code: "combined.recognition_pipeline_reference_incomplete",
        message: `Runtime recognition-node static resolution was incomplete for: ${[...recognitionIssues.incompleteNodes].sort().join(", ")}.`,
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
      mseRuntimeNodes: runtimeNodeSelection.total,
      mseRuntimeNodesSelected: runtimeNodeSelection.selected,
      mseRuntimeNodesOmitted: runtimeNodeSelection.omitted,
    },
    details: {
      mla,
      mse,
      correlation: {
        runtimeNodes: {
          total: runtimeNodeSelection.total,
          selected: runtimeNodeSelection.selected,
          omitted: runtimeNodeSelection.omitted,
          failureNodes: runtimeNodeSelection.failureNodes,
          recognitionOnlyNodes: runtimeNodeSelection.recognitionOnlyNodes,
        },
      },
    },
  };
}
