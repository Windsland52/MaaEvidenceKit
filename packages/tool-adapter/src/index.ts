import { runMlaPreflight, runMlaRuntimeInspection } from "./mla.js";
import {
  runMseProjectPreflight,
  runMseTaskResolution,
  type MseSyntaxMode
} from "./mse.js";
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
  },
  {
    name: "mse.project-preflight",
    description:
      "Load a Maa project through public MSE packages using the caller-selected syntax_mode and return interface, resource, task, pipeline, and static diagnostic facts."
  },
  {
    name: "mse.resolve-tasks",
    description:
      "Resolve task definitions, effective configuration, and references using the caller-selected MSE syntax_mode."
  }
];

const success = (
  id: string,
  result: object | string | number | boolean
): ToolResponse => ({
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

const isMseSyntaxMode = (value: unknown): value is MseSyntaxMode => {
  return value === "maafw" || value === "maa";
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
    if (toolName === "mse.project-preflight") {
      const syntaxMode = toolArguments["syntax_mode"];
      if (!isMseSyntaxMode(syntaxMode)) {
        return failure(
          request.id,
          "INVALID_TOOL_ARGUMENTS",
          "mse.project-preflight requires arguments.syntax_mode to be 'maafw' or 'maa'."
        );
      }
      return success(
        request.id,
        await runMseProjectPreflight(targetPath, syntaxMode)
      );
    }
    if (toolName === "mse.resolve-tasks") {
      const tasks = toolArguments["tasks"];
      const syntaxMode = toolArguments["syntax_mode"];
      const controller = toolArguments["controller"];
      const resource = toolArguments["resource"];
      if (
        !Array.isArray(tasks)
        || tasks.length === 0
        || tasks.length > 50
        || !tasks.every(
          (item) => typeof item === "string" && item.trim().length > 0
        )
        || !isMseSyntaxMode(syntaxMode)
        || (controller !== undefined && typeof controller !== "string")
        || (resource !== undefined && typeof resource !== "string")
      ) {
        return failure(
          request.id,
          "INVALID_TOOL_ARGUMENTS",
          "mse.resolve-tasks requires syntax_mode ('maafw' or 'maa'), 1-50 non-empty tasks, and optional string controller/resource."
        );
      }
      return success(
        request.id,
        await runMseTaskResolution(
          targetPath,
          tasks,
          syntaxMode,
          controller as string | undefined,
          resource as string | undefined
        )
      );
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
      "TOOL_EXECUTION_FAILED",
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
  MlaRuntimeInspectionResult,
  MlaVersionEvidence
} from "./mla.js";
export type {
  MseConfigurationSummary,
  MseDiagnostic,
  MseProjectPreflightResult,
  MseResolvedTask,
  MseSyntaxMode,
  MseTaskBinding,
  MseTaskDefinition,
  MseTaskReference,
  MseTaskResolutionResult
} from "./mse.js";
export type { ToolDescriptor, ToolError, ToolRequest, ToolResponse } from "./protocol.js";
