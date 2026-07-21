from __future__ import annotations

import secrets
from collections.abc import AsyncIterator, Awaitable, Callable
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Literal, NotRequired, TypedDict

from langgraph.config import get_stream_writer
from langgraph.graph import END, START, StateGraph  # pyright: ignore[reportMissingTypeStubs]
from langgraph.graph.state import (  # pyright: ignore[reportMissingTypeStubs]
    CompiledStateGraph,
)

from .agent import ReasoningBackend, ReasoningContext
from .diagnosis_validation import collect_inspection_evidence, finalize_diagnosis_draft
from .domain import (
    AnalysisRequest,
    DiagnosisDraft,
    DiagnosisResult,
    DiagnosisStatus,
    DiagnosticEvent,
    DiagnosticEventKind,
    Evidence,
    JsonValue,
    PreparedAnalysis,
)
from .inspection import (
    DeterministicInspection,
    ToolCaller,
    inspect_prepared_analysis,
    synthesize_inspection_evidence,
)
from .preparation import prepare_analysis
from .reasoning import build_reasoning_context
from .workflow_contracts import (
    BranchDisposition,
    InvestigationBranch,
    InvestigationPlan,
)
from .workflow_planning import plan_initial_investigation

_DEFAULT_QUESTION = "Diagnose the runtime failures and their likely causes."


def _new_run_id() -> str:
    return secrets.token_hex(8)


class DiagnosticState(TypedDict):
    """Internal LangGraph state for one diagnostic run."""

    request: AnalysisRequest
    prepared: NotRequired[PreparedAnalysis]
    plan: NotRequired[InvestigationPlan]
    inspection: NotRequired[DeterministicInspection]
    evidence: NotRequired[list[Evidence]]
    draft: NotRequired[DiagnosisDraft]
    result: NotRequired[DiagnosisResult]
    error_message: NotRequired[str]
    error_type: NotRequired[str]
    error_stage: NotRequired[str]


class _DiagnosticStateUpdate(TypedDict, total=False):
    prepared: PreparedAnalysis
    plan: InvestigationPlan
    inspection: DeterministicInspection
    evidence: list[Evidence]
    draft: DiagnosisDraft
    result: DiagnosisResult
    error_message: str
    error_type: str
    error_stage: str


type _GraphNode = (
    Callable[[DiagnosticState], _DiagnosticStateUpdate]
    | Callable[[DiagnosticState], Awaitable[_DiagnosticStateUpdate]]
)
type _CompiledDiagnosticGraph = CompiledStateGraph[
    DiagnosticState,
    None,
    DiagnosticState,
    DiagnosticState,
]


@dataclass(frozen=True, slots=True)
class _WorkflowUpdate:
    kind: DiagnosticEventKind
    stage: str
    message: str
    data: dict[str, JsonValue] = field(default_factory=dict[str, JsonValue])
    result: DiagnosisResult | None = None


def _emit(update: _WorkflowUpdate) -> None:
    get_stream_writer()(update)


def _failure_update(stage: str, error: Exception) -> _DiagnosticStateUpdate:
    return {
        "error_message": f"Workflow failed: {error}",
        "error_type": type(error).__name__,
        "error_stage": stage,
    }


def _add_graph_node(
    graph: StateGraph[DiagnosticState, None, DiagnosticState, DiagnosticState],
    name: str,
    node: _GraphNode,
) -> None:
    # LangGraph 1.2.9 exposes unparameterized cache/error-handler types in this overload.
    graph.add_node(name, node)  # pyright: ignore[reportUnknownMemberType, reportArgumentType]


def _compile_graph(
    graph: StateGraph[DiagnosticState, None, DiagnosticState, DiagnosticState],
) -> _CompiledDiagnosticGraph:
    # LangGraph 1.2.9 exposes an unparameterized checkpointer type in this signature.
    return graph.compile()  # pyright: ignore[reportUnknownMemberType]


async def _stream_graph(
    graph: _CompiledDiagnosticGraph,
    initial_state: DiagnosticState,
) -> AsyncIterator[object]:
    # LangGraph 1.2.9 exposes an unparameterized Command type in this overload.
    async for update in graph.astream(  # pyright: ignore[reportUnknownMemberType]
        initial_state,
        stream_mode="custom",
    ):
        yield update


