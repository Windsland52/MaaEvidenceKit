#!/usr/bin/env node

import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";

import type {
  FeedbackCategory,
  InspectionResult,
  MseSyntaxMode,
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
  if (output === undefined && format === "json" && rendered.length > sdk.VIEW_DEFAULT_MAX_CHARACTERS) {
    process.stderr.write(
      `JSON inspection is ${rendered.length} characters on stdout and is never truncated. `
      + "Prefer --summary with --output FILE, or --fields, before piping this into a model context.\n",
    );
  }
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
  // No familyRoot override: the record already carries the one its coverage was computed with, so
  // the rendered labels cannot disagree with the stored counts.
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
 * Budgets for the text rendering of `view` and `timeline`.
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
    kinds: [...options(parsed, "--kind"), ...options(parsed, "--kinds")],
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
  const sdk = await loadSdk();
  const budget = viewTextBudget(sdk, parsed, format);
  const tasks = options(parsed, "--task");
  if (await emitSelection(sdk, sdk.taskTimeline(result, { tasks }), parsed, format)) return;
  const rendered = profileStageSync("render", () => sdk.renderTaskTimeline(result, format, {
    tasks,
  }));
  await emitRendered(sdk, rendered, parsed, format, budget);
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

async function runFeedback(parsed: ParsedArguments): Promise<void> {
  const message = option(parsed, "--message");
  if (message === undefined) throw new UsageError("feedback requires --message.");
  const sdk = await loadSdk();
  const preview = await sdk.previewFeedback({
    message,
    category: feedbackCategory(parsed),
    component: feedbackComponent(parsed),
    attachmentPaths: options(parsed, "--attachment"),
  });

  // Printing the exact bundle payload is the cheapest way to let a human or an agent review what
  // they are about to send. Nothing is written and nothing leaves the machine.
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

  const out = option(parsed, "--out");
  if (out === undefined) {
    throw new UsageError("feedback requires --out FILE so the bundle goes somewhere you chose, or --preview to print it.");
  }
  const bundle = await sdk.writeFeedbackBundle(preview, out, { version: MAA_EVIDENCE_VERSION });
  await emit(JSON.stringify({
    written: out,
    schemaVersion: bundle.schemaVersion,
    attachments: bundle.attachments.length,
    totalAttachmentBytes: bundle.totalAttachmentBytes,
    warnings: bundle.warnings,
  }, null, 2), option(parsed, "--output"));
}

async function runOperationalCommand(
  parsed: ParsedArguments,
  command: string,
  operation: () => Promise<InspectionResult | void>,
): Promise<void> {
  await withLocalProfile(command, parsed, operation);
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
        await runOperationalCommand(parsed, "mla.inspect", () => runMla(parsed));
        return 0;
      case "mse":
        rejectUnexpectedPositionals(parsed, 3);
        await runOperationalCommand(
          parsed,
          `mse.${mseCommand(parsed)}`,
          () => runMse(parsed),
        );
        return 0;
      case "repo-docs":
        rejectUnexpectedPositionals(parsed, 2);
        await runOperationalCommand(parsed, "repo-docs", () => runRepoDocs(parsed));
        return 0;
      case "inspect":
        rejectUnexpectedPositionals(parsed, 2);
        await runOperationalCommand(parsed, "inspect", () => runCombined(parsed));
        return 0;
      case "window":
        rejectUnexpectedPositionals(parsed, 1);
        await runOperationalCommand(parsed, "window", () => runWindow(parsed));
        return 0;
      case "view":
        rejectUnexpectedPositionals(parsed, 1);
        await runOperationalCommand(parsed, "view", () => runView(parsed));
        return 0;
      case "search":
        rejectUnexpectedPositionals(parsed, 1);
        await runOperationalCommand(parsed, "search", () => runSearch(parsed));
        return 0;
      case "batch":
        rejectUnexpectedPositionals(parsed, 1);
        await runOperationalCommand(parsed, "batch", () => runBatch(parsed));
        return 0;
      case "timeline":
        rejectUnexpectedPositionals(parsed, 1);
        await runOperationalCommand(parsed, "timeline", () => runTimeline(parsed));
        return 0;
      case "skill":
        rejectUnexpectedPositionals(parsed, 1);
        await runSkill(parsed);
        return 0;
      case "feedback":
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
