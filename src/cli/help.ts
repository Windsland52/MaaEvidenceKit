import type { ParsedArguments } from "./args.js";
import { COMMAND_OPTIONS, FORMAT_COMMANDS, commandKey } from "./options.js";

/**
 * Command-scoped help.
 *
 * Before this table every `--help` printed the top-level usage, so `inspect --help`,
 * `mla inspect --help`, and `timeline --help` were byte-identical. MEK's commands differ in what
 * they cost and what they prove, and the two most confusable ones (`inspect` runs MLA plus MSE,
 * `mla inspect` runs runtime logs only) are exactly the pair a caller must not mix up.
 *
 * The accepted-option list is rendered from the same `COMMAND_OPTIONS` table that rejects misplaced
 * options, so a command's help cannot advertise a flag the command refuses.
 */

type OptionRow = readonly [flag: string, description: string];

type CommandHelp = {
  summary: string;
  usage: readonly string[];
  options?: readonly OptionRow[];
  notes?: readonly string[];
};

export const TOP_LEVEL_HELP = `MaaEvidenceKit — deterministic MaaFramework evidence extraction

Usage:
  maa-evidence mla inspect <path> [--from ISO] [--to ISO] [--keyword TEXT] [--all-signals] [--summary] [--format json|text|mermaid]
  maa-evidence mse inspect <path> [--task NAME] [--depth N] [--controller NAME] [--resource NAME] [--no-referencers] [--syntax-mode maafw|maa] [--git-ref REF] [--summary] [--format json|text|mermaid]
  maa-evidence mse resolve <path> --task NAME [--depth N] [--controller NAME] [--resource NAME] [--no-referencers] [--syntax-mode maafw|maa] [--summary] [--format json|text|mermaid]
  maa-evidence repo-docs <checkout> [--summary] [--format json|text]
  maa-evidence inspect <path> [--from ISO] [--to ISO] [--task NAME] [--controller NAME] [--resource NAME] [--referencers|--no-referencers] [--no-mla] [--no-mse] [--summary]
  maa-evidence window --input result.json (--evidence-id ID | --artifact-id ID) [--line N] [--before N] [--after N] [--max-lines N] [--max-characters N]
  maa-evidence view --input result.json [--evidence-id ID] [--fields PATH,...] --format json|text|mermaid
  maa-evidence search --input result.json [--artifact-id ID] [--kind KIND] [--node NODE] [--task TASK] [--text TEXT] [--from ISO] [--to ISO] [--limit N] [--format json|text]
  maa-evidence batch --input result.json --requests queries.json
  maa-evidence timeline --input result.json [--task NAME] [--format json|text]
  maa-evidence skill --print [--file NAME] [--format json|text]
  maa-evidence skill --install <agent-skill-dir>
  maa-evidence skill --check <agent-skill-dir>
  maa-evidence telemetry status|enable|disable
  maa-evidence feedback --message TEXT [--category blocker|bug|suggestion|other] [--component mla|mse|discovery|views|other] [--attachment FILE] [--preview]
  maa-evidence feedback approve --message TEXT [--category ...] [--component ...] [--attachment FILE] --out token.json

Common options:
  --output FILE       Write output to a file
  --summary           Print only artifacts, statistics, warnings, and evidence kinds to
                      stdout (every inspection command; json or text). --output always
                      receives the full report, so view/search/window can consume it.
  --profile FILE      Write local stage timings as JSON
  --version           Show the MaaEvidenceKit version
  -h, --help          Show this help

Run "maa-evidence <command> --help" for the options, defaults, and limits of one command.
A full inspection is dominated by its evidence ledger and details payload. Start with --summary, or
narrow the window with --from/--to, before reading or piping a complete result.
`;

