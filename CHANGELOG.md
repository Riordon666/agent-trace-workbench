# Changelog

All notable changes to Agent Trace Workbench are documented here. The project follows Semantic Versioning.

## [Unreleased]

### Planned

- Publish the npm package after maintainer authentication is configured.
- Add a stable Trace Schema and broader privacy-scanner report.

## [0.2.0] - 2026-08-12

### Added

- `atw` CLI with automatic local-port selection, browser launch, `setup`, and `doctor`.
- Legacy MITM raw per-call JSONL traces for Anthropic-compatible Messages calls.
- Capture decoding for gzip, deflate, Brotli, and zstd.
- Streaming `signature_delta` preservation and completeness metadata.
- Annotation directory export using the PDF-defined skeleton.
- Export warnings for incomplete or legacy zero-event SSE captures.
- Configurable HTTP/WebSocket Host and Origin allowlists.

### Changed

- Removed Local Gateway from the supported product surface and documentation.
- Clarified historical playback versus deterministic re-execution.
- Reduced the npm package boundary to runtime files and a small wallpaper set.
- Promoted English as the primary README and added `README.zh-CN.md`.

### Security

- Unsupported response encodings are no longer advertised upstream.
- Known credentials are redacted before raw capture persistence and again during supported exports.
- MITM certificate trust and unrestricted `TARGET_HOST` risks are documented explicitly.

## [0.1.0] - 2026-07-15

### Added

- Common event model for messages, reasoning, tools, usage, errors, and request lifecycle events.
- Claude Code and Codex CLI local-history adapters.
- Session Explorer, historical playback, Diagnostics, hashing, crash recovery, and redacted Session Bundles.
- Local terminal with Host, Origin, shell, working-directory, and concurrency boundaries.
- Synthetic fixtures and automated tests.
