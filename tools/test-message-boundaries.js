/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE. */
'use strict';
const assert = require('assert/strict');
const fs = require('fs');
const vm = require('vm');
const { loadBackground } = require('./test-message-rate-limits.js');
const inventory = require('./audit-message-boundaries.js');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function run() {
  assert.equal(fs.readFileSync(inventory.output, 'utf8'), JSON.stringify(inventory.generate(), null, 2) + '\n', 'message inventory must match source and generated scripts');
  const h = loadBackground();
  await sleep(100);
  const tab = { id: h.chrome.runtime.id, frameId: 0, tab: { id: 91, url: 'https://benign.example/page' }, url: 'https://benign.example/page', origin: 'https://benign.example' };
  const learned = [];
  h.ctx.learnDomain = (...args) => learned.push(args);
  const deliver = (message, sender = tab) => {
    const replies = [];
    for (const fn of h.chrome.runtime.onMessage._l) fn(message, sender, reply => replies.push(reply));
    return replies;
  };
  deliver({ kind: 'rg-block', type: 'detected_grabber_domain', detail: { host: 'benign.example' } });
  const forgedRecovery = deliver({ kind: 'site-recovery', action: 'start', tabId: 91, key: 'removeOverlays' });
  assert.equal(forgedRecovery.length, 1);
  assert.equal(forgedRecovery[0].ok, false, 'web content cannot start a site recovery trial');
  for (const message of [{ kind: 'tracker-learner-history', filter: 'all' }, { kind: 'tracker-learner-decide', domain: 'victim.example', decision: 'unblock' }]) {
    const replies = deliver(message);
    assert.equal(replies.length, 1);
    assert.equal(replies[0].ok, false, 'web content cannot read tracker history or change decisions');
  }
  await sleep(40);
  assert.equal(learned.length, 0, 'page-derived grabber claims must not persist learned blocks');
  for (const sender of [ { ...tab, id: 'foreign-extension' }, { ...tab, id: undefined }, { ...tab, tab: { id: -1 } }, { ...tab, tab: { id: '91' } } ]) {
    assert.equal(h.ctx.messageSenderIsTab(sender), false, 'content senders require our ID and a real numeric tab');
  }
  assert.equal(h.ctx.messageSenderIsExtensionPage({ url: h.chrome.runtime.getURL('popup.html') }), false, 'a URL without our sender ID is not private authority');
  const cookie = { kind: 'set-site-permission', key: 'cookies', setting: 'allow', url: tab.url };
  assert.equal(h.ctx.messageIsCookiePermissionEscape(cookie, tab), true);
  for (const sender of [{ ...tab, frameId: 1 }, { ...tab, url: 'https://attacker.example/frame' }]) {
    assert.equal(h.ctx.messageIsCookiePermissionEscape(cookie, sender), false, 'a foreign frame cannot change the top site cookie permission');
  }
  assert.equal(h.ctx.messageIsCookiePermissionEscape({ ...cookie, url: 'https://benign.example:8443/' }, tab), false, 'cookie escape must match the browser origin including port');
  const poison = JSON.parse('{"kind":"rg-block","type":"blocked_ad_request","detail":{"__proto__":{"polluted":true}}}');
  const deep = { kind: 'rg-block', type: 'blocked_ad_request', detail: {} };
  let cursor = deep.detail;
  for (let i = 0; i < 24; i++) cursor = cursor.next = {};
  const cyclic = { kind: 'rg-block' }; cyclic.self = cyclic;
  const malformed = [null, [], 'rg-block', {}, { kind: [] }, { kind: 'x'.repeat(500) }, poison, deep, cyclic,
    { kind: 'rg-block', detail: 'x'.repeat(100000) }, { kind: 'rg-block', detail: Array(2000).fill('x') }];
  const activity = [];
  h.ctx.queueHistory = item => activity.push(item);
  const badgeBefore = h.badge.length;
  for (const message of malformed) {
    let replies;
    assert.doesNotThrow(() => { replies = deliver(message); }, 'malformed input must not throw in either listener');
    assert.equal(replies.length, 1, 'only the router responds to rejected messages');
    assert.equal(replies[0].ok, false);
    assert.match(replies[0].error, /Invalid message/);
  }
  assert.equal(activity.length, 0, 'the independent activity listener must also reject malformed data');
  assert.equal(h.badge.length, badgeBefore);
  for (const url of ['https://benign.example.evil/', 'https://benign.example@evil.example/',
    'https://xn--bnign-bsa.example/', 'https://benign.example:8443/', 'http://benign.example/',
    'http://2130706433/', 'http://[::1]/', 'javascript:alert(1)', 'https://%',
    'https://user:password@benign.example/']) {
    assert.equal(h.ctx.messageIsCookiePermissionEscape({ ...cookie, url }, tab), false, url);
  }
  const currentSender = { ...tab, documentId: 'current-document' };
  h.ctx.tabsGet = async () => ({ id: 91, url: tab.url, incognito: false });
  h.chrome.webNavigation.getFrame = async () => ({ documentId: 'current-document' });
  assert.equal(await h.ctx.messageSenderStillCurrent(currentSender), true);
  assert.equal(await h.ctx.messageSenderStillCurrent(tab), false, 'missing document authority fails closed');
  for (const current of [null, { id: 91, url: 'https://elsewhere.example/', incognito: false },
    { id: 91, url: tab.url, incognito: true }]) {
    h.ctx.tabsGet = async () => current;
    assert.equal(await h.ctx.messageSenderStillCurrent(currentSender), false);
  }
  h.ctx.tabsGet = async () => ({ id: 91, url: tab.url, incognito: false });
  h.chrome.webNavigation.getFrame = async () => ({ documentId: 'replaced-document' });
  assert.equal(await h.ctx.messageSenderStillCurrent(currentSender), false, 'same-origin replacement revokes old document authority');
  assert.equal({}.polluted, undefined);
  assert.equal(learned.length, 0);
  const offscreen = fs.readFileSync('offscreen.js', 'utf8');
  let soundListener;
  const sounds = [];
  const box = { chrome: { runtime: { id: h.chrome.runtime.id, getURL: p => h.chrome.runtime.getURL(p), onMessage: { addListener(fn) { soundListener = fn; } } } },
    playTone: async (...args) => { sounds.push(args); return true; }, Number, Math, URL };
  vm.runInNewContext(offscreen.slice(offscreen.indexOf('chrome.runtime.onMessage.addListener')), box);
  const sound = { target: 'wardenone-offscreen', type: 'play-notification-sound', sound: 'block', volume: 0.5 };
  assert.equal(soundListener(sound, tab, () => {}), false, 'web content cannot drive offscreen audio');
  assert.equal(soundListener(sound, { id: tab.id, url: h.chrome.runtime.getURL('popup.html') }, () => {}), false, 'private pages use the worker sound handler');
  assert.equal(soundListener(sound, { id: tab.id, url: h.chrome.runtime.getURL('background.js') }, () => {}), true);
  await sleep(0);
  assert.equal(sounds.length, 1);
  console.log('[ok] separate worker listeners, sender identity, frame origin, malformed payloads and offscreen authority');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
