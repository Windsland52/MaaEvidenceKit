from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import cast

from pydantic import BaseModel, ValidationError

from .domain import AnalysisRequest, DiagnosisResult, EvidenceQuery, PreparedAnalysis
from .evidence_query import query_evidence
from .preparation import prepare_analysis


def _add_output_argument(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--output", type=Path)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="maa-diagnostic-expert")
    commands = parser.add_subparsers(dest="command", required=True)

    prepare = commands.add_parser("prepare")
    prepare.add_argument("--request", type=Path, required=True)
    _add_output_argument(prepare)

    query = commands.add_parser("query-evidence")
    query.add_argument("--prepared", type=Path, required=True)
    query.add_argument("--request", type=Path, required=True)
    _add_output_argument(query)

    validate = commands.add_parser("validate-result")
    validate.add_argument("--input", type=Path, required=True)
    _add_output_argument(validate)
    return parser


def _load_model[ModelT: BaseModel](path: Path, model: type[ModelT]) -> ModelT:
    return model.model_validate_json(path.read_text(encoding="utf-8"))


def _emit_model(model: BaseModel, output: Path | None) -> None:
    serialized = json.dumps(model.model_dump(mode="json"), ensure_ascii=False, indent=2) + "\n"
    if output is None:
        print(serialized, end="")
        return
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(serialized, encoding="utf-8")


def _run_command(args: argparse.Namespace) -> None:
    command = cast(str, args.command)
    output = cast(Path | None, args.output)
    if command == "prepare":
        request = _load_model(cast(Path, args.request), AnalysisRequest)
        _emit_model(prepare_analysis(request), output)
        return
    if command == "query-evidence":
        prepared = _load_model(cast(Path, args.prepared), PreparedAnalysis)
        request = _load_model(cast(Path, args.request), EvidenceQuery)
        _emit_model(query_evidence(prepared, request), output)
        return
    if command == "validate-result":
        result = _load_model(cast(Path, args.input), DiagnosisResult)
        _emit_model(result, output)
        return
    raise ValueError(f"Unsupported command: {command}")


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        _run_command(args)
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
