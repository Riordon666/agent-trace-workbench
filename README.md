<div align="center">
  <img src="docs/readme-hero.svg" alt="Agent Trace Workbench" width="100%" />

  <h1>Agent Trace Workbench</h1>
  <p><strong>Local-first DevTools for observing, replaying, and diagnosing coding-agent sessions.</strong></p>

  <a href="https://github.com/Riordon666/agent-trace-workbench/actions/workflows/ci.yml"><img alt="CI" src="https://img.shields.io/github/actions/workflow/status/Riordon666/agent-trace-workbench/ci.yml?branch=main&style=flat-square&label=CI" /></a>
  <a href="https://nodejs.org/"><img alt="Node.js 20+" src="https://img.shields.io/badge/Node.js-20%2B-43853d?style=flat-square&logo=node.js&logoColor=white" /></a>
  <a href="LICENSE"><img alt="MIT License" src="https://img.shields.io/badge/License-MIT-5b9bd5?style=flat-square" /></a>
  <img alt="Local-first" src="https://img.shields.io/badge/Local--first-127.0.0.1-e891b5?style=flat-square" />
  <img alt="No telemetry" src="https://img.shields.io/badge/Telemetry-none-5eaaa8?style=flat-square" />

  <p><a href="README.zh-CN.md">简体中文</a> · <a href="docs/ARCHITECTURE.md">Architecture</a> · <a href="ROADMAP.md">Roadmap</a> · <a href="CONTRIBUTING.md">Contributing</a></p>
</div>

---

Agent Trace Workbench (ATW) brings API traffic, local agent history, tool calls, usage, and diagnostics into one local Session. It is intended for debugging questions such as:

- What did the agent actually send to the model?
- Which model, tool calls, token usage, and response events were observed?
- Did an SSE stream end cleanly, or was it truncated?
- Does the local agent history agree with the captured API traffic?
- Can I inspect or share a redacted diagnostic bundle without inventing missing reasoning?

ATW does **not** infer chain-of-thought. If a provider omits, encrypts, or redacts thinking, the UI reports it as `unavailable` and preserves only the fields actually observed.

<p align="center">
  <img src="docs/screenshots/session-explorer.png" alt="Agent Trace Workbench Session Explorer" width="94%" />
</p>

## Current status

`v0.2.0` is being prepared as a public preview. The repository currently provides the CLI and package metadata, but the npm package must not be considered published until the corresponding GitHub/npm release exists.

| Layer | Support | Evidence and boundary |
|---|---|---|
| Agent history | Claude Code | Local JSONL discovery/import with synthetic fixtures and tests |
| Agent history | Codex CLI | Observed rollout formats, version detection, synthetic fixtures and tests |
| Live capture | Legacy MITM | HTTPS CONNECT interception, raw response forwarding, local redacted capture |
| Protocol | Anthropic Messages | Streaming SSE/JSON parsing, thinking/signature/tool/usage fields when present |
| Protocol | OpenAI Responses | Protocol adapter and synthetic conformance tests; live capture is currently optimized for Anthropic Messages |
| Compression | identity, gzip, deflate, br, zstd | Capture-side decoding; unsupported encodings are not advertised upstream |
| Playback | Session Explorer and timeline | Historical inspection; this is not deterministic re-execution |
| Export | Session Bundle and annotation directory | Known credentials are redacted; manual review is still required |

Gemini CLI, OpenCode, Session Comparison, Trace Schema v1, and a broader privacy scanner are roadmap items, not current support claims.

## Quick start from source

Requirements: Node.js 20 or newer, npm, and OpenSSL for MITM certificate generation.

```bash
git clone https://github.com/Riordon666/agent-trace-workbench.git
cd agent-trace-workbench
npm install
npm run setup
npm run workbench
```

Open <http://127.0.0.1:5177/>.

The `v0.2.0` CLI can also be tested locally before npm publication:

```bash
npm link
atw doctor
atw setup
atw
```

`atw` selects an available local port and opens the browser. Use `atw --no-open` for headless environments or `atw --port 5177` to require a specific port.

When launched through the CLI, mutable data is stored outside the npm installation in the current user's application-data directory (`%LOCALAPPDATA%\\agent-trace-workbench` on Windows, `~/Library/Application Support/agent-trace-workbench` on macOS, or `$XDG_DATA_HOME/agent-trace-workbench` on Linux). Set `ATW_DATA_DIR` to override the root. A source checkout launched with `npm run workbench` continues to use the repository's ignored runtime directories.

## Capture a Claude Code session

