# Security

## Supported use

Agent Trace Workbench is intended for one user on a trusted local machine. The web server and proxy bind to `127.0.0.1` by default. Do not expose them through public port forwarding or a reverse proxy unless you understand and configure the explicit Host/Origin allowlists.

## Legacy MITM capture

Live capture uses a locally generated CA certificate and private key.

- Restrict `TARGET_HOST` whenever possible.
- An empty `TARGET_HOST` allows interception of all HTTPS hosts reached through the proxy.
- Never share or commit the generated `cert.pem` or `key.pem`. The CLI stores them under its per-user data directory; source mode defaults to `certs/`.
- Remove the CA from the operating-system trust store when no longer needed. Deleting the local files does not remove trust.
- The proxy must forward provider response bytes unchanged; capture decoding is a separate path.
- Unsupported response compression must not be advertised upstream.

## Sensitive data

Prompts, source code, paths, tool data, responses, cookies, and credentials may be captured. Known credential fields and token patterns are redacted, but context-specific secrets may remain. Every export requires manual review; a scanner must never make an absolute “safe to share” claim.

## Terminal

The terminal is an explicitly user-operated local shell. WebSocket Host and Origin are checked, shells are selected from an allowlist, working directories are restricted, and concurrent PTYs are limited. `TERMINAL_ALLOWED_ROOTS` may add explicit roots using the platform path separator.

## Vulnerability reporting

Use GitHub private vulnerability reporting when available. Do not attach real captures or histories; provide a synthetic reproduction. Supported security fixes are released from the public `main` branch.
