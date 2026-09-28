#!/usr/bin/env node
/**
 * MaaEvidenceKit efficiency benchmark - argument-driven, reproducible harness.
 *
 * Contract (kept deliberately narrow so every number means one thing):
 *   - The measured binary is always "<root>/dist/cli/main.js". The global npm shim is never used:
 *     its name resolution can hand off to another copy, which makes every number unattributable.
 *   - Nothing about the corpus is bundled or defaulted. --root, --corpus, and --workdir are required,
 *     and the corpus is gated on its fingerprint (22 files / 160,222,022 B) before anything runs, so
 *     a number produced here can only come from the reference material.
 *   - MAA_EVIDENCE_AUTO_UPDATE=0 is fixed for every child. The two telemetry conditions are measured
 *     separately: "teldef" (MAA_EVIDENCE_TELEMETRY untouched) and "teloff" (MAA_EVIDENCE_TELEMETRY=0).
 *   - Every item is preceded by two --version runs as the process/import startup baseline (minimum of
 *     the two, because machine load only adds time).
 *   - Per item: one cold run (first execution of that item in this session) plus five warm runs. The
 *     reported item numbers are the median of the five warm runs; the cold run is reported apart.
 *   - Every run is hashed (sha256 of stdout and of the report file) so a non-deterministic item is
 *     visible instead of averaged away.
 *   - Two windows: every question and every probe item runs under --window and again under --window2,
 *     and both are reported side by side with the delta. A single window is never reported silently.
 *   - Per question: callCount, the number of calls that did not reach an answer (idle calls), and the
 *     largest SINGLE return in bytes - the "one read blows up the context" figure, not the total.
 *
 * Not measured here on purpose: OS file-cache state is not flushed between runs (that needs
 * administrative privileges on Windows), so "cold" means "first execution of this item in this
 * session", not "cold cache".
 *
 * Usage:
 *   node scripts/bench/bench-mek.mjs --root <checkout> --corpus <extracted corpus> --workdir <dir>
 *        --window <from>..<to> --window2 <from>..<to>
 *        --root-cause-line <n> --root-cause-artifact <name> --root-cause-time <ISO>
 *        [--label <name>] [--quick] [--questions-only]
 *
 * Writes <workdir>/results/<label>.json plus the rendered reports under <workdir>/reports/ and prints
 * the human summary on stdout. Exit codes: 2 usage, 3 corpus fingerprint, 4 environment.
 */
import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { cpus } from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";

const BENCHMARK_VERSION = "bench-mek-v3";
const WARM_RUNS = 5;
/** Corpus fingerprint gate: the reference material is 22 files / 160,222,022 B. Files are not listed. */
const CORPUS_FILE_COUNT = 22;
const CORPUS_TOTAL_BYTES = 160222022;
/** Manifest budget from the efficiency design: the discovery-state manifest must stay under 8 KiB. */
const MANIFEST_BUDGET_BYTES = 8192;
const TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?$/u;
/** The CLI renders "unknown evidence id" for this; used only when a window has no failure record. */
const PLACEHOLDER_EVIDENCE_ID = "evidence-000000000000";
const PLACEHOLDER_ARTIFACT_ID = "artifact-000000000000";
const REQUIRED_OPTIONS = [
  ["--root", "root"],
  ["--corpus", "corpus"],
  ["--workdir", "workdir"],
  ["--window", "window"],
  ["--window2", "window2"],
  ["--root-cause-line", "rootCauseLine"],
  ["--root-cause-artifact", "rootCauseArtifact"],
  ["--root-cause-time", "rootCauseTime"],
];

const USAGE = [
  "Usage:",
  "  node scripts/bench/bench-mek.mjs --root <checkout> --corpus <extracted corpus> --workdir <dir>",
  "       --window <from>..<to> --window2 <from>..<to>",
  "       --root-cause-line <n> --root-cause-artifact <name> --root-cause-time <ISO>",
  "       [--label <name>] [--quick] [--questions-only]",
  "",
  "  --root                MaaEvidenceKit checkout whose dist/cli/main.js is the CLI under test.",
  "  --corpus              Extracted corpus directory. Gated on 22 files / 160,222,022 B.",
  "  --workdir             Where run artifacts are written (reports/, results/).",
  "  --window, --window2   Two <from>..<to> ISO windows; every question and probe runs under both.",
  "  --root-cause-line     Line of the root-cause record inside the raw material.",
  "  --root-cause-artifact Artifact file name expected to carry that line.",
  "  --root-cause-time     ISO instant inside that artifact's timeCoverage interval.",
  "  --label               Name of the results file (default: run).",
  "  --quick               Skip the item and probe batteries (questions and manifest still run).",
  "  --questions-only      Alias of --quick for the item and probe batteries.",
  "",
  "  Timestamps use the log's own fixed-width form, for example 2026-09-26T18:42:09.390.",
].join("\n");

// ---- arguments ----------------------------------------------------------------------------------

function refuse(message) {
  process.stderr.write("bench-mek: " + message + "\n\n" + USAGE + "\n");
  process.exit(2);
}

function fail(message, exitCode) {
  process.stderr.write("bench-mek: " + message + "\n");
  process.exit(exitCode);
}

function parseArgs(argv) {
  const options = { label: "run", quick: false, questionsOnly: false };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === "--quick") {
      options.quick = true;
      continue;
    }
    if (flag === "--questions-only") {
      options.questionsOnly = true;
      continue;
    }
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) refuse("missing value for " + flag);
    index += 1;
    if (flag === "--label") options.label = value;
    else if (flag === "--root") options.root = value;
    else if (flag === "--corpus") options.corpus = value;
    else if (flag === "--workdir") options.workdir = value;
    else if (flag === "--window") options.window = value;
    else if (flag === "--window2") options.window2 = value;
    else if (flag === "--root-cause-line") options.rootCauseLine = value;
    else if (flag === "--root-cause-artifact") options.rootCauseArtifact = value;
    else if (flag === "--root-cause-time") options.rootCauseTime = value;
    else refuse("unknown option " + flag);
  }
  const missing = REQUIRED_OPTIONS.filter(([, key]) => options[key] === undefined);
  if (missing.length > 0) {
    refuse("missing required option(s): " + missing.map(([flag]) => flag).join(", "));
  }
  return options;
}

/**
 * The log's own fixed-width form ("2026-09-26 18:42:09.422") and the CLI's window form
 * ("2026-09-26T18:42:09.422") both resolve here, with an optional fractional part. Comparing instants
 * as numbers keeps "…:09.39" and "…:09.390" equal instead of relying on string width.
 */
function instantValue(text) {
  const match = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?$/u.exec(text === undefined || text === null ? "" : text);
  if (match === null) return null;
  const fraction = match[7] === undefined ? "000" : (match[7] + "00").slice(0, 3);
  return Date.UTC(
    Number(match[1]), Number(match[2]) - 1, Number(match[3]),
    Number(match[4]), Number(match[5]), Number(match[6]), Number(fraction),
  );
}

function parseWindow(value, flag) {
  const parts = String(value).split("..");
  if (parts.length !== 2) refuse(flag + " expects <from>..<to>, received " + JSON.stringify(value));
  const [from, to] = parts;
  if (!TIMESTAMP_PATTERN.test(from) || !TIMESTAMP_PATTERN.test(to)) {
    refuse(flag + " expects two ISO timestamps like 2026-09-26T18:38:00, received " + JSON.stringify(value));
  }
  if (!(instantValue(from) < instantValue(to))) {
    refuse(flag + " expects from < to, received " + JSON.stringify(value));
  }
  return { from, to };
}

