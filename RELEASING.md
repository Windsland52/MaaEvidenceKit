# Releasing MaaEvidenceKit

Releases are prepared from a clean release branch with Node.js 24+ and the pinned pnpm version from
`package.json`. Real issue logs, extracted archives, local inspections, profiles, and source clones
must remain outside Git.

## Prepare

1. Move completed entries from `Unreleased` in `CHANGELOG.md` into the target version and date.
2. Keep `package.json` and `src/version.ts` versions identical. Update version assertions in tests.
   Release every Skill behavior change with a new package version because automatic Skill sync is
   keyed by the executing MEK version.
3. Run `pnpm install --frozen-lockfile`.
4. Run `pnpm release:check`.
5. Review `pnpm pack --dry-run` and confirm only `dist`, Skill files, package metadata, license,
   privacy notice, README, and changelog are included.

`release:check` runs lint, type checking, tests, build, and a tarball smoke test. The smoke test packs
the current tree, installs the tarball into a temporary consumer project, imports the public SDK,
and invokes the packaged CLI version command. Registry access may be needed for package dependencies.

## Manual Acceptance

Use extracted, local-only issue material representing at least one MLA-only case and one combined
MLA/MSE case. Set `MAA_EVIDENCE_AUTO_UPDATE=0` and `MAA_EVIDENCE_TELEMETRY=0` unless those delivery
paths are being tested.

1. Run `maa-evidence mla inspect` and verify tasks, recognition detail, source locators, explicit
   truncation fields, and missing-evidence records.
2. Run `maa-evidence inspect` against matching issue-time source and verify runtime-to-static
   relations, `staticResolutionStatus`, definition evidence IDs, and automatic-node selection counts.
3. Use `search`, `view`, `window`, and `batch` against the generated inspection. Confirm every raw
   window stays inside inventoried artifacts and every cited evidence ID remains resolvable.
4. Run one command with default aggregate telemetry and a local `--profile`; confirm telemetry stays
   within its documented aggregate allowlist and command-exit budget. Never attach original material.
5. Confirm no issue archive, extracted log, inspection JSON, profile, cache, or local source checkout
   appears in `git status` or the package tarball.
6. In an isolated user/config directory, test the updater with command execution mocked or against
   the published version: confirm exact-version handoff, once-per-version global Skill sync,
   CI/opt-out, concurrent lock fallback, and offline local-runtime fallback. Do not let acceptance
   tests modify a maintainer's real Agent Skill installation.

Record the tested material identifiers, source commit/tag, commands, durations, and pass/fail result
in local release notes. Do not commit user material or absolute local paths.

## Publish

1. Commit the release metadata with `chore(release): <version>`.
2. Create an annotated `v<version>` tag from the reviewed release commit and push the tag. The
   `Publish npm package` workflow publishes that exact tag automatically.
3. Configure the repository `NPM_TOKEN` secret with publish permission before the first release.
   The workflow authenticates with npm, checks that `v<version>` matches `package.json`, and skips a
   version that is already published so a manual rerun is safe.
4. Install the published version in a clean directory and verify SDK import and `maa-evidence
   --version` once more.
5. For the first updater-enabled release, publish migration notes requiring `0.1.x` users to
   reinstall the CLI and reinstall the Skill from the GitHub URL with `--global`. Confirm the npm
   `latest` dist-tag and the repository Skill both point at the reviewed release contents before
   announcing automatic updates.

Do not publish from a dirty worktree, move an existing tag, or replace a published npm version. A
manual workflow dispatch must select a `v<version>` tag; dispatching it from a branch intentionally
fails the version validation.
