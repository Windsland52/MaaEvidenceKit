from __future__ import annotations

from maa_diagnostic_expert.contracts.domain import (
    ArtifactAvailability,
    ArtifactKind,
    ArtifactMediaKind,
    PreparedAnalysis,
    RevisionResolutionStatus,
    SourceRole,
)
from maa_diagnostic_expert.contracts.mse import MseSyntaxMode
from maa_diagnostic_expert.contracts.workflow import (
    AnalysisRelevance,
    ArtifactSourceInventory,
    ArtifactSourceKind,
    BranchDecision,
    BranchDisposition,
    InvestigationBranch,
    InvestigationPlan,
)
from maa_diagnostic_expert.discovery.artifact_classification import classify_artifact_sources
from maa_diagnostic_expert.discovery.inputs import find_maa_interface
from maa_diagnostic_expert.discovery.mse_syntax import detect_mse_syntax_mode
from maa_diagnostic_expert.discovery.source_preparation import (
    source_snapshot_matches_checkout,
    source_snapshot_supports_object_read,
)
from maa_diagnostic_expert.inspection.artifact_targets import select_mla_artifact_targets


def _has_mla_candidate(
    prepared: PreparedAnalysis,
    inventory: ArtifactSourceInventory,
) -> bool:
    return bool(select_mla_artifact_targets(prepared, inventory))


def _log_branch_decision(
    inventory: ArtifactSourceInventory,
    *,
    branch: InvestigationBranch,
    source_kind: ArtifactSourceKind,
    label: str,
) -> BranchDecision:
    if any(item.source_kind is source_kind for item in inventory.classifications):
        return BranchDecision(
            branch=branch,
            disposition=BranchDisposition.RUN,
            relevance=AnalysisRelevance.USEFUL,
            reason=f"At least one {label} log was classified for deterministic overview.",
        )
    if any(item.source_kind is ArtifactSourceKind.UNKNOWN for item in inventory.classifications):
        return BranchDecision(
            branch=branch,
            disposition=BranchDisposition.UNAVAILABLE,
            relevance=AnalysisRelevance.UNDETERMINED,
            reason=f"Unclassified logs remain; a {label} source profile may be required.",
        )
    return BranchDecision(
        branch=branch,
        disposition=BranchDisposition.SKIP,
        relevance=AnalysisRelevance.NOT_RELEVANT,
        reason=f"No supplied log was classified as {label}.",
    )


def _has_available_dump(prepared: PreparedAnalysis) -> bool:
    return any(
        artifact.availability is ArtifactAvailability.AVAILABLE
        and any(
            origin.kind is not ArtifactKind.DIRECTORY
            and origin.media_kind is ArtifactMediaKind.DUMP
            for origin in artifact.all_origins()
        )
        for artifact in prepared.artifacts
    )


def _has_resolved_source(prepared: PreparedAnalysis, role: SourceRole) -> bool:
    return any(
        snapshot.role is role and snapshot.resolution_status is RevisionResolutionStatus.RESOLVED
        for snapshot in prepared.source_snapshots
    )


def _has_usable_mse_project(prepared: PreparedAnalysis) -> bool:
    return any(
        snapshot.role is SourceRole.PROJECT
        and source_snapshot_matches_checkout(
            snapshot,
            require_requested_revision=prepared.request.issue is not None,
        )
        and find_maa_interface(snapshot.path) is not None
        for snapshot in prepared.source_snapshots
    )


def _has_usable_source(prepared: PreparedAnalysis, role: SourceRole) -> bool:
    require_revision = prepared.request.issue is not None
    return any(
        snapshot.role is role
        and source_snapshot_supports_object_read(
            snapshot,
            require_requested_revision=require_revision,
        )
        for snapshot in prepared.source_snapshots
    )


def _can_run_project_source_research(prepared: PreparedAnalysis) -> bool:
    require_revision = prepared.request.issue is not None
    return any(
        snapshot.role is SourceRole.PROJECT
        and source_snapshot_supports_object_read(
            snapshot,
            require_requested_revision=require_revision,
        )
        and source_snapshot_matches_checkout(
            snapshot,
            require_requested_revision=require_revision,
        )
        and find_maa_interface(snapshot.path) is not None
        and detect_mse_syntax_mode(snapshot.path) is MseSyntaxMode.MAAFW
        for snapshot in prepared.source_snapshots
    )


