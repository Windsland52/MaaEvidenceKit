import { expect, test } from "vitest";

import {
  EVIDENCE_SCHEMA_VERSION,
  MANIFEST_ENVELOPE_KEYS,
  MANIFEST_ROW_KEYS,
  MANIFEST_SCHEMA_VERSION,
  artifactId,
  coverageAnnotation,
  manifestDocument,
  manifestRows,
  renderCoverageManifest,
  type Artifact,
  type ArtifactKind,
  type ArtifactStatus,
  type InspectionResult,
  type ManifestRow,
} from "../../src/index.js";

/**
 * The artifact vocabulary the manifest must stay inside. These literals deliberately duplicate the
 * ArtifactKind and ArtifactStatus unions: a type cannot be asserted at runtime, and this list is
 * what fails when a kind or status is added to the domain without the manifest being reconsidered.
 */
const ARTIFACT_KIND_DOMAIN: readonly ArtifactKind[] = [
  "maa_log",
  "log",
  "image",
  "interface",
  "pipeline",
  "archive_part",
  "directory",
  "other",
];

const ARTIFACT_STATUS_DOMAIN: readonly ArtifactStatus[] = ["selected", "available", "skipped", "unreadable"];

const ROW_KEYS: readonly string[] = MANIFEST_ROW_KEYS;
const ENVELOPE_KEYS: readonly string[] = MANIFEST_ENVELOPE_KEYS;

const GENERATED_AT = "2026-09-26T18:50:00.000Z";
const OTHER_GENERATED_AT = "2026-09-27T09:00:00.000Z";
const ROOT_PATH = "corpus";
const REASON = "No supported deterministic Maa evidence adapter selected this file.";

/** A 64-character lowercase hex digest, so the row assertions stay independent of any real file. */
const HEX_A = "a".repeat(64);
const HEX_B = "b".repeat(64);

type ArtifactInit = {
  relativePath: string;
  kind: ArtifactKind;
  status?: ArtifactStatus;
  sizeBytes?: number;
  contentDigest?: string;
  digestStatus?: "unreadable" | "empty" | "too_large";
  reason?: string;
};

function artifact(init: ArtifactInit): Artifact {
  return {
    id: artifactId(init.relativePath),
    path: `/corpus/${init.relativePath}`,
    relativePath: init.relativePath,
    kind: init.kind,
    status: init.status ?? "available",
    ...(init.sizeBytes === undefined ? {} : { sizeBytes: init.sizeBytes }),
    ...(init.contentDigest === undefined ? {} : { contentDigest: init.contentDigest }),
    ...(init.digestStatus === undefined ? {} : { digestStatus: init.digestStatus }),
    ...(init.reason === undefined ? {} : { reason: init.reason }),
  };
}

function inspection(artifacts: readonly Artifact[], rootPath = ROOT_PATH): InspectionResult {
  return {
    schemaVersion: EVIDENCE_SCHEMA_VERSION,
    kind: "mla",
    generatedAt: GENERATED_AT,
    input: { path: rootPath },
    artifacts: [...artifacts],
    evidence: [],
    missingEvidence: [],
    warnings: [],
    statistics: {},
    coverage: coverageAnnotation(artifacts, rootPath),
    details: { extraction: "not-run" },
  };
}

function rowFor(rows: readonly ManifestRow[], relativePath: string): ManifestRow {
  const row = rows.find((candidate) => candidate.path === relativePath);
  if (row === undefined) {
    throw new Error(`No manifest row for ${relativePath}; rows: ${rows.map((item) => item.path).join(", ")}`);
  }
  return row;
}

/** The rotation names used by every rotation assertion, oldest first. */
const ROTATIONS = [
  "maafw.bak.2026.09.26-18.27.41.257.log",
  "maafw.bak.2026.09.26-18.32.12.395.log",
  "maafw.bak.2026.09.26-18.35.46.392.log",
  "maafw.bak.2026.09.26-18.38.06.897.log",
  "maafw.bak.2026.09.26-18.42.09.422.log",
] as const;

