/* WardenOne — Copyright (C) 2026 iri; GPL-3.0-or-later. See LICENSE. */
'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const profile = require('./perf-profile.js');
const { fingerprint, sha256 } = require('./lib/privacy-baseline.js');
const { cleanupProfile } = require('./lib/browser-profile-cleanup.js');

const options = { browser: process.env.WARDENONE_BROWSER_PATH || profile.edgePath() };
for (let i = 2; i < process.argv.length; i += 2) {
  const key = { '--before': 'before', '--after': 'after', '--out': 'out', '--browser': 'browser' }[process.argv[i]];
  if (!key || !process.argv[i + 1]) throw Error('Expected --before path --after path --out path');
  options[key] = path.resolve(process.argv[i + 1]);
}
for (const key of ['before', 'after', 'out']) assert(options[key], 'Missing ' + key);

async function measure(directory) {
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wo-startup-'));
  const port = await profile.freePort();
  let cdp;
  try {
    const version = JSON.parse(fs.readFileSync(path.join(directory, 'manifest.json'), 'utf8')).version;
    const started = performance.now();
    const browser = await profile.launch(options.browser, 'on', directory, port, profileDir,
      ['--host-resolver-rules=MAP * ~NOTFOUND']);
    cdp = new profile.Cdp(browser.webSocketDebuggerUrl);
    await cdp.connect();
    const extension = await profile.extensionReady(cdp, port, version);
    const elapsedMs = Math.round(performance.now() - started);
    await profile.closeExtensionTabs(cdp, port, extension.id);
    return { elapsedMs, browser: browser.Browser };
  } finally {
    if (cdp) { await profile.killBrowser(cdp, port).catch(() => {}); cdp.close(); }
    cleanupProfile(profileDir, 'wo-startup-');
  }
}

const median = values => values.slice().sort((a, b) => a - b)[Math.floor(values.length / 2)];
async function run() {
  const report = { createdAt: new Date().toISOString(), browserSha256: sha256(fs.readFileSync(options.browser)),
    before: { fingerprint: fingerprint(options.before).sha256, samplesMs: [] },
    after: { fingerprint: fingerprint(options.after).sha256, samplesMs: [] } };
  for (const label of ['before', 'after', 'after', 'before', 'before', 'after']) {
    const sample = await measure(options[label]);
    report[label].samplesMs.push(sample.elapsedMs);
    report.browser = sample.browser;
  }
  report.before.medianMs = median(report.before.samplesMs);
  report.after.medianMs = median(report.after.samplesMs);
  report.deltaMs = report.after.medianMs - report.before.medianMs;
  report.deltaPercent = Math.round(1000 * report.deltaMs / report.before.medianMs) / 10;
  fs.mkdirSync(path.dirname(options.out), { recursive: true });
  fs.writeFileSync(options.out, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ before: report.before.samplesMs, after: report.after.samplesMs,
    medianBefore: report.before.medianMs, medianAfter: report.after.medianMs, deltaPercent: report.deltaPercent }));
}
profile.mustFinish(run, 'browser-upgrade-startup').catch(error => { console.error(error.stack || error); process.exitCode = 1; });
