const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { MANIFEST_TEMPLATE, exportAnnotationDirectory, isAnthropicModelCall } = require('../workbench/core/annotation-export');
const { createRawApiCallCapture } = require('../workbench/core/raw-api-capture');

function tempDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-trace-annotation-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('annotation export creates the fixed skeleton and one redacted file per API call', (t) => {
  const root = tempDir(t);
  const sessionDir = path.join(root, 'session');
  const outputRoot = path.join(root, 'exports');
  fs.mkdirSync(sessionDir);
  fs.writeFileSync(path.join(sessionDir, 'https-intercepts.json'), JSON.stringify({
    data: [
      { method: 'POST', path: '/anthropic/v1/messages', timestamp: '2026-08-02T15:38:13.842Z', request: { headers: { authorization: 'Bearer secret' }, body: { model: 'synthetic', messages: [] } }, response: { status: 200 } },
      { method: 'POST', path: '/v1/messages?beta=true', timestamp: '2026-08-02T15:38:13.842Z', request: { body: { api_key: 'secret', model: 'synthetic', messages: [{ role: 'user', content: 'test' }] } }, response: { status: 200 } },
      { method: 'POST', path: '/api/event_logging/v2/batch', timestamp: '2026-08-02T15:38:14.000Z', request: { body: { model: 'synthetic', messages: [] } }, response: { status: 200 } },
      { method: 'GET', path: '/anthropic/v1/messages', timestamp: '2026-08-02T15:38:15.000Z', request: { body: { model: 'synthetic', messages: [] } }, response: { status: 200 } },
      { method: 'POST', path: '/anthropic/v1/messages', timestamp: '2026-08-02T15:38:16.000Z', request: { body: { messages: [] } }, response: { status: 200 } },
    ],
  }));

  const exported = exportAnnotationDirectory({ sessionDir, outputRoot, folderName: 'task-001' });
  assert.equal(exported.trajectoryFiles.length, 2);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(exported.path, 'manifest.json'), 'utf8')), MANIFEST_TEMPLATE);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(exported.path, 'env', 'env_snapshot.json'), 'utf8')), {});
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(exported.path, 'qc', 'qc_report.json'), 'utf8')), {});
  assert.equal(fs.readFileSync(path.join(exported.path, 'task', 'prompt.md'), 'utf8'), '');
  for (const relative of ['task/assets', 'screenshots', 'workspace/src', 'workspace/dist']) {
    assert.equal(fs.statSync(path.join(exported.path, relative)).isDirectory(), true);
  }
  assert.match(exported.trajectoryFiles[0], /^20260802T153813842Z_apicall\.json$/);
  assert.match(exported.trajectoryFiles[1], /^20260802T153813842Z_002_apicall\.json$/);
  const first = JSON.parse(fs.readFileSync(path.join(exported.path, 'trajectory', exported.trajectoryFiles[0]), 'utf8'));
  const second = JSON.parse(fs.readFileSync(path.join(exported.path, 'trajectory', exported.trajectoryFiles[1]), 'utf8'));
  assert.equal(first.request.headers.authorization, '[REDACTED]');
  assert.equal(second.request.body.api_key, '[REDACTED]');
});

test('Anthropic model call detection excludes telemetry and non-model traffic', () => {
  assert.equal(isAnthropicModelCall({ method: 'POST', path: '/anthropic/v1/messages', request: { body: { model: 'm', messages: [] } } }), true);
  assert.equal(isAnthropicModelCall({ method: 'POST', path: '/api/event_logging/v2/batch', request: { body: { model: 'm', messages: [] } } }), false);
  assert.equal(isAnthropicModelCall({ method: 'GET', path: '/anthropic/v1/messages', request: { body: { model: 'm', messages: [] } } }), false);
  assert.equal(isAnthropicModelCall({ method: 'POST', path: '/anthropic/v1/messages', request: { body: { messages: [] } } }), false);
});

test('annotation export does not overwrite an existing target directory', (t) => {
  const root = tempDir(t);
  const sessionDir = path.join(root, 'session');
  const outputRoot = path.join(root, 'exports');
  fs.mkdirSync(sessionDir);
  fs.mkdirSync(path.join(outputRoot, 'task-001'), { recursive: true });
  assert.throws(
    () => exportAnnotationDirectory({ sessionDir, outputRoot, folderName: 'task-001' }),
    /目标目录已存在/,
  );
});

