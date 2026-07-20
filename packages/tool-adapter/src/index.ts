import { runMlaPreflight, runMlaRuntimeInspection } from "./mla.js";
import type { ToolDescriptor, ToolRequest, ToolResponse } from "./protocol.js";

const tools: ToolDescriptor[] = [
  {
    name: "mla.preflight",
    description:
      "Check MaaFramework log compatibility and return runtime-version sessions with source evidence."
  },
  {
    name: "mla.runtime-inspection",
    description:
      "Parse MaaFramework logs and return structured failures, outcomes, and recognition/repetition signals with source-mapped evidence."
  }
];

const success = (id: string, result: unknown): ToolResponse => ({
  id,
  apiVersion: "tool-adapter/v1",
  ok: true,
  result,
  error: null
});

const failure = (
  id: string,
  code: string,
  message: string,
  retryable = false,
  details?: Record<string, unknown>
): ToolResponse => ({
  id,
  apiVersion: "tool-adapter/v1",
  ok: false,
  result: null,
  error: {
    code,
    message,
    retryable,
    ...(details ? { details } : {})
  }
});

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null && !Array.isArray(value);
};

async function callTool(request: ToolRequest): Promise<ToolResponse> {
  const toolName = request.params?.["name"];
  const toolArguments = request.params?.["arguments"];
  if (typeof toolName !== "string" || !isRecord(toolArguments)) {
    return failure(
      request.id,
      "INVALID_TOOL_CALL",
      "tools/call requires string params.name and object params.arguments."
    );
  }
  const targetPath = toolArguments["path"];
  if (typeof targetPath !== "string" || targetPath.trim().length === 0) {
    return failure(
      request.id,
      "INVALID_TOOL_ARGUMENTS",
      `${toolName} requires a non-empty string arguments.path.`
    );
  }

  try {
    if (toolName === "mla.preflight") {
      return success(request.id, await runMlaPreflight(targetPath));
    }
    if (toolName === "mla.runtime-inspection") {
      return success(request.id, await runMlaRuntimeInspection(targetPath));
    }
    return failure(
      request.id,
      "TOOL_NOT_FOUND",
      `Unknown tool: ${toolName}`
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return failure(
      request.id,
      "MLA_TOOL_FAILED",
      message,
      false,
      { tool: toolName }
    );
  }
}

export async function handleRequest(request: ToolRequest): Promise<ToolResponse> {
  switch (request.method) {
    case "health":
      return success(request.id, { status: "ok" });
    case "tools/list":
      return success(request.id, { tools });
    case "tools/call":
      return callTool(request);
  }
}

export type {
  MlaFrameworkSession,
  MlaLogPosition,
  MlaPreflightResult,
  MlaVersionEvidence
} from "./mla.js";
export type { ToolDescriptor, ToolError, ToolRequest, ToolResponse } from "./protocol.js";
