from pathlib import Path

MAA_INTERFACE_MARKERS = (
    "interface.json",
    "interface.jsonc",
    "assets/interface.json",
    "assets/interface.jsonc",
)

PROJECT_MARKERS = (
    *MAA_INTERFACE_MARKERS,
    "maa-project.json",
)


def find_maa_interface(path: Path) -> Path | None:
    for marker in MAA_INTERFACE_MARKERS:
        candidate = path / marker
        if candidate.is_file():
            return candidate
    return None


def is_maa_project_root(path: Path) -> bool:
    return path.is_dir() and any((path / marker).is_file() for marker in PROJECT_MARKERS)


def resolve_project_root(explicit: Path | None, *, cwd: Path | None = None) -> Path | None:
    """Resolve an explicit project root, or use cwd only when Maa project markers exist."""

    if explicit is not None:
        resolved = explicit.expanduser().resolve()
        if not resolved.is_dir():
            raise ValueError(f"Project root is not a directory: {resolved}")
        return resolved

    candidate = (cwd or Path.cwd()).resolve()
    return candidate if is_maa_project_root(candidate) else None
