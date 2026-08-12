const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');
const { SCHEMA_VERSION } = require('./event-schema');
const { readEvents, replaceEvents } = require('./event-store');
const { sha256 } = require('./hashing');
const { mergePrivacyReports, scanAndRedact } = require('./privacy-scanner');

const TRACE_FORMAT = 'agent-trace-workbench-trace';
const BUNDLE_VERSION = '2.0';
const MAX_ENTRIES = 256;
const MAX_UNCOMPRESSED_BYTES = 512 * 1024 * 1024;

function buildBundle(sessionDir, config = {}, diagnostics = {}) {
  const { events, errors } = readEvents(sessionDir);
  const files = new Map();
  const privacyReports = [];

  const safeEvents = scanAndRedact(events);
  privacyReports.push(safeEvents.report);
  const eventsText = safeEvents.value.length ? `${safeEvents.value.map(JSON.stringify).join('\n')}\n` : '';
  files.set('events.jsonl', eventsText);

  const safeMetadata = scanAndRedact(buildMetadata(sessionDir, config));
  privacyReports.push(safeMetadata.report);
  files.set('metadata.json', jsonText(safeMetadata.value));

  const safeDiagnostics = scanAndRedact(diagnostics);
  privacyReports.push(safeDiagnostics.report);
  files.set('diagnostics.json', jsonText(safeDiagnostics.value));

  addRawTraceFiles(files, privacyReports, sessionDir);
  const privacyReport = mergePrivacyReports(privacyReports);
  const models = [...new Set(events.map((event) => event.model).filter(Boolean))];
  const protocols = [...new Set(events.map((event) => event.content?.protocol).filter(Boolean))];
  const manifest = {
    format: TRACE_FORMAT,
    bundle_version: BUNDLE_VERSION,
    schema_version: SCHEMA_VERSION,
    session_id: String(config.id || path.basename(sessionDir)),
    created_at: new Date().toISOString(),
    agent_adapter: config.agent || inferAgent(events),
    protocol_adapters: protocols,
    models,
    source_parse_errors: errors.length,
    replay_mode: 'historical_playback',
    redaction: {
      applied: true,
      findings: privacyReport.findings,
      share_status: privacyReport.share_status,
    },
  };
  files.set('manifest.json', jsonText(manifest));
  files.set('privacy-report.json', jsonText(privacyReport));

  const hashes = Object.fromEntries([...files.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, content]) => [name, sha256(content)]));
  const checksums = Object.entries(hashes).map(([name, digest]) => `${digest}  ${name}`).join('\n') + '\n';
  const zip = new AdmZip();
  for (const [name, content] of [...files.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    zip.addFile(name, Buffer.from(content));
  }
  zip.addFile('checksums.txt', Buffer.from(checksums));
  return { buffer: zip.toBuffer(), manifest, metadata: safeMetadata.value, privacyReport, hashes };
}

function importBundle(buffer, sessionDir) {
  const parsed = parseBundle(buffer);
  const { manifest, metadata, diagnostics, privacyReport, events, entries, verifiedNames } = parsed;

  fs.mkdirSync(sessionDir, { recursive: true });
  replaceEvents(sessionDir, events, { allowUnknown: true });
  fs.writeFileSync(path.join(sessionDir, 'bundle-manifest.json'), jsonText(manifest));
  if (Object.keys(metadata).length) fs.writeFileSync(path.join(sessionDir, 'trace-metadata.json'), jsonText(metadata));
  if (diagnostics) fs.writeFileSync(path.join(sessionDir, 'diagnostics-result.json'), jsonText(diagnostics));
  if (privacyReport) fs.writeFileSync(path.join(sessionDir, 'privacy-report.json'), jsonText(privacyReport));
  restoreRawEntries(entries, verifiedNames, sessionDir);
  return {
    manifest,
    metadata,
    privacyReport,
    events: events.length,
    format: parsed.format,
    verifiedFiles: parsed.verifiedFiles,
  };
}

function readBundle(buffer) {
  const parsed = parseBundle(buffer);
  return {
    manifest: parsed.manifest,
    metadata: parsed.metadata,
    diagnostics: parsed.diagnostics,
    privacyReport: parsed.privacyReport,
    events: parsed.events,
    format: parsed.format,
    verifiedFiles: parsed.verifiedFiles,
  };
}

