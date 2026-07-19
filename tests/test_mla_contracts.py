import pytest
from pydantic import ValidationError

from maa_diagnostic_expert.mla_contracts import (
    MlaFrameworkStatus,
    MlaPreflightResult,
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
