from __future__ import annotations

import asyncio

import pytest

from maa_diagnostic_expert.contracts.domain import (
    ContractModel,
    DiagnosisDraft,
    DiagnosisStatus,
    Evidence,
    EvidenceReliability,
    EvidenceRole,
    SourceRole,
)
from maa_diagnostic_expert.contracts.workflow import (
    IncidentCandidate,
    IncidentComparison,
    IncidentComparisonFinding,
    IncidentComparisonFindingKind,
    IncidentComparisonStatus,
    IncidentCorrelationDraft,
    IncidentExpectedTask,
    IncidentSelection,
    IncidentSelectionStatus,
    KnowledgeResearchPlan,
    SourceResearchPlan,
    SourceResearchStatus,
)
from maa_diagnostic_expert.reasoning.prompts import (
    StubReasoningBackend,
    StubReasoningSession,
    build_incident_correlation_context,
    build_knowledge_research_context,
    build_reasoning_context,
    build_source_research_context,
    order_evidence_for_reasoning,
    render_evidence_block,
    render_instruction,
)


def _evidence(
    evidence_id: str,
    reliability: EvidenceReliability,
    *,
    kind: str = "test_observation",
    role: EvidenceRole = EvidenceRole.CONTEXT,
    content: str = "failure detail",
    line_start: int | None = 42,
) -> Evidence:
    return Evidence(
        id=evidence_id,
        kind=kind,
        source_component="mla:runtime-inspection",
        source_path="maafw.log",
        content=content,
        line_start=line_start,
        line_end=line_start,
        task_id=1,
        role=role,
        reliability=reliability,
    )


def _incident_selection() -> IncidentSelection:
    return IncidentSelection(
        status=IncidentSelectionStatus.AMBIGUOUS,
        candidates=[
            IncidentCandidate(
                candidate_id="incident-1",
                task_name="CombatTask",
                confidence=0.9,
                evidence_ids=["candidate-evidence"],
                reasons=["The task failed."],
            )
        ],
    )


def test_order_evidence_puts_failures_before_signals_and_context() -> None:
    context_ev = _evidence("ctx-1", EvidenceReliability.CONTEXT, kind="session_summary")
    primary_ev = _evidence("pri-1", EvidenceReliability.PRIMARY, role=EvidenceRole.FAILURE)
    secondary_ev = _evidence(
        "sec-1", EvidenceReliability.SECONDARY, kind="recognition_activity_signal"
    )

    ordered = order_evidence_for_reasoning([context_ev, secondary_ev, primary_ev])

    assert [e.id for e in ordered] == ["pri-1", "sec-1", "ctx-1"]


def test_render_instruction_includes_question_rules_and_counts() -> None:
    evidence = [
        _evidence("p", EvidenceReliability.PRIMARY),
        _evidence("c", EvidenceReliability.CONTEXT, kind="session_summary"),
    ]
    instruction = render_instruction("Why did the task fail?", evidence)

    assert "Why did the task fail?" in instruction
    assert "primary=1" in instruction
    assert "context=1" in instruction
    assert "evidence ID" in instruction


def test_render_evidence_block_includes_ids_and_content() -> None:
    evidence = [
        _evidence(
            "ev-1",
            EvidenceReliability.PRIMARY,
            kind="runtime_failure",
            role=EvidenceRole.FAILURE,
            content="boom",
        )
    ]
    block = render_evidence_block(evidence)

    assert "[ev-1]" in block
    assert "primary/failure/runtime_failure" in block
    assert "boom" in block
    assert "line 42" in block


def test_render_evidence_block_empty() -> None:
    assert render_evidence_block([]) == "(no evidence available)"


def test_build_reasoning_context_orders_evidence() -> None:
    evidence = [
        _evidence("ctx", EvidenceReliability.CONTEXT, kind="session_summary"),
        _evidence("pri", EvidenceReliability.PRIMARY),
    ]
    context = build_reasoning_context("diagnose", evidence)

    assert context.stage == "diagnose"
    assert [e.id for e in context.evidence] == ["pri", "ctx"]
    request = context.to_request()
    assert request.evidence_ids == ["pri", "ctx"]


def test_incident_correlation_context_focuses_candidate_evidence() -> None:
    context = build_incident_correlation_context(
        "Question: CombatTask did not finish.",
        [
            _evidence("candidate-evidence", EvidenceReliability.PRIMARY),
            _evidence("unrelated", EvidenceReliability.PRIMARY),
        ],
        _incident_selection(),
    )

    assert context.stage == "correlate_incident"
    assert [item.id for item in context.evidence] == ["candidate-evidence"]
    assert "runtime failure alone does not prove" in context.instruction
    assert context.incident_selection == _incident_selection()


