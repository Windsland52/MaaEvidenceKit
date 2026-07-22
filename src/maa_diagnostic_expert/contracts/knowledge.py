from __future__ import annotations

from enum import StrEnum
from pathlib import Path, PurePosixPath
from typing import Literal

from pydantic import Field, field_validator, model_validator

from .domain import ContractModel

_COMMIT_PATTERN = r"^[0-9a-f]{40}$"
_SOURCE_ID_PATTERN = r"^[a-z0-9]+(?:[.-][a-z0-9]+)*$"


def _relative_path(value: str) -> str:
    normalized = value.strip().replace("\\", "/")
    path = PurePosixPath(normalized)
    if not normalized or path.is_absolute() or ".." in path.parts:
        raise ValueError("Catalog paths must be safe relative paths")
    return normalized


class WikiCatalogKind(StrEnum):
    LOCAL_CHECKOUT = "local_checkout"
    BUNDLE_SNAPSHOT = "bundle_snapshot"
    REMOTE_BUNDLE = "remote_bundle"


class WikiCatalogFile(ContractModel):
    path: str
    size_bytes: int = Field(ge=0)
    sha256: str = Field(pattern=r"^[0-9a-f]{64}$")

    @field_validator("path")
    @classmethod
    def validate_path(cls, value: str) -> str:
        return _relative_path(value)


class WikiCatalogSource(ContractModel):
    source_id: str = Field(pattern=_SOURCE_ID_PATTERN)
    version: str = Field(min_length=1)
    revision: str = Field(pattern=_COMMIT_PATTERN)


class WikiCatalogManifest(ContractModel):
    api_version: Literal["maa-llm-wiki-catalog/v1"] = "maa-llm-wiki-catalog/v1"
    wiki_revision: str = Field(pattern=_COMMIT_PATTERN)
    working_tree_clean: bool
    sources: list[WikiCatalogSource] = Field(min_length=1)
    files: list[WikiCatalogFile] = Field(min_length=1)

    @model_validator(mode="after")
    def require_unique_files_and_sources(self) -> WikiCatalogManifest:
        source_ids = [source.source_id for source in self.sources]
        paths = [file.path for file in self.files]
        if len(source_ids) != len(set(source_ids)):
            raise ValueError("Wiki catalog source IDs must be unique")
        if len(paths) != len(set(paths)):
            raise ValueError("Wiki catalog file paths must be unique")
        if paths != sorted(paths):
            raise ValueError("Wiki catalog files must be sorted")
        return self


class WikiCatalogStatus(ContractModel):
    api_version: Literal["wiki-catalog-status/v1"] = "wiki-catalog-status/v1"
    kind: WikiCatalogKind
    input_path: Path
    input_url: str | None = None
    bundle_sha256: str | None = Field(default=None, pattern=r"^[0-9a-f]{64}$")
    catalog_path: Path
    wiki_revision: str = Field(pattern=_COMMIT_PATTERN)
    working_tree_clean: bool
    sources: list[WikiCatalogSource] = Field(min_length=1)
