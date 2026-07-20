from __future__ import annotations

from typing import TYPE_CHECKING

from .domain import Evidence, EvidenceReliability
from .mla_contracts import (
    MlaRecognitionActivitySignal,
    MlaRecognitionNextListEntry,
    MlaRecognitionTerminalMatch,
    MlaRepeatedNodeSequenceSignal,
    MlaRuntimeEvidencePosition,
    MlaRuntimeEvidenceRange,
    MlaRuntimeFailure,
    MlaRuntimeFailureKind,
    MlaRuntimeMetricDistribution,
    MlaRuntimeOutcome,
    MlaRuntimeOutcomeStatus,
    MlaRuntimeSession,
    MlaRuntimeSignalPriority,
    MlaRuntimeTaskExecution,
    MlaRuntimeTaskStatus,
)

if TYPE_CHECKING:
    from .inspection import MlaRuntimeInspectionArtifact

_SOURCE_COMPONENT = "mla:runtime-inspection"


def _position_path(position: MlaRuntimeEvidencePosition | None, fallback: str) -> str:
    if position is not None and position.path:
        return position.path
    return fallback


def _position_line(position: MlaRuntimeEvidencePosition | None) -> int | None:
    if position is not None:
        return position.local_line
    return None


def _range_lines(
    evidence_range: MlaRuntimeEvidenceRange,
) -> tuple[int | None, int | None]:
    start_line = _position_line(evidence_range.start)
    end_line = _position_line(evidence_range.end)
    if start_line is not None and end_line is None:
        end_line = start_line
    if end_line is not None and start_line is None:
        start_line = end_line
    return start_line, end_line


def _failure_kind_text(kind: MlaRuntimeFailureKind) -> str:
    if kind is MlaRuntimeFailureKind.NEXT_LIST_TIMEOUT:
        return "next list exhausted all candidates without a match before timeout"
    return "action execution failed"


def _next_list_text(entries: list[MlaRecognitionNextListEntry]) -> str:
    parts: list[str] = []
    for entry in entries:
        flags: list[str] = []
        if entry.anchor:
            flags.append("anchor")
        if entry.jump_back:
            flags.append("jump_back")
        suffix = f"({', '.join(flags)})" if flags else ""
        parts.append(f"{entry.name}{suffix}")
    return ", ".join(parts)


def _terminal_matches_text(matches: list[MlaRecognitionTerminalMatch], limit: int = 5) -> str:
    if not matches:
        return ""
    top = sorted(matches, key=lambda m: m.count, reverse=True)[:limit]
    return ", ".join(f"{m.name}({m.count})" for m in top)


def _metric_text(dist: MlaRuntimeMetricDistribution) -> str:
    return f"p50={dist.p50}ms, p95={dist.p95}ms, max={dist.maximum}ms"


def _format_failure(artifact_id: str, artifact_path: str, failure: MlaRuntimeFailure) -> Evidence:
    lines = [
        f"Task '{failure.task_name}' (task_id={failure.task_id}) failed: {failure.kind.value}",
        f"  at pipeline node '{failure.node_name}' (node_id={failure.node_id})",
        f"  mechanism: {_failure_kind_text(failure.kind)}",
        f"  session: {failure.session_id or 'unscoped'} | execution: {failure.execution_id}",
        f"  started: {failure.started_at}",
        f"  ended: {failure.ended_at or 'still running'}",
    ]
    if failure.error_images:
        lines.append(f"  error images: {len(failure.error_images)} referenced")
    if failure.vision_images:
        lines.append(f"  vision images: {len(failure.vision_images)} referenced")
    line = _position_line(failure.evidence)
    return Evidence(
        id=f"mla-ri:{artifact_id}:failure:{failure.failure_id}",
        kind="runtime_failure",
        source_component=_SOURCE_COMPONENT,
        source_path=_position_path(failure.evidence, artifact_path),
        content="\n".join(lines),
        line_start=line,
        line_end=line,
        task_id=failure.task_id,
        reliability=EvidenceReliability.PRIMARY,
    )


def _format_outcome(
    artifact_id: str, artifact_path: str, outcome: MlaRuntimeOutcome
) -> Evidence | None:
    if outcome.status is not MlaRuntimeOutcomeStatus.FAILED:
        return None
    if outcome.node_name is not None and outcome.node_id is not None:
        node_desc = f"node '{outcome.node_name}' (node_id={outcome.node_id})"
    elif outcome.node_name is not None:
        node_desc = f"node '{outcome.node_name}'"
    elif outcome.node_id is not None:
        node_desc = f"node_id={outcome.node_id}"
    else:
        node_desc = "task-level (no specific node)"
    lines = [
        f"Task '{outcome.task_name}' (task_id={outcome.task_id}) "
        f"{outcome.kind.value} outcome FAILED: {node_desc}",
        f"  session: {outcome.session_id or 'unscoped'} | execution: {outcome.execution_id}",
    ]
    if outcome.direct_failure_ids:
        lines.append(f"  related failures: {', '.join(outcome.direct_failure_ids)}")
    line = _position_line(outcome.evidence)
    return Evidence(
        id=f"mla-ri:{artifact_id}:outcome:{outcome.outcome_id}",
        kind="runtime_outcome",
        source_component=_SOURCE_COMPONENT,
        source_path=_position_path(outcome.evidence, artifact_path),
        content="\n".join(lines),
        line_start=line,
        line_end=line,
        task_id=outcome.task_id,
        reliability=EvidenceReliability.PRIMARY,
    )


