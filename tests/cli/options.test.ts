import { describe, expect, test } from "vitest";

import type { ParsedArguments } from "../../src/cli/args.js";
import { commandKey, rejectUnknownOptions } from "../../src/cli/options.js";

function parsed(positionals: string[], options: Record<string, string> = {}): ParsedArguments {
  return {
    positionals,
    options: new Map(Object.entries(options).map(([name, value]) => [name, [value]])),
  };
}

describe("command keys", () => {
  test("distinguishes subcommands that share a namespace", () => {
    expect(commandKey(parsed(["mse", "inspect", "path"]))).toBe("mse inspect");
    expect(commandKey(parsed(["mse", "resolve", "path"]))).toBe("mse resolve");
    expect(commandKey(parsed(["mla", "inspect", "path"]))).toBe("mla inspect");
    expect(commandKey(parsed(["feedback", "approve"]))).toBe("feedback approve");
    expect(commandKey(parsed(["feedback"]))).toBe("feedback");
    expect(commandKey(parsed(["view"]))).toBe("view");
    expect(commandKey(parsed([]))).toBe("");
  });

  test("treats a missing mse subcommand as inspect so the dispatcher still reports it", () => {
    expect(commandKey(parsed(["mse"]))).toBe("mse inspect");
  });
});

describe("per-command option validation", () => {
  test("rejects an option that belongs to another command", () => {
    // The case that motivated the table: a feedback-only flag on an inspection command.
    expect(() => rejectUnknownOptions(parsed(["mla", "inspect", "path"], { "--token": "t" })))
      .toThrow(/Unknown option for mla inspect: --token/u);
    expect(() => rejectUnknownOptions(parsed(["view"], { "--token": "t" })))
      .toThrow(/Unknown option for view: --token/u);
    // --summary only changes inspection stdout, so a query command must not accept it.
    expect(() => rejectUnknownOptions(parsed(["search"], { "--summary": "true" })))
      .toThrow(/Unknown option for search: --summary/u);
    // --syntax-mode is an MSE-only option.
    expect(() => rejectUnknownOptions(parsed(["mla", "inspect", "path"], { "--syntax-mode": "maa" })))
      .toThrow(/Unknown option for mla inspect: --syntax-mode/u);
    // --git-ref is inspect-only, not part of mse resolve.
    expect(() => rejectUnknownOptions(parsed(["mse", "resolve", "path"], { "--git-ref": "v1" })))
      .toThrow(/Unknown option for mse resolve: --git-ref/u);
  });

  test("accepts every option the command actually reads", () => {
    expect(() => rejectUnknownOptions(parsed(["mla", "inspect", "path"], {
      "--all-signals": "true",
      "--from": "2026-01-01",
      "--keyword": "k",
      "--summary": "true",
      "--to": "2026-01-02",
    }))).not.toThrow();

    expect(() => rejectUnknownOptions(parsed(["mse", "inspect", "path"], {
      "--controller": "Win32",
      "--depth": "2",
      "--git-ref": "v1",
      "--no-referencers": "true",
      "--resource": "Official",
      "--syntax-mode": "maafw",
      "--task": "StartUp",
    }))).not.toThrow();

    expect(() => rejectUnknownOptions(parsed(["window"], {
      "--artifact-id": "artifact-1",
      "--before": "1",
      "--evidence-id": "evidence-1",
      "--input": "result.json",
    }))).not.toThrow();

    expect(() => rejectUnknownOptions(parsed(["feedback"], {
      "--category": "bug",
      "--message": "text",
      "--preview": "true",
      "--token": "token.json",
    }))).not.toThrow();

    expect(() => rejectUnknownOptions(parsed(["feedback", "approve"], {
      "--message": "text",
      "--out": "token.json",
    }))).not.toThrow();
  });

  test("leaves an unknown command's options to the dispatcher", () => {
    // Reporting "unknown option" instead of "unknown command" would hide the real error.
    expect(() => rejectUnknownOptions(parsed(["nonsense"], { "--token": "t" }))).not.toThrow();
    expect(() => rejectUnknownOptions(parsed([], { "--token": "t" }))).not.toThrow();
  });

  test("reports every rejected option at once and lists what is accepted", () => {
    expect(() => rejectUnknownOptions(parsed(["view"], { "--token": "t", "--summary": "true" })))
      .toThrow(/Unknown option for view: --summary, --token\./u);
    expect(() => rejectUnknownOptions(parsed(["view"], { "--token": "t" })))
      .toThrow(/view accepts: --evidence-id, --format, --help, --input, --output, --profile, --version, -h\./u);
  });
});
