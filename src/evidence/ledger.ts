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

export type CrossArtifactDuplicateObservationGroup = {
  kind: string;
  summary: string;
  task?: string;
  node?: string;
  /** Every artifact that reported this fingerprint, sorted. */
  artifactIds: string[];
  /** Records in the group, bounded; the fingerprint below identifies the rest. */
  recordIds: string[];
  recordCount: number;
  /**
   * The artifact to filter on when an event must be counted once. It is the member that discovery
   * listed first, falling back to the lexicographically first ID: a stable tie-break, not a claim
   * that one copy is authoritative.
   */
  preferredArtifactId: string;
};

export type CrossArtifactDuplicateObservations = {
  observationGroups: number;
  duplicateRecords: number;
  artifactIds: string[];
  /** Full group list, ordered by record count so a bounded report keeps the largest first. */
  groups: CrossArtifactDuplicateObservationGroup[];
};

const MAX_GROUP_RECORD_IDS = 8;

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
 *
 * `preferredArtifactOrder` is the inspection's artifact order. Reporting a preferred artifact exists
 * so a harness can count an event once with `--artifact-id` instead of working the grouping out by
 * hand; the records themselves are never merged or hidden.
 */
export function findCrossArtifactDuplicateObservations(
  evidence: readonly Evidence[],
  preferredArtifactOrder: readonly string[] = [],
): CrossArtifactDuplicateObservations {
  type Bucket = {
    kind: string;
    summary: string;
    task?: string;
    node?: string;
    records: Evidence[];
    artifacts: Set<string>;
  };
  const buckets = new Map<string, Bucket>();
  for (const item of evidence) {
    const fingerprint = observationFingerprint(item);
    const bucket = buckets.get(fingerprint) ?? {
      kind: item.kind,
      summary: item.summary,
      ...(item.source.task === undefined ? {} : { task: item.source.task }),
      ...(item.source.node === undefined ? {} : { node: item.source.node }),
      records: [],
      artifacts: new Set<string>(),
    };
    bucket.records.push(item);
    bucket.artifacts.add(item.source.artifactId);
    buckets.set(fingerprint, bucket);
  }

  const order = new Map(preferredArtifactOrder.map((id, index) => [id, index]));
  const rank = (id: string): number => order.get(id) ?? Number.MAX_SAFE_INTEGER;
  const artifactIds = new Set<string>();
  const groups: CrossArtifactDuplicateObservationGroup[] = [];
  let duplicateRecords = 0;
  for (const bucket of buckets.values()) {
    if (bucket.artifacts.size < 2) continue;
    const members = [...bucket.artifacts].sort((left, right) =>
      rank(left) - rank(right) || left.localeCompare(right));
    duplicateRecords += bucket.records.length;
    for (const id of members) artifactIds.add(id);
    groups.push({
      kind: bucket.kind,
      summary: bucket.summary,
      ...(bucket.task === undefined ? {} : { task: bucket.task }),
      ...(bucket.node === undefined ? {} : { node: bucket.node }),
      artifactIds: [...members].sort((left, right) => left.localeCompare(right)),
      recordIds: bucket.records.slice(0, MAX_GROUP_RECORD_IDS).map((record) => record.id),
      recordCount: bucket.records.length,
      preferredArtifactId: members[0] as string,
    });
  }
  groups.sort((left, right) =>
    right.recordCount - left.recordCount
    || left.kind.localeCompare(right.kind)
    || left.summary.localeCompare(right.summary));
  return {
    observationGroups: groups.length,
    duplicateRecords,
    artifactIds: [...artifactIds].sort((left, right) => left.localeCompare(right)),
    groups,
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
