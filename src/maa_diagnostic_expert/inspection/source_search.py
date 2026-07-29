from __future__ import annotations

import hashlib
import re
import subprocess
from collections import Counter
from dataclasses import dataclass
from pathlib import Path, PurePosixPath
from typing import Literal
from urllib.parse import unquote

from maa_diagnostic_expert.contracts.domain import (
    Evidence,
    EvidenceQuery,
    EvidenceReliability,
    EvidenceRole,
    MissingEvidence,
    SourceRevisionBackend,
    SourceRole,
    SourceSnapshot,
)
from maa_diagnostic_expert.contracts.workflow import (
    KnowledgeResearchPlan,
    SourceResearchPlan,
    SourceResearchStatus,
    SourceSearchQuery,
)
from maa_diagnostic_expert.discovery.source_preparation import (
    source_snapshot_object_revision,
    source_snapshot_supports_object_read,
)

from .evidence_query import query_evidence
from .models import DeterministicInspection, SourceSearchMatch

_MAX_TOTAL_MATCHES = 50
_MAX_QUERY_CANDIDATES = 5_000
_MAX_FOLLOWUP_IDENTIFIERS = 4
_MAX_FOLLOWUP_MATCHES = 20
_IMPLEMENTATION_SUFFIXES = {
    ".c",
    ".cc",
    ".cpp",
    ".cs",
    ".go",
    ".h",
    ".hpp",
    ".java",
    ".js",
    ".jsx",
    ".kt",
    ".py",
    ".rs",
    ".swift",
    ".ts",
    ".tsx",
}
_FRAMEWORK_DOCUMENTATION_DIRECTORIES = {"doc", "docs", "documentation"}
_DEFAULT_FRAMEWORK_DOCUMENTATION_PATHS = [
    "docs",
    "doc",
    "documentation",
    "README.md",
]
_MAX_WIKI_ORIGINAL_QUERIES = 5
_MARKDOWN_GITHUB_LINK = re.compile(r"\]\((https://github\.com/[^\s)]+)\)")
_COMMIT_PATTERN = re.compile(r"^[0-9a-f]{40}$")

type _SearchEvidenceMode = Literal["source", "knowledge"]


@dataclass(frozen=True, slots=True)
class _WikiOriginalLocator:
    revision: str
    path: str


def _is_framework_documentation_path(path: str) -> bool:
    candidate = Path(path)
    first_part = candidate.parts[0].casefold()
    if first_part in _FRAMEWORK_DOCUMENTATION_DIRECTORIES:
        return True
    filename = candidate.name.casefold()
    return filename.startswith("readme") and candidate.suffix.casefold() in {
        ".md",
        ".rst",
        ".txt",
    }


