import type { InspectionResult } from "../evidence/index.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function escapeLabel(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll('"', "\\\"").replaceAll("\n", " ");
}

function id(index: number): string {
  return `n${index}`;
}

export function renderMermaid(result: InspectionResult): string {
  const lines = ["flowchart TD"];
  let nextId = 0;
  if (result.kind === "mla" && isRecord(result.details) && isRecord(result.details["runtime"])) {
    const sessions = result.details["runtime"]["sessions"];
    if (Array.isArray(sessions)) {
      for (const sessionValue of sessions) {
        if (!isRecord(sessionValue) || !Array.isArray(sessionValue["tasks"])) continue;
        const sessionId = id(nextId++);
        lines.push(`  ${sessionId}["Session ${escapeLabel(String(sessionValue["session_id"]))}"]`);
        for (const taskValue of sessionValue["tasks"]) {
          if (!isRecord(taskValue)) continue;
          const taskId = id(nextId++);
          lines.push(`  ${taskId}["${escapeLabel(String(taskValue["name"]))}: ${escapeLabel(String(taskValue["status"]))}"]`);
          lines.push(`  ${sessionId} --> ${taskId}`);
        }
      }
    }
  }
  const projectGroups: unknown[] = [];
  if (result.kind === "mse" && isRecord(result.details) && Array.isArray(result.details["projects"])) {
    projectGroups.push(result.details);
  }
  if (result.kind === "combined" && isRecord(result.details)) {
    const mse = result.details["mse"];
    if (isRecord(mse) && isRecord(mse["details"]) && Array.isArray(mse["details"]["projects"])) {
      projectGroups.push(mse["details"]);
    }
  }
  for (const group of projectGroups) {
    if (!isRecord(group) || !Array.isArray(group["projects"])) continue;
    for (const project of group["projects"]) {
      if (!isRecord(project)) continue;
      const graph = project["graph"];
      if (!isRecord(graph) || !Array.isArray(graph["nodes"])) continue;
      const nodeIds = new Map<string, string>();
      for (const node of graph["nodes"]) {
        if (!isRecord(node)) continue;
        const graphId = String(node["id"]);
        const renderedId = id(nextId++);
        nodeIds.set(graphId, renderedId);
        lines.push(`  ${renderedId}["${escapeLabel(String(node["name"]))}"]`);
      }
      if (!Array.isArray(graph["edges"])) continue;
      for (const edge of graph["edges"]) {
        if (!isRecord(edge)) continue;
        const from = nodeIds.get(String(edge["from"]));
        const to = nodeIds.get(String(edge["to"]));
        if (from !== undefined && to !== undefined) {
          lines.push(`  ${from} -->|"${escapeLabel(String(edge["kind"]))}"| ${to}`);
        }
      }
    }
  }
  if (lines.length === 1) lines.push('  empty["No renderable graph evidence"]');
  return lines.join("\n");
}
