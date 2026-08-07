# MaaEvidenceKit 输出模型

MEK 输出的确定性证据模型:核心结构、evidence 种类、统计字段与截断语义。
CLI 与 SDK 共用该模型;命令用法见 [`docs/cli.md`](cli.md),SDK 用法见 [`docs/sdk.md`](sdk.md)。

## 核心输出:`maa-evidence/v1`

核心输出使用 `maa-evidence/v1`,包含:

- `artifacts`:发现、选择、跳过或无法读取的材料;
- `evidence`:带稳定 ID 与来源定位的确定性事实;
- `missingEvidence`:缺失分卷、空时间窗或缺失项目等;
- `warnings`:上游限制、截断和兼容性信息;
- `statistics`:确定性计数;
- `details`:MLA/MSE 的项目自有结构化结果。

## MLA 信号与统计

MLA 默认输出其优先级为 `high` 的信号和每个任务的高亮信号,并在 `details.selection.signals`
记录完整数量与入选数量。需要穷举普通、低优先级信号时使用 `--all-signals`,SDK 则设置
`includeAllSignals: true`;筛选只依据 MLA 的通用信号语义,不包含应用项目名称或节点特判。
完整计数始终基于未裁剪的运行时,`statistics` 同时提供 `signalsTotal`、
`recognitionOccurrences`、`repeatedNodeSegments` 和
`repeatedNodeTotalRepeatCount` 及其 `*Focused` 对应值,避免聚焦视图被误当成总量。
识别类 `mla.signal` 会包含 `terminalMatches` 和 `candidateStatistics`,可按候选节点查看
评估次数、匹配次数和未成功尝试次数,便于定位循环中持续失败的子节点。
重复节点信号还会包含 `exitCandidates`:循环内被评估但从未匹配成功的候选,用于定位阻止
循环退出的识别条件。
重复节点信号还会为每个被评估的候选子节点输出 `mla.cycle_candidate_outcome` evidence:
携带 evaluation / matched / unsuccessful 计数,并标记 `persistentFailure`(被评估但从未匹配、
也从未形成终端匹配),便于直接看出循环里持续失败的子节点。
其中 `persistentFailure` 的候选还会单独输出为 `mla.cycle_exit_blocker` evidence,
标记“阻止循环退出”的候选及其观测计数,供 harness 据此定位退出条件为何未满足。
`mla.cycle_exit_blocker` 还会带上 `relatedRecognition`:该候选节点最近一次
`mla.recognition_detail` 的快照(算法、状态、best 分数/文本,或 Or 类子识别摘要),
让 harness 能直接看到“退出阻塞候选最近一次识别的观测事实”。

## 图片关联

标准 `on_error` / `vision` 图片会作为本地路径交给 MLA 与当前及旋转日志关联;只有被运行事实
实际引用的图片才标为 `selected`,图片字节不会嵌入结果。
被失败事实引用的图片会额外输出为 `mla.failure_image` evidence,直接携带图片路径和关联节点,
便于 harness 按需打开截图或调用视觉工具。

## `mla.recognition_detail` 聚合规则

MLA 会按 `node + algorithm + status` 把识别事件聚合为 `mla.recognition_detail` evidence,
按 detail 的真实 shape 通用提取,而不是按算法硬编码。顶层 `score` / `textCounts` 每次识别
只统计一个代表候选(优先 `best`,再取 `filtered` / `all` 首项),不会因同一候选同时出现在
三个上游数组中而重复计数。`candidateStages.all` / `filtered` / `best` 分别保留各阶段的候选总数、
文本计数、分数分布和最多 3 个带 source locator 的样本;`samplesTruncated` 明确表示仍有更多
候选。顶层及各阶段的 `textCounts` 最多返回频次最高的 64 项,完整规模保留在
`textCountSummary`(`observations` / `unique` / `returned` / `truncated`);顶层 `best` 最多
返回 3 个样本,并由 `bestTruncated` 标明是否截断。`detail` 为数组时的子识别(如 Or)也会保留。
嵌套的 And/Or 还会通过直接子识别用 `childRecognition` 有界保留最多 8 个不同子项,完整不同
子项数量在 `childRecognitionTotal` 中,超过上限时 `childRecognitionTruncated` 明确标记。
嵌套的 `descendantRecognition` 有界保留叶子识别路径、候选计数和带 source locator 的 best 样本;
超过深度或数量上限时 `descendantRecognitionTruncated` 会明确标记。OCR 文本、模板分数、
ColorMatch 的 count 等候选字段统一抽取;`detail` 为空的 DirectHit 等不产生记录。
聚合记录的 `representatives` / `best` 样本还会附带各自的 `source` locator,便于 harness
追问某一次观测,而不是只能打开聚合记录的主 source。

## `mla.action_detail` 聚合规则

