
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, expect, test } from "vitest";

import { main } from "../../src/cli/main.js";
import { inspect, inspectMla, setTelemetryEnabled } from "../../src/index.js";

const temporaryRoots: string[] = [];
const originalConfigDirectory = process.env["MAA_EVIDENCE_CONFIG_DIR"];

afterEach(async () => {
  if (originalConfigDirectory === undefined) delete process.env["MAA_EVIDENCE_CONFIG_DIR"];
  else process.env["MAA_EVIDENCE_CONFIG_DIR"] = originalConfigDirectory;
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function event(timestamp: string, message: string, details: Record<string, unknown>): string {
  return `[${timestamp}][INF][Px1][Tx2][test] !!!OnEventNotify!!! [handle=1] [msg=${message}] [details=${JSON.stringify(details)}]`;
}

function failingNodeLog(nodeName: string): string[] {
  const actionDetails = { action: "Click", action_id: 12, box: [0, 0, 10, 10], detail: {}, name: nodeName, success: false };
  return [
    "[2026-07-19 10:00:00.000][DBG][Px1][Tx1][Logger] MAA Process Start",
    "[2026-07-19 10:00:00.001][DBG][Px1][Tx1][Logger] Version v5.12.2",
    event("2026-07-19 10:01:00.000", "Tasker.Task.Starting", {
      task_id: 1, entry: nodeName, hash: "h1", uuid: "u1",
    }),
    event("2026-07-19 10:01:01.000", "Node.PipelineNode.Starting", {
      task_id: 1, node_id: 11, name: nodeName,
    }),
    event("2026-07-19 10:01:01.100", "Node.NextList.Starting", {
      focus: null, list: [{ anchor: false, jump_back: false, name: nodeName }],
      name: nodeName, task_id: 1,
    }),
    event("2026-07-19 10:01:01.200", "Node.Recognition.Starting", {
      focus: null, name: nodeName, reco_id: 21, task_id: 1,
    }),
    event("2026-07-19 10:01:01.300", "Node.Recognition.Succeeded", {
      focus: null, name: nodeName,
      reco_details: { algorithm: "DirectHit", box: [0, 0, 10, 10], detail: null, name: nodeName, reco_id: 21 },
      reco_id: 21, task_id: 1,
    }),
    event("2026-07-19 10:01:01.400", "Node.NextList.Succeeded", {
      focus: null, list: [{ anchor: false, jump_back: false, name: nodeName }],
      name: nodeName, task_id: 1,
    }),
    event("2026-07-19 10:01:01.500", "Node.Action.Starting", {
      action_id: 12, focus: null, name: nodeName, task_id: 1,
    }),
    event("2026-07-19 10:01:02.000", "Node.Action.Failed", {
      action_details: actionDetails, action_id: 12, focus: null, name: nodeName, task_id: 1,
    }),
    event("2026-07-19 10:01:02.000", "Node.PipelineNode.Failed", {
      action_details: actionDetails, focus: null, name: nodeName,
      node_details: { action_id: 12, completed: false, name: nodeName, node_id: 11, reco_id: 21 },
      node_id: 11, task_id: 1,
      reco_details: { algorithm: "DirectHit", box: [0, 0, 10, 10], detail: null, name: nodeName, reco_id: 21 },
    }),
    event("2026-07-19 10:01:03.000", "Tasker.Task.Failed", {
      task_id: 1, entry: nodeName, hash: "h1", uuid: "u1",
    }),
  ];
}

function recognitionNodeLog(nodeName: string): string[] {
  return [
    "[2026-07-19 10:00:00.000][DBG][Px1][Tx1][Logger] MAA Process Start",
    "[2026-07-19 10:00:00.001][DBG][Px1][Tx1][Logger] Version v5.12.2",
    event("2026-07-19 10:01:00.000", "Node.Recognition.Failed", {
      name: nodeName,
      reco_details: {
        algorithm: "OCR",
        name: nodeName,
        detail: {
          all: [{ box: [100, 200, 50, 20], score: 0.72, text: "start" }],
          filtered: [],
          best: null,
        },
      },
    }),
  ];
}

async function createCombinedFixture(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "mek-workflow-"));
  temporaryRoots.push(root);
  await writeFile(path.join(root, "maafw.log"), [
    "[2026-07-19 10:00:00.000][DBG][Px1][Tx1][Logger] MAA Process Start",
    "[2026-07-19 10:00:00.001][DBG][Px1][Tx1][Logger] Version v5.12.2",
    event("2026-07-19 10:01:00.000", "Tasker.Task.Starting", {
      task_id: 1, entry: "Start", hash: "h1", uuid: "u1",
    }),
    event("2026-07-19 10:01:01.000", "Node.PipelineNode.Starting", {
      task_id: 1, node_id: 11, name: "Start",
    }),
    event("2026-07-19 10:01:02.000", "Node.PipelineNode.Succeeded", {
      task_id: 1, node_id: 11, name: "Start",
    }),
    event("2026-07-19 10:01:03.000", "Tasker.Task.Succeeded", {
      task_id: 1, entry: "Start", hash: "h1", uuid: "u1",
    }),
  ].join("\n"), "utf8");
  const assets = path.join(root, "assets");
  const pipeline = path.join(assets, "resource", "base", "pipeline");
  await mkdir(pipeline, { recursive: true });
  await writeFile(path.join(assets, "interface.json"), JSON.stringify({
    controller: [{ name: "Adb" }],
    resource: [{ name: "Official", path: ["resource/base"], controller: ["Adb"] }],
    task: [{ name: "Combat", entry: "Start" }],
  }), "utf8");
  await writeFile(path.join(pipeline, "combat.json"), JSON.stringify({
    Start: { recognition: "DirectHit", next: ["Done"] },
    Done: { recognition: "DirectHit" },
  }), "utf8");
  return root;
}

