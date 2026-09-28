#!/usr/bin/env node

import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { createInterface } from "node:readline/promises";

import type {
  FeedbackCategory,
  InspectionResult,
  MseSyntaxMode,
  OperationalCounts,
  OperationalErrorStage,
  TimeRange,
  ViewFormat,
} from "../index.js";
import { UsageError } from "../evidence/usage-error.js";
import { MAA_EVIDENCE_VERSION } from "../version.js";
import { profileStage, profileStageSync } from "../profiling.js";
import {
  PACKAGED_SKILL_ENTRY,
  checkPackagedSkill,
  installPackagedSkill,
  loadPackagedSkill,
  readPackagedSkillFile,
} from "../skills/index.js";
import { flag, integerOption, option, options, parseArguments, type ParsedArguments } from "./args.js";
import { runWithAutomaticUpdates } from "./auto-update.js";
import { readBatchRequests } from "./batch-input.js";
import { TOP_LEVEL_HELP, commandHelp } from "./help.js";
import { emit, readInspection } from "./io.js";
import { rejectUnknownOptions } from "./options.js";
import { withLocalProfile } from "./profile.js";

type Sdk = typeof import("../index.js");

/**
 * Load the SDK facade for the command that needs it.
 *
 * Commands that print one line (`--version`, `--help`, `skill --print`) and commands that only read
 * a saved report never touch the inspection engine, and importing it for them costs about a second of
 * startup. Node caches the module, so every call after the first is a map lookup.
 */
function loadSdk(): Promise<Sdk> {
  return import("../index.js");
}

function requirePositional(parsed: ParsedArguments, index: number, label: string): string {
  const value = parsed.positionals[index];
  if (value === undefined) throw new UsageError(`Missing ${label}.`);
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
    throw new UsageError("--syntax-mode must be maafw or maa.");
  }
  return value;
}

function rejectUnexpectedPositionals(parsed: ParsedArguments, expected: number): void {
  const unexpected = parsed.positionals.slice(expected);
  if (unexpected.length === 0) return;
  throw new UsageError(
    `Unexpected positional arguments: ${unexpected.map((value) => JSON.stringify(value)).join(", ")}.`,
  );
}

function mseCommand(parsed: ParsedArguments): "inspect" | "resolve" {
  const value = requirePositional(parsed, 1, "MSE command");
  if (value !== "inspect" && value !== "resolve") {
    throw new UsageError("The MSE namespace supports 'inspect' and 'resolve'.");
  }
  return value;
}

function outputFormat(parsed: ParsedArguments): ViewFormat {
  const value = option(parsed, "--format") ?? (process.stdout.isTTY ? "text" : "json");
  if (value !== "json" && value !== "text" && value !== "mermaid") {
    throw new UsageError("--format must be json, text, or mermaid.");
  }
  return value;
}

/**
 * The manifest is a separate output family rather than a fourth `ViewFormat`.
 *
 * `view()` renders an inspection document; a manifest is a projection of the artifact records, and
 * the two entry points that offer it (the discovery-state short circuit and a saved report) share
 * one renderer instead of one `switch` arm. Reading the raw option rather than the resolved format
 * matters: only an explicit `--format manifest` may take the short circuit, so the TTY-dependent
 * default can never silently stop extracting evidence.
 */
function manifestFormat(parsed: ParsedArguments): "json" | "compact" | undefined {
  const value = option(parsed, "--format");
  if (value === undefined) return undefined;
  if (value === "manifest") return "json";
  if (value === "manifest-compact") return "compact";
  if (value !== "json" && value !== "text" && value !== "mermaid") {
    throw new UsageError("--format must be json, text, mermaid, manifest, or manifest-compact.");
  }
  return undefined;
}

function requestedFields(sdk: Sdk, parsed: ParsedArguments): string[] {
  return options(parsed, "--fields").length === 0 ? [] : sdk.parseFields(options(parsed, "--fields"));
}

/**
 * Emit a projected JSON document when `--fields` is present, and report whether it did.
 *
 * JSON is never truncated, so a projection is the bounded alternative to a text budget: it keeps the
 * document valid and fails on a field name that does not exist instead of returning undefined.
 */
