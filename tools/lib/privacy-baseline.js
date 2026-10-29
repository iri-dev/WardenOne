/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE. */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const profile = require('../perf-profile.js');
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const STATUSES = new Set(['blocked', 'stripped', 'detected-but-not-blocked', 'allowed', 'unsupported', 'error']);

function parseArgs(args) {
  const options = { runs: 5, snapshots: null, out: null, builds: null };
  const flags = new Map([['--runs', 'runs'], ['--snapshots', 'snapshots'], ['--out', 'out'], ['--builds', 'builds']]);
  for (let i = 0; i < args.length; i += 2) {
    const key = flags.get(args[i]), value = args[i + 1];
    if (!key || !value || value.startsWith('--')) throw new Error('expected --snapshots file --out file [--runs 1..10] [--builds labels]');
    if (key === 'runs') {
      if (!/^(?:[1-9]|10)$/.test(value)) throw new Error('--runs must be 1..10');
      options.runs = Number(value);
    } else options[key] = key === 'builds' ? value.split(',') : path.resolve(value);
  }
  if (!options.snapshots || !options.out) throw new Error('--snapshots and --out are required');
  return options;
}

function fingerprint(directory) {
  const files = [];
  const visit = relative => {
    for (const entry of fs.readdirSync(path.join(directory, relative), { withFileTypes: true })) {
      if (entry.name === '_metadata' || entry.name === '.git') continue;
      const name = path.join(relative, entry.name);
      if (entry.isSymbolicLink()) throw new Error('Snapshot contains a symbolic link: ' + name);
      if (entry.isDirectory()) visit(name);
      else if (entry.isFile()) {
        const bytes = fs.readFileSync(path.join(directory, name));
        files.push({ path: name.replace(/\\/g, '/'), bytes: bytes.length, sha256: sha256(bytes) });
      }
    }
  };
  visit('');
  files.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  return { sha256: sha256(JSON.stringify(files)), files };
}

function verifyBuild(build) {
  if (!build || !build.directory || !/^[a-f0-9]{64}$/.test(build.fingerprint || '')) throw new Error('Missing immutable build identity');
  const actual = fingerprint(build.directory);
  if (actual.sha256 !== build.fingerprint) throw new Error('Snapshot changed: ' + build.label);
  const manifest = JSON.parse(fs.readFileSync(path.join(build.directory, 'manifest.json'), 'utf8'));
  if (manifest.version !== build.version || manifest.manifest_version !== build.manifestVersion) throw new Error('Snapshot manifest changed');
  return manifest;
}

function requestStatus({ error, received, blockedEvidence, cookieBefore, cookieAtServer, cookieStoredAfter, detected, unsupported }) {
  if (error) return 'error';
  if (unsupported) return 'unsupported';
  if (!received) return blockedEvidence ? 'blocked' : 'error';
  if ((cookieBefore && !cookieAtServer) || cookieStoredAfter === false) return 'stripped';
  return detected ? 'detected-but-not-blocked' : 'allowed';
}

function summarize(runs) {
  const groups = new Map();
  for (const run of runs) for (const result of run.scenarios || []) {
    if (!STATUSES.has(result.status)) throw new Error('Unknown result status: ' + result.status);
    const key = JSON.stringify([run.build, result.name, result.profile]);
    const group = groups.get(key) || { build: run.build, name: result.name, profile: result.profile, samples: [] };
    group.samples.push(result);
    groups.set(key, group);
  }
  return [...groups.values()].map(group => ({
    build: group.build, name: group.name, profile: group.profile, n: group.samples.length,
    statuses: Object.fromEntries([...STATUSES].map(status => [status, group.samples.filter(sample => sample.status === status).length]).filter(([, n]) => n)),
    latencyMs: profile.summarise(group.samples.map(sample => sample.latencyMs).filter(Number.isFinite)),
    browserCpuMs: profile.summarise(group.samples.map(sample => sample.browserCpuMs).filter(Number.isFinite)),
    rendererHeapBytes: profile.summarise(group.samples.map(sample => sample.rendererHeapBytes).filter(Number.isFinite)),
    extensionHeapBytes: profile.summarise(group.samples.map(sample => sample.extensionHeapBytes).filter(Number.isFinite)),
  }));
}

module.exports = { parseArgs, fingerprint, verifyBuild, requestStatus, summarize, sha256, STATUSES };
