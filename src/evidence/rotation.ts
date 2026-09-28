import path from "node:path";

import type { Artifact } from "./types.js";

/**
 * Structural rotation semantics of MaaFramework log file names.
 *
 * A `maafw.bak.<T>.log` name carries the rotation boundary `T`, measured against the file's own
 * last log line, so a chain of names yields a monotonic sequence of boundaries without reading any
 * file content. These are name-derived locators, not content facts: the basis field says so, and
 * `mtime` never participates because extraction stamps every extracted file with the same
 * extraction time.
 */

export const ROTATION_TIME_BASIS = "rotation-filename" as const;

/**
 * A timestamp within this window of a rotation boundary cannot be assigned to one side of the
 * boundary: the next file's first line trails its name boundary by a few dozen milliseconds, so a
 * point this close to the edge belongs to neither file with certainty.
 */
export const ROTATION_BOUNDARY_AMBIGUITY_MS = 25;

const ROTATION_TIMESTAMPED = /^maafw\.(?:bak\.)?(\d{4})\.(\d{2})\.(\d{2})-(\d{2})\.(\d{2})\.(\d{2})\.(\d{3})\.log$/;

/**
 * Active (undated) MaaFramework log names. They sit at the end of their rotation family and never
 * carry a name boundary of their own.
 */
const ROTATION_UNDATED = /^(?:maa|maa\.bak|maafw)\.log$|^maafw\..+\.log$/;

export type RotationCoverage = {
  rotation: { family: string; index: number };
  timeCoverage: {
    basis: typeof ROTATION_TIME_BASIS;
    from: string | null;
    to: string | null;
    fromKnown: boolean;
    toKnown: boolean;
  };
};

type FamilyMember = {
  relativePath: string;
  timestamp: string | null;
};

function rotationTimestamp(name: string): string | null {
  const stamped = ROTATION_TIMESTAMPED.exec(name);
  if (stamped !== null) {
    return `${stamped[1]}-${stamped[2]}-${stamped[3]}T${stamped[4]}:${stamped[5]}:${stamped[6]}.${stamped[7]}`;
  }
  return null;
}

function isRotationMember(kind: Artifact["kind"], name: string): boolean {
  if (kind !== "maa_log") return false;
  return ROTATION_TIMESTAMPED.test(name) || ROTATION_UNDATED.test(name);
}

/**
 * Label one rotation family. The family is a directory: the root directory's own family carries
 * the root's basename, deeper families carry their portable relative directory path.
 */
export function rotationFamilyLabel(rootPath: string, relativePath: string): string {
  const directory = path.posix.dirname(relativePath);
  if (directory === "." || directory === "/") {
    const base = path.basename(rootPath);
    return base.length === 0 ? "." : base;
  }
  return directory;
}

/**
 * Derive rotation membership and name-based time coverage for every artifact of one inspected
 * root. Pure over the artifact records: only relative paths and kinds are read, never file
 * contents or modification times.
 *
 * Members of a family are ordered by their name timestamp and then by path, with undated (active)
 * members after every dated one. `timeCoverage.from` is the previous dated boundary in the family
 * and `to` is the member's own boundary; an undated member has no boundary of its own and starts
 * after the last dated one. Endpoints that the names cannot provide stay explicitly `null`.
 */
export function deriveRotationCoverage(
  artifacts: readonly Pick<Artifact, "relativePath" | "kind">[],
  rootPath: string,
): Map<string, RotationCoverage> {
  const families = new Map<string, FamilyMember[]>();
  for (const artifact of artifacts) {
    const name = path.posix.basename(artifact.relativePath);
    if (!isRotationMember(artifact.kind, name)) continue;
    const family = rotationFamilyLabel(rootPath, artifact.relativePath);
    const members = families.get(family) ?? [];
    members.push({ relativePath: artifact.relativePath, timestamp: rotationTimestamp(name) });
    families.set(family, members);
  }
  const coverage = new Map<string, RotationCoverage>();
  for (const [family, members] of families) {
    const dated = members
      .filter((member) => member.timestamp !== null)
      .sort((left, right) => (left.timestamp ?? "").localeCompare(right.timestamp ?? "")
        || left.relativePath.localeCompare(right.relativePath));
    const undated = members
      .filter((member) => member.timestamp === null)
      .sort((left, right) => left.relativePath.localeCompare(right.relativePath));
    const ordered = [...dated, ...undated];
    ordered.forEach((member, index) => {
      let from: string | null;
      if (member.timestamp !== null) {
        // Dated members occupy the front of `ordered`, so the previous entry is the previous
        // dated boundary.
        const previous = index > 0 ? ordered[index - 1] : undefined;
        from = previous !== undefined && previous.timestamp !== null ? previous.timestamp : null;
      } else {
        const lastDated = dated.length > 0 ? dated[dated.length - 1] : undefined;
        from = lastDated !== undefined ? lastDated.timestamp : null;
      }
      const to = member.timestamp;
      coverage.set(member.relativePath, {
        rotation: { family, index: index + 1 },
        timeCoverage: {
          basis: ROTATION_TIME_BASIS,
          from,
          to,
          fromKnown: from !== null,
          toKnown: to !== null,
        },
      });
    });
  }
  return coverage;
}
