---
name: maa-diagnostic
description: Diagnose MaaFramework runtime failures from logs using MaaDiagnosticExpert deterministic tools. Use when analyzing MaaFramework log failures, task timeouts (next_list_timeout), action failures, recognition issues, repeated-node loops, or pipeline node failures. Provides structured evidence from MaaLogAnalyzer and guides diagnosis formation with traceable evidence IDs.
---

# MaaFramework Log Diagnosis

## When to use

Use this skill when you need to diagnose MaaFramework runtime failures from log files or log
directories. Typical triggers:

- A task failed with `next_list_timeout` or `action_failed`.
- Recognition repeatedly fails to match a UI element.
- A task appears stuck in a loop (same node repeating many times).
- A pipeline node or task outcome is FAILED.
- You need to trace a failure back to its log evidence.

Do not use this skill for non-MaaFramework logs, crash dumps (`.dmp`), or issues without
MaaFramework notify-based logs.

## Prerequisites

- The `maa-diagnostic-expert` CLI is available (`uv run maa-diagnostic-expert`).
- The TypeScript tool adapter is built (`pnpm build` in the MDE repository). If not built, `inspect`
  will report `mla_preflight_failed`.
- A MaaFramework log directory or file containing `maafw.log` with notify events (MaaFramework
  v5.x or later). Older logs without notify events are reported as `unsupported`.

## Workflow

### 1. Prepare the request

Create a request JSON describing what to diagnose and where the evidence lives:

```json
{
  "question": "Why did the task fail?",
  "artifacts": [
    {"path": "/path/to/log/directory", "kind": "directory"}
  ],
  "sources": [
    {"source_id": "project", "role": "project", "path": "/path/to/project/source"}
  ]
}
```

`artifacts` are the log inputs (a directory, a `.log` file, or a `.zip` archive). `sources` are
optional versioned code repositories. Use `cwd` only when Maa project markers are present;
otherwise pass an explicit path.

### 2. Inspect — deterministic evidence gathering

```powershell
uv run maa-diagnostic-expert inspect --request request.json --output inspection.json
```

This runs MaaLogAnalyzer's preflight (compatibility check, framework version) and runtime
inspection (sessions, tasks, failures, outcomes, signals), then synthesizes typed `Evidence`
records. The output `inspection.json` contains:

- `mla_preflights` — compatibility status and framework versions per artifact.
- `mla_runtime_inspections` — raw MLA runtime facts (sessions, tasks, failures, outcomes, signals).
- `synthesized_evidence` — ready-to-reason evidence records (see Evidence Interpretation below).
- `prepared.missing_evidence` — any evidence that could not be collected (e.g., unsupported log
  format, tool adapter failure).

### 3. Review the synthesized evidence

Read `synthesized_evidence` from the inspection output. Each item has:

- `id` — traceable identifier, format `mla-ri:{artifact_id}:{type}:{id}`.
- `kind` — what the evidence represents (see table below).
- `reliability` — `primary`, `secondary`, or `context`.
- `content` — human-readable summary of the finding.
- `source_path`, `line_start`, `line_end` — location in the source log.
- `task_id` — the MaaFramework task ID, when applicable.

Start with `primary` evidence (failures and failed outcomes), then check `secondary` signals for
context, then `context` summaries for the big picture.

### 4. Query raw log windows (optional)

When you need to see the raw log lines around an evidence item, create a query JSON:

```json
{
  "source_path": "/path/to/maafw.log",
  "line_start": 100,
  "line_end": 150,
  "reason": "Check notify events around the failure"
}
```

```powershell
uv run maa-diagnostic-expert query-evidence --prepared inspection.json --request query.json --output window.json
```

Queries are bounded to 400 lines and 40,000 characters. Use them to inspect specific log context,
not to dump entire logs.

### 5. Run the stub diagnosis (optional baseline)

```powershell
uv run maa-diagnostic-expert diagnose --request request.json --output diagnosis.json
```

This runs the full pipeline with a deterministic stub backend (no model credentials needed). The
stub identifies primary failures and forms basic conclusions citing evidence IDs. Use it as a
baseline; your own reasoning should go deeper (identify mechanism and trigger).

### 6. Form your diagnosis

Produce a `DiagnosisResult` with these fields:

- `status` — `complete`, `insufficient_evidence`, `not_applicable`, or `failed`.
- `summary` — one-paragraph overview of the diagnosis.
- `evidence` — the evidence items supporting the diagnosis.
- `conclusions` — each with `statement`, `evidence_ids` (must reference IDs in `evidence`), and
  `confidence` (0.0 to 1.0).
- `missing_evidence` — codes for evidence that was unavailable.

Copy evidence records unchanged from `inspection.json` or saved `EvidenceWindow` outputs. The
model or host agent may select and interpret evidence, but must not create IDs or rewrite evidence
content.

