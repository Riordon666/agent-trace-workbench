const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { createEvent } = require('../../core/event-schema');

const id = 'gemini-cli';

function geminiRoot(env = process.env, homeDir = os.homedir()) {
  return path.join(env.GEMINI_CLI_HOME || homeDir, '.gemini');
}

function detectFormat(value) {
  if (value && !Array.isArray(value) && Array.isArray(value.messages)) return 'gemini-json-v0';
  if (value?.records?.some((record) => record && (record.$set || record.$rewindTo || record.id))) return 'gemini-jsonl-v1';
  return 'unknown';
}

function parseHistory(filePath) {
  const text = fs.readFileSync(filePath, 'utf8');
  try {
    const legacy = JSON.parse(text);
    if (legacy && Array.isArray(legacy.messages)) {
      return { metadata: metadataFrom(legacy), messages: legacy.messages, errors: [], formatVersion: 'gemini-json-v0', filePath };
    }
  } catch {}

  const records = [];
  const errors = [];
  text.split(/\r?\n/).forEach((line, index) => {
    if (!line.trim()) return;
    try { records.push(JSON.parse(line)); } catch (error) { errors.push({ line: index + 1, message: error.message }); }
  });
  const metadata = {};
  const messages = new Map();
  for (const record of records) {
    if (record && typeof record.$rewindTo === 'string') {
      rewindMessages(messages, record.$rewindTo);
    } else if (record?.$set && typeof record.$set === 'object') {
      Object.assign(metadata, record.$set);
    } else if (record && typeof record.id === 'string') {
      messages.set(record.id, record);
    } else if (record && typeof record.sessionId === 'string' && typeof record.projectHash === 'string') {
      Object.assign(metadata, record);
    }
  }
  return { metadata: metadataFrom(metadata), messages: [...messages.values()], records, errors, formatVersion: detectFormat({ records }), filePath };
}

function rewindMessages(messages, rewindId) {
  const ids = [...messages.keys()];
  const index = ids.indexOf(rewindId);
  if (index === -1) return messages.clear();
  ids.slice(index).forEach((messageId) => messages.delete(messageId));
}

function metadataFrom(value = {}) {
  return {
    sessionId: String(value.sessionId || ''),
    projectHash: String(value.projectHash || ''),
    startTime: value.startTime || null,
    lastUpdated: value.lastUpdated || null,
    summary: String(value.summary || ''),
    kind: value.kind || 'main',
    directories: Array.isArray(value.directories) ? value.directories.map(String) : [],
  };
}

