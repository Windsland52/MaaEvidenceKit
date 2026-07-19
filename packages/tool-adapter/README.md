# Tool adapter

This package is the mechanical TypeScript boundary for deterministic MLA and public MSE APIs.
It validates requests and translates third-party results into project-owned JSON. Diagnostic
reasoning and workflow policy remain in Python.

## MLA dependency gate

MDE requires the MaaFramework runtime-session output introduced by MaaLogAnalyzer commit
`006c1ed` (`frameworkVersionSummary` and `frameworkSessions`). Add the MLA package dependency only
after a release containing that contract can be pinned exactly.

Do not use a `file:../MaaLogAnalyzer` dependency, copy MLA implementation into this repository, or
silently fall back to a package version that exposes only a global/preflight parser result. Until
the compatible package is released, the concrete MLA tool remains unregistered.

MSE integrations use only its public packages, including `@nekosu/maa-tasker` and
`@nekosu/maa-pipeline-manager`.
