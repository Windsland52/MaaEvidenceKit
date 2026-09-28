import { deriveRotationCoverage } from "./rotation.js";
import type { Artifact, CoverageAnnotation } from "./types.js";

const STATUS_ORDER: readonly Artifact["status"][] = ["selected", "available", "skipped", "unreadable"];

/**
 * Derive the structural coverage annotation for one inspection's artifact records.
 *
 * The derivation is a pure function of the artifact list, so the annotation on a report and the
 * artifact records it annotates cannot disagree within one inspection: both come from the same
 * assembly. Counts are bounded by the kind and status vocabularies, so the annotation stays small
 * no matter how many files a directory holds.
 *
 * `rootPath` labels the rotation family that lives in the inspected root itself. It is optional
 * because a caller with only a report in hand has no corpus path; the manifest view re-derives its
 * counts from the same function so the two entry points cannot drift.
 */
export function coverageAnnotation(artifacts: readonly Artifact[], rootPath = ""): CoverageAnnotation {
  const kinds: Record<string, number> = {};
  const statuses = new Map<Artifact["status"], number>();
  let readForRuntimeFacts = 0;
  for (const artifact of artifacts) {
    kinds[artifact.kind] = (kinds[artifact.kind] ?? 0) + 1;
    statuses.set(artifact.status, (statuses.get(artifact.status) ?? 0) + 1);
    if (artifact.kind === "maa_log" && artifact.status === "selected") readForRuntimeFacts += 1;
  }
  const rotations = deriveRotationCoverage(artifacts, rootPath);
  let timestampedMembers = 0;
  let readMembers = 0;
  const families = new Set<string>();
  const statusByPath = new Map(artifacts.map((artifact) => [artifact.relativePath, artifact.status] as const));
  for (const [relativePath, info] of rotations) {
    families.add(info.rotation.family);
    if (info.timeCoverage.to !== null) timestampedMembers += 1;
    if (statusByPath.get(relativePath) === "selected") readMembers += 1;
  }
  const byKind = Object.fromEntries(Object.entries(kinds).sort(([left], [right]) => left.localeCompare(right)));
  const byStatus = Object.fromEntries(
    STATUS_ORDER.filter((status) => (statuses.get(status) ?? 0) > 0)
      .map((status) => [status, statuses.get(status) as number]),
  );
  return {
    artifacts: artifacts.length,
    readForRuntimeFacts,
    notRead: artifacts.length - readForRuntimeFacts,
    byKind,
    byStatus,
    rotations: {
      families: families.size,
      members: rotations.size,
      timestampedMembers,
      readMembers,
    },
  };
}
