from __future__ import annotations

from collections.abc import Awaitable, Mapping
from typing import NotRequired, Protocol, TypedDict, cast

from langchain.chat_models import init_chat_model
from langchain_core.messages import HumanMessage, SystemMessage

from maa_diagnostic_expert.contracts.domain import ContractModel

from .model_config import ModelConfig, StructuredOutputMethod
from .prompts import render_evidence_block
from .protocol import ReasoningContext


class _StructuredModel(Protocol):
    def ainvoke(self, input: object) -> Awaitable[object]: ...


class _ChatModel(Protocol):
    def with_structured_output(
        self,
        schema: type[ContractModel],
        *,
        include_raw: bool = False,
        **kwargs: object,
    ) -> _StructuredModel: ...


class _ChatTemplateArguments(TypedDict):
    thinking: bool
    reasoning_effort: NotRequired[str]


class _ExtraBody(TypedDict):
    chat_template_kwargs: _ChatTemplateArguments


class _ModelArguments(TypedDict, total=False):
    timeout: float
    max_retries: int
    api_key: str
    base_url: str
    temperature: float
    extra_body: _ExtraBody


def _model_arguments(config: ModelConfig) -> _ModelArguments:
    arguments: _ModelArguments = {
        "timeout": config.timeout_seconds,
        "max_retries": config.max_retries,
    }
    if config.api_key is not None:
        arguments["api_key"] = config.api_key
    if config.base_url is not None:
        arguments["base_url"] = config.base_url
    if config.temperature is not None:
        arguments["temperature"] = config.temperature
    if config.chat_template_kwargs is not None:
        template_arguments: _ChatTemplateArguments = {
            "thinking": config.chat_template_kwargs.thinking,
        }
        if config.chat_template_kwargs.reasoning_effort is not None:
            template_arguments["reasoning_effort"] = config.chat_template_kwargs.reasoning_effort
        arguments["extra_body"] = {"chat_template_kwargs": template_arguments}
    return arguments


def _initialize_model(config: ModelConfig) -> _ChatModel:
    try:
        model = init_chat_model(
            config.model,
            model_provider=config.provider,
            **_model_arguments(config),
        )
    except (ImportError, TypeError, ValueError) as error:
        raise ValueError(
            f"Unable to initialize LangChain provider '{config.provider}': {error}"
        ) from error
    return cast(_ChatModel, model)


def _structured_output_result(
    envelope: object,
    result_type: type[ContractModel],
) -> tuple[object | None, Exception | None]:
    if not isinstance(envelope, Mapping):
        raise TypeError(
            f"Provider returned an invalid {result_type.__name__} structured output envelope"
        )
    values = cast(Mapping[str, object], envelope)
    if "parsed" not in values or "parsing_error" not in values:
        raise TypeError(
            f"Provider omitted {result_type.__name__} structured output envelope fields"
        )
    parsing_error = values["parsing_error"]
    if parsing_error is not None and not isinstance(parsing_error, Exception):
        raise TypeError("Provider returned an invalid structured output parsing error")
    return values["parsed"], parsing_error


def _raw_structured_payload(
    envelope: object,
    result_type: type[ContractModel],
) -> object | None:
    """Recover decoded tool arguments when LangChain's Pydantic parser rejects them."""
    if not isinstance(envelope, Mapping):
        return None
    values = cast(Mapping[str, object], envelope)
    raw = values.get("raw")
    if raw is None:
        return None
    tool_calls_value = getattr(raw, "tool_calls", None)
    if not isinstance(tool_calls_value, list):
        return None
    tool_calls = cast(list[object], tool_calls_value)
    for tool_call in tool_calls:
        if not isinstance(tool_call, Mapping):
            continue
        call = cast(Mapping[str, object], tool_call)
        if call.get("name") == result_type.__name__ and "args" in call:
            return call["args"]
    return None


class LangChainReasoningSession:
    """One structured reasoning session over a configured LangChain chat model."""

    def __init__(
        self,
        model: _ChatModel,
        output_method: StructuredOutputMethod,
        structured_output_retries: int,
    ) -> None:
        self._model = model
        self._output_method = output_method
        self._structured_output_retries = structured_output_retries
        self._closed = False

    async def reason[ResultT: ContractModel](
        self,
        context: ReasoningContext,
        result_type: type[ResultT],
    ) -> ResultT:
        if self._closed:
            raise RuntimeError("reasoning session is closed")
        output_arguments: dict[str, object] = {}
        if self._output_method is not StructuredOutputMethod.AUTO:
            output_arguments["method"] = self._output_method.value
        structured = self._model.with_structured_output(
            result_type,
            include_raw=True,
            **output_arguments,
        )
        base_messages = [
            SystemMessage(content=context.instruction),
            HumanMessage(content=render_evidence_block(context.evidence)),
        ]
        retry_error: Exception | None = None
        for attempt in range(self._structured_output_retries + 1):
            messages = list(base_messages)
            if retry_error is not None:
                messages.append(
                    HumanMessage(
                        content=(
                            "The previous structured response was invalid. Call the required "
                            f"structured output tool again and satisfy every schema rule. "
                            f"Validation error: {str(retry_error)[:2000]}"
                        )
                    )
                )
            envelope = await structured.ainvoke(messages)
            parsed, parsing_error = _structured_output_result(envelope, result_type)
            try:
                if parsing_error is not None:
                    raw_payload = _raw_structured_payload(envelope, result_type)
                    if raw_payload is None:
                        raise ValueError(
                            f"Provider {result_type.__name__} parsing failed: {parsing_error}"
                        ) from parsing_error
                    try:
                        return result_type.model_validate(raw_payload)
                    except (TypeError, ValueError) as raw_error:
                        raise ValueError(
                            f"Provider {result_type.__name__} parsing failed: {raw_error}"
                        ) from raw_error
                if isinstance(parsed, result_type):
                    return parsed
                if parsed is None:
                    raise ValueError(
                        f"Provider returned no {result_type.__name__} structured tool call"
                    )
                return result_type.model_validate(parsed)
            except (TypeError, ValueError) as error:
                retry_error = error
                if attempt == self._structured_output_retries:
                    raise
        raise RuntimeError("structured output retry loop ended unexpectedly")

    async def close(self) -> None:
        self._closed = True


class LangChainReasoningBackend:
    """Creates MDE reasoning sessions backed by one configured chat model."""

    def __init__(
        self,
        config: ModelConfig,
        *,
        model: _ChatModel | None = None,
    ) -> None:
        self._config = config
        self._model = model if model is not None else _initialize_model(config)

    async def start(self, *, run_id: str) -> LangChainReasoningSession:
        del run_id
        return LangChainReasoningSession(
            self._model,
            self._config.structured_output_method,
            self._config.structured_output_retries,
        )


def make_langchain_backend(config: ModelConfig) -> LangChainReasoningBackend:
    return LangChainReasoningBackend(config)
