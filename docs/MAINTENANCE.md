# Maintenance and Triage

ATW's maintenance record should be made of real reports, reviewed changes, and evidence-backed releases. Do not create empty releases, placeholder Issues, fake compatibility reports, or synthetic adoption numbers to make the project appear active.

## Triage cadence

Maintainers aim to review new Issues and pull requests at least weekly. This is a best-effort target, not a service-level agreement.

For each report:

1. check that no credentials, private prompts/responses, signatures, usernames, or personal paths are exposed;
2. classify it as installation, compatibility, capture, replay, export/privacy, UI, documentation, or security;
3. request a minimal synthetic reproduction and `atw doctor` output when applicable;
4. reproduce on the reported OS and a supported Node.js version;
5. record the upstream Agent/provider version and exact evidence boundary;
6. close with the validating test, documentation change, release, or explicit unsupported boundary.

Potential vulnerabilities and accidental secret exposure must move to the private process in [`SECURITY.md`](../SECURITY.md). Do not ask reporters to attach a real `.atwtrace`, Agent history, or raw capture to a public Issue.

## Compatibility evidence gate

An Agent or format becomes a support claim only when it has:

- an upstream format or an explicitly documented observed format;
- version detection where the upstream CLI exposes a version;
- a synthetic fixture with obviously fake content;
- parser and normalized-event tests;
- a server-level discovery/import check where practical;
- a row in [`ADAPTER_COMPATIBILITY.md`](ADAPTER_COMPATIBILITY.md) stating what was and was not verified.

Reasoning, signatures, retries, costs, file operations, and lifecycle fields must be labeled as observed or explicitly derived. Missing evidence stays unavailable.

## Pull request review

Every pull request should keep one auditable purpose and complete the repository template. Reviewers verify:

- local-first and localhost boundaries;
- no real Session data or unreviewed large assets;
- no regression in response-byte forwarding or privacy redaction;
- deterministic synthetic tests for new formats;
- documentation and compatibility claims that match the implementation;
- `npm run check`, audit, pack boundary, and three-platform CI.

## Release cadence

Release when there is a meaningful, tested user-visible increment. A one-to-two-week cadence is a planning target, not a reason to publish empty versions. Each release follows [`RELEASE_CHECKLIST.md`](RELEASE_CHECKLIST.md), includes a changelog, and leaves `main` on the next development version after tagging.

Security fixes can ship outside the normal cadence. npm and GitHub Release versions must agree before the npm install command is promoted.

## Public project signals

Review these monthly after public launch:

- GitHub stars and forks;
- real Issues opened/closed and median time to first maintainer response;
- external pull requests and contributors;
- npm weekly/monthly downloads after publication;
- platform and Agent coverage backed by compatibility reports;
- release count and age of the public maintenance record.

Record only values returned by the public services. A zero or unavailable metric is more useful than a fabricated one.

Append dated observations to [`PROJECT_SIGNALS.md`](PROJECT_SIGNALS.md). Do not rewrite older snapshots when values change, and do not classify a contributor as external solely from the contributors API.
