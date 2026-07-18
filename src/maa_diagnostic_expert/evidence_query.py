from __future__ import annotations

import hashlib
from pathlib import Path

from .domain import (
    ArtifactAvailability,
    ArtifactKind,
    Evidence,
    EvidenceQuery,
    EvidenceWindow,
    PreparedAnalysis,
)

MAX_EVIDENCE_CHARACTERS = 40_000


def _authorized_source(prepared: PreparedAnalysis, source_path: Path) -> Path:
    resolved = source_path.expanduser().resolve()
    for artifact in prepared.artifacts:
        if artifact.availability is not ArtifactAvailability.AVAILABLE:
            continue
        if artifact.kind is ArtifactKind.DIRECTORY and resolved.is_relative_to(artifact.path):
            return resolved
        if resolved == artifact.path:
            return resolved
    snapshot = prepared.source_snapshot
    if snapshot is not None and resolved.is_relative_to(snapshot.project_root):
        relative = resolved.relative_to(snapshot.project_root)
        if relative.parts and relative.parts[0] == ".git":
            raise ValueError("Git metadata is not an authorized evidence source")
        return resolved
    raise ValueError("Evidence source is outside the prepared analysis inputs")


def _source_component(prepared: PreparedAnalysis, source_path: Path) -> str:
    snapshot = prepared.source_snapshot
    if snapshot is not None and source_path.is_relative_to(snapshot.project_root):
        return "project-source"
    return "diagnostic-artifact"


def query_evidence(prepared: PreparedAnalysis, query: EvidenceQuery) -> EvidenceWindow:
    source_path = _authorized_source(prepared, query.source_path)
    if not source_path.is_file():
        raise ValueError(f"Evidence source is not a file: {source_path}")

    selected: list[str] = []
    actual_end = query.line_start - 1
    has_more_after = False
    truncated = False
    character_count = 0
    with source_path.open("r", encoding="utf-8", errors="replace") as source:
        for line_number, line in enumerate(source, start=1):
            if line_number < query.line_start:
                continue
            if line_number > query.line_end:
                has_more_after = True
                break
            clean_line = line.rstrip("\r\n")
            if "\x00" in clean_line:
                raise ValueError(f"Evidence source appears to be binary: {source_path}")
            remaining = MAX_EVIDENCE_CHARACTERS - character_count
            if remaining <= 0:
                truncated = True
                has_more_after = True
                break
            if len(clean_line) > remaining:
                clean_line = clean_line[:remaining]
                truncated = True
                has_more_after = True
            selected.append(clean_line)
            character_count += len(clean_line) + 1
            actual_end = line_number
            if truncated:
                break

    if not selected:
        raise ValueError(f"Evidence query starts past the end of the file: {source_path}")

    content = "\n".join(selected)
    digest_input = f"{source_path}|{query.line_start}|{actual_end}|{content}"
    evidence_id = f"ev:{hashlib.sha256(digest_input.encode()).hexdigest()[:20]}"
    evidence = Evidence(
        id=evidence_id,
        kind="text_line_window",
        source_component=_source_component(prepared, source_path),
        source_path=str(source_path),
        content=content,
        line_start=query.line_start,
        line_end=actual_end,
    )
    return EvidenceWindow(
        evidence=evidence,
        requested_line_start=query.line_start,
        requested_line_end=query.line_end,
        has_more_before=query.line_start > 1,
        has_more_after=has_more_after,
        truncated=truncated,
    )