function historyToEvents(parsed, context = {}) {
  const data = Array.isArray(parsed) ? { metadata: {}, messages: parsed } : parsed;
  const metadata = data.metadata || {};
  const sessionId = context.session_id || metadata.sessionId || '';
  const events = [];
  if (metadata.startTime) events.push(createEvent({
    session_id: sessionId,
    request_id: '',
    agent: id,
    provider: 'google',
    model: '',
    event_type: 'session_start',
    timestamp: metadata.startTime,
    content: { format_version: data.formatVersion || 'unknown', project_hash: metadata.projectHash || '', kind: metadata.kind || 'main' },
    source: context.source || 'agent-history',
  }));

  let requestId = '';
  const started = new Set();
  const ended = new Set();
  for (const message of data.messages || []) {
    const timestamp = message.timestamp || metadata.lastUpdated || metadata.startTime;
    if (!timestamp) continue;
    if (message.type === 'user') {
      requestId = String(message.id || requestId || '');
      if (requestId && !started.has(requestId)) {
        events.push(eventFor(message, context, metadata, requestId, 'request_start', { inferred_from_message_sequence: true }, timestamp));
        started.add(requestId);
      }
      const text = textFromParts(message.displayContent ?? message.content);
      if (text) events.push(eventFor(message, context, metadata, requestId, 'user_message', { text }, timestamp));
      continue;
    }
    if (message.type === 'error') {
      const errorRequestId = requestId || String(message.id || '');
      if (errorRequestId && !started.has(errorRequestId)) {
        events.push(eventFor(message, context, metadata, errorRequestId, 'request_start', { inferred_from_message_sequence: true, missing_user_message: true }, timestamp));
        started.add(errorRequestId);
      }
      events.push(eventFor(message, context, metadata, errorRequestId, 'error', { message: textFromParts(message.content) || 'Gemini CLI recorded an error' }, timestamp));
      if (errorRequestId && !ended.has(errorRequestId)) {
        events.push(eventFor(message, context, metadata, errorRequestId, 'request_end', { complete: false, inferred_from_message_sequence: true }, timestamp));
        ended.add(errorRequestId);
      }
      continue;
    }
    if (message.type !== 'gemini') continue;
    const model = String(message.model || context.model || '');
    const assistantRequestId = requestId || String(message.id || '');
    if (assistantRequestId && !started.has(assistantRequestId)) {
      events.push(eventFor(message, context, metadata, assistantRequestId, 'request_start', { inferred_from_message_sequence: true, missing_user_message: true }, timestamp, model));
      started.add(assistantRequestId);
    }
    for (const thought of message.thoughts || []) {
      const text = [thought.subject, thought.description].filter(Boolean).join('\n').trim();
      if (text) events.push(eventFor(message, context, metadata, assistantRequestId, 'reasoning', { text, kind: 'summary' }, thought.timestamp || timestamp, model));
    }
    for (const tool of message.toolCalls || []) {
      events.push(eventFor(message, context, metadata, assistantRequestId, 'tool_call', {
        id: tool.id || '', call_id: tool.id || '', name: tool.name || tool.displayName || '', input: tool.args || {}, status: tool.status || '',
      }, tool.timestamp || timestamp, model));
      if (tool.result !== undefined || /^(?:success|error|failed)$/i.test(String(tool.status || ''))) {
        const failed = /^(?:error|failed)$/i.test(String(tool.status || ''));
        events.push(eventFor(message, context, metadata, assistantRequestId, 'tool_result', {
          id: tool.id || '', call_id: tool.id || '', output: textFromParts(tool.result) || tool.result || null,
          status: failed ? 'error' : String(tool.status || 'completed'), success: !failed,
        }, tool.timestamp || timestamp, model));
      }
    }
    const text = textFromParts(message.displayContent ?? message.content);
    if (text) events.push(eventFor(message, context, metadata, assistantRequestId, 'assistant_message', { text }, timestamp, model));
    if (message.tokens) events.push(eventFor(message, context, metadata, assistantRequestId, 'usage', normalizeTokens(message.tokens), timestamp, model));
    if (assistantRequestId && !ended.has(assistantRequestId)) {
      events.push(eventFor(message, context, metadata, assistantRequestId, 'request_end', { complete: true, inferred_from_message_sequence: true }, timestamp, model));
      ended.add(assistantRequestId);
    }
  }
  if (metadata.lastUpdated) events.push(createEvent({
    session_id: sessionId,
    request_id: '',
    agent: id,
    provider: context.provider || 'google',
    model: '',
    event_type: 'session_end',
    timestamp: metadata.lastUpdated,
    content: { inferred_from_history_snapshot: true, requests_started: started.size, requests_completed: ended.size },
    source: context.source || 'agent-history',
  }));
  return events;
}

function eventFor(message, context, metadata, requestId, eventType, content, timestamp, model = '') {
  return createEvent({
    session_id: context.session_id || metadata.sessionId || '',
    request_id: String(requestId || ''),
    agent: id,
    provider: context.provider || 'google',
    model: model || String(message.model || context.model || ''),
    event_type: eventType,
    timestamp,
    content,
    source: context.source || 'agent-history',
  });
}

