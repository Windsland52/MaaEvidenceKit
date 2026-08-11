# MaaEvidenceKit CLI 参考

`maa-evidence` 命令行工具的完整命令与行为参考。快速上手与安装见仓库 [`README.md`](../README.md)。

## 使用前提

调用方负责先解压 ZIP,再将完整文件夹交给 MEK。MEK 自行选择可由 MLA/MSE 处理的材料。
若整仓库同时包含根目录日志和 `debug` 等日志包,MLA 会逐包顺序解析并合并结果,不会把
包含 `node_modules` 的项目根目录直接交给日志加载器;单个日志包失败会记录为缺失证据。

## 发布版自动更新

通过 npm 安装的 CLI 在分析命令及 `--version` 启动时至多每 24 小时检查一次 npm `latest`。
发现更高稳定版后,它先验证该精确版本可启动,再将原命令和标准输入输出完整交给新版本。
全局安装作为稳定启动器保留,不会在当前进程中覆盖自身文件。准备或网络失败时继续使用本地
版本;已经成功接力后则保留新版本命令的退出码,不会重复执行旧版本。

每个 MEK 版本还会调用一次 `skills update maa-evidence --global`,同步受管的用户级 Skill。
具体 Agent 目录、安装目标及符号链接/副本由 `skills` CLI 根据原安装记录处理,MEK 不直接
访问任何 Agent 的 Skill 目录。自动更新状态保存在 MEK 配置目录的 `updates.json`,只包含
检查时间、已知版本和同步状态。

设置 `MAA_EVIDENCE_AUTO_UPDATE=0` 可关闭这两类更新。CI 默认关闭自动更新,显式设置为 `1`
才会启用。无参数、`--help`、`telemetry` 和 `feedback` 不触发更新;SDK import 也不触发。

## 命令速查

### `inspect`:自动选择可用适配器

```powershell
maa-evidence inspect C:\path\to\materials --format json --output inspection.json
```

### `mla inspect`:只检查 MaaFramework 日志

```powershell
# 只检查 MaaFramework 日志
maa-evidence mla inspect C:\path\to\materials --format json

# 根据 GUI/Sentry 提供的时间缩小证据范围
maa-evidence mla inspect C:\path\to\materials `
  --from "2026-07-19 10:00:00" `
  --to "2026-07-19 10:10:00" `
  --format text

# 将本地阶段耗时写入旁路文件(不会混入 evidence)
maa-evidence mla inspect C:\path\to\materials `
  --format json `
  --output inspection.json `
  --profile profile.json
```

### `mse inspect` / `mse resolve`:只检查项目静态定义

```powershell
# 只检查指定项目任务
maa-evidence mse inspect C:\path\to\project --task StartUp --format text

# 已知任务和配置时,只解析静态定义/执行关系,跳过完整预检
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
```

### `window` / `view` / `search` / `batch`:查询已有结果

```powershell
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

# 将已有结果渲染为通用文本或 Mermaid
maa-evidence view --input inspection.json --format text
maa-evidence view --input inspection.json --format mermaid
```

### `telemetry`

```powershell
maa-evidence telemetry status
maa-evidence telemetry enable
maa-evidence telemetry disable
```

## MSE 行为

MSE 未提供 `--task` 时只执行 Interface、资源组合和静态诊断预检,不自动展开项目中的
全部内部 pipeline 节点。需要节点关系时由 harness 传入相关任务名,避免无关证据和耗时膨胀。
传入 `--task` 后,MSE 会沿执行路径递归展开 `next` / `anchor` / `on_error` 等引用;
默认展开两层,可用 `--depth N` 控制深度。图中只保留执行路径边,模板、颜色、OCR 等
资源引用仍保留在 `mse.reference` evidence 中。以失败节点作为 `--task` 时,MSE 还会
反向扫描执行路径,找出哪些任务引用了该节点,便于定位“谁把流程带到失败点”。
对于被大量任务复用的公共节点,反向扫描可能产生很大的图;只需要节点定义及其后续路径时
使用 `--no-referencers`。已从日志确定 controller/resource 时也应显式传入,避免为不相关的
资源组合重复解析。SDK 对应设置 `includeReferencers: false`。
图中节点会附带 `desc` / `recognition` / `action` / `customRecognition` /
`customAction` 摘要字段,便于在不打开完整配置的情况下判断节点职责。

## `mse resolve`:轻量解析模式

