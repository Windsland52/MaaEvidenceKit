import json
from pathlib import Path

import pytest
from pydantic import BaseModel, ValidationError

from maa_diagnostic_expert.contracts.domain import (
    AnalysisRequest,
    DiagnosisDraft,
    DiagnosisResult,
    SourceSnapshot,
)
from maa_diagnostic_expert.contracts.mse import MseProjectPreflightResult
from maa_diagnostic_expert.contracts.schemas import CONTRACT_MODELS, generate_contracts

_VERSION_FIELD_NAMES = ("api_version", "schema_version")
_VERSIONED_CONTRACT_MODELS = sorted(
    {
        model
        for model in CONTRACT_MODELS.values()
        if any(name in model.model_fields for name in _VERSION_FIELD_NAMES)
    },
    key=lambda model: model.__name__,
)


def test_contract_generation(tmp_path: Path) -> None:
    written = generate_contracts(tmp_path)
    assert {path.name for path in written} == set(CONTRACT_MODELS)
    for path in written:
        schema = json.loads(path.read_text(encoding="utf-8"))
        assert schema["type"] == "object"


@pytest.mark.parametrize(
    "model_type",
    _VERSIONED_CONTRACT_MODELS,
    ids=lambda model: model.__name__,
)
def test_contract_versions_are_json_schema_constants(
    model_type: type[BaseModel],
) -> None:
    [field_name] = [name for name in _VERSION_FIELD_NAMES if name in model_type.model_fields]
    field = model_type.model_fields[field_name]
    property_schema = model_type.model_json_schema()["properties"][field_name]

    assert property_schema["const"] == field.default


@pytest.mark.parametrize(
    ("model_type", "payload"),
    [
        (
            AnalysisRequest,
            {"api_version": "analysis-request/v0", "question": "Inspect."},
        ),
        (
            MseProjectPreflightResult,
            {
                "schema_version": "mde-mse-project-preflight/v1",
                "project_root": "C:/project",
                "syntax_mode": "maafw",
                "compatibility": {"status": "supported", "reason": "Loaded."},
            },
        ),
    ],
)
def test_contracts_reject_unknown_versions(
    model_type: type[BaseModel],
    payload: dict[str, object],
) -> None:
    with pytest.raises(ValidationError):
        model_type.model_validate(payload)


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


def test_source_snapshot_schema_constrains_wiki_catalog_backend() -> None:
    schema = SourceSnapshot.model_json_schema()

    assert schema["allOf"] == [
        {
            "if": {
                "properties": {"revision_backend": {"const": "wiki_catalog"}},
                "required": ["revision_backend"],
            },
            "then": {
                "properties": {"role": {"const": "wiki"}},
                "required": ["role"],
            },
        }
    ]
