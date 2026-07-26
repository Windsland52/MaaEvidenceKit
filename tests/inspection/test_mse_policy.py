from pathlib import Path

import pytest

from maa_diagnostic_expert.contracts.mse import (
    MseCompatibility,
    MseCompatibilityStatus,
    MseProjectPreflightResult,
    MseSyntaxMode,
)
from maa_diagnostic_expert.inspection.mse_policy import apply_mse_project_policy


def test_mse_project_policy_rejects_adapter_syntax_mismatch() -> None:
    result = MseProjectPreflightResult(
        project_root=Path("C:/project"),
        syntax_mode=MseSyntaxMode.MAA,
        compatibility=MseCompatibility(
            status=MseCompatibilityStatus.SUPPORTED,
            reason="Loaded mechanically.",
        ),
    )

    with pytest.raises(ValueError, match="syntax mode mismatch"):
        apply_mse_project_policy(result, MseSyntaxMode.MAAFW)
