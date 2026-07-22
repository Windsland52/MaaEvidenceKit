from __future__ import annotations

import hashlib
import os
import shutil
import subprocess
import tempfile
from collections.abc import Callable
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse
from urllib.request import Request, urlopen
from zipfile import BadZipFile, ZipFile

import yaml
from pydantic import TypeAdapter, ValidationError

from maa_diagnostic_expert.contracts.domain import SourceInput, SourceRole
from maa_diagnostic_expert.contracts.knowledge import (
    WikiCatalogKind,
    WikiCatalogManifest,
    WikiCatalogSource,
    WikiCatalogStatus,
)

_MANIFEST_NAME = "catalog-manifest.json"
_MAX_BUNDLE_BYTES = 512 * 1024 * 1024
_INVENTORY_DIRECTORIES = {
    "maafw": "maa-framework",
    "maa-framework-go": "maa-framework-go",
    "maa-framework-rs": "maa-framework-rs",
}


def default_knowledge_cache() -> Path:
    configured = os.environ.get("MDE_KNOWLEDGE_CACHE")
    if configured:
        return Path(configured).expanduser().resolve()
    if local_app_data := os.environ.get("LOCALAPPDATA"):
        return Path(local_app_data) / "MaaDiagnosticExpert" / "knowledge"
    if xdg_cache := os.environ.get("XDG_CACHE_HOME"):
        return Path(xdg_cache) / "maa-diagnostic-expert" / "knowledge"
    return Path.home() / ".cache" / "maa-diagnostic-expert" / "knowledge"


def _git(path: Path, *arguments: str) -> str:
    try:
        result = subprocess.run(
            ["git", "-C", str(path), *arguments],
            check=True,
            capture_output=True,
            encoding="utf-8",
            timeout=10,
        )
    except (OSError, subprocess.SubprocessError) as error:
        raise ValueError(f"Unable to inspect MaaLLMWiki checkout: {error}") from error
    return result.stdout.strip()


def _load_manifest(content: bytes) -> WikiCatalogManifest:
    try:
        manifest = WikiCatalogManifest.model_validate_json(content)
    except ValidationError as error:
        raise ValueError(f"Invalid MaaLLMWiki catalog manifest: {error}") from error
    if not manifest.working_tree_clean:
        raise ValueError("MaaLLMWiki catalog bundle was built from a dirty working tree")
    return manifest


def _verify_content(path: str, content: bytes, size_bytes: int, sha256: str) -> None:
    if len(content) != size_bytes:
        raise ValueError(f"Catalog file size differs from manifest: {path}")
    if hashlib.sha256(content).hexdigest() != sha256:
        raise ValueError(f"Catalog file hash differs from manifest: {path}")


def _bundle_digest(bundle: Path) -> str:
    digest = hashlib.sha256()
    with bundle.open("rb") as handle:
        while chunk := handle.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def _download_bundle(url: str) -> bytes:
    request = Request(url, headers={"User-Agent": "MaaDiagnosticExpert"})
    try:
        with urlopen(request, timeout=60) as response:  # noqa: S310
            content_length = response.headers.get("Content-Length")
            if content_length is not None and int(content_length) > _MAX_BUNDLE_BYTES:
                raise ValueError("Remote MaaLLMWiki catalog exceeds the download size limit")
            content = response.read(_MAX_BUNDLE_BYTES + 1)
    except (HTTPError, URLError, TimeoutError) as error:
        raise ValueError(f"Unable to download MaaLLMWiki catalog: {error}") from error
    if len(content) > _MAX_BUNDLE_BYTES:
        raise ValueError("Remote MaaLLMWiki catalog exceeds the download size limit")
    return content


def _validate_snapshot(path: Path) -> WikiCatalogManifest:
    manifest_path = path / _MANIFEST_NAME
    if not manifest_path.is_file():
        raise ValueError(f"Catalog snapshot is missing {_MANIFEST_NAME}")
    manifest = _load_manifest(manifest_path.read_bytes())
    for record in manifest.files:
        file_path = path / Path(record.path)
        if not file_path.is_file() or not file_path.resolve().is_relative_to(path.resolve()):
            raise ValueError(f"Catalog snapshot is missing file: {record.path}")
        _verify_content(record.path, file_path.read_bytes(), record.size_bytes, record.sha256)
    return manifest


