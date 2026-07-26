from __future__ import annotations

from collections import defaultdict

from pydantic import JsonValue

from maa_diagnostic_expert.contracts.mla import (
    MlaRecognitionActivitySignal,
    MlaRuntimeFailure,
    MlaRuntimeOutcome,
    MlaRuntimeSignal,
    MlaRuntimeTaskExecution,
)
from maa_diagnostic_expert.contracts.mse import MseCompatibilityStatus, MseResolvedTask
from maa_diagnostic_expert.contracts.workflow import (
    IncidentCandidate,
    IncidentComparison,
    IncidentComparisonFinding,
    IncidentComparisonFindingKind,
    IncidentComparisonStatus,
    IncidentCorrelationDraft,
    IncidentExpectedTask,
    IncidentObservedExecution,
)

from .evidence_synthesis import (
    runtime_failure_evidence_id,
    runtime_outcome_evidence_id,
    runtime_signal_evidence_id,
    runtime_task_evidence_id,
)
from .models import DeterministicInspection
from .mse_preflight import (
    mse_task_evidence_id,
    mse_task_not_found_evidence_id,
)


def _append_unique(items: list[str], value: str | None) -> None:
    if value and value not in items:
        items.append(value)


def _scope_matches(
    candidate: IncidentCandidate,
    *,
    session_id: str | None,
    task_id: int,
    task_name: str,
) -> bool:
    if candidate.session_id is not None and candidate.session_id != session_id:
        return False
    if candidate.task_id is not None and candidate.task_id != task_id:
        return False
    return candidate.task_name is None or candidate.task_name == task_name


def _failure_matches(candidate: IncidentCandidate, failure: MlaRuntimeFailure) -> bool:
    return _scope_matches(
        candidate,
        session_id=failure.session_id,
        task_id=failure.task_id,
        task_name=failure.task_name,
    ) and (candidate.node_name is None or candidate.node_name == failure.node_name)


def _outcome_matches(candidate: IncidentCandidate, outcome: MlaRuntimeOutcome) -> bool:
    if not _scope_matches(
        candidate,
        session_id=outcome.session_id,
        task_id=outcome.task_id,
        task_name=outcome.task_name,
    ):
        return False
    return (
        candidate.node_name is None
        or outcome.node_name is None
        or candidate.node_name == outcome.node_name
    )


def _signal_matches(candidate: IncidentCandidate, signal: MlaRuntimeSignal) -> bool:
    if not _scope_matches(
        candidate,
        session_id=signal.session_id,
        task_id=signal.task_id,
        task_name=signal.task_name,
    ):
        return False
    if candidate.node_name is None:
        return True
    if isinstance(signal, MlaRecognitionActivitySignal):
        return signal.pipeline_node_name == candidate.node_name
    return candidate.node_name in signal.pattern


def _task_matches(
    candidate: IncidentCandidate,
    session_id: str | None,
    task: MlaRuntimeTaskExecution,
) -> bool:
    return _scope_matches(
        candidate,
        session_id=session_id,
        task_id=task.task_id,
        task_name=task.name,
    )


def _observed_execution(
    inspection: DeterministicInspection,
    candidate: IncidentCandidate,
    known_evidence_ids: set[str],
) -> IncidentObservedExecution:
    evidence_ids = [item for item in candidate.evidence_ids if item in known_evidence_ids]
    failure_kinds: list[str] = []
    outcome_kinds: list[str] = []
    signal_kinds: list[str] = []
    for artifact in inspection.mla_runtime_inspections:
        runtime = artifact.inspection
        for failure in runtime.failures:
            if not _failure_matches(candidate, failure):
                continue
            evidence_id = runtime_failure_evidence_id(artifact.artifact_id, failure.failure_id)
            if evidence_id in known_evidence_ids:
                _append_unique(failure_kinds, failure.kind.value)
                _append_unique(evidence_ids, evidence_id)
        for outcome in runtime.outcomes:
            if not _outcome_matches(candidate, outcome):
                continue
            evidence_id = runtime_outcome_evidence_id(artifact.artifact_id, outcome.outcome_id)
            if evidence_id in known_evidence_ids:
                _append_unique(outcome_kinds, outcome.kind.value)
                _append_unique(evidence_ids, evidence_id)
        for signal in runtime.signals:
            if not _signal_matches(candidate, signal):
                continue
            evidence_id = runtime_signal_evidence_id(artifact.artifact_id, signal.signal_id)
            if evidence_id in known_evidence_ids:
                _append_unique(signal_kinds, signal.kind)
                _append_unique(evidence_ids, evidence_id)
        for session in runtime.sessions:
            for task in session.tasks:
                if _task_matches(candidate, session.session_id, task):
                    evidence_id = runtime_task_evidence_id(artifact.artifact_id, task.execution_id)
                    if evidence_id in known_evidence_ids:
                        _append_unique(evidence_ids, evidence_id)
        for task in runtime.unscoped_tasks:
            if _task_matches(candidate, None, task):
                evidence_id = runtime_task_evidence_id(artifact.artifact_id, task.execution_id)
                if evidence_id in known_evidence_ids:
                    _append_unique(evidence_ids, evidence_id)
    return IncidentObservedExecution(
        candidate_id=candidate.candidate_id,
        session_id=candidate.session_id,
        task_id=candidate.task_id,
        task_name=candidate.task_name,
        node_name=candidate.node_name,
        failure_kinds=failure_kinds,
        outcome_kinds=outcome_kinds,
        signal_kinds=signal_kinds,
        evidence_ids=evidence_ids,
    )


