const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { PassThrough } = require('node:stream');
const zlib = require('node:zlib');
const { createDecodedResponseStream, parseContentEncodings, supportedAcceptEncoding } = require('../workbench/core/response-decoder');
const { createRawApiCallCapture, readRawApiCall } = require('../workbench/core/raw-api-capture');

function chunks(buffer, size = 7) {
  const result = [];
  for (let offset = 0; offset < buffer.length; offset += size) result.push(buffer.subarray(offset, offset + size));
  return result;
}

async function decodeFixture(contentEncoding, compressed) {
  const source = new PassThrough();
  const raw = [];
  source.on('data', (chunk) => raw.push(chunk));
  const decoding = createDecodedResponseStream(source, contentEncoding);
  const decoded = [];
  const finished = new Promise((resolve, reject) => {
    decoding.stream.on('data', (chunk) => decoded.push(chunk));
    decoding.stream.once('end', resolve);
    decoding.stream.once('error', reject);
  });
  for (const chunk of chunks(compressed)) source.write(chunk);
  source.end();
  await finished;
  return { decoding, raw: Buffer.concat(raw), decoded: Buffer.concat(decoded) };
}

test('response decoder normalizes content-encoding values', () => {
  assert.deepEqual(parseContentEncodings(' GZip, BR, identity '), ['gzip', 'br']);
  assert.deepEqual(parseContentEncodings(''), []);
});

test('proxy advertises only encodings supported by the running Node.js version', () => {
  const advertised = supportedAcceptEncoding('gzip, deflate, br, zstd');
  assert.match(advertised, /gzip/);
  assert.match(advertised, /br/);
  if (typeof zlib.createZstdDecompress === 'function') assert.match(advertised, /zstd/);
  else assert.doesNotMatch(advertised, /zstd/);
});

test('response decoder supports available compression formats without altering forwarded bytes', async (t) => {
  const plaintext = Buffer.from('data: {"type":"message_start","message":{"id":"m-中文"}}\n\ndata: {"type":"message_stop"}\n\n');
  const fixtures = {
    gzip: zlib.gzipSync(plaintext),
    deflate: zlib.deflateSync(plaintext),
    br: zlib.brotliCompressSync(plaintext),
  };
  if (typeof zlib.zstdCompressSync === 'function') fixtures.zstd = zlib.zstdCompressSync(plaintext);
  for (const [encoding, compressed] of Object.entries(fixtures)) {
    await t.test(encoding, async () => {
      const result = await decodeFixture(encoding.toUpperCase(), compressed);
      assert.equal(result.decoding.error, '');
      assert.deepEqual(result.raw, compressed);
      assert.deepEqual(result.decoded, plaintext);
    });
  }
});

test('response decoder reports unknown content encodings without throwing', async () => {
  const source = new PassThrough();
  const decoding = createDecodedResponseStream(source, 'synthetic-encoding');
  assert.equal(decoding.stream, source);
  assert.equal(decoding.decoded, false);
  assert.match(decoding.error, /不支持的响应编码/);
  source.end();
});

test('response decoder surfaces corrupt zstd streams as capture errors', { skip: typeof zlib.createZstdDecompress !== 'function' }, async () => {
  const source = new PassThrough();
  const decoding = createDecodedResponseStream(source, 'zstd');
  const error = new Promise((resolve) => decoding.stream.once('error', resolve));
  source.end(Buffer.from('not-a-valid-zstd-stream'));
  const observed = await error;
  assert.ok(observed instanceof Error);
});

test('zstd decoding feeds thinking and signature events into the raw capture', { skip: typeof zlib.zstdCompressSync !== 'function' }, async (t) => {
  const sessionDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-trace-zstd-'));
  t.after(() => fs.rmSync(sessionDir, { recursive: true, force: true }));
  const rawSSE = [
    { type: 'message_start', message: { id: 'msg-zstd', model: 'claude-synthetic' } },
    { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'reason' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature: 'zstd-signature' } },
    { type: 'message_stop' },
  ].map((event) => `data: ${JSON.stringify(event)}\n\n`).join('');
  const compressed = zlib.zstdCompressSync(Buffer.from(rawSSE));
  const capture = createRawApiCallCapture({ sessionDir, callId: 12, timestamp: new Date().toISOString(), request: {} });
  const source = new PassThrough();
  const decoding = createDecodedResponseStream(source, 'zstd');
  const ended = new Promise((resolve, reject) => {
    decoding.stream.on('data', (chunk) => capture.pushSSE(chunk));
    decoding.stream.once('end', resolve);
    decoding.stream.once('error', reject);
  });
  for (const chunk of chunks(compressed, 3)) source.write(chunk);
  source.end();
  await ended;
  const metadata = await capture.finish({
    complete: true,
    expectSSE: true,
    expectMessageStop: true,
    contentEncoding: 'zstd',
    decoded: true,
  });
  assert.equal(metadata.complete, true);
  assert.equal(metadata.eventCount, 5);
  assert.equal(metadata.thinkingDeltaCount, 1);
  assert.equal(metadata.signatureDeltaCount, 1);
  assert.equal(metadata.messageStopCount, 1);
  const stored = readRawApiCall(sessionDir, metadata.file);
  assert.equal(stored.events.some((event) => event.data?.delta?.signature === 'zstd-signature'), true);
});
