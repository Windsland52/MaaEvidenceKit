#!/usr/bin/env node
import path from "node:path";
import { createInterface } from "node:readline";
import { pathToFileURL } from "node:url";

import { handleRequest } from "./index.js";
import type { ToolRequest, ToolResponse } from "./protocol.js";

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null && !Array.isArray(value);
};

const invalidResponse = (id: string, message: string): ToolResponse => ({
  id,
  apiVersion: "tool-adapter/v1",
  ok: false,
  result: null,
  error: {
    code: "INVALID_REQUEST",
    message,
    retryable: false
  }
});

const parseRequest = (value: unknown): ToolRequest | null => {
  if (!isRecord(value)) return null;
  const id = value["id"];
  const apiVersion = value["apiVersion"];
  const method = value["method"];
  const params = value["params"];
  if (
    typeof id !== "string" ||
    apiVersion !== "tool-adapter/v1" ||
    (method !== "health" && method !== "tools/list" && method !== "tools/call") ||
    (params !== undefined && !isRecord(params))
  ) {
    return null;
  }
  return {
    id,
    apiVersion,
    method,
    ...(params === undefined ? {} : { params })
  };
};

export async function processJsonLine(line: string): Promise<string> {
  let value: unknown;
  try {
    value = JSON.parse(line) as unknown;
  } catch {
    return JSON.stringify(invalidResponse("invalid-request", "Request is not valid JSON."));
  }

  const request = parseRequest(value);
  if (!request) {
    const id = isRecord(value) && typeof value["id"] === "string"
      ? value["id"]
      : "invalid-request";
    return JSON.stringify(invalidResponse(id, "Request does not match tool-adapter/v1."));
  }
  return JSON.stringify(await handleRequest(request));
}

export async function main(): Promise<void> {
  const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
  for await (const line of lines) {
    if (line.trim().length === 0) continue;
    process.stdout.write(`${await processJsonLine(line)}\n`);
  }
}

const isEntrypoint = (): boolean => {
  const argvPath = process.argv[1];
  return argvPath !== undefined
    && import.meta.url === pathToFileURL(path.resolve(argvPath)).href;
};

if (isEntrypoint()) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
