import pytest
from pydantic import ValidationError

from maa_diagnostic_expert.mla_contracts import (
    MlaFrameworkStatus,
    MlaPreflightResult,
    MlaRecognitionActivitySignal,
    MlaRepeatedNodeSequenceSignal,
    MlaRuntimeInspectionResult,
    MlaSessionStatus,
)


def _preflight_payload() -> dict[str, object]:
    return {
        "schema_version": "mde-mla-preflight/v1",
        "mla_schema_version": "mla-preflight/v1",
        "compatibility": {
            "status": "supported",
            "reason": "notify_events_parsed",
            "parser_version": "maa-log-parser/1.0.1",
            "task_count": 1,
            "event_count": 3,
            "node_statistic_count": 1,
            "recognition_statistic_count": 0,
        },
        "framework": {
            "status": "single",
            "versions": ["v5.11.1"],
            "sessions": [
                {
                    "session_id": "framework-session-1",
                    "start_kind": "process_start",
                    "status": "resolved",
                    "version": "v5.11.1",
                    "versions": ["v5.11.1"],
                    "start": {
                        "source": "file:C:/logs/maafw.log",
                        "path": "C:/logs/maafw.log",
                        "line": 2,
                        "timestamp": "2026-07-19 10:00:00.001",
                    },
                    "end": {
                        "source": "file:C:/logs/maafw.log",
                        "path": "C:/logs/maafw.log",
                        "line": 20,
                        "timestamp": "2026-07-19 10:00:02.000",
                    },
                    "version_evidence": [
                        {
                            "source": "file:C:/logs/maafw.log",
                            "path": "C:/logs/maafw.log",
                            "line": 3,
                            "timestamp": "2026-07-19 10:00:00.002",
                            "version": "v5.11.1",
                        }
                    ],
                }
            ],
        },
        "warnings": [],
    }


def test_mla_preflight_contract_accepts_source_backed_sessions() -> None:
    result = MlaPreflightResult.model_validate(_preflight_payload())

    assert result.framework.status is MlaFrameworkStatus.SINGLE
    assert result.framework.sessions[0].status is MlaSessionStatus.RESOLVED
    assert result.framework.sessions[0].version_evidence[0].line == 3


def test_mla_preflight_contract_rejects_third_party_camel_case() -> None:
    payload = _preflight_payload()
    payload["schemaVersion"] = payload.pop("schema_version")

    with pytest.raises(ValidationError):
        MlaPreflightResult.model_validate(payload)


# ---------------------------------------------------------------------------
# Runtime inspection contracts
# ---------------------------------------------------------------------------


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


def _recognition_activity_signal() -> dict[str, object]:
    return {
        "session_id": None,
        "execution_id": "exec-1",
        "task_id": 0,
        "task_name": "TaskA",
        "signal_id": "sig-1",
        "kind": "recognition_activity",
        "pipeline_node_name": "NodeA",
        "next_list": [{"name": "NextA", "anchor": False, "jump_back": False}],
        "occurrence_count": 1,
        "occurrences_with_mixed_results": 0,
        "terminal_outcomes": {"matched": 1, "timeout": 0, "running": 0, "unmatched": 0},
        "terminal_matches": [{"name": "NextA", "count": 1}],
        "candidate_statistics": [
            {
                "name": "NextA",
                "evaluation_count": 1,
                "matched_attempt_count": 1,
                "unsuccessful_attempt_count": 0,
                "running_attempt_count": 0,
                "terminal_match_count": 1,
            }
        ],
        "unmapped_attempt_count": 0,
        "attempts": _metric_dist(1),
        "unsuccessful_attempts": _metric_dist(1),
        "duration_ms": _metric_dist(1),
        "representatives": {
            "first": _occurrence_sample(),
            "worst": _occurrence_sample(),
            "last": _occurrence_sample(),
        },
        "priority": "normal",
        "priority_reasons": [],
    }


def _repeated_node_signal() -> dict[str, object]:
    return {
        "session_id": None,
        "execution_id": "exec-1",
        "task_id": 0,
        "task_name": "TaskA",
        "signal_id": "sig-2",
        "kind": "repeated_node",
        "pattern": ["NodeA", "NodeB"],
        "segment_count": 1,
        "total_repeat_count": 2,
        "maximum_repeat_count": 2,
        "duration_ms": _metric_dist(2),
        "terminations": {"left_pattern": 0, "task_ended": 1, "still_repeating_at_log_end": 0},
        "representatives": {
            "first": {
                "first_seen_at": "2026-07-19 10:00:00.000",
                "last_seen_at": "2026-07-19 10:00:01.000",
                "repeat_count": 2,
                "evidence": _evidence_pos(1),
            },
            "longest": {
                "first_seen_at": "2026-07-19 10:00:00.000",
                "last_seen_at": "2026-07-19 10:00:01.000",
                "repeat_count": 2,
                "evidence": _evidence_pos(1),
            },
            "last": {
                "first_seen_at": "2026-07-19 10:00:02.000",
                "last_seen_at": "2026-07-19 10:00:03.000",
                "repeat_count": 1,
                "evidence": _evidence_pos(3),
            },
        },
        "detector": {
            "name": "repeated-completed-node-sequence",
            "version": 1,
            "minimum_repeats": 2,
            "maximum_pattern_length": 8,
        },
        "priority": "low",
        "priority_reasons": [],
    }


def _runtime_inspection_payload(
    signals: list[dict[str, object]] | None = None,
) -> dict[str, object]:
    return {
        "schema_version": "mla-runtime-inspection/v1",
        "sessions": [],
        "unscoped_tasks": [],
        "failures": [],
        "outcomes": [],
        "signals": signals if signals is not None else [],
        "warnings": [],
    }


def test_mla_runtime_inspection_accepts_empty_result() -> None:
    result = MlaRuntimeInspectionResult.model_validate(_runtime_inspection_payload())
    assert result.schema_version == "mla-runtime-inspection/v1"
    assert result.sessions == []
    assert result.signals == []


def test_mla_runtime_inspection_dispatches_recognition_activity_signal() -> None:
    payload = _runtime_inspection_payload([_recognition_activity_signal()])
    result = MlaRuntimeInspectionResult.model_validate(payload)
    assert len(result.signals) == 1
    assert isinstance(result.signals[0], MlaRecognitionActivitySignal)
    assert result.signals[0].pipeline_node_name == "NodeA"


def test_mla_runtime_inspection_dispatches_repeated_node_signal() -> None:
    payload = _runtime_inspection_payload([_repeated_node_signal()])
    result = MlaRuntimeInspectionResult.model_validate(payload)
    assert len(result.signals) == 1
    assert isinstance(result.signals[0], MlaRepeatedNodeSequenceSignal)
    assert result.signals[0].pattern == ["NodeA", "NodeB"]


def test_mla_runtime_inspection_dispatches_mixed_signals() -> None:
    payload = _runtime_inspection_payload([_recognition_activity_signal(), _repeated_node_signal()])
    result = MlaRuntimeInspectionResult.model_validate(payload)
    assert len(result.signals) == 2
    assert isinstance(result.signals[0], MlaRecognitionActivitySignal)
    assert isinstance(result.signals[1], MlaRepeatedNodeSequenceSignal)


def test_mla_runtime_inspection_rejects_camel_case() -> None:
    payload = _runtime_inspection_payload()
    payload["schemaVersion"] = payload.pop("schema_version")
    with pytest.raises(ValidationError):
        MlaRuntimeInspectionResult.model_validate(payload)
