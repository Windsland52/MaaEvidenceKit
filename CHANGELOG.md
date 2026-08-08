# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

[Unreleased]: https://github.com/Windsland52/MaaEvidenceKit/compare/v0.1.1...HEAD
[0.1.1]: https://github.com/Windsland52/MaaEvidenceKit/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/Windsland52/MaaEvidenceKit/releases/tag/v0.1.0
