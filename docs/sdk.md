# MaaEvidenceKit SDK 参考

`maa-evidence-kit` npm 包的 SDK 用法与选项参考。快速上手与安装见仓库 [`README.md`](../README.md)。

## 示例

```ts
import {
  inspect,
  inspectMla,
  inspectMse,
  evidenceById,
  queryEvidenceBatch,
  queryEvidenceWindow,
  resolveMse,
  searchEvidence,
  view,
} from "maa-evidence-kit";

const runtime = await inspectMla("C:/debug", {
  timeRange: {
    from: "2026-07-19 10:00:00",
    to: "2026-07-19 10:10:00",
  },
});

const project = await inspectMse("C:/project", { tasks: ["StartUp"] });
const resolvedProject = await resolveMse("C:/project", {
  tasks: ["StartUp"],
  controller: "Adb",
  resource: "Official",
  includeReferencers: false,
});
const combined = await inspect("C:/materials");
const text = view(combined, { format: "text" });
const matches = searchEvidence(combined, {
  kinds: ["mla.recognition_detail"],
  nodes: ["DailyProtocolMissionsPick"],
  text: ["一键领取"],
  limit: 20,
});
const selectedEvidence = evidenceById(combined.evidence, "evidence-abc123");
const window = await queryEvidenceWindow(runtime, {
  evidenceId: runtime.evidence[0]?.id,
});
const answers = await queryEvidenceBatch(runtime, [
  { id: "tasks", operation: "search", query: { kinds: ["mla.task"] } },
  { id: "fact", operation: "view", evidenceId: "evidence-abc123" },
  { id: "context", operation: "window", query: { evidenceId: "evidence-abc123" } },
]);
```

## 后续追问建议

后续追问建议先从 JSON 结果中选择并引用 evidence ID,再使用 CLI 的
`view --evidence-id` 查看该条事实的完整 `data`,使用 `window --evidence-id` 查看其来源日志上下文。
`view --evidence-id` 支持 JSON 和 text;`window` 默认保持 JSON,也支持 `--format text`。
未知 evidence ID 会明确报错,不会静默返回空结果。

## 选项语义

- `inspectMla`:`timeRange`(`from` / `to`)用于按时间缩小证据范围,行为与 CLI
  `mla inspect --from/--to` 一致,限制见 [CLI 参考](cli.md)。
- `inspectMse` / `resolveMse`:`tasks`、`controller`、`resource`、`includeReferencers`。
  `includeReferencers: false` 对应 CLI `--no-referencers`,用于公共节点只取定义及前向路径时
  关闭反向引用展开;展开深度由 `depth` 控制(默认两层)。
- `inspect`(组合检查):`InspectOptions.mse.depth` / `includeReferencers` 可覆盖 SDK 默认;
  CLI 需要展开反向引用时使用 `inspect --referencers --depth N`。
- `searchEvidence` / `queryEvidenceBatch` / `queryEvidenceWindow`:与 CLI `search` / `batch` /
  `window` 命令同语义,包括精确/模糊匹配规则、结果上限与批量严格校验,见 [CLI 参考](cli.md)。
- MLA 信号穷举:设置 `includeAllSignals: true`(对应 CLI `--all-signals`),见
  [输出模型](evidence-model.md)。

## 输出模型

SDK 返回与 CLI 输出相同的 `maa-evidence/v1` 结构;各 evidence 种类、统计字段和截断语义见
[`docs/evidence-model.md`](evidence-model.md)。
