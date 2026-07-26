import json
from pathlib import Path

import pytest
from pydantic import ValidationError

from maa_diagnostic_expert.contracts.domain import (
    AnalysisRequest,
    Conclusion,
    DiagnosisDraft,
    DiagnosisResult,
    DiagnosisStatus,
    Evidence,
    EvidenceReliability,
    EvidenceRole,
    SourceInput,
    SourceRole,
)
from maa_diagnostic_expert.discovery.inputs import resolve_project_root


def test_request_requires_a_source_or_question() -> None:
    with pytest.raises(ValidationError):
        AnalysisRequest()


def test_request_rejects_duplicate_source_ids(tmp_path: Path) -> None:
    duplicate_sources = [
        SourceInput(
            source_id="runtime",
            role=SourceRole.PROJECT,
            path=tmp_path,
        ),
        SourceInput(
            source_id="runtime",
            role=SourceRole.MAA_FRAMEWORK,
            path=tmp_path,
        ),
    ]

    with pytest.raises(ValidationError, match="Source IDs must be unique"):
        AnalysisRequest(
            question="Which source revision applies?",
            sources=duplicate_sources,
        )


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
        role=EvidenceRole.CONTEXT,
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
    assert evidence.role is EvidenceRole.CONTEXT

    with pytest.raises(ValidationError):
        DiagnosisResult(
            status=DiagnosisStatus.COMPLETE,
            summary="Invalid evidence reference.",
            conclusions=[
                Conclusion(statement="Unsupported.", evidence_ids=["ev:missing"], confidence=1),
            ],
        )


def test_failure_evidence_requires_primary_reliability() -> None:
    with pytest.raises(ValidationError, match="primary reliability"):
        Evidence(
            id="ev:failure",
            kind="runtime_failure",
            source_component="mla:runtime-inspection",
            source_path="maafw.log",
            content="Task failed.",
            role=EvidenceRole.FAILURE,
            reliability=EvidenceReliability.SECONDARY,
        )


def test_complete_diagnosis_draft_requires_a_conclusion() -> None:
    with pytest.raises(ValidationError, match="at least one conclusion"):
        DiagnosisDraft(
            status=DiagnosisStatus.COMPLETE,
            summary="No conclusion was produced.",
        )


def test_complete_diagnosis_result_requires_an_evidence_backed_conclusion() -> None:
    with pytest.raises(ValidationError, match="evidence-backed conclusion"):
        DiagnosisResult(
            status=DiagnosisStatus.COMPLETE,
            summary="No conclusion was produced.",
        )


def test_non_complete_diagnoses_may_have_no_conclusions() -> None:
    draft = DiagnosisDraft(
        status=DiagnosisStatus.INSUFFICIENT_EVIDENCE,
        summary="More runtime evidence is required.",
    )
    result = DiagnosisResult(
        status=DiagnosisStatus.INSUFFICIENT_EVIDENCE,
        summary="More runtime evidence is required.",
    )

    assert draft.conclusions == []
    assert result.conclusions == []


@pytest.mark.parametrize(
    ("kind", "expected_role"),
    [
        ("runtime_failure", EvidenceRole.FAILURE),
        ("runtime_outcome", EvidenceRole.FAILURE),
        ("mse_static_diagnostic", EvidenceRole.SIGNAL),
        ("log_occurrence:warning", EvidenceRole.SIGNAL),
        ("runtime_version", EvidenceRole.CONTEXT),
        ("knowledge_document_match", EvidenceRole.CONTEXT),
    ],
)
def test_known_legacy_evidence_json_infers_role(kind: str, expected_role: EvidenceRole) -> None:
    serialized = json.dumps(
        {
            "id": "ev:legacy",
            "kind": kind,
            "source_component": "legacy",
            "source_path": "maafw.log",
            "content": "Legacy evidence without an explicit diagnostic role.",
            "reliability": "primary",
        }
    )

    evidence = Evidence.model_validate_json(serialized)

    assert evidence.role is expected_role
    assert evidence.model_dump(mode="json")["role"] == expected_role.value


def test_unknown_legacy_evidence_requires_explicit_role() -> None:
    with pytest.raises(ValidationError, match="role"):
        Evidence.model_validate(
            {
                "id": "ev:custom",
                "kind": "custom_observation",
                "source_component": "external",
                "source_path": "observation.json",
                "content": "An extension-defined observation.",
            }
        )


def test_diagnosis_result_rejects_duplicate_evidence_ids() -> None:
    evidence = Evidence(
        id="ev:duplicate",
        kind="log_line",
        source_component="maa-framework",
        source_path="maafw.log",
        content="first",
        role=EvidenceRole.CONTEXT,
    )

    with pytest.raises(ValidationError, match="Evidence IDs must be unique"):
        DiagnosisResult(
            status=DiagnosisStatus.COMPLETE,
            summary="Duplicate evidence.",
            evidence=[evidence, evidence.model_copy(update={"content": "second"})],
        )
