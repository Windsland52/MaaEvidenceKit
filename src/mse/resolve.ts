import path from "node:path";

import {
  EVIDENCE_SCHEMA_VERSION,
  EvidenceLedger,
  type Artifact,
  type InspectionResult,
  type InspectionWarning,
  type MissingEvidence,
} from "../evidence/index.js";
import { profileStage, profileStageSync } from "../profiling.js";
import { addMseResolutionEvidence } from "./evidence.js";
import { runMseTaskResolution, type MseSyntaxMode, type MseTaskResolutionResult } from "./engine.js";
import { discoverMseProjects } from "./discovery.js";
import { buildMseGraph, type MseGraph } from "./graph.js";
import { MAX_MSE_SELECTED_TASKS, normalizeMseTasks } from "./selection.js";

export type MseResolveOptions = {
  syntaxMode?: MseSyntaxMode;
  tasks: string[];
  controller?: string;
  resource?: string;
  depth?: number;
  includeReferencers?: boolean;
};

export type MseResolvedProjectInspection = {
  projectRoot: string;
  resolution: MseTaskResolutionResult;
  graph: MseGraph;
};

export type MseResolutionInspectionDetails = {
  mode: "resolution";
  projects: MseResolvedProjectInspection[];
  selection: {
    syntaxMode: MseSyntaxMode;
    requestedTasks: string[];
    selectedTasks: string[];
    includeReferencers: boolean;
    controller?: string;
    resource?: string;
    depth?: number;
  };
};

export type MseResolutionInspectionResult = InspectionResult<MseResolutionInspectionDetails> & {
  kind: "mse";
};

export async function resolveMse(
  inputPath: string,
  options: MseResolveOptions,
): Promise<MseResolutionInspectionResult> {
  const resolvedPath = path.resolve(inputPath);
  const syntaxMode = options.syntaxMode ?? "maafw";
  const requestedTasks = normalizeMseTasks(options.tasks);
  if (requestedTasks.length === 0) throw new Error("mse resolve requires at least one task name.");
  const selectedTasks = requestedTasks.slice(0, MAX_MSE_SELECTED_TASKS);
  const discovery = await profileStage("mse.discovery", () => discoverMseProjects(resolvedPath));
  const projects: MseResolvedProjectInspection[] = [];
  const artifacts: Artifact[] = [];
  const ledger = new EvidenceLedger();
  const missingEvidence: MissingEvidence[] = [];
  const warnings: InspectionWarning[] = [...discovery.warnings];
  if (requestedTasks.length > MAX_MSE_SELECTED_TASKS) {
    warnings.push({
      code: "mse_task_resolution_truncated",
      message: `MSE graph resolution is limited to the first ${MAX_MSE_SELECTED_TASKS} selected task names.`,
    });
  }
  for (const candidate of discovery.projects) {
    const resolution = await profileStage("mse.resolution", () => runMseTaskResolution(
      candidate.projectRoot,
      selectedTasks,
      syntaxMode,
      options.controller,
      options.resource,
      options.depth,
      options.includeReferencers ?? true,
    ));
    const graph = profileStageSync("mse.graph", () => buildMseGraph(resolution));
    profileStageSync("mse.evidence_materialization", () =>
      addMseResolutionEvidence(ledger, artifacts, resolvedPath, candidate.projectRoot, resolution));
    projects.push({ projectRoot: candidate.projectRoot, resolution, graph });
    for (const message of resolution.warnings) warnings.push({ code: "mse_warning", message });
    const unresolved = [...new Set(
      resolution.resolutions.filter((task) => !task.found).map((task) => task.name),
    )].sort();
    for (const task of unresolved) {
      missingEvidence.push({
        code: "mse_task_definition_missing",
        message: `MSE did not find a pipeline definition for task ${task} in the selected configuration.`,
        path: candidate.projectRoot,
      });
    }
  }
  if (projects.length === 0) {
    missingEvidence.push({
      code: "mse_project_missing",
      message: "No conventional interface.json or assets/interface.json was found.",
      path: resolvedPath,
    });
  }
  const evidence = ledger.values();
  const configurations = new Set(projects.flatMap((project) =>
    project.resolution.resolutions.map((task) => `${task.controller ?? ""}\0${task.resource ?? ""}`)));
  return {
    schemaVersion: EVIDENCE_SCHEMA_VERSION,
    kind: "mse",
    generatedAt: new Date().toISOString(),
    input: { path: resolvedPath },
    artifacts,
    evidence,
    missingEvidence,
    warnings,
    statistics: {
      projects: projects.length,
      configurations: configurations.size,
      graphNodes: projects.reduce((total, project) => total + project.graph.nodes.length, 0),
      graphEdges: projects.reduce((total, project) => total + project.graph.edges.length, 0),
      evidence: evidence.length,
    },
    details: {
      mode: "resolution",
      projects,
      selection: {
        syntaxMode,
        requestedTasks,
        selectedTasks,
        includeReferencers: options.includeReferencers ?? true,
        ...(options.controller === undefined ? {} : { controller: options.controller }),
        ...(options.resource === undefined ? {} : { resource: options.resource }),
        ...(options.depth === undefined ? {} : { depth: options.depth }),
      },
    },
  };
}
