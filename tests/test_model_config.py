import pytest
from pydantic import ValidationError

from maa_diagnostic_expert.model_config import ModelConfig, resolve_api_key


def test_model_config_normalizes_base_url_without_serializing_a_key() -> None:
    config = ModelConfig(
        provider="openai",
        model="test-model",
        api_key_env="MDE_TEST_API_KEY",
        base_url="http://localhost:8000/v1/",
    )

    assert config.base_url == "http://localhost:8000/v1"
    assert "api_key" not in config.model_dump()


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


def test_resolve_api_key_reads_only_the_named_environment_variable() -> None:
    config = ModelConfig(
        provider="anthropic",
        model="test-model",
        api_key_env="EXPECTED_KEY",
    )

    assert resolve_api_key(config, {"EXPECTED_KEY": "secret", "OTHER_KEY": "ignored"}) == "secret"


def test_resolve_api_key_reports_a_missing_environment_variable() -> None:
    config = ModelConfig(
        provider="openai",
        model="test-model",
        api_key_env="MISSING_KEY",
    )

    with pytest.raises(ValueError, match="MISSING_KEY"):
        resolve_api_key(config, {})
