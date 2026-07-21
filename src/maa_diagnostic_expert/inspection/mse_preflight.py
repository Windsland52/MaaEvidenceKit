from __future__ import annotations

import hashlib
from collections import defaultdict
from pathlib import Path

from maa_diagnostic_expert.contracts.domain import Evidence, EvidenceReliability
from maa_diagnostic_expert.contracts.mse import MseDiagnostic

from .models import MseProjectInspection

_SOURCE_COMPONENT = "mse:project-preflight"
_MAX_DIAGNOSTIC_EVIDENCE = 100


def _summary_evidence(inspection: MseProjectInspection) -> Evidence:
    preflight = inspection.preflight
    interface_path = preflight.interface_path or "."
    configurations = preflight.configurations
    task_names = [
        binding.name + (f" -> {binding.entry}" if binding.entry else "")
        for binding in preflight.task_bindings[:50]
    ]
    lines = [
        f"MSE project preflight for source '{inspection.source_id}'",
        f"  compatibility: {preflight.compatibility.status.value}",
        f"  reason: {preflight.compatibility.reason}",
        f"  syntax mode: {preflight.syntax_mode}",
        f"  interface: {interface_path}",
        f"  controllers: {', '.join(preflight.controllers) or 'none'}",
        f"  resources: {', '.join(preflight.resources) or 'none'}",
        f"  configurations: {len(configurations)}",
        f"  interface tasks: {len(preflight.task_bindings)}",
        f"  static diagnostics: {len(preflight.diagnostics)}"
        + (" (truncated)" if preflight.diagnostics_truncated else ""),
    ]
    if task_names:
        lines.append(f"  task bindings: {', '.join(task_names)}")
    source_path = (
        str(inspection.path / interface_path) if preflight.interface_path else str(inspection.path)
    )
    return Evidence(
        id=f"mse:{inspection.source_id}:project-summary",
        kind="mse_project_summary",
        source_component=_SOURCE_COMPONENT,
        source_path=source_path,
        content=chr(10).join(lines),
        line_start=1 if preflight.interface_path else None,
        line_end=1 if preflight.interface_path else None,
        reliability=EvidenceReliability.CONTEXT,
    )


def _diagnostic_evidence(inspection: MseProjectInspection) -> list[Evidence]:
    grouped: dict[tuple[str, str, int, int, str], list[str]] = defaultdict(list)
    diagnostic_by_key: dict[tuple[str, str, int, int, str], MseDiagnostic] = {}
    for diagnostic in inspection.preflight.diagnostics:
        key = (
            diagnostic.type,
            diagnostic.source_path,
            diagnostic.line,
            diagnostic.column,
            diagnostic.message,
        )
        diagnostic_by_key[key] = diagnostic
        configuration = (
            f"{diagnostic.controller or '<default>'}/{diagnostic.resource or '<default>'}"
        )
        if configuration not in grouped[key]:
            grouped[key].append(configuration)

    evidence: list[Evidence] = []
    for key in sorted(grouped)[:_MAX_DIAGNOSTIC_EVIDENCE]:
        diagnostic = diagnostic_by_key[key]
        digest = hashlib.sha256(repr(key).encode()).hexdigest()[:16]
        content = [
            f"MSE static diagnostic [{diagnostic.level}] {diagnostic.type}",
            f"  message: {diagnostic.message}",
            f"  configurations: {', '.join(grouped[key])}",
        ]
        evidence.append(
            Evidence(
                id=f"mse:{inspection.source_id}:diagnostic:{digest}",
                kind="mse_static_diagnostic",
                source_component=_SOURCE_COMPONENT,
                source_path=str(inspection.path / Path(diagnostic.source_path)),
                content=chr(10).join(content),
                line_start=diagnostic.line,
                line_end=diagnostic.line,
                reliability=(
                    EvidenceReliability.PRIMARY
                    if diagnostic.level == "error"
                    else EvidenceReliability.SECONDARY
                ),
            )
        )
    return evidence


def synthesize_mse_evidence(inspections: list[MseProjectInspection]) -> list[Evidence]:
    evidence: list[Evidence] = []
    for inspection in inspections:
        evidence.append(_summary_evidence(inspection))
        evidence.extend(_diagnostic_evidence(inspection))
    return evidence