def test_diagnosis_context_includes_validated_incident_correlation() -> None:
    correlation = IncidentCorrelationDraft(
        status=IncidentSelectionStatus.SELECTED,
        selected_candidate_id="incident-1",
        relevant_candidate_ids=["incident-1"],
        evidence_ids=["candidate-evidence"],
        rationale="The reported task and candidate match.",
    )

    context = build_reasoning_context(
        "Diagnose",
        [_evidence("candidate-evidence", EvidenceReliability.PRIMARY)],
        _incident_selection(),
        correlation,
    )

    assert "Model incident correlation: selected" in context.instruction
    assert "interpretation" in context.instruction


def test_diagnosis_context_includes_deterministic_actual_expected_comparison() -> None:
    comparison = IncidentComparison(
        status=IncidentComparisonStatus.COMPLETE,
        candidate_ids=["incident-1"],
        expected_tasks=[
            IncidentExpectedTask(
                source_id="project",
                task_name="LoginButton",
                found_variants=1,
                recognition_types=["OCR"],
                next_targets=["Home"],
                evidence_ids=["mse-task"],
            )
        ],
        findings=[
            IncidentComparisonFinding(
                kind=(IncidentComparisonFindingKind.NEXT_LIST_TIMEOUT_AT_RESOLVED_NODE),
                statement="A timeout was observed at a resolved node.",
                observed_evidence_ids=["candidate-evidence"],
                expected_evidence_ids=["mse-task"],
            )
        ],
    )

    context = build_reasoning_context(
        "Diagnose",
        [
            _evidence("candidate-evidence", EvidenceReliability.PRIMARY),
            _evidence("mse-task", EvidenceReliability.SECONDARY),
        ],
        _incident_selection(),
        None,
        comparison,
    )

    assert context.incident_comparison == comparison
    assert "Deterministic actual/expected comparison: complete" in context.instruction
    assert "not root-cause conclusions" in context.instruction
    assert "recognition=OCR" in context.instruction


def test_source_research_context_focuses_comparison_and_guidance() -> None:
    comparison = IncidentComparison(
        status=IncidentComparisonStatus.COMPLETE,
        findings=[
            IncidentComparisonFinding(
                kind=IncidentComparisonFindingKind.ACTUAL_AND_EXPECTED_AVAILABLE,
                statement="Actual and expected facts are available.",
                observed_evidence_ids=["runtime"],
                expected_evidence_ids=["pipeline"],
            )
        ],
    )
    context = build_source_research_context(
        "Diagnose",
        [
            _evidence("runtime", EvidenceReliability.PRIMARY),
            _evidence("pipeline", EvidenceReliability.SECONDARY),
            _evidence(
                "guidance",
                EvidenceReliability.CONTEXT,
                kind="source_guidance",
            ),
            _evidence("unrelated", EvidenceReliability.PRIMARY),
        ],
        comparison,
        ["project"],
    )

    assert context.stage == "plan_source_research"
    assert [item.id for item in context.evidence] == [
        "runtime",
        "pipeline",
        "guidance",
    ]
    assert "Available source IDs: project" in context.instruction
    assert "not a diagnosis" in context.instruction


def test_stub_backend_skips_semantic_source_research() -> None:
    session = StubReasoningSession(run_id="run-source-research")
    context = build_source_research_context(
        "Diagnose",
        [],
        IncidentComparison(status=IncidentComparisonStatus.PARTIAL),
        ["project"],
    )

    result = asyncio.run(session.reason(context, SourceResearchPlan))

    assert result.status is SourceResearchStatus.SKIP
    assert result.queries == []


def test_knowledge_research_context_focuses_diagnostic_evidence() -> None:
    context = build_knowledge_research_context(
        "How does OCR replace work?",
        [
            _evidence("runtime", EvidenceReliability.PRIMARY),
            _evidence(
                "pipeline",
                EvidenceReliability.SECONDARY,
                kind="mse_task_resolution",
            ),
            _evidence("unrelated", EvidenceReliability.CONTEXT),
        ],
        IncidentComparison(status=IncidentComparisonStatus.PARTIAL),
        [
            ("maafw-docs", SourceRole.DOCUMENTATION),
            ("wiki", SourceRole.WIKI),
        ],
    )

    assert context.stage == "plan_knowledge_research"
    assert [item.id for item in context.evidence] == ["pipeline"]
    assert "maafw-docs (documentation)" in context.instruction
    assert "wiki results are navigation only" in context.instruction


