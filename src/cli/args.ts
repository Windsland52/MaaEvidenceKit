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
  "--input",
  "--keyword",
  "--line",
  "--max-characters",
  "--max-lines",
  "--message",
  "--output",
  "--component",
  "--attachment",
  "--resource",
  "--syntax-mode",
  "--task",
  "--to",
]);

const BOOLEAN_OPTIONS = new Set(["--help", "-h", "--no-mla", "--no-mse"]);

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
    if (!VALUE_OPTIONS.has(token)) throw new Error(`Unknown option: ${token}`);
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
  if (!Number.isInteger(parsedValue)) throw new Error(`${name} requires an integer.`);
  return parsedValue;
}
