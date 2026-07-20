from __future__ import annotations

import argparse
import asyncio
import json
import sys
from pathlib import Path
from typing import cast

from pydantic import BaseModel, ValidationError

from .domain import AnalysisRequest, DiagnosisResult, EvidenceQuery, PreparedAnalysis
from .evidence_query import query_evidence
from .inspection import inspect_analysis
from .preparation import prepare_analysis
from .reasoning import make_stub_backend
from .report import render_markdown_report
from .tool_adapter_client import (
    JsonlToolAdapterClient,
    default_tool_adapter_path,
)
from .workflow import DiagnosticWorkflow


def _add_output_argument(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--output", type=Path)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="maa-diagnostic-expert")
    commands = parser.add_subparsers(dest="command", required=True)

    prepare = commands.add_parser("prepare")
    prepare.add_argument("--request", type=Path, required=True)
    _add_output_argument(prepare)

    inspect = commands.add_parser("inspect")
    inspect.add_argument("--request", type=Path, required=True)
    inspect.add_argument("--tool-adapter", type=Path)
    _add_output_argument(inspect)

    query = commands.add_parser("query-evidence")
    query.add_argument("--prepared", type=Path, required=True)
    query.add_argument("--request", type=Path, required=True)
    _add_output_argument(query)

    diagnose = commands.add_parser("diagnose")
    diagnose.add_argument("--request", type=Path, required=True)
    diagnose.add_argument("--tool-adapter", type=Path)
    diagnose.add_argument(
        "--format",
        choices=["json", "markdown"],
        default="json",
        help="Output format for the diagnosis result.",
    )
    diagnose.add_argument(
        "--events",
        type=Path,
        help="Optional path to write the diagnostic event stream as JSON lines.",
    )
    _add_output_argument(diagnose)

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


def _emit_text(text: str, output: Path | None) -> None:
    if output is None:
        print(text, end="")
        return
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(text, encoding="utf-8")


def _resolve_adapter_path(configured: Path | None) -> Path:
    return configured or default_tool_adapter_path()


def _run_diagnose(args: argparse.Namespace) -> None:
    request = _load_model(cast(Path, args.request), AnalysisRequest)
    adapter_path = _resolve_adapter_path(cast(Path | None, args.tool_adapter))
    workflow = DiagnosticWorkflow(
        tool_caller=JsonlToolAdapterClient(adapter_path=adapter_path),
        reasoning_backend=make_stub_backend(),
    )
    events_path = cast(Path | None, args.events)
    output = cast(Path | None, args.output)
    fmt = cast(str, args.format)
    if events_path is not None:
        events_path.parent.mkdir(parents=True, exist_ok=True)
        result = asyncio.run(_stream_to_file(workflow, request, events_path))
    else:
        result = asyncio.run(workflow.diagnose(request))
    if fmt == "markdown":
        _emit_text(render_markdown_report(result), output)
    else:
        _emit_model(result, output)


async def _stream_to_file(
    workflow: DiagnosticWorkflow,
    request: AnalysisRequest,
    events_path: Path,
) -> DiagnosisResult:
    with events_path.open("w", encoding="utf-8") as handle:
        async for event in workflow.stream(request):
            handle.write(
                json.dumps(event.model_dump(mode="json"), ensure_ascii=False) + "\n",
            )
    if workflow.result is None:
        raise RuntimeError("workflow completed without producing a result")
    return workflow.result


def _run_command(args: argparse.Namespace) -> None:
    command = cast(str, args.command)
    output = cast(Path | None, args.output)
    if command == "prepare":
        request = _load_model(cast(Path, args.request), AnalysisRequest)
        _emit_model(prepare_analysis(request), output)
        return
    if command == "inspect":
        request = _load_model(cast(Path, args.request), AnalysisRequest)
        adapter_path = _resolve_adapter_path(cast(Path | None, args.tool_adapter))
        _emit_model(
            inspect_analysis(request, JsonlToolAdapterClient(adapter_path=adapter_path)),
            output,
        )
        return
    if command == "diagnose":
        _run_diagnose(args)
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
