/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/*
 * A page switching the engine off, and WardenOne noticing -- without asking the page.
 *
 * content.min.js runs in the MAIN world, which it shares with the page. The first watchdog
 * noticed when the engine never announced itself and asked the worker to look; the worker
 * read window.__wardenOneReadyVersion in the MAIN world and, if it was there, said "present".
 * That marker is page-writable. A page could call the published dispose and write the markers
 * back, and the probe certified the tab (SEC-03).
 *
 * Now the bridge holds a key the engine received once, at document_start, before the page
 * could run. "installed" counts only when it is signed with that key, and a live engine is one
 * that answers a signed challenge. The worker takes the bridge's word -- it is the isolated
 * world's, which the page cannot reach -- and its answer is a RELOAD, not an injection: no
 * channel into a document the page has already run in is private, so an engine injected there
 * would have to trust a bus the page can write to. A reload is a fresh document_start. It is
 * bounded, recorded, stays out of the way where the engine is meant to be off, and honours the
 * manifest's own exclusions, which the old path did not.
 *
 * Run: node tools/test-engine-watchdog.js
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const BG = fs.readFileSync(path.join(ROOT, 'background.js'), 'utf8');
const BRIDGE = fs.readFileSync(path.join(ROOT, 'bridge.js'), 'utf8');
const HISTORY = fs.readFileSync(path.join(ROOT, 'history.js'), 'utf8');
const CONTENT = fs.readFileSync(path.join(ROOT, 'content.min.js'), 'utf8');
const MANIFEST = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));

let failures = 0;
function check(label, condition, extra) {
  if (condition) { console.log('  ok  ' + label); return; }
  failures++;
  console.log('  FAIL ' + label + (extra === undefined ? '' : ' :: ' + JSON.stringify(extra)));
}

const START = 'const ENGINE_RELOADS = Object.create(null);';
const END = '\n// A navigation that resolves to a file is not a tab hijack';
const from = BG.indexOf(START);
const to = BG.indexOf(END, from + START.length);
assert(from >= 0 && to > from, 'the engine watchdog moved in background.js');
const SLICE = BG.slice(from, to);

function world(options) {
  const o = options || {};
  const history = [];
  const reloads = [];
  const injected = [];
  let now = 1000000;
  const sandbox = {
    DEFAULT_CONFIG: { enabled: true, allowlist: [] },
    localGet: () => Promise.resolve({ wardenone_config: o.config || {} }),
    activeAllowlist: (cfg) => (cfg && cfg.allowlist) || [],
    registrableDomainBg: (h) => String(h || '').split('.').slice(-2).join('.'),
    isMainWorldRepairExcludedUrl: (u) => !!(o.compatExcluded && String(u).indexOf(o.compatExcluded) !== -1),
    queueHistory: (e) => history.push(e),
    chrome: {
      runtime: { getManifest: () => MANIFEST },
      tabs: {
        reload: (id) => {
          reloads.push(id);
          return o.reloadFails ? Promise.reject(new Error('no such tab')) : Promise.resolve();
        },
      },
      scripting: { executeScript: (args) => { injected.push(args); return Promise.resolve([]); } },
    },
    URL, Object, Date: { now: () => now }, String, Number, Promise, RegExp, Array, console,
  };
  vm.createContext(sandbox);
  vm.runInContext(SLICE, sandbox, { filename: 'engine-watchdog-slice.js' });
  return {
    history, reloads, injected,
    advance(ms) { now += ms; },
    check(sender, msg) { return sandbox.verifyEngineInTab(sender, msg); },
    excluded(url) { return sandbox.engineExcludedByManifest(url); },
  };
}

const SENDER = { tab: { id: 7, url: 'https://scary.example/page' }, frameId: 0 };
const DISPOSED = { why: 'disposed', seen: true, fresh: true };
const ABSENT = { why: 'never-announced', seen: false, fresh: true };

console.log('\nengine watchdog\n');

(async () => {
  {
    /* The reported shape: a genuine engine was seen, then stopped answering the challenge. */
    const w = world();
    const res = await w.check(SENDER, DISPOSED);
    check('an engine the bridge saw and then lost is put back by reloading the tab',
      res.ok === true && res.reason === 'reloaded' && w.reloads.length === 1 && w.reloads[0] === 7, res);
    check('nothing is injected into the live document', w.injected.length === 0, w.injected);
    check('and it is recorded rather than fixed silently',
      w.history.length === 1 && w.history[0].type === 'warned_engine_disabled', w.history);
    const d = (w.history[0] || {}).detail || {};
    check('the note says the page did it, and that the part it cannot reach noticed',
      /This page switched WardenOne's in-page engine off/.test(d.why) && /noticed/.test(d.why) && d.confidence === 'High', d);
    check('and says what was done', /The page was reloaded/.test(d.outcome) && /reloaded so the engine could start again/.test(d.action), d);
  }
  {
    /* Never announced with a fresh bridge: the engine did not start. Reload once, say so honestly. */
    const w = world();
    const res = await w.check(SENDER, ABSENT);
    check('an engine that never produced a signed installed is reloaded too',
      res.ok === true && w.reloads.length === 1, res);
    const d = (w.history[0] || {}).detail || {};
    check('but the note does not accuse the page', /never started on this page/.test(d.why) && d.confidence === 'Medium', d);
  }
  {
    /* A bridge injected into a live document never handed a key over; it cannot vouch. */
    const w = world();
    const res = await w.check(SENDER, { why: 'never-announced', seen: false, fresh: false });
    check('a late bridge reports and does not reload', res.ok === false && res.reason === 'late-bridge' && w.reloads.length === 0, res);
  }
  {
    /* Bounded: never a loop, whatever the page does. */
    const w = world();
    await w.check(SENDER, DISPOSED);
    await w.check(SENDER, DISPOSED);
    const same = await w.check(SENDER, DISPOSED);
    check('repeated reports in the same moment reload once, not three times',
      w.reloads.length === 1 && same.reason === 'already-reloaded', { reloads: w.reloads, same });
    w.advance(31000);
    const second = await w.check(SENDER, DISPOSED);
    check('a later page load may be reloaded again', second.ok === true && w.reloads.length === 2, second);
    w.advance(31000);
    const third = await w.check(SENDER, DISPOSED);
    check('a third time inside ten minutes is refused', third.ok === false && third.reason === 'gave-up' && w.reloads.length === 2, third);
    const gaveUp = w.history.filter((h) => /Gave up reloading/.test((h.detail || {}).outcome || ''));
    check('and the giving-up is recorded once, as a High-severity notice naming the page hostile',
      gaveUp.length === 1 && gaveUp[0].detail.severity === 'High' && /hostile/.test(gaveUp[0].detail.action), gaveUp);
    w.advance(31000);
    await w.check(SENDER, DISPOSED);
    check('a fourth report writes nothing more', w.history.filter((h) => /Gave up/.test((h.detail || {}).outcome || '')).length === 1);
    w.advance(11 * 60 * 1000);
    const later = await w.check(SENDER, DISPOSED);
    check('after the window passes the budget is back', later.ok === true && w.reloads.length === 3, later);
  }
  {
    /* Where the engine is meant to be off, nothing happens and nothing is written. */
    const off = world({ config: { enabled: false } });
    const r1 = await off.check(SENDER, DISPOSED);
    check('the master switch being off is respected', r1.reason === 'master-off' && off.reloads.length === 0 && off.history.length === 0, r1);
    const allowed = world({ config: { allowlist: ['scary.example'] } });
    const r2 = await allowed.check(SENDER, DISPOSED);
    check('an allowlisted site is left alone', r2.reason === 'allowlisted' && allowed.reloads.length === 0, r2);
    const mail = world();
    const r3 = await mail.check({ tab: { id: 8, url: 'https://mail.google.com/mail/u/0/' }, frameId: 0 }, ABSENT);
    check('a page the manifest excludes the engine from is left alone (the old path injected into it)',
      r3.reason === 'excluded' && mail.reloads.length === 0 && mail.history.length === 0, r3);
    check('the manifest matcher reads the real exclude_matches',
      mail.excluded('https://accounts.google.com/signin') && mail.excluded('https://github.com/login/oauth/authorize')
      && !mail.excluded('https://github.com/iri-dev/WardenOne') && !mail.excluded('https://scary.example/page'));
    const compat = world({ compatExcluded: 'checkout.shop.example' });
    const r4 = await compat.check({ tab: { id: 9, url: 'https://checkout.shop.example/pay' }, frameId: 0 }, DISPOSED);
    check('and so is a page the worker\'s own compatibility list excludes', r4.reason === 'excluded' && compat.reloads.length === 0, r4);
  }
  {
    const w = world({ reloadFails: true });
    const res = await w.check(SENDER, DISPOSED);
    check('a tab that cannot be reloaded is not reported as an attack', res.ok === false && res.reason === 'reload-failed' && w.history.length === 0, res);
  }
  {
    const w = world();
    const sub = await w.check({ tab: { id: 7, url: 'https://scary.example/page' }, frameId: 3 }, DISPOSED);
    check('only the top frame is checked', sub.ok === false && w.reloads.length === 0, sub);
    const ext = await w.check({ tab: { id: 7, url: 'chrome-extension://abc/page.html' }, frameId: 0 }, DISPOSED);
    check('and only real web pages', ext.ok === false && w.reloads.length === 0, ext);
  }

  /* ---- wiring --------------------------------------------------------------------- */

  check('the bridge asks, and it is the ISOLATED world that asks, saying what it saw',
    /kind: 'wo-engine-check', why: String\(why \|\| ''\)\.slice\(0, 40\), fresh: BRIDGE_FRESH, seen: bridgeEngineSeen/.test(BRIDGE));
  check('the worker only listens to a real tab, and hears the message',
    /msg\.kind === 'wo-engine-check' && messageSenderIsTab\(sender\)/.test(BG) && /verifyEngineInTab\(sender, msg\)/.test(BG));
  check('the tab-context gate lets the watchdog reach that handler',
    /TAB_CONTEXT_ALLOWED_MESSAGES = new Set\(\[[\s\S]*?'wo-engine-check'[\s\S]*?\]\);/.test(BG));
  check('the bridge stops asking rather than looping',
    /bridgeEngineChecks\+\+ > 4/.test(BRIDGE));
  check('an installed claim counts only when it is signed with the key',
    /if \(type === 'installed'\) \{\s*if \(__woAuth\.same\(d\.mac, engineMac\('installed', TOKEN\)\)\) bridgeEngineSeen = true;/.test(BRIDGE));
  check('a live engine is one that answers a signed challenge, inside the dispatch',
    /const engineAnswers = \(\) => \{[\s\S]*?new CustomEvent\('wo-ping', \{ detail: \{ nonce \} \}\)[\s\S]*?return answered;/.test(BRIDGE)
    && /if \(type === 'pong'\) \{\s*if \(bridgePendingPong && d\.nonce === bridgePendingPong\.nonce && __woAuth\.same\(d\.mac, engineMac\('pong', bridgePendingPong\.nonce\)\)\) bridgePendingPong\.ok\(\);/.test(BRIDGE));
  check('a seen engine that stops answering is reported as disposed',
    /if \(!engineAnswers\(\)\) bridgeCheckEngine\('disposed'\);/.test(BRIDGE));
  check('returning to the tab is a second chance to notice, and so is every 45 seconds in front',
    /visibilityState === 'visible'\) bridgeVerifyEngine\('still-absent'\)/.test(BRIDGE) && /woInterval\(\(\) => \{ if \(document\.visibilityState === 'visible' && bridgeEngineSeen\) bridgeVerifyEngine\('still-absent'\); \}, 45000\)/.test(BRIDGE));
  check('the worker no longer reads a page-writable marker to decide health',
    !/window\.__wardenOneReadyVersion === 'string' \? window\.__wardenOneReadyVersion : ''/.test(SLICE) && !/executeScript/.test(SLICE));
  check('the Activity Center has a name for it',
    /warned_engine_disabled: '/.test(HISTORY));

  /* The engine's half: it answers the challenge with the key, and only while it is alive. */
  check('the engine answers wo-ping with a signed pong',
    /woOn\(document,"wo-ping",e=>\{[\s\S]{0,400}type:"pong",nonce:nonce,mac:__woAuth\.hmac\(__woKey,"pong\\n"\+nonce\)/.test(CONTENT));
  check('and signs installed with the same key',
    /"installed"===d\.type&&null!==__woKey&&\(d\.mac=__woAuth\.hmac\(__woKey,"installed\\n"\+__woToken\)\)/.test(CONTENT));
  check('disposing still clears the ready markers it claims to',
    /window\.__wardenOneReadyVersion=void 0,window\.__wardenOneInstalled=void 0/.test(CONTENT));
  check('and clears the protection-active marker with them',
    /window\.__wardenOneProtectionActive=void 0/.test(CONTENT),
    'a stale active marker would tell the popup a disposed engine is still protecting');

  console.log('');
  if (failures) { console.log(failures + ' check(s) failed'); process.exit(1); }
  console.log('engine watchdog checks passed');
})();