test('annotation export embeds the raw SSE trace with signature and reports completeness', async (t) => {
  const root = tempDir(t);
  const sessionDir = path.join(root, 'session');
  const outputRoot = path.join(root, 'exports');
  fs.mkdirSync(sessionDir);
  const timestamp = '2026-08-05T07:39:09.101Z';
  const capture = createRawApiCallCapture({
    sessionDir,
    callId: 1,
    timestamp,
    request: { method: 'POST', path: '/v1/messages', body: { model: 'synthetic', messages: [], api_key: 'secret' } },
  });
  capture.response(200, { 'content-type': 'text/event-stream' });
  capture.pushSSE(Buffer.from('data: {"type":"content_block_delta","index":0,"delta":{"type":"signature_delta","signature":"exported-signature"}}\n\n'));
  capture.pushSSE(Buffer.from('data: {"type":"message_stop"}\n\n'));
  const rawCapture = await capture.finish({ complete: true });
  fs.writeFileSync(path.join(sessionDir, 'https-intercepts.json'), JSON.stringify({ data: [{
    id: 1,
    method: 'POST',
    path: '/v1/messages',
    timestamp,
    request: { body: { model: 'synthetic', messages: [] } },
    response: { status: 200, captureComplete: true, rawCapture, parsed: { signature: 'exported-signature', signatureStatus: 'present' } },
  }] }));
  const exported = exportAnnotationDirectory({ sessionDir, outputRoot, folderName: 'raw-task' });
  assert.deepEqual(exported.trajectorySummary, { total: 1, rawCaptured: 1, complete: 1, incomplete: 0, incompleteCallIds: [], withSignature: 1 });
  const trajectory = JSON.parse(fs.readFileSync(path.join(exported.path, 'trajectory', exported.trajectoryFiles[0]), 'utf8'));
  assert.equal(trajectory.rawTrajectory.complete, true);
  assert.equal(trajectory.rawTrajectory.events.some((event) => event.data?.delta?.signature === 'exported-signature'), true);
  assert.equal(trajectory.rawTrajectory.events[0].request.body.api_key, '[REDACTED]');
});

test('annotation export applies the configured recording intercept window', (t) => {
  const root = tempDir(t);
  const sessionDir = path.join(root, 'session');
  const outputRoot = path.join(root, 'exports');
  fs.mkdirSync(sessionDir);
  const makeRecord = (id) => ({ id, method: 'POST', path: '/v1/messages', timestamp: `2026-08-05T07:39:0${id}.000Z`, request: { body: { model: 'synthetic', messages: [] } }, response: { status: 200 } });
  fs.writeFileSync(path.join(sessionDir, 'https-intercepts.json'), JSON.stringify({ data: [makeRecord(1), makeRecord(2), makeRecord(3)] }));
  fs.writeFileSync(path.join(sessionDir, 'config.json'), JSON.stringify({ recording: { startedAt: '2026-08-05T07:39:01.500Z', startInterceptId: 1, endInterceptId: 2 } }));
  const exported = exportAnnotationDirectory({ sessionDir, outputRoot, folderName: 'window-task' });
  assert.equal(exported.trajectoryFiles.length, 1);
  const trajectory = JSON.parse(fs.readFileSync(path.join(exported.path, 'trajectory', exported.trajectoryFiles[0]), 'utf8'));
  assert.equal(trajectory.id, 2);
});

test('annotation export warns about legacy zstd captures with zero SSE events', (t) => {
  const root = tempDir(t);
  const sessionDir = path.join(root, 'session');
  const outputRoot = path.join(root, 'exports');
  const rawDir = path.join(sessionDir, 'raw', 'api-calls');
  fs.mkdirSync(rawDir, { recursive: true });
  const rawFile = 'raw/api-calls/legacy-zstd.jsonl';
  fs.writeFileSync(path.join(sessionDir, rawFile), [
    JSON.stringify({ type: 'request', request: { body: { model: 'synthetic', messages: [] } } }),
    JSON.stringify({ type: 'response_headers', status: 200, headers: { 'content-encoding': 'zstd' } }),
    JSON.stringify({ type: 'end', complete: true, eventCount: 0 }),
    '',
  ].join('\n'));
  fs.writeFileSync(path.join(sessionDir, 'https-intercepts.json'), JSON.stringify({ data: [{
    id: 7,
    method: 'POST',
    path: '/compatible/v1/messages',
    timestamp: '2026-08-05T09:19:05.706Z',
    request: { body: { model: 'synthetic', messages: [] } },
    response: {
      status: 200,
      streaming: true,
      headers: { 'content-encoding': 'zstd' },
      rawCapture: { version: 1, file: rawFile, complete: true, eventCount: 0 },
    },
  }] }));
  const exported = exportAnnotationDirectory({ sessionDir, outputRoot, folderName: 'legacy-zstd-task' });
  assert.equal(exported.trajectorySummary.incomplete, 1);
  assert.deepEqual(exported.trajectorySummary.incompleteCallIds, [7]);
  const trajectory = JSON.parse(fs.readFileSync(path.join(exported.path, 'trajectory', exported.trajectoryFiles[0]), 'utf8'));
  assert.equal(trajectory.rawTrajectory.complete, false);
  assert.equal(trajectory.rawTrajectory.contentEncoding, 'zstd');
  assert.match(trajectory.rawTrajectory.error, /未包含有效 data 事件/);
});
