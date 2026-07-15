from pathlib import Path

import pytest
from pydantic import ValidationError

from maa_diagnostic_expert.domain import (
    AnalysisRequest,
    Conclusion,
    DiagnosisResult,
    DiagnosisStatus,
    Evidence,
)
from maa_diagnostic_expert.inputs import resolve_project_root


def test_request_requires_a_source_or_question() -> None:
    with pytest.raises(ValidationError):
        AnalysisRequest()


def test_cwd_is_used_only_for_a_maa_project(tmp_path: Path) -> None:
    assert resolve_project_root(None, cwd=tmp_path) is None

    assets = tmp_path / "assets"
    assets.mkdir()
    (assets / "interface.json").write_text("{}", encoding="utf-8")

    assert resolve_project_root(None, cwd=tmp_path) == tmp_path.resolve()


def test_conclusions_must_reference_known_evidence() -> None:
    evidence = Evidence(
        id="ev:1",
        kind="log_line",
        source_component="maa-framework",
        source_path="maafw.log",
        line_start=10,
        line_end=12,
        content="Tasker.Task.Failed",
    )
    result = DiagnosisResult(
        status=DiagnosisStatus.COMPLETE,
        summary="The task failed.",
        evidence=[evidence],
        conclusions=[
            Conclusion(statement="The task failed.", evidence_ids=["ev:1"], confidence=1),
        ],
    )
    assert result.api_version == "diagnosis/v2"

    with pytest.raises(ValidationError):
        DiagnosisResult(
            status=DiagnosisStatus.COMPLETE,
            summary="Invalid evidence reference.",
            conclusions=[
                Conclusion(statement="Unsupported.", evidence_ids=["ev:missing"], confidence=1),
            ],
        )
