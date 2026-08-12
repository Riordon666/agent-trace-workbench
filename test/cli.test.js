const test = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
const path = require('node:path');
const { findPort, parseArgs, resolveDataDir, runtimeEnv } = require('../bin/atw');

test('CLI parses start, doctor, port and no-open options', () => {
  assert.deepEqual(parseArgs([]), { command: 'start', port: null, open: true, help: false, version: false });
  assert.deepEqual(parseArgs(['start', '--port', '6123', '--no-open']), { command: 'start', port: 6123, open: false, help: false, version: false });
  assert.equal(parseArgs(['doctor']).command, 'doctor');
  assert.throws(() => parseArgs(['--port', '70000']), /between 1 and 65535/);
  assert.throws(() => parseArgs(['--unknown']), /Unknown option/);
});

test('CLI uses a per-user data directory and preserves explicit overrides', () => {
  const windows = resolveDataDir({ LOCALAPPDATA: 'C:\\Users\\Example\\AppData\\Local' }, 'win32', 'C:\\Users\\Example');
  const mac = resolveDataDir({}, 'darwin', '/Users/example');
  const linux = resolveDataDir({}, 'linux', '/home/example');
  assert.equal(windows, path.join('C:\\Users\\Example\\AppData\\Local', 'agent-trace-workbench'));
  assert.equal(mac, path.join('/Users/example', 'Library', 'Application Support', 'agent-trace-workbench'));
  assert.equal(linux, path.join('/home/example', '.local', 'share', 'agent-trace-workbench'));

  const env = runtimeEnv('/projects/demo', { ATW_DATA_DIR: '/data/atw', WORKBENCH_CERT_DIR: '/custom/certs' });
  assert.equal(env.WORKBENCH_SESSIONS_DIR, path.resolve('/data/atw', 'sessions'));
  assert.equal(env.WORKBENCH_CERT_DIR, '/custom/certs');
  assert.equal(env.WORKBENCH_PROJECT_ROOT, path.resolve('/projects/demo'));
});

test('CLI finds another port unless the requested port is explicit', async (t) => {
  const blocker = net.createServer();
  await new Promise((resolve) => blocker.listen(0, '127.0.0.1', resolve));
  t.after(() => blocker.close());
  const busy = blocker.address().port;
  const selected = await findPort(busy, false);
  assert.notEqual(selected, busy);
  await assert.rejects(findPort(busy, true), /already in use/);
});
