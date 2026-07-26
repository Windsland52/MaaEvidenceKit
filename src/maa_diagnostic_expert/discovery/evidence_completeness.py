from __future__ import annotations

import os
from pathlib import Path

from maa_diagnostic_expert.contracts.domain import (
    ArtifactAvailability,
    ArtifactKind,
    ArtifactMediaKind,
    ArtifactOrigin,
    ArtifactRecord,
    MissingEvidence,
)


def _is_explicit_zip(origin: ArtifactOrigin) -> bool:
    return (
        origin.input_path == origin.path
        and origin.media_kind is ArtifactMediaKind.ARCHIVE
        and origin.path.suffix.lower() == ".zip"
    )


def _representative_screenshot(record: ArtifactRecord) -> Path | None:
    if record.availability is not ArtifactAvailability.AVAILABLE:
        return None
    screenshots = [
        origin.path
        for origin in record.all_origins()
        if origin.kind is not ArtifactKind.DIRECTORY
        and origin.media_kind is ArtifactMediaKind.IMAGE
    ]
    if not screenshots:
        return None
    return min(
        screenshots,
        key=lambda path: (os.path.normcase(str(path)), str(path)),
    )


def collect_artifact_completeness_missing_evidence(
    records: list[ArtifactRecord],
) -> list[MissingEvidence]:
    """Report evidence combinations that cannot support source-level diagnosis."""
    available_records = [
        record for record in records if record.availability is ArtifactAvailability.AVAILABLE
    ]
    screenshot_records = [
        (record, screenshot)
        for record in available_records
        if (screenshot := _representative_screenshot(record)) is not None
    ]
    screenshots = [screenshot for _, screenshot in screenshot_records]
    screenshots.sort(
        key=lambda path: (os.path.normcase(str(path)), str(path)),
    )
    if not screenshots:
        return []
    screenshot_record_ids = {record.id for record, _ in screenshot_records}
    source_records = [
        record for record in available_records if record.id not in screenshot_record_ids
    ]
    if any(
        origin.kind is not ArtifactKind.DIRECTORY and origin.media_kind is ArtifactMediaKind.LOG
        for record in source_records
        for origin in record.all_origins()
    ):
        return []
    if any(
        _is_explicit_zip(origin) for record in source_records for origin in record.all_origins()
    ):
        return []
    return [
        MissingEvidence(
            code="screenshot_source_logs_missing",
            message=(
                f"{len(screenshots)} screenshot artifact(s) were supplied without an available "
                "source log or an explicit ZIP that can be inspected for source logs."
            ),
            source_path=screenshots[0],
        )
    ]
