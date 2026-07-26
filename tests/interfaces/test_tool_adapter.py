import json
import subprocess
from pathlib import Path

import pytest

import maa_diagnostic_expert.interfaces.tool_adapter as tool_adapter_module
from maa_diagnostic_expert.interfaces.tool_adapter import (
    JsonlToolAdapterClient,
    ToolAdapterInvocationError,
    default_tool_adapter_path,
)


def _client_with_response(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    response: dict[str, object],
) -> JsonlToolAdapterClient:
    adapter_path = tmp_path / "adapter.js"
    adapter_path.write_text("// test adapter", encoding="utf-8")

    def fake_run(*args: object, **kwargs: object) -> subprocess.CompletedProcess[str]:
        del args, kwargs
        return subprocess.CompletedProcess(
            args=["node", str(adapter_path)],
            returncode=0,
            stdout=json.dumps(response) + "\n",
            stderr="",
        )

    monkeypatch.setattr(tool_adapter_module.subprocess, "run", fake_run)
    return JsonlToolAdapterClient(adapter_path=adapter_path)


def test_default_tool_adapter_path_still_resolves_from_repository_root(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("MDE_TOOL_ADAPTER_PATH", raising=False)
    repository_root = Path(__file__).resolve().parents[2]

    assert default_tool_adapter_path() == (
        repository_root / "packages" / "tool-adapter" / "dist" / "cli.js"
    )


def test_jsonl_client_accepts_matching_success_envelope(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    client = _client_with_response(
        tmp_path,
        monkeypatch,
        {
            "id": "python-inspect",
            "apiVersion": "tool-adapter/v1",
            "ok": True,
            "result": {"status": "ok"},
            "error": None,
        },
    )

    assert client.call("health", {}) == {"status": "ok"}


def test_jsonl_client_rejects_mismatched_response_id(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    client = _client_with_response(
        tmp_path,
        monkeypatch,
        {
            "id": "another-request",
            "apiVersion": "tool-adapter/v1",
            "ok": True,
            "result": {"status": "ok"},
            "error": None,
        },
    )

    with pytest.raises(ToolAdapterInvocationError, match="response ID does not match"):
        client.call("health", {})


def test_jsonl_client_propagates_a_valid_failure_envelope(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    client = _client_with_response(
        tmp_path,
        monkeypatch,
        {
            "id": "python-inspect",
            "apiVersion": "tool-adapter/v1",
            "ok": False,
            "result": None,
            "error": {
                "code": "TOOL_FAILED",
                "message": "The deterministic tool failed.",
                "retryable": False,
            },
        },
    )

    with pytest.raises(ToolAdapterInvocationError, match="deterministic tool failed"):
        client.call("health", {})


@pytest.mark.parametrize(
    "response",
    [
        {
            "id": "python-inspect",
            "apiVersion": "tool-adapter/v0",
            "ok": True,
            "result": {"status": "ok"},
            "error": None,
        },
        {
            "id": "python-inspect",
            "apiVersion": "tool-adapter/v1",
            "ok": True,
            "result": None,
            "error": None,
        },
        {
            "id": "python-inspect",
            "apiVersion": "tool-adapter/v1",
            "ok": True,
            "result": {"status": "ok"},
            "error": {
                "code": "UNEXPECTED",
                "message": "Conflicting envelope.",
                "retryable": False,
            },
        },
        {
            "id": "python-inspect",
            "apiVersion": "tool-adapter/v1",
            "ok": False,
            "result": None,
            "error": None,
        },
        {
            "id": "python-inspect",
            "apiVersion": "tool-adapter/v1",
            "ok": False,
            "result": {"status": "unexpected"},
            "error": {
                "code": "FAILED",
                "message": "Conflicting envelope.",
                "retryable": False,
            },
        },
    ],
    ids=[
        "wrong-version",
        "success-without-result",
        "success-with-error",
        "failure-without-error",
        "failure-with-result",
    ],
)
def test_jsonl_client_rejects_invalid_response_envelopes(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    response: dict[str, object],
) -> None:
    client = _client_with_response(tmp_path, monkeypatch, response)

    with pytest.raises(ToolAdapterInvocationError, match="Invalid tool adapter response"):
        client.call("health", {})
