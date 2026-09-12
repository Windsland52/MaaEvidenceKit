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
- `details`:MLA/MSE 的项目自有结构化结果,或 `repo_docs` 的 evidence ID 索引、固定上限与
  扫描截断状态。

## 仓库说明清点

`repo-docs` 使用同一 `maa-evidence/v1` schema,但必须显式调用,不会自动并入组合检查:

- `repo_docs.agents_document`:每个已选 `AGENTS.md` 一条 evidence,包含文件大小、实际返回字节/
  行数、最多 64 KiB 的 UTF-8 文本、`truncated` 与 `endsMidLine`;source 从第一行开始并指向
  原 artifact。文本变化会改变 evidence ID,相对路径不变时 artifact ID 保持稳定。
- `repo_docs.skill_file`:只记录 `SKILL.md` 的路径来源、文件大小、所属已知 Skill 根和目录深度;
  不解析 frontmatter/正文,也不赋予其中内容指令权威。

成功形成 evidence 的文件 artifact 标为 `selected`。符号链接、越界、不可读或深度受限条目
标为 `skipped` 并携带 reason;`window` 拒绝读取 `skipped`/`unreadable` artifact。没有
`AGENTS.md` 或 Skill 是合法空清单,不构成 `missingEvidence`。固定资源上限及已知/未知遗漏通过
`details.scan`、`statistics` 和 warning 明确公开。

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

## 未支持文件的有界清点

发现阶段会看到未选中的文件。它们既不进入 evidence，也不由 MEK 解析，但"被静默丢弃"会让 harness
不知道自己该去看什么，所以输出把它们显式化：

- artifact 列表中最多保留 200 条未支持文件记录（`kind: "other"`，状态 `skipped`）。超过上限后
  被省略的文件进入 `details.selection.omittedUnsupportedFiles`，最多 20 条，按发现顺序（完整路径
  排序）给出 `relativePath`、`sizeBytes` 与 `modifiedAt`（ISO 8601 的文件系统修改时间）。
- 同时输出 warning `unsupported_artifact_list_truncated` 与 `missingEvidence`
  `unsupported_files_not_parsed`，并在 `statistics.omittedUnsupportedFiles` /
  `statistics.reportedOmittedUnsupportedFiles` 给出总数与已描述数。

清点**只给文件元数据，不给内容，也不做语义判断**：这一点由 `AGENTS.md` 明确要求——core discovery
可以清点未支持文件，但不得推断其语义。因此判断"这些文件是否包含决定性证据"是 harness 的职责，
MEK 只保证它知道**哪些文件存在、多大、何时修改**。`modifiedAt` 是文件系统事实，不是解析出的事件
时间；是否落在故障时间窗内需要 harness 自行比对。

## 失败上下文

每条 `mla.failure` 都会产生一条 `mla.failure_context`,在同一已选运行时作用域内关联当前任务、
最多 5 条已完成的前置任务、失败时仍在运行的并发/嵌套任务和后续任务。任务条目保留状态、
起止时间、first/last node 及对应 `mla.task` evidence ID。`counts` 给出各组完整观测数量,
`truncated` 标明有界列表是否省略记录。这里的 preceding/concurrent/following 只表示日志时序,
不表示任务间存在因果关系。时间范围检查只描述被选中的运行时事实,不能用“没有前置任务”证明
范围之外不存在任务。
摘要会直接写出当前关联任务及其状态,并在有界窗口内存在其他失败时给出数量;因此根任务
`succeeded` 与附近子任务失败可以同时出现在一条摘要中,但这仍只是运行事实和时序关联。

每条 `mla.failure` 还携带两个由上游事实直接映射的字段,用于区分"节点失败"与"任务失败":

- `termination`:节点执行如何结束,取 `reco_timeout`(`next_list_timeout`)或
  `action_error`(`action_failed`)。**没有 `stop_requested` 之类的取值**——上游解析不产生停止
  信号,被用户停止打断的节点与其他未成功结束的节点无法区分,因此 MEK 不推断"这次失败是被停止
  导致的"。
- `task_outcome`:该失败所属任务执行的最终状态,取 `failed`、`succeeded`、
  `succeeded_with_open_end`(框架判成功,但日志在闭合事件之前结束)或 `running`;无法解析时
  为 `null`。`task_outcome` 与节点结果可以不一致:节点失败而任务仍成功是真实存在的组合。

当存在"所属任务最终成功"的失败记录时,输出警告 `mla_failures_in_succeeded_tasks`,并给出
`statistics.failuresInSucceededTasks`、`statistics.failuresInFailedTasks`、
`statistics.failuresInRunningTasks` 与 `statistics.failuresWithoutTaskOutcome`。**这些记录不会被
删除、降权或改写**——框架层的节点失败是事实,而它是否代表本次运行损坏需要结合 `task_outcome`
判断,这属于 harness 的解释范围。按失败记录数直接声称任务损坏数量会高估。

