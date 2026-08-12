const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { createEvent } = require('../../core/event-schema');

const id = 'opencode';
const VIRTUAL_PREFIX = 'opencode-session:';

function detectFormat(value) {
  if (value && value.info && Array.isArray(value.messages)) return 'opencode-export-v1';
  return 'unknown';
}

function parseHistory(source, options = {}) {
  let text;
  let sourceSessionId = '';
  if (isVirtualHistorySource(source)) {
    sourceSessionId = virtualSessionId(source);
    const run = options.spawnSync || spawnSync;
    const result = run('opencode', ['export', sourceSessionId], {
      encoding: 'utf8', windowsHide: true, timeout: 30000, maxBuffer: 128 * 1024 * 1024,
    });
    if (result.error) throw new Error(`OpenCode export failed: ${result.error.message}`);
    if (result.status !== 0) throw new Error(`OpenCode export failed: ${String(result.stderr || '').trim() || `exit ${result.status}`}`);
    text = String(result.stdout || '');
  } else {
    text = fs.readFileSync(source, 'utf8');
  }
  let value;
  try { value = JSON.parse(text); } catch { throw new Error('Invalid OpenCode export JSON'); }
  if (detectFormat(value) === 'unknown') throw new Error('Unsupported OpenCode export format');
  return {
    info: value.info,
    messages: value.messages,
    sourceSessionId: sourceSessionId || String(value.info?.id || ''),
    formatVersion: 'opencode-export-v1',
    rawText: `${JSON.stringify(value, null, 2)}\n`,
    filePath: isVirtualHistorySource(source) ? '' : source,
  };
}

function historyToEvents(parsed, context = {}) {
  const info = parsed.info || {};
  const sessionId = context.session_id || info.id || '';
  const events = [];
  if (info.time?.created) events.push(createEvent({
    session_id: sessionId,
    request_id: '',
    agent: id,
    provider: info.model?.providerID || 'unknown',
    model: info.model?.id || '',
    event_type: 'session_start',
    timestamp: timestamp(info.time.created),
    content: { format_version: parsed.formatVersion, cli_version: info.version || '', title: info.title || '' },
    source: context.source || 'agent-history',
  }));

  const started = new Set();
  const ended = new Set();
  for (const message of parsed.messages || []) {
    const messageInfo = message.info || {};
    const parts = Array.isArray(message.parts) ? message.parts : [];
    const requestId = String(messageInfo.role === 'assistant' ? messageInfo.parentID || messageInfo.id || '' : messageInfo.id || '');
    const provider = messageInfo.providerID || messageInfo.model?.providerID || info.model?.providerID || context.provider || 'unknown';
    const model = messageInfo.modelID || messageInfo.model?.modelID || info.model?.id || context.model || '';
    const created = timestamp(messageInfo.time?.created || info.time?.updated || info.time?.created);
    const base = { session_id: sessionId, request_id: requestId, agent: id, provider, model, timestamp: created, source: context.source || 'agent-history' };

    if (messageInfo.role === 'user') {
      if (!started.has(requestId)) {
        events.push(createEvent({ ...base, event_type: 'request_start', content: { agent: messageInfo.agent || info.agent || '' } }));
        started.add(requestId);
      }
      const text = parts.filter((part) => part.type === 'text' && !part.ignored).map((part) => part.text || '').filter(Boolean).join('\n');
      if (text) events.push(createEvent({ ...base, event_type: 'user_message', content: { text } }));
      continue;
    }
    if (messageInfo.role !== 'assistant') continue;
    if (!started.has(requestId)) {
      events.push(createEvent({ ...base, event_type: 'request_start', content: { missing_user_message: true } }));
      started.add(requestId);
    }
    for (const part of parts) {
      const partTime = timestamp(part.time?.start || part.time?.created || messageInfo.time?.created || info.time?.updated);
      const partBase = { ...base, timestamp: partTime };
      if (part.type === 'reasoning' && String(part.text || '').trim()) {
        events.push(createEvent({ ...partBase, event_type: 'reasoning', content: {
          text: String(part.text), signature: part.metadata?.anthropic?.signature || null,
        } }));
      } else if (part.type === 'text' && String(part.text || '').trim()) {
        events.push(createEvent({ ...partBase, event_type: 'assistant_message', content: { text: String(part.text) } }));
      } else if (part.type === 'tool') {
        events.push(createEvent({ ...partBase, event_type: 'tool_call', content: {
          id: part.id || '', call_id: part.callID || '', name: part.tool || '', input: part.state?.input || {}, status: part.state?.status || '',
        } }));
        if (part.state?.status === 'completed' || part.state?.status === 'error') {
          const failed = part.state.status === 'error';
          events.push(createEvent({ ...partBase, timestamp: timestamp(part.state.time?.end || part.time?.end || partTime), event_type: 'tool_result', content: {
            id: part.id || '', call_id: part.callID || '', output: failed ? part.state.error || '' : part.state.output ?? null,
            status: failed ? 'error' : 'completed', success: !failed, error: failed ? part.state.error || 'Tool failed' : null,
          } }));
        }
      } else if (part.type === 'retry') {
        events.push(createEvent({ ...partBase, event_type: 'error', content: {
          message: errorText(part.error) || `OpenCode retry attempt ${part.attempt}`,
          retryable: true, attempt: part.attempt,
        } }));
      } else if (part.type === 'step-finish' && part.tokens) {
        events.push(createEvent({ ...partBase, event_type: 'usage', content: normalizeTokens(part.tokens) }));
      }
    }
    if (messageInfo.tokens) events.push(createEvent({ ...base, event_type: 'usage', content: normalizeTokens(messageInfo.tokens) }));
    if (messageInfo.error) events.push(createEvent({ ...base, event_type: 'error', content: {
      message: errorText(messageInfo.error) || 'OpenCode recorded an assistant error',
      cancelled: /abort/i.test(String(messageInfo.error.name || '')),
    } }));
    const completed = timestamp(messageInfo.time?.completed || messageInfo.time?.created || info.time?.updated);
    events.push(createEvent({ ...base, timestamp: completed, event_type: 'request_end', content: {
      complete: !messageInfo.error, finish: messageInfo.finish || null, cost: messageInfo.cost ?? null,
    } }));
    ended.add(requestId);
  }
  if (info.time?.updated || info.time?.created) events.push(createEvent({
    session_id: sessionId,
    request_id: '',
    agent: id,
    provider: info.model?.providerID || context.provider || 'unknown',
    model: info.model?.id || context.model || '',
    event_type: 'session_end',
    timestamp: timestamp(info.time?.updated || info.time?.created),
    content: { requests_started: started.size, requests_completed: ended.size },
    source: context.source || 'agent-history',
  }));
  return events;
}

