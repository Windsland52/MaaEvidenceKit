from __future__ import annotations

import argparse
import asyncio
import json
import sys
from pathlib import Path

from pydantic import BaseModel, ValidationError

from maa_diagnostic_expert.benchmark import (
    BenchmarkAnnotation,
    BenchmarkCase,
    evaluate_benchmark_diagnosis,
)
from maa_diagnostic_expert.contracts.domain import DiagnosisResult
from maa_diagnostic_expert.reasoning.langchain import make_langchain_backend
from maa_diagnostic_expert.reasoning.model_config import parse_model_configuration_json


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="maa-diagnostic-benchmark")
    parser.add_argument("--case", type=Path, required=True)
    parser.add_argument("--annotation", type=Path, required=True)
    parser.add_argument("--diagnosis", type=Path, required=True)
    parser.add_argument("--judge-model-config", type=Path, required=True)
    parser.add_argument("--pass-threshold", type=float, default=0.7)
    parser.add_argument("--output", type=Path)
    return parser


def _load[ModelT: BaseModel](path: Path, model: type[ModelT]) -> ModelT:
    return model.model_validate_json(path.read_text(encoding="utf-8"))


def _run(args: argparse.Namespace) -> None:
    case = _load(args.case, BenchmarkCase)
    annotation = _load(args.annotation, BenchmarkAnnotation)
    diagnosis = _load(args.diagnosis, DiagnosisResult)
    config = parse_model_configuration_json(args.judge_model_config.read_text(encoding="utf-8"))
    result = asyncio.run(
        evaluate_benchmark_diagnosis(
            run_id=f"benchmark-{annotation.case_id}",
            case=case,
            annotation=annotation,
            diagnosis=diagnosis,
            judge_backend=make_langchain_backend(config),
            pass_threshold=args.pass_threshold,
        )
    )
    serialized = json.dumps(result.model_dump(mode="json"), ensure_ascii=False, indent=2) + "\n"
    if args.output is None:
        print(serialized, end="")
        return
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(serialized, encoding="utf-8")


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        _run(args)
    except (OSError, ValueError, ValidationError) as error:
        print(
            json.dumps(
                {"error": {"type": type(error).__name__, "message": str(error)}},
                ensure_ascii=False,
            ),
            file=sys.stderr,
        )
        return 2
    return 0
