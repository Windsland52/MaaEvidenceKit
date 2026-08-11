---
name: maa-evidence
description: Extract and correlate traceable MaaFramework evidence with MaaEvidenceKit. Use when diagnosing Maa application issues from extracted log folders, MaaFramework logs, Maa project source, pipeline tasks, Interface configuration, focused source windows, task-flow views, or Sentry error clusters. Use the CLI selectively from an external harness, and combine application Sentry telemetry without claiming an Issue-to-event identity unless shared correlation evidence exists.
---

# Maa Evidence

Use MaaEvidenceKit as a deterministic evidence tool. Keep issue understanding, generic log reading,
Sentry investigation, source research, and diagnostic judgment in the host harness.

## Check the CLI first

Before the first MEK command, run `maa-evidence --version`. If it is missing, tell the user to
install the runtime with `npm install --global maa-evidence-kit@latest`; installing this Skill does
not install the npm package. Prefer the installed CLI over a checkout's `dist` files unless the
harness explicitly supplies a local development build.

Treat published MEK's updater as the version owner. It checks npm at most once every 24 hours,
hands the command to a newer stable runtime, and delegates managed Skill updates to the `skills`
CLI. Never guess or write Codex, Claude Code, Cursor, Pi, or other agent Skill paths. If the user is
migrating from `0.1.x` or installed this Skill from a local path, tell them to reinstall it once
from `https://github.com/Windsland52/MaaEvidenceKit` with `--skill maa-evidence --global`; this gives
the installer a remote source and lets it preserve the selected agent targets. Respect
`MAA_EVIDENCE_AUTO_UPDATE=0` and do not re-enable updates for an offline or reproducible run.

## Choose the smallest useful operation

- For MaaFramework runtime behavior, run `maa-evidence mla inspect <folder>`.
- For an exact pipeline task definition or forward execution path when task/controller/resource are
  already known, run `maa-evidence mse resolve <project> --task <name> --no-referencers`.
- For Interface bindings, resource/configuration diagnostics, compatibility, or a task investigation
  that also needs those preflight facts, run `maa-evidence mse inspect <project> --task <name>`.
- Use `maa-evidence inspect <folder>` only after the question requires both runtime and static
  evidence and both inputs are already available under the same material root. It emits
  `combined.pipeline_reference` to connect runtime failure nodes with static pipeline tasks, and
  `combined.recognition_pipeline_reference` to connect runtime recognition evidence with static
  MSE configuration. Recognition references carry controller/resource, definition locations, and
  `definitionEvidenceIds`; retrieve those `mse.task_definition` records when full MSE
  `effectiveConfig` is needed. For direct OCR nodes, inspect each static configuration's
  `ocrObservationComparisons`: it exposes source-backed observed text/boxes alongside static
  `expected`, `roi`, and `only_rec`. `equalsExpectedValue` is literal equality only, while
  `roiRelation` and `roiBoundaryContacts` are geometry only. The declared
  `configurationBasis: mse_static_effective_config` means this is not a reconstructed final runtime
  configuration; inspect applicable `mla.pipeline_override` evidence before using the comparison in
  a diagnosis. Do not infer a cause from the runtime score or boundary contact. Nodes absent from the
  supplied static snapshot emit a
  `combined.recognition_pipeline_reference_missing` warning.
  Check `staticResolutionStatus` and `incompleteReasons`: `not_found` means absence was observed in
  a complete static scope, while `incomplete` or `found_partial` means project/configuration
  truncation or missing definition links prevent an exhaustive claim. Corresponding
  `combined.*_reference_incomplete` warnings must not be treated as proof of absence.
  Automatic runtime-node correlation selects at most 128 unique names, prioritizing failure nodes,
  then failed and frequent recognition observations. Check
  `combined.runtime_node_resolution_truncated`, `statistics.mseRuntimeNodes*`, and
  `details.correlation.runtimeNodes` before assuming every runtime node was statically resolved.
  Automatic correlation resolves direct task definitions only (`depth: 0`, no referencers) to keep
  combined inspection bounded. Pass explicit MSE `depth` / `includeReferencers` options, or use
  `maa-evidence inspect --referencers --depth N`, only when execution-path context is needed.
  Matches carry `pipelineControllers`, `pipelineResources`, and `pipelineDefinitions`
  source locations. Failure references also carry `pipelineDefinitionEvidenceIds` for the MSE
  base definitions, plus `runtimeOverrideEvidenceIds` for overrides observed before that failure
  with the same artifact, node, and exact MaaFramework task ID. Read the referenced
  `mla.pipeline_override` records in sequence; keep `unscopedRuntimeOverrideEvidenceIds` separate.
  Check `runtimeOverrideResolutionStatus` and `runtimeConfigurationIncompleteReasons`. A
  `not_observed` status means no applicable override was extracted from the selected log, not that
  no override existed. `found_partial` or `combined.runtime_configuration_incomplete` means task
  scope, parsing, or truncation prevents a complete runtime-configuration claim. Combined evidence
  deliberately links base definitions and patches instead of materializing a final config because
  MaaFramework override parsing is not generic JSON deep merge. Nodes absent from the project emit a
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
- For application telemetry, use Sentry MCP or CLI directly from the host harness. Read
  [references/sentry.md](references/sentry.md) before querying or correlating Sentry. MEK does not
  receive Sentry credentials or query application Sentry projects. Aggregate titles and counts
  before drilling into groups, and preserve original groups when reporting an inferred signature
  family across native-stack, culprit, release, or localized-message variants.