// ---- measurement primitives ---------------------------------------------------------------------

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function ms(value) {
  return value === null || value === undefined ? null : Math.round(value * 10) / 10;
}

function median(values) {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function git(root, args) {
  return execFileSync("git", ["-C", root, ...args], { encoding: "utf8" }).trim();
}

function readJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function runOnce(binary, args, options) {
  const env = options.env;
  const cwd = options.cwd;
  const outputFile = options.outputFile;
  const before = performance.now();
  let firstStdoutAt = null;
  let firstReportAt = null;
  const stdout = [];
  const stderr = [];
  if (outputFile !== undefined) rmSync(outputFile, { force: true });
  let poller = null;
  if (outputFile !== undefined) {
    poller = setInterval(() => {
      if (firstReportAt !== null) return;
      try {
        if (statSync(outputFile).size > 0) firstReportAt = performance.now();
      } catch {
        // not written yet
      }
    }, 2);
  }
  const child = spawn(process.execPath, [binary, ...args], {
    cwd,
    env,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (chunk) => {
    if (firstStdoutAt === null) firstStdoutAt = performance.now();
    stdout.push(chunk);
  });
  child.stderr.on("data", (chunk) => stderr.push(chunk));
  const settled = await new Promise((resolve) => {
    child.on("close", (code, signal) => resolve({ code, signal }));
    child.on("error", (error) => resolve({ code: -1, signal: String(error) }));
  });
  const ended = performance.now();
  if (poller !== null) clearInterval(poller);
  const stdoutBuffer = Buffer.concat(stdout);
  const stderrBuffer = Buffer.concat(stderr);
  const report = outputFile === undefined || !existsSync(outputFile) ? null : readFileSync(outputFile);
  return {
    wallMs: ms(ended - before),
    timeToOutputMs: ms(firstStdoutAt === null ? null : firstStdoutAt - before),
    timeToReportMs: ms(firstReportAt === null ? null : firstReportAt - before),
    stdoutBytes: stdoutBuffer.byteLength,
    stderrBytes: stderrBuffer.byteLength,
    reportBytes: report === null ? null : report.byteLength,
    exitCode: settled.code,
    signal: settled.signal,
    stdoutSha256: sha256(stdoutBuffer),
    reportSha256: report === null ? null : sha256(report),
    stdoutText: stdoutBuffer.toString("utf8"),
    stderrText: stderrBuffer.toString("utf8"),
  };
}

function summarize(run) {
  return {
    wallMs: run.wallMs,
    timeToOutputMs: run.timeToOutputMs,
    timeToReportMs: run.timeToReportMs,
    stdoutBytes: run.stdoutBytes,
    stderrBytes: run.stderrBytes,
    reportBytes: run.reportBytes,
    exitCode: run.exitCode,
  };
}

function medianOf(runs) {
  const keys = ["wallMs", "timeToOutputMs", "timeToReportMs", "stdoutBytes", "stderrBytes", "reportBytes"];
  const result = {};
  for (const key of keys) {
    const values = runs.map((run) => run[key]).filter((value) => value !== null && value !== undefined);
    result[key] = values.length === 0 ? null : ms(median(values));
  }
  result.exitCodes = [...new Set(runs.map((run) => run.exitCode))];
  return result;
}

function childEnvironment(base, telemetry) {
  const env = { ...base };
  if (telemetry === "teloff") env.MAA_EVIDENCE_TELEMETRY = "0";
  else delete env.MAA_EVIDENCE_TELEMETRY;
  return env;
}

async function measureItem(spec) {
  const env = childEnvironment(spec.environment, spec.telemetry);
  const resolvedOutput = spec.outputFile === undefined ? undefined : path.resolve(spec.workdir, spec.outputFile);
  const args = spec.args.map((value) => (value === "@out" ? spec.outputFile : value));
  const baseline = [];
  for (let index = 0; index < 2; index += 1) {
    const run = await runOnce(spec.binary, ["--version"], { env, cwd: spec.workdir });
    baseline.push(run.wallMs);
  }
  const startedAt = new Date().toISOString();
  const invoke = () => runOnce(spec.binary, args, { env, cwd: spec.workdir, outputFile: resolvedOutput });
  const cold = await invoke();
  const warm = [];
  for (let index = 0; index < WARM_RUNS; index += 1) warm.push(await invoke());
  const stdoutHashes = new Set([cold, ...warm].map((run) => run.stdoutSha256));
  const reportHashes = new Set([cold, ...warm].map((run) => run.reportSha256).filter((value) => value !== null));
  return {
    id: spec.id,
    title: spec.title,
    command: ["node", path.basename(spec.binary), ...args].join(" "),
    telemetry: spec.telemetry,
    startedAt,
    finishedAt: new Date().toISOString(),
    // Set by the caller, which re-hashes dist after every item: whether the build under measurement
    // was still the run's starting build when this item finished.
    buildStableAfterItem: null,
    startupBaselineMs: { samples: baseline.map(ms), min: ms(Math.min(...baseline)) },
    cold: Object.assign(summarize(cold), { stdoutSha256: cold.stdoutSha256, reportSha256: cold.reportSha256 }),
    warm: { samples: warm.map(summarize), median: medianOf(warm) },
    deterministicAcrossRuns: stdoutHashes.size === 1 && reportHashes.size <= 1,
    stdoutSha256: cold.stdoutSha256,
    reportSha256: cold.reportSha256,
    stderrEmpty: [cold, ...warm].every((run) => run.stderrBytes === 0),
  };
}

// ---- questions ----------------------------------------------------------------------------------

function allEvidence(document) {
  if (document === null || typeof document !== "object") return [];
  if (Array.isArray(document.evidence)) return document.evidence;
  if (document.evidence !== undefined) return [document.evidence];
  return [];
}

function parseTimestamp(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})\.(\d{3})$/u.exec(value === undefined || value === null ? "" : value);
  if (match === null) return null;
  return Date.UTC(
    Number(match[1]), Number(match[2]) - 1, Number(match[3]),
    Number(match[4]), Number(match[5]), Number(match[6]), Number(match[7]),
  );
}

/**
 * A call is idle when its return did not carry the fact the step exists to read: the output did not
 * parse, the command exited non-zero, or the field the step reads is absent. A question that never
 * reached an answer counts all of its calls as idle, because none of them bought the answer.
 */
async function askQuestion(spec, context) {
  const calls = [];
  const state = {};
  for (const step of spec.steps) {
    const args = step.args(state, context);
    const run = await runOnce(context.binary, args, { env: context.env, cwd: context.workdir });
    const call = {
      argv: ["node", path.basename(context.binary), ...args].join(" "),
      wallMs: run.wallMs,
      stdoutBytes: run.stdoutBytes,
      stdoutChars: run.stdoutText.length,
      stderrBytes: run.stderrBytes,
      returnBytes: run.stdoutBytes + run.stderrBytes,
      exitCode: run.exitCode,
      useful: false,
    };
    calls.push(call);
    step.consume(run, state);
    call.useful = step.useful(state) === true;
  }
  const answer = spec.answer(state, context);
  const answered = answer.answered === true;
  const returns = calls.map((call) => call.returnBytes);
  return {
    id: spec.id,
    question: spec.question,
    window: context.windowId,
    windowScoped: spec.windowScoped !== false,
    shared: spec.shared === true,
    calls,
    callCount: calls.length,
    idleCalls: answered ? calls.filter((call) => call.useful !== true).length : calls.length,
    stdoutBytes: calls.reduce((total, call) => total + call.stdoutBytes, 0),
    stderrBytes: calls.reduce((total, call) => total + call.stderrBytes, 0),
    returnBytes: calls.reduce((total, call) => total + call.returnBytes, 0),
    maxSingleReturnBytes: returns.length === 0 ? 0 : Math.max(...returns),
    answered,
    answer: answer.value,
    detail: answer.detail === undefined ? null : answer.detail,
  };
}