def _search_evidence_id(
    window_evidence_id: str,
    *,
    mode: _SearchEvidenceMode,
    role: SourceRole,
) -> str:
    if mode == "source":
        kind = "source_search_match"
    elif role is SourceRole.WIKI:
        kind = "wiki_navigation_match"
    else:
        kind = "knowledge_document_match"
    digest = hashlib.sha256(f"{kind}|{window_evidence_id}".encode()).hexdigest()[:20]
    return f"ev:{digest}"


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
    if snapshot.revision_backend is SourceRevisionBackend.WIKI_CATALOG:
        return _grep_snapshot_files(snapshot, query)
    repository_root = _repository_root(snapshot)
    arguments = ["grep", "-n", "-I", "-F", "-i"]
    for term in query.terms:
        arguments.extend(["-e", term])
    revision = source_snapshot_object_revision(
        snapshot,
        require_requested_revision=False,
    )
    if revision is None:
        raise ValueError(f"Source revision for '{snapshot.source_id}' is unavailable")
    arguments.append(revision)
    arguments.append("--")
    arguments.extend(_search_pathspecs(snapshot, repository_root, query))
    result = _git(repository_root, *arguments)
    if result.returncode not in {0, 1}:
        message = result.stderr.strip() or "git grep failed"
        raise ValueError(message)

    candidates: list[tuple[Path, int, str]] = []
    candidate_limit_reached = False
    for raw_line in result.stdout.splitlines():
        line = raw_line
        if line.startswith(f"{revision}:"):
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
        if len(candidates) >= _MAX_QUERY_CANDIDATES:
            candidate_limit_reached = True
            break
        candidates.append((source_path, line_number, matched_line))

    folded_terms = [term.casefold() for term in query.terms]
    term_frequencies: Counter[str] = Counter()
    file_term_frequencies: Counter[tuple[Path, str]] = Counter()
    for source_path, _, matched_line in candidates:
        folded_line = matched_line.casefold()
        for term in folded_terms:
            if term not in folded_line:
                continue
            term_frequencies[term] += 1
            file_term_frequencies[(source_path, term)] += 1

    def identifier_span(matched_line: str, term: str) -> int:
        identifiers = re.findall(r"[A-Za-z_][A-Za-z0-9_]*", matched_line)
        return max(
            (len(identifier) for identifier in identifiers if term in identifier.casefold()),
            default=0,
        )

    def term_relevance_key(
        match: tuple[Path, int, str],
        term: str,
    ) -> tuple[int, int, int, str, int]:
        source_path, line_number, matched_line = match
        return (
            0 if source_path.suffix.casefold() in _IMPLEMENTATION_SUFFIXES else 1,
            -identifier_span(matched_line, term),
            file_term_frequencies[(source_path, term)],
            str(source_path).casefold(),
            line_number,
        )

    term_order = sorted(
        (term for term in folded_terms if term_frequencies[term]),
        key=lambda term: (term_frequencies[term], -len(term), folded_terms.index(term)),
    )
    matches_by_term = {
        term: sorted(
            (match for match in candidates if term in match[2].casefold()),
            key=lambda match, term=term: term_relevance_key(match, term),
        )
        for term in term_order
    }
    selected: list[tuple[Path, int, str]] = []
    selected_keys: set[tuple[Path, int]] = set()

    def overlaps_selected_window(match: tuple[Path, int, str]) -> bool:
        source_path, line_number, _ = match
        return any(
            selected_path == source_path
            and abs(selected_line - line_number) <= query.context_lines * 2
            for selected_path, selected_line, _ in selected
        )

    def add_match(match: tuple[Path, int, str]) -> bool:
        key = (match[0], match[1])
        if key in selected_keys or overlaps_selected_window(match):
            return False
        selected.append(match)
        selected_keys.add(key)
        return True

    for term in term_order:
        for match in matches_by_term[term]:
            if add_match(match):
                break
        if len(selected) >= query.max_results:
            break

    def overall_relevance_key(
        match: tuple[Path, int, str],
    ) -> tuple[int, int, int, int, str, int]:
        source_path, line_number, matched_line = match
        folded_line = matched_line.casefold()
        matched_terms = [term for term in folded_terms if term in folded_line]
        return (
            0 if source_path.suffix.casefold() in _IMPLEMENTATION_SUFFIXES else 1,
            -max((identifier_span(matched_line, term) for term in matched_terms), default=0),
            min(
                (file_term_frequencies[(source_path, term)] for term in matched_terms),
                default=len(candidates),
            ),
            min(
                (term_frequencies[term] for term in matched_terms),
                default=len(candidates),
            ),
            str(source_path).casefold(),
            line_number,
        )

    for match in sorted(candidates, key=overall_relevance_key):
        if len(selected) >= query.max_results:
            break
        add_match(match)

    truncated = candidate_limit_reached or len(candidates) > len(selected)
    return selected, truncated


def _grep_snapshot_files(
    snapshot: SourceSnapshot,
    query: SourceSearchQuery,
) -> tuple[list[tuple[Path, int, str]], bool]:
    root = snapshot.path.resolve()
    requested_paths = query.paths or ["."]
    files: set[Path] = set()
    for requested_path in requested_paths:
        candidate = (root / requested_path).resolve()
        if not candidate.is_relative_to(root):
            raise ValueError(f"Knowledge search path escapes catalog: {requested_path}")
        if candidate.is_file() and not any(
            part.casefold() == ".git" for part in candidate.relative_to(root).parts
        ):
            files.add(candidate)
        elif candidate.is_dir():
            files.update(
                path
                for path in candidate.rglob("*")
                if path.is_file()
                and not any(part.casefold() == ".git" for part in path.relative_to(root).parts)
            )

    matches: list[tuple[Path, int, str]] = []
    for path in sorted(files):
        if path.name == "catalog-manifest.json" or path.stat().st_size > 2_000_000:
            continue
        try:
            lines = path.read_text(encoding="utf-8", errors="replace").splitlines()
        except OSError:
            continue
        for line_number, line in enumerate(lines, start=1):
            folded_line = line.casefold()
            if not any(term.casefold() in folded_line for term in query.terms):
                continue
            if len(matches) >= query.max_results:
                return matches, True
            matches.append((path, line_number, line))
    return matches, False


