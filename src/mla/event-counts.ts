import type { TimeRange } from "../evidence/index.js";

/**
 * Behavior-level keys shared by the raw-line counter and the aggregate extractors.
 *
 * A task id is deliberately absent: it is reused across processes and sessions, and the same
 * behavior observed under different tasks is one aggregate. NUL separates the parts so a node or
 * algorithm name that happens to contain a printable delimiter cannot merge two keys.
 */
export const recognitionBehaviorKey = (
  node: string,
  algorithm: string,
  status: "succeeded" | "failed",
): string => `${node}\u0000${algorithm}\u0000${status}`;

export const actionBehaviorKey = (
  node: string,
  action: string,
  status: "succeeded" | "failed",
): string => `${node}\u0000${action}\u0000${status}`;

/**
 * What `occurrenceCount` means, restated for every aggregate row so a consumer never has to infer
 * whether the number counts raw lines, deduplicated notifications, or task instances.
 *
 * The upstream parser drops a notification only when an identical `(message, details)` record was
 * already seen from a **different** `(Px, Tx)` source within ±1000 ms. Identical notifications from
 * the same source are kept, so this is cross-process mirror dedupe, not per-source dedupe.
 */
export const EVENT_COUNT_RULE =
  "occurrenceCount counts notifications that survived upstream cross-source mirror dedupe; "
  + "rawLineCount counts every matching !!!OnEventNotify!!! line before that rule. "
  + "Dedupe identity is (message, details) and applies only across different Px/Tx sources within 1000 ms; "
  + "same-source repeats are not removed and increment both counts.";

export type RawEventCounts = {
  recognition: ReadonlyMap<string, number>;
  action: ReadonlyMap<string, number>;
};

export type RawEventCounter = {
  /** Count event lines in one source's content. Callers may scan sources in any order. */
  scan: (content: string) => void;
  /** Count one already-split line; chunked sources call this with continuous line text. */
  scanLine: (line: string) => void;
  counts: () => RawEventCounts;
};

const EVENT_LINE_PATTERN =
  /^\[([^\]]+)\]\[([^\]]+)\]\[(Px[^\]]+)\]\[(Tx[^\]]+)\].*?!!!OnEventNotify!!!\s*\[handle=[^\]]*\]\s*\[msg=([^\]]+)\]\s*\[details=(.*)\]\s*$/u;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function timestampWithin(timestamp: string, range: TimeRange | undefined): boolean {
  if (range === undefined) return true;
  const value = Date.parse(timestamp);
  if (!Number.isFinite(value)) return false;
  if (range.from !== undefined && value < Date.parse(range.from)) return false;
  if (range.to !== undefined && value > Date.parse(range.to)) return false;
  return true;
}

/**
 * Count raw log lines that name a recognition or action behavior.
 *
 * The kernel output only contains notifications that survived mirror dedupe, so it cannot answer
 * "how many lines wrote this behavior". This counter reads the same source content MEK already
 * streams for overrides and framework sessions, before that dedupe, and groups by the behavior key
 * the aggregate extractors use.
 *
 * `rawLineCount` is intentionally a line count, not a second semantic count: a line whose payload
 * the extractor skipped still names the behavior, and mirrored copies of one notification still
 * count once per line. `occurrenceCount` remains the count of usable, deduplicated notifications.
 */
export function createRawEventCounter(timeRange?: TimeRange): RawEventCounter {
  const recognition = new Map<string, number>();
  const action = new Map<string, number>();

  const increment = (counts: Map<string, number>, key: string): void => {
    counts.set(key, (counts.get(key) ?? 0) + 1);
  };

  const scanLine = (line: string): void => {
    if (!line.includes("!!!OnEventNotify!!!")) return;
    const match = EVENT_LINE_PATTERN.exec(line);
    if (match === null) return;
    const timestamp = match[1];
    const message = match[5];
    const detailsJson = match[6];
    if (timestamp === undefined || message === undefined || detailsJson === undefined) return;
    if (!timestampWithin(timestamp, timeRange)) return;

    let details: unknown;
    try {
      details = JSON.parse(detailsJson);
    } catch {
      return;
    }
    if (!isRecord(details)) return;

    if (message === "Node.Recognition.Succeeded" || message === "Node.Recognition.Failed") {
      const recoDetails = details["reco_details"];
      if (!isRecord(recoDetails)) return;
      const algorithm = recoDetails["algorithm"];
      const node = recoDetails["name"];
      if (typeof algorithm !== "string" || typeof node !== "string") return;
      increment(
        recognition,
        recognitionBehaviorKey(node, algorithm, message === "Node.Recognition.Succeeded" ? "succeeded" : "failed"),
      );
      return;
    }

    if (message !== "Node.Action.Succeeded" && message !== "Node.Action.Failed") return;
    const actionDetails = details["action_details"];
    if (!isRecord(actionDetails)) return;
    const actionName = actionDetails["action"];
    if (typeof actionName !== "string" || actionName.length === 0) return;
    const detailName = actionDetails["name"];
    const payloadName = details["name"];
    const node = typeof detailName === "string" && detailName.length > 0
      ? detailName
      : typeof payloadName === "string" && payloadName.length > 0 ? payloadName : null;
    if (node === null) return;
    increment(
      action,
      actionBehaviorKey(node, actionName, message === "Node.Action.Succeeded" ? "succeeded" : "failed"),
    );
  };

  const scan = (content: string): void => {
    let start = 0;
    for (;;) {
      const newline = content.indexOf("\n", start);
      const end = newline === -1 ? content.length : newline;
      let line = content.slice(start, end);
      if (line.endsWith("\r")) line = line.slice(0, -1);
      scanLine(line);
      if (newline === -1) return;
      start = newline + 1;
    }
  };

  return { scan, scanLine, counts: () => ({ recognition, action }) };
}
