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
  reason?: string;
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
