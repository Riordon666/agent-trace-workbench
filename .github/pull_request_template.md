## Summary

Describe the user-visible change and the reason for it.

## Verification

- [ ] `npm run check`
- [ ] `npm run test:adapters` passes when an Agent or Protocol Adapter changes
- [ ] `npm run test:package` passes when the CLI, package boundary, runtime paths, or startup changes
- [ ] Tests use synthetic fixtures only
- [ ] No real Session, capture, credentials, certificate, log, private path, or custom wallpaper is included
- [ ] Missing reasoning remains `unavailable`
- [ ] Localhost, MITM target, certificate, and terminal security boundaries remain intact
- [ ] `npm pack --dry-run` contains no runtime data or unintended large assets
- [ ] README, compatibility evidence, Adapter SDK docs, FAQ, and Changelog claims match the implementation where applicable

## UI changes

If applicable, attach a screenshot made with synthetic data. Visual customization is secondary to observability, privacy, and compatibility.
