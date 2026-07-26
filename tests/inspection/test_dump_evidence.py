from __future__ import annotations

import struct
from pathlib import Path

from maa_diagnostic_expert.contracts.domain import (
    AnalysisRequest,
    ArtifactInput,
    ArtifactKind,
    EvidenceRole,
)
from maa_diagnostic_expert.discovery.preparation import prepare_analysis
from maa_diagnostic_expert.inspection.dump_evidence import synthesize_dump_evidence


def _minidump() -> bytes:
    directory_rva = 32
    exception_rva = directory_rva + 24
    system_rva = exception_rva + 32
    header = struct.pack(
        "<4sIIIIIQ",
        b"MDMP",
        0x0000A793,
        2,
        directory_rva,
        0,
        1_700_000_000,
        0,
    )
    directory = struct.pack("<III", 6, 32, exception_rva) + struct.pack("<III", 7, 24, system_rva)
    exception = bytearray(32)
    struct.pack_into("<IIII", exception, 0, 42, 0, 0xC0000005, 0)
    struct.pack_into("<Q", exception, 24, 0x00007FF612341234)
    system = bytearray(24)
    struct.pack_into("<H", system, 0, 9)
    struct.pack_into("<IIII", system, 8, 10, 0, 22631, 2)
    return header + directory + exception + system


def _prepare(path: Path):
    return prepare_analysis(
        AnalysisRequest(
            question="Why did the process crash?",
            artifacts=[ArtifactInput(path=path, kind=ArtifactKind.FILE)],
        )
    )


def test_minidump_exception_is_primary_failure_evidence(tmp_path: Path) -> None:
    dump = tmp_path / "client.dmp"
    dump.write_bytes(_minidump())

    [evidence] = synthesize_dump_evidence(_prepare(dump))

    assert evidence.kind == "minidump_exception"
    assert evidence.role is EvidenceRole.FAILURE
    assert "exception_code=0xc0000005" in evidence.content
    assert "exception_thread_id=42" in evidence.content
    assert "exception_address=0x00007ff612341234" in evidence.content
    assert "processor_architecture=x64" in evidence.content
    assert "os_version=10.0.22631" in evidence.content
    assert "root_cause_inferred=false" in evidence.content


def test_invalid_dump_is_context_not_a_claimed_crash_mechanism(tmp_path: Path) -> None:
    dump = tmp_path / "client.dmp"
    dump.write_bytes(b"not a minidump")

    [evidence] = synthesize_dump_evidence(_prepare(dump))

    assert evidence.kind == "dump_artifact"
    assert evidence.role is EvidenceRole.CONTEXT
    assert "parse_status=invalid_signature" in evidence.content


def test_non_dump_does_not_produce_dump_evidence(tmp_path: Path) -> None:
    log = tmp_path / "client.log"
    log.write_text("log", encoding="utf-8")

    assert synthesize_dump_evidence(_prepare(log)) == []
