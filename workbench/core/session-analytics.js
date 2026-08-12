const fs = require('fs');
const path = require('path');
const {
  nonNegativeNumber,
  selectCanonicalEvents,
  selectMetricEvents,
  summarizeSession,
  usageNumbers,
} = require('./session-comparison');

const DEFAULT_PRICING_FILE = path.join(__dirname, '..', 'data', 'model-pricing.json');
const MAX_TIMELINE_REQUESTS = 200;

function loadPricingCatalog(file = process.env.WORKBENCH_PRICING_FILE || DEFAULT_PRICING_FILE) {
  const catalog = JSON.parse(fs.readFileSync(path.resolve(file), 'utf8'));
  if (!catalog || !Array.isArray(catalog.models) || !catalog.models.length) throw new Error('Pricing catalog must contain at least one model');
  if (String(catalog.currency || '').toUpperCase() !== 'USD') throw new Error('Pricing catalog currency must be USD');
  for (const model of catalog.models) {
    if (!model.provider || !model.label || !Array.isArray(model.aliases) || !model.aliases.length) throw new Error('Pricing catalog model entries require provider, label, and aliases');
    if (!model.rates && !Array.isArray(model.tiers)) throw new Error(`Pricing catalog entry ${model.label} requires rates or tiers`);
    if (model.rates) validateRates(model.rates, model.label);
    if (model.tiers) {
      if (!model.tiers.length) throw new Error(`Pricing catalog entry ${model.label} requires at least one tier`);
      model.tiers.forEach((tier) => validateRates(tier.rates, model.label));
    }
  }
  return catalog;
}

function buildSessionAnalytics(events, metadata = {}, options = {}) {
  const input = Array.isArray(events) ? events : [];
  const canonical = selectCanonicalEvents(input);
  const usageSelection = selectMetricEvents(input, canonical.source, ['usage']);
  const toolSelection = selectMetricEvents(input, canonical.source, ['tool_call', 'tool_result']);
  const requestSelection = selectMetricEvents(input, canonical.source, ['request_start', 'request_end', 'usage', 'tool_call', 'tool_result', 'reasoning', 'error']);
  const pricing = options.pricingCatalog || loadPricingCatalog(options.pricingFile);
  const usageByModel = aggregateUsageByModel(usageSelection.events);
  const toolStatistics = summarizeToolStatistics(toolSelection.events);
  const timeline = buildRequestTimeline(requestSelection.events);
  const cost = summarizeCost(input, canonical.source, usageByModel, pricing);

  return {
    generated_at: new Date().toISOString(),
    summary: summarizeSession(input, metadata),
    tokens: {
      source: usageSelection.source,
      models: usageByModel,
      totals: sumUsages(usageByModel.map((item) => item.usage)),
    },
    cost,
    tools: { source: toolSelection.source, ...toolStatistics },
    timeline: {
      source: requestSelection.source,
      total_requests: timeline.length,
      truncated: timeline.length > MAX_TIMELINE_REQUESTS,
      requests: timeline.slice(-MAX_TIMELINE_REQUESTS),
    },
    notes: [
      'Each analytics category selects one normalized source to avoid proxy/history double counting.',
      'Observed cost is an upstream field. Estimated cost is a local standard-rate calculation and is not a bill.',
      'Request spans and tool durations use timestamps only when both endpoints are present.',
    ],
  };
}

function aggregateUsageByModel(events) {
  const cumulative = events.filter((event) => event.content?.total_token_usage || event.content?.total_usage);
  if (cumulative.length) {
    const models = new Set(cumulative.map((event) => identity(event)).filter((value) => value.model).map((value) => `${value.provider}\u0000${value.model}`));
    if (models.size !== 1) return [];
    let best = null;
    for (const event of cumulative) {
      const usage = usageNumbers(event.content.total_token_usage || event.content.total_usage);
      if (!best || usageMagnitude(usage) > usageMagnitude(best.usage)) best = { ...identity(event), usage };
    }
    return best ? [best] : [];
  }

  const requests = new Map();
  events.forEach((event, index) => {
    const item = identity(event);
    const key = `${event.request_id || `event:${index}`}\u0000${item.provider}\u0000${item.model}`;
    const previous = requests.get(key);
    requests.set(key, { ...item, usage: maxUsage(previous?.usage, usageNumbers(event.content || {})) });
  });
  const models = new Map();
  for (const item of requests.values()) {
    const key = `${item.provider}\u0000${item.model}`;
    const previous = models.get(key);
    models.set(key, { provider: item.provider, model: item.model, usage: addUsage(previous?.usage, item.usage) });
  }
  return [...models.values()].sort((left, right) => usageMagnitude(right.usage) - usageMagnitude(left.usage));
}

