#!/usr/bin/env node

const fs = require('fs');
const http = require('http');
const net = require('net');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const { MAX_UNCOMPRESSED_BYTES, buildBundle, importBundle, readBundle, readBundleManifest } = require('../workbench/core/bundle');
const { diagnoseEvents } = require('../workbench/core/diagnostics');
const { readEvents } = require('../workbench/core/event-store');
const { compareTraceEvents } = require('../workbench/core/trace-diff');

const ROOT = path.resolve(__dirname, '..');
const PACKAGE = require(path.join(ROOT, 'package.json'));
const DEFAULT_PORT = 5177;

function resolveDataDir(env = process.env, platform = process.platform, homeDir = os.homedir()) {
  if (env.ATW_DATA_DIR) return path.resolve(env.ATW_DATA_DIR);
  if (platform === 'win32') {
    return path.join(env.LOCALAPPDATA || env.APPDATA || path.join(homeDir, 'AppData', 'Local'), 'agent-trace-workbench');
  }
  if (platform === 'darwin') return path.join(homeDir, 'Library', 'Application Support', 'agent-trace-workbench');
  return path.join(env.XDG_DATA_HOME || path.join(homeDir, '.local', 'share'), 'agent-trace-workbench');
}

function runtimeEnv(projectRoot = process.cwd(), env = process.env) {
  const dataDir = resolveDataDir(env);
  return {
    ...env,
    WORKBENCH_SESSIONS_DIR: env.WORKBENCH_SESSIONS_DIR || path.join(dataDir, 'sessions'),
    WORKBENCH_CERT_DIR: env.WORKBENCH_CERT_DIR || path.join(dataDir, 'certs'),
    WORKBENCH_WALLPAPER_DIR: env.WORKBENCH_WALLPAPER_DIR || path.join(dataDir, 'wallpapers'),
    WORKBENCH_ANNOTATION_EXPORT_DIR: env.WORKBENCH_ANNOTATION_EXPORT_DIR || path.join(dataDir, 'exports'),
    WORKBENCH_PROJECT_ROOT: env.WORKBENCH_PROJECT_ROOT || path.resolve(projectRoot),
  };
}

function parseArgs(argv) {
  const result = { command: 'start', port: null, open: true, help: false, version: false, target: null, compareTarget: null, output: null, sessionId: null, json: false, failOnRegression: false, thresholds: null };
  const values = [...argv];
  if (values[0] && !values[0].startsWith('-')) result.command = values.shift();
  while (values.length) {
    const value = values.shift();
    if (value === '--port' || value === '-p') result.port = Number(values.shift());
    else if (value === '--output' || value === '-o') result.output = requiredOptionValue(value, values.shift());
    else if (value === '--session-id') result.sessionId = requiredOptionValue(value, values.shift());
    else if (value === '--thresholds') result.thresholds = requiredOptionValue(value, values.shift());
    else if (value === '--json') result.json = true;
    else if (value === '--fail-on-regression') result.failOnRegression = true;
    else if (value === '--no-open') result.open = false;
    else if (value === '--help' || value === '-h') result.help = true;
    else if (value === '--version' || value === '-v') result.version = true;
    else if (!value.startsWith('-') && !result.target) result.target = value;
    else if (!value.startsWith('-') && !result.compareTarget) result.compareTarget = value;
    else throw new Error(`Unknown option: ${value}`);
  }
  if (result.port !== null && (!Number.isInteger(result.port) || result.port < 1 || result.port > 65535)) {
    throw new Error('Port must be an integer between 1 and 65535.');
  }
  if (result.compareTarget && result.command !== 'diff') throw new Error(`Unexpected positional argument: ${result.compareTarget}`);
  if (result.command !== 'diff' && (result.json || result.failOnRegression || result.thresholds)) {
    throw new Error('--json, --fail-on-regression, and --thresholds are only valid with atw diff.');
  }
  return result;
}

function requiredOptionValue(option, value) {
  if (!value || value.startsWith('-')) throw new Error(`${option} requires a value.`);
  return value;
}

function canListen(port, host = '127.0.0.1') {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.unref();
    server.once('error', () => resolve(false));
    server.listen(port, host, () => server.close(() => resolve(true)));
  });
}

