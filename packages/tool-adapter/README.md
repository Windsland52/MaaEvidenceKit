# Tool adapter

This package is the mechanical TypeScript boundary for deterministic MLA and public MSE APIs.
It validates requests and translates third-party results into project-owned JSON. Diagnostic
reasoning and workflow policy remain in Python.

## MLA integration

The adapter pins `@windsland52/maa-log-tools@1.2.2`. That release includes MaaFramework runtime
sessions (`frameworkVersionSummary` and `frameworkSessions`) and NodeNext-compatible declarations.

The registered `mla.preflight` tool accepts:

```json
{
  "name": "mla.preflight",
  "arguments": {
    "path": "C:/path/to/maafw.log-or-debug-bundle"
  }
}
```

It returns the project-owned `mde-mla-preflight/v1` result: compatibility counts, framework-version
summary, source-backed runtime sessions, and warnings. It does not select a diagnosis, source
revision, or root cause.

## JSONL transport

Build the adapter, then send one `tool-adapter/v1` request per stdin line:

```powershell
pnpm build
'{"id":"1","apiVersion":"tool-adapter/v1","method":"tools/list"}' |
  node packages/tool-adapter/dist/cli.js
```

Responses are emitted in input order, one JSON object per stdout line. Protocol errors are returned
as normal error responses; unexpected process failures go to stderr.

## MSE integration

`mse.project-preflight` accepts a Maa project root. It searches only conventional
`interface.json/jsonc` locations, loads controller/resource combinations through the public
`@nekosu/maa-pipeline-manager` API, and returns project-owned snake-case summaries of task
bindings, resource paths, pipeline file counts, and static diagnostics.

The adapter supplies a one-shot read-only file enumerator to MSE instead of starting a persistent
filesystem watcher. It never writes the inspected project. Controller/resource combinations are
capped at 256 and diagnostics at 500 records; truncation is explicit. The adapter consumes only
public MSE packages. `@maaxyz/maa-node@5.12.2`
is a type-only development dependency because the published pipeline-manager declarations refer
to its global types; MDE does not load MaaFramework native runtime during preflight.
