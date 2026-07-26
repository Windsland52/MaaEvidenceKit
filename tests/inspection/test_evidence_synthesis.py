from pathlib import Path

from maa_diagnostic_expert.contracts.domain import EvidenceReliability, EvidenceRole
from maa_diagnostic_expert.contracts.mla import MlaRuntimeInspectionResult
from maa_diagnostic_expert.inspection.evidence_synthesis import synthesize_evidence
from maa_diagnostic_expert.inspection.models import MlaRuntimeInspectionArtifact


def _evidence_pos(line: int = 1) -> dict[str, object]:
    return {
        "timestamp": "2026-07-19 10:00:00.000",
        "source": "file:C:/logs/maafw.log",
        "path": "C:/logs/maafw.log",
        "local_line": line,
    }


def _metric_dist(count: int = 1) -> dict[str, object]:
    return {
        "count": count,
        "minimum": 1.0,
        "p50": 1.0,
        "p95": 1.0,
        "maximum": 1.0,
        "average": 1.0,
    }


def _occurrence_sample() -> dict[str, object]:
    return {
        "node_id": 0,
        "started_at": "2026-07-19 10:00:00.000",
        "ended_at": "2026-07-19 10:00:01.000",
        "attempt_count": 1,
        "unsuccessful_attempts": 0,
        "terminal_match": "NextA",
        "evidence": {"start": _evidence_pos(1), "end": _evidence_pos(2)},
    }


def _recognition_signal(priority: str = "high") -> dict[str, object]:
    return {
        "session_id": "ses-1",
        "execution_id": "exec-1",
        "task_id": 0,
        "task_name": "TaskA",
        "signal_id": "sig-1",
        "kind": "recognition_activity",
        "pipeline_node_name": "NodeA",
        "next_list": [{"name": "NextA", "anchor": False, "jump_back": False}],
        "occurrence_count": 100,
        "occurrences_with_mixed_results": 50,
        "terminal_outcomes": {
            "matched": 90,
            "timeout": 5,
            "running": 0,
            "unmatched": 5,
        },
        "terminal_matches": [{"name": "NextA", "count": 90}],
        "candidate_statistics": [],
        "unmapped_attempt_count": 0,
        "attempts": _metric_dist(100),
        "unsuccessful_attempts": _metric_dist(50),
        "duration_ms": _metric_dist(100),
        "representatives": {
            "first": _occurrence_sample(),
            "worst": _occurrence_sample(),
            "last": _occurrence_sample(),
        },
        "priority": priority,
        "priority_reasons": ["high_mixed_results"],
    }


def _repeated_node_signal(priority: str = "high") -> dict[str, object]:
    return {
        "session_id": "ses-1",
        "execution_id": "exec-1",
        "task_id": 0,
        "task_name": "TaskA",
        "signal_id": "sig-2",
        "kind": "repeated_node",
        "pattern": ["NodeA", "NodeB"],
        "segment_count": 10,
        "total_repeat_count": 20,
        "maximum_repeat_count": 5,
        "duration_ms": _metric_dist(20),
        "terminations": {
            "left_pattern": 5,
            "task_ended": 5,
            "still_repeating_at_log_end": 0,
        },
        "representatives": {
            "first": {
                "first_seen_at": "2026-07-19 10:00:00.000",
                "last_seen_at": "2026-07-19 10:00:01.000",
                "repeat_count": 5,
                "evidence": _evidence_pos(1),
            },
            "longest": {
                "first_seen_at": "2026-07-19 10:00:00.000",
                "last_seen_at": "2026-07-19 10:00:01.000",
                "repeat_count": 5,
                "evidence": _evidence_pos(10),
            },
            "last": {
                "first_seen_at": "2026-07-19 10:00:02.000",
                "last_seen_at": "2026-07-19 10:00:03.000",
                "repeat_count": 3,
                "evidence": _evidence_pos(20),
            },
        },
        "detector": {
            "name": "repeated-completed-node-sequence",
            "version": 1,
            "minimum_repeats": 2,
            "maximum_pattern_length": 8,
        },
        "priority": priority,
        "priority_reasons": ["high_repeat_count"],
    }


def _failure() -> dict[str, object]:
    return {
        "session_id": "ses-1",
        "execution_id": "exec-1",
        "task_id": 0,
        "task_name": "TaskA",
        "failure_id": "fail-1",
        "kind": "next_list_timeout",
        "node_id": 42,
        "node_name": "NodeA",
        "started_at": "2026-07-19 10:00:00.000",
        "ended_at": "2026-07-19 10:00:05.000",
        "error_images": [],
        "vision_images": [],
        "evidence": _evidence_pos(100),
    }


def _failed_outcome() -> dict[str, object]:
    return {
        "session_id": "ses-1",
        "execution_id": "exec-1",
        "task_id": 0,
        "task_name": "TaskA",
        "outcome_id": "out-1",
        "kind": "pipeline_node",
        "status": "failed",
        "node_id": 42,
        "node_name": "NodeA",
        "direct_failure_ids": ["fail-1"],
        "evidence": _evidence_pos(100),
    }


