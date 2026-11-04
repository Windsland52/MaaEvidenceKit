import type {
  Evidence,
  InspectionResult,
  ReportReduction,
  ReportReductionStep,
} from "../evidence/index.js";

/** Bounds for the `--max-report-bytes` CLI option, in UTF-8 bytes of the 2-space JSON document. */
export const MIN_REPORT_BYTES = 4096;
export const MAX_REPORT_BYTES = 268_435_456;

/**
 * Bytes reserved for the `reduction` block itself. The ladder aims below the requested budget by
 * this amount, so attaching the block (whose size grows with the number of steps) still lands inside
 * the budget instead of overshooting by its own bookkeeping.
 */
const REDUCTION_RESERVE = 2048;

/**
 * Evidence kinds the summary's `notableEvidence` cites. Removing one would leave a summary ID that
 * cannot be resolved in the saved report, so the ladder never drops these, no matter the budget.
 */
const PROTECTED_EVIDENCE_KINDS = new Set([
  "mla.failure",
  "mla.failure_context",
  "mla.failure_image",
  "mla.outcome",
  "mla.task_anomaly",
  "mla.task",
  "mla.session",
  "mla.cycle_exit_blocker",
  "mla.possible_mirrored_task_group",
]);

function isRepeatedNodeSignal(record: Evidence): boolean {
  if (record.kind !== "mla.signal") return false;
  const kind = (record.data as { kind?: unknown } | undefined)?.kind;
  return kind === "repeated_node" || kind === "repeated_node_cycle";
}

function isProtected(record: Evidence): boolean {
  return PROTECTED_EVIDENCE_KINDS.has(record.kind) || isRepeatedNodeSignal(record);
}

type LadderStep = {
  id: string;
  /** Path inside `details` (or `details.mla` for a combined inspection) for block-emptying steps. */
  detailsPath?: readonly string[];
  /** Evidence kind thinned by this step, for evidence steps. */
  evidenceKind?: string;
};

/**
 * The fixed ladder, in execution order. Earlier steps are the cheapest and least informative to
 * lose: duplicated projections first, then large evidence families by size. `details.taskTimelines`
 * is the one step whose loss is visible to a later command (`timeline` on a saved report), which the
 * documentation states.
 */
const LADDER: readonly LadderStep[] = [
  { id: "details.runtime.signals", detailsPath: ["runtime", "signals"] },
  { id: "details.taskTimelines", detailsPath: ["taskTimelines"] },
  { id: "details.mirrorGroups", detailsPath: ["mirrorGroups"] },
  { id: "evidence:mla.recognition_detail", evidenceKind: "mla.recognition_detail" },
  { id: "evidence:mla.pipeline_override", evidenceKind: "mla.pipeline_override" },
  { id: "evidence:mla.signal", evidenceKind: "mla.signal" },
  { id: "evidence:mla.action_detail", evidenceKind: "mla.action_detail" },
  { id: "evidence:mla.cycle_candidate_outcome", evidenceKind: "mla.cycle_candidate_outcome" },
];

/** Size of the document `emit` will write: the 2-space JSON rendering, before the trailing newline. */
export function measureReportBytes(result: unknown): number {
  return Buffer.byteLength(JSON.stringify(result, null, 2), "utf8");
}

/**
 * Exact size one evidence record adds to the rendered report.
 *
 * Evidence is an array inside the top-level object, so the record's own 2-space rendering gains four
 * leading spaces on every line, and a record after the first also costs the separating "`, " and
 * newline. A test asserts that summing this over a kind equals the measured difference, so a
 * renderer change cannot silently desynchronize the budget math.
 */
export function evidenceRecordContribution(record: unknown): number {
  const rendered = JSON.stringify(record, null, 2);
  const lines = rendered.split("\n").length;
  return Buffer.byteLength(rendered, "utf8") + 4 * lines + 2;
}

/**
 * Deterministic coverage ranking: midpoint first, then the midpoints of each half, recursively.
 * Earlier ranks are the most representative records, and the ordering nests, so keeping a prefix of
 * it gives a spread across the whole timeline at every budget.
 */
function coverageRanks(length: number): number[] {
  const order: number[] = [];
  const walk = (start: number, end: number): void => {
    if (start > end) return;
    const middle = Math.floor((start + end) / 2);
    order.push(middle);
    walk(start, middle - 1);
    walk(middle + 1, end);
  };
  walk(0, length - 1);
  const ranks = Array.from({ length }, () => 0);
  order.forEach((index, rank) => {
    ranks[index] = rank;
  });
  return ranks;
}

/** Within a thinned kind, keep the records that explain a failure ahead of the routine ones. */
function thinningPriority(record: Evidence, kind: string): number {
  const data = record.data as { status?: unknown; taskAssociation?: unknown } | undefined;
  if (kind === "mla.pipeline_override") return data?.taskAssociation === "task_id" ? 0 : 1;
  if (kind === "mla.action_detail") return data?.status === "failed" ? 0 : 1;
  return 0;
}

