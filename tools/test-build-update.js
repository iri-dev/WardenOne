/* WardenOne's own update check must prove ancestry before calling a build old. */
'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const vm = require('vm');
const { createHash, webcrypto } = require('node:crypto');

const source = fs.readFileSync('build-update.js', 'utf8');
const popup = fs.readFileSync('popup.html', 'utf8');
const settings = fs.readFileSync('settings.html', 'utf8');
const settingsCode = fs.readFileSync('settings.js', 'utf8');
const OLD = 'a'.repeat(40);
const NEW = 'b'.repeat(40);

function release(commit = NEW, extra = {}) {
  return { tag_name: 'build-' + commit, target_commitish: commit, draft: false,
    prerelease: false, published_at: '2026-10-10T04:01:09Z', assets: [
      { name: 'WardenOne-latest.zip', state: 'uploaded', size: 1000 },
      { name: 'WardenOne-latest.zip.sha256', state: 'uploaded', size: 87 },
    ], ...extra };
}

function comparison(status = 'ahead', extra = {}) {
  return { status, base_commit: { sha: OLD }, merge_base_commit: { sha: OLD },
    ahead_by: 1, behind_by: 0, ...extra };
}

function fixture({ installed = OLD, profile = 'full', latest = release(), compare = comparison(),
  now = 1000000 } = {}) {
  const requests = [];
  const opened = [];
  const cache = {};
  const elements = Object.fromEntries([
    'wo-build-update', 'wo-build-update-open', 'wo-build-update-detail',
    'wo-build-status', 'wo-build-detail', 'wo-build-check', 'wo-build-manual',
    'wo-build-release', 'wo-build-zip', 'wo-build-verification',
  ].map((id) => [id, { hidden: true, textContent: '', dataset: {}, disabled: false,
    isConnected: true, onclick: null }]));
  let clock = now;
  let releaseAnswer = latest;
  let compareAnswer = compare;
  const context = {
    WARDENONE_BUILD: { profile }, woSourceCommit: () => installed,
    AbortController, TextDecoder, setTimeout, clearTimeout, crypto: webcrypto,
    Date: class extends Date { static now() { return clock; } },
    document: { getElementById(id) { return elements[id] || null; } },
    chrome: {
      runtime: { getURL(path) { return 'chrome-extension://test/' + path; } },
      tabs: { create(tab) { opened.push(tab.url); } },
      storage: { session: {
        async get(key) { return { [key]: cache[key] }; },
        async set(value) { Object.assign(cache, value); },
      } },
    },
    fetch: async (url, options) => {
      requests.push({ url, options });
      const answer = url.includes('/compare/') ? compareAnswer : releaseAnswer;
      if (answer instanceof Error) throw answer;
      return { ok: true, url, headers: { get() { return null; } },
        text: async () => JSON.stringify(answer) };
    },
  };
  vm.runInNewContext(source + '\nthis.api = WO_BUILD_UPDATE;', context, { filename: 'build-update.js' });
  return { api: context.api, elements, opened, requests, cache,
    advance(ms) { clock += ms; }, setRelease(value) { releaseAnswer = value; },
    setCompare(value) { compareAnswer = value; } };
}

