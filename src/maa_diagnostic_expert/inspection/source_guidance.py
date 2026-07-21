from __future__ import annotations

import hashlib
from pathlib import Path

from maa_diagnostic_expert.contracts.domain import (
    Evidence,
    EvidenceReliability,
    MissingEvidence,
)
from maa_diagnostic_expert.contracts.workflow import SourceGuidance
from maa_diagnostic_expert.discovery.source_preparation import (
    source_snapshot_matches_checkout,
)

from .models import (
    DeterministicInspection,
    SourceGuidanceDocument,
    SourceGuidanceInspection,
)

_MAX_GUIDANCE_DOCUMENTS = 20
_MAX_GUIDANCE_CHARACTERS = 40_000
_MAX_TOTAL_GUIDANCE_CHARACTERS = 80_000
_SOURCE_COMPONENT = "source-guidance"


def source_guidance_evidence_id(
    source_id: str,
    relative_path: str,
    content: str,
) -> str:
    digest = hashlib.sha256(f"{source_id}|{relative_path}|{content}".encode()).hexdigest()[:20]
    return f"source-guidance:{source_id}:{digest}"


def _ancestor_directories(root: Path, target_file: Path) -> list[Path]:
    target_directory = target_file.parent
    relative = target_directory.relative_to(root)
    directories = [root]
    current = root
    for part in relative.parts:
        current /= part
        directories.append(current)
    return directories


def _read_guidance_document(
    root: Path,
    agents_path: Path,
    character_limit: int,
) -> SourceGuidanceDocument:
    content = agents_path.read_text(encoding="utf-8", errors="replace")
    limit = min(_MAX_GUIDANCE_CHARACTERS, character_limit)
    truncated = len(content) > limit
    if truncated:
        content = content[:limit]
    return SourceGuidanceDocument(
        relative_path=agents_path.relative_to(root).as_posix(),
        content=content,
        line_count=max(1, len(content.splitlines())),
        truncated=truncated,
    )


def resolve_focused_source_guidance(
    inspection: DeterministicInspection,
) -> DeterministicInspection:
    """Resolve scoped AGENTS.md files for version-matched MSE target definitions."""
    snapshots = {snapshot.source_id: snapshot for snapshot in inspection.prepared.source_snapshots}
    missing = list(inspection.prepared.missing_evidence)
    results: list[SourceGuidanceInspection] = []
    document_count = 0
    character_count = 0
    document_cache: dict[tuple[str, str], SourceGuidanceDocument] = {}

    for project in inspection.mse_task_resolutions:
        snapshot = snapshots.get(project.source_id)
        if snapshot is None or not source_snapshot_matches_checkout(
            snapshot,
            require_requested_revision=inspection.prepared.request.issue is not None,
        ):
            continue
        root = snapshot.path.resolve()
        target_paths = list(
            dict.fromkeys(
                definition.source_path
                for resolved in project.resolution.resolutions
                if resolved.found
                for definition in resolved.definitions
            )
        )
        for relative_target in target_paths:
            target = (root / Path(relative_target)).resolve()
            if not target.is_relative_to(root):
                missing.append(
                    MissingEvidence(
                        code="source_guidance_target_outside_root",
                        message=(
                            f"Focused source target '{relative_target}' is outside "
                            f"source '{snapshot.source_id}'."
                        ),
                        source_id=snapshot.source_id,
                        source_path=root,
                    )
                )
                continue

            documents: list[SourceGuidanceDocument] = []
            for directory in _ancestor_directories(root, target):
                agents_path = directory / "AGENTS.md"
                if not agents_path.is_file():
                    continue
                relative_agents_path = agents_path.relative_to(root).as_posix()
                cache_key = (snapshot.source_id, relative_agents_path)
                cached = document_cache.get(cache_key)
                if cached is not None:
                    documents.append(cached)
                    continue
                if document_count >= _MAX_GUIDANCE_DOCUMENTS:
                    missing.append(
                        MissingEvidence(
                            code="source_guidance_truncated",
                            message=(
                                "Applicable AGENTS.md documents were truncated at "
                                f"{_MAX_GUIDANCE_DOCUMENTS} files."
                            ),
                            source_id=snapshot.source_id,
                            source_path=target,
                            required=False,
                        )
                    )
                    break
                remaining_characters = _MAX_TOTAL_GUIDANCE_CHARACTERS - character_count
                if remaining_characters <= 0:
                    missing.append(
                        MissingEvidence(
                            code="source_guidance_truncated",
                            message=(
                                "Applicable AGENTS.md content was truncated at "
                                f"{_MAX_TOTAL_GUIDANCE_CHARACTERS} total characters."
                            ),
                            source_id=snapshot.source_id,
                            source_path=target,
                            required=False,
                        )
                    )
                    break
                try:
                    document = _read_guidance_document(
                        root,
                        agents_path,
                        remaining_characters,
                    )
                except OSError as error:
                    missing.append(
                        MissingEvidence(
                            code="source_guidance_read_failed",
                            message=str(error),
                            source_id=snapshot.source_id,
                            source_path=agents_path,
                        )
                    )
                    continue
                documents.append(document)
                document_cache[cache_key] = document
                document_count += 1
                character_count += len(document.content)
                if document.truncated:
                    applied_limit = min(
                        _MAX_GUIDANCE_CHARACTERS,
                        remaining_characters,
                    )
                    missing.append(
                        MissingEvidence(
                            code="source_guidance_content_truncated",
                            message=(
                                f"{document.relative_path} exceeded the bounded "
                                f"limit of {applied_limit} characters."
                            ),
                            source_id=snapshot.source_id,
                            source_path=agents_path,
                            required=False,
                        )
                    )

            guidance_refs = [
                source_guidance_evidence_id(
                    snapshot.source_id,
                    document.relative_path,
                    document.content,
                )
                for document in documents
            ]
            results.append(
                SourceGuidanceInspection(
                    source_root=root,
                    guidance=SourceGuidance(
                        source_id=snapshot.source_id,
                        source_role=snapshot.role,
                        revision=snapshot.requested_revision or snapshot.current_revision,
                        target_path=relative_target,
                        guidance_refs=guidance_refs,
                    ),
                    documents=documents,
                )
            )

    return inspection.model_copy(
        update={
            "prepared": inspection.prepared.model_copy(update={"missing_evidence": missing}),
            "source_guidance_inspections": results,
        }
    )


def synthesize_source_guidance_evidence(
    inspections: list[SourceGuidanceInspection],
) -> list[Evidence]:
    evidence_by_id: dict[str, Evidence] = {}
    for inspection in inspections:
        guidance = inspection.guidance
        for document in inspection.documents:
            evidence_id = source_guidance_evidence_id(
                guidance.source_id,
                document.relative_path,
                document.content,
            )
            evidence_by_id.setdefault(
                evidence_id,
                Evidence(
                    id=evidence_id,
                    kind="source_guidance",
                    source_component=_SOURCE_COMPONENT,
                    source_path=(
                        f"git:{guidance.source_id}@{guidance.revision}:{document.relative_path}"
                        if guidance.revision
                        else str(inspection.source_root / Path(document.relative_path))
                    ),
                    content=document.content,
                    line_start=1,
                    line_end=document.line_count,
                    reliability=EvidenceReliability.CONTEXT,
                ),
            )
    return list(evidence_by_id.values())
