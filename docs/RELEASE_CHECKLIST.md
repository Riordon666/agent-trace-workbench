# Release checklist

Never commit the real data used for manual validation.

## Automated checks

- [ ] `npm ci`
- [ ] `npm run check`
- [ ] `npm audit --audit-level=high`
- [ ] `git diff --check`
- [ ] CI passes on Windows, macOS, and Linux with supported Node.js versions.

## Package validation

- [ ] `npm pack --dry-run --json` contains only intended runtime files and notices.
- [ ] The packed tarball is within the release size budget.
- [ ] Install the tarball in a new empty directory without repository files or existing `node_modules`.
- [ ] `npx --offline <tarball> --version` reports the release version.
- [ ] `atw doctor` reports actionable failures without exposing credentials or private paths unnecessarily.
- [ ] Start with `--no-open`, verify `/api/status`, then shut down cleanly.

## Public boundary

- [ ] No `sessions/`, `certs/`, `local-private/`, `local-data/`, logs, captures, or real histories are staged or packed.
- [ ] Search staged changes for API keys, bearer tokens, private keys, usernames, absolute private paths, prompts, and responses.
- [ ] Screenshots use synthetic data and reveal no private path or terminal history.
- [ ] Wallpaper inventory and third-party notices match the published package.

## Agent and capture validation

- [ ] Import one local Claude Code Session and verify messages, tools, model, timestamps, and unavailable reasoning behavior.
- [ ] Import one local Codex CLI rollout and verify version detection, tools, model, and reasoning-summary labeling.
- [ ] Start Legacy MITM with `TARGET_HOST` restricted to a test upstream.
- [ ] Capture one complete compressed Anthropic Messages SSE response.
- [ ] Confirm raw events, response text, tool calls, usage, thinking/signature status, and `message_stop` completeness.
- [ ] Interrupt one stream and confirm it is marked incomplete.
- [ ] Export and re-import a `.atwtrace`, then export an annotation directory; inspect every entry manually.

Live provider checks can incur charges and require credentials. They must be initiated by the credential owner and never run in CI.

## Security review

- [ ] Confirm the web server, proxy, and terminal bind/allowlist behavior.
- [ ] Confirm `TARGET_HOST` risk and certificate-removal instructions are current.
- [ ] Confirm known credential redaction tests pass.
- [ ] State that automated scanning does not guarantee an export is safe to share.

## GitHub and npm release

- [ ] Default branch is `main`; branch protection and CI badge target `main`.
- [ ] Version matches `package.json`, lockfile, changelog, tag, npm, and GitHub Release.
- [ ] Publish a release candidate before the public stable preview.
- [ ] Verify npm provenance/package page and GitHub Release assets after publication.
- [ ] Monitor installation issues and respond with a documented triage process.
