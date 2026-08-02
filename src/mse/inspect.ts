import path from "node:path";

import {
  EVIDENCE_SCHEMA_VERSION,
  EvidenceLedger,
  artifactId,
  relativePortablePath,
  type Artifact,
  type EvidenceSource,
  type InspectionResult,
} from "../evidence/index.js";
import { discoverArtifacts } from "../mla/discovery.js";
import { discoverMseProjects } from "./discovery.js";
import {
  runMseProjectPreflight,
  runMseTaskResolution,
  type MseProjectPreflightResult,
  type MseSyntaxMode,
  type MseTaskResolutionResult,
} from "./engine.js";
import { buildMseGraph, type MseGraph } from "./graph.js";

const MAX_RESOLVED_TASKS = 500;

export type MseInspectOptions = {
  syntaxMode?: MseSyntaxMode;
  tasks?: string[];
  controller?: string;
  resource?: string;
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
  };
};

export type MseInspectionResult = InspectionResult<MseInspectionDetails> & { kind: "mse" };

function normalizeTasks(tasks: string[] | undefined): string[] {
  if (tasks === undefined) return [];
  return [...new Set(tasks.map((item) => item.trim()).filter(Boolean))].sort();
}

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

function sourceFor(
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
      sourceFor(artifacts, inputRoot, projectRoot, preflight.interface_path),
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
      sourceFor(artifacts, inputRoot, projectRoot, preflight.interface_path, undefined, binding.entry ?? binding.name),
      binding,
    );
  }
  for (const diagnostic of preflight.diagnostics) {
    ledger.add(
      "mse.diagnostic",
      `MSE ${diagnostic.level}: ${diagnostic.message}`,
      sourceFor(
        artifacts,
        inputRoot,
        projectRoot,
        diagnostic.source_path,
        diagnostic.line,
      ),
      diagnostic,
    );
  }
  if (resolution === null) return;
  for (const task of resolution.resolutions) {
    for (const definition of task.definitions) {
      ledger.add(
        "mse.task_definition",
        `Pipeline task ${task.name} is defined for controller ${task.controller ?? "default"} and resource ${task.resource ?? "default"}.`,
        sourceFor(artifacts, inputRoot, projectRoot, definition.source_path, definition.line, task.name),
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
        sourceFor(artifacts, inputRoot, projectRoot, reference.source_path, reference.line, task.name),
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

export async function inspectMse(
  inputPath: string,
  options: MseInspectOptions = {},
): Promise<MseInspectionResult> {
  const resolvedPath = path.resolve(inputPath);
  const inputRoot = resolvedPath;
  const syntaxMode = options.syntaxMode ?? "maafw";
  const requestedTasks = normalizeTasks(options.tasks);
  const discovery = await discoverMseProjects(resolvedPath);
  const projects: MseProjectInspection[] = [];
  const artifacts: Artifact[] = [];
  const missingEvidence = [];
  const warnings = [...discovery.warnings];
  for (const candidate of discovery.projects) {
    const artifactDiscovery = await discoverArtifacts(candidate.projectRoot);
    artifacts.push(...scopeArtifacts(artifactDiscovery.artifacts, candidate.projectRoot, inputRoot));
    missingEvidence.push(...artifactDiscovery.missingEvidence);
    warnings.push(...artifactDiscovery.warnings);
    const preflight = await runMseProjectPreflight(candidate.projectRoot, syntaxMode);
    const selectedTasks = (requestedTasks.length > 0 ? requestedTasks : preflight.task_names)
      .slice(0, MAX_RESOLVED_TASKS);
    if (requestedTasks.length === 0 && preflight.task_names.length > MAX_RESOLVED_TASKS) {
      warnings.push({
        code: "mse_task_resolution_truncated",
        message: `MSE graph resolution is limited to ${MAX_RESOLVED_TASKS} task names.`,
      });
    }
    const resolution = selectedTasks.length === 0
      ? null
      : await runMseTaskResolution(
        candidate.projectRoot,
        selectedTasks,
        syntaxMode,
        options.controller,
        options.resource,
      );
    projects.push({
      projectRoot: candidate.projectRoot,
      preflight,
      resolution,
      graph: resolution === null ? { nodes: [], edges: [] } : buildMseGraph(resolution),
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
    addProjectEvidence(ledger, materializedArtifacts, inputRoot, project);
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
      selection: { syntaxMode, requestedTasks },
    },
  };
}