function windowQuestionSpecs(reportRelative) {
  return [
    {
      id: "q1-failing-node",
      question: "Which node failed, and where is it in the raw material?",
      steps: [
        {
          args: () => [
            "search", "--input", reportRelative, "--kind", "mla.failure",
            "--format", "json", "--fields",
            "evidence.id,evidence.summary,evidence.source.path,evidence.source.line,evidence.source.node",
          ],
          consume: (run, state) => {
            state.failures = allEvidence(readJson(run.stdoutText));
          },
          useful: (state) => state.failures.length > 0,
        },
      ],
      answer: (state, context) => {
        const located = state.failures.filter((item) =>
          item !== null && item !== undefined
          && item.source !== undefined
          && String(item.source.path === undefined ? "" : item.source.path).endsWith(context.rootCauseArtifact)
          && item.source.line === context.rootCauseLine);
        return {
          answered: located.length > 0,
          value: located.length === 0
            ? "no mla.failure record for " + context.rootCauseArtifact + ":" + context.rootCauseLine
            : located.map((item) => item.source.node + " @ " + item.source.path + ":" + item.source.line + " (" + item.id + ")").join("; "),
          detail: {
            failuresReported: state.failures.length,
            candidates: located.length,
            nodes: located.map((item) => item.source.node),
          },
        };
      },
    },
    {
      id: "q2-timeout-20s",
      question: "Which node hit the ~20 s timeout, and what span was observed?",
      steps: [
        {
          // The viewed record is this window's first mla.failure, so the two windows measure the same
          // one-view workload; whether that record is a ~20 s reco_timeout is the score, not a filter.
          args: (state, context) => [
            "view", "--input", reportRelative,
            "--evidence-id", context.failureEvidenceId === null ? PLACEHOLDER_EVIDENCE_ID : context.failureEvidenceId,
            "--format", "json", "--fields",
            "source.path,source.line,source.node,data.termination,data.started_at,data.ended_at",
          ],
          consume: (run, state) => {
            state.evidence = readJson(run.stdoutText);
          },
          useful: (state) => state.evidence !== null && state.evidence.data !== undefined,
        },
      ],
      answer: (state) => {
        const evidence = state.evidence === null || state.evidence === undefined ? null : state.evidence;
        const data = evidence === null ? null : (evidence.data === undefined ? null : evidence.data);
        const source = evidence === null ? null : (evidence.source === undefined ? null : evidence.source);
        const started = parseTimestamp(data === null ? null : data.started_at);
        const ended = parseTimestamp(data === null ? null : data.ended_at);
        const spanMs = started === null || ended === null ? null : ended - started;
        const termination = data === null ? undefined : data.termination;
        return {
          answered: termination === "reco_timeout" && spanMs !== null && spanMs >= 19000 && spanMs <= 21000,
          value: (source === null ? "?" : source.node)
            + " termination=" + (termination === undefined ? "?" : termination)
            + " spanMs=" + (spanMs === null ? "?" : spanMs)
            + " @ " + (source === null ? "?" : source.path + ":" + source.line),
          detail: {
            started: data === null ? null : data.started_at,
            ended: data === null ? null : data.ended_at,
            evidenceId: evidence === null ? null : evidence.id,
          },
        };
      },
    },
    {
      id: "q3-runtime-override",
      question: "Which pipeline nodes were overridden at runtime, and with which patch paths?",
      steps: [
        {
          // --limit 200 covers every override record: the default limit returns 50 of them, which
          // would make the node list look complete while it is not. Note that 9 of the 85 records
          // carry no source.node at all (multi-node context overrides), so the returned node list is
          // deliberately requested on its own: merging it with a full-length field in one --fields
          // call would silently drop it (mergeSelections keeps the left array when lengths differ).
          args: () => [
            "search", "--input", reportRelative, "--kind", "mla.pipeline_override", "--limit", "200",
            "--format", "json", "--fields", "totalMatches,returned,evidence.source.node",
          ],
          consume: (run, state) => {
            const document = readJson(run.stdoutText);
            state.overrides = document;
            const evidence = document === null ? [] : (document.evidence === undefined ? [] : document.evidence);
            state.nodes = [...new Set(evidence.map((item) => (item.source === undefined ? undefined : item.source.node)).filter(Boolean))];
          },
          useful: (state) => state.overrides !== null && (state.overrides.totalMatches === undefined ? 0 : state.overrides.totalMatches) > 0,
        },
        {
          args: () => [
            "search", "--input", reportRelative, "--kind", "mla.pipeline_override", "--limit", "1",
            "--format", "json", "--fields", "evidence.id",
          ],
          consume: (run, state) => {
            const document = readJson(run.stdoutText);
            const evidence = document === null ? [] : (document.evidence === undefined ? [] : document.evidence);
            state.firstId = evidence.length === 0 ? null : evidence[0].id;
          },
          useful: (state) => state.firstId !== null,
        },
        {
          // search projects each hit down to id/kind/source/summary, so the patch paths of one
          // record need one view call on its id.
          args: (state) => [
            "view", "--input", reportRelative,
            "--evidence-id", state.firstId === null ? PLACEHOLDER_EVIDENCE_ID : state.firstId,
            "--format", "json", "--fields", "source,data.scope,data.patchPaths",
          ],
          consume: (run, state) => {
            state.sample = readJson(run.stdoutText);
          },
          useful: (state) => state.sample !== null && state.sample.data !== undefined
            && Array.isArray(state.sample.data.patchPaths) && state.sample.data.patchPaths.length > 0,
        },
      ],
      answer: (state) => {
        const total = state.overrides === null ? null : state.overrides.totalMatches;
        const returned = state.overrides === null ? null : state.overrides.returned;
        const patchPaths = state.sample === null ? null : state.sample.data.patchPaths;
        return {
          answered: (total === null || total === undefined ? 0 : total) > 0
            && state.nodes.length > 0
            && total === returned
            && patchPaths !== undefined && patchPaths.length > 0,
          // 9 of the 85 override records carry no source.node at all (multi-node context overrides).
          value: String(total === undefined ? "?" : total) + " override records (" + String(returned === undefined ? "?" : returned)
            + " returned) over " + state.nodes.length + " distinct nodes; sample patch paths for "
            + (state.sample === null ? "?" : (state.sample.source.node === undefined ? "(multi-node context override)" : state.sample.source.node)) + ": "
            + (patchPaths === undefined ? "?" : patchPaths.join(",")),
          detail: { nodes: state.nodes, totalMatches: total === undefined ? null : total },
        };
      },
    },
    {
      id: "q4-mirror-dedup",
      question: "How much of the material mirrors another artifact, and what are the groups?",
      steps: [
        {
          args: () => ["view", "--input", reportRelative, "--format", "json", "--fields", "statistics"],
          consume: (run, state) => {
            const document = readJson(run.stdoutText);
            state.statistics = document === null ? null : document.statistics;
          },
          useful: (state) => state.statistics !== null && state.statistics !== undefined,
        },
        {
          args: () => [
            "search", "--input", reportRelative, "--kind", "mla.possible_mirrored_task_group",
            "--format", "json", "--fields", "totalMatches,evidence.id,evidence.source.task",
          ],
          consume: (run, state) => {
            const document = readJson(run.stdoutText);
            state.groups = document;
            const evidence = document === null ? [] : (document.evidence === undefined ? [] : document.evidence);
            state.groupId = evidence.length === 0 ? null : evidence[0].id;
          },
          useful: (state) => state.groups !== null && allEvidence(state.groups).length > 0,
        },
        {
          args: (state) => [
            "view", "--input", reportRelative,
            "--evidence-id", state.groupId === null ? PLACEHOLDER_EVIDENCE_ID : state.groupId,
            "--format", "json", "--fields", "source.task,data.memberCount,data.namespaces",
          ],
          consume: (run, state) => {
            state.groupSample = readJson(run.stdoutText);
          },
          useful: (state) => state.groupSample !== null && state.groupSample.data !== undefined
            && typeof state.groupSample.data.memberCount === "number",
        },
      ],
      answer: (state) => {
        const statistics = state.statistics === null || state.statistics === undefined ? {} : state.statistics;
        const groupsTotal = state.groups === null ? null : state.groups.totalMatches;
        const members = state.groupSample === null ? null : state.groupSample.data.memberCount;
        return {
          answered: statistics.possibleMirroredTaskGroups !== undefined
            && statistics.crossArtifactDuplicateObservations !== undefined
            && (groupsTotal === null || groupsTotal === undefined ? 0 : groupsTotal) > 0
            && (members === null || members === undefined ? 0 : members) > 1,
          value: "byteIdenticalArtifactRecordsDeduplicated=" + statistics.byteIdenticalArtifactRecordsDeduplicated
            + ", crossArtifactDuplicateObservations=" + statistics.crossArtifactDuplicateObservations
            + ", possibleMirroredTaskGroups=" + statistics.possibleMirroredTaskGroups
            + ", groupsReported=" + groupsTotal,
          detail: {
            groups: (state.groups === null ? [] : allEvidence(state.groups))
              .map((item) => (item.source === undefined ? null : item.source.task)),
            sampleNamespaces: state.groupSample === null ? null : state.groupSample.data.namespaces,
          },
        };
      },
    },
  ];
}

