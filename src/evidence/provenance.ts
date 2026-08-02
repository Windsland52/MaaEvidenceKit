import path from "node:path";

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
