from pathlib import Path

import pytest

from maa_diagnostic_expert.domain import (
    AnalysisRequest,
    EvidenceQuery,
    SourceInput,
    SourceRole,
)
from maa_diagnostic_expert.evidence_query import query_evidence
from maa_diagnostic_expert.preparation import prepare_analysis


def test_query_evidence_attributes_the_most_specific_source(tmp_path: Path) -> None:
    project_root = tmp_path / "project"
    framework_root = project_root / "deps" / "MaaFramework"
    framework_root.mkdir(parents=True)
    source_file = framework_root / "PipelineTask.cpp"
    source_file.write_text("one\ntwo\nthree\n", encoding="utf-8")
    prepared = prepare_analysis(
        AnalysisRequest(
            question="Inspect version-matched framework source.",
            sources=[
                SourceInput(
                    source_id="project",
                    role=SourceRole.PROJECT,
                    path=project_root,
                ),
                SourceInput(
                    source_id="maa-framework",
                    role=SourceRole.MAA_FRAMEWORK,
                    path=framework_root,
                ),
            ],
        )
    )

    window = query_evidence(
        prepared,
        EvidenceQuery(
            source_path=source_file,
            line_start=2,
            line_end=2,
            reason="Inspect the framework implementation.",
        ),
    )

    assert window.evidence.source_component == "source:maa-framework"


def test_query_evidence_rejects_git_metadata_in_every_source(tmp_path: Path) -> None:
    project_root = tmp_path / "project"
    git_dir = project_root / ".git"
    git_dir.mkdir(parents=True)
    git_config = git_dir / "config"
    git_config.write_text("secret", encoding="utf-8")
    prepared = prepare_analysis(
        AnalysisRequest(
            question="Inspect the project.",
            sources=[
                SourceInput(
                    source_id="project",
                    role=SourceRole.PROJECT,
                    path=project_root,
                )
            ],
        )
    )

    with pytest.raises(ValueError, match="Git metadata"):
        query_evidence(
            prepared,
            EvidenceQuery(
                source_path=git_config,
                line_start=1,
                line_end=1,
                reason="This path must remain unauthorized.",
            ),
        )
