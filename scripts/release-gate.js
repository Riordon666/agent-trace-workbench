#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');

const EXPECTED_REPOSITORY = 'https://github.com/Riordon666/agent-trace-workbench';
const STABLE_TAG = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

function validateRelease(root, tag) {
  const match = STABLE_TAG.exec(String(tag || ''));
  if (!match) throw new Error(`Release tag must be an exact stable SemVer such as v0.3.0; received ${tag || '<empty>'}`);
  const version = tag.slice(1);
  const packageJson = readJson(root, 'package.json');
  const lockfile = readJson(root, 'package-lock.json');
  const changelog = fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8');

  assertEqual(packageJson.version, version, 'package.json version');
  assertEqual(lockfile.version, version, 'package-lock.json version');
  assertEqual(lockfile.packages?.['']?.version, version, 'package-lock root version');
  assertEqual(normalizeRepository(packageJson.repository), EXPECTED_REPOSITORY, 'package repository');
  if (packageJson.private === true) throw new Error('package.json must not be private for a public release');
  assertEqual(packageJson.publishConfig?.access, 'public', 'package publishConfig.access');
  assertEqual(packageJson.bin?.atw, './bin/atw.js', 'package atw bin');
  if (!/^>=\s*20(?:\.0\.0)?$/.test(String(packageJson.engines?.node || ''))) {
    throw new Error(`package engines.node must preserve the supported >=20 boundary; received ${packageJson.engines?.node || '<empty>'}`);
  }

  const escapedVersion = version.replace(/\./g, '\\.');
  if (!new RegExp(`^## \\[${escapedVersion}\\] - \\d{4}-\\d{2}-\\d{2}$`, 'm').test(changelog)) {
    throw new Error(`CHANGELOG.md is missing a dated ## [${version}] release heading`);
  }
  return { packageName: packageJson.name, repository: EXPECTED_REPOSITORY, tag, version };
}

function normalizeRepository(repository) {
  const value = typeof repository === 'string' ? repository : repository?.url;
  return String(value || '').replace(/^git\+/, '').replace(/\.git$/, '').replace(/\/$/, '');
}

function readJson(root, name) {
  return JSON.parse(fs.readFileSync(path.join(root, name), 'utf8'));
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) throw new Error(`${label} must be ${expected}; received ${actual ?? '<empty>'}`);
}

if (require.main === module) {
  try {
    const result = validateRelease(path.resolve(__dirname, '..'), process.argv[2]);
    console.log(`Release gate passed: ${result.packageName}@${result.version} (${result.tag})`);
  } catch (error) {
    console.error(`Release gate failed: ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = { EXPECTED_REPOSITORY, normalizeRepository, validateRelease };
