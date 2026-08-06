import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, expect, test } from "vitest";

import { inspectMla, queryEvidenceWindow, renderText } from "../../src/index.js";
import {
  correlateCycleBlockers,
  countPossibleMirroredTaskGroups,
  countRuntimeSignals,
  cycleCandidateOutcomes,
  cycleExitBlockers,
  cycleExitCandidates,
  findPossibleMirroredTaskGroups,
  focusRuntimeSignals,
  namespaceRuntime,
  summarizeTaskAnomalies,
} from "../../src/mla/engine.js";
import type { MlaRuntimeInspectionResult } from "../../src/mla/translate.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function event(timestamp: string, message: string, details: Record<string, unknown>): string {
  return `[${timestamp}][INF][Px1][Tx2][test] !!!OnEventNotify!!! [handle=1] [msg=${message}] [details=${JSON.stringify(details)}]`;
}

test("extracts source-backed runtime facts and filters them by time", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "mek-mla-"));
  temporaryRoots.push(root);
  const log = path.join(root, "maafw.log");
  await writeFile(log, [
    "[2026-07-19 10:00:00.000][DBG][Px1][Tx1][Logger] MAA Process Start",
    "[2026-07-19 10:00:00.001][DBG][Px1][Tx1][Logger] Version v5.12.2",
    event("2026-07-19 10:01:00.000", "Tasker.Task.Starting", {
      task_id: 1, entry: "First", hash: "h1", uuid: "u1",
    }),
    event("2026-07-19 10:01:01.000", "Node.PipelineNode.Starting", {
      task_id: 1, node_id: 11, name: "FirstNode",
    }),
    event("2026-07-19 10:01:02.000", "Node.PipelineNode.Succeeded", {
      task_id: 1, node_id: 11, name: "FirstNode",
    }),
    event("2026-07-19 10:01:03.000", "Tasker.Task.Succeeded", {
      task_id: 1, entry: "First", hash: "h1", uuid: "u1",
    }),
    event("2026-07-19 11:01:00.000", "Tasker.Task.Starting", {
      task_id: 2, entry: "Second", hash: "h2", uuid: "u2",
    }),
    event("2026-07-19 11:01:01.000", "Node.PipelineNode.Starting", {
      task_id: 2, node_id: 21, name: "SecondNode",
    }),
    event("2026-07-19 11:01:02.000", "Node.PipelineNode.Failed", {
      task_id: 2, node_id: 21, name: "SecondNode",
    }),
    event("2026-07-19 11:01:03.000", "Tasker.Task.Failed", {
      task_id: 2, entry: "Second", hash: "h2", uuid: "u2",
    }),
  ].join("\n"), "utf8");

  const complete = await inspectMla(log);
  const focused = await inspectMla(log, {
    timeRange: { from: "2026-07-19 10:00:00", to: "2026-07-19 10:10:00" },
  });

  expect(complete.details.runtime.sessions[0]?.tasks.map((task) => task.name)).toEqual([
    "First",
    "Second",
  ]);
  expect(focused.details.runtime.sessions[0]?.tasks.map((task) => task.name)).toEqual(["First"]);
  expect(focused.evidence.every((item) => item.source.artifactId === focused.artifacts[0]?.id)).toBe(true);
  expect(focused.evidence.some((item) => item.kind === "mla.task")).toBe(true);
  expect(focused.warnings.some((item) => item.code === "mla_time_window_file_granularity")).toBe(true);
  expect(renderText(focused)).toContain("First: succeeded");
  expect(renderText(focused)).not.toContain("Second: failed");
});

test("reports missing framework log as missing evidence", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "mek-mla-empty-"));
  temporaryRoots.push(root);
  await writeFile(path.join(root, "package.json"), "{}", "utf8");

  const result = await inspectMla(root);

  expect(result.missingEvidence.some((item) => item.code === "maa_framework_log_missing")).toBe(true);
  expect(result.missingEvidence.some((item) => item.code === "mla_evidence_missing")).toBe(true);
  expect(result.evidence).toHaveLength(0);
});


test("extracts aggregated OCR text and TemplateMatch score recognition details", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "mek-mla-recognition-"));
  temporaryRoots.push(root);
  const log = path.join(root, "maafw.log");
  await writeFile(log, [
    "[2026-07-19 10:00:00.000][DBG][Px1][Tx1][Logger] MAA Process Start",
    "[2026-07-19 10:00:00.001][DBG][Px1][Tx1][Logger] Version v5.12.2",
    event("2026-07-19 10:01:00.000", "Node.Recognition.Succeeded", {
      name: "OriginiumOCR",
      task_id: 1,
      reco_details: {
        algorithm: "OCR",
        box: [982, 8, 68, 40],
        name: "OriginiumOCR",
        reco_id: 400000002,
        detail: {
          all: [
            { box: [982, 8, 68, 40], score: 0.99992, text: "292049" },
            { box: [980, 8, 68, 40], score: 0.80, text: "29204g" },
            { box: [978, 8, 68, 40], score: 0.70, text: "292O49" },
            { box: [976, 8, 68, 40], score: 0.60, text: "292049." },
          ],
          filtered: [{ box: [982, 8, 68, 40], score: 0.99992, text: "292049" }],
          best: { box: [982, 8, 68, 40], score: 0.99992, text: "292049" },
        },
      },
    }),
    event("2026-07-19 10:02:00.000", "Node.Recognition.Failed", {
      name: "FindCarryToNextVoucher",
      task_id: 1,
      reco_details: {
        algorithm: "TemplateMatch",
        box: null,
        name: "FindCarryToNextVoucher",
        reco_id: 400000017,
        detail: {
          all: [{ box: [830, 516, 82, 82], score: 0.212474 }],
        },
      },
    }),
    event("2026-07-19 10:03:00.000", "Node.Recognition.Failed", {
      name: "FindCarryToNextVoucher",
      task_id: 1,
      reco_details: {
        algorithm: "TemplateMatch",
        box: null,
        name: "FindCarryToNextVoucher",
        reco_id: 400000023,
        detail: {
          all: [{ box: [830, 333, 82, 82], score: 0.212808 }],
        },
      },
    }),
  ].join("\n"), "utf8");

  const result = await inspectMla(log);
  const recognitionEvidence = result.evidence.filter((item) => item.kind === "mla.recognition_detail");

  expect(recognitionEvidence).toHaveLength(2);
  const ocr = recognitionEvidence.find(
    (item) => (item.data as { node?: string } | undefined)?.node === "OriginiumOCR",
  );
  const template = recognitionEvidence.find(
    (item) => (item.data as { node?: string } | undefined)?.node === "FindCarryToNextVoucher",
  );

  expect(ocr?.data).toMatchObject({
    algorithm: "OCR",
    status: "succeeded",
    occurrenceCount: 1,
    textCounts: [{ text: "292049", count: 1 }],
  });
  expect((ocr?.data as { representatives?: { first?: { text?: string } } } | undefined)?.representatives?.first?.text)
    .toBe("292049");
  const ocrData = ocr?.data as {
    score?: { count?: number };
    textCountSummary?: { observations?: number; unique?: number; returned?: number; truncated?: boolean };
    candidateStages?: {
      all?: { candidateCount?: number; score?: { count?: number }; samples?: Array<{ source?: { line?: number } }>; samplesTruncated?: boolean; textCountSummary?: { observations?: number; unique?: number; returned?: number; truncated?: boolean } };
      filtered?: { candidateCount?: number; score?: { count?: number }; textCountSummary?: { observations?: number } };
      best?: { candidateCount?: number; textCounts?: Array<{ text?: string; count?: number }>; textCountSummary?: { observations?: number } };
    };
  } | undefined;
  expect(ocrData?.score?.count).toBe(1);
  expect(ocrData?.textCountSummary).toEqual({ observations: 1, unique: 1, returned: 1, truncated: false });
  expect(ocrData?.candidateStages?.all).toMatchObject({
    candidateCount: 4,
    score: { count: 4 },
    samplesTruncated: true,
  });
  expect(ocrData?.candidateStages?.all?.samples).toHaveLength(3);
  expect(ocrData?.candidateStages?.all?.samples?.[0]?.source?.line).toBe(3);
  expect(ocrData?.candidateStages?.all?.textCountSummary).toEqual({ observations: 4, unique: 4, returned: 4, truncated: false });
  expect(ocrData?.candidateStages?.filtered).toMatchObject({ candidateCount: 1, score: { count: 1 }, textCountSummary: { observations: 1 } });
  expect(ocrData?.candidateStages?.best).toMatchObject({
    candidateCount: 1,
    textCounts: [{ text: "292049", count: 1 }],
    textCountSummary: { observations: 1 },
  });
  expect(template?.data).toMatchObject({
    algorithm: "TemplateMatch",
    status: "failed",
    occurrenceCount: 2,
  });
  const templateScore = (template?.data as { score?: { count?: number; minimum?: number; maximum?: number } } | undefined)?.score;
  expect(templateScore?.count).toBe(2);
  expect(templateScore?.minimum).toBeCloseTo(0.212474);
  expect(templateScore?.maximum).toBeCloseTo(0.212808);
});

