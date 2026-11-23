import { Buffer } from "node:buffer";

import type { FrameworkSession, FrameworkSessionExtraction } from "@windsland52/maa-log-tools";

const PROCESS_START_PATTERN = /\]\[Logger\]\s+MAA Process Start(?:\s|$)/u;
const VERSION_PATTERN = /\]\[Logger\]\s+Version\s+(v\d+(?:\.\d+)+(?:[-+][0-9A-Za-z.-]+)?)(?:\s|$)/u;
const TIMESTAMP_PATTERN = /^\[(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d{1,3})?)\]/u;

/** Copy out of the chunk string so a timestamp does not retain a multi-megabyte slice. */
const copyText = (value: string): string => Buffer.from(value, "utf8").toString("utf8");

export type FrameworkSourceMeta = {
  path: string;
  reference: string;
};

export type FrameworkChunkAccumulator = {
  scanLine: (line: string, lineNumber: number) => void;
  finish: (meta: FrameworkSourceMeta) => FrameworkSessionExtraction;
};

type VersionHeader = { index: number; timestamp: string | null; version: string };

type OpenSession = {
  startIndex: number;
  startKind: "process_start" | "partial_file";
  firstTimestamp: string | null;
  lastTimestamp: string | null;
  versions: VersionHeader[];
};

/**
 * Streaming equivalent of `extractFrameworkSessions` for one chunked source.
 *
 * Sessions are closed at process-start boundaries, so this keeps only the open session (a few
 * version headers) and never allocates a timestamp table for every line. The 2.4GB corpus has
 * roughly three million log lines; retaining one timestamp entry per line was the dominant cost.
 */
export function createFrameworkChunkAccumulator(): FrameworkChunkAccumulator {
  const sessions: FrameworkSession[] = [];
  let lineIndex = 0;
  let sawProcessStart = false;
  let relevantBeforeFirstProcess = false;
  let open: OpenSession | null = null;

  const close = (endIndex: number): void => {
    if (open === null) return;
    const sessionIndex = sessions.length;
    const uniqueVersions = [...new Set(open.versions.map((header) => header.version))];
    const status: FrameworkSession["status"] = uniqueVersions.length === 0
      ? "missing_version"
      : uniqueVersions.length === 1 ? "resolved" : "conflict";
    sessions.push({
      sessionId: `framework-session-${sessionIndex + 1}`,
      startKind: open.startKind,
      status,
      version: status === "resolved" ? (uniqueVersions[0] ?? null) : null,
      versions: uniqueVersions,
      start: {
        source: "",
        path: "",
        line: open.startIndex + 1,
        timestamp: open.firstTimestamp,
      },
      end: {
        source: "",
        path: "",
        line: Math.max(open.startIndex, endIndex) + 1,
        timestamp: open.lastTimestamp,
      },
      versionEvidence: open.versions.map((header) => ({
        source: "",
        path: "",
        line: header.index + 1,
        timestamp: header.timestamp,
        version: header.version,
      })),
    });
    open = null;
  };

  const openSession = (startIndex: number, startKind: OpenSession["startKind"]): void => {
    open = {
      startIndex,
      startKind,
      firstTimestamp: null,
      lastTimestamp: null,
      versions: [],
    };
  };

  return {
    scanLine: (line: string, lineNumber: number): void => {
      const index = lineNumber - 1;
      lineIndex += 1;
      const rawTimestamp = TIMESTAMP_PATTERN.exec(line)?.[1] ?? null;
      const timestamp = rawTimestamp === null ? null : copyText(rawTimestamp);
      if (!sawProcessStart) {
        if (VERSION_PATTERN.test(line) || line.includes("!!!OnEventNotify!!!")) {
          relevantBeforeFirstProcess = true;
        }
      }
      if (PROCESS_START_PATTERN.test(line)) {
        if (!sawProcessStart) {
          sawProcessStart = true;
          if (index > 0 && relevantBeforeFirstProcess) {
            openSession(0, "partial_file");
            close(index - 1);
          }
        } else {
          close(index - 1);
        }
        openSession(index, "process_start");
      }
      if (open === null) {
        if (!sawProcessStart) {
          openSession(0, "partial_file");
        } else {
          openSession(index, "partial_file");
        }
      }
      if (timestamp !== null) {
        if (open!.firstTimestamp === null) open!.firstTimestamp = timestamp;
        open!.lastTimestamp = timestamp;
      }
      const rawVersion = VERSION_PATTERN.exec(line)?.[1];
      const version = rawVersion === undefined ? undefined : copyText(rawVersion);
      if (version !== undefined) open!.versions.push({ index, timestamp, version });
    },
    finish: (meta) => {
      if (open !== null) close(lineIndex - 1);
      if (sessions.length === 0 && lineIndex > 0) {
        // A source without a process start still yields one partial session.
        sessions.push({
          sessionId: "framework-session-1",
          startKind: "partial_file",
          status: "missing_version",
          version: null,
          versions: [],
          start: { source: meta.reference, path: meta.path, line: 1, timestamp: null },
          end: { source: meta.reference, path: meta.path, line: lineIndex, timestamp: null },
          versionEvidence: [],
        });
      }
      const withMeta = sessions.map((session) => ({
        ...session,
        start: { ...session.start, source: meta.reference, path: meta.path },
        end: { ...session.end, source: meta.reference, path: meta.path },
        versionEvidence: session.versionEvidence.map((item) => ({
          ...item,
          source: meta.reference,
          path: meta.path,
        })),
      }));
      const allVersions = [...new Set(withMeta.flatMap((session) => session.versions))];
      return {
        sessions: withMeta,
        summary: {
          status: withMeta.some((session) => session.status === "conflict")
            ? "conflict"
            : allVersions.length === 0
              ? "none"
              : allVersions.length === 1 ? "single" : "multiple",
          versions: allVersions,
        },
        warnings: [],
      };
    },
  };
}
