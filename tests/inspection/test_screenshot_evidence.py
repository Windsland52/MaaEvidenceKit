from __future__ import annotations

import hashlib
from pathlib import Path

from maa_diagnostic_expert.contracts.domain import (
    AnalysisRequest,
    ArtifactInput,
    ArtifactKind,
    EvidenceReliability,
    EvidenceRole,
)
from maa_diagnostic_expert.discovery.preparation import prepare_analysis
from maa_diagnostic_expert.inspection.screenshot_evidence import synthesize_screenshot_evidence


def _png_header(width: int, height: int) -> bytes:
    return (
        b"\x89PNG\r\n\x1a\n"
        + b"\x00\x00\x00\rIHDR"
        + width.to_bytes(4, "big")
        + height.to_bytes(4, "big")
        + b"\x08\x06\x00\x00\x00"
    )


def test_screenshot_is_synthesized_as_traceable_primary_context(tmp_path: Path) -> None:
    screenshot = tmp_path / "on_error.png"
    payload = _png_header(1280, 720)
    screenshot.write_bytes(payload)
    prepared = prepare_analysis(
        AnalysisRequest(
            question="What is visible in the screenshot?",
            artifacts=[ArtifactInput(path=screenshot, kind=ArtifactKind.FILE)],
        )
    )

    [evidence] = synthesize_screenshot_evidence(prepared)

    assert evidence.kind == "screenshot_artifact"
    assert evidence.source_path == str(screenshot)
    assert evidence.role is EvidenceRole.CONTEXT
    assert evidence.reliability is EvidenceReliability.PRIMARY
    assert "media_type=image/png" in evidence.content
    assert "dimensions=1280x720" in evidence.content
    assert f"sha256={hashlib.sha256(payload).hexdigest()}" in evidence.content
    assert "visual_content_interpreted=false" in evidence.content


def test_screenshot_aliases_produce_one_evidence_record(tmp_path: Path) -> None:
    screenshot = tmp_path / "first.png"
    alias = tmp_path / "second.jpg"
    screenshot.write_bytes(_png_header(10, 20))
    try:
        alias.hardlink_to(screenshot)
    except OSError as error:
        import pytest

        pytest.skip(f"Hard links are unavailable on this filesystem: {error}")
    prepared = prepare_analysis(
        AnalysisRequest(
            question="Inspect screenshots.",
            artifacts=[
                ArtifactInput(path=screenshot, kind=ArtifactKind.FILE),
                ArtifactInput(path=alias, kind=ArtifactKind.FILE),
            ],
        )
    )

    evidence = synthesize_screenshot_evidence(prepared)

    assert len(evidence) == 1


def test_non_image_artifacts_do_not_produce_screenshot_evidence(tmp_path: Path) -> None:
    log = tmp_path / "maafw.log"
    log.write_text("log", encoding="utf-8")
    prepared = prepare_analysis(
        AnalysisRequest(
            question="Inspect log.",
            artifacts=[ArtifactInput(path=log, kind=ArtifactKind.FILE)],
        )
    )

    assert synthesize_screenshot_evidence(prepared) == []
