import json
from pathlib import Path

import pytest

from maa_diagnostic_expert.contracts.domain import DiagnosisDraft, DiagnosisResult
from maa_diagnostic_expert.contracts.schemas import CONTRACT_MODELS, generate_contracts


def test_contract_generation(tmp_path: Path) -> None:
    written = generate_contracts(tmp_path)
    assert {path.name for path in written} == set(CONTRACT_MODELS)
    for path in written:
        schema = json.loads(path.read_text(encoding="utf-8"))
        assert schema["type"] == "object"


@pytest.mark.parametrize("model_type", [DiagnosisDraft, DiagnosisResult])
def test_complete_diagnosis_schema_requires_conclusions(
    model_type: type[DiagnosisDraft] | type[DiagnosisResult],
) -> None:
    schema = model_type.model_json_schema()

    assert schema["allOf"] == [
        {
            "if": {
                "properties": {"status": {"const": "complete"}},
                "required": ["status"],
            },
            "then": {
                "properties": {"conclusions": {"minItems": 1}},
                "required": ["conclusions"],
            },
        }
    ]
