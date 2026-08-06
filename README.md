# MaaEvidenceKit

面向 MaaFramework 的确定性证据提取与诊断辅助工具包。

A deterministic evidence extraction and diagnostic toolkit for MaaFramework.

MaaEvidenceKit（MEK）从 MaaFramework 日志和 Maa 项目中提取可定位的运行时与静态事实，
供 Codex、Claude Code 等外部 harness 按需使用。MEK 不包含模型、诊断 agent 或自动修复逻辑。

## 能力边界

MEK 负责：

- 从完整材料目录中发现受支持的 MaaFramework 日志和 Maa 项目；
- 通过 MaaLogAnalyzer（MLA）提取会话、任务、故障、结果与运行信号；
- 通过 MSE 公共包提取 Interface、资源、静态诊断、任务定义和节点引用；
- 生成稳定 evidence ID，以及文件、行号、时间、任务和节点定位；
- 输出 JSON、纯文本和可选 Mermaid；
- 在明确同意后发送匿名运行遥测或提取缺口反馈。

MEK 不负责理解 GitHub Issue、GUI/自定义日志、Sentry 数据或业务结果，也不会输出根因结论。
这些工作属于调用它的 harness。

## 安装

需要 Node.js 24+ 和 pnpm。

```powershell
pnpm install
pnpm build
node dist/cli/main.js --help
```

发布后可通过 `maa-evidence` 二进制调用。

## CLI

调用方负责先解压 ZIP，再将完整文件夹交给 MEK。MEK 自行选择可由 MLA/MSE 处理的材料。
若整仓库同时包含根目录日志和 `debug` 等日志包，MLA 会逐包顺序解析并合并结果，不会把
包含 `node_modules` 的项目根目录直接交给日志加载器；单个日志包失败会记录为缺失证据。

```powershell
# 自动选择可用适配器
maa-evidence inspect C:\path\to\materials --format json --output inspection.json

# 只检查 MaaFramework 日志
maa-evidence mla inspect C:\path\to\materials --format json

# 根据 GUI/Sentry 提供的时间缩小证据范围
maa-evidence mla inspect C:\path\to\materials `
  --from "2026-07-19 10:00:00" `
  --to "2026-07-19 10:10:00" `
  --format text

# 只检查指定项目任务
maa-evidence mse inspect C:\path\to\project --task StartUp --format text

# 读取某条证据附近的原始行
maa-evidence window --input inspection.json --evidence-id evidence-abc123

# 将已有结果渲染为通用文本或 Mermaid
maa-evidence view --input inspection.json --format text
maa-evidence view --input inspection.json --format mermaid
```

MSE 未提供 `--task` 时只执行 Interface、资源组合和静态诊断预检，不自动展开项目中的
全部内部 pipeline 节点。需要节点关系时由 harness 传入相关任务名，避免无关证据和耗时膨胀。
传入 `--task` 后，MSE 会沿执行路径递归展开 `next` / `anchor` / `on_error` 等引用；
默认展开两层，可用 `--depth N` 控制深度。图中只保留执行路径边，模板、颜色、OCR 等
资源引用仍保留在 `mse.reference` evidence 中。以失败节点作为 `--task` 时，MSE 还会
反向扫描执行路径，找出哪些任务引用了该节点，便于定位“谁把流程带到失败点”。
图中节点会附带 `desc` / `recognition` / `action` / `customRecognition` /
`customAction` 摘要字段，便于在不打开完整配置的情况下判断节点职责。

当提供时间范围时，MLA 先将目录加载聚焦到匹配文件，MEK 再过滤窗口外的任务和直接事实。
当前 MLA 1.3.0 仍可能完整读取一个匹配的日志文件；输出会明确携带该限制，避免把它误解成
真正的行级流式裁剪。

MLA 默认输出其优先级为 `high` 的信号和每个任务的高亮信号，并在 `details.selection.signals`
记录完整数量与入选数量。需要穷举普通、低优先级信号时使用 `--all-signals`，SDK 则设置
`includeAllSignals: true`；筛选只依据 MLA 的通用信号语义，不包含应用项目名称或节点特判。
完整计数始终基于未裁剪的运行时，`statistics` 同时提供 `signalsTotal`、
`recognitionOccurrences`、`repeatedNodeSegments` 和
`repeatedNodeTotalRepeatCount` 及其 `*Focused` 对应值，避免聚焦视图被误当成总量。
识别类 `mla.signal` 会包含 `terminalMatches` 和 `candidateStatistics`，可按候选节点查看
评估次数、匹配次数和未成功尝试次数，便于定位循环中持续失败的子节点。
重复节点信号还会包含 `exitCandidates`：循环内被评估但从未匹配成功的候选，用于定位阻止
循环退出的识别条件。
重复节点信号还会为每个被评估的候选子节点输出 `mla.cycle_candidate_outcome` evidence：
携带 evaluation / matched / unsuccessful 计数，并标记 `persistentFailure`（被评估但从未匹配、
也从未形成终端匹配），便于直接看出循环里持续失败的子节点。
其中 `persistentFailure` 的候选还会单独输出为 `mla.cycle_exit_blocker` evidence，
标记“阻止循环退出”的候选及其观测计数，供 harness 据此定位退出条件为何未满足。
标准 `on_error` / `vision` 图片会作为本地路径交给 MLA 与当前及旋转日志关联；只有被运行事实
实际引用的图片才标为 `selected`，图片字节不会嵌入结果。
被失败事实引用的图片会额外输出为 `mla.failure_image` evidence，直接携带图片路径和关联节点，
便于 harness 按需打开截图或调用视觉工具。
MLA 识别事件中的 OCR 文本和识别分数会聚合成 `mla.recognition_detail` evidence：同一
`node + algorithm + status` 合并为一条记录，保留出现次数、常见文本、分数分布和代表样本。
默认只保留失败识别和成功 OCR，避免把重复成功的模板匹配刷成海量证据。
对标记为成功但运行期间出现 `next_list_timeout`、`action_failure` 或日志结束仍未停止的
重复节点序列，MEK 会输出 `mla.task_anomaly` evidence，避免把框架任务成功直接当作业务成功。
若多个日志中出现字段完全一致的任务，MEK 会发出 `mla_possible_mirrored_tasks`，但不会在缺少
实例关联证据时自动合并；`statistics.tasks` 始终表示观测到的任务记录数，而非已证明唯一的执行数。

## SDK

```ts
import {
  inspect,
  inspectMla,
  inspectMse,
  queryEvidenceWindow,
  view,
} from "maa-evidence-kit";

