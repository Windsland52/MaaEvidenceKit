from __future__ import annotations

import json
from pathlib import Path

import pytest

from maa_diagnostic_expert.cli import main
from maa_diagnostic_expert.domain import (
    AnalysisRequest,
    ArtifactInput,
    ArtifactKind,
    ArtifactMediaKind,
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
from maa_diagnostic_expert.evidence_query import query_evidence
from maa_diagnostic_expert.inspection import DeterministicInspection
from maa_diagnostic_expert.preparation import prepare_analysis


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
