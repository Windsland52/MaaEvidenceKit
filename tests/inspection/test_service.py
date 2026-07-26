import os
from pathlib import Path

import pytest
from pydantic import JsonValue

from maa_diagnostic_expert.contracts.domain import (
    AnalysisRequest,
    ArtifactInput,
    ArtifactKind,
    EvidenceRole,
    PreparedAnalysis,
    RevisionResolutionStatus,
    SourceRevisionBackend,
    SourceRole,
    SourceSnapshot,
)
from maa_diagnostic_expert.contracts.workflow import IncidentSelectionStatus
from maa_diagnostic_expert.discovery.preparation import prepare_analysis
from maa_diagnostic_expert.inspection.service import (
    attach_runtime_identity,
    inspect_analysis,
    inspect_prepared_analysis,
    synthesize_inspection_evidence,
)
from maa_diagnostic_expert.interfaces.tool_adapter import ToolAdapterInvocationError


def _empty_preflight() -> dict[str, JsonValue]:
    return {
        "schema_version": "mde-mla-preflight/v1",
        "mla_schema_version": "mla-preflight/v1",
        "compatibility": {
            "status": "unsupported",
            "reason": "no_notify_events",
            "parser_version": "test-parser",
            "task_count": 0,
            "event_count": 0,
            "node_statistic_count": 0,
            "recognition_statistic_count": 0,
        },
        "framework": {
            "status": "single",
            "versions": ["v5.11.1"],
            "sessions": [],
        },
        "warnings": [],
    }


def _supported_preflight() -> dict[str, JsonValue]:
    return {
        "schema_version": "mde-mla-preflight/v1",
        "mla_schema_version": "mla-preflight/v1",
        "compatibility": {
            "status": "supported",
            "reason": "notify_events_parsed",
            "parser_version": "test-parser",
            "task_count": 1,
            "event_count": 3,
            "node_statistic_count": 1,
            "recognition_statistic_count": 0,
        },
        "framework": {
            "status": "single",
            "versions": ["v5.11.1"],
            "sessions": [],
        },
        "warnings": [],
    }


def _preflight_with_session(start: str, end: str) -> dict[str, JsonValue]:
    return {
        "schema_version": "mde-mla-preflight/v1",
        "mla_schema_version": "mla-preflight/v1",
        "compatibility": {
            "status": "unsupported",
            "reason": "no_notify_events",
            "parser_version": "test-parser",
            "task_count": 0,
            "event_count": 0,
            "node_statistic_count": 0,
            "recognition_statistic_count": 0,
        },
        "framework": {
            "status": "single",
            "versions": ["v5.11.1"],
            "sessions": [
                {
                    "session_id": "session-1",
                    "start_kind": "process_start",
                    "status": "resolved",
                    "version": "v5.11.1",
                    "versions": ["v5.11.1"],
                    "start": {
                        "source": "maafw.log",
                        "path": "maafw.log",
                        "line": 1,
                        "timestamp": start,
                    },
                    "end": {
                        "source": "maafw.log",
                        "path": "maafw.log",
                        "line": 2,
                        "timestamp": end,
                    },
                    "version_evidence": [],
                }
            ],
        },
        "warnings": [],
    }


def _empty_runtime_inspection() -> dict[str, JsonValue]:
    return {
        "schema_version": "mla-runtime-inspection/v1",
        "sessions": [],
        "unscoped_tasks": [],
        "failures": [],
        "outcomes": [],
        "signals": [],
        "warnings": [],
    }


def _mse_preflight(
    project_root: Path,
    *,
    status: str = "supported",
    reason: str = "The interface and resource loaded.",
) -> dict[str, JsonValue]:
    return {
        "schema_version": "mde-mse-project-preflight/v1",
        "project_root": str(project_root),
        "interface_path": "assets/interface.json",
        "syntax_mode": "maafw",
        "compatibility": {
            "status": status,
            "reason": reason,
        },
        "controllers": ["Adb"],
        "resources": ["Official"],
        "task_bindings": [{"name": "Combat", "entry": "Start"}],
        "configurations": [
            {
                "controller": "Adb",
                "resource": "Official",
                "resource_paths": ["resource/base"],
                "task_count": 1,
                "pipeline_file_count": 1,
                "diagnostic_count": 1,
                "error_count": 1,
                "warning_count": 0,
            }
        ],
        "configurations_truncated": False,
        "diagnostics": [
            {
                "type": "unknown-task",
                "level": "error",
                "source_path": "assets/resource/base/pipeline/combat.json",
                "line": 3,
                "column": 10,
                "length": 7,
                "message": "Unknown task Missing.",
                "controller": "Adb",
                "resource": "Official",
            }
        ],
        "diagnostics_truncated": False,
        "warnings": [],
    }


