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
  expect(output).toBe("0.1.0\n");
});
