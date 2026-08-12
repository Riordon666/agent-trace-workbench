const test = require('node:test');
const assert = require('node:assert/strict');
const { compareSessions, summarizeSession, summarizeUsage } = require('../workbench/core/session-comparison');

function event(event_type, timestamp, content = {}, overrides = {}) {
  return {
    schema_version: '1.0', session_id: 'left', request_id: 'req-1', agent: 'codex-cli', provider: 'openai',
    model: 'synthetic-model', event_type, timestamp, content, source: 'agent-history', ...overrides,
  };
}

test('session comparison summarizes observed metrics without dual-source double counting', () => {
  const events = [
    event('session_start', '2026-01-01T00:00:00Z'),
    event('request_start', '2026-01-01T00:00:01Z'),
    event('usage', '2026-01-01T00:00:02Z', { input_tokens: 100, output_tokens: 20 }),
    event('tool_call', '2026-01-01T00:00:03Z', { call_id: 'read-1', name: 'read_file', input: { file_path: 'src/a.js' } }),
    event('tool_result', '2026-01-01T00:00:04Z', { call_id: 'read-1', output: 'ok' }),
    event('tool_call', '2026-01-01T00:00:05Z', { call_id: 'patch-1', name: 'apply_patch', input: { patch: '*** Update File: src/a.js' } }),
    event('tool_result', '2026-01-01T00:00:06Z', { call_id: 'patch-1', output: 'ok' }),
    event('tool_call', '2026-01-01T00:00:07Z', { call_id: 'shell-1', name: 'shell_command', input: { command: 'npm test' } }),
    event('tool_result', '2026-01-01T00:00:08Z', { call_id: 'shell-1', output: 'Process exited with code 1' }),
    event('tool_call', '2026-01-01T00:00:09Z', { call_id: 'shell-2', name: 'shell_command', input: { command: 'npm test' } }),
    event('request_end', '2026-01-01T00:00:10Z', { complete: true }),
    event('session_end', '2026-01-01T00:00:11Z'),
    event('usage', '2026-01-01T00:00:02Z', { input_tokens: 100, output_tokens: 20 }, { source: 'proxy' }),
    event('tool_call', '2026-01-01T00:00:03Z', { call_id: 'read-1', name: 'read_file', input: { file_path: 'src/a.js' } }, { source: 'proxy' }),
  ];
  const summary = summarizeSession(events, { id: 'left', name: 'Left' });
  assert.equal(summary.source, 'agent-history');
  assert.equal(summary.metrics.duration_ms, 11000);
  assert.equal(summary.metrics.input_tokens, 100);
  assert.equal(summary.metrics.output_tokens, 20);
  assert.equal(summary.metrics.tool_calls, 4);
  assert.equal(summary.metrics.files_read, 1);
  assert.equal(summary.metrics.files_edited, 1);
  assert.equal(summary.metrics.failed_commands, 1);
  assert.equal(summary.metrics.retry_signals, 1);
});

test('Codex cumulative token snapshots use maxima instead of being summed', () => {
  const usage = summarizeUsage([
    event('usage', '2026-01-01T00:00:01Z', { total_token_usage: { input_tokens: 100, output_tokens: 10 } }),
    event('usage', '2026-01-01T00:00:02Z', { total_token_usage: { input_tokens: 180, output_tokens: 25, cached_input_tokens: 40 } }, { request_id: 'req-2' }),
  ]);
  assert.deepEqual(usage, { input_tokens: 180, output_tokens: 25, cached_input_tokens: 40, reasoning_tokens: 0 });
});

test('metric categories fall back to another source when the canonical source has no evidence', () => {
  const summary = summarizeSession([
    event('user_message', '2026-01-01T00:00:00Z', { text: 'history only' }),
    event('usage', '2026-01-01T00:00:01Z', { input_tokens: 12, output_tokens: 4 }, { source: 'proxy' }),
  ], { id: 'fallback' });
  assert.equal(summary.source, 'agent-history');
  assert.equal(summary.details.metric_sources.usage, 'proxy');
  assert.equal(summary.metrics.input_tokens, 12);
  assert.equal(summary.metrics.output_tokens, 4);
});

test('comparison reports B minus A absolute and percentage deltas', () => {
  const left = summarizeSession([event('usage', '2026-01-01T00:00:00Z', { input_tokens: 100, output_tokens: 10 })], { id: 'a' });
  const right = summarizeSession([event('usage', '2026-01-01T00:00:00Z', { input_tokens: 75, output_tokens: 15 })], { id: 'b' });
  const comparison = compareSessions(left, right);
  const input = comparison.rows.find((row) => row.key === 'input_tokens');
  const output = comparison.rows.find((row) => row.key === 'output_tokens');
  assert.equal(input.delta, -25);
  assert.equal(input.percent, -25);
  assert.equal(output.delta, 5);
  assert.equal(output.percent, 50);
});