function parseBundle(buffer) {
  const zip = new AdmZip(buffer);
  const entries = validateEntries(zip.getEntries());
  const manifest = readEntryJson(entries, 'manifest.json');
  if (!manifest) throw new Error('Trace is missing manifest.json');

  const isV2 = manifest.format === TRACE_FORMAT && manifest.bundle_version === BUNDLE_VERSION;
  if (manifest.format && manifest.format !== TRACE_FORMAT) throw new Error(`Unsupported trace format: ${manifest.format}`);
  if (manifest.bundle_version && !['1.0', BUNDLE_VERSION].includes(String(manifest.bundle_version))) {
    throw new Error(`Unsupported bundle version: ${manifest.bundle_version}`);
  }

  let verifiedNames;
  if (isV2) {
    validateV2Manifest(manifest);
    for (const required of ['events.jsonl', 'metadata.json', 'diagnostics.json', 'privacy-report.json', 'checksums.txt']) {
      if (!entries.has(required)) throw new Error(`Trace is missing ${required}`);
    }
    verifiedNames = verifyChecksums(entries);
  } else {
    verifiedNames = verifyLegacyHashes(entries);
  }

  const eventsText = readEntryText(entries, 'events.jsonl');
  if (eventsText === null) throw new Error('Trace is missing events.jsonl');
  const events = parseJsonl(eventsText, 'events.jsonl');
  if (isV2) events.forEach((event, index) => validateV2Event(event, index));
  const metadata = readEntryJson(entries, 'metadata.json') || {};
  const diagnostics = readEntryJson(entries, 'diagnostics.json');
  const privacyReport = readEntryJson(entries, 'privacy-report.json');
  if (isV2 && privacyReport?.share_status !== 'manual_review_required') throw new Error('Trace privacy report must require manual review');
  return {
    manifest,
    metadata,
    diagnostics,
    privacyReport,
    events,
    format: isV2 ? TRACE_FORMAT : 'legacy-session-bundle',
    verifiedFiles: verifiedNames.size,
    entries,
    verifiedNames,
  };
}

function readBundleManifest(buffer) {
  const zip = new AdmZip(buffer);
  const entries = validateEntries(zip.getEntries());
  const manifest = readEntryJson(entries, 'manifest.json');
  if (!manifest) throw new Error('Trace is missing manifest.json');
  return manifest;
}

function addRawTraceFiles(files, privacyReports, sessionDir) {
  const apiCallsDir = path.join(sessionDir, 'raw', 'api-calls');
  if (fs.existsSync(apiCallsDir)) {
    for (const entry of fs.readdirSync(apiCallsDir, { withFileTypes: true }).filter((item) => item.isFile() && item.name.endsWith('.jsonl')).sort((a, b) => a.name.localeCompare(b.name))) {
      const result = sanitizeJsonlWithReport(path.join(apiCallsDir, entry.name));
      files.set(`raw/api-calls/${entry.name}`, result.text);
      privacyReports.push(result.report);
    }
  }

  const captureFile = path.join(sessionDir, 'gateway-capture.jsonl');
  if (fs.existsSync(captureFile)) {
    const result = sanitizeJsonlWithReport(captureFile);
    files.set('raw/gateway-capture.redacted.jsonl', result.text);
    privacyReports.push(result.report);
  }

  const interceptFile = path.join(sessionDir, 'https-intercepts.json');
  if (fs.existsSync(interceptFile)) {
    let value;
    try { value = JSON.parse(fs.readFileSync(interceptFile, 'utf8')); } catch { value = { error: 'Legacy intercept file could not be parsed' }; }
    const result = scanAndRedact(value);
    files.set('raw/legacy-intercepts.redacted.json', jsonText(result.value));
    privacyReports.push(result.report);
  }
}

function buildMetadata(sessionDir, config) {
  return {
    session: {
      id: String(config.id || path.basename(sessionDir)),
      name: String(config.name || config.id || path.basename(sessionDir)),
      created_at: config.createdAt || null,
      state: config.state || 'unknown',
      agent: config.agent || 'unknown',
      capture_mode: config.captureMode || null,
    },
    provenance: {
      exported_by: 'agent-trace-workbench',
      source: 'local-session',
    },
  };
}

function sanitizeJsonl(file) {
  return sanitizeJsonlWithReport(file).text;
}

function sanitizeJsonlWithReport(file) {
  const reports = [];
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean).map((line) => {
    try {
      const result = scanAndRedact(JSON.parse(line));
      reports.push(result.report);
      return JSON.stringify(result.value);
    } catch {
      return JSON.stringify({ error: 'Unparseable capture record omitted' });
    }
  });
  return { text: lines.length ? `${lines.join('\n')}\n` : '', report: mergePrivacyReports(reports) };
}

function validateEntries(entries) {
  if (entries.length > MAX_ENTRIES) throw new Error('Trace contains too many entries');
  let totalSize = 0;
  const result = new Map();
  for (const entry of entries) {
    const normalized = entry.entryName.replace(/\\/g, '/');
    if (!normalized || normalized.startsWith('/') || /^[A-Za-z]:/.test(normalized) || normalized.split('/').includes('..') || normalized.includes('\0')) {
      throw new Error(`Unsafe trace entry: ${entry.entryName}`);
    }
    if (result.has(normalized)) throw new Error(`Duplicate trace entry: ${normalized}`);
    totalSize += Number(entry.header?.size || 0);
    if (totalSize > MAX_UNCOMPRESSED_BYTES) throw new Error('Trace uncompressed size exceeds limit');
    if (!entry.isDirectory) result.set(normalized, entry);
  }
  return result;
}

