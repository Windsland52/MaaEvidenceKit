import {
  ROTATION_BOUNDARY_AMBIGUITY_MS,
  ROTATION_TIME_BASIS,
  deriveRotationCoverage,
} from "../evidence/rotation.js";
import type { RotationCoverage } from "../evidence/rotation.js";
import { UsageError } from "../evidence/usage-error.js";
import type { Artifact, CoverageAnnotation, InspectionResult, TimeRange } from "../evidence/types.js";
import { coverageAnnotation } from "../evidence/coverage.js";

/**
 * The coverage manifest: a bounded, deterministic statement of which artifacts a corpus holds and
 * which of them an inspection read.
 *
 * Manifest rows carry no semantic inference. A row says what a file is (`kind`), what was done with
 * it (`status`, and `reason` when an adapter declined it), how large it is, and its content digest.
 * Files no adapter selected appear as `skipped` rows rather than being dropped, because the defect
 * this view exists to fix is a directory-level silence about what was left behind.
 */

export const MANIFEST_SCHEMA_VERSION = "maa-evidence/manifest-v1" as const;

/**
 * The manifest reports which extraction state it came from. `not-run` is the discovery-state short
 * circuit behind `mla inspect <dir> --format manifest`: a caller reads coverage first and then
 * decides whether to pay for parsing. A manifest rendered from a saved report says `reported`, which
 * is the only other honest value: the extraction happened in another process, at another time.
 */
export type ManifestExtraction = "not-run" | "reported";

/**
 * Time coverage derived from a rotation file name. `basis` is constant and names where the endpoints
 * come from, because these are inferred boundaries read off a file name, not timestamps observed in
 * the file. A modification time never participates: extraction stamps every extracted file with the
 * extraction time, so an mtime-derived boundary would be confidently wrong.
 */
export type ManifestTimeCoverage = {
  basis: typeof ROTATION_TIME_BASIS;
  /** Previous rotation boundary in the family, or null when the family cannot supply one. */
  from: string | null;
  /** This artifact's own rotation boundary, or null for the active (undated) file. */
  to: string | null;
  fromKnown: boolean;
  toKnown: boolean;
};

export type ManifestRotation = {
  family: string;
  index: number;
};

export type ManifestRow = {
  path: string;
  /** Hex SHA-256 of the artifact bytes, or null when they could not be digested. */
  sha256: string | null;
  sizeBytes: number | null;
  kind: Artifact["kind"];
  status: Artifact["status"];
  rotation?: ManifestRotation;
  timeCoverage?: ManifestTimeCoverage;
  /** Present when an adapter declined the file; the same words the report uses. */
  reason?: string;
  /** Present when the digest is absent, and why. */
  digestStatus?: "unreadable" | "empty" | "too_large" | "not-recorded";
};

export type ManifestCoverageBlock = CoverageAnnotation & {
  /** Artifacts an adapter selected. */
  selected: number;
  /** Artifacts no adapter selected. */
  skipped: number;
};

/**
 * How far a rotation name can be trusted. A row's `timeCoverage` is an inferred interval, not an
 * observation, and a reader who treats it as exact will misattribute an event that sits on a
 * boundary. The envelope states the basis once so the per-row `basis` does not have to carry a
 * precision claim.
 */
export type ManifestRotationBasis = {
  source: typeof ROTATION_TIME_BASIS;
  /** A timestamp this close to a boundary cannot be assigned to one side of it. */
  boundaryAmbiguityMs: number;
  note: string;
};

/** The manifest root is always `"."`: every row path is relative to it, so a machine path adds nothing. */
export const MANIFEST_ROOT = "." as const;

export type ManifestDocument = {
  schemaVersion: typeof MANIFEST_SCHEMA_VERSION;
  kind: InspectionResult["kind"];
  root: typeof MANIFEST_ROOT;
  generatedAt: string;
  input: { path: string; timeRange?: TimeRange; extraction: ManifestExtraction };
  rotationBasis: ManifestRotationBasis;
  coverage: ManifestCoverageBlock;
  artifacts: ManifestRow[];
};

/**
 * The fixed row key set. Any key outside this list is a test failure: it is how the vocabulary stays
 * closed while the manifest is extended, and it is what stops a second, parallel semantics (a
 * `role` alias, a mirror group) from growing next to `kind` and `status`.
 */
export const MANIFEST_ROW_KEYS = [
  "path",
  "sha256",
  "sizeBytes",
  "kind",
  "status",
  "rotation",
  "timeCoverage",
  "reason",
  "digestStatus",
] as const;

export const MANIFEST_ENVELOPE_KEYS = [
  "schemaVersion",
  "kind",
  "root",
  "generatedAt",
  "input",
  "rotationBasis",
  "coverage",
  "artifacts",
] as const;

export const MANIFEST_ROTATION_BASIS: ManifestRotationBasis = {
  source: ROTATION_TIME_BASIS,
  boundaryAmbiguityMs: ROTATION_BOUNDARY_AMBIGUITY_MS,
  note: "Inferred from the rotation timestamp in the file name, which equals the file's last log-line"
    + " timestamp. A boundary of a name, not an observed event; modification time never participates.",
};

