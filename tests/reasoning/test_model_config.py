import pytest
from pydantic import ValidationError

from maa_diagnostic_expert.reasoning.model_config import (
    ChatTemplateConfig,
    FunctionToolChoiceFormat,
    ModelConfig,
    ModelRouterConfig,
    ReasoningStage,
    StructuredOutputMethod,
    parse_model_configuration_json,
)


def test_model_config_normalizes_base_url_with_a_direct_key() -> None:
    config = ModelConfig(
        provider="openai",
        model="test-model",
        api_key="secret",
        base_url="http://localhost:8000/v1/",
    )

    assert config.base_url == "http://localhost:8000/v1"
    assert config.api_key == "secret"


def test_model_config_rejects_credentials_in_base_url() -> None:
    with pytest.raises(ValidationError, match="must not contain credentials"):
        ModelConfig(
            provider="openai",
            model="test-model",
            base_url="https://user:secret@example.invalid/v1",
        )


def test_model_config_rejects_a_base_url_without_a_host() -> None:
    with pytest.raises(ValidationError, match="must include a host"):
        ModelConfig(provider="openai", model="test-model", base_url="http://")


def test_model_config_rejects_a_blank_api_key() -> None:
    with pytest.raises(ValidationError):
        ModelConfig(provider="openai", model="test-model", api_key="")


def test_chat_template_config_accepts_explicit_reasoning() -> None:
    config = ModelConfig(
        provider="openai",
        model="test-model",
        chat_template_kwargs=ChatTemplateConfig(
            thinking=True,
            reasoning_effort="high",
        ),
    )

    assert config.model_dump()["chat_template_kwargs"] == {
        "thinking": True,
        "reasoning_effort": "high",
    }


def test_chat_template_config_rejects_effort_when_thinking_is_disabled() -> None:
    with pytest.raises(ValidationError, match="requires thinking"):
        ChatTemplateConfig(thinking=False, reasoning_effort="high")


def test_model_config_bounds_structured_output_retries() -> None:
    with pytest.raises(ValidationError):
        ModelConfig(
            provider="openai",
            model="test-model",
            structured_output_retries=4,
        )


def test_model_config_accepts_function_tool_choice_and_output_limit() -> None:
    config = ModelConfig(
        provider="openai",
        model="gateway-model",
        max_output_tokens=8192,
        structured_output_method=StructuredOutputMethod.FUNCTION_CALLING,
        function_tool_choice_format=FunctionToolChoiceFormat.RESPONSES,
    )

    assert config.max_output_tokens == 8192
    assert config.function_tool_choice_format is FunctionToolChoiceFormat.RESPONSES


def test_model_config_rejects_custom_tool_choice_outside_function_calling() -> None:
    with pytest.raises(ValidationError, match="requires function_calling"):
        ModelConfig(
            provider="openai",
            model="gateway-model",
            structured_output_method=StructuredOutputMethod.JSON_MODE,
            function_tool_choice_format=FunctionToolChoiceFormat.RESPONSES,
        )


def test_model_router_config_resolves_exact_stage_routes_and_default() -> None:
    config = ModelRouterConfig(
        models={
            "planner": ModelConfig(provider="openai", model="fast-model"),
            "reasoner": ModelConfig(provider="openai", model="strong-model"),
        },
        default_model="reasoner",
        routes={
            ReasoningStage.PLAN_SOURCE_RESEARCH: "planner",
            ReasoningStage.DIAGNOSE: "reasoner",
        },
    )

    assert config.model_alias_for_stage("plan_source_research") == "planner"
    assert config.model_alias_for_stage("diagnose") == "reasoner"
    assert config.model_alias_for_stage("future_stage") == "reasoner"


def test_model_router_config_rejects_unknown_aliases() -> None:
    with pytest.raises(ValidationError, match="unknown aliases: missing"):
        ModelRouterConfig(
            models={"planner": ModelConfig(provider="openai", model="fast-model")},
            default_model="missing",
        )


def test_model_router_config_rejects_unknown_stage_names() -> None:
    with pytest.raises(ValidationError):
        ModelRouterConfig.model_validate(
            {
                "models": {
                    "planner": {"provider": "openai", "model": "fast-model"},
                },
                "default_model": "planner",
                "routes": {"plan_soruce_research": "planner"},
            }
        )


def test_model_configuration_parser_requires_v2_router_document() -> None:
    with pytest.raises(ValidationError):
        parse_model_configuration_json(
            '{"api_version":"model-config/v1","provider":"openai","model":"old"}'
        )
