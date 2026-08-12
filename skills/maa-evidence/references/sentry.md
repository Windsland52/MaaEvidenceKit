# Sentry investigation

Use application Sentry telemetry as a separate evidence source owned by the host harness. Do not
confuse it with MaaEvidenceKit's optional product telemetry and extraction-gap feedback. Every
application-data query in this workflow is executed by the external Sentry CLI or MCP client. The
MEK SDK and CLI neither receive Sentry credentials nor query application projects.

## Start with the aggregate view

1. Identify the Sentry organization, project, available datasets, retention window, and fields.
2. List recent error groups with available counts, affected-user counts, first/last seen, release,
   and environment.
3. Compare releases and time periods to find spikes and groups that may fragment one error class.
4. Rank groups by prevalence and relevance to the reported symptom before opening events.

Prefer aggregate Sentry facts for questions such as "Is this widespread?" and "Which releases are
affected?". Issue attachments and MEK evidence normally contain more detail for one execution.

Example CLI discovery, when the installed Sentry surface supports these commands and fields:

```powershell
sentry project list <org>/ --fresh --json
sentry issue list <org>/<project> --period 7d --sort date --limit 100 --fresh --json
sentry explore <org>/<project> `
  --dataset errors `
  --period 7d `
  --field title `
  --field release `
  --field environment `
  --field 'count()' `
  --field 'count_unique(user)' `
  --fresh --json
```

With Sentry MCP, use the equivalent structured project, issue-search, aggregate, and event-detail
tools. Use only fields actually present in the project.

## Release-scoped triage

When the question is "what is broken in release X", scope by release when supported and rank by
frequency:

```powershell
sentry issue list <org>/<project> --period 30d `
  --query 'release:"<release>" is:unresolved' `
  --sort freq --limit 100 --fresh --json
```

- A group's `firstSeen` is the first appearance of that Sentry group, not proof that the code defect
  began then. Compare the prior release and compatible signatures before calling a regression.
- Enumerate relevant title variants before summing a task or failure family. Preserve the original
  groups even when the host infers that several belong to one family.
- A common phase or node across unrelated tasks is a clue for shared behavior, not causal proof.
- Counts are absolute, not rates. Without a denominator per release, report counts and observation
  windows rather than an occurrence rate.

## Keep Sentry groups and inferred signature families distinct

One underlying error class can appear under several Sentry groups because the culprit, native
stack, mechanism, release, or localized operating-system message differs. Start with a title/count
aggregate as well as the issue-group list so a high-volume class is not hidden by fragmentation.

The host may report an inferred **signature family** when several rows share a stable exception
type or error code and the same execution phase. Preserve every original Sentry group, its counts,
and its title, and label the family as interpretation rather than a Sentry identity. Translated
messages should only be grouped when locale-neutral codes and compatible context also agree.

Do not merge, resolve, or otherwise mutate groups to express analysis. A signature family also does
not strengthen the link between a member event and a GitHub Issue.

## Drill down only when useful

Open relevant events to inspect fields actually retained by the project, such as exception, stack,
tags, breadcrumbs, trace, or release. Narrow by time only after aggregate triage and only when the
Issue or local evidence supplies a meaningful interval.

```powershell
sentry event list <org>/<short-issue-id> --period 7d --limit 50 --fresh --json
sentry event view <org>/<project> <event-id> --fresh --json
```

An empty Sentry window does not disprove a Maa task problem. Handled recognition loops, bad routes,
or incorrect business outcomes may never produce Sentry error events. Establish which datasets and
event types the project actually ingests.

## Attachment evidence boundaries

- Treat a missing attachment as an evidence gap. Attribute it to quota, retention, SDK settings,
  permissions, or upload failure only when project evidence establishes that cause.
- Do not infer raw OCR candidates from a summary message. When MEK exported
  `mla.recognition_detail`, first use `data.candidateStages.all/filtered/best`: they preserve bounded
  candidate text, score, box, stage distributions, truncation, and source locators when the upstream
  log provided them. Read a bounded original evidence window only when those stages are unavailable
  or truncated and the additional detail is necessary.
