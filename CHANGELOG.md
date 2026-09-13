# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.7.0] - 2026-09-13

### Added

- Read issue-time MSE source from a git ref: `mse inspect --git-ref <ref>` resolves the ref to a
  commit and extracts that commit's tracked content into a temporary directory, so nothing is
  checked out or reset in the caller's worktree. The resolved commit is reported in
  `details.gitSource` (`commit`, `materializedRoot`, `fileCount`, `bytes`) so a result can cite the
  exact revision, a ref that starts with `-` is rejected before reaching git, and the result warns
  with `mse_git_ref_materialized` naming the extracted directory. Tracked symbolic links and
  submodule entries are skipped with warnings instead of being materialized as if they were regular
  content, and only tracked files exist at a ref, so untracked and ignored working-tree files are
  absent. `mse resolve` does not accept `--git-ref`.
- Record one human approval without an interactive prompt at submit time: `feedback approve` runs in
  a real terminal, prints the same preview, requires `UPLOAD`, and writes a token bound to a digest
  of the approved message, category, component, and attachment names and sizes; `feedback --token`
  then accepts exactly that payload once, within 15 minutes. A token that does not match the
  payload, has expired, or was already spent is refused instead of falling back to prompting, and the
  token file holds only the digest, an opaque random value, and the expiry. `feedback --preview`
  prints the exact payload and never submits, so what would be sent can be reviewed without a
  terminal.
- Type `mla.task_anomaly` classes with the new `MlaAnomalyCode` union (`next_list_timeout`,
  `action_failure`, `all_evaluations_failed`, `still_repeating_at_log_end`) instead of free strings,
  so a consumer can match a class without parsing display text and a project can keep its own benign
  list. The codes are compile-time checked, the matching count fields stay so "it happened" and "how
  often" remain separable, and MEK still reports which classes it observed without deciding that any
  of them is harmless. Both `MlaAnomalyCode` and `MlaTaskAnomaly` are exported through the SDK facade,
  so a consumer can name the field it matches on instead of repeating the literals.
- Let a batch `view` request resolve its fact from the same query object `search` accepts, instead of
  requiring an evidence ID that a preceding request in the same batch would have had to return. The
  result carries `matchCount` so a caller can tell a unique hit from an arbitrary first pick; an ID
  lookup still returns the bare evidence record, a request must use either `evidenceId` or `query`,
  and a query that matches nothing fails the batch rather than answering with an empty view.
- Carry a streaming SHA-256 content digest on failure-referenced images, on both the image artifact
  and `mla.failure_image`. A digest is a deterministic equality fact about bytes and makes no visual
  claim, so a harness can tell that two failures were separated by an unchanged screen. Only images
  failures actually reference are read, so the cost stays proportional to failures rather than to the
  artifact tree; a file that is empty, unreadable, or over the 256 MiB cap carries no digest and is
  never grouped with another, and `statistics.artifactContentDigests` keeps the count that did carry
  one. Byte-identical copies previously inflated any count taken from the artifact ledger, so
  statistics keep raw records in `artifacts` and add `byteIdenticalArtifactGroups`,
  `byteIdenticalArtifactRecords`, and `byteIdenticalArtifactRecordsDeduplicated`, with the
  `mla_byte_identical_artifacts` warning naming the digest groups. Records and evidence IDs are never
  merged, because identical bytes alone do not prove one observation.
- Extract pipeline overrides recorded in the C++ signature form such as
  `][virtual bool MaaNS::TaskNS::Context::override_pipeline(const json::value &)]`, not only the bare
  symbol; real material holds both forms, and matching only the bare one extracted nothing from a log
  whose override lines all used the signature. Extraction also detects override activity without
  depending on a marker name and reports `mla_pipeline_override_extraction_empty` when
  override-shaped lines were seen but nothing was extracted, so an unrecognized record format can no
  longer read as "no runtime override occurred".
- Describe the unsupported files discovery lists in `details.selection.omittedUnsupportedFiles`, with
  path, size, and modification time, paired with the `unsupported_files_not_parsed` warning. The
  inventory stays metadata-only: no content is sampled and no meaning is inferred.

### Changed

