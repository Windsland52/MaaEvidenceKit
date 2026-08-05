import type { MseResolvedTask, MseTaskResolutionResult } from "./engine.js";
import { EXECUTION_REFERENCE_KINDS } from "./engine.js";

export type MseGraphNode = {
  id: string;
  name: string;
  controller: string | null;
  resource: string | null;
  found: boolean;
  desc?: string;
  recognition?: string;
  action?: string;
  customRecognition?: string;
  customAction?: string;
  definitions: MseResolvedTask["definitions"];
};

export type MseGraphEdge = {
  from: string;
  to: string;
  kind: string;
  sourcePath: string;
  line: number;
  column: number;
};

export type MseGraph = {
  nodes: MseGraphNode[];
  edges: MseGraphEdge[];
};

function nodeId(name: string, controller: string | null, resource: string | null): string {
  return [controller ?? "default-controller", resource ?? "default-resource", name].join("::");
}

function configValue(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (Array.isArray(value) && value.length > 0) {
    const rendered = value.map((item) => configValue(item)).filter((item): item is string => item !== undefined);
    return rendered.length > 0 ? rendered.join(" | ") : undefined;
  }
  if (typeof value === "object" && value !== null) {
    const record = value as Record<string, unknown>;
    if (typeof record["type"] === "string") return record["type"];
    if (typeof record["name"] === "string") return record["name"];
  }
  return undefined;
}

function nodeSummary(item: MseResolvedTask): Pick<MseGraphNode, "desc" | "recognition" | "action" | "customRecognition" | "customAction"> {
  const config = item.effective_config;
  const desc = configValue(config["desc"]);
  const recognition = configValue(config["recognition"]);
  const action = configValue(config["action"]);
  const customRecognition = configValue(config["custom_recognition"]);
  const customAction = configValue(config["custom_action"]);
  return {
    ...(desc === undefined ? {} : { desc }),
    ...(recognition === undefined ? {} : { recognition }),
    ...(action === undefined ? {} : { action }),
    ...(customRecognition === undefined ? {} : { customRecognition }),
    ...(customAction === undefined ? {} : { customAction }),
  };
}

export function buildMseGraph(resolution: MseTaskResolutionResult): MseGraph {
  const nodes = new Map<string, MseGraphNode>();
  const edges = new Map<string, MseGraphEdge>();
  for (const item of resolution.resolutions) {
    const from = nodeId(item.name, item.controller, item.resource);
    const summary = nodeSummary(item);
    const existing = nodes.get(from);
    const mergedSummary = existing === undefined
      ? summary
      : {
        desc: existing.desc ?? summary.desc,
        recognition: existing.recognition ?? summary.recognition,
        action: existing.action ?? summary.action,
        customRecognition: existing.customRecognition ?? summary.customRecognition,
        customAction: existing.customAction ?? summary.customAction,
      };
    nodes.set(from, {
      id: from,
      name: item.name,
      controller: item.controller,
      resource: item.resource,
      found: item.found,
      ...Object.fromEntries(
        Object.entries(mergedSummary).filter(([, value]) => value !== undefined),
      ),
      definitions: item.definitions,
    });
    for (const reference of item.references) {
      if (!EXECUTION_REFERENCE_KINDS.has(reference.kind)) continue;
      const to = nodeId(reference.target, item.controller, item.resource);
      if (!nodes.has(to)) {
        const prior = nodes.get(to);
        nodes.set(to, {
          id: to,
          name: reference.target,
          controller: item.controller,
          resource: item.resource,
          found: resolution.resolutions.some(
            (candidate) =>
              candidate.name === reference.target
              && candidate.controller === item.controller
              && candidate.resource === item.resource
              && candidate.found,
          ),
          ...(prior === undefined ? {} : {
            desc: prior.desc,
            recognition: prior.recognition,
            action: prior.action,
            customRecognition: prior.customRecognition,
            customAction: prior.customAction,
          }),
          definitions: [],
        });
      }
      const key = [from, to, reference.kind, reference.source_path, reference.line, reference.column]
        .join("|");
      edges.set(key, {
        from,
        to,
        kind: reference.kind,
        sourcePath: reference.source_path,
        line: reference.line,
        column: reference.column,
      });
    }
  }
  return {
    nodes: [...nodes.values()].sort((left, right) => left.id.localeCompare(right.id)),
    edges: [...edges.values()].sort((left, right) =>
      [left.from, left.to, left.kind].join("|").localeCompare([right.from, right.to, right.kind].join("|")),
    ),
  };
}
