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

from maa_diagnostic_expert.contracts.domain import (
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
from maa_diagnostic_expert.contracts.workflow import (
    ArtifactSourceInventory,
    BranchDisposition,
    IncidentCorrelationDraft,
    InvestigationBranch,
    InvestigationPlan,
)
from maa_diagnostic_expert.discovery.artifact_classification import (
    LogSourceProfile,
    classify_artifact_sources,
)
from maa_diagnostic_expert.discovery.preparation import prepare_analysis
from maa_diagnostic_expert.inspection.log_overview import (
    LogOverviewCollection,
    build_log_overviews,
    collect_log_overview_missing_evidence,
)
from maa_diagnostic_expert.inspection.models import DeterministicInspection
from maa_diagnostic_expert.inspection.service import (
    attach_incident_selection,
    attach_runtime_identity,
    inspect_prepared_analysis,
    synthesize_inspection_evidence,
)
from maa_diagnostic_expert.inspection.tooling import ToolCaller
from maa_diagnostic_expert.reasoning.prompts import (
    build_incident_correlation_context,
    build_reasoning_context,
)
from maa_diagnostic_expert.reasoning.protocol import ReasoningBackend, ReasoningContext

from .planning import plan_initial_investigation
from .validation import (
    collect_inspection_evidence,
    finalize_diagnosis_draft,
    validate_incident_correlation,
)

_DEFAULT_QUESTION = "Diagnose the runtime failures and their likely causes."


def _new_run_id() -> str:
    return secrets.token_hex(8)


class DiagnosticState(TypedDict):
    """Internal LangGraph state for one diagnostic run."""

    request: AnalysisRequest
    prepared: NotRequired[PreparedAnalysis]
    artifact_sources: NotRequired[ArtifactSourceInventory]
    log_overviews: NotRequired[LogOverviewCollection]
    plan: NotRequired[InvestigationPlan]
    inspection: NotRequired[DeterministicInspection]
    evidence: NotRequired[list[Evidence]]
    incident_correlation: NotRequired[IncidentCorrelationDraft]
    draft: NotRequired[DiagnosisDraft]
    result: NotRequired[DiagnosisResult]
    error_message: NotRequired[str]
    error_type: NotRequired[str]
    error_stage: NotRequired[str]


class _DiagnosticStateUpdate(TypedDict, total=False):
    prepared: PreparedAnalysis
    artifact_sources: ArtifactSourceInventory
    log_overviews: LogOverviewCollection
    plan: InvestigationPlan
    inspection: DeterministicInspection
    evidence: list[Evidence]
    incident_correlation: IncidentCorrelationDraft
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
    source_profiles: tuple[LogSourceProfile, ...] = ()
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
    def _after_prepare(state: DiagnosticState) -> Literal["classify_artifacts", "fail"]:
        return "fail" if "error_message" in state else "classify_artifacts"

    def _classify_artifacts_node(self, state: DiagnosticState) -> _DiagnosticStateUpdate:
        try:
            prepared = state.get("prepared")
            if prepared is None:
                raise RuntimeError("artifact classification requires prepared diagnostic inputs")
            inventory = classify_artifact_sources(prepared, self.source_profiles)
        except Exception as error:  # noqa: BLE001
            return _failure_update("classify_artifacts", error)

        counts: dict[str, JsonValue] = {
            kind: sum(item.source_kind.value == kind for item in inventory.classifications)
            for kind in ("maa_framework", "gui", "custom", "unknown")
        }
        _emit(
            _WorkflowUpdate(
                kind=DiagnosticEventKind.STAGE_COMPLETED,
                stage="classify_artifacts",
                message="Log artifact sources classified",
                data=counts,
            )
        )
        return {"artifact_sources": inventory}

    @staticmethod
    def _after_classify_artifacts(
        state: DiagnosticState,
    ) -> Literal["plan_overview", "fail"]:
        return "fail" if "error_message" in state else "plan_overview"

    def _plan_overview_node(self, state: DiagnosticState) -> _DiagnosticStateUpdate:
        try:
            prepared = state.get("prepared")
            if prepared is None:
                raise RuntimeError("overview planning requires prepared diagnostic inputs")
            inventory = state.get("artifact_sources")
            if inventory is None:
                raise RuntimeError("overview planning requires artifact source classification")
            plan = plan_initial_investigation(prepared, inventory)
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
    ) -> Literal["overview_logs", "inspect", "initialize_inspection", "fail"]:
        if "error_message" in state:
            return "fail"
        plan = state.get("plan")
        if plan is None:
            return "fail"
        if any(
            plan.decision_for(branch).disposition is BranchDisposition.RUN
            for branch in (
                InvestigationBranch.GUI_LOG_OVERVIEW,
                InvestigationBranch.CUSTOM_LOG_OVERVIEW,
            )
        ):
            return "overview_logs"
        return DiagnosticWorkflow._inspection_route(plan)

    @staticmethod
    def _inspection_route(
        plan: InvestigationPlan,
    ) -> Literal["inspect", "initialize_inspection"]:
        mla = plan.decision_for(InvestigationBranch.MLA_GLOBAL_OVERVIEW)
        mse = plan.decision_for(InvestigationBranch.MSE_PROJECT_PREFLIGHT)
        return (
            "inspect"
            if any(decision.disposition is BranchDisposition.RUN for decision in (mla, mse))
            else "initialize_inspection"
        )

    @staticmethod
    def _overview_logs_node(state: DiagnosticState) -> _DiagnosticStateUpdate:
        try:
            prepared = state.get("prepared")
            inventory = state.get("artifact_sources")
            if prepared is None or inventory is None:
                raise RuntimeError("log overview requires prepared and classified artifacts")
            overviews = build_log_overviews(prepared, inventory)
        except Exception as error:  # noqa: BLE001
            return _failure_update("overview_logs", error)

        _emit(
            _WorkflowUpdate(
                kind=DiagnosticEventKind.STAGE_COMPLETED,
                stage="overview_logs",
                message="GUI and custom log overviews complete",
                data={
                    "logs": len(overviews.overviews),
                    "occurrences": sum(
                        len(item.notable_occurrences) for item in overviews.overviews
                    ),
                },
            )
        )
        return {"log_overviews": overviews}

    @staticmethod
    def _after_overview_logs(
        state: DiagnosticState,
    ) -> Literal["inspect", "initialize_inspection", "fail"]:
        if "error_message" in state:
            return "fail"
        plan = state.get("plan")
        if plan is None:
            return "fail"
        return DiagnosticWorkflow._inspection_route(plan)

    @staticmethod
    def _initialize_inspection_node(state: DiagnosticState) -> _DiagnosticStateUpdate:
        prepared = state.get("prepared")
        if prepared is None:
            return _failure_update(
                "initialize_inspection",
                RuntimeError("inspection initialization requires prepared inputs"),
            )
        overviews = state.get("log_overviews") or LogOverviewCollection()
        overview_missing = collect_log_overview_missing_evidence(overviews)
        prepared_with_overview = prepared.model_copy(
            update={
                "missing_evidence": [*prepared.missing_evidence, *overview_missing],
            }
        )
        inspection = DeterministicInspection(
            prepared=prepared_with_overview,
            log_overviews=overviews,
        )
        _emit(
            _WorkflowUpdate(
                kind=DiagnosticEventKind.STAGE_COMPLETED,
                stage="inspect",
                message="Deterministic tool inspection skipped because no eligible input was found",
                data={
                    "preflights": 0,
                    "runtime_inspections": 0,
                    "mse_projects": 0,
                    "missing": 0,
                },
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
            inspection = inspect_prepared_analysis(
                prepared,
                self.tool_caller,
                state.get("log_overviews"),
                state.get("artifact_sources"),
            )
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
                    "mse_projects": len(inspection.mse_project_inspections),
                    "missing": len(inspection.prepared.missing_evidence),
                },
            )
        )
        return {"inspection": inspection}

    @staticmethod
    def _after_inspect(state: DiagnosticState) -> Literal["identify_runtime", "fail"]:
        return "fail" if "error_message" in state else "identify_runtime"

    @staticmethod
    def _identify_runtime_node(state: DiagnosticState) -> _DiagnosticStateUpdate:
        try:
            inspection = state.get("inspection")
            if inspection is None:
                raise RuntimeError("runtime identity extraction requires deterministic inspection")
            inspection = attach_runtime_identity(inspection)
        except Exception as error:  # noqa: BLE001
            return _failure_update("identify_runtime", error)

        _emit(
            _WorkflowUpdate(
                kind=DiagnosticEventKind.STAGE_COMPLETED,
                stage="identify_runtime",
                message="Runtime version observations extracted",
                data={"versions": len(inspection.runtime_identity.versions)},
            )
        )
        return {"inspection": inspection}

    @staticmethod
    def _after_identify_runtime(state: DiagnosticState) -> Literal["synthesize", "fail"]:
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
    def _after_synthesize(state: DiagnosticState) -> Literal["identify_incident", "fail"]:
        return "fail" if "error_message" in state else "identify_incident"

    @staticmethod
    def _identify_incident_node(state: DiagnosticState) -> _DiagnosticStateUpdate:
        try:
            inspection = state.get("inspection")
            if inspection is None:
                raise RuntimeError(
                    "incident candidate generation requires deterministic inspection"
                )
            inspection = attach_incident_selection(inspection)
        except Exception as error:  # noqa: BLE001
            return _failure_update("identify_incident", error)

        selection = inspection.incident_selection
        _emit(
            _WorkflowUpdate(
                kind=DiagnosticEventKind.STAGE_COMPLETED,
                stage="identify_incident",
                message="Deterministic incident candidates generated",
                data={
                    "status": selection.status.value,
                    "candidates": len(selection.candidates),
                },
            )
        )
        return {"inspection": inspection}

    @staticmethod
    def _after_identify_incident(
        state: DiagnosticState,
    ) -> Literal["correlate_incident", "reason", "fail"]:
        if "error_message" in state:
            return "fail"
        inspection = state.get("inspection")
        if inspection is not None and inspection.incident_selection.candidates:
            return "correlate_incident"
        return "reason"

    async def _correlate_incident_node(self, state: DiagnosticState) -> _DiagnosticStateUpdate:
        try:
            if self.run_id in self._cancelled:
                raise RuntimeError("workflow cancelled before incident correlation")
            inspection = state.get("inspection")
            if inspection is None:
                raise RuntimeError("incident correlation requires deterministic inspection")
            evidence = state.get("evidence", [])
            request = state["request"]
            reported_parts = [
                value
                for value in (
                    f"Issue: {request.issue}" if request.issue else None,
                    f"Question: {request.question}" if request.question else None,
                )
                if value is not None
            ]
            reported_context = "\n".join(reported_parts) or _DEFAULT_QUESTION
            context = build_incident_correlation_context(
                reported_context,
                evidence,
                inspection.incident_selection,
            )

            _emit(
                _WorkflowUpdate(
                    kind=DiagnosticEventKind.MODEL_REQUESTED,
                    stage="correlate_incident",
                    message="Requesting incident correlation",
                    data={
                        "candidates": len(inspection.incident_selection.candidates),
                        "evidence_count": len(context.evidence),
                    },
                )
            )
            session = await self.reasoning_backend.start(run_id=self.run_id)
            try:
                draft = await session.reason(context, IncidentCorrelationDraft)
            finally:
                await session.close()
            draft = validate_incident_correlation(draft, inspection.incident_selection)
        except Exception as error:  # noqa: BLE001
            return _failure_update("correlate_incident", error)

        _emit(
            _WorkflowUpdate(
                kind=DiagnosticEventKind.MODEL_COMPLETED,
                stage="correlate_incident",
                message="Incident correlation complete",
                data={
                    "status": draft.status.value,
                    "selected": draft.selected_candidate_id or "",
                    "relevant_candidates": len(draft.relevant_candidate_ids),
                },
            )
        )
        return {"incident_correlation": draft}

    @staticmethod
    def _after_correlate_incident(state: DiagnosticState) -> Literal["reason", "fail"]:
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
            context: ReasoningContext = build_reasoning_context(
                question,
                evidence,
                inspection.incident_selection,
                state.get("incident_correlation"),
            )

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
            result = finalize_diagnosis_draft(
                draft,
                inspection,
                state.get("incident_correlation"),
            )
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
        _add_graph_node(graph, "classify_artifacts", self._classify_artifacts_node)
        _add_graph_node(graph, "plan_overview", self._plan_overview_node)
        _add_graph_node(graph, "overview_logs", self._overview_logs_node)
        _add_graph_node(graph, "inspect", self._inspect_node)
        _add_graph_node(graph, "initialize_inspection", self._initialize_inspection_node)
        _add_graph_node(graph, "identify_runtime", self._identify_runtime_node)
        _add_graph_node(graph, "synthesize", self._synthesize_node)
        _add_graph_node(graph, "identify_incident", self._identify_incident_node)
        _add_graph_node(graph, "correlate_incident", self._correlate_incident_node)
        _add_graph_node(graph, "reason", self._reason_node)
        _add_graph_node(graph, "validate", self._validate_node)
        _add_graph_node(graph, "fail", self._fail_node)
        _add_graph_node(graph, "complete", self._complete_node)
        graph.add_edge(START, "start")
        graph.add_edge("start", "prepare")
        graph.add_conditional_edges("prepare", self._after_prepare)
        graph.add_conditional_edges("classify_artifacts", self._after_classify_artifacts)
        graph.add_conditional_edges("plan_overview", self._after_plan_overview)
        graph.add_conditional_edges("overview_logs", self._after_overview_logs)
        graph.add_edge("initialize_inspection", "identify_runtime")
        graph.add_conditional_edges("inspect", self._after_inspect)
        graph.add_conditional_edges("identify_runtime", self._after_identify_runtime)
        graph.add_conditional_edges("synthesize", self._after_synthesize)
        graph.add_conditional_edges("identify_incident", self._after_identify_incident)
        graph.add_conditional_edges("correlate_incident", self._after_correlate_incident)
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