- Separate a node result from a task result in failure evidence: `termination` records how the node
  ended (`reco_timeout` or `action_error`) and `task_outcome` records the enclosing task's final
  status. A node can fail while its task still succeeds, which previously made failure counts
  overstate breakage, so `mla_failures_in_succeeded_tasks` and `failuresInSucceededTasks` surface the
  split while every record stays in place. The upstream parser reports no stop signal, so no
  `stop_requested` value is invented, and the exported termination union carries only the two values
  the parser can produce: an unreachable `closed_without_success` member is gone, so an exhaustive
  check no longer needs a branch for a value MEK never reports.
- Validate CLI options against the command that reads them. Options were checked against one global
  vocabulary, so `mla inspect --token foo` ran an inspection and silently dropped the flag while
  `search --summary` looked like it bounded the output. Each command now declares what it reads, a
  rejected option names the command and states why that option does not apply, all rejected options
  are reported together with everything the command accepts, `--summary` is limited to the
  inspection commands, and `--format` is no longer accepted by the commands whose output is always
  JSON. An unrecognized command is still reported as an unknown command rather than as an unknown
  option, and a typo still gets the closest-match spelling suggestion.
- Support Node.js 22 as the oldest major; `engines` required Node.js 24 although nothing needed it.
  `@types/node` is pinned to 22.20.2, matching the floor, so an API newer than Node 22 fails
  `pnpm typecheck` on every machine instead of only where a test happens to execute it, CI runs the
  suite on 22 and 24, and the published artifact is built on Node 22 rather than 24.
- Fail the suite when a `pnpm-lock.yaml` specifier disagrees with `package.json`
  (`tests/deps/lockfile.test.ts`). A stale lockfile could pass a local `pnpm install
  --frozen-lockfile`, because pnpm resolves specifiers from the manifest first and only checks the
  lockfile against the installed tree, so the failure surfaced on a clean CI checkout instead;
  `AGENTS.md` now records that a lockfile conflict is resolved by regenerating the lockfile, never by
  picking one side.
- Update `@sentry/node` to 10.74.0, `@maaxyz/maa-node` to 5.13.0, `oxlint` to 1.82.0, and `vitest`
  to 5.0.0; `@nekosu/maa-pipeline-manager` stays pinned to 1.0.14.
- Correct what the approval token guarantees in `PRIVACY.md` and the docs: the payload digest is
  unkeyed and the token path is caller-chosen, so the mechanism binds an approval to exact content
  and prevents replay, but it is a policy gate that keeps the human decision on the record rather
  than a cryptographic boundary, and attachment contents are not bound either, only their names and
  sizes.

### Fixed

- Stop the combined inspection from reporting the same discovery warning twice. It walks the input
  once before dispatching the adapters and an adapter walks the same input again, so one condition
  was reported as two byte-identical `unsupported_artifact_list_truncated` warnings and a caller
  counting warnings read one condition as two. Warnings that share a code but describe different
  conditions are still kept.
- Expose the flat `pipelineDefinitionEvidenceIds` on `combined.recognition_pipeline_reference`. A
  `found` recognition relation carried its definition links only inside
  `staticConfigurations[].definitionEvidenceIds`, while the failure relation exposes a flat field, so
  a consumer reading the flat field saw no link for a resolved node. The relation now reports the
  sorted, de-duplicated union and keeps the nested per-configuration lists.
- Return a usable range from a character-bounded evidence window. When `--max-characters` could not
  fit the first rendered line, `window` answered with `startLine` greater than `endLine`, an empty
  `text`, and `truncated: true`, which told a consumer nothing about where it looked; the first
  candidate line is now shortened to the remaining budget, so a window with content always reports
  `startLine <= endLine` and a non-empty text, while later lines keep their all-or-nothing behavior
  and a focus beyond the end of the artifact still returns the same explicit empty window.
- State that a link was not traversed instead of returning a silent zero. Artifact discovery and MSE
  project discovery both refuse to follow symbolic links and junctions, so a run whose only material
  sat behind one reported `scannedFiles: 0` with no explanation; each discovery now warns once with
  `artifact_links_skipped` or `mse_project_links_skipped`, naming the sorted relative paths (at most
  ten, plus the remaining count) and the total, while links are still never followed and their
  targets remain outside the artifact list.
- Check the `--git-ref` byte cap before reading any object. Reading ref content in one batch stream
  moved the cap's enforcement to after the content was already buffered, so a large ref could exhaust
  memory before the cap could reject it; sizes now come from `ls-tree -l` and the total is checked
  first, with the streaming check kept as a backstop for a blob that changes between the two git
  commands. A path containing a line break is refused rather than risking the wrong object over the
  line-oriented batch protocol; the guard is defensive and intentionally untested, because Git
  permits those paths but a portable fixture cannot reproduce one.
