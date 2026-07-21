from __future__ import annotations

from pathlib import Path

from pydantic import ValidationError

from maa_diagnostic_expert.contracts.domain import (
    AnalysisRequest,
    ArtifactAvailability,
    ArtifactKind,
    ArtifactMediaKind,
    ArtifactRecord,
    MissingEvidence,
    PreparedAnalysis,
)
from maa_diagnostic_expert.contracts.mla import (
    MlaCompatibilityStatus,
    MlaPreflightResult,
    MlaRuntimeInspectionResult,
)
from maa_diagnostic_expert.contracts.workflow import (
    ArtifactSourceInventory,
    ArtifactSourceKind,
)
from maa_diagnostic_expert.discovery.artifact_classification import classify_artifact_sources
from maa_diagnostic_expert.discovery.preparation import prepare_analysis

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
)
from .runtime_identity import extract_runtime_identity, synthesize_runtime_identity_evidence
from .tooling import ToolCaller, ToolInvocationError


def _is_mla_target(artifact: ArtifactRecord, maa_input_paths: set[Path]) -> bool:
    if artifact.availability is not ArtifactAvailability.AVAILABLE:
        return False
    if artifact.path != artifact.input_path:
        return False
    if artifact.kind is ArtifactKind.DIRECTORY:
        return artifact.path in maa_input_paths
    if artifact.media_kind is ArtifactMediaKind.LOG:
        return artifact.path in maa_input_paths
    return (
        artifact.media_kind is ArtifactMediaKind.ARCHIVE and artifact.path.suffix.lower() == ".zip"
    )


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
    missing = [
        *prepared.missing_evidence,
        *collect_log_overview_missing_evidence(log_overviews or LogOverviewCollection()),
    ]
    source_inventory = artifact_sources or classify_artifact_sources(prepared)
    artifacts_by_id = {artifact.id: artifact for artifact in prepared.artifacts}
    maa_input_paths = {
        artifact.input_path
        for classification in source_inventory.classifications
        if classification.source_kind is ArtifactSourceKind.MAA_FRAMEWORK
        if (artifact := artifacts_by_id.get(classification.artifact_id)) is not None
    }

    for artifact in prepared.artifacts:
        if not _is_mla_target(artifact, maa_input_paths):
            continue
        try:
            raw_result = tool_caller.call("mla.preflight", {"path": str(artifact.path)})
            preflight = MlaPreflightResult.model_validate(raw_result)
        except (ToolInvocationError, ValidationError, ValueError) as error:
            missing.append(
                MissingEvidence(
                    code="mla_preflight_failed",
                    message=str(error),
                    source_path=artifact.path,
                )
            )
            continue
        preflights.append(
            MlaArtifactInspection(
                artifact_id=artifact.id,
                path=artifact.path,
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
                    source_path=artifact.path,
                )
            )
            continue
        try:
            raw_runtime = tool_caller.call(
                "mla.runtime-inspection",
                {"path": str(artifact.path)},
            )
            runtime = MlaRuntimeInspectionResult.model_validate(raw_runtime)
        except (ToolInvocationError, ValidationError, ValueError) as error:
            missing.append(
                MissingEvidence(
                    code="mla_runtime_inspection_failed",
                    message=str(error),
                    source_path=artifact.path,
                )
            )
            continue
        runtime_inspections.append(
            MlaRuntimeInspectionArtifact(
                artifact_id=artifact.id,
                path=artifact.path,
                inspection=runtime,
            )
        )

    prepared_with_tools = prepared.model_copy(update={"missing_evidence": missing})
    return DeterministicInspection(
        prepared=prepared_with_tools,
        log_overviews=log_overviews or LogOverviewCollection(),
        mla_preflights=preflights,
        mla_runtime_inspections=runtime_inspections,
    )


def synthesize_inspection_evidence(
    inspection: DeterministicInspection,
) -> DeterministicInspection:
    """Attach project-owned evidence records derived from deterministic facts."""
    evidence = [
        *synthesize_runtime_identity_evidence(inspection.runtime_identity),
        *synthesize_log_overview_evidence(inspection.log_overviews),
        *synthesize_evidence(inspection.mla_runtime_inspections),
    ]
    return inspection.model_copy(update={"synthesized_evidence": evidence})


def attach_runtime_identity(inspection: DeterministicInspection) -> DeterministicInspection:
    identity = extract_runtime_identity(inspection.mla_preflights)
    return inspection.model_copy(update={"runtime_identity": identity})


def attach_incident_selection(inspection: DeterministicInspection) -> DeterministicInspection:
    selection = generate_incident_selection(inspection)
    return inspection.model_copy(update={"incident_selection": selection})
