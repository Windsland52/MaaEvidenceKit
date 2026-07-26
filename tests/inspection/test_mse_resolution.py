from pathlib import Path

from pydantic import JsonValue

from maa_diagnostic_expert.contracts.domain import (
    AnalysisRequest,
    EvidenceReliability,
    PreparedAnalysis,
)
from maa_diagnostic_expert.contracts.mse import (
    MseCompatibility,
    MseCompatibilityStatus,
    MseProjectPreflightResult,
)
from maa_diagnostic_expert.contracts.workflow import (
    IncidentCandidate,
    IncidentCorrelationDraft,
    IncidentSelection,
    IncidentSelectionStatus,
)
from maa_diagnostic_expert.inspection.models import (
    DeterministicInspection,
    MseProjectInspection,
)
from maa_diagnostic_expert.inspection.mse_resolution import (
    resolve_incident_pipeline_tasks,
)
from maa_diagnostic_expert.inspection.service import synthesize_inspection_evidence


class _ResolutionCaller:
    def __init__(
        self,
        *,
        status: str = "supported",
        reason: str = "Tasks resolved.",
    ) -> None:
        self.calls: list[tuple[str, dict[str, JsonValue]]] = []
        self._status = status
        self._reason = reason

    def call(self, name: str, arguments: dict[str, JsonValue]) -> dict[str, JsonValue]:
        self.calls.append((name, arguments))
        return {
            "schema_version": "mde-mse-task-resolution/v1",
            "project_root": "C:/project",
            "interface_path": "assets/interface.json",
            "compatibility": {
                "status": self._status,
                "reason": self._reason,
            },
            "requested_tasks": ["LoginButton", "LoginTask"],
            "resolutions": [
                {
                    "name": "LoginButton",
                    "controller": "Adb",
                    "resource": "Official",
                    "found": True,
                    "definitions": [
                        {
                            "source_path": "assets/pipeline/login.json",
                            "line": 12,
                            "column": 3,
                            "raw_config": {"recognition": "OCR"},
                        }
                    ],
                    "effective_config": {
                        "recognition": "OCR",
                        "expected": ["Login"],
                    },
                    "references": [
                        {
                            "kind": "task.next",
                            "target": "Home",
                            "source_path": "assets/pipeline/login.json",
                            "line": 16,
                            "column": 5,
                        }
                    ],
                },
                {
                    "name": "LoginTask",
                    "controller": "Adb",
                    "resource": "Official",
                    "found": False,
                    "definitions": [],
                    "effective_config": {},
                    "references": [],
                },
            ],
            "configurations_truncated": False,
            "warnings": [],
        }


def _inspection(
    project: Path,
    *,
    with_names: bool = True,
    project_status: MseCompatibilityStatus = MseCompatibilityStatus.SUPPORTED,
) -> DeterministicInspection:
    candidate = IncidentCandidate(
        candidate_id="incident:1",
        task_name="LoginTask" if with_names else None,
        node_name="LoginButton" if with_names else None,
        confidence=0.95,
        evidence_ids=["runtime:failure:1"],
        reasons=["Direct failure"],
    )
    return DeterministicInspection(
        prepared=PreparedAnalysis(request=AnalysisRequest(question="Inspect the failure.")),
        incident_selection=IncidentSelection(
            status=IncidentSelectionStatus.AMBIGUOUS,
            candidates=[candidate],
        ),
        mse_project_inspections=[
            MseProjectInspection(
                source_id="project",
                path=project,
                preflight=MseProjectPreflightResult(
                    project_root=project,
                    interface_path="assets/interface.json",
                    syntax_mode="maafw",
                    compatibility=MseCompatibility(
                        status=project_status,
                        reason="Loaded."
                        if project_status is MseCompatibilityStatus.SUPPORTED
                        else "A configured resource path could not be read.",
                    ),
                ),
            )
        ],
    )


def _correlation() -> IncidentCorrelationDraft:
    return IncidentCorrelationDraft(
        status=IncidentSelectionStatus.SELECTED,
        selected_candidate_id="incident:1",
        relevant_candidate_ids=["incident:1"],
        evidence_ids=["runtime:failure:1"],
        rationale="The report matches the failure.",
    )


def test_resolve_incident_pipeline_tasks_prefers_node_then_task(tmp_path: Path) -> None:
    caller = _ResolutionCaller()

    inspection = resolve_incident_pipeline_tasks(
        _inspection(tmp_path),
        _correlation(),
        caller,
    )
    inspection = synthesize_inspection_evidence(inspection)

    assert caller.calls == [
        (
            "mse.resolve-tasks",
            {
                "path": str(tmp_path),
                "tasks": ["LoginButton", "LoginTask"],
            },
        )
    ]
    assert len(inspection.mse_task_resolutions) == 1
    task_evidence = [
        item for item in inspection.synthesized_evidence if item.kind == "mse_task_resolution"
    ]
    assert len(task_evidence) == 1
    assert task_evidence[0].line_start == 12
    assert task_evidence[0].reliability is EvidenceReliability.SECONDARY
    assert "expected" in task_evidence[0].content
    assert "mse_tasks_not_found" in {item.code for item in inspection.prepared.missing_evidence}
    not_found = [
        item for item in inspection.synthesized_evidence if item.kind == "mse_task_not_found"
    ]
    assert len(not_found) == 1
    assert not_found[0].reliability is EvidenceReliability.CONTEXT


def test_resolve_incident_pipeline_tasks_records_missing_names(tmp_path: Path) -> None:
    caller = _ResolutionCaller()

    inspection = resolve_incident_pipeline_tasks(
        _inspection(tmp_path, with_names=False),
        _correlation(),
        caller,
    )

    assert caller.calls == []
    assert "mse_focused_task_unavailable" in {
        item.code for item in inspection.prepared.missing_evidence
    }


def test_resolve_incident_pipeline_tasks_records_partial_without_not_found_evidence(
    tmp_path: Path,
) -> None:
    caller = _ResolutionCaller(
        status="partial",
        reason="A resource used by the focused task could not be read.",
    )

    inspection = resolve_incident_pipeline_tasks(
        _inspection(tmp_path),
        _correlation(),
        caller,
    )
    inspection = synthesize_inspection_evidence(inspection)

    missing_by_code = {item.code: item for item in inspection.prepared.missing_evidence}
    assert missing_by_code["mse_task_resolution_incomplete"].required is True
    assert "mse_tasks_not_found" not in missing_by_code
    assert any(item.kind == "mse_task_resolution" for item in inspection.synthesized_evidence)
    assert not any(item.kind == "mse_task_not_found" for item in inspection.synthesized_evidence)


def test_resolve_incident_pipeline_tasks_requires_supported_project_for_not_found(
    tmp_path: Path,
) -> None:
    caller = _ResolutionCaller()

    inspection = resolve_incident_pipeline_tasks(
        _inspection(tmp_path, project_status=MseCompatibilityStatus.PARTIAL),
        _correlation(),
        caller,
    )
    inspection = synthesize_inspection_evidence(inspection)

    [resolution] = inspection.mse_task_resolutions
    assert resolution.resolution.compatibility.status is MseCompatibilityStatus.PARTIAL
    assert "preflight was incomplete" in resolution.resolution.compatibility.reason
    missing_by_code = {item.code: item for item in inspection.prepared.missing_evidence}
    assert missing_by_code["mse_task_resolution_incomplete"].required is True
    assert "mse_tasks_not_found" not in missing_by_code
    assert any(item.kind == "mse_task_resolution" for item in inspection.synthesized_evidence)
    assert not any(item.kind == "mse_task_not_found" for item in inspection.synthesized_evidence)
