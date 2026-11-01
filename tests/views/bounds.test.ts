import { expect, test } from "vitest";

import { boundText, budgetInteger, truncationMarker } from "../../src/views/bounds.js";

const budget = (maxLines: number, maxCharacters: number) => ({ maxLines, maxCharacters });
const MARKER_PREFIX = "--- truncated:";
const MARKER_SUFFIX = "---";
const marker = (shownLines: number, totalLines: number, shownCharacters: number, totalCharacters: number) =>
  `${MARKER_PREFIX} ${shownLines} of ${totalLines} lines, ${shownCharacters} of ${totalCharacters} characters`
  + " (raise --max-lines/--max-characters, or use --output FILE) ---";

/** The final line of a bounded rendering; slicing at the last newline also proves it is one line. */
function finalLine(text: string): string {
  return text.slice(text.lastIndexOf("\n") + 1);
}

test("a document inside its budget is returned unchanged", () => {
  const text = "one\ntwo\nthree";
  expect(boundText(text, budget(10, 1000))).toEqual({ text, truncated: false });
  // Exactly at the limit still counts as inside it.
  expect(boundText(text, budget(3, text.length))).toEqual({ text, truncated: false });
});

test("the marker is one delimited line with both counts and both flags", () => {
  expect(truncationMarker(400, 1200, 40_000, 214_000)).toBe(marker(400, 1200, 40_000, 214_000));
  expect(marker(400, 1200, 40_000, 214_000)).toBe(
    "--- truncated: 400 of 1200 lines, 40000 of 214000 characters (raise --max-lines/--max-characters, or use --output FILE) ---",
  );
  expect(truncationMarker(1, 2, 3, 4).includes("\n")).toBe(false);
});

test("the line budget appends exactly one marker, as the final line at column 0", () => {
  const text = ["one", "two", "three", "four"].join("\n");
  const bounded = boundText(text, budget(2, 1000));

  expect(bounded.truncated).toBe(true);
  const lines = bounded.text.split("\n");
  expect(lines).toHaveLength(3); // two kept lines plus exactly one marker line
  expect(lines[0]).toBe("one");
  expect(lines[1]).toBe("two");

  const lastLine = finalLine(bounded.text);
  expect(lastLine).toBe(marker(2, 4, "one\ntwo".length, text.length));
  expect(lastLine.startsWith(MARKER_PREFIX)).toBe(true);
  expect(lastLine.endsWith(MARKER_SUFFIX)).toBe(true);
  expect(lines.filter((line) => line.startsWith(MARKER_PREFIX))).toHaveLength(1);
});

test("the character budget reports both counts on the same delimited final line", () => {
  const text = ["aaa", "bbbb", "cc"].join("\n");
  const bounded = boundText(text, budget(10, 8));

  expect(bounded.truncated).toBe(true);
  const lastLine = finalLine(bounded.text);
  // The line budget was not binding, so both counts still have to appear: kept/total lines and
  // kept/total characters.
  expect(lastLine).toBe(marker(2, 3, 8, text.length));
  expect(lastLine).toContain("2 of 3 lines");
  expect(lastLine).toContain("8 of 11 characters");
  expect(lastLine).toContain("--max-lines/--max-characters");
  expect(lastLine).toContain("--output FILE");
  expect(bounded.text.startsWith("aaa\nbbbb\n")).toBe(true);
});

test("a first line larger than the budget is cut rather than dropped, marker still last", () => {
  const bounded = boundText("abcdefghij\nsecond", budget(10, 4));

  expect(bounded.truncated).toBe(true);
  expect(bounded.text.startsWith("abcd\n")).toBe(true);
  expect(finalLine(bounded.text)).toBe(marker(1, 2, "abcd".length, "abcdefghij\nsecond".length));
});

test("budgets are validated against their maximum", () => {
  expect(budgetInteger("--max-lines", undefined, 400, 400)).toBe(400);
  expect(budgetInteger("--max-lines", 1, 400, 400)).toBe(1);
  expect(() => budgetInteger("--max-lines", 401, 400, 400))
    .toThrow(/--max-lines must be an integer from 1 through 400, received 401\./u);
  expect(() => budgetInteger("--max-characters", 0, 40000, 40000))
    .toThrow(/--max-characters must be an integer from 1 through 40000, received 0\./u);
});