async function main() {
  const old = fixture();
  const first = await old.api.check();
  assert.equal(first.state, 'update');
  assert.equal(first.installed, OLD);
  assert.equal(first.latest, NEW);
  assert.equal(old.requests.length, 2);
  assert(old.requests[1].url.endsWith('/compare/' + OLD + '...' + NEW + '?per_page=1'));
  assert(old.requests.every((request) => request.url.startsWith('https://api.github.com/repos/iri-dev/WardenOne/')));
  assert(old.requests.every((request) => request.options.credentials === 'omit'
    && request.options.referrerPolicy === 'no-referrer' && request.options.redirect === 'error'));
  await old.api.renderPopup();
  assert.equal(old.elements['wo-build-update'].hidden, false);
  assert.match(old.elements['wo-build-update-detail'].textContent, /Installed aaaaaaa · Latest bbbbbbb/);
  old.elements['wo-build-update-open'].onclick();
  assert.deepEqual(old.opened, ['chrome-extension://test/settings.html#page=about']);
  await old.api.renderAbout();
  assert.equal(old.elements['wo-build-status'].dataset.state, 'update');
  assert.match(old.elements['wo-build-detail'].textContent, /official build/);
  assert.equal(old.requests.length, 2, 'popup and About reuse one session result');
  await old.elements['wo-build-check'].onclick();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(old.requests.length, 4, 'Check again bypasses the cache');

  const current = fixture({ installed: NEW });
  assert.equal((await current.api.check()).state, 'current');
  assert.equal(current.requests.length, 1, 'an exact build match needs no ancestry request');
  await current.api.renderPopup();
  assert.equal(current.elements['wo-build-update'].hidden, true);

  const ahead = fixture({ compare: comparison('behind', {
    ahead_by: 0, behind_by: 2, merge_base_commit: { sha: NEW },
  }) });
  assert.equal((await ahead.api.check()).state, 'ahead');
  const diverged = fixture({ compare: comparison('diverged', { ahead_by: 1, behind_by: 2 }) });
  assert.equal((await diverged.api.check()).state, 'different');
  const forged = fixture({ compare: comparison('ahead', { base_commit: { sha: NEW } }) });
  assert.equal((await forged.api.check()).state, 'unknown', 'unrelated comparison data cannot claim an update');

  for (const bad of [
    release(NEW, { draft: true }), release(NEW, { prerelease: true }),
    release(NEW, { tag_name: 'v1.0.3' }), release(NEW, { target_commitish: OLD }),
    release(NEW, { assets: [{ name: 'WardenOne-latest.zip', state: 'uploaded', size: 1000 }] }),
  ]) {
    const f = fixture({ latest: bad });
    assert.equal((await f.api.check()).state, 'unknown');
    assert.equal(f.requests.length, 1, 'incomplete or unrecognised releases are never compared');
  }

  const offline = fixture({ latest: new Error('offline') });
  assert.equal((await offline.api.check()).state, 'unknown');
  assert.equal((await offline.api.check()).state, 'unknown');
  assert.equal(offline.requests.length, 1, 'failed checks back off briefly');
  offline.advance(10 * 60 * 1000);
  assert.equal((await offline.api.check()).state, 'unknown');
  assert.equal(offline.requests.length, 2);

  const fresh = fixture();
  assert.equal((await fresh.api.check()).state, 'update');
  fresh.setRelease(release(OLD));
  assert.equal((await fresh.api.check()).state, 'update');
  assert.equal(fresh.requests.length, 2, 'successful results are reused within six hours');
  fresh.advance(6 * 60 * 60 * 1000);
  assert.equal((await fresh.api.check()).state, 'current');
  assert.equal(fresh.requests.length, 3);

  const local = fixture({ installed: '' });
  assert.equal((await local.api.check()).state, 'local');
  assert.equal(local.requests.length, 0);
  await local.api.renderAbout();
  assert.match(local.elements['wo-build-detail'].textContent, /no packaged build ID/);
  assert.equal(local.elements['wo-build-check'].disabled, false);
  assert.equal((await local.api.check(true)).latest, NEW);
  assert.equal(local.requests.length, 1, 'manual source-copy checks fetch release metadata without comparing a missing build ID');
  const store = fixture({ profile: 'store' });
  assert.equal((await store.api.check()).state, 'store');
  assert.equal(store.requests.length, 0);
  await store.api.renderAbout();
  assert.equal(store.elements['wo-build-manual'].hidden, true);

  const bytes = Uint8Array.of(1, 2, 3, 4);
  const digest = createHash('sha256').update(bytes).digest('hex');
  const archive = release();
  Object.assign(archive.assets[0], { size: bytes.length, digest: 'sha256:' + digest });
  const verification = fixture({ latest: archive });
  await verification.api.renderAbout();
  const picker = verification.elements['wo-build-zip'];
  const releaseLink = verification.elements['wo-build-release'];
  const verificationStatus = verification.elements['wo-build-verification'];
  assert.equal(picker.disabled, false);
  assert(releaseLink.href.endsWith('/releases/tag/build-' + NEW));
  picker.files = [{ size: bytes.length, arrayBuffer: async () => bytes.buffer }];
  await picker.onchange();
  assert.match(verificationStatus.textContent, /matches the published SHA-256/);
  picker.files = [{ size: bytes.length, arrayBuffer: async () => Uint8Array.of(0, 0, 0, 0).buffer }];
  await picker.onchange();
  assert.match(verificationStatus.textContent, /does not match/);
  assert.equal(verification.requests.length, 2, 'the verification reads the ZIP on-device');
  assert.equal(await verification.api.verifyArchive({ size: 64 * 1024 * 1024 + 1,
    arrayBuffer: async () => { throw new Error('large files should not be read'); } },
  { size: 64 * 1024 * 1024 + 1, sha256: digest }), false);
  const conflict = fixture({ latest: { ...archive, body: 'ZIP SHA-256: `' + 'f'.repeat(64) + '`' } });
  await conflict.api.renderAbout();
  assert.equal(conflict.elements['wo-build-zip'].disabled, true, 'conflicting published digests prevent verification');

  assert.match(popup, /id="wo-build-update"[^>]*hidden/);
  assert.match(popup, /<script src="build-update\.js"><\/script>/);
  assert.match(settings, /<script src="build-update\.js"><\/script>/);
  assert.match(settingsCode, /void WO_BUILD_UPDATE\.renderAbout\(\)/);
  assert.match(settingsCode, /WardenOne folder at the same path/);
  assert.match(settingsCode, /press Reload on WardenOne/);
  console.log('[ok] WardenOne build update checks');
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
