from __future__ import annotations

import hashlib
import os
import struct
from datetime import UTC, datetime
from pathlib import Path
from typing import BinaryIO

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

_MINIDUMP_SIGNATURE = b"MDMP"
_MINIDUMP_HEADER_SIZE = 32
_DIRECTORY_ENTRY_SIZE = 12
_EXCEPTION_STREAM = 6
_SYSTEM_INFO_STREAM = 7
_MAX_STREAMS = 4096
_MAX_HASH_BYTES = 256 * 1024 * 1024

_PROCESSOR_ARCHITECTURES = {
    0: "x86",
    5: "arm",
    6: "ia64",
    9: "x64",
    12: "arm64",
}


def _dump_path(record: ArtifactRecord) -> Path | None:
    candidates = [
        origin.path
        for origin in record.all_origins()
        if origin.kind is not ArtifactKind.DIRECTORY and origin.media_kind is ArtifactMediaKind.DUMP
    ]
    if not candidates:
        return None
    return min(candidates, key=lambda path: (os.path.normcase(str(path)), str(path)))


def _read_at(handle: BinaryIO, offset: int, size: int, file_size: int) -> bytes | None:
    if offset < 0 or size < 0 or offset + size > file_size:
        return None
    handle.seek(offset)
    payload = handle.read(size)
    return payload if len(payload) == size else None


def _parse_minidump(path: Path) -> tuple[dict[str, str], bool]:
    file_size = path.stat().st_size
    with path.open("rb") as handle:
        header = _read_at(handle, 0, _MINIDUMP_HEADER_SIZE, file_size)
        if header is None or not header.startswith(_MINIDUMP_SIGNATURE):
            return {"parse_status": "invalid_signature"}, False
        _, version, stream_count, directory_rva, _, timestamp, flags = struct.unpack(
            "<4sIIIIIQ", header
        )
        facts = {
            "parse_status": "valid_minidump",
            "format_version": f"0x{version:08x}",
            "stream_count": str(stream_count),
            "timestamp_utc": datetime.fromtimestamp(timestamp, tz=UTC).isoformat(),
            "flags": f"0x{flags:016x}",
        }
        if stream_count > _MAX_STREAMS:
            facts["parse_status"] = "stream_limit_exceeded"
            return facts, False
        directory_size = stream_count * _DIRECTORY_ENTRY_SIZE
        directory = _read_at(handle, directory_rva, directory_size, file_size)
        if directory is None:
            facts["parse_status"] = "invalid_stream_directory"
            return facts, False

        exception_found = False
        for offset in range(0, len(directory), _DIRECTORY_ENTRY_SIZE):
            stream_type, data_size, rva = struct.unpack_from("<III", directory, offset)
            if stream_type == _EXCEPTION_STREAM and data_size >= 32:
                payload = _read_at(handle, rva, 32, file_size)
                if payload is None:
                    facts["exception_stream"] = "invalid_location"
                    continue
                thread_id, _, code, exception_flags = struct.unpack_from("<IIII", payload)
                exception_address = struct.unpack_from("<Q", payload, 24)[0]
                facts.update(
                    {
                        "exception_thread_id": str(thread_id),
                        "exception_code": f"0x{code:08x}",
                        "exception_flags": f"0x{exception_flags:08x}",
                        "exception_address": f"0x{exception_address:016x}",
                    }
                )
                exception_found = True
            elif stream_type == _SYSTEM_INFO_STREAM and data_size >= 24:
                payload = _read_at(handle, rva, 24, file_size)
                if payload is None:
                    facts["system_info_stream"] = "invalid_location"
                    continue
                architecture = struct.unpack_from("<H", payload)[0]
                major, minor, build, platform = struct.unpack_from("<IIII", payload, 8)
                facts.update(
                    {
                        "processor_architecture": _PROCESSOR_ARCHITECTURES.get(
                            architecture, f"unknown_{architecture}"
                        ),
                        "os_version": f"{major}.{minor}.{build}",
                        "platform_id": str(platform),
                    }
                )
        facts["exception_stream"] = "present" if exception_found else "absent"
        return facts, exception_found


def _sha256(path: Path, size_bytes: int) -> str:
    if size_bytes > _MAX_HASH_BYTES:
        return f"not_computed:file_exceeds_{_MAX_HASH_BYTES}_bytes"
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        while chunk := handle.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def synthesize_dump_evidence(prepared: PreparedAnalysis) -> list[Evidence]:
    """Extract direct Minidump facts without inferring a root cause."""
    evidence: list[Evidence] = []
    for record in prepared.artifacts:
        source_path = _dump_path(record)
        if source_path is None or record.availability is not ArtifactAvailability.AVAILABLE:
            continue
        try:
            facts, has_exception = _parse_minidump(record.path)
            facts["size_bytes"] = str(record.size_bytes or 0)
            facts["sha256"] = _sha256(record.path, record.size_bytes or 0)
        except (OSError, OverflowError, ValueError) as error:
            facts = {"parse_status": f"unreadable:{type(error).__name__}"}
            has_exception = False
        rendered = "; ".join(f"{key}={value}" for key, value in facts.items())
        digest = hashlib.sha256(f"{record.id}|{rendered}".encode()).hexdigest()[:20]
        evidence.append(
            Evidence(
                id=f"evidence:dump:{digest}",
                kind="minidump_exception" if has_exception else "dump_artifact",
                source_component="minidump-inspection",
                source_path=str(source_path),
                content=f"{rendered}; root_cause_inferred=false",
                role=EvidenceRole.FAILURE if has_exception else EvidenceRole.CONTEXT,
                reliability=EvidenceReliability.PRIMARY,
            )
        )
    return evidence
