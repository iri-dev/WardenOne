/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/* A "Popup blocked" card drawn on a page that navigates a moment later goes with that page. The
   popunder that fires on a link press is refused and then sends the tab on to the link itself
   (pawchive.pw), so the reader never saw a card for any block there. The worker draws the notice
   once more on the page that replaced it. Run: node tools/test-page-notice-carry.js */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const BG = fs.readFileSync(path.join(__dirname, '..', 'background.js'), 'utf8');
let pass = 0;
let fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  ok  - ' + name); return; }
  fail++;
  console.log('  FAIL - ' + name + (extra === undefined ? '' : ' :: ' + JSON.stringify(extra)));
}

const start = BG.indexOf('const FRAME_ACTION_NOTICE_TYPES = new Set([');
const end = BG.indexOf('function notifyBlockedPopup(tabId, detail) {', start);
if (start < 0 || end < start) throw new Error('the page notice block was not found in background.js');

function worker() {
  let now = 1000000;
  const sent = [];
  const sandbox = {
    Object, String, Number, Set,
    Date: { now: () => now },
    chrome: { runtime: { lastError: null }, tabs: { sendMessage: (tabId, message, options) => { sent.push({ tabId, message, options }); } } },
  };
  vm.createContext(sandbox);
  vm.runInContext(BG.slice(start, end) + '\nthis.api = { notifyBlockedAction, noteRecentPageNotice, carryPageNoticeOnCommit, deliverCarriedPageNotice, forgetPageNotices };', sandbox);
  return Object.assign(sandbox.api, { sent, advance(ms) { now += ms; } });
}
const top = (tabId) => ({ tabId, frameId: 0 });

console.log('a block the top page reported, then a new page');
{
  const w = worker();
  w.noteRecentPageNotice(7, 'blocked_popup', { why: 'ad-auction popup', matched: 'qmyamxdku.in', url: 'https://qmyamxdku.in/odtafx?x' });
  check('the page drew its own card, so nothing is sent yet', w.sent.length === 0, w.sent);
  w.advance(150);
  w.carryPageNoticeOnCommit(top(7));
  check('nor at the commit: the new page cannot draw yet', w.sent.length === 0, w.sent);
  w.deliverCarriedPageNotice(top(7));
  const n = w.sent[0];
  check('once the new page has loaded, the notice is drawn there',
    w.sent.length === 1 && n.tabId === 7 && n.options.frameId === 0 && n.message.kind === 'wo-blocked-action'
      && n.message.type === 'blocked_popup' && n.message.detail.why === 'ad-auction popup' && n.message.detail.matched === 'qmyamxdku.in', w.sent);
  check('carrying only what the card shows, not the blocked address', !('url' in n.message.detail), n.message.detail);
  w.deliverCarriedPageNotice(top(7));
  check('once', w.sent.length === 1, w.sent);
  w.advance(100);
  w.carryPageNoticeOnCommit(top(7));
  w.deliverCarriedPageNotice(top(7));
  check('and the redrawn card is not carried again to the page after that', w.sent.length === 1, w.sent);
}

console.log('what is not carried');
{
  const w = worker();
  w.noteRecentPageNotice(7, 'blocked_popup', { why: 'x' });
  w.advance(1600);
  w.carryPageNoticeOnCommit(top(7));
  w.deliverCarriedPageNotice(top(7));
  check('a page that stayed long enough to show its card', w.sent.length === 0, w.sent);
}
{
  const w = worker();
  w.noteRecentPageNotice(7, 'blocked_popup', { why: 'x' });
  w.carryPageNoticeOnCommit({ tabId: 7, frameId: 3 });
  w.deliverCarriedPageNotice({ tabId: 7, frameId: 3 });
  check('a child frame loading', w.sent.length === 0, w.sent);
  w.carryPageNoticeOnCommit(top(8));
  w.deliverCarriedPageNotice(top(8));
  check('another tab navigating', w.sent.length === 0, w.sent);
}
{
  const w = worker();
  w.noteRecentPageNotice(7, 'blocked_ad_resource', { why: 'a rule blocked an ad script' });
  w.carryPageNoticeOnCommit(top(7));
  w.deliverCarriedPageNotice(top(7));
  check('a passive resource block, which has no card', w.sent.length === 0, w.sent);
}
{
  const w = worker();
  w.noteRecentPageNotice(7, 'blocked_popup', { why: 'x' });
  w.forgetPageNotices(7);
  w.carryPageNoticeOnCommit(top(7));
  w.deliverCarriedPageNotice(top(7));
  check('a tab that closed', w.sent.length === 0, w.sent);
}

console.log('only the document that replaced it');
{
  const w = worker();
  w.noteRecentPageNotice(7, 'blocked_popup', { why: 'ad-auction popup', matched: 'qmyamxdku.in' });
  w.carryPageNoticeOnCommit({ tabId: 7, frameId: 0, documentId: 'PRE', documentLifecycle: 'prerender', frameType: 'outermost_frame' });
  w.deliverCarriedPageNotice({ tabId: 7, frameId: 0, documentId: 'PRE', documentLifecycle: 'prerender', frameType: 'outermost_frame' });
  check('a prerendered page committing in the background neither takes the notice nor gets it', w.sent.length === 0, w.sent);
  w.carryPageNoticeOnCommit({ tabId: 7, frameId: 0, documentId: 'NEW', documentLifecycle: 'active', frameType: 'outermost_frame' });
  w.deliverCarriedPageNotice({ tabId: 7, frameId: 0, documentId: 'OTHER', documentLifecycle: 'active', frameType: 'outermost_frame' });
  check('another document loading does not take it either', w.sent.length === 0, w.sent);
  w.deliverCarriedPageNotice({ tabId: 7, frameId: 0, documentId: 'NEW', documentLifecycle: 'active', frameType: 'outermost_frame' });
  check('the document that committed gets it, addressed by its id',
    w.sent.length === 1 && w.sent[0].options.documentId === 'NEW' && w.sent[0].options.frameId === undefined, w.sent);
}

console.log('a popup the worker closed, then a new page');
{
  const w = worker();
  w.notifyBlockedAction(7, 'blocked_popup', { why: 'A page opened an ad-auction popup.', matched: 'qmyamxdku.in' });
  check('the notice goes to the page at once', w.sent.length === 1, w.sent);
  w.advance(40);
  w.carryPageNoticeOnCommit(top(7));
  w.deliverCarriedPageNotice(top(7));
  check('and again to the page that replaced it a moment later', w.sent.length === 2 && w.sent[1].message.detail.why === 'A page opened an ad-auction popup.', w.sent);
}

console.log('wiring');
check('a top-frame block is remembered when the worker records it',
  /relayFrameBlockNotice\(tabId, Number\(sender\.frameId\), normalized\);[\s\S]{0,200}if \(Number\(sender\.frameId\) === 0\) noteRecentPageNotice\(tabId, normalized\.type, normalized\.detail\);/.test(BG));
check('the carry is registered on the commit and drawn on the load',
  /registerListener\('blocked-notice carry-over', \(\) => \{\s*chrome\.webNavigation\?\.onCommitted\?\.addListener\(carryPageNoticeOnCommit\);\s*chrome\.webNavigation\?\.onDOMContentLoaded\?\.addListener\(deliverCarriedPageNotice\);/.test(BG));
check('a closed tab forgets its notices', /chrome\.tabs\.onRemoved\.addListener\(\(tabId\) => \{[\s\S]{0,900}forgetPageNotices\(tabId\);/.test(BG));

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