def _has_usable_knowledge_source(prepared: PreparedAnalysis) -> bool:
    knowledge_roles = {
        SourceRole.MAA_FRAMEWORK,
        SourceRole.DOCUMENTATION,
        SourceRole.WIKI,
    }
    return any(
        snapshot.role in knowledge_roles
        and source_snapshot_supports_object_read(
            snapshot,
            require_requested_revision=prepared.request.issue is not None,
        )
        for snapshot in prepared.source_snapshots
    )


def plan_initial_investigation(
    prepared: PreparedAnalysis,
    inventory: ArtifactSourceInventory | None = None,
) -> InvestigationPlan:
    """Plan the currently available overview branches without inferring a diagnosis."""
    source_inventory = classify_artifact_sources(prepared) if inventory is None else inventory
    mla_candidate = _has_mla_candidate(prepared, source_inventory)
    project_source = _has_usable_source(prepared, SourceRole.PROJECT)
    runnable_project_source = _can_run_project_source_research(prepared)
    mse_project = _has_usable_mse_project(prepared)
    gui_source = _has_resolved_source(prepared, SourceRole.GUI)
    framework_source = _has_resolved_source(prepared, SourceRole.MAA_FRAMEWORK)
    has_dump = _has_available_dump(prepared)
    knowledge_source = _has_usable_knowledge_source(prepared)

    return InvestigationPlan(
        decisions=[
            _log_branch_decision(
                source_inventory,
                branch=InvestigationBranch.GUI_LOG_OVERVIEW,
                source_kind=ArtifactSourceKind.GUI,
                label="GUI",
            ),
            _log_branch_decision(
                source_inventory,
                branch=InvestigationBranch.CUSTOM_LOG_OVERVIEW,
                source_kind=ArtifactSourceKind.CUSTOM,
                label="custom",
            ),
            BranchDecision(
                branch=InvestigationBranch.MLA_GLOBAL_OVERVIEW,
                disposition=(BranchDisposition.RUN if mla_candidate else BranchDisposition.SKIP),
                relevance=(
                    AnalysisRelevance.USEFUL if mla_candidate else AnalysisRelevance.NOT_RELEVANT
                ),
                reason=(
                    "A classified MaaFramework log or explicit ZIP can be checked by MLA."
                    if mla_candidate
                    else "No explicit artifact is eligible for MLA inspection."
                ),
            ),
            BranchDecision(
                branch=InvestigationBranch.MSE_PROJECT_PREFLIGHT,
                disposition=BranchDisposition.RUN if mse_project else BranchDisposition.SKIP,
                relevance=(
                    AnalysisRelevance.USEFUL if mse_project else AnalysisRelevance.NOT_RELEVANT
                ),
                reason=(
                    "A revision-matched Maa project interface is available for MSE preflight."
                    if mse_project
                    else "No revision-matched Maa project interface is available for MSE."
                ),
            ),
            BranchDecision(
                branch=InvestigationBranch.CRASH_PREFLIGHT,
                disposition=BranchDisposition.RUN if has_dump else BranchDisposition.SKIP,
                relevance=(
                    AnalysisRelevance.REQUIRED if has_dump else AnalysisRelevance.NOT_RELEVANT
                ),
                reason=(
                    "A dump artifact is available for built-in Minidump preflight."
                    if has_dump
                    else "No dump artifact was supplied."
                ),
            ),
            BranchDecision(
                branch=InvestigationBranch.PROJECT_SOURCE,
                disposition=(
                    BranchDisposition.RUN
                    if runnable_project_source
                    else (BranchDisposition.DEFERRED if project_source else BranchDisposition.SKIP)
                ),
                relevance=(
                    AnalysisRelevance.USEFUL if project_source else AnalysisRelevance.NOT_RELEVANT
                ),
                reason=(
                    "A revision-matched MaaFramework project interface is available for "
                    "focused task resolution, scoped guidance, and bounded source search."
                    if runnable_project_source
                    else (
                        "Project source is available, but current source research cannot "
                        "derive a supported focused task target; general source search "
                        "remains deferred."
                        if project_source
                        else "No usable project source is available."
                    )
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
                disposition=(BranchDisposition.RUN if knowledge_source else BranchDisposition.SKIP),
                relevance=(
                    AnalysisRelevance.USEFUL if knowledge_source else AnalysisRelevance.NOT_RELEVANT
                ),
                reason=(
                    "Explicit version-matched documentation or Wiki input is available."
                    if knowledge_source
                    else "No usable explicit documentation or Wiki source is available."
                ),
            ),
        ]
    )
