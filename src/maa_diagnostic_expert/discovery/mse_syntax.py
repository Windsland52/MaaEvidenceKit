from pathlib import Path

from maa_diagnostic_expert.contracts.mse import MseSyntaxMode

MAA_CORE_MARKER = Path("src") / "MaaCore"


def detect_mse_syntax_mode(project_root: Path) -> MseSyntaxMode:
    """Identify the MSE parser mode from project-owned source markers."""

    if (project_root / MAA_CORE_MARKER).is_dir():
        return MseSyntaxMode.MAA
    return MseSyntaxMode.MAAFW
