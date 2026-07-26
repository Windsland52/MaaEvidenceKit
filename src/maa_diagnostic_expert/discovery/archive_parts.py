from __future__ import annotations

import os
import re
from dataclasses import dataclass
from pathlib import Path

from maa_diagnostic_expert.contracts.domain import (
    ArtifactAvailability,
    ArtifactKind,
    ArtifactRecord,
    MissingEvidence,
)

MAX_MULTIPART_SEQUENCE_PARTS = 10_000

_NUMBERED_ARCHIVE_PATTERN = re.compile(
    r"^(?:(?P<prefix>.+?)(?P<prefix_separator>[._-]))?"
    r"part(?P<index>\d+)"
    r"(?:(?P<of_before>[._-]?)of(?P<of_after>[._-]?)(?P<total>\d+))?"
    r"(?P<suffix>\.(?:zip|7z|rar|tar(?:\.gz)?|tgz))$",
    re.IGNORECASE,
)
_NUMERIC_VOLUME_PATTERN = re.compile(
    r"^(?P<base>.+\.(?:zip|7z|rar))\.(?P<index>\d{3,})$",
    re.IGNORECASE,
)
_SPLIT_ZIP_PATTERN = re.compile(
    r"^(?P<base>.+)\.z(?P<index>\d{2,})$",
    re.IGNORECASE,
)
_SPLIT_RAR_PATTERN = re.compile(
    r"^(?P<base>.+)\.r(?P<index>\d{2,})$",
    re.IGNORECASE,
)


@dataclass(frozen=True, slots=True)
class _ObservedPath:
    path: Path
    available: bool


@dataclass(frozen=True, slots=True)
class _NumberedArchivePart:
    observed: _ObservedPath
    prefix: str
    prefix_separator: str
    index: int
    index_width: int
    of_before: str
    of_after: str
    total: int | None
    total_width: int
    suffix: str


@dataclass(frozen=True, slots=True)
class _NumericVolumePart:
    observed: _ObservedPath
    base: str
    index: int
    width: int


def is_multipart_archive_path(path: Path) -> bool:
    """Return whether a filename is a recognized archive volume."""
    name = path.name
    return any(
        pattern.fullmatch(name) is not None
        for pattern in (
            _NUMBERED_ARCHIVE_PATTERN,
            _NUMERIC_VOLUME_PATTERN,
            _SPLIT_ZIP_PATTERN,
            _SPLIT_RAR_PATTERN,
        )
    )


def _path_key(path: Path) -> str:
    return os.path.normcase(str(path.resolve()))


def _observed_paths(records: list[ArtifactRecord]) -> list[_ObservedPath]:
    availability_by_path: dict[Path, bool] = {}
    for record in records:
        available = record.availability is ArtifactAvailability.AVAILABLE
        for origin in record.all_origins():
            if origin.kind is ArtifactKind.DIRECTORY:
                continue
            availability_by_path[origin.path] = (
                availability_by_path.get(origin.path, False) or available
            )
    return [
        _ObservedPath(path=path, available=available)
        for path, available in sorted(
            availability_by_path.items(),
            key=lambda item: (os.path.normcase(str(item[0])), str(item[0])),
        )
    ]


def _numbered_part(observed: _ObservedPath) -> _NumberedArchivePart | None:
    match = _NUMBERED_ARCHIVE_PATTERN.fullmatch(observed.path.name)
    if match is None:
        return None
    index_text = match.group("index")
    total_text = match.group("total")
    return _NumberedArchivePart(
        observed=observed,
        prefix=match.group("prefix") or "",
        prefix_separator=match.group("prefix_separator") or "",
        index=int(index_text),
        index_width=len(index_text),
        of_before=match.group("of_before") or "",
        of_after=match.group("of_after") or "",
        total=int(total_text) if total_text is not None else None,
        total_width=len(total_text) if total_text is not None else 0,
        suffix=match.group("suffix"),
    )


def _numeric_part(
    observed: _ObservedPath,
    pattern: re.Pattern[str],
) -> _NumericVolumePart | None:
    match = pattern.fullmatch(observed.path.name)
    if match is None:
        return None
    index_text = match.group("index")
    return _NumericVolumePart(
        observed=observed,
        base=match.group("base"),
        index=int(index_text),
        width=len(index_text),
    )


def _format_ranges(indices: list[int]) -> str:
    ranges: list[str] = []
    start = indices[0]
    end = start
    for index in indices[1:]:
        if index == end + 1:
            end = index
            continue
        ranges.append(str(start) if start == end else f"{start}-{end}")
        start = index
        end = index
    ranges.append(str(start) if start == end else f"{start}-{end}")
    return ", ".join(ranges)


def _unbounded_sequence(
    label: str,
    path: Path,
    maximum: int,
) -> MissingEvidence:
    return MissingEvidence(
        code="multipart_archive_sequence_unbounded",
        message=(
            f"Multipart archive sequence '{label}' declares part {maximum}, which exceeds "
            f"the supported bound of {MAX_MULTIPART_SEQUENCE_PARTS:,}."
        ),
        source_path=path,
    )


