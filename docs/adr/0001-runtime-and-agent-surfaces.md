# ADR 0001: Runtime and agent surfaces

- Status: accepted
- Date: 2026-07-18

## Context

MaaDiagnosticExpert must work as a standalone diagnostic agent while also being useful from
Codex, Claude Code, OpenCode, and future Maa project tooling. Reusing an external coding agent
as the only runtime would make diagnostic workflow behavior depend on that harness. Calling an
internal model from an external agent would create an opaque nested-agent workflow.

## Decision

MDE supports two first-class execution modes over one Python diagnostic core.

1. Standalone mode uses a small, diagnostic-specific Python harness and a user-configured model
   backend. Python owns workflow state, evidence selection, model calls, validation, and reports.
2. Host-agent mode exposes deterministic preparation, evidence lookup, and result validation
   through stable CLI commands. A skill teaches an external agent how to call those commands and
   produce the shared diagnosis contract.

The shared Python core owns artifact discovery, named source snapshots, evidence IDs, missing
evidence, and `DiagnosisResult` validation. Project, MaaFramework, GUI, and agent revisions remain
independent source inputs; GUI and agent roles do not imply a specific implementation. Model output
remains interpretation and cannot create or cite unknown evidence.

MCP is deferred. If a concrete consumer later requires it, an MCP adapter may mechanically mirror
stable Python service contracts. It must not contain prompts, model calls, diagnostic policy, or a
second implementation of the workflow.

## Initial machine surface

The first CLI slice consists of:

- `prepare`: inventory explicit artifacts and record supplied source snapshots without scanning
  complete source trees;
- `query-evidence`: read a bounded text line window from a path authorized by prepared input;
- `validate-result`: parse and validate a `DiagnosisResult`, including evidence references.

Archive extraction, MLA/MSE queries, source adapters, model configuration, and the standalone
diagnostic loop are later layers behind these contracts.

## Consequences

- Benchmark runs can compare standalone MDE with host-agent plus MDE skill without changing the
  deterministic evidence contract.
- External agents can use their existing model configuration without forcing standalone users to
  install an agent harness.
- The CLI remains a transport over Python services rather than the location of domain logic.
- A provider-specific model SDK cannot control workflow transitions or weaken result validation.
