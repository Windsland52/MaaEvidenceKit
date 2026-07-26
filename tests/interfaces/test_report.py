from maa_diagnostic_expert.contracts.domain import (
    DiagnosisResult,
    DiagnosisStatus,
    Evidence,
    EvidenceReliability,
    EvidenceRole,
)
from maa_diagnostic_expert.interfaces.report import render_markdown_report


def _evidence(
    evidence_id: str,
    role: EvidenceRole,
    reliability: EvidenceReliability,
) -> Evidence:
    return Evidence(
        id=evidence_id,
        kind=f"test_{role.value}",
        source_component="test",
        source_path="maafw.log",
        content=f"{role.value} evidence",
        role=role,
        reliability=reliability,
    )


def test_report_separates_diagnostic_roles_from_reliability() -> None:
    result = DiagnosisResult(
        status=DiagnosisStatus.INSUFFICIENT_EVIDENCE,
        summary="Signals require more correlation.",
        evidence=[
            _evidence("context", EvidenceRole.CONTEXT, EvidenceReliability.PRIMARY),
            _evidence("signal", EvidenceRole.SIGNAL, EvidenceReliability.PRIMARY),
            _evidence("failure", EvidenceRole.FAILURE, EvidenceReliability.PRIMARY),
        ],
    )

    report = render_markdown_report(result)

    failure_heading = "### Failure (direct runtime failures) (1)"
    signal_heading = "### Signal (warnings and anomalies) (1)"
    context_heading = "### Context (versions, configuration, and summaries) (1)"
    assert failure_heading in report
    assert signal_heading in report
    assert context_heading in report
    assert (
        report.index(failure_heading) < report.index(signal_heading) < report.index(context_heading)
    )
    assert report.count("**Reliability:** Primary (authoritative observation)") == 3