async function findPort(preferred = DEFAULT_PORT, explicit = false) {
  if (await canListen(preferred)) return preferred;
  if (explicit) throw new Error(`Port ${preferred} is already in use.`);
  for (let port = preferred + 1; port <= Math.min(preferred + 100, 65535); port++) {
    if (await canListen(port)) return port;
  }
  throw new Error(`No available port found between ${preferred} and ${Math.min(preferred + 100, 65535)}.`);
}

function waitForServer(port, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const request = http.get({ host: '127.0.0.1', port, path: '/api/status', timeout: 1000 }, (response) => {
        response.resume();
        if (response.statusCode === 200) resolve();
        else if (Date.now() >= deadline) reject(new Error(`Workbench returned HTTP ${response.statusCode}.`));
        else setTimeout(attempt, 150);
      });
      request.on('timeout', () => request.destroy());
      request.on('error', () => {
        if (Date.now() >= deadline) reject(new Error('Workbench did not become ready in time.'));
        else setTimeout(attempt, 150);
      });
    };
    attempt();
  });
}

function openBrowser(url) {
  let command;
  let args;
  if (process.platform === 'win32') {
    command = 'cmd.exe';
    args = ['/d', '/s', '/c', 'start', '', url];
  } else if (process.platform === 'darwin') {
    command = 'open';
    args = [url];
  } else {
    command = 'xdg-open';
    args = [url];
  }
  const child = spawn(command, args, { detached: true, stdio: 'ignore', windowsHide: true });
  child.on('error', () => {});
  child.unref();
}

function commandExists(command, args = ['--version']) {
  const result = spawnSync(command, args, { stdio: 'ignore', windowsHide: true });
  return !result.error && result.status === 0;
}

async function doctor() {
  const checks = [];
  const env = runtimeEnv();
  const major = Number(process.versions.node.split('.')[0]);
  checks.push({ name: 'Node.js 20+', ok: major >= 20, detail: process.version });
  try {
    require.resolve('node-pty', { paths: [ROOT] });
    checks.push({ name: 'node-pty', ok: true, detail: 'installed' });
  } catch {
    checks.push({ name: 'node-pty', ok: false, detail: 'not installed; run npm install' });
  }
  const opensslAvailable = commandExists('openssl');
  checks.push({ name: 'OpenSSL', ok: opensslAvailable, detail: opensslAvailable ? 'available' : 'required by atw setup' });
  const cert = path.join(env.WORKBENCH_CERT_DIR, 'cert.pem');
  const key = path.join(env.WORKBENCH_CERT_DIR, 'key.pem');
  checks.push({ name: 'MITM certificate', ok: fs.existsSync(cert) && fs.existsSync(key), detail: fs.existsSync(cert) && fs.existsSync(key) ? cert : 'not generated; run atw setup' });
  const defaultPortAvailable = await canListen(DEFAULT_PORT);
  checks.push({ name: `Port ${DEFAULT_PORT}`, ok: defaultPortAvailable, detail: defaultPortAvailable ? 'available' : 'in use; atw will select another port' });
  for (const check of checks) console.log(`${check.ok ? '✓' : '✗'} ${check.name}: ${check.detail}`);
  const required = checks.filter((check) => ['Node.js 20+', 'node-pty', 'OpenSSL'].includes(check.name));
  return required.every((check) => check.ok);
}

function printHelp() {
  console.log(`Agent Trace Workbench ${PACKAGE.version}

Usage:
  atw [start] [--port <port>] [--no-open]
  atw setup
  atw doctor
  atw export <session-id> [--output <file.atwtrace>]
  atw open <file.atwtrace> [--session-id <id>] [--port <port>] [--no-open]
  atw diff <baseline.atwtrace> <candidate.atwtrace> [--json] [--fail-on-regression] [--thresholds <file.json>]
  atw --version

Commands:
  start   Start the local workbench (default)
  setup   Generate the local MITM certificate
  doctor  Check Node.js, native dependencies, OpenSSL, certificate, and port
  export  Create a redacted, checksummed portable trace
  open    Verify/import a trace and open it in the local workbench
  diff    Verify and compare two traces without importing or executing them

Exports always require manual review before sharing. The workbench binds to 127.0.0.1.`);
}

