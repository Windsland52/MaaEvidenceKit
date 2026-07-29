from __future__ import annotations

from pathlib import Path

import pytest

from maa_diagnostic_expert.interfaces import studio_cli
from maa_diagnostic_expert.reasoning.model_config import ModelConfig


def _project_root(path: Path) -> Path:
    path.mkdir()
    (path / "langgraph.json").write_text("{}", encoding="utf-8")
    (path / "pyproject.toml").write_text("", encoding="utf-8")
    return path


def test_discover_project_root_requires_both_markers(tmp_path: Path) -> None:
    root = _project_root(tmp_path / "project")
    nested = root / "src" / "package"
    nested.mkdir(parents=True)

    assert studio_cli.discover_project_root(nested) == root


def test_parser_rejects_invalid_port() -> None:
    with pytest.raises(SystemExit):
        studio_cli.build_parser().parse_args(["--port", "65536"])


def test_prepare_launch_discovers_local_model_config(tmp_path: Path) -> None:
    root = _project_root(tmp_path / "project")
    model_path = root / studio_cli.LOCAL_MODEL_CONFIG
    model_path.write_text(
        ModelConfig(
            provider="openai",
            model="test-model",
            api_key="local-secret",
        ).model_dump_json(),
        encoding="utf-8",
    )
    args = studio_cli.build_parser().parse_args(["--port", "8123", "--no-browser"])

    launch = studio_cli.prepare_launch(
        args,
        project_root=root,
        invocation_root=root,
        environ={},
        executable="langgraph",
    )

    assert launch.model_config == model_path
    assert launch.environment[studio_cli.MODEL_CONFIG_ENV] == str(model_path)
    assert launch.environment["PYTHONUTF8"] == "1"
    assert launch.environment["LANGGRAPH_CLI_NO_ANALYTICS"] == "1"
    assert launch.command == ["langgraph", "dev", "--port", "8123", "--no-browser"]


def test_prepare_launch_stub_overrides_inherited_model_config(tmp_path: Path) -> None:
    root = _project_root(tmp_path / "project")
    args = studio_cli.build_parser().parse_args(["--stub", "--no-reload", "--", "--tunnel"])

    launch = studio_cli.prepare_launch(
        args,
        project_root=root,
        invocation_root=root,
        environ={studio_cli.MODEL_CONFIG_ENV: "missing.json"},
        executable="langgraph",
    )

    assert launch.model_config is None
    assert studio_cli.MODEL_CONFIG_ENV not in launch.environment
    assert launch.command == ["langgraph", "dev", "--no-reload", "--tunnel"]


def test_prepare_launch_rejects_invalid_local_model_config(tmp_path: Path) -> None:
    root = _project_root(tmp_path / "project")
    (root / studio_cli.LOCAL_MODEL_CONFIG).write_text("{}", encoding="utf-8")
    args = studio_cli.build_parser().parse_args([])

    with pytest.raises(ValueError):
        studio_cli.prepare_launch(
            args,
            project_root=root,
            invocation_root=root,
            environ={},
            executable="langgraph",
        )
