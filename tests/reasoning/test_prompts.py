from __future__ import annotations

import asyncio
from pathlib import Path

import pytest

from maa_diagnostic_expert.contracts.domain import (
    AnalysisRequest,
    ArtifactInput,
    ArtifactKind,
    Conclusion,
    ContractModel,
    DiagnosisDraft,
    DiagnosisStatus,
    Evidence,
    EvidenceReliability,
    EvidenceRole,
    MissingEvidence,
    SourceRole,
)
from maa_diagnostic_expert.contracts.workflow import (
    FixCandidate,
    FixCandidatePlan,
    FixMethod,
    FixPlanningStatus,
    FixScope,
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
    VerificationPlanningStatus,
    VerificationPlanSet,
)
from maa_diagnostic_expert.discovery.preparation import prepare_analysis
from maa_diagnostic_expert.reasoning.evidence_budget import (
    MODEL_EVIDENCE_MAX_CHARACTERS,
    MODEL_EVIDENCE_MAX_ITEM_CHARACTERS,
    MODEL_EVIDENCE_MAX_ITEMS,
)
from maa_diagnostic_expert.reasoning.prompts import (
    StubReasoningBackend,
    StubReasoningSession,
    build_evidence_research_context,
    build_fix_candidate_context,
    build_incident_correlation_context,
    build_knowledge_research_context,
    build_reasoning_context,
    build_reported_context,
    build_source_research_context,
    build_verification_plan_context,
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


@pytest.mark.parametrize(
    ("issue", "question", "expected"),
    [
        ("LoginTask stopped.", None, "Reported issue:\nLoginTask stopped."),
        (None, "Why did it stop?", "Diagnostic question:\nWhy did it stop?"),
        (
            "LoginTask stopped.",
            "Why did it stop?",
            "Reported issue:\nLoginTask stopped.\n\nDiagnostic question:\nWhy did it stop?",
        ),
    ],
)
def test_build_reported_context_preserves_issue_and_question(
    issue: str | None,
    question: str | None,
    expected: str,
) -> None:
    assert build_reported_context(issue, question) == expected


def test_all_reasoning_stages_receive_the_same_reported_context() -> None:
    reported_context = build_reported_context(
        "LoginTask stopped after a timeout.",
        "What directly failed?",
    )
    candidate = _evidence(
        "candidate-evidence",
        EvidenceReliability.PRIMARY,
        kind="runtime_failure",
        role=EvidenceRole.FAILURE,
    )
    comparison = IncidentComparison(status=IncidentComparisonStatus.UNAVAILABLE)
    contexts = [
        build_incident_correlation_context(
            reported_context,
            [candidate],
            _incident_selection(),
        ),
        build_source_research_context(
            reported_context,
            [candidate],
            comparison,
            ["project"],
        ),
        build_knowledge_research_context(
            reported_context,
            [candidate],
            comparison,
            [("docs", SourceRole.DOCUMENTATION)],
        ),
        build_fix_candidate_context(
            reported_context,
            [candidate],
            DiagnosisDraft(
                status=DiagnosisStatus.COMPLETE,
                summary="The login task timed out.",
                conclusions=[
                    Conclusion(
                        statement="The login task timed out.",
                        evidence_ids=[candidate.id],
                        confidence=0.9,
                    )
                ],
            ),
            comparison,
        ),
        build_reasoning_context(reported_context, [candidate]),
    ]

    for context in contexts:
        assert f"Reported diagnostic context:\n{reported_context}" in context.instruction
        assert context.instruction.count("LoginTask stopped after a timeout.") == 1
        assert context.instruction.count("What directly failed?") == 1


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


def test_evidence_research_context_lists_only_queryable_text_artifacts(tmp_path: Path) -> None:
    log = tmp_path / "debug.log"
    image = tmp_path / "failure.png"
    log.write_text("first\nsecond\n", encoding="utf-8")
    image.write_bytes(b"image")
    prepared = prepare_analysis(
        AnalysisRequest(
            question="Inspect the failure.",
            artifacts=[
                ArtifactInput(path=log, kind=ArtifactKind.FILE),
                ArtifactInput(path=image, kind=ArtifactKind.FILE),
            ],
        )
    )

    context = build_evidence_research_context(
        "Inspect the failure.",
        [],
        prepared,
        round_number=1,
        max_rounds=2,
    )

    assert context.stage == "plan_evidence_research"
    assert str(log.resolve()) in context.instruction
    assert str(image.resolve()) not in context.instruction
    assert "Adaptive evidence round: 1 of 2" in context.instruction
    assert "at most three windows" in context.instruction


def test_reasoning_context_bounds_model_evidence_count_and_reports_omissions() -> None:
    evidence = [
        _evidence(
            f"failure-{index:03d}",
            EvidenceReliability.PRIMARY,
            role=EvidenceRole.FAILURE,
        )
        for index in range(MODEL_EVIDENCE_MAX_ITEMS + 5)
    ]

    context = build_reasoning_context("Diagnose", evidence)

    assert len(context.evidence) == MODEL_EVIDENCE_MAX_ITEMS
    assert context.available_evidence_count == MODEL_EVIDENCE_MAX_ITEMS + 5
    assert context.omitted_evidence_count == 5
    assert context.truncated_evidence_count == 0
    assert "received 40 of 45 records; omitted=5" in context.instruction
    assert "Do not infer that omitted content is absent" in context.instruction


def test_reasoning_context_bounds_single_item_and_total_rendered_characters() -> None:
    evidence = [
        _evidence(
            f"failure-{index:03d}",
            EvidenceReliability.PRIMARY,
            role=EvidenceRole.FAILURE,
            content="x" * (MODEL_EVIDENCE_MAX_ITEM_CHARACTERS * 2),
        )
        for index in range(MODEL_EVIDENCE_MAX_ITEMS)
    ]

    context = build_reasoning_context("Diagnose", evidence)
    rendered = render_evidence_block(context.evidence)

    assert len(rendered) <= MODEL_EVIDENCE_MAX_CHARACTERS
    assert all(
        len(render_evidence_block([item])) <= MODEL_EVIDENCE_MAX_ITEM_CHARACTERS
        for item in context.evidence
    )
    assert context.truncated_evidence_count == len(context.evidence)
    assert context.omitted_evidence_count > 0
    assert "evidence content truncated for model context" in rendered


def test_reasoning_context_does_not_mutate_authoritative_evidence() -> None:
    original = _evidence(
        "large-failure",
        EvidenceReliability.PRIMARY,
        role=EvidenceRole.FAILURE,
        content="original" * MODEL_EVIDENCE_MAX_ITEM_CHARACTERS,
    )

    context = build_reasoning_context("Diagnose", [original])

    assert context.evidence[0] is not original
    assert context.evidence[0].id == original.id
    assert len(context.evidence[0].content) < len(original.content)
    assert original.content == "original" * MODEL_EVIDENCE_MAX_ITEM_CHARACTERS
    assert context.to_request().evidence_ids == [original.id]


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


def test_missing_evidence_prompt_sections_use_codes_and_messages() -> None:
    selection = IncidentSelection(
        status=IncidentSelectionStatus.NOT_FOUND,
        missing_evidence=[
            MissingEvidence(
                code="incident_candidates_not_found",
                message="No failed runtime incident candidate was found.",
            )
        ],
    )
    comparison = IncidentComparison(
        status=IncidentComparisonStatus.UNAVAILABLE,
        missing_evidence=[
            MissingEvidence(
                code="expected_configuration_unavailable",
                message="No focused expected configuration is available.",
            ),
            MissingEvidence(
                code="incident_candidates_not_found",
                message="A second stage recorded more detail for the same code.",
            ),
        ],
    )

    context = build_reasoning_context(
        "Diagnose",
        [],
        selection,
        None,
        comparison,
        prepared_missing_evidence=[
            MissingEvidence(
                code="artifact_missing",
                message="The requested artifact was not found.",
            )
        ],
    )

    assert "Prepared missing evidence: artifact_missing: The requested artifact was not found." in (
        context.instruction
    )
    assert (
        "Selection missing evidence: incident_candidates_not_found: "
        "No failed runtime incident candidate was found."
    ) in context.instruction
    assert (
        "Comparison missing evidence: expected_configuration_unavailable: "
        "No focused expected configuration is available.; "
        "incident_candidates_not_found: A second stage recorded more detail for the same code."
    ) in context.instruction
    assert context.instruction.count("incident_candidates_not_found") == 2


def test_reasoning_context_defaults_missing_evidence_to_empty() -> None:
    context = build_reasoning_context("Diagnose", [])

    assert "missing evidence:" not in context.instruction


def test_diagnosis_context_renders_comparison_missing_evidence_messages() -> None:
    comparison = IncidentComparison(
        status=IncidentComparisonStatus.PARTIAL,
        missing_evidence=[
            MissingEvidence(
                code="expected_configuration_unavailable",
                message="No focused expected configuration is available.",
            )
        ],
    )

    context = build_reasoning_context(
        "Diagnose",
        [],
        _incident_selection(),
        None,
        comparison,
    )

    assert (
        "Comparison missing evidence: expected_configuration_unavailable: "
        "No focused expected configuration is available."
    ) in (context.instruction)


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
    assert "Available project/GUI/framework source IDs: project" in context.instruction
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


def test_fix_candidate_context_separates_proposal_from_execution() -> None:
    failure = _evidence(
        "failure",
        EvidenceReliability.PRIMARY,
        role=EvidenceRole.FAILURE,
    )
    diagnosis = DiagnosisDraft(
        status=DiagnosisStatus.COMPLETE,
        summary="OCR missed the expected label.",
        conclusions=[
            Conclusion(
                statement="OCR returned an unnormalized variant.",
                evidence_ids=[failure.id],
                confidence=0.9,
            )
        ],
    )

    context = build_fix_candidate_context(
        "Why was the label missed?",
        [failure],
        diagnosis,
        IncidentComparison(status=IncidentComparisonStatus.PARTIAL),
    )

    assert context.stage == "propose_fix"
    assert "do not claim that any change was applied" in context.instruction
    assert "ROI/only_rec" in context.instruction
    assert "evidence=failure" in context.instruction


def test_stub_backend_skips_semantic_fix_planning() -> None:
    session = StubReasoningSession(run_id="run-fix-planning")
    context = build_fix_candidate_context(
        "Diagnose",
        [],
        DiagnosisDraft(
            status=DiagnosisStatus.INSUFFICIENT_EVIDENCE,
            summary="No direct failure was observed.",
        ),
        IncidentComparison(status=IncidentComparisonStatus.UNAVAILABLE),
    )

    result = asyncio.run(session.reason(context, FixCandidatePlan))

    assert result.status is FixPlanningStatus.SKIP
    assert result.candidates == []


def test_verification_plan_context_requires_business_and_regression_checks() -> None:
    fixes = FixCandidatePlan(
        status=FixPlanningStatus.PROPOSED,
        rationale="A focused configuration change is supported.",
        candidates=[
            FixCandidate(
                fix_id="fix-ocr",
                target="pipeline.json:LoginButton.expected",
                scope=FixScope.NODE,
                method=FixMethod.EXPECTED_REPLACE,
                rationale="Normalize the observed OCR variant.",
                evidence_ids=["failure"],
                regression_risks=["Unrelated text might be accepted."],
                verification_steps=["Replay the captured failure."],
            )
        ],
    )

    context = build_verification_plan_context("Why did OCR fail?", [], fixes)

    assert context.stage == "plan_verification"
    assert "exactly one plan for every listed fix ID" in context.instruction
    assert "success event alone is not a business milestone" in context.instruction
    assert "Unrelated text might be accepted" in context.instruction
    assert "do not execute a repair" in context.instruction


def test_stub_backend_skips_verification_without_fix_candidates() -> None:
    session = StubReasoningSession(run_id="run-verification-planning")
    context = build_verification_plan_context(
        "Diagnose",
        [],
        FixCandidatePlan(
            status=FixPlanningStatus.SKIP,
            rationale="No fix candidates exist.",
        ),
    )

    result = asyncio.run(session.reason(context, VerificationPlanSet))

    assert result.status is VerificationPlanningStatus.SKIP
    assert result.plans == []


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
