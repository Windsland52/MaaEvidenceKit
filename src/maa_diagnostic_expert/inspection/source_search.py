from __future__ import annotations

import subprocess
from pathlib import Path

from maa_diagnostic_expert.contracts.domain import (
    Evidence,
    EvidenceQuery,
    EvidenceReliability,
    MissingEvidence,
    RevisionResolutionStatus,
    SourceSnapshot,
)
from maa_diagnostic_expert.contracts.workflow import (
    SourceResearchPlan,
    SourceSearchQuery,
)
from maa_diagnostic_expert.discovery.source_preparation import (
    source_snapshot_matches_checkout,
)

from .evidence_query import query_evidence
from .models import DeterministicInspection, SourceSearchMatch

_MAX_TOTAL_MATCHES = 50


def _git(repository: Path, *arguments: str) -> subprocess.CompletedProcess[str]:
    try:
        return subprocess.run(
            ["git", "-C", str(repository), *arguments],
            capture_output=True,
            check=False,
            encoding="utf-8",
            errors="replace",
            timeout=20,
        )
    except (OSError, subprocess.SubprocessError) as error:
        raise ValueError(f"Unable to search versioned source with Git: {error}") from error


def _repository_root(snapshot: SourceSnapshot) -> Path:
    result = _git(snapshot.path, "rev-parse", "--show-toplevel")
    if result.returncode != 0:
        message = result.stderr.strip() or "unable to locate Git repository root"
        raise ValueError(message)
    return Path(result.stdout.strip()).resolve()


def _search_pathspecs(
    snapshot: SourceSnapshot,
    repository_root: Path,
    query: SourceSearchQuery,
) -> list[str]:
    source_prefix = snapshot.path.resolve().relative_to(repository_root).as_posix()
    requested_paths = query.paths or ["."]
    pathspecs: list[str] = []
    for requested_path in requested_paths:
        if requested_path == ".":
            combined = source_prefix or "."
        elif source_prefix:
            combined = f"{source_prefix}/{requested_path}"
        else:
            combined = requested_path
        pathspecs.append(f":(literal){combined}")
    return pathspecs


def _grep_lines(
    snapshot: SourceSnapshot,
    query: SourceSearchQuery,
) -> tuple[list[tuple[Path, int, str]], bool]:
    repository_root = _repository_root(snapshot)
    arguments = ["grep", "-n", "-I", "-F"]
    for term in query.terms:
        arguments.extend(["-e", term])
    revision: str | None = None
    if snapshot.requested_revision is not None:
        if (
            snapshot.resolution_status is not RevisionResolutionStatus.RESOLVED
            or snapshot.resolved_revision is None
        ):
            raise ValueError(f"Requested revision for source '{snapshot.source_id}' is unresolved")
        revision = snapshot.resolved_revision
        arguments.append(revision)
    arguments.append("--")
    arguments.extend(_search_pathspecs(snapshot, repository_root, query))
    result = _git(repository_root, *arguments)
    if result.returncode not in {0, 1}:
        message = result.stderr.strip() or "git grep failed"
        raise ValueError(message)

    matches: list[tuple[Path, int, str]] = []
    truncated = False
    for raw_line in result.stdout.splitlines():
        line = raw_line
        if revision is not None and line.startswith(f"{revision}:"):
            line = line[len(revision) + 1 :]
        parts = line.split(":", 2)
        if len(parts) != 3:
            continue
        relative_path, line_text, matched_line = parts
        try:
            line_number = int(line_text)
        except ValueError:
            continue
        source_path = (repository_root / Path(relative_path)).resolve()
        if not source_path.is_relative_to(snapshot.path.resolve()):
            continue
        if len(matches) >= query.max_results:
            truncated = True
            break
        matches.append((source_path, line_number, matched_line))
    return matches, truncated


