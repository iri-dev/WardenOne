/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne */
/* The engine starts while the page is still parsing (Round 6 performance, 2026-11-27: Wikipedia parsed in 516 ms with
   the engine and 370 without it). One off sweeps of what the page already holds, and the badge, wait until it has
   parsed and then take an idle task each. Hooks and observers still start at once, and the security sweeps stay
   where they were. Run: node tools/test-engine-start-deferral.js */
'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'src', 'content.js'), 'utf8');
let checks = 0;
const ok = (cond, label) => { assert.ok(cond, label); checks++; };

/* The helper: DOMContentLoaded first while loading, then an idle task; straight to idle once parsed. */
{
  const a = SRC.indexOf('__woAfterParse=fn=>{');
  ok(a > 0, 'the after parse helper is gone');
  const fn = SRC.slice(a, SRC.indexOf('},', a) + 1);
  const run = (readyState) => {
    const listeners = [], idle = [];
    const box = { document: { readyState }, woOn: (t, type, cb, o) => listeners.push({ type, cb, once: o && o.once }), __woIdle: (cb, t) => idle.push({ cb, t }) };
    vm.createContext(box);
    vm.runInContext('const ' + fn + '; this.after = __woAfterParse;', box);
    let ran = 0;
    box.after(() => { ran++; });
    return { listeners, idle, ran: () => ran };
  };
  const loading = run('loading');
  ok(loading.ran() === 0 && loading.idle.length === 0, 'nothing may run while the page is still parsing');
  ok(loading.listeners.length === 1 && loading.listeners[0].type === 'DOMContentLoaded' && loading.listeners[0].once === true, 'it waits for DOMContentLoaded once');
  loading.listeners[0].cb();
  ok(loading.ran() === 0 && loading.idle.length === 1 && loading.idle[0].t >= 250, 'DOMContentLoaded hands it to an idle task, with a timeout so a busy page cannot starve it');
  loading.idle[0].cb();
  ok(loading.ran() === 1, 'the idle task runs it');
  for (const state of ['interactive', 'complete']) {
    const parsed = run(state);
    ok(parsed.listeners.length === 0 && parsed.idle.length === 1, 'a parsed page (' + state + ') goes straight to an idle task');
  }
}

/* The call sites that moved. */
const deferred = {
  'the badge': '__woAfterParse(syncBadgeVisibility)',
  'the overlay cleaner start': '__woAfterParse(start)',
  'the ad collapse sweep': '__woAfterParse(__woSweepAds)',
  'the AMP link sweep': '__woAfterParse(()=>fixLinks(document))',
  'the tracking link sweep': '__woAfterParse(()=>sweepDomLinks(document))',
  'the IP logger image scan': '__woAfterParse(()=>scanImages(document))',
};
for (const [what, call] of Object.entries(deferred)) ok(SRC.includes(call), what + ' no longer waits for the page to parse');
ok(!/document\.body\?syncBadgeVisibility\(\)/.test(SRC), 'the badge is still built during parsing too');
ok(!/document\.readyState!=="loading"\)__woSweepAds\(\)/.test(SRC), 'the ad sweep still runs during parsing too');

/* Their observers still start at once: each deferred sweep has an observer beside it that is not deferred. */
for (const [sweep, observer] of [['fixLinks(document)', 'fixLinks(roots[i])'], ['sweepDomLinks(document)', 'woObserve('],
  ['scanImages(document)', 'woObserve(']]) {
  const at = SRC.indexOf('__woAfterParse(()=>' + sweep + ')');
  const near = SRC.slice(at, at + 900);
  ok(near.includes(observer) && !/__woAfterParse\(\(\)=>woObserve/.test(near), sweep + ' lost the observer that covers nodes added while parsing');
}

/* Security sweeps keep their timing. */
for (const [what, call] of [['the local resource guard', 'document.documentElement&&sweepLocal(document)'],
  ['the scam page guard', 'document.body?scamGuard.now()'], ['the ClickFix guard', 'document.body?clickfixGuard.now()'],
  ['the fake update guard', 'document.body?fakeUpdateGuard.now()'], ['the form scan', 'document.body?scanForms()']]) {
  ok(SRC.includes(call), what + ' must keep running as soon as the engine starts');
}

console.log('[ok] engine start deferral: ' + checks + ' checks');
