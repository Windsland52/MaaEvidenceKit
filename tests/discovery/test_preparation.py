from __future__ import annotations

import json
import os
from pathlib import Path

import pytest

from maa_diagnostic_expert.contracts.domain import (
    AnalysisRequest,
    ArtifactInput,
    ArtifactKind,
    ArtifactMediaKind,
    ArtifactRecord,
    Conclusion,
    DiagnosisResult,
    DiagnosisStatus,
    EvidenceQuery,
    EvidenceWindow,
    PreparedAnalysis,
    RevisionResolutionStatus,
    SourceInput,
    SourceRole,
)
from maa_diagnostic_expert.discovery.preparation import prepare_analysis
from maa_diagnostic_expert.inspection.evidence_query import query_evidence
from maa_diagnostic_expert.inspection.models import DeterministicInspection
from maa_diagnostic_expert.interfaces.cli import main


def _available_file_records(prepared: PreparedAnalysis) -> list[ArtifactRecord]:
    return [
        artifact for artifact in prepared.artifacts if artifact.kind is not ArtifactKind.DIRECTORY
    ]


def _link_or_skip(source: Path, target: Path) -> None:
    try:
        os.link(source, target)
    except OSError as error:
        pytest.skip(f"Hard links are unavailable on this filesystem: {error}")


def _symlink_or_skip(source: Path, target: Path) -> None:
    try:
        target.symlink_to(source)
    except OSError as error:
        pytest.skip(f"Symbolic links are unavailable on this filesystem: {error}")


def test_prepare_inventories_only_explicit_artifacts(tmp_path: Path) -> None:
    artifacts = tmp_path / "issue"
    artifacts.mkdir()
    log_path = artifacts / "maa.log"
    log_path.write_text("one\ntwo\nthree\nfour\nfive\n", encoding="utf-8")
    archive_path = artifacts / "debug.zip"
    archive_path.write_bytes(b"not extracted")
    missing_path = tmp_path / "missing.log"

    prepared = prepare_analysis(
        AnalysisRequest(
            question="What failed?",
            artifacts=[
                ArtifactInput(path=artifacts, kind=ArtifactKind.DIRECTORY),
                ArtifactInput(path=missing_path, kind=ArtifactKind.FILE),
            ],
        )
    )

    by_path = {record.path: record for record in prepared.artifacts}
    assert by_path[log_path].media_kind is ArtifactMediaKind.LOG
    assert by_path[archive_path].kind is ArtifactKind.ARCHIVE
    assert {item.code for item in prepared.missing_evidence} == {"artifact_missing"}


def test_prepare_merges_directory_and_explicit_file_independent_of_request_order(
    tmp_path: Path,
) -> None:
    artifacts = tmp_path / "issue"
    artifacts.mkdir()
    log_path = artifacts / "maa.log"
    log_path.write_text("one\n", encoding="utf-8")

    def prepare(inputs: list[ArtifactInput]) -> PreparedAnalysis:
        return prepare_analysis(AnalysisRequest(question="What failed?", artifacts=inputs))

    directory_input = ArtifactInput(path=artifacts, kind=ArtifactKind.DIRECTORY)
    file_input = ArtifactInput(path=log_path, kind=ArtifactKind.FILE)
    first = prepare([directory_input, file_input])
    second = prepare([file_input, directory_input])

    first_log = [record for record in first.artifacts if record.path == log_path][0]
    second_log = [record for record in second.artifacts if record.path == log_path][0]
    assert first_log.id == second_log.id
    assert [record.id for record in first.artifacts] == [record.id for record in second.artifacts]
    assert len(first_log.origins) == 2
    assert {origin.path for origin in first_log.origins} == {artifacts / "maa.log", log_path}