function summarizeCost(events, preferredSource, usageByModel, catalog) {
  const endSelection = selectCostEvents(events, preferredSource);
  const observedByRequest = new Map();
  endSelection.events.forEach((event, index) => {
    const value = Number(event.content?.cost);
    if (!Number.isFinite(value) || value < 0) return;
    const key = event.request_id || `event:${index}`;
    observedByRequest.set(key, Math.max(observedByRequest.get(key) ?? 0, value));
  });
  const observed = observedByRequest.size ? roundUsd([...observedByRequest.values()].reduce((sum, value) => sum + value, 0)) : null;
  const estimate = estimateCost(usageByModel, catalog);
  if (observed !== null) {
    return {
      status: 'observed',
      amount_usd: observed,
      source: endSelection.source,
      estimated_amount_usd: estimate.status === 'estimated' ? estimate.amount_usd : null,
      breakdown: estimate.breakdown,
      verified_at: catalog.verified_at,
      disclaimer: catalog.disclaimer,
    };
  }
  return { ...estimate, source: estimate.status === 'estimated' ? 'local-pricing-catalog' : 'unavailable', verified_at: catalog.verified_at, disclaimer: catalog.disclaimer };
}

function estimateCost(usageByModel, catalog) {
  if (!usageByModel.length) return { status: 'unavailable', amount_usd: null, reason: 'No attributable token usage was observed.', breakdown: [] };
  const breakdown = [];
  const unmatched = [];
  for (const item of usageByModel) {
    const match = matchCatalogModel(catalog, item.provider, item.model, item.usage.input_tokens);
    if (!match) {
      unmatched.push([item.provider, item.model].filter(Boolean).join('/') || 'unknown model');
      continue;
    }
    const usage = item.usage;
    const rates = match.rates;
    const unsupportedCache = unsupportedCacheReason(item.provider, usage, rates);
    if (unsupportedCache) {
      unmatched.push(`${[item.provider, item.model].filter(Boolean).join('/') || 'unknown model'} (${unsupportedCache})`);
      continue;
    }
    const cached = nonNegativeNumber(usage.cached_input_tokens);
    const inputTokens = nonNegativeNumber(usage.input_tokens);
    const outputTokens = nonNegativeNumber(usage.output_tokens);
    const cacheWrite5m = nonNegativeNumber(usage.cache_write_5m_tokens);
    const cacheWrite1h = nonNegativeNumber(usage.cache_write_1h_tokens);
    const cacheWriteUnknown = nonNegativeNumber(usage.cache_write_unknown_tokens);
    const uncached = match.model.input_includes_cached ? Math.max(0, inputTokens - cached) : inputTokens;
    const components = {
      input: uncached * nonNegativeNumber(rates.input) / 1_000_000,
      cached_input: cached * nonNegativeNumber(rates.cached_input) / 1_000_000,
      cache_write_5m: cacheWrite5m * nonNegativeNumber(rates.cache_write_5m) / 1_000_000,
      cache_write_1h: cacheWrite1h * nonNegativeNumber(rates.cache_write_1h) / 1_000_000,
      cache_write_generic: cacheWriteUnknown * nonNegativeNumber(rates.cache_write) / 1_000_000,
      output: outputTokens * nonNegativeNumber(rates.output) / 1_000_000,
    };
    breakdown.push({
      provider: item.provider,
      model: item.model,
      catalog_model: match.model.label,
      usage,
      rates_per_million: rates,
      amount_usd: roundUsd(Object.values(components).reduce((sum, value) => sum + value, 0)),
    });
  }
  if (unmatched.length) return { status: 'unavailable', amount_usd: null, reason: `No exact standard-rate match for: ${unmatched.join(', ')}`, unmatched_models: unmatched, breakdown };
  return { status: 'estimated', amount_usd: roundUsd(breakdown.reduce((sum, item) => sum + item.amount_usd, 0)), breakdown };
}

function matchCatalogModel(catalog, provider, model, inputTokens) {
  const normalizedProvider = normalizeProvider(provider);
  const normalizedModel = String(model || '').trim().toLowerCase();
  if (!normalizedProvider || !normalizedModel) return null;
  const entry = catalog.models.find((candidate) => normalizeProvider(candidate.provider) === normalizedProvider
    && candidate.aliases.some((alias) => modelMatchesAlias(normalizedModel, alias)));
  if (!entry || (entry.max_supported_input_tokens && inputTokens > entry.max_supported_input_tokens)) return null;
  if (entry.rates) return { model: entry, rates: entry.rates };
  const tier = entry.tiers.find((candidate) => !candidate.max_input_tokens || inputTokens <= candidate.max_input_tokens);
  return tier ? { model: entry, rates: tier.rates } : null;
}

