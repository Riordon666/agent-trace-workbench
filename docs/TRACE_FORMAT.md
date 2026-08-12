# Portable Trace Format

Agent Trace Workbench exports a Session as a ZIP-compatible file with the `.atwtrace` extension. The v2 container carries normalized Trace Schema v1 events and is designed for historical playback and diagnostics, not deterministic command or model re-execution.

## Commands

```bash
atw export <session-id> --output <session-id>.atwtrace
atw open <session-id>.atwtrace
```

`atw export` refuses to overwrite an existing file. `atw open` verifies the trace before importing it and allocates a new Session ID when the original ID already exists.

## Required entries

```text
manifest.json
metadata.json
events.jsonl
diagnostics.json
privacy-report.json
checksums.txt
```

Optional redacted raw captures are stored under `raw/`. Every file except `checksums.txt` must have a SHA-256 entry in `checksums.txt`; imports reject missing, extra, duplicate, unsafe-path, or modified entries. Legacy v1 Session Bundles remain importable.

## Versioning

- `bundle_version: "2.0"` identifies the portable container layout.
- `schema_version: "1.0"` identifies each normalized event's schema.
- Writers emit the event types documented in `event-schema.js`.
- Readers preserve unknown future event types and Diagnostics labels them.

Machine-readable contracts live in [`schemas/trace-manifest.schema.json`](../schemas/trace-manifest.schema.json) and [`schemas/trace-event.schema.json`](../schemas/trace-event.schema.json).

## Privacy contract

Export scans known credential fields, API keys, GitHub and AWS tokens, bearer tokens, cookies, private keys, home-directory paths, email addresses, and IP addresses. `privacy-report.json` records counts by category and severity without retaining the matched values.

The only valid automated sharing status is `manual_review_required`. A zero-finding scan does not mean a trace is safe to share: project-specific secrets, source code, prompts, and tool output still require entry-by-entry human review.

## Playback boundary

An imported trace can be inspected in Session Explorer, Replay, Comparison, and Diagnostics. Replay is a view of recorded events. Import never runs captured commands, calls a model, restores the original filesystem, or evaluates content from the archive.
