import type { MseResolvedTask, MseTaskResolutionResult } from "./engine.js";

export type MseGraphNode = {
  id: string;
  name: string;
  controller: string | null;
  resource: string | null;
  found: boolean;
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

export function buildMseGraph(resolution: MseTaskResolutionResult): MseGraph {
  const nodes = new Map<string, MseGraphNode>();
  const edges = new Map<string, MseGraphEdge>();
  for (const item of resolution.resolutions) {
    const from = nodeId(item.name, item.controller, item.resource);
    nodes.set(from, {
      id: from,
      name: item.name,
      controller: item.controller,
      resource: item.resource,
      found: item.found,
      definitions: item.definitions,
    });
    for (const reference of item.references) {
      const to = nodeId(reference.target, item.controller, item.resource);
      if (!nodes.has(to)) {
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
