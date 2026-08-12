const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const {
  allowedHostSet,
  allowedOriginSet,
  boundedInt,
  normalizeHost,
  resolveCwd,
  resolveShell,
} = require('../workbench/server/terminal');

test('terminal clamps dimensions, restricts cwd and shell selection', () => {
  const root = path.resolve(__dirname, '..');
  assert.equal(resolveCwd(path.resolve(root, '..'), root), root);
  assert.equal(resolveCwd(root, root), root);
  assert.equal(boundedInt(9999, 20, 400, 80), 80);
  assert.doesNotMatch(resolveShell('totally-untrusted.exe'), /totally-untrusted/i);
});

test('terminal network allowlists are local-only unless explicitly configured', () => {
  const previousHosts = process.env.WORKBENCH_ALLOWED_HOSTS;
  const previousOrigins = process.env.WORKBENCH_ALLOWED_ORIGINS;
  delete process.env.WORKBENCH_ALLOWED_HOSTS;
  delete process.env.WORKBENCH_ALLOWED_ORIGINS;

  try {
    const localHosts = allowedHostSet('127.0.0.1');
    const localOrigins = allowedOriginSet('127.0.0.1', 5177);
    assert.deepEqual([...localHosts].sort(), ['127.0.0.1', 'localhost']);
    assert.deepEqual([...localOrigins].sort(), ['http://127.0.0.1:5177', 'http://localhost:5177']);
    assert.equal(localHosts.has('trace.riordon.xyz'), false);
    assert.equal(localOrigins.has('https://trace.riordon.xyz'), false);

    process.env.WORKBENCH_ALLOWED_HOSTS = 'trace.example.com';
    process.env.WORKBENCH_ALLOWED_ORIGINS = 'https://trace.example.com';
    assert.equal(allowedHostSet('127.0.0.1').has('trace.example.com'), true);
    assert.equal(allowedOriginSet('127.0.0.1', 5177).has('https://trace.example.com'), true);
  } finally {
    if (previousHosts === undefined) delete process.env.WORKBENCH_ALLOWED_HOSTS;
    else process.env.WORKBENCH_ALLOWED_HOSTS = previousHosts;
    if (previousOrigins === undefined) delete process.env.WORKBENCH_ALLOWED_ORIGINS;
    else process.env.WORKBENCH_ALLOWED_ORIGINS = previousOrigins;
  }
});

test('terminal rejects malformed host values', () => {
  assert.equal(normalizeHost('localhost:5177'), 'localhost');
  assert.equal(normalizeHost('https://example.com'), '');
  assert.equal(normalizeHost('example.com/path'), '');
  assert.equal(normalizeHost('example.com:99999'), '');
});
