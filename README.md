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
- 默认发送匿名聚合遥测（可关闭），并按需发送需明确确认的提取缺口反馈。

MEK 不负责理解 GitHub Issue、GUI/自定义日志、Sentry 数据或业务结果，也不会输出根因结论。
这些工作属于调用它的 harness。

## 安装

需要 Node.js 24+ 和 pnpm。

```powershell
pnpm install
pnpm build
node dist/cli/main.js --help
node dist/cli/main.js --version
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

# 已知任务和配置时，只解析静态定义/执行关系，跳过完整预检
maa-evidence mse resolve C:\path\to\project `
  --task StartUp `
  --controller Adb `
  --resource Official `
  --no-referencers `
  --format json

# 查询公共节点定义时关闭可能很大的反向引用展开
maa-evidence mse inspect C:\path\to\project `
  --controller Win32-Front `
  --resource 官服 `
  --task __ScenePrivateWorldEnterMenuList `
  --depth 1 `
  --no-referencers

# 读取某条证据附近的原始行
maa-evidence window --input inspection.json --evidence-id evidence-abc123

# 查看某条证据的完整结构化数据
maa-evidence view --input inspection.json --evidence-id evidence-abc123 --format json
maa-evidence view --input inspection.json --evidence-id evidence-abc123 --format text

# 从已有结果中快速查找相关 evidence ID
maa-evidence search --input inspection.json `
  --kind mla.recognition_detail `
  --node DailyProtocolMissionsPick `
  --text "一键领取" `
  --limit 20

# 在同一进程中批量查询已有结果
maa-evidence batch --input inspection.json `
  --requests queries.json `
  --output answers.json

# 将本地阶段耗时写入旁路文件（不会混入 evidence）
maa-evidence mla inspect C:\path\to\materials `
  --format json `
  --output inspection.json `
  --profile profile.json

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
对于被大量任务复用的公共节点，反向扫描可能产生很大的图；只需要节点定义及其后续路径时
使用 `--no-referencers`。已从日志确定 controller/resource 时也应显式传入，避免为不相关的
资源组合重复解析。SDK 对应设置 `includeReferencers: false`。
图中节点会附带 `desc` / `recognition` / `action` / `customRecognition` /
`customAction` 摘要字段，便于在不打开完整配置的情况下判断节点职责。

