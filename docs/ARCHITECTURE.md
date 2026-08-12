# Architecture

## Runtime flow

```text
Coding Agent
  -> Legacy MITM proxy
      -> upstream API (response bytes forwarded unchanged)
      -> capture-only decompression
          -> raw/api-calls/*_apicall.jsonl
          -> Protocol Adapter
              -> normalized events.jsonl

Local Agent History
  -> Agent Adapter
      -> normalized events.jsonl

events.jsonl + raw capture
  -> Session Explorer / Playback / Comparison / Diagnostics / Export
```

ATW intentionally separates the forwarding path from the capture path. Capture decoding or disk failures must not rewrite provider responses or fabricate missing events.

## Capture boundary

The public UI currently exposes one live capture mode: Legacy MITM.

- The proxy accepts HTTPS CONNECT traffic on localhost.
- A locally generated certificate is used to inspect configured traffic.
- `TARGET_HOST` should restrict interception whenever possible.
- identity, gzip, deflate, Brotli, and zstd are decoded only on the capture path.
- unsupported encodings are removed from the upstream `Accept-Encoding` advertisement.
- Anthropic-compatible `/v1/messages` calls receive append-only raw per-call traces.

The old Local Gateway capture mode is not part of the current product surface.

## Raw API-call trace

Each new Anthropic-compatible call writes an append-only JSONL file under:

```text
sessions/<id>/raw/api-calls/<timestamp>_<id>_apicall.jsonl
```

Records include request metadata, response headers, SSE events, completion state, compression metadata, event counts, and an end marker. Authorization and known credential fields are redacted before persistence. Signatures inside model response bodies are preserved because they are protocol data, not API credentials.

The raw trace is the capture source of truth. `https-intercepts.json` provides an index and parsed summary for the UI.

## Common event schema

Generated normalized events contain:

```text
schema_version, session_id, request_id, agent, provider, model,
event_type, timestamp, content, source
```

Generated event types are `session_start`, `session_end`, `request_start`, `user_message`, `reasoning`, `assistant_message`, `tool_call`, `tool_result`, `usage`, `error`, and `request_end`.

Readers preserve unknown future event types and Diagnostics reports them as informational. Writers generate only known types. Model identifiers are stored as observed.

Session Comparison selects one normalized event source per metric category to avoid counting protocol and history copies twice. It reports only observed metrics, exposes selected sources, and labels retry/file statistics as evidence-based signals rather than inferred ground truth.

## Portable trace boundary

`.atwtrace` is a ZIP-compatible, versioned exchange container. Required entries are `manifest.json`, `metadata.json`, `events.jsonl`, `diagnostics.json`, `privacy-report.json`, and `checksums.txt`; redacted raw capture files are optional. Every non-checksum entry is covered by SHA-256. Import rejects missing, extra, duplicate, unsafe-path, unsupported-version, or modified entries before parsing events. Legacy v1 Session Bundles remain read-compatible.

Trace Schema v1 is described by the JSON Schemas under `schemas/`. Readers preserve unknown future event types. Portable export applies a broader scanner than capture-time credential redaction, but always reports `manual_review_required`.

## Adapter boundaries

Protocol Adapters implement `id`, `displayName`, `detect`, `parseSSE`, and `parseJSON`.

Agent Adapters implement `id`, `displayName`, `protocols`, `classifyRequest`, `discoverLocalSessions`, `parseHistory`, and `historyToEvents`.

Reasoning is emitted only when a source contains actual visible reasoning. An encrypted signature, an empty omitted-thinking block, or absent content remains unavailable.

## Playback versus re-execution

The Replay workspace is historical playback over observed events, including imported `.atwtrace` data. It does not execute commands, call models, reproduce filesystem state, or promise deterministic re-execution.

## Security invariants

- The web server and proxy bind to localhost by default.
- WebSocket terminal Host and Origin are allowlisted.
- No HTTP client may select an arbitrary upstream through the workbench server.
- Certificates, Sessions, logs, and local data remain outside the published package/repository boundary.
- Missing reasoning is never inferred.
