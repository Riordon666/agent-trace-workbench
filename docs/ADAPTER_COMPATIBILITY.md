# Agent Adapter Compatibility

This document separates verified history-import behavior from live API-capture support. An Agent Adapter reads a local history format and maps explicit source fields to the common event schema. It does not imply that ATW can intercept every network protocol used by that agent.

## Evidence levels

- **Released**: included in a tagged ATW release, backed by synthetic fixtures and automated tests.
- **Main preview**: implemented and tested on `main`, but not yet included in a tagged release.
- **Live discovery smoke**: the discovery command was run against a locally installed CLI without exporting or inspecting a real user's conversation content.
- **Fixture only**: the parser is tested against a synthetic fixture derived from an upstream format; local installation was not available for a live smoke test.

## Compatibility matrix

| Agent | ATW status | Source read | Explicit evidence mapped | Verification boundary |
|---|---|---|---|---|
| Claude Code | Released in v0.2.0 | Local JSONL history | messages, visible thinking, signatures, tools, usage, lifecycle | Synthetic fixtures and automated tests |
| Codex CLI | Released in v0.2.0 | Local rollout/history files | messages, visible reasoning, tools, usage, lifecycle | Observed rollout variants, version detection, synthetic fixtures and automated tests |
| Gemini CLI | Main preview | `~/.gemini/tmp/<project>/chats/session-*.jsonl` (or the equivalent root under `GEMINI_CLI_HOME`) | user/model messages, explicit `thoughts`, tool calls/results, tokens, `$set`, `$rewindTo` | Official-format snapshot and synthetic fixture; Gemini CLI was not installed for a local live smoke test |
| OpenCode | Main preview | `opencode session list --format json`, then `opencode export <session-id>`; exported JSON files can also be imported directly | messages, explicit reasoning parts, provider signature metadata, tool states/results, retries, usage, errors, lifecycle | Official-format snapshot, synthetic fixture/API integration tests, and discovery smoke on OpenCode 1.18.11 for Windows |

The Gemini implementation tracks the session-management format documented by the official [`google-gemini/gemini-cli`](https://github.com/google-gemini/gemini-cli/blob/main/docs/cli/session-management.md) repository, reviewed at upstream commit `5024443c7217464a66e98f80d73172a26440bd8f`.

The OpenCode implementation uses the official [`session list --format json` and `export`](https://github.com/anomalyco/opencode/blob/dev/packages/web/src/content/docs/cli.mdx) interfaces, reviewed at upstream commit `d4704347465c1ee63d0c213ed00e648e7f0231c5`. It intentionally does not read OpenCode's internal database directly.

## Reasoning and signature boundary

ATW emits a `reasoning` event only when the imported source contains a non-empty, visible reasoning field:

- Gemini CLI: explicit `thoughts` records.
- OpenCode: explicit parts whose type is `reasoning`.

For OpenCode, `metadata.anthropic.signature` is preserved when the exported reasoning part contains it. A missing field remains unavailable. ATW does not decrypt signatures, reconstruct hidden chain-of-thought, or convert summaries into unseen reasoning.

## Import and privacy boundary

History discovery and import are local operations. Import copies the selected source into the Session and creates normalized `events.jsonl` records. A history file can contain prompts, paths, source snippets, tool output, identifiers, or credentials. Treat the Session as sensitive and run the privacy scanner before sharing an `.atwtrace`; its report always requires manual review.

Synthetic compatibility tests cover adapters without reading real user conversations. Upstream CLIs can change their formats, so a new upstream version is not considered verified until its discovery/import path and fixtures pass CI.
