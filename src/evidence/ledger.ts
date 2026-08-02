import { createHash } from "node:crypto";

import type { Evidence, EvidenceSource } from "./types.js";

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