test("bounds high-cardinality OCR text counts without hiding completeness", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "mek-mla-text-counts-"));
  temporaryRoots.push(root);
  const log = path.join(root, "maafw.log");
  const records = Array.from({ length: 80 }, (_, index) => event(
    `2026-07-19 10:01:00.${String(index).padStart(3, "0")}`,
    "Node.Recognition.Succeeded",
    {
      name: "HighCardinalityOCR",
      reco_details: {
        algorithm: "OCR",
        name: "HighCardinalityOCR",
        detail: {
          all: [{ text: index < 10 ? "frequent" : `text-${String(index).padStart(2, "0")}`, score: 0.9 }],
          filtered: [{ text: index < 10 ? "frequent" : `text-${String(index).padStart(2, "0")}`, score: 0.9 }],
          best: { text: index < 10 ? "frequent" : `text-${String(index).padStart(2, "0")}`, score: 0.9 },
        },
      },
    },
  ));
  await writeFile(log, [
    "[2026-07-19 10:00:00.000][DBG][Px1][Tx1][Logger] MAA Process Start",
    "[2026-07-19 10:00:00.001][DBG][Px1][Tx1][Logger] Version v5.12.2",
    ...records,
  ].join("\n"), "utf8");

  const result = await inspectMla(log);
  const item = result.evidence.find((evidence) => evidence.kind === "mla.recognition_detail");
  const data = item?.data as {
    textCounts?: Array<{ text?: string; count?: number }>;
    textCountSummary?: { observations?: number; unique?: number; returned?: number; truncated?: boolean };
    best?: unknown[];
    bestTruncated?: boolean;
    candidateStages?: { all?: { textCounts?: Array<{ text?: string; count?: number }>; textCountSummary?: { observations?: number; unique?: number; returned?: number; truncated?: boolean } } };
  } | undefined;
  expect(data?.textCounts).toHaveLength(64);
  expect(data?.textCounts?.[0]).toEqual({ text: "frequent", count: 10 });
  expect(data?.textCountSummary).toEqual({ observations: 80, unique: 71, returned: 64, truncated: true });
  expect(data?.best).toHaveLength(3);
  expect(data?.bestTruncated).toBe(true);
  expect(data?.candidateStages?.all?.textCounts).toHaveLength(64);
  expect(data?.candidateStages?.all?.textCountSummary).toEqual({ observations: 80, unique: 71, returned: 64, truncated: true });
});

test("extracts bounded action outcomes with source-backed representatives", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "mek-mla-action-"));
  temporaryRoots.push(root);
  const log = path.join(root, "maafw.log");
  const action = (timestamp: string, message: string, success: boolean, point: number[]): string => event(
    timestamp,
    message,
    {
      task_id: 9,
      name: "",
      action_details: {
        action: "Click",
        action_id: 3,
        box: [10, 20, 30, 40],
        detail: { contact: 0, point, pressure: 1 },
        name: "ClickMenu",
        success,
      },
    },
  );
  await writeFile(log, [
    "[2026-07-19 10:00:00.000][DBG][Px1][Tx1][Logger] MAA Process Start",
    "[2026-07-19 10:00:00.001][DBG][Px1][Tx1][Logger] Version v5.12.2",
    action("2026-07-19 10:01:00.000", "Node.Action.Succeeded", true, [20, 30]),
    action("2026-07-19 10:02:00.000", "Node.Action.Succeeded", true, [21, 31]),
    action("2026-07-19 10:03:00.000", "Node.Action.Failed", false, [22, 32]),
  ].join("\n"), "utf8");

  const result = await inspectMla(log);
  const details = result.evidence.filter((item) => item.kind === "mla.action_detail");
  const succeeded = details.find((item) =>
    (item.data as { status?: string } | undefined)?.status === "succeeded"
  );

  expect(details).toHaveLength(2);
  expect(succeeded?.source).toMatchObject({ path: "maafw.log", line: 3, node: "ClickMenu" });
  expect(succeeded?.data).toMatchObject({
    action: "Click",
    node: "ClickMenu",
    status: "succeeded",
    occurrenceCount: 2,
    taskId: 9,
    representatives: {
      first: { detail: { point: [20, 30] }, source: { path: "maafw.log", line: 3 } },
      last: { detail: { point: [21, 31] }, source: { path: "maafw.log", line: 4 } },
    },
  });
  expect(result.statistics.actionOccurrences).toBe(3);
});

test("reports action-detail truncation while preserving complete occurrence counts", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "mek-mla-action-bounded-"));
  temporaryRoots.push(root);
  const log = path.join(root, "maafw.log");
  const actions = Array.from({ length: 501 }, (_, index) => event(
    "2026-07-19 10:01:00.000",
    "Node.Action.Succeeded",
    {
      task_id: index + 1,
      action_details: {
        action: "Click",
        box: [0, 0, 10, 10],
        detail: { point: [index, 0] },
        name: "RepeatedClick",
        success: true,
      },
    },
  ));
  await writeFile(log, [
    "[2026-07-19 10:00:00.000][DBG][Px1][Tx1][Logger] MAA Process Start",
    "[2026-07-19 10:00:00.001][DBG][Px1][Tx1][Logger] Version v5.12.2",
    ...actions,
  ].join("\n"), "utf8");

  const result = await inspectMla(log);
  expect(result.statistics.actionOccurrences).toBe(501);
  expect(result.statistics.actionDetails).toBe(500);
  expect(result.statistics.actionDetailsTotal).toBe(501);
  expect(result.evidence.filter((item) => item.kind === "mla.action_detail")).toHaveLength(500);
  expect(result.warnings.some((item) => item.code === "mla_action_details_truncated")).toBe(true);
});

test("maps recognition details to rotated source files and applies time ranges", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "mek-mla-recognition-sources-"));
  temporaryRoots.push(root);
  const oldLog = path.join(root, "maafw.bak.2026.07.19-10.30.00.000.log");
  const currentLog = path.join(root, "maafw.log");
  const recognition = (time: string, name: string, text: string): string => event(
    time,
    "Node.Recognition.Succeeded",
    {
      name,
      reco_details: {
        algorithm: "OCR",
        box: [0, 0, 10, 10],
        name,
        reco_id: 1,
        detail: { all: [{ box: [0, 0, 10, 10], score: 0.99, text }] },
      },
    },
  );
  await writeFile(oldLog, [
    "[2026-07-19 10:00:00.000][DBG][Px1][Tx1][Logger] MAA Process Start",
    "[2026-07-19 10:00:00.001][DBG][Px1][Tx1][Logger] Version v5.12.2",
    recognition("2026-07-19 10:01:00.000", "OldOCR", "old"),
  ].join("\n"), "utf8");
  await writeFile(currentLog, [
    "[2026-07-19 11:00:00.000][DBG][Px1][Tx1][Logger] MAA Process Start",
    "[2026-07-19 11:00:00.001][DBG][Px1][Tx1][Logger] Version v5.12.2",
    recognition("2026-07-19 11:01:00.000", "CurrentOCR", "current"),
  ].join("\n"), "utf8");

  const complete = await inspectMla(root);
  const completeDetails = complete.evidence.filter((item) => item.kind === "mla.recognition_detail");
  const byNode = new Map(
    completeDetails.map((item) => [(item.data as { node?: string } | undefined)?.node, item]),
  );
  expect(byNode.get("OldOCR")?.source).toMatchObject({
    path: path.basename(oldLog),
    line: 3,
  });
  expect(byNode.get("CurrentOCR")?.source).toMatchObject({
    path: path.basename(currentLog),
    line: 3,
  });
  expect((byNode.get("CurrentOCR")?.data as {
    representatives?: { first?: { source?: { path?: string; line?: number } } };
  } | undefined)?.representatives?.first?.source).toMatchObject({
    path: path.basename(currentLog),
    line: 3,
  });
  const currentEvidence = byNode.get("CurrentOCR");
  expect(currentEvidence).toBeDefined();
  if (currentEvidence !== undefined) {
    const window = await queryEvidenceWindow(complete, {
      evidenceId: currentEvidence.id,
      before: 0,
      after: 0,
    });
    expect(window.path).toBe(path.basename(currentLog));
    expect(window.text).toContain("CurrentOCR");
  }

  const focused = await inspectMla(root, {
    timeRange: { from: "2026-07-19 11:00:00", to: "2026-07-19 11:10:00" },
  });
  const focusedNodes = focused.evidence
    .filter((item) => item.kind === "mla.recognition_detail")
    .map((item) => (item.data as { node?: string } | undefined)?.node);
  expect(focusedNodes).toEqual(["CurrentOCR"]);
});


