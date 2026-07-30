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


class ReasoningStage(StrEnum):
    """Model-facing stages that may be assigned to different model aliases."""

    CORRELATE_INCIDENT = "correlate_incident"
    PLAN_SOURCE_RESEARCH = "plan_source_research"
    PLAN_KNOWLEDGE_RESEARCH = "plan_knowledge_research"
    PLAN_EVIDENCE_RESEARCH = "plan_evidence_research"
    DIAGNOSE = "diagnose"
    PROPOSE_FIX = "propose_fix"
    PLAN_VERIFICATION = "plan_verification"
    PLAN_FIX_EXECUTION = "plan_fix_execution"
    VERIFY_FIX = "verify_fix"
    BENCHMARK_JUDGE = "benchmark_judge"


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
    """One named model's provider connection and structured-output settings."""

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


class ModelRouterConfig(ContractModel):
    """Complete model registry with exact reasoning-stage routes."""

    api_version: Literal["model-config/v2"] = "model-config/v2"
    models: dict[str, ModelConfig] = Field(min_length=1)
    default_model: str = Field(min_length=1)
    routes: dict[ReasoningStage, str] = Field(default_factory=dict[ReasoningStage, str])

    @field_validator("models")
    @classmethod
    def validate_model_aliases(cls, value: dict[str, ModelConfig]) -> dict[str, ModelConfig]:
        for alias in value:
            if not alias or not alias.replace("-", "_").isalnum():
                raise ValueError(
                    "Model aliases must contain only letters, numbers, underscores, or hyphens"
                )
        return value

    @field_validator("default_model")
    @classmethod
    def normalize_default_model(cls, value: str) -> str:
        return value.strip()

    @field_validator("routes")
    @classmethod
    def normalize_routes(cls, value: dict[ReasoningStage, str]) -> dict[ReasoningStage, str]:
        normalized: dict[ReasoningStage, str] = {}
        for stage, alias in value.items():
            resolved_alias = alias.strip()
            if not resolved_alias:
                raise ValueError("Model route aliases must not be blank")
            normalized[stage] = resolved_alias
        return normalized

    @model_validator(mode="after")
    def validate_route_targets(self) -> ModelRouterConfig:
        referenced = {self.default_model, *self.routes.values()}
        unknown = referenced - self.models.keys()
        if unknown:
            raise ValueError(
                "Model routes reference unknown aliases: " + ", ".join(sorted(unknown))
            )
        return self

    def model_alias_for_stage(self, stage: str) -> str:
        try:
            routed_stage = ReasoningStage(stage)
        except ValueError:
            return self.default_model
        return self.routes.get(routed_stage, self.default_model)


def parse_model_configuration_json(serialized: str) -> ModelRouterConfig:
    """Validate the routed model configuration accepted by CLI and Studio."""

    return ModelRouterConfig.model_validate_json(serialized)
