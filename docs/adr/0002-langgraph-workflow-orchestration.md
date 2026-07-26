# ADR 0002: LangGraph workflow orchestration

- Status: accepted
- Date: 2026-07-20

## Context

The Python workflow requires conditional evidence queries, bounded model interactions, human
review, resumable approval surfaces, and node-level benchmark traces while keeping a
framework-independent `ReasoningBackend`. Maintaining those concerns in a custom asynchronous
generator would duplicate capabilities already provided by LangGraph.

## Decision

Standalone MDE uses LangGraph as its Python workflow orchestrator. `DiagnosticWorkflow` remains
the public SDK facade, while an internal typed graph state carries the request, deterministic
inspection, authoritative evidence, model-produced draft, final result, and failure details.

The current graph makes deterministic inspection conditional, keeps model planning bounded, and
validates diagnosis and repair outputs before exposing them:

```text
start -> prepare -> classify_artifacts -> plan_overview
  -> overview_logs? -> inspect | initialize_inspection
  -> identify_runtime -> synthesize -> identify_incident -> correlate_incident?
  -> inspect_expected_pipeline? -> inspect_source_guidance? -> compare_incident
  -> plan/search implementation source? -> plan/search knowledge?
  -> bounded adaptive evidence research -> reason -> validate
  -> propose_fix -> plan_verification -> complete

Any node may route to fail. Question marks identify conditional branches.
```

`classify_artifacts` reads only bounded head/tail samples and records the classifier and signals
for each log. Known project or GUI formats are supplied through source profiles; unmatched logs
remain unknown. `plan_overview` records typed branch decisions before executing an analyzer. A
classified GUI/custom log selects bounded `overview_logs`. A classified MaaFramework log,
eligible ZIP, or revision-matched Maa project interface then selects `inspect`; otherwise
`initialize_inspection` creates an empty deterministic inspection and bypasses external
deterministic tools. MSE project preflight uses a one-shot read-only snapshot rather than a
persistent watcher. It returns static project facts and diagnostics, not a claim that any
diagnostic caused the reported issue.

Both paths then enter `identify_runtime`. MLA-backed inspections retain MaaFramework version
observations by source, session, timestamp, and line instead of flattening a log containing
multiple runtime versions. Explicit project and GUI declarations produce separately sourced
observations. The empty path produces an empty identity without inventing a version. Supplied
Minidumps contribute bounded exception and system metadata as direct facts, not inferred causes.

After evidence synthesis, `identify_incident` creates a bounded set of candidates from failed,
incomplete, or signal-bearing MaaFramework tasks and notable GUI/custom log occurrences. Candidate
confidence is only a deterministic evidence-strength ranking. Candidates remain `ambiguous` until
`correlate_incident` compares them with the reported symptom. The model returns only a draft;
Python rejects unknown candidate IDs, unrelated evidence IDs, and selections that do not cite the
selected candidate. With no candidates the graph skips correlation, and the deterministic stub
keeps candidates ambiguous instead of silently selecting even a single candidate.

When correlation identifies a supported MaaFramework task or node, deterministic MSE resolution
adds effective configuration, references, and source lines. Scoped `AGENTS.md` guidance is loaded
for focused project files. Separate model plans can request at most five literal searches over
revision-matched project, GUI, MaaFramework, documentation, and Wiki inputs; deterministic Python
performs the Git reads and bounds every returned window. Wiki records remain navigation-only, and
fixed-commit links are followed only into an explicitly supplied original checkout at the exact
revision.

Before final reasoning, the same reasoning session may request at most two rounds of three focused
artifact windows. Python authorizes paths against prepared inputs and adds only deterministic
results to the evidence ledger. After validation, a complete diagnosis may produce up to three
evidence-backed repair candidates and exactly one verification plan per candidate. Execution and
post-change verification are separate caller-driven `FixExecutionWorkflow` and
`FixVerificationWorkflow` surfaces because selecting and approving a repair is not a diagnostic
graph decision.

Planning contracts still use `deferred` when a supplied project cannot yield a supported focused
task target and unrestricted repository search is unavailable. This remains distinct from `skip`,
which means the branch is not applicable to the supplied inputs.

Model access remains behind MDE's `ReasoningBackend`; LangGraph does not select a provider or own
model credentials. MLA and MSE remain deterministic services behind the TypeScript adapter.
Models may interpret or request evidence, but only deterministic Python services may add records
to the authoritative evidence ledger.

Diagnostic events are emitted from graph nodes through LangGraph custom streaming and translated
to the existing `DiagnosticEvent` contract. CLI and host-agent integrations therefore do not
depend on LangGraph-specific event payloads.

## Consequences

- Conditional investigation and bounded model-planned evidence loops are explicit graph stages;
  future general-purpose tool loops and checkpointing can be added without replacing the public
  workflow API.
- Benchmark tooling can observe stable diagnostic stages while public events remain versioned MDE
  contracts.
- Planning contracts distinguish executed, skipped, and deferred work, so an absent capability is
  not mistaken for negative diagnostic evidence.
- GUI/custom overview scanning is bounded by bytes, line length, and retained occurrences; its
  summaries and exact-line occurrences enter the authoritative evidence ledger.
- LangGraph is a core runtime dependency rather than an optional model-provider dependency.
- Provider-specific LangChain packages are optional integrations and do not control diagnostic
  policy or evidence validation.
