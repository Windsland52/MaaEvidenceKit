from __future__ import annotations

from maa_diagnostic_expert.contracts.domain import (
    Conclusion,
    DiagnosisResult,
    DiagnosisStatus,
    Evidence,
    EvidenceReliability,
    EvidenceRole,
)

_RELIABILITY_ORDER = {
    EvidenceReliability.PRIMARY: 0,
    EvidenceReliability.SECONDARY: 1,
    EvidenceReliability.CONTEXT: 2,
}

_RELIABILITY_LABEL = {
    EvidenceReliability.PRIMARY: "Primary (authoritative observation)",
    EvidenceReliability.SECONDARY: "Secondary (deterministically derived)",
    EvidenceReliability.CONTEXT: "Context (contextual source)",
}

_ROLE_ORDER = {
    EvidenceRole.FAILURE: 0,
    EvidenceRole.SIGNAL: 1,
    EvidenceRole.CONTEXT: 2,
}

_ROLE_LABEL = {
    EvidenceRole.FAILURE: "Failure (direct runtime failures)",
    EvidenceRole.SIGNAL: "Signal (warnings and anomalies)",
    EvidenceRole.CONTEXT: "Context (versions, configuration, and summaries)",
}

_STATUS_LABEL = {
    DiagnosisStatus.COMPLETE: "Complete",
    DiagnosisStatus.INSUFFICIENT_EVIDENCE: "Insufficient Evidence",
    DiagnosisStatus.NOT_APPLICABLE: "Not Applicable",
    DiagnosisStatus.FAILED: "Failed",
}


def _evidence_location(item: Evidence) -> str:
    parts: list[str] = [item.source_path]
    if item.line_start is not None:
        if item.line_end is not None and item.line_end != item.line_start:
            parts.append(f"lines {item.line_start}-{item.line_end}")
        else:
            parts.append(f"line {item.line_start}")
    return " ".join(parts)


def _format_conclusion(conclusion: Conclusion, index: int) -> str:
    confidence_pct = f"{conclusion.confidence * 100:.0f}%"
    evidence_list = ", ".join(f"`{eid}`" for eid in conclusion.evidence_ids)
    lines = [
        f"### Conclusion {index}",
        "",
        f"**Confidence:** {confidence_pct}",
        "",
        f"**Statement:** {conclusion.statement}",
        "",
        f"**Evidence:** {evidence_list}",
        "",
    ]
    return "\n".join(lines)


def _format_evidence_group(role: EvidenceRole, items: list[Evidence]) -> str:
    label = _ROLE_LABEL[role]
    lines = [f"### {label} ({len(items)})", ""]
    for item in items:
        location = _evidence_location(item)
        lines.append(f"#### `{item.id}`")
        lines.append("")
        lines.append(f"- **Kind:** {item.kind}")
        lines.append(f"- **Reliability:** {_RELIABILITY_LABEL[item.reliability]}")
        lines.append(f"- **Location:** {location}")
        if item.task_id is not None:
            lines.append(f"- **Task ID:** {item.task_id}")
        lines.append("- **Content:**")
        lines.append("")
        for line in item.content.splitlines():
            lines.append(f"  > {line}")
        lines.append("")
    return "\n".join(lines)


def render_markdown_report(result: DiagnosisResult) -> str:
    """Render a DiagnosisResult as a human-readable Markdown report."""
    status_label = _STATUS_LABEL.get(result.status, result.status.value)
    lines = [
        "# Diagnostic Report",
        "",
        f"**Status:** {status_label}",
        "",
        "## Summary",
        "",
        result.summary,
        "",
    ]

    if result.conclusions:
        lines.append("## Conclusions")
        lines.append("")
        for index, conclusion in enumerate(result.conclusions, start=1):
            lines.append(_format_conclusion(conclusion, index))
    else:
        lines.append("## Conclusions")
        lines.append("")
        lines.append("_No conclusions were formed._")
        lines.append("")

    if result.evidence:
        lines.append("## Evidence")
        lines.append("")
        grouped: dict[EvidenceRole, list[Evidence]] = {role: [] for role in EvidenceRole}
        for item in result.evidence:
            grouped[item.role].append(item)
        for role in sorted(grouped, key=lambda item: _ROLE_ORDER[item]):
            items = grouped[role]
            if items:
                ordered = sorted(
                    items,
                    key=lambda item: (_RELIABILITY_ORDER[item.reliability], item.id),
                )
                lines.append(_format_evidence_group(role, ordered))
    else:
        lines.append("## Evidence")
        lines.append("")
        lines.append("_No evidence was collected._")
        lines.append("")

    if result.missing_evidence:
        lines.append("## Missing Evidence")
        lines.append("")
        for code in result.missing_evidence:
            lines.append(f"- `{code}`")
        lines.append("")

    return "\n".join(lines)
