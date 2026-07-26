from pathlib import Path

from maa_diagnostic_expert.contracts.domain import (
    AnalysisRequest,
    PreparedAnalysis,
    RevisionResolutionStatus,
    SourceRevisionBackend,
    SourceRole,
    SourceSnapshot,
)
from maa_diagnostic_expert.contracts.mse import (
    MseCompatibility,
    MseCompatibilityStatus,
    MseResolvedTask,
    MseTaskDefinition,
    MseTaskResolutionResult,
)
from maa_diagnostic_expert.inspection.models import (
    DeterministicInspection,
    MseTaskResolutionInspection,
)
from maa_diagnostic_expert.inspection.source_guidance import (
    resolve_focused_source_guidance,
    synthesize_source_guidance_evidence,
)


def _inspection(root: Path, source_paths: list[str]) -> DeterministicInspection:
    return DeterministicInspection(
        prepared=PreparedAnalysis(
            request=AnalysisRequest(question="Inspect project source."),
            source_snapshots=[
                SourceSnapshot(
                    source_id="project",
                    role=SourceRole.PROJECT,
                    path=root,
                    revision_backend=SourceRevisionBackend.GIT,
                    current_revision="abc123",
                    resolution_status=RevisionResolutionStatus.NOT_REQUESTED,
                )
            ],
        ),
        mse_task_resolutions=[
            MseTaskResolutionInspection(
                source_id="project",
                path=root,
                resolution=MseTaskResolutionResult(
                    project_root=root,
                    interface_path="assets/interface.json",
                    compatibility=MseCompatibility(
                        status=MseCompatibilityStatus.SUPPORTED,
                        reason="Resolved.",
                    ),
                    requested_tasks=["Node"],
                    resolutions=[
                        MseResolvedTask(
                            name=f"Node{index}",
                            found=True,
                            definitions=[
                                MseTaskDefinition(
                                    source_path=source_path,
                                    line=1,
                                    column=1,
                                )
                            ],
                        )
                        for index, source_path in enumerate(source_paths)
                    ],
                ),
            )
        ],
    )


def test_resolve_focused_source_guidance_applies_root_and_nested_files(
    tmp_path: Path,
) -> None:
    root = tmp_path / "project"
    pipeline = root / "assets" / "pipeline"
    pipeline.mkdir(parents=True)
    (root / "AGENTS.md").write_text("root instructions\n", encoding="utf-8")
    (root / "assets" / "AGENTS.md").write_text(
        "asset instructions\n",
        encoding="utf-8",
    )
    (pipeline / "one.json").write_text("{}\n", encoding="utf-8")
    (pipeline / "two.json").write_text("{}\n", encoding="utf-8")

    inspection = resolve_focused_source_guidance(
        _inspection(
            root,
            [
                "assets/pipeline/one.json",
                "assets/pipeline/two.json",
            ],
        )
    )
    evidence = synthesize_source_guidance_evidence(inspection.source_guidance_inspections)

    assert len(inspection.source_guidance_inspections) == 2
    first = inspection.source_guidance_inspections[0]
    assert [item.relative_path for item in first.documents] == [
        "AGENTS.md",
        "assets/AGENTS.md",
    ]
    assert first.guidance.revision == "abc123"
    assert first.guidance.guidance_refs == [item.id for item in evidence]
    assert len(evidence) == 2
    assert all(item.kind == "source_guidance" for item in evidence)
    assert evidence[0].source_path == "git:project@abc123:AGENTS.md"


def test_resolve_focused_source_guidance_rejects_target_outside_source(
    tmp_path: Path,
) -> None:
    root = tmp_path / "project"
    root.mkdir()

    inspection = resolve_focused_source_guidance(_inspection(root, ["../outside.json"]))

    assert inspection.source_guidance_inspections == []
    assert "source_guidance_target_outside_root" in {
        item.code for item in inspection.prepared.missing_evidence
    }


def test_resolve_focused_source_guidance_reports_content_truncation(
    tmp_path: Path,
) -> None:
    root = tmp_path / "project"
    root.mkdir()
    (root / "AGENTS.md").write_text("x" * 50_000, encoding="utf-8")
    (root / "pipeline.json").write_text("{}\n", encoding="utf-8")

    inspection = resolve_focused_source_guidance(_inspection(root, ["pipeline.json"]))

    [guidance] = inspection.source_guidance_inspections
    [document] = guidance.documents
    assert document.truncated is True
    assert len(document.content) == 40_000
    assert "source_guidance_content_truncated" in {
        item.code for item in inspection.prepared.missing_evidence
    }
