# Public Project Signals

This ledger records time-stamped values returned by GitHub and npm. It must not contain invented adoption, testimonials, Issues, pull requests, contributors, or compatibility evidence.

Snapshots are append-only. A later snapshot may report different values, but should not rewrite an earlier observation. Account names returned by the contributors API are not automatically classified as external contributors; ownership and independence require separate evidence.

## Snapshot — 2026-08-12 06:28 UTC

| Signal | Observed value | Evidence boundary |
|---|---:|---|
| GitHub Stars | 4 | `gh repo view` public repository metadata. |
| GitHub Forks | 0 | `gh repo view` public repository metadata. |
| GitHub Issues | 0 open / 0 closed | No real Issue history exists yet. |
| GitHub pull requests | 0 open / 0 closed-unmerged / 4 merged | PRs [#4](https://github.com/Riordon666/agent-trace-workbench/pull/4), [#5](https://github.com/Riordon666/agent-trace-workbench/pull/5), and [#6](https://github.com/Riordon666/agent-trace-workbench/pull/6) were cross-repository; PR [#7](https://github.com/Riordon666/agent-trace-workbench/pull/7) was same-repository. Cross-repository is a technical source fact, not proof of contributor independence. |
| GitHub Releases | 1 | `v0.2.0 — Public Preview`, published 2026-08-12; [release page](https://github.com/Riordon666/agent-trace-workbench/releases/tag/v0.2.0). |
| Contributor identities | 3 | GitHub contributors API returned `Nineu1124` (13), `Riordon666` (12), and `dongdong-cmd` (1). These are contribution counts, not proof of three independent external contributors. |
| Latest completed remote `main` CI | success | Commit `163270b`; [workflow run](https://github.com/Riordon666/agent-trace-workbench/actions/runs/31563201878). Local unpublished commits are not covered by this run. |
| npm package | unpublished | `npm view agent-trace-workbench version --json` returned registry `E404`. Weekly/monthly downloads are therefore unavailable. |
| Default GitHub branch | `master` | Repository metadata still reports `master`; source documentation and CI target `main`. Changing the default requires repository administration. |
| Website visitors | unavailable | The project has no required hosted analytics or product telemetry. No number is inferred. |

Repository: <https://github.com/Riordon666/agent-trace-workbench>

## Snapshot — 2026-08-12 07:00 UTC

| Signal | Observed value | Evidence boundary |
|---|---:|---|
| GitHub Stars | 4 | `gh repo view` public repository metadata. |
| GitHub Forks | 0 | `gh repo view` public repository metadata. |
| GitHub Issues | 0 open / 0 closed | No real Issue history exists yet. |
| GitHub pull requests | 0 open / 0 closed-unmerged / 4 merged | PRs [#4](https://github.com/Riordon666/agent-trace-workbench/pull/4), [#5](https://github.com/Riordon666/agent-trace-workbench/pull/5), and [#6](https://github.com/Riordon666/agent-trace-workbench/pull/6) remain technically cross-repository; PR [#7](https://github.com/Riordon666/agent-trace-workbench/pull/7) remains same-repository. These fields do not prove contributor independence. |
| GitHub Releases | 1 | `v0.2.0 — Public Preview`; no additional release was created. |
| Contributor identities | 3 | Contributors API still returned `Nineu1124` (13), `Riordon666` (12), and `dongdong-cmd` (1). Counts do not prove independent adoption. |
| Latest completed remote `main` CI | success | Implementation commit `062b5f8`; [workflow run](https://github.com/Riordon666/agent-trace-workbench/actions/runs/31571994831) passed 9 source jobs and 3 isolated package-smoke jobs across Windows, macOS, and Linux. |
| npm package | unpublished | Registry lookup still returned `E404`; download metrics remain unavailable. |
| Default GitHub branch | `master` | Repository metadata still reports `master`; changing it requires repository administration. |
| Website visitors | unavailable | No required hosted analytics or product telemetry exists; no value is inferred. |

## Collection procedure

Use public/read-only service responses and retain the timestamp:

```bash
gh repo view Riordon666/agent-trace-workbench --json defaultBranchRef,stargazerCount,forkCount,latestRelease
gh api graphql -f query='query { repository(owner:"Riordon666", name:"agent-trace-workbench") { openIssues: issues(states:OPEN) { totalCount } closedIssues: issues(states:CLOSED) { totalCount } openPullRequests: pullRequests(states:OPEN) { totalCount } closedPullRequests: pullRequests(states:CLOSED) { totalCount } mergedPullRequests: pullRequests(states:MERGED) { totalCount } } }'
gh pr list --repo Riordon666/agent-trace-workbench --state all --json number,state,author,createdAt,mergedAt,url,isCrossRepository,headRepositoryOwner
gh release list --repo Riordon666/agent-trace-workbench --json tagName,name,publishedAt,isDraft,isPrerelease
gh run list --repo Riordon666/agent-trace-workbench --limit 20 --json workflowName,status,conclusion,headBranch,headSha,event,createdAt,url
gh api 'repos/Riordon666/agent-trace-workbench/contributors?per_page=100'
npm view agent-trace-workbench version --json
```

After npm publication, obtain downloads from the public npm downloads API or registry UI and record the exact date range. After real Issue/PR activity begins, distinguish opened/closed, author association, and time to first maintainer response. Never create placeholder activity to improve the table.
