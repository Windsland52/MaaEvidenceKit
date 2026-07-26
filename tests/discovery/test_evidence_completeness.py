import os
from pathlib import Path

import pytest

from maa_diagnostic_expert.contracts.domain import (
    AnalysisRequest,
    ArtifactInput,
    ArtifactKind,
    PreparedAnalysis,
)
from maa_diagnostic_expert.discovery.preparation import prepare_analysis


def _prepare(*artifacts: ArtifactInput) -> PreparedAnalysis:
    return prepare_analysis(
        AnalysisRequest(
            question="Check whether the screenshots have source logs.",
            artifacts=list(artifacts),
        )
    )


def _missing_codes(prepared: PreparedAnalysis) -> set[str]:
    return {item.code for item in prepared.missing_evidence}


def test_reports_screenshot_without_source_logs(tmp_path: Path) -> None:
    screenshot = tmp_path / "on_error.png"
    screenshot.write_bytes(b"image")

    prepared = _prepare(ArtifactInput(path=screenshot, kind=ArtifactKind.FILE))

    [missing] = [
        item for item in prepared.missing_evidence if item.code == "screenshot_source_logs_missing"
    ]
    assert missing.required
    assert missing.source_path == screenshot
    assert "1 screenshot artifact(s)" in missing.message


def test_accepts_screenshot_with_available_log(tmp_path: Path) -> None:
    screenshot = tmp_path / "on_error.png"
    log = tmp_path / "maafw.log"
    screenshot.write_bytes(b"image")
    log.write_text("log", encoding="utf-8")

    prepared = _prepare(
        ArtifactInput(path=screenshot, kind=ArtifactKind.FILE),
        ArtifactInput(path=log, kind=ArtifactKind.FILE),
    )

    assert "screenshot_source_logs_missing" not in _missing_codes(prepared)


def test_missing_log_does_not_satisfy_screenshot_completeness(tmp_path: Path) -> None:
    screenshot = tmp_path / "on_error.png"
    screenshot.write_bytes(b"image")
    missing_log = tmp_path / "missing.log"

    prepared = _prepare(
        ArtifactInput(path=screenshot, kind=ArtifactKind.FILE),
        ArtifactInput(path=missing_log, kind=ArtifactKind.FILE),
    )

    assert {"artifact_missing", "screenshot_source_logs_missing"} <= _missing_codes(prepared)


def test_accepts_screenshot_with_explicit_zip(tmp_path: Path) -> None:
    screenshot = tmp_path / "on_error.png"
    archive = tmp_path / "debug.zip"
    screenshot.write_bytes(b"image")
    archive.write_bytes(b"zip")

    prepared = _prepare(
        ArtifactInput(path=screenshot, kind=ArtifactKind.FILE),
        ArtifactInput(path=archive, kind=ArtifactKind.ARCHIVE),
    )

    assert "screenshot_source_logs_missing" not in _missing_codes(prepared)


def test_directory_discovered_zip_does_not_hide_missing_source_logs(tmp_path: Path) -> None:
    (tmp_path / "on_error.png").write_bytes(b"image")
    (tmp_path / "debug.zip").write_bytes(b"zip")

    prepared = _prepare(ArtifactInput(path=tmp_path, kind=ArtifactKind.DIRECTORY))

    assert "screenshot_source_logs_missing" in _missing_codes(prepared)


def test_unsupported_archive_does_not_hide_missing_source_logs(tmp_path: Path) -> None:
    screenshot = tmp_path / "on_error.png"
    archive = tmp_path / "debug.7z"
    screenshot.write_bytes(b"image")
    archive.write_bytes(b"archive")

    prepared = _prepare(
        ArtifactInput(path=screenshot, kind=ArtifactKind.FILE),
        ArtifactInput(path=archive, kind=ArtifactKind.ARCHIVE),
    )

    assert "screenshot_source_logs_missing" in _missing_codes(prepared)


def test_reports_one_bounded_fact_for_multiple_screenshots(tmp_path: Path) -> None:
    first = tmp_path / "first.png"
    second = tmp_path / "second.jpg"
    first.write_bytes(b"first")
    second.write_bytes(b"second")

    prepared = _prepare(
        ArtifactInput(path=second, kind=ArtifactKind.FILE),
        ArtifactInput(path=first, kind=ArtifactKind.FILE),
    )

    missing = [
        item for item in prepared.missing_evidence if item.code == "screenshot_source_logs_missing"
    ]
    assert len(missing) == 1
    assert missing[0].source_path == first
    assert "2 screenshot artifact(s)" in missing[0].message


def test_missing_screenshot_does_not_request_source_logs(tmp_path: Path) -> None:
    screenshot = tmp_path / "missing.png"

    prepared = _prepare(ArtifactInput(path=screenshot, kind=ArtifactKind.FILE))

    assert _missing_codes(prepared) == {"artifact_missing"}


def test_hardlinked_screenshot_aliases_count_as_one_physical_artifact(tmp_path: Path) -> None:
    first = tmp_path / "first.png"
    alias = tmp_path / "alias.png"
    first.write_bytes(b"image")
    try:
        os.link(first, alias)
    except OSError as error:
        pytest.skip(f"Hard links are unavailable on this filesystem: {error}")

    prepared = _prepare(
        ArtifactInput(path=first, kind=ArtifactKind.FILE),
        ArtifactInput(path=alias, kind=ArtifactKind.FILE),
    )

    [missing] = [
        item for item in prepared.missing_evidence if item.code == "screenshot_source_logs_missing"
    ]
    assert "1 screenshot artifact(s)" in missing.message


def test_log_alias_of_the_screenshot_is_not_independent_source_evidence(
    tmp_path: Path,
) -> None:
    screenshot = tmp_path / "screenshot.png"
    log_alias = tmp_path / "screenshot.log"
    screenshot.write_bytes(b"image")
    try:
        os.link(screenshot, log_alias)
    except OSError as error:
        pytest.skip(f"Hard links are unavailable on this filesystem: {error}")

    prepared = _prepare(
        ArtifactInput(path=screenshot, kind=ArtifactKind.FILE),
        ArtifactInput(path=log_alias, kind=ArtifactKind.FILE),
    )

    assert "screenshot_source_logs_missing" in _missing_codes(prepared)
