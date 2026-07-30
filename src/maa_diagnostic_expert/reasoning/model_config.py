from __future__ import annotations

from enum import StrEnum
from typing import Literal
from urllib.parse import urlsplit

from pydantic import Field, field_validator, model_validator

from maa_diagnostic_expert.contracts.domain import ContractModel


class StructuredOutputMethod(StrEnum):
    AUTO = "auto"
    JSON_SCHEMA = "json_schema"
    FUNCTION_CALLING = "function_calling"
    JSON_MODE = "json_mode"


class FunctionToolChoiceFormat(StrEnum):
    """Wire shape used to force a named function on compatible gateways."""

    CHAT_COMPLETIONS = "chat_completions"
    RESPONSES = "responses"


class ChatTemplateConfig(ContractModel):
    """Provider chat-template controls passed with each model request."""

    thinking: bool
    reasoning_effort: Literal["high", "max"] | None = None

    @model_validator(mode="after")
    def require_effort_only_with_thinking(self) -> ChatTemplateConfig:
        if not self.thinking and self.reasoning_effort is not None:
            raise ValueError("reasoning_effort requires thinking to be enabled")
        return self


class ModelConfig(ContractModel):
    """Serializable model selection and provider connection settings."""

    api_version: Literal["model-config/v1"] = "model-config/v1"
    provider: str = Field(pattern=r"^[a-z][a-z0-9_-]*$")
    model: str = Field(min_length=1)
    api_key: str | None = Field(default=None, min_length=1)
    base_url: str | None = None
    temperature: float | None = Field(default=None, ge=0, le=2)
    timeout_seconds: float = Field(default=120, gt=0, le=600)
    max_retries: int = Field(default=2, ge=0, le=10)
    max_output_tokens: int | None = Field(default=None, ge=1, le=131_072)
    structured_output_retries: int = Field(default=1, ge=0, le=3)
    structured_output_method: StructuredOutputMethod = StructuredOutputMethod.AUTO
    function_tool_choice_format: FunctionToolChoiceFormat = (
        FunctionToolChoiceFormat.CHAT_COMPLETIONS
    )
    chat_template_kwargs: ChatTemplateConfig | None = None

    @model_validator(mode="after")
    def require_function_calling_for_custom_tool_choice(self) -> ModelConfig:
        if (
            self.function_tool_choice_format is not FunctionToolChoiceFormat.CHAT_COMPLETIONS
            and self.structured_output_method is not StructuredOutputMethod.FUNCTION_CALLING
        ):
            raise ValueError(
                "function_tool_choice_format requires function_calling structured output"
            )
        return self

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
