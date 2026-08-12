# Frequently Asked Questions

## Does ATW capture or reconstruct private chain-of-thought?

No. ATW records only reasoning text or summaries that the upstream protocol or local Agent history explicitly exposes. If thinking is omitted, encrypted, or redacted, ATW reports `unavailable` and never reconstructs it.

## What is `signature`?

A signature is opaque Provider data associated with a reasoning block. It can prove that an upstream field was observed, but it is not readable reasoning. ATW preserves signatures when present and never tries to decrypt them.

## Why does Thinking show `unavailable` while Signature shows `present`?

Some Providers return an opaque signature without visible reasoning text. This is a valid source state, not a capture failure by itself. Inspect the raw per-call trace and Adapter compatibility notes before diagnosing transport loss.

## Which live API traffic is supported?

Current raw per-call capture is optimized for Anthropic-compatible Messages traffic, including SSE/JSON, tools, usage, visible thinking, and signatures when actually returned. An OpenAI Responses protocol Adapter exists and is tested with synthetic fixtures, but that does not claim the same live-capture coverage for every OpenAI-compatible endpoint or third-party dialect.

## Can I use ATW without the MITM proxy?

Yes. You can import supported local histories from Claude Code, Codex CLI, Gemini CLI, and OpenCode. Compatibility is format- and version-sensitive; see the [evidence matrix](ADAPTER_COMPATIBILITY.md).

## Why does `npm run workbench` report `EADDRINUSE` for port 5177?

Another process is already listening on that port, often an existing ATW instance. Close the earlier workbench or use the CLI with automatic port selection: `atw --no-open`. To require another explicit port, run `atw --port 5178`.

## Why can “Start Legacy Proxy” keep spinning?

Common causes are an occupied proxy port, a missing certificate, an invalid `TARGET_HOST`, or a child process that exited before the UI received readiness. Run `atw doctor`, verify the configured proxy port, and inspect the System Log. Proxy startup is separate from starting the web workbench.

## Is Replay deterministic re-execution?

No. Replay is historical playback of observed normalized events. It does not re-run shell commands, tools, or model requests and cannot guarantee that an Agent would produce the same result again.

## Is a privacy-scanned `.atwtrace` safe to publish?

Not automatically. The scanner removes known credential and personal-data patterns, but project-specific secrets can remain in prompts, source code, paths, and tool output. Every export is marked `manual_review_required` and must be inspected before sharing.

## What is the difference between `.atwtrace` and the annotation directory?

`.atwtrace` is a checksummed portable diagnostic archive for verified import, playback, and read-only diff. The annotation directory follows the separate dataset skeleton and currently auto-populates only `trajectory/`; the user supplies `manifest.json`, task assets, screenshots, workspace, environment, and QC content.

## Where does ATW store data?

The CLI uses the current user's application-data directory by default. A source checkout launched with `npm run workbench` uses the repository's ignored runtime directories. `ATW_DATA_DIR` and the documented `WORKBENCH_*_DIR` variables provide explicit overrides.

## Is the npm package published?

Do not assume so from the repository version. The package is considered published only when the exact version appears on the npm registry. Until then, use the source checkout or `npm link` instructions in the README.

## How do I add an Agent or protocol Adapter?

Use the versioned [Adapter SDK and conformance runner](ADAPTER_SDK.md), add only synthetic fixtures, document the observed format/version, and update the compatibility matrix. Adapter modules are trusted executable JavaScript; conformance validates behavior but does not sandbox untrusted code.
