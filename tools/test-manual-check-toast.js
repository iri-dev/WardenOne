/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/*
 * An answer to a question the reader asked must always be shown.
 *
 * The four right-click entries -- "Check this link", "Check the selected text",
 * "Where is this image from?" and "What is this frame?" -- all report through
 * wardenManualNotice, which raises a detected_manual_check toast in the page.
 *
 * They appeared to do nothing. Five separate gates in showToast could swallow
 * the answer, and every one of them exists to stop WardenOne interrupting
 * people who did NOT ask:
 *
 *   1. WO.enabled            (forced false on YouTube until the compat fix)
 *   2. WO.showToasts         (same, and the reader can switch it off)
 *   3. shouldQuietToast      -- remembers each type per host for THIRTY MINUTES
 *   4. notificationPreference -- 'off' or 'history' mode
 *   5. toastSeen             -- per-page dedup on the card's wording
 *
 * Gate 3 is the one that made it look broken: after the first check on a site,
 * every later check on that site was silent for half an hour. Someone trying
 * the feature out -- clicking several entries in a row to see what they do --
 * hits it immediately and concludes none of them work.
 *
 * A manual check is not a notification. It is the answer to a request made a
 * second ago, so it bypasses all five.
 *
 * Run: node tools/test-manual-check-toast.js
 */
'use strict';

const fs = require('fs');
const vm = require('vm');

const SRC = fs.readFileSync('src/content.js', 'utf8');
const MIN = fs.readFileSync('content.min.js', 'utf8');
const BG = fs.readFileSync('background.js', 'utf8');
let failed = 0;

function check(what, ok, why) {
  if (ok) return;
  failed++;
  console.error('[fail] ' + what + (why ? ' -- ' + why : ''));
}

/* ---- 1. the gate really would swallow it -------------------------------- *
 * Runs the shipped shouldQuietToast. Without this half the bypass below is a
 * fix for a problem nobody demonstrated. */
function loadQuietRule() {
  const at = MIN.indexOf('shouldQuietToast=(type,detail)=>{');
  if (at < 0) return null;
  const open = MIN.indexOf('{', MIN.indexOf('=>', at));
  let depth = 0, end = open;
  for (; end < MIN.length; end++) {
    if (MIN[end] === '{') depth++;
    else if (MIN[end] === '}') { depth--; if (!depth) break; }
  }
  const body = MIN.slice(open + 1, end);
  const sandbox = { WO: {}, Object, Number, Date, String, location: { hostname: 'example.com' }, __quiet: null };
  vm.createContext(sandbox);
  return (type, detail, wo) => {
    sandbox.WO = wo || {};
    sandbox.__type = type;
    sandbox.__detail = detail;
    vm.runInContext('__quiet=(function(type,detail){' + body + 'return!1})(__type,__detail);', sandbox);
    return sandbox.__quiet;
  };
}
const quiet = loadQuietRule();
check('shouldQuietToast is in the shipped engine', !!quiet);
if (quiet) {
  const seenRecently = { toastMemory: { 'detected_manual_check|example.com': Date.now() - 60000 } };
  check('a second manual check on the same host WOULD be muted by the quiet rule',
    quiet('detected_manual_check', {}, seenRecently) === true,
    'if this stops being true the bug is gone and the bypass can be reconsidered');
  check('the mute window is thirty minutes, not seconds',
    quiet('detected_manual_check', {},
      { toastMemory: { 'detected_manual_check|example.com': Date.now() - 25 * 60000 } }) === true,
    'a check 25 minutes later was still being swallowed');
  check('an unrelated host is unaffected',
    quiet('detected_manual_check', {},
      { toastMemory: { 'detected_manual_check|other.example': Date.now() } }) !== true);
  /* The mute list is the same story with a different switch. */
  check('a muted type WOULD also be swallowed',
    quiet('detected_manual_check', {}, { toastMutes: { detected_manual_check: 0 } }) === true);
}

/* ---- 2. so showToast has to bypass every gate for it -------------------- */
const at = MIN.indexOf('const showToast=(type,detail)=>{');
check('showToast is in the shipped engine', at >= 0);
// The rationale comment survives minification and is ~900 chars, so the window
// has to clear it before the gates begin.
const head = at >= 0 ? MIN.slice(at, at + 2600) : '';

check('showToast recognises a check the reader asked for',
  /const asked="detected_manual_check"===type;/.test(head),
  'the bypass keys on this');
check('gates 1-3 are skipped for it',
  /if\(!asked&&\(!WO\.enabled\|\|!WO\.showToasts\|\|shouldQuietToast\(type,detail\)\)\)return;/.test(head),
  'enabled, showToasts and the thirty-minute quiet rule');
check('gate 4 is skipped for it',
  /if\(!asked\)\{const preference=notificationPreference\(type\);/.test(head),
  'a notification preference of off/history must not hide an answer that was asked for');
check('gate 5 is skipped for it',
  /if\(!asked&&toastSeen\.has\(key\)\)return;/.test(MIN),
  'asking the same question twice is reasonable; the answer is not less true');

/* ---- 3. and nothing else gained a free pass ----------------------------- *
 * The bypass must be exactly one type. If `asked` ever went true for anything
 * else, every gate above would be off for it too. */
check('the bypass is exactly one type, matched by equality',
  (head.match(/asked=/g) || []).length === 1
    && !/asked=.*\|\|/.test(head.split(';')[0] + ';'),
  'a widened condition would silently unmute unrelated warnings');
check('ordinary warnings still pass through every gate',
  /if\(!asked&&\(!WO\.enabled/.test(head) && !/if\(!WO\.enabled\|\|!WO\.showToasts\|\|shouldQuietToast/.test(head),
  'the old unconditional form must be gone, not duplicated');

/* ---- 4. the chain from the menu to the toast ---------------------------- */
check('the four menu entries exist',
  /item\(WO_MENU_LINK, 'Check this link'\);/.test(BG)
    && /item\(WO_MENU_SELECTION, 'Check the selected text'\);/.test(BG)
    && /item\(WO_MENU_MEDIA, 'Where is this image from\?'\);/.test(BG)
    && /item\(WO_MENU_FRAME, 'What is this frame\?'\);/.test(BG));
check('each is wired to a handler',
  /info\.menuItemId === WO_MENU_LINK/.test(BG)
    && /info\.menuItemId === WO_MENU_SELECTION/.test(BG)
    && /info\.menuItemId === WO_MENU_MEDIA/.test(BG)
    && /info\.menuItemId === WO_MENU_FRAME/.test(BG));
check('they all report through wardenManualNotice',
  /async function wardenManualNotice\(title, message, tab, id\)/.test(BG));
check('which raises exactly the type showToast now lets through',
  /type: 'detected_manual_check'/.test(BG));
check('and the engine has copy for that type',
  /detected_manual_check:\{[\s\S]{0,200}?title:"WardenOne check"/.test(MIN));

/* The notice is dispatched from the ISOLATED world by chrome.scripting and read
   by a MAIN-world listener. That boundary was checked against real Chrome via
   CDP Page.createIsolatedWorld: a CustomEvent's detail crosses it intact, so the
   dispatch is sound and the fault was entirely in the gates above. Pinned so a
   future reader does not re-suspect the world boundary. */
check('the notice is still dispatched as a DOM CustomEvent',
  /document\.dispatchEvent\(new CustomEvent\('wo-event'/.test(BG));

if (failed) {
  console.error('manual check toast: ' + failed + ' failed');
  process.exit(1);
}
console.log('manual check toast: all checks passed');