### 7. Validate

```powershell
uv run maa-diagnostic-expert validate-result --input diagnosis.json --inspection inspection.json --evidence-window window.json
```

Repeat `--evidence-window` for every raw window cited by the diagnosis; omit the option when no raw
windows were used. Validation checks every evidence record against the authoritative inspection
and window ledger. It rejects invented IDs, modified content, and omitted required
`missing_evidence` codes.

## Evidence Interpretation

| Kind | Reliability | What it means |
| --- | --- | --- |
| `runtime_failure` | primary | A task failed. `next_list_timeout` = recognition exhausted all next-list candidates without a match before timeout. `action_failed` = recognition matched but the action execution failed. |
| `runtime_outcome` | primary | A task outcome is FAILED. `pipeline_node` = a specific pipeline node failed. `task` = the task itself failed (may propagate from a node). |
| `recognition_activity_signal` | secondary | Recognition path activity: which candidates were tried, terminal matches, attempt counts. Reveals missing `wait_freezes`, low recognition coverage, or wrong templates. |
| `repeated_node_signal` | secondary | A node or node sequence repeated many times. May indicate a stuck loop, retry storm, or expected retry pattern. Check `pattern`, `duration_ms`, and `termination`. |
| `task_execution_summary` | context | Task-level statistics: node executions, recognition attempts, action failures, next-list timeouts. Helps assess overall task health. |
| `session_summary` | context | Session-level statistics: tasks executed, failures, signals. Helps assess overall session health and framework version. |

### Failure kind meanings

- **`next_list_timeout`**: The recognition tried every candidate in the node's `next` list and none
  matched before the timeout expired. Common causes: wrong ROI, changed UI appearance, wrong or
  outdated template image, insufficient `roi` coverage, missing `wait_freezes` before recognition,
  or the element genuinely not being on screen.

- **`action_failed`**: The recognition matched a candidate, but the subsequent action (click, swipe,
  key press, etc.) failed. Common causes: the element moved between recognition and action, the
  action target became invalid, or an action configuration error.

### Reading recognition signals

`recognition_activity_signal` shows the recognition path for a node. Key fields:

- `matched_candidates` — names of candidates that did match, with counts. If the failing node's
  candidates are not here, none matched.
- `terminal_matches` — which terminal nodes were reached. Absence of expected terminals indicates
  the recognition path didn't complete.
- `attempt_count` vs `unsuccessful_attempt_count` — high unsuccessful ratio suggests a systematic
  recognition problem, not a transient one.

### Reading repeated-node signals

`repeated_node_signal` shows loops. Key fields:

- `pattern` — the node sequence that repeated.
- `repeat_count` — how many times.
- `duration_ms` — total duration.
- `termination` — how it ended (`timeout`, `matched`, `still_repeating_at_log_end`, etc.).

A high `repeat_count` with `termination=still_repeating_at_log_end` suggests the task is stuck in a
loop at the time the log was captured.

## Diagnostic Rules

1. **Cite evidence IDs.** Every conclusion must reference at least one evidence ID from the
   `synthesized_evidence` list or a saved `EvidenceWindow`. Do not invent IDs or alter evidence.

2. **Separate symptom, mechanism, and trigger.** The symptom is what the user observed. The
   mechanism is the directly observed failure (e.g., `next_list_timeout` at node X). The trigger is
   the suspected initiating cause (e.g., wrong ROI, changed UI). Distinguish all three.

3. **Framework success is not business success.** A task completing without a framework-level
   failure does not prove the business goal was achieved. Check explicit task milestones and
   outcomes.

4. **Respect versioned source.** Do not use current source code to deny behavior from an older
   release. If the issue is from an old version, check that version's source. Use current source
   only to assess whether a fix exists.

5. **Report missing evidence.** If logs are incomplete, timestamps mismatch, or source is
   unavailable, report it as `missing_evidence` rather than guessing.

6. **Recognition failure may be expected.** MaaFramework retries recognition (traversing the next
   list) until a match or timeout. Individual recognition failures are not necessarily bugs — check
   whether the overall task succeeded or whether the next-list exhaustion or action failure is the
   real problem.

## CLI Reference

| Command | Purpose |
| --- | --- |
| `prepare` | Inventory artifacts and source metadata (no MLA calls). |
| `inspect` | Run MLA preflight + runtime inspection, synthesize evidence. |
| `diagnose` | Full pipeline with stub reasoning backend (model-free baseline). |
| `query-evidence` | Read a bounded raw-log window (max 400 lines). |
| `validate-result` | Compare a DiagnosisResult with its authoritative inspection/window ledger. |

All inputs and outputs are strict JSON contracts under `contracts/`. Use `--tool-adapter <path>`
or the `MDE_TOOL_ADAPTER_PATH` environment variable for a non-default adapter location.
