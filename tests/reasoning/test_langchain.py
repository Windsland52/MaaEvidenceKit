from __future__ import annotations

import asyncio

import pytest

from maa_diagnostic_expert.contracts.domain import ContractModel, DiagnosisDraft, DiagnosisStatus
from maa_diagnostic_expert.reasoning.langchain import LangChainReasoningBackend
from maa_diagnostic_expert.reasoning.model_config import ModelConfig, StructuredOutputMethod
from maa_diagnostic_expert.reasoning.prompts import build_reasoning_context


class _StructuredModel:
    def __init__(self, result: object) -> None:
        self.result = result
        self.input: object | None = None

    async def ainvoke(self, input: object) -> object:
        self.input = input
        return self.result


class _ChatModel:
    def __init__(self, result: object) -> None:
        self.structured = _StructuredModel(result)
        self.schema: type[ContractModel] | None = None
        self.arguments: dict[str, object] = {}

    def with_structured_output(
        self,
        schema: type[ContractModel],
        *,
        include_raw: bool = False,
        **kwargs: object,
    ) -> _StructuredModel:
        assert include_raw is False
        self.schema = schema
        self.arguments = kwargs
        return self.structured


def _config(
    method: StructuredOutputMethod = StructuredOutputMethod.AUTO,
) -> ModelConfig:
    return ModelConfig(
        provider="openai",
        model="test-model",
        structured_output_method=method,
    )


def test_langchain_backend_validates_structured_dictionary_output() -> None:
    model = _ChatModel(
        {
            "status": "insufficient_evidence",
            "summary": "No primary failure was supplied.",
            "conclusions": [],
            "missing_evidence": [],
        }
    )
    backend = LangChainReasoningBackend(_config(), model=model)
    session = asyncio.run(backend.start(run_id="run-1"))

    result = asyncio.run(session.reason(build_reasoning_context("Diagnose.", []), DiagnosisDraft))

    assert result.status is DiagnosisStatus.INSUFFICIENT_EVIDENCE
    assert model.schema is DiagnosisDraft
    assert model.arguments == {}
    assert model.structured.input is not None


def test_langchain_backend_forwards_an_explicit_structured_output_method() -> None:
    draft = DiagnosisDraft(
        status=DiagnosisStatus.INSUFFICIENT_EVIDENCE,
        summary="No evidence.",
    )
    model = _ChatModel(draft)
    backend = LangChainReasoningBackend(
        _config(StructuredOutputMethod.JSON_SCHEMA),
        model=model,
    )
    session = asyncio.run(backend.start(run_id="run-2"))

    result = asyncio.run(session.reason(build_reasoning_context("Diagnose.", []), DiagnosisDraft))

    assert result is draft
    assert model.arguments == {"method": "json_schema"}


def test_langchain_reasoning_session_rejects_use_after_close() -> None:
    model = _ChatModel({})
    backend = LangChainReasoningBackend(_config(), model=model)
    session = asyncio.run(backend.start(run_id="run-3"))
    asyncio.run(session.close())

    with pytest.raises(RuntimeError, match="closed"):
        asyncio.run(session.reason(build_reasoning_context("Diagnose.", []), DiagnosisDraft))