test("extracts recognition detail generically across algorithms", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "mek-mla-recognition-generic-"));
  temporaryRoots.push(root);
  const log = path.join(root, "maafw.log");
  const recoEvent = (
    time: string,
    message: string,
    recoDetails: Record<string, unknown>,
    name: string,
  ): string => event(time, message, { name, reco_details: recoDetails });
  await writeFile(log, [
    "[2026-07-19 10:00:00.000][DBG][Px1][Tx1][Logger] MAA Process Start",
    "[2026-07-19 10:00:00.001][DBG][Px1][Tx1][Logger] Version v5.12.2",
    recoEvent("2026-07-19 10:01:00.000", "Node.Recognition.Succeeded", {
      algorithm: "TemplateMatch",
      box: [0, 0, 10, 10],
      name: "TemplateOk",
      reco_id: 1,
      detail: {
        all: [{ box: [0, 0, 10, 10], score: 0.998994 }],
        best: { box: [0, 0, 10, 10], score: 0.998994 },
        filtered: [{ box: [0, 0, 10, 10], score: 0.998994 }],
      },
    }, "TemplateOk"),
    recoEvent("2026-07-19 10:02:00.000", "Node.Recognition.Succeeded", {
      algorithm: "ColorMatch",
      box: [0, 0, 10, 10],
      name: "ColorOk",
      reco_id: 2,
      detail: {
        all: [{ box: [0, 0, 10, 10], count: 964 }],
        best: { box: [0, 0, 10, 10], count: 964 },
        filtered: [{ box: [0, 0, 10, 10], count: 964 }],
      },
    }, "ColorOk"),
    recoEvent("2026-07-19 10:03:00.000", "Node.Recognition.Succeeded", {
      algorithm: "Or",
      box: null,
      name: "OrNode",
      reco_id: 3,
      detail: [{
        algorithm: "ColorMatch",
        box: [0, 0, 10, 10],
        name: "OrChild",
        reco_id: 4,
        detail: {
          all: [{ box: [0, 0, 10, 10], count: 964 }],
          best: { box: [0, 0, 10, 10], count: 964 },
          filtered: [{ box: [0, 0, 10, 10], count: 964 }],
        },
      }],
    }, "OrNode"),
    recoEvent("2026-07-19 10:04:00.000", "Node.Recognition.Succeeded", {
      algorithm: "DirectHit",
      box: [0, 0, 10, 10],
      name: "DirectOk",
      reco_id: 5,
      detail: null,
    }, "DirectOk"),
    recoEvent("2026-07-19 10:05:00.000", "Node.Recognition.Succeeded", {
      algorithm: "Or",
      box: [0, 0, 10, 10],
      name: "NestedOr",
      reco_id: 6,
      detail: [{
        algorithm: "And",
        box: [0, 0, 10, 10],
        name: "WeeklyByNew",
        reco_id: 7,
        detail: [{
          algorithm: "OCR",
          box: [0, 0, 10, 10],
          name: "RecognitionNew",
          reco_id: 8,
          detail: {
            all: [{ box: [0, 0, 10, 10], score: 0.99, text: "NEW" }],
            filtered: [{ box: [0, 0, 10, 10], score: 0.99, text: "NEW" }],
            best: { box: [0, 0, 10, 10], score: 0.99, text: "NEW" },
          },
        }, {
          algorithm: "OCR",
          box: [10, 10, 20, 20],
          name: "WeeklyText",
          reco_id: 9,
          detail: {
            all: [{ box: [10, 10, 20, 20], score: 0.999, text: "周任务" }],
            filtered: [{ box: [10, 10, 20, 20], score: 0.999, text: "周任务" }],
            best: { box: [10, 10, 20, 20], score: 0.999, text: "周任务" },
          },
        }],
      }],
    }, "NestedOr"),
    recoEvent("2026-07-19 10:06:00.000", "Node.Recognition.Succeeded", {
      algorithm: "Or",
      box: [0, 0, 10, 10],
      name: "WideOr",
      reco_id: 10,
      detail: Array.from({ length: 17 }, (_, index) => ({
        algorithm: "OCR",
        box: [0, 0, 10, 10],
        name: `Leaf${index}`,
        reco_id: 11 + index,
        detail: {
          all: [{ box: [0, 0, 10, 10], score: 0.9, text: `text-${index}` }],
          filtered: [{ box: [0, 0, 10, 10], score: 0.9, text: `text-${index}` }],
          best: { box: [0, 0, 10, 10], score: 0.9, text: `text-${index}` },
        },
      })),
    }, "WideOr"),
  ].join("\n"), "utf8");

  const result = await inspectMla(log);
  const recognitionEvidence = result.evidence.filter((item) => item.kind === "mla.recognition_detail");
  const byNode = new Map(
    recognitionEvidence.map((item) => [(item.data as { node?: string } | undefined)?.node, item]),
  );
  const templateData = byNode.get("TemplateOk")?.data as {
    detailShape?: string;
    candidateCounts?: { filtered?: { average?: number }; all?: { average?: number } };
    candidateStages?: { all?: { score?: { count?: number } }; filtered?: { score?: { count?: number } }; best?: { score?: { count?: number } } };
    best?: Array<{ score?: number }>;
    score?: { count?: number };
  } | undefined;
  const colorData = byNode.get("ColorOk")?.data as { detailShape?: string; best?: Array<{ count?: number }>; score?: { count?: number } } | undefined;
  const orData = byNode.get("OrNode")?.data as {
    detailShape?: string;
    childRecognition?: Array<{ name?: string | null; algorithm?: string | null; occurrenceCount?: number }>;
    childRecognitionTotal?: number;
    childRecognitionTruncated?: boolean;
  } | undefined;
  const nestedData = byNode.get("NestedOr")?.data as {
    descendantRecognition?: Array<{ path?: string[]; algorithm?: string | null; best?: Array<{ text?: string; source?: { path?: string; line?: number } }> }>;
    descendantRecognitionTruncated?: boolean;
  } | undefined;
  const wideData = byNode.get("WideOr")?.data as {
    childRecognition?: Array<{ name?: string | null }>;
    childRecognitionTotal?: number;
    childRecognitionTruncated?: boolean;
    descendantRecognition?: unknown[];
    descendantRecognitionTruncated?: boolean;
  } | undefined;

  expect(byNode.has("DirectOk")).toBe(false);
  expect(templateData?.detailShape).toBe("candidate_list");
  expect(templateData?.candidateCounts?.filtered?.average).toBe(1);
  expect(templateData?.best?.[0]?.score).toBeCloseTo(0.998994);
  expect(templateData?.score?.count).toBe(1);
  expect(templateData?.candidateStages?.all?.score?.count).toBe(1);
  expect(templateData?.candidateStages?.filtered?.score?.count).toBe(1);
  expect(templateData?.candidateStages?.best?.score?.count).toBe(1);
  expect(colorData?.detailShape).toBe("candidate_list");
  expect(colorData?.best?.[0]?.count).toBe(964);
  expect(colorData?.score).toBeNull();
  expect(orData?.detailShape).toBe("child_array");
  expect(orData?.childRecognition?.[0]).toMatchObject({
    name: "OrChild",
    algorithm: "ColorMatch",
    occurrenceCount: 1,
  });
  expect(orData?.childRecognitionTotal).toBe(1);
  expect(orData?.childRecognitionTruncated).toBe(false);
  expect(nestedData?.descendantRecognition).toEqual([
    expect.objectContaining({
      path: ["WeeklyByNew", "RecognitionNew"],
      algorithm: "OCR",
      best: [expect.objectContaining({
        text: "NEW",
        source: expect.objectContaining({ path: "maafw.log", line: 7 }),
      })],
    }),
    expect.objectContaining({
      path: ["WeeklyByNew", "WeeklyText"],
      algorithm: "OCR",
      best: [expect.objectContaining({ text: "周任务" })],
    }),
  ]);
  expect(nestedData?.descendantRecognitionTruncated).toBe(false);
  expect(wideData?.descendantRecognition).toHaveLength(16);
  expect(wideData?.descendantRecognitionTruncated).toBe(true);
  expect(wideData?.childRecognition).toHaveLength(8);
  expect(wideData?.childRecognitionTotal).toBe(17);
  expect(wideData?.childRecognitionTruncated).toBe(true);
});

