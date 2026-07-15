# MaaDiagnosticExpert

`MaaDiagnosticExpert` is being rebuilt as a Python-first diagnostic agent for Maa projects.

The new architecture separates three concerns:

- Python owns input discovery, workflow orchestration, evidence management, model reasoning, and reports.
- MaaLogAnalyzer provides deterministic MaaFramework log facts.
- A small TypeScript adapter consumes public MSE packages and exposes stable JSON contracts to Python.

The project does not expose MCP in this generation. Its first public surfaces will be a Python SDK and CLI.

## Repository layout

```text
src/maa_diagnostic_expert/   Python domain and agent interfaces
packages/tool-adapter/       Thin TypeScript adapter for MLA/MSE
contracts/                   Generated cross-process JSON schemas
tests/                       Python tests
```

## Current milestone

The current root commit intentionally contains only the framework-independent foundation:

- analysis input contracts, including an explicit project source path;
- project-root discovery that uses `cwd` only when Maa project markers are present;
- evidence and diagnosis result contracts;
- an agent protocol without a LangGraph dependency in domain code;
- a versioned JSONL tool-adapter protocol.

LangGraph orchestration, concrete MLA/MSE calls, RAG, and project-specific GUI/agent log adapters will be added after their interfaces are validated against real issue cases.

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