`nearbyFailures` 还会按同一作用域的失败顺序保留最多 5 个失败,并引用各自的 `mla.failure`
及 `mla.failure_image` evidence ID。这为 harness 连续打开相邻失败截图提供确定性索引；MEK
不比较图片像素,也不因时间接近而宣称截图属于同一界面。

## 图片关联

标准 `on_error` / `vision` 图片会作为本地路径交给 MLA 与当前及旋转日志关联;只有被运行事实
实际引用的图片才标为 `selected`,图片字节不会嵌入结果。
被失败事实引用的图片会额外输出为 `mla.failure_image` evidence,直接携带图片路径和关联节点,
便于 harness 按需打开截图或调用视觉工具。

被失败引用的图片还会记录内容摘要(`Artifact.contentDigest`,以及 `mla.failure_image.data` 的
`contentDigest`),格式为 `sha256:<64 位十六进制>`。摘要只回答"这两个文件的字节是否相同"这一
确定性等值问题,不做像素比较、不做画面相似性判断,也不声称两张截图属于同一界面——它把该判断
所需的事实交给 harness。典型用途是按捕获画面聚类失败:两次独立失败写出同一张截图时,画面在两次
失败之间没有变化。
摘要只对确实被读取到的文件记录。空文件、不可读文件和超过 `MAX_CONTENT_DIGEST_BYTES` 的文件
不记录摘要,这些记录按"摘要未知"处理,不会与任何其他记录被判为相同;摘要缺失本身不新增
warning,消费者看到 `contentDigest` 不存在时应理解为"未判定"而不是"与其他都不同"。
当输入里出现多份字节完全相同的 artifact 时,输出 `mla_byte_identical_artifacts` 警告,并给出
`statistics.artifacts`(原始记录数)、`statistics.byteIdenticalArtifactRecords`(其中的副本记录数)
与 `statistics.byteIdenticalArtifactRecordsDeduplicated`(去掉副本后的差值),便于用去重口径复核
计数。artifact 记录与 evidence ID 仍然各自保留,不做合并:字节相同不等于同一次观测。

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

## `mla.pipeline_override`

MLA 会从 MaaFramework 核心日志中提取非空 `pipeline_override` JSON，按日志出现顺序输出
`mla.pipeline_override` evidence。`patches` 保留 object 或 object array 的原始覆盖顺序，
`nodeNames` 给出本次覆盖涉及的节点；`origin` 区分资源覆盖、任务提交、任务更新和 Context
动态覆盖。`patchPaths` 把每一处被覆盖的字段摊平成 `节点.字段.子字段` 形式的去重有序列表，
用于按字段名检索——覆盖载荷的语义在 object key 上，而 evidence 文本检索按设计不匹配字段名。
路径最多 200 条、深度最多 8 层；只有确实有路径被丢弃时 `patchPathsTruncated` 才为 true，
恰好 200 条而没有溢出时仍为 false。内存地址不会直接输出，而是按当前日志内首次出现顺序归一化为
`contextScopeId`。同一输入同时出现在 API/Tasker 层和 Context 核心层时优先保留 Context
来源并去重；若 Context trace 不可见，仍保留可解析的任务或 API 输入，但不会补造其缺失的
Context/task 关联。

只有日志同时提供唯一的 Context ID 到 MaaFramework `task_id` 映射时，才标记
`taskAssociation: "task_id"`；仅能对应任务入口时使用 `entry_only`，否则为 `none`。
空覆盖不会产生 evidence。单个 MLA target 最多保留 500 条非空覆盖，优先保留具备精确
task ID 关联的记录，再对其余记录做时间轴取样；完整数量在
`statistics.pipelineOverridesTotal`，入选数量在 `statistics.pipelineOverrides` 和
`details.selection.pipelineOverrides`。发生截断或覆盖日志行 JSON 不完整时分别输出
`mla_pipeline_overrides_truncated`、`mla_pipeline_override_parse_incomplete`。

`details.selection.pipelineOverrides.activityLines` 与
`statistics.pipelineOverrideActivityLines` 给出**带覆盖痕迹的日志行数**，它不依赖任何已知 marker
名称或格式，因此上游更换 marker 写法后仍然计数。当它大于 0 而 `pipelineOverridesTotal` 为 0 时，
输出 `mla_pipeline_override_extraction_empty`：这表示**提取没有识别出记录格式，而不是本次运行没有
发生覆盖**。此时不得从空结果得出"没有运行时覆盖"的结论，应改为读取被引用 artifact 的原始日志行。
该计数是"带覆盖痕迹的行数"下界，不是记录数，也不与 `pipelineOverridesTotal` 一一对应：
携带覆盖的任务提交会被计入而不产生独立的覆盖 evidence，镜像日志的重复行同样各计一次，
而提取结果会按 Context 来源去重。

