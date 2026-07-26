from pathlib import Path

from maa_diagnostic_expert.contracts.domain import AnalysisRequest, PreparedAnalysis
from maa_diagnostic_expert.contracts.mla import MlaRuntimeInspectionResult
from maa_diagnostic_expert.contracts.mse import (
    MseCompatibility,
    MseCompatibilityStatus,
    MseResolvedTask,
    MseTaskDefinition,
    MseTaskResolutionResult,
)
from maa_diagnostic_expert.contracts.workflow import (
    IncidentCandidate,
    IncidentComparisonFindingKind,
    IncidentComparisonStatus,
    IncidentCorrelationDraft,
    IncidentSelection,
    IncidentSelectionStatus,
)
from maa_diagnostic_expert.inspection.evidence_synthesis import synthesize_evidence
from maa_diagnostic_expert.inspection.incident_comparison import (
    compare_incident_execution,
)
from maa_diagnostic_expert.inspection.models import (
    DeterministicInspection,
    MlaRuntimeInspectionArtifact,
    MseTaskResolutionInspection,
)
from maa_diagnostic_expert.inspection.mse_preflight import (
    synthesize_mse_task_evidence,
)


def _runtime() -> MlaRuntimeInspectionArtifact:
    return MlaRuntimeInspectionArtifact(
        artifact_id="artifact-1",
        path=Path("C:/logs/maafw.log"),
        inspection=MlaRuntimeInspectionResult.model_validate(
            {
                "schema_version": "mla-runtime-inspection/v1",
                "sessions": [],
                "unscoped_tasks": [],
                "failures": [
                    {
                        "session_id": "session-1",
                        "execution_id": "exec-1",
                        "task_id": 7,
                        "task_name": "LoginTask",
                        "failure_id": "failure-1",
                        "kind": "next_list_timeout",
                        "node_id": 12,
                        "node_name": "LoginButton",
                        "started_at": "2026-07-21 10:00:00.000",
                        "ended_at": "2026-07-21 10:00:05.000",
                        "error_images": [],
                        "vision_images": [],
                        "evidence": {
                            "source": "file:C:/logs/maafw.log",
                            "path": "C:/logs/maafw.log",
                            "local_line": 100,
                            "timestamp": "2026-07-21 10:00:05.000",
                        },
                    }
                ],
                "outcomes": [],
                "signals": [],
                "warnings": [],
            }
        ),
    )


def _mse_resolution(
    *,
    status: MseCompatibilityStatus = MseCompatibilityStatus.SUPPORTED,
    login_button_found: bool = True,
) -> MseTaskResolutionInspection:
    definitions = [
        MseTaskDefinition(
            source_path="assets/pipeline/login.json",
            line=12,
            column=3,
            raw_config={"recognition": "OCR"},
        )
    ]
    return MseTaskResolutionInspection(
        source_id="project",
        path=Path("C:/project"),
        resolution=MseTaskResolutionResult(
            project_root=Path("C:/project"),
            interface_path="assets/interface.json",
            compatibility=MseCompatibility(
                status=status,
                reason="Resolved.",
            ),
            requested_tasks=["LoginButton", "LoginTask"],
            resolutions=[
                MseResolvedTask(
                    name="LoginButton",
                    controller="Adb",
                    resource="Official",
                    found=login_button_found,
                    definitions=definitions if login_button_found else [],
                    effective_config={
                        "recognition": "OCR",
                        "expected": ["Login"],
                    }
                    if login_button_found
                    else {},
                ),
                MseResolvedTask(
                    name="LoginTask",
                    controller="Adb",
                    resource="Official",
                    found=False,
                ),
            ],
        ),
    )


def _candidate() -> IncidentCandidate:
    return IncidentCandidate(
        candidate_id="incident:1",
        session_id="session-1",
        task_id=7,
        task_name="LoginTask",
        node_name="LoginButton",
        confidence=0.95,
        evidence_ids=["mla-ri:artifact-1:failure:failure-1"],
        reasons=["Direct failure"],
    )


def _correlation() -> IncidentCorrelationDraft:
    return IncidentCorrelationDraft(
        status=IncidentSelectionStatus.SELECTED,
        selected_candidate_id="incident:1",
        relevant_candidate_ids=["incident:1"],
        evidence_ids=["mla-ri:artifact-1:failure:failure-1"],
        rationale="The report identifies the same task.",
    )


