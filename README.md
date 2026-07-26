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
src/maa_diagnostic_expert/
  contracts/                Serialized domain, MLA, and workflow contracts
  discovery/                Input, source, and artifact discovery
  inspection/               Deterministic inspection and evidence extraction
  reasoning/                Model protocols, prompts, providers, and command tools
  workflow/                 LangGraph planning, orchestration, and validation
  interfaces/               CLI, JSONL tool adapter, and report rendering
packages/tool-adapter/       Thin TypeScript adapter for MLA/MSE
contracts/                   Generated cross-process JSON schemas
skills/                      Host-agent SKILL.md for external agent integration
tests/                       Python tests mirroring the Python domain packages
```

The root Python package is a public facade and module entry point. New implementation modules
belong in one of the domain packages above instead of being added to the package root.

## Current milestone

The framework-independent foundation includes:

- named source inputs that keep project, MaaFramework, GUI, agent, and auxiliary source separate;
- source snapshots with independent path, revision, and resolution status;
- project-root discovery that uses `cwd` only when Maa project markers are present;
- evidence and diagnosis result contracts;
- an agent protocol without a LangGraph dependency in domain code;
- typed local command execution with explicit policy and audit results;
- a versioned JSONL tool-adapter protocol.

The deterministic vertical slice provides artifact preparation, bounded evidence windows, result
validation, MLA preflight/runtime inspection, and revision-matched MSE project inspection through
the JSONL adapter. Runtime inspection results are synthesized into typed `Evidence` records
(primary failures/outcomes, secondary signals, context task/session summaries). MSE contributes
interface/resource/task summaries and source-located static diagnostics without inferring that a
diagnostic caused the reported issue. After incident correlation, it also resolves only the
relevant MaaFramework task/node definitions, effective configuration, and references.

The diagnostic workflow uses LangGraph behind a single `DiagnosticWorkflow`. Its current graph
prepares the input, classifies log sources from bounded samples, records an initial investigation
plan, conditionally runs MLA for eligible artifacts and MSE for a revision-matched project
checkout, extracts source- and session-scoped MaaFramework versions, synthesizes authoritative
evidence, reasons, and validates the result. Before final diagnosis it generates bounded,
evidence-backed incident candidates from
notable MLA tasks and GUI/custom log occurrences. When candidates exist, a separate model stage
correlates them with the reported context; Python rejects invented candidate or evidence IDs.
For relevant candidates that identify a MaaFramework task or pipeline node, the next deterministic
node performs bounded MSE resolution and adds version-matched, line-backed source evidence before
final reasoning. Python then builds a structured actual/expected comparison that links runtime
failure, outcome, and high-priority signal evidence to resolved task configuration evidence
without declaring that the configuration caused the runtime behavior. Applicable AGENTS.md files
from the project source root to each focused pipeline file are loaded under bounded limits and
provided as source-investigation guidance. When a model is configured, a separate planning stage
may request up to five literal, path-scoped searches of the version-matched project repository;
Python executes them with Git and returns only bounded line windows as secondary evidence.
Explicit `documentation`, `wiki`, and MaaFramework source inputs can also enter a separate bounded
knowledge-search stage. Original documentation passages are context evidence; Wiki passages are
navigation-only and validation rejects conclusions that cite them directly.
Inputs that are unrelated to MaaFramework logs can therefore bypass MLA. Explicit graph state
keeps the plan, inspection facts, authoritative evidence, model drafts, failures, and final
results separate.
The reasoning stage is delegated to a pluggable `ReasoningBackend` protocol. A deterministic
`StubReasoningBackend` ships with the project for model-free testing; LangChain model providers
can plug in without changing graph transitions or evidence validation.

The standalone harness also has a Python command-execution foundation. It does not use an OS
sandbox: `safe` mode automatically permits only a small set of read-only-intent `gh`, `git`,
and `rg` process calls, requires approval for other processes and all complete shell strings,
and requires configured working-directory roots. These roots constrain cwd selection rather than
filesystem access and are not a sandbox. `trusted` and `disabled` modes are explicit.
Timeouts, filtered environments, bounded previews, full truncated output files, and serialized
execution results are implemented. The model-facing tool-call loop and approval pause are the
next workflow layer; current structured-output reasoning nodes do not execute commands.

The runtime and orchestration decisions are recorded in
[ADR 0001](docs/adr/0001-runtime-and-agent-surfaces.md) and
[ADR 0002](docs/adr/0002-langgraph-workflow-orchestration.md), while model-provider selection
is recorded in [ADR 0003](docs/adr/0003-langchain-model-providers.md).
Local command execution policy is recorded in
[ADR 0004](docs/adr/0004-command-tool-execution.md).

## CLI

All machine inputs and outputs are strict JSON contracts generated under `contracts/`.

~~~powershell
uv run maa-diagnostic-expert prepare --request request.json --output prepared.json
uv run maa-diagnostic-expert inspect --request request.json --output inspection.json
uv run maa-diagnostic-expert diagnose --request request.json --output diagnosis.json
uv run maa-diagnostic-expert diagnose --request request.json --model-config model.json --output diagnosis.json
uv run maa-diagnostic-expert query-evidence --prepared inspection.json --request evidence-query.json --output evidence-window.json
uv run maa-diagnostic-expert validate-result --input diagnosis.json --inspection inspection.json --evidence-window evidence-window.json
~~~

`prepare` only inventories explicitly supplied artifacts and source metadata. It does not extract
archives or scan the whole project source tree. `query-evidence` accepts either `PreparedAnalysis`
or `DeterministicInspection` through `--prepared`, and reads at most 400 lines and 40,000
characters from an authorized path.

`inspect` is the single-command deterministic path. It prepares the request, classifies log
sources, builds bounded GUI/custom overviews, and calls MLA only for classified MaaFramework logs,
their containing input directories, or explicit ZIP inputs. When a project source checkout
matches the requested revision (or represents the explicit current revision for a non-issue
request), it also runs MSE project preflight. Python validates both analyzer outputs before adding
facts to the evidence ledger. The Python wheel ships a self-contained Node adapter; source
checkouts refresh that bundled resource with `pnpm build`. Use `--tool-adapter <path>` or
`MDE_TOOL_ADAPTER_PATH` for a non-default adapter location. Node.js 24 or newer is required.

`diagnose` runs the currently implemented pipeline end to end: prepare, classify log sources,
plan the overview, conditionally inspect with MLA/MSE, identify runtime versions, synthesize evidence,
generate incident candidates, conditionally correlate the reported issue, resolve focused expected
pipeline configuration, compare actual execution with expected configuration, gather focused raw
artifact windows when the reasoning backend requests them, reason, and validate. Adaptive evidence
research is limited to two rounds of at most three windows each. Every window must identify an
explicitly prepared text, log, or configuration artifact and remains subject to the same 400-line
and 40,000-character limits as `query-evidence`; accepted windows enter the validated evidence
ledger before final reasoning. It
uses the deterministic stub reasoning backend by default (no model credentials required). Pass `--events
<path>` to write the diagnostic event stream as JSON lines alongside the result. When MLA runs,
the produced `DiagnosisResult` cites evidence IDs that trace back to MLA runtime facts. A request
without an MLA-eligible artifact continues with an MLA-empty deterministic inspection, which may
still contain GUI/custom overview evidence.
The reasoning backend produces a `DiagnosisDraft` without evidence objects; the workflow attaches
only cited evidence from the deterministic inspection ledger. The default deterministic stub
keeps incident candidates ambiguous and reports that free-form correlation was unavailable.

MaaFramework logs have a built-in classifier; files under a `custom/` directory receive a
conservative custom-log classification. Known GUI and project formats plug in through
`LogSourceProfile`, while unmatched logs remain `unknown` instead of being guessed or sent to MLA.
Dump inspection, unrestricted general source investigation, the model command-tool loop, and
Wiki-to-original-document follow-up search remain deferred. See
[the workflow architecture](docs/workflow-architecture.md) for the target flow and implementation
status.

Pass `--model-config <path>` to use a LangChain chat model instead of the stub. Install only the
provider integrations needed by the deployment, for example `uv sync --extra openai`,
`uv sync --extra anthropic`, or `uv sync --extra deepseek`; `--extra models` installs the bundled
common providers. LangChain providers not listed as project extras can still be installed and
selected by their `init_chat_model` provider name. OpenAI-compatible gateways use the `openai`
provider with a custom `base_url`.

```json
{
  "api_version": "model-config/v1",
  "provider": "openai",
  "model": "model-name",
  "api_key_env": "MDE_MODEL_API_KEY",
  "base_url": "https://example.invalid/v1",
  "temperature": 0,
  "timeout_seconds": 120,
  "max_retries": 2,
  "structured_output_method": "auto"
}
```

`api_key_env` names an environment variable; credential values are never fields in `ModelConfig`
and are not written to workflow state, events, diagnosis results, or benchmark artifacts. Omit it
when the provider uses its standard environment variables or another credential chain, such as
AWS credentials for Bedrock.

`validate-result` requires the inspection that established the evidence ledger. Pass every cited
raw `EvidenceWindow` with a repeated `--evidence-window` option. Validation rejects invented IDs,
altered evidence content, and omitted required missing-evidence codes.

When a source snapshot has a resolved `revision`, `query-evidence` reads the file directly from
that Git commit rather than the current checkout or dirty worktree. Versioned evidence uses a
`git:<source-id>@<commit>:<path>` locator in the resulting `Evidence` record.

`AnalysisRequest.sources` contains named entries with a `source_id`, role, path, and optional
revision. Roles `project`, `maa_framework`, `gui`, `agent`, `documentation`, and `wiki` are
independently versioned. `documentation` marks original local Git documentation that conclusions
may cite, while `wiki` marks a pinned navigation snapshot. MDE only fetches a Wiki catalog when
the CLI is given a URL or `MDE_WIKI_CATALOG_URL`; source entries are never updated implicitly.
`auxiliary` is reserved for other non-versioned reference source.
GUI and agent roles do not assume MXU, a programming language, or a fixed repository layout.
Optional source adapters handle discovery.

MaaLLMWiki can be supplied as a local Git checkout, extracted catalog snapshot, or released ZIP.
The ZIP manifest is verified before extraction into the knowledge cache and pins the Wiki commit,
upstream versions, file sizes, and SHA-256 digests:

```powershell
uv run maa-diagnostic-expert knowledge-status --wiki ../MaaLLMWiki
uv run maa-diagnostic-expert knowledge-status --wiki ./maa-llm-wiki-catalog-v1.zip
uv run maa-diagnostic-expert prepare --request request.json --wiki ../MaaLLMWiki
uv run maa-diagnostic-expert knowledge-status --wiki-latest
uv run maa-diagnostic-expert prepare --request request.json --wiki-latest
uv run maa-diagnostic-expert knowledge-status --wiki-github-repository owner/repository
```

Set `MDE_KNOWLEDGE_CACHE` or pass `--wiki-cache` to control where verified ZIP snapshots are
stored. A URL is downloaded once and then reused by URL; use `--wiki-refresh` to fetch it again,
`--wiki-offline` to require the cached copy, and `--wiki-sha256` to pin the ZIP itself. The URL
and optional hash can also be configured through `MDE_WIKI_CATALOG_URL` and
`MDE_WIKI_CATALOG_SHA256`. `--wiki-latest` queries the GitHub Releases API for the latest
versioned asset from `Windsland52/MaaLLMWiki`, verifies GitHub's asset digest, and stores discovery
metadata for offline reuse. Set `MDE_WIKI_GITHUB_REPOSITORY` for another repository and
`GH_TOKEN` or `GITHUB_TOKEN` for authenticated API access. Wiki arguments are accepted by
`prepare`, `inspect`, and `diagnose`. Snapshot navigation remains context evidence only;
conclusions must return to the original version-pinned documentation or source.

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
pnpm test
pnpm typecheck
pnpm build
```
