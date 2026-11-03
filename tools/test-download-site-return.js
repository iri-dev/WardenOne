/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE. */
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('background.js', 'utf8');
const start = source.indexOf('const DOWNLOAD_SITE_RETURN_KEY =');
const end = source.indexOf('const WARNING_RECORD_PREFIX =', start);
assert(start >= 0 && end > start);
const key = 'wardenone_download_return';
const warning = 'chrome-extension://test/download-site-blocked.html';

function world(shared = {}, options = {}) {
  const tabs = new Map([[1, { id: 1, url: 'https://catalog.example/game?source=original', windowId: 3 }],
    [2, { id: 2, url: warning, windowId: 3 }]]);
  const updates = [], removed = [], focused = [], checks = [];
  let now = 1800000000000;
  class Clock extends Date {}
  Clock.now = () => now;
  const area = {
    async get(name) { return structuredClone({ [name]: shared[name] }); },
    async set(values) { Object.assign(shared, structuredClone(values)); },
  };
  const ctx = {
    URL, console, Date: Clock, __privacyEraseInProgress: false,
    INCOGNITO_CONTEXT: false, LAST_TOP_URL: {}, sessionArea: () => area,
    async messageSenderStillCurrent(sender, exact) {
      checks.push(exact);
      if (options.eraseAfterCheck === checks.length) ctx.__privacyEraseInProgress = true;
      return options.stale !== true && tabs.get(sender.tab.id)?.url === sender.url;
    },
    chrome: {
      runtime: { id: 'test', getURL: path => 'chrome-extension://test/' + path },
      tabs: {
        async get(id) { if (!tabs.has(id)) throw Error('missing'); return { ...tabs.get(id) }; },
        async update(id, change) {
          if (options.failUpdate || !tabs.has(id)) throw Error('update failed');
          updates.push({ id, change }); Object.assign(tabs.get(id), change); return tabs.get(id);
        },
        async remove(id) { if (options.failRemove) throw Error('remove failed'); removed.push(id); tabs.delete(id); },
      },
      windows: { async update(id, change) { focused.push({ id, change }); } },
    },
  };
  vm.createContext(ctx);
  vm.runInContext(source.slice(start, end)
    + '\nthis.api={noteDownloadPopupSource,noteDownloadSiteNavigation,forgetDownloadSiteReturn,returnFromDownloadSite,downloadSiteSourceUrl,downloadSiteBlockedUrl,downloadSiteReturnRecords,flush:()=>downloadSiteReturnQueue};', ctx);
  const sender = { id: 'test', frameId: 0, documentId: 'warning-document', url: warning, tab: { id: 2 } };
  return { api: ctx.api, ctx, tabs, updates, removed, focused, checks, shared, sender,
    advance: ms => { now += ms; },
    async back(override = {}) { return await ctx.api.returnFromDownloadSite({ ...sender, ...override }); },
  };
}