当 harness 已从运行日志确定 task，且问题只需要 issue-time pipeline 定义或前向执行关系时，
使用 `mse resolve`。它要求至少一个 `--task`，直接执行受限任务解析，跳过 Interface 预检和
全项目 artifact inventory；输出仍是 `maa-evidence/v1`，`kind` 为 `mse`，并以
`details.mode: "resolution"` 明确轻量模式。被定义或引用的 pipeline 文件仍会登记为 artifact，
因此其 evidence 可继续使用 `window`。该模式不会输出 `mse.interface`、`mse.task_binding` 或
`mse.diagnostic`，不能用来回答 Interface 绑定、资源组合完整性或兼容性问题；这些问题必须使用
`mse inspect`。未知任务会产生 `mse_task_definition_missing`，不会被静默当作空成功。

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
`mla.cycle_exit_blocker` 还会带上 `relatedRecognition`：该候选节点最近一次
`mla.recognition_detail` 的快照（算法、状态、best 分数/文本，或 Or 类子识别摘要），
让 harness 能直接看到“退出阻塞候选最近一次识别的观测事实”。
标准 `on_error` / `vision` 图片会作为本地路径交给 MLA 与当前及旋转日志关联；只有被运行事实
实际引用的图片才标为 `selected`，图片字节不会嵌入结果。
被失败事实引用的图片会额外输出为 `mla.failure_image` evidence，直接携带图片路径和关联节点，
便于 harness 按需打开截图或调用视觉工具。
MLA 会按 `node + algorithm + status` 把识别事件聚合为 `mla.recognition_detail` evidence，
按 detail 的真实 shape 通用提取，而不是按算法硬编码。顶层 `score` / `textCounts` 每次识别
只统计一个代表候选（优先 `best`，再取 `filtered` / `all` 首项），不会因同一候选同时出现在
三个上游数组中而重复计数。`candidateStages.all` / `filtered` / `best` 分别保留各阶段的候选总数、
文本计数、分数分布和最多 3 个带 source locator 的样本；`samplesTruncated` 明确表示仍有更多
候选。顶层及各阶段的 `textCounts` 最多返回频次最高的 64 项，完整规模保留在
`textCountSummary`（`observations` / `unique` / `returned` / `truncated`）；顶层 `best` 最多
返回 3 个样本，并由 `bestTruncated` 标明是否截断。`detail` 为数组时的子识别（如 Or）也会保留。嵌套的 And/Or 还会通过
直接子识别通过 `childRecognition` 有界保留最多 8 个不同子项，完整不同子项数量在
`childRecognitionTotal` 中，超过上限时 `childRecognitionTruncated` 明确标记。嵌套的
`descendantRecognition` 有界保留叶子识别路径、候选计数和带 source locator 的 best 样本；超过深度或数量上限时
`descendantRecognitionTruncated` 会明确标记。OCR 文本、模板分数、ColorMatch 的 count 等
候选字段统一抽取；`detail` 为空的 DirectHit 等不产生记录。
聚合记录的 `representatives` / `best` 样本还会附带各自的 `source` locator，便于 harness
追问某一次观测，而不是只能打开聚合记录的主 source。
`Node.Action.Succeeded` / `Node.Action.Failed` 会按节点、action 类型和状态聚合为
`mla.action_detail`，并按 MaaFramework task ID 区分 action 子任务；有界保留 first/last
representative 的 box、detail 和独立 source locator。它只说明 MaaFramework 动作层报告的结果；
Click succeeded 不证明目标界面
已发生业务变化，harness 仍应与后续识别、任务结果或截图对照。
action-detail 组超过 500 时会按时间轴均匀取样，并输出 `mla_action_details_truncated`；
完整事件数仍保留在 `statistics.actionOccurrences` / `actionDetailsTotal`。
对标记为成功但运行期间出现 `next_list_timeout`、`action_failure` 或日志结束仍未停止的
重复节点序列，MEK 会输出 `mla.task_anomaly` evidence，避免把框架任务成功直接当作业务成功。
若循环内某个候选节点所有评估都失败（`unsuccessfulAttemptCount === evaluationCount` 且
`runningAttemptCount === 0`），`mla.task_anomaly` 会额外标记 `all_evaluations_failed`，
只陈述“全部尝试都失败”这一观测事实，不推断是 max_hit 还是手动 disable 导致。
若多个日志中出现字段完全一致的任务，MEK 会发出 `mla_possible_mirrored_tasks` warning 和
`mla.possible_mirrored_task_group` evidence。后者列出任务指纹、execution ID、namespace 以及
每个成员的任务起止来源位置，但不会在缺少实例关联证据时自动合并；`statistics.tasks` 始终表示
观测到的任务记录数，而非已证明唯一的执行数。namespace 是 MEK 为日志目标生成的 execution ID
前缀，只能作为同包来源线索，不能替代 harness 的 issue/run 关联。

## SDK

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

后续追问建议先从 JSON 结果中选择并引用 evidence ID，再使用 CLI 的
`view --evidence-id` 查看该条事实的完整 `data`，使用 `window --evidence-id` 查看其来源日志上下文。
`view --evidence-id` 支持 JSON 和 text；`window` 默认保持 JSON，也支持 `--format text`。
未知 evidence ID 会明确报错，不会静默返回空结果。