def execute_source_research(
    inspection: DeterministicInspection,
    plan: SourceResearchPlan,
    *,
    evidence_mode: _SearchEvidenceMode = "source",
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
        if snapshot is None or not source_snapshot_supports_object_read(
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
        if not grep_matches and query.paths and evidence_mode == "source":
            relaxed_query = query.model_copy(update={"paths": []})
            try:
                grep_matches, relaxed_truncated = _grep_lines(snapshot, relaxed_query)
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
            query_truncated = query_truncated or relaxed_truncated
            missing.append(
                MissingEvidence(
                    code="source_search_paths_relaxed",
                    message=(
                        f"Source search query '{query.query_id}' found no matches within its "
                        "path hints, so the same terms were retried across the authorized source."
                    ),
                    source_id=snapshot.source_id,
                    source_path=snapshot.path,
                    required=False,
                )
            )
        if grep_matches and evidence_mode == "source":
            folded_terms = [term.casefold() for term in query.terms]
            base_identifiers = sorted(
                {
                    identifier
                    for _, _, matched_line in grep_matches
                    for identifier in re.findall(
                        r"[A-Za-z_][A-Za-z0-9_]*",
                        matched_line,
                    )
                    if len(identifier) >= 6
                    and identifier.casefold() not in folded_terms
                    and any(term in identifier.casefold() for term in folded_terms)
                },
                key=lambda identifier: (-len(identifier), identifier.casefold()),
            )[:_MAX_FOLLOWUP_IDENTIFIERS]
            identifiers = list(base_identifiers)
            for identifier in base_identifiers:
                if "_" in identifier:
                    parts = [part for part in identifier.split("_") if part]
                    variant = (
                        parts[0].casefold()
                        + "".join(part[:1].upper() + part[1:].casefold() for part in parts[1:])
                        if parts
                        else ""
                    )
                else:
                    variant = re.sub(r"(?<!^)(?=[A-Z])", "_", identifier).casefold()
                if variant and variant.casefold() not in {item.casefold() for item in identifiers}:
                    identifiers.append(variant)
            identifiers = identifiers[:8]
            if identifiers:
                followup_query = query.model_copy(
                    update={
                        "terms": identifiers,
                        "paths": [],
                        "context_lines": query.context_lines,
                        "max_results": _MAX_FOLLOWUP_MATCHES,
                    }
                )
                try:
                    followup_matches, followup_truncated = _grep_lines(
                        snapshot,
                        followup_query,
                    )
                except ValueError:
                    followup_matches = []
                    followup_truncated = False
                if followup_matches:
                    combined_matches: list[tuple[Path, int, str]] = []
                    seen_match_keys: set[tuple[Path, int]] = set()
                    for match in [*followup_matches, *grep_matches]:
                        key = (match[0], match[1])
                        if key in seen_match_keys:
                            continue
                        combined_matches.append(match)
                        seen_match_keys.add(key)
                        if len(combined_matches) >= query.max_results:
                            break
                    grep_matches = combined_matches
                    query_truncated = query_truncated or followup_truncated
                    missing.append(
                        MissingEvidence(
                            code="source_search_identifier_followup",
                            message=(
                                f"Source search query '{query.query_id}' followed concrete "
                                "identifiers found by its literal terms."
                            ),
                            source_id=snapshot.source_id,
                            source_path=snapshot.path,
                            required=False,
                        )
                    )
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
            folded_line = matched_line.casefold()
            matched_terms = [term for term in query.terms if term.casefold() in folded_line]
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
                    source_role=snapshot.role,
                    relative_path=relative_path,
                    source_locator=window.evidence.source_path,
                    line=line_number,
                    matched_terms=matched_terms,
                    content=window.evidence.content,
                    line_start=window.evidence.line_start or line_start,
                    line_end=window.evidence.line_end or line_end,
                    evidence_id=_search_evidence_id(
                        window.evidence.id,
                        mode=evidence_mode,
                        role=snapshot.role,
                    ),
                )
            )

    return inspection.model_copy(
        update={
            "prepared": inspection.prepared.model_copy(update={"missing_evidence": missing}),
            "source_search_matches": matches,
        }
    )


