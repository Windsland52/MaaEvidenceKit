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
skills/                      Host-agent SKILL.md for external agent integration
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

The diagnostic workflow uses LangGraph to orchestrate the full pipeline — prepare, inspect,
synthesize evidence, reason, validate — behind a single `DiagnosticWorkflow`. Explicit graph
state keeps inspection facts, authoritative evidence, model drafts, failures, and final results
separate.
The reasoning stage is delegated to a pluggable `ReasoningBackend` protocol. A deterministic
`StubReasoningBackend` ships with the project for model-free testing; LangChain model providers
can plug in without changing graph transitions or evidence validation.

The runtime and orchestration decisions are recorded in
[ADR 0001](docs/adr/0001-runtime-and-agent-surfaces.md) and
[ADR 0002](docs/adr/0002-langgraph-workflow-orchestration.md).

## CLI

All machine inputs and outputs are strict JSON contracts generated under `contracts/`.

~~~powershell
uv run maa-diagnostic-expert prepare --request request.json --output prepared.json
uv run maa-diagnostic-expert inspect --request request.json --output inspection.json
uv run maa-diagnostic-expert diagnose --request request.json --output diagnosis.json
uv run maa-diagnostic-expert query-evidence --prepared inspection.json --request evidence-query.json --output evidence-window.json
uv run maa-diagnostic-expert validate-result --input diagnosis.json --inspection inspection.json --evidence-window evidence-window.json
~~~

`prepare` only inventories explicitly supplied artifacts and source metadata. It does not extract
archives or scan the whole project source tree. `query-evidence` accepts either `PreparedAnalysis`
or `DeterministicInspection` through `--prepared`, and reads at most 400 lines and 40,000
characters from an authorized path.

`inspect` is the single-command deterministic path. It prepares the request, selects each explicit
log, ZIP, or directory input once, calls `mla.preflight` through the internal JSONL adapter, and
validates the returned facts with the Python `MlaPreflightResult` contract. Run `pnpm build` first;
use `--tool-adapter <path>` or `MDE_TOOL_ADAPTER_PATH` for a non-default adapter location.

`diagnose` runs the complete pipeline end to end: prepare, inspect, synthesize evidence, reason,
and validate. It uses the deterministic stub reasoning backend by default (no model credentials
required). Pass `--events <path>` to write the diagnostic event stream as JSON lines alongside the
result. The produced `DiagnosisResult` cites evidence IDs that trace back to MLA runtime facts.
The reasoning backend produces a `DiagnosisDraft` without evidence objects; the workflow attaches
only cited evidence from the deterministic inspection ledger.

`validate-result` requires the inspection that established the evidence ledger. Pass every cited
raw `EvidenceWindow` with a repeated `--evidence-window` option. Validation rejects invented IDs,
altered evidence content, and omitted required missing-evidence codes.

When a source snapshot has a resolved `revision`, `query-evidence` reads the file directly from
that Git commit rather than the current checkout or dirty worktree. Versioned evidence uses a
`git:<source-id>@<commit>:<path>` locator in the resulting `Evidence` record.

`AnalysisRequest.sources` contains named entries with a `source_id`, role, path, and optional
revision. Roles `project`, `maa_framework`, `gui`, and `agent` are independently versioned;
`auxiliary` is reserved for non-versioned reference source. GUI and agent roles do not assume MXU,
a programming language, or a fixed repository layout. Optional source adapters handle discovery.

## Host-agent integration

External agents (Codex, Claude Code, OpenCode) can use the deterministic CLI without a model
backend. The [`skills/maa-diagnostic/SKILL.md`](skills/maa-diagnostic/SKILL.md) file documents
the full workflow: prepare a request, run `inspect` for structured evidence, query raw log windows
when needed, and form a diagnosis citing evidence IDs. Copy or symlink this skill into the agent's
workspace to enable MaaFramework log diagnosis.

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
