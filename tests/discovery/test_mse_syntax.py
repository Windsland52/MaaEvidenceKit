from pathlib import Path

from maa_diagnostic_expert.contracts.mse import MseSyntaxMode
from maa_diagnostic_expert.discovery.mse_syntax import detect_mse_syntax_mode


def test_detect_mse_syntax_defaults_to_maafw(tmp_path: Path) -> None:
    assert detect_mse_syntax_mode(tmp_path) is MseSyntaxMode.MAAFW


def test_detect_mse_syntax_identifies_maa_core_source_tree(tmp_path: Path) -> None:
    (tmp_path / "src" / "MaaCore").mkdir(parents=True)

    assert detect_mse_syntax_mode(tmp_path) is MseSyntaxMode.MAA