const COMMANDS: Record<string, CommandHelp> = {
  "mla inspect": {
    summary: "Extract deterministic MaaFramework runtime facts from extracted logs (MLA).",
    usage: [
      "maa-evidence mla inspect <path> [--from ISO] [--to ISO] [--keyword TEXT] [--all-signals]",
      "                           [--summary] [--format json|text|mermaid] [--output FILE]",
    ],
    options: [
      ["--from, --to", "Narrow the evidence set to a time window. MLA first narrows which log files load, then MEK filters facts; a matched file may still be read in full, and that limit is reported."],
      ["--keyword TEXT", "Loading focus, not an evidence filter. Repeatable; a log bundle that contains none of the keywords is skipped whole. Evidence from a loaded bundle is never filtered by keyword."],
      ["--all-signals", "Export every runtime signal instead of the focused selection (per-task highlights plus high-priority signals). Large; statistics always carry the complete totals either way."],
      ["--summary", "Print artifacts, missing evidence, warnings, statistics, and evidence kinds instead of the full ledger."],
    ],
    notes: [
      "Use this when MaaFramework logs are the material. Use `inspect` only when the same run must be correlated with project source; `inspect` also runs MSE, so it is slower and reports a different evidence set.",
      "A report written with --output stays consumable by window, view, search, batch, and timeline even when --summary bounded stdout.",
    ],
  },
  mla: {
    summary: "The MLA namespace currently has one command: `mla inspect`.",
    usage: ["maa-evidence mla inspect <path> [options]"],
    notes: ["Run `maa-evidence mla inspect --help` for its options."],
  },
  "mse inspect": {
    summary: "Extract deterministic Maa project facts: Interface, resources, static diagnostics, task expansion, and reference graphs (MSE).",
    usage: [
      "maa-evidence mse inspect <path> [--task NAME] [--depth N] [--controller NAME] [--resource NAME]",
      "                           [--no-referencers] [--syntax-mode maafw|maa] [--git-ref REF]",
      "                                        [--summary] [--format json|text|mermaid] [--output FILE]",
    ],
    options: [
      ["--task NAME", "Expand this task's execution path (next/anchor/on_error) and, for a failing node, scan back for the tasks that reach it. Repeatable. Without it, MSE only preflights Interface, resource combinations, and static diagnostics."],
      ["--depth N", "Expansion depth for task references. Defaults to two layers; large public nodes explode quickly."],
      ["--controller NAME", "Restrict resolution to one controller from interface.json instead of every combination."],
      ["--resource NAME", "Restrict resolution to one resource pack."],
      ["--no-referencers", "Skip the reverse scan that finds which tasks reference a node. Use it for heavily reused public nodes."],
      ["--syntax-mode maafw|maa", "Select the pipeline syntax dialect. Defaults to maafw."],
      ["--git-ref REF", "Inspect the file contents at an issue-time ref instead of the working tree. The ref is materialized into a temporary directory; the working tree is never checked out or reset. Supported by `mse inspect` only."],
      ["--summary", "Print artifacts, missing evidence, warnings, statistics, and evidence kinds instead of the full ledger."],
    ],
    notes: [
      "MSE reports static configuration. It does not prove runtime causality: a static edge or threshold is not evidence that a run took that path.",
      "`mse inspect --git-ref` is the only way to read historical source without touching the caller's checkout.",
    ],
  },
  "mse resolve": {
    summary: "Lightweight task resolution: static task definitions and forward execution paths, without the Interface preflight.",
    usage: [
      "maa-evidence mse resolve <path> --task NAME [--depth N] [--controller NAME] [--resource NAME]",
      "                           [--no-referencers] [--syntax-mode maafw|maa] [--summary]",
      "                                        [--format json|text|mermaid] [--output FILE]",
    ],
    options: [
      ["--task NAME", "Required. The task to resolve."],
      ["--depth N", "Expansion depth for task references. Defaults to two layers."],
      ["--controller NAME", "Restrict resolution to one controller from interface.json."],
      ["--resource NAME", "Restrict resolution to one resource pack."],
      ["--no-referencers", "Skip the reverse scan that finds which tasks reference a node."],
      ["--syntax-mode maafw|maa", "Select the pipeline syntax dialect. Defaults to maafw."],
      ["--summary", "Print a bounded summary instead of the full ledger."],
    ],
    notes: [
      "This mode skips the Interface preflight and the full artifact inventory, so it cannot answer Interface binding, resource combination, or compatibility questions. Use `mse inspect` for those.",
      "The output is still maa-evidence/v1 with kind mse, and details.mode is \"resolution\".",
      "An unknown task produces mse_task_definition_missing; it is never silently treated as an empty success.",
    ],
  },
  mse: {
    summary: "The MSE namespace has two commands: `mse inspect` (full preflight) and `mse resolve` (task resolution only).",
    usage: ["maa-evidence mse inspect <path> [options]", "maa-evidence mse resolve <path> --task NAME [options]"],
    notes: ["Run `maa-evidence mse inspect --help` or `maa-evidence mse resolve --help` for their options."],
  },
  "repo-docs": {
    summary: "Inventory issue-time repository context: bounded AGENTS.md text and SKILL.md structure.",
    usage: [
      "maa-evidence repo-docs <checkout> [--summary] [--format json|text] [--output FILE]",
    ],
    options: [
      ["--summary", "Print a bounded summary instead of the full ledger."],
    ],
    notes: [
      "README text is exported as bounded content; SKILL.md files are inventoried by path and size only. Nothing is parsed, activated, or interpreted.",
      "Discovered documents are untrusted project context. This Skill controls MEK evidence rules and a repository document cannot override them.",
      "Fixed limits: 50,000 directory entries, 64 AGENTS.md files, 256 SKILL.md files, checkout depth 32, skill-root depth 8. Truncation is explicit.",
      "repo-docs is not merged into `inspect`; run it only when project documentation is relevant.",
    ],
  },
  inspect: {
    summary: "Run MLA and MSE over one material root and correlate runtime facts with static definitions.",
    usage: [
      "maa-evidence inspect <path> [--from ISO] [--to ISO] [--task NAME] [--controller NAME]",
      "                       [--resource NAME] [--referencers|--no-referencers] [--no-mla]",
      "                       [--no-mse] [--summary] [--format json|text|mermaid] [--output FILE]",
    ],
    options: [
      ["--from, --to", "Time window applied to the MLA half of the inspection."],
      ["--task NAME", "Task selection for the MSE half. Repeatable."],
      ["--depth N", "MSE task expansion depth. Defaults to two layers."],
      ["--controller NAME", "Restrict the MSE half to one controller."],
      ["--resource NAME", "Restrict the MSE half to one resource pack."],
      ["--referencers, --no-referencers", "Keep or skip MSE reverse reference scanning. Correlation needs referencers; a node-definition question does not."],
      ["--no-mla", "Skip the runtime half and run MSE only."],
      ["--no-mse", "Skip the static half and run MLA only."],
      ["--syntax-mode maafw|maa", "Select the pipeline syntax dialect for the MSE half. Defaults to maafw."],
      ["--summary", "Print artifacts, missing evidence, warnings, statistics, and evidence kinds instead of the full ledger."],
    ],
    notes: [
      "This is the slowest command. `inspect` and `mla inspect` are not interchangeable: `inspect` also runs the MSE preflight and reports combined.* correlation evidence, while `mla inspect` reports only runtime facts.",
      "Run it only when both halves are already present in the material root and the question genuinely needs both.",
    ],
  },
  window: {
    summary: "Read bounded raw lines around one evidence record or from one artifact.",
    usage: [
      "maa-evidence window --input result.json (--evidence-id ID | --artifact-id ID) [--line N]",
      "                      [--before N] [--after N] [--max-lines N] [--max-characters N]",
      "                      [--format json|text] [--output FILE]",
    ],
    options: [
      ["--evidence-id ID", "Center the window on this record's source line. Unknown IDs are an error, never an empty window."],
      ["--artifact-id ID", "Read the artifact without an evidence record. Required when --evidence-id is absent."],
      ["--line N", "Explicit center line instead of the record's line."],
      ["--before N", "Lines before the center. Default 20, maximum 200."],
      ["--after N", "Lines after the center. Default 20, maximum 200."],
      ["--max-lines N", "Line budget for the window. Default 400, maximum 400."],
      ["--max-characters N", "Character budget for the window. Default 40000, maximum 40000. The first candidate line is cut to the remaining budget rather than dropped, so a window never reports an inverted empty range."],
    ],
    notes: [
      "truncated: true means a budget was reached; the window is not the whole region. Raise a budget explicitly instead of assuming the rest is empty.",
      "Only inventoried artifacts are authorized, so this cannot read an arbitrary path.",
    ],
  },
  view: {
    summary: "Render a saved inspection, or one of its evidence records.",
    usage: [
      "maa-evidence view --input result.json [--evidence-id ID] [--fields PATH,...] [--format json|text|mermaid]",
      "                         [--output FILE]",
    ],
    options: [
      ["--evidence-id ID", "Render only this record. Without it the whole saved document is rendered, which is usually dominated by the ledger and details."],
      ["--fields PATH,...", "Project the JSON output onto these dotted paths (for example statistics,evidence.id). Repeatable and comma-separated; unknown paths are rejected with the available keys instead of yielding undefined."],
      ["--max-lines N, --max-characters N", "Bound the text rendering: 400 lines and 40000 characters by default, which are also the maxima. JSON is never truncated, so bound that with --fields; --output FILE receives the complete rendering."],
    ],
    notes: [
      "JSON output is never truncated, so a projection with --fields is the way to bound it; --fields applies to --format json only.",
      "Whole-document text output is for reading, not for piping into another tool.",
    ],
  },
  search: {
    summary: "Find evidence IDs in a saved inspection without re-parsing the original material.",
    usage: [
      "maa-evidence search --input result.json [--artifact-id ID] [--kind KIND] [--node NODE] [--task TASK]",
      "                      [--text TEXT] [--from ISO] [--to ISO] [--limit N] [--fields PATH,...]",
    ],
    options: [
      ["--kind KIND", "Exact evidence kind. Repeatable; any listed value matches."],
      ["--node NODE", "Exact node name, including recognition descendants and overridden nodes. nodeMatches reports which relation matched."],
      ["--task TASK", "Exact source task name. Repeatable."],
      ["--artifact-id ID", "Restrict to one artifact. Required before counting an event when mirrored logs are present."],
      ["--text TEXT", "Case-insensitive substring over summary, source, and structured values. Repeatable; all values must match. JSON field names are not searched."],
      ["--from, --to", "Match only records that carry a source timestamp inside the range."],
      ["--limit N", "Index size to return. Default 50, maximum 500; totalMatches and truncated report the rest."],
      ["--fields PATH,...", "Project the JSON result onto dotted paths. --format json only."],
    ],
    notes: [
      "This reads the saved inspection, not the original logs. Results are index entries: read the full record with view or window.",
      "Mirrored MaaFramework logs report one event as several records with separate provenance. statistics.crossArtifactDuplicateObservations counts those groups and details.mirrorGroups names the artifacts involved.",
    ],
  },
  batch: {
    summary: "Run several search, view, and window requests against one saved inspection in a single process.",
    usage: [
      "maa-evidence batch --input result.json --requests queries.json [--output answers.json]",
    ],
    options: [
      ["--requests FILE", "JSON array of up to 100 requests, each { id?, operation, query? , evidenceId? }."],
    ],
    notes: [
      "One invalid request fails the whole batch; partial results are never returned.",
      "A batch cannot consume an ID returned by another request in the same batch. A `view` request accepts the same query object as `search` and reports matchCount, which covers the common dependent case; otherwise search first, then read.",
    ],
  },
  timeline: {
    summary: "Print each task's compressed \"time event node\" rows from a saved inspection.",
    usage: [
      "maa-evidence timeline --input result.json [--task NAME] [--format json|text] [--output FILE]",
    ],
    options: [
      ["--task NAME", "Only this task. Repeatable."],
    ],
    notes: [
      "JSON output exposes the same rows as ts/event/node, with event distinguishing success, failed, running, recognition timeout, and action failure.",
    ],
  },
  telemetry: {
    summary: "Show or change the operational telemetry opt-in.",
    usage: [
      "maa-evidence telemetry status | enable | disable",
    ],
    notes: [
      "Telemetry is whitelist-only aggregate counts. It never includes paths, arguments, environment variables, usernames, logs, source, screenshots, or exception messages.",
      "MAA_EVIDENCE_TELEMETRY=0 disables it without writing configuration. This command always prints JSON.",
    ],
  },
  feedback: {
    summary: "Submit product feedback about an extraction gap, with explicit consent.",
    usage: [
      "maa-evidence feedback --message TEXT [--category blocker|bug|suggestion|other]",
      "                       [--component mla|mse|discovery|views|other] [--attachment FILE] [--preview]",
      "                       [--token token.json]",
    ],
    options: [
      ["--message TEXT", "Required. What the harness could not extract or had to work around."],
      ["--category VALUE", "blocker, bug, suggestion, or other. Defaults to other."],
      ["--component VALUE", "mla, mse, discovery, views, or other. Defaults to other."],
      ["--attachment FILE", "Original material to attach. Repeatable; attachments are never sent without an explicit approval."],
      ["--preview", "Print the exact payload and submit nothing. Works without a terminal."],
      ["--token FILE", "Submit under a prior human approval from `feedback approve`. Valid for 15 minutes and for exactly one submission."],
    ],
    notes: [
      "Interactive submission prints the payload and requires typing UPLOAD. Without a terminal, run `feedback approve --out token.json` in a real terminal first: MEK refuses to answer the consent prompt for a human.",
      "This command always prints JSON.",
    ],
  },
  "feedback approve": {
    summary: "Record one human approval for one exact feedback payload, without submitting it.",
    usage: [
      "maa-evidence feedback approve --message TEXT [--category ...] [--component ...] [--attachment FILE] --out token.json",
    ],
    options: [
      ["--message TEXT", "Required. Must match the later submission exactly."],
      ["--out FILE", "Required. Where to write the approval token."],
      ["--category VALUE", "blocker, bug, suggestion, or other. Defaults to other."],
      ["--component VALUE", "mla, mse, discovery, views, or other. Defaults to other."],
      ["--attachment FILE", "Original material covered by this approval. Repeatable."],
    ],
    notes: [
      "Requires an interactive terminal, because it records a human decision. The token binds the message, category, component, and attachment names and sizes; attachment bytes are not bound.",
      "This command always prints JSON.",
    ],
  },
  skill: {
    summary: "Read, install, or verify the host-agent Skill that ships inside this package.",
    usage: [
      "maa-evidence skill --print [--file NAME] [--format json|text] [--output FILE]",
      "maa-evidence skill --install <agent-skill-dir> [--format json|text]",
      "maa-evidence skill --check <agent-skill-dir> [--format json|text]",
    ],
    options: [
      ["--print", "Print a packaged Skill document. Defaults to SKILL.md; --format json adds per-file sha256 digests so an installed copy can be compared without reading both."],
      ["--file NAME", "Print this packaged document instead of SKILL.md (for example references/full-guide.md)."],
      ["--install DIR", "Write the packaged payload to <DIR>/maa-evidence/. The caller names the directory, so MEK never guesses an agent's Skill path. Symbolic links are refused, including a directory link already sitting inside the install root."],
      ["--check DIR", "Compare <DIR>/maa-evidence/ against the packaged payload file by file: same, different, or missing, plus files the payload does not ship. Directory links are followed; an unreadable entry is reported, not raised. Exit status stays 0; read match."],
    ],
    notes: [
      "The Skill and the CLI are installed separately and can drift. The payload carries no version of its own, so compare bytes instead: --check says whether an installed copy is the one this CLI ships, and --format json carries the running package version plus per-file sha256. Nothing here needs the network.",
      "Agent-managed installs should still use `npx skills add` / `npx skills update`, which maintain links and metadata across agents.",
    ],
  },
};