def _format_recognition_signal(
    artifact_id: str, artifact_path: str, signal: MlaRecognitionActivitySignal
) -> Evidence | None:
    if signal.priority is not MlaRuntimeSignalPriority.HIGH:
        return None
    mixed_pct = (
        round(signal.occurrences_with_mixed_results / signal.occurrence_count * 100, 1)
        if signal.occurrence_count > 0
        else 0.0
    )
    terminal = signal.terminal_outcomes
    lines = [
        f"Recognition activity signal [HIGH] for node '{signal.pipeline_node_name}'",
        f"  in task '{signal.task_name}' (task_id={signal.task_id})",
        f"  session: {signal.session_id or 'unscoped'} | execution: {signal.execution_id}",
        f"  occurrences: {signal.occurrence_count}, "
        f"mixed results: {signal.occurrences_with_mixed_results} ({mixed_pct}%)",
        f"  terminal outcomes: {terminal.matched} matched, "
        f"{terminal.timeout} timeout, {terminal.unmatched} unmatched",
    ]
    matches_text = _terminal_matches_text(signal.terminal_matches)
    if matches_text:
        lines.append(f"  top terminal matches: {matches_text}")
    next_list_text = _next_list_text(signal.next_list)
    if next_list_text:
        lines.append(f"  next list: {next_list_text}")
    lines.append(f"  attempts: {_metric_text(signal.attempts)}")
    if signal.priority_reasons:
        lines.append(f"  priority reasons: {', '.join(r.value for r in signal.priority_reasons)}")
    worst = signal.representatives.worst
    start_line, end_line = _range_lines(worst.evidence)
    return Evidence(
        id=f"mla-ri:{artifact_id}:signal:{signal.signal_id}",
        kind="recognition_activity_signal",
        source_component=_SOURCE_COMPONENT,
        source_path=_position_path(worst.evidence.start, artifact_path),
        content="\n".join(lines),
        line_start=start_line,
        line_end=end_line,
        task_id=signal.task_id,
        reliability=EvidenceReliability.SECONDARY,
    )


def _format_repeated_node_signal(
    artifact_id: str, artifact_path: str, signal: MlaRepeatedNodeSequenceSignal
) -> Evidence | None:
    if signal.priority is not MlaRuntimeSignalPriority.HIGH:
        return None
    pattern_text = " -> ".join(signal.pattern)
    terms = signal.terminations
    lines = [
        f"Repeated node sequence [HIGH] (kind: {signal.kind}) "
        f"in task '{signal.task_name}' (task_id={signal.task_id})",
        f"  session: {signal.session_id or 'unscoped'} | execution: {signal.execution_id}",
        f"  pattern: {pattern_text} (length {len(signal.pattern)})",
        f"  segments: {signal.segment_count}, "
        f"total repeats: {signal.total_repeat_count}, "
        f"max repeat: {signal.maximum_repeat_count}",
        f"  duration: {_metric_text(signal.duration_ms)}",
        f"  terminations: {terms.left_pattern} left_pattern, "
        f"{terms.task_ended} task_ended, "
        f"{terms.still_repeating_at_log_end} still_repeating_at_log_end",
    ]
    if signal.priority_reasons:
        lines.append(f"  priority reasons: {', '.join(r.value for r in signal.priority_reasons)}")
    longest = signal.representatives.longest
    line = _position_line(longest.evidence)
    return Evidence(
        id=f"mla-ri:{artifact_id}:signal:{signal.signal_id}",
        kind="repeated_node_signal",
        source_component=_SOURCE_COMPONENT,
        source_path=_position_path(longest.evidence, artifact_path),
        content="\n".join(lines),
        line_start=line,
        line_end=line,
        task_id=signal.task_id,
        reliability=EvidenceReliability.SECONDARY,
    )