def _running_outcome() -> dict[str, object]:
    return {
        "session_id": "ses-1",
        "execution_id": "exec-1",
        "task_id": 0,
        "task_name": "TaskA",
        "outcome_id": "out-2",
        "kind": "pipeline_node",
        "status": "running",
        "node_id": 43,
        "node_name": "NodeB",
        "direct_failure_ids": [],
        "evidence": _evidence_pos(200),
    }


def _task_stats() -> dict[str, object]:
    return {
        "node_executions": 10,
        "succeeded_nodes": 8,
        "failed_nodes": 1,
        "running_nodes": 1,
        "recognition_attempts": 20,
        "unsuccessful_recognition_attempts": 5,
        "node_executions_with_recognition": 10,
        "node_executions_with_mixed_recognition_results": 3,
        "recognition_activity_groups": 2,
        "maximum_recognition_attempts_per_node": 5,
        "maximum_unsuccessful_recognition_attempts_per_node": 2,
        "action_attempts": 8,
        "action_failures": 0,
        "next_list_timeouts": 1,
        "error_image_references": 0,
        "unique_error_images": 0,
        "vision_image_references": 0,
        "unique_vision_images": 0,
    }


def _task_execution(
    status: str = "failed",
    direct_failure_ids: list[str] | None = None,
    outcome_ids: list[str] | None = None,
    signal_ids: list[str] | None = None,
) -> dict[str, object]:
    return {
        "execution_id": "exec-1",
        "task_id": 0,
        "name": "TaskA",
        "hash": "abc123",
        "uuid": "uuid-1",
        "status": status,
        "completeness": "complete",
        "started_at": "2026-07-19 10:00:00.000",
        "ended_at": "2026-07-19 10:00:10.000",
        "observed_duration_ms": 10000.0,
        "first_node": "NodeA",
        "last_node": "NodeB",
        "statistics": _task_stats(),
        "direct_failure_ids": direct_failure_ids or [],
        "outcome_ids": outcome_ids or [],
        "signal_ids": signal_ids or [],
        "signal_highlights": {"recognition_activity": [], "repetitions": []},
        "evidence": {"start": _evidence_pos(1), "end": _evidence_pos(200)},
    }


def _session(tasks: list[dict[str, object]] | None = None) -> dict[str, object]:
    return {
        "session_id": "ses-1",
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
            "line": 500,
            "timestamp": "2026-07-19 10:00:10.000",
        },
        "tasks": tasks or [],
        "summary": {
            "task_executions": 1,
            "succeeded_tasks": 0,
            "failed_tasks": 1,
            "running_tasks": 0,
            "direct_failures": 1,
            "next_list_timeouts": 1,
            "action_failures": 0,
            "signals": 2,
        },
    }


def _build_artifact(
    payload: dict[str, object],
    artifact_id: str = "art-1",
    path: str = "C:/logs/maafw.log",
) -> MlaRuntimeInspectionArtifact:
    return MlaRuntimeInspectionArtifact(
        artifact_id=artifact_id,
        path=Path(path),
        inspection=MlaRuntimeInspectionResult.model_validate(payload),
    )


def _inspection_payload(**fields: object) -> dict[str, object]:
    base: dict[str, object] = {
        "schema_version": "mla-runtime-inspection/v1",
        "sessions": [],
        "unscoped_tasks": [],
        "failures": [],
        "outcomes": [],
        "signals": [],
        "warnings": [],
    }
    base.update(fields)
    return base


def test_empty_inspections_produce_no_evidence() -> None:
    assert synthesize_evidence([]) == []


def test_failures_produce_primary_evidence() -> None:
    artifact = _build_artifact(_inspection_payload(failures=[_failure()]))
    evidence = synthesize_evidence([artifact])
    assert len(evidence) == 1
    ev = evidence[0]
    assert ev.kind == "runtime_failure"
    assert ev.role is EvidenceRole.FAILURE
    assert ev.reliability is EvidenceReliability.PRIMARY
    assert ev.task_id == 0
    assert ev.line_start == 100
    assert "next_list_timeout" in ev.content
    assert "NodeA" in ev.content


def test_evidence_prefers_the_traceable_source_locator() -> None:
    failure = _failure()
    position = failure["evidence"]
    assert isinstance(position, dict)
    position["path"] = "maafw.log"
    position["source"] = "file:C:/logs/debug/maafw.log"
    artifact = _build_artifact(_inspection_payload(failures=[failure]))

    evidence = synthesize_evidence([artifact])

    assert evidence[0].source_path == "C:/logs/debug/maafw.log"