test("combined inspection chooses only the deterministic adapters present", async () => {
  const root = await createCombinedFixture();
  const result = await inspect(root);

  expect(result.details.mla).not.toBeNull();
  expect(result.details.mse).not.toBeNull();
  expect(result.evidence.some((item) => item.kind.startsWith("mla."))).toBe(true);
  expect(result.evidence.some((item) => item.kind.startsWith("mse."))).toBe(true);
  expect(result.statistics.adapters).toBe(2);
});

test("combined inspection reports missing log and project as missing evidence", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "mek-combined-empty-"));
  temporaryRoots.push(root);
  await writeFile(path.join(root, "package.json"), "{}", "utf8");

  const result = await inspect(root);

  expect(result.missingEvidence.some((item) => item.code === "maa_framework_log_not_selected")).toBe(true);
  expect(result.missingEvidence.some((item) => item.code === "mse_project_not_selected")).toBe(true);
  expect(result.evidence).toHaveLength(0);
});

test("combined inspection links runtime failures to MSE pipeline nodes", async () => {
  const root = await createCombinedFixture();
  await writeFile(path.join(root, "maafw.log"), failingNodeLog("Start").join("\n"), "utf8");

  const result = await inspect(root);
  const withTasks = await inspect(root, { mse: { tasks: ["Start"] } });
  const refs = result.evidence.filter((item) => item.kind === "combined.pipeline_reference");
  const refsWithTasks = withTasks.evidence.filter((item) => item.kind === "combined.pipeline_reference");
  const data = refs[0]?.data as {
    node?: string;
    pipelineFound?: boolean;
    pipelineControllers?: string[];
    pipelineResources?: string[];
    pipelineDefinitions?: Array<{ sourcePath: string; line: number; column: number }>;
    staticResolutionStatus?: string;
    incompleteReasons?: string[];
  } | undefined;
  const dataWithTasks = refsWithTasks[0]?.data as { node?: string; pipelineFound?: boolean } | undefined;

  expect(refs.length).toBeGreaterThan(0);
  expect(data?.node).toBe("Start");
  expect(data?.pipelineFound).toBe(true);
  expect(data?.pipelineControllers).toContain("Adb");
  expect(data?.pipelineResources).toContain("Official");
  expect(data?.staticResolutionStatus).toBe("found");
  expect(data?.incompleteReasons).toEqual([]);
  expect(data?.pipelineDefinitions?.length).toBeGreaterThan(0);
  expect(data?.pipelineDefinitions?.[0]?.sourcePath).toMatch(/combat\.json$/);
  expect(dataWithTasks?.node).toBe("Start");
  expect(dataWithTasks?.pipelineFound).toBe(true);
});

