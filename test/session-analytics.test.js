const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildSessionAnalytics,
  estimateCost,
  loadPricingCatalog,
} = require('../workbench/core/session-analytics');

function event(type, timestamp, content = {}, overrides = {}) {
  return {
    session_id: 'analytics-test', request_id: 'request-1', agent: 'fixture', provider: 'openai', model: 'gpt-5',
    event_type: type, timestamp, content, source: 'agent-history', ...overrides,
  };
}

test('analytics reports estimated cost, tool failures, durations, and request timeline', () => {
  const events = [
    event('request_start', '2026-01-01T00:00:00.000Z'),
    event('usage', '2026-01-01T00:00:00.100Z', { input_tokens: 1000, output_tokens: 200, input_tokens_details: { cached_tokens: 400 } }),
    event('tool_call', '2026-01-01T00:00:01.000Z', { call_id: 'call-1', name: 'shell_command', input: { command: 'false' } }),
    event('tool_result', '2026-01-01T00:00:01.250Z', { call_id: 'call-1', exit_code: 1 }),
    event('reasoning', '2026-01-01T00:00:01.500Z', { text: 'summary' }),
    event('request_end', '2026-01-01T00:00:02.000Z', { complete: false }),
  ];
  const analytics = buildSessionAnalytics(events, { id: 'analytics-test' });
  assert.equal(analytics.cost.status, 'estimated');
  assert.equal(analytics.cost.amount_usd, 0.0028);
  assert.equal(analytics.tools.total_calls, 1);
  assert.equal(analytics.tools.total_failures, 1);
  assert.equal(analytics.tools.tools[0].average_duration_ms, 250);
  assert.equal(analytics.timeline.requests[0].duration_ms, 2000);
  assert.equal(analytics.timeline.requests[0].status, 'error');
  assert.equal(analytics.timeline.requests[0].reasoning_events, 1);
});

test('observed upstream cost wins without hiding the local estimate', () => {
  const events = [
    event('usage', '2026-01-01T00:00:00.000Z', { input_tokens: 1000, output_tokens: 100 }),
    event('request_end', '2026-01-01T00:00:01.000Z', { complete: true, cost: 0.1234 }),
  ];
  const cost = buildSessionAnalytics(events).cost;
  assert.equal(cost.status, 'observed');
  assert.equal(cost.amount_usd, 0.1234);
  assert.equal(cost.estimated_amount_usd, 0.00225);
});

test('observed cost can fall back to another source without double counting request-end events', () => {
  const events = [
    event('usage', '2026-01-01T00:00:00.000Z', { input_tokens: 1000, output_tokens: 100 }),
    event('request_end', '2026-01-01T00:00:01.000Z', { complete: true }),
    event('request_end', '2026-01-01T00:00:01.000Z', { complete: true, cost: 0.25 }, { source: 'proxy' }),
  ];
  const cost = buildSessionAnalytics(events).cost;
  assert.equal(cost.status, 'observed');
  assert.equal(cost.amount_usd, 0.25);
  assert.equal(cost.source, 'proxy');
});

test('estimation remains unavailable for custom providers and unmatched models', () => {
  const catalog = loadPricingCatalog();
  const result = estimateCost([{
    provider: '', model: 'model_9mcrjw', usage: { input_tokens: 100, output_tokens: 20 },
  }], catalog);
  assert.equal(result.status, 'unavailable');
  assert.equal(result.amount_usd, null);
  assert.match(result.reason, /model_9mcrjw/);
});

test('tiered Gemini pricing selects the high-context rate from exact usage', () => {
  const catalog = loadPricingCatalog();
  const result = estimateCost([{
    provider: 'google', model: 'gemini-2.5-pro', usage: { input_tokens: 250000, output_tokens: 1000, cached_input_tokens: 0, cache_write_tokens: 0 },
  }], catalog);
  assert.equal(result.status, 'estimated');
  assert.equal(result.amount_usd, 0.64);
});

test('pricing aliases do not treat another model tier as a dated snapshot', () => {
  const catalog = loadPricingCatalog();
  const terra = estimateCost([{
    provider: 'openai', model: 'gpt-5.6-terra', usage: { input_tokens: 1000, output_tokens: 100, cached_input_tokens: 0, cache_write_tokens: 0 },
  }], catalog);
  const mini = estimateCost([{
    provider: 'openai', model: 'gpt-5-mini', usage: { input_tokens: 1000, output_tokens: 100, cached_input_tokens: 0, cache_write_tokens: 0 },
  }], catalog);
  assert.equal(terra.status, 'estimated');
  assert.equal(terra.amount_usd, 0.0032);
  assert.equal(terra.breakdown[0].catalog_model, 'GPT-5.6 Terra');
  assert.equal(mini.status, 'unavailable');
});

test('Anthropic cache writes require a known 5m or 1h pricing tier', () => {
  const catalog = loadPricingCatalog();
  const known = estimateCost([{
    provider: 'anthropic', model: 'claude-sonnet-4-6', usage: {
      input_tokens: 1000, output_tokens: 100, cached_input_tokens: 200, cache_write_tokens: 200,
      cache_write_5m_tokens: 100, cache_write_1h_tokens: 100, cache_write_unknown_tokens: 0,
    },
  }], catalog);
  const unknown = estimateCost([{
    provider: 'anthropic', model: 'claude-sonnet-4-6', usage: {
      input_tokens: 1000, output_tokens: 100, cached_input_tokens: 0, cache_write_tokens: 100,
      cache_write_5m_tokens: 0, cache_write_1h_tokens: 0, cache_write_unknown_tokens: 100,
    },
  }], catalog);
  assert.equal(known.status, 'estimated');
  assert.equal(known.amount_usd, 0.005535);
  assert.equal(unknown.status, 'unavailable');
  assert.match(unknown.reason, /cache-write duration unavailable/);
});
