import assert from "node:assert/strict";
import { test } from "node:test";

import { processJsonLine } from "./cli.js";
import type { ToolResponse } from "./protocol.js";

test("JSONL transport validates malformed JSON", async () => {
  const response = JSON.parse(await processJsonLine("{")) as ToolResponse;

  assert.equal(response.ok, false);
  assert.equal(response.error?.code, "INVALID_REQUEST");
  assert.equal(response.id, "invalid-request");
});

test("JSONL transport preserves request IDs", async () => {
  const response = JSON.parse(await processJsonLine(JSON.stringify({
    id: "health-1",
    apiVersion: "tool-adapter/v1",
    method: "health"
  }))) as ToolResponse;

  assert.equal(response.ok, true);
  assert.equal(response.id, "health-1");
  assert.deepEqual(response.result, { status: "ok" });
});
