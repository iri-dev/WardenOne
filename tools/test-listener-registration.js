/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/*
 * One listener failing to register does not take the ones after it down.
 * Run: node tools/test-listener-registration.js
 *
 * Five listeners across three Chrome namespaces -- the redirect-hop recorder, the redirect-chain
 * evaluator, the popup tracker, the tab-close cleanups and the forced-redirect guard -- were
 * registered inside one try at the top of the worker. A throw in the first (an invalid filter, an
 * API unavailable at call time, a future API change) would have been swallowed by the shared catch
 * and the other four would never have registered: for the rest of that worker lifetime the
 * forced-redirect interstitial, the redirect-chain warning and both on-leave cleanups would have
 * been absent while every setting reported them on, with no log and no health signal (LIFE-04).
 * Two more blocks -- in the download guard and Memory Shield -- mixed namespaces the same way.
 *
 * Each registration now goes through registerListener, which catches on its own and records the
 * name of what could not register for Protection Health to report; the two other blocks are split
 * by namespace. This suite makes the first registration throw and proves the other four still
 * register and the failure is named, and it is the card's regression assertion: no top-level try in
 * any worker file registers listeners for more than one Chrome API namespace, so the next merge
 * cannot widen a failure domain silently.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const WORKERS = ['background.js', 'background-downloads.js', 'background-memory.js', 'background-extension-watch.js', 'background-extension-reputation.js', 'background-startup.js'];
const BG = fs.readFileSync(path.join(ROOT, 'background.js'), 'utf8');

let pass = 0;
const failures = [];
function check(name, cond, detail) {
  if (cond) { pass++; return; }
  failures.push(name + (detail ? ' — ' + detail : ''));
}

/* ---- the card's regression assertion: one namespace per shared try ------------------------- */
{
  const mixed = [];
  let blocks = 0;
  for (const f of WORKERS) {
    const lines = fs.readFileSync(path.join(ROOT, f), 'utf8').split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (!/^try \{\s*$/.test(lines[i])) continue;
      let j = i + 1;
      while (j < lines.length && !/^\} catch/.test(lines[j])) j++;
      const block = lines.slice(i, j + 1).join('\n');
      const regs = [...block.matchAll(/chrome\.([a-zA-Z]+)(?:\?)?\.([a-zA-Z]+)(?:\?)?\.addListener\(/g)].map((m) => m[1] + '.' + m[2]);
      if (!regs.length) continue;
      blocks++;
      const ns = new Set(regs.map((r) => r.split('.')[0]));
      if (ns.size > 1) mixed.push(f + ':' + (i + 1) + ' registers ' + regs.join(', '));
    }
  }
  check('the census still sees the worker\'s top-level registration blocks', blocks >= 15, blocks + ' block(s)');
  check('no top-level try registers listeners for more than one Chrome API namespace', mixed.length === 0, mixed.join('; '));
}

/* ---- the block that carried the two navigation guards ------------------------------------- */
const start = BG.indexOf('const LISTENERS_NOT_REGISTERED = [];');
const end = BG.indexOf("// There is no tabs.onUpdated fallback for that reset.", start);
check('the redirect block is registered one listener at a time', start >= 0 && end > start, 'registerListener block not found');