const BOUNDARIES = [
  "2026-09-26T18:27:41.257",
  "2026-09-26T18:32:12.395",
  "2026-09-26T18:35:46.392",
  "2026-09-26T18:38:06.897",
  "2026-09-26T18:42:09.422",
] as const;

function rotationCorpus(): Artifact[] {
  return [
    // Deliberately listed out of order: the manifest orders rows and rotation members itself.
    artifact({ relativePath: ROTATIONS[4], kind: "maa_log" }),
    artifact({ relativePath: ROTATIONS[0], kind: "maa_log" }),
    artifact({ relativePath: ROTATIONS[2], kind: "maa_log" }),
    artifact({ relativePath: "maafw.log", kind: "maa_log" }),
    artifact({ relativePath: ROTATIONS[1], kind: "maa_log" }),
    artifact({ relativePath: ROTATIONS[3], kind: "maa_log" }),
    artifact({ relativePath: "logs/maafw.bak.2026.09.26-18.27.41.257.log", kind: "maa_log" }),
    artifact({ relativePath: "logs/maafw.log", kind: "maa_log" }),
    artifact({ relativePath: "notes.txt", kind: "log", status: "skipped", reason: REASON }),
  ];
}

test("keeps every manifest row inside the closed kind and status vocabulary", () => {
  const artifacts = [
    artifact({
      relativePath: ROTATIONS[0],
      kind: "maa_log",
      status: "selected",
      sizeBytes: 2048,
      contentDigest: `sha256:${HEX_A}`,
    }),
    artifact({ relativePath: "maafw.log", kind: "maa_log", sizeBytes: 1024, digestStatus: "too_large" }),
    artifact({ relativePath: "go-service.log", kind: "log", status: "skipped", sizeBytes: 16, reason: REASON }),
    artifact({ relativePath: "on_error/shot.png", kind: "image", sizeBytes: 64 }),
    artifact({ relativePath: "interface.json", kind: "interface", sizeBytes: 12 }),
    artifact({ relativePath: "resource/pipeline/AutoDelivery.json", kind: "pipeline", sizeBytes: 34 }),
    artifact({ relativePath: "logs.part1of3.zip", kind: "archive_part", sizeBytes: 8, digestStatus: "unreadable" }),
    artifact({ relativePath: "logs", kind: "directory", sizeBytes: 0 }),
    artifact({ relativePath: "record/prices.json", kind: "other", status: "unreadable", reason: "EACCES" }),
  ];

  const document = manifestDocument(inspection(artifacts), { extraction: "not-run", generatedAt: GENERATED_AT });
  const rows = document.artifacts;

  expect(Object.keys(document).sort()).toEqual([...ENVELOPE_KEYS].sort());
  expect(Object.keys(document)).toHaveLength(ENVELOPE_KEYS.length);

  for (const row of rows) {
    // A key outside the fixed list is a second, parallel semantics growing beside kind and status.
    expect(Object.keys(row).filter((key) => !ROW_KEYS.includes(key))).toEqual([]);
    expect(ARTIFACT_KIND_DOMAIN).toContain(row.kind);
    expect(ARTIFACT_STATUS_DOMAIN).toContain(row.status);
  }

  // The fixture exercises the whole vocabulary, so the assertions above are not vacuous.
  expect([...new Set(rows.map((row) => row.kind))].sort()).toEqual([...ARTIFACT_KIND_DOMAIN].sort());
  expect([...new Set(rows.map((row) => row.status))].sort()).toEqual([...ARTIFACT_STATUS_DOMAIN].sort());
  expect(rows.map((row) => row.path)).toEqual(rows.map((row) => row.path).sort());
  expect(document.schemaVersion).toBe(MANIFEST_SCHEMA_VERSION);
});