/**
 * q5 replaced the upstream fast-entry probe: the only input is the discovery-state manifest, which
 * never reads artifact content. The score is whether the manifest alone names the artifact carrying
 * the root-cause line, plus the bytes it took to say so.
 *
 * The manifest is a discovery-state document: its command takes no window, so this one measurement is
 * reported under both windows marked shared rather than being silently dropped from the comparison.
 */
function manifestQuestionSpec() {
  return {
    id: "q5-manifest-artifact",
    question: "Given only `mla inspect <corpus> --format manifest`, which artifact carries the root-cause line?",
    windowScoped: false,
    shared: true,
    steps: [
      {
        args: (state, context) => ["mla", "inspect", context.corpusArg, "--format", "manifest"],
        consume: (run, state) => {
          state.manifest = readJson(run.stdoutText);
          state.manifestBytes = run.stdoutBytes;
        },
        useful: (state) => state.manifest !== null && Array.isArray(state.manifest.artifacts),
      },
    ],
    answer: (state, context) => {
      const document = state.manifest;
      const bytesConsumed = state.manifestBytes === undefined ? null : state.manifestBytes;
      if (document === null) {
        return {
          answered: false,
          value: "the manifest output did not parse as JSON",
          detail: {
            namedArtifact: null,
            expectedArtifact: context.rootCauseArtifact,
            bytesConsumed,
            budgetBytes: MANIFEST_BUDGET_BYTES,
            matchedArtifacts: [],
            assertions: {
              exactlyOneArtifactMatches: false,
              namedArtifactIsExpected: false,
              extractionNotRun: false,
              bytesWithinBudget: bytesConsumed !== null && bytesConsumed <= MANIFEST_BUDGET_BYTES,
            },
            covered: false,
          },
        };
      }
      const artifacts = Array.isArray(document.artifacts) ? document.artifacts : [];
      const target = instantValue(context.rootCauseTime);
      const matches = artifacts.filter((artifact) => coversInstant(artifact.timeCoverage, target));
      const named = matches.length === 1 ? matches[0].path : null;
      const namedBase = named === null ? null : path.basename(named);
      const assertions = {
        exactlyOneArtifactMatches: matches.length === 1,
        namedArtifactIsExpected: namedBase === context.rootCauseArtifact,
        extractionNotRun: document.input !== undefined && document.input.extraction === "not-run",
        bytesWithinBudget: bytesConsumed !== null && bytesConsumed <= MANIFEST_BUDGET_BYTES,
      };
      const failed = Object.keys(assertions).filter((key) => assertions[key] !== true);
      const covered = failed.length === 0;
      return {
        answered: covered,
        value: named === null
          ? "no unique artifact covers " + context.rootCauseTime + " (" + matches.length + " interval matches)"
          : named + (covered ? " (all assertions hold)" : " (assertion failed: " + failed.join(", ") + ")"),
        detail: {
          namedArtifact: named,
          expectedArtifact: context.rootCauseArtifact,
          bytesConsumed,
          budgetBytes: MANIFEST_BUDGET_BYTES,
          schemaVersion: document.schemaVersion === undefined ? null : document.schemaVersion,
          extraction: document.input === undefined ? null : document.input.extraction,
          artifactCount: artifacts.length,
          matchedArtifacts: matches.map((artifact) => ({ path: artifact.path, timeCoverage: artifact.timeCoverage })),
          assertions,
          covered,
        },
      };
    },
  };
}

/**
 * Containment in the manifest's own timeCoverage interval, with a null bound read as an open end (the
 * family's live member). A null "from" means the first dated boundary is unknown, so nothing is
 * claimed about it.
 */
function coversInstant(timeCoverage, target) {
  if (timeCoverage === null || timeCoverage === undefined || target === null) return false;
  const from = timeCoverage.from === null || timeCoverage.from === undefined ? null : instantValue(timeCoverage.from);
  if (from === null || target < from) return false;
  const to = timeCoverage.to === null || timeCoverage.to === undefined ? null : instantValue(timeCoverage.to);
  if (to === null) return true;
  return target <= to;
}

// ---- corpus -------------------------------------------------------------------------------------

function walkFiles(directory) {
  const files = [];
  const walk = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) walk(absolute);
      else files.push(absolute);
    }
  };
  walk(directory);
  return files.sort();
}

/**
 * sha256 of every built .js under <root>/dist. The benchmark hashes the build before it starts and
 * again when it finishes: a rebuild landing mid-run (still one command away in the same repository)
 * would otherwise make the numbers unattributable without leaving a trace.
 */
function distDigests(distRoot, root) {
  return Object.fromEntries(readdirSync(distRoot, { recursive: true })
    .filter((entry) => typeof entry === "string" && entry.endsWith(".js"))
    .map((entry) => path.resolve(distRoot, entry))
    .sort()
    .map((file) => [path.relative(root, file).replace(/\\/gu, "/"), sha256(readFileSync(file))]));
}

function corpusFingerprint(corpusPath) {
  const files = walkFiles(corpusPath);
  return {
    fileCount: files.length,
    totalBytes: files.reduce((total, file) => total + statSync(file).size, 0),
    files,
  };
}

function corpusInventory(corpusPath, files) {
  let logLines = 0;
  const inventory = files.map((file) => {
    const relative = path.relative(corpusPath, file).split(path.sep).join("/");
    const isLog = relative.toLowerCase().endsWith(".log");
    const content = readFileSync(file);
    const lines = isLog ? content.toString("utf8").split("\n").length - 1 : null;
    if (lines !== null) logLines += lines;
    return { path: relative, bytes: content.byteLength, lines, sha256: sha256(content) };
  });
  return {
    fileCount: inventory.length,
    totalBytes: inventory.reduce((total, item) => total + item.bytes, 0),
    logLines,
    files: inventory,
  };
}

