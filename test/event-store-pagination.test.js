const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { appendEvents, readEventPage } = require('../workbench/core/event-store');

test('event pages are bounded, filtered, counted, and ordered', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'atw-event-page-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const events = Array.from({ length: 235 }, (_, index) => ({
    session_id: 'page-test', request_id: `r-${index}`, agent: 'fixture', provider: 'openai', model: 'gpt-5',
    event_type: index % 5 === 0 ? 'reasoning' : 'assistant_message',
    timestamp: new Date(1_700_000_000_000 + index).toISOString(), content: { index }, source: 'fixture',
  }));
  appendEvents(dir, events);

  const first = await readEventPage(dir, { limit: 100 });
  assert.equal(first.events.length, 100);
  assert.equal(first.total, 235);
  assert.equal(first.filteredTotal, 235);
  assert.equal(first.hasMore, true);
  assert.equal(first.nextOffset, 100);
  assert.equal(first.reasoning, 'available');
  assert.equal(first.events[0].content.index, 0);

  const filtered = await readEventPage(dir, { type: 'reasoning', offset: 40, limit: 20 });
  assert.equal(filtered.filteredTotal, 47);
  assert.equal(filtered.events.length, 7);
  assert.equal(filtered.events[0].content.index, 200);
  assert.equal(filtered.hasMore, false);
  assert.equal(filtered.types.reasoning, 47);
});