test("derives a monotonic rotation chain from file names alone", () => {
  const rows = manifestRows(rotationCorpus(), ROOT_PATH);

  ROTATIONS.forEach((name, offset) => {
    const row = rowFor(rows, name);
    expect(row.rotation).toEqual({ family: "corpus", index: offset + 1 });
    expect(row.timeCoverage).toEqual({
      basis: "rotation-filename",
      from: offset === 0 ? null : BOUNDARIES[offset - 1],
      to: BOUNDARIES[offset],
      fromKnown: offset > 0,
      toKnown: true,
    });
  });

  const active = rowFor(rows, "maafw.log");
  expect(active.rotation).toEqual({ family: "corpus", index: ROTATIONS.length + 1 });
  expect(active.timeCoverage).toEqual({
    basis: "rotation-filename",
    from: BOUNDARIES[BOUNDARIES.length - 1],
    to: null,
    fromKnown: true,
    toKnown: false,
  });

  // A second directory is a second family, and it starts at index 1 with its own boundaries.
  const nestedRotation = rowFor(rows, "logs/maafw.bak.2026.09.26-18.27.41.257.log");
  expect(nestedRotation.rotation).toEqual({ family: "logs", index: 1 });
  expect(nestedRotation.timeCoverage).toEqual({
    basis: "rotation-filename",
    from: null,
    to: BOUNDARIES[0],
    fromKnown: false,
    toKnown: true,
  });
  const nestedActive = rowFor(rows, "logs/maafw.log");
  expect(nestedActive.rotation).toEqual({ family: "logs", index: 2 });
  expect(nestedActive.timeCoverage).toEqual({
    basis: "rotation-filename",
    from: BOUNDARIES[0],
    to: null,
    fromKnown: true,
    toKnown: false,
  });

  // A file discovery classified as something else is not a rotation member and carries no coverage.
  expect(Object.keys(rowFor(rows, "notes.txt"))).not.toContain("rotation");
  expect(Object.keys(rowFor(rows, "notes.txt"))).not.toContain("timeCoverage");
});

test("carries bare hex digests and names every digest absence", () => {
  const rows = manifestRows([
    artifact({ relativePath: "a.log", kind: "log", status: "skipped", reason: REASON, contentDigest: `sha256:${HEX_A}` }),
    artifact({ relativePath: "b.log", kind: "log", status: "skipped", reason: REASON, contentDigest: HEX_B }),
    artifact({ relativePath: "empty.log", kind: "log", status: "skipped", reason: REASON, sizeBytes: 0, digestStatus: "empty" }),
    artifact({ relativePath: "huge.png", kind: "image", digestStatus: "too_large" }),
    artifact({ relativePath: "unknown.txt", kind: "log", status: "skipped", reason: REASON }),
  ], ROOT_PATH);

  expect(rowFor(rows, "a.log").sha256).toBe(HEX_A);
  expect(rowFor(rows, "a.log")).not.toHaveProperty("digestStatus");
  // A digest stored without its algorithm prefix is passed through rather than dropped.
  expect(rowFor(rows, "b.log").sha256).toBe(HEX_B);
  expect(rowFor(rows, "empty.log")).toMatchObject({ sha256: null, sizeBytes: 0, digestStatus: "empty" });
  expect(rowFor(rows, "huge.png")).toMatchObject({ sha256: null, sizeBytes: null, digestStatus: "too_large" });
  // A record with neither a digest nor a named failure reports the absence, never silence.
  expect(rowFor(rows, "unknown.txt")).toMatchObject({ sha256: null, digestStatus: "not-recorded" });
});

test("keeps a file no adapter selected in the rows with its reason", () => {
  const rows = manifestRows([
    artifact({ relativePath: "maafw.log", kind: "maa_log", sizeBytes: 10 }),
    artifact({ relativePath: "notes.txt", kind: "log", status: "skipped", sizeBytes: 4, reason: REASON }),
    artifact({ relativePath: "record/prices.json", kind: "other", status: "skipped", sizeBytes: 2, reason: REASON }),
  ], ROOT_PATH);

  expect(rows).toHaveLength(3);
  for (const name of ["notes.txt", "record/prices.json"]) {
    const row = rowFor(rows, name);
    expect(row.status).toBe("skipped");
    expect(typeof row.reason).toBe("string");
    expect(row.reason).not.toBe("");
  }
});

