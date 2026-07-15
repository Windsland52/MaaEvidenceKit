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

export type ToolResponse = {
  id: string;
  apiVersion: "tool-adapter/v1";
  ok: boolean;
  result: unknown | null;
  error: ToolError | null;
};

export type ToolDescriptor = {
  name: string;
  description: string;
};
