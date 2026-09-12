import { UsageError } from "../evidence/index.js";

export type ParsedArguments = {
  positionals: string[];
  options: Map<string, string[]>;
};

const VALUE_OPTIONS = new Set([
  "--after",
  "--artifact-id",
  "--before",
  "--controller",
  "--evidence-id",
  "--format",
  "--from",
  "--git-ref",
  "--input",
  "--keyword",
  "--kind",
  "--line",
  "--limit",
  "--max-characters",
  "--max-lines",
  "--message",
  "--node",
  "--out",
  "--output",
  "--profile",
  "--category",
  "--component",
  "--depth",
  "--attachment",
  "--resource",
  "--requests",
  "--syntax-mode",
  "--task",
  "--text",
  "--to",
  "--token",
]);

const BOOLEAN_OPTIONS = new Set([
  "--all-signals",
  "--help",
  "-h",
  "--no-mla",
  "--no-mse",
  "--no-referencers",
  "--preview",
  "--summary",
  "--version",
]);

const FORMAT_ALIASES = new Set(["--json", "--text", "--mermaid"]);

function editDistance(left: string, right: string): number {
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let row = 1; row <= left.length; row += 1) {
    const current = [row];
    for (let column = 1; column <= right.length; column += 1) {
      const substitution = (previous[column - 1] ?? 0) + (left[row - 1] === right[column - 1] ? 0 : 1);
      const deletion = (previous[column] ?? 0) + 1;
      const insertion = (current[column - 1] ?? 0) + 1;
      current.push(Math.min(substitution, deletion, insertion));
    }
    previous = current;
  }
  return previous[right.length] ?? Math.max(left.length, right.length);
}

function unknownOptionMessage(token: string): string {
  if (FORMAT_ALIASES.has(token)) {
    return `Unknown option: ${token}. Did you mean --format ${token.slice(2)}?`;
  }
  const known = [...VALUE_OPTIONS, ...BOOLEAN_OPTIONS];
  const ranked = known
    .map((candidate) => ({ candidate, distance: editDistance(token, candidate) }))
    .filter((entry) => entry.distance <= Math.max(2, Math.floor(token.length / 3)))
    .sort((left, right) =>
      left.distance - right.distance || left.candidate.localeCompare(right.candidate)
    );
  const closest = ranked[0]?.candidate;
  return closest === undefined
    ? `Unknown option: ${token}`
    : `Unknown option: ${token}. Did you mean ${closest}?`;
}

export function parseArguments(args: string[]): ParsedArguments {
  const positionals: string[] = [];
  const options = new Map<string, string[]>();
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (token === undefined) continue;
    if (!token.startsWith("-")) {
      positionals.push(token);
      continue;
    }
    if (BOOLEAN_OPTIONS.has(token)) {
      options.set(token, ["true"]);
      continue;
    }
    if (!VALUE_OPTIONS.has(token)) throw new Error(unknownOptionMessage(token));
    const value = args[index + 1];
    if (value === undefined || value.startsWith("--")) throw new Error(`${token} requires a value.`);
    const values = options.get(token) ?? [];
    values.push(value);
    options.set(token, values);
    index += 1;
  }
  return { positionals, options };
}

export function option(parsed: ParsedArguments, name: string): string | undefined {
  return parsed.options.get(name)?.at(-1);
}

export function options(parsed: ParsedArguments, name: string): string[] {
  return parsed.options.get(name) ?? [];
}

export function flag(parsed: ParsedArguments, name: string): boolean {
  return parsed.options.has(name);
}

export function integerOption(parsed: ParsedArguments, name: string): number | undefined {
  const value = option(parsed, name);
  if (value === undefined) return undefined;
  const parsedValue = Number(value);
  if (!Number.isInteger(parsedValue)) throw new UsageError(`${name} requires an integer.`);
  return parsedValue;
}
