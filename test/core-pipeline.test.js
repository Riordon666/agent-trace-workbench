const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const AdmZip = require('adm-zip');
const { appendEvents, readEvents } = require('../workbench/core/event-store');
const { diagnoseEvents } = require('../workbench/core/diagnostics');
const { buildBundle, importBundle, readBundle } = require('../workbench/core/bundle');
const { sha256 } = require('../workbench/core/hashing');
const { scanAndRedact } = require('../workbench/core/privacy-scanner');
const { findSecrets, redactCredentials, redactHeaders } = require('../workbench/core/redaction');

function tempDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-trace-core-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function syntheticEvent(overrides = {}) {
  return { session_id: 'synthetic', request_id: 'req-1', agent: 'codex-cli', provider: 'openai', model: 'gpt-synthetic-full-model', event_type: 'request_start', timestamp: '2026-01-01T00:00:00Z', content: { protocol: 'openai-responses' }, source: 'fixture', ...overrides };
}

function replaceChecksummedEntry(zip, name, content) {
  const buffer = Buffer.isBuffer(content) ? content : Buffer.from(content);
  zip.updateFile(name, buffer);
  const checksums = zip.readAsText('checksums.txt').split(/\r?\n/).map((line) => line.endsWith(`  ${name}`) ? `${sha256(buffer)}  ${name}` : line).join('\n');
  zip.updateFile('checksums.txt', Buffer.from(checksums));
}

test('event store appends durably, deduplicates and recovers past a malformed tail', (t) => {
  const dir = tempDir(t);
  assert.equal(appendEvents(dir, [syntheticEvent(), syntheticEvent()]).appended, 1);
  fs.appendFileSync(path.join(dir, 'events.jsonl'), '{broken\n');
  const parsed = readEvents(dir);
  assert.equal(parsed.events.length, 1);
  assert.equal(parsed.errors.length, 1);
});

test('diagnostics are non-blocking and report incomplete requests and unavailable reasoning', () => {
  const result = diagnoseEvents([syntheticEvent()]);
  assert.equal(result.non_blocking, true);
  assert.ok(result.items.some((item) => item.code === 'incomplete_request'));
  assert.ok(result.items.some((item) => item.code === 'reasoning_unavailable'));
});

test('bundle round trip verifies hashes and redacts secrets', (t) => {
  const source = tempDir(t);
  const target = tempDir(t);
  appendEvents(source, [syntheticEvent({ event_type: 'user_message', content: { text: 'token sk-syntheticSecret123456789 from dev@example.test' } })]);
  const rawDir = path.join(source, 'raw', 'api-calls');
  fs.mkdirSync(rawDir, { recursive: true });
  fs.writeFileSync(path.join(rawDir, 'synthetic_apicall.jsonl'), `${JSON.stringify({ signature: 'protocol-signature', headers: { authorization: 'Bearer synthetic-token-1234' } })}\n`);
  const diagnostics = diagnoseEvents(readEvents(source).events);
  const bundle = buildBundle(source, { id: 'synthetic', agent: 'codex-cli' }, diagnostics);
  assert.equal(bundle.manifest.format, 'agent-trace-workbench-trace');
  assert.equal(bundle.manifest.bundle_version, '2.0');
  assert.equal(bundle.manifest.replay_mode, 'historical_playback');
  assert.equal(bundle.privacyReport.share_status, 'manual_review_required');
  assert.ok(bundle.privacyReport.findings >= 3);
  assert.equal(findSecrets(bundle.buffer.toString('latin1')).length, 0);
  const imported = importBundle(bundle.buffer, target);
  assert.equal(imported.events, 1);
  assert.ok(imported.verifiedFiles >= 6);
  assert.match(readEvents(target).events[0].content.text, /\[REDACTED\]/);
  assert.equal(fs.readFileSync(path.join(target, 'raw', 'api-calls', 'synthetic_apicall.jsonl'), 'utf8').includes('protocol-signature'), true);
  assert.equal(fs.readFileSync(path.join(target, 'raw', 'api-calls', 'synthetic_apicall.jsonl'), 'utf8').includes('synthetic-token'), false);
});

test('portable trace can be verified and read without creating an import directory', (t) => {
  const source = tempDir(t);
  const untouched = path.join(tempDir(t), 'must-not-exist');
  appendEvents(source, [syntheticEvent()]);
  const bundle = buildBundle(source, { id: 'synthetic' }, {});
  const parsed = readBundle(bundle.buffer);
  assert.equal(parsed.events.length, 1);
  assert.equal(parsed.manifest.session_id, 'synthetic');
  assert.equal(parsed.verifiedFiles >= 5, true);
  assert.equal(fs.existsSync(untouched), false);

  const tampered = new AdmZip(bundle.buffer);
  tampered.updateFile('events.jsonl', Buffer.from('{}\n'));
  assert.throws(() => readBundle(tampered.toBuffer()), /checksum mismatch/);
  assert.equal(fs.existsSync(untouched), false);
});

