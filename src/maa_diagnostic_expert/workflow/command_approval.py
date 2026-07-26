from __future__ import annotations

import secrets
from collections.abc import Awaitable, Callable
from typing import Literal, NotRequired, TypedDict, cast

from langchain_core.runnables import RunnableConfig
from langgraph.checkpoint.memory import InMemorySaver
from langgraph.graph import END, START, StateGraph  # pyright: ignore[reportMissingTypeStubs]
from langgraph.graph.state import (  # pyright: ignore[reportMissingTypeStubs]
    CompiledStateGraph,
)
from langgraph.types import Command, interrupt

from maa_diagnostic_expert.contracts.command import (
    CommandApprovalDecision,
    CommandApprovalOutcome,
    CommandApprovalPrompt,
    CommandApprovalResponse,
    CommandApprovalStatus,
    CommandExecutionResult,
    CommandExecutionStatus,
    CommandRequest,
)
from maa_diagnostic_expert.reasoning.tools.command import CommandExecutor


class CommandApprovalState(TypedDict):
    approval_id: str
    request: CommandRequest
    pending_execution: NotRequired[CommandExecutionResult]
    approval: NotRequired[CommandApprovalPrompt]
    response: NotRequired[CommandApprovalResponse]
    execution: NotRequired[CommandExecutionResult]


type _CommandStateUpdate = dict[
    str,
    CommandExecutionResult | CommandApprovalPrompt | CommandApprovalResponse,
]
type _CommandNode = Callable[
    [CommandApprovalState],
    _CommandStateUpdate | Awaitable[_CommandStateUpdate],
]
type _CompiledCommandGraph = CompiledStateGraph[
    CommandApprovalState,
    None,
    CommandApprovalState,
    CommandApprovalState,
]


def _new_approval_id() -> str:
    return secrets.token_hex(16)


def _add_graph_node(
    graph: StateGraph[
        CommandApprovalState,
        None,
        CommandApprovalState,
        CommandApprovalState,
    ],
    name: str,
    node: _CommandNode,
) -> None:
    graph.add_node(name, node)  # pyright: ignore[reportUnknownMemberType, reportArgumentType]


def _config(approval_id: str) -> RunnableConfig:
    return {"configurable": {"thread_id": approval_id}}


class CommandApprovalWorkflow:
    """Resumable LangGraph boundary for harness-owned command approval."""

    def __init__(self, executor: CommandExecutor) -> None:
        self.executor = executor
        self._graph = self._build_graph()

    async def submit(self, request: CommandRequest) -> CommandApprovalOutcome:
        approval_id = _new_approval_id()
        state: CommandApprovalState = {
            "approval_id": approval_id,
            "request": request,
        }
        raw = await self._graph.ainvoke(  # pyright: ignore[reportUnknownMemberType]
            state,
            config=_config(approval_id),
        )
        return self._outcome(cast(CommandApprovalState, raw))

    async def resume(self, response: CommandApprovalResponse) -> CommandApprovalOutcome:
        config = _config(response.approval_id)
        snapshot = await self._graph.aget_state(  # pyright: ignore[reportUnknownMemberType]
            config
        )
        values = cast(CommandApprovalState, snapshot.values)
        approval = values.get("approval")
        if approval is None or not snapshot.next:
            raise ValueError(f"No command approval is pending for '{response.approval_id}'")
        if approval.approval_id != response.approval_id:
            raise ValueError("Approval response does not match the pending command")
        raw = await self._graph.ainvoke(  # pyright: ignore[reportUnknownMemberType]
            Command(resume=response.model_dump(mode="json")),
            config=config,
        )
        return self._outcome(cast(CommandApprovalState, raw))

    async def _evaluate_node(self, state: CommandApprovalState) -> _CommandStateUpdate:
        result = await self.executor.execute(state["request"])
        update: _CommandStateUpdate = {"pending_execution": result}
        if result.status is CommandExecutionStatus.APPROVAL_REQUIRED:
            update["approval"] = CommandApprovalPrompt(
                approval_id=state["approval_id"],
                pending_execution=result,
            )
        else:
            update["execution"] = result
        return update

    @staticmethod
    def _after_evaluate(
        state: CommandApprovalState,
    ) -> Literal["await_approval", "complete"]:
        return "await_approval" if "approval" in state else "complete"

    @staticmethod
    def _await_approval_node(state: CommandApprovalState) -> _CommandStateUpdate:
        approval = state.get("approval")
        if approval is None:
            raise RuntimeError("command approval node requires an approval prompt")
        raw_response = interrupt(approval.model_dump(mode="json"))
        response = CommandApprovalResponse.model_validate(raw_response)
        if response.approval_id != approval.approval_id:
            raise ValueError("Approval response does not match the pending command")
        return {"response": response}

    @staticmethod
    def _after_approval(
        state: CommandApprovalState,
    ) -> Literal["execute_approved", "complete"]:
        response = state.get("response")
        if response is None:
            raise RuntimeError("command approval response is missing")
        if response.decision is CommandApprovalDecision.APPROVE:
            return "execute_approved"
        return "complete"

    async def _execute_approved_node(
        self,
        state: CommandApprovalState,
    ) -> _CommandStateUpdate:
        approval = state.get("approval")
        if approval is None:
            raise RuntimeError("approved command execution requires the original prompt")
        result = await self.executor.execute(
            approval.pending_execution.request,
            approved=True,
        )
        if result.status is CommandExecutionStatus.APPROVAL_REQUIRED:
            raise RuntimeError("approved command unexpectedly requested approval again")
        return {"execution": result}

    @staticmethod
    def _complete_node(state: CommandApprovalState) -> _CommandStateUpdate:
        del state
        return {}

    def _build_graph(self) -> _CompiledCommandGraph:
        graph = StateGraph(CommandApprovalState)
        _add_graph_node(graph, "evaluate", self._evaluate_node)
        _add_graph_node(graph, "await_approval", self._await_approval_node)
        _add_graph_node(graph, "execute_approved", self._execute_approved_node)
        _add_graph_node(graph, "complete", self._complete_node)
        graph.add_edge(START, "evaluate")
        graph.add_conditional_edges("evaluate", self._after_evaluate)
        graph.add_conditional_edges("await_approval", self._after_approval)
        graph.add_edge("execute_approved", "complete")
        graph.add_edge("complete", END)
        return graph.compile(  # pyright: ignore[reportUnknownMemberType, reportReturnType]
            checkpointer=InMemorySaver()
        )

    @staticmethod
    def _outcome(state: CommandApprovalState) -> CommandApprovalOutcome:
        approval_id = state["approval_id"]
        approval = state.get("approval")
        response = state.get("response")
        execution = state.get("execution")
        if response is not None and response.decision is CommandApprovalDecision.REJECT:
            status = CommandApprovalStatus.REJECTED
        elif execution is not None:
            status = CommandApprovalStatus.FINISHED
        else:
            status = CommandApprovalStatus.AWAITING_APPROVAL
        return CommandApprovalOutcome(
            approval_id=approval_id,
            status=status,
            approval=approval,
            response=response,
            execution=execution,
        )
