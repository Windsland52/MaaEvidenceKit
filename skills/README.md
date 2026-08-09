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
asks the skills CLI to update the managed global installation. Set
`MAA_EVIDENCE_AUTO_UPDATE=0` to disable both operations. Network or updater failures fall back to
the installed runtime and Skill.

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
