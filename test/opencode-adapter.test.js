const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const openCode = require('../workbench/adapters/agents/opencode');

const fixture = path.join(__dirname, 'fixtures', 'agents', 'opencode', 'export-v1.json');

test('OpenCode official export maps messages, reasoning, signature, tools, retries and usage', () => {
  const parsed = openCode.parseHistory(fixture);
  assert.equal(parsed.formatVersion, 'opencode-export-v1');
  assert.equal(parsed.info.id, 'opencode-synthetic-session');
  const events = openCode.historyToEvents(parsed, { session_id: 'imported-opencode' });
  assert.equal(events.some((event) => event.event_type === 'user_message' && event.content.text === 'Run the synthetic task'), true);
  assert.equal(events.some((event) => event.event_type === 'reasoning' && event.content.signature === 'synthetic-signature'), true);
  assert.equal(events.some((event) => event.event_type === 'assistant_message' && event.content.text === 'Synthetic task complete'), true);
  assert.equal(events.filter((event) => event.event_type === 'tool_call').length, 2);
  assert.equal(events.some((event) => event.event_type === 'tool_result' && event.content.success === false), true);
  assert.equal(events.some((event) => event.event_type === 'error' && event.content.retryable === true && event.content.attempt === 2), true);
  const usage = events.find((event) => event.event_type === 'usage').content;
  assert.deepEqual(usage, { input_tokens: 120, output_tokens: 40, reasoning_output_tokens: 20, cached_input_tokens: 10, cache_write_tokens: 5, total_tokens: 180 });
  assert.equal(events.some((event) => event.event_type === 'request_end' && event.content.complete === true), true);
  assert.equal(events.every((event) => event.agent === 'opencode' && event.source === 'agent-history'), true);
});

test('OpenCode discovers sessions through the official JSON CLI and imports virtual exports', () => {
  const fixtureText = require('node:fs').readFileSync(fixture, 'utf8');
  const calls = [];
  const run = (_command, args) => {
    calls.push(args);
    if (args[0] === 'session') return { status: 0, stdout: JSON.stringify([{ id: 'ses_synthetic', title: 'Synthetic', updated: 1767225605000, created: 1767225600000, projectId: 'project', directory: '/synthetic' }]), stderr: '' };
    if (args[0] === '--version') return { status: 0, stdout: '9.9.9-synthetic\n', stderr: '' };
    if (args[0] === 'export') return { status: 0, stdout: fixtureText, stderr: '' };
    throw new Error(`Unexpected args: ${args.join(' ')}`);
  };
  const histories = openCode.discoverLocalSessions({ spawnSync: run });
  assert.equal(histories.length, 1);
  assert.equal(histories[0].path, 'opencode-session:ses_synthetic');
  assert.equal(histories[0].agentVersion, '9.9.9-synthetic');
  const parsed = openCode.parseHistory(histories[0].path, { spawnSync: run });
  assert.equal(parsed.info.id, 'opencode-synthetic-session');
  assert.match(parsed.rawText, /Synthetic OpenCode Session/);
  assert.deepEqual(calls.find((args) => args[0] === 'export'), ['export', 'ses_synthetic']);
});

test('OpenCode virtual Session IDs are validated before spawning a command', () => {
  assert.equal(openCode.virtualSessionId('opencode-session:ses_valid-1'), 'ses_valid-1');
  assert.throws(() => openCode.virtualSessionId('opencode-session:../invalid'), /Invalid OpenCode Session ID/);
});

test('OpenCode rejects missing timestamps instead of inventing epoch evidence', () => {
  const parsed = openCode.parseHistory(fixture);
  parsed.messages[0].info.time.created = 'not-a-timestamp';
  assert.throws(() => openCode.historyToEvents(parsed), /Invalid OpenCode timestamp/);
});
