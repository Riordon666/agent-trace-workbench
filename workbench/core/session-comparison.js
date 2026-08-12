const SOURCE_PRIORITY = ['agent-history', 'proxy', 'gateway'];

const METRIC_DEFINITIONS = [
  { key: 'duration_ms', label: 'Duration', unit: 'ms' },
  { key: 'input_tokens', label: 'Input Tokens', unit: 'tokens' },
  { key: 'output_tokens', label: 'Output Tokens', unit: 'tokens' },
  { key: 'tool_calls', label: 'Tool Calls', unit: 'count' },
  { key: 'files_read', label: 'Files Read', unit: 'count' },
  { key: 'files_edited', label: 'Files Edited', unit: 'count' },
  { key: 'failed_commands', label: 'Failed Commands', unit: 'count' },
  { key: 'retry_signals', label: 'Retry Signals', unit: 'count' },
  { key: 'requests', label: 'Requests', unit: 'count' },
  { key: 'errors', label: 'Errors', unit: 'count' },
];

function selectCanonicalEvents(events) {
  const available = new Set(events.map((event) => event.source || 'unknown'));
  const source = SOURCE_PRIORITY.find((candidate) => available.has(candidate)) || [...available][0] || 'unavailable';
  return { source, events: events.filter((event) => (event.source || 'unknown') === source) };
}

function summarizeSession(events, metadata = {}) {
  const input = Array.isArray(events) ? events : [];
  const canonical = selectCanonicalEvents(input);
  const selected = canonical.events;
  const usageSelection = selectMetricEvents(input, canonical.source, ['usage']);
  const toolSelection = selectMetricEvents(input, canonical.source, ['tool_call', 'tool_result']);
  const errorSelection = selectMetricEvents(input, canonical.source, ['error']);
  const usage = summarizeUsage(usageSelection.events);
  const toolStats = summarizeTools(toolSelection.events);
  const timestamps = selected.map((event) => new Date(event.timestamp).getTime()).filter(Number.isFinite);
  const durationFromEvents = timestamps.length > 1 ? Math.max(...timestamps) - Math.min(...timestamps) : 0;
  const explicitDuration = selected
    .filter((event) => event.event_type === 'request_end')
    .reduce((total, event) => total + nonNegativeNumber(event.content?.duration_ms), 0);
  const requestIds = new Set(selected.map((event) => event.request_id).filter(Boolean));
  const models = [...new Set(selected.map((event) => event.model).filter(Boolean))];
  const agents = [...new Set(selected.map((event) => event.agent).filter((value) => value && value !== 'unknown'))];
  const providers = [...new Set(selected.map((event) => event.provider).filter((value) => value && value !== 'unknown'))];
  const metricSources = {
    timeline: canonical.source,
    usage: usageSelection.source,
    tools: toolSelection.source,
    errors: errorSelection.source,
  };

  return {
    session_id: String(metadata.id || input[0]?.session_id || ''),
    name: String(metadata.name || metadata.id || input[0]?.session_id || ''),
    source: canonical.source,
    event_count: selected.length,
    all_event_count: input.length,
    agents,
    providers,
    models,
    reasoning: input.some((event) => event.event_type === 'reasoning') ? 'available' : 'unavailable',
    metrics: {
      duration_ms: Math.round(durationFromEvents || explicitDuration),
      input_tokens: usage.input_tokens,
      output_tokens: usage.output_tokens,
      tool_calls: toolStats.tool_calls,
      files_read: toolStats.files_read.length,
      files_edited: toolStats.files_edited.length,
      failed_commands: toolStats.failed_commands,
      retry_signals: toolStats.retry_signals + retryableErrors(errorSelection.events),
      requests: requestIds.size,
      errors: errorSelection.events.length,
    },
    details: {
      cached_input_tokens: usage.cached_input_tokens,
      reasoning_tokens: usage.reasoning_tokens,
      files_read: toolStats.files_read,
      files_edited: toolStats.files_edited,
      metric_sources: metricSources,
    },
    notes: [
      canonical.source === 'unavailable'
        ? 'No normalized events are available.'
        : `Metric sources: ${Object.entries(metricSources).map(([key, value]) => `${key}=${value}`).join(', ')}. Each category uses one source to avoid double counting.`,
      'File counts include only explicit paths observed in known read/edit tool inputs.',
      'Retry signals are observed retry markers or repeated failed tool calls, not inferred intent.',
    ],
  };
}

