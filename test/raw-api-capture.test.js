const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  SSEDecoder,
  createRawApiCallCapture,
  readRawApiCall,
} = require('../workbench/core/raw-api-capture');

function tempDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-trace-raw-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('SSE decoder preserves split UTF-8 data and multi-line SSE payloads', () => {
  const observed = [];
  const decoder = new SSEDecoder((event) => observed.push(event));
  const input = Buffer.from('event: message\ndata: {"text":"中文"}\n\ndata: [DONE]\n\n');
  decoder.push(input.subarray(0, 31));
  decoder.push(input.subarray(31, 32));
  decoder.push(input.subarray(32));
  decoder.end();
  assert.deepEqual(observed.map((event) => event.data), [{ text: '中文' }, '[DONE]']);
  assert.equal(observed[0].event, 'message');
});

test('raw API capture writes append-only SSE records, signature metadata and redacted secrets', async (t) => {
  const sessionDir = tempDir(t);
  const capture = createRawApiCallCapture({
    sessionDir,
    callId: 7,
    timestamp: '2026-08-05T07:39:09.101Z',
    request: {
      method: 'POST',
      path: '/v1/messages',
      headers: { authorization: 'Bearer test-secret' },
      body: { model: 'synthetic', messages: [], api_key: 'test-secret' },
    },
  });
  capture.response(200, { 'content-type': 'text/event-stream', 'x-api-key': 'response-secret' });
  capture.pushSSE(Buffer.from('data: {"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"reason"}}\n\n'));
  capture.pushSSE(Buffer.from('data: {"type":"content_block_delta","index":0,"delta":{"type":"signature_delta","signature":"opaque-signature"}}\n\n'));
  capture.pushSSE(Buffer.from('data: {"type":"message_stop"}\n\n'));
  const metadata = await capture.finish({ complete: true });
  assert.equal(metadata.complete, true);
  assert.equal(metadata.eventCount, 3);
  assert.equal(metadata.signatureDeltaCount, 1);
  assert.equal(metadata.thinkingDeltaCount, 1);
  const parsed = readRawApiCall(sessionDir, metadata.file);
  assert.equal(parsed.errors.length, 0);
  assert.equal(parsed.events[0].request.headers.authorization, '[REDACTED]');
  assert.equal(parsed.events[0].request.body.api_key, '[REDACTED]');
  assert.equal(parsed.events[1].headers['x-api-key'], '[REDACTED]');
  const signature = parsed.events.find((event) => event.data?.delta?.type === 'signature_delta');
  assert.equal(signature.data.delta.signature, 'opaque-signature');
  assert.equal(parsed.events.at(-1).complete, true);
});

test('raw API capture marks interrupted calls incomplete', async (t) => {
  const sessionDir = tempDir(t);
  const capture = createRawApiCallCapture({ sessionDir, callId: 8, timestamp: new Date().toISOString(), request: {} });
  capture.pushSSE(Buffer.from('data: {"type":"message_start"}\n\n'));
  const metadata = await capture.finish({ complete: false, error: 'synthetic disconnect' });
  assert.equal(metadata.complete, false);
  assert.equal(metadata.error, 'synthetic disconnect');
  const parsed = readRawApiCall(sessionDir, metadata.file);
  assert.equal(parsed.events.at(-1).complete, false);
  assert.equal(parsed.events.at(-1).error, 'synthetic disconnect');
});

test('raw API capture preserves a non-SSE response body as exact decoded bytes', async (t) => {
  const sessionDir = tempDir(t);
  const capture = createRawApiCallCapture({ sessionDir, callId: 9, timestamp: new Date().toISOString(), request: {} });
  capture.response(429, { 'content-type': 'application/json' });
  capture.pushBody(Buffer.from('{"error":"rate limited"}', 'utf8'));
  const metadata = await capture.finish({ complete: true });
  assert.equal(metadata.bodyChunkCount, 1);
  const parsed = readRawApiCall(sessionDir, metadata.file);
  const body = parsed.events.find((event) => event.type === 'response_body_chunk');
  assert.equal(Buffer.from(body.data, body.encoding).toString('utf8'), '{"error":"rate limited"}');
});

test('raw API capture rejects an SSE response with zero data events', async (t) => {
  const sessionDir = tempDir(t);
  const capture = createRawApiCallCapture({ sessionDir, callId: 10, timestamp: new Date().toISOString(), request: {} });
  capture.response(200, { 'content-type': 'text/event-stream', 'content-encoding': 'zstd' });
  const metadata = await capture.finish({ complete: true, expectSSE: true, contentEncoding: 'zstd', decoded: true });
  assert.equal(metadata.complete, false);
  assert.match(metadata.error, /未包含有效 data 事件/);
  assert.equal(metadata.contentEncoding, 'zstd');
});

test('raw API capture requires message_stop for Anthropic model streams', async (t) => {
  const sessionDir = tempDir(t);
  const capture = createRawApiCallCapture({ sessionDir, callId: 11, timestamp: new Date().toISOString(), request: {} });
  capture.pushSSE(Buffer.from('data: {"type":"message_start","message":{"id":"partial"}}\n\n'));
  const metadata = await capture.finish({ complete: true, expectSSE: true, expectMessageStop: true });
  assert.equal(metadata.complete, false);
  assert.equal(metadata.messageStartCount, 1);
  assert.equal(metadata.messageStopCount, 0);
  assert.match(metadata.error, /缺少 message_stop/);
});
