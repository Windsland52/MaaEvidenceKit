import { expect, test } from "vitest";

import { deriveRotationCoverage } from "../../src/evidence/rotation.js";

test("derives rotation coverage from gzip-compressed rotation names", () => {
  const coverage = deriveRotationCoverage([
    { relativePath: "maafw.bak.2026.07.19-09.00.00.000.log.gz", kind: "maa_log" },
    { relativePath: "maafw.bak.2026.07.19-10.00.00.000.log.gz", kind: "maa_log" },
    { relativePath: "maafw.log.gz", kind: "maa_log" },
  ], "C:/logs");

  expect(coverage.get("maafw.bak.2026.07.19-09.00.00.000.log.gz")).toMatchObject({
    rotation: { family: "logs", index: 1 },
    timeCoverage: {
      to: "2026-07-19T09:00:00.000",
      from: null,
      fromKnown: false,
      toKnown: true,
    },
  });
  expect(coverage.get("maafw.bak.2026.07.19-10.00.00.000.log.gz")).toMatchObject({
    rotation: { family: "logs", index: 2 },
    timeCoverage: {
      from: "2026-07-19T09:00:00.000",
      to: "2026-07-19T10:00:00.000",
    },
  });
  expect(coverage.get("maafw.log.gz")).toMatchObject({
    rotation: { family: "logs", index: 3 },
    timeCoverage: {
      from: "2026-07-19T10:00:00.000",
      to: null,
      fromKnown: true,
      toKnown: false,
    },
  });
});
