from __future__ import annotations

import argparse
import os
import shutil
import subprocess
import sys
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import cast

from pydantic import ValidationError

from maa_diagnostic_expert.reasoning.model_config import parse_model_configuration_json

from .studio import MODEL_CONFIG_ENV

LOCAL_MODEL_CONFIG = "model.local.json"


@dataclass(frozen=True)
class StudioLaunch:
    project_root: Path
    command: list[str]
    environment: dict[str, str]
    model_config: Path | None


def _port(value: str) -> int:
    try:
        port = int(value)
    except ValueError as error:
        raise argparse.ArgumentTypeError("port must be an integer") from error
    if not 1 <= port <= 65535:
        raise argparse.ArgumentTypeError("port must be between 1 and 65535")
    return port


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="maa-studio",
        description="Start the local MaaDiagnosticExpert graph in LangGraph Studio.",
    )
    model = parser.add_mutually_exclusive_group()
    model.add_argument(
        "--model-config",
        type=Path,
        help=f"Routed model configuration JSON; defaults to {LOCAL_MODEL_CONFIG} when present.",
    )
    model.add_argument(
        "--stub",
        action="store_true",
        help="Force the deterministic stub backend even when a model is configured.",
    )
    parser.add_argument("--port", type=_port, metavar="PORT")
    parser.add_argument("--no-browser", action="store_true")
    parser.add_argument("--no-reload", action="store_true")
    parser.add_argument(
        "langgraph_args",
        nargs=argparse.REMAINDER,
        metavar="-- LANGGRAPH_ARG ...",
        help="Additional arguments passed to `langgraph dev` after `--`.",
    )
    return parser


def discover_project_root(start: Path | None = None) -> Path:
    """Find a parent containing the committed Studio and Python project markers."""
    candidate = (Path.cwd() if start is None else start).expanduser().resolve()
    if candidate.is_file():
        candidate = candidate.parent
    for parent in (candidate, *candidate.parents):
        if (parent / "langgraph.json").is_file() and (parent / "pyproject.toml").is_file():
            return parent
    raise ValueError(
        "maa-studio must run inside a MaaDiagnosticExpert checkout containing "
        "langgraph.json and pyproject.toml"
    )


def _validated_model_config(path: Path, *, relative_to: Path) -> Path:
    candidate = path.expanduser()
    if not candidate.is_absolute():
        candidate = relative_to / candidate
    resolved = candidate.resolve()
    if not resolved.is_file():
        raise ValueError(f"Model configuration does not exist: {resolved}")
    parse_model_configuration_json(resolved.read_text(encoding="utf-8"))
    return resolved


def _configure_model(
    args: argparse.Namespace,
    *,
    project_root: Path,
    invocation_root: Path,
    environment: dict[str, str],
) -> Path | None:
    if cast(bool, args.stub):
        environment.pop(MODEL_CONFIG_ENV, None)
        return None

    explicit = cast(Path | None, args.model_config)
    if explicit is not None:
        configured = _validated_model_config(explicit, relative_to=invocation_root)
        environment[MODEL_CONFIG_ENV] = str(configured)
        return configured

    inherited = environment.get(MODEL_CONFIG_ENV)
    if inherited is not None and inherited.strip():
        configured = _validated_model_config(Path(inherited), relative_to=invocation_root)
        environment[MODEL_CONFIG_ENV] = str(configured)
        return configured

    local = project_root / LOCAL_MODEL_CONFIG
    if local.is_file():
        configured = _validated_model_config(local, relative_to=project_root)
        environment[MODEL_CONFIG_ENV] = str(configured)
        return configured

    environment.pop(MODEL_CONFIG_ENV, None)
    return None


def prepare_launch(
    args: argparse.Namespace,
    *,
    project_root: Path | None = None,
    invocation_root: Path | None = None,
    environ: Mapping[str, str] | None = None,
    executable: str | None = None,
) -> StudioLaunch:
    root = discover_project_root() if project_root is None else project_root.resolve()
    invoked_from = Path.cwd().resolve() if invocation_root is None else invocation_root.resolve()
    environment = dict(os.environ if environ is None else environ)
    environment["PYTHONUTF8"] = "1"
    environment["PYTHONIOENCODING"] = "utf-8"
    environment.setdefault("LANGGRAPH_CLI_NO_ANALYTICS", "1")
    environment.setdefault("LANGSMITH_TRACING", "false")
    model_config = _configure_model(
        args,
        project_root=root,
        invocation_root=invoked_from,
        environment=environment,
    )

    langgraph = shutil.which("langgraph") if executable is None else executable
    if langgraph is None:
        raise ValueError(
            "LangGraph CLI is unavailable; run `uv sync` to install the development dependencies"
        )
    command = [langgraph, "dev"]
    port = cast(int | None, args.port)
    if port is not None:
        command.extend(("--port", str(port)))
    if cast(bool, args.no_browser):
        command.append("--no-browser")
    if cast(bool, args.no_reload):
        command.append("--no-reload")
    extra_arguments = cast(list[str], args.langgraph_args)
    if extra_arguments[:1] == ["--"]:
        extra_arguments = extra_arguments[1:]
    command.extend(extra_arguments)
    return StudioLaunch(
        project_root=root,
        command=command,
        environment=environment,
        model_config=model_config,
    )


def _run(launch: StudioLaunch) -> int:
    backend = str(launch.model_config) if launch.model_config is not None else "deterministic stub"
    print(f"Project: {launch.project_root}")
    print(f"Model: {backend}")
    completed = subprocess.run(
        launch.command,
        cwd=launch.project_root,
        env=launch.environment,
        check=False,
    )
    return completed.returncode


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        return _run(prepare_launch(args))
    except (OSError, ValueError, ValidationError) as error:
        print(f"maa-studio: {error}", file=sys.stderr)
        return 2
    except KeyboardInterrupt:
        return 130
