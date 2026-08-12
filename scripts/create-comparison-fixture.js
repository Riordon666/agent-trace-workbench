const fs = require('node:fs');
const path = require('node:path');
const { createEvent } = require('../workbench/core/event-schema');
const { replaceEvents } = require('../workbench/core/event-store');

const root = path.resolve(process.argv[2] || '');
if (!process.argv[2]) throw new Error('Usage: node scripts/create-comparison-fixture.js <sessions-dir>');

function writeSession(id, name, spec) {
  const dir = path.join(root, id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ id, name, agent: spec.agent, state: 'recorded', createdAt: spec.start }, null, 2));
  const base = { session_id: id, agent: spec.agent, provider: spec.provider, model: spec.model, source: 'agent-history' };
  const events = [
    createEvent({ ...base, event_type: 'session_start', timestamp: spec.start, content: {} }),
    createEvent({ ...base, request_id: `${id}-turn-1`, event_type: 'request_start', timestamp: offset(spec.start, 1000), content: {} }),
    createEvent({ ...base, request_id: `${id}-turn-1`, event_type: 'user_message', timestamp: offset(spec.start, 1500), content: { text: 'Synthetic comparison fixture' } }),
    createEvent({ ...base, request_id: `${id}-turn-1`, event_type: 'usage', timestamp: offset(spec.start, 2000), content: { input_tokens: spec.input, output_tokens: spec.output } }),
    ...spec.tools.flatMap((tool, index) => {
      const callId = `${id}-tool-${index}`;
      return [
        createEvent({ ...base, request_id: `${id}-turn-1`, event_type: 'tool_call', timestamp: offset(spec.start, 3000 + index * 1000), content: { call_id: callId, ...tool.call } }),
        createEvent({ ...base, request_id: `${id}-turn-1`, event_type: 'tool_result', timestamp: offset(spec.start, 3500 + index * 1000), content: { call_id: callId, ...tool.result } }),
      ];
    }),
    createEvent({ ...base, request_id: `${id}-turn-1`, event_type: 'assistant_message', timestamp: offset(spec.start, spec.duration - 1000), content: { text: 'Synthetic result' } }),
    createEvent({ ...base, request_id: `${id}-turn-1`, event_type: 'request_end', timestamp: offset(spec.start, spec.duration - 500), content: { complete: true } }),
    createEvent({ ...base, event_type: 'session_end', timestamp: offset(spec.start, spec.duration), content: {} }),
  ];
  replaceEvents(dir, events);
}

function offset(value, milliseconds) {
  return new Date(new Date(value).getTime() + milliseconds).toISOString();
}

fs.mkdirSync(root, { recursive: true });
writeSession('synthetic-a', 'Synthetic A · baseline', {
  start: '2026-01-01T00:00:00Z', duration: 184000, input: 95000, output: 12000,
  agent: 'codex-cli', provider: 'openai', model: 'gpt-synthetic-a',
  tools: [
    { call: { name: 'read_file', input: { file_path: 'src/a.js' } }, result: { output: 'ok' } },
    { call: { name: 'apply_patch', input: { patch: '*** Update File: src/a.js' } }, result: { output: 'ok' } },
    { call: { name: 'shell_command', input: { command: 'npm test' } }, result: { output: 'Process exited with code 1' } },
  ],
});
writeSession('synthetic-b', 'Synthetic B · optimized', {
  start: '2026-01-02T00:00:00Z', duration: 121000, input: 72000, output: 14000,
  agent: 'claude-code', provider: 'anthropic', model: 'claude-synthetic-b',
  tools: [
    { call: { name: 'read_file', input: { file_path: 'src/b.js' } }, result: { output: 'ok' } },
    { call: { name: 'apply_patch', input: { patch: '*** Update File: src/b.js' } }, result: { output: 'ok' } },
  ],
});

console.log(root);
