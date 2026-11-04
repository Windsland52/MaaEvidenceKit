import type {
  Completeness,
  Evidence,
  FieldTruncationCompleteness,
} from "./types.js";

/** Maximum number of distinct fields listed in `fieldTruncation.byField`; the rest are counted. */
export const MAX_FIELD_TRUNCATION_FIELDS = 10;

export type CompletenessInput = {
  signals: { mode: "complete" | "focused"; selected: number; total: number };
  actionDetails: { selected: number; total: number };
  pipelineOverrides: { selected: number; total: number };
  evidence: readonly Evidence[];
};

function signalsDimension(
  mode: "complete" | "focused",
  selected: number,
  total: number,
): Completeness["signals"] {
  return { mode, selected, total, downgraded: selected < total };
}

function actionDetailsDimension(
  selected: number,
  total: number,
): Completeness["actionDetails"] {
  return {
    mode: selected < total ? "sampled" : "complete",
    selected,
    total,
    downgraded: selected < total,
  };
}

function pipelineOverridesDimension(
  selected: number,
  total: number,
): Completeness["pipelineOverrides"] {
  return {
    mode: selected < total ? "prioritized" : "complete",
    selected,
    total,
    downgraded: selected < total,
  };
}

/**
 * Build the report-level completeness block from the counters the inspection already tracks.
 *
 * Recording selected/total here instead of re-counting evidence keeps `statistics` derivable from a
 * single source, and the explicit `mode` is what stops a focused signal list from being read as a
 * complete one. `fieldTruncation` is a separate dimension and deliberately does not feed
 * `anyDowngraded`: a sampling decision and a record-level field cap are different limits.
 */
export function buildCompleteness(input: CompletenessInput): Completeness {
  const signals = signalsDimension(input.signals.mode, input.signals.selected, input.signals.total);
  const actionDetails = actionDetailsDimension(
    input.actionDetails.selected,
    input.actionDetails.total,
  );
  const pipelineOverrides = pipelineOverridesDimension(
    input.pipelineOverrides.selected,
    input.pipelineOverrides.total,
  );
  return {
    signals,
    actionDetails,
    pipelineOverrides,
    fieldTruncation: summarizeFieldTruncation(input.evidence),
    anyDowngraded:
      signals.downgraded || actionDetails.downgraded || pipelineOverrides.downgraded,
  };
}

/**
 * Count record-level `*Truncated` booleans across every evidence payload.
 *
 * These are the bounded field caps inside one record (for example `bestTruncated` on a recognition
 * detail), which is why they are reported as a separate dimension: they say a record lost fields,
 * not that the report lost records. The output is bounded by `MAX_FIELD_TRUNCATION_FIELDS` plus an
 * `omitted` count, and fields sort by occurrence count then name so the block is deterministic.
 */
export function summarizeFieldTruncation(
  evidence: readonly Evidence[],
): FieldTruncationCompleteness {
  const counts = new Map<string, { total: number; truncatedTrue: number }>();
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    if (value === null || typeof value !== "object") return;
    for (const [field, child] of Object.entries(value as Record<string, unknown>)) {
      if (field.endsWith("Truncated") && typeof child === "boolean") {
        const entry = counts.get(field) ?? { total: 0, truncatedTrue: 0 };
        entry.total += 1;
        if (child) entry.truncatedTrue += 1;
        counts.set(field, entry);
        continue;
      }
      visit(child);
    }
  };
  for (const item of evidence) visit(item.data);

  const sorted = [...counts.entries()]
    .sort(([leftField, left], [rightField, right]) =>
      right.total - left.total || leftField.localeCompare(rightField)
    );
  const byField = sorted
    .slice(0, MAX_FIELD_TRUNCATION_FIELDS)
    .map(([field, countsForField]) => ({
      field,
      total: countsForField.total,
      truncatedTrue: countsForField.truncatedTrue,
    }));
  return {
    any: sorted.some(([, countsForField]) => countsForField.truncatedTrue > 0),
    total: sorted.reduce((total, [, countsForField]) => total + countsForField.total, 0),
    byField,
    omitted: sorted.length - byField.length,
  };
}
