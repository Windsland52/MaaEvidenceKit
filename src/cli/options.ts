import { UsageError } from "../evidence/index.js";

import type { ParsedArguments } from "./args.js";

/**
 * Options accepted by every command. `--summary` is deliberately not here: it changes only the
 * inspection commands' stdout, so accepting it on `view` or `search` would let it look like it did
 * something.
 */
const COMMON = ["--format", "--help", "-h", "--output", "--profile", "--version"];

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
  const unknown = [...parsed.options.keys()].filter((name) => !allowed.has(name)).sort();
  if (unknown.length === 0) return;
  const known = [...allowed].sort().join(", ");
  throw new UsageError(
    `Unknown option for ${key}: ${unknown.join(", ")}. ${key} accepts: ${known}.`,
  );
}
