from pathlib import Path

from pydantic import JsonValue

from maa_diagnostic_expert.domain import AnalysisRequest, ArtifactInput, ArtifactKind
from maa_diagnostic_expert.inspection import inspect_analysis
from maa_diagnostic_expert.tool_adapter_client import ToolAdapterInvocationError


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


class RecordingToolCaller:
    def __init__(self) -> None:
        self.calls: list[tuple[str, dict[str, JsonValue]]] = []

    def call(self, name: str, arguments: dict[str, JsonValue]) -> dict[str, JsonValue]:
        self.calls.append((name, arguments))
        return _empty_preflight()


class FailingToolCaller:
    def call(self, name: str, arguments: dict[str, JsonValue]) -> dict[str, JsonValue]:
        raise ToolAdapterInvocationError(f"{name} failed for {arguments['path']}")


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
