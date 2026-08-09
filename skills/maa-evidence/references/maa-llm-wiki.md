# MaaLLMWiki access

MaaLLMWiki is a file-based navigation catalog, not a documentation answer store. Neither MEK nor
MaaLLMWiki currently exposes a catalog query command. Use host filesystem and Git/GitHub tools to
find a route, then read the original version-pinned source.

## Obtain one catalog

Use the first available source in this order:

1. Use a catalog or checkout path explicitly supplied by the user or harness.
2. Check declared workspace roots and immediate sibling repositories for `MaaLLMWiki`. Do not scan
   an entire drive or home directory. A usable root contains both `sources/repositories.yaml` and
   `generated/maa-framework/index.md`.
3. Reuse a previously downloaded release catalog only when its release tag, asset digest, and
   `catalog-manifest.json` are still recorded. Keep the cache outside the Maa project and MEK
   repository.
4. When network access is allowed and no local catalog is available, inspect the latest release
   tag and read only the needed files from that immutable tag first:

```powershell
$wikiRelease = gh release view `
  --repo Windsland52/MaaLLMWiki `
  --json tagName,assets | ConvertFrom-Json
$wikiTag = $wikiRelease.tagName
gh api -H "Accept: application/vnd.github.raw+json" `
  "repos/Windsland52/MaaLLMWiki/contents/sources/maa-framework/source-map.yaml?ref=$wikiTag"
gh api -H "Accept: application/vnd.github.raw+json" `
  "repos/Windsland52/MaaLLMWiki/contents/generated/maa-framework/<version>/index.md?ref=$wikiTag"
```

   Fetch `sources/repositories.yaml` and other routed catalog files from the same tag only when the
   first lookup needs them. Record the tag; do not mix files from the release tag and moving `main`.
5. Download the versioned ZIP only for repeated, broad, or offline queries:

```powershell
gh release download $wikiTag `
  --repo Windsland52/MaaLLMWiki `
  --pattern "maa-llm-wiki-catalog-*.zip" `
  --dir <cache-directory>
```

Extract the ZIP in the host harness. Confirm that it contains `catalog-manifest.json`, `sources/`,
and `generated/`; record the manifest's `wiki_revision` and source revisions. Do not hard-code the
currently latest tag or asset name. If `gh` is unavailable, use the same repository's GitHub
Releases page or API to read tagged files or acquire the asset. Do not access the network when the
user or environment disallows it.

Downloading a catalog is optional. If no catalog is available, inspect the version-matched
MaaFramework source directly and report that Wiki navigation was unavailable.

## Find a versioned route

1. Select the exact framework version in `generated/maa-framework/index.md`; open
   `generated/maa-framework/<version>/index.md` for its pinned revision. Do not silently use the
   newest or nearest indexed version.
2. Search `sources/*/source-map.yaml` first by exact field, symbol, log event, or topic. Use fixed
   strings so punctuation in identifiers is not interpreted as a regular expression:

```powershell
rg -n -i -F `
  -e "<field-or-event>" `
  -e "<symbol-or-topic>" `
  <catalog-root>\sources
```

3. Read the complete matched topic entry. Match its `source_id` and `applies_to`, then retain its
   `revision`, `paths`, and relevant `symbols` or `terms`. If no source-map topic matches, search
   only the selected version directory linked by the relevant `generated/*/index.md` for a
   documentation, schema, binding, or native API path.
4. Resolve `source_id` through `sources/repositories.yaml`. Disabled or placeholder sources are not
   authoritative routes.

If the catalog lacks the exact issue version or topic, stop treating it as a match. Continue with
the original versioned repository instead of extrapolating catalog metadata.

## Read the original source

Prefer an existing source checkout containing the routed revision. Read it without changing the
checkout:

```powershell
git -C <source-repository> cat-file -e "<revision>^{commit}"
git -C <source-repository> show "<revision>:<routed-path>"
```

If the commit is not local and network access is allowed, open the routed repository URL from
`sources/repositories.yaml` at `blob/<revision>/<routed-path>`, or acquire that immutable revision
in a host cache. Never replace the routed revision with the source checkout's current HEAD.

Cite the original documentation, schema, API declaration, or implementation, not MaaLLMWiki. Keep
that semantic evidence separate from MEK runtime/static evidence. The catalog does not contain Maa
project-specific Pipeline configuration, and framework source cannot validate application-specific
UI geometry.
