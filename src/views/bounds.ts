import { UsageError } from "../evidence/index.js";

/**
 * Text output budgets.
 *
 * A rendered inspection is unbounded (the text view of a large report runs to tens of thousands of
 * characters), and a caller that pipes it into a model context cannot un-read it. These bounds keep
 * the default readable while staying honest: the truncation marker says exactly how much was
 * withheld, and `--output FILE` still receives the complete rendering.
 */

export const VIEW_DEFAULT_MAX_LINES = 400;
export const VIEW_MAX_LINES = 400;
export const VIEW_DEFAULT_MAX_CHARACTERS = 40_000;
export const VIEW_MAX_CHARACTERS = 40_000;

export type TextBudget = {
  maxLines: number;
  maxCharacters: number;
};

export type BoundedText = {
  text: string;
  truncated: boolean;
};

export function budgetInteger(
  name: string,
  value: number | undefined,
  fallback: number,
  maximum: number,
): number {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || value < 1 || value > maximum) {
    throw new UsageError(`${name} must be an integer from 1 through ${maximum}, received ${value}.`);
  }
  return value;
}

export function truncationMarker(
  shownLines: number,
  totalLines: number,
  shownCharacters: number,
  totalCharacters: number,
): string {
  return `… truncated: ${shownLines} of ${totalLines} lines and ${shownCharacters} of ${totalCharacters} characters shown.`
    + " Raise --max-lines/--max-characters, or use --output FILE for the complete rendering.";
}

export function boundText(text: string, budget: TextBudget): BoundedText {
  const lines = text.split("\n");
  const totalLines = lines.length;
  const totalCharacters = text.length;
  const selected: string[] = [];
  let characters = 0;
  let truncated = lines.length > budget.maxLines;
  for (const line of lines.slice(0, budget.maxLines)) {
    const cost = selected.length === 0 ? line.length : line.length + 1;
    if (characters + cost > budget.maxCharacters) {
      // Mirror the evidence window: a budget that cannot fit even one line still returns that line
      // cut to the budget, so a bounded view never renders as empty.
      if (selected.length === 0 && budget.maxCharacters >= 1) {
        selected.push(line.slice(0, budget.maxCharacters));
        characters = budget.maxCharacters;
      }
      truncated = true;
      break;
    }
    selected.push(line);
    characters += cost;
  }
  if (!truncated) return { text, truncated: false };
  const rendered = selected.join("\n");
  return {
    text: `${rendered}\n${truncationMarker(selected.length, totalLines, rendered.length, totalCharacters)}`,
    truncated: true,
  };
}