def _config_string(config: dict[str, JsonValue], key: str) -> str | None:
    value = config.get(key)
    return value if isinstance(value, str) and value else None


def _expected_tasks(
    inspection: DeterministicInspection,
    target_names: list[str],
    known_evidence_ids: set[str],
) -> list[IncidentExpectedTask]:
    grouped: dict[tuple[str, str], list[MseResolvedTask]] = defaultdict(list)
    for project in inspection.mse_task_resolutions:
        status = project.resolution.compatibility.status
        if status is MseCompatibilityStatus.UNSUPPORTED:
            continue
        for resolved in project.resolution.resolutions:
            if status is MseCompatibilityStatus.PARTIAL and not resolved.found:
                continue
            if resolved.name in target_names:
                grouped[(project.source_id, resolved.name)].append(resolved)

    expected: list[IncidentExpectedTask] = []
    for (source_id, task_name), raw_variants in grouped.items():
        controllers: list[str] = []
        resources: list[str] = []
        recognition_types: list[str] = []
        action_types: list[str] = []
        next_targets: list[str] = []
        evidence_ids: list[str] = []
        found_variants = 0
        for variant in raw_variants:
            if variant.found:
                found_variants += 1
            _append_unique(controllers, variant.controller)
            _append_unique(resources, variant.resource)
            _append_unique(
                recognition_types,
                _config_string(variant.effective_config, "recognition"),
            )
            _append_unique(
                action_types,
                _config_string(variant.effective_config, "action"),
            )
            for reference in variant.references:
                if reference.kind == "task.next":
                    _append_unique(next_targets, reference.target)
            for definition in variant.definitions:
                evidence_id = mse_task_evidence_id(
                    source_id,
                    definition.source_path,
                    definition.line,
                    variant.name,
                    variant.controller,
                    variant.resource,
                )
                if evidence_id in known_evidence_ids:
                    _append_unique(evidence_ids, evidence_id)
        if found_variants == 0:
            evidence_id = mse_task_not_found_evidence_id(source_id, task_name)
            if evidence_id in known_evidence_ids:
                _append_unique(evidence_ids, evidence_id)
        expected.append(
            IncidentExpectedTask(
                source_id=source_id,
                task_name=task_name,
                found_variants=found_variants,
                controllers=controllers,
                resources=resources,
                recognition_types=recognition_types,
                action_types=action_types,
                next_targets=next_targets,
                evidence_ids=evidence_ids,
            )
        )
    return expected


def _candidate_target_names(candidate: IncidentCandidate) -> list[str]:
    names: list[str] = []
    _append_unique(names, candidate.node_name)
    _append_unique(names, candidate.task_name)
    return names


def _finding(
    kind: IncidentComparisonFindingKind,
    statement: str,
    observed: IncidentObservedExecution,
    expected: list[IncidentExpectedTask],
) -> IncidentComparisonFinding:
    return IncidentComparisonFinding(
        kind=kind,
        statement=statement,
        observed_evidence_ids=observed.evidence_ids,
        expected_evidence_ids=list(
            dict.fromkeys(evidence_id for item in expected for evidence_id in item.evidence_ids)
        ),
    )


