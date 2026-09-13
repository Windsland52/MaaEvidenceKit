import { UsageError } from "../evidence/index.js";

import type { ParsedArguments } from "./args.js";

/**
 * Options accepted by every command. `--summary` is deliberately not here: it changes only the
 * inspection commands' stdout, so accepting it on `view` or `search` would let it look like it did
 * something.
 */
const COMMON = ["--help", "-h", "--output", "--profile", "--version"];

/** Commands that print a bounded `--summary` to stdout instead of a full document. */
const SUMMARY_COMMANDS = new Set(["mla inspect", "mse inspect", "mse resolve", "repo-docs", "inspect"]);

/**
 * Commands whose output format is selectable. `feedback`, `feedback approve`, and `telemetry` always
 * print JSON, so accepting `--format` there would be the same silent no-op this table exists to
 * prevent.
 */
const FORMAT_COMMANDS = new Set([
  "mla inspect",
  "mse inspect",
  "mse resolve",
  "repo-docs",
  "inspect",
  "view",
  "window",
  "search",
  "timeline",
]);

/** Options that belong to exactly one command family, so a rejection can name the right command. */
const SOLE_COMMAND_OPTIONS: Record<string, string> = {
  "--all-signals": "mla inspect",
  "--attachment": "feedback",
  "--category": "feedback",
  "--component": "feedback",
  "--git-ref": "mse inspect",
  "--keyword": "mla inspect",
  "--message": "feedback",
  "--out": "feedback approve",
  "--preview": "feedback",
  "--referencers": "inspect",
  "--requests": "batch",
  "--syntax-mode": "mse inspect, mse resolve, or inspect",
  "--token": "feedback",
  "--no-mla": "inspect",
  "--no-mse": "inspect",
};

/**
 * Explain why one option is not valid here, so the caller can fix the invocation without guessing.
 * A bare "unknown option" leaves the reader to work out whether the option is misspelled, belongs to
 * another command, or is simply not supported by this one.
 */
function rejectionReason(name: string, key: string): string {
  const owner = SOLE_COMMAND_OPTIONS[name];
  if (name === "--summary" && !SUMMARY_COMMANDS.has(key)) {
    return "only the inspection commands print a bounded summary"
      + " (mla inspect, mse inspect, mse resolve, repo-docs, inspect), so it would have no effect here";
  }
  if (name === "--format" && !FORMAT_COMMANDS.has(key)) {
    return "this command always prints JSON, so a format would have no effect here";
  }
  if (owner !== undefined && !owner.split(", ").includes(key)) {
    return `this option belongs to ${owner}`;
  }
  if (name === "--evidence-id" && key === "search") {
    return "search returns matching IDs; use view or window to read one of them";
  }
  if (name === "--artifact-id" && key === "timeline") {
    return "timeline renders a saved inspection; filter it with --task";
  }
  return "not supported by this command";
}

/** Options for commands that read a saved inspection and issue a bounded query against it. */
const INSPECTION_INPUT = ["--input"];

const TIME_RANGE = ["--from", "--to"];

const MSE_OPTIONS = [
  "--controller",
  "--depth",
  "--no-referencers",
  "--resource",
  "--syntax-mode",
  "--task",
];

/**
 * Options each command accepts, beyond the common set.
 *
 * `parseArguments` validates options against one global vocabulary, so before this table a
 * misplaced flag such as `mla inspect --token foo` was accepted and silently ignored. MEK exports
 * facts other people cite, and a flag that appears to take effect but does nothing is worse than a
 * rejection, so each command now declares what it understands. Command keys are the leading
 * positional words, which is also what makes `mse inspect` and `mse resolve` distinct.
 */
const COMMAND_OPTIONS: Record<string, readonly string[]> = {
  "mla inspect": ["--all-signals", "--keyword", "--summary", ...TIME_RANGE],
  // --git-ref is inspect-only: resolveMse has its own path and does not read it.
  "mse inspect": [...MSE_OPTIONS, "--git-ref", "--summary"],
  "mse resolve": [...MSE_OPTIONS, "--summary"],
  "repo-docs": ["--summary"],
  inspect: [
    ...MSE_OPTIONS,
    "--no-mla",
    "--no-mse",
    "--referencers",
    "--summary",
    ...TIME_RANGE,
  ],
  view: [...INSPECTION_INPUT, "--evidence-id"],
  window: [
    ...INSPECTION_INPUT,
    "--after",
    "--artifact-id",
    "--before",
    "--evidence-id",
    "--line",
    "--max-characters",
    "--max-lines",
  ],
  search: [...INSPECTION_INPUT, "--artifact-id", "--kind", "--limit", "--node", "--task", "--text", ...TIME_RANGE],
  batch: [...INSPECTION_INPUT, "--requests"],
  timeline: [...INSPECTION_INPUT, "--evidence-id", "--task"],
  telemetry: [],
  feedback: ["--attachment", "--category", "--component", "--message", "--preview", "--token"],
  "feedback approve": ["--attachment", "--category", "--component", "--message", "--out"],
};

/**
 * Resolve the command key used by `COMMAND_OPTIONS` from positional arguments.
 *
 * The key is built from the leading non-option words that name a command, so `mse inspect` and
 * `feedback approve` are distinct from `mse resolve` and `feedback`.
 */
export function commandKey(parsed: ParsedArguments): string {
  const [first, second] = parsed.positionals;
  if (first === undefined) return "";
  if (first === "mse") return second === "resolve" ? "mse resolve" : "mse inspect";
  if (first === "mla") return "mla inspect";
  if (first === "feedback") return second === "approve" ? "feedback approve" : "feedback";
  return first;
}

/** Reject options the current command does not understand instead of ignoring them. */
export function rejectUnknownOptions(parsed: ParsedArguments): void {
  const key = commandKey(parsed);
  const accepted = COMMAND_OPTIONS[key];
  // An unrecognized command is reported by the dispatcher; do not mask it with an option error.
  if (accepted === undefined) return;
  const allowed = new Set([...COMMON, ...accepted]);
  if (FORMAT_COMMANDS.has(key)) allowed.add("--format");
  const unknown = [...parsed.options.keys()].filter((name) => !allowed.has(name)).sort();
  if (unknown.length === 0) return;
  const reasons = unknown.map((name) => `- ${name}: ${rejectionReason(name, key)}`);
  throw new UsageError(
    `Unknown option for ${key}:\n${reasons.join("\n")}\n`
    + `${key} accepts: ${[...allowed].sort().join(", ")}.`,
  );
}
