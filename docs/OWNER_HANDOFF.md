# Repository Owner Handoff

This handoff covers actions that require repository administration, npm account ownership, credentials, or an explicit publication decision. It does not grant an automation agent authority to publish or change shared repository settings.

The requirement-by-requirement completion state is tracked in [`PLAN_EXECUTION_AUDIT.md`](PLAN_EXECUTION_AUDIT.md).

## Observed state — 2026-08-12 07:20 UTC

- GitHub repository: `Riordon666/agent-trace-workbench`.
- GitHub reports `master` as the default branch.
- The verified release-infrastructure implementation commit is `2ab68f9`. [CI run `31573392968`](https://github.com/Riordon666/agent-trace-workbench/actions/runs/31573392968) succeeded with all 9 source jobs and all 3 isolated package-smoke jobs; later documentation-only commits require their own green CI without changing that implementation evidence.
- `.github/workflows/release.yml` exists on `main`, but GitHub's default-branch workflow list still exposes only CI while the repository default remains `master`. Switch the default to `main` before configuring the npm Trusted Publisher or relying on the Release workflow.
- The authenticated GitHub account reports `WRITE`, not `ADMIN`, permission.
- The branch-protection endpoint returned HTTP 404. With the current permission, this is not sufficient evidence that protection is absent; an administrator must verify it in Settings.
- `npm whoami` returned `ENEEDAUTH`.
- `npm view agent-trace-workbench version --json` returned registry `E404`; the package is not published.
- GitHub Release `v0.2.0 — Public Preview` exists and points to immutable tag `v0.2.0`.
- The current development package version is `0.3.0-dev.0`. Do not publish that development identifier as the intended stable `0.3.0` release.

Re-check every item before acting; this section is a dated observation, not live state.

## 1. Validate current `main` before a release

The prepared implementation commits are now published and cross-platform CI is green. Before any release, revalidate the canonical checkout because new commits or dependency state may have changed:

```bash
git fetch origin
git status --short
git log --oneline origin/main..main
npm ci
npm run check
npm run test:package
npm audit --audit-level=high
git diff --check
```

The worktree must be clean and the listed commits must be intentional. If a later release-preparation commit is approved for shared `main`, push it and wait for its own CI rather than relying on the earlier green run:

```bash
git push origin main
gh run list --repo Riordon666/agent-trace-workbench --branch main --limit 5
```

Do not create a release or advertise the new features until the remote CI run for the pushed commit has completed successfully, including the three-OS package-smoke job.

## 2. Make `main` the GitHub default branch

An administrator should use **Repository Settings → Branches → Default branch** and select `main`. Verify afterward:

```bash
gh repo view Riordon666/agent-trace-workbench --json defaultBranchRef --jq .defaultBranchRef.name
```

The result must be `main`. Keep `master` temporarily while checking old links, clones, and automations; branch deletion is a separate destructive decision and is not required for this migration.

## 3. Configure branch protection or a ruleset

After at least one CI run on the final workflow revision, an administrator should protect `main` in GitHub Settings:

- require a pull request before merge;
- require all intended CI and package-smoke status checks;
- require conversations to be resolved;
- prevent force pushes and branch deletion;
- keep bypass permissions explicit and minimal.

Select status checks from a real completed workflow run so their names exactly match GitHub's recorded contexts. Verify the rules in Settings or with an administrator-authorized API token. Do not treat an HTTP 404 from a lower-permission token as proof of protection state.

## 4. Do not publish the existing `v0.2.0` npm artifact

The immutable tag rebuilds reproducibly and passed its Windows empty-consumer smoke, but it contains a known Linux Doctor defect: it executes `openssl --version` rather than portable `openssl version`. The same code failed the Ubuntu package-smoke job before commit `062b5f8` fixed it. See the complete [`v0.2.0 package audit`](V0.2.0_PACKAGE_AUDIT.md).

Keep the GitHub Release as historical preview evidence. Do not publish that known-defective version to npm; npm cannot replace an already-used name/version. Make a later fully verified stable release the first npm publication. The current registry `E404` means that first publication still requires the npm owner to claim the package interactively. After the package exists, configure its npm Trusted Publisher for future releases with these exact values:

- provider: GitHub Actions;
- owner: `Riordon666`;
- repository: `agent-trace-workbench`;
- workflow filename: `release.yml`;
- environment: `npm`;
- allowed action: `npm publish`.

An administrator should also configure the GitHub Environment named `npm` with required reviewers and deployment tag rules. The workflow grants only `contents: write` and `id-token: write`, uses a GitHub-hosted runner, does not use a long-lived npm token, and relies on npm's automatic OIDC provenance. The npm CLI requirement is Node 22.14+ with npm 11.5.1+; the workflow uses Node 24.

## 5. Prepare `v0.3.0` as the first npm release after remote validation

Do not publish `0.3.0-dev.0`. The implementation is on remote `main` and its CI is green; once the intended release scope is frozen:

1. set `package.json` and `package-lock.json` to `0.3.0`;
2. move the scoped `Unreleased` entries into a dated `0.3.0` section;
3. rerun the complete [release checklist](RELEASE_CHECKLIST.md);
4. confirm `node scripts/release-gate.js v0.3.0` passes;
5. commit the release metadata, create an annotated `v0.3.0` tag, and push the commit/tag;
6. wait for main CI and the tag-triggered Release workflow; it creates a recoverable draft, publishes npm through Trusted Publishing, verifies provenance and a clean registry install, then publishes the GitHub Release;
7. verify GitHub/npm versions and install behavior independently before promotion;
8. advance `main` to the next development version only after the release is confirmed.

## 6. Build real adoption evidence

Use the factual launch material in [`LAUNCH_KIT.md`](LAUNCH_KIT.md), triage real reports according to [`MAINTENANCE.md`](MAINTENANCE.md), and append public values to [`PROJECT_SIGNALS.md`](PROJECT_SIGNALS.md). Do not manufacture Issues, PRs, compatibility reports, downloads, testimonials, contributors, or activity cadence.