function selectMetricEvents(events, preferredSource, eventTypes) {
  const types = new Set(eventTypes);
  const sources = [preferredSource, ...SOURCE_PRIORITY, ...events.map((event) => event.source || 'unknown')]
    .filter((source, index, all) => source && all.indexOf(source) === index);
  for (const source of sources) {
    const matching = events.filter((event) => (event.source || 'unknown') === source && types.has(event.event_type));
    if (matching.length) return { source, events: matching };
  }
  return { source: 'unavailable', events: [] };
}

function compareSessions(left, right) {
  return {
    generated_at: new Date().toISOString(),
    left,
    right,
    rows: METRIC_DEFINITIONS.map((definition) => {
      const leftValue = nonNegativeNumber(left.metrics?.[definition.key]);
      const rightValue = nonNegativeNumber(right.metrics?.[definition.key]);
      const absolute = rightValue - leftValue;
      return {
        ...definition,
        left: leftValue,
        right: rightValue,
        delta: absolute,
        percent: leftValue ? (absolute / leftValue) * 100 : null,
      };
    }),
  };
}

function summarizeUsage(events) {
  const cumulative = events.map((event) => event.content?.total_token_usage || event.content?.total_usage).filter(Boolean);
  if (cumulative.length) return cumulative.reduce(maxUsage, emptyUsage());

  const requests = new Map();
  events.forEach((event, index) => {
    const key = event.request_id || `event:${index}`;
    requests.set(key, maxUsage(requests.get(key) || emptyUsage(), event.content || {}));
  });
  return [...requests.values()].reduce(sumUsage, emptyUsage());
}

function usageNumbers(value = {}) {
  const outputDetails = value.output_tokens_details || value.completion_tokens_details || {};
  const cacheCreation = value.cache_creation || {};
  const cacheWrite5m = nonNegativeNumber(value.cache_write_5m_tokens ?? cacheCreation.ephemeral_5m_input_tokens);
  const cacheWrite1h = nonNegativeNumber(value.cache_write_1h_tokens ?? cacheCreation.ephemeral_1h_input_tokens);
  const cacheWriteTotal = nonNegativeNumber(value.cache_write_tokens ?? value.cache_creation_input_tokens) || cacheWrite5m + cacheWrite1h;
  return {
    input_tokens: nonNegativeNumber(value.input_tokens ?? value.prompt_tokens),
    output_tokens: nonNegativeNumber(value.output_tokens ?? value.completion_tokens),
    cached_input_tokens: nonNegativeNumber(value.cached_input_tokens ?? value.cache_read_input_tokens ?? value.input_tokens_details?.cached_tokens ?? value.prompt_tokens_details?.cached_tokens),
    cache_write_tokens: cacheWriteTotal,
    cache_write_5m_tokens: cacheWrite5m,
    cache_write_1h_tokens: cacheWrite1h,
    cache_write_unknown_tokens: Math.max(0, cacheWriteTotal - cacheWrite5m - cacheWrite1h),
    reasoning_tokens: nonNegativeNumber(value.reasoning_output_tokens ?? outputDetails.reasoning_tokens),
  };
}

function emptyUsage() {
  return { input_tokens: 0, output_tokens: 0, cached_input_tokens: 0, cache_write_tokens: 0, cache_write_5m_tokens: 0, cache_write_1h_tokens: 0, cache_write_unknown_tokens: 0, reasoning_tokens: 0 };
}

function maxUsage(left, right) {
  const value = usageNumbers(right);
  return Object.fromEntries(Object.keys(left).map((key) => [key, Math.max(left[key] || 0, value[key] || 0)]));
}

function sumUsage(left, right) {
  return Object.fromEntries(Object.keys(left).map((key) => [key, (left[key] || 0) + (right[key] || 0)]));
}