const COMMON_OPTIONS: readonly OptionRow[] = [
  ["--output FILE", "Write the rendered output to a file instead of stdout."],
  ["--profile FILE", "Write local stage timings as JSON (never part of the evidence)."],
  ["--version", "Print the MaaEvidenceKit version."],
  ["-h, --help", "Print help for this command."],
];

const FORMAT_OPTION: OptionRow = ["--format VALUE", "Select the output format for this command."];

const FIELDS_OPTION: OptionRow = [
  "--fields PATH,...",
  "Project the JSON output onto dotted paths, for example --fields statistics or --fields evidence.id,evidence.summary. Unknown paths are refused with the keys that do exist. --format json only.",
];

const BOUNDS_OPTION: OptionRow = [
  "--max-lines N, --max-characters N",
  "Bound the text output. Defaults 400 lines and 40000 characters, which are also the maxima, and --output FILE receives the complete rendering.",
];

const SUMMARY_OPTION: OptionRow = [
  "--summary",
  "Print artifacts, missing evidence, warnings, statistics, and evidence kinds instead of the full ledger. --output still receives the full report.",
];

/**
 * Options rendered from the acceptance table rather than repeated per command, so a command's help
 * cannot fall behind what the command actually accepts.
 */
const TABLE_OPTIONS: readonly { name: string; row: OptionRow }[] = [
  { name: "--format", row: FORMAT_OPTION },
  { name: "--fields", row: FIELDS_OPTION },
  { name: "--summary", row: SUMMARY_OPTION },
  { name: "--max-lines", row: BOUNDS_OPTION },
];