// ---- summary ------------------------------------------------------------------------------------

function deltaOf(before, after) {
  if (typeof before !== "number" || typeof after !== "number") return null;
  return {
    absolute: Math.round((after - before) * 10) / 10,
    percent: before === 0 ? null : Math.round(((after - before) / before) * 1000) / 10,
  };
}

function itemById(items, id) {
  return items.find((item) => item.id === id);
}

function questionColumn(question) {
  if (question === undefined) return null;
  return {
    answered: question.answered,
    callCount: question.callCount,
    idleCalls: question.idleCalls,
    stdoutBytes: question.stdoutBytes,
    stderrBytes: question.stderrBytes,
    returnBytes: question.returnBytes,
    maxSingleReturnBytes: question.maxSingleReturnBytes,
    answer: question.answer,
  };
}

function buildSummary(windows, parseItemId) {
  const [first, second] = windows;
  const parseColumn = (window) => {
    const item = itemById(window.items, parseItemId);
    return {
      window: window.id,
      from: window.from,
      to: window.to,
      item: parseItemId,
      coldWallMs: item === undefined ? null : item.cold.wallMs,
      warmWallMs: item === undefined ? null : item.warm.median.wallMs,
      warmStdoutBytes: item === undefined ? null : item.warm.median.stdoutBytes,
      warmReportBytes: item === undefined ? null : item.warm.median.reportBytes,
      reportBytes: window.report.bytes,
      reportSha256: window.report.sha256,
    };
  };
  const parse = {
    window1: parseColumn(first),
    window2: parseColumn(second),
    delta: null,
  };
  parse.delta = {
    warmWallMs: deltaOf(parse.window1.warmWallMs, parse.window2.warmWallMs),
    warmReportBytes: deltaOf(parse.window1.warmReportBytes, parse.window2.warmReportBytes),
  };

  const questionIds = first.questions.map((question) => question.id);
  const perQuestion = questionIds.map((id) => {
    const left = questionColumn(itemById(first.questions, id));
    const right = questionColumn(itemById(second.questions, id));
    const shared = (itemById(first.questions, id) === undefined ? second.questions.find((item) => item.id === id) : itemById(first.questions, id)).shared === true;
    return {
      id,
      question: (itemById(first.questions, id) === undefined ? second.questions.find((item) => item.id === id) : itemById(first.questions, id)).question,
      shared,
      window1: left,
      window2: right,
      delta: {
        callCount: deltaOf(left === null ? null : left.callCount, right === null ? null : right.callCount),
        idleCalls: deltaOf(left === null ? null : left.idleCalls, right === null ? null : right.idleCalls),
        stdoutBytes: deltaOf(left === null ? null : left.stdoutBytes, right === null ? null : right.stdoutBytes),
        maxSingleReturnBytes: deltaOf(left === null ? null : left.maxSingleReturnBytes, right === null ? null : right.maxSingleReturnBytes),
      },
    };
  });

  const probeIds = first.followUps.map((item) => item.id);
  const perProbe = probeIds.map((id) => {
    const left = itemById(first.followUps, id);
    const right = itemById(second.followUps, id);
    return {
      id,
      title: (left === undefined ? right : left).title,
      window1WarmWallMs: left === undefined ? null : left.warm.median.wallMs,
      window2WarmWallMs: right === undefined ? null : right.warm.median.wallMs,
      deltaWarmWallMs: deltaOf(left === undefined ? null : left.warm.median.wallMs, right === undefined ? null : right.warm.median.wallMs),
      window1WarmStdoutBytes: left === undefined ? null : left.warm.median.stdoutBytes,
      window2WarmStdoutBytes: right === undefined ? null : right.warm.median.stdoutBytes,
      window1ExitCodes: left === undefined ? [] : left.warm.median.exitCodes,
      window2ExitCodes: right === undefined ? [] : right.warm.median.exitCodes,
    };
  });

  // A shared question (q5) is reported under both windows but executed once, so the run totals and
  // the run maximum count it once.
  const allQuestions = windows.flatMap((window) => window.questions);
  const measured = [];
  for (const question of allQuestions) {
    if (question.shared === true && measured.some((item) => item.id === question.id)) continue;
    measured.push(question);
  }
  const label = (question) => question.id + "@" + (question.window === null ? "shared" : question.window);
  const maxReturn = measured.reduce((best, question) => (
    best === null || question.maxSingleReturnBytes > best.bytes
      ? { bytes: question.maxSingleReturnBytes, questionId: question.id, window: question.window === null ? "shared" : question.window, answer: question.answer }
      : best
  ), null);
  const shared = measured.filter((question) => question.shared === true);

  return {
    windows: windows.map((window) => ({ id: window.id, from: window.from, to: window.to })),
    parse,
    perQuestion,
    perProbe,
    maxSingleReturnBytes: maxReturn,
    idleCalls: {
      totalCalls: measured.reduce((total, question) => total + question.callCount, 0),
      totalIdleCalls: measured.reduce((total, question) => total + question.idleCalls, 0),
      unanswered: measured.filter((question) => !question.answered).map(label),
    },
    q5Manifest: shared.length === 0 ? null : shared[0].detail,
  };
}

// ---- rendering ----------------------------------------------------------------------------------

function tableRow(cells) {
  return "| " + cells.join(" | ") + " |";
}

function renderItemTable(items) {
  const lines = [];
  if (items.length === 0) {
    lines.push("(not measured: --quick / --questions-only)");
    return lines;
  }
  lines.push(tableRow(["item", "telemetry", "baseline ms", "cold ms", "warm wall ms", "to stdout ms", "to report ms", "stdout B", "stderr B", "report B", "det."]));
  lines.push(tableRow(["---", "---", "---", "---", "---", "---", "---", "---", "---", "---", "---"]));
  for (const item of items) {
    const steady = item.warm.median;
    lines.push(tableRow([
      item.id,
      item.telemetry,
      String(item.startupBaselineMs.min),
      String(item.cold.wallMs),
      String(steady.wallMs),
      String(steady.timeToOutputMs),
      String(steady.timeToReportMs),
      String(steady.stdoutBytes),
      String(steady.stderrBytes),
      String(steady.reportBytes),
      item.deterministicAcrossRuns ? "yes" : "NO",
    ]));
  }
  return lines;
}