test("inspectMla exposes complete signal totals alongside focused selection", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "mek-mla-counts-"));
  temporaryRoots.push(root);
  const log = path.join(root, "maafw.log");
  const recognition = (time: string, taskId: number, name: string): string => event(time, "Node.Recognition.Succeeded", {
    name,
    task_id: taskId,
    reco_details: {
      algorithm: "OCR",
      box: [0, 0, 10, 10],
      name,
      reco_id: taskId * 100,
      detail: { all: [{ box: [0, 0, 10, 10], score: 0.9, text: "hello" }] },
    },
  });
  await writeFile(log, [
    "[2026-07-19 10:00:00.000][DBG][Px1][Tx1][Logger] MAA Process Start",
    "[2026-07-19 10:00:00.001][DBG][Px1][Tx1][Logger] Version v5.12.2",
    event("2026-07-19 10:01:00.000", "Tasker.Task.Starting", { task_id: 1, entry: "First", hash: "h1", uuid: "u1" }),
    event("2026-07-19 10:01:01.000", "Node.PipelineNode.Starting", { task_id: 1, node_id: 11, name: "First" }),
    recognition("2026-07-19 10:01:02.000", 1, "First"),
    event("2026-07-19 10:01:03.000", "Node.PipelineNode.Succeeded", { task_id: 1, node_id: 11, name: "First" }),
    event("2026-07-19 10:01:04.000", "Tasker.Task.Succeeded", { task_id: 1, entry: "First", hash: "h1", uuid: "u1" }),
    event("2026-07-19 10:02:00.000", "Tasker.Task.Starting", { task_id: 2, entry: "Second", hash: "h2", uuid: "u2" }),
    event("2026-07-19 10:02:01.000", "Node.PipelineNode.Starting", { task_id: 2, node_id: 21, name: "Second" }),
    recognition("2026-07-19 10:02:02.000", 2, "Second"),
    event("2026-07-19 10:02:03.000", "Node.PipelineNode.Succeeded", { task_id: 2, node_id: 21, name: "Second" }),
    event("2026-07-19 10:02:04.000", "Tasker.Task.Succeeded", { task_id: 2, entry: "Second", hash: "h2", uuid: "u2" }),
  ].join("\n"), "utf8");

  const result = await inspectMla(log);
  const signalsTotal = result.statistics.signalsTotal ?? 0;
  const signals = result.statistics.signals ?? 0;
  const recognitionOccurrences = result.statistics.recognitionOccurrences ?? 0;
  const recognitionOccurrencesFocused = result.statistics.recognitionOccurrencesFocused ?? 0;
  const repeatedNodeTotal = result.statistics.repeatedNodeTotalRepeatCount ?? 0;
  const repeatedNodeTotalFocused = result.statistics.repeatedNodeTotalRepeatCountFocused ?? 0;
  expect(signalsTotal).toBeGreaterThanOrEqual(signals);
  expect(recognitionOccurrences).toBeGreaterThanOrEqual(recognitionOccurrencesFocused);
  expect(repeatedNodeTotal).toBeGreaterThanOrEqual(repeatedNodeTotalFocused);
  expect(result.statistics.recognitionOccurrences).toBeDefined();
});

test("selects and merges independent log bundles from a project directory", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "mek-mla-project-"));
  temporaryRoots.push(root);
  const debug = path.join(root, "debug");
  await mkdir(path.join(root, "node_modules", "unrelated"), { recursive: true });
  await mkdir(debug);
  await writeFile(path.join(root, "package.json"), "{}", "utf8");
  const logWithTask = (time: string, taskName: string, taskId: number): string => [
    `[2026-07-19 ${time}:00.000][DBG][Px1][Tx1][Logger] MAA Process Start`,
    `[2026-07-19 ${time}:00.001][DBG][Px1][Tx1][Logger] Version v5.12.2`,
    event(`2026-07-19 ${time}:01.000`, "Tasker.Task.Starting", {
      task_id: taskId, entry: taskName, hash: `h${taskId}`, uuid: `u${taskId}`,
    }),
    event(`2026-07-19 ${time}:02.000`, "Tasker.Task.Succeeded", {
      task_id: taskId, entry: taskName, hash: `h${taskId}`, uuid: `u${taskId}`,
    }),
  ].join("\n");
  await writeFile(path.join(root, "maafw.log"), logWithTask("10:00", "RootTask", 1), "utf8");
  await writeFile(
    path.join(debug, "maafw.bak.2026.07.19-09.00.00.000.log"),
    logWithTask("09:00", "RotatedTask", 1),
    "utf8",
  );
  await writeFile(path.join(debug, "maafw.log"), logWithTask("11:00", "DebugTask", 1), "utf8");

  const result = await inspectMla(root);
  const focused = await inspectMla(root, {
    timeRange: { from: "2026-07-19 10:50:00", to: "2026-07-19 11:10:00" },
  });
  const tasks = result.details.runtime.sessions.flatMap((session) => session.tasks.map((task) => task.name));
  const sessionIds = result.details.runtime.sessions.map((session) => session.session_id);
  const artifactIds = new Set(result.artifacts.map((artifact) => artifact.id));

  expect(result.details.selection.loadingGranularity).toBe("multiple_bundles");
  expect(result.details.selection.targets).toEqual([
    "maafw.log",
    "debug",
    "debug/maafw.bak.2026.07.19-09.00.00.000.log",
  ]);
  expect(tasks).toEqual(expect.arrayContaining(["RootTask", "RotatedTask", "DebugTask"]));
  expect(new Set(sessionIds).size).toBe(sessionIds.length);
  expect(result.evidence.every((item) => artifactIds.has(item.source.artifactId))).toBe(true);
  expect(result.artifacts.filter((artifact) => artifact.status === "selected")).toHaveLength(3);
  expect(focused.details.selection.targets).toEqual(["debug"]);
  expect(focused.details.runtime.sessions.flatMap((session) => session.tasks.map((task) => task.name)))
    .toEqual(["DebugTask"]);
  expect(focused.artifacts.filter((artifact) => artifact.status === "selected").map((artifact) => artifact.relativePath))
    .toEqual(["debug/maafw.log"]);
  expect(focused.missingEvidence.some((item) => item.code === "mla_target_empty")).toBe(false);
});

test("correlates standard MaaFramework error images with failures from rotated logs", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "mek-mla-rotated-image-"));
  temporaryRoots.push(root);
  const onError = path.join(root, "on_error");
  await mkdir(onError);
  await writeFile(path.join(root, "package.json"), "{}", "utf8");
  const actionDetails = {
    action: "Click",
    action_id: 12,
    box: [0, 0, 10, 10],
    detail: {},
    name: "GenericNode",
    success: false,
  };
  await writeFile(path.join(root, "maafw.bak.2026.07.19-10.00.00.000.log"), [
    "[2026-07-19 10:00:00.000][DBG][Px1][Tx1][Logger] MAA Process Start",
    "[2026-07-19 10:00:00.001][DBG][Px1][Tx1][Logger] Version v5.12.2",
    event("2026-07-19 10:01:00.000", "Tasker.Task.Starting", {
      task_id: 1, entry: "GenericTask", hash: "hash", uuid: "uuid",
    }),
    event("2026-07-19 10:01:01.000", "Node.PipelineNode.Starting", {
      task_id: 1, node_id: 11, name: "GenericTask",
    }),
    event("2026-07-19 10:01:01.100", "Node.NextList.Starting", {
      focus: null, list: [{ anchor: false, jump_back: false, name: "GenericNode" }],
      name: "GenericTask", task_id: 1,
    }),
    event("2026-07-19 10:01:01.200", "Node.Recognition.Starting", {
      focus: null, name: "GenericNode", reco_id: 21, task_id: 1,
    }),
    event("2026-07-19 10:01:01.300", "Node.Recognition.Succeeded", {
      focus: null,
      name: "GenericNode",
      reco_details: {
        algorithm: "DirectHit", box: [0, 0, 10, 10], detail: null, name: "GenericNode", reco_id: 21,
      },
      reco_id: 21,
      task_id: 1,
    }),
    event("2026-07-19 10:01:01.400", "Node.NextList.Succeeded", {
      focus: null, list: [{ anchor: false, jump_back: false, name: "GenericNode" }],
      name: "GenericTask", task_id: 1,
    }),
    event("2026-07-19 10:01:01.500", "Node.Action.Starting", {
      action_id: 12, focus: null, name: "GenericNode", task_id: 1,
    }),
    event("2026-07-19 10:01:02.000", "Node.Action.Failed", {
      action_details: actionDetails, action_id: 12, focus: null, name: "GenericNode", task_id: 1,
    }),
    event("2026-07-19 10:01:02.001", "Node.PipelineNode.Failed", {
      action_details: actionDetails,
      focus: null,
      name: "GenericTask",
      node_details: { action_id: 12, completed: false, name: "GenericNode", node_id: 11, reco_id: 21 },
      node_id: 11,
      reco_details: {
        algorithm: "DirectHit", box: [0, 0, 10, 10], detail: null, name: "GenericNode", reco_id: 21,
      },
      task_id: 1,
    }),
    event("2026-07-19 10:01:03.000", "Tasker.Task.Failed", {
      task_id: 1, entry: "GenericTask", hash: "hash", uuid: "uuid",
    }),
  ].join("\n"), "utf8");
  const imagePath = path.join(onError, "2026.07.19-10.01.02.001_GenericNode.png");
  await writeFile(imagePath, new Uint8Array());

  const result = await inspectMla(root);
  const failure = result.details.runtime.failures[0];
  const image = result.artifacts.find((artifact) => artifact.path === imagePath);
  const failureImage = result.evidence.find((item) => item.kind === "mla.failure_image");

  expect(failure?.error_images).toEqual([`file:${imagePath.replaceAll("\\", "/")}`]);
  expect(image?.status).toBe("selected");
  expect(failureImage?.source.artifactId).toBe(image?.id);
  expect(failureImage?.data).toMatchObject({ imagePath: imagePath.replaceAll("\\", "/"), kind: "error" });
});

