const test = require('node:test');
const assert = require('node:assert/strict');
const { compareTraceEvents, normalizeThresholds } = require('../workbench/core/trace-diff');

function event(event_type, seconds, content = {}, overrides = {}) {
  return {
    schema_version: '1.0', session_id: 'synthetic', request_id: 'request-1', agent: 'synthetic-agent', provider: 'synthetic-provider',
    model: 'synthetic-model', event_type, timestamp: new Date(Date.UTC(2026, 0, 1, 0, 0, seconds)).toISOString(), content, source: 'agent-history', ...overrides,
  };
}

function baseline() {
  return [
    event('session_start', 0, {}, { request_id: '' }),
    event('request_start', 1),
    event('reasoning', 2, { text: 'visible synthetic summary' }),
    event('tool_call', 3, { call_id: 'call-1', name: 'shell', input: { command: 'echo synthetic' } }),
    event('tool_result', 4, { call_id: 'call-1', exit_code: 0, output: 'synthetic' }),
    event('usage', 5, { input_tokens: 10, output_tokens: 4 }),
    event('request_end', 6, { complete: true }),
    event('session_end', 7, {}, { request_id: '' }),
  ];
}

test('equivalent traces remain equivalent and token-only changes are not regressions', () => {
  const same = compareTraceEvents(baseline(), baseline());
  assert.equal(same.status, 'equivalent');
  assert.equal(same.regressions.length, 0);

  const candidate = baseline().map((entry) => entry.event_type === 'usage' ? { ...entry, content: { input_tokens: 25, output_tokens: 4 } } : entry);
  const changed = compareTraceEvents(baseline(), candidate);
  assert.equal(changed.status, 'changed');
  assert.equal(changed.regressions.length, 0);
});

test('trace diff reports evidence-based regressions and tool deltas', () => {
  const candidate = [
    event('session_start', 0, {}, { request_id: '' }),
    event('request_start', 1),
    event('tool_call', 3, { call_id: 'call-1', name: 'shell', input: { command: 'echo synthetic' } }),
    event('tool_result', 4, { call_id: 'call-1', exit_code: 1, output: 'command failed' }),
    event('tool_call', 5, { call_id: 'call-2', name: 'shell', input: { command: 'echo synthetic' } }),
    event('error', 6, { retryable: true, message: 'retry attempt 2' }),
    event('session_end', 12, {}, { request_id: '' }),
  ];
  const result = compareTraceEvents(baseline(), candidate);
  const codes = new Set(result.regressions.map((item) => item.code));
  assert.equal(result.status, 'regression');
  assert.deepEqual([...codes].sort(), [
    'duration_increased',
    'errors_increased',
    'failed_commands_increased',
    'incomplete_requests_increased',
    'reasoning_became_unavailable',
    'retry_signals_increased',
  ]);
  assert.deepEqual(result.tools.find((tool) => tool.name === 'shell'), {
    name: 'shell', left_calls: 1, right_calls: 2, calls_delta: 1, left_failures: 0, right_failures: 1, failures_delta: 1,
  });
});

test('duration and error thresholds are configurable and validated', () => {
  const events = [...baseline(), event('error', 8, { message: 'synthetic error' })];
  const result = compareTraceEvents(baseline(), events, { thresholds: { errors_increase: 1, duration_percent: 100, duration_absolute_ms: 10000 } });
  assert.equal(result.regressions.some((item) => item.code === 'errors_increased'), false);
  assert.throws(() => normalizeThresholds({ invented: 1 }), /Unknown Trace diff threshold/);
  assert.throws(() => normalizeThresholds({ duration_percent: -1 }), /non-negative/);
});

