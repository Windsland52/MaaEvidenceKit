import { expect, test } from "vitest";

import { parseArguments } from "../../src/cli/args.js";
import { commandHelp, helpCommandKeys, renderCommandHelp } from "../../src/cli/help.js";
import { COMMAND_OPTIONS, commandKey } from "../../src/cli/options.js";

test("every command answers --help with its own text", () => {
  const rendered = new Map<string, string>();
  for (const key of helpCommandKeys()) {
    const help = renderCommandHelp(key);
    expect(help, `missing help for ${key}`).toBeDefined();
    rendered.set(key, help as string);
  }
  // The regression this guards: every command used to print the top-level usage, so these three
  // were byte-identical.
  expect(renderCommandHelp("inspect")).not.toBe(renderCommandHelp("mla inspect"));
  expect(renderCommandHelp("timeline")).not.toBe(renderCommandHelp("inspect"));
  const byText = new Map<string, string>();
  for (const [key, text] of rendered) {
    const shared = byText.get(text);
    expect(shared, `${key} and ${shared} share one help text`).toBeUndefined();
    byText.set(text, key);
  }
});

test("each command help documents every option the command accepts", () => {
  for (const key of Object.keys(COMMAND_OPTIONS)) {
    const help = renderCommandHelp(key);
    expect(help, `missing help for ${key}`).toBeDefined();
    for (const option of [...(COMMAND_OPTIONS[key] ?? []), "--help", "--output", "--profile", "--version"]) {
      expect(help, `${key} help does not mention ${option}`).toContain(option);
    }
  }
});

test("help resolves the parsed command, including a bare namespace", () => {
  expect(commandHelp(parseArguments(["inspect", "--help"]))).toContain("Run MLA and MSE over one material root");
  expect(commandHelp(parseArguments(["mse", "resolve", "--help"])))
    .toContain("Lightweight task resolution");
  const namespace = commandHelp(parseArguments(["mse", "--help"]));
  expect(namespace).toContain("mse inspect");
  expect(namespace).toContain("mse resolve");
  expect(commandHelp(parseArguments(["mla", "--help"]))).toContain("mla inspect");
  expect(commandHelp(parseArguments(["nonsense", "--help"]))).toContain("MaaEvidenceKit — deterministic");
});

test("the top-level help points at command help", () => {
  expect(commandHelp(parseArguments(["unparsed"]))).toContain('Run "maa-evidence <command> --help"');
});

test("command help states the defaults that decide cost and bounds", () => {
  expect(renderCommandHelp("window")).toContain("Default 400");
  expect(renderCommandHelp("window")).toContain("Default 20");
  expect(renderCommandHelp("search")).toContain("Default 50, maximum 500");
  expect(renderCommandHelp("view")).toContain("--fields");
  expect(renderCommandHelp("mla inspect")).toContain("Loading focus, not an evidence filter");
  expect(renderCommandHelp("mse resolve")).toContain("Required");
});

test("commandKey stays the single source of the command identity", () => {
  expect(commandKey(parseArguments(["mse", "resolve", "p"]))).toBe("mse resolve");
  expect(commandKey(parseArguments(["feedback", "approve"]))).toBe("feedback approve");
  expect(commandKey(parseArguments(["mla", "inspect", "p"]))).toBe("mla inspect");
});
