from pathlib import Path

from maa_diagnostic_expert.contracts.domain import (
    AnalysisRequest,
    ArtifactInput,
    ArtifactKind,
    EvidenceQuery,
)
from maa_diagnostic_expert.contracts.workflow import (
    EvidenceResearchPlan,
    SourceResearchStatus,
)
from maa_diagnostic_expert.discovery.preparation import prepare_analysis
from maa_diagnostic_expert.inspection.adaptive_evidence import (
    available_configuration_query_paths,
    available_evidence_query_paths,
    execute_evidence_research,
)
from maa_diagnostic_expert.inspection.models import DeterministicInspection
from maa_diagnostic_expert.inspection.service import synthesize_inspection_evidence


def _inspection_for(path: Path) -> DeterministicInspection:
    request = AnalysisRequest(
        question="Why did the operation fail?",
        artifacts=[ArtifactInput(path=path, kind=ArtifactKind.FILE)],
    )
    return DeterministicInspection(prepared=prepare_analysis(request))


def test_execute_evidence_research_adds_authorized_window_to_ledger(
    tmp_path: Path,
) -> None:
    log = tmp_path / "agent.log"
    log.write_text("started\nretry exhausted\nfailed\n", encoding="utf-8")
    inspection = _inspection_for(log)
    plan = EvidenceResearchPlan(
        status=SourceResearchStatus.RUN,
        queries=[
            EvidenceQuery(
                source_path=log,
                line_start=2,
                line_end=3,
                reason="Inspect the failure lines.",
            )
        ],
        rationale="Inspect the focused failure window.",
    )

    researched = execute_evidence_research(inspection, plan)
    synthesized = synthesize_inspection_evidence(researched)

    assert available_evidence_query_paths(inspection.prepared) == [log.resolve()]
    [window] = synthesized.queried_evidence
    assert window.kind == "text_line_window"
    assert window.content == "retry exhausted\nfailed"
    assert window in synthesized.synthesized_evidence


def test_available_configuration_query_paths_classifies_discovered_files(
    tmp_path: Path,
) -> None:
    config = tmp_path / "settings.json"
    config.write_text('{"retryPolicy": "bounded"}\n', encoding="utf-8")
    log = tmp_path / "agent.log"
    log.write_text("started\n", encoding="utf-8")
    prepared = prepare_analysis(
        AnalysisRequest(
            question="Inspect the effective controller.",
            artifacts=[ArtifactInput(path=tmp_path, kind=ArtifactKind.DIRECTORY)],
        )
    )

    assert available_configuration_query_paths(prepared) == {config.resolve()}
    assert available_evidence_query_paths(prepared) == [log.resolve(), config.resolve()]


def test_execute_evidence_research_records_rejected_query_as_missing_evidence(
    tmp_path: Path,
) -> None:
    log = tmp_path / "agent.log"
    log.write_text("failed\n", encoding="utf-8")
    outside = tmp_path / "secret.txt"
    outside.write_text("not authorized\n", encoding="utf-8")
    inspection = _inspection_for(log)
    plan = EvidenceResearchPlan(
        status=SourceResearchStatus.RUN,
        queries=[
            EvidenceQuery(
                source_path=outside,
                line_start=1,
                line_end=1,
                reason="Inspect the purported failure line.",
            )
        ],
        rationale="Attempt a path outside the prepared inputs.",
    )

    researched = execute_evidence_research(inspection, plan)

    assert researched.queried_evidence == []
    [missing] = researched.prepared.missing_evidence
    assert missing.code == "adaptive_evidence_query_failed"
    assert missing.required is True
    assert missing.source_path == outside


def test_execute_evidence_research_deduplicates_windows_across_rounds(
    tmp_path: Path,
) -> None:
    log = tmp_path / "agent.log"
    log.write_text("started\nfailed\n", encoding="utf-8")
    inspection = _inspection_for(log)
    plan = EvidenceResearchPlan(
        status=SourceResearchStatus.RUN,
        queries=[
            EvidenceQuery(
                source_path=log,
                line_start=1,
                line_end=2,
                reason="Inspect the complete focused window.",
            )
        ],
        rationale="Inspect the same focused window.",
    )

    first = execute_evidence_research(inspection, plan)
    second = execute_evidence_research(first, plan)

    assert len(second.queried_evidence) == 1