function summarizeTools(events) {
  const calls = events.filter((event) => event.event_type === 'tool_call');
  const filesRead = new Set();
  const filesEdited = new Set();
  const callById = new Map();
  const failedFingerprints = new Set();
  let lastCall = null;
  let failedCommands = 0;
  let retrySignals = 0;

  for (const event of events) {
    if (event.event_type === 'tool_call') {
      const call = normalizeToolCall(event);
      lastCall = call;
      if (call.id) callById.set(call.id, call);
      if (failedFingerprints.has(call.fingerprint)) retrySignals++;
      const target = isEditTool(call.name) ? filesEdited : isReadTool(call.name) ? filesRead : null;
      if (target) extractPaths(call.input).forEach((file) => target.add(file));
      continue;
    }
    if (event.event_type !== 'tool_result') continue;
    const id = toolId(event.content);
    const call = (id && callById.get(id)) || lastCall;
    if (!call || !isCommandTool(call.name) || !isFailedResult(event.content)) continue;
    failedCommands++;
    failedFingerprints.add(call.fingerprint);
  }

  return {
    tool_calls: calls.length,
    files_read: [...filesRead].sort(),
    files_edited: [...filesEdited].sort(),
    failed_commands: failedCommands,
    retry_signals: retrySignals,
  };
}

function normalizeToolCall(event) {
  const content = event.content || {};
  const name = String(content.name || content.tool_name || content.tool || '').trim().toLowerCase();
  let input = content.input ?? content.arguments ?? {};
  if (typeof input === 'string') {
    try { input = JSON.parse(input); } catch {}
  }
  return {
    id: toolId(content),
    name,
    input,
    fingerprint: `${name}\u0000${stableStringify(input)}`,
  };
}

function toolId(content = {}) {
  return String(content.call_id || content.tool_use_id || content.id || '');
}

function isReadTool(name) {
  return /(^|[_.-])(read|view|open)([_.-]|$)|read_file|read_text_file|get_file/.test(name);
}

function isEditTool(name) {
  return /(^|[_.-])(edit|write|patch|create)([_.-]|$)|apply_patch|write_file|create_file/.test(name);
}

function isCommandTool(name) {
  return /shell|exec|command|terminal|powershell|bash|cmd|run_process/.test(name);
}

function extractPaths(input) {
  const paths = new Set();
  const visit = (value, key = '') => {
    if (typeof value === 'string') {
      if (/^(file_?path|path|filename|target_?file)$/i.test(key) && value.trim()) paths.add(value.trim());
      for (const match of value.matchAll(/^\*\*\* (?:Add|Update|Delete) File:\s*(.+)$/gm)) paths.add(match[1].trim());
      for (const match of value.matchAll(/^\+\+\+ b\/(.+)$/gm)) paths.add(match[1].trim());
      return;
    }
    if (Array.isArray(value)) return value.forEach((entry) => visit(entry, key));
    if (!value || typeof value !== 'object') return;
    Object.entries(value).forEach(([childKey, child]) => visit(child, childKey));
  };
  visit(input);
  return [...paths];
}

function isFailedResult(content = {}) {
  if (content.is_error === true || content.error || content.success === false) return true;
  const exitCode = content.exit_code ?? content.exitCode ?? content.code;
  if (Number.isFinite(Number(exitCode)) && Number(exitCode) !== 0) return true;
  if (/^(failed|error)$/i.test(String(content.status || ''))) return true;
  const output = typeof content === 'string' ? content : String(content.output ?? content.content ?? content.message ?? '');
  return /(?:exit(?:ed)?(?: with)? code|exit_code|process exited with code)\s*[:=]?\s*[1-9]\d*|command failed/i.test(output);
}

function retryableErrors(events) {
  return events.filter((event) => {
    if (event.event_type !== 'error') return false;
    const content = event.content || {};
    const status = Number(content.status || content.status_code || content.code);
    const message = String(content.message || content.error || '');
    return content.retryable === true || status === 429 || status >= 500 || /\bretr(?:y|ied|ying)\b|attempt\s+\d+/i.test(message);
  }).length;
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function nonNegativeNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

module.exports = {
  METRIC_DEFINITIONS,
  compareSessions,
  extractPaths,
  isFailedResult,
  nonNegativeNumber,
  normalizeToolCall,
  selectCanonicalEvents,
  selectMetricEvents,
  summarizeSession,
  summarizeTools,
  summarizeUsage,
  usageNumbers,
};
