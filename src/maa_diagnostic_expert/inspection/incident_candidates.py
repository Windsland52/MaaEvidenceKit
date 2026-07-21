from __future__ import annotations

import hashlib
from datetime import datetime
from typing import TYPE_CHECKING

from maa_diagnostic_expert.contracts.mla import (
    MlaRuntimeTaskCompleteness,
    MlaRuntimeTaskExecution,
    MlaRuntimeTaskStatus,
)
from maa_diagnostic_expert.contracts.workflow import (
    IncidentCandidate,
    IncidentSelection,
    IncidentSelectionStatus,
)

from .evidence_synthesis import (
    runtime_failure_evidence_id,
    runtime_outcome_evidence_id,
    runtime_signal_evidence_id,
    runtime_task_evidence_id,
)
from .log_overview import LogSeverity, log_occurrence_evidence_id

if TYPE_CHECKING:
    from .models import DeterministicInspection

MAX_INCIDENT_CANDIDATES = 100


def _timestamp(value: str | None) -> datetime | None:
    if value is None:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


def _candidate_id(*parts: object) -> str:
    digest = hashlib.sha256("|".join(str(part) for part in parts).encode()).hexdigest()[:20]
    return f"incident:{digest}"


def _task_reasons(task: MlaRuntimeTaskExecution) -> list[str]:
    reasons: list[str] = []
    if task.status is MlaRuntimeTaskStatus.FAILED:
        reasons.append("MaaFramework task status is failed")
    if task.status is MlaRuntimeTaskStatus.RUNNING:
        reasons.append("MaaFramework task was still running at log end")
    if task.completeness is MlaRuntimeTaskCompleteness.OPEN_AT_LOG_END:
        reasons.append("Task execution is open at log end")
    if task.direct_failure_ids:
        reasons.append(f"Task has {len(task.direct_failure_ids)} direct failure(s)")
    if task.outcome_ids:
        reasons.append(f"Task has {len(task.outcome_ids)} notable outcome(s)")
    if task.signal_highlights.repetitions:
        reasons.append(f"Task has {len(task.signal_highlights.repetitions)} repetition signal(s)")
    if task.signal_highlights.recognition_activity:
        reasons.append(
            "Task has "
            f"{len(task.signal_highlights.recognition_activity)} recognition activity signal(s)"
        )
    return reasons


def _task_confidence(task: MlaRuntimeTaskExecution) -> float:
    if task.status is MlaRuntimeTaskStatus.FAILED or task.direct_failure_ids:
        return 0.95
    if task.outcome_ids:
        return 0.85
    if (
        task.status is MlaRuntimeTaskStatus.RUNNING
        or task.completeness is MlaRuntimeTaskCompleteness.OPEN_AT_LOG_END
    ):
        return 0.8
    if task.signal_highlights.repetitions:
        return 0.7
    return 0.6


def _task_evidence_ids(
    artifact_id: str,
    task: MlaRuntimeTaskExecution,
    known_evidence_ids: set[str],
) -> list[str]:
    candidates = [
        runtime_task_evidence_id(artifact_id, task.execution_id),
        *(
            runtime_failure_evidence_id(artifact_id, failure_id)
            for failure_id in task.direct_failure_ids
        ),
        *(runtime_outcome_evidence_id(artifact_id, outcome_id) for outcome_id in task.outcome_ids),
        *(runtime_signal_evidence_id(artifact_id, signal_id) for signal_id in task.signal_ids),
    ]
    return list(dict.fromkeys(item for item in candidates if item in known_evidence_ids))


def _task_candidate(
    *,
    artifact_id: str,
    session_id: str | None,
    task: MlaRuntimeTaskExecution,
    node_name: str | None,
    known_evidence_ids: set[str],
) -> IncidentCandidate | None:
    reasons = _task_reasons(task)
    evidence_ids = _task_evidence_ids(artifact_id, task, known_evidence_ids)
    if not reasons or not evidence_ids:
        return None
    return IncidentCandidate(
        candidate_id=_candidate_id("mla-task", artifact_id, session_id, task.execution_id),
        session_id=session_id,
        task_id=task.task_id,
        task_name=task.name,
        node_name=node_name,
        started_at=_timestamp(task.started_at),
        ended_at=_timestamp(task.ended_at),
        confidence=_task_confidence(task),
        evidence_ids=evidence_ids,
        reasons=reasons,
    )


