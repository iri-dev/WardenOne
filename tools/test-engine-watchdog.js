/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/*
 * A page switching the engine off, and WardenOne noticing.
 *
 * content.min.js runs in the MAIN world, which it shares with the page. Everything it puts on
 * window is therefore page-readable and page-callable, including its dispose. That is a limit
 * of MAIN-world injection and cannot be fixed from inside that world -- the page owns it, and
 * the engine's own comment says so.
 *
 * The engine already answered half of it: disposing clears its ready markers, so the tab stops
 * claiming to be protected and a fresh injection can take. The comment there says the point is
 * that "the bypass has to be repeated rather than done once and left". It was not. Nothing ever
 * re-injected, so one call at document_start switched the engine off for the life of the page
 * and nobody found out.
 *
 * The watchdog is the missing half, and it lives where the page cannot reach it: bridge.js runs
 * in the ISOLATED world, so a page can silence the engine but not the thing that notices. What
 * is asserted here is the shape of that -- that the claim is verified rather than trusted, that
 * it cannot become a loop, that it stays out of the way where the engine is meant to be off,
 * and that it is recorded rather than fixed silently.
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

let failures = 0;
function check(label, condition, extra) {
  if (condition) { console.log('  ok  ' + label); return; }
  failures++;
  console.log('  FAIL ' + label + (extra === undefined ? '' : ' :: ' + JSON.stringify(extra)));
}

/* ---- the worker half, driven for real ---------------------------------------------- */

const START = 'const ENGINE_REARMED_AT = Object.create(null);';
const END = '\n// A navigation that resolves to a file is not a tab hijack';
const from = BG.indexOf(START);
const to = BG.indexOf(END, from + START.length);
assert(from >= 0, 'the engine watchdog moved in background.js');
const SLICE = BG.slice(from, to > from ? to : from + 4000);

function world(options) {
  const o = options || {};
  const history = [];
  const injected = [];
  const probes = [];
  let now = 1000000;
  const sandbox = {
    DEFAULT_CONFIG: { enabled: true, allowlist: [] },
    localGet: () => Promise.resolve({ wardenone_config: o.config || {} }),
    activeAllowlist: (cfg) => (cfg && cfg.allowlist) || [],
    registrableDomainBg: (h) => String(h || '').split('.').slice(-2).join('.'),
    queueHistory: (e) => history.push(e),
    chrome: {
      scripting: {
        executeScript: (args) => {
          if (args && args.files) { injected.push(args.files.join('+')); return Promise.resolve([{ result: true }]); }
          probes.push('probe');
          if (o.notScriptable) return Promise.reject(new Error('frame gone'));
          return Promise.resolve([{ result: o.marker === undefined ? '1.0.1' : o.marker }]);
        },
      },
    },
    URL, Object, Date: { now: () => now }, String, Number, Promise, console,
  };
  vm.createContext(sandbox);
  vm.runInContext(SLICE, sandbox, { filename: 'engine-watchdog-slice.js' });
  return {
    history,
    injected,
    probes,
    advance(ms) { now += ms; },
    check(sender) { return sandbox.verifyEngineInTab(sender); },
  };
}

const SENDER = { tab: { id: 7, url: 'https://scary.example/page' }, frameId: 0 };

console.log('\nengine watchdog\n');

