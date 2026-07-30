from __future__ import annotations

import asyncio
import json
from dataclasses import dataclass, replace
from pathlib import Path
from typing import cast

import pytest
from langchain_core.messages import AIMessage, BaseMessage, HumanMessage, SystemMessage

from maa_diagnostic_expert.contracts.domain import (
    ContractModel,
    DiagnosisDraft,
    DiagnosisStatus,
    EvidenceQuery,
)
from maa_diagnostic_expert.contracts.workflow import EvidenceResearchPlan, SourceResearchStatus
from maa_diagnostic_expert.reasoning import langchain
from maa_diagnostic_expert.reasoning.langchain import LangChainReasoningBackend
from maa_diagnostic_expert.reasoning.model_config import (
    ChatTemplateConfig,
    FunctionToolChoiceFormat,
    ModelConfig,
    StructuredOutputMethod,
)
from maa_diagnostic_expert.reasoning.prompts import build_reasoning_context


@dataclass(frozen=True)
class _ProviderEnvelope:
    raw: object
    parsed: object | None
    parsing_error: Exception | None


class _StructuredModel:
    def __init__(self, *results: object) -> None:
        self.results = list(results)
        self.input: object | None = None
        self.inputs: list[object] = []

    async def ainvoke(self, input: object) -> object:
        self.input = input
        self.inputs.append(input)
        result = self.results.pop(0)
        if isinstance(result, _ProviderEnvelope):
            return {
                "raw": result.raw,
                "parsed": result.parsed,
                "parsing_error": result.parsing_error,
            }
        return {
            "raw": object(),
            "parsed": result,
            "parsing_error": None,
        }


class _ChatModel:
    def __init__(self, *results: object) -> None:
        self.structured = _StructuredModel(*results)
        self.schema: type[ContractModel] | None = None
        self.arguments: dict[str, object] = {}

    def with_structured_output(
        self,
        schema: type[ContractModel],
        *,
        include_raw: bool = False,
        **kwargs: object,
    ) -> _StructuredModel:
        assert include_raw is True
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


def test_langchain_backend_supports_top_level_function_tool_choice_name() -> None:
    draft = DiagnosisDraft(
        status=DiagnosisStatus.INSUFFICIENT_EVIDENCE,
        summary="No evidence.",
    )
    model = _ChatModel(draft)
    config = _config(StructuredOutputMethod.FUNCTION_CALLING).model_copy(
        update={"function_tool_choice_format": FunctionToolChoiceFormat.RESPONSES}
    )
    backend = LangChainReasoningBackend(config, model=model)
    session = asyncio.run(backend.start(run_id="run-responses-tool-choice"))

    result = asyncio.run(session.reason(build_reasoning_context("Diagnose.", []), DiagnosisDraft))

    assert result is draft
    assert model.arguments == {
        "method": "function_calling",
        "tool_choice": {"type": "function", "name": "DiagnosisDraft"},
    }


def test_langchain_backend_includes_target_schema_in_json_mode() -> None:
    draft = DiagnosisDraft(
        status=DiagnosisStatus.INSUFFICIENT_EVIDENCE,
        summary="No evidence.",
    )
    model = _ChatModel(draft)
    backend = LangChainReasoningBackend(
        _config(StructuredOutputMethod.JSON_MODE),
        model=model,
    )
    session = asyncio.run(backend.start(run_id="run-json-mode"))

    result = asyncio.run(session.reason(build_reasoning_context("Diagnose.", []), DiagnosisDraft))

    assert result is draft
    assert model.arguments == {"method": "json_mode"}
    assert model.structured.input is not None
    rendered_input = str(model.structured.input)
    assert "Return only one JSON object" in rendered_input
    assert "Target type: DiagnosisDraft" in rendered_input
    assert '"conclusions"' in rendered_input


def test_langchain_backend_preserves_message_prefix_for_followup_instruction() -> None:
    draft = DiagnosisDraft(
        status=DiagnosisStatus.INSUFFICIENT_EVIDENCE,
        summary="No evidence.",
    )
    model = _ChatModel(draft, draft)
    backend = LangChainReasoningBackend(
        _config(StructuredOutputMethod.JSON_MODE),
        model=model,
    )
    session = asyncio.run(backend.start(run_id="run-cache-prefix"))
    context = build_reasoning_context("Diagnose.", [])
    correction = replace(
        context,
        followup_instruction="Correction required: copy the exact evidence IDs.",
    )

    asyncio.run(session.reason(context, DiagnosisDraft))
    asyncio.run(session.reason(correction, DiagnosisDraft))

    first_messages = cast(list[BaseMessage], model.structured.inputs[0])
    second_messages = cast(list[BaseMessage], model.structured.inputs[1])
    followup_instruction = correction.followup_instruction
    assert followup_instruction is not None
    assert len(first_messages) == 2
    assert len(second_messages) == 3
    assert second_messages[:2] == first_messages
    assert isinstance(second_messages[0], SystemMessage)
    assert isinstance(second_messages[1], HumanMessage)
    assert isinstance(second_messages[2], HumanMessage)
    assert second_messages[2].content == followup_instruction
    assert followup_instruction not in str(second_messages[0].content)
    assert followup_instruction in correction.to_request().instruction


