/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/*
 * The engine must not switch itself off on hosts the reader never chose, and a marker
 * that means "the script ran" must not be read as "protection is on".
 *
 * masterOn was built as `cfg.enabled !== false && !onAllowlist`, and onAllowlist was
 * computed against ["wootility.io", "shopify.com"].concat(cfg.allowlist || []) -- two
 * host families nobody picked, matched by hostMatchesSite so every subdomain went with
 * them. Everything downstream is gate(v) => !!masterOn && v, so every gated protection
 * evaluated false there: phishing blocking, ClickFix, XSS behaviour, Media Shield,
 * clipboard, form-trap, scam-lock, anti-fingerprint, all of it.
 *
 * The second half is what made it High rather than Medium. __woStartRuntime stamps
 * __wardenOneReadyVersion unconditionally -- the gate does not shorten the start path, it
 * only makes it do nothing -- and the worker's watchdog treated any non-empty marker as
 * "engine present". So the tab reported itself healthy to the popup, to Repair and to
 * Protection Health while nothing was running (BUG-01).
 *
 * Three things are asserted here, and each is a way the bug could come back:
 *   - the hard-coded seed list is empty, so only the reader's own allowlist gates
 *   - the two halves of WardenOne agree about which hosts are paused
 *   - "ran" and "protecting" are separate markers, and the watchdog reads the right one
 *
 * Run: node tools/test-engine-allowlist-honesty.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'src', 'content.js'), 'utf8');
const MIN = fs.readFileSync(path.join(ROOT, 'content.min.js'), 'utf8');
const BG = fs.readFileSync(path.join(ROOT, 'background.js'), 'utf8');
const BRIDGE = fs.readFileSync(path.join(ROOT, 'bridge.js'), 'utf8');
const UTILS = fs.readFileSync(path.join(ROOT, 'domain-utils.js'), 'utf8');

let failures = 0;
function check(label, condition, extra) {
  if (condition) { console.log('  ok  ' + label); return; }
  failures++;
  console.log('  FAIL ' + label + (extra ? ' :: ' + extra : ''));
}

/* ---- 1. nothing is seeded into the allowlist ------------------------------------ */

{
  /* The shipped expression, read out of the built engine rather than the pretty source,
     because the built file is what runs. */
  const m = /onAllowlist=([^;]*?)\.some\(h=>hostMatchesSite\(host,h\)\)/.exec(MIN);
  check('the allowlist expression is still recognisable', !!m,
    'if this stops matching, this whole suite silently stops testing anything');
  if (m) {
    const expr = m[1];
    check('the engine seeds no hosts of its own', expr === '(cfg.allowlist||[])',
      'found ' + expr + ' -- a literal here is a whole-engine off switch for a host nobody chose');
    check('and no hostname literal survives in it', !/["'][a-z0-9.-]+\.[a-z]{2,}["']/i.test(expr),
      expr);
  }
}

check('the source agrees with the built engine',
  /onAllowlist=\(cfg\.allowlist\|\|\[\]\)\.some/.test(SRC));

/* The comment that was true of one branch and false of this line. Keep them honest
   together: if a site-wide switch ever comes back, this claim has to go with it. */
check('the file still claims there is no site-wide off switch',
  /there is no site-wide off switch left/.test(SRC),
  'either the claim or the switch has to change, never one without the other');

/* ---- 2. the two halves resolve the same hosts ----------------------------------- */

{
  /* hostMatchesSite is the engine's matcher and lives in domain-utils.js, which both
     worlds load. Run the shipped one rather than restating it. */
  const ctx = { module: { exports: {} }, console };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(UTILS, ctx);
  const hostMatchesSite = ctx.hostMatchesSite;
  check('the shipped matcher loaded', typeof hostMatchesSite === 'function');

  if (typeof hostMatchesSite === 'function') {
    const allowlist = ['example.com'];
    const table = [
      ['example.com', true],
      ['www.example.com', true],
      ['deep.sub.example.com', true],
      ['notexample.com', false],
      ['example.com.evil.test', false],
      ['wootility.io', false],
      ['shopify.com', false],
      ['admin.shopify.com', false],
      ['beta.wootility.io', false],
    ];
    const wrong = table.filter(([host, want]) =>
      allowlist.some((h) => hostMatchesSite(host, h)) !== want);
    check('the reader\'s allowlist matches exactly the hosts it names',
      wrong.length === 0, wrong.map((w) => w[0]).join(', '));

    const seeded = table.filter(([host]) => /wootility|shopify/.test(host));
    check('the formerly hard-coded hosts are no longer paused',
      seeded.every(([host]) => !allowlist.some((h) => hostMatchesSite(host, h))),
      'these are the two families that used to take the whole engine down');
  }
}

check('the bridge builds its allowlist from the reader\'s config only',
  /bridgeActiveAllowlist/.test(BRIDGE)
  && !/["'](?:wootility\.io|shopify\.com)["']/.test(BRIDGE),
  'the isolated half never had the seed, which is why the two halves disagreed');
check('and the engine no longer carries a seed the bridge lacks',
  !/["'](?:wootility\.io|shopify\.com)["']\s*,?\s*\]?\.concat/.test(MIN),
  'a seed on one side only is how MAIN and ISOLATED ended up disagreeing about a site');

/* ---- 3. "ran" and "protecting" are different questions -------------------------- */

check('the engine publishes whether protection is actually on',
  /window\.__wardenOneProtectionActive=!1!==WO\.enabled/.test(MIN),
  'without this the only signal is the ready marker, which means the script ran');
check('the ready marker is still stamped unconditionally',
  /window\.__wardenOneReadyVersion=__WO_RUNTIME_VERSION/.test(MIN),
  'making it conditional would make the watchdog re-inject forever on a paused site');
check('disposal clears the active marker too',
  /window\.__wardenOneProtectionActive=void 0/.test(MIN));

{
  /* The watchdog used to read both markers in one MAIN-world probe and key re-injection on
     the version alone. Both markers are page-writable, so the probe is gone (SEC-03): the
     bridge's signed challenge decides, and the worker reloads rather than injecting. What
     this section still has to pin is that a legitimately paused site is never reloaded --
     the loop the old design avoided by keying on the version. */
  const probe = BG.slice(BG.indexOf('async function verifyEngineInTab'),
    BG.indexOf('\n}\n', BG.indexOf('async function verifyEngineInTab')));
  check('the watchdog no longer reads either page-writable marker',
    !/__wardenOneReadyVersion/.test(probe) && !/__wardenOneProtectionActive/.test(probe) && !/executeScript/.test(probe));
  check('a paused site is left alone before any reload is considered',
    /if \(cfg\.enabled === false\) return \{ ok: false, reason: 'master-off' \};/.test(probe)
    && /return \{ ok: false, reason: 'allowlisted' \}/.test(probe)
    && probe.indexOf("reason: 'allowlisted'") < probe.indexOf('chrome.tabs.reload('),
    'reloading a site the reader paused would be the loop the old design avoided');
  check('and the reload is bounded so a hostile page cannot make it one',
    /ENGINE_RELOAD_MAX/.test(probe) && /reason: 'gave-up'/.test(probe));
}

console.log('');
if (failures) {
  console.log(failures + ' check(s) failed');
  process.exit(1);
}
console.log('all engine allowlist-honesty checks passed');
