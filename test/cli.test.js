const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { appendEvents } = require('../workbench/core/event-store');
const { exportTrace, findPort, importTrace, parseArgs, resolveDataDir, runtimeEnv, safeSessionId } = require('../bin/atw');

function tempDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-trace-cli-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('CLI parses start, doctor, port and no-open options', () => {
  assert.deepEqual(parseArgs([]), { command: 'start', port: null, open: true, help: false, version: false, target: null, output: null, sessionId: null });
  assert.deepEqual(parseArgs(['start', '--port', '6123', '--no-open']), { command: 'start', port: 6123, open: false, help: false, version: false, target: null, output: null, sessionId: null });
  assert.equal(parseArgs(['doctor']).command, 'doctor');
  assert.deepEqual(parseArgs(['export', 'session-1', '-o', 'trace.atwtrace']), { command: 'export', port: null, open: true, help: false, version: false, target: 'session-1', output: 'trace.atwtrace', sessionId: null });
  assert.deepEqual(parseArgs(['open', 'trace.atwtrace', '--session-id', 'imported', '--no-open']), { command: 'open', port: null, open: false, help: false, version: false, target: 'trace.atwtrace', output: null, sessionId: 'imported' });
  assert.throws(() => parseArgs(['--port', '70000']), /between 1 and 65535/);
  assert.throws(() => parseArgs(['export', 'session-1', '--output']), /requires a value/);
  assert.throws(() => parseArgs(['--unknown']), /Unknown option/);
  assert.throws(() => safeSessionId('..'), /Session ID/);
  assert.throws(() => safeSessionId('.'), /Session ID/);
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

test('CLI exports and imports a portable trace without overwriting Sessions or files', (t) => {
  const root = tempDir(t);
  const dataDir = path.join(root, 'data');
  const sessionsDir = path.join(dataDir, 'sessions');
  const sessionDir = path.join(sessionsDir, 'session-1');
  fs.mkdirSync(sessionDir, { recursive: true });
  fs.writeFileSync(path.join(sessionDir, 'config.json'), JSON.stringify({ id: 'session-1', name: 'Synthetic', agent: 'codex-cli' }));
  appendEvents(sessionDir, [{ session_id: 'session-1', request_id: 'r1', agent: 'codex-cli', provider: 'openai', model: 'synthetic', event_type: 'user_message', timestamp: '2026-01-01T00:00:00Z', content: { text: 'hello' }, source: 'fixture' }]);
  const env = { ...process.env, ATW_DATA_DIR: dataDir };
  const output = path.join(root, 'portable.atwtrace');
  const exported = exportTrace({ target: 'session-1', output }, env);
  assert.equal(exported.output, output);
  assert.equal(fs.existsSync(output), true);
  assert.throws(() => exportTrace({ target: 'session-1', output }, env), /already exists/);

  const imported = importTrace({ target: output, sessionId: 'session-1' }, env);
  assert.equal(imported.id, 'session-1-imported-2');
  assert.equal(imported.imported.events, 1);
  assert.equal(JSON.parse(fs.readFileSync(path.join(imported.sessionDir, 'config.json'), 'utf8')).state, 'imported');
});
