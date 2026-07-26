from __future__ import annotations

import hashlib
import subprocess
from collections.abc import Iterable
from dataclasses import dataclass
from pathlib import Path

from maa_diagnostic_expert.contracts.domain import (
    ArtifactAvailability,
    ArtifactKind,
    ArtifactOrigin,
    Evidence,
    EvidenceQuery,
    EvidenceRole,
    EvidenceWindow,
    PreparedAnalysis,
    SourceRevisionBackend,
    SourceSnapshot,
)
from maa_diagnostic_expert.discovery.source_preparation import (
    source_snapshot_object_revision,
)
from maa_diagnostic_expert.knowledge.catalog import read_catalog_snapshot_file

MAX_EVIDENCE_CHARACTERS = 40_000


@dataclass(frozen=True, slots=True)
class _AuthorizedEvidenceSource:
    path: Path
    snapshot: SourceSnapshot | None = None


def _matching_source(prepared: PreparedAnalysis, source_path: Path) -> SourceSnapshot | None:
    matches = [
        snapshot
        for snapshot in prepared.source_snapshots
        if source_path.is_relative_to(snapshot.path)
    ]
    if not matches:
        return None
    return max(matches, key=lambda snapshot: len(snapshot.path.parts))


def _same_physical_file(left: Path, right: Path) -> bool:
    try:
        left_stat = left.stat()
        right_stat = right.stat()
    except OSError:
        return False
    if left_stat.st_ino and right_stat.st_ino:
        return left_stat.st_dev == right_stat.st_dev and left_stat.st_ino == right_stat.st_ino
    return left.resolve() == right.resolve()


def _origin_authorizes_path(
    artifact_path: Path,
    origin: ArtifactOrigin,
    source_path: Path,
) -> bool:
    origin_path = origin.path.expanduser().resolve()
    if not _same_physical_file(origin_path, artifact_path):
        return False
    if origin.kind is ArtifactKind.DIRECTORY:
        return source_path.is_relative_to(origin_path)
    return source_path == origin_path


def _authorized_source(prepared: PreparedAnalysis, source_path: Path) -> _AuthorizedEvidenceSource:
    resolved = source_path.expanduser().resolve()
    for artifact in prepared.artifacts:
        if artifact.availability is not ArtifactAvailability.AVAILABLE:
            continue
        for origin in artifact.all_origins():
            if _origin_authorizes_path(artifact.path, origin, resolved):
                return _AuthorizedEvidenceSource(path=resolved)
        if artifact.kind is ArtifactKind.DIRECTORY and resolved.is_relative_to(artifact.path):
            return _AuthorizedEvidenceSource(path=resolved)
        if resolved == artifact.path:
            return _AuthorizedEvidenceSource(path=resolved)
    snapshot = _matching_source(prepared, resolved)
    if snapshot is not None:
        relative = resolved.relative_to(snapshot.path)
        if any(part.casefold() == ".git" for part in relative.parts):
            raise ValueError("Git metadata is not an authorized evidence source")
        return _AuthorizedEvidenceSource(path=resolved, snapshot=snapshot)
    raise ValueError("Evidence source is outside the prepared analysis inputs")


def _git_command(repository: Path, *arguments: str) -> subprocess.CompletedProcess[str]:
    try:
        return subprocess.run(
            ["git", "-C", str(repository), *arguments],
            capture_output=True,
            check=False,
            encoding="utf-8",
            errors="replace",
            timeout=10,
        )
    except (OSError, subprocess.SubprocessError) as error:
        raise ValueError(f"Unable to read versioned source from Git: {error}") from error


def _git_blob(
    snapshot: SourceSnapshot,
    source_path: Path,
) -> tuple[str, str]:
    revision = source_snapshot_object_revision(
        snapshot,
        require_requested_revision=False,
    )
    if revision is None:
        raise ValueError(f"Source revision for '{snapshot.source_id}' is unavailable")
    relative = source_path.relative_to(snapshot.path)
    prefix_result = _git_command(snapshot.path, "rev-parse", "--show-prefix")
    if prefix_result.returncode != 0:
        message = prefix_result.stderr.strip() or "unable to resolve repository prefix"
        raise ValueError(f"Unable to locate source in Git repository: {message}")
    repository_path = f"{prefix_result.stdout.strip()}{relative.as_posix()}"
    object_spec = f"{revision}:{repository_path}"
    type_result = _git_command(snapshot.path, "cat-file", "-t", object_spec)
    if type_result.returncode != 0 or type_result.stdout.strip() != "blob":
        raise ValueError(f"Source file is not present at revision {revision}: {relative}")
    content_result = _git_command(snapshot.path, "show", object_spec)
    if content_result.returncode != 0:
        message = content_result.stderr.strip() or "git show failed"
        raise ValueError(f"Unable to read versioned source: {message}")
    locator = f"git:{snapshot.source_id}@{revision}:{relative.as_posix()}"
    return content_result.stdout, locator


