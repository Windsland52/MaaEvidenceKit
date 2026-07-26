from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from itertools import combinations
from pathlib import Path

from maa_diagnostic_expert.contracts.domain import MissingEvidence

from .log_overview import LogOverviewCollection, LogOverviewStatus
from .models import MlaArtifactInspection


@dataclass(frozen=True, slots=True)
class _TimeRange:
    family: str
    label: str
    source_path: Path
    start: datetime
    end: datetime
    start_text: str
    end_text: str
    basis: str


def _parse_timestamp(value: str) -> tuple[datetime, str] | None:
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        if parsed.utcoffset() is None:
            return parsed, "local-time-without-offset"
        return parsed.astimezone(UTC), "absolute-time-with-offset"
    except (OverflowError, ValueError):
        return None


def _time_range(
    *,
    family: str,
    label: str,
    source_path: Path,
    start_text: str | None,
    end_text: str | None,
) -> tuple[_TimeRange | None, MissingEvidence | None]:
    if start_text is None or end_text is None:
        return None, None
    parsed_start = _parse_timestamp(start_text)
    parsed_end = _parse_timestamp(end_text)
    if parsed_start is None or parsed_end is None:
        return (
            None,
            MissingEvidence(
                code="artifact_time_range_unparseable",
                message=(
                    f"{label} exposes a time range that cannot be parsed deterministically: "
                    f"{start_text}..{end_text}."
                ),
                source_path=source_path,
            ),
        )
    start, start_basis = parsed_start
    end, end_basis = parsed_end
    if start_basis != end_basis:
        return (
            None,
            MissingEvidence(
                code="artifact_time_basis_inconsistent",
                message=(
                    f"{label} mixes timestamps with and without an explicit UTC offset: "
                    f"{start_text}..{end_text}."
                ),
                source_path=source_path,
            ),
        )
    if end < start:
        return (
            None,
            MissingEvidence(
                code="artifact_time_range_invalid",
                message=f"{label} ends before it starts: {start_text}..{end_text}.",
                source_path=source_path,
            ),
        )
    return (
        _TimeRange(
            family=family,
            label=label,
            source_path=source_path,
            start=start,
            end=end,
            start_text=start_text,
            end_text=end_text,
            basis=start_basis,
        ),
        None,
    )


def _collect_ranges(
    log_overviews: LogOverviewCollection,
    mla_preflights: list[MlaArtifactInspection],
) -> tuple[list[_TimeRange], list[MissingEvidence]]:
    ranges: list[_TimeRange] = []
    missing: list[MissingEvidence] = []
    for overview in log_overviews.overviews:
        if overview.status is not LogOverviewStatus.COMPLETE:
            continue
        time_range, problem = _time_range(
            family=overview.source_kind.value,
            label=f"{overview.source_kind.value} log {overview.path.name}",
            source_path=overview.path,
            start_text=overview.first_timestamp_text,
            end_text=overview.last_timestamp_text,
        )
        if time_range is not None:
            ranges.append(time_range)
        if problem is not None:
            missing.append(problem)

    for inspection in mla_preflights:
        for session in inspection.preflight.framework.sessions:
            time_range, problem = _time_range(
                family="maa_framework",
                label=f"MaaFramework session {session.session_id}",
                source_path=inspection.path,
                start_text=session.start.timestamp,
                end_text=session.end.timestamp,
            )
            if time_range is not None:
                ranges.append(time_range)
            if problem is not None:
                missing.append(problem)
    return ranges, missing


def _gap(left: _TimeRange, right: _TimeRange) -> timedelta:
    if left.end < right.start:
        return right.start - left.end
    if right.end < left.start:
        return left.start - right.end
    return timedelta(0)


def _range_text(time_range: _TimeRange) -> str:
    return f"{time_range.start_text}..{time_range.end_text}"


def collect_time_range_missing_evidence(
    log_overviews: LogOverviewCollection,
    mla_preflights: list[MlaArtifactInspection],
) -> list[MissingEvidence]:
    """Report source families that cannot be correlated on a common time window."""
    ranges, missing = _collect_ranges(log_overviews, mla_preflights)
    by_family: dict[str, list[_TimeRange]] = {}
    for time_range in ranges:
        by_family.setdefault(time_range.family, []).append(time_range)

    for left_family, right_family in combinations(sorted(by_family), 2):
        pairs = [
            (left, right) for left in by_family[left_family] for right in by_family[right_family]
        ]
        comparable = [(left, right) for left, right in pairs if left.basis == right.basis]
        if not comparable:
            left = min(by_family[left_family], key=lambda item: str(item.source_path).casefold())
            right = min(by_family[right_family], key=lambda item: str(item.source_path).casefold())
            missing.append(
                MissingEvidence(
                    code="artifact_time_bases_incompatible",
                    message=(
                        f"{left.label} uses {left.basis}, while {right.label} uses "
                        f"{right.basis}; their time ranges cannot be correlated safely."
                    ),
                    source_path=left.source_path,
                )
            )
            continue

        closest_left, closest_right = min(
            comparable,
            key=lambda pair: (
                _gap(*pair),
                str(pair[0].source_path).casefold(),
                str(pair[1].source_path).casefold(),
            ),
        )
        closest_gap = _gap(closest_left, closest_right)
        if closest_gap == timedelta(0):
            continue
        missing.append(
            MissingEvidence(
                code="artifact_time_ranges_incompatible",
                message=(
                    f"{closest_left.label} ({_range_text(closest_left)}) and "
                    f"{closest_right.label} ({_range_text(closest_right)}) have no common "
                    f"time window; the closest gap is {closest_gap}."
                ),
                source_path=closest_left.source_path,
            )
        )
    return sorted(
        missing,
        key=lambda item: (
            str(item.source_path or "").casefold(),
            item.code,
            item.message,
        ),
    )
