from pathlib import Path

import pytest
from pydantic import ValidationError

from maa_diagnostic_expert.contracts.mse import (
    MseCompatibility,
    MseCompatibilityStatus,
    MseProjectPreflightResult,
)


def test_mse_project_preflight_contract_accepts_project_summary() -> None:
    result = MseProjectPreflightResult(
        project_root=Path("C:/project"),
        interface_path="assets/interface.json",
        syntax_mode="maafw",
        compatibility=MseCompatibility(
            status=MseCompatibilityStatus.SUPPORTED,
            reason="The interface and resource loaded.",
        ),
    )

    assert result.schema_version == "mde-mse-project-preflight/v1"


def test_mse_project_preflight_contract_rejects_adapter_camel_case() -> None:
    with pytest.raises(ValidationError):
        MseProjectPreflightResult.model_validate(
            {
                "projectRoot": "C:/project",
                "syntax_mode": "maafw",
                "compatibility": {
                    "status": "supported",
                    "reason": "Loaded.",
                },
            }
        )
