import path from "node:path";

import type { TimeRange } from "./types.js";

export function portablePath(target: string): string {
  return target.replaceAll(path.sep, "/");
}

export function relativePortablePath(root: string, target: string): string {
  const relative = path.relative(root, target);
  return portablePath(relative.length === 0 ? path.basename(target) : relative);
}

export function parseTimestamp(value: string, field: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${field} must be an ISO-8601 timestamp: ${value}`);
  }
  return parsed;
}

export function validateTimeRange(range: TimeRange | undefined): void {
  if (range?.from !== undefined) parseTimestamp(range.from, "timeRange.from");
  if (range?.to !== undefined) parseTimestamp(range.to, "timeRange.to");
  if (
    range?.from !== undefined
    && range.to !== undefined
    && Date.parse(range.from) > Date.parse(range.to)
  ) {
    throw new Error("timeRange.from must not be later than timeRange.to.");
  }
}
