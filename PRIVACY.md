# MaaEvidenceKit Privacy Notice

Last updated: 2026-11-01

MaaEvidenceKit performs log, project, and explicitly requested repository-document inspection
locally. There is **no telemetry**: MEK has no analytics endpoint, no Sentry client, no installation
identifier, and no code path that uploads inspection results. The only network access is the
automatic updater described below; set `MAA_EVIDENCE_AUTO_UPDATE=0` for a fully offline run.

## Automatic updates

Automatic updates are enabled by default for the published CLI. Before an analysis command or
`--version`, the launcher may:

- query `https://registry.npmjs.org/maa-evidence-kit/latest` at most once every 24 hours;
- ask npm to download and execute a newer exact `maa-evidence-kit` version;
- invoke the `skills` CLI once per MEK version to update remotely managed `maa-evidence` Skill
  installations from their recorded source, normally GitHub;
- when an update cannot be delivered, fetch the abridged packument from
  `https://registry.npmjs.org/maa-evidence-kit` at most once every 24 hours to count the releases
  between the running and the latest version, so the behind hint can name the distance (public
  version metadata only, same host as the update check).

MEK does not include command arguments, paths, logs, source, screenshots, or evidence in these
update requests. npm, GitHub, and their network providers receive the connection metadata required
to serve requests, such as the source IP address and standard HTTP/client metadata. Their own
privacy and authentication behavior applies. MEK sets `DISABLE_TELEMETRY=1` when invoking the
third-party `skills` CLI so that invocation does not send its optional anonymous telemetry.

The local `updates.json` file contains only check/sync timestamps and MEK version strings. It has no
stable installation identifier. While a version handoff runs, the config directory also holds one
`handoff-*.json` marker containing only MEK version strings, the parent's process ID, and a
timestamp; the parent deletes it after reading, leftovers older than 24 hours are swept when the
updater runs, and marker contents are never uploaded. Update checks, downloads, and Skill
synchronization fall back to the installed runtime and Skill when they cannot be prepared safely.
`MAA_EVIDENCE_AUTO_UPDATE=0` disables both runtime and Skill updates. CI disables them unless the
variable is explicitly set to `1`. SDK imports never run the updater.

## Local performance profiles

When explicitly requested with `--profile FILE`, MEK writes a local JSON file containing its
version, command category, success/error status, wall-clock duration, and aggregate stage
names/counts/durations. It does not include command arguments, paths, evidence, or exception
messages. Profiles are never sent anywhere by MEK.

## Feedback bundles

`maa-evidence feedback` writes a local JSON bundle for a report you choose to send yourself. MEK
does not upload it and has no submission endpoint.

The bundle contains:

- the message you wrote;
- the severity (`blocker`, `bug`, `suggestion`, or `other`) and the MEK component you selected;
- for each attachment you named: its path, filename, size, and SHA-256 digest.

MEK does **not** copy attachment bytes into the bundle, does not read them into the report, and does
not upload them. The digest exists so the recipient can confirm they received the same bytes you
meant to send. Attachments may contain secrets or personal data; reviewing and transmitting them is
the user's decision and the user's channel.

`--preview` prints the same payload without writing a file.

## Local files

MEK writes only where you point it and in its config directory:

- `updates.json` and transient `handoff-*.json` markers under the config directory (see above);
- whatever `--output` and `--profile` paths you choose;
- inspection caches only when your harness or a command keeps one locally; MEK does not create a
  hidden cache of inspected material.

No file MEK writes is uploaded automatically.

## Access, retention, and deletion

MEK keeps no server-side data. Delete local outputs, profiles, and the config directory at any time;
nothing needs to be requested from a maintainer. Reports you send through your own channel are
governed by that channel.

## Changes

A change that adds collected fields, a new processor, or a new network destination must update this
notice before release.
