# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.3.0] - 2026-08-11

### Added

- Search retained direct-child and descendant recognition nodes by exact name, with the matching
  relation and nested recognition path included in each result.

### Fixed

- Report a failed combined-directory MLA load as an explicit fallback warning when individual log
  inspection remains available, without duplicating the same file as directory-level missing
  evidence.
- Include the linked task status and nearby-failure count in failure-context summaries so a
  succeeded root task does not hide adjacent failed subtasks.

### Changed

- Refine the host-agent Skill to gather evidence progressively, identify exact or prefix-overlapping
  issue exports before counting reproductions, and keep original Sentry groups separate from
  host-inferred signature families.
- State explicitly that application Sentry queries and diagnostic interpretation remain external
  harness responsibilities; MEK does not receive application Sentry credentials.

## [0.2.0] - 2026-08-11

### Added

- Add a use-time updater that rate-limits npm checks, hands commands to a newer exact stable
  runtime, and delegates cross-Agent Skill synchronization to the `skills` CLI with offline and CI
  fallbacks.
- Extract ordered MaaFramework pipeline override evidence with conservative Context-to-task
  correlation, explicit truncation, and parse-completeness reporting.
- Link runtime failure nodes to both MSE base-definition evidence and exact task-scoped override
  evidence without presenting a generic JSON merge as the final runtime configuration.
- Add bounded failure-centered task chronology with stable task, failure, and failure-image evidence
  references.
- Compare direct static OCR expected values and ROIs with bounded source-backed runtime observations
  using explicit literal and geometry-only semantics.

### Changed

- Update `@nekosu/maa-pipeline-manager` to 1.0.13; `@nekosu/maa-tasker` remains pinned to its latest
  1.0.0 release.
- Update MaaLogAnalyzer tooling to retain nested-task runtime failures and their image evidence.
- Install the hosted Skill as a remotely managed global Skill so its installer, rather than MEK,
  owns Agent-specific paths and update targets.
- Expand the harness Skill's configuration workflow to distinguish static declarations, runtime
  override inputs, framework execution facts, and observed application state.

## [0.1.1] - 2026-08-08

### Fixed

- Resolve CLI entrypoint symlinks before comparing module URLs so globally installed commands run
  correctly through package-manager shims.

### Changed

- Add a portable TypeScript build command for environments without native TypeScript 7 support.
- Include the detailed CLI, SDK, and evidence-model documentation in the published package.

## [0.1.0] - 2026-08-07

### Added

- Initial public TypeScript SDK and `maa-evidence` CLI for deterministic MaaFramework evidence.
- MaaFramework log discovery, task/session/failure facts, cycle analysis, recognition and action
  evidence, bounded source windows, and image-reference metadata.
- Generic OCR, template, color, direct-child, and nested-recognition extraction with explicit
  completeness and truncation fields.
- Public MSE project preflight, focused task resolution, static node/reference graphs, and source
  locations through pinned public MSE packages.
- Combined runtime-to-static failure and recognition relations with explicit resolution status.
- JSON, text, and Mermaid views plus evidence `search`, `view`, `window`, and `batch` workflows.
- Local performance profiles, default aggregate operational telemetry with opt-out, and explicitly
  confirmed original-material feedback.
- Host-agent Skill describing evidence-first issue-analysis workflows and MEK/harness boundaries.

### Security

- Project-root confinement for MSE reads and inventoried-artifact confinement for evidence windows.
- Whitelist-only operational telemetry, disabled default PII, and mandatory preview/confirmation for
  feedback attachments.

[Unreleased]: https://github.com/Windsland52/MaaEvidenceKit/compare/v0.3.0...HEAD
[0.3.0]: https://github.com/Windsland52/MaaEvidenceKit/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/Windsland52/MaaEvidenceKit/compare/v0.1.1...v0.2.0
[0.1.1]: https://github.com/Windsland52/MaaEvidenceKit/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/Windsland52/MaaEvidenceKit/releases/tag/v0.1.0