class RecordingToolCaller:
    def __init__(
        self,
        preflight: dict[str, JsonValue] | None = None,
        runtime: dict[str, JsonValue] | None = None,
        mse: dict[str, JsonValue] | None = None,
    ) -> None:
        self.calls: list[tuple[str, dict[str, JsonValue]]] = []
        self._preflight: dict[str, JsonValue] = (
            preflight if preflight is not None else _empty_preflight()
        )
        self._runtime: dict[str, JsonValue] = (
            runtime if runtime is not None else _empty_runtime_inspection()
        )
        self._mse = mse

    def call(self, name: str, arguments: dict[str, JsonValue]) -> dict[str, JsonValue]:
        self.calls.append((name, arguments))
        if name == "mla.runtime-inspection":
            return self._runtime
        if name == "mse.project-preflight" and self._mse is not None:
            return self._mse
        return self._preflight


class FailingToolCaller:
    def call(self, name: str, arguments: dict[str, JsonValue]) -> dict[str, JsonValue]:
        raise ToolAdapterInvocationError(f"{name} failed for {arguments['path']}")


class SupportedPreflightRuntimeFailingCaller:
    def __init__(self) -> None:
        self.calls: list[tuple[str, dict[str, JsonValue]]] = []

    def call(self, name: str, arguments: dict[str, JsonValue]) -> dict[str, JsonValue]:
        self.calls.append((name, arguments))
        if name == "mla.runtime-inspection":
            raise ToolAdapterInvocationError(f"{name} failed for {arguments['path']}")
        return _supported_preflight()


def test_inspect_runs_mla_once_for_an_explicit_directory(tmp_path: Path) -> None:
    debug_path = tmp_path / "debug"
    debug_path.mkdir()
    (debug_path / "maafw.log").write_text("log", encoding="utf-8")
    tool_caller = RecordingToolCaller()

    inspection = inspect_analysis(
        AnalysisRequest(
            question="Inspect the logs.",
            artifacts=[ArtifactInput(path=debug_path, kind=ArtifactKind.DIRECTORY)],
        ),
        tool_caller,
    )

    assert len(tool_caller.calls) == 1
    assert tool_caller.calls[0] == (
        "mla.preflight",
        {"path": str(debug_path.resolve())},
    )
    assert len(inspection.mla_preflights) == 1
    assert inspection.mla_preflights[0].preflight.framework.versions == ["v5.11.1"]


def test_inspect_runs_mla_for_directory_and_explicit_zip_target(
    tmp_path: Path,
) -> None:
    debug_path = tmp_path / "debug"
    debug_path.mkdir()
    archive = debug_path / "debug.zip"
    (debug_path / "maafw.log").write_text("log", encoding="utf-8")
    archive.write_bytes(b"zip")
    tool_caller = RecordingToolCaller()

    inspect_analysis(
        AnalysisRequest(
            question="Inspect the logs.",
            artifacts=[
                ArtifactInput(path=debug_path, kind=ArtifactKind.DIRECTORY),
                ArtifactInput(path=archive, kind=ArtifactKind.ARCHIVE),
            ],
        ),
        tool_caller,
    )

    assert tool_caller.calls == [
        ("mla.preflight", {"path": str(debug_path.resolve())}),
        ("mla.preflight", {"path": str(archive.resolve())}),
    ]