test("namespaces every task-to-signal reference together with its signal", () => {
  const position = {
    timestamp: "2026-07-19 10:00:00.000",
    source: "file:maafw.log",
    path: "maafw.log",
    local_line: 1,
  };
  const runtime = {
    schema_version: "mla-runtime-inspection/v1",
    sessions: [{
      session_id: "session:1",
      start_kind: "process_start",
      framework_status: "resolved",
      framework_version: "v5.12.2",
      versions: ["v5.12.2"],
      start: { source: "file:maafw.log", path: "maafw.log", line: 1, timestamp: position.timestamp },
      end: { source: "file:maafw.log", path: "maafw.log", line: 2, timestamp: position.timestamp },
      tasks: [{
        execution_id: "execution:1",
        task_id: 1,
        name: "GenericTask",
        hash: "hash",
        uuid: "uuid",
        status: "failed",
        completeness: "complete",
        started_at: position.timestamp,
        ended_at: position.timestamp,
        observed_duration_ms: 1,
        first_node: "NodeA",
        last_node: "NodeA",
        statistics: {
          node_executions: 1,
          succeeded_nodes: 0,
          failed_nodes: 1,
          running_nodes: 0,
          recognition_attempts: 0,
          unsuccessful_recognition_attempts: 0,
          node_executions_with_recognition: 0,
          node_executions_with_mixed_recognition_results: 0,
          recognition_activity_groups: 0,
          maximum_recognition_attempts_per_node: 0,
          maximum_unsuccessful_recognition_attempts_per_node: 0,
          action_attempts: 0,
          action_failures: 0,
          next_list_timeouts: 0,
          error_image_references: 0,
          unique_error_images: 0,
          vision_image_references: 0,
          unique_vision_images: 0,
        },
        direct_failure_ids: [],
        outcome_ids: [],
        signal_ids: ["signal:1"],
        signal_highlights: {
          recognition_activity: [],
          repetitions: ["signal:1"],
        },
        evidence: { start: position, end: position },
      }],
      summary: {
        task_executions: 1,
        succeeded_tasks: 0,
        failed_tasks: 1,
        running_tasks: 0,
        direct_failures: 0,
        next_list_timeouts: 0,
        action_failures: 0,
        signals: 1,
      },
    }],
    unscoped_tasks: [],
    failures: [],
    outcomes: [],
    signals: [{
      session_id: "session:1",
      execution_id: "execution:1",
      task_id: 1,
      task_name: "GenericTask",
      signal_id: "signal:1",
      kind: "repeated_node",
      pattern: ["NodeA"],
      segment_count: 1,
      total_repeat_count: 3,
      maximum_repeat_count: 3,
      duration_ms: { count: 1, minimum: 1, p50: 1, p95: 1, maximum: 1, average: 1 },
      terminations: { left_pattern: 0, task_ended: 1, still_repeating_at_log_end: 0 },
      representatives: {
        first: {
          pattern: ["NodeA"], first_seen_at: position.timestamp, last_seen_at: position.timestamp,
          repeat_count: 3, duration_ms: 1, termination: "task_ended", evidence: position,
        },
        longest: {
          pattern: ["NodeA"], first_seen_at: position.timestamp, last_seen_at: position.timestamp,
          repeat_count: 3, duration_ms: 1, termination: "task_ended", evidence: position,
        },
        last: {
          pattern: ["NodeA"], first_seen_at: position.timestamp, last_seen_at: position.timestamp,
          repeat_count: 3, duration_ms: 1, termination: "task_ended", evidence: position,
        },
      },
      detector: {
        name: "repeated-completed-node-sequence", version: 1, minimum_repeats: 3, maximum_pattern_length: 8,
      },
      priority: "high",
      priority_reasons: ["high_repeat_count"],
    }],
    warnings: [],
  } satisfies MlaRuntimeInspectionResult;

  const namespaced = namespaceRuntime(runtime, "bundle");
  const task = namespaced.sessions[0]?.tasks[0];

  expect(namespaced.signals[0]?.signal_id).toBe("bundle:signal:1");
  expect(task?.signal_ids).toEqual(["bundle:signal:1"]);
  expect(task?.signal_highlights.repetitions).toEqual(["bundle:signal:1"]);

  const session = namespaced.sessions[0];
  const firstSignal = namespaced.signals[0];
  if (session === undefined || task === undefined || firstSignal === undefined) {
    throw new Error("Expected the runtime fixture to contain one session, task, and signal.");
  }
  const highlighted = { ...firstSignal, priority: "low" as const, priority_reasons: [] };
  const high = {
    ...firstSignal,
    signal_id: "bundle:signal:2",
    priority: "high" as const,
    priority_reasons: ["related_to_direct_failure" as const],
  };
  const ordinary = {
    ...firstSignal,
    signal_id: "bundle:signal:3",
    priority: "low" as const,
    priority_reasons: [],
  };
  const completeRuntime: MlaRuntimeInspectionResult = {
    ...namespaced,
    sessions: [{
      ...session,
      tasks: [{ ...task, signal_ids: [highlighted.signal_id, high.signal_id, ordinary.signal_id] }],
      summary: { ...session.summary, signals: 3 },
    }],
    signals: [highlighted, high, ordinary],
  };

  const focused = focusRuntimeSignals(completeRuntime, false);
  const exhaustive = focusRuntimeSignals(completeRuntime, true);

  expect(focused.selection).toEqual({ mode: "focused", total: 3, selected: 2 });
  expect(focused.runtime.signals.map((signal) => signal.signal_id)).toEqual([
    "bundle:signal:1",
    "bundle:signal:2",
  ]);
  expect(focused.runtime.sessions[0]?.tasks[0]?.signal_ids).toEqual([
    "bundle:signal:1",
    "bundle:signal:2",
  ]);
  expect(focused.runtime.sessions[0]?.summary.signals).toBe(2);
  expect(exhaustive.selection).toEqual({ mode: "all", total: 3, selected: 3 });
  expect(countRuntimeSignals(completeRuntime)).toEqual({
    total: 3,
    recognitionOccurrences: 0,
    repeatedNodeSegments: 3,
    repeatedNodeTotalRepeatCount: 9,
  });
  expect(countRuntimeSignals(focused.runtime)).toEqual({
    total: 2,
    recognitionOccurrences: 0,
    repeatedNodeSegments: 2,
    repeatedNodeTotalRepeatCount: 6,
  });

  const mirrored: MlaRuntimeInspectionResult = {
    ...completeRuntime,
    sessions: [
      completeRuntime.sessions[0] as MlaRuntimeInspectionResult["sessions"][number],
      {
        ...(completeRuntime.sessions[0] as MlaRuntimeInspectionResult["sessions"][number]),
        session_id: "other:session:1",
        tasks: [{
          ...(completeRuntime.sessions[0]?.tasks[0] as MlaRuntimeInspectionResult["sessions"][number]["tasks"][number]),
          execution_id: "other:execution:1",
        }],
      },
    ],
  };
  expect(countPossibleMirroredTaskGroups(mirrored)).toBe(1);
  const mirroredGroups = findPossibleMirroredTaskGroups(mirrored);
  expect(mirroredGroups).toHaveLength(1);
  expect(mirroredGroups[0]).toMatchObject({
    fingerprint: {
      taskId: 1,
      name: "GenericTask",
      hash: "hash",
      uuid: "uuid",
      status: "failed",
    },
    memberCount: 2,
    namespaces: ["bundle", "other"],
  });
  expect(mirroredGroups[0]?.members.map((member) => member.executionId)).toEqual([
    "bundle:execution:1",
    "other:execution:1",
  ]);
  const repeatedWithinOneTarget: MlaRuntimeInspectionResult = {
    ...mirrored,
    sessions: mirrored.sessions.map((item, index) => index === 0
      ? item
      : {
        ...item,
        tasks: item.tasks.map((repeatedTask) => ({
          ...repeatedTask,
          execution_id: "bundle:execution:2",
        })),
      }),
  };
  expect(countPossibleMirroredTaskGroups(repeatedWithinOneTarget)).toBe(0);
});