async function emitSelection(
  sdk: Sdk,
  value: unknown,
  parsed: ParsedArguments,
  format: string,
): Promise<boolean> {
  const fields = requestedFields(sdk, parsed);
  if (fields.length === 0) return false;
  if (format !== "json") {
    throw new UsageError("--fields projects JSON output; add --format json or drop --fields.");
  }
  await emit(JSON.stringify(sdk.selectFields(value, fields), null, 2), option(parsed, "--output"));
  return true;
}

async function emitInspection(sdk: Sdk, result: InspectionResult, parsed: ParsedArguments): Promise<void> {
  const format = outputFormat(parsed);
  const output = option(parsed, "--output");
  if (flag(parsed, "--summary")) {
    if (format === "mermaid") throw new UsageError("--summary supports --format json or text.");
    if (requestedFields(sdk, parsed).length > 0) {
      throw new UsageError("--summary already bounds stdout; --fields projects the full JSON document, so use one of them.");
    }
    const summary = profileStageSync("render", () => sdk.renderInspectionSummary(result, format));
    if (output === undefined) {
      await emit(summary);
      return;
    }
    // A saved report must stay consumable by view/search/window, so --output always
    // receives the full document; --summary only decides what stdout shows.
    const rendered = profileStageSync("render", () => sdk.view(result, { format }));
    await emit(rendered, output);
    await emit(summary);
    return;
  }
  if (await emitSelection(sdk, result, parsed, format)) return;
  const rendered = profileStageSync("render", () => sdk.view(result, { format }));
  await emit(rendered, output);
}

async function runMla(parsed: ParsedArguments): Promise<InspectionResult> {
  if (requirePositional(parsed, 1, "MLA command") !== "inspect") {
    throw new UsageError("The MLA namespace currently supports only 'inspect'.");
  }
  const format = manifestFormat(parsed);
  if (format !== undefined) return runMlaManifest(parsed, format);
  const range = timeRange(parsed);
  const sdk = await loadSdk();
  const result = await sdk.inspectMla(requirePositional(parsed, 2, "input path"), {
    ...(range === undefined ? {} : { timeRange: range }),
    keywords: options(parsed, "--keyword"),
    includeAllSignals: flag(parsed, "--all-signals"),
  });
  await emitInspection(sdk, result, parsed);
  return result;
}

/**
 * `mla inspect <dir> --format manifest`: inventory and digest the corpus, then stop.
 *
 * The point of the short circuit is that coverage is visible before extraction is paid for, so this
 * path never selects a target, loads a log, or materializes evidence - and says so in the document it
 * prints (`input.extraction: "not-run"`). Options that only shape extraction are refused rather than
 * accepted and ignored.
 */
async function runMlaManifest(
  parsed: ParsedArguments,
  format: "json" | "compact",
): Promise<InspectionResult> {
  const extractionOnly = ([
    ["--summary", "the manifest is already a bounded projection of the artifact list"],
    ["--all-signals", "a manifest does not extract runtime signals"],
    ["--keyword", "a manifest selects and loads no log target"],
  ] as const).filter(([name]) => flag(parsed, name) || options(parsed, name).length > 0);
  if (extractionOnly.length > 0) {
    throw new UsageError(
      `--format manifest short-circuits before extraction, so ${extractionOnly.map(([name]) => name).join(", ")}`
      + ` would have no effect: ${extractionOnly.map(([, reason]) => reason).join("; ")}.`,
    );
  }
  const sdk = await loadSdk();
  const range = timeRange(parsed);
  const result = await sdk.inspectMlaManifest(
    requirePositional(parsed, 2, "input path"),
    range === undefined ? {} : { timeRange: range },
  );
  const rendered = profileStageSync("render", () => sdk.renderCoverageManifest(result, {
    format,
    extraction: "not-run",
  }));
  await emit(rendered, option(parsed, "--output"));
  return result;
}

