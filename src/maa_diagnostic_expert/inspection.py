from __future__ import annotations

from pathlib import Path
from typing import Protocol

from pydantic import Field, JsonValue, ValidationError

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
from .mla_contracts import (
    MlaCompatibilityStatus,
    MlaPreflightResult,
    MlaRuntimeInspectionResult,
)
from .preparation import prepare_analysis
from .tool_adapter_client import ToolAdapterInvocationError


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
    api_version: str = "deterministic-inspection/v1"
    prepared: PreparedAnalysis
    mla_preflights: list[MlaArtifactInspection] = Field(default_factory=_new_mla_preflights)
    mla_runtime_inspections: list[MlaRuntimeInspectionArtifact] = Field(
        default_factory=_new_mla_runtime_inspections,
    )
    synthesized_evidence: list[Evidence] = Field(
        default_factory=_new_synthesized_evidence,
    )


def _is_mla_target(artifact: ArtifactRecord) -> bool:
    if artifact.availability is not ArtifactAvailability.AVAILABLE:
        return False
    if artifact.path != artifact.input_path:
        return False
    if artifact.kind is ArtifactKind.DIRECTORY:
        return True
    if artifact.media_kind is ArtifactMediaKind.LOG:
        return True
    return (
        artifact.media_kind is ArtifactMediaKind.ARCHIVE and artifact.path.suffix.lower() == ".zip"
    )


def inspect_analysis(
    request: AnalysisRequest,
    tool_caller: ToolCaller,
) -> DeterministicInspection:
    prepared = prepare_analysis(request)
    preflights: list[MlaArtifactInspection] = []
    runtime_inspections: list[MlaRuntimeInspectionArtifact] = []
    missing = list(prepared.missing_evidence)

    for artifact in prepared.artifacts:
        if not _is_mla_target(artifact):
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
        mla_preflights=preflights,
        mla_runtime_inspections=runtime_inspections,
        synthesized_evidence=synthesize_evidence(runtime_inspections),
    )
