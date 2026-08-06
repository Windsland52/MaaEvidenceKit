import { expect, test } from "vitest";

import { profileStage, profileStageSync, runProfiled } from "../src/profiling.js";

test("aggregates nested and concurrent local profile stages without recording operation data", async () => {
  const outcome = await runProfiled("test.command", async () => {
    await Promise.all([
      profileStage("load", async () => "first"),
      profileStage("load", async () => "second"),
    ]);
    return profileStageSync("render", () => "secret result");
  });

  expect(outcome.ok).toBe(true);
  expect(outcome.profile).toMatchObject({
    schemaVersion: "maa-evidence-profile/v1",
    mekVersion: "0.1.0",
    command: "test.command",
    status: "ok",
    concurrentStagesMayOverlap: true,
  });
  expect(outcome.profile.stages.map((stage) => [stage.name, stage.count])).toEqual([
    ["load", 2],
    ["render", 1],
  ]);
  expect(JSON.stringify(outcome.profile)).not.toContain("secret result");
});

test("profiles failed operations without exporting the exception message", async () => {
  const outcome = await runProfiled("test.failure", () =>
    profileStage("load", async () => {
      throw new Error("private path and failure details");
    }));

  expect(outcome.ok).toBe(false);
  expect(outcome.profile.status).toBe("error");
  expect(outcome.profile.stages).toHaveLength(1);
  expect(JSON.stringify(outcome.profile)).not.toContain("private path");
});
