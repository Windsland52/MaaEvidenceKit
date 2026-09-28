export const EVIDENCE_SCHEMA_VERSION = "maa-evidence/v1" as const;

export type InspectionKind = "mla" | "mse" | "combined" | "repo_docs";

export type TimeRange = {
  from?: string;
  to?: string;
};

export type EvidenceSource = {
  artifactId: string;
  path: string;
  line?: number;
  endLine?: number;
  timestamp?: string;
  task?: string;
  node?: string;
};

export type Evidence<T = unknown> = {
  id: string;
  kind: string;
  summary: string;
  source: EvidenceSource;
  data: T;
};

export type ArtifactKind =
  | "maa_log"
  | "log"
  | "image"
  | "interface"
  | "pipeline"
  | "archive_part"
  | "directory"
  | "other";

export type ArtifactStatus = "selected" | "available" | "skipped" | "unreadable";

export type Artifact = {
  id: string;
  path: string;
  relativePath: string;
  kind: ArtifactKind;
  status: ArtifactStatus;
  sizeBytes?: number;
  /**
   * Streaming digest of the artifact's bytes, present only when the artifact was read for digest
   * accounting. This is a deterministic equality fact about content and carries no semantic claim;
   * artifacts larger than the digest cap stay without a value rather than being assumed distinct.
   */
  contentDigest?: string;
  /**
   * Why a content digest is absent: the bytes could not be read, the file is empty, or the file
   * exceeds the digest cap. A missing digest is never reported as equality or existence; absent
   * together with `contentDigest` on records produced before digest accounting covered every
   * artifact, which a manifest view reports as a missing digest.
   */
  digestStatus?: "unreadable" | "empty" | "too_large";
  reason?: string;
};

/**
 * Structural coverage annotation over one inspection's artifact records.
 *
 * `readForRuntimeFacts` counts artifacts with kind `maa_log` and status `selected` — the records
 * whose bytes were read for runtime facts. It is deliberately structural (derived from kind and
 * status alone, never from evidence) so it cannot disagree with the artifact list it annotates.
 * `byStatus` preserves the report's own `ArtifactStatus` vocabulary untouched; the two never merge
 * or rewrite each other.
 */
export type CoverageRotations = {
  /** Distinct rotation families among the discovered MaaFramework logs. */
  families: number;
  /** Artifact records that belong to a rotation family. */
  members: number;
  /** Family members whose name carries a rotation timestamp. */
  timestampedMembers: number;
  /** Family members whose status is `selected`. */
  readMembers: number;
};

export type CoverageAnnotation = {
  artifacts: number;
  readForRuntimeFacts: number;
  /** Every artifact record that was not read for runtime facts. */
  notRead: number;
  byKind: Record<string, number>;
  byStatus: Record<string, number>;
  rotations: CoverageRotations;
  /**
   * The label of the rotation family that sits at the top of the inspection: the name of the directory
   * the relative paths were taken against, which is the inspected directory itself or an inspected
   * file's parent. Recorded as a name rather than a path because it is the only thing a consumer needs
   * to re-derive the same labels from a report, and because an absolute machine path does not belong
   * in a document whose rows are portable.
   */
  rotationFamilyLabel: string;
};

export type MissingEvidence = {
  code: string;
  message: string;
  path?: string;
};

export type InspectionWarning = {
  code: string;
  message: string;
};

export type InspectionInput = {
  path: string;
  timeRange?: TimeRange;
};

export type InspectionResult<TDetails = unknown> = {
  schemaVersion: typeof EVIDENCE_SCHEMA_VERSION;
  kind: InspectionKind;
  generatedAt: string;
  input: InspectionInput;
  artifacts: Artifact[];
  evidence: Evidence[];
  missingEvidence: MissingEvidence[];
  warnings: InspectionWarning[];
  statistics: Record<string, number>;
  /**
   * Structural coverage annotation over `artifacts`, attached by inspections that assemble
   * artifacts. Optional so reports written before the annotation existed stay readable; a manifest
   * view re-derives the counts and refuses a report whose stored annotation disagrees with its
   * artifact records.
   */
  coverage?: CoverageAnnotation;
  details: TDetails;
};

export function isInspectionResult(value: unknown): value is InspectionResult {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return (
    record["schemaVersion"] === EVIDENCE_SCHEMA_VERSION
    && ["mla", "mse", "combined", "repo_docs"].includes(String(record["kind"]))
    && Array.isArray(record["artifacts"])
    && Array.isArray(record["evidence"])
    && Array.isArray(record["missingEvidence"])
    && Array.isArray(record["warnings"])
    && typeof record["details"] === "object"
    && record["details"] !== null
  );
}