function normalizeTokens(tokens = {}) {
  return {
    input_tokens: number(tokens.input),
    output_tokens: number(tokens.output),
    cached_input_tokens: number(tokens.cached),
    reasoning_output_tokens: number(tokens.thoughts),
    tool_input_tokens: number(tokens.tool),
    total_tokens: number(tokens.total),
  };
}

function textFromParts(content) {
  if (content === null || content === undefined) return '';
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return typeof content.text === 'string' ? content.text : '';
  return content.map((part) => {
    if (typeof part === 'string') return part;
    if (typeof part?.text === 'string') return part.text;
    if (part?.functionResponse) return JSON.stringify(part.functionResponse.response ?? part.functionResponse);
    return '';
  }).filter(Boolean).join('\n');
}

function discoverLocalSessions(options = {}) {
  const env = options.env || process.env;
  const root = path.join(geminiRoot(env, options.homeDir || os.homedir()), 'tmp');
  if (!fs.existsSync(root)) return [];
  const version = detectInstalledVersion(options.spawnSync || spawnSync);
  const files = [];
  for (const project of fs.readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isDirectory())) {
    const chats = path.join(root, project.name, 'chats');
    if (!fs.existsSync(chats)) continue;
    for (const entry of fs.readdirSync(chats, { withFileTypes: true })) {
      if (!entry.isFile() || !/^session-.*\.jsonl?$/i.test(entry.name)) continue;
      const file = path.join(chats, entry.name);
      const stat = fs.statSync(file);
      let head = {};
      try { head = readHistoryHead(file); } catch {}
      if (head.kind === 'subagent') continue;
      files.push({
        path: file,
        project: project.name,
        sessionId: head.sessionId || path.basename(file).replace(/\.jsonl?$/i, ''),
        formatVersion: head.formatVersion || 'unknown',
        agentVersion: version,
        model: head.model || '',
        provider: 'google',
        size: stat.size,
        mtime: stat.mtime.toISOString(),
      });
    }
  }
  return files.sort((a, b) => new Date(b.mtime) - new Date(a.mtime)).slice(0, 50);
}

function readHistoryHead(file) {
  const size = Math.min(fs.statSync(file).size, 256 * 1024);
  const fd = fs.openSync(file, 'r');
  try {
    const buffer = Buffer.alloc(size);
    fs.readSync(fd, buffer, 0, size, 0);
    const lines = buffer.toString('utf8').split(/\r?\n/).filter(Boolean);
    const records = lines.map((line) => { try { return JSON.parse(line); } catch { return null; } }).filter(Boolean);
    const metadata = records.find((record) => record.sessionId && record.projectHash) || {};
    const gemini = records.find((record) => record.type === 'gemini') || {};
    return { ...metadataFrom(metadata), model: gemini.model || '', formatVersion: detectFormat({ records }) };
  } finally { fs.closeSync(fd); }
}

function detectInstalledVersion(run = spawnSync) {
  const result = run('gemini', ['--version'], { encoding: 'utf8', windowsHide: true, timeout: 3000 });
  return result && !result.error && result.status === 0 ? String(result.stdout || '').trim() : '';
}

function classifyRequest(record = {}) {
  const body = record.request?.body || record.body || record;
  const text = textFromParts(body.contents?.at?.(-1)?.parts || body.contents?.at?.(-1));
  if (/summari[sz]e|conversation summary|recap/i.test(text)) return 'side-summary';
  if (Array.isArray(body.contents)) return 'main';
  return 'side-other';
}

function number(value) {
  const result = Number(value || 0);
  return Number.isFinite(result) && result > 0 ? result : 0;
}

const adapter = {
  id,
  displayName: 'Gemini CLI',
  protocols: ['google-generative-ai'],
  classifyRequest,
  detectFormat,
  detectInstalledVersion,
  discoverLocalSessions,
  geminiRoot,
  historyFileName: 'gemini-history.jsonl',
  historyToEvents,
  parseHistory,
};

module.exports = { ...adapter, adapter, metadataFrom, normalizeTokens, textFromParts };
