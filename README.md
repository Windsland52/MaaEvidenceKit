# MaaDiagnosticExpert

`MaaDiagnosticExpert` is being rebuilt as a Python-first diagnostic agent for Maa projects.

The new architecture separates three concerns:

- Python owns input discovery, workflow orchestration, evidence management, model reasoning, and reports.
- MaaLogAnalyzer provides deterministic MaaFramework log facts.
- A small TypeScript adapter consumes public MSE packages and exposes stable JSON contracts to Python.

The project does not expose MCP in this generation. Its first public surfaces are a Python SDK
and CLI. External agents use the same deterministic Python services through skills and CLI
commands; standalone MDE will use a small Python harness with a user-configured model backend.

## Repository layout

```text
src/maa_diagnostic_expert/   Python domain and agent implementation
packages/tool-adapter/       Thin TypeScript adapter for MLA/MSE
contracts/                   Generated cross-process JSON schemas
tests/                       Python tests
```

## Current milestone

The framework-independent foundation includes:

- named source inputs that keep project, MaaFramework, GUI, agent, and auxiliary source separate;
- source snapshots with independent path, revision, and resolution status;
- project-root discovery that uses `cwd` only when Maa project markers are present;
- evidence and diagnosis result contracts;
- an agent protocol without a LangGraph dependency in domain code;
- a versioned JSONL tool-adapter protocol.

The deterministic vertical slice provides artifact preparation, bounded evidence windows, result
validation, MLA preflight, and MLA runtime inspection through the JSONL adapter. Runtime
inspection results are synthesized into typed `Evidence` records (primary failures/outcomes,
secondary signals, context task/session summaries).

The diagnostic workflow orchestrates the full pipeline — prepare, inspect, synthesize evidence,
reason, validate — behind a single `DiagnosticWorkflow`. The reasoning stage is delegated to a
pluggable `ReasoningBackend` protocol. A deterministic `StubReasoningBackend` ships with the
project for model-free testing; a real model backend plugs in without workflow changes.

The runtime decision is recorded in
[ADR 0001](docs/adr/0001-runtime-and-agent-surfaces.md).

## CLI

All machine inputs and outputs are strict JSON contracts generated under `contracts/`.

~~~powershell
uv run maa-diagnostic-expert prepare --request request.json --output prepared.json
uv run maa-diagnostic-expert inspect --request request.json --output inspection.json
uv run maa-diagnostic-expert diagnose --request request.json --output diagnosis.json
uv run maa-diagnostic-expert query-evidence --prepared prepared.json --request evidence-query.json --output evidence-window.json
uv run maa-diagnostic-expert validate-result --input diagnosis.json
~~~

`prepare` only inventories explicitly supplied artifacts and source metadata. It does not extract
archives or scan the whole project source tree. `query-evidence` reads at most 400 lines and
40,000 characters from a path authorized by the prepared analysis.

`inspect` is the single-command deterministic path. It prepares the request, selects each explicit
log, ZIP, or directory input once, calls `mla.preflight` through the internal JSONL adapter, and
validates the returned facts with the Python `MlaPreflightResult` contract. Run `pnpm build` first;
use `--tool-adapter <path>` or `MDE_TOOL_ADAPTER_PATH` for a non-default adapter location.

`diagnose` runs the complete pipeline end to end: prepare, inspect, synthesize evidence, reason,
and validate. It uses the deterministic stub reasoning backend by default (no model credentials
required). Pass `--events <path>` to write the diagnostic event stream as JSON lines alongside the
result. The produced `DiagnosisResult` cites evidence IDs that trace back to MLA runtime facts.

`AnalysisRequest.sources` contains named entries with a `source_id`, role, path, and optional
revision. Roles `project`, `maa_framework`, `gui`, and `agent` are independently versioned;
`auxiliary` is reserved for non-versioned reference source. GUI and agent roles do not assume MXU,
a programming language, or a fixed repository layout. Optional source adapters handle discovery.

## Development

```powershell
uv sync
uv run pytest
uv run ruff check .
uv run ruff format --check .
uv run pyright
uv run maa-generate-contracts
pnpm install
pnpm typecheck
pnpm build
```
