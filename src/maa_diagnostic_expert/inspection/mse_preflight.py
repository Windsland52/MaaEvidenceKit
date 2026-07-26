from __future__ import annotations

import hashlib
import json
from collections import defaultdict
from pathlib import Path

from maa_diagnostic_expert.contracts.domain import Evidence, EvidenceReliability, EvidenceRole
from maa_diagnostic_expert.contracts.mse import (
    MseCompatibilityStatus,
    MseDiagnostic,
)

from .models import MseProjectInspection, MseTaskResolutionInspection

_SOURCE_COMPONENT = "mse:project-preflight"
_MAX_DIAGNOSTIC_EVIDENCE = 100
_MAX_TASK_RESOLUTION_EVIDENCE = 100


def mse_task_evidence_id(
    source_id: str,
    source_path: str,
    line: int,
    task_name: str,
    controller: str | None,
    resource: str | None,
) -> str:
    key = (source_id, source_path, line, task_name, controller, resource)
    digest = hashlib.sha256(repr(key).encode()).hexdigest()[:16]
    return f"mse:{source_id}:task:{digest}"


def mse_task_not_found_evidence_id(source_id: str, task_name: str) -> str:
    digest = hashlib.sha256(f"{source_id}|{task_name}".encode()).hexdigest()[:16]
    return f"mse:{source_id}:task-not-found:{digest}"


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
        role=EvidenceRole.CONTEXT,
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
                role=EvidenceRole.SIGNAL,
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


def synthesize_mse_task_evidence(
    inspections: list[MseTaskResolutionInspection],
) -> list[Evidence]:
    evidence: list[Evidence] = []
    seen: set[tuple[str, str, int, str, str | None, str | None]] = set()
    for inspection in inspections:
        if inspection.resolution.compatibility.status is MseCompatibilityStatus.UNSUPPORTED:
            continue
        for resolved in inspection.resolution.resolutions:
            if not resolved.found:
                continue
            effective = json.dumps(
                resolved.effective_config,
                ensure_ascii=False,
                sort_keys=True,
                separators=(",", ":"),
            )
            reference_summary = ", ".join(
                f"{item.kind}={item.target}" for item in resolved.references[:50]
            )
            for definition in resolved.definitions:
                key = (
                    inspection.source_id,
                    definition.source_path,
                    definition.line,
                    resolved.name,
                    resolved.controller,
                    resolved.resource,
                )
                if key in seen:
                    continue
                seen.add(key)
                lines = [
                    f"MSE resolved MaaFramework task '{resolved.name}'",
                    (
                        "  configuration: "
                        f"{resolved.controller or '<default>'}/"
                        f"{resolved.resource or '<default>'}"
                    ),
                    f"  effective_config: {effective}",
                ]
                if reference_summary:
                    lines.append(f"  references: {reference_summary}")
                evidence.append(
                    Evidence(
                        id=mse_task_evidence_id(
                            inspection.source_id,
                            definition.source_path,
                            definition.line,
                            resolved.name,
                            resolved.controller,
                            resolved.resource,
                        ),
                        kind="mse_task_resolution",
                        source_component="mse:resolve-tasks",
                        source_path=str(inspection.path / Path(definition.source_path)),
                        content=chr(10).join(lines),
                        line_start=definition.line,
                        line_end=definition.line,
                        role=EvidenceRole.CONTEXT,
                        reliability=EvidenceReliability.SECONDARY,
                    )
                )
                if len(evidence) >= _MAX_TASK_RESOLUTION_EVIDENCE:
                    return evidence
        for task_name in inspection.resolution.requested_tasks:
            variants = [
                item for item in inspection.resolution.resolutions if item.name == task_name
            ]
            if any(item.found for item in variants):
                continue
            evidence.append(
                Evidence(
                    id=mse_task_not_found_evidence_id(
                        inspection.source_id,
                        task_name,
                    ),
                    kind="mse_task_not_found",
                    source_component="mse:resolve-tasks",
                    source_path=str(inspection.path),
                    content=chr(10).join(
                        [
                            f"MSE did not find MaaFramework task '{task_name}'",
                            (
                                "  inspected configurations: "
                                f"{len(variants)}"
                                + (
                                    " (truncated)"
                                    if inspection.resolution.configurations_truncated
                                    else ""
                                )
                            ),
                            (f"  interface: {inspection.resolution.interface_path or 'unknown'}"),
                        ]
                    ),
                    role=EvidenceRole.CONTEXT,
                    reliability=EvidenceReliability.CONTEXT,
                )
            )
            if len(evidence) >= _MAX_TASK_RESOLUTION_EVIDENCE:
                return evidence
    return evidence
