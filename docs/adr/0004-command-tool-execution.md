# ADR 0004: Local command tool execution

- Status: accepted
- Date: 2026-07-23

## Context

Standalone MDE needs to let a model inspect GitHub issues and repositories with programs such as
`gh`, `git`, and `rg`, then fall back to a generated shell command when a purpose-built tool is
insufficient. External agents already provide their own command tools, but the lightweight Python
harness needs a provider-independent execution boundary.

An OS sandbox is not required for MDE's initial local, single-user deployment. In particular,
unreliable sandbox setup on Windows can make ordinary diagnostic commands fail and then require
the same command to be rerun outside the sandbox. Nevertheless, logs, issue comments, and source
files are untrusted model input, so unrestricted silent command execution is not an acceptable
default.

## Decision

MDE implements command execution in Python without an OS sandbox. It exposes two typed requests:

- `ProcessCommandRequest` executes an executable and argument array without a shell;
- `ShellCommandRequest` executes a complete platform shell command.

The runtime supports three policy modes:

- `disabled` denies all command execution;
- `safe` automatically allows a deliberately small set of read-only-intent `gh`, `git`, and
  `rg` process invocations, requires approval for other processes, and always requires approval
  for complete shell strings;
- `trusted` executes commands without approval checks.

At least one configured working-directory root is required and cwd selection remains enforced in
every mode. This is not filesystem isolation: a command approved to run can still name and access
paths outside those roots. The executor filters inherited environment variables, supplies GitHub
tokens only to direct `gh` process requests, applies a timeout, bounds model-visible stdout and
stderr, writes full truncated streams to a configured temporary directory, and returns a
serialized audit result containing the request, policy match, approval state, timestamps, exit
status, and output locations. The approval flag belongs to the harness or user interface and is
not a model-call parameter.

The safe policy is an approval convenience, not a security boundary. User approval and trusted
mode explicitly authorize execution in the host environment. A future hosted or multi-user MDE
must replace this backend with a container, worker, or OS sandbox without changing the command
contracts.

Model tool calling will be added as explicit LangGraph transitions. It must not be hidden inside
the existing one-shot structured-output reasoning calls. An approval-required result will pause
or route the graph through a user-confirmation surface before the same request is resubmitted with
approval.

Repair execution adds a stricter workflow-level override: a model-planned repair command always
requires explicit approval, including in `trusted` mode. This override can turn an allowed command
into an approval-required command, but it can never turn a policy or cwd denial into an approval.
The approved transition replays the exact pending request.

## Consequences

- Python remains the understandable source of command policy and execution behavior.
- External Codex, OpenCode, and pi integrations continue to use the host agent's own command tool.
- The lightweight harness can reuse the same contracts without depending on a TypeScript agent.
- Shell pipelines remain possible, but are never automatically approved in safe mode.
- Output truncation protects model context while retaining complete local audit artifacts.
- Safe-mode rules require conservative maintenance as new commands are introduced.
