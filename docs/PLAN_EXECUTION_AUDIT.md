# OSS Plan Execution Audit

This audit maps the explicit execution checklist in `agent-trace-workbench_codex-oss_plan.md` to evidence observed on 2026-08-12. It distinguishes verified public source state from repository-owner actions and evidence that only real users can create.

## Evidence snapshot

- The published implementation head is `062b5f8`; this audit update records the verified state that followed it.
- Current development version: `0.3.0-dev.0`.
- [Remote CI run `31571994831`](https://github.com/Riordon666/agent-trace-workbench/actions/runs/31571994831) passed all 9 Windows/macOS/Linux source jobs on Node 20/22/24 and all 3 isolated package-smoke jobs on Node 20.
- Package smoke ran the prepack gate with all 84 tests, then verified a clean tarball install, offline `atw` bin, public Adapter SDK, Doctor, localhost startup, per-user data storage, status API, unmodified install directory, and clean shutdown.
- `npm audit --omit=dev` reported 0 vulnerabilities.
- `git diff --check` passed before the implementation pushes.
- GitHub still reports `master` as the default branch and the authenticated account has `WRITE`, not `ADMIN`, permission.
- npm registry lookup returns `E404`; npm authentication returns `ENEEDAUTH`.
- Public-signal values and their boundaries are recorded in [`PROJECT_SIGNALS.md`](PROJECT_SIGNALS.md).

## Final 20-item checklist

| # | Plan requirement | Status | Authoritative evidence | Remaining gate |
|---:|---|---|---|---|
| 1 | Fix README/code inconsistencies | Verified on remote | English/Chinese README, Architecture, Changelog, FAQ, current capability matrix, screenshots, and Known Limitations describe Legacy MITM/history paths and explicitly exclude deterministic replay or inferred reasoning. | Maintain those boundaries as capabilities change. |
| 2 | Change default branch from `master` to `main` | Owner action required | GitHub repository metadata still returns `master`; source badges and links target `main`. | GitHub administrator changes the default and verifies protection/settings. |
| 3 | Fix CI badge | Verified on remote | README badge targets `branch=main`; workflow runs on push/PR; run `31571994831` passed all 12 jobs. | None beyond keeping CI healthy. |
| 4 | Unify version at `v0.2.0` | Verified for first preview | Immutable `v0.2.0` tag and matching GitHub Release exist. Current `main` correctly uses the next development version `0.3.0-dev.0`. | npm `0.2.0` is still unpublished. |
| 5 | Publish first GitHub Release | Verified publicly | [`v0.2.0 — Public Preview`](https://github.com/Riordon666/agent-trace-workbench/releases/tag/v0.2.0) is published. | Continue only with meaningful evidence-backed releases. |
| 6 | Publish npm package | Not achieved | Registry returns `E404`; `npm whoami` returns `ENEEDAUTH`. | npm package owner authenticates and publishes from immutable `v0.2.0`, then verifies clean installation. |
| 7 | Provide `atw` CLI | Verified on remote | `start`, `setup`, `doctor`, `export`, `open`, and `diff`; three-OS isolated tarball smoke verifies the installed bin. | Registry publication is required for real `npx`/global installation. |
| 8 | Add Issue/PR templates | Verified on remote | Structured Bug, Feature, Compatibility, and PR templates cover platform, versions, data path, exact sanitized errors, privacy, Adapter conformance, and package smoke. | Real reports must remain genuine. |
| 9 | Make English README primary and retain Chinese README | Verified | `README.md` is English and links `README.zh-CN.md`. | None beyond publication/maintenance. |
| 10 | Produce a 30–60 second Demo | Verified publicly | README embeds the synthetic 30-second GIF; reproducible frames and launch kit exist. | Real launch distribution has not been performed. |
| 11 | Implement Session Comparison | Verified on remote | A/B metrics, source disclosure, structured regression status, UI rendering, and tests are published and covered by CI. | Gather real comparison feedback without inventing adoption. |
| 12 | Implement safe Trace Export/Import | Verified on remote | Checksummed `.atwtrace` v2, schemas, redaction/privacy report, CLI export/open, read-only diff, tamper rejection, and tests. | Continue manual review for every shared export. |
| 13 | Add Gemini CLI Adapter | Verified on remote | Official JSONL mapping, discovery, version detection, synthetic fixture, and API integration tests. | Independent real-platform reports are still limited. |
| 14 | Add OpenCode Adapter | Verified on remote | Official CLI list/export integration, format validation, reasoning/signature/tools/retries/usage mapping, synthetic tests, and recorded Windows smoke. | Additional platform/version evidence must come from real reports. |
| 15 | Publish `v0.3.0` | Not achieved | Current version is intentionally `0.3.0-dev.0`; implementation CI is green, but no matching tag/npm/GitHub Release exists. | Freeze scope, change stable version/changelog, rerun release CI, then publish npm and GitHub Release together. |
| 16 | Start promotion | Materials prepared; public campaign unverified | Evidence-bounded English/Chinese launch copy and Demo are in `LAUNCH_KIT.md`. | A maintainer must post to chosen real communities and respond to real feedback. |
| 17 | Process real Issues | Not achieved | GitHub has 0 open and 0 closed Issues. | Real users must report genuine problems; maintainers triage them without manufacturing activity. |
| 18 | Review external PRs | Historical evidence exists; independence not assumed | Four merged PRs exist; three are technically cross-repository. Contributor independence cannot be proven from API fields alone. | Continue evidence-backed review of genuine future PRs. |
| 19 | Release every 1–2 weeks when justified | Not yet established | Only one formal GitHub Release exists. The maintenance policy explicitly rejects empty cadence releases. | Meaningful changes, real feedback, and elapsed public maintenance time are required. |
| 20 | Accumulate 1–2 months, then apply | Not achieved | Public preview was released on 2026-08-12; adoption targets and maintenance duration are not met. | Real elapsed time, downloads, Issues, contributors, releases, and compatibility evidence. |

## Additional plan outcomes

| Area | Current result |
|---|---|
| Distribution readiness | Source and tarball behavior are verified; registry distribution remains unavailable until npm publication. |
| Cross-platform quality | Public CI run `31571994831` passed Windows/macOS/Linux source checks on Node 20/22/24 plus isolated package-smoke on all three operating systems. |
| Privacy | Known patterns are redacted and all exports remain `manual_review_required`; ATW never claims a generic scanner makes a trace safe to share. |
| Adapter ecosystem | Four Agent Adapters and two Protocol Adapters pass the public deterministic conformance contract using synthetic fixtures. Adapter modules are documented as trusted executable JavaScript, not sandboxed plugins. |
| Analytics and regression diagnostics | Published source includes paginated events, Token/model/tool/request analytics, three-state cost semantics, verified Trace diff, thresholds, JSON/CI output, and Session Comparison regression diagnostics. |
| Public evidence | The ledger records 4 Stars, 0 Forks, no Issues, 4 merged PRs, 1 Release, unpublished npm state, and unavailable visitor/download values without inference. |

## Why the plan is not complete

No further code change can truthfully substitute for these external conditions:

1. GitHub `ADMIN` action for the default branch and protection/rulesets;
2. npm credential-owner authentication and publication;
3. an explicit release decision and matching `v0.3.0` version/tag/npm/GitHub Release work;
4. real users, real Issue/PR interactions, downloads, compatibility reports, multiple meaningful releases, and elapsed maintenance time.

The exact owner sequence is in [`OWNER_HANDOFF.md`](OWNER_HANDOFF.md). After any external state changes, refresh this audit from authoritative GitHub/npm/CI responses rather than assuming completion.
