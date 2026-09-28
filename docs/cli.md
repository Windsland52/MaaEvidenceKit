# MaaEvidenceKit CLI 参考

`maa-evidence` 命令行工具的完整命令与行为参考。快速上手与安装见仓库 [`README.md`](../README.md)。

## 选项按命令校验

每个命令只接受自己真正会读取的选项;把别的命令的选项用在这里会被**拒绝**,报错会**逐个选项给出原因**
并列出该命令接受的选项,而不是被静默忽略。例如:

```
Unknown option for mla inspect:
- --syntax-mode: this option belongs to mse inspect, mse resolve, or inspect
- --token: this option belongs to feedback
mla inspect accepts: --all-signals, --fields, --format, --from, --help, --keyword, --output, --profile, --summary, --to, --version, -h.
```

`--summary` 只被检查类命令接受(`mla inspect`、`mse inspect`、`mse resolve`、`repo-docs`、`inspect`)
——它只影响这些命令的 stdout,在 `view` / `search` 上没有任何效果,因此在那些命令上会被拒绝并说明原因。
`--git-ref` 仅 `mse inspect` 接受。完全不认识的选项(多半是拼写错误)仍由参数解析层报出,并给出
`Did you mean --output?` 这类建议。

这条规则的目的很简单:一个看起来生效、实际什么也没做的旗标,比直接报错更危险。

每个命令都有自己的 `--help`,列出该命令的用途、用法行、实际接受的选项以及默认值与上限,例如
`maa-evidence mla inspect --help`、`maa-evidence window --help`、`maa-evidence skill --help`;
不带参数或未知命令的 `--help` 才回落到顶层用法。help 中的选项列表由上面那张校验表生成,因此
不会出现"help 里写了、命令却不接受"的漂移。`inspect` 与 `mla inspect` 是两个不同代价的命令
(前者同时跑 MLA 与 MSE),两者的 help 各自说明了区别。

## 使用前提

调用方负责先解压 ZIP,再将完整文件夹交给 MEK。MEK 自行选择可由 MLA/MSE 处理的材料。
若整仓库同时包含根目录日志和 `debug` 等日志包,MLA 会逐包顺序解析并合并结果,不会把
包含 `node_modules` 的项目根目录直接交给日志加载器;单个日志包失败会记录为缺失证据。

## 发布版自动更新

通过 npm 安装的 CLI 在分析命令及 `--version` 启动时至多每 24 小时检查一次 npm `latest`。
发现更高稳定版后,它先验证该精确版本可启动,再把原命令原样交给新版本执行:接力子进程继承调用方
的 stdout 与 stderr,且**不设超时**(那条命令是调用方自己的,合法的长检查不能被更新器中途杀掉)。
npm 自身的 `npm notice` 行由 `--loglevel=error` 压制,而不是靠吞掉 stderr——吞掉就等于让接力后的
命令失败变成静默。只有 MEK 自己的探测与 Skill 同步子进程才使用捕获输出与 2 分钟预算;探测失败时,
它的 npm 输出在 `MAA_EVIDENCE_DEBUG=1` 下打印。全局安装作为稳定启动器保留,不会在当前进程中覆盖自身文件。准备或网络失败时
继续使用本地版本;已经成功接力后则保留新版本命令的退出码,不会重复执行旧版本。

探测与命令交接都以 `maa-evidence-probe` 别名 bin 运行(与 `maa-evidence` 指向同一入口)。
npm exec 会先按命令名解析子命令:装着旧全局版的机器上,`maa-evidence` 这个名字会命中旧 shim
并答出旧版本,实测探针因此恰恰在最需要更新的机器上永远失败。旧版本不发布这个别名,所以旧
shim 冒充不了这个名字;但 npm 的名字解析行为本身是未受控变量(实测于 npm 10-12:pinned 副本
带有该命令名时由 pinned 副本执行,不带时回退 PATH,安装失败则直接报错),机制的正确性不依赖
它:探测失败会显式报错,接力的实际执行者由下述 marker 校验兜底。

