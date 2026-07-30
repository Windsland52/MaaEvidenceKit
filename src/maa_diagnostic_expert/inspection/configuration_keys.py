from __future__ import annotations

import re
from pathlib import Path

from maa_diagnostic_expert.contracts.domain import Evidence, PreparedAnalysis

from .adaptive_evidence import available_configuration_query_paths
from .log_anchors import source_search_anchor_terms

ConfigurationKeyIndex = dict[Path, dict[str, tuple[int, ...]]]

_MAX_CONFIGURATION_INDEX_CHARACTERS = 2_000_000
_MAX_CONFIGURATION_KEYS = 20_000
_QUOTED_KEY = re.compile(r"[\"']([A-Za-z_$][A-Za-z0-9_$.-]*)[\"']\s*[:=]")
_BARE_KEY = re.compile(r"^\s*([A-Za-z_$][A-Za-z0-9_$.-]*)\s*[:=]")
_PROPERTY_ACCESS = re.compile(r"(?:\?\.|\.)([A-Za-z_$][A-Za-z0-9_$]*)")
_BRACKET_ACCESS = re.compile(r"\[\s*[\"']([A-Za-z_$][A-Za-z0-9_$.-]*)[\"']\s*\]")
_SOURCE_IDENTIFIER = re.compile(r"\b[A-Za-z_$][A-Za-z0-9_$]{2,}\b")
_KEY_LOOKUP = re.compile(
    r"\b(?:get|lookup|option|read|resolve)\s*\(\s*[\"']"
    r"([A-Za-z_$][A-Za-z0-9_$.-]*)[\"']",
    re.IGNORECASE,
)
_SOURCE_COMMENTS = re.compile(r"//[^\n]*|/\*.*?\*/|#[^\n]*", re.DOTALL)
_UNINFORMATIVE_IDENTIFIERS = {
    "config",
    "configuration",
    "data",
    "enabled",
    "find",
    "filter",
    "get",
    "id",
    "items",
    "label",
    "length",
    "map",
    "name",
    "option",
    "options",
    "path",
    "paths",
    "settings",
    "task",
    "tasks",
    "type",
    "value",
    "version",
}


def normalize_configuration_identifier(identifier: str) -> str:
    """Normalize common separator and casing variants without assigning domain meaning."""
    return re.sub(r"[_$.-]+", "", identifier).casefold()


def _useful_identifier(identifier: str) -> str | None:
    normalized = normalize_configuration_identifier(identifier)
    if len(normalized) < 3 or normalized in _UNINFORMATIVE_IDENTIFIERS:
        return None
    return normalized


def extract_configuration_keys(content: str) -> dict[str, tuple[int, ...]]:
    """Extract bounded JSON/YAML/TOML/INI-style keys with their line locations."""
    locations: dict[str, list[int]] = {}
    for line_number, line in enumerate(content.splitlines(), start=1):
        candidates = [match.group(1) for match in _QUOTED_KEY.finditer(line)]
        bare = _BARE_KEY.search(line)
        if bare is not None:
            candidates.append(bare.group(1))
        for candidate in candidates:
            normalized = _useful_identifier(candidate)
            if normalized is None:
                continue
            lines = locations.setdefault(normalized, [])
            if line_number not in lines:
                lines.append(line_number)
            if len(locations) >= _MAX_CONFIGURATION_KEYS:
                return {key: tuple(value) for key, value in locations.items()}
    return {key: tuple(value) for key, value in locations.items()}


def extract_source_configuration_identifiers(content: str) -> set[str]:
    """Extract lexical identifiers that can be intersected with actual configuration keys."""
    content = _SOURCE_COMMENTS.sub("", content)
    candidates = {
        *(match.group(0) for match in _SOURCE_IDENTIFIER.finditer(content)),
        *(match.group(1) for match in _PROPERTY_ACCESS.finditer(content)),
        *(match.group(1) for match in _BRACKET_ACCESS.finditer(content)),
        *(match.group(1) for match in _KEY_LOOKUP.finditer(content)),
    }
    return {
        normalized
        for candidate in candidates
        if (normalized := _useful_identifier(candidate)) is not None
    }


def index_configuration_keys(prepared: PreparedAnalysis) -> ConfigurationKeyIndex:
    """Build a bounded deterministic key index for available configuration artifacts."""
    index: ConfigurationKeyIndex = {}
    for path in available_configuration_query_paths(prepared):
        try:
            with path.open("r", encoding="utf-8", errors="replace") as handle:
                content = handle.read(_MAX_CONFIGURATION_INDEX_CHARACTERS)
        except OSError:
            continue
        keys = extract_configuration_keys(content)
        if keys:
            index[path] = keys
    return index


def source_configuration_identifier_sets(evidence: list[Evidence]) -> dict[str, set[str]]:
    """Extract source identifiers, preferring windows that contain an observed log anchor."""
    source_items = [item for item in evidence if item.kind == "source_search_match"]
    anchors = source_search_anchor_terms(evidence, limit=3)
    anchored_items = [
        item
        for item in source_items
        if any(anchor.casefold() in item.content.casefold() for anchor in anchors)
    ]
    if anchors:
        source_items = anchored_items

    def dependency_prefix(item: Evidence) -> str:
        positions = [
            (position, len(anchor))
            for anchor in anchors
            if (position := item.content.casefold().find(anchor.casefold())) >= 0
        ]
        if not positions:
            return item.content
        position, length = min(positions)
        return item.content[: position + length]

    return {
        item.id: extract_source_configuration_identifiers(dependency_prefix(item))
        for item in source_items
    }


def matching_configuration_identifiers(
    evidence: list[Evidence],
    index: ConfigurationKeyIndex,
) -> dict[Path, set[str]]:
    """Return actual source-identifier/configuration-key intersections by artifact path."""
    source_identifiers = {
        identifier
        for identifiers in source_configuration_identifier_sets(evidence).values()
        for identifier in identifiers
    }
    if not source_identifiers:
        return {}
    return {
        path: common
        for path, keys in index.items()
        if (common := source_identifiers.intersection(keys))
    }
