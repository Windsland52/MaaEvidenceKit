---
name: maa-evidence
description: Extract and correlate traceable MaaFramework evidence with MaaEvidenceKit. Use when diagnosing Maa application issues from extracted log folders, MaaFramework logs, Maa project source, pipeline tasks, Interface configuration, focused source windows, task-flow views, or Sentry error clusters. Use the CLI selectively from an external harness, and combine application Sentry telemetry without claiming an Issue-to-event identity unless shared correlation evidence exists.
---

# Maa Evidence

Use MaaEvidenceKit as a deterministic evidence tool. Keep issue understanding, generic log reading,
Sentry investigation, source research, and diagnostic judgment in the host harness.

## Choose the smallest useful operation

- For MaaFramework runtime behavior, run `maa-evidence mla inspect <folder>`.
- For an exact pipeline task definition or forward execution path when task/controller/resource are
  already known, run `maa-evidence mse resolve <project> --task <name> --no-referencers`.
- For Interface bindings, resource/configuration diagnostics, compatibility, or a task investigation
  that also needs those preflight facts, run `maa-evidence mse inspect <project> --task <name>`.
- Use `maa-evidence inspect <folder>` only after the question requires both runtime and static
  evidence and both inputs are already available under the same material root. It emits
  `combined.pipeline_reference` to connect runtime failure nodes with static pipeline tasks.
  Matches carry `pipelineControllers`, `pipelineResources`, and `pipelineDefinitions`
  source locations; nodes absent from the project emit a
  `combined.pipeline_reference_missing` warning.
- Use `--depth N` to control recursive execution-path expansion. The default two levels
  shows the requested task plus its immediate execution references and their direct targets.
  The graph contains only execution edges; template/color/locale references stay in evidence.
- When a failure node is known, pass it as `--task`; MSE also finds tasks that reference it,
  so the graph can show who led the flow into the failing node.
- Reverse-reference expansion can be large for shared scene nodes. If the question only needs the
  requested node definition and its forward path, add `--no-referencers`. When the runtime
  controller and resource are known, pass `--controller` and `--resource` to avoid unrelated
  configuration combinations.
- MSE graph nodes include `desc`, `recognition`, `action`, `customRecognition`, and
  `customAction` summaries so the harness can judge node purpose without expanding full config.
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

Anonymous aggregate operational telemetry is enabled by default, including in CI and non-TTY use,
and never prompts. It excludes paths, arguments, logs, source, screenshots, and exception messages.
Respect `maa-evidence telemetry disable` and `MAA_EVIDENCE_TELEMETRY=0`; never re-enable telemetry
after the user or environment disables it. Original-material feedback remains separate and always
requires an interactive preview plus explicit `UPLOAD` confirmation.

## Prepare input

Extract ZIP and multipart material before invoking MEK. Pass the extracted folder rather than
choosing individual log files for MEK. If an archive part is absent, report it as missing evidence.

Use the issue-time project checkout when investigating a historical release. Do not use current
source to deny behavior from an older revision.

## Investigate issues in stages

Do not serialize independent network and local preparation work:

1. Fetch issue metadata, body, and comments first. As soon as attachment URLs are known, download
   independent files or multipart groups concurrently within host/network limits. In parallel,
   extract version, controller, resource, task, and time hints from issue text and supported local
   metadata. Do not make MEK interpret the issue text.
2. Verify all required archive parts, then extract archives in the harness. Start MLA as soon as the
   complete MaaFramework log directory is ready; do not wait for source checkout or MSE.
3. Read the focused MLA result before acquiring source. Use its tasks, failed nodes, timestamps,
   recognition details, actions, warnings, and missing evidence to decide whether static evidence
   can answer a remaining question.
4. Acquire the issue-time source and run MSE only when static definitions, expected recognition
   configuration, execution edges, or source locations are needed. Do not run MSE merely because a
   repository or source archive is available.
