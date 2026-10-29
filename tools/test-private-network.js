/* WardenOne — Copyright (C) 2026 iri; GPL-3.0-or-later. See LICENSE. */
'use strict';
const assert = require('assert/strict');
const { loadBackground } = require('./test-message-rate-limits.js');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function run() {
  for (const incognito of [false, true]) {
    const h = loadBackground({ incognito }); await sleep(100);
    const requests = [];
    h.ctx.fetch = async (url, options) => {
      requests.push({ url, options });
      assert.equal(new URL(url).hostname, 'rdap.org', 'the explicit age check has one expected initial provider');
      return new Response(JSON.stringify({ events: [{ eventAction: 'registration', eventDate: '2000-01-01T00:00:00Z' }] }),
        { headers: { 'content-type': 'application/rdap+json' } });
    };
    const tab = { id: h.chrome.runtime.id, frameId: 0, tab: { id: 77, url: 'https://www.example.org/login?token=SECRET' },
      url: 'https://www.example.org/login?token=SECRET', origin: 'https://www.example.org' };
    const send = (message, sender) => new Promise(resolve => {
      for (const fn of h.chrome.runtime.onMessage._l) fn(message, sender, resolve);
    });
    const denied = await send({ kind: 'domain-age', domain: 'www.example.org' }, tab);
    assert.equal(denied.ok, false);
    assert.equal((await send({ kind: 'safe-browsing-check', url: tab.url, context: 'link' }, tab)).enabled, false);
    assert.deepEqual(requests, [], 'ordinary page messages with optional providers off disclose no checked hostname');
    const ui = { id: h.chrome.runtime.id, url: h.chrome.runtime.getURL('popup.html') };
    const age = await send({ kind: 'domain-age', domain: 'www.example.org' }, ui);
    assert.equal(age.ok, true);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, 'https://rdap.org/domain/example.org');
    assert.equal(requests[0].options.credentials, 'omit');
    assert(!JSON.stringify(requests).includes('SECRET'));
    assert.equal(!!h.chrome.storage.local._data.wardenone_domain_age_cache, !incognito,
      'private domain checks cannot write the normal profile cache');
  }
  console.log('[ok] controlled manual RDAP destination, no page bridge lookup, disabled-provider silence and incognito cache isolation');
}
run().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
