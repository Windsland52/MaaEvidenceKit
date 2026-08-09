# MaaEvidenceKit Privacy Notice

Last updated: 2026-08-09

MaaEvidenceKit performs log and project inspection locally and never sends inspected material for
automatic updates. The published CLI may make update requests before inspection, and may also send
the optional operational telemetry and feedback described below. Set
`MAA_EVIDENCE_AUTO_UPDATE=0` and `MAA_EVIDENCE_TELEMETRY=0` for a fully offline inspection.

## Automatic updates

Automatic updates are enabled by default for the published CLI and are separate from telemetry.
Before an analysis command or `--version`, the launcher may:

- query `https://registry.npmjs.org/maa-evidence-kit/latest` at most once every 24 hours;
- ask npm to download and execute a newer exact `maa-evidence-kit` version;
- invoke the `skills` CLI once per MEK version to update remotely managed `maa-evidence` Skill
  installations from their recorded source, normally GitHub.

MEK does not include command arguments, paths, logs, source, screenshots, or evidence in these
update requests. npm, GitHub, and their network providers receive the connection metadata required
to serve requests, such as the source IP address and standard HTTP/client metadata. Their own
privacy and authentication behavior applies. MEK sets `DISABLE_TELEMETRY=1` when invoking the
third-party `skills` CLI so that invocation does not send its optional anonymous telemetry.

The local `updates.json` file contains only check/sync timestamps and MEK version strings. It has no
stable installation identifier. Update checks, downloads, and Skill synchronization fall back to
the installed runtime and Skill when they cannot be prepared safely.
`MAA_EVIDENCE_AUTO_UPDATE=0` disables both runtime and Skill updates. CI disables them unless the
variable is explicitly set to `1`. SDK imports never run the updater.

## Consent

Operational telemetry (aggregate counts only, no original material) is enabled by default. It can
be disabled at any time.

- `maa-evidence telemetry status` shows the current choice.
- `maa-evidence telemetry enable` and `maa-evidence telemetry disable` change it.
- Setting `MAA_EVIDENCE_TELEMETRY=0` also disables operational telemetry for the process.
- Update behavior uses the separate `MAA_EVIDENCE_AUTO_UPDATE` setting above.
- CI and non-interactive use send aggregate operational telemetry by default and never prompt.
- Original-material feedback (logs, screenshots, source) is never sent automatically; it always
  requires an interactive preview and an explicit `UPLOAD` confirmation.

No stable installation, device, user, or advertising identifier is created.

## Operational telemetry

When enabled, an operational event may contain only:

- MaaEvidenceKit version;
- command category, component, and success/error status;
- rounded command duration;
- operating-system platform and CPU architecture;
- Node.js major version;
- aggregate counts only: evidence totals, adapters used, total signals, counts of
  recognition-detail, cycle-exit-blocker, task-anomaly, possible-mirrored-task, and
  recognition-to-MSE-reference records, plus the number of runtime nodes omitted by an automatic
  correlation limit.

Operational telemetry does not intentionally contain command arguments, file paths, environment
variables, usernames, logs, source code, screenshots, exception messages, or stack traces.
The Sentry SDK is configured with `sendDefaultPii: false` and a client-side event allowlist.
Delivery is best-effort: a CLI command gives its operational event a 200ms flush budget, and a
delivery timeout does not change the command's result. Feedback submissions use a separate, longer
confirmation flow.

## Local performance profiles

When explicitly requested with `--profile FILE`, MEK writes a local JSON file containing its
version, command category, success/error status, wall-clock duration, and aggregate stage
names/counts/durations. It does not include command arguments, paths, evidence, or exception
messages. Performance profiles are not attached to operational telemetry or feedback automatically.
They remain local unless the user explicitly selects the file as a confirmed feedback attachment.

## Extraction-gap feedback

Feedback is a separate, user-initiated action. A feedback submission may contain:

- the message entered by the user;
- the selected feedback severity (`blocker`, `bug`, `suggestion`, or `other`) and MEK component;
- files explicitly selected by the user, including complete original logs or screenshots.

Before any submission, the CLI displays the message, attachment paths, sizes, and privacy
warnings. The user must type `UPLOAD` for that submission. Attachments are never selected or sent
in the background. File attachments are uploaded as selected and may contain secrets or personal
data; client-side structured-event scrubbing cannot make arbitrary original files safe.

MEK warns at 20MB but does not impose that as a rejection limit. Sentry currently rejects a
compressed request over 40MB and more than 200MB of uncompressed attachments for one event.

## Processor and location

Telemetry and feedback are sent to the `cli` project in the `maa-evidence-kit` organization on
Sentry's US service. Sentry receives the network connection needed to deliver an event. MEK does
not add an IP address to event data. The `cli` project is configured to scrub stored IP addresses,
use Sentry's default data scrubber, and scrub common credential field names. Data retention remains
controlled by the Sentry plan and project settings.

Sentry's policies apply after receipt:

- https://sentry.io/privacy/
- https://sentry.io/terms/
- https://docs.sentry.io/platforms/javascript/guides/node/enriching-events/attachments/

## Access, retention, and deletion

Project maintainers with access to the private Sentry organization can view submitted events and
attachments. Retention is controlled by the active Sentry plan and project settings. To request
deletion or ask a private data question, contact the maintainer through the contact method listed
on the GitHub profile for <https://github.com/Windsland52>. Do not post sensitive material in a
public GitHub issue.

## Changes

Changes that add collected fields, new processors, or a new network destination must update this
notice and the telemetry allowlist before release.