def test_prepare_merges_overlapping_directory_inputs(tmp_path: Path) -> None:
    root = tmp_path / "issue"
    nested = root / "nested"
    nested.mkdir(parents=True)
    log_path = nested / "maa.log"
    log_path.write_text("one\n", encoding="utf-8")

    prepared = prepare_analysis(
        AnalysisRequest(
            question="What failed?",
            artifacts=[
                ArtifactInput(path=root, kind=ArtifactKind.DIRECTORY),
                ArtifactInput(path=nested, kind=ArtifactKind.DIRECTORY),
            ],
        )
    )

    log_records = [record for record in prepared.artifacts if record.path == log_path]
    assert len(log_records) == 1
    assert {origin.input_path for origin in log_records[0].origins} == {root, nested}


def test_prepare_merges_hardlinked_artifacts(tmp_path: Path) -> None:
    original = tmp_path / "original.log"
    alias = tmp_path / "alias.log"
    original.write_text("one\n", encoding="utf-8")
    _link_or_skip(original, alias)

    prepared = prepare_analysis(
        AnalysisRequest(
            question="What failed?",
            artifacts=[
                ArtifactInput(path=original, kind=ArtifactKind.FILE),
                ArtifactInput(path=alias, kind=ArtifactKind.FILE),
            ],
        )
    )

    records = _available_file_records(prepared)
    assert len(records) == 1
    assert {origin.path for origin in records[0].origins} == {original, alias}


def test_prepare_merges_symlinked_artifacts(tmp_path: Path) -> None:
    original = tmp_path / "original.log"
    alias = tmp_path / "alias.log"
    original.write_text("one\n", encoding="utf-8")
    _symlink_or_skip(original, alias)

    prepared = prepare_analysis(
        AnalysisRequest(
            question="What failed?",
            artifacts=[
                ArtifactInput(path=original, kind=ArtifactKind.FILE),
                ArtifactInput(path=alias, kind=ArtifactKind.FILE),
            ],
        )
    )

    records = _available_file_records(prepared)
    assert len(records) == 1
    assert {origin.path for origin in records[0].origins} == {original, alias}


def test_prepare_keeps_same_content_independent_files_distinct(tmp_path: Path) -> None:
    first = tmp_path / "first.log"
    second = tmp_path / "second.log"
    first.write_text("same\n", encoding="utf-8")
    second.write_text("same\n", encoding="utf-8")

    prepared = prepare_analysis(
        AnalysisRequest(
            question="What failed?",
            artifacts=[
                ArtifactInput(path=first, kind=ArtifactKind.FILE),
                ArtifactInput(path=second, kind=ArtifactKind.FILE),
            ],
        )
    )

    assert {record.path for record in _available_file_records(prepared)} == {first, second}


def test_prepare_reports_directory_symlink_that_leaves_artifact_root(tmp_path: Path) -> None:
    root = tmp_path / "issue"
    root.mkdir()
    outside = tmp_path / "outside.log"
    outside.write_text("outside\n", encoding="utf-8")
    _symlink_or_skip(outside, root / "outside.log")

    prepared = prepare_analysis(
        AnalysisRequest(
            question="What failed?",
            artifacts=[ArtifactInput(path=root, kind=ArtifactKind.DIRECTORY)],
        )
    )

    assert "artifact_symlink_outside_root" in {item.code for item in prepared.missing_evidence}
    assert outside not in {record.path for record in prepared.artifacts}


def test_prepare_reports_unresolved_issue_source(tmp_path: Path) -> None:
    prepared = prepare_analysis(
        AnalysisRequest(
            issue="https://github.com/example/project/issues/1",
            sources=[
                SourceInput(
                    source_id="project",
                    role=SourceRole.PROJECT,
                    path=tmp_path,
                    revision="v1.0.0",
                ),
                SourceInput(
                    source_id="maa-framework",
                    role=SourceRole.MAA_FRAMEWORK,
                    path=tmp_path,
                    revision="v5.11.1",
                ),
            ],
        )
    )

    assert {snapshot.source_id for snapshot in prepared.source_snapshots} == {
        "project",
        "maa-framework",
    }
    assert all(
        snapshot.resolution_status is RevisionResolutionStatus.NOT_A_GIT_REPOSITORY
        for snapshot in prepared.source_snapshots
    )
    assert {item.code for item in prepared.missing_evidence} == {
        "diagnostic_artifacts_missing",
        "requested_revision_unresolved",
    }