`search` 只读取已有 inspection JSON，不重新解析原日志。`--kind`、`--node`、`--task`
和 `--artifact-id` 执行区分大小写的精确匹配；可重复传入同一选项表示任一值均可。
重复的 `--text` 条件执行大小写不敏感的 AND 匹配，搜索 evidence 的摘要、source 和
结构化 data 的原始值，不匹配 JSON 字段名。
`--from` / `--to` 只匹配带 source timestamp 的 evidence。结果默认最多返回 50 条索引、
上限 500 条，并明确给出 `totalMatches` 和 `truncated`；完整 data 仍通过 `view --evidence-id` 获取。

`batch` 用一次 inspection 加载执行多个 `search`、`view` 和 `window` 请求，适合一次追问需要
读取多条已知证据时避免重复启动 CLI 和解析大型 JSON。`--requests` 指向一个 JSON 数组：

```json
[
  { "id": "find", "operation": "search", "query": { "kinds": ["mla.task"], "limit": 20 } },
  { "id": "fact", "operation": "view", "evidenceId": "evidence-abc123" },
  { "id": "context", "operation": "window", "query": { "evidenceId": "evidence-abc123", "before": 5, "after": 5 } }
]
```

输出使用 `maa-evidence-batch/v1`，保持请求顺序和可选 `id`。每批限制 1 到 100 项；输入字段会
严格校验，任一项非法、ID 未知或窗口读取失败时整批明确失败，不返回容易误用的部分结果。
批次不支持引用同批 `search` 动态返回的 ID；这种依赖关系应先批量搜索，再用第二批读取事实和窗口。

`--profile FILE` 可用于 `mla inspect`、`mse inspect`、`mse resolve`、组合 `inspect` 及已有结果的查询命令。
它输出本地 `maa-evidence-profile/v1` 旁路 JSON，聚合 discovery、MLA load/parse、MSE
preflight/resolution、inspection load、render 和 output write 等阶段的 `count`、总耗时与最大耗时。
profile 与 inspection 输出必须使用不同文件；失败命令也会写 `status: error`，但不会写异常消息、
路径或命令参数。并发阶段会重叠，所以各阶段总耗时之和可能大于命令墙钟耗时。该文件不是
evidence，也不会通过运行遥测自动发送。启用运行遥测时，profile 还会以 `telemetry.config` 和
`telemetry.send` 单独显示本地配置读取与发送/flush 耗时，便于区分分析慢和命令退出慢。

当 MLA 与 MSE 同时可用时，`inspect` 会额外输出 `combined.pipeline_reference`
evidence，把运行时失败节点与静态 pipeline 任务关联起来，便于判断失败节点是否
存在于提供的项目配置中。匹配到的节点会携带 `pipelineControllers`、
`pipelineResources` 和 `pipelineDefinitions`（源码路径/行/列定位）；匹配不到的节点
会输出 `pipelineFound: false`，并在 `warnings` 中给出
`combined.pipeline_reference_missing` 提示。

每条 `mla.recognition_detail` 还会产生 `combined.recognition_pipeline_reference`：它关联
运行时算法、状态、聚合次数与同名 pipeline 节点的 controller/resource、recognition 摘要、
定义位置和 `definitionEvidenceIds`。完整 `effectiveConfig` 不会在 relation 中重复复制；harness
可直接 `view` 被引用的 `mse.task_definition` evidence，对照 OCR 文本或模板分数与静态
`threshold`、`template` 等实际存在的配置字段。该关系只表示运行时名称与提供的静态快照匹配，
不表示配置导致了本次识别结果；若节点不在该快照中，会以 `pipelineFound: false` 及
`combined.recognition_pipeline_reference_missing` 提示明确输出。
两类 combined relation 都通过 `staticResolutionStatus` 区分 `found`、`found_partial`、
`not_found` 和 `incomplete`，并在 `incompleteReasons` 中列出配置组合截断、项目发现截断或
definition evidence 链接缺失。只有完整静态范围内确认缺失才使用 `not_found`；不完整范围
使用独立的 `combined.*_reference_incomplete` warning，不能据此断言节点不存在。
自动运行时到 MSE 的关联最多选择 128 个不同节点：failure 节点优先，其余按失败识别次数、
总识别次数和节点名稳定排序。达到上限时会输出 `combined.runtime_node_resolution_truncated`，
完整规模及选中/省略数量保存在 `statistics.mseRuntimeNodes*` 和
`details.correlation.runtimeNodes`；未选择的节点不会被误报为 `pipelineFound: false`。
自动关联只解析选中节点的直接定义（`depth: 0` 且不查找 referencer），避免静态图展开主导
组合检查耗时。传入 `InspectOptions.mse.depth` / `includeReferencers` 可覆盖 SDK 默认；CLI 需要
展开反向引用时使用 `inspect --referencers --depth N`。

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

