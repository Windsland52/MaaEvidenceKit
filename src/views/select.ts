import { UsageError } from "../evidence/index.js";

/**
 * Dotted-path projection for JSON output.
 *
 * Callers that need one number out of a saved report previously had to shell out to `node -e`, which
 * breaks on large documents and turns a wrong field name into an undefined instead of an error. A
 * projection keeps the JSON valid, and an unknown path is refused with the keys that do exist.
 *
 * Semantics: `a.b` walks objects; when the walk meets an array it applies the remaining path to each
 * element. Elements without the path are omitted, but a path that matches no element at all is an
 * error, so a misspelled field cannot come back as an empty list. Two paths over one array can
 * therefore select different numbers of elements, and merging those is refused: pairing them by
 * position would attach a value to the wrong element, and keeping one side would drop a requested
 * field without saying so.
 */

const MISSING = Symbol("missing");

type Failure = {
  path: string;
  reason: string;
  available?: string[];
  /** True when the failing segment was applied to array elements rather than to one object. */
  mapped: boolean;
};

type Context = {
  failure?: Failure;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function describeAvailable(record: Record<string, unknown>): string[] {
  return Object.keys(record).sort((left, right) => left.localeCompare(right));
}

function project(
  source: unknown,
  segments: readonly string[],
  prefix: string,
  context: Context,
  mapped: boolean,
): unknown {
  if (segments.length === 0) return source;
  if (Array.isArray(source)) {
    const projected = source
      .map((element) => project(element, segments, prefix, context, true))
      .filter((element) => element !== MISSING);
    // A path that matches nothing anywhere is a mistake, not an empty selection.
    return projected.length === 0 ? MISSING : projected;
  }
  if (!isRecord(source)) {
    context.failure ??= {
      path: prefix,
      reason: `is ${source === null ? "null" : typeof source}, not an object`,
      mapped,
    };
    return MISSING;
  }
  const [head, ...rest] = segments;
  if (head === undefined || !Object.hasOwn(source, head)) {
    context.failure ??= {
      path: prefix.length === 0 ? String(head) : `${prefix}.${String(head)}`,
      reason: "does not exist",
      available: describeAvailable(source),
      mapped,
    };
    return MISSING;
  }
  const child = project(
    source[head],
    rest,
    prefix.length === 0 ? head : `${prefix}.${head}`,
    context,
    mapped,
  );
  if (child === MISSING) return MISSING;
  return { [head]: child };
}

/**
 * Build the error for the first path that selected nothing.
 *
 * Every requested path has to resolve: a projection that quietly drops one field would let a
 * misspelled name look like an absent fact, which is the failure mode this whole module exists to
 * prevent.
 */
function selectionFailure(fields: readonly string[], context: Context): UsageError {
  const failure = context.failure;
  if (failure === undefined) {
    return new UsageError(`--fields selected nothing from this document: ${fields.join(", ")}.`);
  }
  const available = failure.available === undefined
    ? ""
    : ` Available at this level: ${failure.available.join(", ")}.`;
  const note = failure.mapped
    ? " A path that reaches an array is applied to every element, and there is no index syntax."
    : "";
  return new UsageError(`--fields path "${failure.path}" ${failure.reason}.${available}${note}`);
}

export function parseFields(values: readonly string[]): string[] {
  const fields: string[] = [];
  for (const value of values) {
    for (const part of value.split(",")) {
      const trimmed = part.trim();
      if (trimmed.length === 0) {
        throw new UsageError(
          "--fields requires non-empty dotted paths, such as --fields statistics or --fields evidence.id,evidence.summary.",
        );
      }
      fields.push(trimmed);
    }
  }
  return [...new Set(fields)];
}

export function selectFields(value: unknown, fields: readonly string[]): unknown {
  const context: Context = {};
  let projected: unknown = MISSING;
  let mergedFields: readonly string[] = [];
  for (const field of fields) {
    const segments = field.split(".");
    if (segments.some((segment) => segment.length === 0)) {
      throw new UsageError(`--fields path "${field}" has an empty segment.`);
    }
    const selection = project(value, segments, "", context, false);
    // Every requested path must resolve. Continuing here would return a partial document whose
    // missing field looks like a fact the report does not contain.
    if (selection === MISSING) throw selectionFailure(fields, context);
    projected = projected === MISSING
      ? selection
      : mergeSelections(projected, selection, "", mergedFields, field);
    mergedFields = [...mergedFields, field];
  }
  if (projected === MISSING) throw selectionFailure(fields, context);
  // Field order follows the request order, so the rendered key order stays deterministic.
  return projected;
}

function quoteFieldNames(names: readonly string[]): string {
  const quoted = names.map((name) => `"${name}"`);
  if (quoted.length < 3) return quoted.join(" and ");
  return `${quoted.slice(0, -1).join(", ")} and ${quoted.at(-1)}`;
}

function mergeSelections(
  left: unknown,
  right: unknown,
  path: string,
  leftFields: readonly string[],
  rightField: string,
): unknown {
  if (Array.isArray(left) && Array.isArray(right)) {
    if (left.length !== right.length) {
      throw new UsageError(
        `--fields paths ${quoteFieldNames([...leftFields, rightField])} project arrays of different `
        + `lengths (${left.length} vs ${right.length}) at "${path.length === 0 ? "<document root>" : path}". `
        + "A path that reaches an array applies only to the elements that have it, so pairing them "
        + "by position would attach a value to the wrong element. Request them separately.",
      );
    }
    return left.map((element, index) =>
      mergeSelections(element, right[index], path, leftFields, rightField));
  }
  if (isRecord(left) && isRecord(right)) {
    const merged: Record<string, unknown> = { ...left };
    for (const [key, value] of Object.entries(right)) {
      merged[key] = Object.hasOwn(merged, key)
        ? mergeSelections(
          merged[key],
          value,
          path.length === 0 ? key : `${path}.${key}`,
          leftFields,
          rightField,
        )
        : value;
    }
    return merged;
  }
  return left;
}
