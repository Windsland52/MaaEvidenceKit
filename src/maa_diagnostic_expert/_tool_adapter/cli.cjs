"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// dist/cli.js
var import_node_path6 = __toESM(require("node:path"), 1);
var import_node_readline = require("node:readline");
var import_node_url2 = require("node:url");

// dist/mla.js
var import_promises5 = require("node:fs/promises");
var import_node_path4 = __toESM(require("node:path"), 1);

// ../../node_modules/.pnpm/@windsland52+maa-log-kernel@1.0.2/node_modules/@windsland52/maa-log-kernel/package.json
var package_default = {
  name: "@windsland52/maa-log-kernel",
  version: "1.0.2",
  type: "module",
  private: false,
  exports: {
    ".": {
      import: "./dist/index.js",
      types: "./dist/index.d.ts"
    },
    "./protocol": {
      import: "./dist/protocol.js",
      types: "./dist/protocol.d.ts"
    },
    "./types": {
      import: "./dist/types.js",
      types: "./dist/types.d.ts"
    },
    "./statistics": {
      import: "./dist/statistics.js",
      types: "./dist/statistics.d.ts"
    },
    "./parser": {
      import: "./dist/parser.js",
      types: "./dist/parser.d.ts"
    }
  },
  engines: {
    node: ">=20.18.0"
  },
  publishConfig: {
    access: "public"
  },
  files: [
    "dist",
    "README.md"
  ],
  repository: {
    type: "git",
    url: "https://github.com/MaaXYZ/MaaLogAnalyzer",
    directory: "packages/maa-log-kernel"
  },
  scripts: {
    typecheck: "tsc -p ./tsconfig.json",
    build: `node -e "require('node:fs').rmSync('dist',{ recursive: true, force: true })" && tsc -p ./tsconfig.build.json && node ../../scripts/fix-esm-imports.mjs ./dist`,
    clean: `node -e "require('node:fs').rmSync('dist',{ recursive: true, force: true })"`
  }
};

// ../../node_modules/.pnpm/@windsland52+maa-log-kernel@1.0.2/node_modules/@windsland52/maa-log-kernel/dist/protocol.js
var MLA_KERNEL_SCHEMA_VERSION = "1.0.0";

// ../../node_modules/.pnpm/@windsland52+maa-log-kernel@1.0.2/node_modules/@windsland52/maa-log-kernel/dist/index.js
var KERNEL_PACKAGE_NAME = "@windsland52/maa-log-kernel";
var KERNEL_PACKAGE_VERSION = package_default.version;
var DEFAULT_KERNEL_PARSER_VERSION = `${KERNEL_PACKAGE_NAME}/${KERNEL_PACKAGE_VERSION}`;
var buildKernelWarnings = (content, eventCount, taskCount) => {
  const warnings = [];
  if (!content.trim()) {
    warnings.push("Empty log content.");
  }
  if (eventCount === 0 && content.trim()) {
    warnings.push("No !!!OnEventNotify!!! events found in content.");
  }
  if (eventCount > 0 && taskCount === 0) {
    warnings.push("Events were parsed but no task lifecycle was assembled.");
  }
  return warnings;
};
var buildKernelOutput = (input) => {
  return {
    meta: {
      schemaVersion: MLA_KERNEL_SCHEMA_VERSION,
      parserVersion: input.parserVersion || DEFAULT_KERNEL_PARSER_VERSION,
      generatedAt: input.generatedAt || (/* @__PURE__ */ new Date()).toISOString()
    },
    tasks: input.tasks,
    events: input.events,
    stats: input.stats,
    warnings: buildKernelWarnings(input.content, input.events.length, input.tasks.length)
  };
};

// ../../node_modules/.pnpm/@windsland52+maa-log-runtime@1.1.0/node_modules/@windsland52/maa-log-runtime/dist/index.js
var DEFAULT_CORE_PARSE_OPTIONS = {
  yieldControl: null
};
var analyzeLogContentWith = async (adapter, input) => {
  const parseResult = await adapter.parse({
    content: input.content,
    errorImages: input.errorImages,
    visionImages: input.visionImages,
    waitFreezesImages: input.waitFreezesImages,
    parseOptions: input.parseOptions ?? DEFAULT_CORE_PARSE_OPTIONS
  });
  const stats = adapter.buildStatistics(parseResult.tasks);
  return buildKernelOutput({
    content: input.content,
    tasks: parseResult.tasks,
    events: parseResult.events,
    stats,
    parserVersion: input.parserVersion || adapter.parserVersion
  });
};

// ../../node_modules/.pnpm/@windsland52+maa-log-parser@1.1.0/node_modules/@windsland52/maa-log-parser/dist/event/meta.js
var normalizeMaaDomain = (value) => {
  switch (value) {
    case "Resource":
    case "Controller":
    case "Tasker":
    case "Node":
      return value;
    default:
      return "Unknown";
  }
};
var normalizeMaaPhase = (value) => {
  switch (value) {
    case "Starting":
    case "Succeeded":
    case "Failed":
      return value;
    default:
      return "Unknown";
  }
};
var normalizeMaaTaskerKind = (value) => {
  return value === "Task" ? "Task" : "Unknown";
};
var normalizeMaaNodeKind = (value) => {
  switch (value) {
    case "PipelineNode":
    case "RecognitionNode":
    case "ActionNode":
    case "NextList":
    case "Recognition":
    case "Action":
    case "WaitFreezes":
      return value;
    default:
      return "Unknown";
  }
};
var parseMaaMessageMeta = (message) => {
  const firstDot = message.indexOf(".");
  if (firstDot < 0) {
    return { domain: "Unknown", phase: "Unknown", taskerKind: "Unknown", nodeKind: "Unknown" };
  }
  const secondDot = message.indexOf(".", firstDot + 1);
  if (secondDot < 0) {
    return { domain: "Unknown", phase: "Unknown", taskerKind: "Unknown", nodeKind: "Unknown" };
  }
  const domainRaw = message.slice(0, firstDot);
  const kindRaw = message.slice(firstDot + 1, secondDot);
  const phaseRaw = message.slice(secondDot + 1);
  const domain = normalizeMaaDomain(domainRaw);
  const phase = normalizeMaaPhase(phaseRaw);
  const taskerKind = domain === "Tasker" ? normalizeMaaTaskerKind(kindRaw) : "Unknown";
  const nodeKind = domain === "Node" ? normalizeMaaNodeKind(kindRaw) : "Unknown";
  return {
    domain,
    phase,
    taskerKind,
    nodeKind
  };
};
var parseEventTimestampMs = (timestamp) => {
  const normalized = timestamp.includes("T") ? timestamp : timestamp.replace(" ", "T");
  const parsed = Date.parse(normalized);
  return Number.isFinite(parsed) ? parsed : NaN;
};
var pad2 = (value) => String(value).padStart(2, "0");
var pad3 = (value) => String(value).padStart(3, "0");
var formatEventTimestampMs = (timestampMs2) => {
  const date = new Date(timestampMs2);
  if (!Number.isFinite(date.getTime()))
    return "";
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}.${pad3(date.getMilliseconds())}`;
};
var fnv1aHash = (str) => {
  let hash = 2166136261;
  for (let i2 = 0; i2 < str.length; i2++) {
    hash ^= str.charCodeAt(i2);
    hash = hash * 16777619 >>> 0;
  }
  return hash.toString(36);
};
var buildEventDedupSignature = (message, detailsJson) => {
  return `${message}|${fnv1aHash(detailsJson)}`;
};

// ../../node_modules/.pnpm/@windsland52+maa-log-parser@1.1.0/node_modules/@windsland52/maa-log-parser/dist/event/line.js
var EVENT_LINE_REGEX = /^\[([^\]]+)\]\[([^\]]+)\]\[(Px[^\]]+)\]\[(Tx[^\]]+)\].*?!!!OnEventNotify!!!\s*\[handle=[^\]]*\]\s*\[msg=([^\]]+)\]\s*\[details=(.*)\]\s*$/;
var parseEventLine = (line, lineNum, options) => {
  const match = line.match(EVENT_LINE_REGEX);
  if (!match)
    return null;
  const [, rawTimestamp, rawLevel, rawProcessId, rawThreadId, rawMsg, detailsJson] = match;
  const timestampMs2 = parseEventTimestampMs(rawTimestamp);
  const timestamp = Number.isFinite(timestampMs2) ? formatEventTimestampMs(timestampMs2) : options.forceCopyString(rawTimestamp);
  const level = options.internEventToken(rawLevel);
  const processId = options.internEventToken(rawProcessId);
  const threadId = options.internEventToken(rawThreadId);
  const msg = options.internEventToken(rawMsg);
  let parsedDetails;
  try {
    parsedDetails = JSON.parse(detailsJson);
  } catch {
    return null;
  }
  if (parsedDetails == null || typeof parsedDetails !== "object" || Array.isArray(parsedDetails)) {
    return null;
  }
  const details = parsedDetails;
  return {
    timestamp,
    level,
    message: msg,
    details,
    processId,
    threadId,
    _lineNumber: lineNum,
    _dedupSignature: buildEventDedupSignature(msg, detailsJson),
    _timestampMs: timestampMs2
  };
};

// ../../node_modules/.pnpm/@windsland52+maa-log-parser@1.1.0/node_modules/@windsland52/maa-log-parser/dist/shared/logEventDecoders.js
var readNumberField = (details, field) => {
  if (!details)
    return void 0;
  const value = details[field];
  return typeof value === "number" ? value : void 0;
};
var readStringField = (details, field) => {
  if (!details)
    return void 0;
  const value = details[field];
  return typeof value === "string" ? value : void 0;
};
var parseNumericArray = (value) => {
  if (!Array.isArray(value))
    return void 0;
  const normalized = value.map((item) => typeof item === "number" ? item : Number(item)).filter((item) => Number.isFinite(item));
  return normalized.length > 0 ? normalized : void 0;
};
var parseRoi = (value) => {
  const normalized = parseNumericArray(value);
  if (!normalized || normalized.length !== 4)
    return void 0;
  return [normalized[0], normalized[1], normalized[2], normalized[3]];
};
var parseWaitFreezesParam = (value) => {
  if (!value || typeof value !== "object")
    return void 0;
  const raw = value;
  const param = {};
  if (typeof raw.method === "number")
    param.method = raw.method;
  if (typeof raw.rate_limit === "number")
    param.rate_limit = raw.rate_limit;
  if (typeof raw.threshold === "number")
    param.threshold = raw.threshold;
  if (typeof raw.time === "number")
    param.time = raw.time;
  if (typeof raw.timeout === "number")
    param.timeout = raw.timeout;
  return Object.keys(param).length > 0 ? param : void 0;
};

// ../../node_modules/.pnpm/@windsland52+maa-log-parser@1.1.0/node_modules/@windsland52/maa-log-parser/dist/protocol/eventFactory.js
var toProtocolPhase = (phase) => {
  switch (phase) {
    case "Starting":
      return "starting";
    case "Succeeded":
      return "succeeded";
    case "Failed":
      return "failed";
    default:
      return null;
  }
};
var readRecord = (value) => {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return void 0;
  return value;
};
var readUnknownField = (details, field) => details[field];
var readNextList = (value) => {
  if (!Array.isArray(value))
    return void 0;
  const items = value.map((entry) => {
    const raw = readRecord(entry);
    if (!raw) {
      return {};
    }
    return {
      name: readStringField(raw, "name"),
      anchor: typeof raw.anchor === "boolean" ? raw.anchor : void 0,
      jumpBack: typeof raw.jump_back === "boolean" ? raw.jump_back : void 0
    };
  });
  return items;
};
var readPositiveSafeIntegerField = (details, field) => {
  const value = readNumberField(details, field);
  return value !== void 0 && Number.isSafeInteger(value) && value > 0 ? value : void 0;
};
var buildBase = (event, options, kind, phase) => ({
  kind,
  seq: options.seq,
  ts: event.timestamp,
  tsMs: event._timestampMs,
  processId: event.processId,
  threadId: event.threadId,
  source: createSourceRef(event, options),
  rawMessage: event.message,
  phase,
  rawDetails: event.details
});
var createSourceRef = (event, options = {}) => {
  const inputIndex = options.inputIndex ?? 0;
  return {
    sourceKey: options.sourceKey ?? options.sourcePath ?? `input:${inputIndex}`,
    sourcePath: options.sourcePath,
    inputIndex,
    line: options.line ?? event._lineNumber ?? 0
  };
};
var createProtocolEvent = (event, options) => {
  const meta = parseMaaMessageMeta(event.message);
  const phase = toProtocolPhase(meta.phase);
  if (!phase)
    return null;
  const details = event.details;
  if (event.message.startsWith("Resource.Loading.")) {
    const protocolEvent = {
      ...buildBase(event, options, "resource_loading", phase),
      resId: readNumberField(details, "res_id"),
      path: readStringField(details, "path"),
      resourceType: readStringField(details, "type"),
      hash: readStringField(details, "hash")
    };
    return protocolEvent;
  }
  if (event.message.startsWith("Controller.Action.")) {
    const protocolEvent = {
      ...buildBase(event, options, "controller_action", phase),
      ctrlId: readNumberField(details, "ctrl_id"),
      uuid: readStringField(details, "uuid"),
      action: readStringField(details, "action"),
      param: readRecord(readUnknownField(details, "param")),
      info: readRecord(readUnknownField(details, "info"))
    };
    return protocolEvent;
  }
  if (meta.domain === "Tasker" && meta.taskerKind === "Task") {
    const taskId = readPositiveSafeIntegerField(details, "task_id");
    if (taskId === void 0)
      return null;
    const protocolEvent = {
      ...buildBase(event, options, "task", phase),
      taskId,
      entry: readStringField(details, "entry"),
      uuid: readStringField(details, "uuid"),
      hash: readStringField(details, "hash")
    };
    return protocolEvent;
  }
  if (meta.domain !== "Node")
    return null;
  switch (meta.nodeKind) {
    case "PipelineNode": {
      const taskId = readPositiveSafeIntegerField(details, "task_id");
      const nodeId = readPositiveSafeIntegerField(details, "node_id");
      if (taskId === void 0 || nodeId === void 0)
        return null;
      const protocolEvent = {
        ...buildBase(event, options, "pipeline_node", phase),
        taskId,
        nodeId,
        name: readStringField(details, "name"),
        focus: readUnknownField(details, "focus"),
        nodeDetails: readRecord(readUnknownField(details, "node_details")),
        recoDetails: readRecord(readUnknownField(details, "reco_details")),
        actionDetails: readRecord(readUnknownField(details, "action_details"))
      };
      return protocolEvent;
    }
    case "RecognitionNode": {
      const taskId = readPositiveSafeIntegerField(details, "task_id");
      const nodeId = readPositiveSafeIntegerField(details, "node_id");
      if (taskId === void 0 || nodeId === void 0)
        return null;
      const protocolEvent = {
        ...buildBase(event, options, "recognition_node", phase),
        taskId,
        nodeId,
        recoId: readPositiveSafeIntegerField(details, "reco_id"),
        name: readStringField(details, "name"),
        focus: readUnknownField(details, "focus"),
        nodeDetails: readRecord(readUnknownField(details, "node_details")),
        recoDetails: readRecord(readUnknownField(details, "reco_details"))
      };
      return protocolEvent;
    }
    case "ActionNode": {
      const taskId = readPositiveSafeIntegerField(details, "task_id");
      const nodeId = readPositiveSafeIntegerField(details, "node_id");
      if (taskId === void 0 || nodeId === void 0)
        return null;
      const protocolEvent = {
        ...buildBase(event, options, "action_node", phase),
        taskId,
        nodeId,
        actionId: readPositiveSafeIntegerField(details, "action_id"),
        name: readStringField(details, "name"),
        focus: readUnknownField(details, "focus"),
        nodeDetails: readRecord(readUnknownField(details, "node_details")),
        actionDetails: readRecord(readUnknownField(details, "action_details"))
      };
      return protocolEvent;
    }
    case "NextList": {
      const taskId = readPositiveSafeIntegerField(details, "task_id");
      if (taskId === void 0)
        return null;
      const protocolEvent = {
        ...buildBase(event, options, "next_list", phase),
        taskId,
        name: readStringField(details, "name"),
        list: readNextList(readUnknownField(details, "list")),
        focus: readUnknownField(details, "focus")
      };
      return protocolEvent;
    }
    case "Recognition": {
      const taskId = readPositiveSafeIntegerField(details, "task_id");
      const recoId = readPositiveSafeIntegerField(details, "reco_id");
      if (taskId === void 0 || recoId === void 0)
        return null;
      const protocolEvent = {
        ...buildBase(event, options, "recognition", phase),
        taskId,
        recoId,
        name: readStringField(details, "name"),
        focus: readUnknownField(details, "focus"),
        anchor: readStringField(details, "anchor"),
        recoDetails: readRecord(readUnknownField(details, "reco_details"))
      };
      return protocolEvent;
    }
    case "Action": {
      const taskId = readPositiveSafeIntegerField(details, "task_id");
      const actionId = readPositiveSafeIntegerField(details, "action_id");
      if (taskId === void 0 || actionId === void 0)
        return null;
      const protocolEvent = {
        ...buildBase(event, options, "action", phase),
        taskId,
        actionId,
        name: readStringField(details, "name"),
        focus: readUnknownField(details, "focus"),
        actionDetails: readRecord(readUnknownField(details, "action_details"))
      };
      return protocolEvent;
    }
    case "WaitFreezes": {
      const taskId = readPositiveSafeIntegerField(details, "task_id");
      const wfId = readPositiveSafeIntegerField(details, "wf_id");
      if (taskId === void 0 || wfId === void 0)
        return null;
      const protocolEvent = {
        ...buildBase(event, options, "wait_freezes", phase),
        taskId,
        wfId,
        name: readStringField(details, "name"),
        waitPhase: readStringField(details, "phase"),
        roi: parseRoi(readUnknownField(details, "roi")),
        param: parseWaitFreezesParam(readUnknownField(details, "param")),
        recoIds: parseNumericArray(readUnknownField(details, "reco_ids")),
        elapsed: readNumberField(details, "elapsed"),
        focus: readUnknownField(details, "focus")
      };
      return protocolEvent;
    }
    default:
      return null;
  }
};

// ../../node_modules/.pnpm/@windsland52+maa-log-parser@1.1.0/node_modules/@windsland52/maa-log-parser/dist/trace/scopeId.js
var readNumberField2 = (record, camelField, snakeField) => {
  const camelValue = record[camelField];
  if (typeof camelValue === "number")
    return camelValue;
  const snakeValue = record[snakeField];
  if (typeof snakeValue === "number")
    return snakeValue;
  return void 0;
};
var readScopeIdentityFields = (payload) => {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return {};
  }
  const record = payload;
  return {
    taskId: readNumberField2(record, "taskId", "task_id"),
    nodeId: readNumberField2(record, "nodeId", "node_id"),
    recoId: readNumberField2(record, "recoId", "reco_id"),
    actionId: readNumberField2(record, "actionId", "action_id"),
    wfId: readNumberField2(record, "wfId", "wf_id"),
    resId: readNumberField2(record, "resId", "res_id"),
    ctrlId: readNumberField2(record, "ctrlId", "ctrl_id")
  };
};
var resolveScopeLocalId = (kind, payload) => {
  const identity = readScopeIdentityFields(payload);
  switch (kind) {
    case "task":
      return identity.taskId;
    case "pipeline_node":
    case "recognition_node":
    case "action_node":
      return identity.nodeId;
    case "recognition":
      return identity.recoId;
    case "action":
      return identity.actionId;
    case "wait_freezes":
      return identity.wfId;
    case "resource_loading":
      return identity.resId;
    case "controller_action":
      return identity.ctrlId;
    case "next_list":
    case "trace_root":
      return void 0;
  }
};
var buildScopeId = ({ kind, taskId, localId, startSeq }) => {
  return `${kind}:${taskId ?? 0}:${localId ?? 0}:seq${startSeq}`;
};
var createScopeId = (kind, payload, startSeq, explicitTaskId) => {
  const identity = readScopeIdentityFields(payload);
  return buildScopeId({
    kind,
    taskId: explicitTaskId ?? identity.taskId,
    localId: resolveScopeLocalId(kind, payload),
    startSeq
  });
};

// ../../node_modules/.pnpm/@windsland52+maa-log-parser@1.1.0/node_modules/@windsland52/maa-log-parser/dist/trace/reducer.js
var BUSINESS_SCOPE_KINDS = /* @__PURE__ */ new Set([
  "task",
  "pipeline_node",
  "recognition_node",
  "action_node",
  "next_list",
  "recognition",
  "action",
  "wait_freezes"
]);
var isBusinessScope = (kind) => BUSINESS_SCOPE_KINDS.has(kind);
var matchesScopeSource = (scope, event) => {
  const payload = scope.payload;
  return payload.processId === event.processId && payload.threadId === event.threadId;
};
var pushMapStack = (map, key, value) => {
  const current = map.get(key);
  if (current) {
    current.push(value);
    return;
  }
  map.set(key, [value]);
};
var peekMapStack = (map, key) => {
  const current = map.get(key);
  if (!current || current.length === 0)
    return null;
  return current[current.length - 1] ?? null;
};
var removeMapStackValue = (map, key, value) => {
  const current = map.get(key);
  if (!current || current.length === 0)
    return;
  const index = current.lastIndexOf(value);
  if (index < 0)
    return;
  current.splice(index, 1);
  if (current.length === 0) {
    map.delete(key);
  }
};
var removeOpenScope = (state, scope) => {
  const index = state.openScopes.lastIndexOf(scope);
  if (index >= 0) {
    state.openScopes.splice(index, 1);
  }
};
var toScopeStatus = (phase) => {
  switch (phase) {
    case "starting":
      return "running";
    case "succeeded":
      return "succeeded";
    case "failed":
      return "failed";
  }
};
var readTaskId = (event) => "taskId" in event ? event.taskId : void 0;
var mergeDefinedFields = (base, patch) => {
  const merged = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    if (value !== void 0) {
      merged[key] = value;
    }
  }
  return merged;
};
var buildScopePayload = (event, existing, endEvent) => {
  const merged = mergeDefinedFields(existing ?? {}, event);
  return {
    ...merged,
    startEvent: existing?.startEvent ?? event,
    latestEvent: event,
    endEvent: endEvent ?? existing?.endEvent
  };
};
var buildScopeKey = (event) => {
  switch (event.kind) {
    case "resource_loading":
      return event.resId != null ? `resource:${event.resId}` : null;
    case "controller_action":
      return event.ctrlId != null ? `controller:${event.ctrlId}` : null;
    case "task":
      return event.taskId != null ? `task:${event.taskId}` : null;
    case "pipeline_node":
      return event.taskId != null && event.nodeId != null ? `task:${event.taskId}:pipeline:${event.nodeId}` : null;
    case "recognition_node":
      return event.taskId != null && event.nodeId != null ? `task:${event.taskId}:recognition-node:${event.nodeId}` : null;
    case "action_node":
      return event.taskId != null && event.nodeId != null ? `task:${event.taskId}:action-node:${event.nodeId}` : null;
    case "recognition":
      return event.taskId != null && event.recoId != null ? `task:${event.taskId}:recognition:${event.recoId}` : null;
    case "action":
      return event.taskId != null && event.actionId != null ? `task:${event.taskId}:action:${event.actionId}` : null;
    case "wait_freezes":
      return event.taskId != null && event.wfId != null ? `task:${event.taskId}:wait_freezes:${event.wfId}` : null;
    case "next_list":
      return null;
  }
};
var attachChild = (parent, child) => {
  parent.children.push(child);
};
var createRootNode = (events) => ({
  id: createScopeId("trace_root", {}, 0),
  kind: "trace_root",
  status: "running",
  ts: events[0]?.ts ?? "",
  endTs: events.length > 0 ? events[events.length - 1]?.ts : void 0,
  seq: 0,
  endSeq: events.length > 0 ? events[events.length - 1]?.seq : void 0,
  payload: {},
  children: []
});
var findNearestOpenBusinessScope = (state, options = {}) => {
  for (let index = state.openScopes.length - 1; index >= 0; index -= 1) {
    const scope = state.openScopes[index];
    if (!isBusinessScope(scope.kind))
      continue;
    if (options.taskId != null && scope.taskId !== options.taskId)
      continue;
    if (options.event && !matchesScopeSource(scope, options.event))
      continue;
    return scope;
  }
  return null;
};
var findNearestOpenNonNextListBusinessScopeBySource = (state, event) => {
  for (let index = state.openScopes.length - 1; index >= 0; index -= 1) {
    const scope = state.openScopes[index];
    if (!isBusinessScope(scope.kind) || scope.kind === "next_list")
      continue;
    if (!matchesScopeSource(scope, event))
      continue;
    return scope;
  }
  return null;
};
var resolveWaitFreezesParentScope = (state, event) => {
  const taskId = event.taskId;
  const sameSourceScope = findNearestOpenBusinessScope(state, { event });
  if (sameSourceScope && taskId != null && sameSourceScope.taskId != null && sameSourceScope.taskId !== taskId) {
    if (sameSourceScope.kind !== "next_list") {
      return sameSourceScope;
    }
    const sameSourceForeignScope = findNearestOpenNonNextListBusinessScopeBySource(state, event);
    if (sameSourceForeignScope && sameSourceForeignScope.taskId != null && sameSourceForeignScope.taskId !== taskId) {
      return sameSourceForeignScope;
    }
  }
  if (taskId != null) {
    return findNearestOpenBusinessScope(state, { taskId }) ?? peekMapStack(state.openTaskScopesByTaskId, taskId) ?? state.root;
  }
  return state.root;
};
var resolveParentScope = (state, event) => {
  const taskId = readTaskId(event);
  switch (event.kind) {
    case "resource_loading":
      return findNearestOpenBusinessScope(state, { event }) ?? state.root;
    case "controller_action":
      return findNearestOpenBusinessScope(state, { event }) ?? state.root;
    case "task":
      return findNearestOpenBusinessScope(state, { event }) ?? state.root;
    case "pipeline_node":
      return taskId != null ? peekMapStack(state.openTaskScopesByTaskId, taskId) ?? findNearestOpenBusinessScope(state, { event }) ?? state.root : state.root;
    case "next_list":
      return taskId != null ? peekMapStack(state.openPipelineScopesByTaskId, taskId) ?? peekMapStack(state.openTaskScopesByTaskId, taskId) ?? findNearestOpenBusinessScope(state, { event }) ?? state.root : state.root;
    case "recognition":
      return taskId != null ? peekMapStack(state.openNextListScopesByTaskId, taskId) ?? findNearestOpenBusinessScope(state, { taskId }) ?? peekMapStack(state.openTaskScopesByTaskId, taskId) ?? state.root : state.root;
    case "action":
    case "recognition_node":
    case "action_node":
      return taskId != null ? findNearestOpenBusinessScope(state, { taskId }) ?? peekMapStack(state.openTaskScopesByTaskId, taskId) ?? findNearestOpenBusinessScope(state, { event }) ?? state.root : state.root;
    case "wait_freezes":
      return resolveWaitFreezesParentScope(state, event);
  }
};
var createScopeNode = (event) => ({
  id: createScopeId(event.kind, event, event.seq, readTaskId(event)),
  kind: event.kind,
  status: toScopeStatus(event.phase),
  ts: event.ts,
  endTs: event.phase === "starting" ? void 0 : event.ts,
  seq: event.seq,
  endSeq: event.phase === "starting" ? void 0 : event.seq,
  taskId: readTaskId(event),
  payload: buildScopePayload(event, void 0, event.phase === "starting" ? void 0 : event),
  children: []
});
var openScope = (state, event) => {
  const scopeKey = buildScopeKey(event);
  if (scopeKey) {
    const existingScopes = state.openScopeStacksByKey.get(scopeKey);
    if (existingScopes) {
      for (let index = existingScopes.length - 1; index >= 0; index -= 1) {
        const scope2 = existingScopes[index];
        if (scope2 && !matchesScopeSource(scope2, event)) {
          return scope2;
        }
      }
    }
  }
  const scope = createScopeNode(event);
  const parent = resolveParentScope(state, event);
  attachChild(parent, scope);
  state.openScopes.push(scope);
  if (scopeKey) {
    pushMapStack(state.openScopeStacksByKey, scopeKey, scope);
  }
  const taskId = scope.taskId;
  switch (scope.kind) {
    case "task":
      if (taskId != null) {
        pushMapStack(state.openTaskScopesByTaskId, taskId, scope);
      }
      break;
    case "pipeline_node":
      if (taskId != null) {
        pushMapStack(state.openPipelineScopesByTaskId, taskId, scope);
      }
      break;
    case "next_list":
      if (taskId != null) {
        pushMapStack(state.openNextListScopesByTaskId, taskId, scope);
      }
      break;
    default:
      break;
  }
  return scope;
};
var finalizeScope = (state, scope, event) => {
  scope.status = toScopeStatus(event.phase);
  scope.endTs = event.ts;
  scope.endSeq = event.seq;
  scope.payload = buildScopePayload(event, scope.payload, event);
  removeOpenScope(state, scope);
  const scopeKey = buildScopeKey(event);
  if (scopeKey) {
    removeMapStackValue(state.openScopeStacksByKey, scopeKey, scope);
  }
  const taskId = scope.taskId;
  switch (scope.kind) {
    case "task":
      if (taskId != null) {
        removeMapStackValue(state.openTaskScopesByTaskId, taskId, scope);
      }
      break;
    case "pipeline_node":
      if (taskId != null) {
        removeMapStackValue(state.openPipelineScopesByTaskId, taskId, scope);
      }
      break;
    case "next_list":
      if (taskId != null) {
        removeMapStackValue(state.openNextListScopesByTaskId, taskId, scope);
      }
      break;
    default:
      break;
  }
  return scope;
};
var closeScope = (state, event) => {
  const scopeKey = buildScopeKey(event);
  const scope = scopeKey ? peekMapStack(state.openScopeStacksByKey, scopeKey) : event.kind === "next_list" && event.taskId != null ? peekMapStack(state.openNextListScopesByTaskId, event.taskId) : null;
  if (!scope) {
    return createSyntheticTerminalScope(state, event);
  }
  return finalizeScope(state, scope, event);
};
var createSyntheticTerminalScope = (state, event) => {
  const scope = createScopeNode(event);
  const parent = resolveParentScope(state, event);
  attachChild(parent, scope);
  return scope;
};
var createReducerState = (events) => ({
  root: createRootNode(events),
  openScopes: [],
  openScopeStacksByKey: /* @__PURE__ */ new Map(),
  openTaskScopesByTaskId: /* @__PURE__ */ new Map(),
  openPipelineScopesByTaskId: /* @__PURE__ */ new Map(),
  openNextListScopesByTaskId: /* @__PURE__ */ new Map()
});
var appendEventToReducerState = (state, event) => {
  if (!state.root.ts)
    state.root.ts = event.ts;
  if (event.phase === "starting") {
    openScope(state, event);
  } else {
    closeScope(state, event);
  }
  state.root.endTs = event.ts;
  state.root.endSeq = event.seq;
};
var createIncrementalTraceReducer = () => {
  let state = createReducerState([]);
  return {
    append(event) {
      appendEventToReducerState(state, event);
    },
    getTrace() {
      return state.root;
    },
    reset() {
      state = createReducerState([]);
    }
  };
};
var buildTraceTree = (events) => {
  const state = createReducerState(events);
  for (const event of events) {
    appendEventToReducerState(state, event);
  }
  return state.root;
};

// ../../node_modules/.pnpm/@windsland52+maa-log-parser@1.1.0/node_modules/@windsland52/maa-log-parser/dist/query/locator.js
var buildTaskNodeKey = (taskId, nodeId) => `${taskId}:${nodeId}`;
var buildTaskLocalKey = (taskId, localId) => `${taskId}:${localId}`;

// ../../node_modules/.pnpm/@windsland52+maa-log-parser@1.1.0/node_modules/@windsland52/maa-log-parser/dist/query/traceIndex.js
var pushMapArray = (map, key, value) => {
  const current = map.get(key);
  if (current) {
    current.push(value);
    return;
  }
  map.set(key, [value]);
};
var sortScopesBySeq = (scopes) => {
  scopes.sort((left, right) => left.seq - right.seq);
};
var createEmptyTraceIndex = () => ({
  scopeById: /* @__PURE__ */ new Map(),
  eventBySeq: /* @__PURE__ */ new Map(),
  parentScopeIdByScopeId: /* @__PURE__ */ new Map(),
  childScopeIdsByScopeId: /* @__PURE__ */ new Map(),
  taskScopesByTaskId: /* @__PURE__ */ new Map(),
  pipelineNodeScopesByTaskIdAndNodeId: /* @__PURE__ */ new Map(),
  recognitionScopesByTaskIdAndRecoId: /* @__PURE__ */ new Map(),
  actionScopesByTaskIdAndActionId: /* @__PURE__ */ new Map(),
  waitFreezesScopesByTaskIdAndWfId: /* @__PURE__ */ new Map(),
  nodeExecutionsByTaskIdAndNodeId: /* @__PURE__ */ new Map(),
  nodeExecutionByPipelineScopeId: /* @__PURE__ */ new Map(),
  controllerScopes: [],
  resourceScopes: []
});
var indexScopeNode = (node, index) => {
  const identity = readScopeIdentityFields(node.payload);
  const taskId = node.taskId ?? identity.taskId;
  switch (node.kind) {
    case "task":
      if (taskId != null) {
        pushMapArray(index.taskScopesByTaskId, taskId, node);
      }
      return;
    case "pipeline_node":
      if (taskId != null && identity.nodeId != null) {
        pushMapArray(index.pipelineNodeScopesByTaskIdAndNodeId, buildTaskNodeKey(taskId, identity.nodeId), node);
        pushMapArray(index.nodeExecutionsByTaskIdAndNodeId, buildTaskNodeKey(taskId, identity.nodeId), {
          taskId,
          nodeId: identity.nodeId,
          occurrenceIndex: 0,
          pipelineScopeId: node.id,
          startSeq: node.seq,
          endSeq: node.endSeq
        });
      }
      return;
    case "recognition":
      if (taskId != null && identity.recoId != null) {
        pushMapArray(index.recognitionScopesByTaskIdAndRecoId, buildTaskLocalKey(taskId, identity.recoId), node);
      }
      return;
    case "action":
      if (taskId != null && identity.actionId != null) {
        pushMapArray(index.actionScopesByTaskIdAndActionId, buildTaskLocalKey(taskId, identity.actionId), node);
      }
      return;
    case "wait_freezes":
      if (taskId != null && identity.wfId != null) {
        pushMapArray(index.waitFreezesScopesByTaskIdAndWfId, buildTaskLocalKey(taskId, identity.wfId), node);
      }
      return;
    case "controller_action":
      index.controllerScopes.push(node);
      return;
    case "resource_loading":
      index.resourceScopes.push(node);
      return;
    default:
      return;
  }
};
var walkScopeTree = (node, parentScopeId, index) => {
  index.scopeById.set(node.id, node);
  index.parentScopeIdByScopeId.set(node.id, parentScopeId);
  const sortedChildren = [...node.children].sort((left, right) => left.seq - right.seq);
  index.childScopeIdsByScopeId.set(node.id, sortedChildren.map((child) => child.id));
  indexScopeNode(node, index);
  for (const child of sortedChildren) {
    walkScopeTree(child, node.id, index);
  }
};
var finalizeNodeExecutions = (index) => {
  for (const scopes of index.taskScopesByTaskId.values()) {
    sortScopesBySeq(scopes);
  }
  for (const scopes of index.pipelineNodeScopesByTaskIdAndNodeId.values()) {
    sortScopesBySeq(scopes);
  }
  for (const scopes of index.recognitionScopesByTaskIdAndRecoId.values()) {
    sortScopesBySeq(scopes);
  }
  for (const scopes of index.actionScopesByTaskIdAndActionId.values()) {
    sortScopesBySeq(scopes);
  }
  for (const scopes of index.waitFreezesScopesByTaskIdAndWfId.values()) {
    sortScopesBySeq(scopes);
  }
  index.controllerScopes.sort((left, right) => left.seq - right.seq);
  index.resourceScopes.sort((left, right) => left.seq - right.seq);
  for (const executions of index.nodeExecutionsByTaskIdAndNodeId.values()) {
    executions.sort((left, right) => left.startSeq - right.startSeq);
    executions.forEach((execution, indexInBucket) => {
      execution.occurrenceIndex = indexInBucket + 1;
      index.nodeExecutionByPipelineScopeId.set(execution.pipelineScopeId, execution);
    });
  }
};
var buildTraceIndex = (root, events = []) => {
  const index = createEmptyTraceIndex();
  for (const event of events) {
    index.eventBySeq.set(event.seq, event);
  }
  walkScopeTree(root, null, index);
  finalizeNodeExecutions(index);
  return index;
};

// ../../node_modules/.pnpm/@windsland52+maa-log-parser@1.1.0/node_modules/@windsland52/maa-log-parser/dist/shared/timestamp.js
var toTimestampMs = (value) => {
  if (!value)
    return Number.POSITIVE_INFINITY;
  const normalized = value.includes(" ") ? value.replace(" ", "T") : value;
  const parsed = Date.parse(normalized);
  return Number.isFinite(parsed) ? parsed : Number.POSITIVE_INFINITY;
};

// ../../node_modules/.pnpm/@windsland52+maa-log-parser@1.1.0/node_modules/@windsland52/maa-log-parser/dist/event/imageLookupHelpers.js
function parseEventTimestamp(timestamp) {
  const match = timestamp.match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?/);
  if (!match)
    return void 0;
  const [, year, month, day, hour, minute, second, milliseconds = "0"] = match;
  return {
    secondsKey: `${year}.${month}.${day}-${hour}.${minute}.${second}`,
    milliseconds: Number(milliseconds.padEnd(3, "0"))
  };
}
function parseImageTimestamp(key) {
  const match = key.match(/^(\d{4}\.\d{2}\.\d{2}-\d{2}\.\d{2}\.\d{2})\.(\d{1,3})_/);
  if (!match)
    return void 0;
  return {
    secondsKey: match[1],
    milliseconds: Number(match[2].padEnd(3, "0"))
  };
}
function findImageByTimestampSuffix(source, timestamp, suffix) {
  if (source.size === 0)
    return void 0;
  const target = parseEventTimestamp(timestamp);
  if (!target)
    return void 0;
  const exactKey = `${target.secondsKey}.${String(target.milliseconds).padStart(3, "0")}${suffix}`;
  const exactMatch = source.get(exactKey);
  if (exactMatch)
    return exactMatch;
  let nearestKey;
  let nearestPath;
  let nearestDistance = Number.POSITIVE_INFINITY;
  for (const [key, path8] of source.entries()) {
    if (!key.endsWith(suffix))
      continue;
    const candidate = parseImageTimestamp(key);
    if (!candidate || candidate.secondsKey !== target.secondsKey)
      continue;
    const distance = Math.abs(candidate.milliseconds - target.milliseconds);
    if (distance < nearestDistance || distance === nearestDistance && (nearestKey == null || key < nearestKey)) {
      nearestKey = key;
      nearestPath = path8;
      nearestDistance = distance;
    }
  }
  return nearestPath;
}

// ../../node_modules/.pnpm/@windsland52+maa-log-parser@1.1.0/node_modules/@windsland52/maa-log-parser/dist/projector/waitFreezesImageProjector.js
var readRecord2 = (value) => {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return void 0;
  return value;
};
var readString = (record, camelField, snakeField) => {
  const camelValue = record[camelField];
  if (typeof camelValue === "string")
    return camelValue;
  if (!snakeField)
    return void 0;
  const snakeValue = record[snakeField];
  return typeof snakeValue === "string" ? snakeValue : void 0;
};
var readNumber = (record, camelField, snakeField) => {
  const camelValue = record[camelField];
  if (typeof camelValue === "number")
    return camelValue;
  if (!snakeField)
    return void 0;
  const snakeValue = record[snakeField];
  return typeof snakeValue === "number" ? snakeValue : void 0;
};
var parseScopeWindow = (scope, fallbackEndMs) => {
  const startMs = toTimestampMs(scope.ts);
  const parsedEndMs = toTimestampMs(scope.endTs);
  const endMs = Number.isFinite(parsedEndMs) ? parsedEndMs : fallbackEndMs;
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs) {
    return void 0;
  }
  return { startMs, endMs };
};
var intersectWindows = (first, second) => {
  if (!first || !second)
    return void 0;
  const startMs = Math.max(first.startMs, second.startMs);
  const endMs = Math.min(first.endMs, second.endMs);
  return endMs >= startMs ? { startMs, endMs } : void 0;
};
var readScopeSourceKey = (payload) => {
  const source = readRecord2(payload.source);
  return source ? readString(source, "sourceKey", "source_key") : void 0;
};
var isNodeScope = (scope) => {
  return scope.kind === "pipeline_node" || scope.kind === "recognition_node" || scope.kind === "action_node";
};
var collectWaitFreezesOccurrences = (scope, fallbackEndMs, context, output) => {
  const payload = readRecord2(scope.payload) ?? {};
  const scopeWindow = parseScopeWindow(scope, fallbackEndMs);
  const taskId = scope.taskId ?? readNumber(payload, "taskId", "task_id") ?? context.taskId;
  const sourceKey = readScopeSourceKey(payload) ?? context.sourceKey;
  let taskWindow = context.taskWindow;
  let hasTaskScope = context.hasTaskScope ?? false;
  let hasNodeScope = context.hasNodeScope ?? false;
  let nodeId = context.nodeId;
  let nodeWindow = context.nodeWindow;
  if (scope.kind === "task") {
    hasTaskScope = true;
    taskWindow = scopeWindow;
    hasNodeScope = false;
    nodeId = void 0;
    nodeWindow = void 0;
  }
  if (isNodeScope(scope)) {
    hasNodeScope = true;
    nodeId = readNumber(payload, "nodeId", "node_id") ?? context.nodeId;
    const parentWindow = context.hasNodeScope ? context.nodeWindow : taskWindow;
    nodeWindow = intersectWindows(parentWindow, scopeWindow);
  }
  if (scope.kind === "wait_freezes") {
    let occurrenceWindow = scopeWindow;
    if (hasTaskScope) {
      occurrenceWindow = intersectWindows(occurrenceWindow, taskWindow);
    }
    if (hasNodeScope) {
      occurrenceWindow = intersectWindows(occurrenceWindow, nodeWindow);
    }
    if (occurrenceWindow) {
      output.push({
        scopeId: scope.id,
        name: readString(payload, "name") ?? scope.kind,
        seq: scope.seq,
        taskId,
        nodeId,
        sourceKey,
        ...occurrenceWindow
      });
    }
  }
  const childContext = {
    taskId,
    nodeId,
    sourceKey,
    hasTaskScope,
    hasNodeScope,
    taskWindow,
    nodeWindow
  };
  for (const child of scope.children) {
    collectWaitFreezesOccurrences(child, fallbackEndMs, childContext, output);
  }
};
var parseWaitFreezesImage = (key, path8) => {
  const match = key.match(/^(\d{4})\.(\d{2})\.(\d{2})-(\d{2})\.(\d{2})\.(\d{2})\.(\d{1,3})_(.+)_wait_freezes$/);
  if (!match)
    return void 0;
  const [, year, month, day, hour, minute, second, milliseconds, name] = match;
  const timestampMs2 = toTimestampMs(`${year}-${month}-${day} ${hour}:${minute}:${second}.${milliseconds.padEnd(3, "0")}`);
  if (!Number.isFinite(timestampMs2))
    return void 0;
  return { key, name, path: path8, timestampMs: timestampMs2 };
};
var compareText = (left, right) => {
  if (left === right)
    return 0;
  return left < right ? -1 : 1;
};
var compareImages = (left, right) => {
  return left.timestampMs - right.timestampMs || compareText(left.key, right.key) || compareText(left.path, right.path);
};
var compareOccurrenceForImage = (left, right) => {
  const leftNodeSpecificity = left.nodeId == null ? 0 : 1;
  const rightNodeSpecificity = right.nodeId == null ? 0 : 1;
  const leftTaskSpecificity = left.taskId == null ? 0 : 1;
  const rightTaskSpecificity = right.taskId == null ? 0 : 1;
  return right.startMs - left.startMs || rightNodeSpecificity - leftNodeSpecificity || rightTaskSpecificity - leftTaskSpecificity || left.endMs - right.endMs || right.seq - left.seq || compareText(left.sourceKey ?? "", right.sourceKey ?? "") || (left.taskId ?? Number.MAX_SAFE_INTEGER) - (right.taskId ?? Number.MAX_SAFE_INTEGER) || (left.nodeId ?? Number.MAX_SAFE_INTEGER) - (right.nodeId ?? Number.MAX_SAFE_INTEGER) || compareText(left.scopeId, right.scopeId);
};
var selectOccurrence = (image, occurrences) => {
  let selected;
  for (const occurrence of occurrences) {
    if (occurrence.name !== image.name)
      continue;
    if (image.timestampMs < occurrence.startMs || image.timestampMs > occurrence.endMs)
      continue;
    if (!selected || compareOccurrenceForImage(occurrence, selected) < 0) {
      selected = occurrence;
    }
  }
  return selected;
};
var buildWaitFreezesImageAssignments = (root, source) => {
  if (source.size === 0)
    return /* @__PURE__ */ new Map();
  const fallbackEndMs = toTimestampMs(root.endTs);
  const occurrences = [];
  collectWaitFreezesOccurrences(root, fallbackEndMs, {}, occurrences);
  if (occurrences.length === 0)
    return /* @__PURE__ */ new Map();
  const occurrencesByName = /* @__PURE__ */ new Map();
  for (const occurrence of occurrences) {
    const matching = occurrencesByName.get(occurrence.name);
    if (matching) {
      matching.push(occurrence);
    } else {
      occurrencesByName.set(occurrence.name, [occurrence]);
    }
  }
  const images = [...source.entries()].map(([key, path8]) => parseWaitFreezesImage(key, path8)).filter((image) => !!image).sort(compareImages);
  const assignments = /* @__PURE__ */ new Map();
  for (const image of images) {
    const matchingOccurrences = occurrencesByName.get(image.name);
    if (!matchingOccurrences)
      continue;
    const occurrence = selectOccurrence(image, matchingOccurrences);
    if (!occurrence)
      continue;
    const assigned = assignments.get(occurrence.scopeId);
    if (assigned) {
      assigned.push(image.path);
    } else {
      assignments.set(occurrence.scopeId, [image.path]);
    }
  }
  return assignments;
};

// ../../node_modules/.pnpm/@windsland52+maa-log-parser@1.1.0/node_modules/@windsland52/maa-log-parser/dist/projector/taskProjector.js
var EMPTY_IMAGE_MAP = /* @__PURE__ */ new Map();
var toTaskStatus = (status) => {
  switch (status) {
    case "succeeded":
      return "succeeded";
    case "failed":
      return "failed";
    default:
      return "running";
  }
};
var toRuntimeStatus = (status) => {
  switch (status) {
    case "succeeded":
      return "success";
    case "failed":
      return "failed";
    default:
      return "running";
  }
};
var sortScopesBySeq2 = (scopes) => {
  for (let index = 1; index < scopes.length; index += 1) {
    if ((scopes[index - 1]?.seq ?? 0) > (scopes[index]?.seq ?? 0)) {
      return [...scopes].sort((left, right) => left.seq - right.seq);
    }
  }
  return scopes;
};
var mergeProjectedTaskEntries = (left, right) => {
  if (left.length === 0)
    return right;
  if (right.length === 0)
    return left;
  const merged = new Array(left.length + right.length);
  let leftIndex = 0;
  let rightIndex = 0;
  let outputIndex = 0;
  while (leftIndex < left.length && rightIndex < right.length) {
    const leftEntry = left[leftIndex];
    const rightEntry = right[rightIndex];
    if (leftEntry.seq <= rightEntry.seq) {
      merged[outputIndex++] = leftEntry;
      leftIndex += 1;
    } else {
      merged[outputIndex++] = rightEntry;
      rightIndex += 1;
    }
  }
  while (leftIndex < left.length)
    merged[outputIndex++] = left[leftIndex++];
  while (rightIndex < right.length)
    merged[outputIndex++] = right[rightIndex++];
  return merged;
};
var readRecord3 = (value) => {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return null;
  return value;
};
var readScopePayload = (scope) => {
  return readRecord3(scope.payload) ?? {};
};
var readStringField2 = (record, camelField, snakeField) => {
  const camelValue = record[camelField];
  if (typeof camelValue === "string")
    return camelValue;
  if (snakeField) {
    const snakeValue = record[snakeField];
    if (typeof snakeValue === "string")
      return snakeValue;
  }
  return void 0;
};
var readNumberField3 = (record, camelField, snakeField) => {
  const camelValue = record[camelField];
  if (typeof camelValue === "number")
    return camelValue;
  if (snakeField) {
    const snakeValue = record[snakeField];
    if (typeof snakeValue === "number")
      return snakeValue;
  }
  return void 0;
};
var readScopeName = (scope) => {
  const payload = readScopePayload(scope);
  return readStringField2(payload, "name") ?? readStringField2(payload, "entry") ?? scope.kind;
};
var readScopeTaskId = (scope) => {
  if (scope.taskId != null)
    return scope.taskId;
  const payload = readScopePayload(scope);
  return readNumberField3(payload, "taskId", "task_id");
};
var readScopeNodeId = (scope) => {
  const payload = readScopePayload(scope);
  return readNumberField3(payload, "nodeId", "node_id");
};
var readScopeRecoId = (scope) => {
  const payload = readScopePayload(scope);
  return readNumberField3(payload, "recoId", "reco_id");
};
var readScopeActionId = (scope) => {
  const payload = readScopePayload(scope);
  return readNumberField3(payload, "actionId", "action_id");
};
var readScopeWaitFreezesId = (scope) => {
  const payload = readScopePayload(scope);
  return readNumberField3(payload, "wfId", "wf_id");
};
var normalizeNextList = (value) => {
  if (!Array.isArray(value))
    return [];
  return value.map((item) => {
    const record = readRecord3(item) ?? {};
    return {
      name: readStringField2(record, "name") ?? "",
      anchor: record.anchor === true,
      jump_back: record.jumpBack === true || record.jump_back === true
    };
  });
};
var normalizeNodeDetails = (value) => {
  const record = readRecord3(value);
  if (!record)
    return void 0;
  return {
    action_id: readNumberField3(record, "actionId", "action_id") ?? 0,
    completed: record.completed === true,
    name: readStringField2(record, "name") ?? "",
    node_id: readNumberField3(record, "nodeId", "node_id") ?? 0,
    reco_id: readNumberField3(record, "recoId", "reco_id") ?? 0
  };
};
var normalizeRecognitionDetail = (value) => {
  const record = readRecord3(value);
  if (!record)
    return void 0;
  const box = Array.isArray(record.box) && record.box.length === 4 ? record.box : null;
  return {
    reco_id: readNumberField3(record, "recoId", "reco_id") ?? 0,
    algorithm: readStringField2(record, "algorithm") ?? "",
    box,
    detail: record.detail,
    name: readStringField2(record, "name") ?? ""
  };
};
var normalizeActionDetail = (value) => {
  const record = readRecord3(value);
  if (!record)
    return void 0;
  const box = Array.isArray(record.box) && record.box.length === 4 ? record.box : [0, 0, 0, 0];
  return {
    action_id: readNumberField3(record, "actionId", "action_id") ?? 0,
    action: readStringField2(record, "action") ?? "",
    box,
    detail: record.detail,
    name: readStringField2(record, "name") ?? "",
    success: record.success === true,
    ts: readStringField2(record, "ts"),
    end_ts: readStringField2(record, "endTs", "end_ts")
  };
};
var normalizeResourceLoadingDetail = (scope) => {
  const payload = readScopePayload(scope);
  const resId = readNumberField3(payload, "resId", "res_id");
  const path8 = readStringField2(payload, "path");
  const resourceType = readStringField2(payload, "resourceType", "resource_type");
  const hash = readStringField2(payload, "hash");
  if (resId == null && !path8 && !resourceType && !hash)
    return void 0;
  return {
    res_id: resId ?? 0,
    path: path8,
    resource_type: resourceType,
    hash
  };
};
var readLastPathSegment = (path8) => {
  if (!path8)
    return void 0;
  const normalized = path8.replace(/[\\/]+$/, "");
  if (!normalized)
    return void 0;
  const segments = normalized.split(/[\\/]/).filter(Boolean);
  return segments[segments.length - 1] ?? normalized;
};
var resolveResourceLoadingName = (scope) => {
  const payload = readScopePayload(scope);
  const path8 = readStringField2(payload, "path");
  return readLastPathSegment(path8) ?? readStringField2(payload, "resourceType", "resource_type") ?? readStringField2(payload, "hash") ?? "Resource.Loading";
};
var normalizeWaitFreezesDetail = (scope, options) => {
  const payload = readScopePayload(scope);
  const roi = Array.isArray(payload.roi) && payload.roi.length === 4 ? payload.roi : void 0;
  const recoIds = Array.isArray(payload.recoIds) ? payload.recoIds.filter((value) => typeof value === "number") : void 0;
  const images = options.waitFreezesImagesByScopeId?.get(scope.id);
  return {
    wf_id: readScopeWaitFreezesId(scope) ?? 0,
    phase: readStringField2(payload, "waitPhase", "phase"),
    elapsed: readNumberField3(payload, "elapsed"),
    reco_ids: recoIds,
    roi,
    param: readRecord3(payload.param),
    focus: payload.focus,
    images: images ? [...images] : void 0
  };
};
var readNestedDetailName = (payload, field) => {
  return readStringField2(readRecord3(payload[field]) ?? {}, "name");
};
var findErrorImageByNames = (options, timestamp, candidateNames) => {
  const source = options.errorImages ?? EMPTY_IMAGE_MAP;
  if (source.size === 0)
    return void 0;
  for (const candidate of candidateNames) {
    if (!candidate)
      continue;
    const matched = findImageByTimestampSuffix(source, timestamp, `_${candidate}`);
    if (matched)
      return matched;
  }
  return void 0;
};
var resolveScopeErrorImage = (scope, options, candidateNames) => {
  if (scope.status !== "failed")
    return void 0;
  return findErrorImageByNames(options, scope.endTs ?? scope.ts, candidateNames);
};
var resolveScopeVisionImage = (scope, options, name, recoId) => {
  if (recoId == null)
    return void 0;
  return findImageByTimestampSuffix(options.visionImages ?? EMPTY_IMAGE_MAP, scope.endTs ?? scope.ts, `_${name}_${recoId}`);
};
var summarizeFlowItemStatus = (items) => {
  if (items.some((item) => item.status === "failed"))
    return "failed";
  if (items.some((item) => item.status === "running"))
    return "running";
  return "success";
};
var runtimeStatusToTaskStatus = (status) => {
  if (status === "failed")
    return "failed";
  if (status === "running")
    return "running";
  return "succeeded";
};
var buildDuration = (startTime, endTime) => {
  if (!endTime)
    return void 0;
  const startMs = Date.parse(startTime);
  const endMs = Date.parse(endTime);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs))
    return void 0;
  return Math.max(0, endMs - startMs);
};
var shouldSynthesizeForeignTaskGroup = (parentScope, childScope) => {
  if (childScope.kind !== "pipeline_node")
    return false;
  const parentTaskId = readScopeTaskId(parentScope);
  const childTaskId = readScopeTaskId(childScope);
  if (parentTaskId == null || childTaskId == null)
    return false;
  return parentTaskId !== childTaskId;
};
var projectSyntheticTaskFlowItem = (parentScope, groupedScopes, context) => {
  const firstScope = groupedScopes[0];
  const lastScope = groupedScopes[groupedScopes.length - 1];
  const taskId = readScopeTaskId(firstScope) ?? 0;
  const children = groupedScopes.flatMap((scope) => projectFlowScope(scope, context));
  const status = summarizeFlowItemStatus(children);
  const name = readScopeName(firstScope);
  return {
    id: `${parentScope.id}.synthetic-task.${taskId}.seq${firstScope.seq}`,
    type: "task",
    name,
    status,
    ts: firstScope.ts,
    end_ts: lastScope?.endTs,
    task_id: taskId,
    task_details: {
      task_id: taskId,
      entry: name,
      status: toTaskStatus(status === "running" ? "running" : status === "failed" ? "failed" : "succeeded"),
      ts: firstScope.ts,
      end_ts: lastScope?.endTs
    },
    children: children.length > 0 ? children : void 0
  };
};
var collectTaskScopes = (scope, output) => {
  for (const child of scope.children) {
    if (child.kind === "task") {
      output.push(child);
    }
    collectTaskScopes(child, output);
  }
};
var buildNextTaskOccurrenceSeq = (scopes) => {
  const nextSeqByScope = /* @__PURE__ */ new Map();
  const nextSeqByTaskAndSource = /* @__PURE__ */ new Map();
  for (let index = scopes.length - 1; index >= 0; index -= 1) {
    const scope = scopes[index];
    if (!scope)
      continue;
    const taskId = readScopeTaskId(scope);
    if (taskId == null)
      continue;
    const key = `${taskId}\0${readScopeSourceKey2(scope) ?? ""}`;
    const nextSeq = nextSeqByTaskAndSource.get(key);
    if (nextSeq != null) {
      nextSeqByScope.set(scope, nextSeq);
    }
    nextSeqByTaskAndSource.set(key, scope.seq);
  }
  return nextSeqByScope;
};
var readTaskEventTaskId = (event) => {
  const details = readRecord3(event.details);
  if (!details)
    return void 0;
  return readNumberField3(details, "taskId", "task_id");
};
var eventTimestampMsCache = /* @__PURE__ */ new WeakMap();
var getEventTimestampMs = (event) => {
  const cached = eventTimestampMsCache.get(event);
  if (cached !== void 0)
    return cached;
  const parsed = toTimestampMs(event.timestamp);
  eventTimestampMsCache.set(event, parsed);
  return parsed;
};
var readScopeSourceKey2 = (scope) => {
  const source = readRecord3(readScopePayload(scope).source);
  return source ? readStringField2(source, "sourceKey") : void 0;
};
var copyTaskEvent = (event) => ({
  timestamp: event.timestamp,
  level: event.level,
  message: event.message,
  details: event.details,
  _lineNumber: event._lineNumber
});
var findFirstSequencedEventIndex = (events, targetSeq) => {
  let low = 0;
  let high = events.length;
  while (low < high) {
    const middle = low + Math.floor((high - low) / 2);
    const event = events[middle];
    if (event && event.seq < targetSeq) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }
  return low;
};
var projectTaskEvents = (scope, options, nextOccurrenceSeq) => {
  const taskId = readScopeTaskId(scope);
  const sequencedEvents = taskId == null ? void 0 : options.sequencedEventsByTaskId?.get(taskId);
  if (taskId != null && sequencedEvents) {
    const sourceKey = readScopeSourceKey2(scope);
    const scopeEndSeq = scope.endSeq ?? Number.POSITIVE_INFINITY;
    const occurrenceEndSeq = nextOccurrenceSeq == null ? scopeEndSeq : Math.min(scopeEndSeq, nextOccurrenceSeq - 1);
    const projectedEvents = [];
    const firstEventIndex = findFirstSequencedEventIndex(sequencedEvents, scope.seq);
    for (let index = firstEventIndex; index < sequencedEvents.length; index += 1) {
      const item = sequencedEvents[index];
      if (!item || item.seq > occurrenceEndSeq)
        break;
      if (sourceKey != null && item.sourceKey !== sourceKey)
        continue;
      projectedEvents.push(copyTaskEvent(item.event));
    }
    return projectedEvents;
  }
  const events = taskId == null ? void 0 : options.eventsByTaskId?.get(taskId) ?? options.events;
  if (taskId == null || !events || events.length === 0)
    return [];
  const startMs = toTimestampMs(scope.ts);
  const endMs = scope.endTs ? toTimestampMs(scope.endTs) : Number.POSITIVE_INFINITY;
  return events.filter((event) => {
    if (readTaskEventTaskId(event) !== taskId)
      return false;
    const eventMs = getEventTimestampMs(event);
    if (!Number.isFinite(startMs) || !Number.isFinite(eventMs))
      return true;
    return eventMs >= startMs && eventMs <= endMs + 1;
  }).map(copyTaskEvent);
};
var projectFlowChildren = (scope, context) => {
  const items = [];
  const children = sortScopesBySeq2(scope.children);
  for (let index = 0; index < children.length; index += 1) {
    const child = children[index];
    if (shouldSynthesizeForeignTaskGroup(scope, child)) {
      const groupedScopes = [child];
      const groupedTaskId = readScopeTaskId(child);
      while (index + 1 < children.length) {
        const next = children[index + 1];
        if (!shouldSynthesizeForeignTaskGroup(scope, next) || readScopeTaskId(next) !== groupedTaskId) {
          break;
        }
        groupedScopes.push(next);
        index += 1;
      }
      items.push(projectSyntheticTaskFlowItem(scope, groupedScopes, context));
      continue;
    }
    items.push(...projectFlowScope(child, context));
  }
  return items;
};
var projectTaskFlowItem = (scope, context) => {
  const payload = readScopePayload(scope);
  const children = projectFlowChildren(scope, {
    currentTaskId: readScopeTaskId(scope),
    options: context.options
  });
  return {
    id: scope.id,
    type: "task",
    name: readStringField2(payload, "entry") ?? readScopeName(scope),
    status: toRuntimeStatus(scope.status),
    ts: scope.ts,
    end_ts: scope.endTs,
    task_id: readScopeTaskId(scope),
    task_details: {
      task_id: readScopeTaskId(scope) ?? 0,
      entry: readStringField2(payload, "entry"),
      hash: readStringField2(payload, "hash"),
      uuid: readStringField2(payload, "uuid"),
      status: toTaskStatus(scope.status),
      ts: scope.ts,
      end_ts: scope.endTs
    },
    children: children.length > 0 ? children : void 0
  };
};
var projectPipelineNodeFlowItem = (scope, context) => {
  const payload = readScopePayload(scope);
  const nodeId = readScopeNodeId(scope) ?? context.currentNodeId;
  const nodeName = readScopeName(scope);
  const children = projectFlowChildren(scope, {
    currentTaskId: readScopeTaskId(scope) ?? context.currentTaskId,
    currentNodeId: nodeId,
    options: context.options
  });
  return {
    id: scope.id,
    type: "pipeline_node",
    name: nodeName,
    status: toRuntimeStatus(scope.status),
    ts: scope.ts,
    end_ts: scope.endTs,
    task_id: readScopeTaskId(scope),
    node_id: nodeId,
    focus: payload.focus,
    reco_details: normalizeRecognitionDetail(payload.recoDetails),
    action_details: normalizeActionDetail(payload.actionDetails),
    error_image: resolveScopeErrorImage(scope, context.options, [
      nodeName,
      readNestedDetailName(payload, "actionDetails"),
      readNestedDetailName(payload, "recoDetails")
    ]),
    children: children.length > 0 ? children : void 0
  };
};
var projectResourceLoadingFlowItem = (scope, context) => {
  const children = projectFlowChildren(scope, context);
  return {
    id: scope.id,
    type: "resource_loading",
    name: resolveResourceLoadingName(scope),
    status: toRuntimeStatus(scope.status),
    ts: scope.ts,
    end_ts: scope.endTs,
    task_id: readScopeTaskId(scope) ?? context.currentTaskId,
    node_id: context.currentNodeId,
    resource_loading_details: normalizeResourceLoadingDetail(scope),
    children: children.length > 0 ? children : void 0
  };
};
var projectRecognitionFlowItem = (scope, context) => {
  const payload = readScopePayload(scope);
  const name = readScopeName(scope);
  const recoId = readScopeRecoId(scope);
  const children = projectFlowChildren(scope, context);
  return {
    id: scope.id,
    type: "recognition",
    name,
    status: toRuntimeStatus(scope.status),
    ts: scope.ts,
    end_ts: scope.endTs,
    reco_id: recoId,
    focus: payload.focus,
    anchor_name: readStringField2(payload, "anchor"),
    reco_details: normalizeRecognitionDetail(payload.recoDetails),
    error_image: resolveScopeErrorImage(scope, context.options, [
      name,
      readNestedDetailName(payload, "recoDetails")
    ]),
    vision_image: resolveScopeVisionImage(scope, context.options, name, recoId),
    children: children.length > 0 ? children : void 0
  };
};
var projectRecognitionNodeFlowItem = (scope, context) => {
  const payload = readScopePayload(scope);
  const nodeId = readScopeNodeId(scope) ?? context.currentNodeId;
  const name = readScopeName(scope);
  const recoId = readScopeRecoId(scope);
  const children = projectFlowChildren(scope, {
    currentNodeId: nodeId,
    options: context.options
  });
  return {
    id: scope.id,
    type: "recognition_node",
    name,
    status: toRuntimeStatus(scope.status),
    ts: scope.ts,
    end_ts: scope.endTs,
    task_id: readScopeTaskId(scope),
    node_id: nodeId,
    reco_id: recoId,
    focus: payload.focus,
    reco_details: normalizeRecognitionDetail(payload.recoDetails),
    error_image: resolveScopeErrorImage(scope, context.options, [
      name,
      readNestedDetailName(payload, "recoDetails")
    ]),
    vision_image: resolveScopeVisionImage(scope, context.options, name, recoId),
    children: children.length > 0 ? children : void 0
  };
};
var projectActionFlowItem = (scope, context) => {
  const payload = readScopePayload(scope);
  const name = readScopeName(scope);
  const children = projectFlowChildren(scope, context);
  return {
    id: scope.id,
    type: "action",
    name,
    status: toRuntimeStatus(scope.status),
    ts: scope.ts,
    end_ts: scope.endTs,
    action_id: readScopeActionId(scope),
    focus: payload.focus,
    action_details: normalizeActionDetail(payload.actionDetails),
    error_image: resolveScopeErrorImage(scope, context.options, [
      name,
      readNestedDetailName(payload, "actionDetails")
    ]),
    children: children.length > 0 ? children : void 0
  };
};
var projectActionNodeFlowItem = (scope, context) => {
  const payload = readScopePayload(scope);
  const nodeId = readScopeNodeId(scope) ?? context.currentNodeId;
  const name = readScopeName(scope);
  const children = projectFlowChildren(scope, {
    currentNodeId: nodeId,
    options: context.options
  });
  return {
    id: scope.id,
    type: "action_node",
    name,
    status: toRuntimeStatus(scope.status),
    ts: scope.ts,
    end_ts: scope.endTs,
    task_id: readScopeTaskId(scope),
    node_id: nodeId,
    action_id: readScopeActionId(scope),
    focus: payload.focus,
    action_details: normalizeActionDetail(payload.actionDetails),
    error_image: resolveScopeErrorImage(scope, context.options, [
      name,
      readNestedDetailName(payload, "actionDetails")
    ]),
    children: children.length > 0 ? children : void 0
  };
};
var projectWaitFreezesFlowItem = (scope, context) => {
  const payload = readScopePayload(scope);
  const children = projectFlowChildren(scope, context);
  return {
    id: scope.id,
    type: "wait_freezes",
    name: readScopeName(scope),
    status: toRuntimeStatus(scope.status),
    ts: scope.ts,
    end_ts: scope.endTs,
    task_id: readScopeTaskId(scope),
    node_id: context.currentNodeId,
    focus: payload.focus,
    wait_freezes_details: normalizeWaitFreezesDetail(scope, context.options),
    children: children.length > 0 ? children : void 0
  };
};
var projectFlowScope = (scope, context) => {
  switch (scope.kind) {
    case "task":
      return [projectTaskFlowItem(scope, context)];
    case "pipeline_node":
      return [projectPipelineNodeFlowItem(scope, context)];
    case "resource_loading":
      return [projectResourceLoadingFlowItem(scope, context)];
    case "recognition":
      return [projectRecognitionFlowItem(scope, context)];
    case "recognition_node":
      return [projectRecognitionNodeFlowItem(scope, context)];
    case "action":
      return [projectActionFlowItem(scope, context)];
    case "action_node":
      return [projectActionNodeFlowItem(scope, context)];
    case "wait_freezes":
      return [projectWaitFreezesFlowItem(scope, context)];
    case "next_list":
      return sortScopesBySeq2(scope.children).flatMap((child) => projectFlowScope(child, context));
    case "controller_action":
    case "trace_root":
      return [];
  }
};
var resolveNodeNextList = (scope) => {
  let nextList = [];
  for (const child of sortScopesBySeq2(scope.children)) {
    if (child.kind !== "next_list")
      continue;
    const payload = readScopePayload(child);
    nextList = normalizeNextList(payload.list);
  }
  return nextList;
};
var projectPipelineNodeScope = (scope, options) => {
  const payload = readScopePayload(scope);
  const nodeId = readScopeNodeId(scope) ?? 0;
  const taskId = readScopeTaskId(scope) ?? 0;
  const nodeName = readScopeName(scope);
  const nodeFlow = projectFlowChildren(scope, {
    currentTaskId: taskId,
    currentNodeId: nodeId,
    options
  });
  return {
    node_id: nodeId,
    name: nodeName,
    ts: scope.ts,
    end_ts: scope.endTs,
    status: toRuntimeStatus(scope.status),
    task_id: taskId,
    reco_details: normalizeRecognitionDetail(payload.recoDetails),
    action_details: normalizeActionDetail(payload.actionDetails),
    focus: payload.focus,
    next_list: resolveNodeNextList(scope),
    node_flow: nodeFlow,
    node_details: normalizeNodeDetails(payload.nodeDetails),
    error_image: resolveScopeErrorImage(scope, options, [
      nodeName,
      readNestedDetailName(payload, "actionDetails"),
      readNestedDetailName(payload, "recoDetails")
    ])
  };
};
var projectTaskScope = (scope, options, nextOccurrenceSeq) => {
  const payload = readScopePayload(scope);
  const pipelineScopes = sortScopesBySeq2(scope.children).filter((child) => child.kind === "pipeline_node");
  const nodes = pipelineScopes.map((pipelineScope) => projectPipelineNodeScope(pipelineScope, options));
  return {
    task_id: readScopeTaskId(scope) ?? 0,
    entry: readStringField2(payload, "entry") ?? readScopeName(scope),
    hash: readStringField2(payload, "hash") ?? "",
    uuid: readStringField2(payload, "uuid") ?? "",
    _startEventIndex: scope.seq,
    start_time: scope.ts,
    end_time: scope.endTs,
    status: toTaskStatus(scope.status),
    nodes,
    events: projectTaskEvents(scope, options, nextOccurrenceSeq),
    duration: buildDuration(scope.ts, scope.endTs)
  };
};
var projectTaskScopeWithCache = (scope, options, nextOccurrenceSeq) => {
  const endSeq = scope.endSeq;
  const canCache = scope.status !== "running" && endSeq != null;
  if (!canCache || !options.completedTaskCache) {
    return projectTaskScope(scope, options, nextOccurrenceSeq);
  }
  const cached = options.completedTaskCache.get(scope.id);
  if (cached?.endSeq === endSeq)
    return cached.task;
  const task = projectTaskScope(scope, options, nextOccurrenceSeq);
  options.completedTaskCache.set(scope.id, { endSeq, task });
  return task;
};
var collectRootResourceScopeGroups = (root) => {
  const groups = [];
  let currentGroup = [];
  for (const child of sortScopesBySeq2(root.children)) {
    if (child.kind === "resource_loading") {
      currentGroup.push(child);
      continue;
    }
    if (currentGroup.length > 0) {
      groups.push(currentGroup);
      currentGroup = [];
    }
  }
  if (currentGroup.length > 0) {
    groups.push(currentGroup);
  }
  return groups;
};
var projectRootResourceTaskEntry = (groupedScopes, options, groupIndex) => {
  const firstScope = groupedScopes[0];
  const lastScope = groupedScopes[groupedScopes.length - 1];
  if (!firstScope || !lastScope)
    return null;
  const taskUuid = `synthetic:resource_loading:${groupIndex + 1}:seq${firstScope.seq}`;
  const taskId = 0;
  const nodeId = 0;
  const nodeFlow = groupedScopes.flatMap((scope) => projectFlowScope(scope, {
    currentTaskId: taskId,
    currentNodeId: nodeId,
    options
  }));
  const runtimeStatus = summarizeFlowItemStatus(nodeFlow);
  const endTime = lastScope.endTs;
  const task = {
    task_id: taskId,
    entry: "[Global] Resource.Loading",
    hash: "",
    uuid: taskUuid,
    _startEventIndex: firstScope.seq,
    start_time: firstScope.ts,
    end_time: endTime,
    status: runtimeStatusToTaskStatus(runtimeStatus),
    nodes: [{
      node_id: nodeId,
      name: "Resource.Loading",
      ts: firstScope.ts,
      end_ts: endTime,
      status: runtimeStatus,
      task_id: taskId,
      next_list: [],
      node_flow: nodeFlow
    }],
    events: [],
    duration: buildDuration(firstScope.ts, endTime)
  };
  return {
    seq: firstScope.seq,
    task
  };
};
var projectTasksFromTrace = (root, options = {}) => {
  const projectionOptions = {
    ...options,
    waitFreezesImagesByScopeId: buildWaitFreezesImageAssignments(root, options.waitFreezesImages ?? EMPTY_IMAGE_MAP)
  };
  const taskScopes = [];
  collectTaskScopes(root, taskScopes);
  const sortedTaskScopes = sortScopesBySeq2(taskScopes);
  const nextOccurrenceSeqByScope = buildNextTaskOccurrenceSeq(sortedTaskScopes);
  const projectedTaskEntries = sortedTaskScopes.map((scope) => ({
    seq: scope.seq,
    task: projectTaskScopeWithCache(scope, projectionOptions, nextOccurrenceSeqByScope.get(scope))
  }));
  const rootResourceTaskEntries = collectRootResourceScopeGroups(root).map((groupedScopes, groupIndex) => projectRootResourceTaskEntry(groupedScopes, projectionOptions, groupIndex)).filter((entry) => !!entry);
  return mergeProjectedTaskEntries(projectedTaskEntries, rootResourceTaskEntries).map(({ task }) => task).filter((task) => task.entry !== "MaaTaskerPostStop");
};

// ../../node_modules/.pnpm/@windsland52+maa-log-parser@1.1.0/node_modules/@windsland52/maa-log-parser/dist/raw/store.js
var createRawLineStore = () => ({
  sources: /* @__PURE__ */ new Map()
});
var cloneRawLineStore = (store) => {
  if (!store)
    return null;
  const cloned = createRawLineStore();
  for (const source of store.sources.values()) {
    cloned.sources.set(source.sourceKey, {
      sourceKey: source.sourceKey,
      sourcePath: source.sourcePath,
      inputIndex: source.inputIndex,
      lines: source.lines.slice()
    });
  }
  return cloned;
};
var adoptRawLineSource = (store, source) => {
  const adopted = {
    sourceKey: source.sourceKey,
    sourcePath: source.sourcePath,
    inputIndex: source.inputIndex,
    lines: source.lines
  };
  store.sources.set(adopted.sourceKey, adopted);
  return adopted;
};

// ../../node_modules/.pnpm/@windsland52+maa-log-parser@1.1.0/node_modules/@windsland52/maa-log-parser/dist/core/snapshotIsolation.js
var isObject = (value) => value !== null && typeof value === "object";
var cloneSnapshotData = (value, seen = /* @__PURE__ */ new WeakMap()) => {
  if (!isObject(value))
    return value;
  const existing = seen.get(value);
  if (existing !== void 0)
    return existing;
  if (Array.isArray(value)) {
    const result2 = [];
    seen.set(value, result2);
    for (const item of value)
      result2.push(cloneSnapshotData(item, seen));
    return result2;
  }
  const result = Object.create(Object.getPrototypeOf(value));
  seen.set(value, result);
  for (const key of Reflect.ownKeys(value)) {
    result[key] = cloneSnapshotData(value[key], seen);
  }
  return result;
};
var freezeSnapshotData = (value, seen = /* @__PURE__ */ new WeakSet()) => {
  if (!isObject(value) || seen.has(value))
    return value;
  seen.add(value);
  for (const key of Reflect.ownKeys(value)) {
    freezeSnapshotData(value[key], seen);
  }
  return Object.freeze(value);
};

// ../../node_modules/.pnpm/@windsland52+maa-log-parser@1.1.0/node_modules/@windsland52/maa-log-parser/dist/core/logParser.js
var normalizeParseSourceInputs = (inputs) => {
  const indexedInputs = inputs.map((input, index) => ({
    ...input,
    inputIndex: input.inputIndex ?? index
  }));
  const baseKeys = indexedInputs.map((input) => {
    if (input.sourceKey?.trim())
      return input.sourceKey;
    if (input.sourcePath?.trim())
      return input.sourcePath;
    return `input:${input.inputIndex}`;
  });
  const reservedKeys = new Set(baseKeys);
  const usedKeys = /* @__PURE__ */ new Set();
  const nextSuffixByBaseKey = /* @__PURE__ */ new Map();
  return indexedInputs.map((input, index) => {
    const baseKey = baseKeys[index];
    let sourceKey = baseKey;
    if (usedKeys.has(sourceKey)) {
      let suffix = nextSuffixByBaseKey.get(baseKey) ?? 2;
      do {
        sourceKey = `${baseKey}#${suffix}`;
        suffix += 1;
      } while (usedKeys.has(sourceKey) || reservedKeys.has(sourceKey));
      nextSuffixByBaseKey.set(baseKey, suffix);
    } else {
      nextSuffixByBaseKey.set(baseKey, 2);
    }
    usedKeys.add(sourceKey);
    return {
      ...input,
      sourceKey
    };
  });
};
var defaultParseYieldControl = async () => {
  if (typeof MessageChannel !== "undefined") {
    await new Promise((resolve) => {
      const channel = new MessageChannel();
      channel.port1.onmessage = () => resolve();
      channel.port2.postMessage(null);
    });
  } else {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
};
var forceCopyString = (value) => {
  if (!value)
    return "";
  return (" " + value).slice(1);
};
var CROSS_SOURCE_DUPLICATE_WINDOW_MS = 1e3;
var MAX_DEDUP_SIGNATURES = 16384;
var LogParser = class {
  constructor() {
    this.events = [];
    this.protocolEvents = [];
    this.traceReducer = createIncrementalTraceReducer();
    this.sequencedEventsByTaskId = /* @__PURE__ */ new Map();
    this.completedTaskCache = /* @__PURE__ */ new Map();
    this.rawLines = null;
    this.eventTokenPool = /* @__PURE__ */ new Map();
    this.lastEventBySignature = /* @__PURE__ */ new Map();
    this.dedupSignatureTimeline = [];
    this.dedupSignatureTimelineHead = 0;
    this.syntheticLineNumber = 1;
    this.errorImages = /* @__PURE__ */ new Map();
    this.visionImages = /* @__PURE__ */ new Map();
    this.waitFreezesImages = /* @__PURE__ */ new Map();
    this.fullParseInProgress = false;
  }
  /**
   * 设置错误截图映射
   */
  setErrorImages(images) {
    this.errorImages = images;
    this.completedTaskCache.clear();
  }
  /**
   * 设置 vision 调试截图映射
   * key 格式: YYYY.MM.DD-HH.MM.SS.ms_NodeName_RecoId
   */
  setVisionImages(images) {
    this.visionImages = images;
    this.completedTaskCache.clear();
  }
  /**
   * 设置 wait_freezes 调试截图映射
   * key 格式: YYYY.MM.DD-HH.MM.SS.ms_NodeName_wait_freezes
   */
  setWaitFreezesImages(images) {
    this.waitFreezesImages = images;
    this.completedTaskCache.clear();
  }
  resetParsedEvents() {
    this.events = [];
    this.protocolEvents = [];
    this.traceReducer.reset();
    this.sequencedEventsByTaskId.clear();
    this.completedTaskCache.clear();
    this.rawLines = null;
    this.lastEventBySignature.clear();
    this.dedupSignatureTimeline = [];
    this.dedupSignatureTimelineHead = 0;
    this.eventTokenPool.clear();
    this.syntheticLineNumber = 1;
  }
  pruneDedupSignatures(currentTimestampMs) {
    if (!Number.isFinite(currentTimestampMs))
      return;
    const pruneBefore = currentTimestampMs - CROSS_SOURCE_DUPLICATE_WINDOW_MS;
    while (this.dedupSignatureTimelineHead < this.dedupSignatureTimeline.length) {
      const item = this.dedupSignatureTimeline[this.dedupSignatureTimelineHead];
      if (!item || !Number.isFinite(item.timestampMs) || item.timestampMs >= pruneBefore) {
        break;
      }
      const mapped = this.lastEventBySignature.get(item.signature);
      if (mapped && mapped.timestampMs === item.timestampMs) {
        this.lastEventBySignature.delete(item.signature);
      }
      this.dedupSignatureTimelineHead += 1;
    }
    if (this.dedupSignatureTimelineHead > 4096 && this.dedupSignatureTimelineHead * 2 >= this.dedupSignatureTimeline.length) {
      this.dedupSignatureTimeline = this.dedupSignatureTimeline.slice(this.dedupSignatureTimelineHead);
      this.dedupSignatureTimelineHead = 0;
    }
  }
  pruneDedupSignatureCapacity() {
    while (this.dedupSignatureTimeline.length - this.dedupSignatureTimelineHead > MAX_DEDUP_SIGNATURES) {
      const item = this.dedupSignatureTimeline[this.dedupSignatureTimelineHead];
      if (item) {
        const mapped = this.lastEventBySignature.get(item.signature);
        if (mapped?.timestampMs === item.timestampMs) {
          this.lastEventBySignature.delete(item.signature);
        }
      }
      this.dedupSignatureTimelineHead += 1;
    }
  }
  internEventToken(raw) {
    const copied = forceCopyString(raw);
    const pooled = this.eventTokenPool.get(copied);
    if (pooled)
      return pooled;
    this.eventTokenPool.set(copied, copied);
    return copied;
  }
  ensureRawLineStore() {
    if (!this.rawLines) {
      this.rawLines = createRawLineStore();
    }
    return this.rawLines;
  }
  appendEvent(event, sourceOptions) {
    this.pruneDedupSignatures(event._timestampMs);
    const previous = this.lastEventBySignature.get(event._dedupSignature);
    const eventMs = event._timestampMs;
    const nearInTime = previous && Number.isFinite(previous.timestampMs) && Number.isFinite(eventMs) ? Math.abs(eventMs - previous.timestampMs) <= CROSS_SOURCE_DUPLICATE_WINDOW_MS : false;
    const fromDifferentSource = previous ? previous.processId !== event.processId || previous.threadId !== event.threadId : false;
    if (previous && nearInTime && fromDifferentSource) {
      return;
    }
    const storedEvent = {
      timestamp: event.timestamp,
      level: event.level,
      message: event.message,
      details: event.details,
      _lineNumber: event._lineNumber
    };
    const protocolEvent = createProtocolEvent(event, {
      seq: this.protocolEvents.length + 1,
      sourceKey: sourceOptions?.sourceKey,
      sourcePath: sourceOptions?.sourcePath,
      inputIndex: sourceOptions?.inputIndex
    });
    this.events.push(storedEvent);
    if (protocolEvent) {
      this.protocolEvents.push(protocolEvent);
      this.traceReducer.append(protocolEvent);
      if ("taskId" in protocolEvent && protocolEvent.taskId != null) {
        const sequencedEvent = {
          seq: protocolEvent.seq,
          sourceKey: protocolEvent.source.sourceKey,
          event: storedEvent
        };
        const taskEvents = this.sequencedEventsByTaskId.get(protocolEvent.taskId);
        if (taskEvents) {
          taskEvents.push(sequencedEvent);
        } else {
          this.sequencedEventsByTaskId.set(protocolEvent.taskId, [sequencedEvent]);
        }
      }
    }
    if (Number.isFinite(eventMs)) {
      this.lastEventBySignature.set(event._dedupSignature, {
        timestampMs: eventMs,
        processId: event.processId,
        threadId: event.threadId
      });
      this.dedupSignatureTimeline.push({
        signature: event._dedupSignature,
        timestampMs: eventMs
      });
      this.pruneDedupSignatureCapacity();
    }
  }
  appendRealtimeLines(lines) {
    if (!Array.isArray(lines) || lines.length === 0)
      return;
    for (const rawLine of lines) {
      const lineNum = this.syntheticLineNumber++;
      if (!rawLine || !rawLine.includes("!!!OnEventNotify!!!"))
        continue;
      try {
        const event = this.parseEventLine(rawLine.trim(), lineNum);
        if (!event)
          continue;
        this.appendEvent(event, {
          sourceKey: "input:0",
          inputIndex: 0
        });
      } catch (e2) {
        console.warn(`\u89E3\u6790\u5B9E\u65F6\u4E8B\u4EF6\u884C\u5931\u8D25(line=${lineNum}):`, e2);
      }
    }
  }
  /**
   * 解析日志文件内容（异步分块处理）
   * 只处理包含 !!!OnEventNotify!!! 的行
   */
  async parseSourceContent(input, runtime) {
    const content = input.content;
    const totalChars = content.length;
    const normalizedInputIndex = input.inputIndex ?? 0;
    const sourceKey = input.sourceKey ?? input.sourcePath ?? `input:${normalizedInputIndex}`;
    const sourceMeta = {
      sourceKey,
      sourcePath: input.sourcePath,
      inputIndex: normalizedInputIndex
    };
    const rawLines = runtime.storeRawLines ? [] : null;
    const chunkLineCount = runtime.chunkLineCount;
    let cursor = 0;
    let lineNum = 0;
    if (totalChars === 0) {
      if (rawLines) {
        adoptRawLineSource(this.ensureRawLineStore(), {
          ...sourceMeta,
          lines: rawLines
        });
      }
      if (runtime.onProgress) {
        const current = Math.min(runtime.progressOffset, runtime.totalChars);
        runtime.onProgress({
          current,
          total: runtime.totalChars,
          percentage: runtime.totalChars === 0 ? 100 : Math.round(current / runtime.totalChars * 100)
        });
      }
      return 0;
    }
    while (cursor <= totalChars) {
      if (runtime.yieldControl) {
        await runtime.yieldControl();
      }
      let parsedLines = 0;
      while (parsedLines < chunkLineCount && cursor <= totalChars) {
        const lineStart = cursor;
        let lineEnd = content.indexOf("\n", lineStart);
        if (lineEnd < 0)
          lineEnd = totalChars;
        const rawLine = content.slice(lineStart, lineEnd);
        if (rawLines) {
          rawLines.push(rawLine);
        }
        cursor = lineEnd < totalChars ? lineEnd + 1 : totalChars + 1;
        parsedLines += 1;
        lineNum += 1;
        if (!rawLine || !rawLine.includes("!!!OnEventNotify!!!"))
          continue;
        try {
          const event = this.parseEventLine(rawLine.trim(), lineNum);
          if (!event)
            continue;
          this.appendEvent(event, sourceMeta);
        } catch (e2) {
          console.warn(`\u89E3\u6790\u7B2C ${lineNum} \u884C\u5931\u8D25:`, e2);
        }
      }
      if (runtime.onProgress) {
        const current = Math.min(runtime.progressOffset + Math.min(cursor, totalChars), runtime.totalChars);
        runtime.onProgress({
          current,
          total: runtime.totalChars,
          percentage: runtime.totalChars === 0 ? 100 : Math.round(current / runtime.totalChars * 100)
        });
      }
    }
    if (rawLines) {
      adoptRawLineSource(this.ensureRawLineStore(), {
        ...sourceMeta,
        lines: rawLines
      });
    }
    return totalChars;
  }
  /**
   * 解析多 source 日志内容（异步分块处理）
   */
  async parseInputs(inputs, onProgress, options) {
    const chunkLineCount = options?.chunkLineCount ?? 1e3;
    if (!Number.isSafeInteger(chunkLineCount) || chunkLineCount <= 0) {
      throw new RangeError("chunkLineCount must be a positive safe integer");
    }
    if (this.fullParseInProgress) {
      throw new Error("A full parse is already in progress for this LogParser instance");
    }
    this.fullParseInProgress = true;
    try {
      this.resetParsedEvents();
      const normalizedInputs = normalizeParseSourceInputs(inputs);
      const totalChars = normalizedInputs.reduce((sum, input) => sum + input.content.length, 0);
      const yieldControl = options?.yieldControl === void 0 ? defaultParseYieldControl : options.yieldControl;
      const storeRawLines = options?.storeRawLines === true;
      if (normalizedInputs.length === 0) {
        if (onProgress) {
          onProgress({
            current: 0,
            total: 0,
            percentage: 100
          });
        }
        return;
      }
      let progressOffset = 0;
      for (const input of normalizedInputs) {
        const parsedChars = await this.parseSourceContent(input, {
          onProgress,
          chunkLineCount,
          yieldControl,
          progressOffset,
          totalChars,
          storeRawLines
        });
        progressOffset += parsedChars;
      }
      if (onProgress) {
        onProgress({
          current: totalChars,
          total: totalChars,
          percentage: 100
        });
      }
    } finally {
      this.fullParseInProgress = false;
    }
  }
  /**
   * 解析单个日志文件内容（异步分块处理）
   * 只处理包含 !!!OnEventNotify!!! 的行
   */
  async parseFile(content, onProgress, options) {
    await this.parseInputs([{
      content,
      sourceKey: options?.sourceKey,
      sourcePath: options?.sourcePath,
      inputIndex: options?.inputIndex
    }], onProgress, options);
  }
  /**
   * 直接从事件行提取所有需要的字段
   * 格式: [timestamp][level][Pxpid][Txthread][...] !!!OnEventNotify!!! [handle=xxx] [msg=EventName] [details={...json...}]
   */
  parseEventLine(line, lineNum) {
    return parseEventLine(line, lineNum, {
      internEventToken: (raw) => this.internEventToken(raw),
      forceCopyString
    });
  }
  clearConsumedParseState() {
    this.events = [];
    this.protocolEvents = [];
    this.traceReducer.reset();
    this.sequencedEventsByTaskId.clear();
    this.completedTaskCache.clear();
    this.rawLines = null;
    this.lastEventBySignature.clear();
    this.dedupSignatureTimeline = [];
    this.dedupSignatureTimelineHead = 0;
    console.log(`\u4E8B\u4EF6\u4EE4\u724C\u6C60\u7EDF\u8BA1: ${this.eventTokenPool.size} \u4E2A\u552F\u4E00\u5B57\u7B26\u4E32`);
    this.eventTokenPool.clear();
    this.syntheticLineNumber = 1;
  }
  projectTasksSnapshot(consume) {
    const trace = this.traceReducer.getTrace();
    const tasks = projectTasksFromTrace(trace, {
      sequencedEventsByTaskId: this.sequencedEventsByTaskId,
      completedTaskCache: this.completedTaskCache,
      errorImages: this.errorImages,
      visionImages: this.visionImages,
      waitFreezesImages: this.waitFreezesImages
    });
    for (const task of tasks)
      freezeSnapshotData(task);
    if (consume) {
      this.clearConsumedParseState();
    }
    return tasks;
  }
  /**
   * Project tasks from the current buffered parser state without clearing it.
   *
   * Use this for realtime/incremental consumers that need to read the current
   * task tree repeatedly as new lines arrive.
   */
  getTasksSnapshot() {
    return this.projectTasksSnapshot(false);
  }
  getEventsSnapshot() {
    return cloneSnapshotData(this.events);
  }
  getProtocolEventsSnapshot() {
    return cloneSnapshotData(this.protocolEvents);
  }
  getRawLineStoreSnapshot() {
    return cloneRawLineStore(this.rawLines);
  }
  getTraceSnapshot() {
    return buildTraceTree(this.getProtocolEventsSnapshot());
  }
  getTraceIndexSnapshot() {
    const events = this.getProtocolEventsSnapshot();
    const trace = buildTraceTree(events);
    return buildTraceIndex(trace, events);
  }
  getParseArtifactsSnapshot() {
    const events = this.getProtocolEventsSnapshot();
    const trace = buildTraceTree(events);
    const index = buildTraceIndex(trace, events);
    return {
      events,
      trace,
      index,
      rawLines: this.getRawLineStoreSnapshot() ?? void 0
    };
  }
  /**
   * Project tasks and then clear buffered parser state.
   *
   * Use this for one-shot parse flows where the caller only needs the final
   * projected task list and will not keep querying parser snapshots afterward.
   */
  consumeTasks() {
    return this.projectTasksSnapshot(true);
  }
  /**
   * 获取所有事件
   */
  getEvents() {
    return this.getEventsSnapshot();
  }
};

// ../../node_modules/.pnpm/@windsland52+maa-log-parser@1.1.0/node_modules/@windsland52/maa-log-parser/package.json
var package_default2 = {
  name: "@windsland52/maa-log-parser",
  version: "1.1.0",
  type: "module",
  private: false,
  types: "./dist/core/index.d.ts",
  exports: {
    ".": {
      import: "./dist/core/index.js",
      types: "./dist/core/index.d.ts"
    },
    "./raw-value": {
      import: "./dist/shared/rawValue.js",
      types: "./dist/shared/rawValue.d.ts"
    },
    "./protocol-types": {
      import: "./dist/protocol/types.js",
      types: "./dist/protocol/types.d.ts"
    },
    "./protocol-event-factory": {
      import: "./dist/protocol/eventFactory.js",
      types: "./dist/protocol/eventFactory.d.ts"
    },
    "./trace-scope-types": {
      import: "./dist/trace/scopeTypes.js",
      types: "./dist/trace/scopeTypes.d.ts"
    },
    "./trace-scope-id": {
      import: "./dist/trace/scopeId.js",
      types: "./dist/trace/scopeId.d.ts"
    },
    "./trace-reducer": {
      import: "./dist/trace/reducer.js",
      types: "./dist/trace/reducer.d.ts"
    },
    "./query-types": {
      import: "./dist/query/queryTypes.js",
      types: "./dist/query/queryTypes.d.ts"
    },
    "./query-locator": {
      import: "./dist/query/locator.js",
      types: "./dist/query/locator.d.ts"
    },
    "./trace-index": {
      import: "./dist/query/traceIndex.js",
      types: "./dist/query/traceIndex.d.ts"
    },
    "./query-helpers": {
      import: "./dist/query/helpers.js",
      types: "./dist/query/helpers.d.ts"
    },
    "./raw-line-store": {
      import: "./dist/raw/store.js",
      types: "./dist/raw/store.d.ts"
    },
    "./service-session-store": {
      import: "./dist/service/sessionStore.js",
      types: "./dist/service/sessionStore.d.ts"
    },
    "./service-evidence-builders": {
      import: "./dist/service/evidenceBuilders.js",
      types: "./dist/service/evidenceBuilders.d.ts"
    },
    "./service-tool-handlers": {
      import: "./dist/service/toolHandlers.js",
      types: "./dist/service/toolHandlers.d.ts"
    },
    "./service-tool-protocol": {
      import: "./dist/service/toolProtocol.js",
      types: "./dist/service/toolProtocol.d.ts"
    },
    "./types": {
      import: "./dist/shared/types.js",
      types: "./dist/shared/types.d.ts"
    },
    "./log-event-decoders": {
      import: "./dist/shared/logEventDecoders.js",
      types: "./dist/shared/logEventDecoders.d.ts"
    },
    "./node-flow": {
      import: "./dist/node/flow.js",
      types: "./dist/node/flow.d.ts"
    },
    "./timestamp": {
      import: "./dist/shared/timestamp.js",
      types: "./dist/shared/timestamp.d.ts"
    },
    "./node-statistics": {
      import: "./dist/node/statistics.js",
      types: "./dist/node/statistics.d.ts"
    }
  },
  engines: {
    node: ">=20.18.0"
  },
  publishConfig: {
    access: "public"
  },
  files: [
    "dist",
    "README.md"
  ],
  repository: {
    type: "git",
    url: "https://github.com/MaaXYZ/MaaLogAnalyzer",
    directory: "packages/maa-log-parser"
  },
  scripts: {
    typecheck: "tsc -p ./tsconfig.json",
    test: "vitest run src/__tests__",
    build: `node -e "require('node:fs').rmSync('dist',{ recursive: true, force: true })" && tsc -p ./tsconfig.build.json && node ../../scripts/fix-esm-imports.mjs ./dist`,
    clean: `node -e "require('node:fs').rmSync('dist',{ recursive: true, force: true })"`
  }
};

// ../../node_modules/.pnpm/@windsland52+maa-log-parser@1.1.0/node_modules/@windsland52/maa-log-parser/dist/version.js
var PARSER_PACKAGE_NAME = package_default2.name;
var PARSER_PACKAGE_VERSION = package_default2.version;
var DEFAULT_PARSER_VERSION = `${PARSER_PACKAGE_NAME}/${PARSER_PACKAGE_VERSION}`;

// ../../node_modules/.pnpm/@windsland52+maa-log-parser@1.1.0/node_modules/@windsland52/maa-log-parser/dist/service/sessionStore.js
var DEFAULT_IDLE_TTL_MS = 30 * 60 * 1e3;

// ../../node_modules/.pnpm/@windsland52+maa-log-parser@1.1.0/node_modules/@windsland52/maa-log-parser/dist/node/flow.js
var flowItemTimestampMs = (item) => {
  return toTimestampMs(item.ts || item.end_ts);
};
var sortFlowItems = (items) => {
  return items.map((item, index) => ({ item, index })).sort((a, b3) => {
    const delta = flowItemTimestampMs(a.item) - flowItemTimestampMs(b3.item);
    if (delta !== 0)
      return delta;
    return a.index - b3.index;
  }).map(({ item }) => item);
};
var sortFlowTree = (item) => {
  if (!item.children || item.children.length === 0)
    return item;
  const sortedChildren = sortFlowItems(item.children).map(sortFlowTree);
  return {
    ...item,
    children: sortedChildren
  };
};
var mapFlowRecognitionToAttempt = (item) => {
  const nestedNodes = (item.children ?? []).filter((child) => child.type === "recognition_node").map(mapFlowRecognitionToAttempt);
  const recoId = item.reco_id ?? item.reco_details?.reco_id;
  return {
    reco_id: typeof recoId === "number" ? recoId : 0,
    name: item.name,
    ts: item.ts,
    end_ts: item.end_ts,
    status: item.status,
    anchor_name: item.anchor_name,
    reco_details: item.reco_details,
    error_image: item.error_image,
    vision_image: item.vision_image,
    nested_nodes: nestedNodes.length > 0 ? nestedNodes : void 0
  };
};
var buildNodeFlowItems = (node) => {
  return sortFlowItems(node.node_flow ?? []).map(sortFlowTree);
};
var buildNodeRecognitionFlowItems = (node) => {
  return buildNodeFlowItems(node).filter((item) => item.type === "recognition" || item.type === "recognition_node");
};
var buildNodeRecognitionAttempts = (node) => {
  const flowAttempts = buildNodeRecognitionFlowItems(node).map(mapFlowRecognitionToAttempt);
  if (flowAttempts.length > 0)
    return flowAttempts;
  if (!node.reco_details)
    return [];
  const fallbackTimestamp = node.action_details?.ts || node.end_ts || node.ts;
  return [{
    reco_id: node.reco_details.reco_id,
    name: node.reco_details.name || node.name,
    ts: fallbackTimestamp,
    end_ts: fallbackTimestamp,
    status: node.status === "running" ? "running" : "success",
    reco_details: node.reco_details,
    error_image: node.error_image
  }];
};

// ../../node_modules/.pnpm/@windsland52+maa-log-parser@1.1.0/node_modules/@windsland52/maa-log-parser/dist/node/statistics.js
var summarizeDurations = (durations) => {
  let total = 0;
  let min = Number.POSITIVE_INFINITY;
  let max2 = Number.NEGATIVE_INFINITY;
  let count = 0;
  for (const duration of durations) {
    if (!Number.isFinite(duration))
      continue;
    total += duration;
    count += 1;
    if (duration < min)
      min = duration;
    if (duration > max2)
      max2 = duration;
  }
  if (count === 0) {
    return { total: 0, average: 0, min: 0, max: 0 };
  }
  return {
    total,
    average: total / count,
    min,
    max: max2
  };
};
var NodeStatisticsAnalyzer = class {
  static analyze(tasks) {
    const statsMap = /* @__PURE__ */ new Map();
    for (const task of tasks) {
      const nodes = task.nodes;
      for (let i2 = 0; i2 < nodes.length; i2++) {
        const node = nodes[i2];
        const nextNode = nodes[i2 + 1];
        let duration;
        const currentTime = toTimestampMs(node.ts);
        if (node.end_ts) {
          duration = toTimestampMs(node.end_ts) - currentTime;
        } else if (nextNode) {
          duration = toTimestampMs(nextNode.ts) - currentTime;
        } else if (task.end_time) {
          duration = toTimestampMs(task.end_time) - currentTime;
        } else {
          continue;
        }
        if (!Number.isFinite(duration) || duration < 0 || duration > 36e5) {
          continue;
        }
        if (node.status === "running") {
          continue;
        }
        if (!statsMap.has(node.name)) {
          statsMap.set(node.name, {
            durations: [],
            successCount: 0,
            failCount: 0
          });
        }
        const stats = statsMap.get(node.name);
        stats.durations.push(duration);
        if (node.status === "success") {
          stats.successCount++;
        } else if (node.status === "failed") {
          stats.failCount++;
        }
      }
    }
    const result = [];
    for (const [name, stats] of statsMap.entries()) {
      const durations = stats.durations;
      const count = durations.length;
      if (count === 0)
        continue;
      const durationSummary = summarizeDurations(durations);
      const settledCount = stats.successCount + stats.failCount;
      const successRate = settledCount > 0 ? stats.successCount / settledCount * 100 : 0;
      result.push({
        name,
        count,
        totalDuration: durationSummary.total,
        avgDuration: durationSummary.average,
        minDuration: durationSummary.min,
        maxDuration: durationSummary.max,
        successCount: stats.successCount,
        failCount: stats.failCount,
        successRate,
        durations
      });
    }
    result.sort((a, b3) => b3.avgDuration - a.avgDuration);
    return result;
  }
  static getTopSlowest(tasks, topN = 10) {
    const allStats = this.analyze(tasks);
    return allStats.slice(0, topN);
  }
  static getTopFrequent(tasks, topN = 10) {
    const allStats = this.analyze(tasks);
    return [...allStats].sort((a, b3) => b3.count - a.count).slice(0, topN);
  }
  static getTopFailed(tasks, topN = 10) {
    const allStats = this.analyze(tasks);
    return [...allStats].filter((s) => s.failCount > 0).sort((a, b3) => b3.failCount / b3.count - a.failCount / a.count).slice(0, topN);
  }
  static analyzeRecognitionAction(tasks) {
    const statsMap = /* @__PURE__ */ new Map();
    for (const task of tasks) {
      const nodes = task.nodes;
      for (const node of nodes) {
        const attempts = buildNodeRecognitionAttempts(node);
        if (attempts.length === 0)
          continue;
        if (!statsMap.has(node.name)) {
          statsMap.set(node.name, {
            recognitionDurations: [],
            actionDurations: [],
            recognitionAttempts: [],
            successCount: 0,
            failCount: 0
          });
        }
        const stats = statsMap.get(node.name);
        stats.recognitionAttempts.push(attempts.length);
        if (attempts.length > 0) {
          const firstAttemptTs = toTimestampMs(attempts[0].ts);
          const lastAttempt = attempts[attempts.length - 1];
          const lastAttemptTime = toTimestampMs(lastAttempt.end_ts || lastAttempt.ts);
          const recognitionDuration = lastAttemptTime - firstAttemptTs;
          if (Number.isFinite(recognitionDuration) && recognitionDuration >= 0 && recognitionDuration < 36e5) {
            stats.recognitionDurations.push(recognitionDuration);
          }
          const nodeCompleteTime = toTimestampMs(node.end_ts || node.ts);
          const actionDuration = nodeCompleteTime - lastAttemptTime;
          if (Number.isFinite(actionDuration) && actionDuration >= 0 && actionDuration < 36e5) {
            stats.actionDurations.push(actionDuration);
          }
        }
        if (node.status === "success") {
          stats.successCount++;
        } else if (node.status === "failed") {
          stats.failCount++;
        }
      }
    }
    const result = [];
    for (const [name, stats] of statsMap.entries()) {
      const count = stats.successCount + stats.failCount;
      if (count === 0)
        continue;
      const recognitionDurations = stats.recognitionDurations;
      const recognitionCount = recognitionDurations.length;
      const recognitionSummary = summarizeDurations(recognitionDurations);
      const actionDurations = stats.actionDurations;
      const actionCount = actionDurations.length;
      const actionSummary = summarizeDurations(actionDurations);
      const totalRecognitionAttempts = stats.recognitionAttempts.reduce((sum, a) => sum + a, 0);
      const avgRecognitionAttempts = totalRecognitionAttempts / stats.recognitionAttempts.length;
      const successRate = stats.successCount / count * 100;
      result.push({
        name,
        count,
        avgRecognitionDuration: recognitionSummary.average,
        minRecognitionDuration: recognitionSummary.min,
        maxRecognitionDuration: recognitionSummary.max,
        totalRecognitionDuration: recognitionSummary.total,
        recognitionCount,
        avgActionDuration: actionSummary.average,
        minActionDuration: actionSummary.min,
        maxActionDuration: actionSummary.max,
        totalActionDuration: actionSummary.total,
        actionCount,
        avgRecognitionAttempts,
        totalRecognitionAttempts,
        successCount: stats.successCount,
        failCount: stats.failCount,
        successRate
      });
    }
    result.sort((a, b3) => b3.avgActionDuration - a.avgActionDuration);
    return result;
  }
};

// ../../node_modules/.pnpm/@windsland52+maa-log-adapter@1.1.0/node_modules/@windsland52/maa-log-adapter/dist/index.js
var createMlaRuntimeAdapter = () => {
  return {
    parserVersion: DEFAULT_PARSER_VERSION,
    async parse(input) {
      const parser = new LogParser();
      parser.setErrorImages(input.errorImages ?? /* @__PURE__ */ new Map());
      parser.setVisionImages(input.visionImages ?? /* @__PURE__ */ new Map());
      parser.setWaitFreezesImages(input.waitFreezesImages ?? /* @__PURE__ */ new Map());
      await parser.parseFile(input.content, void 0, input.parseOptions);
      return {
        tasks: parser.getTasksSnapshot(),
        events: parser.getEventsSnapshot()
      };
    },
    buildStatistics(tasks) {
      return {
        nodes: NodeStatisticsAnalyzer.analyze(tasks),
        recognitionActions: NodeStatisticsAnalyzer.analyzeRecognitionAction(tasks)
      };
    }
  };
};
var mlaRuntimeAdapter = createMlaRuntimeAdapter();

// ../../node_modules/.pnpm/@windsland52+maa-log-tools@1.3.0/node_modules/@windsland52/maa-log-tools/dist/nodeInput.js
var import_promises2 = require("node:fs/promises");
var import_node_path = __toESM(require("node:path"), 1);

// ../../node_modules/.pnpm/fflate@0.8.3/node_modules/fflate/esm/index.mjs
var import_module = require("module");
var require2 = (0, import_module.createRequire)("/");
var _a;
var Worker;
var isMarkedAsUntransferable;
try {
  _a = require2("worker_threads"), Worker = _a.Worker, isMarkedAsUntransferable = _a.isMarkedAsUntransferable;
} catch (e2) {
}
var u8 = Uint8Array;
var u16 = Uint16Array;
var i32 = Int32Array;
var fleb = new u8([
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  1,
  1,
  1,
  1,
  2,
  2,
  2,
  2,
  3,
  3,
  3,
  3,
  4,
  4,
  4,
  4,
  5,
  5,
  5,
  5,
  0,
  /* unused */
  0,
  0,
  /* impossible */
  0
]);
var fdeb = new u8([
  0,
  0,
  0,
  0,
  1,
  1,
  2,
  2,
  3,
  3,
  4,
  4,
  5,
  5,
  6,
  6,
  7,
  7,
  8,
  8,
  9,
  9,
  10,
  10,
  11,
  11,
  12,
  12,
  13,
  13,
  /* unused */
  0,
  0
]);
var clim = new u8([16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15]);
var freb = function(eb, start) {
  var b3 = new u16(31);
  for (var i2 = 0; i2 < 31; ++i2) {
    b3[i2] = start += 1 << eb[i2 - 1];
  }
  var r3 = new i32(b3[30]);
  for (var i2 = 1; i2 < 30; ++i2) {
    for (var j = b3[i2]; j < b3[i2 + 1]; ++j) {
      r3[j] = j - b3[i2] << 5 | i2;
    }
  }
  return { b: b3, r: r3 };
};
var _a = freb(fleb, 2);
var fl = _a.b;
var revfl = _a.r;
fl[28] = 258, revfl[258] = 28;
var _b = freb(fdeb, 0);
var fd = _b.b;
var revfd = _b.r;
var rev = new u16(32768);
for (i = 0; i < 32768; ++i) {
  x = (i & 43690) >> 1 | (i & 21845) << 1;
  x = (x & 52428) >> 2 | (x & 13107) << 2;
  x = (x & 61680) >> 4 | (x & 3855) << 4;
  rev[i] = ((x & 65280) >> 8 | (x & 255) << 8) >> 1;
}
var x;
var i;
var hMap = (function(cd, mb, r3) {
  var s = cd.length;
  var i2 = 0;
  var l2 = new u16(mb);
  for (; i2 < s; ++i2) {
    if (cd[i2])
      ++l2[cd[i2] - 1];
  }
  var le = new u16(mb);
  for (i2 = 1; i2 < mb; ++i2) {
    le[i2] = le[i2 - 1] + l2[i2 - 1] << 1;
  }
  var co;
  if (r3) {
    co = new u16(1 << mb);
    var rvb = 15 - mb;
    for (i2 = 0; i2 < s; ++i2) {
      if (cd[i2]) {
        var sv = i2 << 4 | cd[i2];
        var r_1 = mb - cd[i2];
        var v2 = le[cd[i2] - 1]++ << r_1;
        for (var m2 = v2 | (1 << r_1) - 1; v2 <= m2; ++v2) {
          co[rev[v2] >> rvb] = sv;
        }
      }
    }
  } else {
    co = new u16(s);
    for (i2 = 0; i2 < s; ++i2) {
      if (cd[i2]) {
        co[i2] = rev[le[cd[i2] - 1]++] >> 15 - cd[i2];
      }
    }
  }
  return co;
});
var flt = new u8(288);
for (i = 0; i < 144; ++i)
  flt[i] = 8;
var i;
for (i = 144; i < 256; ++i)
  flt[i] = 9;
var i;
for (i = 256; i < 280; ++i)
  flt[i] = 7;
var i;
for (i = 280; i < 288; ++i)
  flt[i] = 8;
var i;
var fdt = new u8(32);
for (i = 0; i < 32; ++i)
  fdt[i] = 5;
var i;
var flrm = /* @__PURE__ */ hMap(flt, 9, 1);
var fdrm = /* @__PURE__ */ hMap(fdt, 5, 1);
var max = function(a) {
  var m2 = a[0];
  for (var i2 = 1; i2 < a.length; ++i2) {
    if (a[i2] > m2)
      m2 = a[i2];
  }
  return m2;
};
var bits = function(d2, p2, m2) {
  var o2 = p2 / 8 | 0;
  return (d2[o2] | d2[o2 + 1] << 8) >> (p2 & 7) & m2;
};
var bits16 = function(d2, p2) {
  var o2 = p2 / 8 | 0;
  return (d2[o2] | d2[o2 + 1] << 8 | d2[o2 + 2] << 16) >> (p2 & 7);
};
var shft = function(p2) {
  return (p2 + 7) / 8 | 0;
};
var slc = function(v2, s, e2) {
  if (s == null || s < 0)
    s = 0;
  if (e2 == null || e2 > v2.length)
    e2 = v2.length;
  return new u8(v2.subarray(s, e2));
};
var ec = [
  "unexpected EOF",
  "invalid block type",
  "invalid length/literal",
  "invalid distance",
  "stream finished",
  "no stream handler",
  ,
  // determined by compression function
  "no callback",
  "invalid UTF-8 data",
  "extra field too long",
  "date not in range 1980-2099",
  "filename too long",
  "stream finishing",
  "invalid zip data"
  // determined by unknown compression method
];
var err = function(ind, msg, nt) {
  var e2 = new Error(msg || ec[ind]);
  e2.code = ind;
  if (Error.captureStackTrace)
    Error.captureStackTrace(e2, err);
  if (!nt)
    throw e2;
  return e2;
};
var inflt = function(dat, st, buf, dict) {
  var sl = dat.length, dl = dict ? dict.length : 0;
  if (!sl || st.f && !st.l)
    return buf || new u8(0);
  var noBuf = !buf;
  var resize = noBuf || st.i != 2;
  var noSt = st.i;
  if (noBuf)
    buf = new u8(sl * 3);
  var cbuf = function(l3) {
    var bl = buf.length;
    if (l3 > bl) {
      var nbuf = new u8(Math.max(bl * 2, l3));
      nbuf.set(buf);
      buf = nbuf;
    }
  };
  var final = st.f || 0, pos = st.p || 0, bt = st.b || 0, lm = st.l, dm = st.d, lbt = st.m, dbt = st.n;
  var tbts = sl * 8;
  do {
    if (!lm) {
      final = bits(dat, pos, 1);
      var type = bits(dat, pos + 1, 3);
      pos += 3;
      if (!type) {
        var s = shft(pos) + 4, l2 = dat[s - 4] | dat[s - 3] << 8, t3 = s + l2;
        if (t3 > sl) {
          if (noSt)
            err(0);
          break;
        }
        if (resize)
          cbuf(bt + l2);
        buf.set(dat.subarray(s, t3), bt);
        st.b = bt += l2, st.p = pos = t3 * 8, st.f = final;
        continue;
      } else if (type == 1)
        lm = flrm, dm = fdrm, lbt = 9, dbt = 5;
      else if (type == 2) {
        var hLit = bits(dat, pos, 31) + 257, hcLen = bits(dat, pos + 10, 15) + 4;
        var tl = hLit + bits(dat, pos + 5, 31) + 1;
        pos += 14;
        var ldt = new u8(tl);
        var clt = new u8(19);
        for (var i2 = 0; i2 < hcLen; ++i2) {
          clt[clim[i2]] = bits(dat, pos + i2 * 3, 7);
        }
        pos += hcLen * 3;
        var clb = max(clt), clbmsk = (1 << clb) - 1;
        var clm = hMap(clt, clb, 1);
        for (var i2 = 0; i2 < tl; ) {
          var r3 = clm[bits(dat, pos, clbmsk)];
          pos += r3 & 15;
          var s = r3 >> 4;
          if (s < 16) {
            ldt[i2++] = s;
          } else {
            var c2 = 0, n3 = 0;
            if (s == 16)
              n3 = 3 + bits(dat, pos, 3), pos += 2, c2 = ldt[i2 - 1];
            else if (s == 17)
              n3 = 3 + bits(dat, pos, 7), pos += 3;
            else if (s == 18)
              n3 = 11 + bits(dat, pos, 127), pos += 7;
            while (n3--)
              ldt[i2++] = c2;
          }
        }
        var lt = ldt.subarray(0, hLit), dt = ldt.subarray(hLit);
        lbt = max(lt);
        dbt = max(dt);
        lm = hMap(lt, lbt, 1);
        dm = hMap(dt, dbt, 1);
      } else
        err(1);
      if (pos > tbts) {
        if (noSt)
          err(0);
        break;
      }
    }
    if (resize)
      cbuf(bt + 131072);
    var lms = (1 << lbt) - 1, dms = (1 << dbt) - 1;
    var lpos = pos;
    for (; ; lpos = pos) {
      var c2 = lm[bits16(dat, pos) & lms], sym = c2 >> 4;
      pos += c2 & 15;
      if (pos > tbts) {
        if (noSt)
          err(0);
        break;
      }
      if (!c2)
        err(2);
      if (sym < 256)
        buf[bt++] = sym;
      else if (sym == 256) {
        lpos = pos, lm = null;
        break;
      } else {
        var add = sym - 254;
        if (sym > 264) {
          var i2 = sym - 257, b3 = fleb[i2];
          add = bits(dat, pos, (1 << b3) - 1) + fl[i2];
          pos += b3;
        }
        var d2 = dm[bits16(dat, pos) & dms], dsym = d2 >> 4;
        if (!d2)
          err(3);
        pos += d2 & 15;
        var dt = fd[dsym];
        if (dsym > 3) {
          var b3 = fdeb[dsym];
          dt += bits16(dat, pos) & (1 << b3) - 1, pos += b3;
        }
        if (pos > tbts) {
          if (noSt)
            err(0);
          break;
        }
        if (resize)
          cbuf(bt + 131072);
        var end = bt + add;
        if (bt < dt) {
          var shift = dl - dt, dend = Math.min(dt, end);
          if (shift + bt < 0)
            err(3);
          for (; bt < dend; ++bt)
            buf[bt] = dict[shift + bt];
        }
        for (; bt < end; ++bt)
          buf[bt] = buf[bt - dt];
      }
    }
    st.l = lm, st.p = lpos, st.b = bt, st.f = final;
    if (lm)
      final = 1, st.m = lbt, st.d = dm, st.n = dbt;
  } while (!final);
  return bt != buf.length && noBuf ? slc(buf, 0, bt) : buf.subarray(0, bt);
};
var et = /* @__PURE__ */ new u8(0);
var b2 = function(d2, b3) {
  return d2[b3] | d2[b3 + 1] << 8;
};
var b4 = function(d2, b3) {
  return (d2[b3] | d2[b3 + 1] << 8 | d2[b3 + 2] << 16 | d2[b3 + 3] << 24) >>> 0;
};
var b8 = function(d2, b3) {
  return b4(d2, b3) + b4(d2, b3 + 4) * 4294967296;
};
var Inflate = /* @__PURE__ */ (function() {
  function Inflate2(opts, cb) {
    if (typeof opts == "function")
      cb = opts, opts = {};
    this.ondata = cb;
    var dict = opts && opts.dictionary && opts.dictionary.subarray(-32768);
    this.s = { i: 0, b: dict ? dict.length : 0 };
    this.o = new u8(32768);
    this.p = new u8(0);
    if (dict)
      this.o.set(dict);
  }
  Inflate2.prototype.e = function(c2) {
    if (!this.ondata)
      err(5);
    if (this.d)
      err(4);
    if (!this.p.length)
      this.p = c2;
    else if (c2.length) {
      var n3 = new u8(this.p.length + c2.length);
      n3.set(this.p), n3.set(c2, this.p.length), this.p = n3;
    }
  };
  Inflate2.prototype.c = function(final) {
    this.s.i = +(this.d = final || false);
    var bts = this.s.b;
    var dt = inflt(this.p, this.s, this.o);
    this.ondata(slc(dt, bts, this.s.b), this.d);
    this.o = slc(dt, this.s.b - 32768), this.s.b = this.o.length;
    this.p = slc(this.p, this.s.p / 8 | 0), this.s.p &= 7;
  };
  Inflate2.prototype.push = function(chunk, final) {
    this.e(chunk), this.c(final);
  };
  return Inflate2;
})();
function inflateSync(data, opts) {
  return inflt(data, { i: 2 }, opts && opts.out, opts && opts.dictionary);
}
var td = typeof TextDecoder != "undefined" && /* @__PURE__ */ new TextDecoder();
var tds = 0;
try {
  td.decode(et, { stream: true });
  tds = 1;
} catch (e2) {
}
var dutf8 = function(d2) {
  for (var r3 = "", i2 = 0; ; ) {
    var c2 = d2[i2++];
    var eb = (c2 > 127) + (c2 > 223) + (c2 > 239);
    if (i2 + eb > d2.length)
      return { s: r3, r: slc(d2, i2 - 1) };
    if (!eb)
      r3 += String.fromCharCode(c2);
    else if (eb == 3) {
      c2 = ((c2 & 15) << 18 | (d2[i2++] & 63) << 12 | (d2[i2++] & 63) << 6 | d2[i2++] & 63) - 65536, r3 += String.fromCharCode(55296 | c2 >> 10, 56320 | c2 & 1023);
    } else if (eb & 1)
      r3 += String.fromCharCode((c2 & 31) << 6 | d2[i2++] & 63);
    else
      r3 += String.fromCharCode((c2 & 15) << 12 | (d2[i2++] & 63) << 6 | d2[i2++] & 63);
  }
};
function strFromU8(dat, latin1) {
  if (latin1) {
    var r3 = "";
    for (var i2 = 0; i2 < dat.length; i2 += 16384)
      r3 += String.fromCharCode.apply(null, dat.subarray(i2, i2 + 16384));
    return r3;
  } else if (td) {
    return td.decode(dat);
  } else {
    var _a2 = dutf8(dat), s = _a2.s, r3 = _a2.r;
    if (r3.length)
      err(8);
    return s;
  }
}
var slzh = function(d2, b3) {
  return b3 + 30 + b2(d2, b3 + 26) + b2(d2, b3 + 28);
};
var zh = function(d2, b3, z) {
  var fnl = b2(d2, b3 + 28), efl = b2(d2, b3 + 30), fn = strFromU8(d2.subarray(b3 + 46, b3 + 46 + fnl), !(b2(d2, b3 + 8) & 2048)), es = b3 + 46 + fnl;
  var _a2 = z64hs(d2, es, efl, z, b4(d2, b3 + 20), b4(d2, b3 + 24), b4(d2, b3 + 42)), sc = _a2[0], su = _a2[1], off = _a2[2];
  return [b2(d2, b3 + 10), sc, su, fn, es + efl + b2(d2, b3 + 32), off];
};
var z64hs = function(d2, b3, l2, z, sc, su, off) {
  var nsc = sc == 4294967295, nsu = su == 4294967295, noff = off == 4294967295, e2 = b3 + l2;
  var nf = nsc + nsu + noff;
  if (z && nf) {
    for (; b3 + 4 < e2; b3 += 4 + b2(d2, b3 + 2)) {
      if (b2(d2, b3) == 1) {
        return [
          nsc ? b8(d2, b3 + 4 + 8 * nsu) : sc,
          nsu ? b8(d2, b3 + 4) : su,
          noff ? b8(d2, b3 + 4 + 8 * (nsu + nsc)) : off,
          1
        ];
      }
    }
    if (z < 2)
      err(13);
  }
  return [sc, su, off, 0];
};
var UnzipPassThrough = /* @__PURE__ */ (function() {
  function UnzipPassThrough2() {
  }
  UnzipPassThrough2.prototype.push = function(chunk, final) {
    this.ondata(null, chunk, final);
  };
  UnzipPassThrough2.compression = 0;
  return UnzipPassThrough2;
})();
var UnzipInflate = /* @__PURE__ */ (function() {
  function UnzipInflate2() {
    var _this = this;
    this.i = new Inflate(function(dat, final) {
      _this.ondata(null, dat, final);
    });
  }
  UnzipInflate2.prototype.push = function(chunk, final) {
    try {
      this.i.push(chunk, final);
    } catch (e2) {
      this.ondata(e2, null, final);
    }
  };
  UnzipInflate2.compression = 8;
  return UnzipInflate2;
})();
var Unzip = /* @__PURE__ */ (function() {
  function Unzip2(cb) {
    this.onfile = cb;
    this.k = [];
    this.o = {
      0: UnzipPassThrough
    };
    this.p = et;
  }
  Unzip2.prototype.push = function(chunk, final) {
    var _this = this;
    if (!this.onfile)
      err(5);
    if (!this.p)
      err(4);
    if (this.c > 0) {
      var len = Math.min(this.c, chunk.length);
      var toAdd = chunk.subarray(0, len);
      this.c -= len;
      if (this.d)
        this.d.push(toAdd, !this.c);
      else
        this.k[0].push(toAdd);
      chunk = chunk.subarray(len);
      if (chunk.length)
        return this.push(chunk, final);
    } else {
      var f = 0, i2 = 0, is = void 0, buf = void 0;
      if (!this.p.length)
        buf = chunk;
      else if (!chunk.length)
        buf = this.p;
      else {
        buf = new u8(this.p.length + chunk.length);
        buf.set(this.p), buf.set(chunk, this.p.length);
      }
      var l2 = buf.length, oc = this.c, add = oc && this.d;
      var _loop_2 = function() {
        var sig = b4(buf, i2);
        if (sig == 67324752) {
          f = 1, is = i2;
          this_1.d = null;
          this_1.c = 0;
          var bf = b2(buf, i2 + 6), cmp_1 = b2(buf, i2 + 8), u2 = bf & 2048, dd = bf & 8, fnl = b2(buf, i2 + 26), es = b2(buf, i2 + 28);
          if (l2 > i2 + 30 + fnl + es) {
            var chks_3 = [];
            this_1.k.unshift(chks_3);
            f = 2;
            var lsc = b4(buf, i2 + 18), lsu = b4(buf, i2 + 22);
            var fn_1 = strFromU8(buf.subarray(i2 + 30, i2 += 30 + fnl), !u2);
            var _a2 = z64hs(buf, i2, es, 2, lsc, lsu, 0), sc_1 = _a2[0], su_1 = _a2[1], z64 = _a2[3];
            if (dd)
              sc_1 = -1 - z64;
            i2 += es;
            this_1.c = sc_1;
            var d_1;
            var file_1 = {
              name: fn_1,
              compression: cmp_1,
              start: function() {
                if (!file_1.ondata)
                  err(5);
                if (!sc_1)
                  file_1.ondata(null, et, true);
                else {
                  var ctr = _this.o[cmp_1];
                  if (!ctr)
                    file_1.ondata(err(14, "unknown compression type " + cmp_1, 1), null, false);
                  d_1 = sc_1 < 0 ? new ctr(fn_1) : new ctr(fn_1, sc_1, su_1);
                  d_1.ondata = function(err2, dat3, final2) {
                    file_1.ondata(err2, dat3, final2);
                  };
                  for (var _i = 0, chks_4 = chks_3; _i < chks_4.length; _i++) {
                    var dat2 = chks_4[_i];
                    d_1.push(dat2, false);
                  }
                  if (_this.k[0] == chks_3 && _this.c)
                    _this.d = d_1;
                  else
                    d_1.push(et, true);
                }
              },
              terminate: function() {
                if (d_1 && d_1.terminate)
                  d_1.terminate();
              }
            };
            if (sc_1 >= 0)
              file_1.size = sc_1, file_1.originalSize = su_1;
            this_1.onfile(file_1);
          }
          return "break";
        } else if (oc) {
          if (sig == 134695760) {
            is = i2 += 12 + (oc == -2 && 8), f = 3, this_1.c = 0;
            return "break";
          } else if (sig == 33639248) {
            is = i2 -= 4, f = 3, this_1.c = 0;
            return "break";
          }
        }
      };
      var this_1 = this;
      for (; i2 < l2 - 4; ++i2) {
        var state_1 = _loop_2();
        if (state_1 === "break")
          break;
      }
      this.p = et;
      if (oc < 0) {
        var dat = f ? buf.subarray(0, is - 12 - (oc == -2 && 8) - (b4(buf, is - 16) == 134695760 && 4)) : buf.subarray(0, i2);
        if (add)
          add.push(dat, !!f);
        else
          this.k[+(f == 2)].push(dat);
      }
      if (f & 2)
        return this.push(buf.subarray(i2), final);
      this.p = buf.subarray(i2);
    }
    if (final) {
      if (this.c)
        err(13);
      this.p = null;
    }
  };
  Unzip2.prototype.register = function(decoder) {
    this.o[decoder.compression] = decoder;
  };
  return Unzip2;
})();
function unzipSync(data, opts) {
  var files = {};
  var e2 = data.length - 22;
  for (; b4(data, e2) != 101010256; --e2) {
    if (!e2 || data.length - e2 > 65558)
      err(13);
  }
  ;
  var c2 = b2(data, e2 + 8);
  if (!c2)
    return {};
  var o2 = b4(data, e2 + 16);
  var z = b4(data, e2 - 20) == 117853008;
  if (z) {
    var ze = b4(data, e2 - 12);
    z = b4(data, ze) == 101075792;
    if (z) {
      c2 = b4(data, ze + 32);
      o2 = b4(data, ze + 48);
    }
  }
  var fltr = opts && opts.filter;
  for (var i2 = 0; i2 < c2; ++i2) {
    var _a2 = zh(data, o2, z), c_2 = _a2[0], sc = _a2[1], su = _a2[2], fn = _a2[3], no = _a2[4], off = _a2[5], b3 = slzh(data, off);
    o2 = no;
    if (!fltr || fltr({
      name: fn,
      size: sc,
      originalSize: su,
      compression: c_2
    })) {
      if (!c_2)
        files[fn] = slc(data, b3, b3 + sc);
      else if (c_2 == 8)
        files[fn] = inflateSync(data.subarray(b3, b3 + sc), { out: new u8(su) });
      else
        err(14, "unknown compression type " + c_2);
    }
  }
  return files;
}

// ../../node_modules/.pnpm/@windsland52+maa-log-tools@1.3.0/node_modules/@windsland52/maa-log-tools/dist/archiveLimits.js
var ArchiveLimitError = class extends Error {
  constructor(code, actual, limit) {
    super(`Input ${code} exceeds the configured limit (${actual} > ${limit})`);
    this.code = code;
    this.actual = actual;
    this.limit = limit;
    this.name = "ArchiveLimitError";
  }
};
var ArchiveFormatError = class extends Error {
  constructor(code, entryName, message) {
    super(message);
    this.code = code;
    this.entryName = entryName;
    this.name = "ArchiveFormatError";
  }
};
var DEFAULT_ARCHIVE_LIMITS = Object.freeze({
  maxVolumes: 16,
  maxCompressedBytes: 268435456,
  maxEntries: 1e4,
  maxPathBytes: 4096,
  maxTotalPathBytes: 8388608,
  maxFileBytes: 268435456,
  maxImageBytes: 33554432,
  maxExtractedBytes: 536870912,
  maxCompressionRatio: 500,
  compressionRatioMinBytes: 1048576
});
var integerLimitKeys = [
  "maxVolumes",
  "maxCompressedBytes",
  "maxEntries",
  "maxPathBytes",
  "maxTotalPathBytes",
  "maxFileBytes",
  "maxImageBytes",
  "maxExtractedBytes",
  "compressionRatioMinBytes"
];
var validateLimits = (limits) => {
  for (const key of integerLimitKeys) {
    const value = limits[key];
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new RangeError(`Archive limit ${key} must be a non-negative safe integer`);
    }
  }
  if (!Number.isFinite(limits.maxCompressionRatio) || limits.maxCompressionRatio < 0) {
    throw new RangeError("Archive limit maxCompressionRatio must be a non-negative finite number");
  }
  return Object.freeze(limits);
};
var resolveArchiveLimits = (overrides = {}) => validateLimits({
  ...DEFAULT_ARCHIVE_LIMITS,
  ...overrides
});
var EMPTY_ARCHIVE_DIRECTORY_BUDGET = Object.freeze({
  entryCount: 0,
  totalPathBytes: 0
});
var EMPTY_EXTRACTION_BUDGET = Object.freeze({
  extractedBytes: 0
});
var assertMetadataInteger = (value, label) => {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`Invalid input metadata: ${label} must be a non-negative safe integer`);
  }
};
var addSize = (total, value, label) => {
  assertMetadataInteger(total, `${label} total`);
  assertMetadataInteger(value, label);
  const next = total + value;
  if (!Number.isSafeInteger(next)) {
    throw new Error(`Invalid input metadata: ${label} total exceeds the safe integer range`);
  }
  return next;
};
var throwLimitError = (code, actual, limit) => {
  throw new ArchiveLimitError(code, actual, limit);
};
var assertArchiveInputsWithinLimits = (inputs, limits = DEFAULT_ARCHIVE_LIMITS) => {
  if (inputs.length > limits.maxVolumes) {
    throwLimitError("volume-count", inputs.length, limits.maxVolumes);
  }
  let total = 0;
  for (const input of inputs) {
    total = addSize(total, input.size, "compressed size");
    if (total > limits.maxCompressedBytes) {
      throwLimitError("compressed-size", total, limits.maxCompressedBytes);
    }
  }
};
var utf8Encoder = new TextEncoder();
var throwFormatError = (code, entryName, message) => {
  throw new ArchiveFormatError(code, entryName, message);
};
var canonicalizeArchivePath = (rawPath) => {
  if (rawPath.length === 0 || rawPath.includes("\\") || rawPath.normalize("NFC") !== rawPath) {
    throwFormatError("invalid-path", rawPath, `Archive entry uses a non-canonical path: ${rawPath}`);
  }
  if (/[\u0000-\u001f\u007f]/u.test(rawPath) || rawPath.startsWith("/")) {
    throwFormatError("invalid-path", rawPath, `Archive entry uses an unsafe path: ${rawPath}`);
  }
  const isDirectory2 = rawPath.endsWith("/");
  const canonical = isDirectory2 ? rawPath.slice(0, -1) : rawPath;
  if (canonical.length === 0) {
    throwFormatError("invalid-path", rawPath, `Archive entry uses an empty path: ${rawPath}`);
  }
  const segments = canonical.split("/");
  for (const [index, segment] of segments.entries()) {
    if (segment.length === 0 || segment === "." || segment === ".." || segment.endsWith(".") || segment.endsWith(" ") || segment.includes(":") || index === 0 && /^[a-z]:$/iu.test(segment)) {
      throwFormatError("invalid-path", rawPath, `Archive entry uses a path alias: ${rawPath}`);
    }
  }
  return {
    canonical,
    identity: canonical.toLowerCase()
  };
};
var addArchiveDirectoryEntry = (current, entry, limits = DEFAULT_ARCHIVE_LIMITS) => {
  if (typeof entry.name !== "string") {
    throw new Error("Invalid input metadata: entry name must be a string");
  }
  assertMetadataInteger(entry.size, "compressed entry size");
  assertMetadataInteger(entry.originalSize, "original entry size");
  assertMetadataInteger(entry.compression, "compression method");
  const entryCount = addSize(current.entryCount, 1, "entry count");
  if (entryCount > limits.maxEntries) {
    throwLimitError("entry-count", entryCount, limits.maxEntries);
  }
  const pathBytes = utf8Encoder.encode(entry.name).byteLength;
  if (pathBytes > limits.maxPathBytes) {
    throwLimitError("path-size", pathBytes, limits.maxPathBytes);
  }
  const totalPathBytes = addSize(current.totalPathBytes, pathBytes, "path size");
  if (totalPathBytes > limits.maxTotalPathBytes) {
    throwLimitError("total-path-size", totalPathBytes, limits.maxTotalPathBytes);
  }
  return { entryCount, totalPathBytes };
};
var copyEntryMetadata = (entry) => ({
  name: entry.name,
  size: entry.size,
  originalSize: entry.originalSize,
  compression: entry.compression
});
var readU16 = (data, offset) => {
  if (offset < 0 || offset + 2 > data.byteLength) {
    throwFormatError("invalid-structure", "", "ZIP record is truncated");
  }
  return data[offset] | data[offset + 1] << 8;
};
var readU32 = (data, offset) => {
  if (offset < 0 || offset + 4 > data.byteLength) {
    throwFormatError("invalid-structure", "", "ZIP record is truncated");
  }
  return (data[offset] | data[offset + 1] << 8 | data[offset + 2] << 16 | data[offset + 3] << 24) >>> 0;
};
var findEndOfCentralDirectory = (data) => {
  const minimumOffset = Math.max(0, data.byteLength - 65557);
  for (let offset = data.byteLength - 22; offset >= minimumOffset; offset -= 1) {
    if (readU32(data, offset) !== 101010256)
      continue;
    const commentBytes = readU16(data, offset + 20);
    if (offset + 22 + commentBytes === data.byteLength)
      return offset;
  }
  return throwFormatError("invalid-structure", "", "ZIP end-of-central-directory record is missing");
};
var equalBytes = (left, right) => {
  if (left.byteLength !== right.byteLength)
    return false;
  for (let index = 0; index < left.byteLength; index += 1) {
    if (left[index] !== right[index])
      return false;
  }
  return true;
};
var parseAndValidateRawZipRecords = (data) => {
  const eocdOffset = findEndOfCentralDirectory(data);
  const diskNumber = readU16(data, eocdOffset + 4);
  const centralDisk = readU16(data, eocdOffset + 6);
  const entriesOnDisk = readU16(data, eocdOffset + 8);
  const totalEntries = readU16(data, eocdOffset + 10);
  const centralSize = readU32(data, eocdOffset + 12);
  const centralOffset = readU32(data, eocdOffset + 16);
  if (diskNumber !== 0 || centralDisk !== 0 || entriesOnDisk !== totalEntries || totalEntries === 65535 || centralSize === 4294967295 || centralOffset === 4294967295) {
    throwFormatError("unsupported-archive", "", "Multi-disk and ZIP64 archives are not supported");
  }
  if (centralOffset + centralSize !== eocdOffset) {
    throwFormatError("invalid-structure", "", "ZIP central-directory bounds are inconsistent");
  }
  const entries = [];
  let offset = centralOffset;
  for (let index = 0; index < totalEntries; index += 1) {
    if (readU32(data, offset) !== 33639248) {
      throwFormatError("invalid-structure", "", "ZIP central-directory entry is malformed");
    }
    const nameBytes = readU16(data, offset + 28);
    const extraBytes = readU16(data, offset + 30);
    const commentBytes = readU16(data, offset + 32);
    const recordEnd = offset + 46 + nameBytes + extraBytes + commentBytes;
    if (recordEnd > eocdOffset) {
      throwFormatError("invalid-structure", "", "ZIP central-directory entry is truncated");
    }
    const size = readU32(data, offset + 20);
    const originalSize = readU32(data, offset + 24);
    const localHeaderOffset = readU32(data, offset + 42);
    if (size === 4294967295 || originalSize === 4294967295 || localHeaderOffset === 4294967295) {
      throwFormatError("unsupported-archive", "", "ZIP64 entries are not supported");
    }
    entries.push({
      flags: readU16(data, offset + 8),
      compression: readU16(data, offset + 10),
      crc32: readU32(data, offset + 16),
      size,
      originalSize,
      localHeaderOffset,
      rawName: data.subarray(offset + 46, offset + 46 + nameBytes)
    });
    offset = recordEnd;
  }
  if (offset !== eocdOffset) {
    throwFormatError("invalid-structure", "", "ZIP central-directory size does not match its entries");
  }
  const localRanges = [];
  const localOffsets = /* @__PURE__ */ new Set();
  for (const entry of entries) {
    const localOffset = entry.localHeaderOffset;
    if (localOffsets.has(localOffset) || readU32(data, localOffset) !== 67324752) {
      throwFormatError("local-entry-mismatch", "", "ZIP local-header offsets are invalid or duplicated");
    }
    localOffsets.add(localOffset);
    const localFlags = readU16(data, localOffset + 6);
    const localCompression = readU16(data, localOffset + 8);
    const localCrc32 = readU32(data, localOffset + 14);
    const localSize = readU32(data, localOffset + 18);
    const localOriginalSize = readU32(data, localOffset + 22);
    const nameBytes = readU16(data, localOffset + 26);
    const extraBytes = readU16(data, localOffset + 28);
    const payloadOffset = localOffset + 30 + nameBytes + extraBytes;
    const rawLocalName = data.subarray(localOffset + 30, localOffset + 30 + nameBytes);
    if (payloadOffset > centralOffset || localFlags !== entry.flags || localCompression !== entry.compression || !equalBytes(rawLocalName, entry.rawName)) {
      throwFormatError("local-entry-mismatch", "", "ZIP local and central entry declarations differ");
    }
    if ((localFlags & 1) !== 0) {
      throwFormatError("unsupported-archive", "", "Encrypted ZIP entries are not supported");
    }
    const usesDescriptor = (localFlags & 8) !== 0;
    if (!usesDescriptor && (localCrc32 !== entry.crc32 || localSize !== entry.size || localOriginalSize !== entry.originalSize)) {
      throwFormatError("declared-size-mismatch", "", "ZIP local and central sizes differ");
    }
    if (usesDescriptor && (localCrc32 !== 0 && localCrc32 !== entry.crc32 || localSize !== 0 && localSize !== entry.size || localOriginalSize !== 0 && localOriginalSize !== entry.originalSize)) {
      throwFormatError("declared-size-mismatch", "", "ZIP streaming local sizes conflict with the central directory");
    }
    const payloadEnd = payloadOffset + entry.size;
    if (!Number.isSafeInteger(payloadEnd) || payloadEnd > centralOffset) {
      throwFormatError("invalid-structure", "", "ZIP entry payload exceeds the local-file area");
    }
    let recordEnd = payloadEnd;
    if (usesDescriptor) {
      const hasSignature = readU32(data, recordEnd) === 134695760;
      if (hasSignature)
        recordEnd += 4;
      const descriptorCrc32 = readU32(data, recordEnd);
      const descriptorSize = readU32(data, recordEnd + 4);
      const descriptorOriginalSize = readU32(data, recordEnd + 8);
      recordEnd += 12;
      if (descriptorCrc32 !== entry.crc32 || descriptorSize !== entry.size || descriptorOriginalSize !== entry.originalSize) {
        throwFormatError("declared-size-mismatch", "", "ZIP data descriptor conflicts with the central directory");
      }
    }
    if (recordEnd > centralOffset) {
      throwFormatError("invalid-structure", "", "ZIP local entry overlaps the central directory");
    }
    localRanges.push({ start: localOffset, end: recordEnd });
  }
  localRanges.sort((left, right) => left.start - right.start);
  for (let index = 1; index < localRanges.length; index += 1) {
    if (localRanges[index].start < localRanges[index - 1].end) {
      throwFormatError("invalid-structure", "", "ZIP local entries overlap");
    }
  }
  return entries;
};
var inspectZipDirectory = (data, limits = DEFAULT_ARCHIVE_LIMITS) => {
  assertArchiveInputsWithinLimits([{ size: data.byteLength }], limits);
  const rawEntries = parseAndValidateRawZipRecords(data);
  const entries = [];
  let directoryBudget = EMPTY_ARCHIVE_DIRECTORY_BUDGET;
  const rawPaths = /* @__PURE__ */ new Set();
  const canonicalPaths = /* @__PURE__ */ new Set();
  unzipSync(data, {
    filter: (entry) => {
      const metadata = copyEntryMetadata(entry);
      const rawEntry = rawEntries[entries.length];
      if (!rawEntry || rawEntry.size !== metadata.size || rawEntry.originalSize !== metadata.originalSize || rawEntry.compression !== metadata.compression) {
        throwFormatError("local-entry-mismatch", metadata.name, `ZIP parsed metadata is inconsistent for ${metadata.name}`);
      }
      const archivePath = canonicalizeArchivePath(metadata.name);
      if (rawPaths.has(metadata.name) || canonicalPaths.has(archivePath.identity)) {
        throwFormatError("duplicate-path", metadata.name, `Archive contains duplicate or aliased entry paths: ${metadata.name}`);
      }
      rawPaths.add(metadata.name);
      canonicalPaths.add(archivePath.identity);
      directoryBudget = addArchiveDirectoryEntry(directoryBudget, metadata, limits);
      entries.push(metadata);
      return false;
    }
  });
  if (entries.length !== rawEntries.length) {
    throwFormatError("invalid-structure", "", "ZIP entry count is inconsistent");
  }
  return entries;
};
var isImageEntry = (name) => /\.(?:png|jpe?g)$/i.test(name);
var addSelectedEntry = (current, entry, limits = DEFAULT_ARCHIVE_LIMITS, checkCompressionRatio = true) => {
  assertMetadataInteger(current.extractedBytes, "extracted size total");
  assertMetadataInteger(entry.size, "compressed entry size");
  assertMetadataInteger(entry.originalSize, "original entry size");
  if (entry.originalSize > limits.maxFileBytes) {
    throwLimitError("file-size", entry.originalSize, limits.maxFileBytes);
  }
  if (isImageEntry(entry.name) && entry.originalSize > limits.maxImageBytes) {
    throwLimitError("image-size", entry.originalSize, limits.maxImageBytes);
  }
  const extractedBytes = addSize(current.extractedBytes, entry.originalSize, "extracted size");
  if (extractedBytes > limits.maxExtractedBytes) {
    throwLimitError("extracted-size", extractedBytes, limits.maxExtractedBytes);
  }
  if (checkCompressionRatio && entry.originalSize >= limits.compressionRatioMinBytes && entry.originalSize > 0) {
    const ratio = entry.size === 0 ? Number.POSITIVE_INFINITY : entry.originalSize / entry.size;
    if (ratio > limits.maxCompressionRatio) {
      throwLimitError("compression-ratio", ratio, limits.maxCompressionRatio);
    }
  }
  return { extractedBytes };
};
var assertSelectedEntriesWithinLimits = (entries, limits = DEFAULT_ARCHIVE_LIMITS) => {
  let budget = EMPTY_EXTRACTION_BUDGET;
  for (const entry of entries) {
    budget = addSelectedEntry(budget, entry, limits);
  }
};
var STREAM_INPUT_CHUNK_BYTES = 16 * 1024;
var assertLocalEntryMatchesCentral = (file, central) => {
  if (file.compression !== central.compression) {
    throwFormatError("local-entry-mismatch", file.name, `ZIP local and central compression methods differ for ${file.name}`);
  }
  if (file.size !== void 0 && file.size !== central.size) {
    throwFormatError("declared-size-mismatch", file.name, `ZIP local and central compressed sizes differ for ${file.name}`);
  }
  if (file.originalSize !== void 0 && file.originalSize !== central.originalSize) {
    throwFormatError("declared-size-mismatch", file.name, `ZIP local and central original sizes differ for ${file.name}`);
  }
};
var extractSelectedEntriesStreaming = (data, entries, selectedNames, limits) => {
  const centralByName = new Map(entries.map((entry) => [entry.name, entry]));
  const seenLocalNames = /* @__PURE__ */ new Set();
  const completedNames = /* @__PURE__ */ new Set();
  const files = /* @__PURE__ */ Object.create(null);
  let actualExtractedBytes = 0;
  let fatalError = null;
  const fail = (error) => {
    if (fatalError == null)
      fatalError = error;
  };
  const unzipper = new Unzip((file) => {
    if (fatalError != null)
      return;
    if (seenLocalNames.has(file.name)) {
      fail(new ArchiveFormatError("duplicate-path", file.name, `ZIP local headers contain a duplicate entry: ${file.name}`));
      return;
    }
    seenLocalNames.add(file.name);
    const central = centralByName.get(file.name);
    if (!central) {
      fail(new ArchiveFormatError("local-entry-mismatch", file.name, `ZIP local entry is missing from the central directory: ${file.name}`));
      return;
    }
    try {
      canonicalizeArchivePath(file.name);
      assertLocalEntryMatchesCentral(file, central);
    } catch (error) {
      fail(error);
      return;
    }
    if (!selectedNames.has(file.name))
      return;
    if (central.compression !== 0 && central.compression !== 8) {
      fail(new ArchiveFormatError("unsupported-compression", file.name, `Unsupported ZIP compression method ${central.compression} for ${file.name}`));
      return;
    }
    const output = new Uint8Array(central.originalSize);
    let outputOffset = 0;
    file.ondata = (error, chunk, final) => {
      if (fatalError != null)
        return;
      if (error) {
        fail(error);
        return;
      }
      const abortOutput = (outputError) => {
        fail(outputError);
        throw outputError;
      };
      const nextFileSize = outputOffset + chunk.byteLength;
      const nextTotalSize = actualExtractedBytes + chunk.byteLength;
      if (!Number.isSafeInteger(nextFileSize) || nextFileSize > central.originalSize) {
        abortOutput(new ArchiveFormatError("actual-size-mismatch", file.name, `ZIP entry output exceeds its declared original size: ${file.name}`));
      }
      if (nextFileSize > limits.maxFileBytes) {
        abortOutput(new ArchiveLimitError("file-size", nextFileSize, limits.maxFileBytes));
      }
      if (isImageEntry(file.name) && nextFileSize > limits.maxImageBytes) {
        abortOutput(new ArchiveLimitError("image-size", nextFileSize, limits.maxImageBytes));
      }
      if (!Number.isSafeInteger(nextTotalSize) || nextTotalSize > limits.maxExtractedBytes) {
        abortOutput(new ArchiveLimitError("extracted-size", nextTotalSize, limits.maxExtractedBytes));
      }
      if (nextFileSize >= limits.compressionRatioMinBytes && nextFileSize > 0) {
        const actualRatio = central.size === 0 ? Number.POSITIVE_INFINITY : nextFileSize / central.size;
        if (actualRatio > limits.maxCompressionRatio) {
          abortOutput(new ArchiveLimitError("compression-ratio", actualRatio, limits.maxCompressionRatio));
        }
      }
      output.set(chunk, outputOffset);
      outputOffset = nextFileSize;
      actualExtractedBytes = nextTotalSize;
      if (!final)
        return;
      if (outputOffset !== central.originalSize) {
        abortOutput(new ArchiveFormatError("actual-size-mismatch", file.name, `ZIP entry output does not match its declared original size: ${file.name}`));
      }
      if (file.originalSize !== void 0 && outputOffset !== file.originalSize) {
        abortOutput(new ArchiveFormatError("actual-size-mismatch", file.name, `ZIP entry output does not match its local declared size: ${file.name}`));
      }
      files[file.name] = output;
      completedNames.add(file.name);
    };
    try {
      file.start();
    } catch (error) {
      fail(error);
    }
  });
  unzipper.register(UnzipInflate);
  try {
    for (let offset = 0; offset < data.byteLength; offset += STREAM_INPUT_CHUNK_BYTES) {
      const end = Math.min(offset + STREAM_INPUT_CHUNK_BYTES, data.byteLength);
      unzipper.push(data.subarray(offset, end), end === data.byteLength);
      if (fatalError != null)
        throw fatalError;
    }
  } catch (error) {
    if (fatalError != null)
      throw fatalError;
    throw error;
  }
  for (const entry of entries) {
    if (!seenLocalNames.has(entry.name)) {
      throwFormatError("missing-entry", entry.name, `ZIP central directory entry has no matching local header: ${entry.name}`);
    }
    if (selectedNames.has(entry.name) && !completedNames.has(entry.name)) {
      throwFormatError("missing-entry", entry.name, `ZIP selected entry did not finish streaming: ${entry.name}`);
    }
  }
  return files;
};
var extractInspectedZipEntriesWithinLimits = (data, entries, shouldExtract, limits = DEFAULT_ARCHIVE_LIMITS) => {
  const selectedEntries = entries.filter((entry) => shouldExtract(entry.name));
  assertSelectedEntriesWithinLimits(selectedEntries, limits);
  const selectedNames = new Set(selectedEntries.map((entry) => entry.name));
  const files = extractSelectedEntriesStreaming(data, entries, selectedNames, limits);
  return { files, entries: [...entries] };
};
var extractZipEntriesWithinLimits = (data, shouldExtract, limits = DEFAULT_ARCHIVE_LIMITS) => {
  const entries = inspectZipDirectory(data, limits);
  return extractInspectedZipEntriesWithinLimits(data, entries, shouldExtract, limits);
};
var createStoredFileMetadata = (name, size) => ({
  name,
  size,
  originalSize: size,
  compression: 0
});

// ../../node_modules/.pnpm/@windsland52+maa-log-tools@1.3.0/node_modules/@windsland52/maa-log-tools/dist/boundedFileReader.js
var import_promises = require("node:fs/promises");
var InputFileError = class extends Error {
  constructor(code, filePath, message) {
    super(message);
    this.code = code;
    this.filePath = filePath;
    this.name = "InputFileError";
  }
};
var READ_CHUNK_BYTES = 64 * 1024;
var getFileIdentity = (stats) => ({
  dev: stats.dev,
  ino: stats.ino
});
var sameFileIdentity = (left, right) => left.dev === right.dev && left.ino === right.ino;
var assertRegularPath = (filePath, stats) => {
  if (stats.isSymbolicLink()) {
    throw new InputFileError("symlink", filePath, `Symbolic-link inputs are not allowed: ${filePath}`);
  }
  if (!stats.isFile()) {
    throw new InputFileError("not-regular-file", filePath, `Expected a regular file: ${filePath}`);
  }
};
var assertHandleIdentity = (filePath, expected, actual) => {
  if (!actual.isFile() || !sameFileIdentity(expected, getFileIdentity(actual))) {
    throw new InputFileError("identity-changed", filePath, `File identity changed while opening or reading: ${filePath}`);
  }
};
var assertStableContentState = (filePath, expected, actual) => {
  if (expected.size !== actual.size || expected.mtimeMs !== actual.mtimeMs || expected.ctimeMs !== actual.ctimeMs) {
    throw new InputFileError("content-changed", filePath, `File content or metadata changed while opening or reading: ${filePath}`);
  }
};
var readBoundedRegularFile = async (filePath, maxBytes, createLimitError, options = {}) => {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) {
    throw new RangeError("Maximum file read size must be a non-negative safe integer");
  }
  const beforeOpen = await (0, import_promises.lstat)(filePath);
  assertRegularPath(filePath, beforeOpen);
  const beforeIdentity = getFileIdentity(beforeOpen);
  if (options.expectedIdentity && !sameFileIdentity(options.expectedIdentity, beforeIdentity)) {
    throw new InputFileError("identity-changed", filePath, `File identity changed after directory discovery: ${filePath}`);
  }
  const handle = await (0, import_promises.open)(filePath, "r");
  try {
    const opened = await handle.stat();
    assertHandleIdentity(filePath, beforeIdentity, opened);
    assertStableContentState(filePath, beforeOpen, opened);
    const afterOpen = await (0, import_promises.lstat)(filePath);
    assertRegularPath(filePath, afterOpen);
    assertHandleIdentity(filePath, beforeIdentity, afterOpen);
    assertStableContentState(filePath, opened, afterOpen);
    if (opened.size > maxBytes)
      throw createLimitError(opened.size);
    const chunks = [];
    let totalBytes = 0;
    let chunkCount = 0;
    while (totalBytes <= maxBytes) {
      const remaining = maxBytes + 1 - totalBytes;
      if (remaining <= 0)
        break;
      const buffer = Buffer.allocUnsafe(Math.min(READ_CHUNK_BYTES, remaining));
      const { bytesRead } = await handle.read(buffer, 0, buffer.byteLength, totalBytes);
      if (bytesRead === 0)
        break;
      totalBytes += bytesRead;
      chunkCount += 1;
      if (totalBytes > maxBytes)
        throw createLimitError(totalBytes);
      chunks.push(buffer.subarray(0, bytesRead));
      await options.onChunkRead?.({ handle, bytesRead: totalBytes, chunkCount });
    }
    const finalHandleStats = await handle.stat();
    assertHandleIdentity(filePath, beforeIdentity, finalHandleStats);
    const finalPathStats = await (0, import_promises.lstat)(filePath);
    assertRegularPath(filePath, finalPathStats);
    assertHandleIdentity(filePath, beforeIdentity, finalPathStats);
    assertStableContentState(filePath, opened, finalHandleStats);
    assertStableContentState(filePath, opened, finalPathStats);
    if (finalHandleStats.size !== totalBytes) {
      throw new InputFileError("size-changed", filePath, `File size changed after the bounded read completed: ${filePath}`);
    }
    const output = new Uint8Array(totalBytes);
    let outputOffset = 0;
    for (const chunk of chunks) {
      output.set(chunk, outputOffset);
      outputOffset += chunk.byteLength;
    }
    return output;
  } finally {
    await handle.close();
  }
};

// ../../node_modules/.pnpm/@windsland52+maa-log-tools@1.3.0/node_modules/@windsland52/maa-log-tools/dist/nodeInput.js
var MAIN_LOG_NAMES = ["maa.log", "maafw.log"];
var BAK_LOG_NAMES = ["maa.bak.log", "maafw.bak.log"];
var SEARCH_TEXT_EXTENSIONS = [".log", ".txt", ".jsonl"];
var MAIN_LOG_NAME_SET = new Set(MAIN_LOG_NAMES.map((name) => name.toLowerCase()));
var HISTORY_LOG_NAME_PATTERNS = [
  /^maa\.bak(?:\..+)?\.log$/i,
  /^maafw\.bak(?:\..+)?\.log$/i
];
var toPosixPath = (value) => value.replace(/\\/g, "/");
var normalizeLowerPath = (value) => toPosixPath(value).toLowerCase();
var isSearchTextFile = (normalizedPath) => {
  const lower = normalizedPath.toLowerCase();
  return SEARCH_TEXT_EXTENSIONS.some((ext) => lower.endsWith(ext));
};
var isHistoryLogName = (fileName) => {
  return HISTORY_LOG_NAME_PATTERNS.some((pattern) => pattern.test(fileName));
};
var isCoreLogName = (fileName) => {
  const lower = fileName.toLowerCase();
  return MAIN_LOG_NAME_SET.has(lower) || isHistoryLogName(lower);
};
var decodeNodeBytes = (bytes) => {
  const encodings = ["utf-8", "gbk", "gb18030", "gb2312"];
  for (const encoding of encodings) {
    try {
      const decoder = new TextDecoder(encoding, { fatal: true });
      const text = decoder.decode(bytes);
      const replacementCount = (text.match(/�/g) || []).length;
      if (replacementCount < text.length * 0.01) {
        return text;
      }
    } catch {
      continue;
    }
  }
  return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
};
var joinPath = (base, name) => base ? `${base}/${name}` : name;
var findBaseDirectory = (paths) => {
  for (const p2 of paths) {
    const lower = normalizeLowerPath(p2);
    if (lower.endsWith("/maa.log") || lower === "maa.log" || lower.endsWith("/maafw.log") || lower === "maafw.log") {
      const normalized = toPosixPath(p2);
      const lastSlash = normalized.lastIndexOf("/");
      return lastSlash === -1 ? "" : normalized.slice(0, lastSlash);
    }
  }
  return null;
};
var findZipEntry = (entries, paths, targetPath) => {
  const normalizedTarget = normalizeLowerPath(targetPath);
  for (const currentPath of paths) {
    if (normalizeLowerPath(currentPath) === normalizedTarget) {
      return entries[currentPath];
    }
  }
  return null;
};
var parseErrorImageKey = (fileName) => {
  const match = fileName.match(/^(\d{4}\.\d{2}\.\d{2}-\d{2}\.\d{2}\.\d{2})\.(\d{1,3})_(.+)\.png$/);
  if (!match)
    return null;
  const [, timestamp, ms, nodeName] = match;
  const paddedMs = ms.padEnd(3, "0");
  return `${timestamp}.${paddedMs}_${nodeName}`;
};
var parseVisionImageKey = (fileName) => {
  const match = fileName.match(/^(\d{4}\.\d{2}\.\d{2}-\d{2}\.\d{2}\.\d{2})\.(\d{1,3})_(.+_\d{9,})\.jpg$/i);
  if (!match)
    return null;
  const [, timestamp, ms, rest] = match;
  const paddedMs = ms.padEnd(3, "0");
  return `${timestamp}.${paddedMs}_${rest}`;
};
var parseWaitFreezesKey = (fileName) => {
  const match = fileName.match(/^(\d{4}\.\d{2}\.\d{2}-\d{2}\.\d{2}\.\d{2})\.(\d{1,3})_(.+_wait_freezes)\.jpg$/i);
  if (!match)
    return null;
  const [, timestamp, ms, rest] = match;
  const paddedMs = ms.padEnd(3, "0");
  return `${timestamp}.${paddedMs}_${rest}`;
};
var isNeededZipEntry = (entryPath) => {
  const lower = normalizeLowerPath(entryPath);
  const name = lower.slice(lower.lastIndexOf("/") + 1);
  if (isSearchTextFile(lower))
    return true;
  if (isCoreLogName(name))
    return true;
  if ((lower.includes("/on_error/") || lower.startsWith("on_error/")) && lower.endsWith(".png"))
    return true;
  if ((lower.includes("/vision/") || lower.startsWith("vision/")) && lower.endsWith(".jpg"))
    return true;
  return false;
};
var toZipReference = (sourceRef, entryPath) => {
  return `zip:${sourceRef}#${toPosixPath(entryPath)}`;
};
var toFileReference = (absolutePath) => {
  return `file:${toPosixPath(absolutePath)}`;
};
var isRelativeImagePath = (relativePath2, directory, extension) => {
  const normalized = relativePath2.toLowerCase();
  return normalized === `${directory}${extension}` || normalized.startsWith(`${directory}/`) || normalized.includes(`/${directory}/`);
};
var normalizeTimestampBoundary = (value) => {
  if (!value)
    return null;
  const trimmed = value.trim();
  if (trimmed.length === 0)
    return null;
  return trimmed.includes(".") ? trimmed : `${trimmed}.000`;
};
var extractTimestamps = (content) => {
  const matches = content.match(/\[(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d{1,3})?)\]/g) ?? [];
  return matches.map((item) => item.slice(1, -1)).map((item) => normalizeTimestampBoundary(item) ?? item);
};
var contentMatchesFocus = (content, focus) => {
  const keywords = (focus.keywords ?? []).filter((keyword) => keyword.trim().length > 0);
  if (keywords.length > 0 && !keywords.some((keyword) => content.includes(keyword))) {
    return false;
  }
  const startedAfter = normalizeTimestampBoundary(focus.started_after);
  const startedBefore = normalizeTimestampBoundary(focus.started_before);
  if (!startedAfter && !startedBefore) {
    return true;
  }
  return extractTimestamps(content).some((timestamp) => {
    if (startedAfter && timestamp < startedAfter) {
      return false;
    }
    if (startedBefore && timestamp > startedBefore) {
      return false;
    }
    return true;
  });
};
var countNewlines = (content) => {
  let count = 0;
  let pos = 0;
  while ((pos = content.indexOf(String.fromCharCode(10), pos)) >= 0) {
    count += 1;
    pos += 1;
  }
  return count;
};
var joinMergedWithSources = (chunks) => {
  let content = "";
  let runningNewlines = 0;
  const chunkStarts = [];
  for (const chunk of chunks) {
    if (chunk.content.length === 0)
      continue;
    if (content.length === 0) {
      content = chunk.content;
    } else if (content.endsWith(String.fromCharCode(10))) {
      content += chunk.content;
    } else {
      content += String.fromCharCode(10) + chunk.content;
      runningNewlines += 1;
    }
    const startLine = runningNewlines + 1;
    chunkStarts.push({ startLine, source: chunk.source, path: chunk.path });
    runningNewlines += countNewlines(chunk.content);
  }
  if (chunkStarts.length === 0) {
    return { content: "", segments: [] };
  }
  const totalLines = runningNewlines + 1;
  const segments = chunkStarts.map((info, i2) => ({
    source: info.source,
    path: info.path,
    startLine: info.startLine,
    lineCount: i2 < chunkStarts.length - 1 ? chunkStarts[i2 + 1].startLine - info.startLine : totalLines - info.startLine + 1
  }));
  return { content, segments };
};
var rankLogPath = (filePath) => {
  const baseName = import_node_path.default.basename(filePath).toLowerCase();
  if (baseName === "maafw.bak.log" || baseName.startsWith("maafw.bak.")) {
    return 0;
  }
  if (baseName === "maa.bak.log" || baseName.startsWith("maa.bak.")) {
    return 1;
  }
  if (baseName === "maafw.log") {
    return 2;
  }
  if (baseName === "maa.log") {
    return 3;
  }
  return 10;
};
var sortLogPaths = (paths) => {
  return [...paths].sort((left, right) => {
    const rankDiff = rankLogPath(left) - rankLogPath(right);
    if (rankDiff !== 0)
      return rankDiff;
    return left.localeCompare(right);
  });
};
var pathKey = (value) => {
  const resolved = import_node_path.default.resolve(value);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
};
var isPathInside = (rootPath, candidatePath) => {
  const relativePath2 = import_node_path.default.relative(rootPath, candidatePath);
  return relativePath2 === "" || !relativePath2.startsWith("..") && !import_node_path.default.isAbsolute(relativePath2);
};
var assertPathInsideContext = async (context, fullPath) => {
  const absolutePath = import_node_path.default.resolve(fullPath);
  if (!isPathInside(context.rootPath, absolutePath)) {
    throw new InputFileError("path-escape", fullPath, `Input path escapes the selected root: ${fullPath}`);
  }
  const physicalPath = await (0, import_promises2.realpath)(absolutePath);
  if (!isPathInside(context.rootRealPath, physicalPath)) {
    throw new InputFileError("path-escape", fullPath, `Input path resolves outside the selected root: ${fullPath}`);
  }
};
var createNodeInputBudgetContext = async (rootPath, limits, requireDirectoryRoot = true) => {
  const absoluteRoot = import_node_path.default.resolve(rootPath);
  const rootStats = await (0, import_promises2.lstat)(absoluteRoot);
  if (rootStats.isSymbolicLink()) {
    throw new InputFileError("symlink", absoluteRoot, `Symbolic-link roots are not allowed: ${absoluteRoot}`);
  }
  if (requireDirectoryRoot && !rootStats.isDirectory()) {
    throw new InputFileError("not-directory", absoluteRoot, `Expected a directory root: ${absoluteRoot}`);
  }
  const physicalRoot = await (0, import_promises2.realpath)(absoluteRoot);
  return {
    limits,
    rootPath: absoluteRoot,
    rootRealPath: physicalRoot,
    directory: EMPTY_ARCHIVE_DIRECTORY_BUDGET,
    extraction: EMPTY_EXTRACTION_BUDGET,
    chargedPaths: /* @__PURE__ */ new Set(),
    discoveredIdentities: /* @__PURE__ */ new Map()
  };
};
var chargePath = (context, fullPath) => {
  const key = pathKey(fullPath);
  if (context.chargedPaths.has(key))
    return;
  const relativePath2 = toPosixPath(import_node_path.default.relative(context.rootPath, import_node_path.default.resolve(fullPath)));
  context.directory = addArchiveDirectoryEntry(context.directory, {
    name: relativePath2,
    size: 0,
    originalSize: 0,
    compression: 0
  }, context.limits);
  context.chargedPaths.add(key);
};
var recordDiscoveredIdentity = (context, fullPath, stats) => {
  const key = pathKey(fullPath);
  const identity = getFileIdentity(stats);
  const previous = context.discoveredIdentities.get(key);
  if (previous && !sameFileIdentity(previous, identity)) {
    throw new InputFileError("identity-changed", fullPath, `Input identity changed during directory analysis: ${fullPath}`);
  }
  context.discoveredIdentities.set(key, identity);
};
var inspectDirectoryEntry = async (context, fullPath) => {
  const stats = await (0, import_promises2.lstat)(fullPath);
  chargePath(context, fullPath);
  if (stats.isSymbolicLink()) {
    throw new InputFileError("symlink", fullPath, `Symbolic-link entries are not allowed: ${fullPath}`);
  }
  await assertPathInsideContext(context, fullPath);
  recordDiscoveredIdentity(context, fullPath, stats);
  return stats;
};
var readNodeTextFileWithinBudget = async (filePath, context) => {
  chargePath(context, filePath);
  await assertPathInsideContext(context, filePath);
  const remainingBytes = context.limits.maxExtractedBytes - context.extraction.extractedBytes;
  const maxBytes = Math.min(context.limits.maxFileBytes, remainingBytes);
  const limitCode = context.limits.maxFileBytes <= remainingBytes ? "file-size" : "extracted-size";
  const bytes = await readBoundedRegularFile(filePath, maxBytes, (actualBytes) => new ArchiveLimitError(limitCode, limitCode === "extracted-size" ? context.extraction.extractedBytes + actualBytes : actualBytes, limitCode === "extracted-size" ? context.limits.maxExtractedBytes : context.limits.maxFileBytes), { expectedIdentity: context.discoveredIdentities.get(pathKey(filePath)) });
  context.extraction = addSelectedEntry(context.extraction, createStoredFileMetadata(toPosixPath(filePath), bytes.byteLength), context.limits, false);
  return decodeNodeBytes(bytes);
};
var collectFocusedFileContents = async (logPaths, focus, context) => {
  const chunks = [];
  for (const logPath of sortLogPaths(logPaths)) {
    const content = await readNodeTextFileWithinBudget(logPath, context);
    if (!contentMatchesFocus(content, focus))
      continue;
    chunks.push({
      content,
      source: toFileReference(logPath),
      path: toPosixPath(import_node_path.default.basename(logPath))
    });
  }
  return joinMergedWithSources(chunks);
};
var collectFocusedZipContents = (entries, paths, basePath, focus, sourceRef) => {
  const normalizedBasePath = normalizeLowerPath(basePath);
  const candidatePaths = sortLogPaths(paths.filter((entryPath) => {
    const normalizedPath = toPosixPath(entryPath);
    const lastSlash = normalizedPath.lastIndexOf("/");
    const parentPath = lastSlash === -1 ? "" : normalizedPath.slice(0, lastSlash);
    if (normalizeLowerPath(parentPath) !== normalizedBasePath) {
      return false;
    }
    const fileName = normalizedPath.slice(lastSlash + 1);
    return isCoreLogName(fileName);
  }));
  const chunks = [];
  for (const entryPath of candidatePaths) {
    const bytes = entries[entryPath];
    if (!bytes)
      continue;
    const content = decodeNodeBytes(bytes);
    if (!contentMatchesFocus(content, focus))
      continue;
    chunks.push({
      content,
      source: toZipReference(sourceRef, toPosixPath(entryPath)),
      path: toPosixPath(entryPath)
    });
  }
  return joinMergedWithSources(chunks);
};
var buildDefaultZipContent = (entries, paths, basePath, sourceRef) => {
  const bakLogName = BAK_LOG_NAMES.find((name) => findZipEntry(entries, paths, joinPath(basePath, name)));
  const mainLogName = MAIN_LOG_NAMES.find((name) => findZipEntry(entries, paths, joinPath(basePath, name)));
  const chunks = [];
  if (bakLogName) {
    const data = findZipEntry(entries, paths, joinPath(basePath, bakLogName));
    if (data) {
      chunks.push({
        content: decodeNodeBytes(data),
        source: toZipReference(sourceRef, joinPath(basePath, bakLogName)),
        path: toPosixPath(joinPath(basePath, bakLogName))
      });
    }
  }
  if (mainLogName) {
    const data = findZipEntry(entries, paths, joinPath(basePath, mainLogName));
    if (data) {
      chunks.push({
        content: decodeNodeBytes(data),
        source: toZipReference(sourceRef, joinPath(basePath, mainLogName)),
        path: toPosixPath(joinPath(basePath, mainLogName))
      });
    }
  }
  return joinMergedWithSources(chunks);
};
var readNodeTextFileContent = async (filePath, options = {}) => {
  const limits = resolveArchiveLimits(options.archiveLimits);
  const context = options.budgetContext ?? await createNodeInputBudgetContext(import_node_path.default.dirname(import_node_path.default.resolve(filePath)), limits);
  return readNodeTextFileWithinBudget(filePath, context);
};
var readNodeTextFilesContent = async (filePaths, options = {}) => {
  const limits = resolveArchiveLimits(options.archiveLimits);
  const commonRoot = filePaths.length > 0 ? import_node_path.default.dirname(import_node_path.default.resolve(filePaths[0])) : process.cwd();
  const context = options.budgetContext ?? await createNodeInputBudgetContext(commonRoot, limits);
  const contents = [];
  for (const filePath of filePaths) {
    contents.push(await readNodeTextFileWithinBudget(filePath, context));
  }
  return contents;
};
var extractZipContentFromNodeBuffer = (zipData, sourceRef = "memory.zip", options = {}) => {
  const limits = resolveArchiveLimits(options.archiveLimits);
  const { files } = extractZipEntriesWithinLimits(zipData, isNeededZipEntry, limits);
  const paths = Object.keys(files);
  const basePath = findBaseDirectory(paths);
  if (basePath == null)
    return null;
  const merged = options.focus ? collectFocusedZipContents(files, paths, basePath, options.focus, sourceRef) : buildDefaultZipContent(files, paths, basePath, sourceRef);
  if (!merged.content)
    return null;
  const errorImages = /* @__PURE__ */ new Map();
  const visionImages = /* @__PURE__ */ new Map();
  const waitFreezesImages = /* @__PURE__ */ new Map();
  const textFiles = [];
  const onErrorPrefix = joinPath(basePath, "on_error/").toLowerCase();
  const visionPrefix = joinPath(basePath, "vision/").toLowerCase();
  for (const currentPath of paths) {
    const normalizedPath = toPosixPath(currentPath);
    const lowerPath = normalizedPath.toLowerCase();
    const fileName = normalizedPath.slice(normalizedPath.lastIndexOf("/") + 1);
    if (lowerPath.startsWith(onErrorPrefix) && lowerPath.endsWith(".png")) {
      const key = parseErrorImageKey(fileName);
      if (key) {
        errorImages.set(key, toZipReference(sourceRef, normalizedPath));
      }
    }
    if (lowerPath.startsWith(visionPrefix) && lowerPath.endsWith(".jpg")) {
      const visionKey = parseVisionImageKey(fileName);
      if (visionKey) {
        visionImages.set(visionKey, toZipReference(sourceRef, normalizedPath));
      }
      const waitKey = parseWaitFreezesKey(fileName);
      if (waitKey) {
        waitFreezesImages.set(waitKey, toZipReference(sourceRef, normalizedPath));
      }
    }
    if (!isSearchTextFile(normalizedPath))
      continue;
    if (isCoreLogName(fileName))
      continue;
    const fileData = files[currentPath];
    if (!fileData)
      continue;
    textFiles.push({
      path: normalizedPath,
      name: fileName,
      content: decodeNodeBytes(fileData),
      reference: toZipReference(sourceRef, normalizedPath)
    });
  }
  textFiles.sort((a, b3) => a.path.localeCompare(b3.path));
  return { content: merged.content, sourceSegments: merged.segments, errorImages, visionImages, waitFreezesImages, textFiles };
};
var extractZipContentFromNodeFile = async (zipFilePath, options = {}) => {
  const limits = resolveArchiveLimits(options.archiveLimits);
  const bytes = await readNodeArchiveFileBytes(zipFilePath, limits);
  return extractZipContentFromNodeBuffer(bytes, zipFilePath, {
    ...options,
    archiveLimits: limits
  });
};
var readNodeArchiveFileBytes = async (zipFilePath, limits) => {
  assertArchiveInputsWithinLimits([{ size: 0 }], limits);
  const context = await createNodeInputBudgetContext(import_node_path.default.dirname(import_node_path.default.resolve(zipFilePath)), limits);
  chargePath(context, zipFilePath);
  await assertPathInsideContext(context, zipFilePath);
  const bytes = await readBoundedRegularFile(zipFilePath, limits.maxCompressedBytes, (actualBytes) => new ArchiveLimitError("compressed-size", actualBytes, limits.maxCompressedBytes));
  assertArchiveInputsWithinLimits([{ size: bytes.byteLength }], limits);
  return bytes;
};
var assertDirectoryIdentity = (directoryPath, expected, stats) => {
  if (!stats.isDirectory() || stats.isSymbolicLink()) {
    throw new InputFileError("not-directory", directoryPath, `Expected a stable directory: ${directoryPath}`);
  }
  if (!sameFileIdentity(expected, getFileIdentity(stats))) {
    throw new InputFileError("identity-changed", directoryPath, `Directory identity changed during traversal: ${directoryPath}`);
  }
};
var inspectDirectory = async (context, directoryPath) => {
  if (pathKey(directoryPath) !== pathKey(context.rootPath))
    chargePath(context, directoryPath);
  const stats = await (0, import_promises2.lstat)(directoryPath);
  if (stats.isSymbolicLink()) {
    throw new InputFileError("symlink", directoryPath, `Symbolic-link directories are not allowed: ${directoryPath}`);
  }
  if (!stats.isDirectory()) {
    throw new InputFileError("not-directory", directoryPath, `Expected a directory: ${directoryPath}`);
  }
  await assertPathInsideContext(context, directoryPath);
  recordDiscoveredIdentity(context, directoryPath, stats);
  return stats;
};
var withSafeDirectory = async (context, directoryPath, consume) => {
  const beforeOpen = await inspectDirectory(context, directoryPath);
  const expectedIdentity = getFileIdentity(beforeOpen);
  const directory = await (0, import_promises2.opendir)(directoryPath);
  const afterOpen = await (0, import_promises2.lstat)(directoryPath);
  assertDirectoryIdentity(directoryPath, expectedIdentity, afterOpen);
  try {
    return await consume(directory);
  } finally {
    await directory.close().catch(() => void 0);
    const afterRead = await (0, import_promises2.lstat)(directoryPath);
    assertDirectoryIdentity(directoryPath, expectedIdentity, afterRead);
  }
};
var tryInspectDirectory = async (context, directoryPath) => {
  try {
    await inspectDirectory(context, directoryPath);
    return true;
  } catch (error) {
    if (error.code === "ENOENT")
      return false;
    throw error;
  }
};
var hasNodeMainLogInDirectory = async (context, directoryPath) => {
  if (!await tryInspectDirectory(context, directoryPath))
    return false;
  for (const name of MAIN_LOG_NAMES) {
    const candidatePath = import_node_path.default.join(directoryPath, name);
    try {
      const stats = await inspectDirectoryEntry(context, candidatePath);
      if (stats.isFile())
        return true;
    } catch (error) {
      if (error.code === "ENOENT")
        continue;
      throw error;
    }
  }
  return false;
};
var findExistingRegularNodeFile = async (context, directoryPath, names) => {
  for (const name of names) {
    const candidatePath = import_node_path.default.join(directoryPath, name);
    try {
      const stats = await inspectDirectoryEntry(context, candidatePath);
      if (stats.isFile())
        return candidatePath;
    } catch (error) {
      if (error.code === "ENOENT")
        continue;
      throw error;
    }
  }
  return null;
};
var findDebugDirectoryRecursively = async (rootPath, context) => {
  const pending = [rootPath];
  while (pending.length > 0) {
    const currentPath = pending.pop();
    if (!currentPath)
      break;
    const found = await withSafeDirectory(context, currentPath, async (directory) => {
      for await (const entry of directory) {
        const fullPath = import_node_path.default.join(currentPath, entry.name);
        const stats = await inspectDirectoryEntry(context, fullPath);
        if (!stats.isDirectory())
          continue;
        if (await hasNodeMainLogInDirectory(context, fullPath))
          return fullPath;
        pending.push(fullPath);
      }
      return null;
    });
    if (found)
      return found;
  }
  return null;
};
var resolveNodeDebugDirectory = async (inputPath, context) => {
  if (await hasNodeMainLogInDirectory(context, inputPath))
    return inputPath;
  const directDebugPath = import_node_path.default.join(inputPath, "debug");
  if (await hasNodeMainLogInDirectory(context, directDebugPath))
    return directDebugPath;
  return findDebugDirectoryRecursively(inputPath, context);
};
var collectFilesRecursively = async (rootPath, context) => {
  const collected = [];
  const pending = [rootPath];
  while (pending.length > 0) {
    const currentPath = pending.pop();
    if (!currentPath)
      break;
    await withSafeDirectory(context, currentPath, async (directory) => {
      for await (const entry of directory) {
        const fullPath = import_node_path.default.join(currentPath, entry.name);
        const stats = await inspectDirectoryEntry(context, fullPath);
        if (stats.isDirectory()) {
          pending.push(fullPath);
        } else if (stats.isFile()) {
          collected.push(fullPath);
        }
      }
    });
  }
  return collected;
};
var pickPrimaryLogPath = async (debugPath, allFiles, candidates) => {
  for (const name of candidates) {
    const directPath = import_node_path.default.join(debugPath, name);
    const directMatch = allFiles.find((filePath) => pathKey(filePath) === pathKey(directPath));
    if (directMatch)
      return directMatch;
  }
  const normalizedCandidates = new Set(candidates.map((name) => name.toLowerCase()));
  for (const filePath of allFiles) {
    const fileName = import_node_path.default.basename(filePath).toLowerCase();
    if (normalizedCandidates.has(fileName)) {
      return filePath;
    }
  }
  return null;
};
var buildDefaultDirectoryContent = async (debugPath, allFiles, context) => {
  const bakLogPath = await pickPrimaryLogPath(debugPath, allFiles, BAK_LOG_NAMES);
  const mainLogPath = await pickPrimaryLogPath(debugPath, allFiles, MAIN_LOG_NAMES);
  const chunks = [];
  if (bakLogPath) {
    chunks.push({
      content: await readNodeTextFileWithinBudget(bakLogPath, context),
      source: toFileReference(bakLogPath),
      path: toPosixPath(import_node_path.default.relative(debugPath, bakLogPath))
    });
  }
  if (mainLogPath) {
    chunks.push({
      content: await readNodeTextFileWithinBudget(mainLogPath, context),
      source: toFileReference(mainLogPath),
      path: toPosixPath(import_node_path.default.relative(debugPath, mainLogPath))
    });
  }
  return joinMergedWithSources(chunks);
};
var loadNodeLogDirectory = async (inputDirectoryPath, options = {}) => {
  const limits = resolveArchiveLimits(options.archiveLimits);
  const context = await createNodeInputBudgetContext(inputDirectoryPath, limits);
  const debugPath = await resolveNodeDebugDirectory(inputDirectoryPath, context);
  if (!debugPath)
    return null;
  const allFiles = await collectFilesRecursively(debugPath, context);
  const merged = options.focus ? await collectFocusedFileContents(allFiles.filter((filePath) => isCoreLogName(import_node_path.default.basename(filePath))), options.focus, context) : await buildDefaultDirectoryContent(debugPath, allFiles, context);
  if (!merged.content)
    return null;
  const errorImages = /* @__PURE__ */ new Map();
  const visionImages = /* @__PURE__ */ new Map();
  const waitFreezesImages = /* @__PURE__ */ new Map();
  const textFiles = [];
  for (const absolutePath of allFiles) {
    const relativePath2 = toPosixPath(import_node_path.default.relative(debugPath, absolutePath));
    const lowerRelativePath = relativePath2.toLowerCase();
    const fileName = import_node_path.default.basename(absolutePath);
    if (isRelativeImagePath(lowerRelativePath, "on_error", ".png")) {
      const key = parseErrorImageKey(fileName);
      if (key) {
        errorImages.set(key, toFileReference(absolutePath));
      }
    }
    if (isRelativeImagePath(lowerRelativePath, "vision", ".jpg")) {
      const visionKey = parseVisionImageKey(fileName);
      if (visionKey) {
        visionImages.set(visionKey, toFileReference(absolutePath));
      }
      const waitKey = parseWaitFreezesKey(fileName);
      if (waitKey) {
        waitFreezesImages.set(waitKey, toFileReference(absolutePath));
      }
    }
    if (!isSearchTextFile(relativePath2))
      continue;
    if (isCoreLogName(fileName))
      continue;
    textFiles.push({
      path: relativePath2,
      name: fileName,
      content: await readNodeTextFileWithinBudget(absolutePath, context),
      reference: toFileReference(absolutePath)
    });
  }
  textFiles.sort((a, b3) => a.path.localeCompare(b3.path));
  return {
    content: merged.content,
    sourceSegments: merged.segments,
    errorImages,
    visionImages,
    waitFreezesImages,
    textFiles
  };
};

// ../../node_modules/.pnpm/@windsland52+maa-log-tools@1.3.0/node_modules/@windsland52/maa-log-tools/dist/frameworkInput.js
var import_promises3 = require("node:fs/promises");
var import_node_path2 = __toESM(require("node:path"), 1);
var MAIN_LOG_NAMES2 = ["maafw.log", "maa.log"];
var BAK_LOG_NAMES2 = ["maafw.bak.log", "maa.bak.log"];
var toPosixPath2 = (value) => value.replace(/\\/g, "/");
var decodeBytes = (bytes) => {
  for (const encoding of ["utf-8", "gbk", "gb18030", "gb2312"]) {
    try {
      return new TextDecoder(encoding, { fatal: true }).decode(bytes);
    } catch {
      continue;
    }
  }
  return new TextDecoder("utf-8").decode(bytes);
};
var findEntryPath = (paths, target) => {
  const normalizedTarget = toPosixPath2(target).toLowerCase();
  return paths.find((candidate) => toPosixPath2(candidate).toLowerCase() === normalizedTarget) ?? null;
};
var findZipBasePath = (paths) => {
  for (const candidate of paths) {
    const normalized = toPosixPath2(candidate);
    const lowerName = import_node_path2.default.posix.basename(normalized).toLowerCase();
    if (!MAIN_LOG_NAMES2.includes(lowerName))
      continue;
    const parent = import_node_path2.default.posix.dirname(normalized);
    return parent === "." ? "" : parent;
  }
  return null;
};
var loadZipSources = async (zipPath, limits) => {
  const bytes = await readNodeArchiveFileBytes(zipPath, limits);
  const entries = inspectZipDirectory(bytes, limits);
  const paths = entries.map((entry) => entry.name);
  const basePath = findZipBasePath(paths);
  if (basePath == null)
    return [];
  const selected = [];
  for (const name of [...BAK_LOG_NAMES2, ...MAIN_LOG_NAMES2]) {
    const candidate = findEntryPath(paths, basePath ? `${basePath}/${name}` : name);
    if (candidate && !selected.includes(candidate))
      selected.push(candidate);
    if (candidate && MAIN_LOG_NAMES2.includes(name))
      break;
  }
  const selectedPaths = new Set(selected);
  const { files } = extractInspectedZipEntriesWithinLimits(bytes, entries, (entryPath) => selectedPaths.has(entryPath), limits);
  return selected.flatMap((entryPath) => {
    const bytes2 = files[entryPath];
    if (!bytes2)
      return [];
    const normalized = toPosixPath2(entryPath);
    return [{
      path: normalized,
      name: import_node_path2.default.posix.basename(normalized),
      content: decodeBytes(bytes2),
      reference: `zip:${toPosixPath2(zipPath)}#${normalized}`
    }];
  });
};
var loadDirectorySources = async (directoryPath, limits) => {
  const context = await createNodeInputBudgetContext(directoryPath, limits);
  const debugPath = await resolveNodeDebugDirectory(directoryPath, context);
  if (!debugPath)
    return [];
  const selected = [
    await findExistingRegularNodeFile(context, debugPath, BAK_LOG_NAMES2),
    await findExistingRegularNodeFile(context, debugPath, MAIN_LOG_NAMES2)
  ].filter((candidate) => candidate != null);
  const contents = await readNodeTextFilesContent(selected, {
    archiveLimits: limits,
    budgetContext: context
  });
  return selected.map((absolutePath, index) => ({
    path: toPosixPath2(import_node_path2.default.relative(debugPath, absolutePath)),
    name: import_node_path2.default.basename(absolutePath),
    content: contents[index] ?? "",
    reference: `file:${toPosixPath2(absolutePath)}`
  }));
};
var loadFrameworkLogSources = async (targetPath, options = {}) => {
  const limits = resolveArchiveLimits(options.archiveLimits);
  const targetStat = await (0, import_promises3.lstat)(targetPath);
  if (targetStat.isSymbolicLink()) {
    throw new InputFileError("symlink", targetPath, `Symbolic-link inputs are not allowed: ${targetPath}`);
  }
  if (targetStat.isDirectory())
    return loadDirectorySources(targetPath, limits);
  if (!targetStat.isFile()) {
    throw new InputFileError("not-regular-file", targetPath, `Expected a regular file: ${targetPath}`);
  }
  if (targetPath.toLowerCase().endsWith(".zip"))
    return loadZipSources(targetPath, limits);
  return [{
    path: toPosixPath2(targetPath),
    name: import_node_path2.default.basename(targetPath),
    content: await readNodeTextFileContent(targetPath, { archiveLimits: limits }),
    reference: `file:${toPosixPath2(targetPath)}`
  }];
};

// ../../node_modules/.pnpm/@windsland52+maa-log-tools@1.3.0/node_modules/@windsland52/maa-log-tools/dist/frameworkVersion.js
var PROCESS_START_PATTERN = /\]\[Logger\]\s+MAA Process Start(?:\s|$)/;
var VERSION_PATTERN = /\]\[Logger\]\s+Version\s+(v\d+(?:\.\d+)+(?:[-+][0-9A-Za-z.-]+)?)(?:\s|$)/;
var TIMESTAMP_PATTERN = /^\[(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d{1,3})?)\]/;
var splitLines = (content) => {
  const lines = content.split(/\r?\n/);
  if (lines[lines.length - 1] === "")
    lines.pop();
  return lines;
};
var timestampOf = (line) => {
  if (!line)
    return null;
  return line.match(TIMESTAMP_PATTERN)?.[1] ?? null;
};
var position = (source, lines, lineIndex) => ({
  source: source.reference,
  path: source.path,
  line: lineIndex + 1,
  timestamp: timestampOf(lines[lineIndex])
});
var findTimestamp = (lines, startIndex, endIndex, direction) => {
  for (let index = direction === 1 ? startIndex : endIndex; index >= startIndex && index <= endIndex; index += direction) {
    const timestamp = timestampOf(lines[index]);
    if (timestamp)
      return timestamp;
  }
  return null;
};
var buildSession = (source, lines, startIndex, endIndex, startKind, sessionIndex) => {
  const versionEvidence = [];
  for (let index = startIndex; index <= endIndex; index += 1) {
    const match = lines[index]?.match(VERSION_PATTERN);
    const version = match?.[1];
    if (!version)
      continue;
    versionEvidence.push({
      ...position(source, lines, index),
      version
    });
  }
  const versions = [...new Set(versionEvidence.map((item) => item.version))];
  const status = versions.length === 0 ? "missing_version" : versions.length === 1 ? "resolved" : "conflict";
  const start = position(source, lines, startIndex);
  start.timestamp = findTimestamp(lines, startIndex, endIndex, 1);
  const end = position(source, lines, endIndex);
  end.timestamp = findTimestamp(lines, startIndex, endIndex, -1);
  return {
    sessionId: `framework-session-${sessionIndex}`,
    startKind,
    status,
    version: status === "resolved" ? versions[0] ?? null : null,
    versions,
    start,
    end,
    versionEvidence
  };
};
var extractFrameworkSessions = (sources) => {
  const sessions = [];
  for (const source of sources) {
    const lines = splitLines(source.content);
    if (lines.length === 0)
      continue;
    const processStarts = [];
    for (let index = 0; index < lines.length; index += 1) {
      if (PROCESS_START_PATTERN.test(lines[index] ?? ""))
        processStarts.push(index);
    }
    const firstProcessStart = processStarts[0];
    const hasPartialPrefix = firstProcessStart != null && firstProcessStart > 0 && lines.slice(0, firstProcessStart).some((line) => VERSION_PATTERN.test(line) || line.includes("!!!OnEventNotify!!!"));
    const boundaries = processStarts.length === 0 || hasPartialPrefix ? [0, ...processStarts] : processStarts;
    for (let index = 0; index < boundaries.length; index += 1) {
      const startIndex = boundaries[index];
      if (startIndex == null)
        continue;
      const nextStart = boundaries[index + 1];
      const endIndex = nextStart == null ? lines.length - 1 : nextStart - 1;
      const isProcessStart = processStarts.includes(startIndex);
      sessions.push(buildSession(source, lines, startIndex, endIndex, isProcessStart ? "process_start" : "partial_file", sessions.length + 1));
    }
  }
  const versions = [...new Set(sessions.flatMap((session) => session.versions))];
  const hasConflict = sessions.some((session) => session.status === "conflict");
  const summary = {
    status: hasConflict ? "conflict" : versions.length === 0 ? "none" : versions.length === 1 ? "single" : "multiple",
    versions
  };
  const warnings = [];
  if (summary.status === "multiple") {
    warnings.push(`Multiple MaaFramework versions found in selected logs: ${versions.join(", ")}.`);
  }
  if (summary.status === "conflict") {
    warnings.push("Conflicting MaaFramework version headers found within a runtime session.");
  }
  if (sessions.some((session) => session.startKind === "partial_file")) {
    warnings.push("Some core log content starts without a MAA Process Start marker; its session boundary is partial.");
  }
  if (sessions.some((session) => session.status === "missing_version")) {
    warnings.push("Some MaaFramework runtime sessions do not contain a Logger version header.");
  }
  return { sessions, summary, warnings };
};

// ../../node_modules/.pnpm/@windsland52+maa-log-tools@1.3.0/node_modules/@windsland52/maa-log-tools/dist/nextListPresentation.js
var normalizeOptionalName = (value) => {
  if (typeof value !== "string")
    return void 0;
  const trimmed = value.trim();
  return trimmed || void 0;
};
var resolveRecognitionNextListName = (attempt, nextListNames) => {
  const anchorName = normalizeOptionalName(attempt.anchor_name);
  if (anchorName && (!nextListNames || nextListNames.has(anchorName))) {
    return anchorName;
  }
  return attempt.name || "";
};

// ../../node_modules/.pnpm/@windsland52+maa-log-tools@1.3.0/node_modules/@windsland52/maa-log-tools/dist/nodeExecutionName.js
var normalizeOptionalName2 = (value) => {
  if (typeof value !== "string")
    return void 0;
  const trimmed = value.trim();
  return trimmed || void 0;
};
var normalizeHitCandidateName = (value) => {
  const withoutPrefixes = value.replace(/^(?:\[[^\]]+\]\s*)+/u, "").trim();
  const equalIndex = withoutPrefixes.indexOf("=");
  if (equalIndex < 0)
    return withoutPrefixes;
  return withoutPrefixes.slice(0, equalIndex).trim();
};
var resolveCandidateNextName = (candidate, nextNames) => {
  const normalized = normalizeOptionalName2(candidate);
  if (!normalized)
    return void 0;
  if (nextNames.has(normalized))
    return normalized;
  const normalizedHit = normalizeHitCandidateName(normalized);
  if (normalizedHit && nextNames.has(normalizedHit))
    return normalizedHit;
  return void 0;
};
var pushSuccessFlowCandidates = (rootItems, output) => {
  if (!Array.isArray(rootItems) || rootItems.length === 0)
    return;
  const stack = [...rootItems];
  while (stack.length > 0) {
    const flowItem = stack.pop();
    if (!flowItem)
      continue;
    if (Array.isArray(flowItem.children) && flowItem.children.length > 0) {
      stack.push(...flowItem.children);
    }
    if (flowItem.status !== "success")
      continue;
    output.push(flowItem.name);
    output.push(flowItem.anchor_name);
    if (flowItem.type === "recognition") {
      output.push(flowItem.reco_details?.name);
    }
    if (flowItem.type === "action") {
      output.push(flowItem.action_details?.name);
    }
  }
};
var resolveNodeMatchedRecognitionName = (node) => {
  return resolveNodeMatchedNextListItem(node)?.name;
};
var resolveNodeMatchedNextListItem = (node) => {
  const nextNames = new Set((node.next_list || []).map((item) => item.name).filter((name) => !!name));
  if (nextNames.size === 0)
    return void 0;
  const nextItemByName = /* @__PURE__ */ new Map();
  for (const nextItem of node.next_list || []) {
    if (!nextItem?.name || nextItemByName.has(nextItem.name))
      continue;
    nextItemByName.set(nextItem.name, nextItem);
  }
  const attempts = buildNodeRecognitionAttempts(node);
  for (const attempt of attempts) {
    if (attempt.status !== "success")
      continue;
    const matchedCandidate = resolveRecognitionNextListName(attempt, nextNames);
    const matchedNextName = resolveCandidateNextName(matchedCandidate, nextNames);
    if (!matchedNextName)
      continue;
    const nextItem = nextItemByName.get(matchedNextName);
    if (nextItem)
      return { name: matchedNextName, nextItem };
  }
  for (const attempt of attempts) {
    if (attempt.status !== "running")
      continue;
    const matchedCandidate = resolveRecognitionNextListName(attempt, nextNames);
    const matchedNextName = resolveCandidateNextName(matchedCandidate, nextNames);
    if (!matchedNextName)
      continue;
    const nextItem = nextItemByName.get(matchedNextName);
    if (nextItem)
      return { name: matchedNextName, nextItem };
  }
  const fallbackCandidates = [
    node.node_details?.name,
    node.action_details?.name,
    node.reco_details?.name
  ];
  pushSuccessFlowCandidates(node.node_flow, fallbackCandidates);
  fallbackCandidates.push(node.name);
  for (const candidate of fallbackCandidates) {
    const matchedNextName = resolveCandidateNextName(candidate, nextNames);
    if (!matchedNextName)
      continue;
    const nextItem = nextItemByName.get(matchedNextName);
    if (nextItem)
      return { name: matchedNextName, nextItem };
  }
  return void 0;
};
var resolveNodeExecutionName = (node) => {
  return resolveNodeMatchedRecognitionName(node) || node.name || "\u672A\u547D\u540D\u8282\u70B9";
};

// ../../node_modules/.pnpm/@windsland52+maa-log-tools@1.3.0/node_modules/@windsland52/maa-log-tools/dist/taskExecutionOrder.js
var LOG_TIMESTAMP_REGEX = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?$/;
var toTimestampMs2 = (timestamp) => {
  if (!timestamp)
    return Number.POSITIVE_INFINITY;
  if (!LOG_TIMESTAMP_REGEX.test(timestamp))
    return Number.POSITIVE_INFINITY;
  const normalized = timestamp.includes("T") ? timestamp : timestamp.replace(" ", "T");
  const parsed = Date.parse(normalized);
  return Number.isFinite(parsed) ? parsed : Number.POSITIVE_INFINITY;
};
var sortNodesByGlobalExecutionOrder = (nodes) => {
  return nodes.map((node, index) => ({
    node,
    index,
    startMs: toTimestampMs2(node.ts)
  })).sort((left, right) => {
    const leftFinite = Number.isFinite(left.startMs);
    const rightFinite = Number.isFinite(right.startMs);
    if (leftFinite && rightFinite && left.startMs !== right.startMs) {
      return left.startMs - right.startMs;
    }
    if (leftFinite !== rightFinite) {
      return leftFinite ? -1 : 1;
    }
    return left.index - right.index;
  }).map((item) => item.node);
};

// ../../node_modules/.pnpm/@windsland52+maa-log-tools@1.3.0/node_modules/@windsland52/maa-log-tools/dist/nodeExecutionTimeline.js
var isNodeActionFailed = (node) => {
  if (node.action_details && node.action_details.success === false)
    return true;
  return (node.node_flow || []).some((item) => (item.type === "action" || item.type === "action_node") && item.status === "failed");
};
var buildNodeExecutionTimeline = (nodes, options = {}) => {
  const originalIndexByNode = /* @__PURE__ */ new Map();
  for (let index = 0; index < nodes.length; index++) {
    const node = nodes[index];
    if (!node || originalIndexByNode.has(node))
      continue;
    originalIndexByNode.set(node, index);
  }
  const filteredNodes = options.rootTaskId == null ? [...nodes] : nodes.filter((node) => node.task_id === options.rootTaskId);
  const orderedNodes = sortNodesByGlobalExecutionOrder(filteredNodes);
  return orderedNodes.map((node, index) => {
    const executionName = resolveNodeExecutionName(node);
    const matchedRecognitionName = resolveNodeMatchedRecognitionName(node);
    const focusNodeId = matchedRecognitionName ?? executionName;
    const originalIndex = originalIndexByNode.get(node) ?? index;
    if (matchedRecognitionName && isNodeActionFailed(node)) {
      return {
        index,
        originalIndex,
        executionName,
        navName: `\u52A8\u4F5C\u5931\u8D25: ${matchedRecognitionName}`,
        navStatus: "action-failed",
        focusNodeId,
        ts: node.ts,
        nodeInfo: node,
        matchedRecognitionName
      };
    }
    if (matchedRecognitionName) {
      return {
        index,
        originalIndex,
        executionName,
        navName: matchedRecognitionName,
        navStatus: node.status,
        focusNodeId,
        ts: node.ts,
        nodeInfo: node,
        matchedRecognitionName
      };
    }
    if (node.status === "failed") {
      return {
        index,
        originalIndex,
        executionName,
        navName: "\u672A\u547D\u4E2D\uFF08\u8BC6\u522B\u8D85\u65F6\uFF09",
        navStatus: "timeout",
        focusNodeId,
        ts: node.ts,
        nodeInfo: node
      };
    }
    if (node.status === "running") {
      return {
        index,
        originalIndex,
        executionName,
        navName: "\u672A\u547D\u4E2D\uFF08\u8BC6\u522B\u4E2D\uFF09",
        navStatus: "running",
        focusNodeId,
        ts: node.ts,
        nodeInfo: node
      };
    }
    return {
      index,
      originalIndex,
      executionName,
      navName: executionName,
      navStatus: node.status,
      focusNodeId,
      ts: node.ts,
      nodeInfo: node
    };
  });
};

// ../../node_modules/.pnpm/@windsland52+maa-log-tools@1.3.0/node_modules/@windsland52/maa-log-tools/dist/runtimeInspection.js
var MLA_RUNTIME_INSPECTION_SCHEMA_VERSION = "mla-runtime-inspection/v1";
var timestampMs = (value) => {
  if (!value)
    return null;
  const parsed = Date.parse(value.includes("T") ? value : value.replace(" ", "T"));
  return Number.isFinite(parsed) ? parsed : null;
};
var elapsed = (start, end) => {
  const startMs = timestampMs(start);
  const endMs = timestampMs(end);
  return startMs == null || endMs == null ? null : Math.max(0, endMs - startMs);
};
var buildEvidenceIndex = (task) => {
  const exactLines = /* @__PURE__ */ new Map();
  const ordered = [];
  for (const event of task.events) {
    if (event._lineNumber == null)
      continue;
    if (!exactLines.has(event.timestamp))
      exactLines.set(event.timestamp, event._lineNumber);
    const timestamp = timestampMs(event.timestamp);
    if (timestamp != null)
      ordered.push({ timestamp, line: event._lineNumber });
  }
  ordered.sort((left, right) => left.timestamp - right.timestamp);
  return { exactLines, ordered };
};
var evidence = (index, timestamp) => {
  if (timestamp) {
    const exactLine = index.exactLines.get(timestamp);
    if (exactLine != null)
      return { timestamp, mergedLine: exactLine };
  }
  const target = timestampMs(timestamp);
  if (target == null || index.ordered.length === 0) {
    return { timestamp: timestamp ?? null, mergedLine: null };
  }
  let low = 0;
  let high = index.ordered.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if ((index.ordered[middle]?.timestamp ?? target) < target)
      low = middle + 1;
    else
      high = middle;
  }
  const before = index.ordered[low - 1];
  const after = index.ordered[low];
  const nearest = before == null ? after : after == null || target - before.timestamp <= after.timestamp - target ? before : after;
  return { timestamp: timestamp ?? null, mergedLine: nearest?.line ?? null };
};
var recognitionItems = (items) => (items ?? []).flatMap((item) => [
  ...item.type === "recognition" || item.type === "recognition_node" ? [item] : [],
  ...recognitionItems(item.children)
]);
var imagesFor = (node) => {
  const attempts = recognitionItems(node.node_flow);
  return {
    error: [node.error_image, ...attempts.map((item) => item.error_image)].filter((item) => Boolean(item)),
    vision: attempts.map((item) => item.vision_image).filter((item) => Boolean(item))
  };
};
var scopeFor = (task, sessionId, executionId) => ({
  sessionId,
  executionId,
  taskId: task.task_id,
  taskName: task.entry
});
var sessionFor = (task, sessions) => {
  const candidates = sessions.filter((session) => session.start.timestamp != null && session.end.timestamp != null && task.start_time >= session.start.timestamp && task.start_time <= session.end.timestamp);
  const complete = candidates.filter((session) => session.startKind === "process_start");
  if (complete.length === 1)
    return complete[0] ?? null;
  const partial = candidates.filter((session) => session.startKind === "partial_file");
  return complete.length === 0 && partial.length === 1 ? partial[0] ?? null : null;
};
var metricDistribution = (values) => {
  if (values.length === 0) {
    return { count: 0, minimum: 0, p50: 0, p95: 0, maximum: 0, average: 0 };
  }
  const sorted = [...values].sort((left, right) => left - right);
  const percentile = (ratio) => sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1)] ?? 0;
  const total = sorted.reduce((sum, value) => sum + value, 0);
  return {
    count: sorted.length,
    minimum: sorted[0] ?? 0,
    p50: percentile(0.5),
    p95: percentile(0.95),
    maximum: sorted[sorted.length - 1] ?? 0,
    average: total / sorted.length
  };
};
var recognitionCandidateName = (attempt, nextNames) => {
  if (attempt.anchor_name && nextNames.has(attempt.anchor_name))
    return attempt.anchor_name;
  if (nextNames.has(attempt.name))
    return attempt.name;
  const detailName = attempt.reco_details?.name;
  return detailName && nextNames.has(detailName) ? detailName : null;
};
var increment = (map, key) => {
  map.set(key, (map.get(key) ?? 0) + 1);
};
var prioritize = (reasons) => {
  if (reasons.length === 0)
    return { priority: "low", priorityReasons: [] };
  if (reasons.includes("timeout") || reasons.includes("unmatched_terminal") || reasons.includes("still_repeating_at_log_end") || reasons.includes("related_to_direct_failure") || reasons.includes("incomplete_repetition")) {
    return { priority: "high", priorityReasons: reasons };
  }
  if (reasons.includes("high_mixed_results") || reasons.includes("high_unsuccessful_attempts") || reasons.includes("high_occurrence_count") || reasons.includes("high_repeat_count") || reasons.includes("long_duration")) {
    return { priority: "normal", priorityReasons: reasons };
  }
  return { priority: "low", priorityReasons: reasons };
};
var repetitions = (nodes) => {
  const result = [];
  let start = 0;
  while (start < nodes.length) {
    let best = null;
    for (let length = 1; length <= Math.min(8, Math.floor((nodes.length - start) / 2)); length += 1) {
      let count = 1;
      while (start + (count + 1) * length <= nodes.length) {
        const same = nodes.slice(start, start + length).every((node, offset) => node.name === nodes[start + count * length + offset]?.name);
        if (!same)
          break;
        count += 1;
      }
      if (count < (length === 1 ? 5 : 3))
        continue;
      if (best == null || length * count > best.length * best.count)
        best = { start, length, count };
    }
    if (best == null)
      start += 1;
    else {
      result.push(best);
      start += best.length * best.count;
    }
  }
  return result;
};
var canonicalCycle = (pattern) => {
  if (pattern.length < 2)
    return [...pattern];
  const rotations = pattern.map((_2, index) => [...pattern.slice(index), ...pattern.slice(0, index)]);
  rotations.sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
  return rotations[0] ?? [...pattern];
};
var findSourceSegment = (segments, mergedLine) => {
  for (const segment of segments) {
    if (mergedLine >= segment.startLine && mergedLine < segment.startLine + segment.lineCount) {
      return segment;
    }
  }
  return null;
};
var enrichWithSource = (position2, segments) => {
  if (position2.mergedLine == null) {
    return { timestamp: position2.timestamp, source: null, path: null, localLine: null };
  }
  const segment = findSourceSegment(segments, position2.mergedLine);
  if (!segment) {
    return { timestamp: position2.timestamp, source: null, path: null, localLine: null };
  }
  return {
    timestamp: position2.timestamp,
    source: segment.source,
    path: segment.path,
    localLine: position2.mergedLine - segment.startLine + 1
  };
};
var createEvidenceFn = (segments) => (index, timestamp) => enrichWithSource(evidence(index, timestamp), segments);
var buildRuntimeInspection = (output, framework, sourceSegments) => {
  const failures = [];
  const outcomes = [];
  const signals = [];
  const taskOccurrences = /* @__PURE__ */ new Map();
  const executionIds = /* @__PURE__ */ new Map();
  const sessionIds = /* @__PURE__ */ new Map();
  const executionSessionIds = /* @__PURE__ */ new Map();
  const evidenceAt = createEvidenceFn(sourceSegments);
  for (const task of output.tasks) {
    const occurrence = (taskOccurrences.get(task.task_id) ?? 0) + 1;
    taskOccurrences.set(task.task_id, occurrence);
    const executionId = `task-execution-${task.task_id}-${occurrence}`;
    const sessionId = sessionFor(task, framework.sessions)?.sessionId ?? null;
    executionIds.set(task, executionId);
    sessionIds.set(task, sessionId);
    executionSessionIds.set(executionId, sessionId);
  }
  const buildTask2 = (task) => {
    const sessionId = sessionIds.get(task) ?? null;
    const executionId = executionIds.get(task);
    if (!executionId)
      throw new Error("Task execution identity was not initialized.");
    const scope = scopeFor(task, sessionId, executionId);
    const directFailureIds = [];
    const outcomeIds = [];
    const signalIds = [];
    const recognitionOccurrences = [];
    const evidenceIndex = buildEvidenceIndex(task);
    const timeline = buildNodeExecutionTimeline(task.nodes, { rootTaskId: task.task_id });
    for (const item of timeline) {
      const failureKind = item.navStatus === "action-failed" ? "action_failed" : item.navStatus === "timeout" && item.nodeInfo.next_list.length > 0 ? "next_list_timeout" : null;
      let nodeFailureId = null;
      if (failureKind) {
        nodeFailureId = `failure-${failures.length + 1}`;
        const images = imagesFor(item.nodeInfo);
        failures.push({
          ...scope,
          failureId: nodeFailureId,
          kind: failureKind,
          nodeId: item.nodeInfo.node_id,
          nodeName: item.executionName,
          startedAt: item.nodeInfo.ts,
          endedAt: item.nodeInfo.end_ts ?? null,
          errorImages: [...new Set(images.error)],
          visionImages: [...new Set(images.vision)],
          evidence: evidenceAt(evidenceIndex, item.nodeInfo.end_ts ?? item.nodeInfo.ts)
        });
        directFailureIds.push(nodeFailureId);
      }
      if (item.nodeInfo.status !== "success") {
        const outcomeId = `outcome-${outcomes.length + 1}`;
        outcomes.push({
          ...scope,
          outcomeId,
          kind: "pipeline_node",
          status: item.nodeInfo.status,
          nodeId: item.nodeInfo.node_id,
          nodeName: item.executionName,
          directFailureIds: nodeFailureId ? [nodeFailureId] : [],
          evidence: evidenceAt(evidenceIndex, item.nodeInfo.end_ts ?? item.nodeInfo.ts)
        });
        outcomeIds.push(outcomeId);
      }
      const attempts = recognitionItems(item.nodeInfo.node_flow);
      const missed = attempts.filter((attempt) => attempt.status === "failed");
      if (item.nodeInfo.next_list.length > 0) {
        const terminalOutcome = item.navStatus === "timeout" ? "timeout" : item.nodeInfo.status === "running" ? "running" : item.matchedRecognitionName ? "matched" : "unmatched";
        recognitionOccurrences.push({
          nodeId: item.nodeInfo.node_id,
          pipelineNodeName: item.nodeInfo.name,
          nextList: item.nodeInfo.next_list.map((next) => ({
            name: next.name,
            anchor: next.anchor,
            jumpBack: next.jump_back
          })),
          attempts,
          terminalMatch: item.matchedRecognitionName ?? null,
          terminalOutcome,
          durationMs: elapsed(item.nodeInfo.ts, item.nodeInfo.end_ts),
          sample: {
            nodeId: item.nodeInfo.node_id,
            startedAt: item.nodeInfo.ts,
            endedAt: item.nodeInfo.end_ts ?? null,
            attemptCount: attempts.length,
            unsuccessfulAttempts: missed.length,
            terminalMatch: item.matchedRecognitionName ?? null,
            evidence: {
              start: evidenceAt(evidenceIndex, attempts[0]?.ts ?? item.nodeInfo.ts),
              end: evidenceAt(evidenceIndex, item.nodeInfo.end_ts ?? item.nodeInfo.ts)
            }
          }
        });
      }
    }
    const recognitionGroups = /* @__PURE__ */ new Map();
    for (const occurrence of recognitionOccurrences) {
      const key = JSON.stringify([occurrence.pipelineNodeName, occurrence.nextList]);
      const group = recognitionGroups.get(key) ?? [];
      group.push(occurrence);
      recognitionGroups.set(key, group);
    }
    for (const group of recognitionGroups.values()) {
      const firstOccurrence = group[0];
      const lastOccurrence = group[group.length - 1];
      if (!firstOccurrence || !lastOccurrence)
        continue;
      const signalId = `signal-${signals.length + 1}`;
      const terminalMatches = /* @__PURE__ */ new Map();
      const terminalOutcomes = { matched: 0, timeout: 0, running: 0, unmatched: 0 };
      const candidates = new Map(firstOccurrence.nextList.map((next) => [next.name, {
        name: next.name,
        evaluationCount: 0,
        matchedAttemptCount: 0,
        unsuccessfulAttemptCount: 0,
        runningAttemptCount: 0,
        terminalMatchCount: 0
      }]));
      let unmappedAttemptCount = 0;
      let occurrencesWithMixedResults = 0;
      for (const occurrence of group) {
        terminalOutcomes[occurrence.terminalOutcome] += 1;
        if (occurrence.terminalMatch) {
          increment(terminalMatches, occurrence.terminalMatch);
          const candidate = candidates.get(occurrence.terminalMatch);
          if (candidate)
            candidate.terminalMatchCount += 1;
        }
        const statuses = new Set(occurrence.attempts.map((attempt) => attempt.status));
        if (statuses.has("failed") && statuses.has("success"))
          occurrencesWithMixedResults += 1;
        const nextNames = new Set(candidates.keys());
        for (const attempt of occurrence.attempts) {
          const candidateName = recognitionCandidateName(attempt, nextNames);
          const candidate = candidateName ? candidates.get(candidateName) : null;
          if (!candidate) {
            unmappedAttemptCount += 1;
            continue;
          }
          candidate.evaluationCount += 1;
          if (attempt.status === "success")
            candidate.matchedAttemptCount += 1;
          else if (attempt.status === "failed")
            candidate.unsuccessfulAttemptCount += 1;
          else
            candidate.runningAttemptCount += 1;
        }
      }
      const worstOccurrence = [...group].sort((left, right) => right.sample.unsuccessfulAttempts - left.sample.unsuccessfulAttempts || right.sample.attemptCount - left.sample.attemptCount)[0] ?? firstOccurrence;
      const attemptsDist = metricDistribution(group.map((item) => item.sample.attemptCount));
      const unsuccessfulDist = metricDistribution(group.map((item) => item.sample.unsuccessfulAttempts));
      const durationDist = metricDistribution(group.flatMap((item) => item.durationMs == null ? [] : [item.durationMs]));
      const reasons = [];
      if (terminalOutcomes.timeout > 0)
        reasons.push("timeout");
      if (terminalOutcomes.unmatched > 0)
        reasons.push("unmatched_terminal");
      if (group.length > 0 && occurrencesWithMixedResults / group.length >= 0.3)
        reasons.push("high_mixed_results");
      if (unsuccessfulDist.maximum >= 5 || unsuccessfulDist.p95 >= 3)
        reasons.push("high_unsuccessful_attempts");
      if (group.length >= 20)
        reasons.push("high_occurrence_count");
      if (group.some((item) => item.sample.nodeId && failures.some((failure2) => failure2.nodeId === item.sample.nodeId && failure2.executionId === scope.executionId))) {
        reasons.push("related_to_direct_failure");
      }
      const ranking = prioritize(reasons);
      signals.push({
        ...scope,
        signalId,
        kind: "recognition_activity",
        pipelineNodeName: firstOccurrence.pipelineNodeName,
        nextList: firstOccurrence.nextList,
        occurrenceCount: group.length,
        occurrencesWithMixedResults,
        terminalOutcomes,
        terminalMatches: [...terminalMatches].map(([name, count]) => ({ name, count })).sort((left, right) => right.count - left.count),
        candidateStatistics: [...candidates.values()],
        unmappedAttemptCount,
        attempts: attemptsDist,
        unsuccessfulAttempts: unsuccessfulDist,
        durationMs: durationDist,
        representatives: {
          first: firstOccurrence.sample,
          worst: worstOccurrence.sample,
          last: lastOccurrence.sample
        },
        priority: ranking.priority,
        priorityReasons: ranking.priorityReasons
      });
      signalIds.push(signalId);
    }
    const completed = timeline.map((item) => item.nodeInfo).filter((node) => node.status !== "running");
    const repetitionGroups = /* @__PURE__ */ new Map();
    for (const repeated of repetitions(completed)) {
      const first = completed[repeated.start];
      const lastIndex = repeated.start + repeated.length * repeated.count - 1;
      const last = completed[lastIndex];
      if (!first || !last)
        continue;
      const rawPattern = completed.slice(repeated.start, repeated.start + repeated.length).map((node) => node.name);
      const pattern = repeated.length === 1 ? rawPattern : canonicalCycle(rawPattern);
      const kind = repeated.length === 1 ? "repeated_node" : "repeated_node_cycle";
      const key = JSON.stringify([kind, pattern]);
      const group = repetitionGroups.get(key) ?? [];
      const timelineLastIndex = timeline.findIndex((item) => item.nodeInfo === last);
      const trailing = timelineLastIndex < 0 ? [] : timeline.slice(timelineLastIndex + 1);
      const reachesCompletedEnd = lastIndex === completed.length - 1;
      const continuesAtLogEnd = reachesCompletedEnd && task.status === "running" && trailing.every((item, offset) => item.nodeInfo.status === "running" && item.nodeInfo.name === rawPattern[offset % rawPattern.length]);
      const taskEndedAtPattern = reachesCompletedEnd && timelineLastIndex === timeline.length - 1 && task.status !== "running";
      group.push({
        pattern,
        repeatCount: repeated.count,
        durationMs: elapsed(first.ts, last.end_ts ?? last.ts) ?? 0,
        firstSeenAt: first.ts,
        lastSeenAt: last.end_ts ?? last.ts,
        termination: continuesAtLogEnd ? "still_repeating_at_log_end" : taskEndedAtPattern ? "task_ended" : "left_pattern",
        evidence: evidenceAt(evidenceIndex, first.ts)
      });
      repetitionGroups.set(key, group);
    }
    for (const group of repetitionGroups.values()) {
      const first = group[0];
      const last = group[group.length - 1];
      if (!first || !last)
        continue;
      const longest = [...group].sort((left, right) => right.durationMs - left.durationMs)[0] ?? first;
      const signalId = `signal-${signals.length + 1}`;
      const terminations = {
        leftPattern: group.filter((item) => item.termination === "left_pattern").length,
        taskEnded: group.filter((item) => item.termination === "task_ended").length,
        stillRepeatingAtLogEnd: group.filter((item) => item.termination === "still_repeating_at_log_end").length
      };
      const totalRepeatCount = group.reduce((sum, item) => sum + item.repeatCount, 0);
      const maximumRepeatCount = Math.max(...group.map((item) => item.repeatCount));
      const repetitionReasons = [];
      if (terminations.stillRepeatingAtLogEnd > 0)
        repetitionReasons.push("still_repeating_at_log_end");
      if (maximumRepeatCount >= 10 || totalRepeatCount >= 20)
        repetitionReasons.push("high_repeat_count");
      const repetitionRanking = prioritize(repetitionReasons);
      signals.push({
        ...scope,
        signalId,
        kind: first.pattern.length === 1 ? "repeated_node" : "repeated_node_cycle",
        pattern: first.pattern,
        segmentCount: group.length,
        totalRepeatCount,
        maximumRepeatCount,
        durationMs: metricDistribution(group.map((item) => item.durationMs)),
        terminations,
        representatives: {
          first,
          longest,
          last
        },
        detector: {
          name: "repeated-completed-node-sequence",
          version: 1,
          minimumRepeats: first.pattern.length === 1 ? 5 : 3,
          maximumPatternLength: 8
        },
        priority: repetitionRanking.priority,
        priorityReasons: repetitionRanking.priorityReasons
      });
      signalIds.push(signalId);
    }
    if (task.status !== "succeeded") {
      const outcomeId = `outcome-${outcomes.length + 1}`;
      outcomes.push({
        ...scope,
        outcomeId,
        kind: "task",
        status: task.status,
        nodeId: null,
        nodeName: null,
        directFailureIds: [...directFailureIds],
        evidence: evidenceAt(evidenceIndex, task.end_time ?? task.events[task.events.length - 1]?.timestamp)
      });
      outcomeIds.push(outcomeId);
    }
    const attemptsByNode = timeline.map((item) => recognitionItems(item.nodeInfo.node_flow));
    const allAttempts = attemptsByNode.flat();
    const imageSets = timeline.map((item) => imagesFor(item.nodeInfo));
    const errorImages = imageSets.flatMap((set) => set.error);
    const visionImages = imageSets.flatMap((set) => set.vision);
    const ownFailures = failures.filter((failure2) => directFailureIds.includes(failure2.failureId));
    const ownSignals = signals.filter((signal) => signalIds.includes(signal.signalId));
    const recognitionSignals = ownSignals.filter((signal) => signal.kind === "recognition_activity");
    const recognitionActivity = [...recognitionSignals].sort((left, right) => right.unsuccessfulAttempts.maximum - left.unsuccessfulAttempts.maximum || right.occurrenceCount - left.occurrenceCount).slice(0, 5).map((signal) => signal.signalId);
    const repetitionSignals = ownSignals.filter((signal) => signal.kind !== "recognition_activity").sort((left, right) => right.totalRepeatCount * right.pattern.length - left.totalRepeatCount * left.pattern.length).slice(0, 5).map((signal) => signal.signalId);
    return {
      executionId: scope.executionId,
      taskId: task.task_id,
      name: task.entry,
      hash: task.hash,
      uuid: task.uuid,
      status: task.status,
      completeness: task.status === "running" ? "open_at_log_end" : "complete",
      startedAt: task.start_time,
      endedAt: task.end_time ?? null,
      observedDurationMs: task.duration ?? elapsed(task.start_time, task.end_time),
      firstNode: timeline[0]?.executionName ?? null,
      lastNode: timeline[timeline.length - 1]?.executionName ?? null,
      statistics: {
        nodeExecutions: timeline.length,
        succeededNodes: timeline.filter((item) => item.nodeInfo.status === "success").length,
        failedNodes: timeline.filter((item) => item.nodeInfo.status === "failed").length,
        runningNodes: timeline.filter((item) => item.nodeInfo.status === "running").length,
        recognitionAttempts: allAttempts.length,
        unsuccessfulRecognitionAttempts: allAttempts.filter((attempt) => attempt.status === "failed").length,
        nodeExecutionsWithRecognition: attemptsByNode.filter((attempts) => attempts.length > 0).length,
        nodeExecutionsWithMixedRecognitionResults: attemptsByNode.filter((attempts) => {
          const statuses = new Set(attempts.map((attempt) => attempt.status));
          return statuses.has("failed") && statuses.has("success");
        }).length,
        recognitionActivityGroups: recognitionSignals.length,
        maximumRecognitionAttemptsPerNode: Math.max(0, ...attemptsByNode.map((attempts) => attempts.length)),
        maximumUnsuccessfulRecognitionAttemptsPerNode: Math.max(0, ...attemptsByNode.map((attempts) => attempts.filter((attempt) => attempt.status === "failed").length)),
        actionAttempts: timeline.filter((item) => item.nodeInfo.action_details != null).length,
        actionFailures: ownFailures.filter((failure2) => failure2.kind === "action_failed").length,
        nextListTimeouts: ownFailures.filter((failure2) => failure2.kind === "next_list_timeout").length,
        errorImageReferences: errorImages.length,
        uniqueErrorImages: new Set(errorImages).size,
        visionImageReferences: visionImages.length,
        uniqueVisionImages: new Set(visionImages).size
      },
      directFailureIds,
      outcomeIds,
      signalIds,
      signalHighlights: { recognitionActivity, repetitions: repetitionSignals },
      evidence: {
        start: evidenceAt(evidenceIndex, task.start_time),
        end: evidenceAt(evidenceIndex, task.end_time ?? task.events[task.events.length - 1]?.timestamp)
      }
    };
  };
  const tasks = output.tasks.map(buildTask2);
  const sessions = framework.sessions.map((session) => {
    const scoped = tasks.filter((task) => executionSessionIds.get(task.executionId) === session.sessionId);
    const ids = new Set(scoped.flatMap((task) => task.directFailureIds));
    const scopedFailures = failures.filter((failure2) => ids.has(failure2.failureId));
    return {
      sessionId: session.sessionId,
      startKind: session.startKind,
      frameworkStatus: session.status,
      frameworkVersion: session.version,
      versions: [...session.versions],
      start: session.start,
      end: session.end,
      tasks: scoped,
      summary: {
        taskExecutions: scoped.length,
        succeededTasks: scoped.filter((task) => task.status === "succeeded").length,
        failedTasks: scoped.filter((task) => task.status === "failed").length,
        runningTasks: scoped.filter((task) => task.status === "running").length,
        directFailures: scopedFailures.length,
        nextListTimeouts: scopedFailures.filter((failure2) => failure2.kind === "next_list_timeout").length,
        actionFailures: scopedFailures.filter((failure2) => failure2.kind === "action_failed").length,
        signals: scoped.reduce((count, task) => count + task.signalIds.length, 0)
      }
    };
  });
  const unscopedTasks = tasks.filter((task) => executionSessionIds.get(task.executionId) == null);
  return {
    schemaVersion: MLA_RUNTIME_INSPECTION_SCHEMA_VERSION,
    sessions,
    unscopedTasks,
    failures,
    outcomes,
    signals,
    warnings: [
      ...framework.warnings,
      ...unscopedTasks.length ? [`${unscopedTasks.length} task execution(s) could not be assigned to one runtime session.`] : []
    ]
  };
};

// ../../node_modules/.pnpm/@windsland52+maa-log-tools@1.3.0/node_modules/@windsland52/maa-log-tools/dist/index.js
var analyzeLogContent = async (input) => {
  return analyzeLogContentWith(mlaRuntimeAdapter, {
    ...input,
    parseOptions: input.parseOptions ?? DEFAULT_CORE_PARSE_OPTIONS
  });
};
var analyzeZipFile = async (input) => {
  const extracted = await extractZipContentFromNodeFile(input.zipFilePath, {
    focus: input.focus,
    archiveLimits: input.archiveLimits
  });
  if (!extracted)
    return null;
  return analyzeLogContent({
    content: extracted.content,
    errorImages: extracted.errorImages,
    visionImages: extracted.visionImages,
    waitFreezesImages: extracted.waitFreezesImages,
    parseOptions: input.parseOptions,
    parserVersion: input.parserVersion
  });
};
var analyzeDirectory = async (input) => {
  const extracted = await loadNodeLogDirectory(input.directoryPath, {
    focus: input.focus,
    archiveLimits: input.archiveLimits
  });
  if (!extracted)
    return null;
  return analyzeLogContent({
    content: extracted.content,
    errorImages: extracted.errorImages,
    visionImages: extracted.visionImages,
    waitFreezesImages: extracted.waitFreezesImages,
    parseOptions: input.parseOptions,
    parserVersion: input.parserVersion
  });
};

// ../../node_modules/.pnpm/@windsland52+maa-log-tools@1.3.0/node_modules/@windsland52/maa-log-tools/dist/cli.js
var import_promises4 = require("node:fs/promises");
var import_node_path3 = __toESM(require("node:path"), 1);
var import_node_url = require("node:url");
var printUsage = () => {
  console.error("Usage: mla-log-tools <path> [--pretty] [--no-events] [--preflight|--runtime-inspection]");
  console.error("  <path>: log file path, zip path, or log directory path");
};
var parseArgs = (argv) => {
  let targetPath = null;
  let pretty = false;
  let noEvents = false;
  let preflight = false;
  let runtimeInspection = false;
  for (const arg of argv) {
    if (arg === "--pretty") {
      pretty = true;
      continue;
    }
    if (arg === "--no-events") {
      noEvents = true;
      continue;
    }
    if (arg === "--preflight") {
      preflight = true;
      continue;
    }
    if (arg === "--runtime-inspection") {
      runtimeInspection = true;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      printUsage();
      process.exit(0);
    }
    if (!targetPath) {
      targetPath = arg;
    }
  }
  return { targetPath, pretty, noEvents, preflight, runtimeInspection };
};
var renderOutput = (output, pretty, noEvents) => {
  const payload = noEvents ? { ...output, events: [] } : output;
  return JSON.stringify(payload, null, pretty ? 2 : 0);
};
var MLA_PREFLIGHT_SCHEMA_VERSION = "mla-preflight/v1";
var isTaskLifecycleProjection = (task) => {
  return !task.uuid.startsWith("synthetic:resource_loading:");
};
var EMPTY_FRAMEWORK_EXTRACTION = {
  sessions: [],
  summary: { status: "none", versions: [] },
  warnings: []
};
var buildPreflightOutput = (output, framework = EMPTY_FRAMEWORK_EXTRACTION) => {
  if (!output) {
    return {
      schemaVersion: MLA_PREFLIGHT_SCHEMA_VERSION,
      status: "unsupported",
      reason: "no_analyzable_content",
      parserVersion: null,
      taskCount: 0,
      eventCount: 0,
      nodeStatisticCount: 0,
      recognitionStatisticCount: 0,
      frameworkVersionSummary: framework.summary,
      frameworkSessions: framework.sessions,
      warnings: framework.warnings
    };
  }
  const taskLifecycleCount = output.tasks.filter(isTaskLifecycleProjection).length;
  const reason = output.events.length > 0 ? taskLifecycleCount > 0 ? "notify_events_parsed" : "no_task_lifecycle" : output.warnings.includes("Empty log content.") ? "empty_log" : "no_notify_events";
  return {
    schemaVersion: MLA_PREFLIGHT_SCHEMA_VERSION,
    status: reason === "notify_events_parsed" ? "supported" : "unsupported",
    reason,
    parserVersion: output.meta.parserVersion,
    taskCount: taskLifecycleCount,
    eventCount: output.events.length,
    nodeStatisticCount: output.stats.nodes.length,
    recognitionStatisticCount: output.stats.recognitionActions.length,
    frameworkVersionSummary: framework.summary,
    frameworkSessions: framework.sessions,
    warnings: [...output.warnings, ...framework.warnings]
  };
};
var main = async () => {
  const { targetPath, pretty, noEvents, preflight, runtimeInspection } = parseArgs(process.argv.slice(2));
  if (preflight && runtimeInspection) {
    console.error("--preflight and --runtime-inspection are mutually exclusive.");
    process.exit(1);
  }
  if (!targetPath) {
    printUsage();
    process.exit(1);
  }
  const resolvedPath = import_node_path3.default.resolve(targetPath);
  const targetStat = await (0, import_promises4.stat)(resolvedPath);
  const framework = preflight || runtimeInspection ? extractFrameworkSessions(await loadFrameworkLogSources(resolvedPath)) : EMPTY_FRAMEWORK_EXTRACTION;
  let result = null;
  let sourceSegments = [];
  if (targetStat.isDirectory()) {
    const extracted = await loadNodeLogDirectory(resolvedPath);
    if (extracted) {
      sourceSegments = extracted.sourceSegments;
      result = await analyzeLogContent({
        content: extracted.content,
        errorImages: extracted.errorImages,
        visionImages: extracted.visionImages,
        waitFreezesImages: extracted.waitFreezesImages
      });
    }
  } else if (resolvedPath.toLowerCase().endsWith(".zip")) {
    const extracted = await extractZipContentFromNodeFile(resolvedPath);
    if (extracted) {
      sourceSegments = extracted.sourceSegments;
      result = await analyzeLogContent({
        content: extracted.content,
        errorImages: extracted.errorImages,
        visionImages: extracted.visionImages,
        waitFreezesImages: extracted.waitFreezesImages
      });
    }
  } else {
    const content = await readNodeTextFileContent(resolvedPath);
    const lineCount = (content.match(/\n/g) ?? []).length + 1;
    sourceSegments = [{
      source: `file:${resolvedPath.replace(/\\/g, "/")}`,
      path: import_node_path3.default.basename(resolvedPath),
      startLine: 1,
      lineCount
    }];
    result = await analyzeLogContent({ content });
  }
  if (!result) {
    if (preflight) {
      process.stdout.write(JSON.stringify(buildPreflightOutput(null, framework), null, pretty ? 2 : 0));
      process.stdout.write("\n");
    }
    console.error("No analyzable log content found in the provided path.");
    process.exit(2);
  }
  if (preflight) {
    const output = buildPreflightOutput(result, framework);
    process.stdout.write(JSON.stringify(output, null, pretty ? 2 : 0));
    process.stdout.write("\n");
    if (output.status === "unsupported") {
      process.exit(3);
    }
    return;
  }
  if (runtimeInspection) {
    process.stdout.write(JSON.stringify(buildRuntimeInspection(result, framework, sourceSegments), null, pretty ? 2 : 0));
    process.stdout.write("\n");
    return;
  }
  process.stdout.write(renderOutput(result, pretty, noEvents));
  process.stdout.write("\n");
};
var isEntrypoint = () => {
  const argvPath = process.argv[1];
  if (!argvPath) {
    return false;
  }
  return void 0 === (0, import_node_url.pathToFileURL)(import_node_path3.default.resolve(argvPath)).href;
};
if (isEntrypoint()) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exit(1);
  });
}

// dist/mla-runtime.js
var copyEvidencePosition = (position2) => ({
  timestamp: position2.timestamp,
  source: position2.source,
  path: position2.path,
  local_line: position2.localLine
});
var copyEvidenceRange = (range) => ({
  start: copyEvidencePosition(range.start),
  end: copyEvidencePosition(range.end)
});
var copyMetricDistribution = (distribution) => ({
  count: distribution.count,
  minimum: distribution.minimum,
  p50: distribution.p50,
  p95: distribution.p95,
  maximum: distribution.maximum,
  average: distribution.average
});
var copyScope = (scope) => ({
  session_id: scope.sessionId,
  execution_id: scope.executionId,
  task_id: scope.taskId,
  task_name: scope.taskName
});
var copyFailure = (failure2) => ({
  ...copyScope(failure2),
  failure_id: failure2.failureId,
  kind: failure2.kind,
  node_id: failure2.nodeId,
  node_name: failure2.nodeName,
  started_at: failure2.startedAt,
  ended_at: failure2.endedAt,
  error_images: [...failure2.errorImages],
  vision_images: [...failure2.visionImages],
  evidence: copyEvidencePosition(failure2.evidence)
});
var copyOutcome = (outcome) => ({
  ...copyScope(outcome),
  outcome_id: outcome.outcomeId,
  kind: outcome.kind,
  status: outcome.status,
  node_id: outcome.nodeId,
  node_name: outcome.nodeName,
  direct_failure_ids: [...outcome.directFailureIds],
  evidence: copyEvidencePosition(outcome.evidence)
});
var copyRecognitionOccurrence = (occurrence) => ({
  node_id: occurrence.nodeId,
  started_at: occurrence.startedAt,
  ended_at: occurrence.endedAt,
  attempt_count: occurrence.attemptCount,
  unsuccessful_attempts: occurrence.unsuccessfulAttempts,
  terminal_match: occurrence.terminalMatch,
  evidence: copyEvidenceRange(occurrence.evidence)
});
var copyRecognitionSignal = (signal) => ({
  ...copyScope(signal),
  signal_id: signal.signalId,
  kind: signal.kind,
  pipeline_node_name: signal.pipelineNodeName,
  next_list: signal.nextList.map((item) => ({
    name: item.name,
    anchor: item.anchor,
    jump_back: item.jumpBack
  })),
  occurrence_count: signal.occurrenceCount,
  occurrences_with_mixed_results: signal.occurrencesWithMixedResults,
  terminal_outcomes: {
    matched: signal.terminalOutcomes.matched,
    timeout: signal.terminalOutcomes.timeout,
    running: signal.terminalOutcomes.running,
    unmatched: signal.terminalOutcomes.unmatched
  },
  terminal_matches: signal.terminalMatches.map((item) => ({
    name: item.name,
    count: item.count
  })),
  candidate_statistics: signal.candidateStatistics.map((item) => ({
    name: item.name,
    evaluation_count: item.evaluationCount,
    matched_attempt_count: item.matchedAttemptCount,
    unsuccessful_attempt_count: item.unsuccessfulAttemptCount,
    running_attempt_count: item.runningAttemptCount,
    terminal_match_count: item.terminalMatchCount
  })),
  unmapped_attempt_count: signal.unmappedAttemptCount,
  attempts: copyMetricDistribution(signal.attempts),
  unsuccessful_attempts: copyMetricDistribution(signal.unsuccessfulAttempts),
  duration_ms: copyMetricDistribution(signal.durationMs),
  representatives: {
    first: copyRecognitionOccurrence(signal.representatives.first),
    worst: copyRecognitionOccurrence(signal.representatives.worst),
    last: copyRecognitionOccurrence(signal.representatives.last)
  },
  priority: signal.priority,
  priority_reasons: [...signal.priorityReasons]
});
var copyRepeatedNodeOccurrence = (occurrence) => ({
  pattern: [...occurrence.pattern],
  first_seen_at: occurrence.firstSeenAt,
  last_seen_at: occurrence.lastSeenAt,
  repeat_count: occurrence.repeatCount,
  duration_ms: occurrence.durationMs,
  termination: occurrence.termination,
  evidence: copyEvidencePosition(occurrence.evidence)
});
var copyRepeatedNodeSignal = (signal) => ({
  ...copyScope(signal),
  signal_id: signal.signalId,
  kind: signal.kind,
  pattern: [...signal.pattern],
  segment_count: signal.segmentCount,
  total_repeat_count: signal.totalRepeatCount,
  maximum_repeat_count: signal.maximumRepeatCount,
  duration_ms: copyMetricDistribution(signal.durationMs),
  terminations: {
    left_pattern: signal.terminations.leftPattern,
    task_ended: signal.terminations.taskEnded,
    still_repeating_at_log_end: signal.terminations.stillRepeatingAtLogEnd
  },
  representatives: {
    first: copyRepeatedNodeOccurrence(signal.representatives.first),
    longest: copyRepeatedNodeOccurrence(signal.representatives.longest),
    last: copyRepeatedNodeOccurrence(signal.representatives.last)
  },
  detector: {
    name: signal.detector.name,
    version: signal.detector.version,
    minimum_repeats: signal.detector.minimumRepeats,
    maximum_pattern_length: signal.detector.maximumPatternLength
  },
  priority: signal.priority,
  priority_reasons: [...signal.priorityReasons]
});
var copySignal = (signal) => {
  switch (signal.kind) {
    case "recognition_activity":
      return copyRecognitionSignal(signal);
    case "repeated_node":
    case "repeated_node_cycle":
      return copyRepeatedNodeSignal(signal);
  }
};
var copyTaskStatistics = (statistics) => ({
  node_executions: statistics.nodeExecutions,
  succeeded_nodes: statistics.succeededNodes,
  failed_nodes: statistics.failedNodes,
  running_nodes: statistics.runningNodes,
  recognition_attempts: statistics.recognitionAttempts,
  unsuccessful_recognition_attempts: statistics.unsuccessfulRecognitionAttempts,
  node_executions_with_recognition: statistics.nodeExecutionsWithRecognition,
  node_executions_with_mixed_recognition_results: statistics.nodeExecutionsWithMixedRecognitionResults,
  recognition_activity_groups: statistics.recognitionActivityGroups,
  maximum_recognition_attempts_per_node: statistics.maximumRecognitionAttemptsPerNode,
  maximum_unsuccessful_recognition_attempts_per_node: statistics.maximumUnsuccessfulRecognitionAttemptsPerNode,
  action_attempts: statistics.actionAttempts,
  action_failures: statistics.actionFailures,
  next_list_timeouts: statistics.nextListTimeouts,
  error_image_references: statistics.errorImageReferences,
  unique_error_images: statistics.uniqueErrorImages,
  vision_image_references: statistics.visionImageReferences,
  unique_vision_images: statistics.uniqueVisionImages
});
var copyTask = (task) => ({
  execution_id: task.executionId,
  task_id: task.taskId,
  name: task.name,
  hash: task.hash,
  uuid: task.uuid,
  status: task.status,
  completeness: task.completeness,
  started_at: task.startedAt,
  ended_at: task.endedAt,
  observed_duration_ms: task.observedDurationMs,
  first_node: task.firstNode,
  last_node: task.lastNode,
  statistics: copyTaskStatistics(task.statistics),
  direct_failure_ids: [...task.directFailureIds],
  outcome_ids: [...task.outcomeIds],
  signal_ids: [...task.signalIds],
  signal_highlights: {
    recognition_activity: [...task.signalHighlights.recognitionActivity],
    repetitions: [...task.signalHighlights.repetitions]
  },
  evidence: copyEvidenceRange(task.evidence)
});
var copySession = (session) => ({
  session_id: session.sessionId,
  start_kind: session.startKind,
  framework_status: session.frameworkStatus,
  framework_version: session.frameworkVersion,
  versions: [...session.versions],
  start: {
    source: session.start.source,
    path: session.start.path,
    line: session.start.line,
    timestamp: session.start.timestamp
  },
  end: {
    source: session.end.source,
    path: session.end.path,
    line: session.end.line,
    timestamp: session.end.timestamp
  },
  tasks: session.tasks.map(copyTask),
  summary: {
    task_executions: session.summary.taskExecutions,
    succeeded_tasks: session.summary.succeededTasks,
    failed_tasks: session.summary.failedTasks,
    running_tasks: session.summary.runningTasks,
    direct_failures: session.summary.directFailures,
    next_list_timeouts: session.summary.nextListTimeouts,
    action_failures: session.summary.actionFailures,
    signals: session.summary.signals
  }
});
var translateRuntimeInspection = (inspection) => ({
  schema_version: inspection.schemaVersion,
  sessions: inspection.sessions.map(copySession),
  unscoped_tasks: inspection.unscopedTasks.map(copyTask),
  failures: inspection.failures.map(copyFailure),
  outcomes: inspection.outcomes.map(copyOutcome),
  signals: inspection.signals.map(copySignal),
  warnings: [...inspection.warnings]
});

// dist/mla.js
var copyPosition = (position2) => ({
  source: position2.source,
  path: position2.path,
  line: position2.line,
  timestamp: position2.timestamp
});
var copyVersionEvidence = (evidence2) => ({
  ...copyPosition(evidence2),
  version: evidence2.version
});
var copySession2 = (session) => ({
  session_id: session.sessionId,
  start_kind: session.startKind,
  status: session.status,
  version: session.version,
  versions: [...session.versions],
  start: copyPosition(session.start),
  end: copyPosition(session.end),
  version_evidence: session.versionEvidence.map(copyVersionEvidence)
});
var translatePreflight = (preflight) => ({
  schema_version: "mde-mla-preflight/v1",
  mla_schema_version: preflight.schemaVersion,
  compatibility: {
    status: preflight.status,
    reason: preflight.reason,
    parser_version: preflight.parserVersion,
    task_count: preflight.taskCount,
    event_count: preflight.eventCount,
    node_statistic_count: preflight.nodeStatisticCount,
    recognition_statistic_count: preflight.recognitionStatisticCount
  },
  framework: {
    status: preflight.frameworkVersionSummary.status,
    versions: [...preflight.frameworkVersionSummary.versions],
    sessions: preflight.frameworkSessions.map(copySession2)
  },
  warnings: [...preflight.warnings]
});
async function runMlaPreflight(targetPath) {
  const resolvedPath = import_node_path4.default.resolve(targetPath);
  const targetStat = await (0, import_promises5.stat)(resolvedPath);
  const framework = extractFrameworkSessions(await loadFrameworkLogSources(resolvedPath));
  let output = null;
  if (targetStat.isDirectory()) {
    output = await analyzeDirectory({ directoryPath: resolvedPath });
  } else if (resolvedPath.toLowerCase().endsWith(".zip")) {
    output = await analyzeZipFile({ zipFilePath: resolvedPath });
  } else {
    output = await analyzeLogContent({
      content: await readNodeTextFileContent(resolvedPath)
    });
  }
  return translatePreflight(buildPreflightOutput(output, framework));
}
async function runMlaRuntimeInspection(targetPath) {
  const resolvedPath = import_node_path4.default.resolve(targetPath);
  const targetStat = await (0, import_promises5.stat)(resolvedPath);
  const framework = extractFrameworkSessions(await loadFrameworkLogSources(resolvedPath));
  let output = null;
  let sourceSegments = [];
  if (targetStat.isDirectory()) {
    const extracted = await loadNodeLogDirectory(resolvedPath);
    if (extracted) {
      sourceSegments = extracted.sourceSegments;
      output = await analyzeLogContent({
        content: extracted.content,
        errorImages: extracted.errorImages,
        visionImages: extracted.visionImages,
        waitFreezesImages: extracted.waitFreezesImages
      });
    }
  } else if (resolvedPath.toLowerCase().endsWith(".zip")) {
    const extracted = await extractZipContentFromNodeFile(resolvedPath);
    if (extracted) {
      sourceSegments = extracted.sourceSegments;
      output = await analyzeLogContent({
        content: extracted.content,
        errorImages: extracted.errorImages,
        visionImages: extracted.visionImages,
        waitFreezesImages: extracted.waitFreezesImages
      });
    }
  } else {
    const content = await readNodeTextFileContent(resolvedPath);
    sourceSegments = [
      {
        source: `file:${resolvedPath.replace(/\\/g, "/")}`,
        path: import_node_path4.default.basename(resolvedPath),
        startLine: 1,
        lineCount: (content.match(/\n/g) ?? []).length + 1
      }
    ];
    output = await analyzeLogContent({ content });
  }
  if (!output) {
    throw new Error("No analyzable log content found in the provided path.");
  }
  const inspection = buildRuntimeInspection(output, framework, sourceSegments);
  return translateRuntimeInspection(inspection);
}

// dist/mse.js
var import_promises6 = require("node:fs/promises");
var import_node_path5 = __toESM(require("node:path"), 1);

// ../../node_modules/.pnpm/@nekosu+maa-locale@1.0.3/node_modules/@nekosu/maa-locale/dist/index.mjs
var locale_zh_cn_default = {
  "maa.pi.entry.switch-controller": "\u66F4\u6539\u63A7\u5236\u5668",
  "maa.pi.entry.switch-resource": "\u66F4\u6539\u8D44\u6E90",
  "maa.pi.entry.add-task": "\u6DFB\u52A0\u4EFB\u52A1",
  "maa.pi.entry.move-task": "\u79FB\u52A8\u4EFB\u52A1",
  "maa.pi.entry.remove-task": "\u5220\u9664\u4EFB\u52A1",
  "maa.pi.entry.launch": "\u6267\u884C",
  "maa.pi.title.choose-action": "\u9009\u62E9\u64CD\u4F5C",
  "maa.pi.title.select-controller": "\u9009\u62E9\u63A7\u5236\u53F0",
  "maa.pi.title.select-device": "\u9009\u62E9\u8BBE\u5907",
  "maa.pi.title.select-window": "\u9009\u62E9\u7A97\u53E3",
  "maa.pi.title.select-resource": "\u9009\u62E9\u8D44\u6E90",
  "maa.pi.title.select-task": "\u9009\u62E9\u4EFB\u52A1",
  "maa.pi.title.select-option": "\u9009\u62E9\u9009\u9879 {0}",
  "maa.pi.title.input-image": "\u8F93\u5165\u56FE\u7247\u540D\u79F0",
  "maa.pi.title.init-config": "\u521D\u59CB\u5316\u914D\u7F6E",
  "maa.pi.item.empty-config": "\u7A7A\u914D\u7F6E",
  "maa.pi.item.interactive-setup-config": "\u4EA4\u4E92\u5F0F\u8BBE\u7F6E\u914D\u7F6E",
  "maa.pi.error.cannot-find-controller": "\u65E0\u6CD5\u627E\u5230\u63A7\u5236\u5668 {0}",
  "maa.pi.error.cannot-find-adb-for-controller": "\u65E0\u6CD5\u627E\u5230\u63A7\u5236\u5668 {0} \u7684 Adb \u914D\u7F6E",
  "maa.pi.error.cannot-find-win32-for-controller": "\u65E0\u6CD5\u627E\u5230\u63A7\u5236\u5668 {0} \u7684 Win32 \u914D\u7F6E",
  "maa.pi.error.cannot-find-hwnd-for-controller": "\u65E0\u6CD5\u627E\u5230\u63A7\u5236\u5668 {0} \u7684 Win32/Gamepad \u914D\u7F6E\u7684 hwnd, \u8BF7\u91CD\u65B0\u914D\u7F6E\u63A7\u5236\u5668",
  "maa.pi.error.cannot-find-playcover-for-controller": "\u65E0\u6CD5\u627E\u5230\u63A7\u5236\u5668 {0} \u7684 PlayCover \u914D\u7F6E",
  "maa.pi.error.cannot-find-address-for-controller": "\u65E0\u6CD5\u627E\u5230\u63A7\u5236\u5668 {0} \u7684 PlayCover \u914D\u7F6E\u7684 address, \u8BF7\u91CD\u65B0\u914D\u7F6E\u63A7\u5236\u5668",
  "maa.pi.error.cannot-find-gamepad-for-controller": "\u65E0\u6CD5\u627E\u5230\u63A7\u5236\u5668 {0} \u7684 Gamepad \u914D\u7F6E",
  "maa.pi.error.cannot-find-resource": "\u65E0\u6CD5\u627E\u5230\u8D44\u6E90 {0}",
  "maa.pi.error.cannot-find-task": "\u65E0\u6CD5\u627E\u5230\u4EFB\u52A1 {0}",
  "maa.pi.error.cannot-find-option": "\u65E0\u6CD5\u627E\u5230\u9009\u9879\u7EC4 {0}",
  "maa.pi.error.cannot-find-option-from": "\u65E0\u6CD5\u627E\u5230\u9009\u9879\u7EC4 {0}, \u7531 {1} {2} \u5F15\u5165",
  "maa.pi.error.cannot-resolve-option": "\u65E0\u6CD5\u8BA1\u7B97\u9009\u9879\u7EC4 {0}",
  "maa.pi.error.cannot-find-case-for-option": "\u65E0\u6CD5\u627E\u5230\u9009\u9879\u7EC4 {1} \u7684\u503C {0}",
  "maa.pi.error.no-devices-found": "\u672A\u627E\u5230\u8BBE\u5907",
  "maa.pi.error.no-win32-config-provided": "\u672A\u63D0\u4F9B Win32 \u914D\u7F6E",
  "maa.pi.error.load-interface-failed": "\u65E0\u6CD5\u52A0\u8F7Dinterface",
  "maa.pi.error.generate-runtime-failed": "\u751F\u6210\u914D\u7F6E\u5931\u8D25: {0}",
  "maa.pi.warning.require-admin": "\u63A7\u5236\u5668\u9700\u8981\u7BA1\u7406\u5458\u6743\u9650",
  "maa.debug.init-controller-failed": "\u521D\u59CB\u5316\u63A7\u5236\u5668\u5931\u8D25",
  "maa.debug.init-resource-failed": "\u521D\u59CB\u5316\u8D44\u6E90\u5931\u8D25",
  "maa.debug.init-instance-failed": "\u521D\u59CB\u5316\u5B9E\u4F8B\u5931\u8D25",
  "maa.debug.init-instance-succeeded": "\u521D\u59CB\u5316\u5B9E\u4F8B\u6210\u529F",
  "maa.debug.task-started": "\u4EFB\u52A1\u5F00\u59CB {0} - {1}",
  "maa.debug.task-finished": "\u4EFB\u52A1\u5B8C\u6210 {0} - {1}",
  "maa.debug.task-failed": "\u4EFB\u52A1\u5931\u8D25 {0} - {1}",
  "maa.pipeline.codelens.launch": "\u6267\u884C",
  "maa.pipeline.codelens.refs": "{0} \u5F15\u7528",
  "maa.pipeline.codelens.eval-task": "\u8BA1\u7B97\u4EFB\u52A1",
  "maa.pipeline.codelens.eval-expr": "\u8BA1\u7B97 {0}",
  "maa.pipeline.codelens.resource-switch": "\u5207\u6362",
  "maa.pipeline.codelens.resource-activated": "\u5DF2\u6FC0\u6D3B",
  "maa.pipeline.codelens.resource-disabled": "\u5DF2\u7981\u7528",
  "maa.pipeline.codelens.language-switch": "\u5207\u6362",
  "maa.pipeline.codelens.language-activated": "\u5DF2\u6FC0\u6D3B",
  "maa.pipeline.codeaction.extract-locale": "\u63D0\u53D6\u56FD\u9645\u5316\u6587\u6848",
  "maa.pipeline.codeaction.input-key": "\u8F93\u5165\u56FD\u9645\u5316\u952E",
  "maa.pipeline.codeaction.key-exists": "\u5DF2\u5B58\u5728",
  "maa.pipeline.codeaction.switch-to-v1": "\u5207\u6362\u5230 V1",
  "maa.pipeline.codeaction.switch-to-v2": "\u5207\u6362\u5230 V2",
  "maa.pipeline.error.no-interface-found": "\u672A\u627E\u5230interface",
  "maa.pipeline.error.not-exists": "{0} \u4E0D\u5B58\u5728",
  "maa.pipeline.error.conflict-task": "\u51B2\u7A81\u4EFB\u52A1 {0}, \u4E0A\u4E00\u4E2A\u5B9A\u4E49\u5728 {1}",
  "maa.pipeline.error.unknown-task": "\u672A\u77E5\u4EFB\u52A1 {0}",
  "maa.pipeline.error.color-filter-invalid": "color_filter \u4EFB\u52A1 {0} \u975E\u6CD5, \u8BC6\u522B\u7C7B\u578B\u4E3A {1}",
  "maa.pipeline.error.unknown-image": "\u672A\u77E5\u56FE\u7247 {0}",
  "maa.pipeline.error.unknown-anchor": "\u672A\u77E5Anchor {0}",
  "maa.pipeline.error.unknown-attr": "\u672A\u77E5\u5C5E\u6027 {0}",
  "maa.pipeline.error.duplicate-next": "\u91CD\u590D\u8DEF\u7531 {0}",
  "maa.pipeline.error.unknown-locale": "\u672A\u77E5\u56FD\u9645\u5316\u952E {0}",
  "maa.pipeline.error.missing-locale": "\u56FD\u9645\u5316\u952E {0} \u7F3A\u5C11\u8BED\u8A00 {1} \u7684\u7FFB\u8BD1",
  "maa.pipeline.warning.mpe-config": "\u68C0\u6D4B\u5230 MPE \u914D\u7F6E",
  "maa.pipeline.error.conflict-controller": "\u51B2\u7A81\u63A7\u5236\u5668 {0}, \u4E0A\u4E00\u4E2A\u5B9A\u4E49\u5728 {1}",
  "maa.pipeline.error.unknown-controller": "\u672A\u77E5\u63A7\u5236\u5668 {0}",
  "maa.pipeline.error.conflict-resource": "\u51B2\u7A81\u8D44\u6E90 {0}, \u4E0A\u4E00\u4E2A\u5B9A\u4E49\u5728 {1}",
  "maa.pipeline.error.unknown-resource": "\u672A\u77E5\u8D44\u6E90 {0}",
  "maa.pipeline.error.conflict-group": "\u51B2\u7A81\u5206\u7EC4 {0}, \u4E0A\u4E00\u4E2A\u5B9A\u4E49\u5728 {1}",
  "maa.pipeline.error.unknown-group": "\u672A\u77E5\u5206\u7EC4 {0}",
  "maa.pipeline.error.conflict-option": "\u51B2\u7A81\u9009\u9879 {0}, \u4E0A\u4E00\u4E2A\u5B9A\u4E49\u5728 {1}",
  "maa.pipeline.error.unknown-option": "\u672A\u77E5\u9009\u9879 {0}",
  "maa.pipeline.error.conflict-case": "\u9009\u9879 {1} \u51B2\u7A81\u9009\u9879\u503C {0}, \u4E0A\u4E00\u4E2A\u5B9A\u4E49\u5728 {2}",
  "maa.pipeline.error.unknown-case": "\u9009\u9879 {1} \u672A\u77E5\u7684\u9009\u9879\u503C {0}",
  "maa.pipeline.error.switch-name-invalid": "\u5F00\u5173\u540D\u65E0\u6548, \u5E94\u4F7F\u7528 Yes \u6216 No",
  "maa.pipeline.error.switch-missing-yes": "\u5F00\u5173\u9009\u9879\u7F3A\u5C11 Yes",
  "maa.pipeline.error.switch-missing-no": "\u5F00\u5173\u9009\u9879\u7F3A\u5C11 No",
  "maa.pipeline.error.switch-missing-all": "\u5F00\u5173\u9009\u9879\u7F3A\u5C11 Yes \u548C No",
  "maa.pipeline.warning.switch-name-should-fixed": "\u5F00\u5173\u540D\u5E94\u4F7F\u7528 Yes \u6216 No",
  "maa.pipeline.error.preset-type-error": "\u9009\u9879 {0} \u9884\u8BBE\u7684\u7C7B\u578B\u9519\u8BEF, \u9884\u671F\u4E3A {1}",
  "maa.pipeline.error.unknown-entry-task": "\u672A\u77E5\u5165\u53E3\u4EFB\u52A1 {0}",
  "maa.pipeline.error.override-unknown-task": "\u8986\u76D6\u672A\u77E5\u4EFB\u52A1 {0}",
  "maa.pipeline.warning.image-path-backslash": "\u56FE\u7247\u8DEF\u5F84\u4E2D\u5305\u542B\u53CD\u659C\u6760, \u5E94\u4F7F\u7528\u6B63\u659C\u6760",
  "maa.pipeline.warning.image-path-dot-slash": "\u56FE\u7247\u8DEF\u5F84\u4E2D\u5305\u542B ./ , \u5E94\u79FB\u9664",
  "maa.pipeline.warning.image-path-missing-png": "\u56FE\u7247\u8DEF\u5F84\u4E0D\u5E94\u7701\u7565.png",
  "maa.pipeline.warning.image-path-dynamic": "\u68C0\u6D4B\u5230\u52A8\u6001\u56FE\u7247\u8DEF\u5F84",
  "maa.native.in-use": "\u6B63\u5728\u4F7F\u7528",
  "maa.native.downloaded": "\u5DF2\u4E0B\u8F7D",
  "maa.native.extension-expected-version": "\u63D2\u4EF6\u9884\u671F\u7248\u672C",
  "maa.native.auto": "\u81EA\u52A8",
  "maa.native.use-extension-expected-version": "\u81EA\u52A8\u4F7F\u7528\u63D2\u4EF6\u9884\u671F\u7248\u672C",
  "maa.native.switch-mirror": "\u5207\u6362\u4E0B\u8F7D\u6E90",
  "maa.native.switch-maafw": "\u5207\u6362 MaaFramework \u7248\u672C",
  "maa.native.fetching-index": "\u83B7\u53D6\u7D22\u5F15\u4E2D",
  "maa.native.download.preparing-folder": "\u51C6\u5907\u76EE\u5F55\u4E2D",
  "maa.native.download.downloading-scripts": "\u4E0B\u8F7D MaaFramework {0} \u811A\u672C\u4E2D",
  "maa.native.download.downloading-binary": "\u4E0B\u8F7D MaaFramework {0} \u4E8C\u8FDB\u5236\u4E2D",
  "maa.native.download.moving-folder": "\u79FB\u52A8\u76EE\u5F55\u4E2D",
  "maa.native.loaded-ver": "\u52A0\u8F7D\u7248\u672C",
  "maa.native.ext-int-ver": "\u63A5\u53E3\u7248\u672C",
  "maa.status.checking-task": "MaaSupport \u68C0\u67E5\u4EFB\u52A1\u4E2D",
  "maa.status.not-loaded": "\u672A\u52A0\u8F7D",
  "maa.status.service-disconnected": "\u670D\u52A1\u5DF2\u65AD\u5F00",
  "maa.status.service-connected": "\u670D\u52A1\u5DF2\u8FDE\u63A5",
  "maa.core.cannot-find-log": "\u65E0\u6CD5\u627E\u5230\u65E5\u5FD7\u6587\u4EF6: {0}",
  "maa.core.load-maafw-failed": "\u52A0\u8F7D MaaFramework \u5931\u8D25",
  "maa.crop.warning.no-resource": "\u672A\u914D\u7F6Einterface\u7684\u8D44\u6E90, \u5C06\u76F4\u63A5\u4FDD\u5B58",
  "maa.screencap.no-runtime": "\u672A\u627E\u5230\u53EF\u622A\u56FE\u7684\u8FD0\u884C\u8D44\u6E90\u9879\u76EE",
  "maa.screencap.multiple-resources": "\u8FD0\u884C\u4E2D\u7684 Maa \u5B9E\u4F8B\u5C5E\u4E8E\u591A\u4E2A\u8D44\u6E90\u9879\u76EE\uFF0C\u65E0\u6CD5\u786E\u5B9A\u622A\u56FE\u76EE\u6807",
  "maa.screencap.failed": "\u622A\u56FE\u5931\u8D25",
  "maa.screencap.saved": "\u622A\u56FE\u5DF2\u4FDD\u5B58: {0}",
  "maa.shortcut.no-target": "\u672A\u6FC0\u6D3B\u5168\u5C40\u5FEB\u6377\u952E\u76EE\u6807\uFF0C\u8BF7\u5728 Maa \u63A7\u5236\u9762\u677F\u4E2D\u6FC0\u6D3B\u5F53\u524D\u7A97\u53E3",
  "maa.shortcut.no-instances": "\u5F53\u524D\u5FEB\u6377\u952E\u76EE\u6807\u7A97\u53E3\u4E2D\u6CA1\u6709\u8FD0\u884C\u4E2D\u7684 Maa \u5B9E\u4F8B",
  "maa.eval.input-task": "\u8F93\u5165\u4EFB\u52A1",
  "maa.eval.eval-failed": "\u8BA1\u7B97\u5931\u8D25!",
  "maa.eval.loop-detected": "\u68C0\u6D4B\u5230\u5FAA\u73AF",
  "maa.eval.cannot-find-task-base": "\u65E0\u6CD5\u627E\u5230\u4EFB\u52A1\u6A21\u677F {0}",
  "maa.eval.json.eval-task": "\u8BA1\u7B97\u4EFB\u52A1",
  "maa.eval.json.eval-list": "\u8BA1\u7B97\u5217\u8868",
  "maa.eval.json.stripped": "\u5DF2\u53BB\u91CD",
  "maa.eval.json.expanded-from": "\u5C55\u5F00\u81EA"
};
var localeDict = locale_zh_cn_default;
function t(key, ...args) {
  let str = localeDict[key];
  for (const [idx, arg] of Object.entries(args)) str = str.replaceAll(`{${idx}}`, arg);
  return str;
}

// ../../node_modules/.pnpm/@nekosu+maa-pipeline-manager@1.0.12/node_modules/@nekosu/maa-pipeline-manager/dist/index.mjs
var import_node_events = __toESM(require("node:events"), 1);
var path5 = __toESM(require("node:path"), 1);

// ../../node_modules/.pnpm/jsonc-parser@3.3.1/node_modules/jsonc-parser/lib/esm/impl/scanner.js
function createScanner(text, ignoreTrivia = false) {
  const len = text.length;
  let pos = 0, value = "", tokenOffset = 0, token = 16, lineNumber = 0, lineStartOffset = 0, tokenLineStartOffset = 0, prevTokenLineStartOffset = 0, scanError = 0;
  function scanHexDigits(count, exact) {
    let digits = 0;
    let value2 = 0;
    while (digits < count || !exact) {
      let ch = text.charCodeAt(pos);
      if (ch >= 48 && ch <= 57) {
        value2 = value2 * 16 + ch - 48;
      } else if (ch >= 65 && ch <= 70) {
        value2 = value2 * 16 + ch - 65 + 10;
      } else if (ch >= 97 && ch <= 102) {
        value2 = value2 * 16 + ch - 97 + 10;
      } else {
        break;
      }
      pos++;
      digits++;
    }
    if (digits < count) {
      value2 = -1;
    }
    return value2;
  }
  function setPosition(newPosition) {
    pos = newPosition;
    value = "";
    tokenOffset = 0;
    token = 16;
    scanError = 0;
  }
  function scanNumber() {
    let start = pos;
    if (text.charCodeAt(pos) === 48) {
      pos++;
    } else {
      pos++;
      while (pos < text.length && isDigit(text.charCodeAt(pos))) {
        pos++;
      }
    }
    if (pos < text.length && text.charCodeAt(pos) === 46) {
      pos++;
      if (pos < text.length && isDigit(text.charCodeAt(pos))) {
        pos++;
        while (pos < text.length && isDigit(text.charCodeAt(pos))) {
          pos++;
        }
      } else {
        scanError = 3;
        return text.substring(start, pos);
      }
    }
    let end = pos;
    if (pos < text.length && (text.charCodeAt(pos) === 69 || text.charCodeAt(pos) === 101)) {
      pos++;
      if (pos < text.length && text.charCodeAt(pos) === 43 || text.charCodeAt(pos) === 45) {
        pos++;
      }
      if (pos < text.length && isDigit(text.charCodeAt(pos))) {
        pos++;
        while (pos < text.length && isDigit(text.charCodeAt(pos))) {
          pos++;
        }
        end = pos;
      } else {
        scanError = 3;
      }
    }
    return text.substring(start, end);
  }
  function scanString() {
    let result = "", start = pos;
    while (true) {
      if (pos >= len) {
        result += text.substring(start, pos);
        scanError = 2;
        break;
      }
      const ch = text.charCodeAt(pos);
      if (ch === 34) {
        result += text.substring(start, pos);
        pos++;
        break;
      }
      if (ch === 92) {
        result += text.substring(start, pos);
        pos++;
        if (pos >= len) {
          scanError = 2;
          break;
        }
        const ch2 = text.charCodeAt(pos++);
        switch (ch2) {
          case 34:
            result += '"';
            break;
          case 92:
            result += "\\";
            break;
          case 47:
            result += "/";
            break;
          case 98:
            result += "\b";
            break;
          case 102:
            result += "\f";
            break;
          case 110:
            result += "\n";
            break;
          case 114:
            result += "\r";
            break;
          case 116:
            result += "	";
            break;
          case 117:
            const ch3 = scanHexDigits(4, true);
            if (ch3 >= 0) {
              result += String.fromCharCode(ch3);
            } else {
              scanError = 4;
            }
            break;
          default:
            scanError = 5;
        }
        start = pos;
        continue;
      }
      if (ch >= 0 && ch <= 31) {
        if (isLineBreak(ch)) {
          result += text.substring(start, pos);
          scanError = 2;
          break;
        } else {
          scanError = 6;
        }
      }
      pos++;
    }
    return result;
  }
  function scanNext() {
    value = "";
    scanError = 0;
    tokenOffset = pos;
    lineStartOffset = lineNumber;
    prevTokenLineStartOffset = tokenLineStartOffset;
    if (pos >= len) {
      tokenOffset = len;
      return token = 17;
    }
    let code = text.charCodeAt(pos);
    if (isWhiteSpace(code)) {
      do {
        pos++;
        value += String.fromCharCode(code);
        code = text.charCodeAt(pos);
      } while (isWhiteSpace(code));
      return token = 15;
    }
    if (isLineBreak(code)) {
      pos++;
      value += String.fromCharCode(code);
      if (code === 13 && text.charCodeAt(pos) === 10) {
        pos++;
        value += "\n";
      }
      lineNumber++;
      tokenLineStartOffset = pos;
      return token = 14;
    }
    switch (code) {
      // tokens: []{}:,
      case 123:
        pos++;
        return token = 1;
      case 125:
        pos++;
        return token = 2;
      case 91:
        pos++;
        return token = 3;
      case 93:
        pos++;
        return token = 4;
      case 58:
        pos++;
        return token = 6;
      case 44:
        pos++;
        return token = 5;
      // strings
      case 34:
        pos++;
        value = scanString();
        return token = 10;
      // comments
      case 47:
        const start = pos - 1;
        if (text.charCodeAt(pos + 1) === 47) {
          pos += 2;
          while (pos < len) {
            if (isLineBreak(text.charCodeAt(pos))) {
              break;
            }
            pos++;
          }
          value = text.substring(start, pos);
          return token = 12;
        }
        if (text.charCodeAt(pos + 1) === 42) {
          pos += 2;
          const safeLength = len - 1;
          let commentClosed = false;
          while (pos < safeLength) {
            const ch = text.charCodeAt(pos);
            if (ch === 42 && text.charCodeAt(pos + 1) === 47) {
              pos += 2;
              commentClosed = true;
              break;
            }
            pos++;
            if (isLineBreak(ch)) {
              if (ch === 13 && text.charCodeAt(pos) === 10) {
                pos++;
              }
              lineNumber++;
              tokenLineStartOffset = pos;
            }
          }
          if (!commentClosed) {
            pos++;
            scanError = 1;
          }
          value = text.substring(start, pos);
          return token = 13;
        }
        value += String.fromCharCode(code);
        pos++;
        return token = 16;
      // numbers
      case 45:
        value += String.fromCharCode(code);
        pos++;
        if (pos === len || !isDigit(text.charCodeAt(pos))) {
          return token = 16;
        }
      // found a minus, followed by a number so
      // we fall through to proceed with scanning
      // numbers
      case 48:
      case 49:
      case 50:
      case 51:
      case 52:
      case 53:
      case 54:
      case 55:
      case 56:
      case 57:
        value += scanNumber();
        return token = 11;
      // literals and unknown symbols
      default:
        while (pos < len && isUnknownContentCharacter(code)) {
          pos++;
          code = text.charCodeAt(pos);
        }
        if (tokenOffset !== pos) {
          value = text.substring(tokenOffset, pos);
          switch (value) {
            case "true":
              return token = 8;
            case "false":
              return token = 9;
            case "null":
              return token = 7;
          }
          return token = 16;
        }
        value += String.fromCharCode(code);
        pos++;
        return token = 16;
    }
  }
  function isUnknownContentCharacter(code) {
    if (isWhiteSpace(code) || isLineBreak(code)) {
      return false;
    }
    switch (code) {
      case 125:
      case 93:
      case 123:
      case 91:
      case 34:
      case 58:
      case 44:
      case 47:
        return false;
    }
    return true;
  }
  function scanNextNonTrivia() {
    let result;
    do {
      result = scanNext();
    } while (result >= 12 && result <= 15);
    return result;
  }
  return {
    setPosition,
    getPosition: () => pos,
    scan: ignoreTrivia ? scanNextNonTrivia : scanNext,
    getToken: () => token,
    getTokenValue: () => value,
    getTokenOffset: () => tokenOffset,
    getTokenLength: () => pos - tokenOffset,
    getTokenStartLine: () => lineStartOffset,
    getTokenStartCharacter: () => tokenOffset - prevTokenLineStartOffset,
    getTokenError: () => scanError
  };
}
function isWhiteSpace(ch) {
  return ch === 32 || ch === 9;
}
function isLineBreak(ch) {
  return ch === 10 || ch === 13;
}
function isDigit(ch) {
  return ch >= 48 && ch <= 57;
}
var CharacterCodes;
(function(CharacterCodes2) {
  CharacterCodes2[CharacterCodes2["lineFeed"] = 10] = "lineFeed";
  CharacterCodes2[CharacterCodes2["carriageReturn"] = 13] = "carriageReturn";
  CharacterCodes2[CharacterCodes2["space"] = 32] = "space";
  CharacterCodes2[CharacterCodes2["_0"] = 48] = "_0";
  CharacterCodes2[CharacterCodes2["_1"] = 49] = "_1";
  CharacterCodes2[CharacterCodes2["_2"] = 50] = "_2";
  CharacterCodes2[CharacterCodes2["_3"] = 51] = "_3";
  CharacterCodes2[CharacterCodes2["_4"] = 52] = "_4";
  CharacterCodes2[CharacterCodes2["_5"] = 53] = "_5";
  CharacterCodes2[CharacterCodes2["_6"] = 54] = "_6";
  CharacterCodes2[CharacterCodes2["_7"] = 55] = "_7";
  CharacterCodes2[CharacterCodes2["_8"] = 56] = "_8";
  CharacterCodes2[CharacterCodes2["_9"] = 57] = "_9";
  CharacterCodes2[CharacterCodes2["a"] = 97] = "a";
  CharacterCodes2[CharacterCodes2["b"] = 98] = "b";
  CharacterCodes2[CharacterCodes2["c"] = 99] = "c";
  CharacterCodes2[CharacterCodes2["d"] = 100] = "d";
  CharacterCodes2[CharacterCodes2["e"] = 101] = "e";
  CharacterCodes2[CharacterCodes2["f"] = 102] = "f";
  CharacterCodes2[CharacterCodes2["g"] = 103] = "g";
  CharacterCodes2[CharacterCodes2["h"] = 104] = "h";
  CharacterCodes2[CharacterCodes2["i"] = 105] = "i";
  CharacterCodes2[CharacterCodes2["j"] = 106] = "j";
  CharacterCodes2[CharacterCodes2["k"] = 107] = "k";
  CharacterCodes2[CharacterCodes2["l"] = 108] = "l";
  CharacterCodes2[CharacterCodes2["m"] = 109] = "m";
  CharacterCodes2[CharacterCodes2["n"] = 110] = "n";
  CharacterCodes2[CharacterCodes2["o"] = 111] = "o";
  CharacterCodes2[CharacterCodes2["p"] = 112] = "p";
  CharacterCodes2[CharacterCodes2["q"] = 113] = "q";
  CharacterCodes2[CharacterCodes2["r"] = 114] = "r";
  CharacterCodes2[CharacterCodes2["s"] = 115] = "s";
  CharacterCodes2[CharacterCodes2["t"] = 116] = "t";
  CharacterCodes2[CharacterCodes2["u"] = 117] = "u";
  CharacterCodes2[CharacterCodes2["v"] = 118] = "v";
  CharacterCodes2[CharacterCodes2["w"] = 119] = "w";
  CharacterCodes2[CharacterCodes2["x"] = 120] = "x";
  CharacterCodes2[CharacterCodes2["y"] = 121] = "y";
  CharacterCodes2[CharacterCodes2["z"] = 122] = "z";
  CharacterCodes2[CharacterCodes2["A"] = 65] = "A";
  CharacterCodes2[CharacterCodes2["B"] = 66] = "B";
  CharacterCodes2[CharacterCodes2["C"] = 67] = "C";
  CharacterCodes2[CharacterCodes2["D"] = 68] = "D";
  CharacterCodes2[CharacterCodes2["E"] = 69] = "E";
  CharacterCodes2[CharacterCodes2["F"] = 70] = "F";
  CharacterCodes2[CharacterCodes2["G"] = 71] = "G";
  CharacterCodes2[CharacterCodes2["H"] = 72] = "H";
  CharacterCodes2[CharacterCodes2["I"] = 73] = "I";
  CharacterCodes2[CharacterCodes2["J"] = 74] = "J";
  CharacterCodes2[CharacterCodes2["K"] = 75] = "K";
  CharacterCodes2[CharacterCodes2["L"] = 76] = "L";
  CharacterCodes2[CharacterCodes2["M"] = 77] = "M";
  CharacterCodes2[CharacterCodes2["N"] = 78] = "N";
  CharacterCodes2[CharacterCodes2["O"] = 79] = "O";
  CharacterCodes2[CharacterCodes2["P"] = 80] = "P";
  CharacterCodes2[CharacterCodes2["Q"] = 81] = "Q";
  CharacterCodes2[CharacterCodes2["R"] = 82] = "R";
  CharacterCodes2[CharacterCodes2["S"] = 83] = "S";
  CharacterCodes2[CharacterCodes2["T"] = 84] = "T";
  CharacterCodes2[CharacterCodes2["U"] = 85] = "U";
  CharacterCodes2[CharacterCodes2["V"] = 86] = "V";
  CharacterCodes2[CharacterCodes2["W"] = 87] = "W";
  CharacterCodes2[CharacterCodes2["X"] = 88] = "X";
  CharacterCodes2[CharacterCodes2["Y"] = 89] = "Y";
  CharacterCodes2[CharacterCodes2["Z"] = 90] = "Z";
  CharacterCodes2[CharacterCodes2["asterisk"] = 42] = "asterisk";
  CharacterCodes2[CharacterCodes2["backslash"] = 92] = "backslash";
  CharacterCodes2[CharacterCodes2["closeBrace"] = 125] = "closeBrace";
  CharacterCodes2[CharacterCodes2["closeBracket"] = 93] = "closeBracket";
  CharacterCodes2[CharacterCodes2["colon"] = 58] = "colon";
  CharacterCodes2[CharacterCodes2["comma"] = 44] = "comma";
  CharacterCodes2[CharacterCodes2["dot"] = 46] = "dot";
  CharacterCodes2[CharacterCodes2["doubleQuote"] = 34] = "doubleQuote";
  CharacterCodes2[CharacterCodes2["minus"] = 45] = "minus";
  CharacterCodes2[CharacterCodes2["openBrace"] = 123] = "openBrace";
  CharacterCodes2[CharacterCodes2["openBracket"] = 91] = "openBracket";
  CharacterCodes2[CharacterCodes2["plus"] = 43] = "plus";
  CharacterCodes2[CharacterCodes2["slash"] = 47] = "slash";
  CharacterCodes2[CharacterCodes2["formFeed"] = 12] = "formFeed";
  CharacterCodes2[CharacterCodes2["tab"] = 9] = "tab";
})(CharacterCodes || (CharacterCodes = {}));

// ../../node_modules/.pnpm/jsonc-parser@3.3.1/node_modules/jsonc-parser/lib/esm/impl/string-intern.js
var cachedSpaces = new Array(20).fill(0).map((_2, index) => {
  return " ".repeat(index);
});
var maxCachedValues = 200;
var cachedBreakLinesWithSpaces = {
  " ": {
    "\n": new Array(maxCachedValues).fill(0).map((_2, index) => {
      return "\n" + " ".repeat(index);
    }),
    "\r": new Array(maxCachedValues).fill(0).map((_2, index) => {
      return "\r" + " ".repeat(index);
    }),
    "\r\n": new Array(maxCachedValues).fill(0).map((_2, index) => {
      return "\r\n" + " ".repeat(index);
    })
  },
  "	": {
    "\n": new Array(maxCachedValues).fill(0).map((_2, index) => {
      return "\n" + "	".repeat(index);
    }),
    "\r": new Array(maxCachedValues).fill(0).map((_2, index) => {
      return "\r" + "	".repeat(index);
    }),
    "\r\n": new Array(maxCachedValues).fill(0).map((_2, index) => {
      return "\r\n" + "	".repeat(index);
    })
  }
};

// ../../node_modules/.pnpm/jsonc-parser@3.3.1/node_modules/jsonc-parser/lib/esm/impl/parser.js
var ParseOptions;
(function(ParseOptions2) {
  ParseOptions2.DEFAULT = {
    allowTrailingComma: false
  };
})(ParseOptions || (ParseOptions = {}));
function parseTree(text, errors = [], options = ParseOptions.DEFAULT) {
  let currentParent = { type: "array", offset: -1, length: -1, children: [], parent: void 0 };
  function ensurePropertyComplete(endOffset) {
    if (currentParent.type === "property") {
      currentParent.length = endOffset - currentParent.offset;
      currentParent = currentParent.parent;
    }
  }
  function onValue(valueNode) {
    currentParent.children.push(valueNode);
    return valueNode;
  }
  const visitor = {
    onObjectBegin: (offset) => {
      currentParent = onValue({ type: "object", offset, length: -1, parent: currentParent, children: [] });
    },
    onObjectProperty: (name, offset, length) => {
      currentParent = onValue({ type: "property", offset, length: -1, parent: currentParent, children: [] });
      currentParent.children.push({ type: "string", value: name, offset, length, parent: currentParent });
    },
    onObjectEnd: (offset, length) => {
      ensurePropertyComplete(offset + length);
      currentParent.length = offset + length - currentParent.offset;
      currentParent = currentParent.parent;
      ensurePropertyComplete(offset + length);
    },
    onArrayBegin: (offset, length) => {
      currentParent = onValue({ type: "array", offset, length: -1, parent: currentParent, children: [] });
    },
    onArrayEnd: (offset, length) => {
      currentParent.length = offset + length - currentParent.offset;
      currentParent = currentParent.parent;
      ensurePropertyComplete(offset + length);
    },
    onLiteralValue: (value, offset, length) => {
      onValue({ type: getNodeType(value), offset, length, parent: currentParent, value });
      ensurePropertyComplete(offset + length);
    },
    onSeparator: (sep2, offset, length) => {
      if (currentParent.type === "property") {
        if (sep2 === ":") {
          currentParent.colonOffset = offset;
        } else if (sep2 === ",") {
          ensurePropertyComplete(offset);
        }
      }
    },
    onError: (error, offset, length) => {
      errors.push({ error, offset, length });
    }
  };
  visit(text, visitor, options);
  const result = currentParent.children[0];
  if (result) {
    delete result.parent;
  }
  return result;
}
function visit(text, visitor, options = ParseOptions.DEFAULT) {
  const _scanner = createScanner(text, false);
  const _jsonPath = [];
  let suppressedCallbacks = 0;
  function toNoArgVisit(visitFunction) {
    return visitFunction ? () => suppressedCallbacks === 0 && visitFunction(_scanner.getTokenOffset(), _scanner.getTokenLength(), _scanner.getTokenStartLine(), _scanner.getTokenStartCharacter()) : () => true;
  }
  function toOneArgVisit(visitFunction) {
    return visitFunction ? (arg) => suppressedCallbacks === 0 && visitFunction(arg, _scanner.getTokenOffset(), _scanner.getTokenLength(), _scanner.getTokenStartLine(), _scanner.getTokenStartCharacter()) : () => true;
  }
  function toOneArgVisitWithPath(visitFunction) {
    return visitFunction ? (arg) => suppressedCallbacks === 0 && visitFunction(arg, _scanner.getTokenOffset(), _scanner.getTokenLength(), _scanner.getTokenStartLine(), _scanner.getTokenStartCharacter(), () => _jsonPath.slice()) : () => true;
  }
  function toBeginVisit(visitFunction) {
    return visitFunction ? () => {
      if (suppressedCallbacks > 0) {
        suppressedCallbacks++;
      } else {
        let cbReturn = visitFunction(_scanner.getTokenOffset(), _scanner.getTokenLength(), _scanner.getTokenStartLine(), _scanner.getTokenStartCharacter(), () => _jsonPath.slice());
        if (cbReturn === false) {
          suppressedCallbacks = 1;
        }
      }
    } : () => true;
  }
  function toEndVisit(visitFunction) {
    return visitFunction ? () => {
      if (suppressedCallbacks > 0) {
        suppressedCallbacks--;
      }
      if (suppressedCallbacks === 0) {
        visitFunction(_scanner.getTokenOffset(), _scanner.getTokenLength(), _scanner.getTokenStartLine(), _scanner.getTokenStartCharacter());
      }
    } : () => true;
  }
  const onObjectBegin = toBeginVisit(visitor.onObjectBegin), onObjectProperty = toOneArgVisitWithPath(visitor.onObjectProperty), onObjectEnd = toEndVisit(visitor.onObjectEnd), onArrayBegin = toBeginVisit(visitor.onArrayBegin), onArrayEnd = toEndVisit(visitor.onArrayEnd), onLiteralValue = toOneArgVisitWithPath(visitor.onLiteralValue), onSeparator = toOneArgVisit(visitor.onSeparator), onComment = toNoArgVisit(visitor.onComment), onError = toOneArgVisit(visitor.onError);
  const disallowComments = options && options.disallowComments;
  const allowTrailingComma = options && options.allowTrailingComma;
  function scanNext() {
    while (true) {
      const token = _scanner.scan();
      switch (_scanner.getTokenError()) {
        case 4:
          handleError(
            14
            /* ParseErrorCode.InvalidUnicode */
          );
          break;
        case 5:
          handleError(
            15
            /* ParseErrorCode.InvalidEscapeCharacter */
          );
          break;
        case 3:
          handleError(
            13
            /* ParseErrorCode.UnexpectedEndOfNumber */
          );
          break;
        case 1:
          if (!disallowComments) {
            handleError(
              11
              /* ParseErrorCode.UnexpectedEndOfComment */
            );
          }
          break;
        case 2:
          handleError(
            12
            /* ParseErrorCode.UnexpectedEndOfString */
          );
          break;
        case 6:
          handleError(
            16
            /* ParseErrorCode.InvalidCharacter */
          );
          break;
      }
      switch (token) {
        case 12:
        case 13:
          if (disallowComments) {
            handleError(
              10
              /* ParseErrorCode.InvalidCommentToken */
            );
          } else {
            onComment();
          }
          break;
        case 16:
          handleError(
            1
            /* ParseErrorCode.InvalidSymbol */
          );
          break;
        case 15:
        case 14:
          break;
        default:
          return token;
      }
    }
  }
  function handleError(error, skipUntilAfter = [], skipUntil = []) {
    onError(error);
    if (skipUntilAfter.length + skipUntil.length > 0) {
      let token = _scanner.getToken();
      while (token !== 17) {
        if (skipUntilAfter.indexOf(token) !== -1) {
          scanNext();
          break;
        } else if (skipUntil.indexOf(token) !== -1) {
          break;
        }
        token = scanNext();
      }
    }
  }
  function parseString(isValue) {
    const value = _scanner.getTokenValue();
    if (isValue) {
      onLiteralValue(value);
    } else {
      onObjectProperty(value);
      _jsonPath.push(value);
    }
    scanNext();
    return true;
  }
  function parseLiteral() {
    switch (_scanner.getToken()) {
      case 11:
        const tokenValue = _scanner.getTokenValue();
        let value = Number(tokenValue);
        if (isNaN(value)) {
          handleError(
            2
            /* ParseErrorCode.InvalidNumberFormat */
          );
          value = 0;
        }
        onLiteralValue(value);
        break;
      case 7:
        onLiteralValue(null);
        break;
      case 8:
        onLiteralValue(true);
        break;
      case 9:
        onLiteralValue(false);
        break;
      default:
        return false;
    }
    scanNext();
    return true;
  }
  function parseProperty() {
    if (_scanner.getToken() !== 10) {
      handleError(3, [], [
        2,
        5
        /* SyntaxKind.CommaToken */
      ]);
      return false;
    }
    parseString(false);
    if (_scanner.getToken() === 6) {
      onSeparator(":");
      scanNext();
      if (!parseValue()) {
        handleError(4, [], [
          2,
          5
          /* SyntaxKind.CommaToken */
        ]);
      }
    } else {
      handleError(5, [], [
        2,
        5
        /* SyntaxKind.CommaToken */
      ]);
    }
    _jsonPath.pop();
    return true;
  }
  function parseObject2() {
    onObjectBegin();
    scanNext();
    let needsComma = false;
    while (_scanner.getToken() !== 2 && _scanner.getToken() !== 17) {
      if (_scanner.getToken() === 5) {
        if (!needsComma) {
          handleError(4, [], []);
        }
        onSeparator(",");
        scanNext();
        if (_scanner.getToken() === 2 && allowTrailingComma) {
          break;
        }
      } else if (needsComma) {
        handleError(6, [], []);
      }
      if (!parseProperty()) {
        handleError(4, [], [
          2,
          5
          /* SyntaxKind.CommaToken */
        ]);
      }
      needsComma = true;
    }
    onObjectEnd();
    if (_scanner.getToken() !== 2) {
      handleError(7, [
        2
        /* SyntaxKind.CloseBraceToken */
      ], []);
    } else {
      scanNext();
    }
    return true;
  }
  function parseArray2() {
    onArrayBegin();
    scanNext();
    let isFirstElement = true;
    let needsComma = false;
    while (_scanner.getToken() !== 4 && _scanner.getToken() !== 17) {
      if (_scanner.getToken() === 5) {
        if (!needsComma) {
          handleError(4, [], []);
        }
        onSeparator(",");
        scanNext();
        if (_scanner.getToken() === 4 && allowTrailingComma) {
          break;
        }
      } else if (needsComma) {
        handleError(6, [], []);
      }
      if (isFirstElement) {
        _jsonPath.push(0);
        isFirstElement = false;
      } else {
        _jsonPath[_jsonPath.length - 1]++;
      }
      if (!parseValue()) {
        handleError(4, [], [
          4,
          5
          /* SyntaxKind.CommaToken */
        ]);
      }
      needsComma = true;
    }
    onArrayEnd();
    if (!isFirstElement) {
      _jsonPath.pop();
    }
    if (_scanner.getToken() !== 4) {
      handleError(8, [
        4
        /* SyntaxKind.CloseBracketToken */
      ], []);
    } else {
      scanNext();
    }
    return true;
  }
  function parseValue() {
    switch (_scanner.getToken()) {
      case 3:
        return parseArray2();
      case 1:
        return parseObject2();
      case 10:
        return parseString(true);
      default:
        return parseLiteral();
    }
  }
  scanNext();
  if (_scanner.getToken() === 17) {
    if (options.allowEmptyContent) {
      return true;
    }
    handleError(4, [], []);
    return false;
  }
  if (!parseValue()) {
    handleError(4, [], []);
    return false;
  }
  if (_scanner.getToken() !== 17) {
    handleError(9, [], []);
  }
  return true;
}
function getNodeType(value) {
  switch (typeof value) {
    case "boolean":
      return "boolean";
    case "number":
      return "number";
    case "string":
      return "string";
    case "object": {
      if (!value) {
        return "null";
      } else if (Array.isArray(value)) {
        return "array";
      }
      return "object";
    }
    default:
      return "null";
  }
}

// ../../node_modules/.pnpm/jsonc-parser@3.3.1/node_modules/jsonc-parser/lib/esm/main.js
var ScanError;
(function(ScanError2) {
  ScanError2[ScanError2["None"] = 0] = "None";
  ScanError2[ScanError2["UnexpectedEndOfComment"] = 1] = "UnexpectedEndOfComment";
  ScanError2[ScanError2["UnexpectedEndOfString"] = 2] = "UnexpectedEndOfString";
  ScanError2[ScanError2["UnexpectedEndOfNumber"] = 3] = "UnexpectedEndOfNumber";
  ScanError2[ScanError2["InvalidUnicode"] = 4] = "InvalidUnicode";
  ScanError2[ScanError2["InvalidEscapeCharacter"] = 5] = "InvalidEscapeCharacter";
  ScanError2[ScanError2["InvalidCharacter"] = 6] = "InvalidCharacter";
})(ScanError || (ScanError = {}));
var SyntaxKind;
(function(SyntaxKind2) {
  SyntaxKind2[SyntaxKind2["OpenBraceToken"] = 1] = "OpenBraceToken";
  SyntaxKind2[SyntaxKind2["CloseBraceToken"] = 2] = "CloseBraceToken";
  SyntaxKind2[SyntaxKind2["OpenBracketToken"] = 3] = "OpenBracketToken";
  SyntaxKind2[SyntaxKind2["CloseBracketToken"] = 4] = "CloseBracketToken";
  SyntaxKind2[SyntaxKind2["CommaToken"] = 5] = "CommaToken";
  SyntaxKind2[SyntaxKind2["ColonToken"] = 6] = "ColonToken";
  SyntaxKind2[SyntaxKind2["NullKeyword"] = 7] = "NullKeyword";
  SyntaxKind2[SyntaxKind2["TrueKeyword"] = 8] = "TrueKeyword";
  SyntaxKind2[SyntaxKind2["FalseKeyword"] = 9] = "FalseKeyword";
  SyntaxKind2[SyntaxKind2["StringLiteral"] = 10] = "StringLiteral";
  SyntaxKind2[SyntaxKind2["NumericLiteral"] = 11] = "NumericLiteral";
  SyntaxKind2[SyntaxKind2["LineCommentTrivia"] = 12] = "LineCommentTrivia";
  SyntaxKind2[SyntaxKind2["BlockCommentTrivia"] = 13] = "BlockCommentTrivia";
  SyntaxKind2[SyntaxKind2["LineBreakTrivia"] = 14] = "LineBreakTrivia";
  SyntaxKind2[SyntaxKind2["Trivia"] = 15] = "Trivia";
  SyntaxKind2[SyntaxKind2["Unknown"] = 16] = "Unknown";
  SyntaxKind2[SyntaxKind2["EOF"] = 17] = "EOF";
})(SyntaxKind || (SyntaxKind = {}));
var parseTree2 = parseTree;
var ParseErrorCode;
(function(ParseErrorCode2) {
  ParseErrorCode2[ParseErrorCode2["InvalidSymbol"] = 1] = "InvalidSymbol";
  ParseErrorCode2[ParseErrorCode2["InvalidNumberFormat"] = 2] = "InvalidNumberFormat";
  ParseErrorCode2[ParseErrorCode2["PropertyNameExpected"] = 3] = "PropertyNameExpected";
  ParseErrorCode2[ParseErrorCode2["ValueExpected"] = 4] = "ValueExpected";
  ParseErrorCode2[ParseErrorCode2["ColonExpected"] = 5] = "ColonExpected";
  ParseErrorCode2[ParseErrorCode2["CommaExpected"] = 6] = "CommaExpected";
  ParseErrorCode2[ParseErrorCode2["CloseBraceExpected"] = 7] = "CloseBraceExpected";
  ParseErrorCode2[ParseErrorCode2["CloseBracketExpected"] = 8] = "CloseBracketExpected";
  ParseErrorCode2[ParseErrorCode2["EndOfFileExpected"] = 9] = "EndOfFileExpected";
  ParseErrorCode2[ParseErrorCode2["InvalidCommentToken"] = 10] = "InvalidCommentToken";
  ParseErrorCode2[ParseErrorCode2["UnexpectedEndOfComment"] = 11] = "UnexpectedEndOfComment";
  ParseErrorCode2[ParseErrorCode2["UnexpectedEndOfString"] = 12] = "UnexpectedEndOfString";
  ParseErrorCode2[ParseErrorCode2["UnexpectedEndOfNumber"] = 13] = "UnexpectedEndOfNumber";
  ParseErrorCode2[ParseErrorCode2["InvalidUnicode"] = 14] = "InvalidUnicode";
  ParseErrorCode2[ParseErrorCode2["InvalidEscapeCharacter"] = 15] = "InvalidEscapeCharacter";
  ParseErrorCode2[ParseErrorCode2["InvalidCharacter"] = 16] = "InvalidCharacter";
})(ParseErrorCode || (ParseErrorCode = {}));

// ../../node_modules/.pnpm/@nekosu+simple-parser@1.0.0/node_modules/@nekosu/simple-parser/dist/index.mjs
function e(t3) {
  if (typeof t3 == `object`) {
    if (t3 instanceof Function) return t3;
    if (t3 instanceof Array) return t3.map(e);
    {
      let e2 = {};
      for (let n3 in t3) e2[n3] = t3[n3];
      return e2;
    }
  } else return t3;
}
var t2 = class {
  constructor(e2) {
    this.lexRule = e2, this.parseRule = { $: [[[`%$begin`, `$entry`, `%$end`], ([, e3]) => e3]] };
    let t3 = this.parseRule, n3 = 0, r3 = { entry(...e3) {
      return r3.for(`$entry`).when(...e3);
    }, for(e3 = ``) {
      return e3 === `` && (e3 = `$${n3++}`), t3[e3] = t3[e3] || [], { key: e3, pat: {}, for(e4) {
        return r3.for(e4);
      }, with(e4) {
        return e4(this), this;
      }, when(...n4) {
        return { do: (r4 = ([e4]) => e4) => (t3[e3].push([n4, r4]), this), withloop() {
          let e4 = r3.for(), t4 = r3.for();
          return t4.when(e4.key).do((e5) => e5).when(e4.key, t4.key).do(([e5, t5]) => [e5, ...t5]), n4.push(t4.key), { when(...t5) {
            return { do: (n5) => (e4.when(...t5).do(n5), this) };
          }, do: (e5) => this.do(e5) };
        } };
      }, sameas(n4) {
        return t3[e3].push([[n4], ([e4]) => e4]), this;
      } };
    } };
    this.rule = r3;
  }
  canLex(e2, t3) {
    let n3 = t3.exec(e2);
    return n3 && n3.index === 0 ? [true, n3[0].length] : [false, -1];
  }
  *doLex(e2) {
    let t3 = 0, n3 = null;
    for (; e2.length > 0; ) {
      let [r3, i2] = this.canLex(e2, this.lexRule.ignore);
      if (r3) {
        e2 = e2.substring(i2), t3 += i2;
        continue;
      }
      for (let [n4, r4] of this.lexRule.token) {
        if (this.lexRule.tokenFilter?.(`%${n4}`, (e3) => this.tokens[this.tokens.length - 1 - e3].name ?? null)) continue;
        let [i3, a] = this.canLex(e2, r4);
        if (i3) {
          yield { name: `%${n4}`, value: e2.substring(0, a), range: [t3, a] }, e2 = e2.substring(a), t3 += a;
          break;
        }
      }
      if (n3 === t3) throw `parse error: lex failed since >>${e2.substring(0, 10)}<<`;
      n3 = t3;
    }
  }
  matchGrammar(t3, n3, r3, i2, a) {
    if (t3.length === n3) {
      a.push([e(i2), r3]);
      return;
    }
    let [o2, s] = this.doParse(t3[n3], r3);
    if (o2) for (let [e2, o3] of s) i2.push(e2), this.matchGrammar(t3, n3 + 1, r3 + o3, i2, a), i2.pop();
  }
  doParse(e2, t3 = 0) {
    if (t3 >= this.tokens.length) return [false, []];
    if (e2.startsWith(`%`)) {
      let n4 = this.tokens[t3];
      return n4.name === e2 ? [true, [[{ value: n4.value, range: n4.range }, 1]]] : [false, []];
    }
    let n3 = this.parseRule[e2], r3 = [];
    for (let [e3, i2] of n3) {
      let n4 = [];
      this.matchGrammar(e3, 0, t3, [], n4), r3.push(...n4.map(([e4, n5]) => [i2(e4), n5 - t3]));
    }
    return [r3.length > 0, r3];
  }
  parse(e2) {
    this.tokens = [{ name: `%$begin`, range: [0, 0] }];
    for (let t4 of this.doLex(e2)) this.tokens.push(t4);
    this.tokens.push({ name: `%$end`, range: [e2.length, 0] });
    let [t3, n3] = this.doParse(`$`);
    if (t3 && n3.length === 1) return n3[0][0];
    throw `parse error: ${n3}`;
  }
};
function n() {
  return {};
}
function r(e2, n3, r3, i2, a) {
  let o2 = new t2({ token: e2, ignore: i2, tokenFilter: n3 });
  return a(o2.rule), o2;
}

// ../../node_modules/.pnpm/@nekosu+maa-tasker@1.0.0/node_modules/@nekosu/maa-tasker/dist/index.mjs
var n2 = [`__baseTaskResolved`, `baseTask`, `algorithm`, `action`, `sub`, `subErrorIgnored`, `next`, `maxTimes`, `exceededNext`, `onErrorNext`, `preDelay`, `postDelay`, `roi`, `cache`, `rectMove`, `reduceOtherTimes`, `specificRect`, `specialParams`, `highResolutionSwipeFix`];
var r2 = [`sub`, `next`, `exceededNext`, `onErrorNext`, `reduceOtherTimes`];
function o(e2) {
  return [`next`, `exceeded_next`, `on_error_next`].includes(e2);
}
var c = null;
function l() {
  return r([[`virt`, /(?:none|self|back|next|sub|on_error_next|exceeded_next|reduce_other_times)(?![a-zA-Z0-9_-])/], [`number`, /\d+/], [`task`, /[a-zA-Z0-9_-]+/], [`sharp`, /#/], [`at`, /@/], [`multi`, /\*/], [`plus`, /\+/], [`diff`, /\^/], [`leftBrace`, /\(/], [`rightBrace`, /\)/]], (e2, t3) => e2 === `%virt` ? t3(0) !== `%sharp` : e2 === `%number` ? t3(0) !== `%multi` : false, n(), /[ \t\n]+/, (e2) => e2.entry(`taskList1`).do().for(`taskVirt`).when(`%sharp`, `%virt`).do(([, e3]) => ({ type: `#`, virt: e3.value, range: e3.range })).for(`atTaskList`).when(`taskList4`).withloop().when(`%at`, `taskList4`).do(([, e3]) => e3).do(([e3, t3]) => [e3, ...t3]).for(`taskList4`).when(`%task`).do(([e3]) => ({ type: `task`, task: e3.value, range: e3.range })).when(`%leftBrace`, `taskList1`, `%rightBrace`).do(([, e3]) => ({ type: `brace`, list: e3 })).for(`taskList3`).sameas(`taskList4`).when(`taskList4`, `taskVirt`).do(([e3, t3]) => ({ type: `@`, list: [e3], virt: t3.virt })).sameas(`taskVirt`).when(`atTaskList`, `taskVirt`).do(([e3, t3]) => ({ type: `@`, list: e3, virt: t3.virt })).when(`atTaskList`).do(([e3]) => ({ type: `@`, list: e3 })).for(`taskList2`).sameas(`taskList3`).when(`taskList3`, `%multi`, `%number`).do(([e3, , t3]) => ({ type: `*`, list: e3, count: parseInt(t3.value), range: t3.range })).for(`taskList1`).sameas(`taskList2`).when(`taskList2`, `%plus`, `taskList1`).do(([e3, , t3]) => ({ type: `+`, left: e3, right: t3 })).when(`taskList2`, `%diff`, `taskList1`).do(([e3, , t3]) => ({ type: `^`, left: e3, right: t3 })));
}
function u() {
  return c ||= l(), c;
}
function d(e2) {
  try {
    return u().parse(e2);
  } catch (e3) {
    throw `${e3}`;
  }
}
function p(e2) {
  return !!e2.__baseTaskResolved;
}
function m(e2) {
  return !e2.__baseTaskResolved;
}
function h(e2, t3 = false) {
  let n3 = new Set(e2);
  return t3 && (e2 = e2.toReversed()), e2 = e2.filter((e3) => n3.has(e3) ? (n3.delete(e3), true) : false), t3 && e2.reverse(), e2;
}
function g(e2) {
  let t3 = e2.pop();
  return [...h(e2, true), t3].join(`@`);
}
function _(e2, t3, r3) {
  if (r3 === `@` && t3.task.baseTask) return t3;
  let i2 = { self: t3.self, task: {}, trace: {} };
  if (t3.task.algorithm && (e2.task.algorithm ?? `MatchTemplate`) !== t3.task.algorithm) for (let r4 of n2) t3.task[r4] === void 0 ? e2.task[r4] !== void 0 && (i2.task[r4] = e2.task[r4], i2.trace[r4] = e2.self) : (i2.task[r4] = t3.task[r4], i2.trace[r4] = t3.self);
  else {
    i2.task = { ...e2.task }, i2.trace = { ...e2.trace };
    for (let [e3, n3] of Object.entries(t3.task)) i2.task[e3] = n3, i2.trace[e3] = t3.self;
    t3.task.template || (delete i2.task.template, delete i2.trace.template);
  }
  return r3 === `baseTask` && (delete i2.task.baseTask, delete i2.trace.baseTask), i2;
}
function v(e2) {
  if (e2 = JSON.parse(JSON.stringify(e2)), e2.length === 1) return e2[0];
  let t3 = e2.pop();
  if (t3.task.baseTask) return t3.task.baseTask === `#none` && (delete t3.task.baseTask, delete t3.trace.baseTask), t3;
  let n3 = v(e2);
  n3.self = t3.self;
  for (let [e3, r3] of Object.entries(t3.task)) n3.task[e3] = r3, n3.trace[e3] = t3.self;
  return n3;
}
function y(e2, t3) {
  if (!e2) return null;
  let n3 = JSON.parse(JSON.stringify(e2));
  if (!t3) return n3;
  for (let e3 of r2) {
    let r3 = n3.task[e3];
    if (r3) {
      let i2 = [];
      for (let e4 of r3) i2.push(t3.join(`@`) + e4);
      n3.task[e3] = i2, n3.trace[e3] = n3.self;
    }
  }
  return n3;
}
var b = class {
  taskLoopDetected(e2) {
    console.error(`task loop detected ${e2.join(` -> `)}`);
  }
  exprPropLoopDetected(e2) {
    console.error(`expr loop detected ${e2.join(` -> `)}`);
  }
  cannotFindTask(e2, t3) {
    console.error(`cannot find task ${e2} with parent ${t3}`);
  }
  warnCannotFindBaseTask(e2) {
    console.warn(`cannot find base task ${e2}`);
  }
  parseExprError(e2, t3) {
    console.error(`parse expr ${e2} failed with error ${t3}`);
  }
  exprTooLarge(e2) {
    console.error(`expr expand too large ${e2}`);
  }
};
var x2 = class {
  error;
  constructor(e2) {
    this.error = e2;
  }
  query(e2) {
    return [];
  }
};
var S = class {
  impl;
  constructor(e2) {
    this.impl = new C(e2);
  }
  evalTask(e2) {
    return this.impl.evalTask(e2, { taskChain: [], exprGetPropChain: [] });
  }
  evalExpr(e2, t3, n3 = true) {
    return this.impl.evalExpr(e2, t3, n3, { taskChain: [], exprGetPropChain: [] });
  }
  cleanCache() {
    this.impl.cache = {};
  }
};
var C = class {
  delegate;
  cache = {};
  constructor(e2) {
    this.delegate = e2;
  }
  evalTask(e2, t3) {
    return e2 = typeof e2 == `string` ? e2.split(`@`) : [...e2], this.evalTaskImpl(g(e2), [], t3);
  }
  evalExpr(e2, t3, n3, r3) {
    if (typeof e2 == `string`) try {
      e2 = d(e2);
    } catch (t4) {
      return this.delegate.error.parseExprError(e2, `${t4}`), null;
    }
    let i2 = e2, a;
    switch (i2.type) {
      case `task`:
        a = [i2.task];
        break;
      case `brace`:
        a = this.evalExpr(i2.list, t3, false, r3);
        break;
      case `#`:
        switch (i2.virt) {
          case `none`:
            a = [];
            break;
          case `self`:
            a = [t3];
            break;
          case `back`:
            a = [];
            break;
          case `next`:
          case `sub`:
          case `exceeded_next`:
          case `on_error_next`:
          case `reduce_other_times`:
            a = [];
            break;
        }
        break;
      case `@`: {
        let e3 = [], n4 = 1;
        for (let a2 of i2.list) {
          let i3 = this.evalExpr(a2, t3, false, r3);
          if (!i3) return null;
          e3.push(i3), n4 *= i3.length;
        }
        if (n4 > 1e5) return this.delegate.error.exprTooLarge(n4), null;
        for (; e3.length > 1; ) {
          let t4 = e3.shift(), n5 = e3.shift(), r4 = [];
          for (let e4 of t4) for (let t5 of n5) r4.push(`${e4}@${t5}`);
          e3.unshift(r4);
        }
        let o2 = e3.shift().map((e4) => g(e4.split(`@`)));
        switch (i2.virt) {
          case void 0:
            a = o2;
            break;
          case `none`:
            a = [];
            break;
          case `self`:
            a = o2.map(() => t3) ?? null;
            break;
          case `back`:
            a = o2;
            break;
          case `next`:
          case `sub`:
          case `exceeded_next`:
          case `on_error_next`:
          case `reduce_other_times`:
            a = [];
            for (let e4 of o2) {
              let n5 = this.getNextList(e4, i2.virt, t3, r3);
              if (!n5) return null;
              a.push(...n5);
            }
            break;
        }
        break;
      }
      case `*`: {
        let e3 = this.evalExpr(i2.list, t3, false, r3);
        if (!e3) return null;
        a = Array.from({ length: i2.count }, () => [...e3]).flat();
        break;
      }
      case `+`: {
        let e3 = this.evalExpr(i2.left, t3, false, r3), n4 = this.evalExpr(i2.right, t3, false, r3);
        if (!e3 || !n4) return null;
        a = [...e3, ...n4];
        break;
      }
      case `^`: {
        let e3 = this.evalExpr(i2.left, t3, false, r3), n4 = this.evalExpr(i2.right, t3, false, r3);
        if (!e3 || !n4) return null;
        let o2 = new Set(n4);
        a = e3.filter((e4) => !o2.has(e4));
        break;
      }
    }
    return a ? (n3 && (a = h(a)), a) : null;
  }
  evalTaskImpl(e2, t3, n3) {
    let r3 = `${t3.join(`@`)}:${e2}`, i2 = [...t3, e2].join(`@`);
    if (this.cache[i2]) return this.cache[i2];
    if (n3.taskChain.indexOf(r3) !== -1) return n3.taskChain.push(r3), this.delegate.error.taskLoopDetected(n3.taskChain), null;
    n3.taskChain.push(r3);
    let a = this.delegate.query(e2).map(([e3, t4]) => {
      let n4 = { task: i2, anchor: t4 };
      return { self: n4, task: e3, trace: Object.fromEntries(Object.keys(e3).map((e4) => [e4, n4])) };
    }), o2 = e2.split(`@`);
    if (a.length === 0) {
      if (o2.length === 1) return this.delegate.error.cannotFindTask(e2, t3), n3.taskChain.pop(), null;
      let r4 = o2.shift(), i3 = this.evalTaskImpl(o2.join(`@`), [...t3, r4], n3);
      return n3.taskChain.pop(), i3;
    } else {
      let e3 = v(a);
      if (e3.task.baseTask || o2.length === 1) {
        let r4 = y(this.resolveBaseTask(e3, n3), t3);
        return r4 && (this.cache[i2] = r4), n3.taskChain.pop(), r4;
      } else {
        let r4 = o2.shift(), a2 = this.evalTask(o2, n3);
        a2 || this.delegate.error.warnCannotFindBaseTask(o2.join(`@`));
        let s;
        if (a2) {
          this.cache[o2.join(`@`)] = a2;
          let i3 = y(a2, [r4]);
          if (!i3) return n3.taskChain.pop(), null;
          s = y(_(i3, e3, `@`), t3);
        } else s = y(e3, t3);
        return s && (this.cache[i2] = s), n3.taskChain.pop(), s;
      }
    }
  }
  resolveBaseTask(e2, t3) {
    if (p(e2.task)) return e2;
    if (m(e2.task)) {
      if (!e2.task.baseTask) return { self: e2.self, task: { ...e2.task, __baseTaskResolved: true }, trace: e2.trace };
      let n3 = this.evalTask(e2.task.baseTask, t3);
      return n3 ? this.resolveBaseTask(_(n3, e2, `baseTask`), t3) : null;
    }
    return null;
  }
  getNextList(e2, t3, n3, r3) {
    let i2 = `${e2}.${t3}`;
    if (r3.exprGetPropChain.indexOf(i2) !== -1) return r3.exprGetPropChain.push(i2), this.delegate.error.exprPropLoopDetected(r3.exprGetPropChain), null;
    r3.exprGetPropChain.push(i2);
    let a = this.evalTask(e2, r3);
    if (!a) return r3.exprGetPropChain.pop(), null;
    let s;
    switch (t3) {
      case `next`:
        s = a.task.next ?? [];
        break;
      case `sub`:
        s = a.task.sub ?? [];
        break;
      case `exceeded_next`:
        s = a.task.exceededNext ?? [];
        break;
      case `on_error_next`:
        s = a.task.onErrorNext ?? [];
        break;
      case `reduce_other_times`:
        s = a.task.reduceOtherTimes ?? [];
        break;
    }
    let c2 = [];
    for (let e3 of s) {
      let i3 = d(e3);
      if (!i3) return r3.exprGetPropChain.pop(), null;
      let a2 = this.evalExpr(i3, n3, o(t3), r3);
      if (!a2) return r3.exprGetPropChain.pop(), null;
      c2.push(...a2);
    }
    return r3.exprGetPropChain.pop(), c2;
  }
};

// ../../node_modules/.pnpm/@nekosu+maa-pipeline-manager@1.0.12/node_modules/@nekosu/maa-pipeline-manager/dist/index.mjs
var fs = __toESM(require("node:fs/promises"), 1);
var nodeKeys = [
  "next",
  "rate_limit",
  "timeout",
  "on_error",
  "anchor",
  "inverse",
  "enabled",
  "max_hit",
  "pre_delay",
  "post_delay",
  "pre_wait_freezes",
  "post_wait_freezes",
  "repeat",
  "repeat_delay",
  "repeat_wait_freezes",
  "focus",
  "attach",
  "doc",
  "desc",
  "sub_name"
];
var recoKeys = [
  "roi",
  "roi_offset",
  "template",
  "threshold",
  "order_by",
  "index",
  "method",
  "green_mask",
  "count",
  "detector",
  "ratio",
  "lower",
  "upper",
  "connected",
  "expected",
  "replace",
  "only_rec",
  "model",
  "color_filter",
  "labels",
  "all_of",
  "box_index",
  "any_of",
  "custom_recognition",
  "custom_recognition_param"
];
var actKeys = [
  "target",
  "target_offset",
  "contact",
  "pressure",
  "duration",
  "begin",
  "begin_offset",
  "end",
  "end_offset",
  "end_hold",
  "only_hover",
  "swipes",
  "dx",
  "dy",
  "key",
  "input_text",
  "package",
  "exec",
  "args",
  "detach",
  "cmd",
  "shell_timeout",
  "filename",
  "format",
  "quality",
  "custom_action",
  "custom_action_param"
];
var maaNodeKeys = [
  "baseTask",
  "sub",
  "subErrorIgnored",
  "next",
  "maxTimes",
  "exceededNext",
  "onErrorNext",
  "preDelay",
  "postDelay",
  "roi",
  "cache",
  "rectMove",
  "reduceOtherTimes",
  "specificRect",
  "specialParams",
  "highResolutionSwipeFix"
];
var maaRecoKeys = [
  "template",
  "templThreshold",
  "maskRange",
  "colorScales",
  "colorWithClose",
  "pureColor",
  "method",
  "text",
  "ocrReplace",
  "fullMatch",
  "isAscii",
  "withoutDet",
  "useRaw",
  "binThreshold",
  "count",
  "ratio",
  "detector"
];
var maaActKeys = ["inputText"];
function parseProp(prop) {
  const pair = parsePropFlex(prop);
  if (!pair) return null;
  const [key, obj, node] = pair;
  if (!obj) return null;
  return [
    key,
    obj,
    node
  ];
}
function parsePropFlex(prop) {
  if (prop.type === "property" && prop.children?.length === 1 && isString(prop.children[0])) return [
    prop.children[0].value,
    null,
    prop.children[0]
  ];
  if (prop.type !== "property" || !prop.children || prop.children.length !== 2) return null;
  const [key, obj] = prop.children;
  if (!isString(key)) return null;
  return [
    key.value,
    obj,
    key
  ];
}
function* parseObject(node) {
  if (!node || node.type !== "object") return;
  for (const prop of node.children ?? []) {
    const pair = parseProp(prop);
    if (pair) yield pair;
  }
}
function* parseObjectFlex(node) {
  if (!node || node.type !== "object") return;
  for (const prop of node.children ?? []) {
    const pair = parsePropFlex(prop);
    if (pair) yield pair;
  }
}
function* parseArray(node) {
  if (!node || node.type !== "array") return;
  for (const obj of node.children ?? []) yield obj;
}
function isString(node) {
  return !!node && node.type === "string" && typeof node.value === "string";
}
function isNumber(node) {
  return !!node && node.type === "number" && typeof node.value === "number";
}
function isBool(node) {
  return !!node && node.type === "boolean" && typeof node.value === "boolean";
}
var parseUtils = {
  parseObject,
  parseObjectFlex,
  parseArray,
  isString,
  isNumber,
  isBool
};
function shrinkParent(node) {
  delete node.parent;
  for (const child of node.children ?? []) shrinkParent(child);
}
function parseTreeWithoutParent(content) {
  const node = parseTree2(content);
  if (node) shrinkParent(node);
  return node;
}
function buildTree(node) {
  switch (node.type) {
    case "string":
    case "number":
    case "boolean":
      return node.value ?? null;
    case "object":
      return Object.fromEntries([...parseObject(node)].map(([key, obj]) => [key, buildTree(obj)]));
    case "array":
      return [...parseArray(node)].map(buildTree);
    case "property":
      return null;
    case "null":
      return null;
  }
  return null;
}
function joinPath2(...segs) {
  return path5.join(...segs);
}
function joinImagePath(maa2, root, image) {
  return path5.join(root, maa2 ? "template" : "image", image);
}
function normalizeImageFolder(image) {
  let norm = path5.normalize(image).replaceAll(path5.sep, "/");
  if (norm.endsWith("/")) norm = norm.slice(0, -1);
  return norm;
}
function relativePath(base, target) {
  return path5.relative(base, target);
}
function specialStringify(value, indent, indentCount) {
  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    const result = ["["];
    for (const val of value) result.push(indent.repeat(indentCount) + specialStringify(val, indent, indentCount + 1) + ",");
    result.push(indent.repeat(indentCount - 1) + "]");
    return result.join("\n");
  } else if (typeof value === "object" && value !== null) {
    if (Object.keys(value).length === 0) return "{}";
    const result = ["{"];
    for (const [key, val] of Object.entries(value)) result.push(indent.repeat(indentCount) + JSON.stringify(key) + ": " + specialStringify(val, indent, indentCount + 1) + ",");
    result.push(indent.repeat(indentCount - 1) + "}");
    return result.join("\n");
  } else return JSON.stringify(value);
}
var LayerInfo = class {
  loader;
  maa;
  root;
  parent;
  type;
  tasks;
  images;
  extraDecls;
  extraRefs;
  dirty;
  mergedDeclsCache;
  mergedRefsCache;
  constructor(loader, maa2, root, type) {
    this.loader = loader;
    this.maa = maa2;
    this.root = root;
    this.type = type;
    this.tasks = {};
    this.images = /* @__PURE__ */ new Set();
    this.extraDecls = [];
    this.extraRefs = [];
    this.dirty = true;
    this.mergedDeclsCache = [];
    this.mergedRefsCache = [];
  }
  reset() {
    this.tasks = {};
    this.images = /* @__PURE__ */ new Set();
    this.extraDecls = [];
    this.extraRefs = [];
    this.dirty = true;
    this.mergedDeclsCache = [];
    this.mergedRefsCache = [];
  }
  mutableTaskInfo(name) {
    this.tasks[name] = this.tasks[name] ?? [];
    return this.tasks[name];
  }
  removeFile(file) {
    const changed = [];
    for (const [task, infos] of Object.entries(this.tasks)) {
      const newInfos = infos.filter((info) => info.file !== file);
      if (infos.length !== newInfos.length) {
        if (newInfos.length === 0) delete this.tasks[task];
        else infos.splice(0, infos.length, ...newInfos);
        changed.push(task);
      }
    }
    this.extraDecls = this.extraDecls.filter((decl) => decl.file !== file);
    this.extraRefs = this.extraRefs.filter((ref) => ref.file !== file);
    this.markDirty();
    return changed;
  }
  markDirty() {
    this.dirty = true;
  }
  get mergedDecls() {
    this.flushMergedDeclsRefs();
    return this.mergedDeclsCache;
  }
  get mergedRefs() {
    this.flushMergedDeclsRefs();
    return this.mergedRefsCache;
  }
  get mergedAllDecls() {
    return (this.parent?.mergedAllDecls ?? []).concat(this.mergedDecls);
  }
  get mergedAllRefs() {
    return (this.parent?.mergedAllRefs ?? []).concat(this.mergedRefs);
  }
  flushMergedDeclsRefs() {
    if (!this.dirty) return;
    this.mergedDeclsCache = [];
    this.mergedRefsCache = [];
    for (const taskInfos of Object.values(this.tasks)) for (const taskInfo of taskInfos) {
      this.mergedDeclsCache.push(...taskInfo.info.decls);
      this.mergedRefsCache.push(...taskInfo.info.refs);
    }
    this.mergedDeclsCache.push(...this.extraDecls);
    this.mergedRefsCache.push(...this.extraRefs);
    this.dirty = false;
  }
  getTaskListNotUnique() {
    return (this.parent?.getTaskList() ?? []).concat(Object.keys(this.tasks).filter((task) => !task.startsWith("$")));
  }
  getTaskList() {
    return [...new Set(this.getTaskListNotUnique())];
  }
  getAnchorList() {
    const anchors = this.parent?.getAnchorList() ?? [];
    const decls = this.mergedDecls.filter((decl) => decl.type === "task.anchor");
    anchors.push(...decls.map((decl) => [decl.anchor, decl]));
    return anchors;
  }
  getImageListNotUnique() {
    return (this.parent?.getImageList() ?? []).concat(...this.images);
  }
  getImageList() {
    return [...new Set(this.getImageListNotUnique())];
  }
  getImageFolders() {
    const result = this.parent?.getImageFolders() ?? /* @__PURE__ */ new Map();
    for (const image of this.images) {
      const rel = path5.dirname(image);
      if (result.has(rel)) {
        const arr = result.get(rel);
        if (arr[0] !== this) arr.unshift(this);
      } else result.set(rel, [this]);
    }
    return result;
  }
  maaFindTaskDecl(task) {
    const tasks = this.getTaskList();
    let current = task;
    while (!tasks.includes(current) && current.indexOf("@") !== -1) current = current.replace(/^[^@]+@/, "");
    return current;
  }
  getTask(task, maaTrace = true) {
    const tasks = this.parent?.getTask(task) ?? [];
    const infos = {
      layer: this,
      infos: [...this.tasks[task] ?? []]
    };
    tasks.unshift(infos);
    if (this.maa && maaTrace) {
      let current = task;
      while (current.indexOf("@") !== -1) {
        const next = current.replace(/^[^@]+@/, "");
        infos.infos.push(...this.tasks[next] ?? []);
        current = next;
      }
    }
    return tasks.filter((x3) => x3.infos.length > 0);
  }
  evalTask(task) {
    const upper = this.parent?.evalTask(task);
    const result = upper ?? {};
    const info = this.tasks[task]?.[0];
    if (info) {
      const parts = info.info.parts;
      if (!upper) {
        const reco = "$" + (parts.recoType?.value ?? "DirectHit");
        const act = "$" + (parts.actType?.value ?? "DoNothing");
        Object.assign(result, this.tasks["$Default"]?.[0].obj ?? {});
        Object.assign(result, this.tasks[reco]?.[0].obj ?? {});
        Object.assign(result, this.tasks[act]?.[0].obj ?? {});
      }
      let recoChanged = false;
      let actChanged = false;
      if (parts.recoType) {
        const oldReco = result.recognition ?? "DirectHit";
        recoChanged = parts.recoType.value !== oldReco;
        result["recognition"] = parts.recoType.value;
      }
      if (parts.actType) {
        const oldAct = result.action ?? "DoNothing";
        actChanged = parts.actType.value !== oldAct;
        result["action"] = parts.actType.value;
      }
      if (recoChanged) for (const key of recoKeys) delete result[key];
      if (actChanged) for (const key of actKeys) delete result[key];
      for (const [key, obj] of [
        ...parts.base,
        ...parts.reco,
        ...parts.act,
        ...parts.unknown
      ]) if (key === "attach") result[key] = Object.assign(result[key] ?? {}, buildTree(obj));
      else result[key] = buildTree(obj);
    }
    return result;
  }
  getImage(image) {
    const layers = this.parent?.getImage(image) ?? [];
    if (this.images.has(image)) layers.unshift([
      this,
      joinImagePath(this.maa, this.root, image),
      image
    ]);
    if (this.maa) {
      const suffix = "/" + image;
      for (const file of this.images) if (file.endsWith(suffix)) layers.unshift([
        this,
        joinImagePath(this.maa, this.root, file),
        file
      ]);
    }
    return layers;
  }
  getTaskBriefInfo(task) {
    const result = {};
    for (const { infos } of this.getTask(task)) for (const info of infos) {
      if (!result.reco && info.info.parts.recoType) result.reco = info.info.parts.recoType.value;
      else if (!result.act && info.info.parts.actType) result.act = info.info.parts.actType.value;
      if (result.reco && result.act) return result;
    }
    return result;
  }
  getTaskDoc(task) {
    return this.mergedAllDecls.filter((decl) => decl.type === "task.doc").filter((decl) => decl.task === task).map((decl) => decl.doc).join(" ");
  }
  toggleMode(mode, info, indent = "    ") {
    const parts = info.info.parts;
    const data = {};
    if (mode === 1) {
      if (parts.recoType) data.recognition = parts.recoType.value;
      for (const [key, obj] of parts.reco) data[key] = buildTree(obj);
      if (parts.actType) data.action = parts.actType.value;
      for (const [key, obj] of parts.act) data[key] = buildTree(obj);
    } else if (mode === 2) {
      if (parts.recoType || parts.reco.length > 0) {
        data.recognition = {};
        if (parts.recoType) data.recognition.type = parts.recoType.value;
        if (parts.reco.length > 0) {
          data.recognition.param = {};
          for (const [key, obj] of parts.reco) data.recognition.param[key] = buildTree(obj);
        }
      }
      if (parts.actType || parts.act.length > 0) {
        data.action = {};
        if (parts.actType) data.action.type = parts.actType.value;
        if (parts.act.length > 0) {
          data.action.param = {};
          for (const [key, obj] of parts.act) data.action.param[key] = buildTree(obj);
        }
      }
    }
    for (const [key, obj] of parts.base) data[key] = buildTree(obj);
    for (const [key, obj] of parts.unknown) data[key] = buildTree(obj);
    return JSON.stringify(info.prop.value) + ": " + specialStringify(data, indent, 2);
  }
};
function parseSingle$3(node, info, ctx) {
  if (isString(node)) info.decls.push({
    file: ctx.file,
    location: node,
    type: "task.anchor",
    anchor: node.value,
    task: ctx.taskName,
    belong: ctx.taskName
  });
}
function parseAnchor(node, info, ctx) {
  if (isString(node)) parseSingle$3(node, info, ctx);
  else if (node.type === "array") for (const obj of parseArray(node)) parseSingle$3(obj, info, ctx);
  else for (const [key, obj, prop] of parseObjectFlex(node)) if (obj && isString(obj)) {
    info.decls.push({
      file: ctx.file,
      location: prop,
      type: "task.anchor",
      anchor: key,
      task: obj.value,
      belong: ctx.taskName
    });
    info.refs.push({
      file: ctx.file,
      location: obj,
      type: "task.anchor",
      target: obj.value
    });
  } else info.decls.push({
    file: ctx.file,
    location: prop,
    type: "task.anchor",
    anchor: key,
    task: "",
    belong: ctx.taskName
  });
}
function isColor(node) {
  let length = 0;
  for (const obj of parseArray(node)) {
    if (!isNumber(obj)) return false;
    length += 1;
  }
  return length === 3;
}
function parseColorSingle(node, info, ctx, method) {
  const color = [];
  for (const obj of parseArray(node)) if (isNumber(obj)) color.push(obj.value);
  info.refs.push({
    location: node,
    file: ctx.file,
    type: "task.color",
    method,
    color
  });
}
function parseColor(node, info, ctx, method) {
  if (isColor(node)) parseColorSingle(node, info, ctx, method);
  else for (const item of parseArray(node)) if (isColor(item)) parseColorSingle(item, info, ctx, method);
}
function parseColorFilter(node, info, ctx) {
  if (isString(node)) info.refs.push({
    file: ctx.file,
    location: node,
    type: "task.color_filter",
    target: node.value
  });
}
function parseFocus(node, info, ctx) {
  for (const [_key, obj] of parseObject(node)) if (isString(obj)) {
    if (obj.value.startsWith("$")) info.refs.push({
      file: ctx.file,
      location: obj,
      type: "task.locale",
      target: obj.value.substring(1)
    });
    else if (obj.value.length > 0) info.refs.push({
      file: ctx.file,
      location: obj,
      type: "task.can_locale",
      target: obj.value
    });
  }
}
function parseAttr(name, keys) {
  const info = {
    offset: 0,
    attrs: {},
    unknown: []
  };
  let offset = 0;
  while (true) {
    let found = false;
    for (const key of keys) {
      const prefix = `[${key}]`;
      if (name.startsWith(prefix)) {
        info.attrs[key] = true;
        name = name.substring(prefix.length);
        offset += prefix.length;
        found = true;
        break;
      }
    }
    if (found) continue;
    const match = /^\[([^\]]+)\]/.exec(name);
    if (match) {
      info.unknown.push([
        match[1],
        offset,
        match[1].length + 2
      ]);
      name = name.substring(match[1].length + 2);
      offset += match[1].length + 2;
      continue;
    }
    break;
  }
  info.offset = offset;
  return [name, info];
}
function parseTarget(node, info, ctx, acceptArray = false) {
  if (isString(node)) {
    const [target, attrs] = parseAttr(node.value, ["Anchor"]);
    info.refs.push({
      file: ctx.file,
      location: node,
      type: "task.target",
      target,
      attrs
    });
  } else if (acceptArray) for (const obj of parseArray(node)) parseTarget(obj, info, ctx);
}
function parseFreeze(node, info, ctx) {
  for (const [key, obj] of parseObject(node)) switch (key) {
    case "target":
      parseTarget(obj, info, ctx);
      break;
  }
}
function parseMaaBaseTask(node, info, ctx) {
  if (isString(node)) info.refs.push({
    file: ctx.file,
    location: node,
    type: "task.maa.base_task",
    target: node.value,
    tasks: buildTaskRef(node.value),
    belong: ctx.taskName
  });
}
function calcSuffix(list) {
  if (list.length === 0) return;
  let current = list[0].task;
  list.shift();
  while (list.length > 0) {
    const next = list.shift();
    current = `${next.task}@${current}`;
    next.taskSuffix = current;
  }
}
function parseMaaExprTask(ast, tasks) {
  switch (ast.type) {
    case "task":
      tasks.push({
        task: ast.task,
        taskSuffix: ast.task,
        offset: ast.range[0],
        length: ast.range[1]
      });
      return tasks[tasks.length - 1];
    case "brace":
      parseMaaExprTask(ast.list, tasks);
      break;
    case "@": {
      let list = [];
      for (const sub of ast.list) {
        const next = parseMaaExprTask(sub, tasks);
        if (next) list.unshift(next);
        else {
          calcSuffix(list);
          list = [];
        }
      }
      calcSuffix(list);
      break;
    }
    case "#":
      break;
    case "*":
      parseMaaExprTask(ast.list, tasks);
      break;
    case "+":
    case "^":
      parseMaaExprTask(ast.left, tasks);
      parseMaaExprTask(ast.right, tasks);
      break;
  }
}
function parseMaaExpr(node, info, ctx) {
  if (isString(node)) {
    const tasks = [];
    info.refs.push({
      file: ctx.file,
      location: node,
      type: "task.maa.expr",
      target: node.value,
      tasks,
      belong: ctx.taskName
    });
    try {
      parseMaaExprTask(d(node.value), tasks);
    } catch (_err) {
      return;
    }
  }
}
function parseMaaExprList(node, info, ctx) {
  for (const obj of parseArray(node)) parseMaaExpr(obj, info, ctx);
}
function parseSingle$2(node, info, ctx) {
  if (isString(node)) {
    const [target, attrs] = parseAttr(node.value, ["JumpBack", "Anchor"]);
    info.refs.push({
      file: ctx.file,
      location: node,
      type: "task.next",
      target,
      objMode: false,
      attrs
    });
  } else if (node.type === "object") {
    let loc = null;
    const ref = {
      type: "task.next",
      target: "",
      objMode: true,
      attrs: {
        offset: 0,
        attrs: {},
        unknown: []
      }
    };
    for (const [key, obj] of parseObject(node)) if (key === "name" && isString(obj)) {
      ref.target = obj.value;
      loc = obj;
    } else if (key === "jump_back" && isBool(obj)) ref.attrs.attrs.JumpBack = obj.value;
    else if (key === "anchor" && isBool(obj)) ref.attrs.attrs.Anchor = obj.value;
    if (loc) info.refs.push({
      file: ctx.file,
      location: loc,
      ...ref
    });
  }
}
function parseNextList(node, info, ctx, forceArray = false) {
  if (!forceArray && node.type !== "array") parseSingle$2(node, info, ctx);
  else for (const obj of parseArray(node)) parseSingle$2(obj, info, ctx);
}
function parseRoi2(node, info, prev, ctx) {
  if (isString(node)) {
    const [target, attrs] = parseAttr(node.value, ["Anchor"]);
    if (attrs.offset > 0) info.refs.push({
      file: ctx.file,
      location: node,
      type: "task.roi",
      target,
      attrs,
      prev: [...prev],
      task: ctx.taskName,
      prevRef: false
    });
    else {
      const prevRef = !!prev.find((decl) => decl.value === node.value);
      info.refs.push({
        file: ctx.file,
        location: node,
        type: "task.roi",
        target: node.value,
        attrs: {
          offset: 0,
          attrs: {},
          unknown: []
        },
        prev: [...prev],
        task: ctx.taskName,
        prevRef
      });
    }
  }
}
function splitNode(node, maa2) {
  const result = {
    node,
    base: [],
    reco: [],
    act: [],
    unknown: []
  };
  if (maa2) {
    for (const pair of parseObject(node)) {
      const [key, obj] = pair;
      if (key === "algorithm" && isString(obj)) result.recoType = obj;
      else if (key === "action" && isString(obj)) result.actType = obj;
      else if (maaNodeKeys.includes(key)) result.base.push(pair);
      else if (maaRecoKeys.includes(key)) result.reco.push(pair);
      else if (maaActKeys.includes(key)) result.act.push(pair);
      else result.unknown.push(pair);
    }
    return result;
  }
  for (const pair of parseObject(node)) {
    const [key, obj] = pair;
    if (nodeKeys.includes(key)) result.base.push(pair);
    else if (recoKeys.includes(key)) result.reco.push(pair);
    else if (actKeys.includes(key)) result.act.push(pair);
    else if (key === "recognition") {
      if (isString(obj)) result.recoType = obj;
      else if (obj.type === "object") {
        const type = obj.children?.find((node2) => node2.children?.[0].value === "type" && isString(node2.children?.[1]));
        const param = obj.children?.find((node2) => node2.children?.[0].value === "param");
        if (type) result.recoType = type.children[1];
        for (const pair2 of parseObject(param?.children?.[1])) if (recoKeys.includes(pair2[0])) result.reco.push(pair2);
      }
    } else if (key === "action") {
      if (isString(obj)) result.actType = obj;
      else if (obj.type === "object") {
        const type = obj.children?.find((node2) => node2.children?.[0].value === "type" && isString(node2.children?.[1]));
        const param = obj.children?.find((node2) => node2.children?.[0].value === "param");
        if (type) result.actType = type.children[1];
        for (const pair2 of parseObject(param?.children?.[1])) if (actKeys.includes(pair2[0])) result.act.push(pair2);
      }
    } else result.unknown.push(pair);
  }
  return result;
}
function parseSubName(node, info, parent, ctx) {
  if (isString(node)) {
    info.decls.push({
      file: ctx.file,
      location: node,
      type: "task.sub_reco",
      name: node.value,
      reco: parent,
      task: ctx.taskName
    });
    return node;
  } else return null;
}
function parseSingle$1(node, info, ctx) {
  if (isString(node)) info.refs.push({
    file: ctx.file,
    location: node,
    type: "task.template",
    target: node.value
  });
}
function parseTemplate(node, info, ctx) {
  if (node.type !== "array") parseSingle$1(node, info, ctx);
  else for (const obj of parseArray(node)) parseSingle$1(obj, info, ctx);
}
function parseMaaBase(props, info, ctx) {
  for (const [prop, obj] of props) switch (prop) {
    case "baseTask":
      parseMaaBaseTask(obj, info, ctx);
      break;
    case "sub":
    case "next":
    case "exceededNext":
    case "onErrorNext":
    case "reduceOtherTimes":
      parseMaaExprList(obj, info, ctx);
      break;
  }
}
function parseBase(props, info, ctx) {
  for (const [key, obj] of props) switch (key) {
    case "next":
    case "on_error":
      parseNextList(obj, info, ctx);
      break;
    case "anchor":
      parseAnchor(obj, info, ctx);
      break;
    case "pre_wait_freezes":
    case "post_wait_freezes":
    case "repeat_wait_freezes":
      parseFreeze(obj, info, ctx);
      break;
    case "focus":
      parseFocus(obj, info, ctx);
      break;
    case "doc":
    case "desc":
      if (isString(obj)) info.decls.push({
        file: ctx.file,
        location: obj,
        type: "task.doc",
        task: ctx.taskName,
        doc: obj.value
      });
      break;
  }
}
function parseMaaReco(props, info, ctx) {
  for (const [prop, obj] of props) switch (prop) {
    case "template":
      parseTemplate(obj, info, ctx);
      break;
  }
}
function processCustom(result, customName, customType, info, ctx) {
  switch (result.type) {
    case "taskRef":
      info.refs.push({
        location: result.node,
        file: ctx.file,
        type: "task.custom_task",
        target: result.node.value,
        meta: {
          customName,
          customType,
          missingPolicy: result.missingPolicy ?? "error"
        }
      });
      break;
    case "anchorRef":
      info.refs.push({
        location: result.node,
        file: ctx.file,
        type: "task.custom_anchor",
        target: result.node.value,
        meta: {
          customName,
          customType,
          missingPolicy: result.missingPolicy ?? "error"
        },
        attrs: {
          offset: 0,
          attrs: { Anchor: true },
          unknown: []
        }
      });
      break;
    case "template":
      info.refs.push({
        location: result.node,
        file: ctx.file,
        type: "task.custom_template",
        target: result.node.value,
        meta: {
          customName,
          customType,
          missingPolicy: result.missingPolicy ?? "error"
        }
      });
      break;
  }
}
function parseReco(props, baseProps, info, prev, ctx, parent) {
  let subName = null;
  let colorMatchMethod = "rgb";
  let customReco = null;
  for (const [key, obj] of props) switch (key) {
    case "roi":
      parseRoi2(obj, info, prev, ctx);
      break;
    case "template":
      parseTemplate(obj, info, ctx);
      break;
    case "color_filter":
      parseColorFilter(obj, info, ctx);
      break;
    case "all_of":
    case "any_of":
      for (const sub of parseArray(obj)) if (isString(sub)) info.refs.push({
        file: ctx.file,
        location: sub,
        type: "task.reco",
        target: sub.value
      });
      else {
        const subInfo = splitNode(sub, false);
        parseReco(subInfo.reco, subInfo.base, info, prev, ctx, sub);
      }
      break;
    case "method":
      if (isNumber(obj)) switch (obj.value) {
        case 4:
          colorMatchMethod = "rgb";
          break;
        case 40:
          colorMatchMethod = "hsv";
          break;
        default:
          colorMatchMethod = null;
      }
      break;
    case "custom_recognition":
      if (isString(obj)) customReco = obj.value;
      break;
  }
  for (const [key, obj] of baseProps) switch (key) {
    case "sub_name":
      if (parent) subName = parseSubName(obj, info, parent, ctx);
      break;
  }
  if (subName) prev.push(subName);
  if (colorMatchMethod) for (const [key, obj] of props) switch (key) {
    case "upper":
    case "lower":
      parseColor(obj, info, ctx, colorMatchMethod);
      break;
  }
  if (customReco) for (const [key, obj] of props) switch (key) {
    case "custom_recognition_param":
      const refs = ctx.parser?.customReco?.call(ctx, customReco, obj, parseUtils) ?? [];
      for (const ref of refs) processCustom(ref, customReco, "reco", info, ctx);
      break;
  }
}
function parseAct(props, info, ctx) {
  let customAct = null;
  for (const [key, obj] of props) switch (key) {
    case "target":
    case "begin":
      parseTarget(obj, info, ctx);
      break;
    case "end":
      parseTarget(obj, info, ctx, true);
      break;
    case "custom_action":
      if (isString(obj)) customAct = obj.value;
      break;
  }
  if (customAct) for (const [key, obj] of props) switch (key) {
    case "custom_action_param":
      const refs = ctx.parser?.customAction?.call(ctx, customAct, obj, parseUtils) ?? [];
      for (const ref of refs) processCustom(ref, customAct, "act", info, ctx);
      break;
  }
}
function parseUnknown(props, info, ctx) {
  for (const [key, _obj, prop] of props) if (key.startsWith("$__mpe")) info.decls.push({
    file: ctx.file,
    location: prop,
    type: "task.mpe_config"
  });
}
function buildTaskRef(task) {
  let offset = 0;
  const tasks = task.split("@").map((task2) => {
    const result = {
      task: task2,
      taskSuffix: task2,
      offset,
      length: task2.length
    };
    offset += task2.length + 1;
    return result;
  });
  let suffix = tasks[tasks.length - 1].task;
  for (let idx = tasks.length - 2; idx >= 0; idx--) {
    suffix = `${tasks[idx].task}@${suffix}`;
    tasks[idx].taskSuffix = suffix;
  }
  return tasks;
}
function parseTask(node, ctx) {
  const parts = splitNode(node, ctx.maa);
  const info = {
    parts,
    decls: [],
    refs: []
  };
  info.decls.push({
    file: ctx.file,
    location: ctx.task,
    type: "task.decl",
    task: ctx.taskName,
    tasks: buildTaskRef(ctx.taskName)
  });
  if (ctx.maa) {
    parseMaaBase(info.parts.base, info, ctx);
    parseMaaReco(parts.reco, info, ctx);
  } else {
    parseBase(info.parts.base, info, ctx);
    parseReco(parts.reco, parts.base, info, [], ctx);
    parseAct(parts.act, info, ctx);
    parseUnknown(parts.unknown, info, ctx);
  }
  return info;
}
var BundleManager = class {
  loader;
  watcher;
  root;
  delegate;
  changed;
  removed;
  watcherCtrl;
  duringFlush;
  flushResolve;
  needFlush;
  constructor(loader, watcher, root, delegate) {
    this.loader = loader;
    this.watcher = watcher;
    this.root = root;
    this.delegate = delegate;
    this.changed = /* @__PURE__ */ new Set();
    this.removed = /* @__PURE__ */ new Set();
    this.duringFlush = false;
    this.flushResolve = [];
    this.needFlush = false;
  }
  async load() {
    this.watcherCtrl?.stop();
    await this.delegate.reset();
    this.changed.clear();
    this.removed.clear();
    this.watcherCtrl = await this.watcher.watch(this.root, false, {
      filter: (file, isdir) => {
        return this.delegate.filterFile(file, isdir);
      },
      fileAdded: (file) => {
        this.changed.add(file);
        this.removed.delete(file);
        this.dispatchFlush();
      },
      fileChanged: (file) => {
        this.changed.add(file);
        this.removed.delete(file);
        this.dispatchFlush();
      },
      fileDeleted: (file) => {
        this.removed.add(file);
        this.changed.delete(file);
        this.dispatchFlush();
      }
    });
    await this.flush();
  }
  stop() {
    this.watcherCtrl?.stop();
  }
  async flush() {
    if (this.duringFlush) return new Promise((resolve) => {
      this.flushResolve.push(resolve);
    });
    this.duringFlush = true;
    this.needFlush = false;
    const changed = this.changed;
    const removed = this.removed;
    this.changed = /* @__PURE__ */ new Set();
    this.removed = /* @__PURE__ */ new Set();
    for (const file of removed) await this.delegate.deleteFile(relativePath(this.root, file), file);
    for (const file of changed) if (this.delegate.needContent(file)) {
      const content = await this.loader.get(file);
      if (typeof content === "string") await this.delegate.loadFile(relativePath(this.root, file), file, content);
      else await this.delegate.deleteFile(relativePath(this.root, file), file);
    } else await this.delegate.loadFile(relativePath(this.root, file), file);
    this.duringFlush = false;
    if (this.needFlush) setTimeout(() => {
      this.flush();
    }, 100);
    else {
      const resolves = this.flushResolve;
      this.flushResolve = [];
      process.nextTick(() => {
        for (const func of resolves) func();
      });
    }
  }
  dispatchFlush(timeout = 100) {
    if (this.needFlush) return;
    this.needFlush = true;
    setTimeout(() => {
      this.flush();
    }, timeout);
  }
};
var Bundle = class extends import_node_events.default {
  maa;
  root;
  parser;
  pipelineRoot;
  imageRoot;
  files;
  layer;
  manager;
  imageChangedTimer;
  get defaultPipelineRel() {
    return "default_pipeline.json";
  }
  get defaultPipelinePath() {
    return joinPath2(this.root, this.defaultPipelineRel);
  }
  constructor(loader, watcher, maa2, root, parser) {
    super();
    this.maa = maa2;
    this.root = root;
    this.parser = parser;
    this.pipelineRoot = joinPath2(this.root, this.maa ? "tasks" : "pipeline");
    this.imageRoot = joinPath2(this.root, this.maa ? "template" : "image");
    this.files = {};
    this.layer = new LayerInfo(loader, this.maa, this.root, "resource");
    this.manager = new BundleManager(loader, watcher, this.root, this);
  }
  async load() {
    await this.manager.load();
  }
  stop() {
    this.manager.stop();
  }
  async flush() {
    await this.manager.flush();
  }
  filterFile(file, isdir) {
    if (path5.basename(file).startsWith(".")) return false;
    if (isdir) return file.startsWith(this.pipelineRoot) || file.startsWith(this.imageRoot) || file === this.root;
    else if (file.startsWith(this.pipelineRoot)) return file.endsWith(".json") || file.endsWith(".jsonc");
    else if (file.startsWith(this.imageRoot)) return file.endsWith(".png");
    else if (file === this.defaultPipelinePath) return true;
    return false;
  }
  needContent(file) {
    return file.endsWith(".json") || file.endsWith(".jsonc");
  }
  async reset() {
    this.files = {};
    this.layer.reset();
    this.emit("reset");
  }
  async loadFile(file, full, content) {
    if (!this.filterFile(full, false)) return;
    if (file.endsWith(".json") || file.endsWith(".jsonc")) {
      const changed = this.loadFileImpl(file, content);
      if (changed.length > 0) this.emit("taskChanged", [...new Set(changed)]);
    } else if (file.endsWith(".png")) {
      const imageFile = file.replaceAll(path5.sep, "/").replace(this.maa ? "template/" : "image/", "");
      if (!this.layer.images.has(imageFile)) {
        this.layer.images.add(imageFile);
        this.dispatchImageChanged();
      }
    }
  }
  async deleteFile(file, full) {
    if (!this.filterFile(full, false)) return;
    if (file.endsWith(".json") || file.endsWith(".jsonc")) {
      const changed = this.deleteFileImpl(file);
      if (changed.length > 0) this.emit("taskChanged", [...new Set(changed)]);
    } else if (file.endsWith(".png")) {
      const imageFile = file.replaceAll(path5.sep, "/").replace(this.maa ? "template/" : "image/", "");
      if (this.layer.images.delete(imageFile)) this.dispatchImageChanged();
    }
  }
  loadFileImpl(file, content) {
    const isDefault = file === this.defaultPipelineRel;
    const changed = [];
    changed.push(...this.deleteFileImpl(file));
    if (!content) return changed;
    this.files[file] = content;
    const full = joinPath2(this.root, file);
    const tree = parseTreeWithoutParent(content);
    if (tree && tree.type === "object") for (const [key, obj, prop] of parseObject(tree)) {
      if (key.startsWith("$")) {
        if (key.startsWith("$__mpe")) this.layer.extraDecls.push({
          file: full,
          location: prop,
          type: "task.mpe_config"
        });
        continue;
      }
      let taskName = key;
      if (isDefault) taskName = "$" + taskName;
      this.layer.mutableTaskInfo(taskName).push({
        file: full,
        prop,
        data: obj,
        info: parseTask(obj, {
          maa: this.maa,
          file: full,
          task: prop,
          taskName,
          parser: this.parser
        }),
        obj: buildTree(obj)
      });
      this.layer.markDirty();
      changed.push(taskName);
    }
    return changed;
  }
  deleteFileImpl(file) {
    delete this.files[file];
    return this.layer.removeFile(joinPath2(this.root, file));
  }
  dispatchImageChanged() {
    if (this.imageChangedTimer) clearTimeout(this.imageChangedTimer);
    this.imageChangedTimer = setTimeout(() => {
      this.emit("imageChanged");
    }, 100);
  }
};
var FsContentLoader = class {
  async get(file) {
    try {
      return await fs.readFile(file, "utf8");
    } catch {
      return null;
    }
  }
};
function checkInterface(bundle) {
  const result = [];
  const layer = bundle.topLayer;
  if (layer.type === "interface") {
    const realTasks = new Set(layer.parent?.getTaskListNotUnique() ?? []);
    for (const ref of layer.mergedRefs) if (ref.type === "task.entry") {
      if (!realTasks.has(ref.target)) result.push({
        level: "error",
        file: ref.file,
        offset: ref.location.offset,
        length: ref.location.length,
        type: "int-unknown-entry-task",
        task: ref.target
      });
    }
    for (const decl of layer.mergedDecls) if (decl.type === "task.decl") {
      if (!realTasks.has(decl.task)) result.push({
        level: "error",
        file: decl.file,
        offset: decl.location.offset,
        length: decl.location.length,
        type: "int-override-unknown-task",
        task: decl.task
      });
    }
  }
  const ctrlDecls = bundle.info.decls.filter((decl) => decl.type === "interface.controller");
  const ctrls = /* @__PURE__ */ new Map();
  for (const decl of ctrlDecls) if (ctrls.has(decl.name)) {
    const prev = ctrls.get(decl.name);
    result.push({
      level: "error",
      file: decl.file,
      offset: decl.location.offset,
      length: decl.location.length,
      type: "int-conflict-controller",
      ctrl: decl.name,
      previous: {
        file: prev.file,
        offset: prev.location.offset,
        length: prev.location.length
      }
    });
  } else ctrls.set(decl.name, decl);
  const resDecls = bundle.info.decls.filter((decl) => decl.type === "interface.resource");
  const ress = /* @__PURE__ */ new Map();
  for (const decl of resDecls) if (ress.has(decl.name)) {
    const prev = ress.get(decl.name);
    result.push({
      level: "error",
      file: decl.file,
      offset: decl.location.offset,
      length: decl.location.length,
      type: "int-conflict-resource",
      res: decl.name,
      previous: {
        file: prev.file,
        offset: prev.location.offset,
        length: prev.location.length
      }
    });
  } else ress.set(decl.name, decl);
  const groupDecls = bundle.info.decls.filter((decl) => decl.type === "interface.group");
  const groups = /* @__PURE__ */ new Map();
  for (const decl of groupDecls) if (groups.has(decl.name)) {
    const prev = groups.get(decl.name);
    result.push({
      level: "error",
      file: decl.file,
      offset: decl.location.offset,
      length: decl.location.length,
      type: "int-conflict-group",
      group: decl.name,
      previous: {
        file: prev.file,
        offset: prev.location.offset,
        length: prev.location.length
      }
    });
  } else groups.set(decl.name, decl);
  const optDecls = bundle.info.decls.filter((decl) => decl.type === "interface.option");
  const options = /* @__PURE__ */ new Map();
  for (const decl of optDecls) if (options.has(decl.name)) {
    const prev = options.get(decl.name);
    result.push({
      level: "error",
      file: decl.file,
      offset: decl.location.offset,
      length: decl.location.length,
      type: "int-conflict-option",
      option: decl.name,
      previous: {
        file: prev.file,
        offset: prev.location.offset,
        length: prev.location.length
      }
    });
  } else {
    options.set(decl.name, decl);
    if (!decl.optionType || decl.optionType === "select" || decl.optionType === "switch") {
      const caseDecls = bundle.info.decls.filter((decl2) => decl2.type === "interface.case" && decl2.option === decl.name);
      const cases = /* @__PURE__ */ new Map();
      for (const decl2 of caseDecls) if (cases.has(decl2.name)) {
        const prev = cases.get(decl2.name);
        result.push({
          level: "error",
          file: decl2.file,
          offset: decl2.location.offset,
          length: decl2.location.length,
          type: "int-conflict-case",
          option: decl.name,
          case: decl2.name,
          previous: {
            file: prev.file,
            offset: prev.location.offset,
            length: prev.location.length
          }
        });
      } else cases.set(decl2.name, decl2);
      const caseRefs = bundle.info.refs.filter((ref) => ref.type === "interface.case").filter((ref) => ref.option === decl.name);
      for (const ref of caseRefs) if (!cases.has(ref.target)) result.push({
        level: "error",
        file: ref.file,
        offset: ref.location.offset,
        length: ref.location.length,
        type: "int-unknown-case",
        option: decl.name,
        case: ref.target
      });
      if (decl.optionType === "switch") {
        let missingYes = true;
        let missingNo = true;
        for (const [name, decl2] of cases) if (name === "Yes") missingYes = false;
        else if (name === "No") missingNo = false;
        else if (name.toLowerCase() === "yes") {
          missingYes = false;
          result.push({
            level: "warning",
            file: decl2.file,
            offset: decl2.location.offset,
            length: decl2.location.length,
            type: "int-switch-should-fixed"
          });
        } else if (name.toLowerCase() === "no") {
          missingNo = false;
          result.push({
            level: "warning",
            file: decl2.file,
            offset: decl2.location.offset,
            length: decl2.location.length,
            type: "int-switch-should-fixed"
          });
        } else result.push({
          level: "error",
          file: decl2.file,
          offset: decl2.location.offset,
          length: decl2.location.length,
          type: "int-switch-name-invalid"
        });
        if (missingYes || missingNo) result.push({
          level: "error",
          file: decl.file,
          offset: decl.location.offset,
          length: decl.location.length,
          type: "int-switch-missing",
          option: decl.name,
          missingYes,
          missingNo
        });
      }
    }
  }
  for (const ref of bundle.info.refs) if (ref.type === "interface.controller") {
    if (!ctrls.has(ref.target)) result.push({
      level: "error",
      file: ref.file,
      offset: ref.location.offset,
      length: ref.location.length,
      type: "int-unknown-controller",
      ctrl: ref.target
    });
  } else if (ref.type === "interface.resource") {
    if (!ress.has(ref.target)) result.push({
      level: "error",
      file: ref.file,
      offset: ref.location.offset,
      length: ref.location.length,
      type: "int-unknown-resource",
      res: ref.target
    });
  } else if (ref.type === "interface.group") {
    if (!groups.has(ref.target)) result.push({
      level: "error",
      file: ref.file,
      offset: ref.location.offset,
      length: ref.location.length,
      type: "int-unknown-group",
      group: ref.target
    });
  } else if (ref.type === "interface.option") {
    if (!options.has(ref.target)) result.push({
      level: "error",
      file: ref.file,
      offset: ref.location.offset,
      length: ref.location.length,
      type: "int-unknown-option",
      option: ref.target
    });
    if (ref.preset) {
      const optDecl = optDecls.find((decl) => decl.name === ref.target);
      if (optDecl) switch (optDecl.optionType ?? "select") {
        case "select":
        case "switch":
          if (!isString(ref.preset)) result.push({
            level: "error",
            file: ref.file,
            offset: ref.preset.offset,
            length: ref.preset.length,
            type: "int-preset-type-error",
            option: ref.target,
            expected: "string"
          });
          break;
        case "checkbox":
          if (ref.preset.type !== "array") result.push({
            level: "error",
            file: ref.file,
            offset: ref.preset.offset,
            length: ref.preset.length,
            type: "int-preset-type-error",
            option: ref.target,
            expected: "array"
          });
          break;
        case "input":
          if (ref.preset.type !== "object") result.push({
            level: "error",
            file: ref.file,
            offset: ref.preset.offset,
            length: ref.preset.length,
            type: "int-preset-type-error",
            option: ref.target,
            expected: "object"
          });
          break;
      }
    }
  }
  return result;
}
function extractTaskRef(r3) {
  if (r3.type === "task.anchor" || r3.type === "task.reco" || r3.type === "task.color_filter" || r3.type === "task.custom_task" || r3.type === "task.entry") return r3.target;
  else if (r3.type === "task.next" || r3.type === "task.roi" || r3.type === "task.target") {
    if (r3.attrs.attrs.Anchor) return null;
    if (r3.type === "task.roi" && r3.prevRef) return null;
    return r3.target;
  } else return null;
}
function isAnchorRef(r3) {
  return (r3.type === "task.next" || r3.type === "task.roi" || r3.type === "task.target" || r3.type === "task.custom_anchor") && !!r3.attrs.attrs.Anchor;
}
function checkTask(bundle) {
  const result = [];
  for (const layer of bundle.allLayers) {
    for (const [name, taskInfos] of Object.entries(layer.tasks)) {
      if (taskInfos.length > 0 && layer.type !== "interface") for (const taskInfo of taskInfos.slice(1)) result.push({
        level: "error",
        file: taskInfo.file,
        offset: taskInfo.prop.offset,
        length: taskInfo.prop.length,
        type: "conflict-task",
        task: name,
        previous: {
          file: taskInfos[0].file,
          offset: taskInfos[0].prop.offset,
          length: taskInfos[0].prop.length
        }
      });
      if (!bundle.maa) for (const taskInfo of taskInfos) {
        const existsNext = /* @__PURE__ */ new Set();
        const refs2 = taskInfo.info.refs.filter((ref) => ref.type === "task.next" && !ref.attrs.attrs.Anchor);
        refs2.sort((a, b3) => a.location.offset - b3.location.offset);
        for (const ref of refs2) if (existsNext.has(ref.target)) result.push({
          level: "error",
          file: ref.file,
          offset: ref.location.offset,
          length: ref.location.length,
          type: "duplicate-next",
          task: ref.target
        });
        else existsNext.add(ref.target);
      }
    }
    const decls = layer.mergedDecls;
    for (const decl of decls) if (decl.type === "task.mpe_config") result.push({
      level: "warning",
      file: decl.file,
      offset: decl.location.offset,
      length: decl.location.length,
      type: "mpe-config"
    });
    const refs = layer.mergedRefs;
    const tasks = new Set(layer.getTaskListNotUnique());
    const anchors = new Set(layer.getAnchorList().map(([anchor]) => anchor));
    const images = new Set(layer.getImageListNotUnique());
    const imageFolders = layer.getImageFolders();
    for (const ref of refs) {
      const task = extractTaskRef(ref);
      if (task !== null) {
        if (!tasks.has(task) && !(task === "" && ref.type === "task.anchor")) {
          let offset = ref.location.offset;
          let length = ref.location.length;
          if (ref.type === "task.next" && ref.attrs.offset > 0) {
            offset = ref.location.offset + ref.attrs.offset + 1;
            length = ref.location.length - ref.attrs.offset - 2;
          }
          let policy = "error";
          if (ref.type === "task.custom_task") {
            if (ref.meta.missingPolicy === "ignore") continue;
            policy = ref.meta.missingPolicy;
          }
          result.push({
            level: policy,
            file: ref.file,
            offset,
            length,
            type: "unknown-task",
            task
          });
        }
        if (ref.type === "task.color_filter") {
          const { reco } = layer.getTaskBriefInfo(ref.target);
          if (reco !== "ColorMatch") result.push({
            level: "error",
            file: ref.file,
            offset: ref.location.offset,
            length: ref.location.length,
            type: "color-filter-invalid",
            task,
            reco: reco ?? "DirectHit"
          });
        }
      } else if (ref.type === "task.template" || ref.type === "task.custom_template") {
        let imagePath = ref.target;
        let isFolder = false;
        if (!bundle.maa && !imagePath.endsWith(".png")) {
          const norm = normalizeImageFolder(imagePath);
          if (imageFolders.has(norm)) isFolder = true;
          else {
            result.push({
              level: "warning",
              file: ref.file,
              offset: ref.location.offset,
              length: ref.location.length,
              type: "dynamic-image"
            });
            continue;
          }
        }
        if (imagePath.includes("\\")) {
          result.push({
            level: "warning",
            file: ref.file,
            offset: ref.location.offset,
            length: ref.location.length,
            type: "image-path-back-slash"
          });
          imagePath = imagePath.replaceAll("\\", "/");
        }
        if (imagePath.startsWith("./")) {
          result.push({
            level: "warning",
            file: ref.file,
            offset: ref.location.offset,
            length: ref.location.length,
            type: "image-path-dot-slash"
          });
          imagePath = imagePath.replace("./", "");
        }
        if (bundle.maa && !imagePath.endsWith(".png")) {
          result.push({
            level: "warning",
            file: ref.file,
            offset: ref.location.offset,
            length: ref.location.length,
            type: "image-path-missing-png"
          });
          imagePath = imagePath + ".png";
        }
        if (isFolder) continue;
        if (!images.has(imagePath)) {
          let found = false;
          if (bundle.maa) {
            const suffix = "/" + imagePath;
            for (const image of images) if (image.endsWith(suffix)) {
              found = true;
              break;
            }
          }
          if (!found) {
            let policy = "error";
            if (ref.type === "task.custom_template") {
              if (ref.meta.missingPolicy === "ignore") continue;
              policy = ref.meta.missingPolicy;
            }
            result.push({
              level: policy,
              file: ref.file,
              offset: ref.location.offset,
              length: ref.location.length,
              type: "unknown-image",
              image: ref.target
            });
          }
        }
      } else if (isAnchorRef(ref)) {
        if (!anchors.has(ref.target)) {
          let policy = "error";
          if (ref.type === "task.custom_anchor") {
            if (ref.meta.missingPolicy === "ignore") continue;
            policy = ref.meta.missingPolicy;
          }
          result.push({
            level: policy,
            file: ref.file,
            offset: ref.location.offset + ref.attrs.offset + 1,
            length: ref.location.length - ref.attrs.offset - 2,
            type: "unknown-anchor",
            anchor: ref.target
          });
        }
      } else if (ref.type === "task.locale") {
        const infos = bundle.langBundle.queryKey(ref.target);
        if (!infos.find((info) => !!info)) result.push({
          level: "error",
          file: ref.file,
          offset: ref.location.offset,
          length: ref.location.length,
          type: "unknown-locale",
          locale: ref.target
        });
        else {
          const missingLangs = [];
          for (const [idx, info] of infos.entries()) if (!info) missingLangs.push(bundle.langBundle.langs[idx].name);
          if (missingLangs.length > 0) result.push({
            level: "error",
            file: ref.file,
            offset: ref.location.offset,
            length: ref.location.length,
            type: "missing-locale",
            locale: ref.target,
            langs: missingLangs
          });
        }
      }
      if ((ref.type === "task.next" || ref.type === "task.roi" || ref.type === "task.target") && ref.attrs.unknown.length > 0) for (const [attr, offset, length] of ref.attrs.unknown) result.push({
        level: "error",
        file: ref.file,
        offset: ref.location.offset + 2 + offset,
        length: length - 2,
        type: "unknown-attr",
        attr
      });
    }
  }
  return result;
}
async function buildDiagnosticMessage(root, diag, evalPos, _option) {
  const buildPos = async (loc) => {
    const [line, column] = await evalPos(loc.file, loc.offset);
    return `${relativePath(root, loc.file)}:${line}:${column}`;
  };
  const start = await evalPos(diag.file, diag.offset);
  const end = await evalPos(diag.file, diag.offset + diag.length);
  const buildBrief = async () => {
    switch (diag.type) {
      case "conflict-task":
        return t("maa.pipeline.error.conflict-task", diag.task, await buildPos(diag.previous));
      case "duplicate-next":
        return t("maa.pipeline.error.duplicate-next", diag.task);
      case "unknown-task":
        return t("maa.pipeline.error.unknown-task", diag.task);
      case "color-filter-invalid":
        return t("maa.pipeline.error.color-filter-invalid", diag.task, diag.reco);
      case "dynamic-image":
        return t("maa.pipeline.warning.image-path-dynamic");
      case "image-path-back-slash":
        return t("maa.pipeline.warning.image-path-backslash");
      case "image-path-dot-slash":
        return t("maa.pipeline.warning.image-path-dot-slash");
      case "image-path-missing-png":
        return t("maa.pipeline.warning.image-path-missing-png");
      case "unknown-image":
        return t("maa.pipeline.error.unknown-image", diag.image);
      case "unknown-anchor":
        return t("maa.pipeline.error.unknown-anchor", diag.anchor);
      case "unknown-attr":
        return t("maa.pipeline.error.unknown-attr", diag.attr);
      case "unknown-locale":
        return t("maa.pipeline.error.unknown-locale", diag.locale);
      case "missing-locale":
        return t("maa.pipeline.error.missing-locale", diag.locale, diag.langs.join(", "));
      case "mpe-config":
        return t("maa.pipeline.warning.mpe-config");
      case "int-conflict-controller":
        return t("maa.pipeline.error.conflict-controller", diag.ctrl, await buildPos(diag.previous));
      case "int-unknown-controller":
        return t("maa.pipeline.error.unknown-controller", diag.ctrl);
      case "int-conflict-resource":
        return t("maa.pipeline.error.conflict-resource", diag.res, await buildPos(diag.previous));
      case "int-unknown-resource":
        return t("maa.pipeline.error.unknown-resource", diag.res);
      case "int-conflict-group":
        return t("maa.pipeline.error.conflict-group", diag.group, await buildPos(diag.previous));
      case "int-unknown-group":
        return t("maa.pipeline.error.unknown-group", diag.group);
      case "int-conflict-option":
        return t("maa.pipeline.error.conflict-option", diag.option, await buildPos(diag.previous));
      case "int-unknown-option":
        return t("maa.pipeline.error.unknown-option", diag.option);
      case "int-conflict-case":
        return t("maa.pipeline.error.conflict-case", diag.case, diag.option, await buildPos(diag.previous));
      case "int-unknown-case":
        return t("maa.pipeline.error.unknown-case", diag.case, diag.option);
      case "int-switch-name-invalid":
        return t("maa.pipeline.error.switch-name-invalid");
      case "int-switch-missing":
        if (diag.missingYes && diag.missingNo) return t("maa.pipeline.error.switch-missing-all");
        else if (diag.missingYes) return t("maa.pipeline.error.switch-missing-yes");
        else return t("maa.pipeline.error.switch-missing-no");
      case "int-switch-should-fixed":
        return t("maa.pipeline.warning.switch-name-should-fixed");
      case "int-preset-type-error":
        return t("maa.pipeline.error.preset-type-error", diag.option, diag.expected);
      case "int-unknown-entry-task":
        return t("maa.pipeline.error.unknown-entry-task", diag.task);
      case "int-override-unknown-task":
        return t("maa.pipeline.error.override-unknown-task", diag.task);
    }
    return `unknown diagnostic: ${JSON.stringify(diag)}`;
  };
  return [
    start,
    end,
    await buildBrief()
  ];
}
function performDiagnostic(bundle, option) {
  const result = [];
  result.push(...checkTask(bundle));
  result.push(...checkInterface(bundle));
  return result.filter((diag) => !option.ignoreTypes?.includes(diag.type)).map((diag) => {
    if (option.errorTypes?.includes(diag.type)) {
      const newDiag = { ...diag };
      newDiag.level = "error";
      return newDiag;
    } else return diag;
  });
}
var ContentJson = class {
  loader;
  watcher;
  file;
  changed;
  node;
  object;
  dirty;
  watcherCtrl;
  duringFlush;
  flushResolve;
  needFlush;
  constructor(loader, watcher, file, changed) {
    this.loader = loader;
    this.watcher = watcher;
    this.file = file;
    this.changed = changed;
    this.dirty = true;
    this.duringFlush = false;
    this.flushResolve = [];
    this.needFlush = false;
    this.load();
  }
  async load() {
    this.watcherCtrl?.stop();
    this.dirty = true;
    this.watcherCtrl = await this.watcher.watch(this.file, true, {
      filter: (_file, _isdir) => {
        return true;
      },
      fileAdded: (_file) => {
        this.dirty = true;
        this.dispatchFlush();
      },
      fileChanged: (_file) => {
        this.dirty = true;
        this.dispatchFlush();
      },
      fileDeleted: (_file) => {
        this.dirty = true;
        this.dispatchFlush();
      }
    });
    await this.flush();
  }
  stop() {
    this.watcherCtrl?.stop();
  }
  async flush() {
    if (this.duringFlush) return new Promise((resolve) => {
      this.flushResolve.push(resolve);
    });
    this.duringFlush = true;
    this.needFlush = false;
    if (this.dirty) {
      const content = await this.loader.get(this.file);
      if (typeof content === "string") this.node = parseTreeWithoutParent(content);
      else this.node = void 0;
      if (this.node) this.object = buildTree(this.node);
      else this.object = void 0;
      await this.changed(this.node, this.object);
      this.dirty = false;
    }
    const resolves = this.flushResolve;
    this.flushResolve = [];
    this.duringFlush = false;
    process.nextTick(() => {
      for (const func of resolves) func();
    });
    if (this.needFlush) setTimeout(() => {
      this.flush();
    }, 100);
  }
  dispatchFlush(timeout = 100) {
    if (this.needFlush) return;
    this.needFlush = true;
    setTimeout(() => {
      this.flush();
    }, timeout);
  }
};
function parseCtrlRef(node, info, ctx) {
  const refs = [];
  for (const obj of parseArray(node)) if (isString(obj)) {
    info.refs.push({
      file: ctx.file,
      location: obj,
      type: "interface.controller",
      target: obj.value
    });
    refs.push(obj.value);
  }
  return refs;
}
function parseGroup(node, info, ctx) {
  for (const [key, obj] of parseObject(node)) switch (key) {
    case "name":
      if (isString(obj)) info.decls.push({
        file: ctx.file,
        location: obj,
        type: "interface.group",
        name: obj.value
      });
      break;
  }
}
function parseImport(node, info, ctx) {
  if (isString(node)) info.refs.push({
    file: ctx.file,
    location: node,
    type: "interface.import_path",
    target: node.value
  });
}
var locKeys = [
  "label",
  "icon",
  "description",
  "title",
  "contact",
  "license",
  "welcome"
];
function parseLanguage(node, info, ctx) {
  for (const [key, obj] of parseObject(node)) if (isString(obj)) {
    info.decls.push({
      file: ctx.file,
      location: obj,
      type: "interface.language",
      name: key,
      path: obj.value
    });
    info.refs.push({
      file: ctx.file,
      location: obj,
      type: "interface.language_path",
      target: obj.value
    });
  }
}
function parseOptionRef(node, info, ctx, trace) {
  for (const obj of parseArray(node)) if (isString(obj)) info.refs.push({
    file: ctx.file,
    location: obj,
    type: "interface.option",
    target: obj.value,
    trace: {
      name: obj.value,
      ...trace
    }
  });
}
function parseOverride(node, info, ctx) {
  for (const [key, obj, prop] of parseObject(node)) {
    if (key.startsWith("$")) {
      if (key.startsWith("$__mpe")) info.layer.extraDecls.push({
        file: ctx.file,
        location: prop,
        type: "task.mpe_config"
      });
      continue;
    }
    info.layer.mutableTaskInfo(key).push({
      file: ctx.file,
      prop,
      data: obj,
      info: parseTask(obj, {
        maa: ctx.maa,
        file: ctx.file,
        task: prop,
        taskName: key,
        parser: ctx.parser
      }),
      obj: buildTree(obj)
    });
    info.layer.markDirty();
  }
}
function parseCase(node, info, option, ctx) {
  for (const [key, obj] of parseObject(node)) switch (key) {
    case "name":
      if (isString(obj)) info.decls.push({
        file: ctx.file,
        location: obj,
        type: "interface.case",
        name: obj.value,
        option
      });
      break;
    case "option":
      parseOptionRef(obj, info, ctx, {
        from: "option",
        origin: option
      });
      break;
    case "pipeline_override":
      parseOverride(obj, info, ctx);
      break;
  }
}
function parseCases(node, info, option, ctx) {
  for (const obj of parseArray(node)) parseCase(obj, info, option, ctx);
}
function isPipelineType(type) {
  return [
    "string",
    "int",
    "bool"
  ].includes(type);
}
function parseInput(node, info, option, ctx) {
  let loc = null;
  const decl = {
    type: "interface.input",
    name: "",
    option
  };
  for (const [key, obj] of parseObject(node)) switch (key) {
    case "name":
      if (isString(obj)) {
        loc = obj;
        decl.name = obj.value;
      }
      break;
    case "pipeline_type":
      if (isString(obj) && isPipelineType(obj.value)) decl.cast = obj.value;
      break;
  }
  if (loc) {
    info.decls.push({
      file: ctx.file,
      location: loc,
      ...decl
    });
    return decl.name;
  } else return null;
}
function parseInputs(node, info, option, ctx) {
  const names = [];
  for (const obj of parseArray(node)) {
    const name = parseInput(obj, info, option, ctx);
    if (name) names.push(name);
  }
  return names;
}
function parseResRef(node, info, ctx) {
  for (const obj of parseArray(node)) if (isString(obj)) info.refs.push({
    file: ctx.file,
    location: obj,
    type: "interface.resource",
    target: obj.value
  });
}
function parseInputRef(node, info, option, names, ctx) {
  if (isString(node)) for (const [name, re] of names) for (const occur of node.value.matchAll(re)) info.refs.push({
    file: ctx.file,
    location: node,
    type: "interface.input",
    target: name,
    option,
    offset: occur.index
  });
  else if (node.type === "array") for (const obj of parseArray(node)) parseInputRef(obj, info, option, names, ctx);
  else if (node.type === "object") for (const [, obj] of parseObject(node)) parseInputRef(obj, info, option, names, ctx);
}
function parseOptionSec(node, info, option, ctx) {
  let type = void 0;
  let inputNames = [];
  let overrideNode = null;
  for (const [key, obj] of parseObject(node)) switch (key) {
    case "controller":
      parseCtrlRef(obj, info, ctx);
      break;
    case "resource":
      parseResRef(obj, info, ctx);
      break;
    case "type":
      if (isString(obj)) {
        if ([
          "select",
          "checkbox",
          "switch",
          "input"
        ].includes(obj.value)) type = obj.value;
      }
      break;
    case "cases":
      parseCases(obj, info, option, ctx);
      break;
    case "inputs":
      inputNames = parseInputs(obj, info, option, ctx);
      break;
    case "pipeline_override":
      overrideNode = obj;
      break;
    case "default_case":
      if (isString(obj)) info.refs.push({
        file: ctx.file,
        location: obj,
        type: "interface.case",
        target: obj.value,
        option
      });
      else for (const sub of parseArray(obj)) if (isString(sub)) info.refs.push({
        file: ctx.file,
        location: sub,
        type: "interface.case",
        target: sub.value,
        option
      });
      break;
  }
  if (overrideNode) {
    const names = [];
    for (const name of inputNames) names.push([name, new RegExp("\\{" + name + "\\}", "g")]);
    parseInputRef(overrideNode, info, option, names, ctx);
    parseOverride(overrideNode, info, ctx);
  }
  return type;
}
function parseOption(node, info, ctx) {
  for (const [key, obj, prop] of parseObject(node)) {
    const type = parseOptionSec(obj, info, key, ctx);
    info.decls.push({
      file: ctx.file,
      location: prop,
      type: "interface.option",
      name: key,
      optionType: type
    });
  }
}
function parseSingle(node, info, ctx) {
  if (isString(node)) {
    let target = node.value;
    if (target.startsWith("{PROJECT_DIR}")) target = target.substring(14);
    info.refs.push({
      file: ctx.file,
      location: node,
      type: "interface.resource_path",
      target
    });
    return target;
  } else return "";
}
function parsePath(node, info, ctx) {
  const result = [];
  if (node.type !== "array") result.push(parseSingle(node, info, ctx));
  else for (const obj of parseArray(node)) result.push(parseSingle(obj, info, ctx));
  return result.filter((res) => res !== "");
}
function parsePresetOption(node, info, ctx, name) {
  for (const [key, obj, prop] of parseObjectFlex(node)) {
    info.refs.push({
      file: ctx.file,
      location: prop,
      type: "interface.option",
      target: key,
      trace: {
        name: key,
        from: "preset",
        origin: name
      },
      preset: obj ?? void 0
    });
    if (!obj) continue;
    if (isString(obj)) info.refs.push({
      file: ctx.file,
      location: obj,
      type: "interface.case",
      option: key,
      target: obj.value
    });
    else if (obj.type === "array") {
      for (const val of parseArray(obj)) if (isString(val)) info.refs.push({
        file: ctx.file,
        location: val,
        type: "interface.case",
        target: val.value,
        option: key
      });
    } else for (const [inputKey, _2, inputProp] of parseObjectFlex(obj)) info.refs.push({
      file: ctx.file,
      location: inputProp,
      type: "interface.input",
      target: inputKey,
      option: key
    });
  }
}
function parsePresetTask(node, info, ctx) {
  let name = "";
  for (const [key, obj] of parseObject(node)) switch (key) {
    case "name":
      if (isString(obj)) {
        name = obj.value;
        info.refs.push({
          file: ctx.file,
          location: obj,
          type: "interface.task",
          target: obj.value
        });
      }
      break;
  }
  for (const [key, obj] of parseObject(node)) switch (key) {
    case "option":
      parsePresetOption(obj, info, ctx, name);
      break;
  }
}
function parsePresetSingle(node, info, ctx) {
  for (const [key, obj] of parseObject(node)) switch (key) {
    case "name":
      if (isString(obj)) info.decls.push({
        file: ctx.file,
        location: obj,
        type: "interface.preset",
        name: obj.value
      });
      break;
    case "task":
      for (const sub of parseArray(obj)) parsePresetTask(sub, info, ctx);
  }
}
function parsePreset(node, info, ctx) {
  for (const obj of parseArray(node)) parsePresetSingle(obj, info, ctx);
}
function parseController(node, info, ctx) {
  let loc = null;
  const decl = {
    type: "interface.controller",
    name: "",
    attachs: []
  };
  for (const [key, obj] of parseObject(node)) switch (key) {
    case "name":
      if (isString(obj)) {
        loc = obj;
        decl.name = obj.value;
      }
      break;
    case "attach_resource_path":
      decl.attachs = parsePath(obj, info, ctx);
      break;
  }
  for (const [key, obj] of parseObject(node)) switch (key) {
    case "option":
      parseOptionRef(obj, info, ctx, {
        from: "controller",
        origin: decl.name
      });
      break;
  }
  if (loc) info.decls.push({
    file: ctx.file,
    location: loc,
    ...decl
  });
}
function parseResource(node, info, ctx) {
  let loc = null;
  const decl = {
    type: "interface.resource",
    name: "",
    paths: []
  };
  for (const [key, obj] of parseObject(node)) switch (key) {
    case "name":
      if (isString(obj)) {
        loc = obj;
        decl.name = obj.value;
      }
      break;
    case "path":
      decl.paths = parsePath(obj, info, ctx);
      break;
    case "controller":
      decl.controller = parseCtrlRef(obj, info, ctx);
      break;
  }
  for (const [key, obj] of parseObject(node)) switch (key) {
    case "option":
      parseOptionRef(obj, info, ctx, {
        from: "resource",
        origin: decl.name
      });
      break;
  }
  if (loc) info.decls.push({
    file: ctx.file,
    location: loc,
    ...decl
  });
}
function parseTaskSec(node, info, ctx) {
  let name = "";
  for (const [key, obj] of parseObject(node)) switch (key) {
    case "name":
      if (isString(obj)) {
        name = obj.value;
        info.decls.push({
          file: ctx.file,
          location: obj,
          type: "interface.task",
          name: obj.value
        });
      }
      break;
    case "group":
      for (const sub of parseArray(obj)) if (isString(sub)) info.refs.push({
        file: ctx.file,
        location: sub,
        type: "interface.group",
        target: sub.value
      });
      break;
    case "resource":
      parseResRef(obj, info, ctx);
      break;
    case "controller":
      parseCtrlRef(obj, info, ctx);
      break;
    case "pipeline_override":
      parseOverride(obj, info, ctx);
      break;
  }
  for (const [key, obj] of parseObject(node)) switch (key) {
    case "entry":
      if (isString(obj)) {
        info.refs.push({
          file: ctx.file,
          location: obj,
          type: "interface.task_entry",
          target: obj.value,
          task: name
        });
        info.layer.extraRefs.push({
          file: ctx.file,
          location: obj,
          type: "task.entry",
          target: obj.value
        });
      }
      break;
    case "option":
      parseOptionRef(obj, info, ctx, {
        from: "task",
        origin: name
      });
      break;
  }
}
function parseLocalization(node, info, ctx) {
  if (node.type === "object") for (const [key, obj] of parseObject(node)) if (locKeys.includes(key) && isString(obj)) {
    if (obj.value.startsWith("$")) info.layer.extraRefs.push({
      file: ctx.file,
      location: obj,
      type: "task.locale",
      target: obj.value.substring(1)
    });
    else if (obj.value.length > 0) info.layer.extraRefs.push({
      file: ctx.file,
      location: obj,
      type: "task.can_locale",
      target: obj.value
    });
  } else parseLocalization(obj, info, ctx);
  else if (node.type === "array") for (const obj of parseArray(node)) parseLocalization(obj, info, ctx);
}
function parseInterface(node, info, ctx) {
  for (const [key, obj] of parseObject(node)) {
    if (ctx.import && ![
      "option",
      "task",
      "preset"
    ].includes(key)) continue;
    switch (key) {
      case "languages":
        parseLanguage(obj, info, ctx);
        break;
      case "controller":
        for (const sub of parseArray(obj)) parseController(sub, info, ctx);
        break;
      case "resource":
        for (const sub of parseArray(obj)) parseResource(sub, info, ctx);
        break;
      case "group":
        for (const sub of parseArray(obj)) parseGroup(sub, info, ctx);
        break;
      case "task":
        for (const sub of parseArray(obj)) parseTaskSec(sub, info, ctx);
        break;
      case "option":
        parseOption(obj, info, ctx);
        break;
      case "global_option":
        parseOptionRef(obj, info, ctx, {
          from: "global",
          origin: ""
        });
        break;
      case "import":
        for (const sub of parseArray(obj)) parseImport(sub, info, ctx);
        break;
      case "preset":
        parsePreset(obj, info, ctx);
        break;
    }
  }
  parseLocalization(node, info, ctx);
}
var LanguageBundle = class extends import_node_events.default {
  loader;
  watcher;
  root;
  langs;
  constructor(loader, watcher, root) {
    super();
    this.loader = loader;
    this.watcher = watcher;
    this.root = root;
    this.langs = [];
  }
  stop() {
    for (const lang of this.langs) lang.content.stop();
  }
  async flush() {
    await Promise.all(this.langs.map((lang) => lang.content.flush()));
  }
  async update(config) {
    if (JSON.stringify(this.langs.map((info) => [info.name, info.file])) === JSON.stringify(config)) return true;
    this.stop();
    this.langs = config.map(([name, file], idx) => ({
      name,
      file,
      content: new ContentJson(this.loader, this.watcher, joinPath2(this.root, file), async () => {
        await this.rebuildIndex(idx);
      }),
      entries: [],
      decls: [],
      refs: []
    }));
    await Promise.all(this.langs.map((lang) => lang.content.load()));
  }
  async rebuildIndex(idx) {
    const lang = this.langs[idx];
    const full = joinPath2(this.root, lang.file);
    lang.entries = [];
    lang.decls = [];
    lang.refs = [];
    for (const [key, obj, prop] of parseObject(lang.content.node)) if (isString(obj)) {
      lang.entries.push({
        key,
        keyNode: prop,
        value: obj.value,
        valueNode: obj
      });
      lang.decls.push({
        location: prop,
        file: full,
        type: "task.locale",
        key,
        value: obj.value,
        valueNode: obj
      });
      lang.refs.push({
        location: obj,
        file: full,
        type: "task.locale_text",
        target: obj.value
      });
    }
    this.emit("localeChanged");
  }
  allKeys() {
    const keys = this.langs.map((lang) => lang.entries.map((entry) => entry.key)).flat();
    return [...new Set(keys)];
  }
  queryName(name) {
    const idx = this.langs.findIndex((lang) => lang.name === name);
    return idx === -1 ? 0 : idx;
  }
  queryKey(key) {
    const result = [];
    for (const lang of this.langs) {
      const info = lang.entries.find((info2) => info2.key === key);
      result.push(info ?? null);
    }
    return result;
  }
  addPair(key, value, indent = "    ") {
    const keys = this.allKeys();
    if (keys.includes(key)) return [];
    const row = JSON.stringify(key) + ": " + JSON.stringify(value);
    const result = [];
    if (keys.length === 0) return this.langs.map((lang) => {
      return {
        type: "replace",
        file: joinPath2(this.root, lang.file),
        content: `{
${indent}${row},
}
`
      };
    });
    else {
      let insertIndex = keys.findIndex((val) => val.localeCompare(key) > 0);
      if (insertIndex === -1) insertIndex = keys.length;
      const upper = keys.slice(0, insertIndex);
      const lower = keys.slice(insertIndex);
      for (const lang of this.langs) {
        let found = false;
        for (const upKey of upper.toReversed()) {
          const anchor = lang.entries.find((entry) => entry.key === upKey);
          if (!anchor) continue;
          result.push({
            type: "insert",
            file: joinPath2(this.root, lang.file),
            content: `,
${indent}${row}`,
            offset: anchor.valueNode.offset + anchor.valueNode.length
          });
          found = true;
          break;
        }
        if (found) continue;
        for (const loKey of lower) {
          const anchor = lang.entries.find((entry) => entry.key === loKey);
          if (!anchor) continue;
          result.push({
            type: "insert",
            file: joinPath2(this.root, lang.file),
            content: `${row},
${indent}`,
            offset: anchor.keyNode.offset
          });
          found = true;
          break;
        }
        if (found) continue;
        result.push({
          type: "replace",
          file: joinPath2(this.root, lang.file),
          content: `{
${indent}${row},
}
`
        });
      }
    }
    return result;
  }
};
var MaaEvalDelegateImpl = class extends x2 {
  intBundle;
  constructor(intBundle) {
    super(new b());
    this.intBundle = intBundle;
  }
  query(task) {
    const topLayer = this.intBundle.topLayer;
    if (!topLayer) return [];
    const infos = topLayer.getTask(task, false);
    infos.reverse();
    return infos.map(({ layer, infos: infos2 }) => {
      const info = infos2[0];
      const match = /resource\/global\/(.+)\//.exec(layer.root);
      const anchor = match ? match[1] : "Official";
      return [info.obj, anchor];
    });
  }
};
var InterfaceBundle = class extends import_node_events.default {
  maa;
  root;
  file;
  parser;
  content;
  info;
  importFiles;
  imports;
  activeController;
  activeResource;
  paths;
  bundles;
  langBundle;
  eval;
  set evalErrorDelegate(delegate) {
    this.eval.error = delegate;
  }
  constructor(loader, watcher, maa2, root, file = "interface.json", parser) {
    super();
    this.maa = maa2;
    this.root = root;
    this.file = joinPath2(this.root, file);
    this.parser = parser;
    this.content = new ContentJson(loader, watcher, this.file, () => {
      this.removeFile(this.file);
      if (this.content.node) parseInterface(this.content.node, this.info, {
        maa: this.maa,
        file: this.file,
        import: false
      });
      this.emit("interfaceChanged");
    });
    this.info = {
      decls: [],
      refs: [],
      layer: new LayerInfo(loader, this.maa, this.root, "interface")
    };
    this.activeController = "";
    this.activeResource = "";
    this.paths = [];
    this.bundles = [];
    this.langBundle = new LanguageBundle(loader, watcher, this.root);
    this.importFiles = [];
    this.imports = [];
    this.eval = new MaaEvalDelegateImpl(this);
    this.on("interfaceChanged", () => {
      this.updatePaths();
      this.updateLangs();
      this.updateImports();
    });
    this.on("activeChanged", () => {
      this.updatePaths();
    });
    this.on("importChanged", async () => {
      await Promise.all(this.imports.map((content) => content.load()));
    });
    this.on("pathChanged", async () => {
      let prev = void 0;
      for (const bundle of this.bundles) {
        bundle.layer.parent = prev;
        prev = bundle.layer;
      }
      this.info.layer.parent = prev;
      await Promise.all(this.bundles.map((bundle) => bundle.load()));
      this.emit("bundleReloaded");
      this.emit("switchActiveFinished");
    });
    this.on("bundleReloaded", () => {
      for (const bundle of this.bundles) {
        bundle.on("reset", () => {
          this.emit("pipelineChanged");
        });
        bundle.on("taskChanged", () => {
          this.emit("pipelineChanged");
        });
        bundle.on("imageChanged", () => {
          this.emit("pipelineChanged");
        });
      }
    });
    this.langBundle.on("localeChanged", () => {
      const restDecls = this.info.layer.extraDecls.filter((decl) => decl.type !== "task.locale");
      this.info.layer.extraDecls = [...restDecls, ...this.langBundle.langs.map((lang) => lang.decls).flat()];
      const restRefs = this.info.layer.extraRefs.filter((ref) => ref.type !== "task.locale_text");
      this.info.layer.extraRefs = [...restRefs, ...this.langBundle.langs.map((lang) => lang.refs).flat()];
      this.emit("localeChanged");
    });
  }
  async load() {
    await this.content.load();
  }
  stop() {
    this.content.stop();
    for (const bundle of this.bundles) bundle.stop();
  }
  async flush(flushBundles = false) {
    await this.content.flush();
    for (const imp of this.imports) await imp.flush();
    await this.langBundle.flush();
    if (flushBundles) await Promise.all(this.bundles.map((bundle) => bundle.flush()));
  }
  async updateParser(parser) {
    this.parser = parser;
    await this.load();
    for (const bundle of this.bundles) {
      bundle.parser = parser;
      await bundle.load();
    }
  }
  switchActive(controller, resource) {
    this.activeController = controller;
    this.activeResource = resource;
    const pro = new Promise((resolve) => {
      this.once("switchActiveFinished", resolve);
    });
    this.emit("activeChanged");
    return pro;
  }
  allControllerNames(onlyWithAttaches = false) {
    return this.info.decls.filter((decl) => decl.type === "interface.controller").filter(onlyWithAttaches ? (decl) => decl.attachs.length > 0 : () => true).map((info) => info.name);
  }
  allResourceNames(checkController = "") {
    return this.info.decls.filter((decl) => decl.type === "interface.resource").filter(checkController ? (decl) => !decl.controller || decl.controller.includes(checkController) : () => true).map((info) => info.name);
  }
  updatePaths() {
    const ctrlInfo = this.info.decls.filter((decl) => decl.type === "interface.controller").find((info) => info.name === this.activeController);
    const resInfo = this.info.decls.filter((decl) => decl.type === "interface.resource").find((info) => info.name === this.activeResource);
    const finalPaths = [];
    if (resInfo) finalPaths.push(...resInfo.paths);
    if (ctrlInfo) finalPaths.push(...ctrlInfo.attachs);
    if (finalPaths.length > 0) {
      if (JSON.stringify(this.paths) === JSON.stringify(finalPaths)) {
        this.emit("switchActiveFinished");
        return;
      }
      for (const content of this.imports) content.stop();
      for (const bundle of this.bundles) bundle.stop();
      this.paths = finalPaths;
      this.bundles = this.paths.map((dir) => {
        return new Bundle(this.content.loader, this.content.watcher, this.maa, path5.join(this.root, dir), this.parser);
      });
    } else {
      for (const bundle of this.bundles) bundle.stop();
      this.paths = [];
      this.bundles = [];
    }
    this.emit("pathChanged");
  }
  updateLangs() {
    const newFiles = this.info.decls.filter((decl) => decl.type === "interface.language").map((info) => [info.name, info.path]);
    this.langBundle.update(newFiles).then(() => {
      this.emit("localeChanged");
    });
  }
  removeFile(file) {
    this.info.decls = this.info.decls.filter((decl) => decl.file !== file);
    this.info.refs = this.info.refs.filter((ref) => ref.file !== file);
    this.info.layer.removeFile(file);
  }
  updateImports() {
    const newFiles = this.info.refs.filter((ref) => ref.type === "interface.import_path").map((info) => info.target);
    if (JSON.stringify(this.importFiles) === JSON.stringify(newFiles)) return;
    this.info.decls = this.info.decls.filter((decl) => decl.file === this.file);
    this.info.refs = this.info.refs.filter((ref) => ref.file === this.file);
    for (const content of this.imports) {
      content.stop();
      this.info.layer.removeFile(content.file);
    }
    this.importFiles = newFiles;
    this.imports = newFiles.map((file) => {
      const full = joinPath2(this.root, file);
      return new ContentJson(this.content.loader, this.content.watcher, full, (node) => {
        this.removeFile(full);
        if (node) parseInterface(node, this.info, {
          maa: this.maa,
          file: full,
          import: true
        });
        this.emit("slaveInterfaceChanged");
      });
    });
    this.emit("importChanged");
  }
  locateLayer(file) {
    const rel = relativePath(this.root, file).replaceAll(path5.sep, "/");
    if (file === this.file || this.importFiles.includes(rel) || this.langBundle.langs.find((lang) => lang.file === rel)) return [
      this.info.layer,
      file,
      false
    ];
    else for (const bundle of this.bundles) {
      if (file.startsWith(joinPath2(bundle.root, this.maa ? "tasks" : "pipeline"))) return [
        bundle.layer,
        file,
        false
      ];
      if (file === bundle.defaultPipelinePath) return [
        bundle.layer,
        file,
        true
      ];
    }
    return null;
  }
  get allLayers() {
    const layers = this.bundles.map((bundle) => bundle.layer);
    layers.push(this.info.layer);
    return layers;
  }
  get topLayer() {
    return this.info.layer;
  }
  evalTask(task) {
    return this.topLayer.evalTask(task);
  }
  maaEvalTask(task) {
    if (!this.maa) return null;
    const result = new S(this.eval).evalTask(task);
    if (result) delete result.task.__baseTaskResolved;
    return result;
  }
  maaEvalExpr(expr, self, strip) {
    if (!this.maa) return null;
    return new S(this.eval).evalExpr(expr, self, strip);
  }
};

// dist/mse.js
var INTERFACE_CANDIDATES = [
  "interface.json",
  "interface.jsonc",
  "assets/interface.json",
  "assets/interface.jsonc"
];
var MAX_SCANNED_FILES = 1e4;
var MAX_CONFIGURATIONS = 256;
var MAX_DIAGNOSTICS = 500;
var MAX_TASK_RESOLUTION_CONFIGURATIONS = 64;
var CONFINEMENT_ERROR = "MSE project access escaped the configured project root.";
var NO_ACTIVE_RESOURCE_PATH_WARNING = "No activated MSE resource paths were readable.";
var ProjectRootConfinement = class {
  root;
  rootReal;
  violations = 0;
  constructor(projectRoot) {
    this.root = import_node_path5.default.resolve(projectRoot);
    this.rootReal = (0, import_promises6.realpath)(this.root);
  }
  recordViolation() {
    this.violations += 1;
  }
  assertNoViolations() {
    if (this.violations > 0) {
      throw new Error(CONFINEMENT_ERROR);
    }
  }
  async isAllowed(target) {
    const resolved = import_node_path5.default.resolve(target);
    if (!this.isContained(this.root, resolved)) {
      this.recordViolation();
      return false;
    }
    const targetReal = await this.realpathExistingTargetOrAncestor(resolved);
    if (targetReal === null) {
      this.recordViolation();
      return false;
    }
    let rootReal;
    try {
      rootReal = await this.rootReal;
    } catch {
      this.recordViolation();
      return false;
    }
    if (!this.isContained(rootReal, targetReal)) {
      this.recordViolation();
      return false;
    }
    return true;
  }
  async realpathExistingTargetOrAncestor(target) {
    let current = target;
    while (this.isContained(this.root, current)) {
      try {
        return await (0, import_promises6.realpath)(current);
      } catch (error) {
        if (!["ENOENT", "ENOTDIR"].includes(errorCode(error) ?? ""))
          return null;
        const parent = import_node_path5.default.dirname(current);
        if (parent === current)
          return null;
        current = parent;
      }
    }
    return null;
  }
  isContained(root, target) {
    const relative2 = import_node_path5.default.relative(root, target);
    return relative2.length === 0 || !relative2.startsWith("..") && !import_node_path5.default.isAbsolute(relative2);
  }
};
var MseResourceAccessRecorder = class {
  projectRoot;
  issues = /* @__PURE__ */ new Map();
  expectedFiles = /* @__PURE__ */ new Set();
  constructor(projectRoot) {
    this.projectRoot = projectRoot;
  }
  get hasIssues() {
    return this.issues.size > 0;
  }
  recordMissingRoot(target) {
    this.record(target, "Configured MSE resource root is missing: ");
  }
  recordNonDirectoryRoot(target) {
    this.record(target, "Configured MSE resource root is not a directory: ");
  }
  recordUnreadableRoot(target) {
    this.record(target, "Configured MSE resource root is unreadable: ");
  }
  recordExpectedFile(target) {
    this.expectedFiles.add(import_node_path5.default.resolve(target));
  }
  recordMissingFile(target) {
    this.record(target, "Configured MSE project file is missing: ");
  }
  recordNonFile(target) {
    this.record(target, "Configured MSE project file is not a file: ");
  }
  recordUnreadableFile(target) {
    this.record(target, "Configured MSE project file is unreadable: ");
  }
  recordUnavailableFile(target) {
    if (!this.expectedFiles.has(import_node_path5.default.resolve(target)))
      return;
    this.record(target, "MSE project file was unavailable during read: ");
  }
  warnings() {
    return [...this.issues.values()].sort();
  }
  record(target, prefix) {
    this.issues.set(prefix + import_node_path5.default.resolve(target), prefix + relativeSourcePath(this.projectRoot, target) + ".");
  }
};
var ConfinedContentLoader = class {
  confinement;
  accessRecorder;
  inner = new FsContentLoader();
  constructor(confinement, accessRecorder) {
    this.confinement = confinement;
    this.accessRecorder = accessRecorder;
  }
  async get(file) {
    if (!await this.confinement.isAllowed(file))
      return null;
    try {
      const content = await this.inner.get(file);
      if (content === null)
        this.accessRecorder.recordUnavailableFile(file);
      return content;
    } catch {
      this.accessRecorder.recordUnavailableFile(file);
      return null;
    }
  }
};
var ReadOnlySnapshotWatcher = class {
  confinement;
  accessRecorder;
  scannedFiles = 0;
  constructor(confinement, accessRecorder) {
    this.confinement = confinement;
    this.accessRecorder = accessRecorder;
  }
  async watch(root, isFile2, delegate) {
    if (!await this.confinement.isAllowed(root)) {
      return { stop() {
      } };
    }
    if (isFile2) {
      const rootStatus = await fileScanStatus(root);
      if (rootStatus === "missing") {
        this.accessRecorder.recordMissingFile(root);
      } else if (rootStatus === "not_file") {
        this.accessRecorder.recordNonFile(root);
      } else if (rootStatus === "unreadable") {
        this.accessRecorder.recordUnreadableFile(root);
      } else {
        this.accessRecorder.recordExpectedFile(root);
      }
      return { stop() {
      } };
    }
    if (!isFile2) {
      const rootStatus = await directoryScanStatus(root);
      if (rootStatus === "missing") {
        this.accessRecorder.recordMissingRoot(root);
        return { stop() {
        } };
      }
      if (rootStatus === "not_directory") {
        this.accessRecorder.recordNonDirectoryRoot(root);
        return { stop() {
        } };
      }
      if (rootStatus === "unreadable") {
        this.accessRecorder.recordUnreadableRoot(root);
        return { stop() {
        } };
      }
      this.scannedFiles = 0;
      await this.scanDirectory(import_node_path5.default.resolve(root), delegate);
    }
    return { stop() {
    } };
  }
  async scanDirectory(directory, delegate) {
    if (!await this.confinement.isAllowed(directory))
      return;
    if (!delegate.filter(directory, true))
      return;
    let entries;
    try {
      entries = await (0, import_promises6.readdir)(directory, { withFileTypes: true });
    } catch {
      this.accessRecorder.recordUnreadableRoot(directory);
      return;
    }
    for (const entry of entries) {
      const target = import_node_path5.default.join(directory, entry.name);
      if (!await this.confinement.isAllowed(target))
        continue;
      if (entry.isDirectory()) {
        await this.scanDirectory(target, delegate);
      } else if (entry.isFile() && delegate.filter(target, false)) {
        this.scannedFiles += 1;
        if (this.scannedFiles > MAX_SCANNED_FILES) {
          throw new Error("MSE project scan exceeded " + MAX_SCANNED_FILES + " files.");
        }
        this.accessRecorder.recordExpectedFile(target);
        delegate.fileAdded(target);
      }
    }
  }
};
var isFile = async (target, confinement) => {
  try {
    if (confinement !== void 0 && !await confinement.isAllowed(target))
      return false;
    const targetStat = await (0, import_promises6.stat)(target);
    return targetStat.isFile();
  } catch {
    return false;
  }
};
var directoryScanStatus = async (target) => {
  try {
    const targetStat = await (0, import_promises6.stat)(target);
    return targetStat.isDirectory() ? "directory" : "not_directory";
  } catch (error) {
    const code = errorCode(error);
    if (code === "ENOENT")
      return missingPathStatus(target, "not_directory");
    if (code === "ENOTDIR")
      return "not_directory";
    return "unreadable";
  }
};
var fileScanStatus = async (target) => {
  try {
    const targetStat = await (0, import_promises6.stat)(target);
    return targetStat.isFile() ? "file" : "not_file";
  } catch (error) {
    const code = errorCode(error);
    if (code === "ENOENT")
      return missingPathStatus(target, "not_file");
    if (code === "ENOTDIR")
      return "not_file";
    return "unreadable";
  }
};
var missingPathStatus = async (target, blockedByFileStatus) => {
  let current = import_node_path5.default.dirname(import_node_path5.default.resolve(target));
  while (true) {
    try {
      const currentStat = await (0, import_promises6.stat)(current);
      return currentStat.isDirectory() ? "missing" : blockedByFileStatus;
    } catch (error) {
      const code = errorCode(error);
      if (code !== "ENOENT" && code !== "ENOTDIR")
        return "unreadable";
      const parent = import_node_path5.default.dirname(current);
      if (parent === current)
        return "missing";
      current = parent;
    }
  }
};
var isDirectory = async (target, confinement) => {
  try {
    if (confinement !== void 0 && !await confinement.isAllowed(target))
      return false;
    const targetStat = await (0, import_promises6.stat)(target);
    return targetStat.isDirectory();
  } catch {
    return false;
  }
};
var errorCode = (error) => {
  return isRecord(error) && typeof error["code"] === "string" ? error["code"] : void 0;
};
var isAbsoluteOnSupportedPlatform = (target) => {
  return import_node_path5.default.posix.isAbsolute(target) || import_node_path5.default.win32.isAbsolute(target);
};
var assertInterfacePathsAreRelative = (bundle) => {
  for (const ref of bundle.info.refs) {
    if (ref.type === "interface.resource_path" || ref.type === "interface.import_path" || ref.type === "interface.language_path") {
      if (isAbsoluteOnSupportedPlatform(ref.target)) {
        throw new Error(CONFINEMENT_ERROR);
      }
    }
  }
};
var findInterface = async (projectRoot, confinement) => {
  for (const relative2 of INTERFACE_CANDIDATES) {
    const candidate = import_node_path5.default.join(projectRoot, relative2);
    if (await isFile(candidate, confinement))
      return candidate;
  }
  return null;
};
var relativeSourcePath = (projectRoot, target) => {
  const relative2 = import_node_path5.default.relative(projectRoot, target);
  return relative2.length > 0 ? relative2.replaceAll(import_node_path5.default.sep, "/") : ".";
};
var lineColumn = (content, offset) => {
  const prefix = content.slice(0, Math.max(0, offset));
  const lines = prefix.split(/\r?\n/u);
  return [lines.length, (lines.at(-1)?.length ?? 0) + 1];
};
var isRecord = (value) => {
  return typeof value === "object" && value !== null && !Array.isArray(value);
};
var toJsonRecord = (value) => {
  const serialized = JSON.stringify(value);
  if (serialized === void 0)
    return {};
  const parsed = JSON.parse(serialized);
  return isRecord(parsed) ? parsed : {};
};
var taskBindings = (bundle) => {
  const entries = /* @__PURE__ */ new Map();
  for (const ref of bundle.info.refs) {
    if (ref.type === "interface.task_entry")
      entries.set(ref.task, ref.target);
  }
  return bundle.info.decls.filter((decl) => decl.type === "interface.task").map((decl) => ({
    name: decl.name,
    entry: entries.get(decl.name) ?? null
  }));
};
async function runMseProjectPreflight(targetPath, syntaxMode) {
  const projectRoot = import_node_path5.default.resolve(targetPath);
  if (!await isDirectory(projectRoot)) {
    throw new Error("MSE project path is not a directory: " + projectRoot);
  }
  const confinement = new ProjectRootConfinement(projectRoot);
  if (!await confinement.isAllowed(projectRoot)) {
    throw new Error(CONFINEMENT_ERROR);
  }
  const interfacePath = await findInterface(projectRoot, confinement);
  confinement.assertNoViolations();
  const base = {
    schema_version: "mde-mse-project-preflight/v2",
    project_root: projectRoot,
    syntax_mode: syntaxMode
  };
  if (interfacePath === null) {
    return {
      ...base,
      interface_path: null,
      compatibility: {
        status: "unsupported",
        reason: "No conventional interface.json or interface.jsonc was found."
      },
      controllers: [],
      resources: [],
      task_bindings: [],
      configurations: [],
      configurations_truncated: false,
      diagnostics: [],
      diagnostics_truncated: false,
      warnings: []
    };
  }
  const accessRecorder = new MseResourceAccessRecorder(projectRoot);
  const loader = new ConfinedContentLoader(confinement, accessRecorder);
  const watcher = new ReadOnlySnapshotWatcher(confinement, accessRecorder);
  const bundle = new InterfaceBundle(loader, watcher, syntaxMode === "maa", import_node_path5.default.dirname(interfacePath), import_node_path5.default.basename(interfacePath));
  const diagnostics = [];
  const configurations = [];
  const fileContents = /* @__PURE__ */ new Map();
  const locate = async (file, offset) => {
    let content = fileContents.get(file);
    if (content === void 0) {
      const loadedContent = await loader.get(file);
      confinement.assertNoViolations();
      if (loadedContent === null) {
        throw new Error("MSE project file content is unavailable.");
      }
      content = loadedContent;
      fileContents.set(file, content);
    }
    return lineColumn(content, offset);
  };
  try {
    await bundle.load();
    confinement.assertNoViolations();
    assertInterfacePathsAreRelative(bundle);
    await bundle.flush(false);
    confinement.assertNoViolations();
    assertInterfacePathsAreRelative(bundle);
    const controllers = [...new Set(bundle.allControllerNames())];
    const resources = [...new Set(bundle.allResourceNames())];
    const controllerChoices = controllers.length > 0 ? controllers : [null];
    let configurationsTruncated = false;
    configurationLoop: for (const controller of controllerChoices) {
      const compatibleResources = [
        ...new Set(bundle.allResourceNames(controller ?? ""))
      ];
      const resourceChoices = compatibleResources.length > 0 ? compatibleResources : [null];
      for (const resource of resourceChoices) {
        if (configurations.length >= MAX_CONFIGURATIONS) {
          configurationsTruncated = true;
          break configurationLoop;
        }
        await bundle.switchActive(controller ?? "", resource ?? "");
        confinement.assertNoViolations();
        await bundle.flush(true);
        confinement.assertNoViolations();
        const rawDiagnostics = performDiagnostic(bundle, {});
        const counts = { error: 0, warning: 0 };
        for (const diagnostic of rawDiagnostics) {
          counts[diagnostic.level] += 1;
          if (diagnostics.length >= MAX_DIAGNOSTICS)
            continue;
          const [start, , message] = await buildDiagnosticMessage(bundle.root, diagnostic, locate, {});
          diagnostics.push({
            type: diagnostic.type,
            level: diagnostic.level,
            source_path: relativeSourcePath(projectRoot, diagnostic.file),
            line: start[0],
            column: start[1],
            length: diagnostic.length,
            message,
            controller,
            resource
          });
        }
        const pipelineFiles = new Set(bundle.bundles.flatMap((resourceBundle) => Object.keys(resourceBundle.files).map((file) => import_node_path5.default.join(resourceBundle.root, file))));
        configurations.push({
          controller,
          resource,
          resource_paths: bundle.paths.map((item) => item.replaceAll(import_node_path5.default.sep, "/")),
          task_count: bundle.topLayer.getTaskList().length,
          pipeline_file_count: pipelineFiles.size,
          diagnostic_count: rawDiagnostics.length,
          error_count: counts.error,
          warning_count: counts.warning
        });
      }
    }
    const warnings = [];
    const diagnosticsTruncated = configurations.reduce((total, item) => total + item.diagnostic_count, 0) > diagnostics.length;
    if (diagnosticsTruncated) {
      warnings.push("Diagnostics were truncated at " + MAX_DIAGNOSTICS + " records.");
    }
    if (configurationsTruncated) {
      warnings.push("Controller/resource configurations were truncated at " + MAX_CONFIGURATIONS + " records.");
    }
    const hasConfigurations = configurations.some((item) => item.resource_paths.length > 0);
    if (!hasConfigurations) {
      warnings.push(NO_ACTIVE_RESOURCE_PATH_WARNING);
    }
    warnings.push(...accessRecorder.warnings());
    const fullyLoadedConfigurations = hasConfigurations && !accessRecorder.hasIssues;
    return {
      ...base,
      interface_path: relativeSourcePath(projectRoot, interfacePath),
      compatibility: {
        status: fullyLoadedConfigurations ? "supported" : "partial",
        reason: fullyLoadedConfigurations ? "The interface and at least one resource configuration were loaded." : hasConfigurations ? "The interface loaded, but one or more activated resource paths could not be fully scanned." : "The interface loaded, but no resource paths were activated."
      },
      controllers,
      resources,
      task_bindings: taskBindings(bundle),
      configurations,
      configurations_truncated: configurationsTruncated,
      diagnostics,
      diagnostics_truncated: diagnosticsTruncated,
      warnings
    };
  } finally {
    bundle.stop();
  }
}
async function resolveTask(bundle, projectRoot, name, controller, resource, locate) {
  const groups = bundle.topLayer.getTask(name);
  const definitions = [];
  const references = [];
  for (const group of groups) {
    for (const info of group.infos) {
      const definitionPosition = await locate(info.file, info.prop.offset);
      definitions.push({
        source_path: relativeSourcePath(projectRoot, info.file),
        line: definitionPosition[0],
        column: definitionPosition[1],
        raw_config: toJsonRecord(info.obj)
      });
      for (const reference of info.info.refs) {
        if (!("target" in reference) || typeof reference.target !== "string")
          continue;
        const referencePosition = await locate(reference.file, reference.location.offset);
        references.push({
          kind: reference.type,
          target: reference.target,
          source_path: relativeSourcePath(projectRoot, reference.file),
          line: referencePosition[0],
          column: referencePosition[1]
        });
      }
    }
  }
  return {
    name,
    controller,
    resource,
    found: definitions.length > 0,
    definitions,
    effective_config: definitions.length > 0 ? toJsonRecord(bundle.topLayer.evalTask(name)) : {},
    references
  };
}
async function runMseTaskResolution(targetPath, requestedTasks, syntaxMode, requestedController, requestedResource) {
  const tasks = [...new Set(requestedTasks.map((item) => item.trim()))].filter((item) => item.length > 0);
  if (tasks.length === 0) {
    throw new Error("MSE task resolution requires at least one task name.");
  }
  const projectRoot = import_node_path5.default.resolve(targetPath);
  if (!await isDirectory(projectRoot)) {
    throw new Error("MSE project path is not a directory: " + projectRoot);
  }
  const confinement = new ProjectRootConfinement(projectRoot);
  if (!await confinement.isAllowed(projectRoot)) {
    throw new Error(CONFINEMENT_ERROR);
  }
  const interfacePath = await findInterface(projectRoot, confinement);
  confinement.assertNoViolations();
  if (interfacePath === null) {
    return {
      schema_version: "mde-mse-task-resolution/v2",
      project_root: projectRoot,
      interface_path: null,
      syntax_mode: syntaxMode,
      compatibility: {
        status: "unsupported",
        reason: "No conventional interface.json or interface.jsonc was found."
      },
      requested_tasks: tasks,
      resolutions: [],
      configurations_truncated: false,
      warnings: []
    };
  }
  const accessRecorder = new MseResourceAccessRecorder(projectRoot);
  const loader = new ConfinedContentLoader(confinement, accessRecorder);
  const watcher = new ReadOnlySnapshotWatcher(confinement, accessRecorder);
  const bundle = new InterfaceBundle(loader, watcher, syntaxMode === "maa", import_node_path5.default.dirname(interfacePath), import_node_path5.default.basename(interfacePath));
  const fileContents = /* @__PURE__ */ new Map();
  const locate = async (file, offset) => {
    let content = fileContents.get(file);
    if (content === void 0) {
      const loadedContent = await loader.get(file);
      confinement.assertNoViolations();
      if (loadedContent === null) {
        throw new Error("MSE project file content is unavailable.");
      }
      content = loadedContent;
      fileContents.set(file, content);
    }
    return lineColumn(content, offset);
  };
  const resolutions = [];
  let configurationsTruncated = false;
  let configurationCount = 0;
  let hasActivatedResourcePaths = false;
  try {
    await bundle.load();
    confinement.assertNoViolations();
    assertInterfacePathsAreRelative(bundle);
    await bundle.flush(false);
    confinement.assertNoViolations();
    assertInterfacePathsAreRelative(bundle);
    const controllers = requestedController === void 0 ? [...new Set(bundle.allControllerNames())] : [requestedController];
    const controllerChoices = controllers.length > 0 ? controllers : [null];
    configurationLoop: for (const controller of controllerChoices) {
      const resources = requestedResource === void 0 ? [...new Set(bundle.allResourceNames(controller ?? ""))] : [requestedResource];
      const resourceChoices = resources.length > 0 ? resources : [null];
      for (const resource of resourceChoices) {
        if (configurationCount >= MAX_TASK_RESOLUTION_CONFIGURATIONS) {
          configurationsTruncated = true;
          break configurationLoop;
        }
        configurationCount += 1;
        await bundle.switchActive(controller ?? "", resource ?? "");
        confinement.assertNoViolations();
        if (bundle.paths.length > 0)
          hasActivatedResourcePaths = true;
        await bundle.flush(true);
        confinement.assertNoViolations();
        for (const task of tasks) {
          resolutions.push(await resolveTask(bundle, projectRoot, task, controller, resource, locate));
        }
      }
    }
    const warnings = [];
    if (configurationsTruncated) {
      warnings.push("Controller/resource configurations were truncated at " + MAX_TASK_RESOLUTION_CONFIGURATIONS + " records.");
    }
    if (!hasActivatedResourcePaths) {
      warnings.push(NO_ACTIVE_RESOURCE_PATH_WARNING);
    }
    warnings.push(...accessRecorder.warnings());
    const fullyLoadedConfigurations = hasActivatedResourcePaths && !accessRecorder.hasIssues;
    return {
      schema_version: "mde-mse-task-resolution/v2",
      project_root: projectRoot,
      interface_path: relativeSourcePath(projectRoot, interfacePath),
      syntax_mode: syntaxMode,
      compatibility: {
        status: fullyLoadedConfigurations ? "supported" : "partial",
        reason: fullyLoadedConfigurations ? "Requested tasks were resolved across active configurations." : hasActivatedResourcePaths ? "Requested tasks were resolved, but one or more activated resource paths could not be fully scanned." : "The interface loaded, but no resource paths were activated."
      },
      requested_tasks: tasks,
      resolutions,
      configurations_truncated: configurationsTruncated,
      warnings
    };
  } finally {
    bundle.stop();
  }
}

// dist/index.js
var tools = [
  {
    name: "mla.preflight",
    description: "Check MaaFramework log compatibility and return runtime-version sessions with source evidence."
  },
  {
    name: "mla.runtime-inspection",
    description: "Parse MaaFramework logs and return structured failures, outcomes, and recognition/repetition signals with source-mapped evidence."
  },
  {
    name: "mse.project-preflight",
    description: "Load a Maa project through public MSE packages using the caller-selected syntax_mode and return interface, resource, task, pipeline, and static diagnostic facts."
  },
  {
    name: "mse.resolve-tasks",
    description: "Resolve task definitions, effective configuration, and references using the caller-selected MSE syntax_mode."
  }
];
var success = (id, result) => ({
  id,
  apiVersion: "tool-adapter/v1",
  ok: true,
  result,
  error: null
});
var failure = (id, code, message, retryable = false, details) => ({
  id,
  apiVersion: "tool-adapter/v1",
  ok: false,
  result: null,
  error: {
    code,
    message,
    retryable,
    ...details ? { details } : {}
  }
});
var isRecord2 = (value) => {
  return typeof value === "object" && value !== null && !Array.isArray(value);
};
var isMseSyntaxMode = (value) => {
  return value === "maafw" || value === "maa";
};
async function callTool(request) {
  const toolName = request.params?.["name"];
  const toolArguments = request.params?.["arguments"];
  if (typeof toolName !== "string" || !isRecord2(toolArguments)) {
    return failure(request.id, "INVALID_TOOL_CALL", "tools/call requires string params.name and object params.arguments.");
  }
  const targetPath = toolArguments["path"];
  if (typeof targetPath !== "string" || targetPath.trim().length === 0) {
    return failure(request.id, "INVALID_TOOL_ARGUMENTS", `${toolName} requires a non-empty string arguments.path.`);
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
        return failure(request.id, "INVALID_TOOL_ARGUMENTS", "mse.project-preflight requires arguments.syntax_mode to be 'maafw' or 'maa'.");
      }
      return success(request.id, await runMseProjectPreflight(targetPath, syntaxMode));
    }
    if (toolName === "mse.resolve-tasks") {
      const tasks = toolArguments["tasks"];
      const syntaxMode = toolArguments["syntax_mode"];
      const controller = toolArguments["controller"];
      const resource = toolArguments["resource"];
      if (!Array.isArray(tasks) || tasks.length === 0 || tasks.length > 50 || !tasks.every((item) => typeof item === "string" && item.trim().length > 0) || !isMseSyntaxMode(syntaxMode) || controller !== void 0 && typeof controller !== "string" || resource !== void 0 && typeof resource !== "string") {
        return failure(request.id, "INVALID_TOOL_ARGUMENTS", "mse.resolve-tasks requires syntax_mode ('maafw' or 'maa'), 1-50 non-empty tasks, and optional string controller/resource.");
      }
      return success(request.id, await runMseTaskResolution(targetPath, tasks, syntaxMode, controller, resource));
    }
    return failure(request.id, "TOOL_NOT_FOUND", `Unknown tool: ${toolName}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return failure(request.id, "TOOL_EXECUTION_FAILED", message, false, { tool: toolName });
  }
}
async function handleRequest(request) {
  switch (request.method) {
    case "health":
      return success(request.id, { status: "ok" });
    case "tools/list":
      return success(request.id, { tools });
    case "tools/call":
      return callTool(request);
  }
}

// dist/cli.js
var isRecord3 = (value) => {
  return typeof value === "object" && value !== null && !Array.isArray(value);
};
var invalidResponse = (id, message) => ({
  id,
  apiVersion: "tool-adapter/v1",
  ok: false,
  result: null,
  error: {
    code: "INVALID_REQUEST",
    message,
    retryable: false
  }
});
var parseRequest = (value) => {
  if (!isRecord3(value))
    return null;
  const id = value["id"];
  const apiVersion = value["apiVersion"];
  const method = value["method"];
  const params = value["params"];
  if (typeof id !== "string" || apiVersion !== "tool-adapter/v1" || method !== "health" && method !== "tools/list" && method !== "tools/call" || params !== void 0 && !isRecord3(params)) {
    return null;
  }
  return {
    id,
    apiVersion,
    method,
    ...params === void 0 ? {} : { params }
  };
};
async function processJsonLine(line) {
  let value;
  try {
    value = JSON.parse(line);
  } catch {
    return JSON.stringify(invalidResponse("invalid-request", "Request is not valid JSON."));
  }
  const request = parseRequest(value);
  if (!request) {
    const id = isRecord3(value) && typeof value["id"] === "string" ? value["id"] : "invalid-request";
    return JSON.stringify(invalidResponse(id, "Request does not match tool-adapter/v1."));
  }
  return JSON.stringify(await handleRequest(request));
}
async function main2() {
  const lines = (0, import_node_readline.createInterface)({ input: process.stdin, crlfDelay: Infinity });
  for await (const line of lines) {
    if (line.trim().length === 0)
      continue;
    process.stdout.write(`${await processJsonLine(line)}
`);
  }
}
var isEntrypoint2 = () => {
  const argvPath = process.argv[1];
  return argvPath !== void 0 && void 0 === (0, import_node_url2.pathToFileURL)(import_node_path6.default.resolve(argvPath)).href;
};
if (isEntrypoint2()) {
  main2().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}
`);
    process.exitCode = 1;
  });
}

// dist/bundle.js
main2().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}
`);
  process.exitCode = 1;
});
