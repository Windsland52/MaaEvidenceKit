import type { InspectionResult } from "../evidence/index.js";
import type { MlaInspectionDetails } from "../mla/index.js";
import type { MseInspectionDetails, MseGraph } from "../mse/index.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isMlaDetails(value: unknown): value is MlaInspectionDetails {
  return isRecord(value) && isRecord(value["runtime"]) && Array.isArray(value["runtime"]["sessions"]);
}

function isMseDetails(value: unknown): value is MseInspectionDetails {
  return isRecord(value) && Array.isArray(value["projects"]);
}

function renderMla(details: MlaInspectionDetails): string[] {
  const lines = ["MLA execution flow"];
  const signalSelection = details.selection.signals;
  if (signalSelection !== undefined) {
    lines.push(
      `Signals: ${signalSelection.selected} selected / ${signalSelection.total} observed (${signalSelection.mode})`,
    );
  }
  const sessions = details.runtime.sessions;
  if (sessions.length === 0 && details.runtime.unscoped_tasks.length === 0) {
    lines.push("└─ No task executions observed");
    return lines;
  }
  for (const [sessionIndex, session] of sessions.entries()) {
    const lastSession = sessionIndex === sessions.length - 1 && details.runtime.unscoped_tasks.length === 0;
    const branch = lastSession ? "└─" : "├─";
    lines.push(`${branch} Session ${session.session_id} (${session.framework_version ?? "version unresolved"})`);
    for (const [taskIndex, task] of session.tasks.entries()) {
      const lastTask = taskIndex === session.tasks.length - 1;
      const taskBranch = lastTask ? "└─" : "├─";
      lines.push(`   ${taskBranch} ${task.name}: ${task.status}`);
      if (task.first_node !== null) lines.push(`      ├─ first: ${task.first_node}`);
      if (task.last_node !== null) lines.push(`      └─ last: ${task.last_node}`);
    }
  }
  if (details.runtime.unscoped_tasks.length > 0) {
    lines.push("└─ Unscoped tasks");
    for (const task of details.runtime.unscoped_tasks) lines.push(`   ├─ ${task.name}: ${task.status}`);
  }
  return lines;
}

function renderGraph(graph: MseGraph, projectLabel: string): string[] {
  const lines = [`MSE node relations — ${projectLabel}`];
  if (graph.nodes.length === 0) {
    lines.push("└─ No nodes resolved");
    return lines;
  }
  const names = new Map(graph.nodes.map((node) => [node.id, node.name]));
  const outgoing = new Map<string, Array<{ target: string; kind: string }>>();
  const edgeKeys = new Set<string>();
  for (const edge of graph.edges) {
    const from = names.get(edge.from) ?? edge.from;
    const target = names.get(edge.to) ?? edge.to;
    const key = `${from}|${edge.kind}|${target}`;
    if (edgeKeys.has(key)) continue;
    edgeKeys.add(key);
    const group = outgoing.get(from) ?? [];
    group.push({ target, kind: edge.kind });
    outgoing.set(from, group);
  }
  const connected = new Set([...outgoing.keys(), ...[...outgoing.values()].flat().map((edge) => edge.target)]);
  for (const [nodeName, edges] of [...outgoing.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    lines.push(`├─ ${nodeName}`);
    for (const [index, edge] of edges.entries()) {
      lines.push(`│  ${index === edges.length - 1 ? "└─" : "├─"} [${edge.kind}] ${edge.target}`);
    }
  }
  const isolated = [...new Set(graph.nodes.map((node) => node.name))]
    .filter((name) => !connected.has(name));
  for (const nodeName of isolated) lines.push(`└─ ${nodeName}`);
  return lines;
}

const EVIDENCE_PRIORITY: Record<string, number> = {
  "mla.failure": 0,
  "mla.outcome": 1,
  "mla.task": 5,
  "mla.signal": 4,
  "mla.session": 6,
  "mse.interface": 7,
  "mse.task_binding": 8,
  "mse.task_definition": 9,
  "mse.reference": 10,
  "mse.diagnostic": 11,
};

function evidencePriority(item: InspectionResult["evidence"][number]): number {
  if (item.kind !== "mla.signal" || !isRecord(item.data)) {
    return EVIDENCE_PRIORITY[item.kind] ?? 100;
  }
  switch (item.data["priority"]) {
    case "high":
      return 2;
    case "normal":
      return 3;
    default:
      return 4;
  }
}

export function renderText(result: InspectionResult): string {
  const selected = result.artifacts.filter((artifact) => artifact.status === "selected").length;
  const lines = [
    `MaaEvidenceKit ${result.kind} inspection`,
    `Input: ${result.input.path}`,
    `Artifacts: ${selected} selected / ${result.artifacts.length} reported`,
    `Evidence: ${result.evidence.length}`,
  ];
  if (result.input.timeRange !== undefined) {
    lines.push(`Time range: ${result.input.timeRange.from ?? "start"} → ${result.input.timeRange.to ?? "end"}`);
  }
  lines.push("");
  if (result.kind === "mla" && isMlaDetails(result.details)) {
    lines.push(...renderMla(result.details), "");
  } else if (result.kind === "mse" && isMseDetails(result.details)) {
    for (const project of result.details.projects) {
      lines.push(...renderGraph(project.graph, project.projectRoot), "");
    }
  } else if (result.kind === "combined" && isRecord(result.details)) {
    const mla = result.details["mla"];
    const mse = result.details["mse"];
    if (isRecord(mla) && isMlaDetails(mla["details"])) lines.push(...renderMla(mla["details"]), "");
    if (isRecord(mse) && isMseDetails(mse["details"])) {
      for (const project of mse["details"].projects) {
        lines.push(...renderGraph(project.graph, project.projectRoot), "");
      }
    }
  }
  lines.push("Evidence ledger");
  const evidenceLimit = 200;
  const displayedEvidence = [...result.evidence]
    .sort((left, right) => evidencePriority(left) - evidencePriority(right))
    .slice(0, evidenceLimit);
  for (const evidence of displayedEvidence) {
    const location = [evidence.source.path, evidence.source.line].filter((item) => item !== undefined).join(":");
    lines.push(`- ${evidence.id} [${evidence.kind}] ${evidence.summary} (${location})`);
  }
  if (result.evidence.length > displayedEvidence.length) {
    lines.push(`- … ${result.evidence.length - displayedEvidence.length} additional evidence records are available in JSON.`);
  }
  if (result.missingEvidence.length > 0) {
    lines.push("", "Missing evidence");
    for (const missing of result.missingEvidence) lines.push(`- ${missing.code}: ${missing.message}`);
  }
  if (result.warnings.length > 0) {
    lines.push("", "Warnings");
    for (const warning of result.warnings) lines.push(`- ${warning.code}: ${warning.message}`);
  }
  return lines.join("\n").trimEnd();
}
