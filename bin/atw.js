#!/usr/bin/env node

const fs = require('fs');
const http = require('http');
const net = require('net');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

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
  const result = { command: 'start', port: null, open: true, help: false, version: false };
  const values = [...argv];
  if (values[0] && !values[0].startsWith('-')) result.command = values.shift();
  while (values.length) {
    const value = values.shift();
    if (value === '--port' || value === '-p') result.port = Number(values.shift());
    else if (value === '--no-open') result.open = false;
    else if (value === '--help' || value === '-h') result.help = true;
    else if (value === '--version' || value === '-v') result.version = true;
    else throw new Error(`Unknown option: ${value}`);
  }
  if (result.port !== null && (!Number.isInteger(result.port) || result.port < 1 || result.port > 65535)) {
    throw new Error('Port must be an integer between 1 and 65535.');
  }
  return result;
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
  atw --version

Commands:
  start   Start the local workbench (default)
  setup   Generate the local MITM certificate
  doctor  Check Node.js, native dependencies, OpenSSL, certificate, and port

The workbench binds to 127.0.0.1. Captures may contain sensitive data.`);
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
  if (options.command !== 'start') throw new Error(`Unknown command: ${options.command}`);
  await start(options);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = { canListen, doctor, findPort, main, parseArgs, resolveDataDir, runtimeEnv, waitForServer };