5. Use saved inspection results for follow-ups. Batch independent searches/views/windows instead of
   restarting the CLI for each evidence ID.

Suitable MLA-only questions include what ran, when it ran, observed OCR/template candidates, action
results, repeated runtime sequences, and framework task status. MSE becomes relevant when the answer
needs the issue-version node definition, configured threshold/text/template, controller/resource
resolution, or static predecessor/successor relation.

When MSE is justified:

- resolve the release/tag/commit from issue-time evidence and fail explicitly if it cannot be
  obtained; never silently substitute current HEAD;
- pass every known `--task`, `--controller`, and `--resource` value;
- begin with the smallest useful `--depth`;
- use `--no-referencers` for a shared node when only its definition and forward path are needed;
- expand referencers, depth, or additional tasks only after the focused result leaves a specific
  evidence gap.

Prefer `mse resolve` as the first static operation when MLA already supplies a task and the question
only needs its issue-version definition or forward execution path. It skips Interface preflight and
full artifact inventory, requires at least one task, and returns `details.mode: "resolution"` in a
normal `maa-evidence/v1` MSE inspection. It still inventories source files actually used by emitted
definitions/references, so evidence windows remain authorized. Do not use the absence of
`mse.interface`, `mse.task_binding`, or `mse.diagnostic` in this mode as evidence that those facts do
not exist; rerun `mse inspect` when they become relevant.

Run issue/source research, generic-log inspection, image interpretation, and Sentry queries in
parallel only when they are independently relevant. Do not block the primary MLA path on optional
Sentry or VLM work.

## Reuse host-side caches safely

Caching belongs to the harness, not MEK. Keep it outside the repository and never commit cached
issues, logs, screenshots, extracted source, or inspection JSON.

Use three separate caches:

- **Attachments:** index the original URL plus response metadata to an object stored by SHA-256
  content hash. Reuse only a complete object; preserve multipart membership and detect when a newly
  available part changes the material set. Do not use an issue number, filename, URL, size, or mtime
  alone as proof of identical content.
- **Source:** key by canonical repository identity and the resolved immutable commit SHA. A mutable
  tag may locate the commit, but the cached checkout must record and verify the resolved SHA. Never
  let a cache miss fall back to current HEAD.
- **Inspection:** key by the complete material-content manifest, normalized inspection options, MEK
  version, and—when MSE is used—the immutable source commit. Obtain the CLI version with
  `maa-evidence --version`; SDK callers can use `MAA_EVIDENCE_VERSION`.

The material manifest must change when an input file or archive part is added, removed, or changes
content. Normalize options as sorted structured data and include adapter choice, time range,
keywords, tasks, depth, syntax mode, controller/resource, all-signals, and referencer selection as
applicable. Do not reuse an MLA-only result for a combined query or a broad MSE result as proof that
a differently resolved controller/resource was inspected.

An inspection stores authorized artifact paths used by `window`. Keep its extracted material root
at those paths for the cache lifetime. If an artifact no longer exists at the recorded path, treat
the cached result as view/search-only or rerun inspection before requesting a source window; never
rewrite an artifact path to an uninventoried file. Cache only successfully completed output, retain
its warnings and missing evidence, and invalidate it when any key component changes.

These caches contain user material even though operational telemetry does not. Apply the harness's
normal access controls and retention policy, and never attach cached content to MEK feedback without
the same per-submission preview and explicit confirmation as the original files.

## Profile unexplained local latency

Do not enable profiling for every routine run. When a local MEK command remains unexpectedly slow,
rerun the smallest representative operation with a separate profile path:

```powershell
maa-evidence mla inspect C:\path\to\materials `
  --format json `
  --output inspection.json `
  --profile profile.json