(async () => {
  let count = 0;
  async function check(name, action) { await action(); count++; console.log('[ok] ' + name); }
  await check('browser popup parent IDs survive worker restart without collecting ordinary source URLs', async () => {
    const shared = {}, before = world(shared);
    before.api.noteDownloadPopupSource({ tabId: 2, sourceTabId: 1, url: 'about:blank' });
    await before.api.flush();
    assert.equal(shared[key]['2'].sourceUrl, '');
    const after = world(shared);
    assert.equal((await after.back()).ok, true);
    assert.equal(after.updates[0].id, 1);
    assert.equal(after.updates[0].change.active, true);
    assert.deepEqual(after.removed, [2]);
    assert.equal(after.focused[0].id, 3);
    await after.api.flush();
    assert.equal(shared[key]['2'], undefined);
  });
  await check('same-tab source retains its exact browser-owned address across worker restart', async () => {
    const shared = {}, before = world(shared);
    before.ctx.LAST_TOP_URL[2] = 'https://catalog.example/game?download=source#links';
    before.api.noteDownloadSiteNavigation({ tabId: 2, frameId: 0, url: 'https://cloud-1uaj.whuw8g.site/' });
    await before.api.flush();
    const after = world(shared);
    assert.equal((await after.back()).ok, true);
    assert.equal(after.updates[0].id, 2);
    assert.equal(after.updates[0].change.url, 'https://catalog.example/game?download=source#links');
    assert.deepEqual(after.removed, []);
  });
  await check('a cold-worker navigation can capture the browser current source before redirect', async () => {
    const w = world();
    w.tabs.get(2).url = 'https://catalog.example/source';
    w.api.noteDownloadSiteNavigation({ tabId: 2, frameId: 0, url: 'https://dl-rsjp.whuw8g.site/' });
    await w.api.flush();
    w.tabs.get(2).url = warning;
    assert.equal((await w.back()).ok, true);
    assert.equal(w.updates[0].change.url, 'https://catalog.example/source');
  });
  await check('the browser opener remains a safe fallback when no saved record exists', async () => {
    const w = world(); w.tabs.get(2).openerTabId = 1;
    assert.equal((await w.back()).ok, true);
    assert.deepEqual(w.removed, [2]);
  });
  await check('a closed source tab uses its captured safe address without opening a new tab', async () => {
    const w = world();
    w.api.noteDownloadPopupSource({ tabId: 2, sourceTabId: 1 });
    w.api.noteDownloadSiteNavigation({ tabId: 2, frameId: 0, url: 'https://whuw8g.site/' });
    await w.api.flush(); w.tabs.delete(1);
    assert.equal((await w.back()).ok, true);
    assert.equal(w.updates[0].change.url, 'https://catalog.example/game?source=original');
  });
  for (const override of [{ frameId: 1 }, { id: 'other' }, { url: warning + '?next=https://evil.example' },
    { url: warning + '#return' }, { url: 'https://attacker.example/download-site-blocked.html' }, { tab: { id: -1 } }]) {
    await check('non-current, framed or forged warning context is refused: ' + JSON.stringify(override), async () => {
      const w = world(); w.tabs.get(2).openerTabId = 1;
      assert.equal((await w.back(override)).ok, false);
      assert.deepEqual(w.updates, []); assert.deepEqual(w.removed, []);
    });
  }
  for (const raw of ['javascript:alert(1)', 'about:blank', 'file:///etc/passwd', warning,
    'https://user:password@catalog.example/', 'https://whuw8g.site/', 'https://another.whuw8g.site/',
    'https://whuw8g.site./', 'https://another.whuw8g.site./', 'https://catalog.example/' + 'x'.repeat(2048)]) {
    await check('stored unsafe return address is rejected: ' + raw.slice(0, 65), async () => {
      const w = world({ [key]: { 2: { at: 1800000000000, sourceUrl: raw, sourceTabId: -1 } } });
      assert.equal((await w.back()).ok, false);
      assert.deepEqual(w.updates, []); assert.deepEqual(w.removed, []);
    });
  }
  await check('expired records and missing source leave the warning visible instead of navigating to blank', async () => {
    const w = world({ [key]: { 2: { at: 1800000000000, sourceUrl: 'https://catalog.example/' } } });
    w.advance(30 * 60 * 1000);
    assert.equal((await w.back()).ok, false);
    assert.deepEqual(w.updates, []); assert.deepEqual(w.removed, []);
  });
  await check('source tabs in another privacy context or on the blocked family are not activated', async () => {
    for (const source of [{ incognito: true }, { url: 'https://new.whuw8g.site/' }, { url: warning }]) {
      const w = world(); w.tabs.get(2).openerTabId = 1; Object.assign(w.tabs.get(1), source);
      assert.equal((await w.back()).ok, false);
      assert.deepEqual(w.updates, []); assert.deepEqual(w.removed, []);
    }
  });
  await check('stale warning documents cannot activate or close tabs', async () => {
    const w = world({}, { stale: true }); w.tabs.get(2).openerTabId = 1;
    assert.equal((await w.back()).ok, false);
    assert.deepEqual(w.updates, []); assert.deepEqual(w.removed, []);
  });
  await check('privacy erasure blocks returns before and during source validation', async () => {
    for (const options of [{ eraseAfterCheck: 1 }, { eraseAfterCheck: 2 }, {}]) {
      const w = world({}, options); w.tabs.get(2).openerTabId = 1;
      if (!options.eraseAfterCheck) w.ctx.__privacyEraseInProgress = true;
      assert.equal((await w.back()).ok, false);
      assert.deepEqual(w.updates, []); assert.deepEqual(w.removed, []);
    }
    const w = world({ [key]: { 2: { at: 1800000000000, sourceUrl: 'https://catalog.example/' } } }, { eraseAfterCheck: 2 });
    assert.equal((await w.back()).ok, false);
    assert.deepEqual(w.updates, []); assert.deepEqual(w.removed, []);
  });
  await check('failed tab mutations report failure while preserving the warning', async () => {
    for (const options of [{ failUpdate: true }, { failRemove: true }]) {
      const w = world({}, options); w.tabs.get(2).openerTabId = 1;
      assert.equal((await w.back()).ok, false);
      assert.deepEqual(w.removed, []);
    }
  });
  await check('ordinary and child-frame navigation never records source URLs', async () => {
    const w = world();
    w.api.noteDownloadSiteNavigation({ tabId: 2, frameId: 0, url: 'https://normal.example/' });
    w.api.noteDownloadSiteNavigation({ tabId: 2, frameId: 1, url: 'https://whuw8g.site/' });
    await w.api.flush(); assert.equal(w.shared[key], undefined);
  });
  await check('warning-page arrival can retain a source when no target navigation event was exposed', async () => {
    const w = world(); w.ctx.LAST_TOP_URL[2] = 'https://catalog.example/game';
    w.api.noteDownloadSiteNavigation({ tabId: 2, frameId: 0, url: warning });
    await w.api.flush();
    assert.equal((await w.back()).ok, true);
    assert.equal(w.updates[0].change.url, 'https://catalog.example/game');
  });
  await check('record validation bounds count and rejects malformed timestamps and identifiers', async () => {
    const w = world(), records = {};
    for (let i = 0; i < 110; i++) records[i] = { at: 1800000000000, sourceTabId: i + 1 };
    records.bad = { at: 1800000000000, sourceTabId: 1 };
    records[500] = { at: 1800000000001, sourceTabId: 1 };
    records[501] = { at: '1800000000000', sourceTabId: 1 };
    assert.equal(Object.keys(w.api.downloadSiteReturnRecords(records)).length, 100);
  });
  console.log(count + ' download-site return checks passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
