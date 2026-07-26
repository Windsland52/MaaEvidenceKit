from __future__ import annotations

from pydantic import JsonValue, ValidationError

from maa_diagnostic_expert.contracts.domain import MissingEvidence
from maa_diagnostic_expert.contracts.mse import (
    MseCompatibilityStatus,
    MseTaskResolutionResult,
)
from maa_diagnostic_expert.contracts.workflow import IncidentCorrelationDraft

from .models import DeterministicInspection, MseTaskResolutionInspection
from .mse_policy import validate_mse_task_resolution
from .tooling import ToolCaller, ToolInvocationError

_MAX_FOCUSED_TASKS = 20


def _focused_task_names(
    inspection: DeterministicInspection,
    correlation: IncidentCorrelationDraft,
) -> list[str]:
    candidates = {
        candidate.candidate_id: candidate for candidate in inspection.incident_selection.candidates
    }
    names: list[str] = []
    for candidate_id in correlation.relevant_candidate_ids:
        candidate = candidates.get(candidate_id)
        if candidate is None:
            continue
        for name in (candidate.node_name, candidate.task_name):
            if name and name not in names:
                names.append(name)
                if len(names) >= _MAX_FOCUSED_TASKS:
                    return names
    return names


def resolve_incident_pipeline_tasks(
    inspection: DeterministicInspection,
    correlation: IncidentCorrelationDraft,
    tool_caller: ToolCaller,
) -> DeterministicInspection:
    """Resolve only pipeline tasks named by model-correlated deterministic candidates."""
    if not inspection.mse_project_inspections:
        return inspection

    task_names = _focused_task_names(inspection, correlation)
    missing = list(inspection.prepared.missing_evidence)
    if not task_names:
        missing.append(
            MissingEvidence(
                code="mse_focused_task_unavailable",
                message=(
                    "Relevant incident candidates did not identify a MaaFramework task "
                    "or pipeline node for focused source inspection."
                ),
            )
        )
        return inspection.model_copy(
            update={
                "prepared": inspection.prepared.model_copy(update={"missing_evidence": missing})
            }
        )

    resolutions: list[MseTaskResolutionInspection] = []
    for project in inspection.mse_project_inspections:
        project_status = project.preflight.compatibility.status
        if project_status is MseCompatibilityStatus.UNSUPPORTED:
            continue
        try:
            arguments: dict[str, JsonValue] = {
                "path": str(project.path),
                "tasks": list[JsonValue](task_names),
                "syntax_mode": project.preflight.syntax_mode.value,
            }
            raw_result = tool_caller.call(
                "mse.resolve-tasks",
                arguments,
            )
            result = MseTaskResolutionResult.model_validate(raw_result)
            validate_mse_task_resolution(result, project.preflight.syntax_mode)
        except (ToolInvocationError, ValidationError, ValueError) as error:
            missing.append(
                MissingEvidence(
                    code="mse_task_resolution_failed",
                    message=str(error),
                    source_id=project.source_id,
                    source_path=project.path,
                )
            )
            continue
        if (
            project_status is MseCompatibilityStatus.PARTIAL
            and result.compatibility.status is MseCompatibilityStatus.SUPPORTED
        ):
            result = result.model_copy(
                update={
                    "compatibility": result.compatibility.model_copy(
                        update={
                            "status": MseCompatibilityStatus.PARTIAL,
                            "reason": (
                                "MSE project preflight was incomplete: "
                                f"{project.preflight.compatibility.reason}"
                            ),
                        }
                    )
                }
            )
        resolutions.append(
            MseTaskResolutionInspection(
                source_id=project.source_id,
                path=project.path,
                resolution=result,
            )
        )
        if result.compatibility.status is MseCompatibilityStatus.UNSUPPORTED:
            missing.append(
                MissingEvidence(
                    code="mse_task_resolution_unsupported",
                    message=result.compatibility.reason,
                    source_id=project.source_id,
                    source_path=project.path,
                )
            )
        elif result.compatibility.status is MseCompatibilityStatus.PARTIAL:
            missing.append(
                MissingEvidence(
                    code="mse_task_resolution_incomplete",
                    message=result.compatibility.reason,
                    source_id=project.source_id,
                    source_path=project.path,
                )
            )
        if result.compatibility.status is not MseCompatibilityStatus.SUPPORTED:
            continue
        missing_tasks = [
            name
            for name in result.requested_tasks
            if not any(item.name == name and item.found for item in result.resolutions)
        ]
        if missing_tasks:
            missing.append(
                MissingEvidence(
                    code="mse_tasks_not_found",
                    message=("MSE did not find focused task(s): " + ", ".join(missing_tasks)),
                    source_id=project.source_id,
                    source_path=project.path,
                    required=False,
                )
            )

    return inspection.model_copy(
        update={
            "prepared": inspection.prepared.model_copy(update={"missing_evidence": missing}),
            "mse_task_resolutions": resolutions,
        }
    )
