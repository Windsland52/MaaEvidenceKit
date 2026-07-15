from __future__ import annotations

import argparse
import json
from pathlib import Path

from .domain import AnalysisRequest
from .inputs import resolve_project_root


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="maa-diagnostic-expert")
    parser.add_argument("--issue")
    parser.add_argument("--project-root", type=Path)
    parser.add_argument("--revision")
    parser.add_argument("--question")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    project_root = resolve_project_root(args.project_root)
    request = AnalysisRequest(
        issue=args.issue,
        project_root=project_root,
        revision=args.revision,
        question=args.question,
    )
    print(json.dumps(request.model_dump(mode="json"), ensure_ascii=False, indent=2))
    return 0