def execute_knowledge_research(
    inspection: DeterministicInspection,
    plan: KnowledgeResearchPlan,
) -> DeterministicInspection:
    """Search explicit versioned documentation and Wiki repositories."""
    snapshots = {snapshot.source_id: snapshot for snapshot in inspection.prepared.source_snapshots}
    eligible_roles = {
        SourceRole.MAA_FRAMEWORK,
        SourceRole.DOCUMENTATION,
        SourceRole.WIKI,
    }
    missing = list(inspection.prepared.missing_evidence)
    eligible_queries: list[SourceSearchQuery] = []
    for query in plan.queries:
        snapshot = snapshots.get(query.source_id)
        if snapshot is None or snapshot.role not in eligible_roles:
            missing.append(
                MissingEvidence(
                    code="knowledge_search_source_unavailable",
                    message=(
                        f"Knowledge search query '{query.query_id}' references a source "
                        "that is not explicit MaaFramework documentation or Wiki input."
                    ),
                    source_id=query.source_id,
                )
            )
            continue
        if snapshot.role is SourceRole.MAA_FRAMEWORK:
            requested_paths = query.paths or _DEFAULT_FRAMEWORK_DOCUMENTATION_PATHS
            if not all(_is_framework_documentation_path(path) for path in requested_paths):
                missing.append(
                    MissingEvidence(
                        code="knowledge_search_path_unavailable",
                        message=(
                            f"Knowledge search query '{query.query_id}' requested a "
                            "non-documentation MaaFramework path."
                        ),
                        source_id=query.source_id,
                        source_path=snapshot.path,
                    )
                )
                continue
            eligible_queries.append(query.model_copy(update={"paths": requested_paths}))
        else:
            eligible_queries.append(query)

    prepared = inspection.prepared.model_copy(update={"missing_evidence": missing})
    inspection_with_missing = inspection.model_copy(update={"prepared": prepared})
    if not eligible_queries:
        return inspection_with_missing.model_copy(update={"knowledge_search_matches": []})

    source_plan = SourceResearchPlan(
        status=plan.status,
        queries=eligible_queries,
        rationale=plan.rationale,
    )
    searched = execute_source_research(
        inspection_with_missing,
        source_plan,
        evidence_mode="knowledge",
    )
    knowledge = searched.model_copy(
        update={
            "source_search_matches": inspection.source_search_matches,
            "knowledge_search_matches": searched.source_search_matches,
        }
    )
    return resolve_wiki_original_sources(knowledge)


def resolve_wiki_original_sources(
    inspection: DeterministicInspection,
) -> DeterministicInspection:
    """Follow pinned Wiki navigation links into explicit revision-matched Git sources."""
    wiki_matches = [
        match
        for match in inspection.knowledge_search_matches
        if match.source_role is SourceRole.WIKI
    ]
    if not wiki_matches:
        return inspection

    require_revision = inspection.prepared.request.issue is not None
    originals_by_revision: dict[str, list[SourceSnapshot]] = {}
    for snapshot in inspection.prepared.source_snapshots:
        if snapshot.role not in {SourceRole.MAA_FRAMEWORK, SourceRole.DOCUMENTATION}:
            continue
        revision = source_snapshot_object_revision(
            snapshot,
            require_requested_revision=require_revision,
        )
        if revision is not None:
            originals_by_revision.setdefault(revision, []).append(snapshot)

    missing = list(inspection.prepared.missing_evidence)
    queries: list[SourceSearchQuery] = []
    query_keys: set[tuple[str, str, tuple[str, ...]]] = set()
    truncated = False
    for match in wiki_matches:
        locators = _wiki_original_locators(match)
        if not locators:
            missing.append(
                MissingEvidence(
                    code="wiki_original_locator_unavailable",
                    message=(
                        f"Wiki navigation match '{match.evidence_id}' has no supported "
                        "revision-pinned original-source link on its matched line."
                    ),
                    source_id=match.source_id,
                    required=False,
                )
            )
            continue
        for locator in locators:
            candidates = originals_by_revision.get(locator.revision, [])
            if not candidates:
                missing.append(
                    MissingEvidence(
                        code="wiki_original_source_unavailable",
                        message=(
                            f"Wiki original '{locator.path}' at {locator.revision} has "
                            "no explicit revision-matched source checkout."
                        ),
                        source_id=match.source_id,
                        required=True,
                    )
                )
                continue
            compatible = [
                (snapshot, relative_path)
                for snapshot in candidates
                if (relative_path := _path_within_snapshot(snapshot, locator.path)) is not None
            ]
            if not compatible:
                missing.append(
                    MissingEvidence(
                        code="wiki_original_path_unavailable",
                        message=(
                            f"Wiki original '{locator.path}' is outside every explicit "
                            "revision-matched source root."
                        ),
                        source_id=match.source_id,
                    )
                )
                continue
            preferred = [item for item in compatible if item[0].role is SourceRole.DOCUMENTATION]
            selected = preferred or compatible
            if len(selected) != 1:
                missing.append(
                    MissingEvidence(
                        code="wiki_original_source_unavailable",
                        message=(
                            f"Wiki original '{locator.path}' at {locator.revision} matches "
                            "multiple eligible explicit source checkouts."
                        ),
                        source_id=match.source_id,
                        required=True,
                    )
                )
                continue
            snapshot, relative_path = selected[0]
            terms = tuple(match.matched_terms)
            key = (snapshot.source_id, relative_path, terms)
            if key in query_keys:
                continue
            if len(queries) >= _MAX_WIKI_ORIGINAL_QUERIES:
                truncated = True
                continue
            query_keys.add(key)
            digest = hashlib.sha256("|".join((key[0], key[1], *key[2])).encode()).hexdigest()[:16]
            queries.append(
                SourceSearchQuery(
                    query_id=f"wiki-original-{digest}",
                    source_id=snapshot.source_id,
                    terms=list(terms),
                    paths=[relative_path],
                    reason=(
                        f"Resolve Wiki navigation evidence {match.evidence_id} to its "
                        "revision-matched original source."
                    ),
                    context_lines=6,
                    max_results=5,
                )
            )
    if truncated:
        missing.append(
            MissingEvidence(
                code="wiki_original_resolution_truncated",
                message=(
                    "Wiki original-source follow-up was truncated at "
                    f"{_MAX_WIKI_ORIGINAL_QUERIES} queries."
                ),
                required=False,
            )
        )

    prepared = inspection.prepared.model_copy(update={"missing_evidence": missing})
    inspection_with_missing = inspection.model_copy(update={"prepared": prepared})
    if not queries:
        return inspection_with_missing
    searched = execute_source_research(
        inspection_with_missing,
        SourceResearchPlan(
            status=SourceResearchStatus.RUN,
            queries=queries,
            rationale="Resolve pinned Wiki navigation matches to original sources.",
        ),
        evidence_mode="knowledge",
    )
    combined: dict[str, SourceSearchMatch] = {
        match.evidence_id: match for match in inspection.knowledge_search_matches
    }
    for match in searched.source_search_matches:
        combined.setdefault(match.evidence_id, match)
    return searched.model_copy(
        update={
            "source_search_matches": inspection.source_search_matches,
            "knowledge_search_matches": list(combined.values()),
        }
    )