接力子进程在一切门禁之前,向配置目录原子写(临时文件加改名)一个
`handoff-<父进程 PID>-<时间戳>.json` marker,内含实际运行的版本、来源版本、子进程 ID 与
时间戳;写失败静默放弃,绝不阻塞命令。接力结束后,父进程读取该文件并立即删除:版本与目标
一致才算交付成功;版本不符或 marker 缺失——旧版本子进程没有这段代码,或 npm 把命令名解析到
了别处——一律按无法核验处理,在 stderr 打印一行诊断并走 24 小时节流的落后提示,命令自身的
退出码与 stdout 保持原样。持锁启动更新流程时,还会清扫配置目录中超过 24 小时的残留 marker。
marker 只含版本号、进程 ID 与时间戳,留在本地、永不上传(见 [`PRIVACY.md`](../PRIVACY.md))。

**更新工作只在交互式终端进行**:`--version`、分析命令默认仅在 stdout 是 TTY 时检查更新。
agent、harness、被重定向或管道输出的调用不探测、不接力、不写状态,因此不会为一次普通命令付出
`npm exec` 的秒级开销。`MAA_EVIDENCE_AUTO_UPDATE=1` 可在非交互环境显式开启,
`MAA_EVIDENCE_AUTO_UPDATE=0` 关闭;CI 默认关闭。无参数、`--help`、`telemetry`、`feedback` 和
`skill` 不触发更新;SDK import 也不触发。

某个版本的探测失败后,`updates.json` 会记住该版本与时间,24 小时内不再重试(否则一次失败会让
之后每条命令都重复等待一次注定失败的 `npm exec`)。这只是在同样不改变证据的前提下省掉重复等待。

更新无法交付时——探测失败,或接力子进程无法启动——CLI 在 stderr 打印一行落后提示:运行版本、
最新版本与确切的升级命令(`npm i -g maa-evidence-kit@<latest>`)。提示至多每 24 小时一次,
绝不写入 stdout,内容也只有版本号。MEK 不会自动执行升级命令。

每个 MEK 版本还会调用一次 `skills update maa-evidence --global`,同步受管的用户级 Skill;当已知
npm `latest` 与当前运行版本不一致(开发中的 checkout,或接力失败后仍在跑旧版)时**跳过**这一步
——从 npm 装上另一个版本的 Skill 再把它记成本版本已同步,正是已安装 Skill 悄悄落后一版的成因。
具体 Agent 目录、安装目标及符号链接/副本仍由 `skills` CLI 根据原安装记录处理,MEK 不直接访问
任何 Agent 的 Skill 目录。自动更新状态保存在 MEK 配置目录的 `updates.json`,只包含检查时间、
已知版本、失败的探测版本、落后提示时间与同步状态。

## 命令速查

