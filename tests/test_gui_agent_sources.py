from pathlib import Path

from maa_diagnostic_expert.domain import (
    AnalysisRequest,
    ArtifactInput,
    ArtifactKind,
    SourceInput,
    SourceRole,
)
from maa_diagnostic_expert.preparation import prepare_analysis


def test_issue_requires_revisions_for_supplied_gui_and_agent_sources(tmp_path: Path) -> None:
    project_root = tmp_path / "project"
    gui_root = tmp_path / "gui"
    agent_root = tmp_path / "agent"
    artifact = tmp_path / "maafw.log"
    for source_path in (project_root, gui_root, agent_root):
        source_path.mkdir()
    artifact.write_text("log", encoding="utf-8")

    prepared = prepare_analysis(
        AnalysisRequest(
            issue="https://github.com/example/project/issues/1",
            artifacts=[ArtifactInput(path=artifact, kind=ArtifactKind.FILE)],
            sources=[
                SourceInput(
                    source_id="project",
                    role=SourceRole.PROJECT,
                    path=project_root,
                    revision="v1.0.0",
                ),
                SourceInput(source_id="gui", role=SourceRole.GUI, path=gui_root),
                SourceInput(source_id="agent", role=SourceRole.AGENT, path=agent_root),
            ],
        )
    )

    unresolved_source_ids = {
        item.source_id
        for item in prepared.missing_evidence
        if item.code == "issue_revision_unresolved"
    }
    assert unresolved_source_ids == {"gui", "agent"}
