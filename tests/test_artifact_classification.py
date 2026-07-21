from __future__ import annotations

from pathlib import Path

from maa_diagnostic_expert.artifact_classification import (
    LogClassificationMatch,
    classify_artifact_sources,
)
from maa_diagnostic_expert.domain import (
    AnalysisRequest,
    ArtifactInput,
    ArtifactKind,
    PreparedAnalysis,
)
from maa_diagnostic_expert.preparation import prepare_analysis
from maa_diagnostic_expert.workflow_contracts import (
    ArtifactSourceKind,
    BranchDisposition,
    InvestigationBranch,
)
from maa_diagnostic_expert.workflow_planning import plan_initial_investigation


class _GuiProfile:
    @property
    def profile_id(self) -> str:
        return "test-gui"

    def classify(self, path: Path, sample: str) -> LogClassificationMatch | None:
        del path
        if "GUI application started" not in sample:
            return None
        return LogClassificationMatch(
            source_kind=ArtifactSourceKind.GUI,
            confidence=0.95,
            signals=("test_gui_banner",),
        )


def _prepare(directory: Path) -> PreparedAnalysis:
    return prepare_analysis(
        AnalysisRequest(
            question="Classify the logs.",
            artifacts=[ArtifactInput(path=directory, kind=ArtifactKind.DIRECTORY)],
        )
    )


def test_classifies_maafw_custom_and_unknown_logs(tmp_path: Path) -> None:
    maafw = tmp_path / "maafw.log"
    maafw.write_text(
        "[2026-01-01 00:00:00.000][DBG][Px1][Tx2][Logger] MAA Process Start\n",
        encoding="utf-8",
    )
    custom_dir = tmp_path / "custom"
    custom_dir.mkdir()
    custom = custom_dir / "2026-01-01.log"
    custom.write_text("project event\n", encoding="utf-8")
    unknown = tmp_path / "application.log"
    unknown.write_text("unrecognized format\n", encoding="utf-8")
    prepared = _prepare(tmp_path)

    inventory = classify_artifact_sources(prepared)
    by_path = {item.path: item for item in inventory.classifications}

    assert by_path[maafw].source_kind is ArtifactSourceKind.MAA_FRAMEWORK
    assert "maa_process_start" in by_path[maafw].signals
    assert by_path[custom].source_kind is ArtifactSourceKind.CUSTOM
    assert by_path[unknown].source_kind is ArtifactSourceKind.UNKNOWN


def test_profile_classifies_known_gui_format(tmp_path: Path) -> None:
    gui = tmp_path / "application.log"
    gui.write_text("GUI application started\n", encoding="utf-8")
    prepared = _prepare(tmp_path)

    inventory = classify_artifact_sources(
        prepared,
        profiles=(_GuiProfile(),),
    )

    assert inventory.classifications[0].source_kind is ArtifactSourceKind.GUI
    assert inventory.classifications[0].classifier_id == "profile/test-gui"
    plan = plan_initial_investigation(prepared, inventory)
    assert (
        plan.decision_for(InvestigationBranch.GUI_LOG_OVERVIEW).disposition is BranchDisposition.RUN
    )


def test_unknown_log_keeps_source_specific_overviews_unavailable(tmp_path: Path) -> None:
    (tmp_path / "application.log").write_text("unrecognized format\n", encoding="utf-8")
    prepared = _prepare(tmp_path)

    plan = plan_initial_investigation(prepared)

    assert (
        plan.decision_for(InvestigationBranch.GUI_LOG_OVERVIEW).disposition
        is BranchDisposition.UNAVAILABLE
    )
    assert (
        plan.decision_for(InvestigationBranch.CUSTOM_LOG_OVERVIEW).disposition
        is BranchDisposition.UNAVAILABLE
    )
    assert (
        plan.decision_for(InvestigationBranch.MLA_GLOBAL_OVERVIEW).disposition
        is BranchDisposition.SKIP
    )


def test_planner_does_not_send_custom_log_to_mla(tmp_path: Path) -> None:
    custom_dir = tmp_path / "custom"
    custom_dir.mkdir()
    (custom_dir / "agent.log").write_text("custom agent event\n", encoding="utf-8")
    prepared = _prepare(tmp_path)

    plan = plan_initial_investigation(prepared)

    assert (
        plan.decision_for(InvestigationBranch.MLA_GLOBAL_OVERVIEW).disposition
        is BranchDisposition.SKIP
    )
    assert (
        plan.decision_for(InvestigationBranch.CUSTOM_LOG_OVERVIEW).disposition
        is BranchDisposition.RUN
    )


def test_bounded_sample_includes_log_tail(tmp_path: Path) -> None:
    log = tmp_path / "runtime.log"
    log.write_text(
        "x" * (80 * 1024)
        + "\n[2026-01-01 00:00:00.000][DBG][Px1][Tx2][Logger] MAA Process Start\n",
        encoding="utf-8",
    )
    prepared = _prepare(tmp_path)

    inventory = classify_artifact_sources(prepared)

    assert inventory.classifications[0].source_kind is ArtifactSourceKind.MAA_FRAMEWORK