function renderMarkdown(report) {
  const lines = [];
  const summary = report.summary;
  lines.push("# MEK efficiency benchmark - " + report.label);
  lines.push("");
  lines.push("- binary: `" + report.binary.path + "` (version " + report.binary.version + ", package " + report.binary.packageVersion + ")");
  lines.push("- commit: `" + report.git.short + "` (" + report.git.commit + ")" + (report.git.dirty ? " - dirty: " + report.git.status.join("; ") : " - clean"));
  lines.push("- node " + report.environment.node + ", " + report.environment.cpus + " CPUs, AUTO_UPDATE=" + report.environment.autoUpdate + ", telemetry=" + report.environment.telemetryStatus);
  lines.push("- corpus: " + report.corpus.fileCount + " files, " + report.corpus.totalBytes + " B, " + report.corpus.logLines + " log lines (fingerprint gate: "
    + report.corpus.fingerprint.expectedFiles + " files / " + report.corpus.fingerprint.expectedBytes + " B expected)");
  lines.push("- windows: window1 " + report.windows[0].from + " .. " + report.windows[0].to + "; window2 " + report.windows[1].from + " .. " + report.windows[1].to);
  lines.push("- clock: cold = first run of the item; warm = median of " + report.definitions.warmRuns + " runs; startup baseline = min of two --version runs in the same environment");
  if (report.binary.changedDuringRun) lines.push("- WARNING: the build under measurement changed during the run (dist digests differ before/after)");
  lines.push("");

  lines.push("## Cold/warm parse timing, both windows");
  lines.push("");
  lines.push(tableRow(["window", "from", "to", "cold ms", "warm wall ms", "warm stdout B", "warm report B", "report B", "report sha256"]));
  lines.push(tableRow(["---", "---", "---", "---", "---", "---", "---", "---", "---"]));
  for (const column of [summary.parse.window1, summary.parse.window2]) {
    lines.push(tableRow([
      column.window,
      column.from,
      column.to,
      String(column.coldWallMs),
      String(column.warmWallMs),
      String(column.warmStdoutBytes),
      String(column.warmReportBytes),
      String(column.reportBytes),
      String(column.reportSha256).slice(0, 16) + "...",
    ]));
  }
  lines.push("");
  lines.push("- delta window2-window1 (warm wall): " + formatDelta(summary.parse.delta.warmWallMs)
    + "; (warm report bytes): " + formatDelta(summary.parse.delta.warmReportBytes));
  lines.push("");

  lines.push("## Window item battery");
  lines.push("");
  for (const window of report.windows) {
    lines.push("### " + window.id + " (" + window.from + " .. " + window.to + ")");
    lines.push("");
    lines.push(...renderItemTable(window.items));
    lines.push("");
  }

  lines.push("## Window-independent items");
  lines.push("");
  lines.push(...renderItemTable(report.items));
  lines.push("");

  lines.push("## Probe items, both windows");
  lines.push("");
  for (const window of report.windows) {
    lines.push("### " + window.id + " (" + window.from + " .. " + window.to + ")");
    lines.push("");
    lines.push(...renderItemTable(window.followUps));
    lines.push("");
    lines.push("Inputs: " + JSON.stringify(window.inputs));
    lines.push("");
  }
  lines.push(tableRow(["probe", "window1 warm ms", "window2 warm ms", "delta ms", "window1 exit", "window2 exit"]));
  lines.push(tableRow(["---", "---", "---", "---", "---", "---"]));
  for (const probe of summary.perProbe) {
    lines.push(tableRow([
      probe.id,
      String(probe.window1WarmWallMs),
      String(probe.window2WarmWallMs),
      formatDelta(probe.deltaWarmWallMs),
      JSON.stringify(probe.window1ExitCodes),
      JSON.stringify(probe.window2ExitCodes),
    ]));
  }
  lines.push("");

  lines.push("## Questions, both windows");
  lines.push("");
  lines.push(tableRow(["question", "window", "calls", "idle calls", "max single return B", "stdout B total", "answered", "answer"]));
  lines.push(tableRow(["---", "---", "---", "---", "---", "---", "---", "---"]));
  for (const window of report.windows) {
    for (const question of window.questions) {
      lines.push(tableRow([
        question.id,
        question.shared === true ? window.id + " (shared)" : window.id,
        String(question.callCount),
        String(question.idleCalls),
        String(question.maxSingleReturnBytes),
        String(question.stdoutBytes),
        question.answered ? "yes" : "NO",
        question.answer.replace(/\|/gu, "\\|"),
      ]));
    }
  }
  lines.push("");
  lines.push(tableRow(["question", "calls w1", "calls w2", "idle w1", "idle w2", "max return w1 B", "max return w2 B", "max return delta"]));
  lines.push(tableRow(["---", "---", "---", "---", "---", "---", "---", "---"]));
  for (const question of summary.perQuestion) {
    lines.push(tableRow([
      question.id + (question.shared ? " (shared)" : ""),
      cell(question.window1, "callCount"),
      cell(question.window2, "callCount"),
      cell(question.window1, "idleCalls"),
      cell(question.window2, "idleCalls"),
      cell(question.window1, "maxSingleReturnBytes"),
      cell(question.window2, "maxSingleReturnBytes"),
      formatDelta(question.delta.maxSingleReturnBytes),
    ]));
  }
  lines.push("");
  lines.push("- calls that did not reach an answer (idle), all questions: " + summary.idleCalls.totalIdleCalls + " of " + summary.idleCalls.totalCalls
    + (summary.idleCalls.unanswered.length === 0 ? "" : " (unanswered: " + summary.idleCalls.unanswered.join(", ") + ")"));
  lines.push("- run maximum single tool return: " + String(summary.maxSingleReturnBytes.bytes) + " B from " + summary.maxSingleReturnBytes.questionId
    + " on " + String(summary.maxSingleReturnBytes.window));
  lines.push("");

  lines.push("## q5 - manifest-only artifact naming");
  lines.push("");
  if (summary.q5Manifest === null) {
    lines.push("- not measured");
  } else {
    const q5 = summary.q5Manifest;
    lines.push("- named artifact: " + String(q5.namedArtifact) + " (expected " + q5.expectedArtifact + ")");
    lines.push("- bytes consumed: " + String(q5.bytesConsumed) + " B of a " + q5.budgetBytes + " B budget");
    lines.push("- extraction: " + String(q5.extraction) + ", artifacts in manifest: " + String(q5.artifactCount) + ", schema " + String(q5.schemaVersion));
    lines.push("- assertions: " + Object.entries(q5.assertions).map(([key, value]) => key + "=" + (value ? "hold" : "FAILED")).join(", "));
    lines.push("- covered: " + (q5.covered ? "yes" : "NO")
      + " (the replaced upstream fast path cost 30,099 B for a directory and 188,785 B for one rotated file)");
  }
  lines.push("");
  lines.push("- results json: " + report.resultsPath);
  return lines.join("\n") + "\n";
}

function cell(column, key) {
  return column === null ? "n/a" : String(column[key]);
}

function formatDelta(delta) {
  if (delta === null) return "n/a";
  const absolute = delta.absolute >= 0 ? "+" + delta.absolute : String(delta.absolute);
  if (delta.percent === null) return absolute + " (n/a %)";
  return absolute + " (" + (delta.percent >= 0 ? "+" : "") + delta.percent + "%)";
}