const runtime = await inspectMla("C:/debug", {
  timeRange: {
    from: "2026-07-19 10:00:00",
    to: "2026-07-19 10:10:00",
  },
});

const project = await inspectMse("C:/project", { tasks: ["StartUp"] });
const combined = await inspect("C:/materials");
const text = view(combined, { format: "text" });
const window = await queryEvidenceWindow(runtime, {
  evidenceId: runtime.evidence[0]?.id,
});
```

当 MLA 与 MSE 同时可用时，`inspect` 会额外输出 `combined.pipeline_reference`
evidence，把运行时失败节点与静态 pipeline 任务关联起来，便于判断失败节点是否
存在于当前项目配置中。匹配到的节点会携带 `pipelineControllers`、
`pipelineResources` 和 `pipelineDefinitions`（源码路径/行/列定位）；匹配不到的节点
会输出 `pipelineFound: false`，并在 `warnings` 中给出
`combined.pipeline_reference_missing` 提示。

核心输出使用 `maa-evidence/v1`，包含：

- `artifacts`：发现、选择、跳过或无法读取的材料；
- `evidence`：带稳定 ID 与来源定位的确定性事实；
- `missingEvidence`：缺失分卷、空时间窗或缺失项目等；
- `warnings`：上游限制、截断和兼容性信息；
- `statistics`：确定性计数；
- `details`：MLA/MSE 的项目自有结构化结果。

## Harness Skill

[`skills/maa-evidence/SKILL.md`](skills/maa-evidence/SKILL.md) 指导外部 agent 按需选择 MLA、
MSE、证据窗口和文本视图。Skill 不要求每个问题都运行完整检查；Sentry 调查也由 harness
直接使用 Sentry MCP 或 CLI 完成。Sentry 默认用于聚类错误、衡量影响范围和版本趋势；若
Issue/本地日志与 Sentry 没有共享 `event_id` 或隐私安全的 `run_id`，不得仅凭时间和版本将
两者认定为同一次事件。详细规则见
[`skills/maa-evidence/references/sentry.md`](skills/maa-evidence/references/sentry.md)。

## 遥测与反馈

核心检查离线运行。首次符合条件的交互式使用会询问是否启用匿名运行遥测：

```powershell
maa-evidence telemetry status
maa-evidence telemetry enable
maa-evidence telemetry disable
```

CI 和非交互环境不会询问、发送或保存选择。原始日志等附件只能通过交互式 `feedback`
命令发送，并且每次都必须预览后输入 `UPLOAD`。20MB 只是配额警告，不是 MEK 拒绝上限。
完整说明见 [`PRIVACY.md`](PRIVACY.md)。

## 架构

```text
src/
  evidence/    证据、来源、稳定 ID、原文窗口
  mla/         日志发现与 MLA 集成
  mse/         MSE 集成与静态关系图
  views/       JSON、文本和 Mermaid
  feedback/    同意状态、匿名遥测和提取缺口反馈
  cli/         命令行入口
  inspect.ts   可选组合检查
  index.ts     SDK 公共入口
```

依赖固定为精确版本，并只使用 MSE 的公开包。项目没有 Python、LangGraph、MCP 或内置模型。

## 开发

```powershell
pnpm install
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

真实 Issue 附件、日志、截图和本地上游仓库只用于本地验收，不得提交。
