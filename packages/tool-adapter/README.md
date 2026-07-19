# Tool adapter

This package is the mechanical TypeScript boundary for deterministic MLA and public MSE APIs.
It validates requests and translates third-party results into project-owned JSON. Diagnostic
reasoning and workflow policy remain in Python.

## MLA integration

The adapter pins `@windsland52/maa-log-tools@1.1.1`. That release includes MaaFramework runtime
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

MSE integrations use only its public packages, including `@nekosu/maa-tasker` and
`@nekosu/maa-pipeline-manager`.
