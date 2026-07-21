# ADR 0002: LangGraph workflow orchestration

- Status: accepted
- Date: 2026-07-20

## Context

The initial Python workflow established the diagnostic sequence and a framework-independent
`ReasoningBackend`, but future investigation needs conditional evidence queries, bounded tool
loops, human review, checkpointing, and node-level benchmark traces. Maintaining those concerns
in a custom asynchronous generator would duplicate capabilities already provided by LangGraph.

## Decision

Standalone MDE uses LangGraph as its Python workflow orchestrator. `DiagnosticWorkflow` remains
the public SDK facade, while an internal typed graph state carries the request, deterministic
inspection, authoritative evidence, model-produced draft, final result, and failure details.

The current graph introduces explicit overview planning and makes MLA conditional:

```text
start -> prepare -> classify_artifacts -> plan_overview
                                             |-> overview_logs -> inspect-+
                                             |                    |       |
                                             +--------------------+-> initialize_inspection
                                                                      |-> synthesize -> reason -> validate -> complete
                                             +-----------------------------------------------> fail
```

`classify_artifacts` reads only bounded head/tail samples and records the classifier and signals
for each log. Known project or GUI formats are supplied through source profiles; unmatched logs
remain unknown. `plan_overview` records typed branch decisions before executing an analyzer. A
classified GUI/custom log selects bounded `overview_logs`. A classified MaaFramework log or
eligible ZIP then selects `inspect`; otherwise
`initialize_inspection` creates an empty deterministic inspection and bypasses MLA. This prevents
the workflow from treating every issue as a MaaFramework-log problem.

Future MSE, dump, source, and knowledge branches are present in the planning contract before they
have executable nodes. Such decisions use `deferred`; a branch may
be marked `run` only when the current graph can execute it. This makes partial implementation
visible to callers and benchmarks.

Model access remains behind MDE's `ReasoningBackend`; LangGraph does not select a provider or own
model credentials. MLA and MSE remain deterministic services behind the TypeScript adapter.
Models may interpret or request evidence in later graph revisions, but only deterministic Python
services may add records to the authoritative evidence ledger.

Diagnostic events are emitted from graph nodes through LangGraph custom streaming and translated
to the existing `DiagnosticEvent` contract. CLI and host-agent integrations therefore do not
depend on LangGraph-specific event payloads.

## Consequences

- Conditional investigation, bounded tool loops, interrupts, and checkpointing can be added as
  graph transitions without replacing the public workflow API.
- Benchmark tooling can observe stable diagnostic stages while public events remain versioned MDE
  contracts.
- Planning contracts distinguish executed, skipped, and deferred work, so an absent capability is
  not mistaken for negative diagnostic evidence.
- GUI/custom overview scanning is bounded by bytes, line length, and retained occurrences; its
  summaries and exact-line occurrences enter the authoritative evidence ledger.
- LangGraph is a core runtime dependency rather than an optional model-provider dependency.
- Provider-specific LangChain packages will be optional integrations added with the real model
  backend; they will not control diagnostic policy or evidence validation.
