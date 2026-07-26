from __future__ import annotations

import asyncio
from datetime import UTC, datetime
from typing import cast

import pytest

from maa_diagnostic_expert.benchmark import (
    BenchmarkAnnotation,
    BenchmarkArtifact,
    BenchmarkCase,
    BenchmarkEvidenceRequirement,
    BenchmarkIssueSnapshot,
    BenchmarkJudgmentDraft,
    BenchmarkPayload,
    BenchmarkProvenance,
    BenchmarkResult,
    build_benchmark_judge_context,
    evaluate_benchmark_diagnosis,
    score_benchmark_judgment,
)
from maa_diagnostic_expert.contracts.domain import (
    Conclusion,
    ContractModel,
    DiagnosisResult,
    DiagnosisStatus,
    Evidence,
    EvidenceReliability,
    EvidenceRole,
)
from maa_diagnostic_expert.reasoning.protocol import ReasoningContext


def _annotation() -> BenchmarkAnnotation:
    return BenchmarkAnnotation(
        case_id="case-1",
        reported_symptom="The visible task does not complete.",
        observed_mechanism="The expected successor is not selected after a runtime failure.",
        initiating_trigger="The client enters the recovery branch.",
        root_cause="The issue-version pipeline omits the required recovery successor.",
        required_evidence=[
            BenchmarkEvidenceRequirement(
                evidence_id="runtime-path",
                kind="log_lines",
                source_ref="artifact:log#maafw.log",
                description="The runtime enters the recovery branch and fails its successor.",
                line_start=10,
                line_end=20,
            ),
            BenchmarkEvidenceRequirement(
                evidence_id="issue-source",
                kind="source_lines",
                source_ref="project@revision:pipeline.json",
                description="The issue-version pipeline lacks the recovery successor.",
            ),
        ],
        required_absences=[],
        acceptable_conclusions=[
            "The runtime reaches the recovery branch.",
            "The issue-version pipeline lacks a required recovery successor.",
        ],
        forbidden_claims=["The user disabled the feature."],
        missing_evidence=["No same-environment post-fix replay is available."],
        fix_direction="Add the recovery successor and replay the task.",
        provenance=[
            BenchmarkProvenance(
                kind="fixing_change",
                source_ref="https://example.invalid/pull/999",
                description="SECRET CLOSING CHANGE",
            )
        ],
        annotators=["reviewer"],
        adjudication="SECRET ADJUDICATION",
    )


def _case(case_id: str = "case-1") -> BenchmarkCase:
    snapshot_hash = "a" * 64
    return BenchmarkCase(
        case_id=case_id,
        source_candidate_id="example#1",
        project_id="example",
        repository="example/project",
        issue_number=1,
        tier="gold",
        split="stable",
        difficulty="l3",
        observation_cutoff=datetime(2026, 1, 1, tzinfo=UTC),
        annotation_cutoff=datetime(2026, 1, 2, tzinfo=UTC),
        visible_issue_snapshot=BenchmarkIssueSnapshot(
            issue_url="https://github.com/example/project/issues/1",
            snapshot_revision=snapshot_hash,
            payload=BenchmarkPayload(
                sha256=snapshot_hash,
                media_type="application/json",
                size_bytes=100,
                label="Filtered issue snapshot",
            ),
        ),
        visible_artifacts=[
            BenchmarkArtifact(
                artifact_id="b" * 64,
                source_url="https://github.com/user-attachments/files/1/logs.zip",
                filename="logs.zip",
                payload=BenchmarkPayload(
                    sha256="c" * 64,
                    media_type="application/zip",
                    size_bytes=200,
                    label="Diagnostic logs",
                ),
                captured_at=datetime(2026, 1, 1, tzinfo=UTC),
                privacy_review="pass",
                redistribution="download_only",
                required=True,
            )
        ],
        issue_source_revision="d" * 40,
        tasks=["diagnose_at_report_time"],
        coverage_tags=["version-matched-source"],
    )


def _diagnosis(status: DiagnosisStatus = DiagnosisStatus.COMPLETE) -> DiagnosisResult:
    evidence = Evidence(
        id="ev:runtime",
        kind="runtime_failure",
        source_component="test",
        source_path="maafw.log",
        content="recovery branch failed\n" + "x" * 2_500,
        line_start=10,
        line_end=20,
        role=EvidenceRole.FAILURE,
        reliability=EvidenceReliability.PRIMARY,
    )
    conclusions = (
        [
            Conclusion(
                statement=(
                    "The recovery branch runs, but issue-version source lacks its successor."
                ),
                evidence_ids=[evidence.id],
                confidence=0.9,
            )
        ]
        if status is DiagnosisStatus.COMPLETE
        else []
    )
    return DiagnosisResult(
        status=status,
        summary="The recovery route is incomplete.",
        evidence=[evidence],
        conclusions=conclusions,
        missing_evidence=["post_fix_replay"],
    )