test("combined failure references link MSE base definitions to task-scoped runtime overrides", async () => {
  const root = await createCombinedFixture();
  const failureLog = failingNodeLog("Start");
  await writeFile(path.join(root, "maafw.log"), [
    ...failureLog.slice(0, 2),
    "[2026-07-19 10:00:59.000][INF][Px1][Tx1][Tasker.cpp][L87][MaaNS::Tasker::post_task] [entry=Start] [pipeline_override=[{\"Start\":{\"next\":[\"Fallback\"]}}]]",
    "[2026-07-19 10:00:59.000][TRC][Px1][Tx1][Context.cpp][L195][MaaNS::TaskNS::Context::override_pipeline] [getptr()=ABC123] [pipeline_override=[{\"Start\":{\"next\":[\"Fallback\"]}}]]",
    "[2026-07-19 10:00:59.010][INF][Px2][Tx2][AgentServer.cpp][L225][MaaNS::AgentNS::ServerNS::AgentServer::handle_action_request] [req={\"context_id\":\"ABC123\",\"task_id\":1}]",
    ...failureLog.slice(2, 9),
    "[2026-07-19 10:01:01.900][TRC][Px1][Tx1][Context.cpp][L195][MaaNS::TaskNS::Context::override_pipeline] [getptr()=ABC123] [pipeline_override={\"Start\":{\"attach\":{\"choice\":\"runtime\"}}}]",
    ...failureLog.slice(9),
  ].join("\n"), "utf8");

  const result = await inspect(root);
  const reference = result.evidence.find((item) => item.kind === "combined.pipeline_reference");
  const data = reference?.data as {
    pipelineDefinitionEvidenceIds?: string[];
    runtimeOverrideEvidenceIds?: string[];
    unscopedRuntimeOverrideEvidenceIds?: string[];
    runtimeOverrideResolutionStatus?: string;
    runtimeConfigurationIncompleteReasons?: string[];
  } | undefined;

  expect(data).toMatchObject({
    runtimeOverrideResolutionStatus: "found",
    runtimeConfigurationIncompleteReasons: [],
    unscopedRuntimeOverrideEvidenceIds: [],
  });
  expect(data?.pipelineDefinitionEvidenceIds).toHaveLength(1);
  expect(data?.runtimeOverrideEvidenceIds).toHaveLength(2);
  expect(result.evidence.find((item) => item.id === data?.pipelineDefinitionEvidenceIds?.[0]))
    .toMatchObject({ kind: "mse.task_definition" });
  const runtimeOverrides = (data?.runtimeOverrideEvidenceIds ?? []).map((id) =>
    result.evidence.find((item) => item.id === id)
  );
  expect(runtimeOverrides).toHaveLength(2);
  expect(runtimeOverrides.every((item) => item?.kind === "mla.pipeline_override")).toBe(true);
  expect(runtimeOverrides.map((item) => (item?.data as { patches?: unknown[] } | undefined)?.patches))
    .toEqual([
      [{ Start: { next: ["Fallback"] } }],
      [{ Start: { attach: { choice: "runtime" } } }],
    ]);
});

test("combined inspection reports runtime failure nodes missing from the MSE pipeline", async () => {
  const root = await createCombinedFixture();
  await writeFile(path.join(root, "maafw.log"), failingNodeLog("Ghost").join("\n"), "utf8");

  const result = await inspect(root);
  const refs = result.evidence.filter((item) => item.kind === "combined.pipeline_reference");
  const data = refs[0]?.data as {
    node?: string;
    pipelineFound?: boolean;
    staticResolutionStatus?: string;
    incompleteReasons?: string[];
  } | undefined;

  expect(refs.length).toBeGreaterThan(0);
  expect(data?.node).toBe("Ghost");
  expect(data?.pipelineFound).toBe(false);
  expect(data?.staticResolutionStatus).toBe("not_found");
  expect(data?.incompleteReasons).toEqual([]);
  expect(result.warnings.some((item) => item.code === "combined.pipeline_reference_missing")).toBe(true);
  expect(result.warnings.some((item) => item.message.includes("Ghost"))).toBe(true);
});

