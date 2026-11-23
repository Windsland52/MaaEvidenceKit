import { expect, test } from "vitest";

import { CLI_MAX_OLD_SPACE_MB, hasHeapLimit, heapLimitedArguments } from "../../src/cli/heap.js";

test("detects an existing old-space limit in execArgv or NODE_OPTIONS", () => {
  expect(hasHeapLimit([], "")).toBe(false);
  expect(hasHeapLimit(["--max-old-space-size=4096"], "")).toBe(true);
  expect(hasHeapLimit([], "--max-old-space-size=4096")).toBe(true);
  expect(hasHeapLimit([], undefined)).toBe(false);
});

test("builds a child argv that keeps the original exec flags and arguments", () => {
  expect(heapLimitedArguments(["script.js", "mla", "inspect", "dir"], ["--no-warnings"]))
    .toEqual(["--no-warnings", `--max-old-space-size=${CLI_MAX_OLD_SPACE_MB}`, "script.js", "mla", "inspect", "dir"]);
});
