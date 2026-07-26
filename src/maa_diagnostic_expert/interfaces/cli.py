from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
from pathlib import Path
from typing import cast

from pydantic import BaseModel, ValidationError

from maa_diagnostic_expert.contracts.domain import (
    AnalysisRequest,
    DiagnosisResult,
    EvidenceQuery,
    EvidenceWindow,
    PreparedAnalysis,
    SourceRole,
)
from maa_diagnostic_expert.contracts.knowledge import WikiCatalogStatus
from maa_diagnostic_expert.discovery.preparation import prepare_analysis
from maa_diagnostic_expert.inspection.evidence_query import query_evidence
from maa_diagnostic_expert.inspection.models import DeterministicInspection
from maa_diagnostic_expert.inspection.service import inspect_analysis
from maa_diagnostic_expert.knowledge.catalog import (
    DEFAULT_WIKI_GITHUB_REPOSITORY,
    catalog_source_input,
    resolve_github_wiki_catalog,
    resolve_remote_wiki_catalog,
    resolve_wiki_catalog,
)
from maa_diagnostic_expert.reasoning.langchain import make_langchain_backend
from maa_diagnostic_expert.reasoning.model_config import ModelConfig
from maa_diagnostic_expert.reasoning.prompts import make_stub_backend
from maa_diagnostic_expert.workflow.graph import DiagnosticWorkflow
from maa_diagnostic_expert.workflow.validation import validate_result_against_inspection

from .report import render_markdown_report
from .tool_adapter import (
    JsonlToolAdapterClient,
    default_tool_adapter_path,
)


def _add_output_argument(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--output", type=Path)


def _add_wiki_arguments(parser: argparse.ArgumentParser) -> None:
    location = parser.add_mutually_exclusive_group()
    location.add_argument(
        "--wiki",
        type=Path,
        help="MaaLLMWiki checkout, extracted snapshot, or catalog ZIP.",
    )
    location.add_argument(
        "--wiki-url",
        help="HTTPS URL for a MaaLLMWiki catalog ZIP.",
    )
    location.add_argument(
        "--wiki-latest",
        action="store_true",
        help="Discover the latest catalog from the default MaaLLMWiki GitHub Release.",
    )
    location.add_argument(
        "--wiki-github-repository",
        metavar="OWNER/REPOSITORY",
        help="Discover the latest versioned catalog from a GitHub Release.",
    )
    parser.add_argument("--wiki-cache", type=Path)
    parser.add_argument(
        "--wiki-sha256",
        help="Expected SHA-256 of the remote catalog ZIP.",
    )
    network = parser.add_mutually_exclusive_group()
    network.add_argument(
        "--wiki-refresh",
        action="store_true",
        help="Download the remote catalog again even when its URL is cached.",
    )
    network.add_argument(
        "--wiki-offline",
        action="store_true",
        help="Require an already cached remote catalog and do not access the network.",
    )


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="maa-diagnostic-expert")
    commands = parser.add_subparsers(dest="command", required=True)

    prepare = commands.add_parser("prepare")
    prepare.add_argument("--request", type=Path, required=True)
    _add_wiki_arguments(prepare)
    _add_output_argument(prepare)

    inspect = commands.add_parser("inspect")
    inspect.add_argument("--request", type=Path, required=True)
    inspect.add_argument("--tool-adapter", type=Path)
    _add_wiki_arguments(inspect)
    _add_output_argument(inspect)

    query = commands.add_parser("query-evidence")
    query.add_argument("--prepared", type=Path, required=True)
    query.add_argument("--request", type=Path, required=True)
    _add_output_argument(query)

    diagnose = commands.add_parser("diagnose")
    diagnose.add_argument("--request", type=Path, required=True)
    diagnose.add_argument("--tool-adapter", type=Path)
    _add_wiki_arguments(diagnose)
    diagnose.add_argument(
        "--model-config",
        type=Path,
        help="Optional ModelConfig JSON; omit to use the deterministic stub backend.",
    )
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
    diagnose.add_argument(
        "--fix-plan",
        type=Path,
        help="Optional path to write the validated FixCandidatePlan JSON.",
    )
    diagnose.add_argument(
        "--verification-plan",
        type=Path,
        help="Optional path to write the validated VerificationPlanSet JSON.",
    )
    _add_output_argument(diagnose)

    validate = commands.add_parser("validate-result")
    validate.add_argument("--input", type=Path, required=True)
    validate.add_argument("--inspection", type=Path, required=True)
    validate.add_argument(
        "--evidence-window",
        type=Path,
        action="append",
        default=[],
        help="Additional authoritative EvidenceWindow; may be repeated.",
    )
    _add_output_argument(validate)

    knowledge_status = commands.add_parser("knowledge-status")
    _add_wiki_arguments(knowledge_status)
    _add_output_argument(knowledge_status)
    return parser


def _load_model[ModelT: BaseModel](path: Path, model: type[ModelT]) -> ModelT:
    return model.model_validate_json(path.read_text(encoding="utf-8"))


def _load_prepared_context(path: Path) -> PreparedAnalysis:
    serialized = path.read_text(encoding="utf-8")
    try:
        return PreparedAnalysis.model_validate_json(serialized)
    except ValidationError:
        try:
            return DeterministicInspection.model_validate_json(serialized).prepared
        except ValidationError as error:
            raise ValueError(
                "Expected a PreparedAnalysis or DeterministicInspection context."
            ) from error


