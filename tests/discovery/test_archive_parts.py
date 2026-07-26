from pathlib import Path

from maa_diagnostic_expert.contracts.domain import (
    AnalysisRequest,
    ArtifactInput,
    ArtifactKind,
    ArtifactMediaKind,
    MissingEvidence,
    PreparedAnalysis,
)
from maa_diagnostic_expert.discovery.preparation import prepare_analysis


def _prepare_directory(directory: Path) -> PreparedAnalysis:
    return prepare_analysis(
        AnalysisRequest(
            question="Check the archive set.",
            artifacts=[ArtifactInput(path=directory, kind=ArtifactKind.DIRECTORY)],
        )
    )


def _multipart_missing(prepared: PreparedAnalysis) -> list[MissingEvidence]:
    return [
        item for item in prepared.missing_evidence if item.code.startswith("multipart_archive_")
    ]


def test_reports_a_gap_in_numbered_zip_parts(tmp_path: Path) -> None:
    (tmp_path / "part01.zip").write_bytes(b"one")
    (tmp_path / "part03.zip").write_bytes(b"three")

    prepared = _prepare_directory(tmp_path)

    [missing] = _multipart_missing(prepared)
    assert missing.code == "multipart_archive_part_missing"
    assert missing.source_path == tmp_path / "part02.zip"
    assert "missing part numbers 2" in missing.message
    assert missing.required


def test_accepts_a_complete_numbered_zip_sequence(tmp_path: Path) -> None:
    for index in range(1, 4):
        (tmp_path / f"part{index:02}.zip").write_bytes(str(index).encode())

    prepared = _prepare_directory(tmp_path)

    assert _multipart_missing(prepared) == []


def test_reports_preceding_parts_when_only_a_later_part_is_supplied(tmp_path: Path) -> None:
    part = tmp_path / "part02.zip"
    part.write_bytes(b"two")

    prepared = prepare_analysis(
        AnalysisRequest(
            question="Check the supplied archive part.",
            artifacts=[ArtifactInput(path=part, kind=ArtifactKind.ARCHIVE)],
        )
    )

    [missing] = _multipart_missing(prepared)
    assert missing.source_path == tmp_path / "part01.zip"


def test_does_not_guess_a_trailing_part_after_an_isolated_part_one(tmp_path: Path) -> None:
    part = tmp_path / "part01.zip"
    part.write_bytes(b"one")

    prepared = prepare_analysis(
        AnalysisRequest(
            question="Check the supplied archive part.",
            artifacts=[ArtifactInput(path=part, kind=ArtifactKind.ARCHIVE)],
        )
    )

    assert _multipart_missing(prepared) == []


def test_declared_part_total_exposes_a_missing_trailing_part(tmp_path: Path) -> None:
    (tmp_path / "logs.part01-of-03.zip").write_bytes(b"one")
    (tmp_path / "logs.part02-of-03.zip").write_bytes(b"two")

    prepared = _prepare_directory(tmp_path)

    [missing] = _multipart_missing(prepared)
    assert missing.source_path == tmp_path / "logs.part03-of-03.zip"
    assert "missing part numbers 3" in missing.message


def test_reports_a_gap_in_numeric_7z_volumes_and_classifies_them_as_archives(
    tmp_path: Path,
) -> None:
    first = tmp_path / "debug.7z.001"
    third = tmp_path / "debug.7z.003"
    first.write_bytes(b"one")
    third.write_bytes(b"three")

    prepared = _prepare_directory(tmp_path)

    [missing] = _multipart_missing(prepared)
    assert missing.source_path == tmp_path / "debug.7z.002"
    by_path = {artifact.path: artifact for artifact in prepared.artifacts}
    assert by_path[first].media_kind is ArtifactMediaKind.ARCHIVE
    assert by_path[third].kind is ArtifactKind.ARCHIVE


def test_split_zip_requires_its_terminal_zip_file(tmp_path: Path) -> None:
    volume = tmp_path / "debug.z01"
    volume.write_bytes(b"one")

    prepared = _prepare_directory(tmp_path)

    [missing] = _multipart_missing(prepared)
    assert missing.source_path == tmp_path / "debug.zip"
    assert "debug.zip" in missing.message


def test_accepts_split_zip_with_contiguous_volumes_and_terminal_file(tmp_path: Path) -> None:
    (tmp_path / "debug.z01").write_bytes(b"one")
    (tmp_path / "debug.z02").write_bytes(b"two")
    (tmp_path / "debug.zip").write_bytes(b"terminal")

    prepared = _prepare_directory(tmp_path)

    assert _multipart_missing(prepared) == []


def test_ignores_non_sequence_names_and_non_archive_parts(tmp_path: Path) -> None:
    (tmp_path / "counterpart02.zip").write_bytes(b"ordinary")
    (tmp_path / "part01.txt").write_text("one", encoding="utf-8")
    (tmp_path / "part03.txt").write_text("three", encoding="utf-8")

    prepared = _prepare_directory(tmp_path)

    assert _multipart_missing(prepared) == []


def test_bounds_implausibly_large_sequence_numbers(tmp_path: Path) -> None:
    (tmp_path / "part10001.zip").write_bytes(b"large")

    prepared = _prepare_directory(tmp_path)

    [missing] = _multipart_missing(prepared)
    assert missing.code == "multipart_archive_sequence_unbounded"
    assert "10,000" in missing.message
