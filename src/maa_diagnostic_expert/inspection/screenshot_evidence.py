from __future__ import annotations

import hashlib
import os
from pathlib import Path

from maa_diagnostic_expert.contracts.domain import (
    ArtifactAvailability,
    ArtifactKind,
    ArtifactMediaKind,
    ArtifactRecord,
    Evidence,
    EvidenceReliability,
    EvidenceRole,
    PreparedAnalysis,
)

_HEADER_BYTES = 64 * 1024
_PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"


def _image_path(record: ArtifactRecord) -> Path | None:
    candidates = [
        origin.path
        for origin in record.all_origins()
        if origin.kind is not ArtifactKind.DIRECTORY
        and origin.media_kind is ArtifactMediaKind.IMAGE
    ]
    if not candidates:
        return None
    return min(candidates, key=lambda path: (os.path.normcase(str(path)), str(path)))


def _jpeg_dimensions(payload: bytes) -> tuple[int, int] | None:
    offset = 2
    start_of_frame = {
        0xC0,
        0xC1,
        0xC2,
        0xC3,
        0xC5,
        0xC6,
        0xC7,
        0xC9,
        0xCA,
        0xCB,
        0xCD,
        0xCE,
        0xCF,
    }
    while offset + 3 < len(payload):
        if payload[offset] != 0xFF:
            offset += 1
            continue
        marker = payload[offset + 1]
        offset += 2
        if marker in {0xD8, 0xD9} or 0xD0 <= marker <= 0xD7:
            continue
        if offset + 2 > len(payload):
            return None
        segment_length = int.from_bytes(payload[offset : offset + 2], "big")
        if segment_length < 2 or offset + segment_length > len(payload):
            return None
        if marker in start_of_frame and segment_length >= 7:
            height = int.from_bytes(payload[offset + 3 : offset + 5], "big")
            width = int.from_bytes(payload[offset + 5 : offset + 7], "big")
            return (width, height) if width > 0 and height > 0 else None
        offset += segment_length
    return None


def _image_metadata(payload: bytes) -> tuple[str, int | None, int | None]:
    if payload.startswith(_PNG_SIGNATURE) and len(payload) >= 24:
        return (
            "image/png",
            int.from_bytes(payload[16:20], "big"),
            int.from_bytes(payload[20:24], "big"),
        )
    if payload.startswith(b"\xff\xd8"):
        dimensions = _jpeg_dimensions(payload)
        if dimensions is None:
            return "image/jpeg", None, None
        return "image/jpeg", dimensions[0], dimensions[1]
    if payload[:6] in {b"GIF87a", b"GIF89a"} and len(payload) >= 10:
        return (
            "image/gif",
            int.from_bytes(payload[6:8], "little"),
            int.from_bytes(payload[8:10], "little"),
        )
    if payload.startswith(b"BM") and len(payload) >= 26:
        width = abs(int.from_bytes(payload[18:22], "little", signed=True))
        height = abs(int.from_bytes(payload[22:26], "little", signed=True))
        return "image/bmp", width or None, height or None
    if payload.startswith(b"RIFF") and payload[8:12] == b"WEBP":
        return "image/webp", None, None
    return "application/octet-stream", None, None


def _screenshot_evidence_id(record: ArtifactRecord, sha256: str) -> str:
    digest = hashlib.sha256(f"{record.id}|{sha256}".encode()).hexdigest()[:20]
    return f"evidence:screenshot:{digest}"


def synthesize_screenshot_evidence(prepared: PreparedAnalysis) -> list[Evidence]:
    """Record bounded image facts without claiming to interpret screenshot pixels."""
    evidence: list[Evidence] = []
    for record in prepared.artifacts:
        image_path = _image_path(record)
        if image_path is None or record.availability is not ArtifactAvailability.AVAILABLE:
            continue
        try:
            digest = hashlib.sha256()
            header = b""
            with record.path.open("rb") as handle:
                while chunk := handle.read(1024 * 1024):
                    if not header:
                        header = chunk[:_HEADER_BYTES]
                    digest.update(chunk)
        except OSError:
            continue
        sha256 = digest.hexdigest()
        media_type, width, height = _image_metadata(header)
        dimensions = f"{width}x{height}" if width is not None and height is not None else "unknown"
        evidence.append(
            Evidence(
                id=_screenshot_evidence_id(record, sha256),
                kind="screenshot_artifact",
                source_component="screenshot-inspection",
                source_path=str(image_path),
                content=(
                    f"media_type={media_type}; dimensions={dimensions}; "
                    f"size_bytes={record.size_bytes or 0}; sha256={sha256}; "
                    "visual_content_interpreted=false"
                ),
                role=EvidenceRole.CONTEXT,
                reliability=EvidenceReliability.PRIMARY,
            )
        )
    return evidence
