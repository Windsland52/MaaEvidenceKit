from __future__ import annotations

from pathlib import Path
from typing import Protocol

from pydantic import Field, JsonValue, ValidationError

from .artifact_classification import classify_artifact_sources
from .domain import (
    AnalysisRequest,
    ArtifactAvailability,
    ArtifactKind,
    ArtifactMediaKind,
    ArtifactRecord,
    ContractModel,
    Evidence,
    MissingEvidence,
    PreparedAnalysis,
)
from .evidence_synthesis import synthesize_evidence
from .log_overview import (
    LogOverviewCollection,
    build_log_overviews,
    collect_log_overview_missing_evidence,
    synthesize_log_overview_evidence,
)
from .mla_contracts import (
    MlaCompatibilityStatus,
    MlaPreflightResult,
    MlaRuntimeInspectionResult,
)
from .preparation import prepare_analysis
from .tool_adapter_client import ToolAdapterInvocationError
from .workflow_contracts import ArtifactSourceInventory, ArtifactSourceKind


class ToolCaller(Protocol):
    def call(self, name: str, arguments: dict[str, JsonValue]) -> dict[str, JsonValue]: ...


class MlaArtifactInspection(ContractModel):
    artifact_id: str = Field(min_length=1)
    path: Path
    preflight: MlaPreflightResult


def _new_mla_preflights() -> list[MlaArtifactInspection]:
    return []


class MlaRuntimeInspectionArtifact(ContractModel):
    artifact_id: str = Field(min_length=1)
    path: Path
    inspection: MlaRuntimeInspectionResult


def _new_mla_runtime_inspections() -> list[MlaRuntimeInspectionArtifact]:
    return []


def _new_synthesized_evidence() -> list[Evidence]:
    return []


class DeterministicInspection(ContractModel):
    api_version: str = "deterministic-inspection/v2"
    prepared: PreparedAnalysis
    log_overviews: LogOverviewCollection = Field(default_factory=LogOverviewCollection)
    mla_preflights: list[MlaArtifactInspection] = Field(default_factory=_new_mla_preflights)
    mla_runtime_inspections: list[MlaRuntimeInspectionArtifact] = Field(
        default_factory=_new_mla_runtime_inspections,
    )
    synthesized_evidence: list[Evidence] = Field(
        default_factory=_new_synthesized_evidence,
    )


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
    return synthesize_inspection_evidence(inspection)


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
        except (ToolAdapterInvocationError, ValidationError, ValueError) as error:
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
        except (ToolAdapterInvocationError, ValidationError, ValueError) as error:
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
        *synthesize_log_overview_evidence(inspection.log_overviews),
        *synthesize_evidence(inspection.mla_runtime_inspections),
    ]
    return inspection.model_copy(update={"synthesized_evidence": evidence})