function verifyChecksums(entries) {
  const text = readEntryText(entries, 'checksums.txt');
  const expected = new Map();
  for (const [index, line] of String(text || '').split(/\r?\n/).entries()) {
    if (!line.trim()) continue;
    const match = line.match(/^([a-fA-F0-9]{64})\s{2}(.+)$/);
    if (!match) throw new Error(`Invalid checksums.txt line ${index + 1}`);
    const name = match[2].replace(/\\/g, '/');
    if (name === 'checksums.txt') throw new Error('checksums.txt must not checksum itself');
    if (expected.has(name)) throw new Error(`Duplicate checksum entry: ${name}`);
    expected.set(name, match[1].toLowerCase());
  }
  for (const [name, entry] of entries) {
    if (name === 'checksums.txt') continue;
    if (!expected.has(name)) throw new Error(`Trace entry is not checksummed: ${name}`);
    if (sha256(entry.getData()) !== expected.get(name)) throw new Error(`${name} checksum mismatch`);
  }
  for (const name of expected.keys()) if (!entries.has(name)) throw new Error(`Checksummed entry is missing: ${name}`);
  return new Set(expected.keys());
}

function validateV2Manifest(manifest) {
  for (const field of ['format', 'bundle_version', 'schema_version', 'session_id', 'created_at', 'agent_adapter', 'protocol_adapters', 'models', 'replay_mode', 'redaction']) {
    if (!Object.hasOwn(manifest, field)) throw new Error(`Trace manifest is missing ${field}`);
  }
  if (manifest.schema_version !== SCHEMA_VERSION) throw new Error(`Unsupported trace schema version: ${manifest.schema_version}`);
  if (!manifest.session_id || typeof manifest.session_id !== 'string') throw new Error('Trace manifest has an invalid session_id');
  if (!Number.isFinite(new Date(manifest.created_at).getTime())) throw new Error('Trace manifest has an invalid created_at');
  if (!Array.isArray(manifest.protocol_adapters) || !Array.isArray(manifest.models)) throw new Error('Trace manifest adapter/model fields must be arrays');
  if (manifest.replay_mode !== 'historical_playback') throw new Error('Trace manifest has an unsupported replay mode');
  if (manifest.redaction?.share_status !== 'manual_review_required') throw new Error('Trace manifest must require manual review');
}

function validateV2Event(event, index) {
  if (!event || typeof event !== 'object' || Array.isArray(event)) throw new Error(`Invalid events.jsonl line ${index + 1}: event must be an object`);
  for (const field of ['schema_version', 'session_id', 'request_id', 'agent', 'provider', 'model', 'event_type', 'timestamp', 'content', 'source']) {
    if (!Object.hasOwn(event, field)) throw new Error(`Invalid events.jsonl line ${index + 1}: missing ${field}`);
  }
  if (event.schema_version !== SCHEMA_VERSION) throw new Error(`Invalid events.jsonl line ${index + 1}: unsupported schema ${event.schema_version}`);
  if (!event.event_type || typeof event.event_type !== 'string') throw new Error(`Invalid events.jsonl line ${index + 1}: invalid event_type`);
  if (!Number.isFinite(new Date(event.timestamp).getTime())) throw new Error(`Invalid events.jsonl line ${index + 1}: invalid timestamp`);
}

function verifyLegacyHashes(entries) {
  const hashes = readEntryJson(entries, 'hashes.json');
  if (!hashes || !entries.has('events.jsonl')) throw new Error('Legacy bundle is missing hashes.json or events.jsonl');
  const verified = new Set();
  for (const [name, digest] of Object.entries(hashes)) {
    const entry = entries.get(name);
    if (!entry) throw new Error(`Hashed entry is missing: ${name}`);
    if (name === 'diagnostics.json') continue;
    if (sha256(entry.getData()) !== digest) throw new Error(`${name} hash mismatch`);
    verified.add(name);
  }
  if (!verified.has('events.jsonl')) throw new Error('events.jsonl is not hash verified');
  return verified;
}

function restoreRawEntries(entries, verifiedNames, sessionDir) {
  for (const name of verifiedNames) {
    if (!name.startsWith('raw/')) continue;
    const destination = path.resolve(sessionDir, name.replaceAll('/', path.sep));
    const root = path.resolve(sessionDir);
    if (!destination.startsWith(`${root}${path.sep}`)) throw new Error(`Unsafe raw trace entry: ${name}`);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, entries.get(name).getData());
  }
}

function parseJsonl(text, name) {
  return String(text).split(/\r?\n/).filter(Boolean).map((line, index) => {
    try { return JSON.parse(line); } catch { throw new Error(`Invalid ${name} line ${index + 1}`); }
  });
}

function readEntryJson(entries, name) {
  const text = readEntryText(entries, name);
  if (text === null) return null;
  try { return JSON.parse(text); } catch { throw new Error(`Invalid ${name}`); }
}

function readEntryText(entries, name) {
  const entry = entries.get(name);
  return entry ? entry.getData().toString('utf8') : null;
}

function jsonText(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function inferAgent(events) {
  return events.find((event) => event.agent && event.agent !== 'unknown')?.agent || 'unknown';
}

module.exports = {
  BUNDLE_VERSION,
  MAX_ENTRIES,
  MAX_UNCOMPRESSED_BYTES,
  TRACE_FORMAT,
  buildBundle,
  importBundle,
  readBundle,
  readBundleManifest,
  sanitizeJsonl,
};
