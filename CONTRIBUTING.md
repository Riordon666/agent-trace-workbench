# Contributing

Participation is governed by [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).

Issue triage, compatibility evidence, pull request review, and release cadence are documented in [docs/MAINTENANCE.md](docs/MAINTENANCE.md).

1. Keep the application local-first and bound to `127.0.0.1` by default.
2. Do not add telemetry, accounts, remote storage, or open-proxy behavior.
3. Never commit real Agent histories, API captures, credentials, certificates, logs, or custom wallpapers.
4. Use synthetic fixtures with obviously fake model names and content.
5. Do not infer or generate missing reasoning.
6. Protocol adapters normalize wire formats; Agent adapters normalize local histories.
7. Add tests and run `npm run check`, `npm pack --dry-run`, and `git diff --check` before proposing a change.
8. Do not claim Agent/version compatibility without a synthetic fixture, version detection, and a documented observed format.
9. Treat the Replay workspace as historical playback unless a change explicitly implements and verifies deterministic re-execution.

New or changed adapters must pass the public conformance runner described in [docs/ADAPTER_SDK.md](docs/ADAPTER_SDK.md). Conformance uses only the explicitly supplied synthetic fixture and never invokes local-session discovery. Adapter modules are trusted executable JavaScript and must be reviewed as code; passing conformance does not sandbox them.

The project code is MIT-licensed. Do not replace its license or add new third-party artwork without documenting the applicable permission, license, source, and attribution in `THIRD_PARTY_NOTICES.md` and `workbench/public/pic/wallpapers.json`.
