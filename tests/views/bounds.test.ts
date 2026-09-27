import { expect, test } from "vitest";

import { boundText, budgetInteger } from "../../src/views/bounds.js";

const budget = (maxLines: number, maxCharacters: number) => ({ maxLines, maxCharacters });

test("a document inside its budget is returned unchanged", () => {
  const text = "one\ntwo\nthree";
  expect(boundText(text, budget(10, 1000))).toEqual({ text, truncated: false });
  // Exactly at the limit still counts as inside it.
  expect(boundText(text, budget(3, text.length))).toEqual({ text, truncated: false });
});

test("a long document is cut at the line budget with an explicit marker", () => {
  const text = ["one", "two", "three", "four"].join("\n");
  const bounded = boundText(text, budget(2, 1000));

  expect(bounded.truncated).toBe(true);
  expect(bounded.text.startsWith("one\ntwo\n")).toBe(true);
  expect(bounded.text).toContain("… truncated: 2 of 4 lines and 7 of 18 characters shown.");
  expect(bounded.text).toContain("--max-lines/--max-characters");
});

test("the character budget stops before a line that would exceed it", () => {
  const text = ["aaa", "bbbb", "cc"].join("\n");
  const bounded = boundText(text, budget(10, 8));

  expect(bounded.truncated).toBe(true);
  expect(bounded.text).toContain("… truncated: 2 of 3 lines");
});

test("a first line larger than the budget is cut rather than dropped", () => {
  const bounded = boundText("abcdefghij\nsecond", budget(10, 4));

  expect(bounded.truncated).toBe(true);
  expect(bounded.text.startsWith("abcd\n")).toBe(true);
});

test("budgets are validated against their maximum", () => {
  expect(budgetInteger("--max-lines", undefined, 400, 400)).toBe(400);
  expect(budgetInteger("--max-lines", 1, 400, 400)).toBe(1);
  expect(() => budgetInteger("--max-lines", 401, 400, 400))
    .toThrow(/--max-lines must be an integer from 1 through 400, received 401\./u);
  expect(() => budgetInteger("--max-characters", 0, 40000, 40000))
    .toThrow(/--max-characters must be an integer from 1 through 40000, received 0\./u);
});