def _numbered_archive_missing(
    observed_paths: list[_ObservedPath],
) -> list[MissingEvidence]:
    groups: dict[tuple[str, str, str], list[_NumberedArchivePart]] = {}
    for observed in observed_paths:
        part = _numbered_part(observed)
        if part is None:
            continue
        key = (
            _path_key(observed.path.parent),
            part.prefix.casefold(),
            part.suffix.casefold(),
        )
        groups.setdefault(key, []).append(part)

    missing: list[MissingEvidence] = []
    for parts in groups.values():
        parts.sort(key=lambda part: (part.index, str(part.observed.path).casefold()))
        exemplar = min(
            (part for part in parts if part.total is not None),
            key=lambda part: str(part.observed.path).casefold(),
            default=parts[0],
        )
        totals: set[int] = {total for part in parts if (total := part.total) is not None}
        observed_maximum = max(part.index for part in parts)
        maximum = max([observed_maximum, *totals])
        label = f"{exemplar.prefix + exemplar.prefix_separator}part*{exemplar.suffix}"
        if maximum > MAX_MULTIPART_SEQUENCE_PARTS:
            missing.append(_unbounded_sequence(label, exemplar.observed.path, maximum))
            continue

        if len(totals) > 1 or any(
            part.total is not None and part.index > part.total for part in parts
        ):
            missing.append(
                MissingEvidence(
                    code="multipart_archive_part_count_conflict",
                    message=(
                        f"Multipart archive sequence '{label}' has inconsistent declared "
                        "part counts."
                    ),
                    source_path=exemplar.observed.path,
                )
            )

        available = {part.index for part in parts if part.observed.available}
        start = 0 if any(part.index == 0 for part in parts) else 1
        missing_indices = [index for index in range(start, maximum + 1) if index not in available]
        if not missing_indices:
            continue

        width = max(part.index_width for part in parts)
        first_missing = missing_indices[0]
        name = f"{exemplar.prefix}{exemplar.prefix_separator}part{first_missing:0{width}d}"
        if exemplar.total is not None:
            total_width = max(exemplar.total_width, width)
            name += f"{exemplar.of_before}of{exemplar.of_after}{exemplar.total:0{total_width}d}"
        expected_path = exemplar.observed.path.parent / f"{name}{exemplar.suffix}"
        missing.append(
            MissingEvidence(
                code="multipart_archive_part_missing",
                message=(
                    f"Multipart archive sequence '{label}' is incomplete; missing part "
                    f"numbers {_format_ranges(missing_indices)}."
                ),
                source_path=expected_path,
            )
        )
    return missing


def _numeric_volume_missing(
    observed_paths: list[_ObservedPath],
    *,
    pattern: re.Pattern[str],
    marker: str,
    start: int,
    terminal_suffix: str | None = None,
) -> list[MissingEvidence]:
    groups: dict[tuple[str, str], list[_NumericVolumePart]] = {}
    for observed in observed_paths:
        part = _numeric_part(observed, pattern)
        if part is None:
            continue
        key = (_path_key(observed.path.parent), part.base.casefold())
        groups.setdefault(key, []).append(part)

    available_paths = {
        _path_key(observed.path) for observed in observed_paths if observed.available
    }
    missing: list[MissingEvidence] = []
    for parts in groups.values():
        parts.sort(key=lambda part: (part.index, str(part.observed.path).casefold()))
        exemplar = parts[0]
        maximum = max(part.index for part in parts)
        label = f"{exemplar.base}.{marker}*"
        if maximum > MAX_MULTIPART_SEQUENCE_PARTS:
            missing.append(_unbounded_sequence(label, exemplar.observed.path, maximum))
            continue
        available = {part.index for part in parts if part.observed.available}
        missing_indices = [index for index in range(start, maximum + 1) if index not in available]
        width = max(part.width for part in parts)
        terminal: Path | None = None
        terminal_missing = False
        if terminal_suffix is not None:
            terminal = exemplar.observed.path.parent / f"{exemplar.base}{terminal_suffix}"
            terminal_missing = _path_key(terminal) not in available_paths
        if not missing_indices and not terminal_missing:
            continue
        details: list[str] = []
        if missing_indices:
            details.append(f"part numbers {_format_ranges(missing_indices)}")
            expected_name = f"{exemplar.base}.{marker}{missing_indices[0]:0{width}d}"
            expected_path = exemplar.observed.path.parent / expected_name
        else:
            expected_path = terminal or exemplar.observed.path
        if terminal_missing and terminal is not None:
            details.append(f"terminal file {terminal.name}")
        missing.append(
            MissingEvidence(
                code="multipart_archive_part_missing",
                message=(
                    f"Multipart archive sequence '{label}' is incomplete; missing "
                    f"{' and '.join(details)}."
                ),
                source_path=expected_path,
            )
        )
    return missing


def collect_multipart_archive_missing_evidence(
    records: list[ArtifactRecord],
) -> list[MissingEvidence]:
    """Identify deterministically knowable gaps in supplied archive sequences."""
    observed_paths = _observed_paths(records)
    missing = [
        *_numbered_archive_missing(observed_paths),
        *_numeric_volume_missing(
            observed_paths,
            pattern=_NUMERIC_VOLUME_PATTERN,
            marker="",
            start=1,
        ),
        *_numeric_volume_missing(
            observed_paths,
            pattern=_SPLIT_ZIP_PATTERN,
            marker="z",
            start=1,
            terminal_suffix=".zip",
        ),
        *_numeric_volume_missing(
            observed_paths,
            pattern=_SPLIT_RAR_PATTERN,
            marker="r",
            start=0,
            terminal_suffix=".rar",
        ),
    ]
    return sorted(
        missing,
        key=lambda item: (
            os.path.normcase(str(item.source_path or "")),
            item.code,
            item.message,
        ),
    )
