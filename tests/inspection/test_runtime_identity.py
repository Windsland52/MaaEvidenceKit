from __future__ import annotations

from pathlib import Path

import pytest
from pydantic import ValidationError

from maa_diagnostic_expert.contracts.domain import EvidenceRole
from maa_diagnostic_expert.contracts.mla import MlaPreflightResult
from maa_diagnostic_expert.contracts.workflow import (
    RuntimeComponent,
    RuntimeIdentity,
    RuntimeVersionObservation,
    VersionObservationKind,
)
from maa_diagnostic_expert.inspection.models import MlaArtifactInspection
from maa_diagnostic_expert.inspection.runtime_identity import (
    extract_runtime_identity,
    synthesize_runtime_identity_evidence,
)


def _preflight(
    *,
    sessions: list[dict[str, object]],
    versions: list[str],
) -> MlaPreflightResult:
    return MlaPreflightResult.model_validate(
        {
            "schema_version": "mde-mla-preflight/v1",
            "mla_schema_version": "mla-preflight/v1",
            "compatibility": {
                "status": "supported",
                "reason": "notify_events_parsed",
                "parser_version": "test-parser",
                "task_count": 0,
                "event_count": 0,
                "node_statistic_count": 0,
                "recognition_statistic_count": 0,
            },
            "framework": {
                "status": "multiple" if len(versions) > 1 else "single",
                "versions": versions,
                "sessions": sessions,
            },
            "warnings": [],
        }
    )


def _session(
    *,
    session_id: str,
    source: str,
    line: int,
    evidence: list[tuple[str, int]],
) -> dict[str, object]:
    versions = [version for version, _ in evidence]
    return {
        "session_id": session_id,
        "start_kind": "process_start",
        "status": "conflict" if len(set(versions)) > 1 else "resolved",
        "version": versions[0] if len(set(versions)) == 1 else None,
        "versions": list(dict.fromkeys(versions)),
        "start": {
            "source": source,
            "path": source.removeprefix("file:"),
            "line": line,
            "timestamp": "2026-07-19 10:00:00.001",
        },
        "end": {
            "source": source,
            "path": source.removeprefix("file:"),
            "line": line + 20,
            "timestamp": "2026-07-19 10:00:02.000",
        },
        "version_evidence": [
            {
                "source": source,
                "path": source.removeprefix("file:"),
                "line": evidence_line,
                "timestamp": "2026-07-19 10:00:00.002",
                "version": version,
            }
            for version, evidence_line in evidence
        ],
    }


def _artifact(path: Path, preflight: MlaPreflightResult) -> MlaArtifactInspection:
    return MlaArtifactInspection(
        artifact_id=f"artifact:{path.name}", path=path, preflight=preflight
    )


def test_extract_runtime_identity_keeps_versions_scoped_to_sessions(tmp_path: Path) -> None:
    source = f"file:{tmp_path / 'maafw.log'}"
    preflight = _preflight(
        sessions=[
            _session(
                session_id="session-old",
                source=source,
                line=1,
                evidence=[("v5.10.0", 2)],
            ),
            _session(
                session_id="session-new",
                source=source,
                line=30,
                evidence=[("v5.11.1", 31)],
            ),
        ],
        versions=["v5.10.0", "v5.11.1"],
    )

    identity = extract_runtime_identity([_artifact(tmp_path / "maafw.log", preflight)])

    assert [(item.session_id, item.version) for item in identity.versions] == [
        ("session-old", "v5.10.0"),
        ("session-new", "v5.11.1"),
    ]
    assert [item.line_number for item in identity.versions] == [2, 31]
    assert all(item.kind is VersionObservationKind.OBSERVED for item in identity.versions)


def test_extract_runtime_identity_preserves_conflicting_session_versions(
    tmp_path: Path,
) -> None:
    source = f"file:{tmp_path / 'maafw.log'}"
    preflight = _preflight(
        sessions=[
            _session(
                session_id="session-conflict",
                source=source,
                line=1,
                evidence=[("v5.10.0", 2), ("v5.11.1", 12)],
            )
        ],
        versions=["v5.10.0", "v5.11.1"],
    )

    identity = extract_runtime_identity([_artifact(tmp_path / "maafw.log", preflight)])

    assert [(item.version, item.line_number) for item in identity.versions] == [
        ("v5.10.0", 2),
        ("v5.11.1", 12),
    ]
    assert len({item.evidence_id for item in identity.versions}) == 2


def test_extract_runtime_identity_falls_back_to_source_level_version(tmp_path: Path) -> None:
    preflight = _preflight(sessions=[], versions=["v5.11.1"])

    identity = extract_runtime_identity([_artifact(tmp_path / "maafw.log", preflight)])

    [observation] = identity.versions
    assert observation.version == "v5.11.1"
    assert observation.session_id is None
    assert observation.line_number is None
    assert observation.kind is VersionObservationKind.RESOLVED
    assert observation.confidence == 0.7


def test_extract_runtime_identity_does_not_merge_artifacts_with_same_version(
    tmp_path: Path,
) -> None:
    preflight = _preflight(sessions=[], versions=["v5.11.1"])

    identity = extract_runtime_identity(
        [
            _artifact(tmp_path / "first.log", preflight),
            _artifact(tmp_path / "second.log", preflight),
        ]
    )

    assert len(identity.versions) == 2
    assert {item.source_ref for item in identity.versions} == {
        str(tmp_path / "first.log"),
        str(tmp_path / "second.log"),
    }
    assert len({item.evidence_id for item in identity.versions}) == 2


def test_runtime_identity_evidence_preserves_source_line_and_reliability(
    tmp_path: Path,
) -> None:
    source = f"file:{tmp_path / 'maafw.log'}"
    preflight = _preflight(
        sessions=[
            _session(
                session_id="session-1",
                source=source,
                line=1,
                evidence=[("v5.11.1", 3)],
            )
        ],
        versions=["v5.11.1"],
    )
    identity = extract_runtime_identity([_artifact(tmp_path / "maafw.log", preflight)])

    [evidence] = synthesize_runtime_identity_evidence(identity)

    assert evidence.id == identity.versions[0].evidence_id
    assert evidence.source_path == str(tmp_path / "maafw.log")
    assert evidence.line_start == 3
    assert evidence.line_end == 3
    assert evidence.role is EvidenceRole.CONTEXT
    assert evidence.reliability.value == "primary"
    assert "session=session-1" in evidence.content


def test_runtime_identity_rejects_duplicate_evidence_ids() -> None:
    observation = RuntimeVersionObservation(
        component=RuntimeComponent.MAA_FRAMEWORK,
        version="v5.11.1",
        kind=VersionObservationKind.OBSERVED,
        source_ref="file:maafw.log",
        evidence_id="evidence:runtime-version:duplicate",
        confidence=1,
    )

    with pytest.raises(ValidationError, match="evidence IDs must be unique"):
        RuntimeIdentity(versions=[observation, observation])
