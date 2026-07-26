from pathlib import Path
from typing import Literal

from pydantic import Field

from maa_diagnostic_expert.contracts.domain import (
    ContractModel,
    Evidence,
    PreparedAnalysis,
    SourceRole,
)
from maa_diagnostic_expert.contracts.mla import MlaPreflightResult, MlaRuntimeInspectionResult
from maa_diagnostic_expert.contracts.mse import (
    MseProjectPreflightResult,
    MseTaskResolutionResult,
)
from maa_diagnostic_expert.contracts.workflow import (
    IncidentComparison,
    IncidentComparisonStatus,
    IncidentSelection,
    IncidentSelectionStatus,
    RuntimeIdentity,
    SourceGuidance,
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


class MseTaskResolutionInspection(ContractModel):
    source_id: str = Field(min_length=1)
    path: Path
    resolution: MseTaskResolutionResult


class SourceGuidanceDocument(ContractModel):
    relative_path: str = Field(min_length=1)
    content: str
    line_count: int = Field(ge=1)
    truncated: bool = False


class SourceGuidanceInspection(ContractModel):
    source_root: Path
    guidance: SourceGuidance
    documents: list[SourceGuidanceDocument] = Field(default_factory=list[SourceGuidanceDocument])


class SourceSearchMatch(ContractModel):
    query_id: str = Field(min_length=1)
    source_id: str = Field(min_length=1)
    source_role: SourceRole
    relative_path: str = Field(min_length=1)
    source_locator: str = Field(min_length=1)
    line: int = Field(ge=1)
    matched_terms: list[str] = Field(min_length=1)
    content: str
    line_start: int = Field(ge=1)
    line_end: int = Field(ge=1)
    evidence_id: str = Field(min_length=1)


def _new_mla_preflights() -> list[MlaArtifactInspection]:
    return []


def _new_mla_runtime_inspections() -> list[MlaRuntimeInspectionArtifact]:
    return []


def _new_synthesized_evidence() -> list[Evidence]:
    return []


def _new_mse_project_inspections() -> list[MseProjectInspection]:
    return []


def _new_mse_task_resolutions() -> list[MseTaskResolutionInspection]:
    return []


def _new_source_guidance_inspections() -> list[SourceGuidanceInspection]:
    return []


def _new_source_search_matches() -> list[SourceSearchMatch]:
    return []


def _new_incident_selection() -> IncidentSelection:
    return IncidentSelection(status=IncidentSelectionStatus.NOT_FOUND)


def _new_incident_comparison() -> IncidentComparison:
    return IncidentComparison(status=IncidentComparisonStatus.UNAVAILABLE)


class DeterministicInspection(ContractModel):
    api_version: Literal["deterministic-inspection/v17"] = "deterministic-inspection/v17"
    prepared: PreparedAnalysis
    artifact_evidence: list[Evidence] = Field(default_factory=_new_synthesized_evidence)
    queried_evidence: list[Evidence] = Field(default_factory=_new_synthesized_evidence)
    log_overviews: LogOverviewCollection = Field(default_factory=LogOverviewCollection)
    runtime_identity: RuntimeIdentity = Field(default_factory=RuntimeIdentity)
    incident_selection: IncidentSelection = Field(default_factory=_new_incident_selection)
    incident_comparison: IncidentComparison = Field(default_factory=_new_incident_comparison)
    mla_preflights: list[MlaArtifactInspection] = Field(default_factory=_new_mla_preflights)
    mla_runtime_inspections: list[MlaRuntimeInspectionArtifact] = Field(
        default_factory=_new_mla_runtime_inspections,
    )
    mse_project_inspections: list[MseProjectInspection] = Field(
        default_factory=_new_mse_project_inspections,
    )
    mse_task_resolutions: list[MseTaskResolutionInspection] = Field(
        default_factory=_new_mse_task_resolutions,
    )
    source_guidance_inspections: list[SourceGuidanceInspection] = Field(
        default_factory=_new_source_guidance_inspections,
    )
    source_search_matches: list[SourceSearchMatch] = Field(
        default_factory=_new_source_search_matches,
    )
    knowledge_search_matches: list[SourceSearchMatch] = Field(
        default_factory=_new_source_search_matches,
    )
    synthesized_evidence: list[Evidence] = Field(
        default_factory=_new_synthesized_evidence,
    )
