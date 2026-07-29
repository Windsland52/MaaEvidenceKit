from __future__ import annotations

import json
import zipfile
from pathlib import Path

from maa_diagnostic_expert.contracts.domain import AnalysisRequest, ArtifactInput, ArtifactKind
from maa_diagnostic_expert.contracts.mla import MlaPreflightResult
from maa_diagnostic_expert.contracts.mse import MseProjectPreflightResult
from maa_diagnostic_expert.inspection.service import inspect_analysis
from maa_diagnostic_expert.interfaces.tool_adapter import (
    JsonlToolAdapterClient,
    default_tool_adapter_path,
)


def _bundled_client() -> JsonlToolAdapterClient:
    return JsonlToolAdapterClient(
        adapter_path=default_tool_adapter_path(),
        timeout_seconds=30,
    )


def test_python_client_calls_bundled_mla_adapter_across_process(tmp_path: Path) -> None:
    log_path = tmp_path / "maafw.log"
    log_path.write_text(
        "\n".join(
            [
                "[2026-07-19 10:00:00.000][DBG][Px1][Tx1][Logger] MAA Process Start",
                "[2026-07-19 10:00:00.001][DBG][Px1][Tx1][Logger] Version v5.11.1",
                "[2026-07-19 10:00:01.000][INF][Px1][Tx1][Tasker] no notify event",
            ]
        ),
        encoding="utf-8",
    )

    raw_result = _bundled_client().call("mla.preflight", {"path": str(log_path)})
    result = MlaPreflightResult.model_validate(raw_result)

    assert result.framework.versions == ["v5.11.1"]
    assert result.framework.sessions[0].version_evidence[0].line == 2


def test_bundled_mla_archive_limit_failure_becomes_missing_evidence(
    tmp_path: Path,
) -> None:
    archive_path = tmp_path / "debug.zip"
    with zipfile.ZipFile(
        archive_path,
        mode="w",
        compression=zipfile.ZIP_DEFLATED,
        compresslevel=9,
    ) as archive:
        archive.writestr("maafw.log", b"0" * (2 * 1024 * 1024))

    inspection = inspect_analysis(
        AnalysisRequest(artifacts=[ArtifactInput(path=archive_path, kind=ArtifactKind.ARCHIVE)]),
        _bundled_client(),
    )

    failures = [
        item for item in inspection.prepared.missing_evidence if item.code == "mla_preflight_failed"
    ]
    assert len(failures) == 1
    assert "compression-ratio" in failures[0].message
    assert failures[0].source_path == archive_path.resolve()
    assert inspection.mla_preflights == []
    assert inspection.mla_runtime_inspections == []


def test_python_client_calls_bundled_mse_adapter_across_process(tmp_path: Path) -> None:
    (tmp_path / "interface.json").write_text(json.dumps({}), encoding="utf-8")

    raw_result = _bundled_client().call(
        "mse.project-preflight",
        {"path": str(tmp_path), "syntax_mode": "maafw"},
    )
    result = MseProjectPreflightResult.model_validate(raw_result)

    assert result.project_root == tmp_path.resolve()
    assert result.interface_path == "interface.json"
    assert result.syntax_mode.value == "maafw"
