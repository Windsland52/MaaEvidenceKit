from pathlib import Path

import pytest

from maa_diagnostic_expert.interfaces.tool_adapter import default_tool_adapter_path


def test_default_tool_adapter_path_still_resolves_from_repository_root(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("MDE_TOOL_ADAPTER_PATH", raising=False)
    repository_root = Path(__file__).resolve().parents[2]

    assert default_tool_adapter_path() == (
        repository_root / "packages" / "tool-adapter" / "dist" / "cli.js"
    )
