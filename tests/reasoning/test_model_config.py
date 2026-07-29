import pytest
from pydantic import ValidationError

from maa_diagnostic_expert.reasoning.model_config import ChatTemplateConfig, ModelConfig


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