- Bound how long materialized `--git-ref` trees are kept. Materialized ref content is inspection
  output, not scratch: artifact paths point into it and evidence windows read it after the process
  exits, so it cannot be deleted on exit, and every run previously left a full copy of the project in
  the temporary directory forever. Each materialization now prunes directories older than an hour and
  keeps at most the four newest, recognizing only directories MEK created by its prefix; a directory
  must be both stale and beyond the retention count, and pruning ignores failures, so a concurrent
  run is never pruned out from under itself. A failed materialization removes its own partial tree,
  the returned materialization exposes `cleanup()`, and `pruneGitRefMaterializations()` reclaims on
  demand.
- Consume an approval token before attempting its upload. The token was documented as authorizing
  exactly one submission while the submit path never removed it, so one approval could be replayed
  for the whole 15-minute window and upload the same payload repeatedly. An interrupted or failed run
  now spends the approval instead of leaving a replayable one, and a token that cannot be removed
  refuses the submission rather than continuing with a live approval.

### Performance

- Read `--git-ref` content through a single `git cat-file --batch` stream instead of one `git show`
  process per file. On a real project that is thousands of processes: `mse inspect --git-ref` against
  MaaEnd (1604 tracked files, about 49MB) did not finish within 120 seconds, so the option was
  effectively unusable on the projects it exists for. Objects are split by the frame length each
  object reports, which also keeps binary content from being decoded as text; materialization dropped
  to about 2.3 seconds, and a full `mse inspect --git-ref` takes 42 seconds against 37 seconds for the
  same inspection without the option.

## [0.6.0] - 2026-09-03

### Added

- Add a per-task compressed node timeline to MLA inspections as `details.taskTimelines`
  (`maa-evidence-task-timeline/v1`), built through the pinned maa-log-tools node execution timeline.
  Each execution carries `time, event, node, matched recognition` entries classified into `success`,
  `failed`, `running`, recognition `timeout`, and `action-failed`, so a harness no longer rebuilds
  node sequences from raw logs. Task ids restart across framework sessions inside one bundle, so
  kernel timelines correlate to runtime executions by `(task_id, start_time)` instead of a task-id
  map that silently kept only the last occurrence, and the correlation stays correct under
  time-range focus. The new `maa-evidence timeline` command renders the timeline as JSON or text
  with an optional `--task` filter; non-MLA inspections are rejected as usage errors, and unknown
  timeline events are dropped at the view boundary.
- Embed a bounded `notableEvidence` block in inspection summaries: up to ten evidence identities
  per actionable kind (`mla.task_anomaly`, `mla.outcome` with failures first, cycle exit blockers,
  mirrored task groups, repeated node segments) plus `total`/`omitted`, deterministic in evidence
  order. Summaries previously reported these kinds only as statistics counts, forcing a discovery
  search round trip before any `view --evidence-id` follow-up.
- Export `UsageError` and `errnoCode` through the SDK facade so SDK consumers can distinguish
  caller-input failures from operational failures and classify them the same way operational
  telemetry does.

### Changed

- `--output` now always receives the complete inspection document, and `--summary` only decides
  what stdout shows. `mla inspect --summary --output F` previously wrote the bounded summary into
  F, which `view`/`search`/`window` cannot consume and which forced a second full inspection; one
  run now both bounds the first read and keeps the saved report drillable.
- Make usage errors actionable and classify them as `invalid_input`: missing input paths, missing
  inspection files, and missing `--output` directories fail with messages that name the offending
  path instead of raw `ENOENT` text, directory inputs and outputs are rejected explicitly, and
  caller-input validation (CLI argument checks, batch request parsing, unknown evidence IDs,
  archive and directory guards) throws `UsageError`. Operational telemetry classifies these
  expected failures as `invalid_input` instead of the `operation_failed` fallback; the operational
  telemetry schema version is bumped to 3 for the changed `error_category` semantics.

## [0.5.0] - 2026-09-01

### Added

- Match `mla.pipeline_override` target nodes in evidence search. `--node` previously covered only the
  top-level source node and retained recognition children, so an override that configured a node was
  unreachable by the node the harness was investigating, even though the record already carried
  `nodeNames`. Matches report the new `pipeline_override` relation.
