from __future__ import annotations

import asyncio
import os
from pathlib import Path

from langchain_core.runnables import RunnableConfig
from langgraph.graph.state import (  # pyright: ignore[reportMissingTypeStubs]
    CompiledStateGraph,
)
from langgraph_sdk.runtime import ServerRuntime

from maa_diagnostic_expert.interfaces.tool_adapter import (
    JsonlToolAdapterClient,
    default_tool_adapter_path,
)
from maa_diagnostic_expert.reasoning.langchain import make_langchain_backend
from maa_diagnostic_expert.reasoning.model_config import ModelConfig
from maa_diagnostic_expert.reasoning.prompts import make_stub_backend
from maa_diagnostic_expert.reasoning.protocol import ReasoningBackend
from maa_diagnostic_expert.workflow.graph import DiagnosticState, DiagnosticWorkflow

MODEL_CONFIG_ENV = "MDE_MODEL_CONFIG"

type StudioDiagnosticGraph = CompiledStateGraph[
    DiagnosticState,
    None,
    DiagnosticState,
    DiagnosticState,
]


def _reasoning_backend() -> ReasoningBackend:
    configured = os.environ.get(MODEL_CONFIG_ENV)
    if configured is None or not configured.strip():
        return make_stub_backend()
    path = Path(configured).expanduser().resolve()
    config = ModelConfig.model_validate_json(path.read_text(encoding="utf-8"))
    return make_langchain_backend(config)


def build_studio_workflow() -> DiagnosticWorkflow:
    """Build one isolated workflow for a Studio graph execution."""
    return DiagnosticWorkflow(
        tool_caller=JsonlToolAdapterClient(adapter_path=default_tool_adapter_path()),
        reasoning_backend=_reasoning_backend(),
    )


def _compile_studio_graph() -> StudioDiagnosticGraph:
    return build_studio_workflow().compile_graph()


async def make_graph(
    config: RunnableConfig,
    runtime: ServerRuntime,
) -> StudioDiagnosticGraph:
    """Create a fresh compiled graph for the LangGraph Agent Server."""
    del config, runtime
    return await asyncio.to_thread(_compile_studio_graph)
