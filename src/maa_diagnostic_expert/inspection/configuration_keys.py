from __future__ import annotations

import re
from pathlib import Path

from maa_diagnostic_expert.contracts.domain import Evidence, MissingEvidence, PreparedAnalysis

from .adaptive_evidence import available_configuration_query_paths
from .log_anchors import source_search_anchor_terms

ConfigurationKeyIndex = dict[Path, dict[str, tuple[int, ...]]]
ConfigurationValueIndex = dict[Path, dict[str, tuple[int, ...]]]

_MAX_CONFIGURATION_INDEX_CHARACTERS = 2_000_000
_MAX_CONFIGURATION_KEYS = 20_000
_CONFIGURATION_CONTEXT_LINE_RADIUS = 20
_MAX_UNSCOPED_VALUE_OCCURRENCES = 1
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
_SCALAR_ASSIGNMENT = re.compile(
    r"(?:^|[\s{,\-])(?:\"[^\"\r\n]+\"|'[^'\r\n]+'|[A-Za-z_$][A-Za-z0-9_$.-]*)"
    r"\s*[:=]\s*(?P<value>\"[^\"\r\n]{1,200}\"|'[^'\r\n]{1,200}'|"
    r"[^,\[\]{}#;\r\n]{1,200})"
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


def index_configuration_values(prepared: PreparedAnalysis) -> ConfigurationValueIndex:
    """Index bounded JSON/YAML/TOML/INI scalar values with exact line locations."""
    index: ConfigurationValueIndex = {}
    for path in available_configuration_query_paths(prepared):
        try:
            with path.open("r", encoding="utf-8", errors="replace") as handle:
                content = handle.read(_MAX_CONFIGURATION_INDEX_CHARACTERS)
        except OSError:
            continue
        locations: dict[str, list[int]] = {}
        for line_number, line in enumerate(content.splitlines(), start=1):
            for match in _SCALAR_ASSIGNMENT.finditer(line):
                value = match.group("value").strip()
                if len(value) >= 2 and value[0] == value[-1] and value[0] in {'"', "'"}:
                    value = value[1:-1].strip()
                if not value or value[0] in "[{|>" or len(value) > 200:
                    continue
                lines = locations.setdefault(value, [])
                if line_number not in lines:
                    lines.append(line_number)
                if len(locations) >= _MAX_CONFIGURATION_KEYS:
                    break
            if len(locations) >= _MAX_CONFIGURATION_KEYS:
                break
        if locations:
            index[path] = {value: tuple(lines) for value, lines in locations.items()}
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


def source_configuration_applicability_identifier_sets(
    evidence: list[Evidence],
) -> dict[str, set[str]]:
    """Extract full source windows for values that decide whether a guard should apply."""
    return {
        item.id: extract_source_configuration_identifiers(item.content)
        for item in evidence
        if item.kind in {"source_search_match", "source_update_match"}
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


def matching_configuration_applicability_identifiers(
    evidence: list[Evidence],
    index: ConfigurationKeyIndex,
) -> dict[Path, set[str]]:
    """Find config keys that determine applicability anywhere in matched source windows."""
    source_identifiers = {
        identifier
        for identifiers in source_configuration_applicability_identifier_sets(evidence).values()
        for identifier in identifiers
    }
    if not source_identifiers:
        return {}
    return {
        path: common
        for path, keys in index.items()
        if (common := source_identifiers.intersection(keys))
    }


def matching_reported_configuration_values(
    reported_context: str,
    evidence: list[Evidence],
    index: ConfigurationValueIndex,
    key_index: ConfigurationKeyIndex,
) -> dict[Path, dict[str, tuple[int, ...]]]:
    """Locate exact reported/runtime strings in configuration without model guessing."""
    configuration_paths = {path.resolve() for path in index}

    def is_observed_artifact_evidence(item: Evidence) -> bool:
        if item.kind.startswith("log_occurrence:") or item.role.value in {"failure", "signal"}:
            return True
        if item.kind != "text_line_window" or item.source_component.startswith("source:"):
            return False
        try:
            return Path(item.source_path).resolve() not in configuration_paths
        except OSError:
            return False

    observed_text = "\n".join(
        [
            reported_context,
            *(item.content for item in evidence if is_observed_artifact_evidence(item)),
        ]
    ).casefold()
    observed_identifiers = extract_source_configuration_identifiers(observed_text)

    def is_low_information_scalar(value: str) -> bool:
        return (
            value.casefold()
            in {
                "false",
                "no",
                "none",
                "null",
                "off",
                "on",
                "true",
                "yes",
            }
            or re.fullmatch(r"[+-]?\d+(?:\.\d+)*", value) is not None
        )

    def observed(path: Path, value: str, lines: tuple[int, ...]) -> bool:
        folded = value.casefold()
        if re.fullmatch(r"[A-Za-z0-9_$.-]+", value):
            value_observed = (
                re.search(
                    rf"(?<![A-Za-z0-9_$]){re.escape(folded)}(?![A-Za-z0-9_$])",
                    observed_text,
                )
                is not None
            )
        else:
            value_observed = folded in observed_text
        if not value_observed:
            return False
        if not is_low_information_scalar(value):
            return True
        keys_on_value_lines = {
            key
            for key, key_lines in key_index.get(path, {}).items()
            if set(lines).intersection(key_lines)
        }
        return bool(keys_on_value_lines.intersection(observed_identifiers))

    return {
        path: matches
        for path, values in index.items()
        if (
            matches := {
                value: lines for value, lines in values.items() if observed(path, value, lines)
            }
        )
    }


def unresolved_configuration_research_locations(
    reported_context: str,
    evidence: list[Evidence],
    key_index: ConfigurationKeyIndex,
    value_index: ConfigurationValueIndex,
) -> dict[Path, set[int]]:
    """Return exact config lines still needed to establish trigger applicability."""
    locations: dict[Path, set[int]] = {}
    reported_matches = matching_reported_configuration_values(
        reported_context,
        evidence,
        value_index,
        key_index,
    )
    anchor_lines_by_path = {
        path: {
            line
            for lines in values.values()
            if len(lines) <= _MAX_UNSCOPED_VALUE_OCCURRENCES
            for line in lines
        }
        for path, values in reported_matches.items()
    }
    causal_identifiers_by_path = matching_configuration_identifiers(evidence, key_index)
    for path, identifiers in matching_configuration_applicability_identifiers(
        evidence,
        key_index,
    ).items():
        anchor_lines = anchor_lines_by_path.get(path, set())
        causal_identifiers = causal_identifiers_by_path.get(path, set())
        for identifier in identifiers:
            key_lines = key_index[path][identifier]
            if identifier in causal_identifiers and len(key_lines) == 1:
                locations.setdefault(path, set()).update(key_lines)
            elif anchor_lines:
                locations.setdefault(path, set()).update(
                    line
                    for line in key_lines
                    if any(
                        abs(line - anchor_line) <= _CONFIGURATION_CONTEXT_LINE_RADIUS
                        for anchor_line in anchor_lines
                    )
                )
    for path, values in reported_matches.items():
        anchor_lines = anchor_lines_by_path.get(path, set())
        for lines in values.values():
            if len(lines) <= _MAX_UNSCOPED_VALUE_OCCURRENCES:
                locations.setdefault(path, set()).update(lines)
            elif anchor_lines:
                locations.setdefault(path, set()).update(
                    line
                    for line in lines
                    if any(
                        abs(line - anchor_line) <= _CONFIGURATION_CONTEXT_LINE_RADIUS
                        for anchor_line in anchor_lines
                    )
                )
    if not locations:
        return {}

    remaining = {path: set(lines) for path, lines in locations.items()}
    for item in evidence:
        if item.kind != "text_line_window" or item.line_start is None or item.line_end is None:
            continue
        try:
            path = Path(item.source_path).resolve()
        except OSError:
            continue
        unresolved_lines = remaining.get(path)
        if unresolved_lines is None:
            continue
        covered_lines = {
            line for line in unresolved_lines if item.line_start <= line <= item.line_end
        }
        unresolved_lines.difference_update(covered_lines)
        if not unresolved_lines:
            remaining.pop(path)
    return remaining


def unresolved_configuration_missing_evidence(
    locations: dict[Path, set[int]],
) -> list[MissingEvidence]:
    """Describe exact configuration targets left after bounded adaptive research."""
    missing: list[MissingEvidence] = []
    for path, lines in sorted(locations.items(), key=lambda item: str(item[0])):
        ordered = sorted(lines)
        displayed = ordered[:20]
        suffix = (
            f" and {len(ordered) - len(displayed)} more" if len(ordered) > len(displayed) else ""
        )
        missing.append(
            MissingEvidence(
                code="configuration_applicability_unresolved",
                message=(
                    "Bounded evidence research ended before inspecting configuration target "
                    f"line(s) {displayed}{suffix}; configuration-dependent applicability must "
                    "remain unresolved."
                ),
                source_path=path,
            )
        )
    return missing