- Export `patchPaths` on `mla.pipeline_override` evidence: a bounded, sorted, de-duplicated list of
  the overridden fields as `Node.field.subfield` strings. Override payloads carry their meaning in
  object keys, and evidence text search deliberately does not match JSON field names, so the field a
  run actually set was previously unsearchable. Paths are capped at 200 entries and depth 8, and
  `patchPathsTruncated` is set only when a path is actually dropped.
- Add `--summary` to the inspection commands and `summarizeInspection`/`renderInspectionSummary` to
  the SDK. The summary is a separate `maa-evidence-summary/v1` document holding artifacts, missing
  evidence, warnings, statistics, and the available evidence kinds with their counts, without the
  evidence ledger or the details payload that dominate a full result.
- Report identical observations that repeat across mirrored artifacts through the new
  `mla_cross_artifact_duplicate_observations` warning and the
  `crossArtifactDuplicateObservations` statistic. Records keep separate provenance and stay
  unmerged; the warning names the artifacts so a harness does not read one event as two.
- Suggest the closest known option when the CLI rejects an unknown one, including the common
  `--json`/`--text`/`--mermaid` mistake for `--format <value>`.

### Changed

- Document narrowing a known incident window with `--from`/`--to` and starting from `--summary` in
  the CLI reference, the README, and the host-agent Skill.

## [0.4.0] - 2026-09-01

### Added

- Bound how many files a directory target may contribute before it is handed to the upstream
  directory loader. `@windsland52/maa-log-tools` 2.0.0 removed its own entry-count limit, so an
  oversized directory now fails that single target with an explicit reason and falls back to the
  individually discovered log files, instead of walking the directory unbounded.

### Changed

- Update `@windsland52/maa-log-tools` to 2.0.0. That release removes `ArchiveLimits.maxEntries` and
  the `entry-count` `ArchiveLimitCode` from the public surface, and `loadNodeLogDirectory` no longer
  caps how many entries a directory may contribute. MEK never configured that limit, so no call site
  changed; artifact discovery stays bounded by MEK's own scanned-file limit, while the directory read
  inside the upstream loader is now bounded only by its byte budgets.
- Update `@nekosu/maa-pipeline-manager` to 1.0.14, which fixes content watching on macOS by using
  polling and moves the transitive `@nekosu/maa-locale` to 1.1.0. `@nekosu/maa-tasker` is already
  current and stays pinned to 1.0.0.
- Extend the host-agent Skill's Sentry reference with release-health triage: obtain a per-release
  session denominator before comparing versions, separate telemetry-schema and tag-coverage changes
  from real regressions, correlate a suspected regression with the application's own issue-time tag
  history, sample custom event context instead of assuming it is queryable, and verify Sentry CLI
  aggregates before ranking or quantifying with them.
- Route release or version health questions in the Skill entry point to the population-first Sentry
  path instead of the Issue-driven MLA/MSE path.

## [0.3.2] - 2026-08-12

### Added

- Add a random, locally stored anonymous installation identity for estimating active installations
  and command frequency without deriving an identifier from hardware or operating-system accounts.
- Add queryable telemetry schema, duration/evidence buckets, and deterministic error category/stage
  tags with versioned Sentry releases.

### Fixed

- Disable operational telemetry in MEK's own tests and release workflows so development failures
  do not inflate usage or failure counts.

## [0.3.1] - 2026-08-12

### Added

- Add an explicit `repo-docs` CLI/SDK inspection kind that exports bounded, source-backed
  `AGENTS.md` evidence and deterministic `SKILL.md` path structure without parsing or activating
  repository skills.

### Fixed

- Discover common image formats by file signature when an attachment has no filename extension.
- Constrain repository-document discovery with deterministic ordering, fixed scan/depth/list/text
  limits, checkout confinement, symbolic-link rejection, and authorized evidence windows.

### Changed

- Generalize the host Skill's Sentry and OCR triage guidance, keeping project-specific failure
  explanations conditional and evidence-backed.
- Add an on-demand host reporting template that separates reported symptoms, observed mechanisms,
  suspected triggers, evidence gaps, user guidance, and repair handoffs without exposing internal
  reasoning or partial drafts.

## [0.3.0] - 2026-08-11

### Added

- Search retained direct-child and descendant recognition nodes by exact name, with the matching
  relation and nested recognition path included in each result.

### Fixed

- Report a failed combined-directory MLA load as an explicit fallback warning when individual log
  inspection remains available, without duplicating the same file as directory-level missing
  evidence.
