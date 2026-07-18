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
src/maa_diagnostic_expert/   Python domain and agent interfaces
packages/tool-adapter/       Thin TypeScript adapter for MLA/MSE
contracts/                   Generated cross-process JSON schemas
tests/                       Python tests
```

## Current milestone

The framework-independent foundation includes:

- analysis input contracts, including an explicit project source path;
- project-root discovery that uses `cwd` only when Maa project markers are present;
- evidence and diagnosis result contracts;
- an agent protocol without a LangGraph dependency in domain code;
- a versioned JSONL tool-adapter protocol.

The first machine-facing vertical slice now provides artifact preparation, bounded evidence
windows, and result validation. LangGraph orchestration, concrete MLA/MSE calls, RAG, and
project-specific GUI/agent log adapters will be added after their interfaces are validated
against real issue cases. The runtime decision is recorded in
[ADR 0001](docs/adr/0001-runtime-and-agent-surfaces.md).

## CLI

All machine inputs and outputs are strict JSON contracts generated under `contracts/`.

~~~powershell
uv run maa-diagnostic-expert prepare --request request.json --output prepared.json
uv run maa-diagnostic-expert query-evidence --prepared prepared.json --request evidence-query.json --output evidence-window.json
uv run maa-diagnostic-expert validate-result --input diagnosis.json
~~~

`prepare` only inventories explicitly supplied artifacts and source metadata. It does not extract
archives or scan the whole project source tree. `query-evidence` reads at most 400 lines and
40,000 characters from a path authorized by the prepared analysis.

## Development

```powershell
uv sync
uv run pytest
uv run ruff check .
uv run ruff format --check .
uv run pyright
pnpm install
pnpm typecheck
```
