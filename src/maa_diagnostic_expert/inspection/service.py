from __future__ import annotations

from pydantic import ValidationError

from maa_diagnostic_expert.contracts.domain import (
    AnalysisRequest,
    MissingEvidence,
    PreparedAnalysis,
    SourceRole,
)
from maa_diagnostic_expert.contracts.mla import (
    MlaCompatibilityStatus,
    MlaPreflightResult,
    MlaRuntimeInspectionResult,
)
from maa_diagnostic_expert.contracts.mse import (
    MseCompatibilityStatus,
    MseProjectPreflightResult,
)
from maa_diagnostic_expert.contracts.workflow import (
    ArtifactSourceInventory,
)
from maa_diagnostic_expert.discovery.artifact_classification import classify_artifact_sources
from maa_diagnostic_expert.discovery.inputs import find_maa_interface
from maa_diagnostic_expert.discovery.preparation import prepare_analysis
from maa_diagnostic_expert.discovery.source_preparation import (
    source_snapshot_matches_checkout,
)

from .artifact_targets import (
    mla_artifact_target_is_current,
    select_mla_artifact_targets,
)
from .evidence_synthesis import synthesize_evidence
from .incident_candidates import generate_incident_selection
from .log_overview import (
    LogOverviewCollection,
    build_log_overviews,
    collect_log_overview_missing_evidence,
    synthesize_log_overview_evidence,
)
from .models import (
    DeterministicInspection,
    MlaArtifactInspection,
    MlaRuntimeInspectionArtifact,
    MseProjectInspection,
)
from .mse_preflight import synthesize_mse_evidence, synthesize_mse_task_evidence
from .runtime_identity import extract_runtime_identity, synthesize_runtime_identity_evidence
from .source_guidance import synthesize_source_guidance_evidence
from .source_search import (
    synthesize_knowledge_search_evidence,
    synthesize_source_search_evidence,
)
from .time_ranges import collect_time_range_missing_evidence
from .tooling import ToolCaller, ToolInvocationError


def inspect_analysis(
    request: AnalysisRequest,
    tool_caller: ToolCaller,
) -> DeterministicInspection:
    prepared = prepare_analysis(request)
    inventory = classify_artifact_sources(prepared)
    overviews = build_log_overviews(prepared, inventory)
    inspection = inspect_prepared_analysis(prepared, tool_caller, overviews, inventory)
    inspection = attach_runtime_identity(inspection)
    inspection = synthesize_inspection_evidence(inspection)
    return attach_incident_selection(inspection)