def _source_component(source: _AuthorizedEvidenceSource) -> str:
    if source.snapshot is not None:
        return f"source:{source.snapshot.source_id}"
    return "diagnostic-artifact"


def _select_lines(
    lines: Iterable[str],
    query: EvidenceQuery,
    source_label: str,
) -> tuple[list[str], int, bool, bool]:
    selected: list[str] = []
    actual_end = query.line_start - 1
    has_more_after = False
    truncated = False
    character_count = 0
    for line_number, line in enumerate(lines, start=1):
        if line_number < query.line_start:
            continue
        if line_number > query.line_end:
            has_more_after = True
            break
        clean_line = line.rstrip("\r\n")
        if "\x00" in clean_line:
            raise ValueError(f"Evidence source appears to be binary: {source_label}")
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
    return selected, actual_end, has_more_after, truncated


def query_evidence(prepared: PreparedAnalysis, query: EvidenceQuery) -> EvidenceWindow:
    source = _authorized_source(prepared, query.source_path)
    snapshot = source.snapshot
    if snapshot is not None and snapshot.revision_backend is SourceRevisionBackend.GIT:
        content, source_label = _git_blob(snapshot, source.path)
        selected, actual_end, has_more_after, truncated = _select_lines(
            content.splitlines(keepends=True), query, source_label
        )
    else:
        catalog_content: str | None = None
        if snapshot is not None and snapshot.revision_backend is SourceRevisionBackend.WIKI_CATALOG:
            revision = source_snapshot_object_revision(
                snapshot,
                require_requested_revision=False,
            )
            if revision is None:
                raise ValueError(f"Wiki catalog '{snapshot.source_id}' is unavailable")
            relative = source.path.relative_to(snapshot.path)
            live_revision, verified_content = read_catalog_snapshot_file(
                snapshot.path,
                relative,
            )
            if live_revision != revision:
                raise ValueError(f"Wiki catalog '{snapshot.source_id}' revision changed")
            catalog_content = verified_content.decode("utf-8", errors="replace")
        elif snapshot is not None and snapshot.requested_revision is not None:
            raise ValueError(f"Source revision for '{snapshot.source_id}' is unavailable")
        else:
            revision = None
        if not source.path.is_file():
            raise ValueError(f"Evidence source is not a file: {source.path}")
        if revision is not None and snapshot is not None:
            relative = source.path.relative_to(snapshot.path).as_posix()
            source_label = f"catalog:{snapshot.source_id}@{revision}:{relative}"
        else:
            source_label = str(source.path)
        if catalog_content is not None:
            selected, actual_end, has_more_after, truncated = _select_lines(
                catalog_content.splitlines(keepends=True), query, source_label
            )
        else:
            with source.path.open("r", encoding="utf-8", errors="replace") as handle:
                selected, actual_end, has_more_after, truncated = _select_lines(
                    handle, query, source_label
                )

    if not selected:
        raise ValueError(f"Evidence query starts past the end of the file: {source_label}")

    content = "\n".join(selected)
    digest_input = f"{source_label}|{query.line_start}|{actual_end}|{content}"
    evidence_id = f"ev:{hashlib.sha256(digest_input.encode()).hexdigest()[:20]}"
    evidence = Evidence(
        id=evidence_id,
        kind="text_line_window",
        source_component=_source_component(source),
        source_path=source_label,
        content=content,
        line_start=query.line_start,
        line_end=actual_end,
        role=EvidenceRole.CONTEXT,
    )
    return EvidenceWindow(
        evidence=evidence,
        requested_line_start=query.line_start,
        requested_line_end=query.line_end,
        has_more_before=query.line_start > 1,
        has_more_after=has_more_after,
        truncated=truncated,
    )