```

The `maa-evidence-profile/v1` file contains only the MEK version, command category, success/error
status, wall-clock duration, and aggregate stage names/counts/durations. It does not contain paths,
arguments, evidence, or exception messages and is never sent through operational telemetry. Treat
it as local diagnostic output, not evidence. `mla.load_parse` isolates upstream log loading and
analysis; `mse.preflight` and `mse.resolution` may overlap because they run concurrently;
`inspection.load`, `render`, and `output.write` expose follow-up overhead. Concurrent stage totals
can exceed command wall-clock duration, so do not sum them as a serial critical path. When
operational telemetry is enabled, `telemetry.config` and `telemetry.send` separate local consent
lookup and send/flush time from extraction time.

Use the profile to choose a response rather than to form a diagnosis: narrow MLA only when the
question permits it, focus or defer MSE, batch follow-ups, or investigate local I/O. Do not cite
timings as facts about the reported Maa run.

## Extract evidence

Prefer JSON for reasoning:

```powershell
maa-evidence mla inspect C:\path\to\materials --format json --output mla.json
maa-evidence mse inspect C:\path\to\project --task StartUp --format json --output mse.json
maa-evidence mse resolve C:\path\to\project --task StartUp --no-referencers --format json --output mse-resolved.json
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
Complete totals are always in `statistics` (`signalsTotal`, `recognitionOccurrences`,
`repeatedNodeSegments`, `repeatedNodeTotalRepeatCount`) plus their `*Focused` counterparts;
do not derive totals from the focused signal list alone.

## Read results

Inspect these fields before forming a diagnosis:

- `evidence`: deterministic facts with stable IDs and source locations.
- `missingEvidence`: absent logs, projects, time-window facts, or archive parts.
- `warnings`: truncation, compatibility, and upstream limitations.
- `artifacts`: selected and skipped local material.
- `details`: MLA execution facts or MSE static relations.

`mla.recognition_detail` aggregates recognition events by node/algorithm/status and extracts
the detail generically by shape: `all`/`filtered`/`best` candidate counts and score distributions,
plus child-recognition summaries when `detail` is an array (e.g. Or). Nested And/Or leaves are
available in bounded `descendantRecognition` entries with their recognition path, counts, and best
samples; check `descendantRecognitionTruncated` before assuming the list is exhaustive. OCR text,
template scores, and ColorMatch counts are unified candidate fields; empty `detail` (e.g. DirectHit)
is skipped. Aggregated recognition records also attach a `source` locator to representative and best
samples; use that locator when a follow-up asks about one occurrence rather than the aggregate's main
source.
`mla.action_detail` aggregates `Node.Action.Succeeded` and `Node.Action.Failed` by node, action
type, status, and MaaFramework task ID. Its first/last representatives retain bounded action details
and source locators.
Treat action success as a framework-layer fact only; compare it with subsequent recognition and
task evidence before claiming the target UI changed.
Action-detail evidence is capped at 500 evenly spaced chronological groups per MLA target. Check
`mla_action_details_truncated` and the complete `statistics.actionOccurrences` / `actionDetailsTotal`
counts before treating the returned records as exhaustive.
Use filtered counts and best candidates to distinguish a failed recognition from a low-confidence
successful match, and to compare OCR text observed at issue time with the expected pipeline text.

Recognition `mla.signal` entries include `candidateStatistics` and `terminalMatches`. Use them to
see which candidate nodes were evaluated, matched, or repeatedly unsuccessful inside a cycle.
Repeated-node signals also include `exitCandidates`: candidates inside the cycle that were
evaluated but never matched, which pinpoints the recognition condition preventing loop exit.
Each evaluated candidate in a repeated-node cycle is also emitted as
`mla.cycle_candidate_outcome` with matched/unsuccessful counts and a
`persistentFailure` flag for candidates that were evaluated but never matched.
Persistent-failure candidates are also emitted separately as
`mla.cycle_exit_blocker` so the harness can identify which candidate blocked cycle exit
and read the observed evaluation counts without deriving conclusions in MEK.
Each `mla.cycle_exit_blocker` also carries `relatedRecognition`: a snapshot of that
candidate node's most recent `mla.recognition_detail` (best score/text, or the
child-recognition summary for Or-style nodes) so the harness can see the latest
observed recognition facts without re-joining evidence.

