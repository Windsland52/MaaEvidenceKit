from pathlib import Path

from maa_diagnostic_expert.contracts.domain import AnalysisRequest, DiagnosisResult
from maa_diagnostic_expert.contracts.workflow import (
    FixCandidatePlan,
    FixPlanningStatus,
)
from maa_diagnostic_expert.interfaces.cli import build_parser, main


def test_diagnose_accepts_separate_fix_plan_output() -> None:
    args = build_parser().parse_args(
        [
            "diagnose",
            "--request",
            "request.json",
            "--fix-plan",
            "fix-plan.json",
        ]
    )

    assert args.command == "diagnose"
    assert args.request == Path("request.json")
    assert args.fix_plan == Path("fix-plan.json")


def test_diagnose_writes_fix_plan_output(tmp_path: Path) -> None:
    request_path = tmp_path / "request.json"
    diagnosis_path = tmp_path / "diagnosis.json"
    fix_plan_path = tmp_path / "fix-plan.json"
    request_path.write_text(
        AnalysisRequest(question="Diagnose without artifacts.").model_dump_json(),
        encoding="utf-8",
    )

    exit_code = main(
        [
            "diagnose",
            "--request",
            str(request_path),
            "--fix-plan",
            str(fix_plan_path),
            "--output",
            str(diagnosis_path),
        ]
    )

    diagnosis = DiagnosisResult.model_validate_json(diagnosis_path.read_text(encoding="utf-8"))
    fix_plan = FixCandidatePlan.model_validate_json(fix_plan_path.read_text(encoding="utf-8"))
    assert exit_code == 0
    assert diagnosis.summary
    assert fix_plan.status is FixPlanningStatus.SKIP
