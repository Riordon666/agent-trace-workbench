const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const root = path.resolve(__dirname, '..');

test('workbench API imports Gemini CLI and OpenCode histories through the adapter registry', async (t) => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'atw-agent-history-api-'));
  const port = await freePort();
  let stderr = '';
  const child = spawn(process.execPath, [path.join(root, 'workbench', 'server.js'), '--port', String(port)], {
    cwd: root,
    env: {
      ...process.env,
      WORKBENCH_SESSIONS_DIR: path.join(tempRoot, 'sessions'),
      WORKBENCH_CERT_DIR: path.join(tempRoot, 'certs'),
      WORKBENCH_WALLPAPER_DIR: path.join(tempRoot, 'wallpapers'),
      WORKBENCH_ANNOTATION_EXPORT_DIR: path.join(tempRoot, 'exports'),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  child.stderr.on('data', (chunk) => { stderr += String(chunk); });
  t.after(async () => {
    if (child.exitCode === null) {
      child.kill();
      await Promise.race([new Promise((resolve) => child.once('exit', resolve)), delay(3000)]);
    }
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  const base = `http://127.0.0.1:${port}`;
  await waitUntilReady(base, child, () => stderr);

  const cases = [
    {
      agent: 'gemini-cli',
      fixture: path.join(root, 'test', 'fixtures', 'agents', 'gemini-cli', 'session-v1.jsonl'),
      namedFile: 'gemini-history.jsonl',
      expectedFormat: 'gemini-jsonl-v1',
      expectedThinking: 1,
      expectedSignatures: 0,
    },
    {
      agent: 'opencode',
      fixture: path.join(root, 'test', 'fixtures', 'agents', 'opencode', 'export-v1.json'),
      namedFile: 'opencode-export.json',
      expectedFormat: 'opencode-export-v1',
      expectedThinking: 1,
      expectedSignatures: 1,
    },
  ];

  for (const scenario of cases) {
    const created = await jsonRequest(base, '/api/sessions', { name: `${scenario.agent}-integration` });
    const imported = await jsonRequest(base, `/api/sessions/${encodeURIComponent(created.id)}/import`, {
      agent: scenario.agent,
      historyPath: scenario.fixture,
    });
    assert.equal(imported.imported.adapter, scenario.agent);
    assert.equal(imported.imported.formatVersion, scenario.expectedFormat);
    assert.equal(imported.agent, scenario.agent);
    assert.equal(imported.eventSummary.agents.includes(scenario.agent), true);
    assert.equal(imported.eventSummary.reasoning, 'available');
    assert.equal(imported.historySummary.thinkingRounds, scenario.expectedThinking);
    assert.equal(imported.historySummary.signatureRounds, scenario.expectedSignatures);
    assert.equal(imported.files.find((file) => file.name === 'agent-history.jsonl').exists, true);
    assert.equal(imported.files.find((file) => file.name === scenario.namedFile).exists, true);

    const eventResponse = await jsonRequest(base, `/api/sessions/${encodeURIComponent(created.id)}/events`);
    assert.equal(eventResponse.events.some((event) => event.source === 'agent-history'), true);
    assert.equal(eventResponse.parseErrors.length, 0);
    assert.equal(eventResponse.events.length <= 100, true);
    assert.equal(eventResponse.filteredTotal >= eventResponse.events.length, true);

    const eventPage = await jsonRequest(base, `/api/sessions/${encodeURIComponent(created.id)}/events?offset=1&limit=2`);
    assert.equal(eventPage.offset, 1);
    assert.equal(eventPage.limit, 2);
    assert.equal(eventPage.events.length <= 2, true);

    const analytics = await jsonRequest(base, `/api/sessions/${encodeURIComponent(created.id)}/analytics`);
    assert.equal(analytics.summary.session_id, created.id);
    assert.equal(analytics.timeline.total_requests >= 1, true);
    assert.equal(['observed', 'estimated', 'unavailable'].includes(analytics.cost.status), true);
  }
});

async function jsonRequest(base, route, body) {
  const response = await fetch(`${base}${route}`, body === undefined ? undefined : {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const value = await response.json();
  assert.equal(response.ok, true, `${route}: ${value.error || response.status}`);
  return value;
}

async function waitUntilReady(base, child, stderr) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`Workbench exited before readiness (${child.exitCode}): ${stderr()}`);
    try {
      const response = await fetch(`${base}/api/status`);
      if (response.ok) return;
    } catch {}
    await delay(50);
  }
  throw new Error(`Workbench did not become ready: ${stderr()}`);
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
