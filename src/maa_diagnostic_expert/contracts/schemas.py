import json
from pathlib import Path

from pydantic import BaseModel

from maa_diagnostic_expert.inspection.log_overview import LogOverviewCollection
from maa_diagnostic_expert.inspection.models import DeterministicInspection
from maa_diagnostic_expert.reasoning.model_config import ModelConfig

from .domain import (
    AnalysisRequest,
    DiagnosisDraft,
    DiagnosisResult,
    DiagnosticEvent,
    Evidence,
    EvidenceQuery,
    EvidenceWindow,
    PreparedAnalysis,
    ReasoningRequest,
)
from .mla import MlaPreflightResult, MlaRuntimeInspectionResult
from .mse import MseProjectPreflightResult, MseTaskResolutionResult
from .workflow import (
    ArtifactSourceInventory,
    FixCandidate,
    IncidentComparison,
    IncidentCorrelationDraft,
    IncidentSelection,
    InvestigationPlan,
    KnowledgeResearchPlan,
    RuntimeIdentity,
    SourceGuidance,
    SourceResearchPlan,
    VerificationPlan,
)

CONTRACT_MODELS: dict[str, type[BaseModel]] = {
    "analysis-request.schema.json": AnalysisRequest,
    "diagnostic-event.schema.json": DiagnosticEvent,
    "deterministic-inspection.schema.json": DeterministicInspection,
    "diagnosis-draft.schema.json": DiagnosisDraft,
    "diagnosis-result.schema.json": DiagnosisResult,
    "evidence.schema.json": Evidence,
    "evidence-query.schema.json": EvidenceQuery,
    "evidence-window.schema.json": EvidenceWindow,
    "prepared-analysis.schema.json": PreparedAnalysis,
    "reasoning-request.schema.json": ReasoningRequest,
    "mla-preflight.schema.json": MlaPreflightResult,
    "mla-runtime-inspection.schema.json": MlaRuntimeInspectionResult,
    "mse-project-preflight.schema.json": MseProjectPreflightResult,
    "mse-task-resolution.schema.json": MseTaskResolutionResult,
    "model-config.schema.json": ModelConfig,
    "artifact-source-inventory.schema.json": ArtifactSourceInventory,
    "log-overview.schema.json": LogOverviewCollection,
    "runtime-identity.schema.json": RuntimeIdentity,
    "incident-selection.schema.json": IncidentSelection,
    "incident-correlation-draft.schema.json": IncidentCorrelationDraft,
    "incident-comparison.schema.json": IncidentComparison,
    "investigation-plan.schema.json": InvestigationPlan,
    "fix-candidate.schema.json": FixCandidate,
    "verification-plan.schema.json": VerificationPlan,
    "source-guidance.schema.json": SourceGuidance,
    "source-research-plan.schema.json": SourceResearchPlan,
    "knowledge-research-plan.schema.json": KnowledgeResearchPlan,
}


def generate_contracts(output_dir: Path) -> list[Path]:
    output_dir.mkdir(parents=True, exist_ok=True)
    written: list[Path] = []
    for filename, model in CONTRACT_MODELS.items():
        path = output_dir / filename
        schema = model.model_json_schema()
        path.write_text(
            json.dumps(schema, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
            newline="\n",
        )
        written.append(path)
    return written


def main() -> int:
    generate_contracts(Path.cwd() / "contracts")
    return 0
