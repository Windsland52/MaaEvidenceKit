# MaaEvidenceKit

面向 MaaFramework 的确定性证据提取与诊断辅助工具包。

A deterministic evidence extraction and diagnostic toolkit for MaaFramework.

MaaEvidenceKit(MEK)从 MaaFramework 日志和 Maa 项目中提取可定位的运行时与静态事实,
供 Codex、Claude Code 等外部 harness 按需使用。MEK 不包含模型、诊断 agent 或自动修复逻辑。

## 目录

- [能力边界](#能力边界)
- [安装](#安装)
- [快速开始](#快速开始)
- [SDK](#sdk)
- [输出模型](#输出模型)
- [Harness Skill](#harness-skill)
- [遥测与反馈](#遥测与反馈)
- [架构](#架构)
- [文档与开发](#文档与开发)

## 能力边界

| MEK 负责 | MEK 不负责 |
| --- | --- |
| 从完整材料目录中发现受支持的 MaaFramework 日志和 Maa 项目 | 理解 GitHub Issue、GUI/自定义日志、Sentry 数据或业务结果 |
| 通过 MaaLogAnalyzer(MLA)提取会话、任务、故障、结果与运行信号 | 输出根因结论 |
| 通过 MSE 公共包提取 Interface、资源、静态诊断、任务定义和节点引用 | 模型、诊断 agent 或自动修复逻辑 |
| 生成稳定 evidence ID,以及文件、行号、时间、任务和节点定位 | |
| 输出 JSON、纯文本和可选 Mermaid | |
| 默认发送匿名聚合遥测(可关闭),并按需发送需明确确认的提取缺口反馈 | |

## 安装

需要 Node.js 24+。发布版用户先安装 CLI:

```powershell
npm install --global maa-evidence-kit@latest
maa-evidence --version
```

如果要让 Codex、Claude Code 等 agent 使用 MEK,再从 GitHub 安装用户级 Skill。不要自行
拼接 agent 的 Skill 目录;`skills` CLI 会检测或询问目标 agent,并维护各 agent 所需的路径:

```powershell
npx skills add https://github.com/Windsland52/MaaEvidenceKit `
  --skill maa-evidence `
  --global
```

交互安装时优先使用默认的符号链接方式,使多个 agent 指向同一个受管副本。Skill 和 CLI
仍是两个独立的分发物,安装 Skill 不会自动安装 npm 包。

### 从 0.1.x 迁移

`0.1.x` 不包含更新启动器,无法通过发布新包获得自动更新能力。用户需要手动执行一次上面的
两条安装命令。Skill 必须从 GitHub 地址安装以保留远端来源;本地路径安装只适合开发,不能由
`skills update` 跟踪远端版本。

### 使用时自动更新

迁移后的发布版 CLI 在分析命令和 `--version` 启动时自动维护版本:

1. 至多每 24 小时查询一次 npm `latest`,将结果记入本地 `updates.json`。
2. 发现更高的稳定版本时,通过 npm 准备该精确版本并将本次命令交给它执行。全局安装保留为
   启动器,无需在运行中覆盖自身文件。
3. 每个 MEK 版本通过 `skills update maa-evidence --global` 同步一次受管的用户级 Skill。
   Agent 目录、符号链接或副本仍完全由 `skills` CLI 处理。

网络、npm 或 Skill 更新失败时继续使用当前可用版本。设置 `MAA_EVIDENCE_AUTO_UPDATE=0` 可
关闭 CLI 和 Skill 自动更新;CI 默认关闭,需要时可显式设为 `1`。SDK import 不执行自动更新。
完整网络与本地状态说明见 [`PRIVACY.md`](PRIVACY.md)。

开发本仓库时则使用本地构建:

```powershell
$env:MAA_EVIDENCE_AUTO_UPDATE = "0"
pnpm install
pnpm build
node dist/cli/main.js --help
node dist/cli/main.js --version
```

发布后可通过 `maa-evidence` 二进制调用。Skill 的目录、安装方式和本地开发说明见
[`skills/README.md`](skills/README.md)。

## 快速开始

调用方负责先解压 ZIP,再将完整文件夹交给 MEK。完整命令参考见
[`docs/cli.md`](docs/cli.md)。

```powershell
# 自动选择可用适配器
maa-evidence inspect C:\path\to\materials --format json --output inspection.json

# 只检查 MaaFramework 日志,可按时间缩小证据范围
maa-evidence mla inspect C:\path\to\materials --format json

# 只检查指定项目任务
maa-evidence mse inspect C:\path\to\project --task StartUp --format text

# 清点 issue 源码里的 AGENTS.md 与技能索引（确定性，不解释内容）
maa-evidence repo-docs C:\path\to\issue-checkout --format json

# 从已有结果中读取某条证据及其来源上下文
maa-evidence view --input inspection.json --evidence-id evidence-abc123 --format text
maa-evidence window --input inspection.json --evidence-id evidence-abc123
```

## SDK

```ts
import {
  inspect,
  inspectMla,
  inspectMse,
  resolveMse,
  searchEvidence,
  view,
} from "maa-evidence-kit";

const runtime = await inspectMla("C:/debug", {
  timeRange: { from: "2026-07-19 10:00:00", to: "2026-07-19 10:10:00" },
});
const project = await inspectMse("C:/project", { tasks: ["StartUp"] });
const combined = await inspect("C:/materials");
const text = view(combined, { format: "text" });
const matches = searchEvidence(combined, {
  kinds: ["mla.recognition_detail"],
  nodes: ["DailyProtocolMissionsPick"],
  limit: 20,
});
```

完整 API、选项语义与后续追问建议见 [`docs/sdk.md`](docs/sdk.md)。

## 输出模型

核心输出使用 `maa-evidence/v1`,包含 `artifacts`、`evidence`、`missingEvidence`、
`warnings`、`statistics` 和 `details`。每条 evidence 都有稳定 ID 与来源定位;截断、缺失和
上游限制都会作为显式的 warning / missingEvidence 输出,不会静默丢失。
常见 PNG、JPEG、GIF、WebP 与 BMP 即使附件名没有扩展名,也会通过文件签名确定性地登记为
`image` artifact；MEK 只登记格式与来源,不解释像素含义。

各 evidence 种类(`mla.failure_context`、`mla.recognition_detail`、`mla.action_detail`、
`mla.pipeline_override`、`mla.task_anomaly`、`combined.pipeline_reference` 等)的聚合规则、
统计字段与截断语义见
[`docs/evidence-model.md`](docs/evidence-model.md)。
`mla.failure_context` 摘要会显示当前关联任务的状态和附近失败数量,便于直接发现“根任务成功但
附近子任务失败”;结构化任务/失败引用仍是判断范围与时序的权威数据。

MLA 会保留 MaaFramework 日志中可解析的有序 pipeline override patch，并只在日志提供唯一
Context-to-task 映射时标记精确 task ID 关联。Combined failure relation 通过 evidence ID 同时
引用 MSE 静态基础定义和失败前的精确任务级 override；它不会用普通 JSON 深合并伪造最终运行
配置。作用域不明、解析不完整或截断会以独立状态、原因和 warning 暴露。

## Harness Skill

[`skills/maa-evidence/SKILL.md`](skills/maa-evidence/SKILL.md) 指导外部 agent 按需选择 MLA、
MSE、证据窗口和文本视图。Skill 不要求每个问题都运行完整检查;Sentry 调查也由 harness
直接使用 Sentry MCP 或 CLI 完成,MEK SDK/CLI 本身不接收 Sentry 凭据也不查询应用项目。
Sentry 默认用于聚类错误、衡量影响范围和版本趋势;宿主可把错误码与执行阶段一致的多个原始
group 标成“推断的签名族”,但必须保留原 group 和计数并明确这是解释。若
Issue/本地日志与 Sentry 没有共享 `event_id` 或隐私安全的 `run_id`,不得仅凭时间和版本将
两者认定为同一次事件。详细规则见
[`skills/maa-evidence/references/sentry.md`](skills/maa-evidence/references/sentry.md)。

Issue 调查采用分阶段快路径:harness 并发获取独立附件并提取 issue 中的版本/时间提示,日志
完整后立即先运行聚焦 MLA;只有剩余问题确实需要节点定义、配置阈值或静态执行关系时,才获取
issue-time 源码并运行聚焦 MSE。已知 task/controller/resource 必须传给 MSE,共享节点只需定义
和前向路径时使用 `--no-referencers`。多个后续证据查询使用 `batch`,不重复启动 CLI 和解析结果。
`search --node` 会精确匹配顶层节点和 inspection 中已保留的 And/Or 子识别节点,并通过
`nodeMatches` 返回匹配关系和嵌套路径;若识别详情标记了截断,空搜索结果不能证明节点不存在。
当 MLA 无法把日志目录作为一个组合目标加载、但仍能逐文件回退时,输出会用
`mla_directory_fallback_used` 警告说明跨文件聚合可能不完整;只有实际逐文件失败继续进入
`missingEvidence`,避免同一大文件同时产生目录级和文件级缺失记录。

Skill 同时定义由 harness 管理的三层本地缓存:附件按内容 SHA-256,源码按仓库与不可变 commit,
inspection 按完整材料清单、规范化选项、MEK 版本及可选源码 commit。CLI 可用
`maa-evidence --version` 提供缓存键版本。缓存不属于 MEK 核心,不得提交到仓库;若 cached
inspection 记录的 artifact 原路径已不可用,只能继续做 `view`/`search`,读取 `window` 前必须
恢复原路径或重新检查。
跨 Issue 比较时,harness 还会用提取后 artifact 哈希或完整日志的精确字节前缀识别重叠/延长
导出;保留各自来源,但同一运行只计一次。相似文件名、大小、任务或时间本身不足以去重。

## 遥测与反馈

核心检查离线运行。匿名运行遥测(仅聚合计数,不含路径、参数、用户名、日志、源码或截图)
默认启用,可用 `telemetry disable` 或环境变量 `MAA_EVIDENCE_TELEMETRY=0` 关闭:

```powershell
maa-evidence telemetry status
maa-evidence telemetry enable
maa-evidence telemetry disable
```

CI 和非交互环境默认发送聚合遥测,但从不弹出交互提示。运行遥测为 best-effort,每次命令使用
200ms 投递预算,超时不会改变命令结果;原始日志、截图或源代码等附件
**不会自动发送**,只能通过交互式 `feedback` 命令发送,并且每次都必须预览后输入 `UPLOAD`。
反馈按严重程度分为 `blocker`(无法使用/崩溃)、`bug`、`suggestion`、`other` 四类,默认
`other`。20MB 只是配额警告,不是 MEK 拒绝上限。完整说明见 [`PRIVACY.md`](PRIVACY.md)。

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

依赖固定为精确版本,并只使用 MSE 的公开包。项目没有 Python、LangGraph、MCP 或内置模型。

## 文档与开发

- CLI 参考:[`docs/cli.md`](docs/cli.md)
- SDK 参考:[`docs/sdk.md`](docs/sdk.md)
- 输出模型:[`docs/evidence-model.md`](docs/evidence-model.md)
- 版本变更记录:[`CHANGELOG.md`](CHANGELOG.md)
- 发布步骤及手工验收清单:[`RELEASING.md`](RELEASING.md)

发布前统一运行 `pnpm release:check`;该命令除完整检查外,还会打包 tarball,在临时消费项目中
安装并验证 SDK import 和 CLI 入口。推送与包版本一致的 `v<version>` tag 后,GitHub Actions
会使用仓库配置的 `NPM_TOKEN` 自动发布到 npm。

```powershell
pnpm install
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

真实 Issue 附件、日志、截图和本地上游仓库只用于本地验收,不得提交。
