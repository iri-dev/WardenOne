/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/*
 * Protection Health says "You're safe" only about a page that answered.
 * Run: node tools/test-health-tab-evidence.js
 *
 * The summary used to count the switches that were on, label the count "Active shields",
 * and say "You're safe. Core shields are active and watching quietly." with no input from
 * any page at all -- after an extension reload, a failed injection or a page the engine
 * cannot run on, the panel showed the full total and the strongest line it has. The count
 * is now labelled as what it is (switches on) and the safety line is reserved for a tab
 * whose bridge answered the engine's signed challenge.
 *
 * Two parts, both the real code: tabProtectionEvidence against a stubbed tab and bridge
 * (healthy, engine missing, bridge missing, stale bridge, restricted URL, paused site,
 * excluded site, sleeping tab, given-up tab, timed-out tab), then the status decision
 * lifted from buildProtectionHealthSummary and driven with every evidence state and every
 * issue level -- including the property the finding is about: with no issue found, the
 * safety line appears for `verified` and for nothing else.
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const BG = fs.readFileSync(path.join(ROOT, 'background.js'), 'utf8');
const POPUP_JS = fs.readFileSync(path.join(ROOT, 'popup.js'), 'utf8');
const POPUP_HTML = fs.readFileSync(path.join(ROOT, 'popup.html'), 'utf8');

let pass = 0;
const failures = [];
function check(name, cond, detail) {
  if (cond) { pass++; return; }
  failures.push(name + (detail ? ' — ' + detail : ''));
}
function between(src, startMark, endMark, what) {
  const a = src.indexOf(startMark);
  assert(a >= 0, 'missing ' + what + ' start');
  const b = src.indexOf(endMark, a);
  assert(b > a, 'missing ' + what + ' end');
  return src.slice(a, b);
}
function grabFn(name) {
  const m = new RegExp('^(?:async )?function ' + name + '\\(', 'm').exec(BG);
  assert(m, 'missing ' + name);
  let depth = 0;
  let seen = false;
  for (let i = m.index; i < BG.length; i++) {
    if (BG[i] === '{') { depth++; seen = true; } else if (BG[i] === '}') {
      depth--;
      if (seen && depth === 0) return BG.slice(m.index, i + 1);
    }
  }
  throw new Error('unterminated ' + name);
}

/* ---- 1. the evidence, per tab -------------------------------------------------------- */
/* `bridge` says what the tab's bridge does: an answer object, null for "no receiver",
   or 'hang' for a page that never calls back. */
function evidenceRunner(options) {
  const o = options || {};
  const calls = [];
  const chrome = {
    runtime: { lastError: null },
    tabs: {
      sendMessage(tabId, msg, opts, cb) {
        calls.push({ tabId, msg, opts });
        if (o.bridge === 'hang') return;
        if (o.bridge === 'throw') throw new Error('No tab with id');
        setTimeout(() => cb(o.bridge === null || o.bridge === undefined ? undefined : o.bridge), 0);
      },
    },
  };
  const src = between(BG, 'const TAB_EVIDENCE_TIMEOUT_MS = 700;', '\nasync function buildProtectionHealthSummary(', 'the evidence functions')
    .replace('const TAB_EVIDENCE_TIMEOUT_MS = 700;', 'const TAB_EVIDENCE_TIMEOUT_MS = ' + (o.timeoutMs || 40) + ';');
  // eslint-disable-next-line no-new-func
  const run = new Function('chrome', 'activeAllowlist', 'registrableDomainBg', 'engineExcludedByManifest', 'isMainWorldRepairExcludedUrl', 'ENGINE_GAVE_UP', 'setTimeout', 'clearTimeout',
    '"use strict";' + src + '\nreturn tabProtectionEvidence;');
  const evidence = run(chrome,
    (cfg) => (cfg && cfg.allowlist) || [],
    (h) => String(h).split('.').slice(-2).join('.'),
    (url) => /excluded\.example/.test(url),
    (url) => /repair-excluded\.example/.test(url),
    o.gaveUp || {},
    setTimeout, clearTimeout);
  return { evidence, calls };
}
const CFG = { enabled: true, allowlist: ['paused.example'] };
const TAB = (over) => Object.assign({ id: 7, url: 'https://shop.example/cart', discarded: false }, over || {});