test("emits structured evidence for possible mirrored tasks across log targets", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "mek-mla-mirrored-"));
  temporaryRoots.push(root);
  const mirror = path.join(root, "mirror");
  await mkdir(mirror);
  await writeFile(path.join(root, "package.json"), "{}", "utf8");
  const log = (): string => [
    "[2026-07-19 10:00:00.000][DBG][Px1][Tx1][Logger] MAA Process Start",
    "[2026-07-19 10:00:00.001][DBG][Px1][Tx1][Logger] Version v5.12.2",
    event("2026-07-19 10:01:00.000", "Tasker.Task.Starting", {
      task_id: 7, entry: "MirrorTask", hash: "mirror-hash", uuid: "mirror-uuid",
    }),
    event("2026-07-19 10:01:01.000", "Tasker.Task.Succeeded", {
      task_id: 7, entry: "MirrorTask", hash: "mirror-hash", uuid: "mirror-uuid",
    }),
  ].join("\n");
  await writeFile(path.join(root, "maafw.log"), log(), "utf8");
  await writeFile(path.join(mirror, "maafw.log"), log(), "utf8");

  const result = await inspectMla(root);
  const evidence = result.evidence.filter((item) => item.kind === "mla.possible_mirrored_task_group");
  const data = evidence[0]?.data as {
    fingerprint?: { name?: string; taskId?: number; hash?: string; uuid?: string };
    namespaces?: string[];
    memberCount?: number;
    members?: Array<{
      executionId?: string;
      namespace?: string;
      source?: { start?: { path?: string; line?: number }; end?: { path?: string; line?: number } };
    }>;
  } | undefined;

  expect(evidence).toHaveLength(1);
  expect(result.statistics.possibleMirroredTaskGroups).toBe(1);
  expect(result.warnings.some((item) => item.code === "mla_possible_mirrored_tasks")).toBe(true);
  expect(data?.fingerprint).toEqual({
    name: "MirrorTask",
    taskId: 7,
    hash: "mirror-hash",
    uuid: "mirror-uuid",
    status: "succeeded",
    startedAt: "2026-07-19 10:01:00.000",
    endedAt: "2026-07-19 10:01:01.000",
  });
  expect(data?.namespaces).toHaveLength(2);
  expect(data?.memberCount).toBe(2);
  expect(data?.members).toHaveLength(2);
  expect(new Set(data?.members?.map((member) => member.executionId)).size).toBe(2);
  expect(data?.members?.every((member) => member.namespace !== undefined)).toBe(true);
  expect(data?.members?.every((member) => member.source?.start?.line === 3)).toBe(true);
  expect(data?.members?.every((member) => member.source?.end?.line === 4)).toBe(true);
  expect(data?.members?.map((member) => member.source?.start?.path)).toEqual([
    "maafw.log",
    "mirror/maafw.log",
  ]);
});

test("summarizes anomalies for succeeded tasks with timeouts, action failures, or endless repetition", () => {
  const position = {
    timestamp: "2026-07-19 10:00:00.000",
    source: "file:maafw.log",
    path: "maafw.log",
    local_line: 1,
  };
  const baseStatistics = {
    node_executions: 1,
    succeeded_nodes: 1,
    failed_nodes: 0,
    running_nodes: 0,
    recognition_attempts: 0,
    unsuccessful_recognition_attempts: 0,
    node_executions_with_recognition: 0,
    node_executions_with_mixed_recognition_results: 0,
    recognition_activity_groups: 0,
    maximum_recognition_attempts_per_node: 0,
    maximum_unsuccessful_recognition_attempts_per_node: 0,
    action_attempts: 0,
    action_failures: 0,
    next_list_timeouts: 0,
    error_image_references: 0,
    unique_error_images: 0,
    vision_image_references: 0,
    unique_vision_images: 0,
  };
  const makeTask = (
    executionId: string,
    taskId: number,
    statistics: typeof baseStatistics,
    signalIds: string[] = [],
  ): MlaRuntimeInspectionResult["sessions"][number]["tasks"][number] => ({
    execution_id: executionId,
    task_id: taskId,
    name: `Task${taskId}`,
    hash: `hash${taskId}`,
    uuid: `uuid${taskId}`,
    status: "succeeded",
    completeness: "complete",
    started_at: position.timestamp,
    ended_at: position.timestamp,
    observed_duration_ms: 1,
    first_node: "NodeA",
    last_node: "NodeA",
    statistics,
    direct_failure_ids: [],
    outcome_ids: [],
    signal_ids: signalIds,
    signal_highlights: { recognition_activity: [], repetitions: signalIds },
    evidence: { start: position, end: position },
  });
  const runtime: MlaRuntimeInspectionResult = {
    schema_version: "mla-runtime-inspection/v1",
    sessions: [{
      session_id: "session:1",
      start_kind: "process_start",
      framework_status: "resolved",
      framework_version: "v5.12.2",
      versions: ["v5.12.2"],
      start: { source: "file:maafw.log", path: "maafw.log", line: 1, timestamp: position.timestamp },
      end: { source: "file:maafw.log", path: "maafw.log", line: 2, timestamp: position.timestamp },
      tasks: [
        makeTask("execution:1", 1, { ...baseStatistics, next_list_timeouts: 2, action_failures: 1 }),
        makeTask("execution:2", 2, baseStatistics, ["repeat:1"]),
        makeTask("execution:3", 3, baseStatistics),
      ],
      summary: {
        task_executions: 3,
        succeeded_tasks: 3,
        failed_tasks: 0,
        running_tasks: 0,
        direct_failures: 0,
        next_list_timeouts: 2,
        action_failures: 1,
        signals: 1,
      },
    }],
    unscoped_tasks: [],
    failures: [],
    outcomes: [],
    signals: [{
      session_id: "session:1",
      execution_id: "execution:2",
      task_id: 2,
      task_name: "Task2",
      signal_id: "repeat:1",
      kind: "repeated_node",
      pattern: ["NodeA"],
      segment_count: 1,
      total_repeat_count: 5,
      maximum_repeat_count: 5,
      duration_ms: { count: 1, minimum: 1, p50: 1, p95: 1, maximum: 1, average: 1 },
      terminations: { left_pattern: 0, task_ended: 0, still_repeating_at_log_end: 1 },
      representatives: {
        first: {
          pattern: ["NodeA"], first_seen_at: position.timestamp, last_seen_at: position.timestamp,
          repeat_count: 5, duration_ms: 1, termination: "still_repeating_at_log_end", evidence: position,
        },
        longest: {
          pattern: ["NodeA"], first_seen_at: position.timestamp, last_seen_at: position.timestamp,
          repeat_count: 5, duration_ms: 1, termination: "still_repeating_at_log_end", evidence: position,
        },
        last: {
          pattern: ["NodeA"], first_seen_at: position.timestamp, last_seen_at: position.timestamp,
          repeat_count: 5, duration_ms: 1, termination: "still_repeating_at_log_end", evidence: position,
        },
      },
      detector: {
        name: "repeated-completed-node-sequence", version: 1, minimum_repeats: 3, maximum_pattern_length: 8,
      },
      priority: "high",
      priority_reasons: ["still_repeating_at_log_end"],
    }],
    warnings: [],
  };

  const anomalies = summarizeTaskAnomalies(runtime);

  expect(anomalies).toHaveLength(1);
  expect(anomalies[0]).toMatchObject({
    executionId: "execution:1",
    taskName: "Task1",
    status: "succeeded",
    observed: ["next_list_timeout", "action_failure"],
    nextListTimeouts: 2,
    actionFailures: 1,
    stillRepeatingAtLogEnd: 0,
  });
});
test("flags cycle candidates whose evaluations all failed in task anomalies", () => {
  const position = {
    timestamp: "2026-07-19 10:00:00.000",
    source: "file:maafw.log",
    path: "maafw.log",
    local_line: 1,
  };
  const baseStatistics = {
    node_executions: 1,
    succeeded_nodes: 1,
    failed_nodes: 0,
    running_nodes: 0,
    recognition_attempts: 0,
    unsuccessful_recognition_attempts: 0,
    node_executions_with_recognition: 0,
    node_executions_with_mixed_recognition_results: 0,
    recognition_activity_groups: 0,
    maximum_recognition_attempts_per_node: 0,
    maximum_unsuccessful_recognition_attempts_per_node: 0,
    action_attempts: 0,
    action_failures: 0,
    next_list_timeouts: 0,
    error_image_references: 0,
    unique_error_images: 0,
    vision_image_references: 0,
    unique_vision_images: 0,
  };
  const repeated = {
    session_id: "session:1",
    execution_id: "execution:1",
    task_id: 1,
    task_name: "Task1",
    signal_id: "repeat:1",
    kind: "repeated_node" as const,
    pattern: ["NodeA"],
    segment_count: 1,
    total_repeat_count: 5,
    maximum_repeat_count: 5,
    duration_ms: { count: 1, minimum: 1, p50: 1, p95: 1, maximum: 1, average: 1 },
    terminations: { left_pattern: 0, task_ended: 0, still_repeating_at_log_end: 0 },
    representatives: {
      first: {
        pattern: ["NodeA"], first_seen_at: position.timestamp, last_seen_at: position.timestamp,
        repeat_count: 5, duration_ms: 1, termination: "task_ended" as const, evidence: position,
      },
      longest: {
        pattern: ["NodeA"], first_seen_at: position.timestamp, last_seen_at: position.timestamp,
        repeat_count: 5, duration_ms: 1, termination: "task_ended" as const, evidence: position,
      },
      last: {
        pattern: ["NodeA"], first_seen_at: position.timestamp, last_seen_at: position.timestamp,
        repeat_count: 5, duration_ms: 1, termination: "task_ended" as const, evidence: position,
      },
    },
    detector: {
      name: "repeated-completed-node-sequence" as const,
      version: 1 as const,
      minimum_repeats: 3 as const,
      maximum_pattern_length: 8 as const,
    },
    priority: "high" as const,
    priority_reasons: ["high_unsuccessful_attempts"],
  };
  const recognitionA = {
    session_id: "session:1",
    execution_id: "execution:1",
    task_id: 1,
    task_name: "Task1",
    signal_id: "reco:1",
    kind: "recognition_activity" as const,
    pipeline_node_name: "NodeA",
    next_list: [],
    occurrence_count: 5,
    occurrences_with_mixed_results: 0,
    terminal_outcomes: { matched: 0, timeout: 0, running: 0, unmatched: 5 },
    terminal_matches: [],
    candidate_statistics: [{
      name: "TargetA",
      evaluation_count: 5,
      matched_attempt_count: 0,
      unsuccessful_attempt_count: 5,
      running_attempt_count: 0,
      terminal_match_count: 0,
    }],
    unmapped_attempt_count: 0,
    attempts: { count: 5, minimum: 1, p50: 1, p95: 1, maximum: 1, average: 1 },
    unsuccessful_attempts: { count: 5, minimum: 1, p50: 1, p95: 1, maximum: 1, average: 1 },
    duration_ms: { count: 5, minimum: 1, p50: 1, p95: 1, maximum: 1, average: 1 },
    representatives: {
      first: {
        node_id: 11, started_at: position.timestamp, ended_at: position.timestamp,
        attempt_count: 5, unsuccessful_attempts: 5, terminal_match: null,
        evidence: { start: position, end: position },
      },
      worst: {
        node_id: 11, started_at: position.timestamp, ended_at: position.timestamp,
        attempt_count: 5, unsuccessful_attempts: 5, terminal_match: null,
        evidence: { start: position, end: position },
      },
      last: {
        node_id: 11, started_at: position.timestamp, ended_at: position.timestamp,
        attempt_count: 5, unsuccessful_attempts: 5, terminal_match: null,
        evidence: { start: position, end: position },
      },
    },
    priority: "high" as const,
    priority_reasons: ["high_unsuccessful_attempts"],
  };
  const runtime: MlaRuntimeInspectionResult = {
    schema_version: "mla-runtime-inspection/v1",
    sessions: [{
      session_id: "session:1",
      start_kind: "process_start",
      framework_status: "resolved",
      framework_version: "v5.12.2",
      versions: ["v5.12.2"],
      start: { source: "file:maafw.log", path: "maafw.log", line: 1, timestamp: position.timestamp },
      end: { source: "file:maafw.log", path: "maafw.log", line: 2, timestamp: position.timestamp },
      tasks: [{
        execution_id: "execution:1",
        task_id: 1,
        name: "Task1",
        hash: "hash1",
        uuid: "uuid1",
        status: "succeeded",
        completeness: "complete",
        started_at: position.timestamp,
        ended_at: position.timestamp,
        observed_duration_ms: 1,
        first_node: "NodeA",
        last_node: "NodeA",
        statistics: baseStatistics,
        direct_failure_ids: [],
        outcome_ids: [],
        signal_ids: ["repeat:1"],
        signal_highlights: { recognition_activity: [], repetitions: ["repeat:1"] },
        evidence: { start: position, end: position },
      }],
      summary: {
        task_executions: 1,
        succeeded_tasks: 1,
        failed_tasks: 0,
        running_tasks: 0,
        direct_failures: 0,
        next_list_timeouts: 0,
        action_failures: 0,
        signals: 1,
      },
    }],
    unscoped_tasks: [],
    failures: [],
    outcomes: [],
    signals: [repeated, recognitionA] as unknown as MlaRuntimeInspectionResult["signals"],
    warnings: [],
  };

  const anomalies = summarizeTaskAnomalies(runtime);

  expect(anomalies).toHaveLength(1);
  expect(anomalies[0]).toMatchObject({
    executionId: "execution:1",
    taskName: "Task1",
    status: "succeeded",
    observed: ["all_evaluations_failed"],
    allEvaluationsFailed: 1,
  });
});


