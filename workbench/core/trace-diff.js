const {
  compareSessions,
  isFailedResult,
  normalizeToolCall,
  selectCanonicalEvents,
  selectMetricEvents,
  summarizeSession,
} = require('./session-comparison');

const DEFAULT_THRESHOLDS = Object.freeze({
  duration_percent: 20,
  duration_absolute_ms: 1000,
  errors_increase: 0,
  failed_commands_increase: 0,
  retry_signals_increase: 0,
  incomplete_requests_increase: 0,
});

function compareTraceEvents(leftEvents, rightEvents, options = {}) {
  const leftInput = Array.isArray(leftEvents) ? leftEvents : [];
  const rightInput = Array.isArray(rightEvents) ? rightEvents : [];
  const thresholds = normalizeThresholds(options.thresholds);
  const left = summarizeTrace(leftInput, options.left || {});
  const right = summarizeTrace(rightInput, options.right || {});
  const comparison = compareSessions(left.summary, right.summary);
  const regressions = detectRegressions(left, right, comparison.rows, thresholds);
  const eventTypes = compareCounts(left.event_types, right.event_types);
  const tools = compareTools(left.tools, right.tools);
  const identities = {
    agents: compareSets(left.summary.agents, right.summary.agents),
    providers: compareSets(left.summary.providers, right.summary.providers),
    models: compareSets(left.summary.models, right.summary.models),
  };
  const changed = comparison.rows.some((row) => row.delta !== 0)
    || eventTypes.some((row) => row.delta !== 0)
    || tools.some((row) => row.calls_delta !== 0 || row.failures_delta !== 0)
    || Object.values(identities).some((value) => value.added.length || value.removed.length)
    || left.requests.incomplete !== right.requests.incomplete
    || left.summary.reasoning !== right.summary.reasoning;

  return {
    schema_version: '1.0',
    status: regressions.length ? 'regression' : changed ? 'changed' : 'equivalent',
    generated_at: new Date().toISOString(),
    thresholds,
    left: publicTraceSummary(left),
    right: publicTraceSummary(right),
    rows: comparison.rows,
    event_types: eventTypes,
    tools,
    identities,
    regressions,
    notes: [
      'A regression is evidence-based: token or tool-count changes alone are reported but never classified as regressions.',
      'Duration regresses only when both the absolute and percentage thresholds are exceeded and the baseline duration is non-zero.',
      'Each metric category uses one normalized source to avoid double counting protocol capture and Agent History.',
    ],
  };
}

function summarizeTrace(events, metadata) {
  const summary = summarizeSession(events, metadata);
  const canonical = selectCanonicalEvents(events);
  const toolSelection = selectMetricEvents(events, canonical.source, ['tool_call', 'tool_result']);
  return {
    summary,
    event_types: countEventTypes(canonical.events),
    tools: summarizeToolNames(toolSelection.events),
    requests: summarizeRequestCompleteness(canonical.events),
  };
}

function publicTraceSummary(trace) {
  return { ...trace.summary, event_types: trace.event_types, requests: trace.requests, tools: trace.tools };
}

function normalizeThresholds(input = {}) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) throw new Error('Trace diff thresholds must be a JSON object');
  const unknown = Object.keys(input).filter((key) => !Object.hasOwn(DEFAULT_THRESHOLDS, key));
  if (unknown.length) throw new Error(`Unknown Trace diff threshold(s): ${unknown.join(', ')}`);
  const result = { ...DEFAULT_THRESHOLDS };
  for (const [key, value] of Object.entries(input)) {
    const number = Number(value);
    if (!Number.isFinite(number) || number < 0) throw new Error(`Trace diff threshold ${key} must be a non-negative number`);
    result[key] = number;
  }
  return result;
}