(async () => {
  {
    const r = evidenceRunner({ bridge: { ok: true, alive: true, seen: true, fresh: true } });
    const e = await r.evidence(TAB(), CFG);
    check('a tab whose engine answers the signed challenge is verified', e.state === 'verified' && /shop\.example/.test(e.text), JSON.stringify(e));
    check('the question goes to the top frame of that tab only',
      r.calls.length === 1 && r.calls[0].tabId === 7 && r.calls[0].msg.kind === 'wo-engine-status' && r.calls[0].opts.frameId === 0);
  }
  {
    const e = await evidenceRunner({ bridge: { ok: true, alive: false, seen: false, fresh: true } }).evidence(TAB(), CFG);
    check('a bridge that reports no engine is failed, and names the page', e.state === 'failed' && /not running on shop\.example/.test(e.text), JSON.stringify(e));
  }
  {
    const e = await evidenceRunner({ bridge: null }).evidence(TAB(), CFG);
    check('no bridge to answer is unknown, not failed', e.state === 'unknown' && /not answered/.test(e.text), JSON.stringify(e));
  }
  {
    const e = await evidenceRunner({ bridge: 'hang', timeoutMs: 30 }).evidence(TAB(), CFG);
    check('a page that never calls back times out into unknown', e.state === 'unknown', JSON.stringify(e));
  }
  {
    const e = await evidenceRunner({ bridge: 'throw' }).evidence(TAB(), CFG);
    check('a sendMessage that throws is unknown', e.state === 'unknown', JSON.stringify(e));
  }
  {
    const e = await evidenceRunner({ bridge: { ok: true, alive: false, seen: false, fresh: false } }).evidence(TAB(), CFG);
    check('a bridge that arrived after the page ran cannot vouch: unknown, with the reload advice', e.state === 'unknown' && /loaded before/.test(e.text), JSON.stringify(e));
  }
  for (const url of ['chrome://newtab/', 'chrome-extension://abc/popup.html', 'about:blank', 'file:///C:/x.html', '']) {
    const r = evidenceRunner({ bridge: { ok: true, alive: true } });
    const e = await r.evidence(TAB({ url }), CFG);
    check('a page Chrome keeps extensions out of is restricted and never asked: ' + (url || '(empty)'),
      e.state === 'restricted' && r.calls.length === 0, JSON.stringify(e));
  }
  {
    const r = evidenceRunner({ bridge: { ok: true, alive: true } });
    const e = await r.evidence(TAB({ url: 'https://www.paused.example/a' }), CFG);
    check('an allowlisted site is paused and never asked', e.state === 'paused' && r.calls.length === 0 && /paused\.example/.test(e.text), JSON.stringify(e));
  }
  {
    const r = evidenceRunner({ bridge: { ok: true, alive: true } });
    const e = await r.evidence(TAB({ url: 'https://excluded.example/' }), CFG);
    const e2 = await r.evidence(TAB({ url: 'https://repair-excluded.example/' }), CFG);
    check('a manifest- or repair-excluded site is excluded and never asked', e.state === 'excluded' && e2.state === 'excluded' && r.calls.length === 0, JSON.stringify([e, e2]));
  }
  {
    const r = evidenceRunner({ bridge: { ok: true, alive: true } });
    const e = await r.evidence(TAB({ discarded: true }), CFG);
    check('a sleeping tab is reported asleep and never asked', e.state === 'sleeping' && r.calls.length === 0);
  }
  {
    const r = evidenceRunner({ bridge: { ok: true, alive: true }, gaveUp: { 7: true } });
    const e = await r.evidence(TAB(), CFG);
    check('a tab WardenOne gave up reloading is failed, with that reason, and not asked again', e.state === 'failed' && /stopped reloading/.test(e.text) && r.calls.length === 0, JSON.stringify(e));
  }
  {
    const r = evidenceRunner({ bridge: { ok: true, alive: true } });
    const e = await r.evidence(TAB(), { enabled: false });
    check('with the master switch off the tab is not asked', e.state === 'off' && r.calls.length === 0);
    const none = await r.evidence(null, CFG);
    check('no tab at all is unknown', none.state === 'unknown');
  }

  /* ---- 2. the status decision --------------------------------------------------------- */
  const DECISION = between(BG, '  // ---- what this adds up to', '\n  return {', 'the status decision');
  // eslint-disable-next-line no-new-func
  const decide = new Function('cfg', 'issues', 'tabEvidence', 'healthCountActiveShields',
    '"use strict";' + DECISION + '\nreturn { status, detail, highest, configuredShields };');
  const STATES = ['verified', 'failed', 'unknown', 'restricted', 'paused', 'excluded', 'sleeping', 'off'];
  const evidenceFor = (state) => ({ state, text: 'Reason for ' + state + '.' });
  const count = () => 99;
  for (const state of STATES) {
    const r = decide({ enabled: true }, [], evidenceFor(state), count);
    if (state === 'verified') {
      check('a verified page with no issue is "You\'re safe"', r.status === "You're safe" && /running on this page/.test(r.detail), JSON.stringify(r));
    } else {
      check('with no issue found, ' + state + ' is "Protections on" and says why the page could not be vouched for',
        r.status === 'Protections on' && /No issue found in what could be checked\. Reason for /.test(r.detail) && r.highest === 'ok', JSON.stringify(r));
    }
  }
  {
    const r = decide({ enabled: true }, [{ severity: 'info', text: 'a note', topLevel: false }], evidenceFor('verified'), count);
    check('a verified page with only notes stays safe and points below', r.status === "You're safe" && /notes are tucked below/.test(r.detail));
    const w = decide({ enabled: true }, [{ severity: 'warn', text: 'a setup problem', topLevel: true }], evidenceFor('verified'), count);
    check('a top-level warning beats a verified page', w.status === 'Check setup' && w.detail === 'a setup problem');
    const d = decide({ enabled: true }, [{ severity: 'danger', text: 'a danger', topLevel: false }], evidenceFor('verified'), count);
    check('a danger beats a verified page', d.status === 'Needs review' && d.detail === 'a danger');
    const off = decide({ enabled: false }, [], evidenceFor('verified'), () => 0);
    check('master off is Off whatever the page says', off.status === 'Off');
    check('the count reported is a count of switches, named so', r.configuredShields === 99 && /configuredShields/.test(DECISION) && !/activeShields/.test(DECISION));
  }
  /* The failed state must become a top-level warning in the builder itself. */
  check('a failed page is raised as a top-level setup warning', /if \(tabEvidence\.state === 'failed'\) addIssue\('warn', tabEvidence\.text, true\);/.test(BG));
  check('and no other evidence state adds an issue', (BG.match(/tabEvidence\.state === '[a-z]+'\) addIssue/g) || []).length === 1);

  /* ---- 3. the popup: the count is labelled as switches, the page line is shown -------- */
  check('the popup labels the count as switches on, not active shields',
    /<strong id="health-active-count">-<\/strong><span>Switched on<\/span>/.test(POPUP_HTML) && !/Active shields/.test(POPUP_HTML));
  check('the popup names the tab it is open on when it asks', /kind: 'protection-health', tabId/.test(POPUP_JS) && /chrome\.tabs\.query\(\{ active: true, currentWindow: true \}[\s\S]{0,200}ask\(/.test(POPUP_JS));
  check('the popup shows the page\'s evidence line', /id="health-tab-line"/.test(POPUP_HTML) && /This page: engine verified\./.test(POPUP_JS) && /This page: engine missing\./.test(POPUP_JS) && /This page: cannot be checked\./.test(POPUP_JS));
  check('the popup reads the renamed count', /res\.configuredShields/.test(POPUP_JS) && !/res\.activeShields/.test(POPUP_JS));
  check('the worker reads the tab back from Chrome rather than trusting the message', /chrome\.tabs\.get\(tabId, /.test(between(BG, "msg.kind === 'protection-health'", 'buildProtectionHealthSummary(tab)', 'the handler')));

  console.log('');
  if (failures.length) {
    for (const f of failures) console.log('  FAIL ' + f);
    console.log('\n' + failures.length + ' check(s) failed, ' + pass + ' passed');
    process.exit(1);
  }
  console.log('  ok  ' + pass + ' checks: the safety line is said about a page that answered, and about nothing else');
})().catch((e) => { console.error(e); process.exit(1); });