Issue 调查采用分阶段快路径：harness 并发获取独立附件并提取 issue 中的版本/时间提示，日志
完整后立即先运行聚焦 MLA；只有剩余问题确实需要节点定义、配置阈值或静态执行关系时，才获取
issue-time 源码并运行聚焦 MSE。已知 task/controller/resource 必须传给 MSE，共享节点只需定义
和前向路径时使用 `--no-referencers`。多个后续证据查询使用 `batch`，不重复启动 CLI 和解析结果。

Skill 同时定义由 harness 管理的三层本地缓存：附件按内容 SHA-256，源码按仓库与不可变 commit，
inspection 按完整材料清单、规范化选项、MEK 版本及可选源码 commit。CLI 可用
`maa-evidence --version` 提供缓存键版本。缓存不属于 MEK 核心，不得提交到仓库；若 cached
inspection 记录的 artifact 原路径已不可用，只能继续做 `view`/`search`，读取 `window` 前必须
恢复原路径或重新检查。

## 遥测与反馈

核心检查离线运行。匿名运行遥测（仅聚合计数，不含路径、参数、用户名、日志、源码或截图）
默认启用，可用 `telemetry disable` 或环境变量 `MAA_EVIDENCE_TELEMETRY=0` 关闭：

```powershell
maa-evidence telemetry status
maa-evidence telemetry enable
maa-evidence telemetry disable
```

CI 和非交互环境默认发送聚合遥测，但从不弹出交互提示。运行遥测为 best-effort，每次命令使用
200ms 投递预算，超时不会改变命令结果；原始日志、截图或源代码等附件
**不会自动发送**，只能通过交互式 `feedback` 命令发送，并且每次都必须预览后输入 `UPLOAD`。
反馈按严重程度分为 `blocker`（无法使用/崩溃）、`bug`、`suggestion`、`other` 四类，默认
`other`。20MB 只是配额警告，不是 MEK 拒绝上限。完整说明见 [`PRIVACY.md`](PRIVACY.md)。

## 架构

```text
src/
  evidence/    证据、来源、稳定 ID、原文窗口
  mla/         日志发现与 MLA 集成
  mse/         MSE 集成与静态关系图
  views/       JSON、文本和 Mermaid
  feedback/    同意状态、匿名遥测和分级反馈
  cli/         命令行入口
  profiling.ts 本地旁路阶段计时
  inspect.ts   可选组合检查
  index.ts     SDK 公共入口
```

依赖固定为精确版本，并只使用 MSE 的公开包。项目没有 Python、LangGraph、MCP 或内置模型。

版本变更记录见 [`CHANGELOG.md`](CHANGELOG.md)，发布步骤及手工验收清单见
[`RELEASING.md`](RELEASING.md)。发布前统一运行 `pnpm release:check`；该命令除完整检查外，
还会打包 tarball，在临时消费项目中安装并验证 SDK import 和 CLI 入口。推送与包版本一致的
`v<version>` tag 后，GitHub Actions 会使用仓库配置的 `NPM_TOKEN` 自动发布到 npm。

## 开发

```powershell
pnpm install
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

真实 Issue 附件、日志、截图和本地上游仓库只用于本地验收，不得提交。
