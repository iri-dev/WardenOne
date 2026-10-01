/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE. */
'use strict';

const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const popup = fs.readFileSync('popup.js', 'utf8');
const start = popup.indexOf('const UPDATE_GUARDIAN_CACHE_MS =');
const end = popup.indexOf('// Remove a single exposed token', start);
assert(start > 0 && end > start, 'Update Guardian implementation must be available');
const code = popup.slice(start, end) + '\nglobalThis.guardian = { detectBrowser, renderUpdateGuardian, parseBraveRelease, parseChromeRelease, parseEdgeRelease };';

const braveNotes = (version = '1.96.60', engine = '154.0.8037.93') =>
  '<h2 id="desktop">Desktop</h2><h3 id="desktop-release-notes-v19660">Release Notes <strong>v'
  + version + '</strong></h3><ul><li>Upgraded Chromium to ' + engine + '.</li></ul>'
  + '<h3 id="desktop-release-notes-old">Old release</h3>';
const chromeRelease = (version = '154.0.8037.93', fraction = 1) => JSON.stringify({
  releases: [{ version, fraction, serving: { startTime: '2026-09-29T00:00:00Z' } }],
});
const edgeReleases = JSON.stringify([{ Product: 'Stable', Releases: [
  { Platform: 'Windows', Architecture: 'x64', ProductVersion: '152.0.4191.100' },
  { Platform: 'Windows', Architecture: 'x64', ProductVersion: '154.0.4258.48' },
  { Platform: 'MacOS', Architecture: 'universal', ProductVersion: '153.0.0.1' },
] }]);

function run(navigator, answers = {}) {
  const elements = Object.fromEntries(['ug-name', 'ug-status', 'ug-note', 'ug-latest', 'ug-btn', 'ug-refresh'].map((id) =>
    [id, { textContent: '', style: {}, dataset: {}, disabled: false, onclick: null }]));
  const opened = [];
  const requests = [];
  const cache = {};
  const context = {
    navigator, URL, AbortController, setTimeout, clearTimeout,
    $(id) { return elements[id]; },
    fetch: async (url, options) => {
      requests.push({ url, options });
      const result = Object.entries(answers).find(([part]) => url.includes(part));
      if (!result || result[1] instanceof Error) throw result ? result[1] : new Error('unexpected source');
      return { ok: true, url, headers: { get() { return null; } }, text: async () => result[1] };
    },
    chrome: {
      tabs: { create(tab) { opened.push(tab.url); } },
      storage: { session: {
        async get(key) { return { [key]: cache[key] }; },
        async set(value) { Object.assign(cache, value); },
      } },
    },
  };
  vm.runInNewContext(code, context, { filename: 'popup-update-guardian.js' });
  return { guardian: context.guardian, elements, opened, requests, cache };
}

function chromiumNav(major, extra = {}) {
  return {
    userAgent: 'Mozilla/5.0 Chrome/' + major + '.0.0.0 Safari/537.36',
    platform: 'Win32',
    userAgentData: { platform: 'Windows', brands: [{ brand: 'Chromium', version: String(major) }],
      async getHighEntropyValues() { return { fullVersionList: [] }; } },
    ...extra,
  };
}