function detailContainers(result: InspectionResult): Record<string, unknown>[] {
  const details = result.details as Record<string, unknown> | undefined;
  if (details === undefined || details === null || typeof details !== "object") return [];
  const containers: Record<string, unknown>[] = [details];
  const mla = details["mla"];
  if (mla !== null && typeof mla === "object" && !Array.isArray(mla)) {
    containers.push(mla as Record<string, unknown>);
  }
  return containers;
}

/** Empty one details array; returns how many entries were removed (0 when the block is absent). */
function emptyDetailsArray(result: InspectionResult, path: readonly string[]): number {
  for (const container of detailContainers(result)) {
    let current = container;
    let found = true;
    for (const key of path.slice(0, -1)) {
      const next = current[key];
      if (next === null || typeof next !== "object" || Array.isArray(next)) {
        found = false;
        break;
      }
      current = next as Record<string, unknown>;
    }
    if (!found) continue;
    const leaf = path[path.length - 1] as string;
    const value = current[leaf];
    if (!Array.isArray(value)) continue;
    current[leaf] = [];
    return value.length;
  }
  return 0;
}

/**
 * Thin one evidence kind to fit the budget. Protected records always stay; among the rest, priority
 * records come first and each remaining slot follows the coverage ranking. The byte total is solved
 * exactly from per-record contributions, so no candidate record is guessed at twice.
 */
function thinEvidenceKind(
  result: InspectionResult,
  kind: string,
  budget: number,
  currentBytes: number,
): number {
  const records = result.evidence.filter((record) => record.kind === kind);
  if (records.length === 0) return 0;

  const contributions = new Map<Evidence, number>();
  for (const record of records) contributions.set(record, evidenceRecordContribution(record));
  const totalContribution = records.reduce(
    (sum, record) => sum + (contributions.get(record) as number),
    0,
  );
  const baseBytes = currentBytes - totalContribution;

  const ranks = coverageRanks(records.length);
  const ranked: { record: Evidence; rank: number; priority: number }[] = [];
  const kept = new Set<Evidence>();
  let keptBytes = 0;
  records.forEach((record, index) => {
    if (isProtected(record)) {
      kept.add(record);
      keptBytes += contributions.get(record) as number;
      return;
    }
    ranked.push({ record, rank: ranks[index] as number, priority: thinningPriority(record, kind) });
  });
  ranked.sort((left, right) =>
    left.priority - right.priority || left.rank - right.rank
  );

  const capacity = budget - baseBytes;
  for (const candidate of ranked) {
    const contribution = contributions.get(candidate.record) as number;
    if (keptBytes + contribution > capacity) continue;
    kept.add(candidate.record);
    keptBytes += contribution;
  }

  result.evidence = result.evidence.filter((record) => record.kind !== kind || kept.has(record));
  return records.length - kept.size;
}

function attachReduction(
  result: InspectionResult,
  maxBytes: number,
  steps: ReportReductionStep[],
): ReportReduction {
  const reduction: ReportReduction = {
    maxBytes,
    actualBytes: 0,
    steps,
    dropped: {
      items: steps.reduce((total, step) => total + step.removedItems, 0),
      bytes: steps.reduce((total, step) => total + step.removedBytes, 0),
    },
  };
  result.reduction = reduction;
  // The block's own digits change the document size; measure until the recorded size is the size.
  reduction.actualBytes = measureReportBytes(result);
  const settled = measureReportBytes(result);
  if (settled !== reduction.actualBytes) reduction.actualBytes = settled;
  if (reduction.actualBytes > maxBytes) reduction.budgetUnsatisfied = true;
  return reduction;
}

export type BoundInspection = {
  result: InspectionResult;
  /** Present only when a reduction actually happened. */
  reduction?: ReportReduction;
};

/**
 * Fit an inspection into `maxBytes`, or return it untouched.
 *
 * Without a reduction the exact same object is returned, so a report generated without
 * `--max-report-bytes` stays byte-identical. With a reduction the document loses whole entries in
 * the ladder order; record contents and IDs of everything that remains are untouched, which keeps
 * every surviving citation resolvable.
 */
export function boundInspection(result: InspectionResult, maxBytes: number): BoundInspection {
  const originalBytes = measureReportBytes(result);
  if (originalBytes <= maxBytes) return { result };

  const document = structuredClone(result) as InspectionResult;
  const steps: ReportReductionStep[] = [];
  const target = Math.max(1, maxBytes - REDUCTION_RESERVE);
  let bytes = originalBytes;
  for (const step of LADDER) {
    if (bytes <= target) break;
    const before = bytes;
    const removedItems = step.detailsPath === undefined
      ? thinEvidenceKind(document, step.evidenceKind as string, target, bytes)
      : emptyDetailsArray(document, step.detailsPath);
    if (removedItems === 0) continue;
    bytes = measureReportBytes(document);
    steps.push({ id: step.id, removedItems, removedBytes: before - bytes });
  }

  const reduction = attachReduction(document, maxBytes, steps);
  return { result: document, reduction };
}
