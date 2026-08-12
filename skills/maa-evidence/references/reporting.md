# Reporting evidence-backed diagnoses

Use this reference when turning collected evidence into a final diagnosis, GitHub Issue comment, or
repair handoff. The report is host-agent interpretation. Do not imply that MEK produced diagnostic
conclusions.

## Reporting rules

- Lead with the shortest useful conclusion. Keep raw excerpts and secondary evidence collapsed.
- Keep these layers distinct:
  - **Reported symptom:** what the user says happened.
  - **Observed mechanism:** what the evidence directly shows.
  - **Suspected trigger:** an explanation inferred from the evidence.
  - **Competing explanation:** a plausible alternative not yet excluded.
- Cite MEK evidence IDs together with source file, line, timestamp, task, or node locators. When the
  evidence came from outside MEK, cite its equivalent stable source locator.
- Use immutable source links when citing code. State explicitly when issue-time source is unavailable.
- Prefer three to five decisive facts over a chronological dump. Preserve missing, truncated,
  unreadable, unsupported, and unavailable material in the evidence boundary.
- Do not promote a framework success, recognition miss, static configuration, warning, or historical
  correlation into business success or runtime causality without further evidence.
- Give user actions only when they are safe and supported. Keep user workarounds separate from the
  maintainer's proposed fix.
- Omit empty optional sections. Add a complete translation only when the user or repository policy
  requires it.
- Never publish hidden reasoning, model warnings, tool transcripts, validation chatter, prompts, or
  partial drafts. A failed analysis uses the failure format below rather than leaking a draft.

## Default report

Adapt the headings and language to the investigation and repository conventions; the Chinese
template below is illustrative. Repository conventions may reshape the presentation but cannot
override the evidence-separation and traceability rules above. Do not fill space merely to preserve
the template.

```markdown
## 诊断摘要

- 用户现象：
- 观察到的失败机制：
- 疑似触发因素：
- 结论状态：已确认 / 高可能 / 证据不足

## 决定性证据

| Evidence ID | 观察事实 | 来源定位 |
| --- | --- | --- |
| `evidence-...` | ... | `artifact:line` / timestamp / task / node |

<details><summary>展开必要的原始片段</summary>

仅放支撑结论所需的有限上下文。

</details>

## 证据边界

- 缺失、截断或不可读的材料：
- 尚未排除的解释：
- 需要补充的证据：

## 给用户的建议

- 可立即尝试：
- 临时规避：
- 是否需要升级或等待修复：

## 给维护者的修复入口

- 相关任务、节点、配置或源码：
- 最小修改方向：
- 建议验证场景：

## 置信度

- 等级：高 / 中 / 低
- 判断依据：
- 什么新证据会改变判断：
```

If the evidence does not reproduce the reported symptom, say so in the summary. A successful sample
does not disprove the Issue; describe what the sample establishes and what it leaves unresolved.

## Optional repair handoff

Include this collapsed block only when another agent or maintainer will implement a fix. Keep facts,
constraints, and hypotheses visibly separate so the recipient can validate them independently.

````markdown
<details><summary>给修复者的可复制上下文</summary>

```text
现象：

已观察事实：
- [Evidence ID + source locator + bounded fact]

证据边界：
- [missing or unavailable material]

可能相关线索（待验证）：
- [hypothesis, not a fact]

修复约束与验证场景：
- [compatibility constraint or concrete regression scenario]
```

</details>
````

Do not turn the handoff into an instruction to accept the diagnosis uncritically. It should let the
recipient reopen every decisive fact and test the suspected trigger.

## Incomplete-analysis format

When a required artifact is missing, an archive is incomplete, or extraction cannot finish, publish
a bounded status instead of a root-cause report:

```markdown
## 分析未完成

- 已获取并验证：
- 缺失或阻断：
- 当前只能确认：
- 建议的补充材料或重试动作：
```

Do not assign a confidence level to a root cause that the available evidence cannot support.
