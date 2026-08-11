# Sentry investigation

Use application Sentry telemetry as a separate evidence source owned by the host harness. Do not
confuse it with MaaEvidenceKit's optional product telemetry and extraction-gap feedback.
Every application-data query in this workflow is executed by the external Sentry CLI or MCP
client. The MEK SDK and CLI neither receive Sentry credentials nor query application projects.

## Start with the aggregate view

1. Identify the Sentry organization, project, available datasets, and retention window.
2. List recent error groups with title, count, affected-user count, first/last seen, release, and
   environment.
3. Compare releases and time periods to find spikes, regressions, and errors fragmented across
   several Sentry groups.
4. Rank groups by prevalence and relevance to the reported symptom before opening individual
   events.

Prefer aggregate Sentry facts for questions such as “Is this widespread?”, “Which release
introduced it?”, and “Are several Issues probably the same error class?”. Issue attachments and
MEK evidence normally contain more detail for one task execution.

Example CLI discovery:

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
tools. Prefer MCP when it exposes the required fields clearly; use the CLI when scripting or
dataset exploration is easier. Do not require either surface when the other is sufficient.

## Keep Sentry groups and inferred signature families distinct

One underlying error class can appear under several Sentry groups because the culprit, native
stack, mechanism, release, or localized operating-system message differs. Start with a title/count
aggregate as well as the issue-group list so a high-volume class is not hidden by fragmentation.

The host may report an inferred **signature family** when several rows share a stable exception
type or error code and the same execution phase. Preserve every original Sentry group, its counts,
and its title, and label the family as an interpretation rather than a Sentry identity. In
particular, translated messages such as Windows errors should only be grouped when a locale-neutral
code and compatible exception context are also present. Similar wording alone is insufficient.

Do not merge, resolve, or otherwise mutate Sentry groups to express this analysis. A signature
family also does not strengthen the link between any member event and a GitHub Issue; apply the
cross-source correlation grades below independently.

## Drill down only when useful

Open events from a relevant group to inspect exception type, stack, tags, breadcrumbs, trace, and
release. Narrow by time only after aggregate triage, and only when the Issue or local logs provide a
meaningful interval.

```powershell
sentry event list <org>/<short-issue-id> --period 7d --limit 50 --fresh --json
sentry event view <org>/<project> <event-id> --fresh --json
```

An empty Sentry window does not disprove a Maa task bug. Recognition loops, bad routes, incorrect
business results, and other handled failures may never produce Sentry error events. Also check
whether the project actually ingests logs, spans, replays, or only crashes.

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

Never promote a weak candidate by stacking correlated fields that all derive from the same clock
or release string. A nearby event from another anonymous user is not Issue evidence.

For future reliable linkage, recommend that the application generate a privacy-safe random
`run_id`, add it to both local export metadata and Sentry tags, and write captured Sentry
`event_id`s to the local log. A MaaFramework `task_id` may be added when it is scoped to one run.

## Combine evidence without flattening it

Report three layers independently:

1. **Issue report**: user-visible symptom, version, controller, options, and attachments.
2. **Single-run evidence**: MEK facts plus focused GUI/custom-log or source evidence.
3. **Population evidence**: Sentry group frequency, affected users, releases, and trend.

Then label any cross-source link with its correlation level. Do not cite a Sentry aggregate as the
direct cause of one execution, and do not generalize one log package into population prevalence.

## Preserve privacy and external state

- Do not reproduce Sentry user IDs, server names, IP-derived locations, emails, or full private
  event payloads in the report unless strictly required and authorized. Prefer aggregate counts.
- Do not use a server name, IP, or geographic field as an Issue-linking mechanism.
- Do not upload Issue attachments or MEK output to Sentry to create a correlation.
- Keep Sentry queries read-only. Do not resolve, archive, merge, assign, or comment on groups unless
  the user explicitly requests that state change.
- Treat stack traces, breadcrumbs, and tags as evidence; treat Sentry AI explanations and root-cause
  suggestions as interpretation that still requires source verification.
