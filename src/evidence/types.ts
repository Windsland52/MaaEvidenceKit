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

/**
 * How much of one sampling dimension an inspection kept, and which strategy produced the selection.
 * `downgraded` is exactly `selected < total`; both are recorded so a reader never has to infer the
 * flag from the counters, and a test keeps the pair consistent.
 */
export type SignalsCompleteness = {
  mode: "complete" | "focused";
  selected: number;
  total: number;
  downgraded: boolean;
};

export type ActionDetailsCompleteness = {
  mode: "complete" | "sampled";
  selected: number;
  total: number;
  downgraded: boolean;
};

export type PipelineOverridesCompleteness = {
  mode: "complete" | "prioritized";
  selected: number;
  total: number;
  downgraded: boolean;
};

export type FieldTruncationField = {
  field: string;
  total: number;
  truncatedTrue: number;
};

/**
 * Bounded aggregate of record-level `*Truncated` booleans. It counts occurrences of data fields
 * whose name ends in `Truncated`; it never lists record paths, and `byField` is capped so the block
 * cannot grow with the report.
 */
export type FieldTruncationCompleteness = {
  any: boolean;
  total: number;
  byField: FieldTruncationField[];
  omitted: number;
};

/**
 * How complete this inspection is on every dimension that can be sampled or truncated. Present only
 * when MLA participated; `mse`, `repo_docs`, and a combined inspection with `--no-mla` omit the
 * block rather than reporting empty dimensions.
 */
export type Completeness = {
  signals: SignalsCompleteness;
  actionDetails: ActionDetailsCompleteness;
  pipelineOverrides: PipelineOverridesCompleteness;
  fieldTruncation: FieldTruncationCompleteness;
  anyDowngraded: boolean;
};

export type MissingEvidence = {
  code: string;
  message: string;
  path?: string;
};

export type ReportReductionStep = {
  /** Ladder step: a `details.*` block id or `evidence:<kind>`. */
  id: string;
  /** Entries removed by this step: evidence records, or elements of a details array. */
  removedItems: number;
  /** UTF-8 bytes this step removed from the rendered (2-space) JSON document. */
  removedBytes: number;
};

/**
 * Present only when an inspection was reduced to fit `--max-report-bytes`; an unreduced report has
 * no `reduction` key at all, so adding the budget feature never changes an unrequested report's
 * bytes. Reduction removes whole entries in a fixed ladder and never rewrites a record, so every ID
 * that remains still resolves to the same content.
 */
export type ReportReduction = {
  /** Budget the caller requested, in UTF-8 bytes of the 2-space JSON document. */
  maxBytes: number;
  /** Measured size of the reduced document that was written. */
  actualBytes: number;
  /** True when the never-removable protected set alone exceeds the budget; the document is emitted. */
  budgetUnsatisfied?: boolean;
  steps: ReportReductionStep[];
  dropped: { items: number; bytes: number };
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
  /**
   * Sampling and field-truncation completeness. Optional so reports written before the block
   * existed stay readable; MLA inspections emit it, and a reader that needs to know whether
   * evidence was sampled must read it instead of inferring from the counts.
   */
  completeness?: Completeness;
  /**
   * Present only when the report was reduced to a requested byte budget. Absent on every report
   * produced without `--max-report-bytes`, which keeps those documents byte-identical.
   */
  reduction?: ReportReduction;
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
