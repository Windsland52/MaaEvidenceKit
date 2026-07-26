import hashlib
import json
import subprocess
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile

import pytest

from maa_diagnostic_expert.contracts.domain import (
    AnalysisRequest,
    EvidenceQuery,
    SourceInput,
    SourceRevisionBackend,
    SourceRole,
)
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
from maa_diagnostic_expert.inspection.evidence_query import query_evidence
from maa_diagnostic_expert.inspection.models import DeterministicInspection
from maa_diagnostic_expert.inspection.source_search import (
    execute_knowledge_research,
    synthesize_knowledge_search_evidence,
)
from maa_diagnostic_expert.knowledge.catalog import (
    catalog_source_input,
    resolve_github_wiki_catalog,
    resolve_remote_wiki_catalog,
    resolve_wiki_catalog,
)

_REVISION = "a" * 40
_DOCUMENT_PATH = "generated/maa-framework/5.12.2/documentation/zh-cn.md"


def _manifest(
    content: bytes,
    source_revision: str = "b" * 40,
) -> WikiCatalogManifest:
    return WikiCatalogManifest(
        wiki_revision=_REVISION,
        working_tree_clean=True,
        sources=[
            WikiCatalogSource(
                source_id="maafw",
                version="5.12.2",
                revision=source_revision,
            )
        ],
        files=[
            WikiCatalogFile(
                path=_DOCUMENT_PATH,
                size_bytes=len(content),
                sha256=hashlib.sha256(content).hexdigest(),
            )
        ],
    )


def _snapshot(
    path: Path,
    content: bytes = b"Pipeline next list recognition timeout.\n",
    source_revision: str = "b" * 40,
) -> Path:
    manifest = _manifest(content, source_revision)
    document = path / manifest.files[0].path
    document.parent.mkdir(parents=True)
    document.write_bytes(content)
    (path / "catalog-manifest.json").write_text(
        manifest.model_dump_json(indent=2) + "\n", encoding="utf-8"
    )
    return path


def _git(repository: Path, *arguments: str) -> str:
    completed = subprocess.run(
        ["git", "-C", str(repository), *arguments],
        check=True,
        capture_output=True,
        encoding="utf-8",
    )
    return completed.stdout.strip()


def _original_repository(path: Path) -> tuple[Path, str]:
    path.mkdir()
    _git(path, "init")
    _git(path, "config", "user.name", "MDE Test")
    _git(path, "config", "user.email", "mde-test@example.invalid")
    document = path / "docs" / "pipeline.md"
    document.parent.mkdir()
    document.write_text("Pipeline next list recognition timeout.\n", encoding="utf-8")
    _git(path, "add", ".")
    _git(path, "commit", "-m", "documentation")
    return path, _git(path, "rev-parse", "HEAD")


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
    assert prepared.source_snapshots[0].revision_backend is SourceRevisionBackend.WIKI_CATALOG
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


def test_catalog_navigation_resolves_explicit_original_git_source(tmp_path: Path) -> None:
    original, original_revision = _original_repository(tmp_path / "framework")
    navigation = (
        "Pipeline next list recognition timeout. "
        "[`docs/pipeline.md`](https://github.com/example/framework/blob/"
        f"{original_revision}/docs/pipeline.md)\n"
    ).encode()
    snapshot = _snapshot(
        tmp_path / "wiki",
        navigation,
        original_revision,
    )
    prepared = prepare_analysis(
        AnalysisRequest(
            question="Explain the timeout.",
            sources=[
                SourceInput(
                    source_id="framework",
                    role=SourceRole.MAA_FRAMEWORK,
                    path=original,
                    revision=original_revision,
                ),
                SourceInput(
                    source_id="maa-llm-wiki",
                    role=SourceRole.WIKI,
                    path=snapshot,
                    revision=_REVISION,
                ),
            ],
        )
    )
    plan = KnowledgeResearchPlan(
        status=SourceResearchStatus.RUN,
        rationale="Resolve a Wiki navigation result to original documentation.",
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

    result = execute_knowledge_research(DeterministicInspection(prepared=prepared), plan)
    evidence = synthesize_knowledge_search_evidence(result.knowledge_search_matches)

    assert {match.source_role for match in result.knowledge_search_matches} == {
        SourceRole.WIKI,
        SourceRole.MAA_FRAMEWORK,
    }
    original_match = next(
        match for match in result.knowledge_search_matches if match.source_id == "framework"
    )
    assert original_match.source_locator == (f"git:framework@{original_revision}:docs/pipeline.md")
    assert {item.kind for item in evidence} == {
        "wiki_navigation_match",
        "knowledge_document_match",
    }


@pytest.mark.parametrize("tamper", ["listed_file", "extra_file"])
def test_tampered_catalog_snapshot_is_not_read_as_pinned_evidence(
    tmp_path: Path,
    tamper: str,
) -> None:
    snapshot = _snapshot(tmp_path / "wiki")
    document = snapshot / _DOCUMENT_PATH
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
    if tamper == "listed_file":
        document.write_text("Tampered next list guidance.\n", encoding="utf-8")
    else:
        (snapshot / "injected.md").write_text("Injected next list guidance.\n", encoding="utf-8")

    plan = KnowledgeResearchPlan(
        status=SourceResearchStatus.RUN,
        rationale="Find the versioned navigation entry.",
        queries=[
            SourceSearchQuery(
                query_id="timeout-doc",
                source_id="maa-llm-wiki",
                terms=["next list"],
                paths=["."],
                reason="Locate timeout documentation.",
                context_lines=0,
                max_results=5,
            )
        ],
    )

    result = execute_knowledge_research(DeterministicInspection(prepared=prepared), plan)

    assert result.knowledge_search_matches == []
    assert "source_search_source_unavailable" in {
        item.code for item in result.prepared.missing_evidence
    }
    with pytest.raises(ValueError, match="Wiki catalog .* is unavailable"):
        query_evidence(
            prepared,
            EvidenceQuery(
                source_path=document,
                line_start=1,
                line_end=1,
                reason="Read the pinned navigation evidence.",
            ),
        )


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


def test_github_latest_discovers_versioned_asset_and_reuses_it_offline(
    tmp_path: Path,
) -> None:
    bundle = _bundle(tmp_path / "catalog.zip").read_bytes()
    digest = hashlib.sha256(bundle).hexdigest()
    asset_url = (
        "https://github.com/Windsland52/MaaLLMWiki/releases/download/"
        "v0.1.0/maa-llm-wiki-catalog-v0.1.0.zip"
    )
    api_url = "https://api.github.com/repos/Windsland52/MaaLLMWiki/releases/latest"
    release = json.dumps(
        {
            "tag_name": "v0.1.0",
            "assets": [
                {
                    "name": "maa-llm-wiki-catalog-v0.1.0.zip",
                    "browser_download_url": asset_url,
                    "digest": f"sha256:{digest}",
                }
            ],
        }
    ).encode()
    calls: list[str] = []

    def download(url: str) -> bytes:
        calls.append(url)
        return release if url == api_url else bundle

    status = resolve_github_wiki_catalog(
        cache_root=tmp_path / "cache",
        downloader=download,
    )
    offline = resolve_github_wiki_catalog(
        cache_root=tmp_path / "cache",
        offline=True,
        downloader=download,
    )

    assert calls == [api_url, asset_url]
    assert status.input_url == asset_url
    assert status.bundle_sha256 == digest
    assert offline.catalog_path == status.catalog_path
