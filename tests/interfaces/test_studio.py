from __future__ import annotations

import asyncio
from pathlib import Path
from typing import cast

import pytest
from langgraph_sdk.runtime import ServerRuntime

from maa_diagnostic_expert.contracts.domain import AnalysisRequest, DiagnosisStatus
from maa_diagnostic_expert.interfaces import studio
from maa_diagnostic_expert.interfaces.tool_adapter import JsonlToolAdapterClient
from maa_diagnostic_expert.reasoning.model_config import ModelConfig
from maa_diagnostic_expert.reasoning.prompts import StubReasoningBackend, make_stub_backend
from maa_diagnostic_expert.reasoning.protocol import ReasoningBackend
from maa_diagnostic_expert.workflow.graph import DiagnosticState


def test_studio_workflow_uses_stub_without_model_config(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv(studio.MODEL_CONFIG_ENV, raising=False)
    monkeypatch.delenv("MDE_TOOL_ADAPTER_PATH", raising=False)

    workflow = studio.build_studio_workflow()
    tool_caller = cast(JsonlToolAdapterClient, workflow.tool_caller)

    assert isinstance(workflow.reasoning_backend, StubReasoningBackend)
    assert tool_caller.adapter_path.is_file()


def test_studio_workflow_loads_model_config_from_environment(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    config_path = tmp_path / "model.json"
    config_path.write_text(
        ModelConfig(provider="openai", model="test-model").model_dump_json(),
        encoding="utf-8",
    )
    captured: list[ModelConfig] = []
    backend = make_stub_backend()

    def fake_backend(config: ModelConfig) -> ReasoningBackend:
        captured.append(config)
        return backend

    monkeypatch.setenv(studio.MODEL_CONFIG_ENV, str(config_path))
    monkeypatch.setattr(studio, "make_langchain_backend", fake_backend)

    workflow = studio.build_studio_workflow()

    assert workflow.reasoning_backend is backend
    assert captured == [ModelConfig(provider="openai", model="test-model")]


def test_studio_workflow_loads_direct_api_key_from_local_config(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    config_path = tmp_path / "model.local.json"
    config_path.write_text(
        ModelConfig(
            provider="openai",
            model="test-model",
            api_key="local-secret",
        ).model_dump_json(),
        encoding="utf-8",
    )
    captured: list[ModelConfig] = []
    backend = make_stub_backend()

    def fake_backend(config: ModelConfig) -> ReasoningBackend:
        captured.append(config)
        return backend

    monkeypatch.setenv(studio.MODEL_CONFIG_ENV, str(config_path))
    monkeypatch.setattr(studio, "make_langchain_backend", fake_backend)

    workflow = studio.build_studio_workflow()

    assert workflow.reasoning_backend is backend
    assert captured == [ModelConfig(provider="openai", model="test-model", api_key="local-secret")]


def test_studio_graph_validates_serialized_analysis_request(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv(studio.MODEL_CONFIG_ENV, raising=False)
    graph = asyncio.run(studio.make_graph({}, cast(ServerRuntime, object())))
    serialized_request = cast(
        AnalysisRequest,
        cast(
            object,
            {
                "api_version": "analysis-request/v2",
                "question": "Diagnose without artifacts.",
            },
        ),
    )
    serialized_state: DiagnosticState = {"request": serialized_request}

    raw_state = asyncio.run(
        graph.ainvoke(  # pyright: ignore[reportUnknownMemberType]
            serialized_state
        )
    )
    state = cast(DiagnosticState, raw_state)
    result = state.get("result")

    assert isinstance(state["request"], AnalysisRequest)
    assert result is not None
    assert result.status is DiagnosisStatus.INSUFFICIENT_EVIDENCE