async function runMse(parsed: ParsedArguments): Promise<InspectionResult> {
  const command = mseCommand(parsed);
  const inputPath = requirePositional(parsed, 2, "project path");
  const commonOptions = {
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
  };
  const sdk = await loadSdk();
  const result = command === "inspect"
    ? await sdk.inspectMse(inputPath, {
      ...commonOptions,
      ...(option(parsed, "--git-ref") === undefined
        ? {}
        : { gitRef: option(parsed, "--git-ref") as string }),
    })
    : await sdk.resolveMse(inputPath, commonOptions);
  await emitInspection(sdk, result, parsed);
  return result;
}

async function runRepoDocs(parsed: ParsedArguments): Promise<InspectionResult> {
  const format = option(parsed, "--format");
  if (format === "mermaid") throw new UsageError("repo-docs --format must be json or text.");
  const sdk = await loadSdk();
  const result = await sdk.inspectRepositoryDocs(requirePositional(parsed, 1, "checkout path"));
  await emitInspection(sdk, result, parsed);
  return result;
}

async function runCombined(parsed: ParsedArguments): Promise<InspectionResult> {
  const range = timeRange(parsed);
  if (flag(parsed, "--referencers") && flag(parsed, "--no-referencers")) {
    throw new UsageError("--referencers and --no-referencers cannot be used together.");
  }
  const includeReferencers = flag(parsed, "--referencers")
    ? true
    : flag(parsed, "--no-referencers")
      ? false
      : undefined;
  const sdk = await loadSdk();
  const result = await sdk.inspect(requirePositional(parsed, 1, "input path"), {
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
        ...(includeReferencers === undefined ? {} : { includeReferencers }),
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
  await emitInspection(sdk, result, parsed);
  return result;
}

async function runWindow(parsed: ParsedArguments): Promise<void> {
  const result = await readInspection(option(parsed, "--input") ?? "");
  const sdk = await loadSdk();
  const evidenceWindow = await profileStage("evidence.window", () => sdk.queryEvidenceWindow(result, {
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
  }));
  const format = option(parsed, "--format") ?? "json";
  if (format !== "json" && format !== "text") {
    throw new UsageError("window --format must be json or text.");
  }
  if (await emitSelection(sdk, evidenceWindow, parsed, format)) return;
  const rendered = profileStageSync("render", () => sdk.renderEvidenceWindow(evidenceWindow, format));
  await emit(rendered, option(parsed, "--output"));
}

/**
 * Budgets for the text rendering of `view`.
 *
 * JSON is never truncated, so a text budget asked for with `--format json` is refused rather than
 * ignored: silently dropping either one is exactly how a caller ends up trusting a partial document.
 */
function viewTextBudget(
  sdk: Sdk,
  parsed: ParsedArguments,
  format: string,
): { maxLines: number; maxCharacters: number } {
  const requested = integerOption(parsed, "--max-lines") !== undefined
    || integerOption(parsed, "--max-characters") !== undefined;
  if (requested && format !== "text") {
    throw new UsageError(
      "--max-lines/--max-characters bound the text rendering; use --format text, or --fields to project JSON output.",
    );
  }
  return {
    maxLines: sdk.budgetInteger("--max-lines", integerOption(parsed, "--max-lines"), sdk.VIEW_DEFAULT_MAX_LINES, sdk.VIEW_MAX_LINES),
    maxCharacters: sdk.budgetInteger(
      "--max-characters",
      integerOption(parsed, "--max-characters"),
      sdk.VIEW_DEFAULT_MAX_CHARACTERS,
      sdk.VIEW_MAX_CHARACTERS,
    ),
  };
}

/** Bound stdout; `--output FILE` keeps the complete rendering, as it does for an inspection. */
async function emitRendered(
  sdk: Sdk,
  rendered: string,
  parsed: ParsedArguments,
  format: string,
  budget: { maxLines: number; maxCharacters: number },
): Promise<void> {
  const output = option(parsed, "--output");
  if (output !== undefined) {
    await emit(rendered, output);
    return;
  }
  await emit(format === "text" ? sdk.boundText(rendered, budget).text : rendered);
}

async function runView(parsed: ParsedArguments): Promise<void> {
  const result = await readInspection(option(parsed, "--input") ?? "");
  const evidenceId = option(parsed, "--evidence-id");
  const sdk = await loadSdk();
  const manifest = manifestFormat(parsed);
  if (manifest !== undefined) {
    // The other face of one renderer: a manifest assembled from a saved report. Nothing on this path
    // resolves, stats, or opens result.input.path, so a report still renders after its corpus was
    // renamed, moved, or deleted; sha256 comes from the digest the report already carries.
    if (evidenceId !== undefined) {
      throw new UsageError("view --format manifest renders every artifact; --evidence-id applies to json and text.");
    }
    if (option(parsed, "--max-lines") !== undefined || option(parsed, "--max-characters") !== undefined) {
      throw new UsageError("view --format manifest is never truncated; a manifest over budget is a bug, not a reason to hide rows.");
    }
    const rendered = profileStageSync("render", () => sdk.renderCoverageManifest(result, {
      format: manifest,
      extraction: "reported",
      generatedAt: result.generatedAt,
    }));
    await emit(rendered, option(parsed, "--output"));
    return;
  }
  const format = outputFormat(parsed);
  // Validated up front: a budget asked for with a format that cannot honor it must fail even when
  // the rendering path would never read it.
  const budget = viewTextBudget(sdk, parsed, format);
  if (evidenceId === undefined) {
    if (await emitSelection(sdk, result, parsed, format)) return;
    const rendered = profileStageSync("render", () => sdk.view(result, { format }));
    await emitRendered(sdk, rendered, parsed, format, budget);
    return;
  }
  if (format === "mermaid") throw new UsageError("view --evidence-id supports only json or text.");
  const evidence = profileStageSync("evidence.view", () => sdk.evidenceById(result.evidence, evidenceId));
  if (await emitSelection(sdk, evidence, parsed, format)) return;
  const rendered = profileStageSync("render", () => sdk.renderEvidence(evidence, format));
  await emitRendered(sdk, rendered, parsed, format, budget);
}

async function runSearch(parsed: ParsedArguments): Promise<void> {
  const result = await readInspection(option(parsed, "--input") ?? "");
  const range = timeRange(parsed);
  const sdk = await loadSdk();
  const search = profileStageSync("evidence.search", () => sdk.searchEvidence(result, {
    artifactIds: options(parsed, "--artifact-id"),
    kinds: options(parsed, "--kind"),
    nodes: options(parsed, "--node"),
    tasks: options(parsed, "--task"),
    text: options(parsed, "--text"),
    ...(range === undefined ? {} : { timeRange: range }),
    ...(integerOption(parsed, "--limit") === undefined ? {} : { limit: integerOption(parsed, "--limit") as number }),
  }));
  const format = option(parsed, "--format") ?? (process.stdout.isTTY ? "text" : "json");
  if (format !== "json" && format !== "text") throw new UsageError("search --format must be json or text.");
  if (await emitSelection(sdk, search, parsed, format)) return;
  const rendered = profileStageSync("render", () => sdk.renderEvidenceSearch(search, format));
  await emit(rendered, option(parsed, "--output"));
}

async function runTimeline(parsed: ParsedArguments): Promise<void> {
  const result = await readInspection(option(parsed, "--input") ?? "");
  const format = option(parsed, "--format") ?? (process.stdout.isTTY ? "text" : "json");
  if (format !== "json" && format !== "text") {
    throw new UsageError("timeline --format must be json or text.");
  }
  const tasks = options(parsed, "--task");
  const sdk = await loadSdk();
  if (await emitSelection(sdk, sdk.taskTimeline(result, { tasks }), parsed, format)) return;
  const rendered = profileStageSync("render", () => sdk.renderTaskTimeline(result, format, {
    tasks,
  }));
  await emit(rendered, option(parsed, "--output"));
}

async function runBatch(parsed: ParsedArguments): Promise<void> {
  const result = await readInspection(option(parsed, "--input") ?? "");
  const sdk = await loadSdk();
  const requests = await profileStage("batch.requests_load", () =>
    readBatchRequests(option(parsed, "--requests") ?? ""));
  const batch = await profileStage("evidence.batch", () => sdk.queryEvidenceBatch(result, requests));
  if (await emitSelection(sdk, batch, parsed, "json")) return;
  const rendered = profileStageSync("render", () => JSON.stringify(batch, null, 2));
  await emit(rendered, option(parsed, "--output"));
}

async function runSkill(parsed: ParsedArguments): Promise<void> {
  const installDirectory = option(parsed, "--install");
  const checkDirectory = option(parsed, "--check");
  const print = flag(parsed, "--print");
  const file = option(parsed, "--file");
  const modes = [print, installDirectory !== undefined, checkDirectory !== undefined]
    .filter(Boolean).length;
  if (modes !== 1) {
    throw new UsageError("skill requires exactly one of --print, --install <dir>, or --check <dir>.");
  }
  if (file !== undefined && !print) {
    throw new UsageError("--file selects a Skill document to print; it can only be combined with --print.");
  }
  const format = option(parsed, "--format");
  if (format !== undefined && format !== "json" && format !== "text") {
    throw new UsageError("skill --format must be json or text.");
  }
  const skill = await loadPackagedSkill();
  if (checkDirectory !== undefined) {
    const check = await checkPackagedSkill(skill, checkDirectory);
    const resolved = format ?? (process.stdout.isTTY ? "text" : "json");
    const rendered = resolved === "json"
      ? JSON.stringify(check, null, 2)
      : [
        `MaaEvidenceKit Skill ${check.version}`,
        `Installed: ${check.installedDirectory}`,
        check.installed
          ? (check.match
            ? "Status: matches the packaged copy"
            : "Status: differs from the packaged copy")
          : "Status: no installed Skill at this path",
        ...check.files.map((entry) => `- ${entry.path}: ${entry.status}`),
        ...(check.extraFiles.length === 0
          ? []
          : [`- not part of the packaged payload: ${check.extraFiles.join(", ")}`]),
      ].join("\n");
    await emit(rendered, option(parsed, "--output"));
    return;
  }
  if (installDirectory !== undefined) {
    const install = await installPackagedSkill(skill, installDirectory);
    const resolved = format ?? (process.stdout.isTTY ? "text" : "json");
    const rendered = resolved === "json"
      ? JSON.stringify(install, null, 2)
      : [
        `Installed MaaEvidenceKit Skill ${install.version} into ${install.installedDirectory}`,
        ...install.files.map((entry) => `- ${entry}`),
      ].join("\n");
    await emit(rendered, option(parsed, "--output"));
    return;
  }
  const selected = file ?? PACKAGED_SKILL_ENTRY;
  const content = await readPackagedSkillFile(skill, selected);
  if (format === "json") {
    const entry = skill.files.find((candidate) => candidate.path === selected);
    await emit(JSON.stringify({
      name: skill.name,
      version: skill.version,
      entry: skill.entry,
      directory: skill.directory,
      files: skill.files,
      selected: { ...entry, content },
    }, null, 2), option(parsed, "--output"));
    return;
  }
  await emit(content, option(parsed, "--output"));
}

async function runTelemetry(parsed: ParsedArguments): Promise<void> {
  const action = requirePositional(parsed, 1, "telemetry action");
  const sdk = await loadSdk();
  if (action === "status") {
    await emit(JSON.stringify({ status: await sdk.getTelemetryStatus() }, null, 2), option(parsed, "--output"));
    return;
  }
  if (action === "enable" || action === "disable") {
    await sdk.setTelemetryEnabled(action === "enable");
    await emit(JSON.stringify({ status: action === "enable" ? "enabled" : "disabled" }, null, 2), option(parsed, "--output"));
    return;
  }
  throw new UsageError("telemetry action must be status, enable, or disable.");
}

function feedbackComponent(parsed: ParsedArguments): "mla" | "mse" | "discovery" | "views" | "other" {
  const component = option(parsed, "--component") ?? "other";
  if (!["mla", "mse", "discovery", "views", "other"].includes(component)) {
    throw new UsageError("--component must be mla, mse, discovery, views, or other.");
  }
  return component as "mla" | "mse" | "discovery" | "views" | "other";
}

function feedbackCategory(parsed: ParsedArguments): FeedbackCategory {
  const value = option(parsed, "--category") ?? "other";
  if (!["blocker", "bug", "suggestion", "other"].includes(value)) {
    throw new UsageError("--category must be blocker, bug, suggestion, or other.");
  }
  return value as FeedbackCategory;
}

async function runFeedbackApprove(parsed: ParsedArguments): Promise<void> {
  const message = option(parsed, "--message");
  if (message === undefined) throw new UsageError("feedback approve requires --message.");
  const out = option(parsed, "--out");
  if (out === undefined) throw new UsageError("feedback approve requires --out.");
  const sdk = await loadSdk();
  const preview = await sdk.previewFeedback({
    message,
    category: feedbackCategory(parsed),
    component: feedbackComponent(parsed),
    attachmentPaths: options(parsed, "--attachment"),
  });
  // Approval is the human step: it writes a token instead of submitting, so an agent can later
  // submit exactly this payload without answering a prompt on the human's behalf.
  if (!process.stdin.isTTY || !process.stderr.isTTY) {
    throw new UsageError(
      "feedback approve must run in an interactive terminal; it records the human approval that a later --token submission relies on.",
    );
  }
  process.stderr.write("\nFeedback approval\n");
  process.stderr.write(`Category: ${preview.category}\n`);
  process.stderr.write(`Message: ${preview.message}\n`);
  process.stderr.write(`Attachments: ${preview.attachments.length} (${preview.totalAttachmentBytes} bytes)\n`);
  for (const attachment of preview.attachments) {
    process.stderr.write(`- ${attachment.path} (${attachment.sizeBytes} bytes)\n`);
  }
  for (const warning of preview.warnings) process.stderr.write(`WARNING: ${warning}\n`);
  const reader = createInterface({ input: process.stdin, output: process.stderr });
  try {
    const answer = await reader.question(
      "Type UPLOAD to approve exactly this feedback for later submission, or anything else to cancel: ",
    );
    if (answer.trim() !== "UPLOAD") throw new UsageError("Feedback approval cancelled.");
  } finally {
    reader.close();
  }
  const token = sdk.createApprovalToken({
    message: preview.message,
    category: preview.category,
    component: preview.component,
    attachments: preview.attachments,
  });
  await sdk.writeApprovalToken(out, token);
  process.stderr.write(
    `Approved until ${token.expiresAt}. Submit with: maa-evidence feedback --message ... --token ${out}\n`,
  );
}

async function runFeedback(parsed: ParsedArguments): Promise<void> {
  const message = option(parsed, "--message");
  if (message === undefined) throw new UsageError("feedback requires --message.");
  const attachments = options(parsed, "--attachment");
  const sdk = await loadSdk();
  const preview = await sdk.previewFeedback({
    message,
    category: feedbackCategory(parsed),
    component: feedbackComponent(parsed),
    attachmentPaths: attachments,
  });

  // Printing the exact payload is the cheapest way to let a human or an agent review what would be
  // sent. It never submits, and it works without a terminal so an agent can show a human.
  if (flag(parsed, "--preview")) {
    await emit(JSON.stringify({
      previewOnly: true,
      category: preview.category,
      component: preview.component,
      message: preview.message,
      attachments: preview.attachments.map((attachment) => ({
        filename: attachment.filename,
        sizeBytes: attachment.sizeBytes,
        large: attachment.large,
      })),
      totalAttachmentBytes: preview.totalAttachmentBytes,
      warnings: preview.warnings,
    }, null, 2), option(parsed, "--output"));
    return;
  }

  const tokenPath = option(parsed, "--token");
  if (tokenPath !== undefined) {
    // A valid approval stands in for the terminal prompt; an invalid or mismatched token is refused
    // rather than silently falling back to prompting. Consuming the token before uploading keeps one
    // approval to one submission.
    await sdk.consumeApprovalToken(tokenPath, {
      message: preview.message,
      category: preview.category,
      component: preview.component,
      attachments: preview.attachments,
    });
    const eventId = await sdk.submitFeedback(preview);
    await emit(JSON.stringify({ sent: true, eventId, approvedBy: tokenPath }, null, 2), option(parsed, "--output"));
    return;
  }

  if (!process.stdin.isTTY || !process.stderr.isTTY) {
    throw new UsageError(
      "Feedback submission requires an interactive terminal for per-submission confirmation. "
      + "Run \"feedback approve --message ... --out token.json\" in a real terminal first, then submit with --token token.json.",
    );
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
    if (answer.trim() !== "UPLOAD") throw new UsageError("Feedback upload cancelled.");
  } finally {
    reader.close();
  }
  const eventId = await sdk.submitFeedback(preview);
  await emit(JSON.stringify({ sent: true, eventId }, null, 2), option(parsed, "--output"));
}

function countsFromInspection(result: InspectionResult): OperationalCounts {
  const counts: { [key: string]: number } = { evidenceCount: result.evidence.length };
  const details = result.details as { mla?: { evidence?: unknown[] } | null; mse?: { evidence?: unknown[] } | null } | null;
  if (details?.mla?.evidence !== undefined) counts["mlaEvidenceCount"] = details.mla.evidence.length;
  if (details?.mse?.evidence !== undefined) counts["mseEvidenceCount"] = details.mse.evidence.length;
  if (result.kind === "combined") {
    const statistics = (result as { statistics: Record<string, number> }).statistics;
    counts["adapters"] = statistics["adapters"] ?? 0;
    counts["runtimeNodeResolutionOmitted"] = statistics["mseRuntimeNodesOmitted"] ?? 0;
  }
  if (result.kind === "mla" || result.kind === "combined") {
    if (result.kind === "mla") {
      counts["signalsTotal"] = (result as { statistics: Record<string, number> }).statistics["signalsTotal"] ?? 0;
    }
    const evidence = (result as { evidence: Array<{ kind: string }> }).evidence;
    counts["recognitionDetails"] = evidence.filter((item) => item.kind === "mla.recognition_detail").length;
    counts["cycleExitBlockers"] = evidence.filter((item) => item.kind === "mla.cycle_exit_blocker").length;
    counts["taskAnomalies"] = evidence.filter((item) => item.kind === "mla.task_anomaly").length;
    counts["possibleMirroredTaskGroups"] = evidence.filter((item) => item.kind === "mla.possible_mirrored_task_group").length;
    counts["recognitionPipelineReferences"] = evidence.filter((item) => item.kind === "combined.recognition_pipeline_reference").length;
  }
  if (result.kind === "repo_docs") {
    counts["repoDocsAgentsDocuments"] = result.statistics["agentsDocumentsSelected"] ?? 0;
    counts["repoDocsAgentsOmitted"] = result.statistics["agentsDocumentsOmitted"] ?? 0;
    counts["repoDocsAgentsTruncated"] = result.statistics["agentsDocumentsTruncated"] ?? 0;
    counts["repoDocsSkillFiles"] = result.statistics["skillFilesSelected"] ?? 0;
    counts["repoDocsSkillFilesOmitted"] = result.statistics["skillFilesOmitted"] ?? 0;
    counts["repoDocsScanTruncated"] = result.statistics["scanTruncated"] ?? 0;
  }
  return Object.fromEntries(
    Object.entries(counts).filter(([, value]) => value !== undefined),
  ) as OperationalCounts;
}

async function withOperationalTelemetry(
  command: string,
  component: "mla" | "mse" | "combined" | "view" | "window" | "search" | "batch" | "repo-docs"
    | "timeline",
  operation: () => Promise<InspectionResult | void>,
): Promise<void> {
  const startedAt = performance.now();
  try {
    const result = await operation();
    const { recordOperationalTelemetry } = await loadSdk();
    await recordOperationalTelemetry({
      command,
      component,
      status: "ok",
      durationMs: performance.now() - startedAt,
      ...(result === undefined ? {} : { counts: countsFromInspection(result) }),
    });
  } catch (error: unknown) {
    // Both the reporter and the classifier are only needed once a command has ended, so neither is
    // imported while a command is still running.
    const { recordOperationalTelemetry } = await loadSdk();
    const { classifyOperationalError } = await import("../feedback/sentry.js");
    const errorStage: OperationalErrorStage = component === "repo-docs"
      ? "repository_scan"
      : ["window", "view", "search", "batch", "timeline"].includes(component)
        ? "evidence_query"
        : "inspection";
    await recordOperationalTelemetry({
      command,
      component,
      status: "error",
      durationMs: performance.now() - startedAt,
      errorCategory: classifyOperationalError(error),
      errorStage,
    });
    throw error;
  }
}

async function runOperationalCommand(
  parsed: ParsedArguments,
  command: string,
  component: "mla" | "mse" | "combined" | "view" | "window" | "search" | "batch" | "repo-docs"
    | "timeline",
  operation: () => Promise<InspectionResult | void>,
): Promise<void> {
  await withLocalProfile(command, parsed, () =>
    withOperationalTelemetry(command, component, operation));
}

export async function main(args: string[] = process.argv.slice(2)): Promise<number> {
  try {
    const parsed = parseArguments(args);
    if (flag(parsed, "--version")) {
      process.stdout.write(`${MAA_EVIDENCE_VERSION}\n`);
      return 0;
    }
    if (args.length === 0 || flag(parsed, "--help") || flag(parsed, "-h")) {
      // `--help` follows the named command, because the top-level usage cannot show the defaults
      // and limits that decide whether an invocation is cheap or exhaustive.
      process.stdout.write(args.length === 0 ? TOP_LEVEL_HELP : commandHelp(parsed));
      return 0;
    }
    // Reject options the named command does not understand, so a misplaced flag cannot look like it
    // took effect.
    rejectUnknownOptions(parsed);
    switch (requirePositional(parsed, 0, "command")) {
      case "mla":
        rejectUnexpectedPositionals(parsed, 3);
        await runOperationalCommand(parsed, "mla.inspect", "mla", () => runMla(parsed));
        return 0;
      case "mse":
        rejectUnexpectedPositionals(parsed, 3);
        await runOperationalCommand(
          parsed,
          `mse.${mseCommand(parsed)}`,
          "mse",
          () => runMse(parsed),
        );
        return 0;
      case "repo-docs":
        rejectUnexpectedPositionals(parsed, 2);
        await runOperationalCommand(parsed, "repo-docs", "repo-docs", () => runRepoDocs(parsed));
        return 0;
      case "inspect":
        rejectUnexpectedPositionals(parsed, 2);
        await runOperationalCommand(parsed, "inspect", "combined", () => runCombined(parsed));
        return 0;
      case "window":
        rejectUnexpectedPositionals(parsed, 1);
        await runOperationalCommand(parsed, "window", "window", () => runWindow(parsed));
        return 0;
      case "view":
        rejectUnexpectedPositionals(parsed, 1);
        await runOperationalCommand(parsed, "view", "view", () => runView(parsed));
        return 0;
      case "search":
        rejectUnexpectedPositionals(parsed, 1);
        await runOperationalCommand(parsed, "search", "search", () => runSearch(parsed));
        return 0;
      case "batch":
        rejectUnexpectedPositionals(parsed, 1);
        await runOperationalCommand(parsed, "batch", "batch", () => runBatch(parsed));
        return 0;
      case "timeline":
        rejectUnexpectedPositionals(parsed, 1);
        await runOperationalCommand(parsed, "timeline", "timeline", () => runTimeline(parsed));
        return 0;
      case "telemetry":
        rejectUnexpectedPositionals(parsed, 2);
        await runTelemetry(parsed);
        return 0;
      case "skill":
        rejectUnexpectedPositionals(parsed, 1);
        await runSkill(parsed);
        return 0;
      case "feedback":
        if (parsed.positionals[1] === "approve") {
          rejectUnexpectedPositionals(parsed, 2);
          await runFeedbackApprove(parsed);
          return 0;
        }
        rejectUnexpectedPositionals(parsed, 1);
        await runFeedback(parsed);
        return 0;
      default:
        throw new UsageError(`Unknown command: ${requirePositional(parsed, 0, "command")}`);
    }
  } catch (error: unknown) {
    process.stderr.write(`maa-evidence: ${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}

const invokedPath = process.argv[1];
if (invokedPath !== undefined && import.meta.url === pathToFileURL(realpathSync(invokedPath)).href) {
  process.exitCode = await runWithAutomaticUpdates(process.argv.slice(2), main);
}