(async () => {
  {
    /* The reported shape: the marker is gone, so the engine really is off. */
    const w = world({ marker: '' });
    const res = await w.check(SENDER);
    check('an engine that is actually gone is put back',
      res.ok === true && res.reason === 'rearmed' && w.injected.length === 1, { res, injected: w.injected });
    check('and the engine files are the ones re-injected',
      w.injected[0] === 'content.min.js+permission-chain.js', w.injected);
    check('and it is recorded rather than fixed silently',
      w.history.length === 1 && w.history[0].type === 'warned_engine_disabled', w.history);
    const d = w.history[0] && w.history[0].detail;
    check('the note says the page did it, not that WardenOne broke',
      !!d && /switched WardenOne/i.test(d.why), d && d.why);
    check('and tells the reader there is nothing for them to do',
      !!d && /nothing to do/i.test(d.action), d && d.action);
  }

  {
    /* The bridge cannot be taken at its word. A healthy engine must cost one probe and
       nothing else -- no injection, no history, no noise. */
    const w = world({ marker: '1.0.1' });
    const res = await w.check(SENDER);
    check('a claim about a healthy engine is verified and dropped',
      res.ok === true && res.reason === 'present', res);
    check('nothing is re-injected when the engine is there', w.injected.length === 0, w.injected);
    check('and nothing is written to the Activity Center', w.history.length === 0, w.history);
  }

  {
    /* A page that keeps disposing must not turn this into an injection loop. */
    const w = world({ marker: '' });
    await w.check(SENDER);
    await w.check(SENDER);
    await w.check(SENDER);
    check('repeated checks in the same moment re-arm once, not three times',
      w.injected.length === 1, w.injected);
    w.advance(31000);
    await w.check(SENDER);
    check('but a later page load is allowed to re-arm again', w.injected.length === 2, w.injected);
  }

  {
    /* Where the engine is meant to be off, putting it back would be the bug. */
    const off = world({ marker: '', config: { enabled: false } });
    const r1 = await off.check(SENDER);
    check('the master switch being off is respected',
      r1.reason === 'master-off' && off.injected.length === 0, { r1, injected: off.injected });
    check('and no probe is even spent on it', off.probes.length === 0, off.probes);

    const allowed = world({ marker: '', config: { allowlist: ['scary.example'] } });
    const r2 = await allowed.check(SENDER);
    check('an allowlisted site is left alone',
      r2.reason === 'allowlisted' && allowed.injected.length === 0, { r2, injected: allowed.injected });
  }

  {
    /* A frame that has gone is not a finding. */
    const w = world({ notScriptable: true });
    const res = await w.check(SENDER);
    check('a frame that vanished is not reported as an attack',
      res.ok === false && res.reason === 'not-scriptable' && w.history.length === 0, { res, history: w.history });
  }

  {
    const w = world({ marker: '' });
    const sub = await w.check({ tab: { id: 7, url: 'https://scary.example/page' }, frameId: 3 });
    check('only the top frame is checked', sub.ok === false && w.injected.length === 0, sub);
    const ext = await w.check({ tab: { id: 7, url: 'chrome-extension://abc/page.html' }, frameId: 0 });
    check('and only real web pages', ext.ok === false && w.injected.length === 0, ext);
  }

  /* ---- wiring --------------------------------------------------------------------- */

  check('the bridge asks, and it is the ISOLATED world that asks',
    /kind: 'wo-engine-check'/.test(BRIDGE));
  check('the worker only listens to a real tab',
    /msg\.kind === 'wo-engine-check' && messageSenderIsTab\(sender\)/.test(BG));
  check('the tab-context gate lets the watchdog reach that handler',
    /TAB_CONTEXT_ALLOWED_MESSAGES = new Set\(\[[\s\S]*?'wo-engine-check'[\s\S]*?\]\);/.test(BG));
  check('the bridge stops asking rather than looping',
    /bridgeEngineChecks\+\+ > 4/.test(BRIDGE));
  check('an engine that announced itself is never reported',
    /if \(type === 'installed'\) bridgeEngineSeen = true;/.test(BRIDGE));
  check('returning to the tab is a second chance to notice',
    /visibilitychange/.test(BRIDGE) && /still-absent/.test(BRIDGE));
  check('the Activity Center has a name for it',
    /warned_engine_disabled: '/.test(HISTORY));

  /* The engine's own half of the bargain: dispose must keep clearing the markers, or the
     watchdog probes a tab that lies about being healthy and re-arms nothing. */
  check('disposing still clears the ready markers it claims to',
    /window\.__wardenOneReadyVersion=void 0,window\.__wardenOneInstalled=void 0/.test(CONTENT));

  console.log('');
  if (failures) { console.log(failures + ' check(s) failed'); process.exit(1); }
  console.log('all engine-watchdog checks passed');
})();
