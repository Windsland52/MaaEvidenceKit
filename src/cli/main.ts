#!/usr/bin/env node

import { pathToFileURL } from "node:url";
import { createInterface } from "node:readline/promises";

import {
  inspect,
  inspectMla,
  inspectMse,
  MAA_EVIDENCE_VERSION,
  getTelemetryStatus,
  previewFeedback,
  queryEvidenceBatch,
  type FeedbackCategory,
  type OperationalCounts,
  queryEvidenceWindow,
  recordOperationalTelemetry,
  renderEvidenceWindow,
  evidenceById,
  renderEvidence,
  renderEvidenceSearch,
  searchEvidence,
  setTelemetryEnabled,
  submitFeedback,
  view,
  type InspectionResult,
  type MseSyntaxMode,
  type TimeRange,
  type ViewFormat,
} from "../index.js";
import { flag, integerOption, option, options, parseArguments, type ParsedArguments } from "./args.js";
import { readBatchRequests } from "./batch-input.js";
import { emit, readInspection } from "./io.js";

const HELP = `MaaEvidenceKit — deterministic MaaFramework evidence extraction

Usage:
  maa-evidence mla inspect <path> [--from ISO] [--to ISO] [--keyword TEXT] [--all-signals] [--format json|text|mermaid]
  maa-evidence mse inspect <path> [--task NAME] [--depth N] [--controller NAME] [--resource NAME] [--no-referencers] [--syntax-mode maafw|maa] [--format json|text|mermaid]
  maa-evidence inspect <path> [--from ISO] [--to ISO] [--task NAME] [--controller NAME] [--resource NAME] [--no-referencers] [--no-mla] [--no-mse]
  maa-evidence window --input result.json (--evidence-id ID | --artifact-id ID) [--line N]
  maa-evidence view --input result.json [--evidence-id ID] --format json|text|mermaid
  maa-evidence search --input result.json [--artifact-id ID] [--kind KIND] [--node NODE] [--task TASK] [--text TEXT] [--from ISO] [--to ISO] [--limit N] [--format json|text]
  maa-evidence batch --input result.json --requests queries.json
  maa-evidence telemetry status|enable|disable
  maa-evidence feedback --message TEXT [--category blocker|bug|suggestion|other] [--component mla|mse|discovery|views|other] [--attachment FILE]

Common options:
  --output FILE       Write output to a file
  --format FORMAT     json, text, or mermaid
  --version           Show the MaaEvidenceKit version
  -h, --help          Show this help
`;

function requirePositional(parsed: ParsedArguments, index: number, label: string): string {
  const value = parsed.positionals[index];
  if (value === undefined) throw new Error(`Missing ${label}.`);
  return value;
}

function timeRange(parsed: ParsedArguments): TimeRange | undefined {
  const from = option(parsed, "--from");
  const to = option(parsed, "--to");
  if (from === undefined && to === undefined) return undefined;
  return { ...(from === undefined ? {} : { from }), ...(to === undefined ? {} : { to }) };
}

function syntaxMode(parsed: ParsedArguments): MseSyntaxMode {
  const value = option(parsed, "--syntax-mode") ?? "maafw";
  if (value !== "maafw" && value !== "maa") {
    throw new Error("--syntax-mode must be maafw or maa.");
  }
  return value;
}

function outputFormat(parsed: ParsedArguments): ViewFormat {
  const value = option(parsed, "--format") ?? (process.stdout.isTTY ? "text" : "json");
  if (value !== "json" && value !== "text" && value !== "mermaid") {
    throw new Error("--format must be json, text, or mermaid.");
  }
  return value;
}

async function emitInspection(result: InspectionResult, parsed: ParsedArguments): Promise<void> {
  await emit(view(result, { format: outputFormat(parsed) }), option(parsed, "--output"));
}