test("refuses a stored coverage annotation that disagrees with the artifact records", () => {
  const artifacts = [
    artifact({ relativePath: "maafw.log", kind: "maa_log", status: "selected", sizeBytes: 10 }),
    artifact({ relativePath: "notes.txt", kind: "log", status: "skipped", reason: REASON }),
    artifact({ relativePath: "logs/maafw.bak.2026.09.26-18.27.41.257.log", kind: "maa_log" }),
  ];
  const stored = inspection(artifacts);
  const options = { extraction: "reported", generatedAt: GENERATED_AT } as const;

  // Untampered: the stored annotation and the rows it annotates come from the same assembly.
  const document = manifestDocument(stored, options);
  expect(document.coverage).toMatchObject({ artifacts: 3, readForRuntimeFacts: 1, selected: 1, skipped: 1 });

  const tamperedCount = structuredClone(stored);
  tamperedCount.coverage = { ...coverageAnnotation(artifacts, ROOT_PATH), readForRuntimeFacts: 3 };
  expect(() => renderCoverageManifest(tamperedCount, options))
    .toThrow(/coverage\.readForRuntimeFacts .*disagrees with its artifact records/u);

  const tamperedKind = structuredClone(stored);
  tamperedKind.coverage = { ...coverageAnnotation(artifacts, ROOT_PATH), byKind: { maa_log: 1 } };
  expect(() => renderCoverageManifest(tamperedKind, options))
    .toThrow(/coverage\.byKind .*disagrees with its artifact records/u);

  // Tampering with the records instead of the annotation is the same disagreement, read the other way.
  const tamperedArtifacts = structuredClone(stored);
  tamperedArtifacts.artifacts = tamperedArtifacts.artifacts.map((item) =>
    item.relativePath === "notes.txt" ? { ...item, status: "selected" as const } : item);
  expect(() => renderCoverageManifest(tamperedArtifacts, options))
    .toThrow(/coverage\.(byStatus|readForRuntimeFacts|notRead) .*disagrees with its artifact records/u);

  // A report written before the annotation existed still renders, because it claims nothing.
  const unannotated = structuredClone(stored);
  delete unannotated.coverage;
  expect(manifestDocument(unannotated, options).coverage).toMatchObject({ artifacts: 3, selected: 1, skipped: 1 });
});

test("renders byte-identically for one input and isolates generatedAt", () => {
  const result = inspection(rotationCorpus());
  const first = renderCoverageManifest(result, { extraction: "reported", generatedAt: GENERATED_AT });
  const second = renderCoverageManifest(result, { extraction: "reported", generatedAt: GENERATED_AT });
  const later = renderCoverageManifest(result, { extraction: "reported", generatedAt: OTHER_GENERATED_AT });

  expect(second).toBe(first);
  expect(later).not.toBe(first);
  expect(later).toBe(first.replace(GENERATED_AT, OTHER_GENERATED_AT));
  expect(JSON.parse(later)).toEqual({ ...JSON.parse(first) as object, generatedAt: OTHER_GENERATED_AT });
});

test("states which extraction state the document came from", () => {
  const result = inspection(rotationCorpus());
  const shortCircuit = manifestDocument(result, { extraction: "not-run", generatedAt: GENERATED_AT });
  const reported = manifestDocument(result, { extraction: "reported", generatedAt: GENERATED_AT });

  expect(shortCircuit.input).toEqual({ path: ROOT_PATH, extraction: "not-run" });
  expect(reported.input).toEqual({ path: ROOT_PATH, extraction: "reported" });
  // The two entry points differ in the extraction state they name and in nothing else that matters.
  expect(shortCircuit.artifacts).toEqual(reported.artifacts);
  expect(reported.coverage).toEqual(shortCircuit.coverage);

  // The document root is never a machine path: every row path is already relative to it, so carrying
  // the inspected directory would make two manifests of one corpus differ for no reason.
  for (const document of [shortCircuit, reported]) {
    expect(document.root).toBe(".");
    expect(document.rotationBasis.source).toBe("rotation-filename");
    expect(document.rotationBasis.boundaryAmbiguityMs).toBeGreaterThan(0);
    expect(document.rotationBasis.note).not.toBe("");
  }
  expect(shortCircuit.rotationBasis).toEqual(reported.rotationBasis);
});
