import { afterEach, expect, test, vi } from "vitest";

import { main } from "../../src/cli/main.js";

afterEach(() => {
  vi.restoreAllMocks();
});

test("prints a stable CLI version without running inspection or telemetry", async () => {
  let output = "";
  vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    output += String(chunk);
    return true;
  });

  await expect(main(["--version"])).resolves.toBe(0);
  expect(output).toBe("0.3.1\n");
});

test("rejects mistyped options instead of silently treating them as positional arguments", async () => {
  let errorOutput = "";
  vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
    errorOutput += String(chunk);
    return true;
  });

  await expect(main([
    "search",
    "--input",
    "missing.json",
    "node",
    "TaskName",
    "--kind",
    "mla.recognition_detail",
  ])).resolves.toBe(1);
  expect(errorOutput).toContain('Unexpected positional arguments: "node", "TaskName".');
  expect(errorOutput).not.toContain("ENOENT");
});