def _install_bundle(bundle: Path, cache_root: Path) -> tuple[Path, WikiCatalogManifest]:
    try:
        with ZipFile(bundle) as archive:
            members = archive.infolist()
            names = [member.filename for member in members if not member.is_dir()]
            if len(names) != len(set(names)):
                raise ValueError("Catalog bundle contains duplicate paths")
            if _MANIFEST_NAME not in names:
                raise ValueError(f"Catalog bundle is missing {_MANIFEST_NAME}")
            manifest = _load_manifest(archive.read(_MANIFEST_NAME))
            expected = {_MANIFEST_NAME, *(record.path for record in manifest.files)}
            if set(names) != expected:
                raise ValueError("Catalog bundle files differ from its manifest")
            target = cache_root / manifest.wiki_revision
            if target.exists():
                cached = _validate_snapshot(target)
                if cached != manifest:
                    raise ValueError("Cached catalog manifest differs from requested bundle")
                return target, cached
            for record in manifest.files:
                content = archive.read(record.path)
                _verify_content(record.path, content, record.size_bytes, record.sha256)
            cache_root.mkdir(parents=True, exist_ok=True)
            staging = Path(tempfile.mkdtemp(prefix=f".{manifest.wiki_revision}-", dir=cache_root))
            try:
                (staging / _MANIFEST_NAME).write_bytes(archive.read(_MANIFEST_NAME))
                for record in manifest.files:
                    output = staging / Path(record.path)
                    if not output.resolve().is_relative_to(staging.resolve()):
                        raise ValueError(f"Unsafe catalog bundle path: {record.path}")
                    output.parent.mkdir(parents=True, exist_ok=True)
                    output.write_bytes(archive.read(record.path))
                try:
                    staging.replace(target)
                except FileExistsError:
                    cached = _validate_snapshot(target)
                    if cached != manifest:
                        raise ValueError(
                            "Cached catalog manifest differs from requested bundle"
                        ) from None
                return target, manifest
            finally:
                shutil.rmtree(staging, ignore_errors=True)
    except BadZipFile as error:
        raise ValueError("MaaLLMWiki catalog bundle is not a valid ZIP archive") from error


def _inventory_source(root: Path, source_id: str, directory: str) -> WikiCatalogSource:
    path = root / "sources" / directory / "inventory.yaml"
    try:
        value = TypeAdapter(dict[str, object]).validate_python(
            yaml.safe_load(path.read_text(encoding="utf-8"))
        )
        return WikiCatalogSource.model_validate(
            {
                "source_id": value.get("source_id"),
                "version": value.get("version"),
                "revision": value.get("revision"),
            }
        )
    except (OSError, ValueError, ValidationError, yaml.YAMLError) as error:
        raise ValueError(f"Unable to read Wiki inventory for {source_id}: {error}") from error


def _local_checkout(path: Path) -> WikiCatalogStatus:
    revision = _git(path, "rev-parse", "HEAD")
    clean = not bool(_git(path, "status", "--short"))
    sources = [
        _inventory_source(path, source_id, directory)
        for source_id, directory in _INVENTORY_DIRECTORIES.items()
    ]
    return WikiCatalogStatus(
        kind=WikiCatalogKind.LOCAL_CHECKOUT,
        input_path=path,
        catalog_path=path,
        wiki_revision=revision,
        working_tree_clean=clean,
        sources=sources,
    )