- Include the linked task status and nearby-failure count in failure-context summaries so a
  succeeded root task does not hide adjacent failed subtasks.

### Changed

- Refine the host-agent Skill to gather evidence progressively, identify exact or prefix-overlapping
  issue exports before counting reproductions, and keep original Sentry groups separate from
  host-inferred signature families.
- State explicitly that application Sentry queries and diagnostic interpretation remain external
  harness responsibilities; MEK does not receive application Sentry credentials.

## [0.2.0] - 2026-08-11

### Added

- Add a use-time updater that rate-limits npm checks, hands commands to a newer exact stable
  runtime, and delegates cross-Agent Skill synchronization to the `skills` CLI with offline and CI
  fallbacks.
- Extract ordered MaaFramework pipeline override evidence with conservative Context-to-task
  correlation, explicit truncation, and parse-completeness reporting.
- Link runtime failure nodes to both MSE base-definition evidence and exact task-scoped override
  evidence without presenting a generic JSON merge as the final runtime configuration.
- Add bounded failure-centered task chronology with stable task, failure, and failure-image evidence
  references.
- Compare direct static OCR expected values and ROIs with bounded source-backed runtime observations
  using explicit literal and geometry-only semantics.

### Changed

- Update `@nekosu/maa-pipeline-manager` to 1.0.13; `@nekosu/maa-tasker` remains pinned to its latest
  1.0.0 release.
- Update MaaLogAnalyzer tooling to retain nested-task runtime failures and their image evidence.
- Install the hosted Skill as a remotely managed global Skill so its installer, rather than MEK,
  owns Agent-specific paths and update targets.
- Expand the harness Skill's configuration workflow to distinguish static declarations, runtime
  override inputs, framework execution facts, and observed application state.

### Upgrade notes

- `0.1.x` carries no use-time updater, so publishing a newer package cannot upgrade it in place.
  Move such an install by hand once: rerun the CLI install and the global Skill install. After that
  the updater maintains both. Install the Skill from its GitHub URL, because a local-path install is
  a development setup that `skills update` does not track.

## [0.1.1] - 2026-08-08

### Fixed

- Resolve CLI entrypoint symlinks before comparing module URLs so globally installed commands run
  correctly through package-manager shims.

### Changed

- Add a portable TypeScript build command for environments without native TypeScript 7 support.
- Include the detailed CLI, SDK, and evidence-model documentation in the published package.

## [0.1.0] - 2026-08-07

### Added

- Initial public TypeScript SDK and `maa-evidence` CLI for deterministic MaaFramework evidence.
- MaaFramework log discovery, task/session/failure facts, cycle analysis, recognition and action
  evidence, bounded source windows, and image-reference metadata.
- Generic OCR, template, color, direct-child, and nested-recognition extraction with explicit
  completeness and truncation fields.
- Public MSE project preflight, focused task resolution, static node/reference graphs, and source
  locations through pinned public MSE packages.
- Combined runtime-to-static failure and recognition relations with explicit resolution status.
- JSON, text, and Mermaid views plus evidence `search`, `view`, `window`, and `batch` workflows.
- Local performance profiles, default aggregate operational telemetry with opt-out, and explicitly
  confirmed original-material feedback.
- Host-agent Skill describing evidence-first issue-analysis workflows and MEK/harness boundaries.

### Security

- Project-root confinement for MSE reads and inventoried-artifact confinement for evidence windows.
- Whitelist-only operational telemetry, disabled default PII, and mandatory preview/confirmation for
  feedback attachments.

[Unreleased]: https://github.com/Windsland52/MaaEvidenceKit/compare/v0.7.0...HEAD
[0.7.0]: https://github.com/Windsland52/MaaEvidenceKit/compare/v0.6.0...v0.7.0
[0.6.0]: https://github.com/Windsland52/MaaEvidenceKit/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/Windsland52/MaaEvidenceKit/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/Windsland52/MaaEvidenceKit/compare/v0.3.2...v0.4.0
[0.3.2]: https://github.com/Windsland52/MaaEvidenceKit/compare/v0.3.1...v0.3.2
[0.3.1]: https://github.com/Windsland52/MaaEvidenceKit/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/Windsland52/MaaEvidenceKit/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/Windsland52/MaaEvidenceKit/compare/v0.1.1...v0.2.0
[0.1.1]: https://github.com/Windsland52/MaaEvidenceKit/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/Windsland52/MaaEvidenceKit/releases/tag/v0.1.0