`Node.Action.Succeeded` / `Node.Action.Failed` 会按节点、action 类型和状态聚合为
`mla.action_detail`,并按 MaaFramework task ID 区分 action 子任务;有界保留 first/last
representative 的 box、detail 和独立 source locator。它只说明 MaaFramework 动作层报告的结果;
Click succeeded 不证明目标界面已发生业务变化,harness 仍应与后续识别、任务结果或截图对照。
action-detail 组超过 500 时会按时间轴均匀取样,并输出 `mla_action_details_truncated`;
完整事件数仍保留在 `statistics.actionOccurrences` / `actionDetailsTotal`。

## `mla.task_anomaly`

对标记为成功但运行期间出现 `next_list_timeout`、`action_failure` 或日志结束仍未停止的
重复节点序列,MEK 会输出 `mla.task_anomaly` evidence,避免把框架任务成功直接当作业务成功。
若循环内某个候选节点所有评估都失败(`unsuccessfulAttemptCount === evaluationCount` 且
`runningAttemptCount === 0`),`mla.task_anomaly` 会额外标记 `all_evaluations_failed`,
只陈述“全部尝试都失败”这一观测事实,不推断是 max_hit 还是手动 disable 导致。

## 镜像任务(mirrored tasks)

若多个日志中出现字段完全一致的任务,MEK 会发出 `mla_possible_mirrored_tasks` warning 和
`mla.possible_mirrored_task_group` evidence。后者列出任务指纹、execution ID、namespace 以及
每个成员的任务起止来源位置,但不会在缺少实例关联证据时自动合并;`statistics.tasks` 始终表示
观测到的任务记录数,而非已证明唯一的执行数。namespace 是 MEK 为日志目标生成的 execution ID
前缀,只能作为同包来源线索,不能替代 harness 的 issue/run 关联。

## 组合检查(`inspect`)的关联证据

当 MLA 与 MSE 同时可用时,`inspect` 会额外输出 `combined.pipeline_reference`
evidence,把运行时失败节点与静态 pipeline 任务关联起来,便于判断失败节点是否
存在于提供的项目配置中。匹配到的节点会携带 `pipelineControllers`、
`pipelineResources` 和 `pipelineDefinitions`(源码路径/行/列定位);匹配不到的节点
会输出 `pipelineFound: false`,并在 `warnings` 中给出
`combined.pipeline_reference_missing` 提示。

每条 `mla.recognition_detail` 还会产生 `combined.recognition_pipeline_reference`:它关联
运行时算法、状态、聚合次数与同名 pipeline 节点的 controller/resource、recognition 摘要、
定义位置和 `definitionEvidenceIds`。完整 `effectiveConfig` 不会在 relation 中重复复制;harness
可直接 `view` 被引用的 `mse.task_definition` evidence,对照 OCR 文本或模板分数与静态
`threshold`、`template` 等实际存在的配置字段。该关系只表示运行时名称与提供的静态快照匹配,
不表示配置导致了本次识别结果;若节点不在该快照中,会以 `pipelineFound: false` 及
`combined.recognition_pipeline_reference_missing` 提示明确输出。
两类 combined relation 都通过 `staticResolutionStatus` 区分 `found`、`found_partial`、
`not_found` 和 `incomplete`,并在 `incompleteReasons` 中列出配置组合截断、项目发现截断或
definition evidence 链接缺失。只有完整静态范围内确认缺失才使用 `not_found`;不完整范围
使用独立的 `combined.*_reference_incomplete` warning,不能据此断言节点不存在。
自动运行时到 MSE 的关联最多选择 128 个不同节点:failure 节点优先,其余按失败识别次数、
总识别次数和节点名稳定排序。达到上限时会输出 `combined.runtime_node_resolution_truncated`,
完整规模及选中/省略数量保存在 `statistics.mseRuntimeNodes*` 和
`details.correlation.runtimeNodes`;未选择的节点不会被误报为 `pipelineFound: false`。
自动关联只解析选中节点的直接定义(`depth: 0` 且不查找 referencer),避免静态图展开主导
组合检查耗时。传入 `InspectOptions.mse.depth` / `includeReferencers` 可覆盖 SDK 默认;CLI 需要
展开反向引用时使用 `inspect --referencers --depth N`。

## 批量查询输出:`maa-evidence-batch/v1`

`batch` 输出使用 `maa-evidence-batch/v1`,保持请求顺序和可选 `id`。每批限制 1 到 100 项;
输入字段严格校验,任一项非法、ID 未知或窗口读取失败时整批明确失败,不返回容易误用的
部分结果。批次不支持引用同批 `search` 动态返回的 ID;这种依赖关系应先批量搜索,再用
第二批读取事实和窗口。命令用法见 [CLI 参考](cli.md)。