1. Run `atw setup` once to generate the local MITM certificate.
2. Create or select a Session in the workbench.
3. Start the Legacy MITM proxy, normally on `127.0.0.1:8888`.
4. Start official capture.
5. Launch Claude Code with the proxy and CA environment shown by the workbench.
6. Complete the task, wait for active requests to reach zero, and stop capture.
7. Inspect the Session Explorer, raw trace status, replay timeline, and Diagnostics.

ATW forwards upstream response bytes to the client unchanged. A separate capture path decodes supported compression and records Anthropic SSE events, including `thinking_delta` and `signature_delta` when the upstream actually sends them.

## Security warning: local MITM certificate

Legacy MITM capture is powerful and sensitive:

- It uses a locally generated CA certificate and private key under the configured certificate directory (the CLI uses its per-user data directory; a source checkout defaults to `certs/`).
- Keep the proxy bound to localhost and restrict `TARGET_HOST` whenever possible.
- Leaving `TARGET_HOST` empty allows the local proxy to intercept all HTTPS hosts reached through it.
- Captures can contain prompts, source code, paths, tool inputs, tool output, cookies, and credentials.
- Remove the certificate from the trust store when it is no longer needed; deleting the local certificate files alone does not remove OS trust.
- Never commit or share certificate keys, Session data, raw traces, or unreviewed exports.

See [SECURITY.md](SECURITY.md) and [docs/PRIVACY.md](docs/PRIVACY.md).

## Data flow

```mermaid
flowchart LR
  AGENT["Coding agent"] --> PROXY["Legacy MITM proxy"]
  PROXY -->|"bytes unchanged"| UPSTREAM["Model API"]
  UPSTREAM -->|"bytes unchanged"| AGENT
  PROXY --> RAW["Raw API-call JSONL"]
  RAW --> PA["Protocol adapter"]
  HISTORY["Local agent history"] --> AA["Agent adapter"]
  PA --> EVENTS["events.jsonl"]
  AA --> EVENTS
  EVENTS --> EXPLORER["Explorer / Playback / Diagnostics"]
  RAW --> EXPORT["Redacted export"]
  EVENTS --> EXPORT
```

The raw trace is the source of truth for captured wire events. Normalized events are derived views used by the UI and diagnostics.

## Session files

```text
sessions/<session-id>/
├── config.json
├── proxy-status.json
├── https-intercepts.json
├── raw/api-calls/*_apicall.jsonl
├── events.jsonl
├── agent-history.jsonl
├── claude-history.jsonl
└── diagnostics-result.json
```

Runtime directories are gitignored. Session Bundle export redacts known credential patterns and adds hashes, but prompts and tool output may contain project-specific secrets no generic scanner can recognize.

The CLI places these directories under its per-user data root. `ATW_DATA_DIR`, `WORKBENCH_SESSIONS_DIR`, `WORKBENCH_CERT_DIR`, and `WORKBENCH_ANNOTATION_EXPORT_DIR` provide explicit overrides.

## CLI

```text
atw [start] [--port <port>] [--no-open]
atw setup
atw doctor
atw --version
```

- `start`: starts the local web server, chooses a free port when needed, and opens a browser.
- `setup`: generates the local MITM certificate with OpenSSL. Trust is an explicit OS-level action.
- `doctor`: checks Node.js, `node-pty`, OpenSSL, certificate presence, and the default port.

## Privacy and reasoning

- No account, hosted backend, analytics, or telemetry is required.
- Authorization headers, API-key fields, cookies, and common token patterns are redacted in supported exports.
- A clean scanner result means only “no known pattern was detected,” never “safe to share.”
- `signature` is opaque encrypted provider data; ATW preserves it and never tries to decrypt it.
- Empty thinking plus a signature is shown as unavailable thinking, not reconstructed text.

## Development

```bash
npm ci
npm run check
npm pack --dry-run
```

Tests use synthetic fixtures only. Never add real prompts, histories, captures, credentials, certificates, usernames, customer data, or private filesystem paths.

The public branch is `main`. See [CONTRIBUTING.md](CONTRIBUTING.md), [SECURITY.md](SECURITY.md), and the [release checklist](docs/RELEASE_CHECKLIST.md).

## Known limitations

- Live capture requires local proxy and certificate configuration and varies by client/OS.
- Current raw per-call capture is focused on Anthropic-compatible `/v1/messages` traffic.
- Some providers intentionally omit visible thinking and return only an opaque signature.
- Playback reconstructs observed events; it does not re-run tools or guarantee deterministic execution.
- Automated redaction is not a complete privacy scrubber.
- Large sessions can consume significant disk and browser memory.

## License

Code is available under the [MIT License](LICENSE). Artwork and bundled third-party assets may have separate terms documented in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