test("CLI writes JSON inspection and can query a cited source window", async () => {
  const root = await createCombinedFixture();
  const configDirectory = path.join(root, "config");
  process.env["MAA_EVIDENCE_CONFIG_DIR"] = configDirectory;
  await setTelemetryEnabled(false, configDirectory);
  const inspectionPath = path.join(root, "inspection.json");
  const profilePath = path.join(root, "inspection-profile.json");
  const windowPath = path.join(root, "window.json");
  const evidencePath = path.join(root, "evidence.json");
  const windowTextPath = path.join(root, "window.txt");
  const searchPath = path.join(root, "search.json");
  const batchRequestsPath = path.join(root, "batch-requests.json");
  const batchPath = path.join(root, "batch.json");
  const focusedCombinedPath = path.join(root, "focused-combined.json");
  const resolvedMsePath = path.join(root, "resolved-mse.json");
  const resolvedMseProfilePath = path.join(root, "resolved-mse-profile.json");

  expect(await main([
    "inspect",
    root,
    "--format",
    "json",
    "--output",
    inspectionPath,
    "--profile",
    profilePath,
  ])).toBe(0);
  const profile = JSON.parse(await readFile(profilePath, "utf8")) as {
    schemaVersion: string;
    command: string;
    status: string;
    stages: Array<{ name: string }>;
  };
  expect(profile).toMatchObject({
    schemaVersion: "maa-evidence-profile/v1",
    command: "inspect",
    status: "ok",
  });
  expect(profile.stages.map((stage) => stage.name)).toEqual(expect.arrayContaining([
    "combined.discovery",
    "mla.discovery",
    "mla.load_parse",
    "mse.preflight",
    "render",
    "output.write",
  ]));
  expect(await main([
    "inspect",
    root,
    "--task",
    "Start",
    "--controller",
    "Adb",
    "--resource",
    "Official",
    "--no-referencers",
    "--format",
    "json",
    "--output",
    focusedCombinedPath,
  ])).toBe(0);
  const focusedCombined = JSON.parse(await readFile(focusedCombinedPath, "utf8")) as {
    details: {
      mse?: {
        details?: {
          selection?: { includeReferencers?: boolean };
          projects?: Array<{
            resolution?: { resolutions?: Array<{ controller?: string; resource?: string }> };
          }>;
        };
      };
    };
  };
  expect(focusedCombined.details.mse?.details?.selection?.includeReferencers).toBe(false);
  expect(focusedCombined.details.mse?.details?.projects?.[0]?.resolution?.resolutions?.[0]).toMatchObject({
    controller: "Adb",
    resource: "Official",
  });
  expect(await main([
    "mse",
    "resolve",
    root,
    "--task",
    "Start",
    "--controller",
    "Adb",
    "--resource",
    "Official",
    "--no-referencers",
    "--format",
    "json",
    "--output",
    resolvedMsePath,
    "--profile",
    resolvedMseProfilePath,
  ])).toBe(0);
  const resolvedMse = JSON.parse(await readFile(resolvedMsePath, "utf8")) as {
    details: { mode?: string };
    evidence: Array<{ kind: string }>;
  };
  const resolvedMseProfile = JSON.parse(await readFile(resolvedMseProfilePath, "utf8")) as {
    command: string;
    stages: Array<{ name: string }>;
  };
  expect(resolvedMse.details.mode).toBe("resolution");
  expect(resolvedMse.evidence.some((item) => item.kind === "mse.task_definition")).toBe(true);
  expect(resolvedMse.evidence.some((item) => item.kind === "mse.interface")).toBe(false);
  expect(resolvedMseProfile.command).toBe("mse.resolve");
  expect(resolvedMseProfile.stages.map((stage) => stage.name)).toContain("mse.resolution");
  expect(resolvedMseProfile.stages.map((stage) => stage.name)).not.toContain("mse.preflight");
  const inspection = JSON.parse(await readFile(inspectionPath, "utf8")) as {
    schemaVersion: string;
    evidence: Array<{ id: string; source: { line?: number } }>;
  };
  const cited = inspection.evidence.find((item) => item.source.line !== undefined);
  expect(inspection.schemaVersion).toBe("maa-evidence/v1");
  expect(cited).toBeDefined();
  expect(await main([
    "window",
    "--input",
    inspectionPath,
    "--evidence-id",
    cited?.id ?? "",
    "--before",
    "1",
    "--after",
    "1",
    "--output",
    windowPath,
  ])).toBe(0);
  const window = JSON.parse(await readFile(windowPath, "utf8")) as { text: string };
  expect(window.text).toContain("MAA Process Start");
  expect(await main([
    "search",
    "--input",
    inspectionPath,
    "--kind",
    "mla.session",
    "--text",
    "v5.12.2",
    "--format",
    "json",
    "--output",
    searchPath,
  ])).toBe(0);
  const search = JSON.parse(await readFile(searchPath, "utf8")) as {
    totalMatches: number;
    evidence: Array<{ id: string; source: object; data?: unknown }>;
  };
  expect(search.totalMatches).toBeGreaterThan(0);
  expect(search.evidence[0]?.id).toMatch(/^evidence-/);
  expect(search.evidence[0]?.source).toBeDefined();
  expect(search.evidence[0]?.data).toBeUndefined();
  await writeFile(batchRequestsPath, JSON.stringify([
    {
      id: "sessions",
      operation: "search",
      query: { kinds: ["mla.session"], text: ["v5.12.2"], limit: 5 },
    },
    { id: "cited", operation: "view", evidenceId: cited?.id },
    {
      id: "context",
      operation: "window",
      query: { evidenceId: cited?.id, before: 1, after: 1 },
    },
  ]), "utf8");
  expect(await main([
    "batch",
    "--input",
    inspectionPath,
    "--requests",
    batchRequestsPath,
    "--output",
    batchPath,
  ])).toBe(0);
  const batch = JSON.parse(await readFile(batchPath, "utf8")) as {
    schemaVersion: string;
    results: Array<{ id: string; operation: string; result: Record<string, unknown> }>;
  };
  expect(batch.schemaVersion).toBe("maa-evidence-batch/v1");
  expect(batch.results.map((item) => [item.id, item.operation])).toEqual([
    ["sessions", "search"],
    ["cited", "view"],
    ["context", "window"],
  ]);
  expect(batch.results[1]?.result["data"]).toBeDefined();
  expect(String(batch.results[2]?.result["text"])).toContain("MAA Process Start");
  expect(await main([
    "view",
    "--input",
    inspectionPath,
    "--evidence-id",
    cited?.id ?? "",
    "--format",
    "json",
    "--output",
    evidencePath,
  ])).toBe(0);
  const singleEvidence = JSON.parse(await readFile(evidencePath, "utf8")) as { id: string; kind: string };
  expect(singleEvidence.id).toBe(cited?.id);
  expect(singleEvidence.kind).toBeDefined();
  expect(await main([
    "window",
    "--input",
    inspectionPath,
    "--evidence-id",
    cited?.id ?? "",
    "--format",
    "text",
    "--before",
    "1",
    "--after",
    "1",
    "--output",
    windowTextPath,
  ])).toBe(0);
  const windowText = await readFile(windowTextPath, "utf8");
  expect(windowText).toContain("Evidence window");
  expect(windowText).toContain("MAA Process Start");
  expect(await main([
    "view",
    "--input",
    inspectionPath,
    "--evidence-id",
    "evidence-missing",
    "--format",
    "json",
  ])).toBe(1);
});

