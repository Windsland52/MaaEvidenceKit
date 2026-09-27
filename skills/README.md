# MaaEvidenceKit Skills

This directory contains the installable agent skills bundled with MaaEvidenceKit. Each skill is
kept in its own folder and has a `SKILL.md` plus optional agent metadata and references.

## Installation

Install the MEK CLI separately because installing a skill does not install npm packages:

```bash
npm install --global maa-evidence-kit@latest
maa-evidence --version
```

Install the skill with the [skills CLI](https://github.com/vercel-labs/skills):

```bash
# List skills available in this repository
npx skills add https://github.com/Windsland52/MaaEvidenceKit --list

# Install the MaaEvidenceKit skill
npx skills add https://github.com/Windsland52/MaaEvidenceKit --skill maa-evidence --global
```

Omit `--agent` for interactive agent detection and selection. Keep the default symlink method so
the skills CLI can maintain one canonical copy across the selected agents. MEK never writes
agent-specific paths itself.

The first release with the automatic updater requires one manual migration from `0.1.x`: reinstall
the CLI and reinstall the Skill from the GitHub URL above. A local-path Skill has no remote source
for `skills update` to follow.

After migration, the published `maa-evidence` launcher checks npm `latest` at most once every 24
hours and hands commands to a newer stable runtime when available. Once per MEK version it also
asks the skills CLI to update the managed global installation. Both operations run only in an
interactive terminal: an agent or a piped command never pays for them. Set
`MAA_EVIDENCE_AUTO_UPDATE=0` to disable them everywhere, or `MAA_EVIDENCE_AUTO_UPDATE=1` to force
them on outside a terminal. Network or updater failures fall back to the installed runtime and
Skill.

## Skill and CLI versions

The Skill is published inside the npm package and carries no version of its own: a version written
into `SKILL.md` would have to be edited on every release, and it would still be wrong for a copy
installed from the repository instead of a published tarball. Compare bytes instead.

```bash
# Is the copy at <dir>/maa-evidence/ the one this CLI ships? Per file: same / different / missing
maa-evidence skill --check /path/to/agent-skills

# The copy inside the installed package (no network), with per-file digests as JSON
maa-evidence skill --print
maa-evidence skill --print --format json

# Write that exact copy to <dir>/maa-evidence/ instead of using the skills CLI
maa-evidence skill --install /path/to/agent-skills
```

`--check` also reports files the payload does not ship (agent metadata) without counting them as
drift, and it follows the directory symlink that the skills CLI creates for an agent target. A copy
rewritten by another tool, for example with different line endings, compares as `different`.

Nothing in the payload has to change when the package version does, so releasing a version that does
not touch the Skill needs no Skill edit at all.

Keep using `npx skills add` / `npx skills update` for agent-managed installs: they maintain the
symlink layout and per-agent targets. `skill --install` is for harnesses that manage their own copy
and want a byte-exact, offline install.

When developing from a local checkout, use the checkout path instead of the GitHub URL:

```bash
npx skills add . --skill maa-evidence
```

Local-path development installs are not remotely updateable; rerun the command after changing the
Skill.

The skill tells an external harness how to use MEK deterministically. It does not interpret GitHub
Issues, generic GUI/custom logs, application Sentry data, or business results.

## Available Skills

### `maa-evidence`

Extract and correlate traceable MaaFramework runtime and static evidence with MaaEvidenceKit. Use it
from an external harness when MLA/MSE evidence is relevant to an issue investigation.