def _perfect_judgment() -> BenchmarkJudgmentDraft:
    return BenchmarkJudgmentDraft(
        case_id="case-1",
        covered_required_evidence_ids=["runtime-path", "issue-source"],
        matched_acceptable_conclusion_indexes=[0, 1],
        acknowledged_missing_evidence_indexes=[0],
        separates_diagnostic_layers=True,
        citations_traceable=True,
        rationale="The diagnosis covers the complete evidence-backed mechanism.",
    )


class _JudgeSession:
    def __init__(
        self,
        judgment: BenchmarkJudgmentDraft,
        contexts: list[ReasoningContext],
    ) -> None:
        self.judgment = judgment
        self.contexts = contexts
        self.closed = False

    async def reason[ResultT: ContractModel](
        self,
        context: ReasoningContext,
        result_type: type[ResultT],
    ) -> ResultT:
        if result_type is not BenchmarkJudgmentDraft:
            raise TypeError(result_type.__name__)
        self.contexts.append(context)
        return cast(ResultT, self.judgment)

    async def close(self) -> None:
        self.closed = True


class _JudgeBackend:
    def __init__(self, judgment: BenchmarkJudgmentDraft) -> None:
        self.judgment = judgment
        self.contexts: list[ReasoningContext] = []
        self.session: _JudgeSession | None = None

    async def start(self, *, run_id: str) -> _JudgeSession:
        assert run_id == "benchmark-run"
        self.session = _JudgeSession(self.judgment, self.contexts)
        return self.session


def test_perfect_judgment_scores_and_hashes_diagnosis() -> None:
    result = score_benchmark_judgment(
        _annotation(),
        _diagnosis(),
        _perfect_judgment(),
    )

    assert result.score == 1
    assert result.passed
    assert len(result.diagnosis_sha256) == 64
    assert result.metrics.required_absence_coverage == 1


def test_forbidden_claim_applies_penalty_and_blocks_pass() -> None:
    judgment = _perfect_judgment().model_copy(update={"violated_forbidden_claim_indexes": [0]})

    result = score_benchmark_judgment(_annotation(), _diagnosis(), judgment)

    assert result.score == 0.75
    assert result.metrics.forbidden_claim_penalty == 0.25
    assert not result.passed


def test_incomplete_diagnosis_cannot_pass_perfect_judgment() -> None:
    result = score_benchmark_judgment(
        _annotation(),
        _diagnosis(DiagnosisStatus.INSUFFICIENT_EVIDENCE),
        _perfect_judgment(),
    )

    assert result.score == 1
    assert not result.passed


def test_serialized_benchmark_result_rejects_tampered_score() -> None:
    result = score_benchmark_judgment(_annotation(), _diagnosis(), _perfect_judgment())
    payload = result.model_dump(mode="json")
    payload["score"] = 0.1

    with pytest.raises(ValueError, match="score does not match"):
        BenchmarkResult.model_validate(payload)


def test_case_and_annotation_ids_must_match() -> None:
    backend = _JudgeBackend(_perfect_judgment())

    with pytest.raises(ValueError, match="case and annotation IDs"):
        asyncio.run(
            evaluate_benchmark_diagnosis(
                run_id="benchmark-run",
                case=_case("other-case"),
                annotation=_annotation(),
                diagnosis=_diagnosis(),
                judge_backend=backend,
            )
        )


@pytest.mark.parametrize(
    ("update", "message"),
    [
        ({"covered_required_evidence_ids": ["invented"]}, "unknown required evidence"),
        ({"matched_acceptable_conclusion_indexes": [2]}, "acceptable conclusion indexes"),
        ({"violated_forbidden_claim_indexes": [-1]}, "forbidden claim indexes"),
    ],
)
def test_judgment_rejects_invented_rubric_references(
    update: dict[str, list[str] | list[int]],
    message: str,
) -> None:
    judgment = _perfect_judgment().model_copy(update=update)

    with pytest.raises(ValueError, match=message):
        score_benchmark_judgment(_annotation(), _diagnosis(), judgment)


def test_judge_context_is_bounded_and_excludes_post_cutoff_fields() -> None:
    context = build_benchmark_judge_context(_annotation(), _diagnosis())

    assert context.stage == "benchmark_judge"
    [submission] = context.evidence
    assert submission.kind == "benchmark_diagnosis_submission"
    assert "content_truncated" in submission.content
    assert "x" * 2_001 not in submission.content
    assert "SECRET CLOSING CHANGE" not in context.instruction
    assert "SECRET ADJUDICATION" not in context.instruction
    assert "Add the recovery successor" not in context.instruction


def test_model_judgment_is_validated_and_scored() -> None:
    backend = _JudgeBackend(_perfect_judgment())

    result = asyncio.run(
        evaluate_benchmark_diagnosis(
            run_id="benchmark-run",
            case=_case(),
            annotation=_annotation(),
            diagnosis=_diagnosis(),
            judge_backend=backend,
        )
    )

    assert result.passed
    assert backend.contexts[0].stage == "benchmark_judge"
    assert backend.session is not None and backend.session.closed