test("identifies cycle candidates that never matched", () => {
  const baseSignal = {
    session_id: "session:1",
    execution_id: "execution:1",
    task_id: 1,
    task_name: "Task1",
  };
  const repeated = {
    ...baseSignal,
    signal_id: "repeat:1",
    kind: "repeated_node" as const,
    pattern: ["NodeA", "NodeB"],
    segment_count: 1,
    total_repeat_count: 5,
    maximum_repeat_count: 5,
    duration_ms: { count: 1, minimum: 1, p50: 1, p95: 1, maximum: 1, average: 1 },
    terminations: { left_pattern: 0, task_ended: 0, still_repeating_at_log_end: 1 },
    representatives: {
      first: {
        pattern: ["NodeA", "NodeB"], first_seen_at: "2026-07-19 10:00:00.000",
        last_seen_at: "2026-07-19 10:00:00.000", repeat_count: 5, duration_ms: 1,
        termination: "still_repeating_at_log_end" as const,
        evidence: { timestamp: "2026-07-19 10:00:00.000", source: "file:maafw.log", path: "maafw.log", local_line: 1 },
      },
      longest: {
        pattern: ["NodeA", "NodeB"], first_seen_at: "2026-07-19 10:00:00.000",
        last_seen_at: "2026-07-19 10:00:00.000", repeat_count: 5, duration_ms: 1,
        termination: "still_repeating_at_log_end" as const,
        evidence: { timestamp: "2026-07-19 10:00:00.000", source: "file:maafw.log", path: "maafw.log", local_line: 1 },
      },
      last: {
        pattern: ["NodeA", "NodeB"], first_seen_at: "2026-07-19 10:00:00.000",
        last_seen_at: "2026-07-19 10:00:00.000", repeat_count: 5, duration_ms: 1,
        termination: "still_repeating_at_log_end" as const,
        evidence: { timestamp: "2026-07-19 10:00:00.000", source: "file:maafw.log", path: "maafw.log", local_line: 1 },
      },
    },
    detector: {
      name: "repeated-completed-node-sequence" as const,
      version: 1 as const,
      minimum_repeats: 3 as const,
      maximum_pattern_length: 8 as const,
    },
    priority: "high",
    priority_reasons: ["still_repeating_at_log_end"],
  };
  const recognitionA = {
    ...baseSignal,
    signal_id: "reco:1",
    kind: "recognition_activity" as const,
    pipeline_node_name: "NodeA",
    next_list: [],
    occurrence_count: 5,
    occurrences_with_mixed_results: 0,
    terminal_outcomes: { matched: 0, timeout: 0, running: 0, unmatched: 5 },
    terminal_matches: [],
    candidate_statistics: [{
      name: "TargetA",
      evaluation_count: 5,
      matched_attempt_count: 0,
      unsuccessful_attempt_count: 5,
      running_attempt_count: 0,
      terminal_match_count: 0,
    }],
    unmapped_attempt_count: 0,
    attempts: { count: 5, minimum: 1, p50: 1, p95: 1, maximum: 1, average: 1 },
    unsuccessful_attempts: { count: 5, minimum: 1, p50: 1, p95: 1, maximum: 1, average: 1 },
    duration_ms: { count: 5, minimum: 1, p50: 1, p95: 1, maximum: 1, average: 1 },
    representatives: {
      first: {
        node_id: 11, started_at: "2026-07-19 10:00:00.000", ended_at: "2026-07-19 10:00:00.000",
        attempt_count: 5, unsuccessful_attempts: 5, terminal_match: null,
        evidence: {
          start: { timestamp: "2026-07-19 10:00:00.000", source: "file:maafw.log", path: "maafw.log", local_line: 1 },
          end: { timestamp: "2026-07-19 10:00:00.000", source: "file:maafw.log", path: "maafw.log", local_line: 1 },
        },
      },
      worst: {
        node_id: 11, started_at: "2026-07-19 10:00:00.000", ended_at: "2026-07-19 10:00:00.000",
        attempt_count: 5, unsuccessful_attempts: 5, terminal_match: null,
        evidence: {
          start: { timestamp: "2026-07-19 10:00:00.000", source: "file:maafw.log", path: "maafw.log", local_line: 1 },
          end: { timestamp: "2026-07-19 10:00:00.000", source: "file:maafw.log", path: "maafw.log", local_line: 1 },
        },
      },
      last: {
        node_id: 11, started_at: "2026-07-19 10:00:00.000", ended_at: "2026-07-19 10:00:00.000",
        attempt_count: 5, unsuccessful_attempts: 5, terminal_match: null,
        evidence: {
          start: { timestamp: "2026-07-19 10:00:00.000", source: "file:maafw.log", path: "maafw.log", local_line: 1 },
          end: { timestamp: "2026-07-19 10:00:00.000", source: "file:maafw.log", path: "maafw.log", local_line: 1 },
        },
      },
    },
    priority: "high",
    priority_reasons: ["high_unsuccessful_attempts"],
  };
  const runtime = {
    schema_version: "mla-runtime-inspection/v1",
    sessions: [],
    unscoped_tasks: [],
    failures: [],
    outcomes: [],
    signals: [repeated, recognitionA],
    warnings: [],
  } as unknown as MlaRuntimeInspectionResult;
  const candidates = cycleExitCandidates(runtime, repeated as MlaRuntimeInspectionResult["signals"][number]);

  expect(candidates).toEqual([
    {
      node: "TargetA",
      evaluationCount: 5,
      matchedAttemptCount: 0,
      unsuccessfulAttemptCount: 5,
      terminalMatchCount: 0,
    },
  ]);
});


