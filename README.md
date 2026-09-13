# MaaEvidenceKit

面向 MaaFramework 的确定性证据提取与诊断辅助工具包。

A deterministic evidence extraction and diagnostic toolkit for MaaFramework.

MaaEvidenceKit(MEK)从 MaaFramework 日志和 Maa 项目中提取可定位的运行时与静态事实,
供 Codex、Claude Code 等外部 harness 按需使用。MEK 不包含模型、诊断 agent 或自动修复逻辑。

## 能力边界

| MEK 负责 | MEK 不负责 |
| --- | --- |
| 从完整材料目录中发现受支持的 MaaFramework 日志和 Maa 项目 | 理解 GitHub Issue、GUI/自定义日志、Sentry 数据或业务结果 |
| 通过 MaaLogAnalyzer(MLA)提取会话、任务、故障、结果与运行信号 | 输出根因结论 |
| 通过 MSE 公共包提取 Interface、资源、静态诊断、任务定义和节点引用 | 模型、诊断 agent 或自动修复逻辑 |
| 显式清点 issue-time checkout 中受界的 `AGENTS.md` 文本和 Skill 文件结构 | 解析、激活或遵循 checkout 中的 Skill |
| 生成稳定 evidence ID,以及文件、行号、时间、任务和节点定位 | |
| 输出 JSON、纯文本和可选 Mermaid | |
| 默认发送匿名聚合遥测(可关闭),并按需发送需明确确认的提取缺口反馈 | |

## 安装

需要 Node.js 22+。发布版用户先安装 CLI:

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

交互安装时优先使用默认的符号链接方式,使多个 agent 指向同一个受管副本。Skill 和 CLI 仍是两个
独立的分发物,安装 Skill 不会自动安装 npm 包;Skill 需从 GitHub 地址安装以保留远端来源,本地路径
安装只适合开发,无法被 `skills update` 跟踪远端版本。

发布版 CLI 在分析命令和 `--version` 启动时自动维护 CLI 与受管 Skill 的版本:至多每 24 小时
检查一次 npm `latest`,发现更高稳定版就让本次命令由该精确版本执行并同步一次 Skill;准备或网络
失败时沿用当前版本。`MAA_EVIDENCE_AUTO_UPDATE=0` 关闭更新,CI 默认关闭(可显式设为 `1`),
SDK import 不执行更新。机制与 `updates.json` 的说明见 [`docs/cli.md`](docs/cli.md),网络与
本地状态见 [`PRIVACY.md`](PRIVACY.md)。

开发本仓库时使用本地构建:

```powershell
$env:MAA_EVIDENCE_AUTO_UPDATE = "0"
pnpm install
pnpm build
node dist/cli/main.js --help
```

Skill 的目录、安装方式和本地开发说明见 [`skills/README.md`](skills/README.md)。

## 快速开始

调用方负责先解压 ZIP,再将完整文件夹交给 MEK。完整命令参考见
[`docs/cli.md`](docs/cli.md)。

```powershell
# 自动选择可用适配器
maa-evidence inspect C:\path\to\materials --format json --output inspection.json

# 只检查 MaaFramework 日志,可按时间缩小证据范围
maa-evidence mla inspect C:\path\to\materials --from 2026-09-01T20:12:00 --to 2026-09-01T20:22:00 `
  --format json --output inspection.json

# 先读摘要:artifacts / warnings / statistics 和各 evidence kind 的数量
maa-evidence mla inspect C:\path\to\materials --summary --format text

# 只检查指定项目任务
maa-evidence mse inspect C:\path\to\project --task StartUp --format text

# 清点 issue-time checkout 里的 AGENTS.md 与 Skill 结构(确定性,不解释内容)
maa-evidence repo-docs C:\path\to\issue-checkout --format json

# 从已有结果中读取某条证据及其来源上下文
maa-evidence view --input inspection.json --evidence-id evidence-abc123 --format text
maa-evidence window --input inspection.json --evidence-id evidence-abc123

# 每任务的“时间 事件 节点名”压缩时间线,可用 --task 过滤
maa-evidence timeline --input inspection.json --task Combat --format text
```

## SDK

```ts
import {
  inspect,
  inspectMla,
  inspectMse,
  inspectRepositoryDocs,
  searchEvidence,
  view,
} from "maa-evidence-kit";

