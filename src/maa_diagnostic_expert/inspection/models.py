from pathlib import Path

from pydantic import Field

from maa_diagnostic_expert.contracts.domain import ContractModel, Evidence, PreparedAnalysis
from maa_diagnostic_expert.contracts.mla import MlaPreflightResult, MlaRuntimeInspectionResult
from maa_diagnostic_expert.contracts.mse import MseProjectPreflightResult
from maa_diagnostic_expert.contracts.workflow import (
    IncidentSelection,
    IncidentSelectionStatus,
    RuntimeIdentity,
)

from .log_overview import LogOverviewCollection


class MlaArtifactInspection(ContractModel):
    artifact_id: str = Field(min_length=1)
    path: Path
    preflight: MlaPreflightResult


class MlaRuntimeInspectionArtifact(ContractModel):
    artifact_id: str = Field(min_length=1)
    path: Path
    inspection: MlaRuntimeInspectionResult


class MseProjectInspection(ContractModel):
    source_id: str = Field(min_length=1)
    path: Path
    preflight: MseProjectPreflightResult


def _new_mla_preflights() -> list[MlaArtifactInspection]:
    return []


def _new_mla_runtime_inspections() -> list[MlaRuntimeInspectionArtifact]:
    return []


def _new_synthesized_evidence() -> list[Evidence]:
    return []


def _new_mse_project_inspections() -> list[MseProjectInspection]:
    return []


def _new_incident_selection() -> IncidentSelection:
    return IncidentSelection(status=IncidentSelectionStatus.NOT_FOUND)


class DeterministicInspection(ContractModel):
    api_version: str = "deterministic-inspection/v5"
    prepared: PreparedAnalysis
    log_overviews: LogOverviewCollection = Field(default_factory=LogOverviewCollection)
    runtime_identity: RuntimeIdentity = Field(default_factory=RuntimeIdentity)
    incident_selection: IncidentSelection = Field(default_factory=_new_incident_selection)
    mla_preflights: list[MlaArtifactInspection] = Field(default_factory=_new_mla_preflights)
    mla_runtime_inspections: list[MlaRuntimeInspectionArtifact] = Field(
        default_factory=_new_mla_runtime_inspections,
    )
    mse_project_inspections: list[MseProjectInspection] = Field(
        default_factory=_new_mse_project_inspections,
    )
    synthesized_evidence: list[Evidence] = Field(
        default_factory=_new_synthesized_evidence,
    )
