const fs = require('fs');
const path = require('path');
const { StringDecoder } = require('string_decoder');
const { redactCredentials, redactHeaders } = require('./redaction');

const RAW_CAPTURE_VERSION = 1;
const RAW_CALLS_RELATIVE_DIR = path.join('raw', 'api-calls');

function safeTimestamp(value) {
  const date = new Date(value || Date.now());
  const valid = Number.isNaN(date.getTime()) ? new Date() : date;
  return valid.toISOString().replace(/[-:.]/g, '');
}

function rawCallFilename(timestamp, callId) {
  return `${safeTimestamp(timestamp)}_${String(callId).padStart(6, '0')}_apicall.jsonl`;
}

class SSEDecoder {
  constructor(onEvent) {
    this.onEvent = onEvent;
    this.decoder = new StringDecoder('utf8');
    this.buffer = '';
    this.lines = [];
  }

  push(chunk) {
    this.buffer += this.decoder.write(chunk);
    this.#consumeLines(false);
  }

  end() {
    this.buffer += this.decoder.end();
    this.#consumeLines(true);
    this.#dispatch();
  }

  #consumeLines(flush) {
    let newline;
    while ((newline = this.buffer.indexOf('\n')) >= 0) {
      let line = this.buffer.slice(0, newline);
      this.buffer = this.buffer.slice(newline + 1);
      if (line.endsWith('\r')) line = line.slice(0, -1);
      if (line === '') this.#dispatch();
      else this.lines.push(line);
    }
    if (flush && this.buffer) {
      const line = this.buffer.endsWith('\r') ? this.buffer.slice(0, -1) : this.buffer;
      this.buffer = '';
      if (line) this.lines.push(line);
    }
  }

  #dispatch() {
    if (!this.lines.length) return;
    const lines = this.lines;
    this.lines = [];
    let event = '';
    let id = '';
    const dataLines = [];
    for (const line of lines) {
      if (line.startsWith(':')) continue;
      const colon = line.indexOf(':');
      const field = colon < 0 ? line : line.slice(0, colon);
      let value = colon < 0 ? '' : line.slice(colon + 1);
      if (value.startsWith(' ')) value = value.slice(1);
      if (field === 'event') event = value;
      else if (field === 'id') id = value;
      else if (field === 'data') dataLines.push(value);
    }
    if (!dataLines.length) return;
    const payload = dataLines.join('\n');
    let data = payload;
    if (payload !== '[DONE]') {
      try { data = JSON.parse(payload); } catch {}
    }
    this.onEvent({ event, id, data, raw: lines.join('\n') });
  }
}