function modelMatchesAlias(model, alias) {
  const normalizedAlias = String(alias || '').trim().toLowerCase();
  if (!normalizedAlias) return false;
  if (model === normalizedAlias) return true;
  if (!model.startsWith(`${normalizedAlias}-`)) return false;
  const suffix = model.slice(normalizedAlias.length + 1);
  return /^(?:\d{8}|\d{4}-\d{2}-\d{2})(?:$|-)/.test(suffix);
}

function selectCostEvents(events, preferredSource) {
  const sources = [preferredSource, 'agent-history', 'proxy', 'gateway', ...events.map((event) => event.source || 'unknown')]
    .filter((source, index, all) => source && all.indexOf(source) === index);
  for (const source of sources) {
    const matching = events.filter((event) => (event.source || 'unknown') === source && event.event_type === 'request_end'
      && Number.isFinite(Number(event.content?.cost)) && Number(event.content.cost) >= 0);
    if (matching.length) return { source, events: matching };
  }
  return { source: 'unavailable', events: [] };
}

function summarizeToolStatistics(events) {
  const calls = new Map();
  const byName = new Map();
  let sequence = 0;
  for (const event of events) {
    if (event.event_type === 'tool_call') {
      const name = String(event.content?.name || event.content?.tool_name || event.content?.tool || 'unknown').trim() || 'unknown';
      const id = String(event.content?.call_id || event.content?.tool_use_id || event.content?.id || `sequence:${sequence++}`);
      const record = { name, timestamp: timestampMs(event.timestamp), failed: false };
      calls.set(id, record);
      const stat = toolStat(byName, name);
      stat.calls += 1;
      continue;
    }
    if (event.event_type !== 'tool_result') continue;
    const id = String(event.content?.call_id || event.content?.tool_use_id || event.content?.id || '');
    const call = calls.get(id);
    const name = call?.name || 'unmatched-result';
    const stat = toolStat(byName, name);
    stat.results += 1;
    if (isFailedToolResult(event.content)) {
      stat.failures += 1;
      if (call) call.failed = true;
    }
    const duration = call?.timestamp === null ? null : timestampMs(event.timestamp) - call.timestamp;
    if (Number.isFinite(duration) && duration >= 0) {
      stat.duration_total_ms += duration;
      stat.duration_samples += 1;
    }
  }
  const tools = [...byName.entries()].map(([name, stat]) => ({
    name,
    calls: stat.calls,
    results: stat.results,
    failures: stat.failures,
    failure_rate: stat.calls ? stat.failures / stat.calls : null,
    average_duration_ms: stat.duration_samples ? Math.round(stat.duration_total_ms / stat.duration_samples) : null,
    duration_samples: stat.duration_samples,
  })).sort((left, right) => right.calls - left.calls || left.name.localeCompare(right.name));
  return {
    total_calls: tools.reduce((sum, item) => sum + item.calls, 0),
    total_failures: tools.reduce((sum, item) => sum + item.failures, 0),
    tools,
  };
}

function buildRequestTimeline(events) {
  const requests = new Map();
  for (const event of events) {
    if (!event.request_id) continue;
    const request = requests.get(event.request_id) || {
      request_id: event.request_id,
      agent: event.agent || 'unknown',
      provider: event.provider || 'unknown',
      model: event.model || '',
      first_at: null,
      last_at: null,
      start_at: null,
      end_at: null,
      event_count: 0,
      tool_calls: 0,
      errors: 0,
      reasoning_events: 0,
      usage: {},
      complete: null,
    };
    const time = timestampMs(event.timestamp);
    if (time !== null) {
      request.first_at = request.first_at === null ? time : Math.min(request.first_at, time);
      request.last_at = request.last_at === null ? time : Math.max(request.last_at, time);
      if (event.event_type === 'request_start') request.start_at = request.start_at === null ? time : Math.min(request.start_at, time);
      if (event.event_type === 'request_end') request.end_at = request.end_at === null ? time : Math.max(request.end_at, time);
    }
    request.event_count += 1;
    if (event.event_type === 'tool_call') request.tool_calls += 1;
    if (event.event_type === 'error') request.errors += 1;
    if (event.event_type === 'reasoning') request.reasoning_events += 1;
    if (event.event_type === 'usage') request.usage = maxUsage(request.usage, usageNumbers(event.content || {}));
    if (event.event_type === 'request_end' && typeof event.content?.complete === 'boolean') request.complete = event.content.complete;
    requests.set(event.request_id, request);
  }
  return [...requests.values()].map((request) => {
    const start = request.start_at ?? request.first_at;
    const end = request.end_at ?? request.last_at;
    return {
      request_id: request.request_id,
      agent: request.agent,
      provider: request.provider,
      model: request.model,
      started_at: start === null ? null : new Date(start).toISOString(),
      ended_at: end === null ? null : new Date(end).toISOString(),
      duration_ms: start === null || end === null ? null : Math.max(0, end - start),
      duration_basis: request.start_at !== null && request.end_at !== null ? 'request-boundaries' : 'observed-event-span',
      event_count: request.event_count,
      tool_calls: request.tool_calls,
      errors: request.errors,
      reasoning_events: request.reasoning_events,
      usage: request.usage,
      status: request.complete === false || request.errors ? 'error' : request.complete === true ? 'complete' : 'incomplete',
    };
  }).sort((left, right) => String(left.started_at || '').localeCompare(String(right.started_at || '')));
}

