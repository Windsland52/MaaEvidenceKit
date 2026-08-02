# MaaEvidenceKit Privacy Notice

Last updated: 2026-08-02

MaaEvidenceKit performs its core log and project inspection locally. Core inspection does not
require an account and does not make network requests. Network transmission occurs only through
the optional operational telemetry and feedback features described below.

## Consent

On the first eligible interactive CLI use, MaaEvidenceKit may ask whether anonymous operational
telemetry can be enabled. Nothing is sent without an affirmative choice.

- CI and non-interactive use do not prompt, send telemetry, or persist a decision.
- `maa-evidence telemetry status` shows the current choice.
- `maa-evidence telemetry enable` and `maa-evidence telemetry disable` change it.
- Disabling telemetry stops future operational telemetry. It does not delete events already sent.

No stable installation, device, user, or advertising identifier is created.

## Operational telemetry

When enabled, an operational event may contain only:

- MaaEvidenceKit version;
- command category, component, and success/error status;
- rounded command duration;
- operating-system platform and CPU architecture;
- Node.js major version.

Operational telemetry does not intentionally contain command arguments, file paths, environment
variables, usernames, logs, source code, screenshots, exception messages, or stack traces.
The Sentry SDK is configured with `sendDefaultPii: false` and a client-side event allowlist.

## Extraction-gap feedback

Feedback is a separate, user-initiated action. A feedback submission may contain:

- the message entered by the user;
- the selected MEK component and feedback category;
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
