const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { once } = require('events');
const { createEvent } = require('./event-schema');
const { sha256, stableStringify } = require('./hashing');

const EVENT_FILE = 'events.jsonl';
const cache = new Map();

function eventFile(sessionDir) {
  return path.join(sessionDir, EVENT_FILE);
}

function eventFingerprint(event) {
  return sha256(stableStringify(event));
}

function loadFingerprints(file) {
  const stat = fs.existsSync(file) ? fs.statSync(file) : null;
  const cached = cache.get(file);
  if (cached && stat && cached.size === stat.size && cached.mtimeMs === stat.mtimeMs) return cached.values;
  const values = new Set();
  if (stat) {
    for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean)) {
      try { values.add(eventFingerprint(JSON.parse(line))); } catch {}
    }
  }
  cache.set(file, { values, size: stat?.size || 0, mtimeMs: stat?.mtimeMs || 0 });
  return values;
}

function appendEvents(sessionDir, inputs) {
  fs.mkdirSync(sessionDir, { recursive: true });
  const file = eventFile(sessionDir);
  const fingerprints = loadFingerprints(file);
  const lines = [];
  for (const input of inputs || []) {
    const event = createEvent(input);
    const fingerprint = eventFingerprint(event);
    if (fingerprints.has(fingerprint)) continue;
    fingerprints.add(fingerprint);
    lines.push(JSON.stringify(event));
  }
  if (!lines.length) return { appended: 0, file };
  const fd = fs.openSync(file, 'a');
  try {
    fs.writeSync(fd, `${lines.join('\n')}\n`);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  const stat = fs.statSync(file);
  cache.set(file, { values: fingerprints, size: stat.size, mtimeMs: stat.mtimeMs });
  return { appended: lines.length, file };
}

function readEvents(sessionDir, { allowUnknown = true } = {}) {
  const file = eventFile(sessionDir);
  const events = [];
  const errors = [];
  if (!fs.existsSync(file)) return { events, errors, file };
  fs.readFileSync(file, 'utf8').split(/\r?\n/).forEach((line, index) => {
    if (!line.trim()) return;
    try {
      const event = JSON.parse(line);
      if (!allowUnknown) createEvent(event);
      events.push(event);
    } catch (error) {
      errors.push({ line: index + 1, message: error.message });
    }
  });
  return { events, errors, file };
}

async function readEventPage(sessionDir, options = {}) {
  const file = eventFile(sessionDir);
  const type = String(options.type || '').trim();
  const offset = Math.max(0, Number.parseInt(options.offset, 10) || 0);
  const limit = Math.min(500, Math.max(1, Number.parseInt(options.limit, 10) || 100));
  const events = [];
  const errors = [];
  const types = {};
  let total = 0;
  let filteredTotal = 0;
  let parseErrorCount = 0;
  let lineNumber = 0;
  let reasoning = false;

  if (!fs.existsSync(file)) return pageResult();
  const input = fs.createReadStream(file, { encoding: 'utf8' });
  const lines = readline.createInterface({ input, crlfDelay: Infinity });
  for await (const line of lines) {
    lineNumber += 1;
    if (!line.trim()) continue;
    let event;
    try {
      event = JSON.parse(line);
    } catch (error) {
      parseErrorCount += 1;
      if (errors.length < 100) errors.push({ line: lineNumber, message: error.message });
      continue;
    }
    total += 1;
    const eventType = String(event.event_type || 'unknown');
    types[eventType] = (types[eventType] || 0) + 1;
    if (eventType === 'reasoning') reasoning = true;
    if (type && eventType !== type) continue;
    if (filteredTotal >= offset && events.length < limit) events.push(event);
    filteredTotal += 1;
  }
  // On Windows, readline can finish before the underlying file descriptor has
  // emitted close. Waiting here keeps callers from racing cleanup or replacement
  // of the session directory, which is especially visible in rapid CI reruns.
  if (!input.closed) await once(input, 'close');
  return pageResult();

  function pageResult() {
    const nextOffset = offset + events.length;
    return {
      events,
      errors,
      parseErrorCount,
      total,
      filteredTotal,
      offset,
      limit,
      nextOffset,
      hasMore: nextOffset < filteredTotal,
      types,
      reasoning: reasoning ? 'available' : 'unavailable',
      file,
    };
  }
}

function replaceEvents(sessionDir, inputs, { allowUnknown = false } = {}) {
  fs.mkdirSync(sessionDir, { recursive: true });
  const file = eventFile(sessionDir);
  const temp = `${file}.tmp-${process.pid}`;
  const seen = new Set();
  const events = [];
  for (const input of inputs || []) {
    const event = allowUnknown ? normalizeImportedEvent(input) : createEvent(input);
    const fingerprint = eventFingerprint(event);
    if (seen.has(fingerprint)) continue;
    seen.add(fingerprint);
    events.push(event);
  }
  fs.writeFileSync(temp, events.length ? `${events.map(JSON.stringify).join('\n')}\n` : '');
  fs.renameSync(temp, file);
  cache.delete(file);
  return { written: events.length, file };
}

function normalizeImportedEvent(input) {
  if (!input || typeof input !== 'object' || !input.event_type) throw new Error('Imported event is missing event_type');
  try { return createEvent(input); } catch (error) {
    if (!/Unsupported trace event type/.test(error.message)) throw error;
    return JSON.parse(JSON.stringify(input));
  }
}

module.exports = { EVENT_FILE, appendEvents, eventFile, eventFingerprint, readEventPage, readEvents, replaceEvents };
