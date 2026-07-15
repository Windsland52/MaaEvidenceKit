import json
from pathlib import Path

from maa_diagnostic_expert.contracts import CONTRACT_MODELS, generate_contracts


def test_contract_generation(tmp_path: Path) -> None:
    written = generate_contracts(tmp_path)
    assert {path.name for path in written} == set(CONTRACT_MODELS)
    for path in written:
        schema = json.loads(path.read_text(encoding="utf-8"))
        assert schema["type"] == "object"
