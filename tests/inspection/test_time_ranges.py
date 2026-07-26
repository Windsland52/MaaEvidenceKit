from pathlib import Path

from maa_diagnostic_expert.contracts.domain import MissingEvidence
from maa_diagnostic_expert.contracts.mla import MlaPreflightResult
from maa_diagnostic_expert.contracts.workflow import ArtifactSourceKind
from maa_diagnostic_expert.inspection.log_overview import (
    LogArtifactOverview,
    LogOverviewCollection,
    LogOverviewStatus,
)
from maa_diagnostic_expert.inspection.models import MlaArtifactInspection
from maa_diagnostic_expert.inspection.time_ranges import (
    collect_time_range_missing_evidence,
)


def _overview(
    path: Path,
    source_kind: ArtifactSourceKind,
    start: str,
    end: str,
) -> LogArtifactOverview:
    return LogArtifactOverview(
        artifact_id=f"artifact:{path.name}",
        path=path,
        source_kind=source_kind,
        status=LogOverviewStatus.COMPLETE,
        scanned_bytes=1,
        scanned_lines=1,
        first_timestamp_text=start,
        last_timestamp_text=end,
    )


def _mla_preflight(
    path: Path,
    *ranges: tuple[str, str],
) -> MlaArtifactInspection:
    sessions = [
        {
            "session_id": f"session-{index}",
            "start_kind": "process_start",
            "status": "resolved",
            "version": "v5.11.1",
            "versions": ["v5.11.1"],
            "start": {
                "source": str(path),
                "path": path.name,
                "line": 1,
                "timestamp": start,
            },
            "end": {
                "source": str(path),
                "path": path.name,
                "line": 2,
                "timestamp": end,
            },
            "version_evidence": [],
        }
        for index, (start, end) in enumerate(ranges, start=1)
    ]
    preflight = MlaPreflightResult.model_validate(
        {
            "schema_version": "mde-mla-preflight/v1",
            "mla_schema_version": "mla-preflight/v1",
            "compatibility": {
                "status": "unsupported",
                "reason": "test",
                "parser_version": "test",
                "task_count": 0,
                "event_count": 0,
                "node_statistic_count": 0,
                "recognition_statistic_count": 0,
            },
            "framework": {
                "status": "single",
                "versions": ["v5.11.1"],
                "sessions": sessions,
            },
            "warnings": [],
        }
    )
    return MlaArtifactInspection(
        artifact_id=f"artifact:{path.name}",
        path=path,
        preflight=preflight,
    )


def _missing(
    overviews: list[LogArtifactOverview],
    preflights: list[MlaArtifactInspection],
) -> list[MissingEvidence]:
    return collect_time_range_missing_evidence(
        LogOverviewCollection(overviews=overviews),
        preflights,
    )


def test_accepts_overlapping_gui_and_maa_time_ranges(tmp_path: Path) -> None:
    gui = _overview(
        tmp_path / "gui.log",
        ArtifactSourceKind.GUI,
        "2026-07-14 18:24:31",
        "2026-07-14 18:27:09",
    )
    mla = _mla_preflight(
        tmp_path / "maafw.log",
        ("2026-07-14 18:24:31.399", "2026-07-14 18:27:05.263"),
    )

    assert _missing([gui], [mla]) == []


def test_reports_disjoint_gui_and_maa_time_ranges(tmp_path: Path) -> None:
    gui = _overview(
        tmp_path / "gui.log",
        ArtifactSourceKind.GUI,
        "2026-07-21 10:00:00",
        "2026-07-21 10:05:00",
    )
    mla = _mla_preflight(
        tmp_path / "maafw.log",
        ("2026-07-19 10:00:00", "2026-07-19 10:05:00"),
    )

    [missing] = _missing([gui], [mla])

    assert missing.code == "artifact_time_ranges_incompatible"
    assert missing.required
    assert "1 day, 23:55:00" in missing.message


def test_accepts_ranges_that_touch_at_the_same_timestamp(tmp_path: Path) -> None:
    gui = _overview(
        tmp_path / "gui.log",
        ArtifactSourceKind.GUI,
        "2026-07-21 10:05:00",
        "2026-07-21 10:10:00",
    )
    mla = _mla_preflight(
        tmp_path / "maafw.log",
        ("2026-07-21 10:00:00", "2026-07-21 10:05:00"),
    )

    assert _missing([gui], [mla]) == []


def test_accepts_when_any_maa_session_overlaps_the_gui_log(tmp_path: Path) -> None:
    gui = _overview(
        tmp_path / "gui.log",
        ArtifactSourceKind.GUI,
        "2026-07-21 10:00:00",
        "2026-07-21 10:05:00",
    )
    mla = _mla_preflight(
        tmp_path / "maafw.log",
        ("2026-07-19 10:00:00", "2026-07-19 10:05:00"),
        ("2026-07-21 10:01:00", "2026-07-21 10:02:00"),
    )

    assert _missing([gui], [mla]) == []


def test_normalizes_explicit_utc_offsets_before_comparison(tmp_path: Path) -> None:
    gui = _overview(
        tmp_path / "gui.log",
        ArtifactSourceKind.GUI,
        "2026-07-21T10:00:00+08:00",
        "2026-07-21T10:05:00+08:00",
    )
    mla = _mla_preflight(
        tmp_path / "maafw.log",
        ("2026-07-21T02:00:00Z", "2026-07-21T02:05:00Z"),
    )

    assert _missing([gui], [mla]) == []


def test_reports_incompatible_timestamp_bases(tmp_path: Path) -> None:
    gui = _overview(
        tmp_path / "gui.log",
        ArtifactSourceKind.GUI,
        "2026-07-21 10:00:00",
        "2026-07-21 10:05:00",
    )
    mla = _mla_preflight(
        tmp_path / "maafw.log",
        ("2026-07-21T10:00:00Z", "2026-07-21T10:05:00Z"),
    )

    [missing] = _missing([gui], [mla])

    assert missing.code == "artifact_time_bases_incompatible"


def test_reports_a_reversed_time_range(tmp_path: Path) -> None:
    gui = _overview(
        tmp_path / "gui.log",
        ArtifactSourceKind.GUI,
        "2026-07-21 10:05:00",
        "2026-07-21 10:00:00",
    )

    [missing] = _missing([gui], [])

    assert missing.code == "artifact_time_range_invalid"


def test_reports_an_unparseable_time_range(tmp_path: Path) -> None:
    gui = _overview(
        tmp_path / "gui.log",
        ArtifactSourceKind.GUI,
        "not-a-time",
        "still-not-a-time",
    )

    [missing] = _missing([gui], [])

    assert missing.code == "artifact_time_range_unparseable"


def test_reports_a_timestamp_that_overflows_during_utc_normalization(
    tmp_path: Path,
) -> None:
    gui = _overview(
        tmp_path / "gui.log",
        ArtifactSourceKind.GUI,
        "0001-01-01T00:00:00+23:00",
        "0001-01-01T00:01:00+23:00",
    )

    [missing] = _missing([gui], [])

    assert missing.code == "artifact_time_range_unparseable"


def test_does_not_compare_a_truncated_log_range(tmp_path: Path) -> None:
    gui = _overview(
        tmp_path / "gui.log",
        ArtifactSourceKind.GUI,
        "2026-07-21 10:00:00",
        "2026-07-21 10:05:00",
    ).model_copy(update={"status": LogOverviewStatus.TRUNCATED})
    mla = _mla_preflight(
        tmp_path / "maafw.log",
        ("2026-07-19 10:00:00", "2026-07-19 10:05:00"),
    )

    assert _missing([gui], [mla]) == []
