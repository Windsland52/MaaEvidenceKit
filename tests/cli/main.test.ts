import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, expect, test, vi } from "vitest";

import { main } from "../../src/cli/main.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function mlaFixture(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "mek-cli-summary-"));
  temporaryRoots.push(root);
  const event = (timestamp: string, message: string, details: Record<string, unknown>): string =>
    `[${timestamp}][INF][Px1][Tx2][test] !!!OnEventNotify!!! [handle=1] [msg=${message}] [details=${JSON.stringify(details)}]`;
  await writeFile(
    path.join(root, "maafw.log"),
    [
      event("2026-07-19 10:00:59.000", "Tasker.Task.Starting", {
        task_id: 7, entry: "Combat", hash: "h1", uuid: "u1",
      }),
      event("2026-07-19 10:01:03.000", "Tasker.Task.Failed", {
        task_id: 7, entry: "Combat", hash: "h1", uuid: "u1",
      }),
    ].join("\n"),
    "utf8",
  );
  return root;
}

test("prints a stable CLI version without running inspection or telemetry", async () => {
  let output = "";
  vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    output += String(chunk);
    return true;
  });

  await expect(main(["--version"])).resolves.toBe(0);
  expect(output).toBe("0.7.0\n");
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

test("suggests the closest option when an unknown flag is supplied", async () => {
  let errorOutput = "";
  vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
    errorOutput += String(chunk);
    return true;
  });

  await expect(main(["mla", "inspect", ".", "--json"])).resolves.toBe(1);
  expect(errorOutput).toContain("Unknown option: --json. Did you mean --format json?");

  errorOutput = "";
  await expect(main(["search", "--input", "missing.json", "--nodes", "Target"])).resolves.toBe(1);
  expect(errorOutput).toContain("Unknown option: --nodes. Did you mean --node?");
});

test("writes the full report to --output while --summary keeps stdout bounded", async () => {
  const root = await mlaFixture();
  const reportPath = path.join(root, "report.json");
  let output = "";
  vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    output += String(chunk);
    return true;
  });

  expect(await main(["mla", "inspect", root, "--summary", "--format", "json", "--output", reportPath])).toBe(0);

  const stdoutSummary = JSON.parse(output) as Record<string, unknown>;
  expect(stdoutSummary["schemaVersion"]).toBe("maa-evidence-summary/v1");
  expect(stdoutSummary["kind"]).toBe("mla");
  expect(stdoutSummary).not.toHaveProperty("evidence");
  expect(stdoutSummary).not.toHaveProperty("details");
  expect(stdoutSummary["statistics"]).toBeDefined();
  expect(Array.isArray(stdoutSummary["evidenceKinds"])).toBe(true);
  expect(typeof stdoutSummary["evidenceCount"]).toBe("number");

  const saved = JSON.parse(await readFile(reportPath, "utf8")) as Record<string, unknown>;
  expect(saved["schemaVersion"]).toBe("maa-evidence/v1");
  expect(saved["kind"]).toBe("mla");
  expect(saved["evidence"]).toBeDefined();
  expect(output.length).toBeLessThan((await readFile(reportPath, "utf8")).length);
});

test("emits a text inspection summary to stdout and the full report to --output", async () => {
  const root = await mlaFixture();
  const reportPath = path.join(root, "report.txt");
  let output = "";
  vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    output += String(chunk);
    return true;
  });

  expect(await main(["mla", "inspect", root, "--summary", "--format", "text", "--output", reportPath])).toBe(0);

  expect(output).toContain("MaaEvidenceKit mla inspection summary");
  expect(output).toContain("maafw.log");
  expect(output).toContain("Evidence:");

  const saved = await readFile(reportPath, "utf8");
  expect(saved).not.toContain("inspection summary");
  expect(saved).toContain("MaaEvidenceKit mla inspection");
});

test("keeps a report saved with --summary consumable by downstream evidence queries", async () => {
  const root = await mlaFixture();
  const reportPath = path.join(root, "report.json");
  let output = "";
  vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    output += String(chunk);
    return true;
  });

  expect(await main(["mla", "inspect", root, "--summary", "--output", reportPath])).toBe(0);
  expect(await main(["search", "--input", reportPath, "--kind", "mla.task"])).toBe(0);
  expect(output).toContain("maa-evidence-search/v1");
});

