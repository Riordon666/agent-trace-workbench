const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const sdk = require('../adapter-sdk');
const { adapters: agentAdapters } = require('../workbench/adapters/agents');
const anthropic = require('../workbench/adapters/protocols/anthropic-messages');
const openai = require('../workbench/adapters/protocols/openai-responses');

const fixtures = {
  'claude-code': { file: 'claude-code/session-v1.jsonl', expected: { minEvents: 5, requiredEventTypes: ['user_message', 'reasoning', 'tool_call', 'assistant_message', 'usage'], reasoning: 'available', signature: 'present' } },
  'codex-cli': { file: 'codex-cli/rollout-v1.jsonl', expected: { formatVersion: 'rollout-v1', minEvents: 8, requiredEventTypes: ['session_start', 'request_start', 'reasoning', 'tool_call', 'tool_result', 'request_end'], reasoning: 'available', signature: 'absent' } },
  'gemini-cli': { file: 'gemini-cli/session-v1.jsonl', expected: { formatVersion: 'gemini-jsonl-v1', minEvents: 7, requiredEventTypes: ['session_start', 'user_message', 'reasoning', 'tool_call', 'tool_result', 'usage'], reasoning: 'available', signature: 'absent' } },
  opencode: { file: 'opencode/export-v1.json', expected: { formatVersion: 'opencode-export-v1', minEvents: 8, requiredEventTypes: ['session_start', 'request_start', 'reasoning', 'tool_call', 'tool_result', 'usage', 'request_end'], reasoning: 'available', signature: 'present' } },
};

test('public Adapter SDK validates and freezes definitions', () => {
  const definition = sdk.defineAgentAdapter({
    id: 'synthetic-agent', displayName: 'Synthetic Agent', protocols: [],
    classifyRequest: () => 'main', discoverLocalSessions: () => [], parseHistory: () => ({}), historyToEvents: () => [],
  });
  assert.equal(definition.adapterApiVersion, '1.0');
  assert.equal(Object.isFrozen(definition), true);
  assert.throws(() => sdk.defineAgentAdapter({ id: '../bad', displayName: 'Bad' }), /Invalid agent adapter/);
});

test('all bundled Agent Adapters pass the same conformance contract', async () => {
  for (const adapter of agentAdapters) {
    const specification = fixtures[adapter.id];
    const report = await sdk.runAgentAdapterConformance(adapter, {
      fixturePath: path.join(__dirname, 'fixtures', 'agents', specification.file),
      expected: specification.expected,
    });
    assert.equal(report.ok, true, `${adapter.id}: ${JSON.stringify(report.failures)}`);
    assert.equal(report.evidence.eventCount >= specification.expected.minEvents, true);
  }
});

test('Agent Adapter conformance rejects invented empty reasoning and nondeterminism', async () => {
  let attempt = 0;
  const adapter = {
    id: 'bad-agent', displayName: 'Bad Agent', classifyRequest: () => 'main', discoverLocalSessions: () => [], parseHistory: () => ({}),
    historyToEvents: () => [{
      schema_version: '1.0', session_id: 'adapter-conformance', request_id: 'r', agent: 'bad-agent', provider: 'unknown', model: '',
      event_type: 'reasoning', timestamp: '2026-01-01T00:00:00.000Z', content: { text: '', attempt: attempt++ }, source: 'agent-history',
    }],
  };
  const report = await sdk.runAgentAdapterConformance(adapter, { fixturePath: path.join(__dirname, 'fixtures', 'agents', 'claude-code', 'session-v1.jsonl') });
  assert.equal(report.ok, false);
  assert.match(report.failures[0].detail, /empty reasoning/);
});

function sse(objects) {
  return objects.map((object) => `data: ${JSON.stringify(object)}\n\n`).join('');
}

test('bundled Protocol Adapters pass deterministic synthetic cases', async () => {
  const anthropicReport = await sdk.runProtocolAdapterConformance(anthropic, { cases: [{
    name: 'anthropic-sse', kind: 'sse', detectEvent: { type: 'message_start' },
    input: sse([{ type: 'message_start', message: { id: 'm', model: 'claude-synthetic' } }, { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'visible' } }, { type: 'message_stop' }]),
    context: { session_id: 'protocol-synthetic', source: 'fixture' },
    expected: { apiFormat: 'anthropic-messages', requiredEventTypes: ['request_start', 'reasoning', 'request_end'], reasoning: 'available' },
  }] });
  const openaiReport = await sdk.runProtocolAdapterConformance(openai, { cases: [{
    name: 'openai-sse', kind: 'sse', detectEvent: { type: 'response.created' },
    input: sse([{ type: 'response.created', response: { id: 'r', model: 'gpt-synthetic' } }, { type: 'response.output_text.delta', delta: 'answer' }, { type: 'response.completed', response: { id: 'r', model: 'gpt-synthetic' } }]),
    context: { session_id: 'protocol-synthetic', source: 'fixture' },
    expected: { apiFormat: 'openai-responses', requiredEventTypes: ['request_start', 'assistant_message', 'request_end'], forbiddenEventTypes: ['reasoning'], reasoning: 'unavailable' },
  }] });
  assert.equal(anthropicReport.ok, true, JSON.stringify(anthropicReport.failures));
  assert.equal(openaiReport.ok, true, JSON.stringify(openaiReport.failures));
});