def test_inspect_rejects_a_replaced_explicit_zip_alias(tmp_path: Path) -> None:
    canonical = tmp_path / "aaa.bin"
    archive_alias = tmp_path / "zzz.zip"
    canonical.write_bytes(b"original")
    try:
        os.link(canonical, archive_alias)
    except OSError as error:
        pytest.skip(f"Hard links are unavailable on this filesystem: {error}")
    prepared = prepare_analysis(
        AnalysisRequest(
            question="Inspect the archive.",
            artifacts=[
                ArtifactInput(path=canonical, kind=ArtifactKind.FILE),
                ArtifactInput(path=archive_alias, kind=ArtifactKind.ARCHIVE),
            ],
        )
    )
    archive_alias.unlink()
    archive_alias.write_bytes(b"replacement")
    tool_caller = RecordingToolCaller()

    inspection = inspect_prepared_analysis(prepared, tool_caller)

    assert tool_caller.calls == []
    assert "artifact_origin_changed" in {item.code for item in inspection.prepared.missing_evidence}


def test_inspect_reports_disjoint_custom_and_maa_time_ranges(tmp_path: Path) -> None:
    custom = tmp_path / "custom"
    custom.mkdir()
    (custom / "agent.log").write_text(
        "2026-07-21 10:00:00 INFO start\n2026-07-21 10:05:00 ERROR failed\n",
        encoding="utf-8",
    )
    maa = tmp_path / "maafw.log"
    maa.write_text(
        "[2026-07-19 10:00:00.000][DBG][Px1][Tx1][Logger] MAA Process Start\n",
        encoding="utf-8",
    )
    tool_caller = RecordingToolCaller(
        preflight=_preflight_with_session(
            "2026-07-19 10:00:00.000",
            "2026-07-19 10:05:00.000",
        )
    )

    inspection = inspect_analysis(
        AnalysisRequest(
            question="Do not correlate different runs.",
            artifacts=[ArtifactInput(path=tmp_path, kind=ArtifactKind.DIRECTORY)],
        ),
        tool_caller,
    )

    assert "artifact_time_ranges_incompatible" in {
        item.code for item in inspection.prepared.missing_evidence
    }


def test_inspect_records_mla_failures_as_missing_evidence(tmp_path: Path) -> None:
    log_path = tmp_path / "maafw.log"
    log_path.write_text("log", encoding="utf-8")

    inspection = inspect_analysis(
        AnalysisRequest(
            question="Inspect the log.",
            artifacts=[ArtifactInput(path=log_path, kind=ArtifactKind.FILE)],
        ),
        FailingToolCaller(),
    )

    assert inspection.mla_preflights == []
    assert {item.code for item in inspection.prepared.missing_evidence} == {"mla_preflight_failed"}


def test_inspect_calls_runtime_inspection_when_preflight_supported(tmp_path: Path) -> None:
    debug_path = tmp_path / "debug"
    debug_path.mkdir()
    (debug_path / "maafw.log").write_text("log", encoding="utf-8")
    tool_caller = RecordingToolCaller(preflight=_supported_preflight())

    inspection = inspect_analysis(
        AnalysisRequest(
            question="Inspect the logs.",
            artifacts=[ArtifactInput(path=debug_path, kind=ArtifactKind.DIRECTORY)],
        ),
        tool_caller,
    )

    assert len(tool_caller.calls) == 2
    assert tool_caller.calls[0][0] == "mla.preflight"
    assert tool_caller.calls[1][0] == "mla.runtime-inspection"
    assert len(inspection.mla_preflights) == 1
    assert len(inspection.mla_runtime_inspections) == 1
    assert (
        inspection.mla_runtime_inspections[0].inspection.schema_version
        == "mla-runtime-inspection/v1"
    )


def test_inspect_skips_runtime_inspection_when_preflight_unsupported(tmp_path: Path) -> None:
    debug_path = tmp_path / "debug"
    debug_path.mkdir()
    (debug_path / "maafw.log").write_text("log", encoding="utf-8")
    tool_caller = RecordingToolCaller()

    inspection = inspect_analysis(
        AnalysisRequest(
            question="Inspect the logs.",
            artifacts=[ArtifactInput(path=debug_path, kind=ArtifactKind.DIRECTORY)],
        ),
        tool_caller,
    )

    assert len(tool_caller.calls) == 1
    assert tool_caller.calls[0][0] == "mla.preflight"
    assert len(inspection.mla_preflights) == 1
    assert len(inspection.mla_runtime_inspections) == 0
    assert {item.code for item in inspection.prepared.missing_evidence} == {"mla_log_unsupported"}


