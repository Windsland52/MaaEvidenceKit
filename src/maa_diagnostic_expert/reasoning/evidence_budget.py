from __future__ import annotations

from dataclasses import dataclass

from maa_diagnostic_expert.contracts.domain import Evidence

MODEL_EVIDENCE_MAX_ITEMS = 40
MODEL_EVIDENCE_MAX_CHARACTERS = 64_000
MODEL_EVIDENCE_MAX_ITEM_CHARACTERS = 12_000

_TRUNCATION_MARKER = "[... evidence content truncated for model context ...]"


@dataclass(frozen=True, slots=True)
class ModelEvidenceSelection:
    """A bounded projection of the authoritative evidence ledger for one model call."""

    evidence: list[Evidence]
    available_count: int
    omitted_count: int
    truncated_count: int


def render_model_evidence_item(item: Evidence) -> str:
    """Render one evidence record using the stable model-facing text format."""
    header = f"[{item.id}] ({item.reliability.value}/{item.role.value}/{item.kind})"
    body = item.content
    if item.line_start is not None:
        if item.line_end is not None and item.line_end != item.line_start:
            location = f"lines {item.line_start}-{item.line_end}"
        else:
            location = f"line {item.line_start}"
        body = f"location: {item.source_path} {location}\n{body}"
    return f"{header}\n{body}"


def _fit_evidence_item(item: Evidence, character_limit: int) -> tuple[Evidence, bool] | None:
    rendered = render_model_evidence_item(item)
    if len(rendered) <= character_limit:
        return item, False

    marker_only = item.model_copy(update={"content": _TRUNCATION_MARKER})
    marker_length = len(render_model_evidence_item(marker_only))
    if marker_length > character_limit:
        return None

    prefix_limit = character_limit - marker_length - 1
    prefix = item.content[: max(0, prefix_limit)].rstrip()
    content = f"{prefix}\n{_TRUNCATION_MARKER}" if prefix else _TRUNCATION_MARKER
    bounded = item.model_copy(update={"content": content})
    return bounded, True


def bound_model_evidence(evidence: list[Evidence]) -> ModelEvidenceSelection:
    """Bound evidence count and rendered characters without mutating the ledger."""
    selected: list[Evidence] = []
    rendered_characters = 0
    truncated_count = 0

    for item in evidence:
        if len(selected) >= MODEL_EVIDENCE_MAX_ITEMS:
            break
        separator_length = 2 if selected else 0
        remaining = MODEL_EVIDENCE_MAX_CHARACTERS - rendered_characters - separator_length
        item_limit = min(MODEL_EVIDENCE_MAX_ITEM_CHARACTERS, remaining)
        fitted = _fit_evidence_item(item, item_limit)
        if fitted is None:
            continue
        bounded, truncated = fitted
        rendered_characters += separator_length + len(render_model_evidence_item(bounded))
        selected.append(bounded)
        truncated_count += int(truncated)

    return ModelEvidenceSelection(
        evidence=selected,
        available_count=len(evidence),
        omitted_count=len(evidence) - len(selected),
        truncated_count=truncated_count,
    )