function normalizeTokens(tokens = {}) {
  return {
    input_tokens: number(tokens.input),
    output_tokens: number(tokens.output),
    reasoning_output_tokens: number(tokens.reasoning),
    cached_input_tokens: number(tokens.cache?.read),
    cache_write_tokens: number(tokens.cache?.write),
    total_tokens: number(tokens.total),
  };
}

function discoverLocalSessions(options = {}) {
  const run = options.spawnSync || spawnSync;
  const result = run('opencode', ['session', 'list', '--format', 'json', '--max-count', '50'], {
    encoding: 'utf8', windowsHide: true, timeout: 10000, maxBuffer: 16 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) return [];
  let sessions;
  try { sessions = JSON.parse(String(result.stdout || '')); } catch { return []; }
  if (!Array.isArray(sessions)) return [];
  const version = detectInstalledVersion(run);
  return sessions.map((session) => ({
    path: `${VIRTUAL_PREFIX}${session.id}`,
    project: session.directory || session.projectId || '',
    sessionId: String(session.id || ''),
    title: String(session.title || ''),
    formatVersion: 'opencode-export-v1',
    agentVersion: version,
    model: '',
    provider: '',
    size: 0,
    mtime: optionalTimestamp(session.updated || session.created),
  })).filter((session) => session.sessionId);
}

function isVirtualHistorySource(source) {
  return String(source || '').startsWith(VIRTUAL_PREFIX);
}

function virtualSessionId(source) {
  const value = String(source || '').slice(VIRTUAL_PREFIX.length);
  if (!/^[A-Za-z0-9._-]+$/.test(value) || value === '.' || value === '..') throw new Error('Invalid OpenCode Session ID');
  return value;
}

function detectInstalledVersion(run = spawnSync) {
  const result = run('opencode', ['--version'], { encoding: 'utf8', windowsHide: true, timeout: 3000 });
  return result && !result.error && result.status === 0 ? String(result.stdout || '').trim() : '';
}

function classifyRequest(record = {}) {
  const value = record.info || record;
  if (value.role === 'user') return 'main';
  if (value.summary) return 'side-summary';
  return 'side-other';
}

function timestamp(value) {
  if (value === undefined || value === null || value === '') throw new Error('OpenCode record is missing a valid timestamp');
  if (typeof value === 'number' || /^\d+$/.test(String(value || ''))) {
    const numberValue = Number(value);
    const milliseconds = numberValue < 1e12 ? numberValue * 1000 : numberValue;
    const parsed = new Date(milliseconds);
    if (Number.isFinite(parsed.getTime())) return parsed.toISOString();
    throw new Error(`Invalid OpenCode timestamp: ${value}`);
  }
  const parsed = new Date(value);
  if (Number.isFinite(parsed.getTime())) return parsed.toISOString();
  throw new Error(`Invalid OpenCode timestamp: ${value}`);
}

function optionalTimestamp(value) {
  try { return timestamp(value); } catch { return ''; }
}

function number(value) {
  const result = Number(value || 0);
  return Number.isFinite(result) && result > 0 ? result : 0;
}

function errorText(value) {
  if (!value) return '';
  if (typeof value === 'string') return value;
  return String(value.message || value.data?.message || value.name || '');
}

const adapter = {
  id,
  displayName: 'OpenCode',
  protocols: ['multi-provider'],
  classifyRequest,
  detectFormat,
  detectInstalledVersion,
  discoverLocalSessions,
  historyFileName: 'opencode-export.json',
  historyToEvents,
  isVirtualHistorySource,
  parseHistory,
};

module.exports = { ...adapter, adapter, VIRTUAL_PREFIX, errorText, normalizeTokens, timestamp, virtualSessionId };
