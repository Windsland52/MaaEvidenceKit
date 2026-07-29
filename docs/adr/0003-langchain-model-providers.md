# ADR 0003: LangChain model providers

- Status: accepted
- Date: 2026-07-20
- Updated: 2026-07-29

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

`ModelConfig` records the provider, model, endpoint, optional direct `api_key`, timeouts, retry
policy, and structured-output method. The configuration remains an input-only provider boundary:
it must not enter graph state, diagnostic events, results, or benchmark artifacts. Credential-bearing
configuration files must remain outside version control. Providers with their own credential chain
may omit `api_key`.

Optional `chat_template_kwargs` make provider-specific reasoning mode selection explicit and are
passed as request `extra_body`, without changing reasoning contracts or graph state. This supports
OpenAI-compatible endpoints such as NVIDIA NIM where reasoning mode affects forced tool calling.
Successful provider responses that omit or violate the requested structured contract receive a
separate bounded validation retry; transport retries and structured-output retries remain distinct.

The LangChain integration implements MDE's `ReasoningBackend`. It receives a resolved
`ReasoningContext` and requests a Pydantic `DiagnosisDraft`; model output is validated again before
the workflow's deterministic validation node attaches authoritative evidence. Provider SDKs do
not control graph transitions and cannot write to the evidence ledger.

## Consequences

- MDE can add or upgrade provider packages without changing LangGraph nodes or diagnosis contracts.
- Users install only the provider extras they need; the model-free stub remains the CLI default.
- Provider differences in structured output remain explicit through `structured_output_method`.
- Provider chat-template reasoning modes remain explicit through `chat_template_kwargs`.
- The general-purpose model command-tool loop remains a future bounded MDE graph concern rather
  than a provider-specific agent-runtime feature. Repair execution already uses a separate,
  workflow-owned exact-request approval boundary.
