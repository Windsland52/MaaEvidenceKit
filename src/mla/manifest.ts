import {
  EVIDENCE_SCHEMA_VERSION,
  validateTimeRange,
  type InspectionResult,
  type TimeRange,
} from "../evidence/index.js";
import { coverageAnnotation } from "../evidence/coverage.js";
import { profileStage } from "../profiling.js";
import { applyDigestResults, digestArtifacts } from "./content-digest.js";
import { discoverArtifacts, resolveInspectionInput } from "./discovery.js";

/**
 * Discovery-state inspection: inventory, classify, and digest a corpus without selecting targets,
 * loading logs, or materializing evidence.
 *
 * This is the cost contract behind `mla inspect <dir> --format manifest`: a harness reads the
 * coverage manifest first and then decides whether to pay for parsing. The returned record is an
 * ordinary `maa-evidence/v1` inspection of kind `mla` whose evidence ledger is empty and whose
 * `details.extraction` says `not-run`, so a saved copy stays consumable by `view` — including
 * `view --format manifest`, which re-renders the same manifest without touching the corpus again.
 */
export type MlaManifestInspectionOptions = {
  timeRange?: TimeRange;
};

export type MlaManifestDetails = {
  extraction: "not-run";
};

export type MlaManifestInspectionResult = InspectionResult<MlaManifestDetails> & { kind: "mla" };

export async function inspectMlaManifest(
  inputPath: string,
  options: MlaManifestInspectionOptions = {},
): Promise<MlaManifestInspectionResult> {
  validateTimeRange(options.timeRange);
  const { resolvedPath } = await resolveInspectionInput(inputPath);
  const discovery = await profileStage("mla.discovery", () => discoverArtifacts(resolvedPath));
  const digestResults = await profileStage("mla.content_digest", () => digestArtifacts(discovery.artifacts));
  const artifacts = applyDigestResults(discovery.artifacts, digestResults);
  const missingEvidence = [...discovery.missingEvidence];
  if (discovery.omittedOtherFileCount > 0) {
    missingEvidence.push({
      code: "unsupported_files_not_parsed",
      message: `${discovery.omittedOtherFileCount} file(s) were not classified or parsed.`
        + " MEK does not infer the meaning of unsupported material: read these files directly if the question may depend on them.",
      path: resolvedPath,
    });
  }
  for (const artifact of artifacts) {
    if (artifact.digestStatus === undefined) continue;
    missingEvidence.push({
      code: "artifact_content_digest_unavailable",
      message: `Content digest is unavailable for this artifact (${artifact.digestStatus});`
        + " the manifest cannot claim byte equality for it.",
      path: artifact.path,
    });
  }
  return {
    schemaVersion: EVIDENCE_SCHEMA_VERSION,
    kind: "mla",
    generatedAt: new Date().toISOString(),
    input: {
      path: resolvedPath,
      ...(options.timeRange === undefined ? {} : { timeRange: options.timeRange }),
    },
    artifacts,
    evidence: [],
    missingEvidence,
    warnings: discovery.warnings,
    statistics: {
      scannedFiles: discovery.scannedFileCount,
      omittedUnsupportedFiles: discovery.omittedOtherFileCount,
      reportedOmittedUnsupportedFiles: discovery.omittedUnsupportedFiles.length,
      selectedArtifacts: 0,
      artifacts: artifacts.length,
      artifactContentDigests: artifacts.filter((artifact) => artifact.contentDigest !== undefined).length,
    },
    coverage: coverageAnnotation(artifacts, resolvedPath),
    details: { extraction: "not-run" },
  };
}
