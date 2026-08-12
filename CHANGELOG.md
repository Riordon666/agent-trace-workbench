# Changelog

All notable changes to Agent Trace Workbench are documented here. The project follows Semantic Versioning.

## [Unreleased]

### Added

- Session A/B comparison with duration, token, tool, explicit-file, failed-command, retry-signal, request, and error deltas.
- Metric-source disclosure and synthetic cross-agent Comparison fixtures/tests.
- Portable `.atwtrace` v2 export/import with Trace Schema v1, metadata, Diagnostics, optional redacted raw captures, and SHA-256 coverage for every archive entry.
- `atw export` and `atw open` commands with no-overwrite behavior and legacy v1 Session Bundle import compatibility.
- Categorized privacy scanning for known provider credentials, GitHub/AWS tokens, bearer tokens, cookies, private keys, home paths, email addresses, and IP addresses.
- Gemini CLI history discovery/import for official JSONL sessions, including explicit thoughts, tools, tokens, metadata updates, and rewinds.
- OpenCode history discovery/import through the official CLI list/export interface, including explicit reasoning/signatures, tool states, retries, usage, and errors.
- Adapter compatibility matrix and server-level synthetic import integration tests.
- A 30-second synthetic-data UI walkthrough, reproducible Demo builder, and evidence-bounded launch copy.
- Per-model Token Analytics, three-state cost semantics, tool statistics, request timelines, and server-paginated event browsing.
- Public Adapter SDK v1.0 with deterministic Agent/Protocol conformance runners, synthetic fixtures, and explicit executable-code trust boundaries.
- Verified read-only `atw diff` with JSON output, configurable regression thresholds, CI exit code 2, and matching Session Comparison diagnostics.
- FAQ covering capture, reasoning/signature boundaries, proxy/port troubleshooting, privacy review, storage, and export formats.

### Changed

- Anthropic streaming usage events now retain the merged input/output token counts observed across the response.
- Development version advanced to `0.3.0-dev.0`; npm `0.2.0` must be published from the immutable `v0.2.0` tag.

### Planned

- Publish the npm package after maintainer authentication is configured.
- Collect independent platform/Agent smoke evidence and real-user compatibility reports.
- Publish subsequent releases only after their scoped release checks and maintenance evidence are complete.

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
