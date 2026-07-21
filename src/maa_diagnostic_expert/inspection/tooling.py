from typing import Protocol

from pydantic import JsonValue


class ToolCaller(Protocol):
    def call(self, name: str, arguments: dict[str, JsonValue]) -> dict[str, JsonValue]: ...


class ToolInvocationError(ValueError):
    """Project-owned failure raised by a deterministic tool transport."""