- Establish screenshot capture timing from logs, event fields, or version-pinned application source;
  a filename alone does not prove that it depicts the failing recognition frame.
- Treat project-specific event fields as optional. Inspect an event before relying on custom option,
  failure-stage, node, or duration fields.

## Grade cross-source correlation

Use the strongest applicable level and state it in the report:

- **Confirmed**: the Issue or exported log contains the same Sentry `event_id`; or a shared
  privacy-safe `run_id`/`session_id` is present in both sources.
- **Strong candidate**: a shared privacy-safe installation/run identifier, release, error
  signature, and narrow time interval all match, but no event ID is available.
- **Weak candidate**: only release, timestamp, platform, or a generic message matches. Keep the
  Sentry group separate and do not say it came from the reporter.
- **Unrelated**: the error signature or execution phase conflicts with the reported symptom, even
  if the time is close.

Never promote a weak candidate by stacking fields that all derive from the same clock or release.
A nearby event from another anonymous user is not Issue evidence.

For future reliable linkage, recommend a privacy-safe random `run_id` in local export metadata and
Sentry tags, and locally record captured Sentry `event_id`s. A framework task ID is useful only when
its scope is unambiguous within the run.

## Combine evidence without flattening it

Report three layers independently:

1. **Issue report**: user-visible symptom, version, controller, options, and attachments.
2. **Single-run evidence**: MEK facts plus focused GUI/custom-log or source evidence.
3. **Population evidence**: Sentry group frequency, affected users, releases, and trend.

Then label any cross-source link with its correlation level. Do not cite an aggregate as the direct
cause of one execution, and do not generalize one log package into population prevalence.

## Recognition triage from observed patterns

Separate the observation from possible explanations:

- If unrelated OCR nodes all produce no candidates, report broad absence of OCR output. First
  verify that the configured controller reaches the intended PC window, ADB device, and application
  frame. A wrong controller, device, window, or foreground application is distinct from OCR failure.
- If the correct frames are verified but broad OCR output is still absent, missing model files,
  model-load failures, or runtime/backend faults are candidates only after initialization logs,
  file inventory, or framework errors support them.
- If unrelated OCR nodes produce candidates but text or scores are broadly abnormal, GPU
  acceleration, driver compatibility, or unsupported/old hardware are candidates. Verify the
  configured backend and hardware/driver evidence, and compare a CPU or GPU-disabled run when safe
  and available.
- If only one ROI has no candidate, inspect the captured frame, ROI, page state, and timing. The ROI
  may simply contain no target text at that moment.
- If candidates exist but filtering or expected-text matching rejects them, compare the retained
  candidate text, scores, boxes, replacement rules, thresholds, and issue-time static configuration.
- A low score is only an observation. It does not by itself prove animation, an empty ROI, a model
  fault, or an incorrect result.

Framework timeout, pipeline ordering, stop behavior, and version-specific failure propagation must
be verified against issue-time evidence or version-pinned framework source before stating their
semantics. A behavior difference from the prior release is a regression candidate, not proof.

## Evaluate alternative explanations

Do not pre-classify clusters as noise. Relevant alternatives can include a wrong controller or
target application, an unexpected initial page, user interaction concurrent with automation,
normal transition timing, missing OCR models, or GPU/driver/hardware faults. Classify one only when
screenshots, connection logs, configuration, initialization records, or runtime chronology support
it. Otherwise keep the status unknown and do not silently exclude the Sentry group.

Avoid exposing device serials, unnecessary window titles, or other identifying controller fields
while making this distinction.

## Preserve privacy and external state

- Do not reproduce Sentry user IDs, server names, IP-derived locations, emails, or full private
  event payloads unless strictly required and authorized. Prefer aggregate counts.
- Do not use a server name, IP, or geographic field as an Issue-linking mechanism.
- Do not upload Issue attachments or MEK output to Sentry to create a correlation.
- Keep queries read-only. Do not resolve, archive, merge, assign, or comment on groups unless the
  user explicitly requests that state change.
- Treat stack traces, breadcrumbs, and tags as evidence; treat AI explanations and root-cause
  suggestions as interpretation requiring source verification.