提取本身接受多种 marker 写法，因为真实材料里同时存在它们：
`][MaaNS::TaskNS::Context::override_pipeline]`（裸符号）与
`][virtual bool MaaNS::TaskNS::Context::override_pipeline(const json::value &)]`（C++ 签名）。
只匹配裸符号会在含有 159 行签名写法的真实日志上提取出 0 条记录。

agent 反向请求路径（`AgentClient::handle_context_override_pipeline` 携带
`_ContextOverridePipelineReverseRequest`）**不做提取**，因为它的信息完全冗余：它携带的每条 patch
都已从对应的 Context marker 行按原文提取。三份真实日志上，全部反向请求 payload 都能在已提取的
patch 中逐字节找到（31/31、26/26、66/66 条 patch；18/18、13/13、17/17 个节点名被覆盖），
因此解析它只会产生重复记录。这些行仍被活动行计数覆盖，所以它们是**可见的已知缺口**而非静默丢失。

该 evidence 只证明日志记录了覆盖输入，不是覆盖成功或最终运行配置的序列化结果。
MaaFramework 会按 pipeline 协议和当时已有节点数据解析覆盖，并非普通 JSON 深合并；日志级别
也可能令某些动态覆盖不可见。因此 `patches` 必须与静态基础定义、任务作用域、时间顺序及
后续实际动作/识别事实分开解释，未观察到记录不能证明运行时不存在覆盖。

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
`pipelineResources`、`pipelineDefinitions`(源码路径/行/列定位)和
`pipelineDefinitionEvidenceIds`；后者指向保存 MSE `effectiveConfig` 的
`mse.task_definition`。同一关系还会把失败发生前、同一日志 artifact、同一 task ID、同一节点的
`mla.pipeline_override` 放入 `runtimeOverrideEvidenceIds`。仅节点和时间吻合但任务作用域无法
确认的记录放入 `unscopedRuntimeOverrideEvidenceIds`，并将
`runtimeOverrideResolutionStatus` 标为 `found_partial`；截断、解析不完整和作用域缺失会记录在
`runtimeConfigurationIncompleteReasons` 并输出 `combined.runtime_configuration_incomplete`
warning。`not_observed` 只表示所选日志中没有找到可关联覆盖，不等于证明没有覆盖。

Combined relation 故意不生成一个新的“最终 effectiveConfig”：MSE 配置是所提供源码快照的
静态基础，override evidence 是运行时记录的有序 patch，二者的关系不等价于通用 JSON 深合并，
且日志可能缺少动态覆盖或覆盖成功结果。harness 应通过这些 evidence ID 分别查看基础定义和
运行时 patch，再与实际动作参数、识别结果和应用状态对照。匹配不到的节点
会输出 `pipelineFound: false`,并在 `warnings` 中给出
`combined.pipeline_reference_missing` 提示。

每条 `mla.recognition_detail` 还会产生 `combined.recognition_pipeline_reference`:它关联
运行时算法、状态、聚合次数与同名 pipeline 节点的 controller/resource、recognition 摘要、
定义位置和 `definitionEvidenceIds`。完整 `effectiveConfig` 不会在 relation 中重复复制;harness
可直接 `view` 被引用的 `mse.task_definition` evidence,对照 OCR 文本或模板分数与静态
`threshold`、`template` 等实际存在的配置字段。该关系只表示运行时名称与提供的静态快照匹配,
不表示配置导致了本次识别结果;若节点不在该快照中,会以 `pipelineFound: false` 及
`combined.recognition_pipeline_reference_missing` 提示明确输出。

对于直接 OCR 配置,每个 `staticConfigurations` 条目还会输出
`configurationBasis: mse_static_effective_config` 和 `ocrObservationComparisons`。后者保留静态
`expected`、`roi`、`only_rec`,并将最多 12 个 MLA OCR 候选的文本、框、分数和 source locator
逐项关联。`equalsExpectedValue` 只做区分大小写的字面相等,不模拟 MaaFramework 的正则或匹配
语义；`roiRelation` 与 `roiBoundaryContacts` 只做矩形几何比较。候选总数和截断状态分别由
`observationCount`、`observationsTruncated` 表示。该对照是静态源码快照与运行观测的并列事实,
不是最终运行时配置；若日志存在 override,仍需读取对应 `mla.pipeline_override` 并保留无法确定
识别事件 task scope 的限制。
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