def test_zip_evidence_retains_its_archive_member_locator() -> None:
    failure = _failure()
    position = failure["evidence"]
    assert isinstance(position, dict)
    position["path"] = "debug/maafw.log"
    position["source"] = "zip:C:/logs/debug.zip#debug/maafw.log"
    artifact = _build_artifact(
        _inspection_payload(failures=[failure]),
        path="C:/logs/debug.zip",
    )

    evidence = synthesize_evidence([artifact])

    assert evidence[0].source_path == "zip:C:/logs/debug.zip#debug/maafw.log"


def test_failed_outcomes_produce_primary_evidence() -> None:
    artifact = _build_artifact(
        _inspection_payload(outcomes=[_failed_outcome(), _running_outcome()])
    )
    evidence = synthesize_evidence([artifact])
    assert len(evidence) == 1
    ev = evidence[0]
    assert ev.kind == "runtime_outcome"
    assert ev.role is EvidenceRole.FAILURE
    assert ev.reliability is EvidenceReliability.PRIMARY
    assert "FAILED" in ev.content
    assert "fail-1" in ev.content


def test_running_outcomes_skipped() -> None:
    artifact = _build_artifact(_inspection_payload(outcomes=[_running_outcome()]))
    evidence = synthesize_evidence([artifact])
    assert len(evidence) == 0


def test_high_priority_recognition_signal_produces_secondary_evidence() -> None:
    artifact = _build_artifact(_inspection_payload(signals=[_recognition_signal(priority="high")]))
    evidence = synthesize_evidence([artifact])
    assert len(evidence) == 1
    ev = evidence[0]
    assert ev.kind == "recognition_activity_signal"
    assert ev.role is EvidenceRole.SIGNAL
    assert ev.reliability is EvidenceReliability.SECONDARY
    assert "NodeA" in ev.content
    assert "50.0%" in ev.content


def test_normal_priority_recognition_signal_skipped() -> None:
    artifact = _build_artifact(
        _inspection_payload(signals=[_recognition_signal(priority="normal")])
    )
    evidence = synthesize_evidence([artifact])
    assert len(evidence) == 0


def test_high_priority_repeated_node_signal_produces_secondary_evidence() -> None:
    artifact = _build_artifact(
        _inspection_payload(signals=[_repeated_node_signal(priority="high")])
    )
    evidence = synthesize_evidence([artifact])
    assert len(evidence) == 1
    ev = evidence[0]
    assert ev.kind == "repeated_node_signal"
    assert ev.role is EvidenceRole.SIGNAL
    assert ev.reliability is EvidenceReliability.SECONDARY
    assert "NodeA -> NodeB" in ev.content


def test_notable_task_produces_context_evidence() -> None:
    artifact = _build_artifact(
        _inspection_payload(
            sessions=[
                _session(tasks=[_task_execution(status="failed", direct_failure_ids=["fail-1"])])
            ]
        )
    )
    evidence = synthesize_evidence([artifact])
    kinds = [ev.kind for ev in evidence]
    assert "task_execution_summary" in kinds
    assert "session_summary" in kinds
    task_ev = next(ev for ev in evidence if ev.kind == "task_execution_summary")
    assert task_ev.reliability is EvidenceReliability.CONTEXT
    assert task_ev.task_id == 0


def test_non_notable_task_skipped() -> None:
    artifact = _build_artifact(
        _inspection_payload(sessions=[_session(tasks=[_task_execution(status="succeeded")])])
    )
    evidence = synthesize_evidence([artifact])
    kinds = [ev.kind for ev in evidence]
    assert "session_summary" in kinds
    assert "task_execution_summary" not in kinds


def test_session_always_produces_context_evidence() -> None:
    artifact = _build_artifact(_inspection_payload(sessions=[_session(tasks=[])]))
    evidence = synthesize_evidence([artifact])
    assert len(evidence) == 1
    ev = evidence[0]
    assert ev.kind == "session_summary"
    assert ev.reliability is EvidenceReliability.CONTEXT
    assert ev.line_start == 1
    assert ev.line_end == 500


def test_evidence_ids_are_unique() -> None:
    artifact = _build_artifact(
        _inspection_payload(
            sessions=[
                _session(tasks=[_task_execution(status="failed", direct_failure_ids=["fail-1"])])
            ],
            failures=[_failure()],
            outcomes=[_failed_outcome()],
            signals=[
                _recognition_signal(priority="high"),
                _repeated_node_signal(priority="high"),
            ],
        )
    )
    evidence = synthesize_evidence([artifact])
    ids = [ev.id for ev in evidence]
    assert len(ids) == len(set(ids))


def test_multiple_artifacts_produce_separate_evidence() -> None:
    artifact_a = _build_artifact(
        _inspection_payload(failures=[_failure()]),
        artifact_id="art-a",
    )
    artifact_b = _build_artifact(
        _inspection_payload(failures=[_failure()]),
        artifact_id="art-b",
    )
    evidence = synthesize_evidence([artifact_a, artifact_b])
    assert len(evidence) == 2
    assert evidence[0].id != evidence[1].id
    assert "art-a" in evidence[0].id
    assert "art-b" in evidence[1].id