test("combined inspection links runtime recognition evidence to static MSE configuration", async () => {
  const root = await createCombinedFixture();
  await writeFile(path.join(root, "maafw.log"), recognitionNodeLog("Start").join("\n"), "utf8");
  await writeFile(path.join(root, "assets", "resource", "base", "pipeline", "combat.json"), JSON.stringify({
    Start: {
      recognition: "OCR",
      expected: ["Start"],
      roi: [100, 190, 200, 50],
      only_rec: true,
      threshold: 0.95,
      template: "start.png",
      next: ["Done"],
    },
    Done: { recognition: "DirectHit" },
  }), "utf8");

  const result = await inspect(root);
  const refs = result.evidence.filter((item) => item.kind === "combined.recognition_pipeline_reference");
  const data = refs[0]?.data as {
    recognitionEvidenceId?: string;
    node?: string;
    algorithm?: string;
    status?: string;
    occurrenceCount?: number;
    pipelineFound?: boolean;
    pipelineControllers?: string[];
    pipelineResources?: string[];
    staticResolutionStatus?: string;
    incompleteReasons?: string[];
    staticConfigurations?: Array<{
      recognition?: unknown;
      customRecognition?: unknown;
      definitionEvidenceIds?: string[];
      definitionLinksComplete?: boolean;
      configurationBasis?: string;
      ocrObservationComparisons?: Array<{
        expectedValues?: string[];
        roi?: number[];
        onlyRec?: boolean;
        comparisonSemantics?: string;
        observations?: Array<{
          text?: string;
          equalsExpectedValue?: boolean;
          roiRelation?: string;
          roiBoundaryContacts?: string[];
        }>;
      }>;
      definitions?: Array<{ sourcePath?: string; line?: number; column?: number }>;
    }>;
  } | undefined;

  expect(refs).toHaveLength(1);
  expect(data).toMatchObject({
    node: "Start",
    algorithm: "OCR",
    status: "failed",
    occurrenceCount: 1,
    pipelineFound: true,
    pipelineControllers: ["Adb"],
    pipelineResources: ["Official"],
    staticResolutionStatus: "found",
    incompleteReasons: [],
  });
  expect(data?.recognitionEvidenceId).toMatch(/^evidence-/);
  expect(result.details.mse?.details.selection).toMatchObject({ depth: 0, includeReferencers: false });
  expect(data?.staticConfigurations?.[0]).toMatchObject({
    recognition: "OCR",
    customRecognition: null,
    definitionLinksComplete: true,
    configurationBasis: "mse_static_effective_config",
    ocrObservationComparisons: [{
      expectedValues: ["Start"],
      roi: [100, 190, 200, 50],
      onlyRec: true,
      comparisonSemantics: "literal_equality_and_roi_geometry",
      observations: [{
        text: "start",
        equalsExpectedValue: false,
        roiRelation: "touches_boundary",
        roiBoundaryContacts: ["left"],
      }],
    }],
  });
  expect(data?.staticConfigurations?.[0]).not.toHaveProperty("effectiveConfig");
  expect(data?.staticConfigurations?.[0]?.definitions?.[0]).toMatchObject({
    sourcePath: expect.stringMatching(/combat\.json$/),
  });
  const definitionEvidenceId = data?.staticConfigurations?.[0]?.definitionEvidenceIds?.[0];
  const definitionEvidence = result.evidence.find((item) => item.id === definitionEvidenceId);
  expect(definitionEvidence).toMatchObject({ kind: "mse.task_definition" });
  expect((definitionEvidence?.data as { effectiveConfig?: Record<string, unknown> } | undefined)?.effectiveConfig)
    .toMatchObject({ recognition: "OCR", threshold: 0.95, template: "start.png" });
  expect(result.warnings.some((item) => item.code === "combined.recognition_pipeline_reference_missing"))
    .toBe(false);
});

