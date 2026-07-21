from __future__ import annotations

from pathlib import Path

from maa_diagnostic_expert.contracts.domain import AnalysisRequest, PreparedAnalysis
from maa_diagnostic_expert.contracts.mla import MlaRuntimeInspectionResult
from maa_diagnostic_expert.contracts.workflow import (
    ArtifactSourceKind,
    IncidentSelectionStatus,
)
from maa_diagnostic_expert.inspection.evidence_synthesis import synthesize_evidence
from maa_diagnostic_expert.inspection.incident_candidates import (
    MAX_INCIDENT_CANDIDATES,
    generate_incident_selection,
)
from maa_diagnostic_expert.inspection.log_overview import (
    LogArtifactOverview,
    LogOccurrence,
    LogOverviewCollection,
    LogOverviewStatus,
    LogSeverity,
    synthesize_log_overview_evidence,
)
from maa_diagnostic_expert.inspection.models import (
    DeterministicInspection,
    MlaRuntimeInspectionArtifact,
)
from maa_diagnostic_expert.reasoning.prompts import build_reasoning_context


def _position(line: int) -> dict[str, object]:
    return {
        "timestamp": "2026-07-19 10:00:00.000",
        "source": "file:C:/logs/maafw.log",
        "path": "C:/logs/maafw.log",
        "local_line": line,
    }


def _task(status: str) -> dict[str, object]:
    failed = status == "failed"
    return {
        "execution_id": f"exec-{status}",
        "task_id": 7,
        "name": "CombatTask",
        "hash": "hash",
        "uuid": "uuid",
        "status": status,
        "completeness": "complete",
        "started_at": "2026-07-19 10:00:00.000",
        "ended_at": "2026-07-19 10:00:05.000",
        "observed_duration_ms": 5000,
        "first_node": "Start",
        "last_node": "End",
        "statistics": {
            "node_executions": 2,
            "succeeded_nodes": 1 if failed else 2,
            "failed_nodes": 1 if failed else 0,
            "running_nodes": 0,
            "recognition_attempts": 0,
            "unsuccessful_recognition_attempts": 0,
            "node_executions_with_recognition": 0,
            "node_executions_with_mixed_recognition_results": 0,
            "recognition_activity_groups": 0,
            "maximum_recognition_attempts_per_node": 0,
            "maximum_unsuccessful_recognition_attempts_per_node": 0,
            "action_attempts": 0,
            "action_failures": 0,
            "next_list_timeouts": 0,
            "error_image_references": 0,
            "unique_error_images": 0,
            "vision_image_references": 0,
            "unique_vision_images": 0,
        },
        "direct_failure_ids": [],
        "outcome_ids": [],
        "signal_ids": [],
        "signal_highlights": {"recognition_activity": [], "repetitions": []},
        "evidence": {"start": _position(10), "end": _position(20)},
    }


def _runtime_payload(*, tasks: list[dict[str, object]]) -> dict[str, object]:
    failed_tasks = sum(task["status"] == "failed" for task in tasks)
    return {
        "schema_version": "mla-runtime-inspection/v1",
        "sessions": [
            {
                "session_id": "session-1",
                "start_kind": "process_start",
                "framework_status": "resolved",
                "framework_version": "v5.11.1",
                "versions": ["v5.11.1"],
                "start": {
                    "source": "file:C:/logs/maafw.log",
                    "path": "C:/logs/maafw.log",
                    "line": 1,
                    "timestamp": "2026-07-19 10:00:00.000",
                },
                "end": {
                    "source": "file:C:/logs/maafw.log",
                    "path": "C:/logs/maafw.log",
                    "line": 30,
                    "timestamp": "2026-07-19 10:00:06.000",
                },
                "tasks": tasks,
                "summary": {
                    "task_executions": len(tasks),
                    "succeeded_tasks": len(tasks) - failed_tasks,
                    "failed_tasks": failed_tasks,
                    "running_tasks": 0,
                    "direct_failures": 0,
                    "next_list_timeouts": 0,
                    "action_failures": 0,
                    "signals": 0,
                },
            }
        ],
        "unscoped_tasks": [],
        "failures": [],
        "outcomes": [],
        "signals": [],
        "warnings": [],
    }


def _inspection(payload: dict[str, object]) -> DeterministicInspection:
    artifact = MlaRuntimeInspectionArtifact(
        artifact_id="artifact-1",
        path=Path("C:/logs/maafw.log"),
        inspection=MlaRuntimeInspectionResult.model_validate(payload),
    )
    inspection = DeterministicInspection(
        prepared=PreparedAnalysis(request=AnalysisRequest(question="Diagnose")),
        mla_runtime_inspections=[artifact],
    )
    return inspection.model_copy(update={"synthesized_evidence": synthesize_evidence([artifact])})


