import path from "node:path";
import { writeFile } from "node:fs/promises";

import { runProfiled } from "../profiling.js";
import { option, type ParsedArguments } from "./args.js";

export async function withLocalProfile<T>(
  command: string,
  parsed: ParsedArguments,
  operation: () => Promise<T>,
): Promise<T> {
  const profilePath = option(parsed, "--profile");
  if (profilePath === undefined) return operation();
  const outputPath = option(parsed, "--output");
  if (outputPath !== undefined && path.resolve(outputPath) === path.resolve(profilePath)) {
    throw new Error("--profile and --output must use different files.");
  }
  const outcome = await runProfiled(command, operation);
  await writeFile(profilePath, `${JSON.stringify(outcome.profile, null, 2)}\n`, "utf8");
  if (!outcome.ok) throw outcome.error;
  return outcome.value;
}
