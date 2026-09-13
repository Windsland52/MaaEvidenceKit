# MaaEvidenceKit Privacy Notice

Last updated: 2026-08-12

MaaEvidenceKit performs log, project, and explicitly requested repository-document inspection
locally and never sends inspected material for
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
- Original-material feedback (logs, screenshots, source) is never sent automatically; every
  submission is gated by a preview and an explicit `UPLOAD` confirmation, either interactively at
  submission time or through the one-time `feedback approve` token described below.

When operational telemetry first attempts to send, MEK creates a random installation seed in the
local configuration directory. It is not derived from hardware, operating-system accounts, usernames,
network addresses, or other machine identifiers. MEK sends only a one-way SHA-256 derivative as
Sentry's anonymous user ID so maintainers can estimate active installations and command frequency.
The seed is deleted by `telemetry disable`; enabling telemetry later creates a new identity.
Clearing the configuration, reinstalling without preserving it, or using another device also
counts as another installation. Consequently, this is not an exact count of people and it is not
used for advertising or cross-product tracking.

## Operational telemetry

When enabled, an operational event may contain only:

- MaaEvidenceKit version;
- telemetry schema version and an anonymous random installation ID as described above;
- command category, component, and success/error status;
- rounded command duration and a low-cardinality duration bucket;
- operating-system platform and CPU architecture;
- Node.js major version;
- aggregate counts only: evidence totals, adapters used, total signals, counts of
  recognition-detail, cycle-exit-blocker, task-anomaly, possible-mirrored-task, and
  recognition-to-MSE-reference records, plus the number of runtime nodes omitted by an automatic
  correlation limit; for `repo-docs`, aggregate counts of selected and list-omitted `AGENTS.md` and
  `SKILL.md`, truncated `AGENTS.md` text, and whether the repository scan hit its entry limit;
- low-cardinality evidence-count bucket and, for failed commands, a deterministic error category
  and execution stage. Error messages and stack traces remain excluded.

Operational telemetry does not intentionally contain command arguments, file paths, environment
variables, usernames, hardware identifiers, logs, source code, screenshots, exception messages,
or stack traces.
The Sentry SDK is configured with `sendDefaultPii: false` and a client-side event allowlist.
Delivery is best-effort: a CLI command gives its operational event a 200ms flush budget, and a
delivery timeout does not change the command's result. Feedback submissions use a separate, longer
confirmation flow.

MEK's own repository tests, release checks, and package smoke tests disable operational telemetry
so development failures do not inflate public usage counts. This does not disable the documented
default for consumers running MEK in their own CI or other non-interactive environments.

`repo-docs` reads repository documents only on the local machine. Its operational telemetry does
not include checkout paths, relative paths, filenames, document sizes, document text, evidence IDs,
warning messages, or Skill contents. Repository documents can be sent only if a user explicitly
selects them in the separate feedback preview and confirms that submission.

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

Approval can be recorded once and used for exactly one later submission, so a human can approve in a
real terminal and an agent can submit without answering the confirmation prompt on the human's behalf:

```powershell
maa-evidence feedback approve --message TEXT --category bug --out token.json
maa-evidence feedback --message TEXT --category bug --token token.json
```

`feedback approve` is the interactive step: it prints the same preview and requires `UPLOAD`, then
writes a token instead of submitting. The token is valid for 15 minutes, is bound to a digest of the
approved message, category, component, and attachment names and sizes, and is **consumed before the
upload is attempted**, so one approval authorizes one upload: an interrupted or failed submission
spends the approval instead of leaving a replayable token, and a token that cannot be removed refuses
the submission. A mismatched, expired, or already-consumed token is refused and never falls back to
prompting. The token file holds no original material and no message text, only the digest, an opaque
random value, and the expiry.

What this mechanism is and is not:

- It **binds an approval to exact content**: a token issued for one message cannot submit different
  words, a different category, or a different attachment set, and it cannot be replayed.
- It is **not a cryptographic barrier against a local process**. The digest is unkeyed and the token
  path is caller-chosen, so anything able to run `maa-evidence` and write in the same filesystem can
  mint an equivalent approval. MEK treats this as a policy gate that keeps the human decision on the
  record, not as an enforcement boundary; a local actor that wanted to bypass it could contact the
  Sentry project directly without MEK at all.
- Attachment **contents** are not bound: the digest covers attachment names and sizes, so a file of
  the same size replaced after approval would still upload. Attachment bytes are never scrubbed by
  `beforeSend`, which is why they remain an explicit user selection.

`--preview` prints the exact payload that would be sent and never submits, so a human can review it
without a terminal.

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