test("rejects Mermaid output for an inspection summary", async () => {
  const root = await mlaFixture();
  let errorOutput = "";
  vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
    errorOutput += String(chunk);
    return true;
  });

  await expect(main(["mla", "inspect", root, "--summary", "--format", "mermaid"])).resolves.toBe(1);
  expect(errorOutput).toContain("--summary supports --format json or text.");
});

test("rejects Mermaid output for repository documentation inventory", async () => {
  let errorOutput = "";
  vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
    errorOutput += String(chunk);
    return true;
  });

  await expect(main(["repo-docs", ".", "--format", "mermaid"])).resolves.toBe(1);
  expect(errorOutput).toContain("repo-docs --format must be json or text");
});

test("reports a missing input path as an actionable usage error", async () => {
  const root = await mlaFixture();
  const missing = path.join(root, "does-not-exist");
  let errorOutput = "";
  vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
    errorOutput += String(chunk);
    return true;
  });

  await expect(main(["mla", "inspect", missing])).resolves.toBe(1);
  expect(errorOutput).toContain(`Input path not found: ${missing}`);
});

test("reports a missing inspection file as an actionable usage error", async () => {
  const missing = path.join("no-such-directory", "inspection.json");
  let errorOutput = "";
  vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
    errorOutput += String(chunk);
    return true;
  });

  await expect(main(["window", "--input", missing])).resolves.toBe(1);
  expect(errorOutput).toContain(`Input file not found: ${missing}`);
});

test("reports a missing output directory as an actionable usage error", async () => {
  const root = await mlaFixture();
  const output = path.join(root, "no-such-dir", "report.json");
  let errorOutput = "";
  vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
    errorOutput += String(chunk);
    return true;
  });

  await expect(main(["mla", "inspect", root, "--output", output])).resolves.toBe(1);
  expect(errorOutput).toContain(`Output directory does not exist: ${path.join(root, "no-such-dir")}`);
});

test("reports a directory input path as an actionable usage error", async () => {
  const root = await mlaFixture();
  let errorOutput = "";
  vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
    errorOutput += String(chunk);
    return true;
  });

  await expect(main(["window", "--input", root])).resolves.toBe(1);
  expect(errorOutput).toContain(`Input path is not a file: ${root}`);
});

test("reports a directory output path as an actionable usage error", async () => {
  const root = await mlaFixture();
  let errorOutput = "";
  vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
    errorOutput += String(chunk);
    return true;
  });

  await expect(main(["mla", "inspect", root, "--output", root])).resolves.toBe(1);
  expect(errorOutput).toContain(`Output path is a directory: ${root}`);
});

test("reports a missing repository-docs source as an actionable usage error", async () => {
  const missing = path.join("no-such-directory", "checkout");
  let errorOutput = "";
  vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
    errorOutput += String(chunk);
    return true;
  });

  await expect(main(["repo-docs", missing])).resolves.toBe(1);
  expect(errorOutput).toContain(`Input path not found: ${path.resolve(missing)}`);
});

test("renders a task timeline from a saved inspection report", async () => {
  const root = await mlaFixture();
  const reportPath = path.join(root, "report.json");
  let output = "";
  vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    output += String(chunk);
    return true;
  });

  expect(await main(["mla", "inspect", root, "--output", reportPath])).toBe(0);
  expect(await main(["timeline", "--input", reportPath, "--format", "json"])).toBe(0);
  const parsed = JSON.parse(output) as { schemaVersion: string; tasks: Array<{ name: string; entries: unknown[] }> };
  expect(parsed.schemaVersion).toBe("maa-evidence-task-timeline/v1");
  expect(parsed.tasks.map((task) => task.name)).toEqual(["Combat"]);

  output = "";
  expect(await main(["timeline", "--input", reportPath, "--format", "text", "--task", "Combat"])).toBe(0);
  expect(output).toContain("Task Combat [failed]");
  expect(output).not.toContain("Task Collect");
});
