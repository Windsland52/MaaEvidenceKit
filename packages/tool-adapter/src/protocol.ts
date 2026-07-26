export type ToolRequest = {
  id: string;
  apiVersion: "tool-adapter/v1";
  method: "health" | "tools/list" | "tools/call";
  params?: Record<string, unknown>;
};

export type ToolError = {
  code: string;
  message: string;
  retryable: boolean;
  details?: Record<string, unknown>;
};

type ToolResponseBase = {
  id: string;
  apiVersion: "tool-adapter/v1";
};

export type ToolSuccessResponse = ToolResponseBase & {
  ok: true;
  result: object | string | number | boolean;
  error: null;
};

export type ToolFailureResponse = ToolResponseBase & {
  ok: false;
  result: null;
  error: ToolError;
};

export type ToolResponse = ToolSuccessResponse | ToolFailureResponse;

export type ToolDescriptor = {
  name: string;
  description: string;
};