async function runMla(parsed: ParsedArguments): Promise<InspectionResult> {
  if (requirePositional(parsed, 1, "MLA command") !== "inspect") {
    throw new Error("The MLA namespace currently supports only 'inspect'.");
  }
  const range = timeRange(parsed);
  const result = await inspectMla(requirePositional(parsed, 2, "input path"), {
    ...(range === undefined ? {} : { timeRange: range }),
    keywords: options(parsed, "--keyword"),
    includeAllSignals: flag(parsed, "--all-signals"),
  });
  await emitInspection(result, parsed);
  return result;
}

async function runMse(parsed: ParsedArguments): Promise<InspectionResult> {
  if (requirePositional(parsed, 1, "MSE command") !== "inspect") {
    throw new Error("The MSE namespace currently supports only 'inspect'.");
  }
  const result = await inspectMse(requirePositional(parsed, 2, "project path"), {
    syntaxMode: syntaxMode(parsed),
    tasks: options(parsed, "--task"),
    includeReferencers: !flag(parsed, "--no-referencers"),
    ...(option(parsed, "--controller") === undefined
      ? {}
      : { controller: option(parsed, "--controller") as string }),
    ...(option(parsed, "--resource") === undefined
      ? {}
      : { resource: option(parsed, "--resource") as string }),
    ...(integerOption(parsed, "--depth") === undefined
      ? {}
      : { depth: integerOption(parsed, "--depth") as number }),
  });
  await emitInspection(result, parsed);
  return result;
}

async function runCombined(parsed: ParsedArguments): Promise<InspectionResult> {
  const range = timeRange(parsed);
  const result = await inspect(requirePositional(parsed, 1, "input path"), {
    mla: flag(parsed, "--no-mla")
      ? false
      : {
        ...(range === undefined ? {} : { timeRange: range }),
        keywords: options(parsed, "--keyword"),
        includeAllSignals: flag(parsed, "--all-signals"),
      },
    mse: flag(parsed, "--no-mse")
      ? false
      : {
        syntaxMode: syntaxMode(parsed),
        tasks: options(parsed, "--task"),
        includeReferencers: !flag(parsed, "--no-referencers"),
        ...(option(parsed, "--controller") === undefined
          ? {}
          : { controller: option(parsed, "--controller") as string }),
        ...(option(parsed, "--resource") === undefined
          ? {}
          : { resource: option(parsed, "--resource") as string }),
        ...(integerOption(parsed, "--depth") === undefined
          ? {}
          : { depth: integerOption(parsed, "--depth") as number }),
      },
  });
  await emitInspection(result, parsed);
  return result;
}

async function runWindow(parsed: ParsedArguments): Promise<void> {
  const result = await readInspection(option(parsed, "--input") ?? "");
  const window = await queryEvidenceWindow(result, {
    ...(option(parsed, "--evidence-id") === undefined
      ? {}
      : { evidenceId: option(parsed, "--evidence-id") as string }),
    ...(option(parsed, "--artifact-id") === undefined
      ? {}
      : { artifactId: option(parsed, "--artifact-id") as string }),
    ...(integerOption(parsed, "--line") === undefined ? {} : { line: integerOption(parsed, "--line") as number }),
    ...(integerOption(parsed, "--before") === undefined ? {} : { before: integerOption(parsed, "--before") as number }),
    ...(integerOption(parsed, "--after") === undefined ? {} : { after: integerOption(parsed, "--after") as number }),
    ...(integerOption(parsed, "--max-lines") === undefined
      ? {}
      : { maxLines: integerOption(parsed, "--max-lines") as number }),
    ...(integerOption(parsed, "--max-characters") === undefined
      ? {}
      : { maxCharacters: integerOption(parsed, "--max-characters") as number }),
  });
  const format = option(parsed, "--format") ?? "json";
  if (format !== "json" && format !== "text") {
    throw new Error("window --format must be json or text.");
  }
  await emit(renderEvidenceWindow(window, format), option(parsed, "--output"));
}

async function runView(parsed: ParsedArguments): Promise<void> {
  const result = await readInspection(option(parsed, "--input") ?? "");
  const evidenceId = option(parsed, "--evidence-id");
  const format = outputFormat(parsed);
  if (evidenceId === undefined) {
    await emit(view(result, { format }), option(parsed, "--output"));
    return;
  }
  if (format === "mermaid") throw new Error("view --evidence-id supports only json or text.");
  await emit(renderEvidence(evidenceById(result.evidence, evidenceId), format), option(parsed, "--output"));
}