async function start({ port, open }) {
  const selectedPort = await findPort(port || DEFAULT_PORT, port !== null);
  const serverFile = path.join(ROOT, 'workbench', 'server.js');
  const projectRoot = process.cwd();
  const child = spawn(process.execPath, [serverFile, '--port', String(selectedPort)], {
    cwd: projectRoot,
    env: runtimeEnv(projectRoot),
    stdio: 'inherit',
    windowsHide: true,
  });
  child.once('error', (error) => {
    console.error(`Failed to start workbench: ${error.message}`);
    process.exitCode = 1;
  });
  try {
    await waitForServer(selectedPort);
    const url = `http://127.0.0.1:${selectedPort}/`;
    console.log(`Agent Trace Workbench ${PACKAGE.version}: ${url}`);
    if (open) openBrowser(url);
  } catch (error) {
    child.kill('SIGTERM');
    throw error;
  }
  child.once('exit', (code, signal) => {
    process.removeListener('SIGINT', stopOnInterrupt);
    process.removeListener('SIGTERM', stopOnTerminate);
    if (code && !signal) process.exitCode = code;
  });
  const stopChild = (signal) => {
    if (!child.killed) child.kill(signal);
  };
  const stopOnInterrupt = () => stopChild('SIGINT');
  const stopOnTerminate = () => stopChild('SIGTERM');
  process.once('SIGINT', stopOnInterrupt);
  process.once('SIGTERM', stopOnTerminate);
  return child;
}

function exportTrace(options, env = process.env) {
  if (!options.target) throw new Error('Usage: atw export <session-id> [--output <file.atwtrace>]');
  const id = safeSessionId(options.target);
  const runtime = runtimeEnv(process.cwd(), env);
  const sessionDir = path.join(runtime.WORKBENCH_SESSIONS_DIR, id);
  if (!fs.existsSync(sessionDir)) throw new Error(`Session not found: ${id}`);
  const configFile = path.join(sessionDir, 'config.json');
  const config = fs.existsSync(configFile) ? JSON.parse(fs.readFileSync(configFile, 'utf8')) : { id };
  const parsed = readEvents(sessionDir);
  const diagnostics = diagnoseEvents(parsed.events, parsed.errors);
  const bundle = buildBundle(sessionDir, config, diagnostics);
  const output = path.resolve(options.output || `${id}.atwtrace`);
  if (fs.existsSync(output)) throw new Error(`Output already exists: ${output}`);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, bundle.buffer, { flag: 'wx' });
  console.log(`Exported ${output}`);
  console.log(`Privacy scanner redacted ${bundle.privacyReport.findings} finding(s); manual review is required before sharing.`);
  return { output, ...bundle };
}

function importTrace(options, env = process.env) {
  if (!options.target) throw new Error('Usage: atw open <file.atwtrace> [--session-id <id>]');
  const input = path.resolve(options.target);
  if (!fs.existsSync(input) || !fs.statSync(input).isFile()) throw new Error(`Trace not found: ${input}`);
  if (fs.statSync(input).size > MAX_UNCOMPRESSED_BYTES) throw new Error('Trace file exceeds the 512 MiB input limit.');
  const buffer = fs.readFileSync(input);
  const manifest = readBundleManifest(buffer);
  const preferred = options.sessionId || manifest.session_id || path.basename(input, path.extname(input));
  const baseId = safeSessionId(String(preferred));
  const runtime = runtimeEnv(process.cwd(), env);
  const id = availableSessionId(runtime.WORKBENCH_SESSIONS_DIR, baseId);
  const sessionDir = path.join(runtime.WORKBENCH_SESSIONS_DIR, id);
  fs.mkdirSync(sessionDir, { recursive: false });
  try {
    const imported = importBundle(buffer, sessionDir);
    const now = new Date().toISOString();
    const sourceName = imported.metadata?.session?.name || imported.manifest.session_id || baseId;
    fs.writeFileSync(path.join(sessionDir, 'config.json'), JSON.stringify({
      id,
      name: sourceName === id ? id : `${sourceName} (imported)`,
      createdAt: now,
      state: 'imported',
      agent: imported.manifest.agent_adapter || 'unknown',
      bundleImportedAt: now,
      traceFormat: imported.format,
    }, null, 2));
    console.log(`Imported ${imported.events} event(s) into Session ${id}; ${imported.verifiedFiles} file(s) verified.`);
    return { id, sessionDir, imported };
  } catch (error) {
    fs.rmSync(sessionDir, { recursive: true, force: true });
    throw error;
  }
}