def test_failed_mla_task_becomes_unselected_candidate() -> None:
    selection = generate_incident_selection(_inspection(_runtime_payload(tasks=[_task("failed")])))

    assert selection.status is IncidentSelectionStatus.AMBIGUOUS
    assert selection.selected_candidate_id is None
    [candidate] = selection.candidates
    assert candidate.session_id == "session-1"
    assert candidate.task_name == "CombatTask"
    assert candidate.confidence == 0.95
    assert candidate.evidence_ids == ["mla-ri:artifact-1:task:exec-failed"]


def test_successful_mla_task_without_signals_is_not_an_incident_candidate() -> None:
    selection = generate_incident_selection(
        _inspection(_runtime_payload(tasks=[_task("succeeded")]))
    )

    assert selection.status is IncidentSelectionStatus.NOT_FOUND
    assert selection.candidates == []


def test_direct_failure_is_candidate_even_without_task_summary() -> None:
    payload = _runtime_payload(tasks=[])
    payload["failures"] = [
        {
            "session_id": "session-1",
            "execution_id": "exec-missing",
            "task_id": 8,
            "task_name": "MissingTask",
            "failure_id": "failure-1",
            "kind": "next_list_timeout",
            "node_id": 12,
            "node_name": "Recognize",
            "started_at": "2026-07-19 10:00:01.000",
            "ended_at": "2026-07-19 10:00:02.000",
            "error_images": [],
            "vision_images": [],
            "evidence": _position(15),
        }
    ]

    selection = generate_incident_selection(_inspection(payload))

    [candidate] = selection.candidates
    assert candidate.task_name == "MissingTask"
    assert candidate.evidence_ids == ["mla-ri:artifact-1:failure:failure-1"]


def test_gui_log_occurrence_becomes_candidate_with_source_evidence() -> None:
    overview = LogArtifactOverview(
        artifact_id="gui-log",
        path=Path("C:/logs/gui.log"),
        source_kind=ArtifactSourceKind.GUI,
        status=LogOverviewStatus.COMPLETE,
        scanned_bytes=100,
        scanned_lines=3,
        notable_occurrences=[
            LogOccurrence(
                line_number=2,
                byte_offset=20,
                timestamp_text="2026-07-19 10:00:01.000",
                severity=LogSeverity.ERROR,
                excerpt="ERROR task failed",
            )
        ],
    )
    overviews = LogOverviewCollection(overviews=[overview])
    inspection = DeterministicInspection(
        prepared=PreparedAnalysis(request=AnalysisRequest(question="Diagnose")),
        log_overviews=overviews,
        synthesized_evidence=synthesize_log_overview_evidence(overviews),
    )

    selection = generate_incident_selection(inspection)

    [candidate] = selection.candidates
    assert candidate.confidence == 0.7
    assert candidate.started_at is not None
    assert candidate.evidence_ids[0].startswith("evidence:log-overview:")


def test_reasoning_prompt_marks_candidates_as_leads_not_proof() -> None:
    inspection = _inspection(_runtime_payload(tasks=[_task("failed")]))
    selection = generate_incident_selection(inspection)

    context = build_reasoning_context(
        "Diagnose",
        inspection.synthesized_evidence,
        selection,
    )

    assert "Deterministic incident selection: ambiguous" in context.instruction
    assert selection.candidates[0].candidate_id in context.instruction
    assert "leads, not proof" in context.instruction


def test_incident_candidates_are_bounded() -> None:
    overviews = LogOverviewCollection(
        overviews=[
            LogArtifactOverview(
                artifact_id=f"gui-{index}",
                path=Path(f"C:/logs/gui-{index}.log"),
                source_kind=ArtifactSourceKind.GUI,
                status=LogOverviewStatus.COMPLETE,
                scanned_bytes=100,
                scanned_lines=1,
                notable_occurrences=[
                    LogOccurrence(
                        line_number=1,
                        byte_offset=0,
                        severity=LogSeverity.ERROR,
                        excerpt=f"ERROR failure {index}",
                    )
                ],
            )
            for index in range(MAX_INCIDENT_CANDIDATES + 1)
        ]
    )
    inspection = DeterministicInspection(
        prepared=PreparedAnalysis(request=AnalysisRequest(question="Diagnose")),
        log_overviews=overviews,
        synthesized_evidence=synthesize_log_overview_evidence(overviews),
    )

    selection = generate_incident_selection(inspection)

    assert len(selection.candidates) == MAX_INCIDENT_CANDIDATES
    assert selection.missing_evidence == [
        "1 lower-priority incident candidate(s) were omitted by the bounded limit."
    ]
