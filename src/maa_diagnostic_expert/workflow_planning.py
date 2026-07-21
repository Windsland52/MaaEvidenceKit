from __future__ import annotations

from .domain import (
    ArtifactAvailability,
    ArtifactMediaKind,
    PreparedAnalysis,
    RevisionResolutionStatus,
    SourceRole,
)
from .workflow_contracts import (
    AnalysisRelevance,
    BranchDecision,
    BranchDisposition,
    InvestigationBranch,
    InvestigationPlan,
)


def _has_mla_candidate(prepared: PreparedAnalysis) -> bool:
    for artifact in prepared.artifacts:
        if artifact.availability is not ArtifactAvailability.AVAILABLE:
            continue
        if artifact.media_kind is ArtifactMediaKind.LOG:
            return True
        if (
            artifact.media_kind is ArtifactMediaKind.ARCHIVE
            and artifact.path.suffix.lower() == ".zip"
        ):
            return True
    return False


def _has_available_dump(prepared: PreparedAnalysis) -> bool:
    return any(
        artifact.availability is ArtifactAvailability.AVAILABLE
        and artifact.media_kind is ArtifactMediaKind.DUMP
        for artifact in prepared.artifacts
    )


def _has_resolved_source(prepared: PreparedAnalysis, role: SourceRole) -> bool:
    return any(
        snapshot.role is role and snapshot.resolution_status is RevisionResolutionStatus.RESOLVED
        for snapshot in prepared.source_snapshots
    )


def plan_initial_investigation(prepared: PreparedAnalysis) -> InvestigationPlan:
    """Plan the currently available overview branches without inferring a diagnosis."""
    mla_candidate = _has_mla_candidate(prepared)
    project_source = _has_resolved_source(prepared, SourceRole.PROJECT)
    gui_source = _has_resolved_source(prepared, SourceRole.GUI)
    framework_source = _has_resolved_source(prepared, SourceRole.MAA_FRAMEWORK)
    has_dump = _has_available_dump(prepared)

    return InvestigationPlan(
        decisions=[
            BranchDecision(
                branch=InvestigationBranch.GUI_LOG_OVERVIEW,
                disposition=BranchDisposition.DEFERRED,
                relevance=AnalysisRelevance.UNDETERMINED,
                reason="GUI log source classification is not implemented yet.",
            ),
            BranchDecision(
                branch=InvestigationBranch.CUSTOM_LOG_OVERVIEW,
                disposition=BranchDisposition.DEFERRED,
                relevance=AnalysisRelevance.UNDETERMINED,
                reason="Custom log source classification is not implemented yet.",
            ),
            BranchDecision(
                branch=InvestigationBranch.MLA_GLOBAL_OVERVIEW,
                disposition=(BranchDisposition.RUN if mla_candidate else BranchDisposition.SKIP),
                relevance=(
                    AnalysisRelevance.USEFUL if mla_candidate else AnalysisRelevance.NOT_RELEVANT
                ),
                reason=(
                    "An explicit directory, log, or zip artifact can be checked by MLA."
                    if mla_candidate
                    else "No explicit artifact is eligible for MLA inspection."
                ),
            ),
            BranchDecision(
                branch=InvestigationBranch.MSE_PROJECT_PREFLIGHT,
                disposition=(
                    BranchDisposition.DEFERRED if project_source else BranchDisposition.SKIP
                ),
                relevance=(
                    AnalysisRelevance.USEFUL if project_source else AnalysisRelevance.NOT_RELEVANT
                ),
                reason=(
                    "A version-resolved project source is available; MSE integration is pending."
                    if project_source
                    else "No version-resolved project source is available for MSE."
                ),
            ),
            BranchDecision(
                branch=InvestigationBranch.CRASH_PREFLIGHT,
                disposition=BranchDisposition.DEFERRED if has_dump else BranchDisposition.SKIP,
                relevance=(
                    AnalysisRelevance.REQUIRED if has_dump else AnalysisRelevance.NOT_RELEVANT
                ),
                reason=(
                    "A dump artifact is available; dump inspection is not implemented yet."
                    if has_dump
                    else "No dump artifact was supplied."
                ),
            ),
            BranchDecision(
                branch=InvestigationBranch.PROJECT_SOURCE,
                disposition=(
                    BranchDisposition.DEFERRED if project_source else BranchDisposition.SKIP
                ),
                relevance=(
                    AnalysisRelevance.USEFUL if project_source else AnalysisRelevance.NOT_RELEVANT
                ),
                reason=(
                    "Project source is resolved; scoped AGENTS.md analysis is pending."
                    if project_source
                    else "No version-resolved project source is available."
                ),
            ),
            BranchDecision(
                branch=InvestigationBranch.GUI_SOURCE,
                disposition=BranchDisposition.DEFERRED if gui_source else BranchDisposition.SKIP,
                relevance=(
                    AnalysisRelevance.UNDETERMINED if gui_source else AnalysisRelevance.NOT_RELEVANT
                ),
                reason=(
                    "GUI source is resolved and may be investigated when runtime evidence "
                    "requires it."
                    if gui_source
                    else "No version-resolved GUI source is available."
                ),
            ),
            BranchDecision(
                branch=InvestigationBranch.FRAMEWORK_SOURCE,
                disposition=(
                    BranchDisposition.DEFERRED if framework_source else BranchDisposition.SKIP
                ),
                relevance=(
                    AnalysisRelevance.UNDETERMINED
                    if framework_source
                    else AnalysisRelevance.NOT_RELEVANT
                ),
                reason=(
                    "MaaFramework source is resolved and may be investigated only when required."
                    if framework_source
                    else "No version-resolved MaaFramework source is available."
                ),
            ),
            BranchDecision(
                branch=InvestigationBranch.KNOWLEDGE_RESEARCH,
                disposition=BranchDisposition.DEFERRED,
                relevance=AnalysisRelevance.UNDETERMINED,
                reason="Version-matched document search is not implemented yet.",
            ),
        ]
    )