当 harness 已从运行日志确定 task,且问题只需要 issue-time pipeline 定义或前向执行关系时,
使用 `mse resolve`。它要求至少一个 `--task`,直接执行受限任务解析,跳过 Interface 预检和
全项目 artifact inventory;输出仍是 `maa-evidence/v1`,`kind` 为 `mse`,并以
`details.mode: "resolution"` 明确轻量模式。被定义或引用的 pipeline 文件仍会登记为 artifact,
因此其 evidence 可继续使用 `window`。该模式不会输出 `mse.interface`、`mse.task_binding` 或
`mse.diagnostic`,不能用来回答 Interface 绑定、资源组合完整性或兼容性问题;这些问题必须使用
`mse inspect`。未知任务会产生 `mse_task_definition_missing`,不会被静默当作空成功。

## MLA 时间范围与限制

当提供时间范围时,MLA 先将目录加载聚焦到匹配文件,MEK 再过滤窗口外的任务和直接事实。
当前 MLA 1.3.1 仍可能完整读取一个匹配的日志文件;输出会明确携带该限制,避免把它误解成
真正的行级流式裁剪。
如果组合目录目标超过上游资源限制、但发现的 MaaFramework 日志仍可逐文件检查,
`mla_directory_fallback_used` 会保留“跨文件聚合可能不完整”的警告,逐文件失败则单独保留为
`mla_target_unreadable` missing evidence。目录失败不会再为同一个不可读文件重复生成缺失记录。

## 查询命令语义

`view --evidence-id` 支持 JSON 和 text;`window` 默认保持 JSON,也支持 `--format text`。
未知 evidence ID 会明确报错,不会静默返回空结果。

`search` 只读取已有 inspection JSON,不重新解析原日志。`--kind`、`--node`、`--task`
和 `--artifact-id` 执行区分大小写的精确匹配;可重复传入同一选项表示任一值均可。
`--node` 除顶层 source node 外,也精确匹配 `mla.recognition_detail` 中已保留的
`childRecognition` / `descendantRecognition` 节点;结果的 `nodeMatches` 会标明顶层、直接子节点
或后代节点及其路径。嵌套列表仍受 inspection 的既有上限约束,当对应 `*Truncated` 为 true 时,
搜索结果不能证明未返回的节点不存在。
重复的 `--text` 条件执行大小写不敏感的 AND 匹配,搜索 evidence 的摘要、source 和
结构化 data 的原始值,不匹配 JSON 字段名。
`--from` / `--to` 只匹配带 source timestamp 的 evidence。结果默认最多返回 50 条索引、
上限 500 条,并明确给出 `totalMatches` 和 `truncated`;完整 data 仍通过 `view --evidence-id` 获取。

`batch` 用一次 inspection 加载执行多个 `search`、`view` 和 `window` 请求,适合一次追问需要
读取多条已知证据时避免重复启动 CLI 和解析大型 JSON。`--requests` 指向一个 JSON 数组:

```json
[
  { "id": "find", "operation": "search", "query": { "kinds": ["mla.task"], "limit": 20 } },
  { "id": "fact", "operation": "view", "evidenceId": "evidence-abc123" },
  { "id": "context", "operation": "window", "query": { "evidenceId": "evidence-abc123", "before": 5, "after": 5 } }
]
```

输出使用 `maa-evidence-batch/v1`,保持请求顺序和可选 `id`。每批限制 1 到 100 项;输入字段会
严格校验,任一项非法、ID 未知或窗口读取失败时整批明确失败,不返回容易误用的部分结果。
批次不支持引用同批 `search` 动态返回的 ID;这种依赖关系应先批量搜索,再用第二批读取事实和窗口。

## `--profile`:本地阶段计时

`--profile FILE` 可用于 `mla inspect`、`mse inspect`、`mse resolve`、组合 `inspect` 及已有结果的查询命令。
它输出本地 `maa-evidence-profile/v1` 旁路 JSON,聚合 discovery、MLA load/parse、MSE
preflight/resolution、inspection load、render 和 output write 等阶段的 `count`、总耗时与最大耗时。
profile 与 inspection 输出必须使用不同文件;失败命令也会写 `status: error`,但不会写异常消息、
路径或命令参数。并发阶段会重叠,所以各阶段总耗时之和可能大于命令墙钟耗时。该文件不是
evidence,也不会通过运行遥测自动发送。启用运行遥测时,profile 还会以 `telemetry.config` 和
`telemetry.send` 单独显示本地配置读取与发送/flush 耗时,便于区分分析慢和命令退出慢。