def _wiki_original_locators(match: SourceSearchMatch) -> list[_WikiOriginalLocator]:
    lines = match.content.splitlines()
    index = match.line - match.line_start
    if index < 0 or index >= len(lines):
        return []
    locators: list[_WikiOriginalLocator] = []
    for raw_url in _MARKDOWN_GITHUB_LINK.findall(lines[index]):
        path_url = raw_url.split("#", maxsplit=1)[0].split("?", maxsplit=1)[0]
        parts = path_url.removeprefix("https://github.com/").split("/")
        if len(parts) < 5 or parts[2] != "blob" or not _COMMIT_PATTERN.fullmatch(parts[3]):
            continue
        raw_path = unquote("/".join(parts[4:])).replace("\\", "/")
        path = PurePosixPath(raw_path)
        if (
            not raw_path
            or len(raw_path) > 300
            or any(ord(character) < 32 for character in raw_path)
            or path.is_absolute()
            or ".." in path.parts
            or any(part.casefold() == ".git" for part in path.parts)
        ):
            continue
        locator = _WikiOriginalLocator(revision=parts[3], path=raw_path)
        if locator not in locators:
            locators.append(locator)
    return locators


def _path_within_snapshot(snapshot: SourceSnapshot, original_path: str) -> str | None:
    try:
        repository = _repository_root(snapshot)
        prefix = snapshot.path.resolve().relative_to(repository).as_posix()
    except (OSError, ValueError):
        return None
    path = PurePosixPath(original_path)
    if not prefix:
        return path.as_posix()
    prefix_parts = PurePosixPath(prefix).parts
    if path.parts[: len(prefix_parts)] != prefix_parts:
        return None
    relative = PurePosixPath(*path.parts[len(prefix_parts) :])
    return relative.as_posix() if relative.parts else None


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
                role=EvidenceRole.CONTEXT,
                reliability=EvidenceReliability.SECONDARY,
            ),
        )
    return list(evidence_by_id.values())


def synthesize_knowledge_search_evidence(
    matches: list[SourceSearchMatch],
) -> list[Evidence]:
    evidence_by_id: dict[str, Evidence] = {}
    for match in matches:
        is_wiki = match.source_role is SourceRole.WIKI
        evidence_by_id.setdefault(
            match.evidence_id,
            Evidence(
                id=match.evidence_id,
                kind=("wiki_navigation_match" if is_wiki else "knowledge_document_match"),
                source_component=f"source:{match.source_id}",
                source_path=match.source_locator,
                content=match.content,
                line_start=match.line_start,
                line_end=match.line_end,
                role=EvidenceRole.CONTEXT,
                reliability=EvidenceReliability.CONTEXT,
            ),
        )
    return list(evidence_by_id.values())