async function main() {
  const brave153 = run(chromiumNav(153, { brave: { isBrave: async () => true } }), {
    'versions.brave.com': '1.96.60', 'brave.com/latest/': braveNotes(),
  });
  assert.strictEqual((await brave153.guardian.detectBrowser()).name, 'Brave');
  await brave153.guardian.renderUpdateGuardian();
  assert.strictEqual(brave153.elements['ug-name'].textContent, 'Brave');
  assert.strictEqual(brave153.elements['ug-status'].textContent, 'Brave update available');
  assert.strictEqual(brave153.elements['ug-status'].dataset.state, 'update');
  assert.match(brave153.elements['ug-note'].textContent, /behind the latest Brave release/i);
  assert.strictEqual(brave153.elements['ug-latest'].textContent, 'Latest Brave release: 1.96.60');
  assert(brave153.requests.every((request) => request.options.credentials === 'omit'));
  brave153.elements['ug-btn'].onclick();
  assert.deepStrictEqual(brave153.opened, ['brave://settings/help']);
  await brave153.guardian.renderUpdateGuardian();
  assert.strictEqual(brave153.requests.length, 2, 'recent release data should be cached');
  await brave153.elements['ug-refresh'].onclick();
  await new Promise((resolve) => setImmediate(resolve));
  assert.strictEqual(brave153.requests.length, 4, 'Check again must bypass the cache');

  const brave154 = run(chromiumNav(154, { brave: { isBrave: async () => true } }), {
    'versions.brave.com': '1.96.60', 'brave.com/latest/': braveNotes(),
  });
  await brave154.guardian.renderUpdateGuardian();
  assert.strictEqual(brave154.elements['ug-status'].textContent, 'Brave looks current');
  assert.match(brave154.elements['ug-note'].textContent, /smaller security updates/i);
  assert.doesNotMatch(brave154.elements['ug-note'].textContent, /hidden from extensions/i);

  const braveFull = run(chromiumNav(154, { brave: { isBrave: async () => true },
    userAgentData: { platform: 'Windows', brands: [{ brand: 'Chromium', version: '154' }],
      async getHighEntropyValues() { return { fullVersionList: [{ brand: 'Brave', version: '1.96.60' }] }; } },
  }), { 'versions.brave.com': '1.96.60', 'brave.com/latest/': braveNotes() });
  await braveFull.guardian.renderUpdateGuardian();
  assert.strictEqual(braveFull.elements['ug-status'].textContent, 'Brave is up to date');

  const braveEngineVersion = run(chromiumNav(154, { brave: { isBrave: async () => true },
    userAgentData: { platform: 'Windows', brands: [{ brand: 'Chromium', version: '154' }],
      async getHighEntropyValues() { return { fullVersionList: [{ brand: 'Brave', version: '154.0.8037.93' }] }; } },
  }), { 'versions.brave.com': '1.96.60', 'brave.com/latest/': braveNotes() });
  assert.strictEqual((await braveEngineVersion.guardian.detectBrowser()).fullVersion, '',
    'a Chromium version from Brave UA hints is not the Brave product version');
  await braveEngineVersion.guardian.renderUpdateGuardian();
  assert.strictEqual(braveEngineVersion.elements['ug-status'].textContent, 'Brave looks current');

  const mismatch = run(chromiumNav(154, { brave: { isBrave: async () => true } }), {
    'versions.brave.com': '1.96.60', 'brave.com/latest/': braveNotes('1.96.59'),
  });
  await mismatch.guardian.renderUpdateGuardian();
  assert.strictEqual(mismatch.elements['ug-status'].textContent, 'Could not check right now');
  assert.strictEqual(mismatch.elements['ug-latest'].textContent, '');

  const chrome153 = run(chromiumNav(153), { 'versionhistory.googleapis.com': chromeRelease() });
  await chrome153.guardian.renderUpdateGuardian();
  assert.strictEqual(chrome153.elements['ug-status'].textContent, 'Chrome update available');
  assert.match(chrome153.elements['ug-latest'].textContent, /154\.0\.8037\.93/);

  const staged = run(chromiumNav(154), { 'versionhistory.googleapis.com': chromeRelease('155.0.8059.26', .005) });
  await staged.guardian.renderUpdateGuardian();
  assert.strictEqual(staged.elements['ug-status'].textContent, 'Could not check right now');
  assert.doesNotMatch(staged.elements['ug-note'].textContent, /newer/i);

  const chromeFull = run(chromiumNav(154, { userAgentData: {
    platform: 'Windows', brands: [{ brand: 'Chromium', version: '154' }, { brand: 'Google Chrome', version: '154' }],
    async getHighEntropyValues() { return { fullVersionList: [{ brand: 'Google Chrome', version: '154.0.8037.93' }] }; },
  } }), { 'versionhistory.googleapis.com': chromeRelease() });
  await chromeFull.guardian.renderUpdateGuardian();
  assert.strictEqual(chromeFull.elements['ug-status'].textContent, 'Chrome is up to date');

  const edge153 = run(chromiumNav(153, { userAgent: 'Chrome/153.0.0.0 Edg/153.0.0.0',
    brave: { isBrave: async () => true },
    userAgentData: { platform: 'Windows', brands: [
      { brand: 'Chromium', version: '153' }, { brand: 'Microsoft Edge', version: '153' },
      { brand: 'Brave', version: '153' },
    ], async getHighEntropyValues() { return { fullVersionList: [] }; } },
  }), {
    'edgeupdates.microsoft.com': edgeReleases,
  });
  assert.strictEqual((await edge153.guardian.detectBrowser()).name, 'Microsoft Edge');
  await edge153.guardian.renderUpdateGuardian();
  assert.strictEqual(edge153.elements['ug-name'].textContent, 'Edge');
  assert.strictEqual(edge153.elements['ug-status'].textContent, 'Edge update available');
  assert.strictEqual(edge153.elements['ug-btn'].textContent, 'Check Edge updates');
  assert.match(edge153.elements['ug-note'].textContent, /managed update schedule/i);
  assert.match(edge153.elements['ug-latest'].textContent, /154\.0\.4258\.48/);
  assert(edge153.requests.every((request) => !request.url.includes('brave.com')));
  edge153.elements['ug-btn'].onclick();
  assert.deepStrictEqual(edge153.opened, ['edge://settings/help']);

  const edge154 = run(chromiumNav(154, { userAgent: 'Chrome/154.0.0.0 Edg/154.0.0.0' }), {
    'edgeupdates.microsoft.com': edgeReleases,
  });
  await edge154.guardian.renderUpdateGuardian();
  assert.strictEqual(edge154.elements['ug-status'].textContent, 'Edge looks current');

  const offline = run(chromiumNav(154), { 'versionhistory.googleapis.com': new Error('offline') });
  await offline.guardian.renderUpdateGuardian();
  assert.strictEqual(offline.elements['ug-status'].textContent, 'Could not check right now');

  const unknown = run({ userAgent: '', platform: '' });
  await unknown.guardian.renderUpdateGuardian();
  assert.strictEqual(unknown.requests.length, 0);
  assert.strictEqual(unknown.elements['ug-status'].textContent, 'Check updates in your browser');
  assert.match(unknown.elements['ug-note'].textContent, /not available for this browser/i);
  assert(!/Looks current/.test(popup));
  console.log('[ok] Update Guardian tests');
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
