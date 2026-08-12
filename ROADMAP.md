# Roadmap

Agent Trace Workbench remains local-first: no required account, hosted backend, analytics, or telemetry.

## v0.2.0 — Public Preview

- Legacy MITM capture with raw per-call Anthropic Messages traces.
- gzip, deflate, Brotli, and zstd capture decoding.
- Thinking/signature preservation when present; unavailable remains explicit.
- Claude Code and Codex CLI history adapters.
- Session Explorer, historical playback, Diagnostics, bundles, annotation export, and local terminal.
- `atw` CLI, Doctor, npm package boundary, English/Chinese documentation, and three-platform CI.

## v0.3.0 — Comparison and analytics

- [Implemented on `main`] Side-by-side Session Comparison with documented cross-agent metric definitions.
- [Implemented on `main`] Duration, token, tool-call, explicit-file, command-failure, and retry-signal deltas where evidence is available.
- Large-session navigation and virtualization.
- [Implemented on `main`] Evidence-based compatibility matrix maintained with adapter fixtures.

## v0.4.0 — Adapter ecosystem

- [Implemented on `main`] Gemini CLI adapter based on the official local JSONL session format.
- [Implemented on `main`] OpenCode adapter based on the official CLI list/export interface.
- Adapter conformance kit and trust boundaries.

## v0.5.0 — Portable trace infrastructure

- [Implemented on `main`] Versioned Trace Schema v1 and checksummed `.atwtrace` v2 packaging.
- [Implemented on `main`] CLI export/open workflows with non-overwrite import/export behavior.
- [Implemented on `main`] Privacy scanner with categorized findings, severity counts, and an explicit manual-review requirement.
- Trace diff diagnostics and regression comparison.

## v1.0.0 — Stable

Requires a stable trace schema and adapter interface, cross-platform installation evidence, real-user validation, and a sustained public maintenance record.

Roadmap items are candidates, not support claims. New adapters require synthetic fixtures, version detection, compatibility documentation, and tests. ATW never fabricates unavailable reasoning.
