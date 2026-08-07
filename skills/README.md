# MaaEvidenceKit Skills

This directory contains the installable agent skills bundled with MaaEvidenceKit. Each skill is
kept in its own folder and has a `SKILL.md` plus optional agent metadata and references.

## Installation

Install the MEK CLI separately because installing a skill does not install npm packages:

```bash
npm install --global maa-evidence-kit
maa-evidence --version
```

Install the skill with the [skills CLI](https://github.com/vercel-labs/skills):

```bash
# List skills available in this repository
npx skills add https://github.com/Windsland52/MaaEvidenceKit --list

# Install the MaaEvidenceKit skill
npx skills add https://github.com/Windsland52/MaaEvidenceKit --skill maa-evidence
```

When developing from a local checkout, use the checkout path instead of the GitHub URL:

```bash
npx skills add . --skill maa-evidence
```

The skill tells an external harness how to use MEK deterministically. It does not interpret GitHub
Issues, generic GUI/custom logs, application Sentry data, or business results.

## Available Skills

### `maa-evidence`

Extract and correlate traceable MaaFramework runtime and static evidence with MaaEvidenceKit. Use it
from an external harness when MLA/MSE evidence is relevant to an issue investigation.