When a task reports `succeeded` but its execution also contains `next_list_timeout`,
`action_failure`, or a repeated sequence still running at log end, MEK emits
`mla.task_anomaly`. Treat framework success as only a partial fact and investigate the anomaly
before concluding the business task succeeded.
When a cycle candidate node had every evaluation fail (`unsuccessfulAttemptCount ===
evaluationCount` and `runningAttemptCount === 0`), `mla.task_anomaly` also marks
`all_evaluations_failed`. This states only that all attempts failed; it does not
infer whether max_hit or a manual disable caused the skip.

MLA failure facts may reference standard `on_error` or `vision` images by local path. Open only the
referenced images needed for the question; MEK does not embed or interpret their pixels.
Each failure-referenced image is also emitted as `mla.failure_image` evidence with its path and
associated node, so a visual harness can open the exact screenshot without re-parsing the log.

Treat task counts as observed records. If `mla_possible_mirrored_tasks` is present, do not claim
the records are unique executions and do not merge them without instance or run correlation evidence.

Request raw context only for a cited location:

```powershell
maa-evidence window --input inspection.json --evidence-id evidence-abc123
maa-evidence window --input inspection.json --evidence-id evidence-abc123 --format text
```

For a follow-up question about one fact, first select its stable ID from the JSON ledger, then use:

```powershell
maa-evidence search --input inspection.json `
  --kind mla.recognition_detail `
  --node DailyProtocolMissionsPick `
  --text "claim" `
  --limit 20
maa-evidence view --input inspection.json --evidence-id evidence-abc123 --format json
maa-evidence view --input inspection.json --evidence-id evidence-abc123 --format text
```

When one follow-up needs two or more independent queries against the same saved inspection, prefer
one batch so the CLI starts and parses the inspection only once:

```json
[
  { "id": "find", "operation": "search", "query": { "kinds": ["mla.recognition_detail"], "nodes": ["DailyProtocolMissionsPick"], "limit": 20 } },
  { "id": "fact", "operation": "view", "evidenceId": "evidence-abc123" },
  { "id": "context", "operation": "window", "query": { "evidenceId": "evidence-abc123", "before": 5, "after": 5 } }
]
```

```powershell
maa-evidence batch --input inspection.json --requests queries.json --output answers.json
```

Batch output preserves request order and optional IDs. A batch contains 1 through 100 requests and
fails as a whole on an invalid request or unresolved evidence/artifact ID. A request cannot consume
IDs returned by another request in the same batch; run search and dependent view/window operations
as two batches.

`search` reads the saved inspection only; it does not re-run MLA or MSE. Artifact ID, kind, node,
and task filters are exact and case-sensitive. Repeated values within one exact filter are OR
alternatives; repeated `--text` values are case-insensitive AND terms across primitive values in the
summary, source, and structured data. JSON field names are not searched. Time filters exclude
evidence without a source timestamp. Results are bounded indexes without
the potentially large `data` field; use the returned ID with `view` to retrieve the full record.

The single-evidence JSON output is the original structured record, including its deterministic
`data` and source locator. Use `window` separately when the raw source lines are needed. Unknown
IDs fail explicitly. `view --evidence-id` supports JSON and text; Mermaid is only for the complete
inspection view. Use `maa-evidence view --input inspection.json --format text` when the host cannot
render Mermaid.

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

## Report feedback

Offer feedback only with the user's permission. Classify it by severity with `--category`:
`blocker` (cannot use / crash), `bug`, `suggestion`, or `other` (default).

```powershell
maa-evidence feedback `
  --category bug `
  --component mla `
  --message "The task transition at the cited interval was not extracted." `
  --attachment C:\path\to\maafw.log
```

The command displays a preview and requires the user to type `UPLOAD`. Never send original material
automatically or treat general telemetry consent as attachment consent.