def _inspection(
    *,
    include_mse: bool,
    mse_status: MseCompatibilityStatus = MseCompatibilityStatus.SUPPORTED,
    login_button_found: bool = True,
) -> DeterministicInspection:
    runtime = _runtime()
    resolutions = (
        [_mse_resolution(status=mse_status, login_button_found=login_button_found)]
        if include_mse
        else []
    )
    evidence = [
        *synthesize_evidence([runtime]),
        *synthesize_mse_task_evidence(resolutions),
    ]
    return DeterministicInspection(
        prepared=PreparedAnalysis(request=AnalysisRequest(question="Diagnose login timeout.")),
        incident_selection=IncidentSelection(
            status=IncidentSelectionStatus.AMBIGUOUS,
            candidates=[_candidate()],
        ),
        mla_runtime_inspections=[runtime],
        mse_task_resolutions=resolutions,
        synthesized_evidence=evidence,
    )


def test_compare_incident_execution_links_runtime_and_expected_facts() -> None:
    inspection = compare_incident_execution(
        _inspection(include_mse=True),
        _correlation(),
    )

    comparison = inspection.incident_comparison
    assert comparison.status is IncidentComparisonStatus.COMPLETE
    assert comparison.observed_executions[0].failure_kinds == ["next_list_timeout"]
    expected = comparison.expected_tasks[0]
    assert expected.task_name == "LoginButton"
    assert expected.recognition_types == ["OCR"]
    assert expected.found_variants == 1
    missing_expected = next(
        item for item in comparison.expected_tasks if item.task_name == "LoginTask"
    )
    assert missing_expected.found_variants == 0
    assert missing_expected.evidence_ids
    assert {finding.kind for finding in comparison.findings} == {
        IncidentComparisonFindingKind.ACTUAL_AND_EXPECTED_AVAILABLE,
        IncidentComparisonFindingKind.NEXT_LIST_TIMEOUT_AT_RESOLVED_NODE,
    }
    assert all(finding.observed_evidence_ids for finding in comparison.findings)
    assert all(finding.expected_evidence_ids for finding in comparison.findings)


def test_compare_incident_execution_remains_partial_without_mse() -> None:
    inspection = compare_incident_execution(
        _inspection(include_mse=False),
        _correlation(),
    )

    comparison = inspection.incident_comparison
    assert comparison.status is IncidentComparisonStatus.PARTIAL
    assert comparison.expected_tasks == []
    assert comparison.findings[0].kind is (IncidentComparisonFindingKind.ACTUAL_EXECUTION_ONLY)
    assert [item.code for item in comparison.missing_evidence] == [
        "expected_configuration_unavailable"
    ]


def test_compare_incident_execution_does_not_report_not_found_from_partial_mse() -> None:
    inspection = compare_incident_execution(
        _inspection(
            include_mse=True,
            mse_status=MseCompatibilityStatus.PARTIAL,
            login_button_found=False,
        ),
        _correlation(),
    )

    comparison = inspection.incident_comparison
    assert comparison.status is IncidentComparisonStatus.PARTIAL
    assert comparison.expected_tasks == []
    assert IncidentComparisonFindingKind.EXPECTED_TASK_NOT_FOUND not in {
        finding.kind for finding in comparison.findings
    }
    assert comparison.findings[0].kind is IncidentComparisonFindingKind.ACTUAL_EXECUTION_ONLY
    assert [item.code for item in comparison.missing_evidence] == [
        "expected_configuration_unavailable"
    ]


def test_compare_incident_execution_reports_not_found_from_supported_mse() -> None:
    inspection = compare_incident_execution(
        _inspection(
            include_mse=True,
            login_button_found=False,
        ),
        _correlation(),
    )

    comparison = inspection.incident_comparison
    assert comparison.status is IncidentComparisonStatus.PARTIAL
    assert IncidentComparisonFindingKind.EXPECTED_TASK_NOT_FOUND in {
        finding.kind for finding in comparison.findings
    }
    assert [item.code for item in comparison.missing_evidence] == [
        "expected_pipeline_definition_not_found"
    ]


def test_compare_incident_execution_keeps_found_variant_from_partial_mse() -> None:
    inspection = compare_incident_execution(
        _inspection(
            include_mse=True,
            mse_status=MseCompatibilityStatus.PARTIAL,
            login_button_found=True,
        ),
        _correlation(),
    )

    comparison = inspection.incident_comparison
    assert comparison.status is IncidentComparisonStatus.COMPLETE
    assert [item.task_name for item in comparison.expected_tasks] == ["LoginButton"]
    assert comparison.expected_tasks[0].found_variants == 1
    assert IncidentComparisonFindingKind.ACTUAL_AND_EXPECTED_AVAILABLE in {
        finding.kind for finding in comparison.findings
    }
    assert IncidentComparisonFindingKind.EXPECTED_TASK_NOT_FOUND not in {
        finding.kind for finding in comparison.findings
    }
