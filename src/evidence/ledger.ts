import { createHash } from "node:crypto";

import type { Artifact, Evidence, EvidenceSource } from "./types.js";

type EvidenceDraft<T> = Omit<Evidence<T>, "id">;

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object" && value !== null) {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function evidenceKey<T>(draft: EvidenceDraft<T>): string {
  return canonicalJson({
    kind: draft.kind,
    source: draft.source,
    data: draft.data,
  });
}

export type CrossArtifactDuplicateObservations = {
  observationGroups: number;
  duplicateRecords: number;
  artifactIds: string[];
};

function observationFingerprint(evidence: Evidence): string {
  return canonicalJson([
    evidence.kind,
    evidence.summary,
    evidence.source.task ?? null,
    evidence.source.node ?? null,
  ]);
}

/**
 * Count evidence records that describe the same observation in more than one artifact. Mirrored
 * MaaFramework logs (a launcher copy plus an agent copy) report the same runtime events, and each
 * copy earns its own evidence ID because provenance differs. The records stay unmerged; this only
 * makes the repetition explicit so a harness does not read one event as two.
 *
 * The fingerprint is kind, summary, task, and node. Timestamps are deliberately excluded: mirrored
 * processes flush independently, and on real material only 99 of 131 mirrored groups agreed on the
 * timestamp, so including it would have hidden about a quarter of the duplication. The tradeoff is
 * that two genuinely distinct events sharing all four fields collapse into one group, which
 * understates `observationGroups`. This is a fingerprint match, not proof of identity, and the
 * group count is a lower bound on distinct observations.
 */
export function findCrossArtifactDuplicateObservations(
  evidence: readonly Evidence[],
): CrossArtifactDuplicateObservations {
  const groups = new Map<string, Set<string>>();
  const counts = new Map<string, number>();
  for (const item of evidence) {
    const fingerprint = observationFingerprint(item);
    const artifacts = groups.get(fingerprint) ?? new Set<string>();
    artifacts.add(item.source.artifactId);
    groups.set(fingerprint, artifacts);
    counts.set(fingerprint, (counts.get(fingerprint) ?? 0) + 1);
  }
  const artifactIds = new Set<string>();
  let observationGroups = 0;
  let duplicateRecords = 0;
  for (const [fingerprint, artifacts] of groups) {
    if (artifacts.size < 2) continue;
    observationGroups += 1;
    duplicateRecords += (counts.get(fingerprint) ?? 0);
    for (const id of artifacts) artifactIds.add(id);
  }
  return {
    observationGroups,
    duplicateRecords,
    artifactIds: [...artifactIds].sort((left, right) => left.localeCompare(right)),
  };
}

export type ByteIdenticalArtifacts = {
  /** Groups of two or more artifacts whose bytes are identical. */
  groups: { contentDigest: string; artifactIds: string[]; relativePaths: string[] }[];
  /** Number of artifact records in those groups. */
  artifactRecords: number;
  /** artifactRecords minus one representative per group. */
  deduplicatedRecords: number;
};

/**
 * Group artifacts whose bytes are identical.
 *
 * This is a deterministic equality fact about file content. It exists because mirrored log copies
 * and duplicate error screenshots each earn their own artifact record, so any count taken from the
 * ledger can be inflated by copies that carry no independent information. The records themselves
 * stay separate - provenance and evidence IDs are not merged - and this only states how much a
 * count is inflated by byte-identical copies. A byte-identical copy is not automatically the same
 * observation: two runs can capture an identical frame or write an identical log segment.
 *
 * Only artifacts that actually carry a digest participate; artifacts skipped by the digest cap, or
 * never read for digesting, are excluded rather than assumed distinct.
 */
export function findByteIdenticalArtifacts(
  artifacts: readonly Artifact[],
): ByteIdenticalArtifacts {
  const byDigest = new Map<string, Artifact[]>();
  for (const artifact of artifacts) {
    if (artifact.contentDigest === undefined) continue;
    const group = byDigest.get(artifact.contentDigest) ?? [];
    group.push(artifact);
    byDigest.set(artifact.contentDigest, group);
  }
  const groups: ByteIdenticalArtifacts["groups"] = [];
  let artifactRecords = 0;
  for (const [contentDigest, entries] of byDigest) {
    if (entries.length < 2) continue;
    const sorted = [...entries].sort((left, right) => left.id.localeCompare(right.id));
    groups.push({
      contentDigest,
      artifactIds: sorted.map((artifact) => artifact.id),
      relativePaths: sorted.map((artifact) => artifact.relativePath),
    });
    artifactRecords += sorted.length;
  }
  groups.sort((left, right) => (left.artifactIds[0] ?? "").localeCompare(right.artifactIds[0] ?? ""));
  return {
    groups,
    artifactRecords,
    deduplicatedRecords: artifactRecords - groups.length,
  };
}

export function artifactId(relativePath: string): string {
  const digest = createHash("sha256")
    .update(relativePath.replaceAll("\\", "/").normalize("NFC"))
    .digest("hex")
    .slice(0, 12);
  return `artifact-${digest}`;
}

export class EvidenceLedger {
  readonly #byKey = new Map<string, Evidence>();
  readonly #byId = new Map<string, Evidence>();

  add<T>(kind: string, summary: string, source: EvidenceSource, data: T): Evidence<T> {
    const draft: EvidenceDraft<T> = { kind, summary, source, data };
    const key = evidenceKey(draft);
    const existing = this.#byKey.get(key);
    if (existing !== undefined) return existing as Evidence<T>;

    const digest = createHash("sha256").update(key).digest("hex");
    let width = 12;
    let id = `evidence-${digest.slice(0, width)}`;
    while (this.#byId.has(id)) {
      width += 2;
      id = `evidence-${digest.slice(0, width)}`;
    }
    const evidence: Evidence<T> = { id, ...draft };
    this.#byKey.set(key, evidence);
    this.#byId.set(id, evidence);
    return evidence;
  }

  values(): Evidence[] {
    return [...this.#byId.values()];
  }

  get(id: string): Evidence | undefined {
    return this.#byId.get(id);
  }
}
