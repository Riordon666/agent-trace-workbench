const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const gemini = require('../workbench/adapters/agents/gemini-cli');

const fixture = path.join(__dirname, 'fixtures', 'agents', 'gemini-cli', 'session-v1.jsonl');

test('Gemini CLI JSONL maps official chat records, rewind, thoughts, tools and tokens', () => {
  const parsed = gemini.parseHistory(fixture);
  assert.equal(parsed.formatVersion, 'gemini-jsonl-v1');
  assert.equal(parsed.metadata.sessionId, 'gemini-synthetic-session');
  assert.equal(parsed.metadata.summary, 'Synthetic Gemini Session');
  assert.equal(parsed.messages.some((message) => message.id === 'user-rewound'), false);
  const events = gemini.historyToEvents(parsed, { session_id: 'imported-gemini' });
  assert.equal(events.some((event) => event.event_type === 'user_message' && event.content.text.includes('synthetic project')), true);
  assert.equal(events.some((event) => event.event_type === 'reasoning' && event.content.kind === 'summary'), true);
  assert.equal(events.some((event) => event.event_type === 'tool_call' && event.content.name === 'read_file'), true);
  assert.equal(events.some((event) => event.event_type === 'tool_result' && event.content.call_id === 'tool-1'), true);
  assert.equal(events.some((event) => event.event_type === 'assistant_message' && event.model === 'gemini-synthetic-model'), true);
  assert.equal(events.some((event) => event.event_type === 'request_start' && event.content.inferred_from_message_sequence === true), true);
  assert.equal(events.some((event) => event.event_type === 'request_end' && event.content.complete === true), true);
  assert.equal(events.some((event) => event.event_type === 'session_end' && event.content.inferred_from_history_snapshot === true), true);
  const usage = events.find((event) => event.event_type === 'usage').content;
  assert.deepEqual(usage, { input_tokens: 120, output_tokens: 30, cached_input_tokens: 20, reasoning_output_tokens: 4, tool_input_tokens: 6, total_tokens: 180 });
  assert.equal(events.every((event) => event.agent === 'gemini-cli' && event.source === 'agent-history'), true);
});

test('Gemini CLI discovers project-scoped chats and reports the installed version', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gemini-adapter-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const chats = path.join(root, '.gemini', 'tmp', 'synthetic-project', 'chats');
  fs.mkdirSync(chats, { recursive: true });
  fs.copyFileSync(fixture, path.join(chats, 'session-2026-synthetic.jsonl'));
  const histories = gemini.discoverLocalSessions({
    env: { GEMINI_CLI_HOME: root },
    homeDir: root,
    spawnSync: () => ({ status: 0, stdout: '9.9.9-synthetic\n', stderr: '' }),
  });
  assert.equal(histories.length, 1);
  assert.equal(histories[0].sessionId, 'gemini-synthetic-session');
  assert.equal(histories[0].formatVersion, 'gemini-jsonl-v1');
  assert.equal(histories[0].agentVersion, '9.9.9-synthetic');
});

test('Gemini CLI detects main protocol requests without treating summaries as main', () => {
  assert.equal(gemini.classifyRequest({ body: { contents: [{ parts: [{ text: 'Implement the task' }] }] } }), 'main');
  assert.equal(gemini.classifyRequest({ body: { contents: [{ parts: [{ text: 'Summarize the conversation' }] }] } }), 'side-summary');
});