def execute_source_research(
    inspection: DeterministicInspection,
    plan: SourceResearchPlan,
) -> DeterministicInspection:
    """Execute bounded model-planned searches against authorized source snapshots."""
    snapshots = {snapshot.source_id: snapshot for snapshot in inspection.prepared.source_snapshots}
    missing = list(inspection.prepared.missing_evidence)
    matches: list[SourceSearchMatch] = []
    total_truncation_recorded = False

    for query in plan.queries:
        if len(matches) >= _MAX_TOTAL_MATCHES:
            missing.append(
                MissingEvidence(
                    code="source_search_truncated",
                    message=(
                        f"Source search matches were truncated at {_MAX_TOTAL_MATCHES} records."
                    ),
                    required=False,
                )
            )
            break
        snapshot = snapshots.get(query.source_id)
        if snapshot is None or not source_snapshot_matches_checkout(
            snapshot,
            require_requested_revision=inspection.prepared.request.issue is not None,
        ):
            missing.append(
                MissingEvidence(
                    code="source_search_source_unavailable",
                    message=(
                        f"Source search query '{query.query_id}' references an unavailable "
                        f"or revision-mismatched source '{query.source_id}'."
                    ),
                    source_id=query.source_id,
                )
            )
            continue
        try:
            grep_matches, query_truncated = _grep_lines(snapshot, query)
        except ValueError as error:
            missing.append(
                MissingEvidence(
                    code="source_search_failed",
                    message=str(error),
                    source_id=snapshot.source_id,
                    source_path=snapshot.path,
                )
            )
            continue
        if query_truncated:
            missing.append(
                MissingEvidence(
                    code="source_search_query_truncated",
                    message=(
                        f"Source search query '{query.query_id}' was truncated at "
                        f"{query.max_results} matches."
                    ),
                    source_id=snapshot.source_id,
                    source_path=snapshot.path,
                    required=False,
                )
            )
        if not grep_matches:
            missing.append(
                MissingEvidence(
                    code="source_search_no_matches",
                    message=(f"Source search query '{query.query_id}' found no matches."),
                    source_id=snapshot.source_id,
                    source_path=snapshot.path,
                    required=False,
                )
            )
            continue

        for source_path, line_number, matched_line in grep_matches:
            if len(matches) >= _MAX_TOTAL_MATCHES:
                if not total_truncation_recorded:
                    missing.append(
                        MissingEvidence(
                            code="source_search_truncated",
                            message=(
                                "Source search matches were truncated at "
                                f"{_MAX_TOTAL_MATCHES} records."
                            ),
                            required=False,
                        )
                    )
                    total_truncation_recorded = True
                break
            line_start = max(1, line_number - query.context_lines)
            line_end = line_number + query.context_lines
            matched_terms = [term for term in query.terms if term in matched_line]
            if not matched_terms:
                matched_terms = list(query.terms)

            try:
                window = query_evidence(
                    inspection.prepared,
                    EvidenceQuery(
                        source_path=source_path,
                        line_start=line_start,
                        line_end=line_end,
                        reason=query.reason,
                    ),
                )
            except (OSError, ValueError) as error:
                missing.append(
                    MissingEvidence(
                        code="source_search_window_failed",
                        message=str(error),
                        source_id=snapshot.source_id,
                        source_path=source_path,
                    )
                )
                continue
            relative_path = source_path.relative_to(snapshot.path.resolve()).as_posix()
            matches.append(
                SourceSearchMatch(
                    query_id=query.query_id,
                    source_id=snapshot.source_id,
                    relative_path=relative_path,
                    source_locator=window.evidence.source_path,
                    line=line_number,
                    matched_terms=matched_terms,
                    content=window.evidence.content,
                    line_start=window.evidence.line_start or line_start,
                    line_end=window.evidence.line_end or line_end,
                    evidence_id=window.evidence.id,
                )
            )

    return inspection.model_copy(
        update={
            "prepared": inspection.prepared.model_copy(update={"missing_evidence": missing}),
            "source_search_matches": matches,
        }
    )


def synthesize_source_search_evidence(
    matches: list[SourceSearchMatch],
) -> list[Evidence]:
    evidence_by_id: dict[str, Evidence] = {}
    for match in matches:
        evidence_by_id.setdefault(
            match.evidence_id,
            Evidence(
                id=match.evidence_id,
                kind="source_search_match",
                source_component=f"source:{match.source_id}",
                source_path=match.source_locator,
                content=match.content,
                line_start=match.line_start,
                line_end=match.line_end,
                reliability=EvidenceReliability.SECONDARY,
            ),
        )
    return list(evidence_by_id.values())
