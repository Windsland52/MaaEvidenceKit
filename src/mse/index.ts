export { discoverMseProjects, type MseProjectCandidate, type MseProjectDiscovery } from "./discovery.js";
export {
  MATERIALIZATION_KEEP_NEWEST,
  MATERIALIZATION_MAX_AGE_MS,
  materializeGitRef,
  pruneGitRefMaterializations,
  type GitSourceMaterialization,
} from "./git-source.js";
export type {
  MseCompatibility,
  MseConfigurationSummary,
  MseDiagnostic,
  MseProjectPreflightResult,
  MseResolvedTask,
  MseSyntaxMode,
  MseTaskBinding,
  MseTaskDefinition,
  MseTaskReference,
  MseTaskResolutionResult,
} from "./engine.js";
export { buildMseGraph, type MseGraph, type MseGraphEdge, type MseGraphNode } from "./graph.js";
export {
  inspectMse,
  type MseInspectOptions,
  type MseInspectionDetails,
  type MseInspectionResult,
  type MseProjectInspection,
} from "./inspect.js";
export {
  resolveMse,
  type MseResolveOptions,
  type MseResolutionInspectionDetails,
  type MseResolutionInspectionResult,
  type MseResolvedProjectInspection,
} from "./resolve.js";