@dataclass
class DiagnosticWorkflow:
    """LangGraph-backed end-to-end diagnostic workflow.

    The public facade remains framework-independent for CLI and host integrations,
    while LangGraph owns node transitions and failure routing internally.
    """

    tool_caller: ToolCaller
    reasoning_backend: ReasoningBackend
    run_id: str = field(default_factory=_new_run_id)
    _cancelled: set[str] = field(default_factory=set[str], init=False, repr=False)
    _result: DiagnosisResult | None = field(default=None, init=False, repr=False)

    @property
    def result(self) -> DiagnosisResult | None:
        """Result produced by the most recent run, or None if not finished."""
        return self._result

    async def cancel(self, run_id: str) -> None:
        self._cancelled.add(run_id)

    async def diagnose(self, request: AnalysisRequest) -> DiagnosisResult:
        self._result = None
        async for _ in self._run(request):
            pass
        if self._result is None:
            raise RuntimeError("diagnostic workflow did not produce a result")
        return self._result

    def stream(self, request: AnalysisRequest) -> AsyncIterator[DiagnosticEvent]:
        self._result = None
        return self._run(request)

    def _start_node(self, state: DiagnosticState) -> _DiagnosticStateUpdate:
        del state
        _emit(
            _WorkflowUpdate(
                kind=DiagnosticEventKind.RUN_STARTED,
                stage="workflow",
                message="Started diagnostic workflow",
                data={"run_id": self.run_id},
            )
        )
        return {}

    def _prepare_node(self, state: DiagnosticState) -> _DiagnosticStateUpdate:
        try:
            if self.run_id in self._cancelled:
                raise RuntimeError("workflow cancelled before preparation")
            _emit(
                _WorkflowUpdate(
                    kind=DiagnosticEventKind.STAGE_STARTED,
                    stage="prepare",
                    message="Preparing diagnostic inputs",
                )
            )
            prepared = prepare_analysis(state["request"])
        except Exception as error:  # noqa: BLE001
            return _failure_update("prepare", error)

        _emit(
            _WorkflowUpdate(
                kind=DiagnosticEventKind.STAGE_COMPLETED,
                stage="prepare",
                message="Diagnostic inputs prepared",
                data={
                    "artifacts": len(prepared.artifacts),
                    "sources": len(prepared.source_snapshots),
                    "missing": len(prepared.missing_evidence),
                },
            )
        )
        return {"prepared": prepared}

    @staticmethod
    def _after_prepare(state: DiagnosticState) -> Literal["plan_overview", "fail"]:
        return "fail" if "error_message" in state else "plan_overview"

    def _plan_overview_node(self, state: DiagnosticState) -> _DiagnosticStateUpdate:
        try:
            prepared = state.get("prepared")
            if prepared is None:
                raise RuntimeError("overview planning requires prepared diagnostic inputs")
            plan = plan_initial_investigation(prepared)
        except Exception as error:  # noqa: BLE001
            return _failure_update("plan_overview", error)

        run_count = sum(
            decision.disposition is BranchDisposition.RUN for decision in plan.decisions
        )
        deferred_count = sum(
            decision.disposition is BranchDisposition.DEFERRED for decision in plan.decisions
        )
        _emit(
            _WorkflowUpdate(
                kind=DiagnosticEventKind.STAGE_COMPLETED,
                stage="plan_overview",
                message="Initial investigation branches planned",
                data={"run": run_count, "deferred": deferred_count},
            )
        )
        return {"plan": plan}

    @staticmethod
    def _after_plan_overview(
        state: DiagnosticState,
    ) -> Literal["inspect", "initialize_inspection", "fail"]:
        if "error_message" in state:
            return "fail"
        plan = state.get("plan")
        if plan is None:
            return "fail"
        mla = plan.decision_for(InvestigationBranch.MLA_GLOBAL_OVERVIEW)
        return "inspect" if mla.disposition is BranchDisposition.RUN else "initialize_inspection"

    @staticmethod
    def _initialize_inspection_node(state: DiagnosticState) -> _DiagnosticStateUpdate:
        prepared = state.get("prepared")
        if prepared is None:
            return _failure_update(
                "initialize_inspection",
                RuntimeError("inspection initialization requires prepared inputs"),
            )
        inspection = DeterministicInspection(prepared=prepared)
        _emit(
            _WorkflowUpdate(
                kind=DiagnosticEventKind.STAGE_COMPLETED,
                stage="inspect",
                message="MLA inspection skipped because no eligible artifact was found",
                data={"preflights": 0, "runtime_inspections": 0, "missing": 0},
            )
        )
        return {"inspection": inspection}

    def _inspect_node(self, state: DiagnosticState) -> _DiagnosticStateUpdate:
        try:
            prepared = state.get("prepared")
            if prepared is None:
                raise RuntimeError("inspection requires prepared diagnostic inputs")
            if self.run_id in self._cancelled:
                raise RuntimeError("workflow cancelled before inspection")
            _emit(
                _WorkflowUpdate(
                    kind=DiagnosticEventKind.STAGE_STARTED,
                    stage="inspect",
                    message="Running deterministic inspection",
                )
            )
            inspection = inspect_prepared_analysis(prepared, self.tool_caller)
        except Exception as error:  # noqa: BLE001
            return _failure_update("inspect", error)

        _emit(
            _WorkflowUpdate(
                kind=DiagnosticEventKind.STAGE_COMPLETED,
                stage="inspect",
                message="Deterministic inspection complete",
                data={
                    "preflights": len(inspection.mla_preflights),
                    "runtime_inspections": len(inspection.mla_runtime_inspections),
                    "missing": len(inspection.prepared.missing_evidence),
                },
            )
        )
        return {"inspection": inspection}

    @staticmethod
    def _after_inspect(state: DiagnosticState) -> Literal["synthesize", "fail"]:
        return "fail" if "error_message" in state else "synthesize"

    def _synthesize_node(self, state: DiagnosticState) -> _DiagnosticStateUpdate:
        _emit(
            _WorkflowUpdate(
                kind=DiagnosticEventKind.STAGE_STARTED,
                stage="synthesize",
                message="Synthesizing authoritative evidence",
            )
        )
        try:
            inspection = state.get("inspection")
            if inspection is None:
                raise RuntimeError("evidence synthesis requires deterministic inspection")
            inspection = synthesize_inspection_evidence(inspection)
            evidence = collect_inspection_evidence(inspection)
        except Exception as error:  # noqa: BLE001
            return _failure_update("synthesize", error)

        _emit(
            _WorkflowUpdate(
                kind=DiagnosticEventKind.STAGE_COMPLETED,
                stage="synthesize",
                message="Authoritative evidence synthesized",
                data={
                    "evidence": len(evidence),
                },
            )
        )
        if evidence:
            _emit(
                _WorkflowUpdate(
                    kind=DiagnosticEventKind.EVIDENCE_ADDED,
                    stage="synthesize",
                    message=f"Synthesized {len(evidence)} evidence items",
                    data={"count": len(evidence)},
                )
            )
        return {"inspection": inspection, "evidence": evidence}

    @staticmethod
    def _after_synthesize(state: DiagnosticState) -> Literal["reason", "fail"]:
        return "fail" if "error_message" in state else "reason"

    async def _reason_node(self, state: DiagnosticState) -> _DiagnosticStateUpdate:
        try:
            if self.run_id in self._cancelled:
                raise RuntimeError("workflow cancelled before reasoning")
            inspection = state.get("inspection")
            if inspection is None:
                raise RuntimeError("reasoning requires deterministic inspection")
            evidence = state.get("evidence", [])
            question = state["request"].question or _DEFAULT_QUESTION
            context: ReasoningContext = build_reasoning_context(question, evidence)

            _emit(
                _WorkflowUpdate(
                    kind=DiagnosticEventKind.MODEL_REQUESTED,
                    stage="reason",
                    message="Requesting diagnostic reasoning",
                    data={"evidence_count": len(evidence)},
                )
            )
            session = await self.reasoning_backend.start(run_id=self.run_id)
            try:
                draft = await session.reason(context, DiagnosisDraft)
            finally:
                await session.close()
        except Exception as error:  # noqa: BLE001
            return _failure_update("reason", error)

        _emit(
            _WorkflowUpdate(
                kind=DiagnosticEventKind.MODEL_COMPLETED,
                stage="reason",
                message="Diagnostic reasoning complete",
                data={"conclusions": len(draft.conclusions)},
            )
        )
        return {"draft": draft}

    @staticmethod
    def _after_reason(state: DiagnosticState) -> Literal["validate", "fail"]:
        return "fail" if "error_message" in state else "validate"

    def _validate_node(self, state: DiagnosticState) -> _DiagnosticStateUpdate:
        _emit(
            _WorkflowUpdate(
                kind=DiagnosticEventKind.STAGE_STARTED,
                stage="validate",
                message="Validating diagnosis against authoritative evidence",
            )
        )
        try:
            inspection = state.get("inspection")
            draft = state.get("draft")
            if inspection is None or draft is None:
                raise RuntimeError("validation requires inspection and diagnosis draft")
            result = finalize_diagnosis_draft(draft, inspection)
        except Exception as error:  # noqa: BLE001
            return _failure_update("validate", error)

        _emit(
            _WorkflowUpdate(
                kind=DiagnosticEventKind.STAGE_COMPLETED,
                stage="validate",
                message="Diagnosis validation complete",
                data={"cited_evidence": len(result.evidence)},
            )
        )
        _emit(
            _WorkflowUpdate(
                kind=DiagnosticEventKind.RUN_COMPLETED,
                stage="workflow",
                message="Diagnostic workflow complete",
                data={
                    "status": result.status.value,
                    "conclusions": len(result.conclusions),
                    "evidence": len(result.evidence),
                },
                result=result,
            )
        )
        return {"result": result}

    @staticmethod
    def _after_validate(state: DiagnosticState) -> Literal["complete", "fail"]:
        return "fail" if "error_message" in state else "complete"

    def _fail_node(self, state: DiagnosticState) -> _DiagnosticStateUpdate:
        message = state.get("error_message", "Workflow failed")
        inspection = state.get("inspection")
        prepared = state.get("prepared")
        evidence = state.get("evidence", [])
        if inspection is not None:
            missing_codes = [item.code for item in inspection.prepared.missing_evidence]
        elif prepared is not None:
            missing_codes = [item.code for item in prepared.missing_evidence]
        else:
            missing_codes = []
        result = DiagnosisResult(
            status=DiagnosisStatus.FAILED,
            summary=message,
            evidence=evidence,
            conclusions=[],
            missing_evidence=missing_codes,
        )
        _emit(
            _WorkflowUpdate(
                kind=DiagnosticEventKind.RUN_FAILED,
                stage=state.get("error_stage", "workflow"),
                message=message,
                data={"error_type": state.get("error_type", "RuntimeError")},
                result=result,
            )
        )
        return {"result": result}

    @staticmethod
    def _complete_node(state: DiagnosticState) -> _DiagnosticStateUpdate:
        del state
        return {}

    def _build_graph(
        self,
    ) -> _CompiledDiagnosticGraph:
        graph = StateGraph(DiagnosticState)
        _add_graph_node(graph, "start", self._start_node)
        _add_graph_node(graph, "prepare", self._prepare_node)
        _add_graph_node(graph, "plan_overview", self._plan_overview_node)
        _add_graph_node(graph, "inspect", self._inspect_node)
        _add_graph_node(graph, "initialize_inspection", self._initialize_inspection_node)
        _add_graph_node(graph, "synthesize", self._synthesize_node)
        _add_graph_node(graph, "reason", self._reason_node)
        _add_graph_node(graph, "validate", self._validate_node)
        _add_graph_node(graph, "fail", self._fail_node)
        _add_graph_node(graph, "complete", self._complete_node)
        graph.add_edge(START, "start")
        graph.add_edge("start", "prepare")
        graph.add_conditional_edges("prepare", self._after_prepare)
        graph.add_conditional_edges("plan_overview", self._after_plan_overview)
        graph.add_edge("initialize_inspection", "synthesize")
        graph.add_conditional_edges("inspect", self._after_inspect)
        graph.add_conditional_edges("synthesize", self._after_synthesize)
        graph.add_conditional_edges("reason", self._after_reason)
        graph.add_conditional_edges("validate", self._after_validate)
        graph.add_edge("fail", END)
        graph.add_edge("complete", END)
        return _compile_graph(graph)

    async def _run(self, request: AnalysisRequest) -> AsyncIterator[DiagnosticEvent]:
        sequence = 0
        initial_state: DiagnosticState = {"request": request}
        graph = self._build_graph()
        async for raw_update in _stream_graph(graph, initial_state):
            if not isinstance(raw_update, _WorkflowUpdate):
                raise TypeError("LangGraph returned an unexpected custom stream update")
            update = raw_update
            if update.result is not None:
                self._result = update.result
            yield DiagnosticEvent(
                run_id=self.run_id,
                sequence=sequence,
                occurred_at=datetime.now(UTC),
                kind=update.kind,
                stage=update.stage,
                message=update.message,
                data=update.data,
            )
            sequence += 1
