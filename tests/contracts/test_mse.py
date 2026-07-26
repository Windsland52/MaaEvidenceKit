from pathlib import Path

import pytest
from pydantic import ValidationError

from maa_diagnostic_expert.contracts.mse import (
    MseCompatibility,
    MseCompatibilityStatus,
    MseProjectPreflightResult,
    MseSyntaxMode,
    MseTaskResolutionResult,
)


def test_mse_project_preflight_contract_accepts_project_summary() -> None:
    result = MseProjectPreflightResult(
        project_root=Path("C:/project"),
        interface_path="assets/interface.json",
        syntax_mode=MseSyntaxMode.MAAFW,
        compatibility=MseCompatibility(
            status=MseCompatibilityStatus.SUPPORTED,
            reason="The interface and resource loaded.",
        ),
    )

    assert result.schema_version == "mde-mse-project-preflight/v2"
    assert result.syntax_mode is MseSyntaxMode.MAAFW


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


def test_mse_task_resolution_contract_accepts_source_locations() -> None:
    result = MseTaskResolutionResult.model_validate(
        {
            "project_root": "C:/project",
            "interface_path": "assets/interface.json",
            "syntax_mode": "maafw",
            "compatibility": {
                "status": "supported",
                "reason": "Loaded.",
            },
            "requested_tasks": ["LoginButton"],
            "resolutions": [
                {
                    "name": "LoginButton",
                    "controller": "Adb",
                    "resource": "Official",
                    "found": True,
                    "definitions": [
                        {
                            "source_path": "assets/pipeline/login.json",
                            "line": 12,
                            "column": 3,
                            "raw_config": {"recognition": "OCR"},
                        }
                    ],
                    "effective_config": {
                        "recognition": "OCR",
                        "expected": ["Login"],
                    },
                    "references": [],
                }
            ],
        }
    )

    assert result.resolutions[0].definitions[0].line == 12
    assert result.schema_version == "mde-mse-task-resolution/v2"