function diffTraces(options) {
  if (!options.target || !options.compareTarget) {
    throw new Error('Usage: atw diff <baseline.atwtrace> <candidate.atwtrace> [--json] [--fail-on-regression] [--thresholds <file.json>]');
  }
  const leftPath = path.resolve(options.target);
  const rightPath = path.resolve(options.compareTarget);
  const left = loadTraceForDiff(leftPath);
  const right = loadTraceForDiff(rightPath);
  const thresholds = readDiffThresholds(options.thresholds);
  const result = compareTraceEvents(left.events, right.events, {
    left: traceIdentity(left, leftPath),
    right: traceIdentity(right, rightPath),
    thresholds,
  });
  if (options.json) console.log(JSON.stringify(result, null, 2));
  else printTraceDiff(result);
  return result;
}

function loadTraceForDiff(file) {
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) throw new Error(`Trace not found: ${file}`);
  if (fs.statSync(file).size > MAX_UNCOMPRESSED_BYTES) throw new Error(`Trace file exceeds the 512 MiB input limit: ${file}`);
  return readBundle(fs.readFileSync(file));
}

function readDiffThresholds(file) {
  if (!file) return {};
  const input = path.resolve(file);
  if (!fs.existsSync(input) || !fs.statSync(input).isFile()) throw new Error(`Threshold file not found: ${input}`);
  if (fs.statSync(input).size > 1024 * 1024) throw new Error('Threshold file exceeds the 1 MiB input limit.');
  try { return JSON.parse(fs.readFileSync(input, 'utf8')); } catch { throw new Error(`Invalid threshold JSON: ${input}`); }
}

function traceIdentity(trace, file) {
  return {
    id: trace.manifest?.session_id || path.basename(file),
    name: trace.metadata?.session?.name || trace.manifest?.session_id || path.basename(file),
  };
}

function printTraceDiff(result) {
  console.log(`Trace diff: ${result.status.toUpperCase()}`);
  console.log(`A: ${result.left.name || result.left.session_id} (${result.left.all_event_count} events)`);
  console.log(`B: ${result.right.name || result.right.session_id} (${result.right.all_event_count} events)`);
  console.log('');
  for (const row of result.rows) {
    const percent = row.percent === null ? 'n/a' : `${row.percent >= 0 ? '+' : ''}${row.percent.toFixed(1)}%`;
    console.log(`${row.label}: ${row.left} -> ${row.right} (delta ${row.delta >= 0 ? '+' : ''}${row.delta}; ${percent})`);
  }
  if (result.regressions.length) {
    console.log('');
    console.log('Regressions:');
    for (const item of result.regressions) console.log(`- ${item.code}: ${item.reason}`);
  }
}

function availableSessionId(sessionsDir, preferred) {
  fs.mkdirSync(sessionsDir, { recursive: true });
  if (!fs.existsSync(path.join(sessionsDir, preferred))) return preferred;
  for (let suffix = 2; suffix <= 9999; suffix++) {
    const candidate = `${preferred}-imported-${suffix}`;
    if (!fs.existsSync(path.join(sessionsDir, candidate))) return candidate;
  }
  throw new Error(`Could not allocate an imported Session ID for ${preferred}`);
}

function safeSessionId(value) {
  if (!/^[A-Za-z0-9._-]+$/.test(value || '') || value === '.' || value === '..') throw new Error('Session ID may contain only letters, digits, dot, underscore, and hyphen.');
  return value;
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) return printHelp();
  if (options.version) return console.log(PACKAGE.version);
  if (options.command === 'doctor') {
    if (!await doctor()) process.exitCode = 1;
    return;
  }
  if (options.command === 'setup') {
    const result = spawnSync(process.execPath, [path.join(ROOT, 'setup-https-proxy.js')], {
      cwd: process.cwd(),
      env: runtimeEnv(),
      stdio: 'inherit',
    });
    if (result.error) throw result.error;
    process.exitCode = result.status || 0;
    return;
  }
  if (options.command === 'export') {
    exportTrace(options);
    return;
  }
  if (options.command === 'open') {
    importTrace(options);
    await start(options);
    return;
  }
  if (options.command === 'diff') {
    const result = diffTraces(options);
    if (options.failOnRegression && result.status === 'regression') process.exitCode = 2;
    return;
  }
  if (options.command !== 'start') throw new Error(`Unknown command: ${options.command}`);
  await start(options);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = { availableSessionId, canListen, diffTraces, doctor, exportTrace, findPort, importTrace, main, parseArgs, resolveDataDir, runtimeEnv, safeSessionId, waitForServer };
