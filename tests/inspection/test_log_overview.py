from __future__ import annotations

from pathlib import Path

import pytest

from maa_diagnostic_expert.contracts.domain import (
    AnalysisRequest,
    ArtifactInput,
    ArtifactKind,
    EvidenceRole,
)
from maa_diagnostic_expert.contracts.workflow import ArtifactSourceKind
from maa_diagnostic_expert.discovery.artifact_classification import classify_artifact_sources
from maa_diagnostic_expert.discovery.preparation import prepare_analysis
from maa_diagnostic_expert.inspection import log_overview
from maa_diagnostic_expert.inspection.log_overview import (
    LogOverviewStatus,
    LogSeverity,
    build_log_overviews,
    collect_log_overview_missing_evidence,
    synthesize_log_overview_evidence,
)


def _overview(path: Path) -> log_overview.LogArtifactOverview:
    prepared = prepare_analysis(
        AnalysisRequest(
            question="Summarize the custom log.",
            artifacts=[ArtifactInput(path=path.parent, kind=ArtifactKind.DIRECTORY)],
        )
    )
    inventory = classify_artifact_sources(prepared)
    collection = build_log_overviews(prepared, inventory)
    assert len(collection.overviews) == 1
    return collection.overviews[0]


def test_overview_records_time_levels_and_traceable_occurrences(tmp_path: Path) -> None:
    custom = tmp_path / "custom"
    custom.mkdir()
    path = custom / "agent.log"
    path.write_text(
        "2026-01-01 00:00:00 INFO application started\n"
        "2026-01-01 00:00:01 WARNING retry requested\n"
        '{"level":"error","time":"2026-01-01T00:00:02+08:00","message":"boom"}\n',
        encoding="utf-8",
    )

    overview = _overview(path)
    counts = {item.severity: item.count for item in overview.severity_counts}

    assert overview.status is LogOverviewStatus.COMPLETE
    assert overview.scanned_lines == 3
    assert overview.first_timestamp_text == "2026-01-01 00:00:00"
    assert overview.last_timestamp_text == "2026-01-01T00:00:02+08:00"
    assert counts[LogSeverity.INFO] == 1
    assert counts[LogSeverity.WARNING] == 1
    assert counts[LogSeverity.ERROR] == 1
    assert [item.line_number for item in overview.notable_occurrences] == [2, 3]
    assert overview.notable_occurrences[1].byte_offset > 0


def test_overview_scans_unknown_log_formats_for_generic_warning_evidence(
    tmp_path: Path,
) -> None:
    path = tmp_path / "2026-07-26-2.log"
    path.write_text(
        "2026-07-27 08:00:16 INFO [Task] scheduled task triggered\n"
        "2026-07-27 08:00:16 WARN [Task] lock screen detected, cancelling startup\n",
        encoding="utf-8",
    )

    overview = _overview(path)

    assert overview.source_kind is ArtifactSourceKind.UNKNOWN
    assert [item.line_number for item in overview.notable_occurrences] == [2]
    assert overview.notable_occurrences[0].severity is LogSeverity.WARNING
    assert "lock screen detected" in overview.notable_occurrences[0].excerpt


def test_overview_bounds_long_lines_and_keeps_first_and_last_errors(tmp_path: Path) -> None:
    custom = tmp_path / "custom"
    custom.mkdir()
    path = custom / "agent.log"
    lines = ["ERROR " + "x" * (70 * 1024)]
    lines.extend(f"ERROR failure {index}" for index in range(1, 50))
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")

    overview = _overview(path)

    assert overview.oversized_line_count == 1
    assert overview.notable_occurrences[0].line_truncated
    assert len(overview.notable_occurrences) == 40
    assert overview.notable_occurrences[0].line_number == 1
    assert overview.notable_occurrences[-1].line_number == 50
    assert overview.omitted_occurrence_count == 10


def test_overview_reports_total_scan_truncation(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    custom = tmp_path / "custom"
    custom.mkdir()
    path = custom / "agent.log"
    path.write_text("INFO line\n" * 100, encoding="utf-8")
    monkeypatch.setattr(log_overview, "MAX_SCAN_BYTES", 64)

    overview = _overview(path)

    assert overview.status is LogOverviewStatus.TRUNCATED
    assert overview.scanned_bytes <= 65
    missing = collect_log_overview_missing_evidence(
        log_overview.LogOverviewCollection(overviews=[overview])
    )
    assert [item.code for item in missing] == ["log_overview_truncated"]
    assert not missing[0].required


def test_overview_evidence_preserves_source_lines(tmp_path: Path) -> None:
    custom = tmp_path / "custom"
    custom.mkdir()
    path = custom / "agent.log"
    path.write_text("INFO start\nERROR failed\n", encoding="utf-8")
    prepared = prepare_analysis(
        AnalysisRequest(
            question="Summarize the custom log.",
            artifacts=[ArtifactInput(path=custom, kind=ArtifactKind.DIRECTORY)],
        )
    )
    collection = build_log_overviews(prepared, classify_artifact_sources(prepared))

    evidence = synthesize_log_overview_evidence(collection)

    assert [item.kind for item in evidence] == [
        "log_overview_summary",
        "log_occurrence:error",
    ]
    assert evidence[0].role is EvidenceRole.CONTEXT
    assert evidence[1].role is EvidenceRole.SIGNAL
    assert evidence[1].source_path == str(path)
    assert evidence[1].line_start == 2
    assert evidence[1].line_end == 2


def test_overview_scans_a_directory_and_explicit_log_only_once(tmp_path: Path) -> None:
    custom = tmp_path / "custom"
    custom.mkdir()
    path = custom / "agent.log"
    path.write_text("INFO start\nERROR failed\n", encoding="utf-8")
    prepared = prepare_analysis(
        AnalysisRequest(
            question="Summarize the custom log once.",
            artifacts=[
                ArtifactInput(path=custom, kind=ArtifactKind.DIRECTORY),
                ArtifactInput(path=path, kind=ArtifactKind.FILE),
            ],
        )
    )

    collection = build_log_overviews(prepared, classify_artifact_sources(prepared))
    evidence = synthesize_log_overview_evidence(collection)

    assert len(collection.overviews) == 1
    assert [item.kind for item in evidence] == [
        "log_overview_summary",
        "log_occurrence:error",
    ]