function createRawApiCallCapture({ sessionDir, callId, timestamp, request }) {
  const relativeDir = RAW_CALLS_RELATIVE_DIR;
  const directory = path.join(sessionDir, relativeDir);
  fs.mkdirSync(directory, { recursive: true });
  const filename = rawCallFilename(timestamp, callId);
  const relativePath = path.join(relativeDir, filename).split(path.sep).join('/');
  const file = path.join(directory, filename);
  const stream = fs.createWriteStream(file, { flags: 'a', encoding: 'utf8' });
  let writeError = '';
  let ended = false;
  let eventCount = 0;
  let signatureDeltaCount = 0;
  let thinkingDeltaCount = 0;
  let bodyChunkCount = 0;
  let messageStartCount = 0;
  let messageStopCount = 0;
  let bytesWritten = 0;
  let sequence = 0;

  stream.on('error', (error) => { writeError = error.message; });

  function append(value) {
    if (ended || writeError) return;
    const line = `${JSON.stringify(value)}\n`;
    bytesWritten += Buffer.byteLength(line);
    stream.write(line);
  }

  append({
    version: RAW_CAPTURE_VERSION,
    type: 'request',
    sequence: sequence++,
    timestamp,
    callId,
    request: redactCredentials(request),
  });

  const decoder = new SSEDecoder((sseEvent) => {
    eventCount++;
    if (sseEvent.data?.type === 'message_start') messageStartCount++;
    if (sseEvent.data?.type === 'message_stop') messageStopCount++;
    if (sseEvent.data?.type === 'content_block_delta') {
      if (sseEvent.data.delta?.type === 'signature_delta') signatureDeltaCount++;
      if (sseEvent.data.delta?.type === 'thinking_delta') thinkingDeltaCount++;
    }
    append({
      version: RAW_CAPTURE_VERSION,
      type: 'sse',
      sequence: sequence++,
      receivedAt: new Date().toISOString(),
      ...sseEvent,
    });
  });

  return {
    file,
    relativePath,
    response(status, headers) {
      append({
        version: RAW_CAPTURE_VERSION,
        type: 'response_headers',
        sequence: sequence++,
        receivedAt: new Date().toISOString(),
        status,
        headers: redactHeaders(headers),
      });
    },
    pushSSE(chunk) {
      if (!ended) decoder.push(chunk);
    },
    pushBody(chunk) {
      if (ended) return;
      bodyChunkCount++;
      append({
        version: RAW_CAPTURE_VERSION,
        type: 'response_body_chunk',
        sequence: sequence++,
        receivedAt: new Date().toISOString(),
        encoding: 'base64',
        data: Buffer.from(chunk).toString('base64'),
      });
    },
    async finish({
      complete,
      error = '',
      expectSSE = false,
      expectMessageStop = false,
      contentEncoding = '',
      decoded = false,
    }) {
      if (ended) return null;
      decoder.end();
      let effectiveError = error || writeError;
      if (!effectiveError && expectSSE && eventCount === 0) effectiveError = 'SSE 响应未包含有效 data 事件';
      if (!effectiveError && expectMessageStop && messageStopCount === 0) effectiveError = 'SSE 响应缺少 message_stop';
      const effectiveComplete = Boolean(complete) && !effectiveError;
      append({
        version: RAW_CAPTURE_VERSION,
        type: 'end',
        sequence: sequence++,
        receivedAt: new Date().toISOString(),
        complete: effectiveComplete,
        error: effectiveError,
        contentEncoding: String(contentEncoding || '').trim().toLowerCase(),
        decoded: Boolean(decoded),
        eventCount,
        signatureDeltaCount,
        thinkingDeltaCount,
        bodyChunkCount,
        messageStartCount,
        messageStopCount,
      });
      ended = true;
      await new Promise((resolve) => {
        if (stream.closed) {
          resolve();
          return;
        }
        stream.once('close', resolve);
        if (writeError) stream.destroy();
        else stream.end();
      });
      return {
        version: RAW_CAPTURE_VERSION,
        file: relativePath,
        complete: effectiveComplete && !writeError,
        error: effectiveError || writeError,
        contentEncoding: String(contentEncoding || '').trim().toLowerCase(),
        decoded: Boolean(decoded),
        eventCount,
        signatureDeltaCount,
        thinkingDeltaCount,
        bodyChunkCount,
        messageStartCount,
        messageStopCount,
        bytes: bytesWritten,
      };
    },
  };
}

function readRawApiCall(sessionDir, relativePath) {
  const root = path.resolve(sessionDir);
  const file = path.resolve(root, String(relativePath || ''));
  if (file === root || !file.startsWith(`${root}${path.sep}`)) throw new Error('原始轨迹路径超出 Session 目录');
  if (!fs.existsSync(file)) throw new Error(`原始轨迹文件不存在: ${relativePath}`);
  const events = [];
  const errors = [];
  fs.readFileSync(file, 'utf8').split(/\r?\n/).forEach((line, index) => {
    if (!line) return;
    try { events.push(JSON.parse(line)); } catch (error) { errors.push({ line: index + 1, message: error.message }); }
  });
  return { events, errors };
}

module.exports = {
  RAW_CAPTURE_VERSION,
  RAW_CALLS_RELATIVE_DIR,
  SSEDecoder,
  createRawApiCallCapture,
  rawCallFilename,
  readRawApiCall,
};