def _resolve_wiki_argument(args: argparse.Namespace) -> WikiCatalogStatus | None:
    wiki = cast(Path | None, getattr(args, "wiki", None))
    url = cast(str | None, getattr(args, "wiki_url", None))
    latest = cast(bool, getattr(args, "wiki_latest", False))
    repository = cast(str | None, getattr(args, "wiki_github_repository", None))
    expected_sha256 = cast(str | None, getattr(args, "wiki_sha256", None))
    refresh = cast(bool, getattr(args, "wiki_refresh", False))
    offline = cast(bool, getattr(args, "wiki_offline", False))
    cache = cast(Path | None, getattr(args, "wiki_cache", None))
    if wiki is not None:
        if expected_sha256 is not None or refresh or offline:
            raise ValueError("Remote Wiki options require --wiki-url, not --wiki")
        return resolve_wiki_catalog(wiki, cache_root=cache)
    if latest:
        repository = DEFAULT_WIKI_GITHUB_REPOSITORY
    repository = repository or os.environ.get("MDE_WIKI_GITHUB_REPOSITORY")
    configured_url = url or os.environ.get("MDE_WIKI_CATALOG_URL")
    if repository is not None and configured_url is not None and not latest:
        raise ValueError(
            "Configure only one of a GitHub Wiki repository and a direct Wiki catalog URL"
        )
    if repository is not None:
        return resolve_github_wiki_catalog(
            repository,
            cache_root=cache,
            expected_sha256=expected_sha256 or os.environ.get("MDE_WIKI_CATALOG_SHA256"),
            refresh=refresh,
            offline=offline,
        )
    if configured_url is None:
        if expected_sha256 is not None or refresh or offline:
            raise ValueError(
                "Remote Wiki options require --wiki-latest, --wiki-url, or a Wiki environment "
                "configuration"
            )
        return None
    return resolve_remote_wiki_catalog(
        configured_url,
        cache_root=cache,
        expected_sha256=expected_sha256 or os.environ.get("MDE_WIKI_CATALOG_SHA256"),
        refresh=refresh,
        offline=offline,
    )


def _attach_wiki(request: AnalysisRequest, args: argparse.Namespace) -> AnalysisRequest:
    status = _resolve_wiki_argument(args)
    if status is None:
        return request
    if any(source.role is SourceRole.WIKI for source in request.sources):
        raise ValueError("AnalysisRequest already contains an explicit Wiki source")
    return request.model_copy(update={"sources": [*request.sources, catalog_source_input(status)]})


def _load_request(args: argparse.Namespace) -> AnalysisRequest:
    request = _load_model(cast(Path, args.request), AnalysisRequest)
    return _attach_wiki(request, args)


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
    request = _load_request(args)
    adapter_path = _resolve_adapter_path(cast(Path | None, args.tool_adapter))
    model_config_path = cast(Path | None, args.model_config)
    reasoning_backend = (
        make_langchain_backend(_load_model(model_config_path, ModelConfig))
        if model_config_path is not None
        else make_stub_backend()
    )
    workflow = DiagnosticWorkflow(
        tool_caller=JsonlToolAdapterClient(adapter_path=adapter_path),
        reasoning_backend=reasoning_backend,
    )
    events_path = cast(Path | None, args.events)
    output = cast(Path | None, args.output)
    fmt = cast(str, args.format)
    if events_path is not None:
        events_path.parent.mkdir(parents=True, exist_ok=True)
        result = asyncio.run(_stream_to_file(workflow, request, events_path))
    else:
        result = asyncio.run(workflow.diagnose(request))
    fix_plan_path = cast(Path | None, args.fix_plan)
    if fix_plan_path is not None:
        if workflow.fix_candidate_plan is None:
            raise RuntimeError("workflow completed without producing a fix candidate plan")
        _emit_model(workflow.fix_candidate_plan, fix_plan_path)
    verification_plan_path = cast(Path | None, args.verification_plan)
    if verification_plan_path is not None:
        if workflow.verification_plan_set is None:
            raise RuntimeError("workflow completed without producing a verification plan set")
        _emit_model(workflow.verification_plan_set, verification_plan_path)
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
        request = _load_request(args)
        _emit_model(prepare_analysis(request), output)
        return
    if command == "inspect":
        request = _load_request(args)
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
        prepared = _load_prepared_context(cast(Path, args.prepared))
        request = _load_model(cast(Path, args.request), EvidenceQuery)
        _emit_model(query_evidence(prepared, request), output)
        return
    if command == "validate-result":
        result = _load_model(cast(Path, args.input), DiagnosisResult)
        inspection = _load_model(cast(Path, args.inspection), DeterministicInspection)
        windows = [
            _load_model(path, EvidenceWindow).evidence
            for path in cast(list[Path], args.evidence_window)
        ]
        _emit_model(validate_result_against_inspection(result, inspection, windows), output)
        return
    if command == "knowledge-status":
        status = _resolve_wiki_argument(args)
        if status is None:
            raise ValueError(
                "knowledge-status requires a local Wiki, direct URL, GitHub repository, or Wiki "
                "environment configuration"
            )
        _emit_model(status, output)
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
