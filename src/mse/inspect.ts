import path from "node:path";

import {
  EVIDENCE_SCHEMA_VERSION,
  EvidenceLedger,
  artifactId,
  relativePortablePath,
  type Artifact,
  type InspectionResult,
} from "../evidence/index.js";
import { discoverArtifacts } from "../mla/discovery.js";
import { profileStage, profileStageSync } from "../profiling.js";
import { discoverMseProjects } from "./discovery.js";
import {
  runMseProjectPreflight,
  runMseTaskResolution,
  type MseProjectPreflightResult,
  type MseSyntaxMode,
  type MseTaskResolutionResult,
} from "./engine.js";
import { buildMseGraph, type MseGraph } from "./graph.js";
import { addMseResolutionEvidence, mseSourceFor } from "./evidence.js";
import { MAX_MSE_SELECTED_TASKS, normalizeMseTasks } from "./selection.js";


export type MseInspectOptions = {
  syntaxMode?: MseSyntaxMode;
  tasks?: string[];
  controller?: string;
  resource?: string;
  depth?: number;
  includeReferencers?: boolean;
};

export type MseProjectInspection = {
  projectRoot: string;
  preflight: MseProjectPreflightResult;
  resolution: MseTaskResolutionResult | null;
  graph: MseGraph;
};

export type MseInspectionDetails = {
  projects: MseProjectInspection[];
  selection: {
    syntaxMode: MseSyntaxMode;
    requestedTasks: string[];
    includeReferencers: boolean;
    depth?: number;
  };
};

export type MseInspectionResult = InspectionResult<MseInspectionDetails> & { kind: "mse" };

function scopeArtifacts(
  artifacts: readonly Artifact[],
  projectRoot: string,
  inputRoot: string,
): Artifact[] {
  return artifacts.map((item) => {
    const absolute = path.resolve(projectRoot, item.relativePath);
    const relativePath = relativePortablePath(inputRoot, absolute);
    return { ...item, id: artifactId(relativePath), path: absolute, relativePath };
  });
}

function addProjectEvidence(
  ledger: EvidenceLedger,
  artifacts: Artifact[],
  inputRoot: string,
  project: MseProjectInspection,
): void {
  const { preflight, resolution, projectRoot } = project;
  if (preflight.interface_path !== null) {
    ledger.add(
      "mse.interface",
      `MSE loaded ${preflight.interface_path} with ${preflight.compatibility.status} compatibility.`,
      mseSourceFor(artifacts, inputRoot, projectRoot, preflight.interface_path),
      {
        compatibility: preflight.compatibility,
        controllers: preflight.controllers,
        resources: preflight.resources,
      },
    );
  }
  for (const binding of preflight.task_bindings) {
    if (preflight.interface_path === null) continue;
    ledger.add(
      "mse.task_binding",
      binding.entry === null
        ? `Interface task ${binding.name} has no resolved entry.`
        : `Interface task ${binding.name} enters pipeline task ${binding.entry}.`,
      mseSourceFor(artifacts, inputRoot, projectRoot, preflight.interface_path, undefined, binding.entry ?? binding.name),
      binding,
    );
  }
  for (const diagnostic of preflight.diagnostics) {
    ledger.add(
      "mse.diagnostic",
      `MSE ${diagnostic.level}: ${diagnostic.message}`,
      mseSourceFor(
        artifacts,
        inputRoot,
        projectRoot,
        diagnostic.source_path,
        diagnostic.line,
      ),
      diagnostic,
    );
  }
  if (resolution !== null) {
    addMseResolutionEvidence(ledger, artifacts, inputRoot, projectRoot, resolution);
  }
}