def _format_task_summary(
    artifact_id: str, artifact_path: str, task: MlaRuntimeTaskExecution
) -> Evidence:
    stats = task.statistics
    lines = [
        f"Task '{task.name}' (task_id={task.task_id}, execution {task.execution_id})",
        f"  status: {task.status.value}, completeness: {task.completeness.value}",
        f"  started: {task.started_at}",
    ]
    if task.ended_at:
        lines.append(f"  ended: {task.ended_at}")
    lines.append(
        f"  nodes: {stats.node_executions} executed "
        f"({stats.succeeded_nodes} succeeded, {stats.failed_nodes} failed, "
        f"{stats.running_nodes} running)"
    )
    lines.append(
        f"  recognition: {stats.recognition_attempts} attempts, "
        f"{stats.unsuccessful_recognition_attempts} unsuccessful"
    )
    lines.append(
        f"  actions: {stats.action_attempts} attempts, "
        f"{stats.action_failures} failures | "
        f"next list timeouts: {stats.next_list_timeouts}"
    )
    lines.append(
        f"  direct failures: {len(task.direct_failure_ids)} | "
        f"outcomes: {len(task.outcome_ids)} | "
        f"signals: {len(task.signal_ids)}"
    )
    highlights = task.signal_highlights
    lines.append(
        f"  signal highlights: "
        f"recognition={len(highlights.recognition_activity)}, "
        f"repetitions={len(highlights.repetitions)}"
    )
    start_line, end_line = _range_lines(task.evidence)
    return Evidence(
        id=f"mla-ri:{artifact_id}:task:{task.execution_id}",
        kind="task_execution_summary",
        source_component=_SOURCE_COMPONENT,
        source_path=_position_path(task.evidence.start, artifact_path),
        content="\n".join(lines),
        line_start=start_line,
        line_end=end_line,
        task_id=task.task_id,
        reliability=EvidenceReliability.CONTEXT,
    )


def _task_is_notable(task: MlaRuntimeTaskExecution) -> bool:
    if task.status is MlaRuntimeTaskStatus.FAILED:
        return True
    if task.status is MlaRuntimeTaskStatus.RUNNING:
        return True
    if task.direct_failure_ids:
        return True
    if task.outcome_ids:
        return True
    highlights = task.signal_highlights
    if highlights.recognition_activity or highlights.repetitions:
        return True
    return False


def _format_session_summary(
    artifact_id: str, artifact_path: str, session: MlaRuntimeSession
) -> Evidence:
    summary = session.summary
    lines = [
        f"Session '{session.session_id}'",
        f"  start: {session.start_kind.value}, framework: {session.framework_status.value}",
    ]
    if session.framework_version:
        lines.append(f"  version: {session.framework_version}")
    elif session.versions:
        lines.append(f"  versions: {', '.join(session.versions)}")
    lines.append(
        f"  tasks: {summary.task_executions} executed "
        f"({summary.succeeded_tasks} succeeded, {summary.failed_tasks} failed, "
        f"{summary.running_tasks} running)"
    )
    lines.append(
        f"  direct failures: {summary.direct_failures} "
        f"(next_list_timeout: {summary.next_list_timeouts}, "
        f"action_failed: {summary.action_failures})"
    )
    lines.append(f"  signals: {summary.signals}")
    return Evidence(
        id=f"mla-ri:{artifact_id}:session:{session.session_id}",
        kind="session_summary",
        source_component=_SOURCE_COMPONENT,
        source_path=session.start.path or artifact_path,
        content="\n".join(lines),
        line_start=session.start.line,
        line_end=session.end.line,
        reliability=EvidenceReliability.CONTEXT,
    )


def synthesize_evidence(
    runtime_inspections: list[MlaRuntimeInspectionArtifact],
) -> list[Evidence]:
    """Convert MLA runtime inspection results into Evidence records.

    Produces PRIMARY evidence for failures and failed outcomes,
    SECONDARY evidence for HIGH-priority signals, and CONTEXT evidence
    for notable task summaries and all session summaries.
    """
    evidence: list[Evidence] = []
    for artifact in runtime_inspections:
        artifact_id = artifact.artifact_id
        artifact_path = str(artifact.path)
        inspection = artifact.inspection

        for failure in inspection.failures:
            evidence.append(_format_failure(artifact_id, artifact_path, failure))

        for outcome in inspection.outcomes:
            formatted = _format_outcome(artifact_id, artifact_path, outcome)
            if formatted is not None:
                evidence.append(formatted)

        for signal in inspection.signals:
            if isinstance(signal, MlaRecognitionActivitySignal):
                formatted = _format_recognition_signal(artifact_id, artifact_path, signal)
            else:
                formatted = _format_repeated_node_signal(artifact_id, artifact_path, signal)
            if formatted is not None:
                evidence.append(formatted)

        for session in inspection.sessions:
            for task in session.tasks:
                if _task_is_notable(task):
                    evidence.append(_format_task_summary(artifact_id, artifact_path, task))
            evidence.append(_format_session_summary(artifact_id, artifact_path, session))

        for task in inspection.unscoped_tasks:
            if _task_is_notable(task):
                evidence.append(_format_task_summary(artifact_id, artifact_path, task))

    return evidence