def test_stub_backend_skips_semantic_knowledge_research() -> None:
    session = StubReasoningSession(run_id="run-knowledge-research")
    context = build_knowledge_research_context(
        "Diagnose",
        [],
        IncidentComparison(status=IncidentComparisonStatus.UNAVAILABLE),
        [("docs", SourceRole.DOCUMENTATION)],
    )

    result = asyncio.run(session.reason(context, KnowledgeResearchPlan))

    assert result.status is SourceResearchStatus.SKIP
    assert result.queries == []


def test_stub_backend_produces_complete_draft_with_direct_failure() -> None:
    backend = StubReasoningBackend()
    session = asyncio.run(backend.start(run_id="run-1"))
    context = build_reasoning_context(
        "diagnose",
        [
            _evidence(
                "p1",
                EvidenceReliability.PRIMARY,
                role=EvidenceRole.FAILURE,
            ),
            _evidence("c1", EvidenceReliability.CONTEXT),
        ],
    )

    result = asyncio.run(session.reason(context, DiagnosisDraft))

    assert result.status is DiagnosisStatus.COMPLETE
    assert len(result.conclusions) == 1
    assert result.conclusions[0].evidence_ids == ["p1"]
    asyncio.run(session.close())
    assert session.closed


def test_stub_backend_preserves_known_legacy_runtime_failure() -> None:
    legacy = Evidence.model_validate(
        {
            "id": "legacy-failure",
            "kind": "runtime_failure",
            "source_component": "mla:runtime-inspection",
            "source_path": "maafw.log",
            "content": "Tasker.Task.Failed",
            "reliability": "primary",
        }
    )
    context = build_reasoning_context("diagnose", [legacy])

    result = asyncio.run(StubReasoningSession(run_id="run-legacy").reason(context, DiagnosisDraft))

    assert legacy.role is EvidenceRole.FAILURE
    assert result.status is DiagnosisStatus.COMPLETE
    assert result.conclusions[0].evidence_ids == [legacy.id]


@pytest.mark.parametrize(
    ("kind", "role"),
    [
        ("runtime_version", EvidenceRole.CONTEXT),
        ("mse_static_diagnostic", EvidenceRole.SIGNAL),
        ("log_occurrence:warning", EvidenceRole.SIGNAL),
    ],
)
def test_stub_backend_does_not_treat_primary_non_failures_as_runtime_failures(
    kind: str,
    role: EvidenceRole,
) -> None:
    session = StubReasoningSession(run_id="run-non-failure")
    context = build_reasoning_context(
        "diagnose",
        [_evidence("observed", EvidenceReliability.PRIMARY, kind=kind, role=role)],
    )

    result = asyncio.run(session.reason(context, DiagnosisDraft))

    assert result.status is DiagnosisStatus.INSUFFICIENT_EVIDENCE
    assert result.conclusions == []


def test_stub_backend_returns_insufficient_without_primary() -> None:
    session = StubReasoningSession(run_id="run-2")
    context = build_reasoning_context(
        "diagnose",
        [_evidence("c1", EvidenceReliability.CONTEXT, kind="session_summary")],
    )

    result = asyncio.run(session.reason(context, DiagnosisDraft))

    assert result.status is DiagnosisStatus.INSUFFICIENT_EVIDENCE
    assert result.conclusions == []


def test_stub_backend_preserves_incident_candidates_as_ambiguous() -> None:
    session = StubReasoningSession(run_id="run-correlation")
    context = build_incident_correlation_context(
        "Question: diagnose",
        [_evidence("candidate-evidence", EvidenceReliability.PRIMARY)],
        _incident_selection(),
    )

    result = asyncio.run(session.reason(context, IncidentCorrelationDraft))

    assert result.status is IncidentSelectionStatus.AMBIGUOUS
    assert result.relevant_candidate_ids == ["incident-1"]
    assert result.evidence_ids == ["candidate-evidence"]


def test_stub_session_rejects_unsupported_result_type() -> None:
    session = StubReasoningSession(run_id="run-3")
    context = build_reasoning_context("diagnose", [])

    class Other(ContractModel):
        pass

    with pytest.raises(TypeError):
        asyncio.run(session.reason(context, Other))


def test_stub_session_cannot_reason_after_close() -> None:
    session = StubReasoningSession(run_id="run-4")
    asyncio.run(session.close())

    with pytest.raises(RuntimeError):
        asyncio.run(session.reason(build_reasoning_context("diagnose", []), DiagnosisDraft))


def test_stub_backend_tracks_sessions() -> None:
    backend = StubReasoningBackend()

    asyncio.run(backend.start(run_id="run-a"))
    asyncio.run(backend.start(run_id="run-b"))

    assert len(backend.sessions) == 2
    assert backend.sessions[0].run_id == "run-a"
    assert backend.sessions[1].run_id == "run-b"
    assert backend.last_session is backend.sessions[1]