export async function inspectMse(
  inputPath: string,
  options: MseInspectOptions = {},
): Promise<MseInspectionResult> {
  const resolvedPath = path.resolve(inputPath);
  const inputRoot = resolvedPath;
  const syntaxMode = options.syntaxMode ?? "maafw";
  const requestedTasks = normalizeMseTasks(options.tasks);
  const discovery = await profileStage("mse.discovery", () => discoverMseProjects(resolvedPath));
  const projects: MseProjectInspection[] = [];
  const artifacts: Artifact[] = [];
  const missingEvidence = [];
  const warnings = [...discovery.warnings];
  for (const candidate of discovery.projects) {
    const selectedTasks = requestedTasks.slice(0, MAX_MSE_SELECTED_TASKS);
    if (requestedTasks.length > MAX_MSE_SELECTED_TASKS) {
      warnings.push({
        code: "mse_task_resolution_truncated",
        message: `MSE graph resolution is limited to the first ${MAX_MSE_SELECTED_TASKS} selected task names.`,
      });
    }
    // Artifact inventory, Interface diagnostics, and an explicitly requested task
    // resolution are independent read-only operations. Run them together so a
    // focused graph does not pay for two sequential full-project loads.
    const [artifactDiscovery, preflight, resolution] = await Promise.all([
      profileStage("mse.artifact_discovery", () => discoverArtifacts(candidate.projectRoot)),
      profileStage("mse.preflight", () => runMseProjectPreflight(candidate.projectRoot, syntaxMode)),
      selectedTasks.length === 0
        ? Promise.resolve(null)
        : profileStage("mse.resolution", () => runMseTaskResolution(
          candidate.projectRoot,
          selectedTasks,
          syntaxMode,
          options.controller,
          options.resource,
          options.depth,
          options.includeReferencers ?? true,
        )),
    ]);
    artifacts.push(...scopeArtifacts(artifactDiscovery.artifacts, candidate.projectRoot, inputRoot));
    missingEvidence.push(...artifactDiscovery.missingEvidence);
    warnings.push(...artifactDiscovery.warnings);
    projects.push({
      projectRoot: candidate.projectRoot,
      preflight,
      resolution,
      graph: resolution === null
        ? { nodes: [], edges: [] }
        : profileStageSync("mse.graph", () => buildMseGraph(resolution)),
    });
  }
  if (projects.length === 0) {
    missingEvidence.push({
      code: "mse_project_missing",
      message: "No conventional interface.json or assets/interface.json was found.",
      path: resolvedPath,
    });
  }
  const uniqueArtifacts = new Map(artifacts.map((artifact) => [artifact.id, artifact]));
  const materializedArtifacts = [...uniqueArtifacts.values()];
  const ledger = new EvidenceLedger();
  for (const project of projects) {
    profileStageSync("mse.evidence_materialization", () =>
      addProjectEvidence(ledger, materializedArtifacts, inputRoot, project));
    for (const message of project.preflight.warnings) {
      warnings.push({ code: "mse_warning", message });
    }
    for (const message of project.resolution?.warnings ?? []) {
      warnings.push({ code: "mse_warning", message });
    }
  }
  const evidence = ledger.values();
  const selectedIds = new Set(evidence.map((item) => item.source.artifactId));
  const finalArtifacts = materializedArtifacts.map((artifact) =>
    selectedIds.has(artifact.id)
      ? { ...artifact, status: "selected" as const, reason: undefined }
      : artifact,
  ).map(({ reason, ...artifact }) => reason === undefined ? artifact : { ...artifact, reason });
  return {
    schemaVersion: EVIDENCE_SCHEMA_VERSION,
    kind: "mse",
    generatedAt: new Date().toISOString(),
    input: { path: resolvedPath },
    artifacts: finalArtifacts,
    evidence,
    missingEvidence,
    warnings,
    statistics: {
      projects: projects.length,
      configurations: projects.reduce((total, project) => total + project.preflight.configurations.length, 0),
      diagnostics: projects.reduce((total, project) => total + project.preflight.diagnostics.length, 0),
      graphNodes: projects.reduce((total, project) => total + project.graph.nodes.length, 0),
      graphEdges: projects.reduce((total, project) => total + project.graph.edges.length, 0),
      evidence: evidence.length,
    },
    details: {
      projects,
      selection: {
        syntaxMode,
        requestedTasks,
        includeReferencers: options.includeReferencers ?? true,
        ...(options.depth === undefined ? {} : { depth: options.depth }),
      },
    },
  };
}
