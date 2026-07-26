from __future__ import annotations

import os
from pathlib import Path

import pytest

from maa_diagnostic_expert.contracts.domain import AnalysisRequest, ArtifactInput, ArtifactKind
from maa_diagnostic_expert.discovery.artifact_classification import classify_artifact_sources
from maa_diagnostic_expert.discovery.preparation import prepare_analysis
from maa_diagnostic_expert.inspection.artifact_targets import select_mla_artifact_targets


def _maa_log(path: Path) -> None:
    path.write_text(
        "[2026-01-01 00:00:00.000][DBG][Px1][Tx2][Logger] MAA Process Start\n",
        encoding="utf-8",
    )


def _link_or_skip(source: Path, target: Path) -> None:
    try:
        os.link(source, target)
    except OSError as error:
        pytest.skip(f"Hard links are unavailable on this filesystem: {error}")


def _targets(request: AnalysisRequest) -> list[Path]:
    prepared = prepare_analysis(request)
    inventory = classify_artifact_sources(prepared)
    return [target.path for target in select_mla_artifact_targets(prepared, inventory)]


def test_outer_mla_directory_overrides_nested_directory_and_explicit_log(
    tmp_path: Path,
) -> None:
    root = tmp_path / "debug"
    nested = root / "nested"
    nested.mkdir(parents=True)
    log = nested / "maa.log"
    _maa_log(log)

    paths = _targets(
        AnalysisRequest(
            question="Inspect the logs.",
            artifacts=[
                ArtifactInput(path=root, kind=ArtifactKind.DIRECTORY),
                ArtifactInput(path=nested, kind=ArtifactKind.DIRECTORY),
                ArtifactInput(path=log, kind=ArtifactKind.FILE),
            ],
        )
    )

    assert paths == [root.resolve()]


def test_directory_discovered_zip_is_not_a_separate_mla_target(tmp_path: Path) -> None:
    root = tmp_path / "debug"
    root.mkdir()
    _maa_log(root / "maa.log")
    (root / "debug.zip").write_bytes(b"zip")

    paths = _targets(
        AnalysisRequest(
            question="Inspect the logs.",
            artifacts=[ArtifactInput(path=root, kind=ArtifactKind.DIRECTORY)],
        )
    )

    assert paths == [root.resolve()]


def test_explicit_zip_inside_mla_directory_stays_independent(tmp_path: Path) -> None:
    root = tmp_path / "debug"
    root.mkdir()
    archive = root / "debug.zip"
    _maa_log(root / "maa.log")
    archive.write_bytes(b"zip")

    paths = _targets(
        AnalysisRequest(
            question="Inspect the logs.",
            artifacts=[
                ArtifactInput(path=root, kind=ArtifactKind.DIRECTORY),
                ArtifactInput(path=archive, kind=ArtifactKind.ARCHIVE),
            ],
        )
    )

    assert paths == [root.resolve(), archive.resolve()]


def test_hardlinked_mla_log_aliases_are_targeted_once(tmp_path: Path) -> None:
    first = tmp_path / "maa.log"
    alias = tmp_path / "maafw.log"
    _maa_log(first)
    _link_or_skip(first, alias)

    paths = _targets(
        AnalysisRequest(
            question="Inspect the log.",
            artifacts=[
                ArtifactInput(path=first, kind=ArtifactKind.FILE),
                ArtifactInput(path=alias, kind=ArtifactKind.FILE),
            ],
        )
    )

    assert len(paths) == 1
    assert paths[0] in {first.resolve(), alias.resolve()}


def test_directory_covers_an_explicit_hardlink_alias_outside_the_directory(
    tmp_path: Path,
) -> None:
    root = tmp_path / "debug"
    root.mkdir()
    contained = root / "maa.log"
    outside_alias = tmp_path / "maafw.log"
    _maa_log(contained)
    _link_or_skip(contained, outside_alias)

    paths = _targets(
        AnalysisRequest(
            question="Inspect the log once.",
            artifacts=[
                ArtifactInput(path=root, kind=ArtifactKind.DIRECTORY),
                ArtifactInput(path=outside_alias, kind=ArtifactKind.FILE),
            ],
        )
    )

    assert paths == [root.resolve()]


def test_non_log_hardlink_in_a_directory_does_not_replace_the_explicit_log_target(
    tmp_path: Path,
) -> None:
    root = tmp_path / "debug"
    root.mkdir()
    contained_text = root / "runtime.txt"
    explicit_log = tmp_path / "maa.log"
    _maa_log(contained_text)
    _link_or_skip(contained_text, explicit_log)

    paths = _targets(
        AnalysisRequest(
            question="Inspect the explicit log.",
            artifacts=[
                ArtifactInput(path=root, kind=ArtifactKind.DIRECTORY),
                ArtifactInput(path=explicit_log, kind=ArtifactKind.FILE),
            ],
        )
    )

    assert paths == [explicit_log.resolve()]


def test_explicit_zip_alias_keeps_its_suffix_when_the_canonical_path_does_not(
    tmp_path: Path,
) -> None:
    canonical = tmp_path / "aaa.bin"
    archive_alias = tmp_path / "zzz.zip"
    canonical.write_bytes(b"archive")
    _link_or_skip(canonical, archive_alias)

    paths = _targets(
        AnalysisRequest(
            question="Inspect the explicit archive.",
            artifacts=[
                ArtifactInput(path=canonical, kind=ArtifactKind.FILE),
                ArtifactInput(path=archive_alias, kind=ArtifactKind.ARCHIVE),
            ],
        )
    )

    assert paths == [archive_alias.resolve()]
    assert paths[0].suffix == ".zip"


def test_directory_named_with_zip_suffix_is_not_treated_as_an_archive(tmp_path: Path) -> None:
    directory = tmp_path / "debug.zip"
    directory.mkdir()

    paths = _targets(
        AnalysisRequest(
            question="Do not inspect an empty directory as an archive.",
            artifacts=[ArtifactInput(path=directory, kind=ArtifactKind.DIRECTORY)],
        )
    )

    assert paths == []
