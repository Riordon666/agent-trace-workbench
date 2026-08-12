const fs = require('fs');
const path = require('path');
const { EVENT_TYPES, SCHEMA_VERSION, createEvent } = require('../core/event-schema');
const { sha256, stableStringify } = require('../core/hashing');

const ADAPTER_API_VERSION = '1.0';
const AGENT_METHODS = ['classifyRequest', 'discoverLocalSessions', 'historyToEvents', 'parseHistory'];
const PROTOCOL_METHODS = ['detect', 'parseJSON', 'parseSSE'];
const REQUEST_CLASSIFICATIONS = new Set(['main', 'side-summary', 'side-title', 'side-other']);
const EVENT_FIELDS = ['schema_version', 'session_id', 'request_id', 'agent', 'provider', 'model', 'event_type', 'timestamp', 'content', 'source'];

function validateAgentAdapter(adapter) {
  return validateAdapterShape(adapter, 'agent', AGENT_METHODS);
}

function validateProtocolAdapter(adapter) {
  return validateAdapterShape(adapter, 'protocol', PROTOCOL_METHODS);
}

function defineAgentAdapter(definition) {
  validateAgentAdapter(definition);
  return Object.freeze({ adapterApiVersion: ADAPTER_API_VERSION, ...definition });
}

function defineProtocolAdapter(definition) {
  validateProtocolAdapter(definition);
  return Object.freeze({ adapterApiVersion: ADAPTER_API_VERSION, ...definition });
}

function validateAdapterShape(adapter, kind, methods) {
  const missing = methods.filter((method) => typeof adapter?.[method] !== 'function');
  if (!adapter?.id || typeof adapter.id !== 'string' || !adapter?.displayName || typeof adapter.displayName !== 'string' || missing.length) {
    throw new Error(`Invalid ${kind} adapter ${adapter?.id || '<unknown>'}; missing: ${missing.join(', ')}`);
  }
  if (!/^[a-z0-9][a-z0-9._-]*$/.test(adapter.id)) throw new Error(`Invalid ${kind} adapter id: ${adapter.id}`);
  if (adapter.adapterApiVersion && adapter.adapterApiVersion !== ADAPTER_API_VERSION) {
    throw new Error(`Unsupported ${kind} adapter API version: ${adapter.adapterApiVersion}`);
  }
  return true;
}

function validateNormalizedEvent(event, index = 0, options = {}) {
  if (!event || typeof event !== 'object' || Array.isArray(event)) throw new Error(`Event ${index + 1} must be an object`);
  for (const field of EVENT_FIELDS) if (!Object.hasOwn(event, field)) throw new Error(`Event ${index + 1} is missing ${field}`);
  if (event.schema_version !== SCHEMA_VERSION) throw new Error(`Event ${index + 1} uses unsupported schema ${event.schema_version}`);
  if (!options.allowUnknownEventTypes && !EVENT_TYPES.has(event.event_type)) throw new Error(`Event ${index + 1} uses unsupported event_type ${event.event_type}`);
  if (!Number.isFinite(new Date(event.timestamp).getTime())) throw new Error(`Event ${index + 1} has an invalid timestamp`);
  if (options.sessionId !== undefined && event.session_id !== String(options.sessionId)) throw new Error(`Event ${index + 1} does not preserve the conformance session_id`);
  if (event.event_type === 'reasoning' && !String(event.content?.text || event.content?.delta || '').trim()) {
    throw new Error(`Event ${index + 1} has an empty reasoning payload`);
  }
  stableStringify(event.content);
  return true;
}