def compare_incident_execution(
    inspection: DeterministicInspection,
    correlation: IncidentCorrelationDraft,
) -> DeterministicInspection:
    """Compare correlated runtime observations with version-matched MSE facts."""
    candidates = {item.candidate_id: item for item in inspection.incident_selection.candidates}
    relevant = [
        candidate
        for candidate_id in correlation.relevant_candidate_ids
        if (candidate := candidates.get(candidate_id)) is not None
    ]
    if not relevant:
        comparison = IncidentComparison(
            status=IncidentComparisonStatus.UNAVAILABLE,
            missing_evidence=[
                "No relevant deterministic incident candidate was available for comparison."
            ],
        )
        return inspection.model_copy(update={"incident_comparison": comparison})

    known_evidence_ids = {
        item.id for item in [*inspection.prepared.evidence, *inspection.synthesized_evidence]
    }
    observed = [
        _observed_execution(inspection, candidate, known_evidence_ids) for candidate in relevant
    ]
    target_names = list(
        dict.fromkeys(name for candidate in relevant for name in _candidate_target_names(candidate))
    )
    expected = _expected_tasks(inspection, target_names, known_evidence_ids)
    findings: list[IncidentComparisonFinding] = []
    missing: list[str] = []

    for candidate, actual in zip(relevant, observed, strict=True):
        names = set(_candidate_target_names(candidate))
        candidate_expected = [item for item in expected if item.task_name in names]
        resolved = [item for item in candidate_expected if item.found_variants > 0]
        if resolved:
            findings.append(
                _finding(
                    IncidentComparisonFindingKind.ACTUAL_AND_EXPECTED_AVAILABLE,
                    (
                        f"Runtime observations and version-matched pipeline definitions "
                        f"are both available for candidate '{candidate.candidate_id}'."
                    ),
                    actual,
                    resolved,
                )
            )
            if "next_list_timeout" in actual.failure_kinds:
                findings.append(
                    _finding(
                        IncidentComparisonFindingKind.NEXT_LIST_TIMEOUT_AT_RESOLVED_NODE,
                        (
                            "A next-list timeout was observed at a pipeline node whose "
                            "version-matched effective configuration was resolved."
                        ),
                        actual,
                        resolved,
                    )
                )
            if "action_failed" in actual.failure_kinds:
                findings.append(
                    _finding(
                        IncidentComparisonFindingKind.ACTION_FAILURE_AT_RESOLVED_NODE,
                        (
                            "An action failure was observed at a pipeline node whose "
                            "version-matched effective configuration was resolved."
                        ),
                        actual,
                        resolved,
                    )
                )
            if "recognition_activity" in actual.signal_kinds:
                findings.append(
                    _finding(
                        IncidentComparisonFindingKind.RECOGNITION_ACTIVITY_AT_RESOLVED_NODE,
                        (
                            "Recognition activity was observed for a pipeline node whose "
                            "version-matched effective configuration was resolved."
                        ),
                        actual,
                        resolved,
                    )
                )
            if any(kind.startswith("repeated_node") for kind in actual.signal_kinds):
                findings.append(
                    _finding(
                        IncidentComparisonFindingKind.REPETITION_AT_RESOLVED_NODE,
                        (
                            "A repeated-node signal involved a pipeline node whose "
                            "version-matched effective configuration was resolved."
                        ),
                        actual,
                        resolved,
                    )
                )
        elif candidate_expected:
            findings.append(
                _finding(
                    IncidentComparisonFindingKind.EXPECTED_TASK_NOT_FOUND,
                    (
                        "MSE inspected the project configurations but did not find the "
                        f"candidate task/node names: {', '.join(sorted(names))}."
                    ),
                    actual,
                    candidate_expected,
                )
            )
            missing.append(
                f"Expected pipeline definition was not found for candidate "
                f"'{candidate.candidate_id}'."
            )
        else:
            findings.append(
                _finding(
                    IncidentComparisonFindingKind.ACTUAL_EXECUTION_ONLY,
                    (
                        f"Only runtime observations are available for candidate "
                        f"'{candidate.candidate_id}'; no focused MSE result exists."
                    ),
                    actual,
                    [],
                )
            )
            missing.append(
                f"No focused expected configuration is available for candidate "
                f"'{candidate.candidate_id}'."
            )

    has_observed = any(item.evidence_ids for item in observed)
    has_expected = any(item.found_variants > 0 and item.evidence_ids for item in expected)
    status = (
        IncidentComparisonStatus.COMPLETE
        if has_observed and has_expected
        else IncidentComparisonStatus.PARTIAL
        if has_observed or expected
        else IncidentComparisonStatus.UNAVAILABLE
    )
    comparison = IncidentComparison(
        status=status,
        candidate_ids=[item.candidate_id for item in relevant],
        observed_executions=observed,
        expected_tasks=expected,
        findings=findings,
        missing_evidence=missing,
    )
    return inspection.model_copy(update={"incident_comparison": comparison})
