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
    index_configuration_values,
    matching_configuration_applicability_identifiers,
    matching_configuration_identifiers,
    matching_reported_configuration_values,
    unresolved_configuration_missing_evidence,
    unresolved_configuration_research_locations,
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
    identifiers = extract_source_configuration_identifiers(
        "// hotkeys configure shortcuts\nconst theme = settings.theme;"
    )
    assert "theme" in identifiers
    assert "hotkeys" not in identifiers


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


def test_configuration_values_cover_multiple_serialized_scalar_styles(tmp_path: Path) -> None:
    config = tmp_path / "service.yaml"
    config.write_text(
        "profile: tenant-blue\n"
        "retry_count = 4\n"
        "circuit_open: false\n"
        'routing: {"region": "eu-west-2", "quota": 0}\n',
        encoding="utf-8",
    )
    prepared = prepare_analysis(
        AnalysisRequest(
            issue="tenant-blue in eu-west-2 had retry_count 4 with circuit_open false.",
            artifacts=[ArtifactInput(path=config, kind=ArtifactKind.FILE)],
        )
    )

    values = index_configuration_values(prepared)

    assert {
        "tenant-blue": (1,),
        "4": (2,),
        "false": (3,),
        "eu-west-2": (4,),
        "0": (4,),
    }.items() <= values[config.resolve()].items()
    assert matching_reported_configuration_values(
        "tenant-blue in eu-west-2 had retry_count 4 with circuit_open false.",
        [],
        values,
        index_configuration_keys(prepared),
    )[config.resolve()] == {
        "tenant-blue": (1,),
        "4": (2,),
        "false": (3,),
        "eu-west-2": (4,),
    }


def test_configuration_windows_do_not_create_new_reported_value_targets(tmp_path: Path) -> None:
    config = tmp_path / "service.json"
    config.write_text(
        '{\n  "tenant": "reported-blue",\n  "profile": "unreported-shadow"\n}\n',
        encoding="utf-8",
    )
    prepared = prepare_analysis(
        AnalysisRequest(
            issue="reported-blue received a stale response.",
            artifacts=[ArtifactInput(path=config, kind=ArtifactKind.FILE)],
        )
    )
    queried_config = Evidence(
        id="ev:queried-config",
        kind="text_line_window",
        source_component="diagnostic-artifact",
        source_path=str(config.resolve()),
        content='"profile": "unreported-shadow"',
        line_start=3,
        line_end=3,
        role=EvidenceRole.CONTEXT,
    )

    assert matching_reported_configuration_values(
        "reported-blue received a stale response.",
        [queried_config],
        index_configuration_values(prepared),
        index_configuration_keys(prepared),
    ) == {config.resolve(): {"reported-blue": (2,)}}


def test_configuration_targets_scope_repeated_values_to_reported_entity_block(
    tmp_path: Path,
) -> None:
    config = (tmp_path / "profiles.yaml").resolve()
    warning = Evidence(
        id="ev:warning",
        kind="log_occurrence:error",
        source_component="log-overview:service",
        source_path="service.log",
        content="reported-beta failed in shared mode",
        role=EvidenceRole.SIGNAL,
    )
    source = _source("if (settings.backendMode === requestedMode) route();")
    key_index = {config: {"backendmode": (3, 50, 100)}}
    value_index = {
        config: {
            "reported-beta": (49,),
            "shared": (3, 50, 100),
        }
    }

    assert unresolved_configuration_research_locations(
        "reported-beta failed in shared mode",
        [warning, source],
        key_index,
        value_index,
    ) == {config: {49, 50}}


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
        'use(settings.transportProfile); log.warn("retry budget exhausted");',
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

    post_anchor_access = message_owner.model_copy(
        update={
            "id": "ev:post-anchor",
            "content": 'log.warn("retry budget exhausted"); use(settings.retryBudget);',
        }
    )
    assert matching_configuration_identifiers([log, post_anchor_access], index) == {}

    no_message_owner = message_owner.model_copy(
        update={"content": "const profile = settings.transportProfile;"}
    )
    assert (
        matching_configuration_identifiers(
            [log, broad_match, no_message_owner],
            index,
        )
        == {}
    )


def test_configuration_research_locates_reported_target_and_guard_applicability(
    tmp_path: Path,
) -> None:
    config = tmp_path / "mxu.json"
    config.write_text(
        '{\n  "name": "日常-活动",\n  "controllerName": "ADB"\n}\n',
        encoding="utf-8",
    )
    prepared = prepare_analysis(
        AnalysisRequest(
            issue="The 日常-活动 scheduled instance was cancelled while locked.",
            artifacts=[ArtifactInput(path=config, kind=ArtifactKind.FILE)],
        )
    )
    warning = Evidence(
        id="ev:warning",
        kind="log_occurrence:warning",
        source_component="log-overview:gui",
        source_path="gui.log",
        content="实例 日常-活动: workstation locked, cancel start",
        role=EvidenceRole.SIGNAL,
    )
    source = _source(
        "if (isWorkstationLocked()) { warn('workstation locked, cancel start'); }\n"
        "const controller = controllers.find(c => c.name === controllerName);"
    )
    key_index = index_configuration_keys(prepared)
    value_index = index_configuration_values(prepared)

    assert matching_configuration_applicability_identifiers(
        [warning, source],
        key_index,
    ) == {config.resolve(): {"controllername"}}
    assert matching_reported_configuration_values(
        "The 日常-活动 scheduled instance was cancelled.",
        [warning, source],
        value_index,
        key_index,
    ) == {config.resolve(): {"日常-活动": (2,)}}
    assert unresolved_configuration_research_locations(
        "The 日常-活动 scheduled instance was cancelled.",
        [warning, source],
        key_index,
        value_index,
    ) == {config.resolve(): {2, 3}}

    partially_queried = Evidence(
        id="ev:config-name",
        kind="text_line_window",
        source_component="diagnostic-artifact",
        source_path=str(config.resolve()),
        content='"name": "日常-活动"',
        line_start=2,
        line_end=2,
        role=EvidenceRole.CONTEXT,
    )
    assert unresolved_configuration_research_locations(
        "The 日常-活动 scheduled instance was cancelled.",
        [warning, source, partially_queried],
        key_index,
        value_index,
    ) == {config.resolve(): {3}}
    [missing] = unresolved_configuration_missing_evidence({config.resolve(): {3, 7}})
    assert missing.code == "configuration_applicability_unresolved"
    assert missing.source_path == config.resolve()
    assert "[3, 7]" in missing.message

    queried = Evidence(
        id="ev:config",
        kind="text_line_window",
        source_component="diagnostic-artifact",
        source_path=str(config.resolve()),
        content='"name": "日常-活动",\n"controllerName": "ADB"',
        line_start=2,
        line_end=3,
        role=EvidenceRole.CONTEXT,
    )
    assert (
        unresolved_configuration_research_locations(
            "The 日常-活动 scheduled instance was cancelled.",
            [warning, source, queried],
            key_index,
            value_index,
        )
        == {}
    )
