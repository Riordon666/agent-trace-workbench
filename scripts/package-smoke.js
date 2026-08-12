#!/usr/bin/env node

const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const PACKAGE = require(path.join(ROOT, 'package.json'));
const FORBIDDEN_RUNTIME_ENTRIES = ['certs', 'exports', 'local-data', 'logs', 'sessions', 'wallpapers'];

async function main() {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'atw-package-smoke-'));
  const consumer = path.join(temporaryRoot, 'consumer');
  const dataRoot = path.join(temporaryRoot, 'runtime-data');
  let workbench = null;
  let output = '';
  let errorOutput = '';

  try {
    runNpm(['pack', '--pack-destination', temporaryRoot], ROOT);
    const tarball = path.join(temporaryRoot, `agent-trace-workbench-${PACKAGE.version}.tgz`);
    assert(fs.existsSync(tarball), 'npm pack did not produce the expected tarball');

    fs.mkdirSync(consumer);
    fs.writeFileSync(path.join(consumer, 'package.json'), `${JSON.stringify({ name: 'atw-package-smoke-consumer', private: true }, null, 2)}\n`);
    runNpm(['install', tarball, '--no-audit', '--no-fund'], consumer);

    const installedRoot = path.join(consumer, 'node_modules', PACKAGE.name);
    const cli = path.join(installedRoot, 'bin', 'atw.js');
    assert(fs.existsSync(cli), 'Installed package is missing bin/atw.js');
    const binShim = path.join(consumer, 'node_modules', '.bin', process.platform === 'win32' ? 'atw.cmd' : 'atw');
    assert(fs.existsSync(binShim), 'Installed package did not create the atw bin shim');
    assertNoRuntimeEntries(installedRoot);

    const version = runNpm(['exec', '--offline', '--', 'atw', '--version'], consumer).stdout.trim();
    assert(version === PACKAGE.version, `Installed CLI reported ${version || '<empty>'}, expected ${PACKAGE.version}`);

    const sdk = require(installedRoot);
    assert(sdk.ADAPTER_API_VERSION === '1.0', 'Installed package did not expose Adapter SDK v1.0');
    assert(Array.isArray(sdk.AGENT_METHODS) && Array.isArray(sdk.PROTOCOL_METHODS), 'Installed package exposed an incomplete Adapter SDK');

    const environment = { ...process.env, ATW_DATA_DIR: dataRoot };
    const doctor = run(process.execPath, [cli, 'doctor'], consumer, environment);
    assert(doctor.stdout.includes('Node.js 20+') && doctor.stdout.includes('node-pty'), 'Doctor omitted required runtime checks');
    assert(doctor.stdout.includes('not generated; run atw setup'), 'Doctor did not provide the expected fresh-install certificate guidance');

    const port = await availablePort();
    workbench = spawn(process.execPath, [cli, '--no-open', '--port', String(port)], {
      cwd: consumer,
      env: environment,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    workbench.stdout.setEncoding('utf8');
    workbench.stderr.setEncoding('utf8');
    workbench.stdout.on('data', (chunk) => { output += chunk; });
    workbench.stderr.on('data', (chunk) => { errorOutput += chunk; });

    const status = await waitForStatus(port, workbench, () => `${output}\n${errorOutput}`);
    const certificatePath = path.resolve(status.certs?.certPath || '');
    assert(isInside(certificatePath, dataRoot), 'Fresh install resolved certificate storage inside the package or another unexpected directory');
    assert(path.resolve(status.annotationExportRoot || '').startsWith(`${path.resolve(dataRoot)}${path.sep}`), 'Annotation export root escaped the configured data directory');
    assert(Array.isArray(status.sessions) && status.sessions.length === 0, 'Fresh install unexpectedly exposed an existing Session');
    assertNoRuntimeEntries(installedRoot);

    const shutdown = await fetch(`http://127.0.0.1:${port}/api/shutdown`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    assert(shutdown.ok, `Shutdown API returned HTTP ${shutdown.status}`);
    await waitForExit(workbench, 10000);
    assert(workbench.exitCode === 0, `Installed CLI exited with ${workbench.exitCode}; ${errorOutput.trim()}`);
    workbench = null;

    console.log(`Package smoke passed: ${PACKAGE.name}@${PACKAGE.version}`);
    console.log('Verified tarball install, CLI, Adapter SDK, Doctor, localhost startup, data isolation, status API, and clean shutdown.');
  } finally {
    if (workbench && workbench.exitCode === null) {
      workbench.kill('SIGTERM');
      try { await waitForExit(workbench, 3000); } catch {}
    }
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

function run(command, args, cwd, env = process.env) {
  const result = spawnSync(command, args, { cwd, env, encoding: 'utf8', windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} exited with ${result.status}\n${result.stdout || ''}${result.stderr || ''}`.trim());
  }
  return result;
}

function runNpm(args, cwd) {
  const candidates = [
    process.env.npm_execpath,
    path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js'),
  ].filter(Boolean);
  const cli = candidates.find((candidate) => fs.existsSync(candidate));
  if (!cli) throw new Error('Could not locate npm-cli.js for the package smoke test');
  return run(process.execPath, [cli, ...args], cwd);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertNoRuntimeEntries(installedRoot) {
  const unexpected = FORBIDDEN_RUNTIME_ENTRIES.filter((name) => fs.existsSync(path.join(installedRoot, name)));
  assert(!unexpected.length, `Installed package was mutated with runtime entries: ${unexpected.join(', ')}`);
}

function isInside(candidate, root) {
  const resolvedRoot = path.resolve(root);
  return candidate.startsWith(`${resolvedRoot}${path.sep}`);
}

function availablePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

async function waitForStatus(port, child, diagnostics) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Installed CLI exited before startup with ${child.exitCode}\n${diagnostics()}`.trim());
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/status`);
      if (response.ok) return response.json();
    } catch {}
    await delay(150);
  }
  throw new Error(`Installed CLI did not become ready in time\n${diagnostics()}`.trim());
}

function waitForExit(child, timeoutMs) {
  if (child.exitCode !== null) return Promise.resolve(child.exitCode);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.removeListener('exit', onExit);
      reject(new Error('Installed CLI did not shut down in time'));
    }, timeoutMs);
    const onExit = (code) => {
      clearTimeout(timer);
      resolve(code);
    };
    child.once('exit', onExit);
  });
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
