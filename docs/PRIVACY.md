# Privacy and data boundaries

Agent Trace Workbench has no required account, hosted backend, analytics, or telemetry. The CLI stores runtime data under a per-user application-data directory; source mode uses local ignored directories. Data leaves those locations only when the user explicitly exports or shares it.

## Sensitive content

Captures may contain prompts, responses, source code, file paths, tool inputs, tool output, email addresses, IP addresses, cookies, and credentials. Raw Anthropic thinking signatures are opaque protocol fields and may be large.

Known Authorization/API-key fields and common token patterns are redacted in supported persistence/export paths. This is pattern matching, not a general-purpose data-loss-prevention system.

The correct scanner conclusion is:

> No known secret pattern was detected. Manual review is still required.

Never claim an automated export is “safe to share.”

## Never commit

- Session directories and exported traces
- Certificate directories and private keys
- `local-private/`
- `local-data/`
- logs, captures, histories, tokens, private keys, or private screenshots

## Certificate boundary

MITM setup creates a CA certificate and private key. Restrict capture targets, keep the key local, and remove the CA from the OS trust store when finished. Deleting the local certificate files does not revoke OS trust automatically.

## Sharing

Session Bundles and annotation exports must be reviewed entry by entry. If an Issue needs reproduction data, prefer a synthetic fixture rather than a sanitized real trace.