Do not run the complete MEK inspection merely because the command exists.

## Resolve framework semantics only when needed

MEK reports runtime and static facts; it does not define MaaFramework protocol or API semantics.
Research those semantics in the host harness only when a diagnosis or proposed change depends on
an exact field meaning, default, merge rule, coordinate convention, algorithm mode, API behavior,
or version difference. Skip this step when the question only asks what the supplied evidence
records, or when the same semantic point is already supported by a version-matched original source
in the current investigation.

Use this bounded route:

1. Resolve the MaaFramework version or revision from the supplied material. Keep it unknown when
   the evidence does not identify it.
2. Read [references/maa-llm-wiki.md](references/maa-llm-wiki.md), then follow its bounded catalog
   discovery and query procedure. Stop at the first usable catalog and exact version route.
3. Treat MaaLLMWiki as navigation-only. Follow its version-pinned route to the original
   MaaFramework documentation, schema, public API, or source code and cite that original source for
   the semantic claim. A Wiki route is not behavioral evidence by itself.
4. If no matching catalog route is available, inspect the issue-version MaaFramework checkout or
   official versioned source directly. Never substitute current HEAD to explain historical
   behavior.
5. Compare the source-defined behavior with the runtime and static evidence. Source semantics show
   what the framework should do; they do not prove what happened in the supplied run.

Keep the lookup focused: use one catalog search and the smallest relevant original-source window
per unresolved semantic question, batch independent terms, and reuse a resolved route during the
investigation. Do not query MaaLLMWiki for every task or configuration field. When a proposed value
depends on application pixels, such as a click position or recognition ROI, also verify it against
the relevant screenshot and scale; framework semantics cannot validate application-specific
geometry.

## Respect the telemetry choice

Anonymous aggregate operational telemetry is enabled by default, including in CI and non-TTY use,
and never prompts. It excludes paths, arguments, logs, source, screenshots, and exception messages.
Respect `maa-evidence telemetry disable` and `MAA_EVIDENCE_TELEMETRY=0`; never re-enable telemetry
after the user or environment disables it. Original-material feedback remains separate and always
requires an interactive preview plus explicit `UPLOAD` confirmation.

