import { expect, test } from "vitest";

import { parseFields, selectFields } from "../../src/views/select.js";

const document = {
  schemaVersion: "maa-evidence/v1",
  kind: "mla",
  statistics: { evidence: 3, signalsTotal: 88 },
  evidence: [
    { id: "evidence-a", kind: "mla.task", source: { path: "maafw.log", line: 1 } },
    { id: "evidence-b", kind: "mla.signal", source: { path: "mirror/maafw.log", line: 4 } },
  ],
};

test("projects one subtree and keeps the surrounding shape", () => {
  expect(selectFields(document, ["statistics"])).toEqual({
    statistics: { evidence: 3, signalsTotal: 88 },
  });
  expect(selectFields(document, ["kind"])).toEqual({ kind: "mla" });
});

test("projects a path through an array once per element", () => {
  expect(selectFields(document, ["evidence.id"])).toEqual({
    evidence: [{ id: "evidence-a" }, { id: "evidence-b" }],
  });
  expect(selectFields(document, ["evidence.source.line"])).toEqual({
    evidence: [{ source: { line: 1 } }, { source: { line: 4 } }],
  });
});

test("merges several paths in request order", () => {
  expect(selectFields(document, ["evidence.id", "evidence.kind"])).toEqual({
    evidence: [
      { id: "evidence-a", kind: "mla.task" },
      { id: "evidence-b", kind: "mla.signal" },
    ],
  });
  expect(Object.keys(selectFields(document, ["kind", "statistics"]) as object)).toEqual([
    "kind",
    "statistics",
  ]);
});

test("refuses to merge paths that select different numbers of elements", () => {
  const partial = {
    evidence: [
      { id: "evidence-a", source: { node: "NodeA" } },
      { id: "evidence-b" },
    ],
  };
  // evidence.id selects two elements and evidence.source.node selects one, because the element
  // without source is omitted. Pairing them by position would put NodeA next to evidence-b, and
  // keeping only the first selection would drop the node silently.
  expect(() => selectFields(partial, ["evidence.id", "evidence.source.node"]))
    .toThrow(/--fields selected 2 and 1 elements at "evidence"/u);
  expect(() => selectFields(partial, ["evidence.source.node", "evidence.id"]))
    .toThrow(/--fields selected 1 and 2 elements at "evidence"/u);
  // Each path on its own still projects the elements that carry it.
  expect(selectFields(partial, ["evidence.source.node"]))
    .toEqual({ evidence: [{ source: { node: "NodeA" } }] });
  expect(selectFields(partial, ["evidence.id"]))
    .toEqual({ evidence: [{ id: "evidence-a" }, { id: "evidence-b" }] });
});

test("refuses an unknown path with the keys that exist", () => {
  expect(() => selectFields(document, ["statistcs"]))
    .toThrow(/--fields path "statistcs" does not exist\. Available at this level: evidence, kind, schemaVersion, statistics\./u);
  expect(() => selectFields(document, ["evidence.nope"]))
    .toThrow(/--fields path "evidence.nope" does not exist\. Available at this level: id, kind, source\./u);
  expect(() => selectFields(document, ["evidence.id.deeper"]))
    .toThrow(/--fields path "evidence.id" is string, not an object\./u);
});

test("a projection that selects nothing is an error, not an empty result", () => {
  expect(() => selectFields(document, ["evidence.missing"])).toThrow(/does not exist/u);
  expect(() => selectFields({ evidence: [] }, ["evidence.id"]))
    .toThrow(/selected nothing from this document: evidence\.id/u);
});

test("parses repeated and comma-separated fields without empty segments", () => {
  expect(parseFields(["a,b", "c", "a"])).toEqual(["a", "b", "c"]);
  expect(() => parseFields(["a,,b"])).toThrow(/non-empty dotted paths/u);
  expect(() => selectFields(document, ["a..b"])).toThrow(/has an empty segment/u);
});

test("every requested path must resolve, not just the first one", () => {
  // A partial projection would let a misspelled field look like a fact the report does not carry.
  expect(() => selectFields(document, ["kind", "statistcs"]))
    .toThrow(/--fields path "statistcs" does not exist/u);
  expect(() => selectFields(document, ["evidence.id", "details.missing"]))
    .toThrow(/--fields path "details" does not exist\. Available at this level: evidence, kind, schemaVersion, statistics\./u);
});

test("a path that reaches an array says there is no index syntax", () => {
  expect(() => selectFields(document, ["evidence.0.id"]))
    .toThrow(/--fields path "evidence\.0" does not exist\. Available at this level: id, kind, source\. A path that reaches an array is applied to every element, and there is no index syntax\./u);
});