def test_query_evidence_returns_bounded_authorized_window(tmp_path: Path) -> None:
    artifacts = tmp_path / "issue"
    artifacts.mkdir()
    log_path = artifacts / "maa.log"
    log_path.write_text("one\ntwo\nthree\nfour\nfive\n", encoding="utf-8")
    prepared = prepare_analysis(
        AnalysisRequest(
            question="What failed?",
            artifacts=[ArtifactInput(path=artifacts, kind=ArtifactKind.DIRECTORY)],
        )
    )

    window = query_evidence(
        prepared,
        EvidenceQuery(
            source_path=log_path,
            line_start=2,
            line_end=4,
            reason="Inspect the failure window.",
        ),
    )

    assert window.evidence.content == "two\nthree\nfour"
    assert window.evidence.line_start == 2
    assert window.evidence.line_end == 4
    assert window.has_more_before
    assert window.has_more_after

    outside = tmp_path / "outside.log"
    outside.write_text("secret", encoding="utf-8")
    with pytest.raises(ValueError, match="outside the prepared analysis inputs"):
        query_evidence(
            prepared,
            EvidenceQuery(
                source_path=outside,
                line_start=1,
                line_end=1,
                reason="This path was not supplied.",
            ),
        )


def test_cli_vertical_slice(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    log_path = tmp_path / "maa.log"
    log_path.write_text("start\nTasker.Task.Failed\nend\n", encoding="utf-8")
    request_path = tmp_path / "request.json"
    request_path.write_text(
        AnalysisRequest(
            question="Why did the task fail?",
            artifacts=[ArtifactInput(path=log_path, kind=ArtifactKind.FILE)],
        ).model_dump_json(),
        encoding="utf-8",
    )
    prepared_path = tmp_path / "prepared.json"

    assert main(["prepare", "--request", str(request_path), "--output", str(prepared_path)]) == 0
    prepared = PreparedAnalysis.model_validate_json(prepared_path.read_text(encoding="utf-8"))
    inspection_path = tmp_path / "inspection.json"
    inspection_path.write_text(
        DeterministicInspection(prepared=prepared).model_dump_json(),
        encoding="utf-8",
    )

    query_path = tmp_path / "query.json"
    query_path.write_text(
        EvidenceQuery(
            source_path=log_path,
            line_start=2,
            line_end=2,
            reason="Read the directly observed failure.",
        ).model_dump_json(),
        encoding="utf-8",
    )
    window_path = tmp_path / "window.json"
    assert (
        main(
            [
                "query-evidence",
                "--prepared",
                str(inspection_path),
                "--request",
                str(query_path),
                "--output",
                str(window_path),
            ]
        )
        == 0
    )
    window = EvidenceWindow.model_validate_json(window_path.read_text(encoding="utf-8"))
    result = DiagnosisResult(
        status=DiagnosisStatus.COMPLETE,
        summary="The task failed.",
        evidence=[*prepared.evidence, window.evidence],
        conclusions=[
            Conclusion(
                statement="The task emitted a failure event.",
                evidence_ids=[window.evidence.id],
                confidence=1,
            )
        ],
    )
    result_path = tmp_path / "diagnosis.json"
    result_path.write_text(result.model_dump_json(), encoding="utf-8")

    assert (
        main(
            [
                "validate-result",
                "--input",
                str(result_path),
                "--inspection",
                str(inspection_path),
                "--evidence-window",
                str(window_path),
            ]
        )
        == 0
    )
    output = json.loads(capsys.readouterr().out)
    assert output["status"] == "complete"
