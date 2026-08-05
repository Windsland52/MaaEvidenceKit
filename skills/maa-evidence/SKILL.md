---
name: maa-evidence
description: Extract and correlate traceable MaaFramework evidence with MaaEvidenceKit. Use when diagnosing Maa application issues from extracted log folders, MaaFramework logs, Maa project source, pipeline tasks, Interface configuration, focused source windows, task-flow views, or Sentry error clusters. Use the CLI selectively from an external harness, and combine application Sentry telemetry without claiming an Issue-to-event identity unless shared correlation evidence exists.
---

# Maa Evidence

Use MaaEvidenceKit as a deterministic evidence tool. Keep issue understanding, generic log reading,
Sentry investigation, source research, and diagnostic judgment in the host harness.

## Choose the smallest useful operation

- For MaaFramework runtime behavior, run `maa-evidence mla inspect <folder>`.
- For pipeline, Interface, resource, or task definitions, run
  `maa-evidence mse inspect <project> --task <name>`.
- Use `--depth N` to control recursive execution-path expansion. The default two levels
  shows the requested task plus its immediate execution references and their direct targets.
  The graph contains only execution edges; template/color/locale references stay in evidence.
- When a failure node is known, pass it as `--task`; MSE also finds tasks that reference it,
  so the graph can show who led the flow into the failing node.
- MSE graph nodes include `desc`, `recognition`, `action`, `customRecognition`, and
  `customAction` summaries so the harness can judge node purpose without expanding full config.
- When both supported logs and project source are present, run `maa-evidence inspect <folder>`.
- For GUI/custom logs only, inspect them with host tools. Derive a timestamp or task name, then call
  MEK only if MaaFramework evidence is needed. Simple project-specific service logs usually need
  keyword search instead of a parser: prefer `rg` (e.g. `rg -i "err|failed" go-service.log`), fall back to
  `grep` when ripgrep is unavailable (or PowerShell `Select-String` on Windows). Keep these host-side
  findings out of MEK evidence.
- For application telemetry, use Sentry MCP or CLI directly. Read
  [references/sentry.md](references/sentry.md) before querying or correlating Sentry. MEK does not
  query application Sentry projects.

Do not run the complete MEK inspection merely because the command exists.

## Respect the telemetry choice

On first use, let the user decide whether anonymous operational telemetry should be enabled. An
interactive CLI asks directly. If the host runs commands non-interactively, check
`maa-evidence telemetry status`, explain the choice when it is `undecided`, and run
`maa-evidence telemetry enable` only after an affirmative answer. Never infer consent or enable it
on the user's behalf. CI and non-interactive MEK commands do not send operational telemetry.

## Prepare input

Extract ZIP and multipart material before invoking MEK. Pass the extracted folder rather than
choosing individual log files for MEK. If an archive part is absent, report it as missing evidence.

Use the issue-time project checkout when investigating a historical release. Do not use current
source to deny behavior from an older revision.

## Extract evidence

Prefer JSON for reasoning:

```powershell
maa-evidence mla inspect C:\path\to\materials --format json --output mla.json
maa-evidence mse inspect C:\path\to\project --task StartUp --format json --output mse.json
maa-evidence inspect C:\path\to\materials --format json --output inspection.json
```

When another source identifies the relevant interval, pass its wall-clock timestamps:

```powershell
maa-evidence mla inspect C:\path\to\materials `
  --from "2026-07-19 10:00:00" `
  --to "2026-07-19 10:10:00" `
  --format json
```

MLA 1.3.0 selects matching files and MEK filters facts afterward. Treat the
`mla_time_window_file_granularity` warning as a real resource limitation.

MLA output is focused by default: it keeps high-priority signals and each task's MLA-selected
highlights. Check `details.selection.signals` for selected and total counts. Add `--all-signals`
only when exhaustive ordinary and low-priority signal enumeration is necessary; do not pay that
output cost for routine triage.

## Read results

Inspect these fields before forming a diagnosis:

- `evidence`: deterministic facts with stable IDs and source locations.
- `missingEvidence`: absent logs, projects, time-window facts, or archive parts.
- `warnings`: truncation, compatibility, and upstream limitations.
- `artifacts`: selected and skipped local material.
- `details`: MLA execution facts or MSE static relations.

`mla.recognition_detail` records aggregate OCR text and recognition scores by node/algorithm/status.
Use them to distinguish a failed recognition from a low-confidence successful match, and to compare
OCR text observed at issue time with the expected pipeline text.

Recognition `mla.signal` entries include `candidateStatistics` and `terminalMatches`. Use them to
see which candidate nodes were evaluated, matched, or repeatedly unsuccessful inside a cycle.

When a task reports `succeeded` but its execution also contains `next_list_timeout`,
`action_failure`, or a repeated sequence still running at log end, MEK emits
`mla.task_anomaly`. Treat framework success as only a partial fact and investigate the anomaly
before concluding the business task succeeded.

MLA failure facts may reference standard `on_error` or `vision` images by local path. Open only the
referenced images needed for the question; MEK does not embed or interpret their pixels.

Treat task counts as observed records. If `mla_possible_mirrored_tasks` is present, do not claim
the records are unique executions and do not merge them without instance or run correlation evidence.

Request raw context only for a cited location:

```powershell
maa-evidence window --input inspection.json --evidence-id evidence-abc123
```

Use `maa-evidence view --input inspection.json --format text` when the host cannot render Mermaid.

## Form an evidence-backed interpretation

- Cite evidence IDs and their file/line/time/node locations.
- Separate reported symptom, directly observed mechanism, and suspected initiating trigger.
- Do not treat recognition misses as failures unless MLA reports a deterministic terminal failure.
- Do not treat framework task success as proof of business success.
- Do not claim MSE static configuration caused runtime behavior without runtime evidence.
- Keep competing explanations when evidence does not distinguish them.
- State missing evidence instead of guessing around it.

When Sentry is available, keep its error-cluster evidence separate from the single-run evidence
above. Use it first to measure recurrence, affected users, release concentration, and regressions.
Do not infer that a Sentry event belongs to an Issue from timestamp and release alone. Require the
correlation levels and reporting rules in [references/sentry.md](references/sentry.md).

## Report an extraction gap

If MEK omits evidence and host tools must reopen raw material, offer feedback only with the user's
permission:

```powershell
maa-evidence feedback `
  --component mla `
  --message "The task transition at the cited interval was not extracted." `
  --attachment C:\path\to\maafw.log
```

The command displays a preview and requires the user to type `UPLOAD`. Never send original material
automatically or treat general telemetry consent as attachment consent.
