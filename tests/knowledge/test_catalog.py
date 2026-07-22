import hashlib
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile

from maa_diagnostic_expert.contracts.domain import AnalysisRequest, SourceInput, SourceRole
from maa_diagnostic_expert.contracts.knowledge import (
    WikiCatalogFile,
    WikiCatalogKind,
    WikiCatalogManifest,
    WikiCatalogSource,
)
from maa_diagnostic_expert.contracts.workflow import (
    KnowledgeResearchPlan,
    SourceResearchStatus,
    SourceSearchQuery,
)
from maa_diagnostic_expert.discovery.preparation import prepare_analysis
from maa_diagnostic_expert.inspection.models import DeterministicInspection
from maa_diagnostic_expert.inspection.source_search import (
    execute_knowledge_research,
    synthesize_knowledge_search_evidence,
)
from maa_diagnostic_expert.knowledge.catalog import (
    catalog_source_input,
    resolve_remote_wiki_catalog,
    resolve_wiki_catalog,
)

_REVISION = "a" * 40


def _manifest(content: bytes) -> WikiCatalogManifest:
    return WikiCatalogManifest(
        wiki_revision=_REVISION,
        working_tree_clean=True,
        sources=[WikiCatalogSource(source_id="maafw", version="5.12.2", revision="b" * 40)],
        files=[
            WikiCatalogFile(
                path="generated/maa-framework/5.12.2/documentation/zh-cn.md",
                size_bytes=len(content),
                sha256=hashlib.sha256(content).hexdigest(),
            )
        ],
    )


def _snapshot(path: Path) -> Path:
    content = b"Pipeline next list recognition timeout.\n"
    manifest = _manifest(content)
    document = path / manifest.files[0].path
    document.parent.mkdir(parents=True)
    document.write_bytes(content)
    (path / "catalog-manifest.json").write_text(
        manifest.model_dump_json(indent=2) + "\n", encoding="utf-8"
    )
    return path


def _bundle(path: Path) -> Path:
    content = b"Pipeline next list recognition timeout.\n"
    manifest = _manifest(content)
    with ZipFile(path, "w", compression=ZIP_DEFLATED) as archive:
        archive.writestr("catalog-manifest.json", manifest.model_dump_json(indent=2))
        archive.writestr(manifest.files[0].path, content)
    return path


def test_bundle_is_verified_and_installed_by_revision(tmp_path: Path) -> None:
    bundle = _bundle(tmp_path / "catalog.zip")
    status = resolve_wiki_catalog(bundle, cache_root=tmp_path / "cache")

    assert status.kind is WikiCatalogKind.BUNDLE_SNAPSHOT
    assert status.wiki_revision == _REVISION
    assert status.catalog_path == tmp_path / "cache" / _REVISION
    assert catalog_source_input(status).revision == _REVISION


def test_snapshot_is_revisioned_and_searchable_without_git(tmp_path: Path) -> None:
    snapshot = _snapshot(tmp_path / "wiki")
    prepared = prepare_analysis(
        AnalysisRequest(
            question="Explain the timeout.",
            sources=[
                SourceInput(
                    source_id="maa-llm-wiki",
                    role=SourceRole.WIKI,
                    path=snapshot,
                    revision=_REVISION,
                )
            ],
        )
    )
    inspection = DeterministicInspection(prepared=prepared)
    plan = KnowledgeResearchPlan(
        status=SourceResearchStatus.RUN,
        rationale="Find the versioned navigation entry.",
        queries=[
            SourceSearchQuery(
                query_id="timeout-doc",
                source_id="maa-llm-wiki",
                terms=["next list"],
                paths=["generated"],
                reason="Locate timeout documentation.",
                context_lines=0,
                max_results=5,
            )
        ],
    )

    result = execute_knowledge_research(inspection, plan)
    [match] = result.knowledge_search_matches
    [evidence] = synthesize_knowledge_search_evidence(result.knowledge_search_matches)

    assert prepared.source_snapshots[0].resolved_revision == _REVISION
    assert match.source_locator.startswith(f"catalog:maa-llm-wiki@{_REVISION}:")
    assert evidence.kind == "wiki_navigation_match"


def test_remote_bundle_is_downloaded_once_and_reused_offline(tmp_path: Path) -> None:
    bundle = _bundle(tmp_path / "catalog.zip").read_bytes()
    calls: list[str] = []

    def download(url: str) -> bytes:
        calls.append(url)
        return bundle

    url = "https://example.invalid/releases/latest/download/maa-llm-wiki-catalog.zip"
    digest = hashlib.sha256(bundle).hexdigest()
    status = resolve_remote_wiki_catalog(
        url,
        cache_root=tmp_path / "cache",
        expected_sha256=digest,
        downloader=download,
    )
    cached = resolve_remote_wiki_catalog(
        url,
        cache_root=tmp_path / "cache",
        expected_sha256=digest,
        offline=True,
        downloader=download,
    )

    assert calls == [url]
    assert status.kind is WikiCatalogKind.REMOTE_BUNDLE
    assert status.input_url == url
    assert status.bundle_sha256 == digest
    assert cached.catalog_path == status.catalog_path


def test_remote_bundle_hash_mismatch_does_not_poison_cache(tmp_path: Path) -> None:
    bundle = _bundle(tmp_path / "catalog.zip").read_bytes()
    cache = tmp_path / "cache"

    try:
        resolve_remote_wiki_catalog(
            "https://example.invalid/catalog.zip",
            cache_root=cache,
            expected_sha256="0" * 64,
            downloader=lambda _: bundle,
        )
    except ValueError as error:
        assert "hash differs" in str(error)
    else:
        raise AssertionError("Expected a bundle hash mismatch")

    assert not list((cache / "downloads").glob("*.zip"))


def test_invalid_bundle_does_not_leave_partial_revision_cache(tmp_path: Path) -> None:
    content = b"corrupted"
    manifest = _manifest(b"expected")
    bundle = tmp_path / "invalid.zip"
    with ZipFile(bundle, "w", compression=ZIP_DEFLATED) as archive:
        archive.writestr("catalog-manifest.json", manifest.model_dump_json(indent=2))
        archive.writestr(manifest.files[0].path, content)
    cache = tmp_path / "cache"

    try:
        resolve_wiki_catalog(bundle, cache_root=cache)
    except ValueError as error:
        assert "differs from manifest" in str(error)
    else:
        raise AssertionError("Expected invalid bundle content")

    assert not (cache / _REVISION).exists()