const HELP_WIDTH = 100;

function wrap(text: string, indent: number): string[] {
  const available = HELP_WIDTH - indent;
  const lines: string[] = [];
  let current = "";
  for (const word of text.split(" ")) {
    if (current.length === 0) {
      current = word;
      continue;
    }
    if (current.length + 1 + word.length <= available) {
      current = `${current} ${word}`;
      continue;
    }
    lines.push(current);
    current = word;
  }
  if (current.length > 0) lines.push(current);
  return lines;
}

export function renderOptionRows(rows: readonly OptionRow[]): string {
  const width = Math.max(...rows.map(([flag]) => flag.length));
  return rows
    .flatMap(([flag, description]) => {
      const prefix = `  ${flag.padEnd(width)}  `;
      const [first, ...rest] = wrap(description, prefix.length);
      return [
        `${prefix}${first ?? ""}`,
        ...rest.map((line) => `${" ".repeat(prefix.length)}${line}`),
      ];
    })
    .join("\n");
}

function section(title: string, body: string): string {
  return `${title}:\n${body}`;
}

function optionsFor(key: string, declared: readonly OptionRow[]): OptionRow[] {
  const accepted = new Set(COMMAND_OPTIONS[key] ?? []);
  const rendered = [...declared];
  const mentions = (row: OptionRow, name: string): boolean => row[0].includes(name);
  const covered = (name: string): boolean => rendered.some((row) => mentions(row, name));
  for (const entry of TABLE_OPTIONS) {
    const isAccepted = entry.name === "--format" ? FORMAT_COMMANDS.has(key) : accepted.has(entry.name);
    if (isAccepted && !covered(entry.name)) rendered.push(entry.row);
  }
  rendered.push(...COMMON_OPTIONS);
  return rendered;
}

export function renderCommandHelp(key: string): string | undefined {
  const command = COMMANDS[key];
  if (command === undefined) return undefined;
  const options = optionsFor(key, command.options ?? []);
  return [
    `MaaEvidenceKit — ${command.summary}`,
    "",
    section("Usage", command.usage.map((line) => `  ${line}`).join("\n")),
    "",
    section("Options", renderOptionRows(options)),
    ...(command.notes === undefined || command.notes.length === 0
      ? []
      : ["", "Notes:", ...command.notes.map((note) => `- ${note}`)]),
    "",
    'Run "maa-evidence --help" for every command.',
  ].join("\n");
}

/**
 * Resolve help for the parsed command. A bare namespace (`mse`) or an unknown word falls back to
 * the top-level usage instead of printing the help of an arbitrary subcommand.
 */
export function commandHelp(parsed: ParsedArguments): string {
  const [first, second] = parsed.positionals;
  if (first !== undefined && second === undefined && (first === "mla" || first === "mse")) {
    return renderCommandHelp(first) ?? TOP_LEVEL_HELP;
  }
  return renderCommandHelp(commandKey(parsed)) ?? TOP_LEVEL_HELP;
}

export function helpCommandKeys(): string[] {
  return Object.keys(COMMANDS);
}
