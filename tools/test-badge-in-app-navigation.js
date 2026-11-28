/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne */
'use strict';
/* Page badge actions after an in-app navigation. Chrome keeps sender.url at the address the document
   loaded with after history.pushState, so an exact URL match answered "This page is no longer current."
   on YouTube and Twitch once the reader had moved to another video or channel. */
const assert = require('assert/strict');
const { loadBackground } = require('./test-message-rate-limits.js');

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const LOADED_URL = 'https://www.youtube.com/';
const CURRENT_URL = 'https://www.youtube.com/watch?v=next-video';
const REQUESTS = [
  { kind: 'badge-beacon-state', destinations: [] },
  { kind: 'badge-rule-settings', type: 'blocked_popup' },
  { kind: 'badge-open-activity' },
];

async function run() {
  const h = loadBackground();
  await sleep(100);
  const browser = { tabUrl: CURRENT_URL, documentId: 'watch-document' };
  const opened = [];
  h.ctx.tabsGet = async id => ({ id, url: browser.tabUrl, incognito: false });
  h.chrome.webNavigation.getFrame = async () => ({ documentId: browser.documentId });
  h.chrome.tabs.create = async change => { opened.push(change.url); return { id: 900 + opened.length }; };
  const sender = (tabId, extra = {}) => Object.assign({ id: h.chrome.runtime.id, frameId: 0, documentId: 'watch-document',
    url: LOADED_URL, origin: 'https://www.youtube.com', tab: { id: tabId, url: CURRENT_URL, incognito: false } }, extra);
  const send = (message, from) => new Promise(resolve => {
    for (const listener of h.chrome.runtime.onMessage._l) listener(message, from, resolve);
  });

  for (const [index, message] of REQUESTS.entries()) {
    const reply = await send(message, sender(701 + index));
    assert.equal(reply.ok, true, message.kind + ' works after an in-app navigation: ' + JSON.stringify(reply));
  }
  assert.equal(opened.length, 2, 'settings and activity each open their page once');
  console.log('[ok] badge beacon state, rule settings and activity work after an in-app navigation');

  const refusals = [
    { name: 'a full navigation replaced the document', document: 'replacement-document' },
    { name: 'the tab is now on another site', tabUrl: 'https://elsewhere.example/' },
    { name: 'a subframe asked', extra: { frameId: 1 } },
  ];
  for (const [index, item] of refusals.entries()) {
    browser.tabUrl = item.tabUrl || CURRENT_URL;
    browser.documentId = item.document || 'watch-document';
    for (const [offset, message] of REQUESTS.entries()) {
      const reply = await send(message, sender(720 + index * 10 + offset, item.extra));
      assert.equal(reply.ok, false, item.name + ' refuses ' + message.kind + ': ' + JSON.stringify(reply));
      assert.notEqual(reply.error, 'Rate limited.', item.name + ' is refused by the sender check, not the ceiling');
    }
  }
  assert.equal(opened.length, 2, 'a refused sender opens nothing');
  console.log('[ok] a replaced document, another site and a subframe are still refused');
}

run().catch(error => { console.error(error); process.exitCode = 1; });