async function runAgentAdapterConformance(adapter, specification = {}) {
  const report = reportBase('agent', adapter);
  try {
    validateAgentAdapter(adapter);
    pass(report, 'shape', 'Required Agent Adapter methods and identifiers are present.');
  } catch (error) {
    fail(report, 'shape', error.message);
    return finish(report);
  }

  const fixture = resolveFixture(specification.fixturePath, report);
  if (!fixture) return finish(report);
  const context = { session_id: 'adapter-conformance', source: 'agent-history', ...(specification.context || {}) };
  try {
    const classification = await adapter.classifyRequest({});
    if (!REQUEST_CLASSIFICATIONS.has(classification)) throw new Error(`classifyRequest returned unsupported value: ${classification}`);
    pass(report, 'classification', `classifyRequest returned ${classification}.`);
  } catch (error) {
    fail(report, 'classification', error.message);
  }

  let parsed;
  let events;
  try {
    parsed = await adapter.parseHistory(fixture);
    events = await adapter.historyToEvents(parsed, context);
    if (!Array.isArray(events)) throw new Error('historyToEvents must return an array');
    events.forEach((event, index) => validateNormalizedEvent(event, index, { sessionId: context.session_id }));
    pass(report, 'normalized-events', `${events.length} normalized event(s) passed Trace Schema checks.`);
  } catch (error) {
    fail(report, 'normalized-events', error.message);
    return finish(report);
  }

  try {
    const parsedAgain = await adapter.parseHistory(fixture);
    const eventsAgain = await adapter.historyToEvents(parsedAgain, context);
    if (stableStringify(eventsAgain) !== stableStringify(events)) throw new Error('Repeated parsing produced different normalized events');
    pass(report, 'determinism', `Stable event hash ${sha256(events).slice(0, 16)}.`);
  } catch (error) {
    fail(report, 'determinism', error.message);
  }

  applyEventExpectations(report, events, parsed, specification.expected || {});
  report.evidence = summarizeEvidence(events, parsed);
  return finish(report);
}

async function runProtocolAdapterConformance(adapter, specification = {}) {
  const report = reportBase('protocol', adapter);
  try {
    validateProtocolAdapter(adapter);
    pass(report, 'shape', 'Required Protocol Adapter methods and identifiers are present.');
  } catch (error) {
    fail(report, 'shape', error.message);
    return finish(report);
  }
  const cases = Array.isArray(specification.cases) ? specification.cases : [];
  if (!cases.length) {
    fail(report, 'fixtures', 'At least one explicit synthetic protocol case is required.');
    return finish(report);
  }
  for (const [index, testCase] of cases.entries()) {
    const name = String(testCase.name || `case-${index + 1}`);
    const caseContext = {
      session_id: 'adapter-conformance',
      source: 'fixture',
      timestamp: '2000-01-01T00:00:00.000Z',
      ...(testCase.context || {}),
    };
    try {
      if (testCase.detectEvent !== undefined && !await adapter.detect(testCase.detectEvent)) throw new Error('detect did not recognize the declared protocol event');
      const parser = testCase.kind === 'json' ? adapter.parseJSON : adapter.parseSSE;
      const result = await parser(testCase.input, caseContext);
      validateProtocolResult(result, testCase.expected || {});
      const repeated = await parser(testCase.input, caseContext);
      if (stableStringify(repeated) !== stableStringify(result)) throw new Error('Repeated parsing produced a different protocol result');
      pass(report, `case:${name}`, `${result.events.length} event(s); format ${result.apiFormat || 'unavailable'}.`);
      report.evidence.cases.push({ name, apiFormat: result.apiFormat || 'unavailable', events: summarizeEventTypes(result.events) });
    } catch (error) {
      fail(report, `case:${name}`, error.message);
    }
  }
  return finish(report);
}

function validateProtocolResult(result, expected) {
  if (!result || typeof result !== 'object') throw new Error('Protocol parser must return an object');
  if (!Array.isArray(result.events) || !Array.isArray(result.toolCalls)) throw new Error('Protocol result requires events and toolCalls arrays');
  if (typeof result.content !== 'string' || typeof result.reasoning !== 'string') throw new Error('Protocol result content and reasoning must be strings');
  result.events.forEach((event, index) => validateNormalizedEvent(event, index));
  applyExpectedTypes(result.events, expected.requiredEventTypes, expected.forbiddenEventTypes);
  if (expected.reasoning === 'unavailable' && (result.reasoning || result.events.some((event) => event.event_type === 'reasoning'))) {
    throw new Error('Protocol result invented reasoning where the fixture declares it unavailable');
  }
  if (expected.reasoning === 'available' && !result.events.some((event) => event.event_type === 'reasoning')) throw new Error('Expected a visible reasoning event');
  if (expected.apiFormat && result.apiFormat !== expected.apiFormat) throw new Error(`Expected apiFormat ${expected.apiFormat}, received ${result.apiFormat}`);
}

