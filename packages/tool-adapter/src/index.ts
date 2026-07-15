import type { ToolDescriptor, ToolRequest, ToolResponse } from "./protocol.js";

const tools: ToolDescriptor[] = [];

export function handleRequest(request: ToolRequest): ToolResponse {
  switch (request.method) {
    case "health":
      return {
        id: request.id,
        apiVersion: "tool-adapter/v1",
        ok: true,
        result: { status: "ok" },
        error: null
      };
    case "tools/list":
      return {
        id: request.id,
        apiVersion: "tool-adapter/v1",
        ok: true,
        result: { tools },
        error: null
      };
    case "tools/call":
      return {
        id: request.id,
        apiVersion: "tool-adapter/v1",
        ok: false,
        result: null,
        error: {
          code: "TOOL_NOT_IMPLEMENTED",
          message: "Concrete MLA and MSE tools have not been registered yet.",
          retryable: false
        }
      };
  }
}

export type { ToolDescriptor, ToolError, ToolRequest, ToolResponse } from "./protocol.js";
