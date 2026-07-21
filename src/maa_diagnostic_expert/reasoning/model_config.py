from __future__ import annotations

import os
from collections.abc import Mapping
from enum import StrEnum
from urllib.parse import urlsplit

from pydantic import Field, field_validator

from maa_diagnostic_expert.contracts.domain import ContractModel


class StructuredOutputMethod(StrEnum):
    AUTO = "auto"
    JSON_SCHEMA = "json_schema"
    FUNCTION_CALLING = "function_calling"
    JSON_MODE = "json_mode"


class ModelConfig(ContractModel):
    """Serializable model selection without credential values."""

    api_version: str = "model-config/v1"
    provider: str = Field(pattern=r"^[a-z][a-z0-9_-]*$")
    model: str = Field(min_length=1)
    api_key_env: str | None = Field(
        default=None,
        pattern=r"^[A-Za-z_][A-Za-z0-9_]*$",
    )
    base_url: str | None = None
    temperature: float | None = Field(default=None, ge=0, le=2)
    timeout_seconds: float = Field(default=120, gt=0, le=600)
    max_retries: int = Field(default=2, ge=0, le=10)
    structured_output_method: StructuredOutputMethod = StructuredOutputMethod.AUTO

    @field_validator("model")
    @classmethod
    def reject_blank_model(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("Model name must not be blank")
        return value.strip()

    @field_validator("base_url")
    @classmethod
    def validate_base_url(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = value.rstrip("/")
        try:
            parsed = urlsplit(normalized)
            hostname = parsed.hostname
        except ValueError as error:
            raise ValueError("Model base_url is invalid") from error
        if parsed.scheme not in {"http", "https"}:
            raise ValueError("Model base_url must use http or https")
        if hostname is None:
            raise ValueError("Model base_url must include a host")
        if parsed.username is not None or parsed.password is not None:
            raise ValueError("Model base_url must not contain credentials")
        if parsed.query or parsed.fragment:
            raise ValueError("Model base_url must not contain a query or fragment")
        return normalized


def resolve_api_key(
    config: ModelConfig,
    environ: Mapping[str, str] | None = None,
) -> str | None:
    """Resolve a configured credential without adding it to serialized state."""
    if config.api_key_env is None:
        return None
    values = os.environ if environ is None else environ
    value = values.get(config.api_key_env)
    if value is None or not value.strip():
        raise ValueError(f"Model API key environment variable is missing: {config.api_key_env}")
    return value