test('portable trace rejects modified or unchecked entries', (t) => {
  const source = tempDir(t);
  const target = tempDir(t);
  appendEvents(source, [syntheticEvent()]);
  const bundle = buildBundle(source, { id: 'synthetic' }, diagnoseEvents(readEvents(source).events));
  const modified = new AdmZip(bundle.buffer);
  modified.updateFile('metadata.json', Buffer.from('{"tampered":true}\n'));
  assert.throws(() => importBundle(modified.toBuffer(), target), /metadata\.json checksum mismatch/);

  const extra = new AdmZip(bundle.buffer);
  extra.addFile('unchecked.txt', Buffer.from('not covered'));
  assert.throws(() => importBundle(extra.toBuffer(), target), /not checksummed/);

  const invalidEvent = new AdmZip(bundle.buffer);
  replaceChecksummedEntry(invalidEvent, 'events.jsonl', '{}\n');
  assert.throws(() => importBundle(invalidEvent.toBuffer(), target), /missing schema_version/);

  const invalidPrivacy = new AdmZip(bundle.buffer);
  replaceChecksummedEntry(invalidPrivacy, 'privacy-report.json', JSON.stringify({ share_status: 'safe_to_share' }));
  assert.throws(() => importBundle(invalidPrivacy.toBuffer(), target), /must require manual review/);

  const selfChecksum = new AdmZip(bundle.buffer);
  selfChecksum.updateFile('checksums.txt', Buffer.from(`${selfChecksum.readAsText('checksums.txt')}\n${'0'.repeat(64)}  checksums.txt\n`));
  assert.throws(() => importBundle(selfChecksum.toBuffer(), target), /must not checksum itself/);
});

test('portable trace importer remains compatible with legacy v1 bundles', (t) => {
  const target = tempDir(t);
  const eventsText = `${JSON.stringify(syntheticEvent())}\n`;
  const zip = new AdmZip();
  zip.addFile('manifest.json', Buffer.from(JSON.stringify({ bundle_version: '1.0', schema_version: '1.0', session_id: 'legacy' })));
  zip.addFile('events.jsonl', Buffer.from(eventsText));
  zip.addFile('diagnostics.json', Buffer.from('{}'));
  zip.addFile('hashes.json', Buffer.from(JSON.stringify({ 'events.jsonl': sha256(eventsText), 'diagnostics.json': sha256({}) })));
  const imported = importBundle(zip.toBuffer(), target);
  assert.equal(imported.format, 'legacy-session-bundle');
  assert.equal(imported.events, 1);
});

test('privacy scanner classifies credentials and personal data without promising safe sharing', () => {
  const result = scanAndRedact({
    authorization: 'Bearer field-secret',
    cookie: 'session=secret',
    notes: [
      'sk-syntheticSecret123456789',
      'sk-ant-syntheticSecret123456789',
      `ghp_${'a'.repeat(30)}`,
      `AKIA${'A'.repeat(16)}`,
      'dev@example.test',
      '192.0.2.44',
      'C:\\Users\\Example\\project\\file.js',
      '/home/example/project/file.js',
    ],
  });
  for (const category of ['authorization_field', 'cookie_field', 'openai_api_key', 'anthropic_api_key', 'github_token', 'aws_access_key', 'email', 'ip_address', 'windows_home_path', 'posix_home_path']) {
    assert.ok(result.report.by_category[category] >= 1, `missing ${category}`);
  }
  assert.equal(result.report.share_status, 'manual_review_required');
  assert.equal(result.report.manual_review_required, true);
  assert.ok(result.report.by_severity.critical >= 6);
  assert.ok(result.report.by_severity.warning >= 3);
  assert.ok(result.report.by_severity.info >= 1);
  assert.equal(JSON.stringify(result.value).includes('Example'), false);
});

test('redaction covers headers, nested credential fields and token-like text', () => {
  assert.equal(redactHeaders({ Authorization: 'Bearer secret' }).Authorization, '[REDACTED]');
  assert.deepEqual(redactCredentials({ nested: { api_key: 'secret' } }), { nested: { api_key: '[REDACTED]' } });
  assert.equal(findSecrets('sk-syntheticSecret123456789').length, 1);
});

test('event readers preserve unknown future event types', (t) => {
  const dir = tempDir(t);
  const future = { ...syntheticEvent(), event_type: 'future_protocol_marker', schema_version: '2.0' };
  fs.writeFileSync(path.join(dir, 'events.jsonl'), `${JSON.stringify(future)}\n`);
  const parsed = readEvents(dir);
  assert.equal(parsed.events[0].event_type, 'future_protocol_marker');
  assert.ok(diagnoseEvents(parsed.events).items.some((item) => item.code === 'unknown_event_type'));
});
