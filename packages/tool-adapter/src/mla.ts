import { stat } from "node:fs/promises";
import path from "node:path";

import {
  analyzeDirectory,
  analyzeLogContent,
  analyzeZipFile,
  extractFrameworkSessions,
  loadFrameworkLogSources,
  readNodeTextFileContent
} from "@windsland52/maa-log-tools";
import {
  buildPreflightOutput,
  type PreflightOutput
} from "@windsland52/maa-log-tools/cli";
import type {
  FrameworkLogPosition,
  FrameworkSession,
  FrameworkVersionEvidence
} from "@windsland52/maa-log-tools";

export type MlaLogPosition = {
  source: string;
  path: string;
  line: number;
  timestamp: string | null;
};

export type MlaVersionEvidence = MlaLogPosition & {
  version: string;
};

export type MlaFrameworkSession = {
  session_id: string;
  start_kind: "process_start" | "partial_file";
  status: "resolved" | "missing_version" | "conflict";
  version: string | null;
  versions: string[];
  start: MlaLogPosition;
  end: MlaLogPosition;
  version_evidence: MlaVersionEvidence[];
};

export type MlaPreflightResult = {
  schema_version: "mde-mla-preflight/v1";
  mla_schema_version: string;
  compatibility: {
    status: "supported" | "unsupported";
    reason: string;
    parser_version: string | null;
    task_count: number;
    event_count: number;
    node_statistic_count: number;
    recognition_statistic_count: number;
  };
  framework: {
    status: "none" | "single" | "multiple" | "conflict";
    versions: string[];
    sessions: MlaFrameworkSession[];
  };
  warnings: string[];
};

const copyPosition = (position: FrameworkLogPosition): MlaLogPosition => ({
  source: position.source,
  path: position.path,
  line: position.line,
  timestamp: position.timestamp
});

const copyVersionEvidence = (
  evidence: FrameworkVersionEvidence
): MlaVersionEvidence => ({
  ...copyPosition(evidence),
  version: evidence.version
});

const copySession = (session: FrameworkSession): MlaFrameworkSession => ({
  session_id: session.sessionId,
  start_kind: session.startKind,
  status: session.status,
  version: session.version,
  versions: [...session.versions],
  start: copyPosition(session.start),
  end: copyPosition(session.end),
  version_evidence: session.versionEvidence.map(copyVersionEvidence)
});

const translatePreflight = (preflight: PreflightOutput): MlaPreflightResult => ({
  schema_version: "mde-mla-preflight/v1",
  mla_schema_version: preflight.schemaVersion,
  compatibility: {
    status: preflight.status,
    reason: preflight.reason,
    parser_version: preflight.parserVersion,
    task_count: preflight.taskCount,
    event_count: preflight.eventCount,
    node_statistic_count: preflight.nodeStatisticCount,
    recognition_statistic_count: preflight.recognitionStatisticCount
  },
  framework: {
    status: preflight.frameworkVersionSummary.status,
    versions: [...preflight.frameworkVersionSummary.versions],
    sessions: preflight.frameworkSessions.map(copySession)
  },
  warnings: [...preflight.warnings]
});

export async function runMlaPreflight(targetPath: string): Promise<MlaPreflightResult> {
  const resolvedPath = path.resolve(targetPath);
  const targetStat = await stat(resolvedPath);
  const framework = extractFrameworkSessions(
    await loadFrameworkLogSources(resolvedPath)
  );

  let output = null;
  if (targetStat.isDirectory()) {
    output = await analyzeDirectory({ directoryPath: resolvedPath });
  } else if (resolvedPath.toLowerCase().endsWith(".zip")) {
    output = await analyzeZipFile({ zipFilePath: resolvedPath });
  } else {
    output = await analyzeLogContent({
      content: await readNodeTextFileContent(resolvedPath)
    });
  }

  return translatePreflight(buildPreflightOutput(output, framework));
}