async function runSearch(parsed: ParsedArguments): Promise<void> {
  const result = await readInspection(option(parsed, "--input") ?? "");
  const range = timeRange(parsed);
  const search = searchEvidence(result, {
    artifactIds: options(parsed, "--artifact-id"),
    kinds: options(parsed, "--kind"),
    nodes: options(parsed, "--node"),
    tasks: options(parsed, "--task"),
    text: options(parsed, "--text"),
    ...(range === undefined ? {} : { timeRange: range }),
    ...(integerOption(parsed, "--limit") === undefined ? {} : { limit: integerOption(parsed, "--limit") as number }),
  });
  const format = option(parsed, "--format") ?? (process.stdout.isTTY ? "text" : "json");
  if (format !== "json" && format !== "text") throw new Error("search --format must be json or text.");
  await emit(renderEvidenceSearch(search, format), option(parsed, "--output"));
}

async function runBatch(parsed: ParsedArguments): Promise<void> {
  const result = await readInspection(option(parsed, "--input") ?? "");
  const requests = await readBatchRequests(option(parsed, "--requests") ?? "");
  const batch = await queryEvidenceBatch(result, requests);
  await emit(JSON.stringify(batch, null, 2), option(parsed, "--output"));
}

async function runTelemetry(parsed: ParsedArguments): Promise<void> {
  const action = requirePositional(parsed, 1, "telemetry action");
  if (action === "status") {
    await emit(JSON.stringify({ status: await getTelemetryStatus() }, null, 2), option(parsed, "--output"));
    return;
  }
  if (action === "enable" || action === "disable") {
    await setTelemetryEnabled(action === "enable");
    await emit(JSON.stringify({ status: action === "enable" ? "enabled" : "disabled" }, null, 2), option(parsed, "--output"));
    return;
  }
  throw new Error("telemetry action must be status, enable, or disable.");
}

function feedbackComponent(parsed: ParsedArguments): "mla" | "mse" | "discovery" | "views" | "other" {
  const component = option(parsed, "--component") ?? "other";
  if (!["mla", "mse", "discovery", "views", "other"].includes(component)) {
    throw new Error("--component must be mla, mse, discovery, views, or other.");
  }
  return component as "mla" | "mse" | "discovery" | "views" | "other";
}

function feedbackCategory(parsed: ParsedArguments): FeedbackCategory {
  const value = option(parsed, "--category") ?? "other";
  if (!["blocker", "bug", "suggestion", "other"].includes(value)) {
    throw new Error("--category must be blocker, bug, suggestion, or other.");
  }
  return value as FeedbackCategory;
}

async function runFeedback(parsed: ParsedArguments): Promise<void> {
  const message = option(parsed, "--message");
  if (message === undefined) throw new Error("feedback requires --message.");
  const preview = await previewFeedback({
    message,
    category: feedbackCategory(parsed),
    component: feedbackComponent(parsed),
    attachmentPaths: options(parsed, "--attachment"),
  });
  if (!process.stdin.isTTY || !process.stderr.isTTY) {
    throw new Error("Feedback submission requires an interactive terminal for per-submission confirmation.");
  }
  process.stderr.write("\nFeedback preview\n");
  process.stderr.write(`Category: ${preview.category}\n`);
  process.stderr.write(`Message: ${preview.message}\n`);
  process.stderr.write(`Attachments: ${preview.attachments.length} (${preview.totalAttachmentBytes} bytes)\n`);
  for (const attachment of preview.attachments) {
    process.stderr.write(`- ${attachment.path} (${attachment.sizeBytes} bytes)\n`);
  }
  for (const warning of preview.warnings) process.stderr.write(`WARNING: ${warning}\n`);
  const reader = createInterface({ input: process.stdin, output: process.stderr });
  try {
    const answer = await reader.question("Type UPLOAD to send this feedback to the MaaEvidenceKit Sentry project: ");
    if (answer.trim() !== "UPLOAD") throw new Error("Feedback upload cancelled.");
  } finally {
    reader.close();
  }
  const eventId = await submitFeedback(preview);
  await emit(JSON.stringify({ sent: true, eventId }, null, 2), option(parsed, "--output"));
}

