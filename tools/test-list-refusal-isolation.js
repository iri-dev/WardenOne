/* WardenOne — Copyright (C) 2026 iri; GPL-3.0-or-later. See LICENSE. */
/* One refused feed is set aside on its own; the others still update.
   From 20 to 26 November 2026 threatview and TweetFeed took turns being refused, and because a refusal threw the
   whole refresh away, none of the 32 feeds updated for six days. Runs the real refresh with fake feeds.
   Run: node tools/test-list-refusal-isolation.js */
'use strict';
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { loadBackground } = require('./test-message-rate-limits.js');

const ROOT = path.resolve(__dirname, '..');
const THREATVIEW = 'https://threatview.io/Downloads/DOMAIN-High-Confidence-Feed.txt';
const SCAM = 'https://raw.githubusercontent.com/durablenapkin/scamblocklist/master/hosts.txt';
const ADULT = 'https://raw.githubusercontent.com/StevenBlack/hosts/master/alternates/porn-only/hosts';
const GRABBER = 'https://raw.githubusercontent.com/TMAFE/anti-grabify/master/url_list.txt';
const hosts = (prefix, count) => Array.from({ length: count }, (_, i) => prefix + '-' + i + '.feed-fixture.net');
const slug = (url) => url.replace(/[^a-z0-9]+/gi, '').slice(-24).toLowerCase();

async function run() {
  const h = loadBackground();
  await new Promise((resolve) => setTimeout(resolve, 100));
  const rules = new Map();
  h.chrome.declarativeNetRequest.getDynamicRules = async ({ ruleIds } = {}) => [...rules.values()].filter((rule) => !ruleIds || ruleIds.includes(rule.id));
  h.chrome.declarativeNetRequest.updateDynamicRules = async (change) => {
    for (const id of change.removeRuleIds || []) rules.delete(id);
    for (const rule of change.addRules || []) rules.set(rule.id, rule);
  };
  /* What each feed serves right now; anything not named serves its own steady list. */
  const serve = new Map();
  h.ctx.fetch = async (input) => {
    const address = String(input);
    if (address.startsWith(h.chrome.runtime.getURL(''))) {
      return new Response(fs.readFileSync(path.join(ROOT, address.slice(h.chrome.runtime.getURL('').length))), { status: 200 });
    }
    const body = serve.has(address) ? serve.get(address) : hosts('steady-' + slug(address), 60);
    return new Response(body.map((host) => '0.0.0.0 ' + host).join('\n'), { status: 200 });
  };
  await h.ctx.updateStoredConfig((cfg) => Object.assign(cfg, { enabled: true, autoUpdateLists: true, blockMalwareSites: true, blockTrackers: false, adShield: false }));
  const installed = (host) => [...rules.values()].some((rule) => (rule.condition.requestDomains || []).includes(host));
  const baseline = async (url) => {
    const stored = await h.ctx.localGet('wardenone_list_integrity');
    return stored.wardenone_list_integrity.sources[url];
  };
  /* As updateRemoteLists does: hold the shared download broker for the run, so the next run fetches afresh. */
  const broker = vm.runInContext('LIST_BROKER', h.ctx);
  const refresh = async (name) => {
    broker.retain();
    try { return await h.ctx[name]('manual'); } finally { broker.release(); }
  };

  /* 1. Every feed healthy. */
  serve.set(THREATVIEW, hosts('tv-real', 60));
  serve.set(SCAM, hosts('scam', 60));
  const first = await refresh('updateRemoteListsCore');
  assert.equal(first.ok, true, first.error);
  assert(installed('tv-real-0.feed-fixture.net') && installed('scam-0.feed-fixture.net'));
  const realThreatview = await baseline(THREATVIEW);
  assert(realThreatview && realThreatview.sha256, 'the first copy becomes the baseline');

  /* 2. ThreatView serves something else entirely; the scam list gains a site the same day. */
  serve.set(THREATVIEW, hosts('tv-swapped', 60));
  serve.set(SCAM, hosts('scam', 60).concat('scam-fresh.feed-fixture.net'));
  const second = await refresh('updateRemoteListsCore');
  assert.equal(second.ok, true, 'one refused feed no longer refuses the whole refresh: ' + second.error);
  assert(installed('scam-fresh.feed-fixture.net'), 'the other feeds still update');
  assert(!installed('tv-swapped-0.feed-fixture.net'), 'the refused copy never lands');
  assert(!installed('tv-real-0.feed-fixture.net'), 'the refused feed is set aside like an unreachable one, not mixed with its old copy');
  assert.equal(second.meta.sources.rejected, 1);
  const held = second.meta.sources.failures.find((f) => f.url === THREATVIEW);
  assert(held && held.rejected === true && /overlap/.test(held.error), JSON.stringify(second.meta.sources.failures));
  assert.equal((await baseline(THREATVIEW)).sha256, realThreatview.sha256, 'the refused copy never becomes the baseline');
  assert.equal(h.ctx.listUpdateNeedsRetry(second), false, 'a refusal is on purpose, so nothing is fetched again early');
  const meta = await h.ctx.getListMeta();
  assert(Date.now() - meta.updated < 60000, 'the list status shows today\'s update');

  /* 3. The real list comes back and is accepted against the baseline it was refused against. */
  serve.set(THREATVIEW, hosts('tv-real', 60));
  const third = await refresh('updateRemoteListsCore');
  assert.equal(third.ok, true, third.error);
  assert.equal(third.meta.sources.rejected, 0);
  assert(installed('tv-real-0.feed-fixture.net') && installed('scam-fresh.feed-fixture.net'));

  /* 4. Everything refused at once still keeps the installed lists: the combined drop guard is the backstop. */
  for (const url of vm.runInContext('REMOTE_LISTS.concat(TOKEN_AND_SCAM_LISTS, MALWARE_LISTS)', h.ctx)) serve.set(url, hosts('swap-' + slug(url), 60));
  const allSwapped = await refresh('updateRemoteListsCore');
  assert.equal(allSwapped.ok, false, 'every feed refused is not an update');
  assert(installed('tv-real-0.feed-fixture.net') && installed('scam-fresh.feed-fixture.net'), 'the installed lists stay');

  /* The page lists: a refused list keeps its previous copy while the others update. */
  serve.set(ADULT, hosts('adult', 60));
  serve.set(GRABBER, hosts('grabber', 60));
  const pagesFirst = await refresh('updateSupplementalLists');
  assert.equal(pagesFirst.ok, true, pagesFirst.error);
  serve.set(ADULT, hosts('adult-swapped', 60));
  serve.set(GRABBER, hosts('grabber', 60).concat('grabber-fresh.feed-fixture.net'));
  const pages = await refresh('updateSupplementalLists');
  assert.equal(pages.ok, true, 'one refused page list no longer holds the others back: ' + pages.error);
  const lists = (await h.ctx.localGet('wardenone_aux_lists')).wardenone_aux_lists;
  assert(lists.grabberDomainsExtra.includes('grabber-fresh.feed-fixture.net'), 'the other page lists update');
  assert(lists.adultDomainsExtra.includes('adult-0.feed-fixture.net'), 'the refused list keeps its previous copy');
  assert(!lists.adultDomainsExtra.includes('adult-swapped-0.feed-fixture.net'), 'and its refused copy never lands');
  assert.equal(pages.meta.sources.rejected, 1);

  console.log('[ok] a refused feed is set aside alone: the others update, its copy and baseline never land, and it returns when healthy');
}
run().catch((error) => { console.error(error); process.exitCode = 1; });
