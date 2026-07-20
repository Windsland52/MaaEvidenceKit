# ADR 0003: LangChain model providers

- Status: accepted
- Date: 2026-07-20

## Context

Standalone MDE needs user-configured models across hosted vendors, OpenAI-compatible gateways,
and local services. LangGraph orchestrates the diagnostic workflow but does not provide a model
provider abstraction. Adding both LangChain provider integrations and LiteLLM would introduce two
compatibility layers for structured output and tool calling, making failures harder to attribute.

## Decision

MDE uses LangChain's `init_chat_model` and official provider packages. Common integrations are
available as optional project extras; other LangChain integrations can be installed independently.
OpenAI-compatible services use the OpenAI provider with a configured `base_url`. LiteLLM is not a
project dependency.

`ModelConfig` records the provider, model, endpoint, timeouts, retry policy, and structured-output
method. It may name an environment variable through `api_key_env`, but credential values are not
configuration fields and must not enter graph state, diagnostic events, results, or benchmark
artifacts. Providers with their own default credential chain may omit `api_key_env`.

The LangChain integration implements MDE's `ReasoningBackend`. It receives a resolved
`ReasoningContext` and requests a Pydantic `DiagnosisDraft`; model output is validated again before
the workflow's deterministic validation node attaches authoritative evidence. Provider SDKs do
not control graph transitions and cannot write to the evidence ledger.

## Consequences

- MDE can add or upgrade provider packages without changing LangGraph nodes or diagnosis contracts.
- Users install only the provider extras they need; the model-free stub remains the CLI default.
- Provider differences in structured output remain explicit through `structured_output_method`.
- Future tool calling will be implemented as bounded MDE graph transitions rather than delegated to
  a provider-specific agent runtime.