test("decomposes cycle candidate success/failure outcomes", () => {
  const baseSignal = {
    session_id: "session:1",
    execution_id: "execution:1",
    task_id: 1,
    task_name: "Task1",
  };
  const repeated = {
    ...baseSignal,
    signal_id: "repeat:1",
    kind: "repeated_node" as const,
    pattern: ["NodeA"],
    segment_count: 1,
    total_repeat_count: 5,
    maximum_repeat_count: 5,
    duration_ms: { count: 1, minimum: 1, p50: 1, p95: 1, maximum: 1, average: 1 },
    terminations: { left_pattern: 0, task_ended: 0, still_repeating_at_log_end: 1 },
    representatives: {
      first: {
        pattern: ["NodeA"], first_seen_at: "2026-07-19 10:00:00.000",
        last_seen_at: "2026-07-19 10:00:00.000", repeat_count: 5, duration_ms: 1,
        termination: "still_repeating_at_log_end" as const,
        evidence: { timestamp: "2026-07-19 10:00:00.000", source: "file:maafw.log", path: "maafw.log", local_line: 1 },
      },
      longest: {
        pattern: ["NodeA"], first_seen_at: "2026-07-19 10:00:00.000",
        last_seen_at: "2026-07-19 10:00:00.000", repeat_count: 5, duration_ms: 1,
        termination: "still_repeating_at_log_end" as const,
        evidence: { timestamp: "2026-07-19 10:00:00.000", source: "file:maafw.log", path: "maafw.log", local_line: 1 },
      },
      last: {
        pattern: ["NodeA"], first_seen_at: "2026-07-19 10:00:00.000",
        last_seen_at: "2026-07-19 10:00:00.000", repeat_count: 5, duration_ms: 1,
        termination: "still_repeating_at_log_end" as const,
        evidence: { timestamp: "2026-07-19 10:00:00.000", source: "file:maafw.log", path: "maafw.log", local_line: 1 },
      },
    },
    detector: {
      name: "repeated-completed-node-sequence" as const,
      version: 1 as const,
      minimum_repeats: 3 as const,
      maximum_pattern_length: 8 as const,
    },
    priority: "high",
    priority_reasons: ["still_repeating_at_log_end"],
  };
  const recognitionA = {
    ...baseSignal,
    signal_id: "reco:1",
    kind: "recognition_activity" as const,
    pipeline_node_name: "NodeA",
    next_list: [],
    occurrence_count: 5,
    occurrences_with_mixed_results: 0,
    terminal_outcomes: { matched: 3, timeout: 0, running: 0, unmatched: 2 },
    terminal_matches: [],
    candidate_statistics: [
      {
        name: "TargetA",
        evaluation_count: 5,
        matched_attempt_count: 0,
        unsuccessful_attempt_count: 5,
        running_attempt_count: 0,
        terminal_match_count: 0,
      },
      {
        name: "TargetB",
        evaluation_count: 5,
        matched_attempt_count: 3,
        unsuccessful_attempt_count: 2,
        running_attempt_count: 0,
        terminal_match_count: 0,
      },
    ],
    unmapped_attempt_count: 0,
    attempts: { count: 5, minimum: 1, p50: 1, p95: 1, maximum: 1, average: 1 },
    unsuccessful_attempts: { count: 5, minimum: 1, p50: 1, p95: 1, maximum: 1, average: 1 },
    duration_ms: { count: 5, minimum: 1, p50: 1, p95: 1, maximum: 1, average: 1 },
    representatives: {
      first: {
        node_id: 11, started_at: "2026-07-19 10:00:00.000", ended_at: "2026-07-19 10:00:00.000",
        attempt_count: 5, unsuccessful_attempts: 5, terminal_match: null,
        evidence: {
          start: { timestamp: "2026-07-19 10:00:00.000", source: "file:maafw.log", path: "maafw.log", local_line: 1 },
          end: { timestamp: "2026-07-19 10:00:00.000", source: "file:maafw.log", path: "maafw.log", local_line: 1 },
        },
      },
      worst: {
        node_id: 11, started_at: "2026-07-19 10:00:00.000", ended_at: "2026-07-19 10:00:00.000",
        attempt_count: 5, unsuccessful_attempts: 5, terminal_match: null,
        evidence: {
          start: { timestamp: "2026-07-19 10:00:00.000", source: "file:maafw.log", path: "maafw.log", local_line: 1 },
          end: { timestamp: "2026-07-19 10:00:00.000", source: "file:maafw.log", path: "maafw.log", local_line: 1 },
        },
      },
      last: {
        node_id: 11, started_at: "2026-07-19 10:00:00.000", ended_at: "2026-07-19 10:00:00.000",
        attempt_count: 5, unsuccessful_attempts: 5, terminal_match: null,
        evidence: {
          start: { timestamp: "2026-07-19 10:00:00.000", source: "file:maafw.log", path: "maafw.log", local_line: 1 },
          end: { timestamp: "2026-07-19 10:00:00.000", source: "file:maafw.log", path: "maafw.log", local_line: 1 },
        },
      },
    },
    priority: "high",
    priority_reasons: ["high_unsuccessful_attempts"],
  };
  const runtime = {
    schema_version: "mla-runtime-inspection/v1",
    sessions: [],
    unscoped_tasks: [],
    failures: [],
    outcomes: [],
    signals: [repeated, recognitionA],
    warnings: [],
  } as unknown as MlaRuntimeInspectionResult;
  const repeatedSignal = repeated as MlaRuntimeInspectionResult["signals"][number];
  const outcomes = cycleCandidateOutcomes(runtime, repeatedSignal);

  expect(outcomes).toEqual([
    {
      cycleSignalId: "repeat:1",
      pipelineNode: "NodeA",
      candidate: "TargetA",
      evaluationCount: 5,
      matchedAttemptCount: 0,
      unsuccessfulAttemptCount: 5,
      runningAttemptCount: 0,
      terminalMatchCount: 0,
      persistentFailure: true,
      evidence: {
        timestamp: "2026-07-19 10:00:00.000",
        source: "file:maafw.log",
        path: "maafw.log",
        local_line: 1,
      },
    },
    {
      cycleSignalId: "repeat:1",
      pipelineNode: "NodeA",
      candidate: "TargetB",
      evaluationCount: 5,
      matchedAttemptCount: 3,
      unsuccessfulAttemptCount: 2,
      runningAttemptCount: 0,
      terminalMatchCount: 0,
      persistentFailure: false,
      evidence: {
        timestamp: "2026-07-19 10:00:00.000",
        source: "file:maafw.log",
        path: "maafw.log",
        local_line: 1,
      },
    },
  ]);

  const blockers = cycleExitBlockers(runtime, repeatedSignal);
  expect(blockers.map((item) => item.candidate)).toEqual(["TargetA"]);
  expect(blockers[0]?.persistentFailure).toBe(true);
});



test("correlates cycle exit blockers with the latest recognition detail", () => {
  const blocker: import("../../src/evidence/types.js").Evidence = {
    id: "blocker:1",
    kind: "mla.cycle_exit_blocker",
    summary: "blocked",
    source: { artifactId: "a", path: "maafw.log" },
    data: {
      cycleSignalId: "repeat:1",
      pipelineNode: "NodeA",
      candidate: "TargetA",
      evaluationCount: 8,
      matchedAttemptCount: 0,
      unsuccessfulAttemptCount: 8,
      runningAttemptCount: 0,
      terminalMatchCount: 0,
      persistentFailure: true,
      evidence: { timestamp: "2026-07-19 10:00:00.000", source: "file:maafw.log", path: "maafw.log", local_line: 1 },
    },
  };
  const detail: import("../../src/evidence/types.js").Evidence = {
    id: "detail:1",
    kind: "mla.recognition_detail",
    summary: "recognition",
    source: { artifactId: "a", path: "maafw.log" },
    data: {
      algorithm: "TemplateMatch",
      detailShape: "candidate_list",
      node: "TargetA",
      status: "failed",
      best: [
        {
          box: [0, 0, 10, 10],
          score: 0.212474,
          text: "needle",
          timestamp: "2026-07-19 10:05:00.000",
          mergedLine: 40,
        },
      ],
    },
  };
  const correlated = correlateCycleBlockers([blocker, detail]);
  const blockerData = correlated.find((item) => item.kind === "mla.cycle_exit_blocker")?.data as {
    relatedRecognition?: {
      recognitionEvidenceId: string;
      algorithm: string;
      status: string;
      score: number;
      text: string;
      timestamp: string;
    };
  };

  expect(blockerData?.relatedRecognition).toEqual({
    recognitionEvidenceId: "detail:1",
    algorithm: "TemplateMatch",
    status: "failed",
    detailShape: "candidate_list",
    score: 0.212474,
    text: "needle",
    count: null,
    label: null,
    timestamp: "2026-07-19 10:05:00.000",
  });
});