function identity(event) {
  return { provider: normalizeProvider(event.provider), model: String(event.model || '').trim().toLowerCase() };
}

function normalizeProvider(value) {
  const provider = String(value || '').trim().toLowerCase();
  if (provider === 'gemini' || provider === 'google-ai' || provider === 'google-ai-studio') return 'google';
  return ['openai', 'anthropic', 'google'].includes(provider) ? provider : '';
}

function maxUsage(left = {}, right = {}) {
  const keys = usageKeys();
  return Object.fromEntries(keys.map((key) => [key, Math.max(nonNegativeNumber(left[key]), nonNegativeNumber(right[key]))]));
}

function addUsage(left = {}, right = {}) {
  const keys = usageKeys();
  return Object.fromEntries(keys.map((key) => [key, nonNegativeNumber(left[key]) + nonNegativeNumber(right[key])]));
}

function sumUsages(usages) {
  return usages.reduce(addUsage, addUsage());
}

function usageMagnitude(usage) {
  return nonNegativeNumber(usage.input_tokens) + nonNegativeNumber(usage.output_tokens) + nonNegativeNumber(usage.cache_write_tokens);
}

function usageKeys() {
  return ['input_tokens', 'output_tokens', 'cached_input_tokens', 'cache_write_tokens', 'cache_write_5m_tokens', 'cache_write_1h_tokens', 'cache_write_unknown_tokens', 'reasoning_tokens'];
}

function unsupportedCacheReason(provider, usage, rates) {
  if (nonNegativeNumber(usage.cached_input_tokens) > 0 && rates.cached_input === undefined) return 'cached-input rate unavailable';
  if (nonNegativeNumber(usage.cache_write_5m_tokens) > 0 && rates.cache_write_5m === undefined) return '5m cache-write rate unavailable';
  if (nonNegativeNumber(usage.cache_write_1h_tokens) > 0 && rates.cache_write_1h === undefined) return '1h cache-write rate unavailable';
  if (nonNegativeNumber(usage.cache_write_unknown_tokens) > 0) {
    if (provider === 'anthropic') return 'cache-write duration unavailable';
    if (rates.cache_write === undefined) return 'cache-write rate unavailable';
  }
  return '';
}

function toolStat(map, name) {
  if (!map.has(name)) map.set(name, { calls: 0, results: 0, failures: 0, duration_total_ms: 0, duration_samples: 0 });
  return map.get(name);
}

function isFailedToolResult(content = {}) {
  if (content.is_error === true || content.error || content.success === false) return true;
  const exitCode = Number(content.exit_code ?? content.exitCode ?? content.code);
  return Number.isFinite(exitCode) && exitCode !== 0 || /^(failed|error)$/i.test(String(content.status || ''));
}

function timestampMs(value) {
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : null;
}

function roundUsd(value) {
  return Math.round((Number(value) + Number.EPSILON) * 1e8) / 1e8;
}

function validateRates(rates, label) {
  if (!rates || !Number.isFinite(Number(rates.input)) || !Number.isFinite(Number(rates.output))) {
    throw new Error(`Pricing catalog entry ${label} requires finite input and output rates`);
  }
  for (const [name, value] of Object.entries(rates)) {
    if (!Number.isFinite(Number(value)) || Number(value) < 0) throw new Error(`Pricing catalog entry ${label} has invalid ${name} rate`);
  }
}

module.exports = {
  DEFAULT_PRICING_FILE,
  aggregateUsageByModel,
  buildRequestTimeline,
  buildSessionAnalytics,
  estimateCost,
  loadPricingCatalog,
  matchCatalogModel,
  summarizeToolStatistics,
};
