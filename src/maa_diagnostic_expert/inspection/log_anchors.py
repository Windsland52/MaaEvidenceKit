from __future__ import annotations

import re

from maa_diagnostic_expert.contracts.domain import Evidence

_LOG_MESSAGE_PREFIX = re.compile(
    r"^(?:\d{4}[-/.]\d{2}[-/.]\d{2}[ T]\d{2}:\d{2}:\d{2}(?:[.,]\d+)?\s+)?"
    r"(?:TRACE|DEBUG|INFO|WARN(?:ING)?|ERROR|CRITICAL)\s+(?:\[[^]]+\]\s+)?",
    re.IGNORECASE,
)
_DYNAMIC_LOG_FRAGMENT = re.compile(
    r"(?:\b[A-Za-z_$][A-Za-z0-9_$]*\s*=|[\"'][^\"']+[\"']|"
    r"\b[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\b|\d{2,})",
    re.IGNORECASE,
)


def source_search_anchor_terms(evidence: list[Evidence], *, limit: int = 3) -> list[str]:
    """Extract stable message fragments from observed log occurrences for source lookup."""
    candidates: dict[str, int] = {}
    for item in evidence:
        if not item.kind.startswith("log_occurrence:"):
            continue
        for raw_line in reversed(item.content.splitlines()):
            message = _LOG_MESSAGE_PREFIX.sub("", raw_line.strip())
            if " | " in message:
                message = message.rsplit(" | ", 1)[1]
            fragments = [fragment.strip().strip("\"'") for fragment in message.split(": ")]
            stable = [fragment for fragment in fragments if 8 <= len(fragment) <= 160]
            if stable:
                best = max(
                    stable,
                    key=lambda fragment: (
                        len(fragment) - 30 * len(_DYNAMIC_LOG_FRAGMENT.findall(fragment)),
                        len(fragment),
                    ),
                )
                score = len(best) - 30 * len(_DYNAMIC_LOG_FRAGMENT.findall(best))
                candidates[best] = max(candidates.get(best, score), score)
                break
    ranked = sorted(candidates, key=lambda candidate: (-candidates[candidate], -len(candidate)))
    return ranked[:limit]