function detectRegressions(left, right, rows, thresholds) {
  const regressions = [];
  const row = (key) => rows.find((candidate) => candidate.key === key);
  addIncrease(regressions, row('errors'), thresholds.errors_increase, 'errors_increased', 'Observed error events increased.');
  addIncrease(regressions, row('failed_commands'), thresholds.failed_commands_increase, 'failed_commands_increased', 'Observed failed command results increased.');
  addIncrease(regressions, row('retry_signals'), thresholds.retry_signals_increase, 'retry_signals_increased', 'Observed retry signals increased.');

  const incompleteDelta = right.requests.incomplete - left.requests.incomplete;
  if (incompleteDelta > thresholds.incomplete_requests_increase) {
    regressions.push(regression('incomplete_requests_increased', 'incomplete_requests', left.requests.incomplete, right.requests.incomplete, incompleteDelta, null, 'Requests without a successful observed end increased.'));
  }

  if (left.summary.reasoning === 'available' && right.summary.reasoning === 'unavailable') {
    regressions.push(regression('reasoning_became_unavailable', 'reasoning', 'available', 'unavailable', null, null, 'Visible reasoning evidence present in A is unavailable in B.'));
  }

  const duration = row('duration_ms');
  if (duration.left > 0 && duration.delta > thresholds.duration_absolute_ms && duration.percent > thresholds.duration_percent) {
    regressions.push(regression('duration_increased', 'duration_ms', duration.left, duration.right, duration.delta, duration.percent, 'Duration exceeded both configured regression thresholds.'));
  }
  return regressions;
}

function addIncrease(output, row, allowance, code, reason) {
  if (row && row.delta > allowance) output.push(regression(code, row.key, row.left, row.right, row.delta, row.percent, reason));
}

function regression(code, metric, baseline, candidate, delta, percent, reason) {
  return { code, metric, baseline, candidate, delta, percent, reason };
}

function summarizeRequestCompleteness(events) {
  const requests = new Map();
  for (const event of events) {
    if (!event.request_id) continue;
    const request = requests.get(event.request_id) || { started: false, ended: false, successful: false };
    if (event.event_type === 'request_start') request.started = true;
    if (event.event_type === 'request_end') {
      request.ended = true;
      request.successful = event.content?.complete !== false && event.content?.success !== false;
    }
    requests.set(event.request_id, request);
  }
  const observed = [...requests.values()].filter((request) => request.started || request.ended);
  return {
    observed: observed.length,
    started: observed.filter((request) => request.started).length,
    ended: observed.filter((request) => request.ended).length,
    incomplete: observed.filter((request) => request.started && (!request.ended || !request.successful)).length,
  };
}

function summarizeToolNames(events) {
  const tools = {};
  const calls = new Map();
  let lastCall = null;
  for (const event of events) {
    if (event.event_type === 'tool_call') {
      const call = normalizeToolCall(event);
      const name = call.name || 'unknown';
      const entry = tools[name] || { calls: 0, failures: 0 };
      entry.calls += 1;
      tools[name] = entry;
      lastCall = { ...call, name };
      if (call.id) calls.set(call.id, lastCall);
      continue;
    }
    if (event.event_type !== 'tool_result' || !isFailedResult(event.content)) continue;
    const id = String(event.content?.call_id || event.content?.tool_use_id || event.content?.id || '');
    const call = (id && calls.get(id)) || lastCall;
    if (call) tools[call.name].failures += 1;
  }
  return Object.fromEntries(Object.entries(tools).sort(([left], [right]) => left.localeCompare(right)));
}

function countEventTypes(events) {
  const counts = {};
  for (const event of events) counts[event.event_type] = (counts[event.event_type] || 0) + 1;
  return Object.fromEntries(Object.entries(counts).sort(([left], [right]) => left.localeCompare(right)));
}

function compareCounts(left, right) {
  return [...new Set([...Object.keys(left), ...Object.keys(right)])].sort().map((key) => ({
    event_type: key,
    left: left[key] || 0,
    right: right[key] || 0,
    delta: (right[key] || 0) - (left[key] || 0),
  }));
}

function compareTools(left, right) {
  return [...new Set([...Object.keys(left), ...Object.keys(right)])].sort().map((name) => ({
    name,
    left_calls: left[name]?.calls || 0,
    right_calls: right[name]?.calls || 0,
    calls_delta: (right[name]?.calls || 0) - (left[name]?.calls || 0),
    left_failures: left[name]?.failures || 0,
    right_failures: right[name]?.failures || 0,
    failures_delta: (right[name]?.failures || 0) - (left[name]?.failures || 0),
  }));
}

function compareSets(left = [], right = []) {
  const before = new Set(left);
  const after = new Set(right);
  return {
    added: [...after].filter((value) => !before.has(value)).sort(),
    removed: [...before].filter((value) => !after.has(value)).sort(),
  };
}

module.exports = {
  DEFAULT_THRESHOLDS,
  compareTraceEvents,
  normalizeThresholds,
  summarizeRequestCompleteness,
  summarizeToolNames,
};