def generate_incident_selection(inspection: DeterministicInspection) -> IncidentSelection:
    """Generate bounded incident candidates without claiming which one matches the report."""
    known_evidence_ids = {
        item.id for item in [*inspection.prepared.evidence, *inspection.synthesized_evidence]
    }
    candidates: list[IncidentCandidate] = []

    for artifact in inspection.mla_runtime_inspections:
        runtime = artifact.inspection
        failures_by_id = {item.failure_id: item for item in runtime.failures}
        outcomes_by_id = {item.outcome_id: item for item in runtime.outcomes}
        represented_failures: set[str] = set()
        represented_outcomes: set[str] = set()
        for session in runtime.sessions:
            for task in session.tasks:
                node_name = next(
                    (
                        failure.node_name
                        for failure_id in task.direct_failure_ids
                        if (failure := failures_by_id.get(failure_id)) is not None
                    ),
                    next(
                        (
                            outcome.node_name
                            for outcome_id in task.outcome_ids
                            if (outcome := outcomes_by_id.get(outcome_id)) is not None
                            and outcome.node_name is not None
                        ),
                        task.last_node,
                    ),
                )
                candidate = _task_candidate(
                    artifact_id=artifact.artifact_id,
                    session_id=session.session_id,
                    task=task,
                    node_name=node_name,
                    known_evidence_ids=known_evidence_ids,
                )
                if candidate is not None:
                    candidates.append(candidate)
                    represented_failures.update(task.direct_failure_ids)
                    represented_outcomes.update(task.outcome_ids)
        for task in runtime.unscoped_tasks:
            node_name = next(
                (
                    failure.node_name
                    for failure_id in task.direct_failure_ids
                    if (failure := failures_by_id.get(failure_id)) is not None
                ),
                next(
                    (
                        outcome.node_name
                        for outcome_id in task.outcome_ids
                        if (outcome := outcomes_by_id.get(outcome_id)) is not None
                        and outcome.node_name is not None
                    ),
                    task.last_node,
                ),
            )
            candidate = _task_candidate(
                artifact_id=artifact.artifact_id,
                session_id=None,
                task=task,
                node_name=node_name,
                known_evidence_ids=known_evidence_ids,
            )
            if candidate is not None:
                candidates.append(candidate)
                represented_failures.update(task.direct_failure_ids)
                represented_outcomes.update(task.outcome_ids)

        for failure in runtime.failures:
            if failure.failure_id in represented_failures:
                continue
            evidence_id = runtime_failure_evidence_id(artifact.artifact_id, failure.failure_id)
            if evidence_id not in known_evidence_ids:
                continue
            candidates.append(
                IncidentCandidate(
                    candidate_id=_candidate_id(
                        "mla-failure",
                        artifact.artifact_id,
                        failure.failure_id,
                    ),
                    session_id=failure.session_id,
                    task_id=failure.task_id,
                    task_name=failure.task_name,
                    node_name=failure.node_name,
                    started_at=_timestamp(failure.started_at),
                    ended_at=_timestamp(failure.ended_at),
                    confidence=0.95,
                    evidence_ids=[evidence_id],
                    reasons=[f"MaaFramework reported direct failure: {failure.kind.value}"],
                )
            )

        for outcome in runtime.outcomes:
            if outcome.outcome_id in represented_outcomes:
                continue
            evidence_id = runtime_outcome_evidence_id(artifact.artifact_id, outcome.outcome_id)
            if evidence_id not in known_evidence_ids:
                continue
            candidates.append(
                IncidentCandidate(
                    candidate_id=_candidate_id(
                        "mla-outcome",
                        artifact.artifact_id,
                        outcome.outcome_id,
                    ),
                    session_id=outcome.session_id,
                    task_id=outcome.task_id,
                    task_name=outcome.task_name,
                    node_name=outcome.node_name,
                    confidence=0.9,
                    evidence_ids=[evidence_id],
                    reasons=[f"MaaFramework reported failed outcome: {outcome.kind.value}"],
                )
            )

    for overview in inspection.log_overviews.overviews:
        for occurrence in overview.notable_occurrences:
            evidence_id = log_occurrence_evidence_id(overview, occurrence)
            if evidence_id not in known_evidence_ids:
                continue
            confidence = {
                LogSeverity.CRITICAL: 0.8,
                LogSeverity.ERROR: 0.7,
                LogSeverity.WARNING: 0.45,
            }.get(occurrence.severity, 0.4)
            candidates.append(
                IncidentCandidate(
                    candidate_id=_candidate_id(
                        "log-occurrence",
                        overview.artifact_id,
                        occurrence.byte_offset,
                    ),
                    started_at=_timestamp(occurrence.timestamp_text),
                    ended_at=_timestamp(occurrence.timestamp_text),
                    confidence=confidence,
                    evidence_ids=[evidence_id],
                    reasons=[
                        f"{overview.source_kind.value} log contains a "
                        f"{occurrence.severity.value} occurrence"
                    ],
                )
            )

    candidates.sort(key=lambda item: (-item.confidence, item.candidate_id))
    omitted = max(0, len(candidates) - MAX_INCIDENT_CANDIDATES)
    retained = candidates[:MAX_INCIDENT_CANDIDATES]
    missing: list[str] = []
    if omitted:
        missing.append(
            f"{omitted} lower-priority incident candidate(s) were omitted by the bounded limit."
        )
    if not retained:
        missing.append(
            "No failed, incomplete, or signal-bearing MaaFramework task and no notable "
            "GUI/custom log occurrence was found."
        )
        return IncidentSelection(
            status=IncidentSelectionStatus.NOT_FOUND,
            candidates=[],
            missing_evidence=missing,
        )
    return IncidentSelection(
        status=IncidentSelectionStatus.AMBIGUOUS,
        candidates=retained,
        missing_evidence=missing,
    )
