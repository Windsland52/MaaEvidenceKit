from __future__ import annotations

import os
from pathlib import Path

from maa_diagnostic_expert.contracts.domain import (
    ArtifactAvailability,
    ArtifactKind,
    ArtifactMediaKind,
    MissingEvidence,
    PreparedAnalysis,
)
from maa_diagnostic_expert.contracts.workflow import EvidenceResearchPlan

from .evidence_query import query_evidence
from .models import DeterministicInspection


def available_evidence_query_paths(prepared: PreparedAnalysis) -> list[Path]:
    """List explicit, available text artifacts that a model may request by line."""
    media_kinds = {
        ArtifactMediaKind.CONFIGURATION,
        ArtifactMediaKind.LOG,
        ArtifactMediaKind.TEXT,
    }
    paths: dict[str, Path] = {}
    for artifact in prepared.artifacts:
        if artifact.availability is not ArtifactAvailability.AVAILABLE:
            continue
        for origin in artifact.all_origins():
            if origin.kind is ArtifactKind.DIRECTORY or origin.media_kind not in media_kinds:
                continue
            resolved = origin.path.resolve()
            paths.setdefault(os.path.normcase(str(resolved)), resolved)
    return sorted(paths.values(), key=lambda path: (os.path.normcase(str(path)), str(path)))


def available_configuration_query_paths(prepared: PreparedAnalysis) -> set[Path]:
    """Return the authorized artifact paths classified as configuration snapshots."""
    paths: set[Path] = set()
    for artifact in prepared.artifacts:
        if artifact.availability is not ArtifactAvailability.AVAILABLE:
            continue
        for origin in artifact.all_origins():
            if (
                origin.kind is not ArtifactKind.DIRECTORY
                and origin.media_kind is ArtifactMediaKind.CONFIGURATION
            ):
                paths.add(origin.path.resolve())
    return paths


def execute_evidence_research(
    inspection: DeterministicInspection,
    plan: EvidenceResearchPlan,
) -> DeterministicInspection:
    """Execute model-planned windows through the deterministic authorization boundary."""
    queried = list(inspection.queried_evidence)
    known_ids = {item.id for item in queried}
    missing = list(inspection.prepared.missing_evidence)
    for query in plan.queries:
        try:
            window = query_evidence(inspection.prepared, query)
        except (OSError, ValueError) as error:
            missing.append(
                MissingEvidence(
                    code="adaptive_evidence_query_failed",
                    message=str(error),
                    source_path=query.source_path,
                )
            )
            continue
        if window.evidence.id not in known_ids:
            queried.append(window.evidence)
            known_ids.add(window.evidence.id)
        if window.truncated:
            missing.append(
                MissingEvidence(
                    code="adaptive_evidence_window_truncated",
                    message=(
                        f"The requested evidence window at {query.source_path}:"
                        f"{query.line_start}-{query.line_end} reached the character limit."
                    ),
                    source_path=query.source_path,
                    required=False,
                )
            )
    return inspection.model_copy(
        update={
            "prepared": inspection.prepared.model_copy(update={"missing_evidence": missing}),
            "queried_evidence": queried,
        }
    )