/**
 * Drop the algorithm prefix from a stored digest. Reports keep `sha256:<hex>` so the algorithm
 * travels with the value; the manifest names the algorithm in the key instead and carries bare hex,
 * which is 8 bytes per row cheaper and matches the documented row contract.
 */
function manifestDigest(digest: string | undefined): string | null {
  if (digest === undefined) return null;
  const separator = digest.indexOf(":");
  return separator === -1 ? digest : digest.slice(separator + 1);
}

function manifestRow(
  artifact: Artifact,
  rotation: RotationCoverage | undefined,
): ManifestRow {
  const digest = artifact.contentDigest;
  const digestStatus = artifact.digestStatus
    ?? (digest === undefined ? "not-recorded" as const : undefined);
  return {
    path: artifact.relativePath,
    sha256: manifestDigest(digest),
    sizeBytes: artifact.sizeBytes ?? null,
    kind: artifact.kind,
    status: artifact.status,
    ...(rotation === undefined ? {} : {
      rotation: { family: rotation.rotation.family, index: rotation.rotation.index },
      timeCoverage: {
        basis: rotation.timeCoverage.basis,
        from: rotation.timeCoverage.from,
        to: rotation.timeCoverage.to,
        fromKnown: rotation.timeCoverage.fromKnown,
        toKnown: rotation.timeCoverage.toKnown,
      },
    }),
    ...(artifact.reason === undefined ? {} : { reason: artifact.reason }),
    ...(digestStatus === undefined ? {} : { digestStatus }),
  };
}

export function manifestRows(
  artifacts: readonly Artifact[],
  rootPath = "",
): ManifestRow[] {
  const coverage = deriveRotationCoverage(artifacts, rootPath);
  return [...artifacts]
    .sort((left, right) => left.relativePath.localeCompare(right.relativePath))
    .map((artifact) => manifestRow(artifact, coverage.get(artifact.relativePath)));
}

/**
 * Recompute the coverage block from the artifact records and refuse a report whose stored annotation
 * disagrees. A stored count that no longer matches the rows it annotates is worse than no count: it
 * reads as an authoritative measurement while describing a different artifact list.
 */
export function reconcileCoverage(
  artifacts: readonly Artifact[],
  stored: CoverageAnnotation | undefined,
  rootPath = "",
): CoverageAnnotation {
  const derived = coverageAnnotation(artifacts, rootPath);
  if (stored === undefined) return derived;
  const keys = ["artifacts", "readForRuntimeFacts", "notRead", "byKind", "byStatus", "rotations"] as const;
  for (const key of keys) {
    const left = JSON.stringify(derived[key]);
    const right = JSON.stringify(stored[key]);
    if (left !== right) {
      throw new UsageError(
        `The report's stored coverage.${key} (${right}) disagrees with its artifact records (${left}).`
        + " The manifest re-derives coverage from the rows it prints; re-run the inspection instead of trusting either value.",
      );
    }
  }
  return derived;
}

export type ManifestRenderOptions = {
  extraction: ManifestExtraction;
  /** Rotation family label for members that sit in the inspected root. */
  rootPath?: string;
  /** Overrides the report's own timestamp; used only by tests that compare two renderings. */
  generatedAt?: string;
};

/**
 * Build the manifest document from an inspection result.
 *
 * This is the only place the manifest is assembled, so the discovery-state short circuit and the
 * saved-report view cannot drift: both hand the same inspection record to this function. Nothing
 * here reads the corpus, which is what lets `view --input <report> --format manifest` answer from a
 * report whose directory has since been renamed or deleted.
 */
export function manifestDocument(
  result: InspectionResult,
  options: ManifestRenderOptions,
): ManifestDocument {
  // The inspected root only ever labels the rotation family that lives in the root directory itself;
  // it never appears in the document, which keeps two manifests of one corpus comparable byte for
  // byte no matter which machine produced which.
  const rootPath = options.rootPath ?? result.input.path;
  const coverage = reconcileCoverage(result.artifacts, result.coverage, rootPath);
  const rows = manifestRows(result.artifacts, rootPath);
  let selected = 0;
  let skipped = 0;
  for (const row of rows) {
    if (row.status === "selected") selected += 1;
    if (row.status === "skipped") skipped += 1;
  }
  return {
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    kind: result.kind,
    root: MANIFEST_ROOT,
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    input: {
      path: result.input.path,
      ...(result.input.timeRange === undefined ? {} : { timeRange: result.input.timeRange }),
      extraction: options.extraction,
    },
    rotationBasis: MANIFEST_ROTATION_BASIS,
    coverage: { ...coverage, selected, skipped },
    artifacts: rows,
  };
}

export type ManifestFormat = "json" | "compact";

export type ManifestViewOptions = ManifestRenderOptions & {
  format?: ManifestFormat;
};

/**
 * Render one inspection as a coverage manifest.
 *
 * `json` is indented and stable enough to diff byte for byte; `compact` is the same document on one
 * line for callers that pay per token rather than per line. Neither is truncated: a manifest has a
 * size budget, and exceeding it is a bug in what the manifest reports, not a reason to withhold rows.
 */
export function renderCoverageManifest(
  result: InspectionResult,
  options: ManifestViewOptions,
): string {
  const document = manifestDocument(result, options);
  return options.format === "compact"
    ? JSON.stringify(document)
    : JSON.stringify(document, null, 1);
}