const runtime = await inspectMla("C:/debug", {
  timeRange: { from: "2026-07-19 10:00:00", to: "2026-07-19 10:10:00" },
});
const project = await inspectMse("C:/project", { tasks: ["StartUp"] });
const combined = await inspect("C:/materials");
const repositoryDocs = await inspectRepositoryDocs("C:/issue-checkout");
const text = view(combined, { format: "text" });
const matches = searchEvidence(combined, {
  kinds: ["mla.recognition_detail"],
  nodes: ["DailyProtocolMissionsPick"],
  limit: 20,
});
```

完整 API、选项语义与后续追问建议见 [`docs/sdk.md`](docs/sdk.md)。

## 输出模型

核心输出使用 `maa-evidence/v1`,包含 `artifacts`、`evidence`、`missingEvidence`、`warnings`、
`statistics` 和 `details`。每条 evidence 都有稳定 ID 与来源定位;截断、缺失和上游限制都会作为
显式的 warning / missingEvidence 输出,不会静默丢失。

三条契约级保证,字段与截断语义细节见 [`docs/evidence-model.md`](docs/evidence-model.md):

- **不越界登记**:未支持文件、`repo-docs` 与图片只做有界登记——未支持文件给路径、大小与修改时间,
  `AGENTS.md` 给受界文本,`SKILL.md` 只登记路径与结构,图片按扩展名或文件签名登记格式;不推断
  语义,范围、固定上限与截断状态都在输出中公开,是否读原件由 harness 决定。
- **摘要只是等值事实**:被失败引用的图片带 `sha256:` 内容摘要,可按捕获画面分组失败,但不证明是
  同一次观测,记录与 evidence ID 也不会因此合并;没有摘要即“未判定”。
- **不伪造最终配置**:pipeline override 保留日志中可解析的原始 patch 序列,仅在唯一
  Context-to-task 映射时标记 task 关联,不做 JSON 深合并;作用域不明、截断和解析不完整显式暴露。

## Harness Skill

[`skills/maa-evidence/SKILL.md`](skills/maa-evidence/SKILL.md) 指导外部 agent 按需选择 MLA、MSE、
repo-docs、证据窗口和文本视图,而不是对每个问题都运行完整检查。核心约定:

- 从回答问题所需的最小操作开始;通用 GUI/自定义日志由 harness 自行解析,MEK 只清点不解释。
- Issue 调查走分阶段快路径:日志就绪即运行聚焦 MLA,确需节点定义、配置阈值或静态执行关系时才
  获取 issue-time 源码并运行聚焦 MSE,用 `--git-ref` 固定 issue 时点而不是当前工作树。
- 结论引用稳定 evidence ID 与文件/行/时间/任务/节点定位,并区分症状、机制与疑似诱因。
- Sentry 调查由 harness 直接使用 Sentry MCP/CLI 完成;MEK 不接收 Sentry 凭据也不查询应用项目。
  把 Issue 与 Sentry 事件认定为同一次发生,需要共享 `event_id`/`run_id` 之类的关联证据,不能只凭
  时间与版本;详细规则见
  [`skills/maa-evidence/references/sentry.md`](skills/maa-evidence/references/sentry.md)。
- 进阶语义按需阅读 `references/`:`full-guide.md` 覆盖 override 检索、镜像日志、字节相同副本、
  目录回退与三层缓存等规则,`reporting.md` 对接最终报告产出,`maa-llm-wiki.md` 查框架字段与
  API 语义。

## 遥测与反馈

核心检查离线运行。匿名运行遥测(仅聚合计数,不含路径、参数、用户名、硬件标识、日志、源码或
截图)默认启用,`maa-evidence telemetry status|enable|disable` 或 `MAA_EVIDENCE_TELEMETRY=0`
可切换;CI 与非交互环境同样默认发送,但从不弹出提示。

原始日志、截图和源码等附件**永不自动发送**:交互式 `feedback` 必须预览后输入 `UPLOAD`;非交互场景
先用 `feedback approve --out token.json` 让人类批准一次(15 分钟内有效、一次一用),再用
`feedback --token token.json` 提交,`feedback --preview` 只打印不提交。首次发送遥测时会在本地
配置目录创建随机安装种子,只向 Sentry 上报其单向 SHA-256 派生值(不读机器码、账户或硬件指纹),
用于估算活跃安装数与命令频率;`telemetry disable` 会删除该种子,多设备或重装会形成新 ID,因此
它不是精确人数。反馈分 `blocker` / `bug` / `suggestion` / `other` 四类,默认 `other`;完整字段
与保留策略见 [`PRIVACY.md`](PRIVACY.md)(20MB 仅为配额警告,不是 MEK 拒绝上限)。

## 架构

单包 TypeScript 项目,`src/` 下按域划分:`evidence/`(事实、来源、稳定 ID、原文窗口)、`mla/`(日志发现与
MLA 集成)、`mse/`(MSE 集成与静态关系图)、`repo-docs/`(仓库说明与 Skill 文件结构清点)、
`views/`(JSON、文本、Mermaid)、`feedback/`(同意状态、匿名遥测与分级反馈)、`cli/`(命令行入口),
外加 `profiling.ts`(本地旁路阶段计时)、`inspect.ts`(可选组合)与 `index.ts`(SDK 公共入口)。

依赖固定为精确版本,并只使用 MSE 的公开包。项目没有 Python、LangGraph、MCP 或内置模型。

## 文档与开发

文档:[`docs/cli.md`](docs/cli.md)(CLI 参考)、[`docs/sdk.md`](docs/sdk.md)(SDK 参考)、
[`docs/evidence-model.md`](docs/evidence-model.md)(输出模型)、[`CHANGELOG.md`](CHANGELOG.md)
(变更记录)、[`RELEASING.md`](RELEASING.md)(发布步骤与手工验收清单)。

发布前运行 `pnpm release:check`(= `pnpm lint` + `pnpm typecheck` + `pnpm test` + `pnpm build`,
再打包 tarball,在临时消费项目中安装并验证 SDK import 和 CLI 入口)。推送与包版本一致的
`v<version>` tag 后,GitHub Actions 通过 npm trusted publishing(OIDC)自动发布到 npm,不需要
长期 token。

真实 Issue 附件、日志、截图和本地上游仓库只用于本地验收,不得提交。
