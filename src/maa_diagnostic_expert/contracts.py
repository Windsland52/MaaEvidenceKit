import json
from pathlib import Path

from pydantic import BaseModel

from .domain import AnalysisRequest, DiagnosisResult, Evidence

CONTRACT_MODELS: dict[str, type[BaseModel]] = {
    "analysis-request.schema.json": AnalysisRequest,
    "diagnosis-result.schema.json": DiagnosisResult,
    "evidence.schema.json": Evidence,
}


def generate_contracts(output_dir: Path) -> list[Path]:
    output_dir.mkdir(parents=True, exist_ok=True)
    written: list[Path] = []
    for filename, model in CONTRACT_MODELS.items():
        path = output_dir / filename
        schema = model.model_json_schema()
        path.write_text(json.dumps(schema, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        written.append(path)
    return written


def main() -> int:
    generate_contracts(Path.cwd() / "contracts")
    return 0
