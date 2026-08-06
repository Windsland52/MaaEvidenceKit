# Repository Guidelines

> **Primary rule: keep every exported fact deterministic and traceable to its source.**

MaaEvidenceKit is a TypeScript SDK and CLI. It extracts MaaFramework evidence for external
harnesses; it is not an agent and does not form model-generated diagnostic conclusions.

## Architecture Boundaries

```text
External harness
    ├─ understands the issue and generic GUI/custom logs
    ├─ chooses whether MLA, MSE, source search, or Sentry is relevant
    └─ forms interpretations while citing evidence IDs

MaaEvidenceKit
    ├─ discovers supported local artifacts
    ├─ extracts deterministic MLA runtime facts
    ├─ extracts deterministic MSE static facts
    ├─ provides evidence windows and views
    └─ sends optional, explicitly consented product feedback
```

- Keep the project a single Node.js/TypeScript package.
- Do not add model providers, prompts, LangGraph, an internal harness, MCP, or automatic repair.
- Do not interpret Sentry application data. A harness may use Sentry MCP or CLI independently.
- Harnesses extract archives before passing a directory to MEK. Do not restore archive extraction
  as a public MEK responsibility.
- Generic GUI/custom-agent meaning belongs to the harness. Core discovery may inventory unsupported
  files but must not infer their semantics.

## Source Ownership

```text
src/
  evidence/    Public facts, provenance, stable IDs, and bounded evidence windows
  mla/         MaaFramework log discovery and MaaLogAnalyzer integration
  mse/         Public MSE package integration and static node/reference graphs
  views/       JSON, text, and Mermaid rendering
  feedback/    Consent state, operational telemetry, and extraction-gap feedback
  cli/         Argument handling and command entry point
  inspect.ts   Optional MLA/MSE composition
  index.ts     Stable SDK facade
```

Put new implementation into the narrowest existing domain. Do not introduce `utils.ts` or
`common.ts` dumping grounds.

## Evidence Correctness

- Logs, configuration, screenshots, and source are evidence. Harness output is interpretation.
- Every evidence record must have a stable ID and a source artifact. Add line, timestamp, task, or
  node locators whenever the upstream parser provides them.
- Keep reported symptom, observed failure mechanism, and suspected trigger separate. MEK exports
  only observed facts.
- A framework task success does not prove business success.
- An unsuccessful recognition attempt is not automatically a failure.
- MSE diagnostics and static configuration do not prove runtime causality.
- Preserve missing multipart archives, empty time windows, truncation, unreadable files, and
  unsupported formats as explicit missing evidence or warnings.
- Do not silently replace an issue-time checkout with current source.
- Do not read arbitrary paths through evidence-window requests. Only inventoried artifacts are
  authorized, with the existing line and character bounds.

## Upstream Integrations

- Pin MLA and MSE dependencies exactly.
- MLA remains deterministic: parsing, indexing, deduplication, aggregation, statistics, comparison,
  and evidence lookup only.
- Consume MSE only through public `@nekosu/maa-tasker` and
  `@nekosu/maa-pipeline-manager` exports. Never copy unpublished internals.
- Translate third-party results into project-owned types before exporting them.
- Treat changes to upstream fields, discovery behavior, locations, or resource limits as contract
  changes and add fixture coverage.

## Privacy and Feedback

- Core inspection is offline. Sentry is used only for MEK product telemetry and feedback.
- Operational telemetry (aggregate counts only) is enabled by default and can be disabled with
  `telemetry disable` or `MAA_EVIDENCE_TELEMETRY=0`. CI/non-TTY use sends aggregate telemetry by
  default but must never prompt.
- Operational telemetry is whitelist-only. Never add paths, arguments, environment variables,
  usernames, logs, source, screenshots, or exception messages.
- Original-material feedback requires a preview and explicit confirmation for every submission.
- Do not weaken `beforeSend`, `sendDefaultPii: false`, attachment limits, or consent tests.
- Keep `PRIVACY.md` synchronized with collected fields and retention behavior.

## TypeScript Conventions

- Node.js 24 or newer is required.
- TypeScript strict mode, `exactOptionalPropertyTypes`, and `noUncheckedIndexedAccess` stay enabled.
- Fix unknown third-party types at integration boundaries rather than weakening compiler settings.
- Prefer discriminated unions and small explicit public types.
- Runtime validation belongs at untrusted JSON/CLI boundaries. Do not generate large model-oriented
  schemas.
- Keep machine output on stdout and diagnostics/prompts on stderr.

## Required Checks

Every completed change must pass:

```powershell
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Use small synthetic fixtures for deterministic behavior. Real logs may be used for local manual
verification but must never be committed.

## Change Discipline

- Update README and the host-agent Skill when commands or public behavior change.
- Never commit issue archives, extracted user data, real logs, credentials, Sentry responses,
  caches, or local upstream clones.
- Use Conventional Commit messages.
- Do not push, publish, modify GitHub issues, or change the default branch unless explicitly asked.