function applyEventExpectations(report, events, parsed, expected) {
  try {
    if (expected.minEvents !== undefined && events.length < Number(expected.minEvents)) throw new Error(`Expected at least ${expected.minEvents} events, received ${events.length}`);
    applyExpectedTypes(events, expected.requiredEventTypes, expected.forbiddenEventTypes);
    const reasoning = events.some((event) => event.event_type === 'reasoning');
    if (expected.reasoning === 'available' && !reasoning) throw new Error('Expected visible reasoning evidence');
    if (expected.reasoning === 'unavailable' && reasoning) throw new Error('Reasoning was emitted despite an unavailable expectation');
    const signature = events.some((event) => event.event_type === 'reasoning' && String(event.content?.signature || '').trim());
    if (expected.signature === 'present' && !signature) throw new Error('Expected an opaque signature on a reasoning event');
    if (expected.signature === 'absent' && signature) throw new Error('Unexpected signature evidence');
    const formatVersion = parsed?.formatVersion || parsed?.metadata?.formatVersion || null;
    if (expected.formatVersion && formatVersion !== expected.formatVersion) throw new Error(`Expected format ${expected.formatVersion}, received ${formatVersion || 'unavailable'}`);
    pass(report, 'expectations', 'Declared fixture expectations passed.');
  } catch (error) {
    fail(report, 'expectations', error.message);
  }
}

function applyExpectedTypes(events, required = [], forbidden = []) {
  const types = new Set(events.map((event) => event.event_type));
  for (const type of required || []) if (!types.has(type)) throw new Error(`Missing required event type: ${type}`);
  for (const type of forbidden || []) if (types.has(type)) throw new Error(`Forbidden event type was emitted: ${type}`);
}

function resolveFixture(value, report) {
  if (!value) {
    fail(report, 'fixture', 'An explicit synthetic fixturePath is required.');
    return null;
  }
  const fixture = path.resolve(value);
  if (!fs.existsSync(fixture) || !fs.statSync(fixture).isFile()) {
    fail(report, 'fixture', 'The declared fixture does not exist or is not a file.');
    return null;
  }
  pass(report, 'fixture', `Synthetic fixture ${path.basename(fixture)} is readable.`);
  return fixture;
}

function summarizeEvidence(events, parsed) {
  return {
    formatVersion: parsed?.formatVersion || parsed?.metadata?.formatVersion || null,
    eventCount: events.length,
    eventTypes: summarizeEventTypes(events),
    reasoning: events.some((event) => event.event_type === 'reasoning') ? 'available' : 'unavailable',
    signature: events.some((event) => event.event_type === 'reasoning' && String(event.content?.signature || '').trim()) ? 'present' : 'absent',
    models: [...new Set(events.map((event) => event.model).filter(Boolean))].sort(),
  };
}

function summarizeEventTypes(events) {
  return events.reduce((types, event) => ({ ...types, [event.event_type]: (types[event.event_type] || 0) + 1 }), {});
}

function reportBase(kind, adapter) {
  return { ok: false, adapterApiVersion: ADAPTER_API_VERSION, kind, adapter: adapter?.id || '<unknown>', checks: [], failures: [], evidence: kind === 'protocol' ? { cases: [] } : null };
}

function pass(report, name, detail) {
  report.checks.push({ name, status: 'pass', detail });
}

function fail(report, name, detail) {
  report.checks.push({ name, status: 'fail', detail });
  report.failures.push({ name, detail });
}

function finish(report) {
  report.ok = report.failures.length === 0;
  return report;
}

function assertConformance(report) {
  if (!report?.ok) throw new Error(`Adapter conformance failed: ${(report?.failures || []).map((failure) => `${failure.name}: ${failure.detail}`).join('; ') || 'unknown failure'}`);
  return report;
}

module.exports = {
  ADAPTER_API_VERSION,
  AGENT_METHODS,
  EVENT_FIELDS,
  PROTOCOL_METHODS,
  REQUEST_CLASSIFICATIONS,
  assertConformance,
  createEvent,
  defineAgentAdapter,
  defineProtocolAdapter,
  runAgentAdapterConformance,
  runProtocolAdapterConformance,
  validateAgentAdapter,
  validateNormalizedEvent,
  validateProtocolAdapter,
};