def test_langchain_backend_uses_json_retry_feedback_in_json_mode() -> None:
    model = _ChatModel(
        None,
        {
            "status": "insufficient_evidence",
            "summary": "No evidence.",
            "conclusions": [],
            "missing_evidence": [],
        },
    )
    backend = LangChainReasoningBackend(
        _config(StructuredOutputMethod.JSON_MODE),
        model=model,
    )
    session = asyncio.run(backend.start(run_id="run-json-retry"))

    result = asyncio.run(session.reason(build_reasoning_context("Diagnose.", []), DiagnosisDraft))

    assert result.status is DiagnosisStatus.INSUFFICIENT_EVIDENCE
    assert "previous JSON response was invalid" in str(model.structured.inputs[1])
    assert "structured output tool" not in str(model.structured.inputs[1])


def test_langchain_backend_retries_missing_structured_output_with_validation_feedback() -> None:
    model = _ChatModel(
        None,
        {
            "status": "insufficient_evidence",
            "summary": "No evidence.",
            "conclusions": [],
            "missing_evidence": [],
        },
    )
    backend = LangChainReasoningBackend(_config(), model=model)
    session = asyncio.run(backend.start(run_id="run-retry"))

    result = asyncio.run(session.reason(build_reasoning_context("Diagnose.", []), DiagnosisDraft))

    assert result.status is DiagnosisStatus.INSUFFICIENT_EVIDENCE
    assert len(model.structured.inputs) == 2
    assert "previous structured response was invalid" in str(model.structured.inputs[1])


def test_langchain_backend_recovers_raw_tool_arguments_after_parser_error(
    tmp_path: Path,
) -> None:
    query = EvidenceQuery(
        source_path=tmp_path / "settings.json",
        line_start=1,
        line_end=100,
        reason="Inspect the effective controller.",
    )
    raw_arguments = {
        "status": "run",
        "queries": json.dumps([query.model_dump(mode="json")]),
        "rationale": "The provider JSON-encoded one array argument.",
    }
    parsing_error = ValueError("queries must be a valid list")
    model = _ChatModel(
        _ProviderEnvelope(
            raw=AIMessage(
                content="",
                tool_calls=[
                    {
                        "name": "EvidenceResearchPlan",
                        "args": raw_arguments,
                        "id": "call-1",
                        "type": "tool_call",
                    }
                ],
            ),
            parsed=None,
            parsing_error=parsing_error,
        )
    )
    backend = LangChainReasoningBackend(
        _config().model_copy(update={"structured_output_retries": 0}),
        model=model,
    )
    session = asyncio.run(backend.start(run_id="run-raw-recovery"))

    result = asyncio.run(
        session.reason(build_reasoning_context("Plan focused evidence.", []), EvidenceResearchPlan)
    )

    assert result.status is SourceResearchStatus.RUN
    assert result.queries == [query]


def test_langchain_backend_reports_exhausted_structured_output_retries() -> None:
    model = _ChatModel(None)
    config = _config().model_copy(update={"structured_output_retries": 0})
    backend = LangChainReasoningBackend(config, model=model)
    session = asyncio.run(backend.start(run_id="run-no-retry"))

    with pytest.raises(ValueError, match="no DiagnosisDraft structured tool call"):
        asyncio.run(session.reason(build_reasoning_context("Diagnose.", []), DiagnosisDraft))


def test_langchain_reasoning_session_rejects_use_after_close() -> None:
    model = _ChatModel({})
    backend = LangChainReasoningBackend(_config(), model=model)
    session = asyncio.run(backend.start(run_id="run-3"))
    asyncio.run(session.close())

    with pytest.raises(RuntimeError, match="closed"):
        asyncio.run(session.reason(build_reasoning_context("Diagnose.", []), DiagnosisDraft))


def test_langchain_backend_passes_direct_api_key_to_provider(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    model = _ChatModel({})
    captured: list[tuple[str, str, dict[str, object]]] = []

    def fake_init_chat_model(
        name: str,
        *,
        model_provider: str,
        **kwargs: object,
    ) -> _ChatModel:
        captured.append((name, model_provider, kwargs))
        return model

    monkeypatch.setattr(langchain, "init_chat_model", fake_init_chat_model)

    backend = langchain.make_langchain_backend(
        ModelConfig(
            provider="openai",
            model="test-model",
            api_key="direct-secret",
            base_url="https://example.invalid/v1",
            max_output_tokens=8192,
            chat_template_kwargs=ChatTemplateConfig(
                thinking=True,
                reasoning_effort="high",
            ),
        )
    )

    assert isinstance(backend, LangChainReasoningBackend)
    assert captured == [
        (
            "test-model",
            "openai",
            {
                "timeout": 120,
                "max_retries": 2,
                "api_key": "direct-secret",
                "base_url": "https://example.invalid/v1",
                "max_tokens": 8192,
                "extra_body": {
                    "chat_template_kwargs": {
                        "thinking": True,
                        "reasoning_effort": "high",
                    }
                },
            },
        )
    ]
