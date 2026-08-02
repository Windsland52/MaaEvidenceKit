---
name: maa-evidence
description: Extract traceable MaaFramework runtime and static evidence with MaaEvidenceKit. Use when diagnosing Maa application issues from extracted log folders, MaaFramework logs, Maa project source, pipeline tasks, Interface configuration, or when a focused source window or task-flow view is needed. Use the CLI selectively from an external harness; it does not generate root-cause conclusions.
---

# Maa Evidence

Use MaaEvidenceKit as a deterministic evidence tool. Keep issue understanding, generic log reading,
Sentry investigation, source research, and diagnostic judgment in the host harness.

## Choose the smallest useful operation

- For MaaFramework runtime behavior, run `maa-evidence mla inspect <folder>`.
- For pipeline, Interface, resource, or task definitions, run
  `maa-evidence mse inspect <project> --task <name>`.
- When both supported logs and project source are present, run `maa-evidence inspect <folder>`.
- For GUI/custom logs only, inspect them with host tools. Derive a timestamp or task name, then call
  MEK only if MaaFramework evidence is needed.
- For application telemetry, use Sentry MCP or CLI directly. Use findings such as timestamp and task
  name to focus MEK; MEK does not query Sentry.

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

## Read results

Inspect these fields before forming a diagnosis:

- `evidence`: deterministic facts with stable IDs and source locations.
- `missingEvidence`: absent logs, projects, time-window facts, or archive parts.
- `warnings`: truncation, compatibility, and upstream limitations.
- `artifacts`: selected and skipped local material.
- `details`: MLA execution facts or MSE static relations.

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
