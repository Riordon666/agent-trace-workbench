const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { validateRelease } = require('../scripts/release-gate');

function fixture(t, overrides = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atw-release-gate-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));
  const version = overrides.version || '0.3.0';
  const packageJson = {
    name: 'agent-trace-workbench',
    version,
    repository: { type: 'git', url: 'git+https://github.com/Riordon666/agent-trace-workbench.git' },
    publishConfig: { access: 'public' },
    bin: { atw: './bin/atw.js' },
    engines: { node: '>=20' },
    ...overrides.packageJson,
  };
  const lockfile = {
    name: packageJson.name,
    version: overrides.lockVersion || version,
    packages: { '': { name: packageJson.name, version: overrides.lockRootVersion || version } },
  };
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify(packageJson));
  fs.writeFileSync(path.join(root, 'package-lock.json'), JSON.stringify(lockfile));
  fs.writeFileSync(path.join(root, 'CHANGELOG.md'), overrides.changelog || `# Changelog\n\n## [${version}] - 2026-08-12\n`);
  return root;
}

test('release gate accepts an internally consistent stable release', (t) => {
  const root = fixture(t);
  assert.deepEqual(validateRelease(root, 'v0.3.0'), {
    packageName: 'agent-trace-workbench',
    repository: 'https://github.com/Riordon666/agent-trace-workbench',
    tag: 'v0.3.0',
    version: '0.3.0',
  });
});

test('release gate rejects prerelease tags and inconsistent release metadata', (t) => {
  assert.throws(() => validateRelease(fixture(t), 'v0.3.0-dev.0'), /exact stable SemVer/);
  assert.throws(() => validateRelease(fixture(t, { lockRootVersion: '0.2.0' }), 'v0.3.0'), /package-lock root version/);
  assert.throws(() => validateRelease(fixture(t, { changelog: '# Changelog\n\n## [Unreleased]\n' }), 'v0.3.0'), /dated.*release heading/);
  assert.throws(() => validateRelease(fixture(t, { packageJson: { publishConfig: {} } }), 'v0.3.0'), /publishConfig.access/);
  assert.throws(() => validateRelease(fixture(t, { packageJson: { repository: 'https://example.com/fork' } }), 'v0.3.0'), /package repository/);
});