def test_inspect_records_runtime_inspection_failures_as_missing_evidence(
    tmp_path: Path,
) -> None:
    log_path = tmp_path / "maafw.log"
    log_path.write_text("log", encoding="utf-8")
    tool_caller = SupportedPreflightRuntimeFailingCaller()

    inspection = inspect_analysis(
        AnalysisRequest(
            question="Inspect the log.",
            artifacts=[ArtifactInput(path=log_path, kind=ArtifactKind.FILE)],
        ),
        tool_caller,
    )

    assert len(inspection.mla_preflights) == 1
    assert len(inspection.mla_runtime_inspections) == 0
    missing_codes = {item.code for item in inspection.prepared.missing_evidence}
    assert "mla_runtime_inspection_failed" in missing_codes


def test_inspect_builds_custom_overview_without_calling_mla(tmp_path: Path) -> None:
    custom = tmp_path / "custom"
    custom.mkdir()
    log = custom / "agent.log"
    log.write_text("INFO start\nERROR failed\n", encoding="utf-8")
    tool_caller = RecordingToolCaller()

    inspection = inspect_analysis(
        AnalysisRequest(
            question="Inspect the custom log.",
            artifacts=[ArtifactInput(path=custom, kind=ArtifactKind.DIRECTORY)],
        ),
        tool_caller,
    )

    assert tool_caller.calls == []
    assert len(inspection.log_overviews.overviews) == 1
    assert [item.kind for item in inspection.synthesized_evidence] == [
        "log_overview_summary",
        "log_occurrence:error",
    ]
    assert inspection.incident_selection.status is IncidentSelectionStatus.AMBIGUOUS
    assert len(inspection.incident_selection.candidates) == 1


def test_inspect_runs_mse_for_revision_matched_project_source(tmp_path: Path) -> None:
    assets = tmp_path / "assets"
    assets.mkdir()
    (assets / "interface.json").write_text("{}", encoding="utf-8")
    caller = RecordingToolCaller(mse=_mse_preflight(tmp_path))
    prepared = PreparedAnalysis(
        request=AnalysisRequest(question="Inspect the current project."),
        source_snapshots=[
            SourceSnapshot(
                source_id="project",
                role=SourceRole.PROJECT,
                path=tmp_path,
                revision_backend=SourceRevisionBackend.GIT,
                current_revision="abc123",
                resolution_status=RevisionResolutionStatus.NOT_REQUESTED,
            )
        ],
    )

    inspection = inspect_prepared_analysis(prepared, caller)
    inspection = attach_runtime_identity(inspection)
    inspection = synthesize_inspection_evidence(inspection)

    assert caller.calls == [
        ("mse.project-preflight", {"path": str(tmp_path)}),
    ]
    assert len(inspection.mse_project_inspections) == 1
    assert [item.kind for item in inspection.synthesized_evidence] == [
        "mse_project_summary",
        "mse_static_diagnostic",
    ]
    assert inspection.synthesized_evidence[1].role is EvidenceRole.SIGNAL
    assert inspection.synthesized_evidence[1].line_start == 3


def test_inspect_records_partial_mse_project_as_required_missing_evidence(
    tmp_path: Path,
) -> None:
    assets = tmp_path / "assets"
    assets.mkdir()
    (assets / "interface.json").write_text("{}", encoding="utf-8")
    caller = RecordingToolCaller(
        mse=_mse_preflight(
            tmp_path,
            status="partial",
            reason="A configured resource path could not be read.",
        )
    )
    prepared = PreparedAnalysis(
        request=AnalysisRequest(question="Inspect the current project."),
        source_snapshots=[
            SourceSnapshot(
                source_id="project",
                role=SourceRole.PROJECT,
                path=tmp_path,
                revision_backend=SourceRevisionBackend.GIT,
                current_revision="abc123",
                resolution_status=RevisionResolutionStatus.NOT_REQUESTED,
            )
        ],
    )

    inspection = inspect_prepared_analysis(prepared, caller)

    [missing] = [
        item
        for item in inspection.prepared.missing_evidence
        if item.code == "mse_project_incomplete"
    ]
    assert missing.required is True
    assert missing.source_id == "project"
    assert missing.source_path == tmp_path
