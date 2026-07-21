from __future__ import annotations

from collections.abc import Awaitable
from typing import Protocol, TypedDict, cast

from langchain.chat_models import init_chat_model
from langchain_core.messages import HumanMessage, SystemMessage

from maa_diagnostic_expert.contracts.domain import ContractModel

from .model_config import ModelConfig, StructuredOutputMethod, resolve_api_key
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


class _ModelArguments(TypedDict, total=False):
    timeout: float
    max_retries: int
    api_key: str
    base_url: str
    temperature: float


def _model_arguments(config: ModelConfig) -> _ModelArguments:
    arguments: _ModelArguments = {
        "timeout": config.timeout_seconds,
        "max_retries": config.max_retries,
    }
    api_key = resolve_api_key(config)
    if api_key is not None:
        arguments["api_key"] = api_key
    if config.base_url is not None:
        arguments["base_url"] = config.base_url
    if config.temperature is not None:
        arguments["temperature"] = config.temperature
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


class LangChainReasoningSession:
    """One structured reasoning session over a configured LangChain chat model."""

    def __init__(
        self,
        model: _ChatModel,
        output_method: StructuredOutputMethod,
    ) -> None:
        self._model = model
        self._output_method = output_method
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
            include_raw=False,
            **output_arguments,
        )
        messages = [
            SystemMessage(content=context.instruction),
            HumanMessage(content=render_evidence_block(context.evidence)),
        ]
        raw_result = await structured.ainvoke(messages)
        if isinstance(raw_result, result_type):
            return raw_result
        return result_type.model_validate(raw_result)

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
        )


def make_langchain_backend(config: ModelConfig) -> LangChainReasoningBackend:
    return LangChainReasoningBackend(config)