CLI 与 Skill 的一致性比对与离线安装见下文 [`skill`](#skill读取安装或校验包内-skill)。

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

**`--format manifest` = 发现态短路(先看覆盖,再决定是否支付解析)。** 它只做发现层工作——遍历、
分类、对**全部** artifact 流式算 sha256——然后**停下**:不选 target、不 load 日志、不物化 evidence。
输出是一份 `maa-evidence/manifest-v1` 清单,其中 `input.extraction` 固定为 `"not-run"`,顶层**没有**
`evidence`/`statistics` 键。代价差异是数量级的:同一语料完整 `mla inspect` 约 10 秒 / 18 MB 报告,
清单约 0.45 秒 / 7.6 KB(实测见下)。因此它是"先看这个目录到底有什么、我漏了什么"的入口,而不是
事后说明。

```powershell
# 一条命令拿到覆盖清单:22 个 artifact,每个都有 64 位十六进制 sha256
maa-evidence mla inspect C:\path\to\materials --format manifest

# 同一份文档压成一行(便于逐字节比对或按字节计费的下游)
maa-evidence mla inspect C:\path\to\materials --format manifest-compact

# 事后复核:从已存报告出同一份清单,零语料访问
maa-evidence view --input inspection.json --format manifest
```

清单每行键集合固定为 `{path, sha256, sizeBytes, kind, status, rotation?, timeCoverage?, reason?, digestStatus?}`,
并且**不出现** `role`:该槽位由既有 `kind` 承担(`archive_part|interface|image|pipeline|other|maa_log|log`),
不新造平行枚举。`sha256` 是裸 64 位十六进制(报告里存的是 `sha256:<hex>`,清单把算法名放进键名,
省下每行 8 字节并让字典序等价于字节序)。`sha256: null` + `digestStatus` 表示这份摘要不是"相等"也
不是"存在",而是"读不到/空文件/超上限"。

`rotation` 与 `timeCoverage` 只出现在 MaaFramework 日志上,且**只从文件名导出**:

| 字段 | 语义 |
| --- | --- |
| `rotation.family` | 轮转族 = (目录, maafw 家族)。`ext/` 与 `cpp-algo/debug/` 各自一族,各自从 `index: 1` 起 |
| `rotation.index` | 族内序号,按文件名时间戳排序,**无时间戳的活文件排在末位** |
| `timeCoverage.from` | 同族紧前一个轮转边界(下界,**开**区间);最老一轮为 `null` |
| `timeCoverage.to` | 本文件自己的文件名边界(上界,**闭**区间);活文件为 `null` |
| `timeCoverage.basis` | 恒为 `"rotation-filename"`。这是**推断边界**(实测精度 ±25 ms),不是内容事实 |
| `fromKnown` / `toKnown` | 显式说"这个名字给不出端点",避免把"不知道"读成"没有" |

**`mtime` 绝不参与**,这是实测陷阱:`maafw.bak.<T>.log` 的 `T` 等于该文件**最后一行**日志的时间戳
(实测偏差 0–32 ms),而解压落盘的 22 个文件 `mtime` 全都是同一个时刻——用 `mtime` 只会给出自信的
错误答案。有回归测试守住这一点。

**这不是上游 CLI 的探针行为。** 上游 `MaaLogAnalyzer` 指一个目录时,只按字面量表取 `maafw.log`;
同目录下 5 个时间戳轮转(共约 130 MB)会被整体丢弃,而调用方不会看到任何提示。需要逐个文件探针,
或需要知道"这份目录到底覆盖了哪一段时间",就用 `--format manifest`——它把覆盖面本身变成输出。

### 覆盖标注:`coverage`

**每个**检查结果顶层都带 `coverage` 块(不只 manifest):

```json
{
  "coverage": {
    "artifacts": 22, "readForRuntimeFacts": 7, "notRead": 15,
    "byKind": { "image": 5, "log": 3, "maa_log": 7, "other": 7 },
    "byStatus": { "selected": 12, "skipped": 10 },
    "rotationFamilyLabel": "ext",
    "rotations": { "families": 2, "members": 7, "timestampedMembers": 5, "readMembers": 7 },
    "selected": 12, "skipped": 10
  }
}
```

词汇是精确的,避免与报告既有 `status` 撞车:

- `readForRuntimeFacts` := `kind === "maa_log" && status === "selected"` 的 artifact 数。**结构性判定**,
  不依赖任何 evidence,所以不可能与它所标注的 artifact 列表不一致。
- `notRead` := `artifacts − readForRuntimeFacts`。
- `byStatus` 保留报告自己的 `selected|available|skipped|unreadable` 词汇**原样**,与上面两项**不合并、
  **不互相改写。两者对不上是**有意义的信号**,不是矛盾——本语料里 `byStatus.selected: 12` 包含 5 张
  被选中的图片(它们不承载运行时事实),所以 `readForRuntimeFacts` 是 7 而不是 12。
- `rotationFamilyLabel` 是**本次检查**顶层轮转族的标签(被检查目录自身的名字,或单文件检查时该文件
  所在目录的名字)。检查是唯一知道输入是目录还是文件的一方,所以它把标签记下来,让清单渲染器不必去
  猜、也不必碰语料。
- 带 `--from/--to` 时 `readForRuntimeFacts` 随窗口变:全目录 7 → 窗口 `18:38–18:42:20` 为 4
  (`notRead` 15 → 18,`byStatus {selected:6, available:6, skipped:10}`)。

预算:覆盖标注 ≤ 2 KB;清单 ≤ 8 KB(pretty)/ ≤ 7 KB(紧凑)。**超限是 bug,不是截断理由**——清单永不
截断,也没有 `--max-lines` 之类的旋钮:一个装不下的清单说明它报的东西错了,而不是该少报几行。

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

# 读 issue 时点源码:按 git ref 检查,不动当前工作树
maa-evidence mse inspect C:\path\to\project --git-ref v2.28.0 --task StartUp --format json --output mse-at-ref.json
```

`mse inspect --git-ref REF` 按该 ref 的提交内容检查,而不是当前工作树。该 ref 会被解析并**物化到临时
目录**,因此不会在调用方的 checkout 里做任何 checkout/reset;解析出的 commit 记录在
`details.gitSource.commit`,便于引用。只有**被跟踪的文件**存在于某个 ref,所以工作树里未跟踪、
被忽略的文件不会出现。结果会输出 `mse_git_ref_materialized` warning,其中包含临时目录路径;
artifact 路径指向该临时目录,因此若临时目录已被清理,`window` 需要重新按该 ref 运行。

物化内容属于**输出而非临时垃圾**:artifact 路径指向它,`window` 在进程结束后仍会读取它,所以它不会
随进程退出被删除。回收采用**有界保留**:每次物化前清理**同时满足**"超过 1 小时"与"超出最新 4 个"的
目录——两个条件都要成立,因此并发运行不会因为存在多个物化目录就被删掉自己正在用的树;只清理 MEK
自己创建的目录(按 `mek-git-ref-` 前缀识别),不会碰其他文件。物化失败时**不会留下半成品**。
SDK 侧可显式释放:`materializeGitRef` 返回的 `cleanup()` 会删除该目录;`pruneGitRefMaterializations()`
可在需要时主动回收。

字节上限通过 `git ls-tree -l` 的元数据**在读取内容之前**预检,因此超限会在分配内存之前就被拒绝,
而不是先把内容读进内存再报错。单次 `--git-ref` 的物化总量上限为 **512 MiB**;以 `-` 开头的 ref 会在
交给 git 之前就被拒绝,因此 ref 不可能被当成 git 选项传入。

**已知未覆盖**:包含换行符的跟踪路径会被拒绝(`cat-file --batch` 是行协议,无法无歧义寻址),
但这条防护**没有测试**——git 允许这类路径,而 `git update-index --cacheinfo` 会拒绝、Windows 也不允许
该文件名,所以无法构造可移植 fixture。它是防御性判断,不是已验证行为。

读取使用单个 `git cat-file --batch` 流而不是每个文件一次 `git show`。这不是微优化:实测 MaaEnd 项目
(1604 个文件、约 49MB)按文件起进程会超时,改用批量流后物化耗时约 **2.3 秒**,整个
`mse inspect --git-ref` 为 42 秒(同项目不带 `--git-ref` 的普通检查为 37 秒)。字节按帧长精确切分,
二进制内容不会被按文本解码。

被跟踪的**符号链接不会被物化**(symlink 的 blob 存的是目标路径,写成普通文件会误represent)，
会输出 `mse_git_ref_symlinks_skipped` 与对应 `missingEvidence`;submodule 同样不物化并输出
`mse_git_ref_submodules_skipped`。

未通过 `--git-ref` 时,`mse inspect` 与 `mse resolve` 的行为不变(`--git-ref` 目前仅 `mse inspect`
支持)。

### `repo-docs`:清点 issue-time 仓库上下文

```powershell
maa-evidence repo-docs C:\path\to\issue-checkout --format json --output repo-docs.json
maa-evidence repo-docs C:\path\to\issue-checkout --format text
```

该命令不会自动并入普通 `inspect`。它按规范化相对路径确定性排序,在整个 checkout 中发现
`AGENTS.md`,并在 `.agents/skills`、`.claude/skills`、`skills` 三个已知根目录中递归发现
`SKILL.md`。`AGENTS.md` 输出最多 64 KiB 受界文本;Skill 只输出路径结构和文件大小,不解析
frontmatter 或正文,也不会激活仓库 Skill。

固定上限为 50,000 个目录项、64 个 `AGENTS.md`、256 个 `SKILL.md`、checkout 深度 32、
Skill 根内目录深度 8。输出区分已知列表遗漏与扫描提前结束造成的未知遗漏。符号链接不跟随;
越界、不可读、深度受限和扫描截断均显式报告。text 视图列出路径及 evidence ID;受界
`AGENTS.md` 文本通过 JSON 或 `view --evidence-id` 获取。harness 决定确有需要时,可用受授权的
`window` 显式读取已清点的 `AGENTS.md` 或 `SKILL.md`。`repo-docs` 只支持 JSON/text,不支持 Mermaid。

### `window` / `view` / `search` / `batch`:查询已有结果

`view --format manifest` 与 `mla inspect --format manifest` 共用同一个渲染器与同一份契约
(`src/views/manifest.ts`),因此两者不可能漂移;**零语料访问**是硬性质,不是实现细节:该路径不
resolve、不 stat、不打开 `input.path`,摘要直接取报告内的 `contentDigest`,所以报告指向的目录被改名、
移走或删除后,清单照样渲染。它的 `input.extraction` 是 `"reported"`(抽取发生在另一个进程、另一个时刻),
`generatedAt` 沿用报告自己的值,于是"同一份报告的清单"逐字节确定。

```powershell
# 读取某条证据附近的原始行
maa-evidence window --input inspection.json --evidence-id evidence-abc123

# 查看某条证据的完整结构化数据
maa-evidence view --input inspection.json --evidence-id evidence-abc123 --format json
maa-evidence view --input inspection.json --evidence-id evidence-abc123 --format text

# 从已存报告出覆盖清单:与 mla inspect --format manifest 同一渲染器,但零语料访问
maa-evidence view --input inspection.json --format manifest

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

# 只要几个字段,不写脚本解析整份 JSON;未知路径会报错并列出可用 key
maa-evidence view --input inspection.json --fields statistics --format json
maa-evidence search --input inspection.json --kind mla.failure `
  --fields totalMatches,returned,evidence.id --format json

# 文本视图有默认上限;--output 始终拿到完整渲染
maa-evidence view --input inspection.json --format text --max-lines 200
maa-evidence view --input inspection.json --format text --output full.txt

# 将已有结果渲染为通用文本或 Mermaid
maa-evidence view --input inspection.json --format text
maa-evidence view --input inspection.json --format mermaid
```

### `skill`:读取、安装或校验包内 Skill

```powershell
# 打印包内的 SKILL.md(默认 text);--format json 附带包版本与逐文件 sha256
maa-evidence skill --print
maa-evidence skill --print --format json
maa-evidence skill --print --file references/full-guide.md

# 把包内 Skill 写到 <dir>/maa-evidence/,不联网;目标为符号链接时拒绝写入
maa-evidence skill --install <agent-skill-dir>

# 比对 <dir>/maa-evidence/ 与当前 CLI 自带的那份:逐文件 same / different / missing
maa-evidence skill --check <agent-skill-dir>
```

该命令永远读**当前包自带**的副本。Skill 正文**不写版本号**:写死的版本号每发一次版都要改,
而且对"从仓库而不是从 npm 包安装的副本"仍然是错的;所以判定方式是比较字节而不是比较数字。
`--check` 给出逐文件结论(另附 payload 未包含的文件,如 agent 自己的元数据,不计为漂移),
并跟随 `skills` CLI 为 agent 目标创建的目录符号链接;命令退出码始终为 0,结论读 `match`。
被别的工具重写过的副本(例如行尾不同)会报 `different`;某次发版没动过的文件仍是 `same`,
即使包版本已经前进——因此发版本身不需要改 Skill 任何一行。

受管安装(符号链接、多 agent 目标)仍应使用 `npx skills add` / `npx skills update`;
`--install` 面向自己管理副本的 harness。

### `telemetry`

```powershell
maa-evidence telemetry status
maa-evidence telemetry enable
maa-evidence telemetry disable
```

### `feedback`:可选的产品反馈

```powershell
# 只打印将要发送的确切 payload,不提交(无需终端)
maa-evidence feedback --message TEXT --category bug --component mla --preview

# 人类在真实终端里批准一次,写出 token
maa-evidence feedback approve --message TEXT --category bug --component mla --out token.json

# 提交时用该 token 代替交互确认;token 过期或不匹配会被拒绝
maa-evidence feedback --message TEXT --category bug --component mla --token token.json
```

`feedback approve` 是交互步骤:它打印与提交相同的预览并要求输入 `UPLOAD`,然后**写 token 而不是
提交**。token 有效期 15 分钟,并绑定到"被批准的消息、类别、组件、附件名与附件大小"的摘要;
提交成功消费后**立即删除**,因此一个批准只授权一次上传。不匹配、过期或已被消费的 token 一律拒绝,
不会静默退回交互提示。token 文件只包含摘要、一个不可读的随机值和时间戳,**不含消息正文或原始素材**。

该机制**绑定内容**（批准过的措辞/类别/附件集合不能被换成别的,且不能重放），但它**不是本地进程
无法绕过的密码学边界**:摘要无密钥、token 路径由调用方指定,任何能运行 `maa-evidence` 并在同一文件
系统写入的进程都能构造等价批准。MEK 将其定位为**把人类决定留在记录里的策略闸门**,而非强制边界。
另外**附件内容不在绑定范围内**（摘要只覆盖附件名与大小），且附件字节不经 `beforeSend` 清洗。

`--preview` 可让 agent 把确切 payload 展示给人类审阅,且不提交。

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
当前 MLA 2.1.1 仍可能完整读取一个匹配的日志文件;输出会明确携带该限制,避免把它误解成
真正的行级流式裁剪。
如果组合目录目标超过上游资源限制、但发现的 MaaFramework 日志仍可逐文件检查,
`mla_directory_fallback_used` 会保留“跨文件聚合可能不完整”的警告,逐文件失败则单独保留为
`mla_target_unreadable` missing evidence。目录失败不会再为同一个不可读文件重复生成缺失记录。

## 先看摘要,再取证据

完整 inspection 的体积由 evidence 账本和 `details` 主导,直接打到 stdout 往往会被上游按尾部
截断,反而丢掉 `artifacts` / `warnings` / `statistics` 这些必看字段。

```powershell
# 只输出 artifacts、missingEvidence、warnings、statistics 和各 evidence kind 的数量
maa-evidence mla inspect C:\path\to\materials --summary --format text

# 完整结果落盘,再用 search / view / window 钻取
maa-evidence mla inspect C:\path\to\materials --format json --output inspection.json
```

`--summary` 输出独立的 `maa-evidence-summary/v1` 文档(不含 `evidence` 与 `details`),
其中 `evidenceKinds` 直接给出可用的 `--kind` 取值及数量,便于规划后续 `search`。
该文档不是 inspection 结果,不能作为 `--input` 回传。

已知事发时间时先用 `--from` / `--to` 收窄窗口:实测一份 16 MB 的产物在收窄到十分钟窗口后
降到约 8%,而结论所需证据完全保留。

读回单个事实用 `view --evidence-id` 或 `window`;只要统计与计数用
`view --fields statistics`。实测的教训:直接 `view --format json` 打整份文档会一次返回数万字符,
而投影或窗口预算能把同样的结论压到几百字符。

## 查询命令语义

`view --evidence-id` 支持 JSON 和 text;`window` 默认保持 JSON,也支持 `--format text`。
未知 evidence ID 会明确报错,不会静默返回空结果。

`--fields` 把 JSON 输出投影到点分路径上,可用于检查类命令与 `view`、`window`、`search`、
`batch`、`timeline`。它保持 JSON 合法与原有嵌套形状(路径穿过数组时对该数组的每个元素应用剩余
路径,**没有下标语法**),并且要求**每个**请求的路径都能解析:任一字段不存在就整体报错并列出该层
可用的 key,而不是悄悄少给一个字段——少给的字段看起来会像"报告里没有这个事实"。同一个数组上的两条
路径还可能各自选中**不同数量**的元素(没有该路径的元素被省略),这种合并会报错并点名冲突的
两条(或多条)路径、两边的元素数与所在位置:按下标合并会把值贴到别的元素上,只保留一边又会静默少给字段;确实需要两者时分两次投影。
它只作用于 JSON:`--format text|mermaid` 下会报错,而不会被静默忽略。

文本输出用预算而不是投影来收敛:`window` 与 `view` 默认 **400 行 / 40000 字符**(也是上限),
可用 `--max-lines`、`--max-characters` 调整,触顶时在输出里附上明确的截断标记
(`window` 的 `truncated: true`、`view` 的 `… truncated: N of M lines ...`)。JSON 输出**永不截断**,
所以给 JSON 传这两个选项会直接报错并指向 `--fields`;`--output FILE` 始终收到完整渲染,不受 stdout
预算影响。
`window` 的行数与字符预算同时受上界约束;当 `--max-characters` 连第一条候选行都放不下时,窗口返回
该行按预算截断后的前缀并标记 `truncated: true`,因此有内容的窗口不会退化成 `startLine` 大于
`endLine` 的空范围。

`search` 只读取已有 inspection JSON,不重新解析原日志。`--kind`、`--node`、`--task`
和 `--artifact-id` 执行区分大小写的精确匹配;可重复传入同一选项表示任一值均可。
`--node` 除顶层 source node 外,也精确匹配 `mla.recognition_detail` 中已保留的
`childRecognition` / `descendantRecognition` 节点,以及 `mla.pipeline_override` 覆盖到的
`nodeNames`;结果的 `nodeMatches` 会以 `source` / `recognition_child` /
`recognition_descendant` / `pipeline_override` 标明匹配关系及路径。嵌套列表仍受 inspection 的
既有上限约束,当对应 `*Truncated` 为 true 时,搜索结果不能证明未返回的节点不存在。
重复的 `--text` 条件执行大小写不敏感的 AND 匹配,搜索 evidence 的摘要、source 和
结构化 data 的原始值,不匹配 JSON 字段名。覆盖载荷的含义恰恰在 key 上,因此
`mla.pipeline_override` 额外导出 `patchPaths`(如 `EatCandyStart.attach.fast`),
让被覆盖的字段名以普通值的形式可被 `--text` 命中,而无需放宽“不匹配字段名”这条规则。
`--from` / `--to` 只匹配带 source timestamp 的 evidence。结果默认最多返回 50 条索引、
上限 500 条,并明确给出 `totalMatches` 和 `truncated`;完整 data 仍通过 `view --evidence-id` 获取。

`batch` 用一次 inspection 加载执行多个 `search`、`view` 和 `window` 请求,适合一次追问需要
读取多条已知证据时避免重复启动 CLI 和解析大型 JSON。`--requests` 指向一个 JSON 数组:

```json
[
  { "id": "find", "operation": "search", "query": { "kinds": ["mla.task"], "limit": 20 } },
  { "id": "fact", "operation": "view", "evidenceId": "evidence-abc123" },
  { "id": "fact-by-query", "operation": "view", "query": { "kinds": ["mla.failure"], "limit": 1 } },
  { "id": "context", "operation": "window", "query": { "evidenceId": "evidence-abc123", "before": 5, "after": 5 } }
]
```

输出使用 `maa-evidence-batch/v1`,保持请求顺序和可选 `id`。每批限制 1 到 100 项;输入字段会
严格校验,任一项非法、ID 未知或窗口读取失败时整批明确失败,不返回容易误用的部分结果。
`view` 请求要么给 `evidenceId`,要么给与 `search` 相同的 `query`,**不能同时给**;按 `query` 解析时
结果额外带 `matchCount`,用于区分唯一命中与“任意第一条”,而 `query` 匹配为空会让整批失败,不会返回
空 view。批次仍不支持引用同批 `search` 动态返回的 ID;这类依赖用 `view` 的 `query` 形式表达,或先
批量搜索、再用第二批读取事实和窗口。

## `--profile`:本地阶段计时

`--profile FILE` 可用于 `mla inspect`、`mse inspect`、`mse resolve`、`repo-docs`、组合 `inspect`
及已有结果的查询命令。
它输出本地 `maa-evidence-profile/v1` 旁路 JSON,聚合 discovery、MLA load/parse、MSE
preflight/resolution、inspection load、render 和 output write 等阶段的 `count`、总耗时与最大耗时。
profile 与 inspection 输出必须使用不同文件;失败命令也会写 `status: error`,但不会写异常消息、
路径或命令参数。并发阶段会重叠,所以各阶段总耗时之和可能大于命令墙钟耗时。该文件不是
evidence,也不会通过运行遥测自动发送。启用运行遥测时,profile 还会以 `telemetry.config` 和
`telemetry.send` 单独显示本地配置读取与发送/flush 耗时,便于区分分析慢和命令退出慢。
