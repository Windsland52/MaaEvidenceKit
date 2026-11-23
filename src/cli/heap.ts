/**
 * Old-space floor for the CLI.
 *
 * V8 sizes its default old space from the machine's memory; on an 8GB desktop it can be around
 * 2GB, which is below the transient peak of a multi-GB extracted log directory. The CLI re-executes
 * itself once with an explicit limit so the same corpus does not OOM just because the machine is
 * small. The churn-heavy parse keeps a much lower live set than this floor, so the explicit limit
 * does not reserve physical memory up front.
 */
export const CLI_MAX_OLD_SPACE_MB = 1792;

const HEAP_FLAG = "--max-old-space-size";

export function hasHeapLimit(execArgv: readonly string[], nodeOptions = process.env.NODE_OPTIONS): boolean {
  return execArgv.some((argument) => argument.startsWith(HEAP_FLAG))
    || (nodeOptions ?? "").includes(HEAP_FLAG);
}

export function heapLimitedArguments(
  argv: readonly string[],
  execArgv: readonly string[],
  limitMb: number = CLI_MAX_OLD_SPACE_MB,
): string[] {
  return [...execArgv, `${HEAP_FLAG}=${limitMb}`, ...argv];
}
