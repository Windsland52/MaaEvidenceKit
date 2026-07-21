# Repository Guidelines

> **Primary rule: keep the diagnostic domain and workflow understandable from Python.**
>
> Every completed change must pass the checks for the languages it touches. Diagnostic conclusions must remain traceable to source evidence.

## Architecture Boundaries

```text
Python SDK / CLI
    ├─ input and artifact discovery
    ├─ workflow orchestration
    ├─ evidence ledger and diagnosis contracts
    ├─ model reasoning and reporting
    └─ project-specific source adapters

TypeScript tool adapter
    ├─ MaaLogAnalyzer integration
    └─ public MSE package integration
```

- Python is the primary implementation language. Domain models, workflow state, prompts, RAG, reports, and diagnostic decisions belong in Python.
- Keep TypeScript small and mechanical. It may load MLA/MSE, validate requests, and translate results into stable JSON, but it must not contain diagnostic reasoning or workflow policy.
- MLA performs deterministic work only: parsing, indexing, deduplication, aggregation, statistics, comparisons, and evidence lookup. Do not add model calls or inferred root-cause conclusions to MLA integrations.
- Consume MSE through its public packages, especially `@nekosu/maa-tasker` and `@nekosu/maa-pipeline-manager`. Do not copy, fork, or import unpublished MSE internals.
- MCP is not a current project surface. Do not introduce MCP schemas, servers, or tool mirrors unless the architecture decision is explicitly revisited.
- GUI and custom-agent formats are not fixed. Keep generic discovery in core code and put MXU, custom GUI, Go/Python/C++ agent behavior behind optional source adapters.

## Diagnostic Correctness

- Treat logs, dumps, configuration snapshots, screenshots, and version-matched source as evidence; treat model output as interpretation.
- Every `Conclusion` must cite known evidence IDs. Do not bypass the validation in `DiagnosisResult`.
- Separate the reported symptom, the directly observed failure mechanism, and the suspected initiating trigger.
- A framework-level success event does not prove business success. Record observed execution paths and check explicit task milestones when available.
- Do not use current source to deny behavior from an older release. Resolve the issue revision first and use the latest revision only to assess whether a fix exists.
- Do not silently use `cwd` as a project root. It is a default only when Maa project markers are present; otherwise require an explicit path.
- Do not send whole large logs to a model when deterministic tools can return a focused evidence window.
- Missing multipart archives, mismatched timestamps, or absent source logs must be reported as missing evidence rather than guessed around.

## Project Structure

```text
src/maa_diagnostic_expert/
  contracts/                Serialized domain, MLA, and workflow contracts
  discovery/                Input, source, and artifact discovery
  inspection/               Deterministic inspection and evidence extraction
  reasoning/                Model protocols, prompts, and provider integrations
  workflow/                 LangGraph planning, orchestration, and validation
  interfaces/               CLI, JSONL tool adapter, and report rendering
packages/tool-adapter/       Thin TypeScript MLA/MSE adapter
contracts/                   Generated JSON schemas
skills/                      Host-agent SKILL.md for external agent integration
tests/                       Python tests mirroring the Python domain packages
tmp/                         Ignored local issue-analysis data
sample/                      Ignored local upstream repositories/links
```

Keep `src/maa_diagnostic_expert/__init__.py` as the stable public facade and `__main__.py` as the
module entry point. Put new implementation modules in an existing domain package; do not restore
the flat module layout or introduce generic `utils.py`/`common.py` dumping grounds.

Generated schemas in `contracts/*.schema.json` come from the Python Pydantic models. Do not edit them manually. Run `uv run maa-generate-contracts` after contract changes.

## Required Checks

For Python changes:

```powershell
uv run pytest
uv run ruff check .
uv run ruff format --check .
uv run pyright
uv run maa-generate-contracts
```

For TypeScript changes:

```powershell
pnpm typecheck
pnpm build
```

If Python contract models changed, regenerate contracts before rerunning tests and include the generated schema diff.

## Coding Conventions

- Python 3.13 is required and locked by `.python-version` and `pyproject.toml`.
- Python must pass Pyright with `typeCheckingMode = "strict"`. Fix unknown types at boundaries instead of disabling strict checks globally.
- Ruff owns Python linting and formatting. Keep public contracts explicit and use typed factories when libraries obscure generic inference.
- TypeScript must use strict compiler settings. Isolate third-party types at the adapter boundary and return project-owned protocol types.
- Use Pydantic for serialized Python contracts. Reject unknown fields unless a contract explicitly requires extension data.
- Prefer small, composable source adapters over filename checks scattered through workflow nodes.
- Pin adapter dependencies exactly. Upgrade MLA/MSE versions deliberately with contract and fixture tests.

## Testing Guidelines

- Deterministic layers must be testable without API credentials or model calls.
- Add fixture tests for artifact discovery, log-source detection, event deduplication, task selection, evidence ranges, and MSE resolution.
- Model-dependent evaluations belong in the external benchmark suite, not the deterministic unit-test gate.
- Never commit downloaded issue archives, extracted user data, local upstream clones, caches, credentials, or API responses from `tmp/` and `sample/`.

## Change Discipline

- Keep the root history focused on the new architecture; do not restore v1 CoreResult, MCP, or the old TypeScript diagnostic pipeline by copying from the legacy branch.
- Update `README.md` when public commands, directory ownership, or architectural boundaries change.
- Use Conventional Commit messages.
- Do not push, publish packages, modify GitHub issues, or change the remote default branch unless explicitly requested.