Eligible inspection and follow-up commands attempt operational telemetry automatically. Do not
rerun work merely to manufacture telemetry, and do not treat telemetry controls as a diagnostic
submission. Aggregate telemetry cannot describe a specific extraction gap; use the feedback
workflow below when problem details matter.

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
3. Read the focused MLA result before acquiring source. Start each failure investigation from its
   `mla.failure_context`, then follow the referenced task/failure/image evidence IDs. Use its tasks,
   failed nodes, timestamps, recognition details, actions, warnings, and missing evidence to decide
   whether static evidence can answer a remaining question.
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
Operational telemetry delivery is best-effort and uses a 200ms command-exit budget, so do not treat
the absence of one event as evidence that a harness did not run MEK.

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

MLA 1.3.1 selects matching files and MEK filters facts afterward. Treat the
`mla_time_window_file_granularity` warning as a real resource limitation.
If `mla_directory_fallback_used` is present, MEK could not load a log directory as one combined
target and attempted its discovered MaaFramework logs individually. Read any separate
`mla_target_unreadable` entries and keep cross-file chronology or aggregation incomplete even when
the focused file facts were extracted successfully.

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

For each `mla.failure`, read the matching `mla.failure_context` before treating the failed task in
isolation. Its bounded `precedingTasks`, `concurrentTasks`, and `followingTasks` restore the selected
runtime chronology and link back to `mla.task` evidence. Check `counts` and `truncated`; a missing
task in a time-filtered or truncated context is not proof that it did not run. These relations are
temporal facts, not causality.
The summary names the linked current task and its status and counts other nearby failures, so it can
surface a succeeded root task beside failed subtasks. Read the structured task and failure references
before deciding which failure corresponds to the reported symptom.

`mla.recognition_detail` aggregates recognition events by node/algorithm/status and extracts
the detail generically by shape. Top-level `score` and `textCounts` select one representative per
recognition occurrence (`best`, then the first `filtered`/`all` candidate), so an upstream candidate
repeated across all three arrays is not counted three times. Use `candidateStages.all`, `.filtered`,
and `.best` for separate candidate totals, text counts, score distributions, and up to three
source-backed samples per stage; check `samplesTruncated` before treating samples as exhaustive.
Top-level and per-stage `textCounts` return at most the 64 most frequent values. Use
`textCountSummary.observations`, `.unique`, `.returned`, and `.truncated` for completeness. Top-level
`best` retains at most three samples and reports `bestTruncated`.
When `detail` is an array (e.g. Or), `childRecognition` retains at most eight distinct direct child
summaries. Use `childRecognitionTotal` and `childRecognitionTruncated` before assuming that list is
complete. Nested And/Or leaves are
available in bounded `descendantRecognition` entries with their recognition path, counts, and
source-backed best samples; check `descendantRecognitionTruncated` before assuming the list is exhaustive. OCR text,
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

`mla.pipeline_override` preserves non-empty MaaFramework override patches in source order. Treat
`patches` as observed override input, not as a serialized final node configuration. Use
`taskAssociation: task_id` only as an exact task link; keep `entry_only` and `none` scoped records as
possible context rather than silently assigning them to a run. Check
`details.selection.pipelineOverrides`, `mla_pipeline_overrides_truncated`, and
`mla_pipeline_override_parse_incomplete` before treating the patch sequence as complete. A missing
record can reflect log level or extraction scope and is not proof that no runtime override occurred.

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
Use `mla.failure_context.nearbyFailures` to open nearby failures' referenced images in order when a
leftover dialog or shared screen may span tasks. Compare pixels with the host's visual tool; MEK
does not perform visual similarity and chronology alone does not prove that images show one screen.