def inspect_prepared_analysis(
    prepared: PreparedAnalysis,
    tool_caller: ToolCaller,
    log_overviews: LogOverviewCollection | None = None,
    artifact_sources: ArtifactSourceInventory | None = None,
) -> DeterministicInspection:
    """Run deterministic tools against an already prepared analysis."""
    preflights: list[MlaArtifactInspection] = []
    runtime_inspections: list[MlaRuntimeInspectionArtifact] = []
    mse_inspections: list[MseProjectInspection] = []
    missing = [
        *prepared.missing_evidence,
        *collect_log_overview_missing_evidence(log_overviews or LogOverviewCollection()),
    ]
    source_inventory = artifact_sources or classify_artifact_sources(prepared)
    artifacts_by_id = {artifact.id: artifact for artifact in prepared.artifacts}

    for target in select_mla_artifact_targets(prepared, source_inventory):
        artifact = artifacts_by_id.get(target.artifact_id)
        if artifact is None or not mla_artifact_target_is_current(target, artifact):
            missing.append(
                MissingEvidence(
                    code="artifact_origin_changed",
                    message=(
                        "The selected MLA path no longer identifies the physical artifact "
                        "recorded during preparation."
                    ),
                    source_path=target.path,
                )
            )
            continue
        try:
            raw_result = tool_caller.call("mla.preflight", {"path": str(target.path)})
            preflight = MlaPreflightResult.model_validate(raw_result)
        except (ToolInvocationError, ValidationError, ValueError) as error:
            missing.append(
                MissingEvidence(
                    code="mla_preflight_failed",
                    message=str(error),
                    source_path=target.path,
                )
            )
            continue
        preflights.append(
            MlaArtifactInspection(
                artifact_id=target.artifact_id,
                path=target.path,
                preflight=preflight,
            )
        )
        if preflight.compatibility.status is not MlaCompatibilityStatus.SUPPORTED:
            missing.append(
                MissingEvidence(
                    code="mla_log_unsupported",
                    message=(
                        f"MaaLogAnalyzer cannot inspect this log: {preflight.compatibility.reason}."
                    ),
                    source_path=target.path,
                )
            )
            continue
        try:
            raw_runtime = tool_caller.call(
                "mla.runtime-inspection",
                {"path": str(target.path)},
            )
            runtime = MlaRuntimeInspectionResult.model_validate(raw_runtime)
        except (ToolInvocationError, ValidationError, ValueError) as error:
            missing.append(
                MissingEvidence(
                    code="mla_runtime_inspection_failed",
                    message=str(error),
                    source_path=target.path,
                )
            )
            continue
        runtime_inspections.append(
            MlaRuntimeInspectionArtifact(
                artifact_id=target.artifact_id,
                path=target.path,
                inspection=runtime,
            )
        )

    for snapshot in prepared.source_snapshots:
        if snapshot.role is not SourceRole.PROJECT:
            continue
        if not source_snapshot_matches_checkout(
            snapshot,
            require_requested_revision=prepared.request.issue is not None,
        ):
            continue
        if find_maa_interface(snapshot.path) is None:
            continue
        try:
            raw_mse = tool_caller.call("mse.project-preflight", {"path": str(snapshot.path)})
            mse_preflight = MseProjectPreflightResult.model_validate(raw_mse)
        except (ToolInvocationError, ValidationError, ValueError) as error:
            missing.append(
                MissingEvidence(
                    code="mse_project_preflight_failed",
                    message=str(error),
                    source_id=snapshot.source_id,
                    source_path=snapshot.path,
                )
            )
            continue
        mse_inspections.append(
            MseProjectInspection(
                source_id=snapshot.source_id,
                path=snapshot.path,
                preflight=mse_preflight,
            )
        )
        if mse_preflight.compatibility.status is MseCompatibilityStatus.UNSUPPORTED:
            missing.append(
                MissingEvidence(
                    code="mse_project_unsupported",
                    message=mse_preflight.compatibility.reason,
                    source_id=snapshot.source_id,
                    source_path=snapshot.path,
                )
            )
        elif mse_preflight.compatibility.status is MseCompatibilityStatus.PARTIAL:
            missing.append(
                MissingEvidence(
                    code="mse_project_incomplete",
                    message=mse_preflight.compatibility.reason,
                    source_id=snapshot.source_id,
                    source_path=snapshot.path,
                )
            )

    missing.extend(
        collect_time_range_missing_evidence(
            log_overviews or LogOverviewCollection(),
            preflights,
        )
    )
    prepared_with_tools = prepared.model_copy(update={"missing_evidence": missing})
    return DeterministicInspection(
        prepared=prepared_with_tools,
        log_overviews=log_overviews or LogOverviewCollection(),
        mla_preflights=preflights,
        mla_runtime_inspections=runtime_inspections,
        mse_project_inspections=mse_inspections,
    )


def synthesize_inspection_evidence(
    inspection: DeterministicInspection,
) -> DeterministicInspection:
    """Attach project-owned evidence records derived from deterministic facts."""
    evidence = [
        *synthesize_runtime_identity_evidence(inspection.runtime_identity),
        *synthesize_log_overview_evidence(inspection.log_overviews),
        *synthesize_evidence(inspection.mla_runtime_inspections),
        *synthesize_mse_evidence(inspection.mse_project_inspections),
        *synthesize_mse_task_evidence(inspection.mse_task_resolutions),
        *synthesize_source_guidance_evidence(inspection.source_guidance_inspections),
        *synthesize_source_search_evidence(inspection.source_search_matches),
        *synthesize_knowledge_search_evidence(inspection.knowledge_search_matches),
    ]
    return inspection.model_copy(update={"synthesized_evidence": evidence})


def attach_runtime_identity(inspection: DeterministicInspection) -> DeterministicInspection:
    identity = extract_runtime_identity(inspection.mla_preflights)
    return inspection.model_copy(update={"runtime_identity": identity})


def attach_incident_selection(inspection: DeterministicInspection) -> DeterministicInspection:
    selection = generate_incident_selection(inspection)
    return inspection.model_copy(update={"incident_selection": selection})