function boot(options) {
  const o = options || {};
  const registered = [];
  const listener = (name) => ({
    addListener: (fn, filter) => {
      if (o.throwOn === name) throw new Error(o.throwOn + ' refused the filter');
      registered.push({ name, fn, filter });
    },
  });
  const sandbox = {
    console: { warn() {}, log() {} }, Object, Array, String, Number, Date, Error,
    chrome: {
      webRequest: { onBeforeRedirect: listener('webRequest.onBeforeRedirect') },
      webNavigation: {
        onCompleted: listener('webNavigation.onCompleted'),
        onCreatedNavigationTarget: listener('webNavigation.onCreatedNavigationTarget'),
        onCommitted: listener('webNavigation.onCommitted'),
      },
      tabs: { onRemoved: listener('tabs.onRemoved') },
    },
    noteRedirectHop() {}, evaluateRedirectChain() {}, domainOfTab() { return ''; }, forgetNavSignals() {}, forgetRebindTab() {},
    forgetWarningRecordsForTab() {}, maybeClearOnLeave() {}, maybeClearServiceWorkersOnLeave() {}, maybeBlockForcedTopRedirect() {},
    POPUP_OPENED_AT: {}, REDIRECT_CHAINS: {}, LAST_TOP_URL: {},
  };
  const ctx = vm.createContext(sandbox);
  vm.runInContext(BG.slice(start, end) + '\nthis.api = { LISTENERS_NOT_REGISTERED, registerListener };', ctx, { filename: 'listener-block.js' });
  return { registered, api: sandbox.api, sandbox };
}

if (start >= 0 && end > start) {
  {
    const b = boot();
    check('with nothing throwing, all five listeners register', b.registered.length === 5 && b.api.LISTENERS_NOT_REGISTERED.length === 0,
      b.registered.map((r) => r.name).join(', '));
    const hop = b.registered.find((r) => r.name === 'webRequest.onBeforeRedirect');
    check('the redirect-hop listener still carries its main_frame filter', !!hop && hop.filter && hop.filter.types && hop.filter.types[0] === 'main_frame');
  }
  {
    /* The card's verification: the first registration throws. */
    const b = boot({ throwOn: 'webRequest.onBeforeRedirect' });
    check('when the first registration throws, the other four still register',
      b.registered.length === 4 && b.registered.map((r) => r.name).join(',') === 'webNavigation.onCompleted,webNavigation.onCreatedNavigationTarget,tabs.onRemoved,webNavigation.onCommitted',
      b.registered.map((r) => r.name).join(', '));
    check('and the failure is recorded by the name a reader would recognise', b.api.LISTENERS_NOT_REGISTERED.join(',') === 'redirect-hop recording', b.api.LISTENERS_NOT_REGISTERED.join(','));
    /* And the guard the card was most worried about still works through its listener. */
    const commit = b.registered.find((r) => r.name === 'webNavigation.onCommitted');
    let guardCalled = false;
    b.sandbox.maybeBlockForcedTopRedirect = () => { guardCalled = true; };
    commit.fn({ frameId: 0, tabId: 7, url: 'https://next.example/' });
    check('the forced-redirect guard runs on the committed navigation', guardCalled && b.sandbox.LAST_TOP_URL[7] === 'https://next.example/');
  }
  {
    const b = boot({ throwOn: 'tabs.onRemoved' });
    check('a throw in the middle costs only that one listener', b.registered.length === 4 && b.api.LISTENERS_NOT_REGISTERED.join(',') === 'tab-close cleanup',
      b.registered.map((r) => r.name).join(', ') + ' / ' + b.api.LISTENERS_NOT_REGISTERED.join(','));
  }
  {
    const b = boot();
    check('the helper reports its outcome', b.api.registerListener('x', () => {}) === true && b.api.registerListener('y', () => { throw new Error('no'); }) === false
      && b.api.LISTENERS_NOT_REGISTERED.join(',') === 'y');
  }
}

/* ---- Protection Health says so --------------------------------------------------------------- */
check('Protection Health reports a listener that could not register as a top-level danger',
  /if \(LISTENERS_NOT_REGISTERED\.length\) \{\s*addIssue\('danger', 'Could not start in this browser session: ' \+ LISTENERS_NOT_REGISTERED\.slice\(0, 6\)\.join\(', '\)/.test(BG)
    && /restarting the browser usually clears this\.', true\);/.test(BG));

console.log('');
if (failures.length) {
  for (const f of failures) console.log('  FAIL ' + f);
  console.log('\n' + failures.length + ' check(s) failed, ' + pass + ' passed');
  process.exit(1);
}
console.log('  ok  ' + pass + ' checks: one listener failing to register costs that listener, and the popup is told');
