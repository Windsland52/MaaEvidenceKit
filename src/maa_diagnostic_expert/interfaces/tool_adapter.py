from __future__ import annotations

import json
import os
import subprocess
from dataclasses import dataclass
from pathlib import Path

from pydantic import Field, JsonValue

from maa_diagnostic_expert.contracts.domain import ContractModel
from maa_diagnostic_expert.inspection.tooling import ToolInvocationError


class ToolAdapterError(ContractModel):
    code: str = Field(min_length=1)
    message: str = Field(min_length=1)
    retryable: bool
    details: dict[str, JsonValue] | None = None


class ToolAdapterResponse(ContractModel):
    id: str = Field(min_length=1)
    apiVersion: str
    ok: bool
    result: dict[str, JsonValue] | None = None
    error: ToolAdapterError | None = None


class ToolAdapterInvocationError(ToolInvocationError):
    pass


def default_tool_adapter_path() -> Path:
    configured = os.environ.get("MDE_TOOL_ADAPTER_PATH")
    if configured:
        return Path(configured).expanduser().resolve()
    repository_root = Path(__file__).resolve().parents[3]
    return repository_root / "packages" / "tool-adapter" / "dist" / "cli.js"


@dataclass(frozen=True, slots=True)
class JsonlToolAdapterClient:
    adapter_path: Path
    node_executable: str = "node"
    timeout_seconds: float = 120

    def call(self, name: str, arguments: dict[str, JsonValue]) -> dict[str, JsonValue]:
        adapter_path = self.adapter_path.expanduser().resolve()
        if not adapter_path.is_file():
            raise ToolAdapterInvocationError(
                f"Tool adapter is not built: {adapter_path}. Run 'pnpm build' first."
            )
        request = {
            "id": "python-inspect",
            "apiVersion": "tool-adapter/v1",
            "method": "tools/call",
            "params": {"name": name, "arguments": arguments},
        }
        try:
            completed = subprocess.run(
                [self.node_executable, str(adapter_path)],
                input=json.dumps(request, ensure_ascii=False) + "\n",
                capture_output=True,
                check=False,
                encoding="utf-8",
                timeout=self.timeout_seconds,
            )
        except (OSError, subprocess.SubprocessError) as error:
            raise ToolAdapterInvocationError(str(error)) from error
        if completed.returncode != 0:
            message = completed.stderr.strip() or f"adapter exited with {completed.returncode}"
            raise ToolAdapterInvocationError(message)

        response_lines = [line for line in completed.stdout.splitlines() if line.strip()]
        if len(response_lines) != 1:
            raise ToolAdapterInvocationError(
                f"Expected one adapter response, received {len(response_lines)}."
            )
        response = ToolAdapterResponse.model_validate_json(response_lines[0])
        if not response.ok:
            message = response.error.message if response.error else "Unknown tool adapter error."
            raise ToolAdapterInvocationError(message)
        if response.result is None:
            raise ToolAdapterInvocationError("Tool adapter returned no result.")
        return response.result