// ---- main ---------------------------------------------------------------------------------------

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const root = path.resolve(options.root);
  const corpusPath = path.resolve(options.corpus);
  const workdir = path.resolve(options.workdir);
  const rootCauseLine = Number(options.rootCauseLine);
  if (!Number.isInteger(rootCauseLine) || rootCauseLine <= 0) {
    refuse("--root-cause-line expects a positive integer, received " + JSON.stringify(options.rootCauseLine));
  }
  if (!TIMESTAMP_PATTERN.test(options.rootCauseTime)) {
    refuse("--root-cause-time expects an ISO timestamp like 2026-09-26T18:42:09.390, received " + JSON.stringify(options.rootCauseTime));
  }
  const windows = [
    Object.assign({ id: "window1" }, parseWindow(options.window, "--window"), { reportRelative: "reports/window-1.json" }),
    Object.assign({ id: "window2" }, parseWindow(options.window2, "--window2"), { reportRelative: "reports/window-2.json" }),
  ];
  if (instantValue(windows[0].from) === instantValue(windows[1].from)
    && instantValue(windows[0].to) === instantValue(windows[1].to)) {
    refuse("--window and --window2 are identical; the second window is the contrast axis and a fallback to one window is never silent.");
  }

  const binary = path.resolve(root, "dist/cli/main.js");
  const binaryRelative = path.relative(root, binary);
  if (binaryRelative.startsWith("..") || path.isAbsolute(binaryRelative)) {
    fail("refusing a binary outside the checkout: " + binary, 4);
  }
  if (!existsSync(binary)) fail("missing checkout build: " + binary + " (run pnpm build in " + root + ")", 4);

  const fingerprint = corpusFingerprint(corpusPath);
  if (fingerprint.fileCount !== CORPUS_FILE_COUNT || fingerprint.totalBytes !== CORPUS_TOTAL_BYTES) {
    process.stderr.write(
      "bench-mek: refusing to run: corpus fingerprint mismatch.\n"
      + "  --corpus   " + corpusPath + "\n"
      + "  expected   " + CORPUS_FILE_COUNT + " files, " + CORPUS_TOTAL_BYTES + " bytes\n"
      + "  observed   " + fingerprint.fileCount + " files, " + fingerprint.totalBytes + " bytes\n"
      + "  The benchmark is pinned to the reference corpus; numbers from other material are not comparable.\n",
    );
    process.exit(3);
  }

  mkdirSync(path.join(workdir, "reports"), { recursive: true });
  mkdirSync(path.join(workdir, "results"), { recursive: true });

  const environment = { ...process.env, MAA_EVIDENCE_AUTO_UPDATE: "0" };
  const versionRun = await runOnce(binary, ["--version"], { env: environment, cwd: workdir });
  const telemetryRun = await runOnce(binary, ["telemetry", "status"], { env: environment, cwd: workdir });
  const distRoot = path.resolve(root, "dist");
  const distAtStart = distDigests(distRoot, root);
  const packageVersion = JSON.parse(readFileSync(path.resolve(root, "package.json"), "utf8")).version;
  const gitStatus = git(root, ["status", "--porcelain"]);

  const report = {
    benchmark: "scripts/bench/bench-mek.mjs",
    benchmarkVersion: BENCHMARK_VERSION,
    label: options.label,
    generatedAt: new Date().toISOString(),
    arguments: {
      root: root.replace(/\\/gu, "/"),
      corpus: corpusPath.replace(/\\/gu, "/"),
      workdir: workdir.replace(/\\/gu, "/"),
      window: options.window,
      window2: options.window2,
      rootCauseLine,
      rootCauseArtifact: options.rootCauseArtifact,
      rootCauseTime: options.rootCauseTime,
      quick: options.quick,
      questionsOnly: options.questionsOnly,
    },
    definitions: {
      warmRuns: WARM_RUNS,
      coldWarm: "cold = the first execution of that item in this session; warm = median of " + WARM_RUNS + " runs. The OS file cache is not flushed between runs.",
      idleCall: "A call is idle when its return did not carry the fact the step exists to read (unparseable output, non-zero exit, or the field the step reads missing). An unanswered question counts every one of its calls as idle.",
      maxSingleReturnBytes: "The largest SINGLE call return inside a question (stdout bytes + stderr bytes), not the sum over calls.",
      manifestBudgetBytes: MANIFEST_BUDGET_BYTES,
      windowDelta: "window2 minus window1, absolute and as a percentage of window1 (percent is null when window1 is 0).",
      sharedQuestion: "q5 reads the discovery-state manifest, whose command takes no window: the single measurement is reported under both windows marked shared and its delta is therefore 0.",
    },
    binary: {
      path: binary.replace(/\\/gu, "/"),
      version: versionRun.stdoutText.trim(),
      packageVersion,
      distSha256: distAtStart,
    },
    git: {
      commit: git(root, ["rev-parse", "HEAD"]),
      short: git(root, ["rev-parse", "--short", "HEAD"]),
      dirty: gitStatus.length > 0,
      status: gitStatus.split("\n").filter(Boolean),
    },
    environment: {
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      cpus: cpus().length,
      autoUpdate: "0",
      telemetryStatus: readJson(telemetryRun.stdoutText) === null
        ? telemetryRun.stdoutText.trim()
        : readJson(telemetryRun.stdoutText).status,
      versionCanaryMs: versionRun.wallMs,
    },
    corpus: Object.assign({
      path: corpusPath.replace(/\\/gu, "/"),
      fingerprint: {
        expectedFiles: CORPUS_FILE_COUNT,
        expectedBytes: CORPUS_TOTAL_BYTES,
        observedFiles: fingerprint.fileCount,
        observedBytes: fingerprint.totalBytes,
        matched: true,
      },
    }, corpusInventory(corpusPath, fingerprint.files)),
  };

  const questionEnvironment = childEnvironment(environment, "teloff");
  const logItem = (measured) => {
    const steady = measured.warm.median;
    process.stderr.write(
      "       wall=" + steady.wallMs + "ms tto=" + steady.timeToOutputMs + "ms stdout=" + steady.stdoutBytes
      + "B report=" + steady.reportBytes + "B baseline=" + measured.startupBaselineMs.min + "ms\n",
    );
  };
  // The measured binary is the checkout's build, and another process can rebuild it at any moment.
  // Re-hashing dist after every item turns "the build moved during the run" into a per-item fact, so
  // a run with a moving checkout still says which measurements are attributable to which build.
  const measure = async (spec) => {
    const measured = await measureItem(Object.assign({}, spec, { binary, workdir, environment }));
    measured.buildStableAfterItem = JSON.stringify(distDigests(distRoot, root)) === JSON.stringify(distAtStart);
    logItem(measured);
    return measured;
  };

  const sharedItemSpecs = [
    { id: "version-teldef", title: "--version (startup, telemetry default)", args: ["--version"], telemetry: "teldef" },
    { id: "version-teloff", title: "--version (startup, telemetry off)", args: ["--version"], telemetry: "teloff" },
    { id: "help-teldef", title: "--help (top-level usage)", args: ["--help"], telemetry: "teldef" },
    { id: "skill-print", title: "skill --print", args: ["skill", "--print"], telemetry: "teldef" },
    {
      id: "inspect-full-summary-teloff",
      title: "mla inspect full corpus, --summary, --output",
      args: ["mla", "inspect", "@corpus", "--format", "json", "--summary", "--output", "@out"],
      telemetry: "teloff",
      outputFile: "reports/full.json",
    },
  ];
  const windowItemSpecs = (window) => [
    {
      id: "inspect-window-summary-teldef",
      title: "mla inspect windowed, --summary, --output (telemetry default)",
      args: ["mla", "inspect", "@corpus", "--from", window.from, "--to", window.to, "--format", "json", "--summary", "--output", "@out"],
      telemetry: "teldef",
      outputFile: "reports/" + window.id + "-teldef.json",
    },
    {
      id: "inspect-window-summary-teloff",
      title: "mla inspect windowed, --summary, --output (telemetry off)",
      args: ["mla", "inspect", "@corpus", "--from", window.from, "--to", window.to, "--format", "json", "--summary", "--output", "@out"],
      telemetry: "teloff",
      outputFile: window.reportRelative,
    },
    {
      id: "inspect-window-nosummary-teloff",
      title: "mla inspect windowed, no --summary (stdout gets the whole document)",
      args: ["mla", "inspect", "@corpus", "--from", window.from, "--to", window.to, "--format", "json"],
      telemetry: "teloff",
    },
  ];
  const followUpSpecs = (window, inputs) => [
    {
      id: "search-overrides",
      title: "search pipeline overrides in the saved report",
      args: ["search", "--input", window.reportRelative, "--kind", "mla.pipeline_override", "--format", "json", "--fields", "evidence.id,evidence.source.node"],
      telemetry: "teloff",
    },
    {
      id: "view-evidence",
      title: "view the window's first failure record from the saved report",
      args: ["view", "--input", window.reportRelative, "--evidence-id", inputs.failureEvidenceId === null ? PLACEHOLDER_EVIDENCE_ID : inputs.failureEvidenceId, "--format", "json", "--fields", "source,data.kind,data.termination"],
      telemetry: "teloff",
    },
    {
      id: "window-artifact",
      title: "window around the window's first failure line in its rotated log",
      args: ["window", "--input", window.reportRelative, "--artifact-id", inputs.failureArtifactId === null ? PLACEHOLDER_ARTIFACT_ID : inputs.failureArtifactId, "--line", String(inputs.failureLine === null ? 1 : inputs.failureLine), "--before", "5", "--after", "10", "--format", "json"],
      telemetry: "teloff",
    },
    {
      id: "search-mirror-groups",
      title: "search possible mirrored task groups",
      args: ["search", "--input", window.reportRelative, "--kind", "mla.possible_mirrored_task_group", "--format", "json", "--fields", "evidence.id,evidence.source.task"],
      telemetry: "teloff",
    },
  ];

  // Items are window-independent unless they carry a window; the corpus path is substituted for
  // "@corpus" so every number stays attributable to the arguments this run was given.
  const corpusArg = corpusPath.replace(/\\/gu, "/");
  const withCorpus = (spec) => Object.assign({}, spec, {
    args: spec.args.map((value) => (value === "@corpus" ? corpusArg : value)),
  });

  report.items = [];
  if (!options.quick && !options.questionsOnly) {
    for (const spec of sharedItemSpecs) {
      process.stderr.write("[item] " + spec.id + "\n");
      report.items.push(await measure(withCorpus(spec)));
    }
  }

  report.windows = [];
  for (const window of windows) {
    const entry = {
      id: window.id,
      from: window.from,
      to: window.to,
      reportRelative: window.reportRelative,
      report: { relative: window.reportRelative, bytes: null, sha256: null },
      items: [],
      followUps: [],
      inputs: null,
      questions: [],
    };
    if (!options.quick && !options.questionsOnly) {
      for (const spec of windowItemSpecs(window)) {
        process.stderr.write("[item] " + window.id + " " + spec.id + "\n");
        entry.items.push(await measure(withCorpus(spec)));
      }
    }
    const reportFile = path.resolve(workdir, window.reportRelative);
    if (!existsSync(reportFile)) {
      // --quick / --questions-only skip the item battery, so the report the questions read has to be
      // produced here instead.
      process.stderr.write("[setup] generating " + window.reportRelative + "\n");
      const setup = await runOnce(binary, [
        "mla", "inspect", corpusArg, "--from", window.from, "--to", window.to,
        "--format", "json", "--summary", "--output", window.reportRelative,
      ], {
        env: questionEnvironment,
        cwd: workdir,
        outputFile: reportFile,
      });
      if (!existsSync(reportFile)) {
        fail("could not generate " + window.reportRelative + ": exit " + setup.exitCode + "\n" + setup.stderrText.trim(), 4);
      }
    }
    const reportBytes = readFileSync(reportFile);
    if (readJson(reportBytes.toString("utf8")) === null) {
      fail("the window report " + window.reportRelative + " is not JSON; the runs measured above did not produce a report", 4);
    }
    entry.report = { relative: window.reportRelative, bytes: reportBytes.byteLength, sha256: sha256(reportBytes) };
    const reportDocument = readJson(reportBytes.toString("utf8"));
    const reportEvidence = reportDocument === null || reportDocument.evidence === undefined ? [] : reportDocument.evidence;
    const firstFailure = reportEvidence.find((item) => item.kind === "mla.failure");
    const rootCauseFailure = reportEvidence.find((item) =>
      item.kind === "mla.failure"
      && item.source !== undefined
      && String(item.source.path === undefined ? "" : item.source.path).endsWith(options.rootCauseArtifact)
      && item.source.line === rootCauseLine);
    const firstGroup = reportEvidence.find((item) => item.kind === "mla.possible_mirrored_task_group");
    entry.inputs = {
      parsed: reportDocument !== null,
      evidenceCount: reportEvidence.length,
      failureEvidenceId: firstFailure === undefined ? null : firstFailure.id,
      failureArtifactId: firstFailure === undefined ? null : firstFailure.source.artifactId,
      failureLine: firstFailure === undefined ? null : firstFailure.source.line,
      failureNode: firstFailure === undefined ? null : firstFailure.source.node,
      rootCauseFailureEvidenceId: rootCauseFailure === undefined ? null : rootCauseFailure.id,
      mirrorGroupEvidenceId: firstGroup === undefined ? null : firstGroup.id,
    };
    if (!options.quick && !options.questionsOnly) {
      for (const spec of followUpSpecs(window, entry.inputs)) {
        process.stderr.write("[item] " + window.id + " " + spec.id + "\n");
        entry.followUps.push(await measure(withCorpus(spec)));
      }
    }
    const questionContext = {
      binary,
      workdir,
      env: questionEnvironment,
      windowId: window.id,
      corpusArg,
      rootCauseArtifact: options.rootCauseArtifact,
      rootCauseLine,
      rootCauseTime: options.rootCauseTime,
      failureEvidenceId: entry.inputs.failureEvidenceId,
    };
    for (const spec of windowQuestionSpecs(window.reportRelative)) {
      const asked = await askQuestion(spec, questionContext);
      entry.questions.push(asked);
      process.stderr.write("[question] " + window.id + " " + asked.id + ": calls=" + asked.callCount + " idle=" + asked.idleCalls
        + " maxReturn=" + asked.maxSingleReturnBytes + "B answered=" + asked.answered + "\n");
    }
    report.windows.push(entry);
  }

  const manifestAsked = await askQuestion(manifestQuestionSpec(), {
    binary,
    workdir,
    env: questionEnvironment,
    windowId: null,
    corpusArg,
    rootCauseArtifact: options.rootCauseArtifact,
    rootCauseLine,
    rootCauseTime: options.rootCauseTime,
  });
  process.stderr.write("[question] shared " + manifestAsked.id + ": calls=" + manifestAsked.callCount + " idle=" + manifestAsked.idleCalls
    + " maxReturn=" + manifestAsked.maxSingleReturnBytes + "B covered=" + manifestAsked.answered + "\n");
  for (const window of report.windows) window.questions.push(manifestAsked);

  const distAfter = distDigests(distRoot, root);
  const allItems = [...report.items, ...report.windows.flatMap((window) => [...window.items, ...window.followUps])];
  report.binary.distSha256After = distAfter;
  report.binary.changedDuringRun = JSON.stringify(distAfter) !== JSON.stringify(distAtStart);
  report.binary.firstItemAfterBuildChange = (allItems.find((item) => item.buildStableAfterItem === false) === undefined
    ? null
    : allItems.find((item) => item.buildStableAfterItem === false).id);
  report.summary = buildSummary(report.windows, "inspect-window-summary-teloff");
  report.summary.binaryChangedDuringRun = report.binary.changedDuringRun;
  report.summary.itemsBeforeBuildChange = allItems.filter((item) => item.buildStableAfterItem !== false).map((item) => item.id);
  if (report.binary.changedDuringRun) {
    process.stderr.write("bench-mek: WARNING the build under measurement changed while the run was in progress;"
      + " items measured before \"" + String(report.binary.firstItemAfterBuildChange) + "\" are attributable to the starting build.\n");
  }
  const resultsPath = path.join(workdir, "results", options.label + ".json");
  report.resultsPath = resultsPath.replace(/\\/gu, "/");
  writeFileSync(resultsPath, JSON.stringify(report, null, 2) + "\n");
  process.stdout.write(renderMarkdown(report));
}

await main();