def resolve_wiki_catalog(location: Path, *, cache_root: Path | None = None) -> WikiCatalogStatus:
    resolved = location.expanduser().resolve()
    if not resolved.exists():
        raise ValueError(f"MaaLLMWiki path does not exist: {resolved}")
    if resolved.is_file():
        target, manifest = _install_bundle(
            resolved, (cache_root or default_knowledge_cache()).expanduser().resolve()
        )
        return WikiCatalogStatus(
            kind=WikiCatalogKind.BUNDLE_SNAPSHOT,
            input_path=resolved,
            catalog_path=target,
            wiki_revision=manifest.wiki_revision,
            working_tree_clean=manifest.working_tree_clean,
            sources=manifest.sources,
        )
    if not resolved.is_dir():
        raise ValueError(f"MaaLLMWiki path is not a directory or ZIP file: {resolved}")
    if (resolved / _MANIFEST_NAME).is_file():
        manifest = _validate_snapshot(resolved)
        return WikiCatalogStatus(
            kind=WikiCatalogKind.BUNDLE_SNAPSHOT,
            input_path=resolved,
            catalog_path=resolved,
            wiki_revision=manifest.wiki_revision,
            working_tree_clean=manifest.working_tree_clean,
            sources=manifest.sources,
        )
    if not (resolved / ".git").exists():
        raise ValueError("MaaLLMWiki directory is neither a Git checkout nor catalog snapshot")
    return _local_checkout(resolved)


def resolve_remote_wiki_catalog(
    url: str,
    *,
    cache_root: Path | None = None,
    expected_sha256: str | None = None,
    refresh: bool = False,
    offline: bool = False,
    downloader: Callable[[str], bytes] = _download_bundle,
) -> WikiCatalogStatus:
    parsed = urlparse(url)
    if parsed.scheme != "https" or not parsed.netloc:
        raise ValueError("MaaLLMWiki catalog URL must be an absolute HTTPS URL")
    if expected_sha256 is not None and (
        len(expected_sha256) != 64
        or any(character not in "0123456789abcdef" for character in expected_sha256)
    ):
        raise ValueError("Expected MaaLLMWiki bundle SHA-256 must be 64 lowercase hex characters")

    root = (cache_root or default_knowledge_cache()).expanduser().resolve()
    downloads = root / "downloads"
    cache_key = hashlib.sha256(url.encode()).hexdigest()
    bundle = downloads / f"{cache_key}.zip"
    if offline and not bundle.is_file():
        raise ValueError(f"No cached MaaLLMWiki catalog is available for offline URL: {url}")

    if refresh or not bundle.is_file():
        if offline:
            raise ValueError("Cannot refresh MaaLLMWiki catalog while offline")
        content = downloader(url)
        if len(content) > _MAX_BUNDLE_BYTES:
            raise ValueError("Remote MaaLLMWiki catalog exceeds the download size limit")
        downloads.mkdir(parents=True, exist_ok=True)
        temporary = downloads / f".{cache_key}.tmp"
        temporary.write_bytes(content)
        try:
            digest = _bundle_digest(temporary)
            if expected_sha256 is not None and digest != expected_sha256:
                raise ValueError("Remote MaaLLMWiki bundle hash differs from expected SHA-256")
            _install_bundle(temporary, root)
            temporary.replace(bundle)
        finally:
            temporary.unlink(missing_ok=True)

    digest = _bundle_digest(bundle)
    if expected_sha256 is not None and digest != expected_sha256:
        raise ValueError("Cached MaaLLMWiki bundle hash differs from expected SHA-256")
    local = resolve_wiki_catalog(bundle, cache_root=root)
    return local.model_copy(
        update={
            "kind": WikiCatalogKind.REMOTE_BUNDLE,
            "input_url": url,
            "bundle_sha256": digest,
        }
    )


def is_catalog_snapshot(path: Path) -> bool:
    return (path / _MANIFEST_NAME).is_file()


def snapshot_revision(path: Path) -> str | None:
    if not is_catalog_snapshot(path):
        return None
    return _load_manifest((path / _MANIFEST_NAME).read_bytes()).wiki_revision


def catalog_source_input(status: WikiCatalogStatus) -> SourceInput:
    return SourceInput(
        source_id="maa-llm-wiki",
        role=SourceRole.WIKI,
        path=status.catalog_path,
        revision=status.wiki_revision,
    )
