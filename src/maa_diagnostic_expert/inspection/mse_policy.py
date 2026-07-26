from maa_diagnostic_expert.contracts.mse import (
    MseCompatibility,
    MseCompatibilityStatus,
    MseProjectPreflightResult,
    MseSyntaxMode,
    MseTaskResolutionResult,
)

_MAA_UNSUPPORTED_REASON = (
    "MDE diagnostic reasoning does not yet support MaaAssistantArknights pipeline "
    "semantics; MSE loaded the project mechanically using Maa syntax."
)


def validate_mse_syntax_mode(
    actual: MseSyntaxMode,
    requested: MseSyntaxMode,
) -> None:
    if actual is not requested:
        raise ValueError(
            "MSE adapter syntax mode mismatch: "
            f"requested {requested.value!r}, received {actual.value!r}."
        )


def apply_mse_project_policy(
    result: MseProjectPreflightResult,
    requested_syntax: MseSyntaxMode,
) -> MseProjectPreflightResult:
    """Validate adapter facts, then apply Python-owned diagnostic support policy."""

    validate_mse_syntax_mode(result.syntax_mode, requested_syntax)
    if requested_syntax is MseSyntaxMode.MAA:
        return result.model_copy(
            update={
                "compatibility": MseCompatibility(
                    status=MseCompatibilityStatus.UNSUPPORTED,
                    reason=_MAA_UNSUPPORTED_REASON,
                )
            }
        )
    return result


def validate_mse_task_resolution(
    result: MseTaskResolutionResult,
    requested_syntax: MseSyntaxMode,
) -> None:
    validate_mse_syntax_mode(result.syntax_mode, requested_syntax)