Treat task counts as observed records. If `mla_possible_mirrored_tasks` or
`mla.possible_mirrored_task_group` is present, inspect its task fingerprint, execution IDs,
namespaces, and source locations, but do not claim the records are unique executions or merge them
without instance or run correlation evidence. The namespace is only the MEK execution-ID prefix;
issue/run correlation remains the harness's responsibility.

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
and task filters are exact and case-sensitive. A node filter also matches retained
`childRecognition` and `descendantRecognition` names in `mla.recognition_detail`; inspect each
result's `nodeMatches` for the direct or nested recognition path. These nested lists remain bounded,
so check `childRecognitionTruncated` and `descendantRecognitionTruncated` before treating an empty
node search as proof of absence. Repeated values within one exact filter are OR
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
- Check failure-centered task chronology and nearby failure images before assuming each task failed
  independently; describe a prior-task trigger only when later application-state evidence supports
  it.
- Keep four layers distinct: the source snapshot's declared configuration, logged runtime override
  inputs, parameters or results observed during framework execution, and the application state
  observed after execution.
- Before describing a runtime node configuration, inspect applicable `mla.pipeline_override`
  evidence. When MSE is available, follow both `pipelineDefinitionEvidenceIds` and
  `runtimeOverrideEvidenceIds`; preserve patch order and report unresolved scope or missing runtime
  material instead of treating MSE `effectiveConfig` as the final runtime value.
- Do not treat recognition misses as failures unless MLA reports a deterministic terminal failure.
- Do not treat framework task success as proof of business success.
- Do not claim MSE static configuration caused runtime behavior without runtime evidence.
- Treat framework action success as an action-layer result, not proof that the intended application
  state transition occurred; verify it with later recognition, application diagnostics, or images.
- Keep competing explanations when evidence does not distinguish them.
- State missing evidence instead of guessing around it.

When Sentry is available, keep its error-cluster evidence separate from the single-run evidence
above. Use it first to measure recurrence, affected users, release concentration, and regressions.
Keep Sentry's original issue groups separate from host-inferred signature families and label the
latter as interpretation.
Do not infer that a Sentry event belongs to an Issue from timestamp and release alone. Require the
correlation levels and reporting rules in [references/sentry.md](references/sentry.md).

## Surface and report MEK product gaps

Classify a result as a MEK product gap only after comparing MEK output with the source material in
the same inspected scope. Treat these as product-gap candidates:

- a supported artifact contains a source-backed fact that MEK omits, misstates, or links to the
  wrong provenance;
- a documented command fails deterministically on valid supported input;
- MEK violates a documented resolution, completeness, truncation, or evidence-window contract;
- the smallest representative profile confirms unexplained MEK overhead worth investigating.

Do not report a MEK gap merely because the application behaved incorrectly or the desired answer
is absent. First exclude incomplete material, an incorrect time/task/controller/resource scope, a
wrong source revision, an explicitly unsupported artifact, an upstream limitation that MEK reports
accurately, and a harness interpretation mistake.

When a product-gap candidate remains:

1. Cite the source fact and the MEK output, warning, or missing evidence that demonstrates the
   discrepancy.
2. Tell the user that operational telemetry may already have recorded aggregate command usage but
   cannot contain the problem description, paths, arguments, logs, source, or screenshots.
3. Proactively offer a minimal feedback draft with a category, component, message, and whether an
   attachment is actually needed. Prefer message-only feedback when the cited facts are sufficient.
4. Wait for permission before invoking `feedback`; then preserve its interactive preview and
   explicit `UPLOAD` confirmation. Enabled operational telemetry is not feedback consent.

Use `blocker` for unusable commands or crashes, `bug` for incorrect or missing supported evidence,
`suggestion` for useful unsupported coverage or performance improvements, and `other` only when the
preceding categories do not fit.

```powershell
maa-evidence feedback `
  --category bug `
  --component mla `
  --message "The task transition at the cited interval was not extracted." `
  --attachment C:\path\to\maafw.log
```

The command displays a preview and requires the user to type `UPLOAD`. Never send original material
automatically or treat general telemetry consent as feedback or attachment consent. Even when the
gap is fixed in the MEK repository during the same task, state that aggregate telemetry did not
record the gap details and surface the separate feedback choice instead of silently assuming the
code change replaced consent.