function countsFromInspection(result: InspectionResult): OperationalCounts {
  const counts: { [key: string]: number } = { evidenceCount: result.evidence.length };
  const details = result.details as { mla?: { evidence?: unknown[] } | null; mse?: { evidence?: unknown[] } | null } | null;
  if (details?.mla?.evidence !== undefined) counts["mlaEvidenceCount"] = details.mla.evidence.length;
  if (details?.mse?.evidence !== undefined) counts["mseEvidenceCount"] = details.mse.evidence.length;
  if (result.kind === "combined") {
    counts["adapters"] = (result as { statistics: Record<string, number> }).statistics["adapters"] ?? 0;
  }
  if (result.kind === "mla") {
    counts["signalsTotal"] = (result as { statistics: Record<string, number> }).statistics["signalsTotal"] ?? 0;
    const evidence = (result as { evidence: Array<{ kind: string }> }).evidence;
    counts["recognitionDetails"] = evidence.filter((item) => item.kind === "mla.recognition_detail").length;
    counts["cycleExitBlockers"] = evidence.filter((item) => item.kind === "mla.cycle_exit_blocker").length;
    counts["taskAnomalies"] = evidence.filter((item) => item.kind === "mla.task_anomaly").length;
  }
  return Object.fromEntries(
    Object.entries(counts).filter(([, value]) => value !== undefined),
  ) as OperationalCounts;
}

async function withOperationalTelemetry(
  command: string,
  component: "mla" | "mse" | "combined" | "view" | "window" | "search" | "batch",
  operation: () => Promise<InspectionResult | void>,
): Promise<void> {
  const startedAt = performance.now();
  try {
    const result = await operation();
    await recordOperationalTelemetry({
      command,
      component,
      status: "ok",
      durationMs: performance.now() - startedAt,
      ...(result === undefined ? {} : { counts: countsFromInspection(result) }),
    });
  } catch (error: unknown) {
    await recordOperationalTelemetry({
      command,
      component,
      status: "error",
      durationMs: performance.now() - startedAt,
    });
    throw error;
  }
}

export async function main(args: string[] = process.argv.slice(2)): Promise<number> {
  try {
    const parsed = parseArguments(args);
    if (flag(parsed, "--version")) {
      process.stdout.write(`${MAA_EVIDENCE_VERSION}\n`);
      return 0;
    }
    if (args.length === 0 || flag(parsed, "--help") || flag(parsed, "-h")) {
      process.stdout.write(HELP);
      return 0;
    }
    switch (requirePositional(parsed, 0, "command")) {
      case "mla":
        await withOperationalTelemetry("mla.inspect", "mla", () => runMla(parsed));
        return 0;
      case "mse":
        await withOperationalTelemetry("mse.inspect", "mse", () => runMse(parsed));
        return 0;
      case "inspect":
        await withOperationalTelemetry("inspect", "combined", () => runCombined(parsed));
        return 0;
      case "window":
        await withOperationalTelemetry("window", "window", () => runWindow(parsed));
        return 0;
      case "view":
        await withOperationalTelemetry("view", "view", () => runView(parsed));
        return 0;
      case "search":
        await withOperationalTelemetry("search", "search", () => runSearch(parsed));
        return 0;
      case "batch":
        await withOperationalTelemetry("batch", "batch", () => runBatch(parsed));
        return 0;
      case "telemetry":
        await runTelemetry(parsed);
        return 0;
      case "feedback":
        await runFeedback(parsed);
        return 0;
      default:
        throw new Error(`Unknown command: ${requirePositional(parsed, 0, "command")}`);
    }
  } catch (error: unknown) {
    process.stderr.write(`maa-evidence: ${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}

const invokedPath = process.argv[1];
if (invokedPath !== undefined && import.meta.url === pathToFileURL(invokedPath).href) {
  process.exitCode = await main();
}