test("combined inspection bounds automatic runtime-node MSE correlation", async () => {
  const root = await createCombinedFixture();
  const recognitionEvents = Array.from({ length: 129 }, (_, index) => {
    const node = `Recognition${String(index).padStart(3, "0")}`;
    return event(`2026-07-19 10:01:${String(index % 60).padStart(2, "0")}.${String(index).padStart(3, "0")}`, "Node.Recognition.Failed", {
      name: node,
      reco_details: {
        algorithm: "OCR",
        name: node,
        detail: { all: [{ score: 0.5, text: node }], filtered: [], best: null },
      },
    });
  });
  await writeFile(path.join(root, "maafw.log"), [
    ...failingNodeLog("ZZZFailure"),
    ...recognitionEvents,
  ].join("\n"), "utf8");

  const result = await inspect(root, { mse: { depth: 0, includeReferencers: false } });
  const references = result.evidence
    .filter((item) => item.kind === "combined.recognition_pipeline_reference")
    .map((item) => (item.data as { node?: string } | undefined)?.node);

  expect(result.details.correlation.runtimeNodes).toEqual({
    total: 130,
    selected: 128,
    omitted: 2,
    failureNodes: 1,
    recognitionOnlyNodes: 129,
  });
  expect(result.statistics).toMatchObject({
    mseRuntimeNodes: 130,
    mseRuntimeNodesSelected: 128,
    mseRuntimeNodesOmitted: 2,
  });
  expect(result.details.mse?.details.selection.requestedTasks).toHaveLength(128);
  expect(result.details.mse?.details.selection.requestedTasks).toContain("ZZZFailure");
  expect(references).toHaveLength(127);
  expect(references).toContain("Recognition126");
  expect(references).not.toContain("Recognition127");
  expect(references).not.toContain("Recognition128");
  expect(result.warnings.some((item) => item.code === "combined.runtime_node_resolution_truncated"))
    .toBe(true);
});

test("MLA rejects archives because extraction belongs to the harness", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "mek-archive-"));
  temporaryRoots.push(root);
  const archive = path.join(root, "issue.zip");
  await writeFile(archive, "not a real archive", "utf8");
  await expect(inspectMla(archive)).rejects.toThrow("calling harness");
});
