from pathlib import Path

from maa_diagnostic_expert.contracts.domain import (
    AnalysisRequest,
    ArtifactInput,
    ArtifactKind,
    Evidence,
    EvidenceRole,
)
from maa_diagnostic_expert.discovery.preparation import prepare_analysis
from maa_diagnostic_expert.inspection.configuration_keys import (
    extract_configuration_keys,
    extract_source_configuration_identifiers,
    index_configuration_keys,
    matching_configuration_identifiers,
)


def _source(content: str, evidence_id: str = "ev:source") -> Evidence:
    return Evidence(
        id=evidence_id,
        kind="source_search_match",
        source_component="source:project",
        source_path="git:project@revision:workflow.ts",
        content=content,
        role=EvidenceRole.CONTEXT,
    )


def test_configuration_keys_normalize_casing_and_separator_variants() -> None:
    keys = extract_configuration_keys(
        '{\n  "transport_profile": "sandbox",\n  "retryBudget": 3\n}\n'
    )

    assert keys == {"transportprofile": (2,), "retrybudget": (3,)}
    assert extract_source_configuration_identifiers(
        "const transport_profile = settings.transportProfile; const retry = config['retry-budget'];"
    ) >= {"transportprofile", "retrybudget"}


def test_configuration_index_matches_only_identifiers_present_in_source(
    tmp_path: Path,
) -> None:
    config = tmp_path / "settings.yaml"
    config.write_text(
        "transport_profile: sandbox\nretry_budget: 3\n",
        encoding="utf-8",
    )
    prepared = prepare_analysis(
        AnalysisRequest(
            question="Inspect the configuration-dependent branch.",
            artifacts=[ArtifactInput(path=config, kind=ArtifactKind.FILE)],
        )
    )

    index = index_configuration_keys(prepared)

    assert index == {
        config.resolve(): {
            "transportprofile": (1,),
            "retrybudget": (2,),
        }
    }
    assert matching_configuration_identifiers(
        [_source("if (transportProfile === selectedProfile) run();")],
        index,
    ) == {config.resolve(): {"transportprofile"}}
    assert (
        matching_configuration_identifiers(
            [_source("if (settings.timeoutSeconds > 0) run();")],
            index,
        )
        == {}
    )


def test_configuration_key_extraction_ignores_generic_object_fields() -> None:
    keys = extract_configuration_keys(
        '{"id": "one", "name": "demo", "enabled": true, "customLimit": 4}'
    )

    assert keys == {"customlimit": (1,)}


def test_configuration_matching_prefers_source_window_containing_observed_message(
    tmp_path: Path,
) -> None:
    profile_config = (tmp_path / "profile.yaml").resolve()
    retry_config = (tmp_path / "retry.yaml").resolve()
    log = Evidence(
        id="ev:warning",
        kind="log_occurrence:warning",
        source_component="log-overview:custom",
        source_path="worker.log",
        content="2026-07-27 08:00:16 WARN [Worker] retry budget exhausted",
        role=EvidenceRole.SIGNAL,
    )
    message_owner = _source(
        'log.warn("retry budget exhausted"); use(transportProfile);',
        "ev:message-owner",
    )
    broad_match = _source("if (retryBudget > 0) retry();", "ev:broad-match")
    index = {
        profile_config: {"transportprofile": (2,)},
        retry_config: {"retrybudget": (4,)},
    }

    assert matching_configuration_identifiers(
        [log, broad_match, message_owner],
        index,
    ) == {profile_config: {"transportprofile"}}
