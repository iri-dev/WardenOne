/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/*
 * The three page-text detectors share one scheduler, and churn no longer buys a scan (PERF-03).
 * Run: node tools/test-text-scan-scheduler.js
 *      WARDENONE_CONTENT_MIN=<older content.min.js> node tools/test-text-scan-scheduler.js
 *
 * Scam Lock, ClickFix and Fake Update each turned every mutation batch into a page-wide pass of
 * their own -- debounced at 700 or 800 ms, then forced through idle with a 600 ms timeout, for the
 * life of the document, with no notion of whether the batch carried anything they could act on. A
 * page that keeps changing paid about three whole-page passes a second indefinitely, and ClickFix's
 * pass reads body.innerText, a forced layout.
 *
 * Now one scheduler stands between a mutation and a pass with four rules -- relevance of the added
 * text, a change signature, exponential backoff on repeated negatives, deferral while hidden -- and
 * the three detectors register through it. The scheduler is sliced from the shipped content.min.js
 * and driven here with synthetic consumers, a fake document, a fake observer and fake timers, so
 * every claim is a count: how many passes a thousand irrelevant batches buy (none), how many an
 * unchanged page buys (none), how the spacing grows and when it resets. The detectors' own
 * relevance patterns are sliced too and tested against the text they must and must not fire on.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const CONTENT_PATH = process.env.WARDENONE_CONTENT_MIN ? path.resolve(process.env.WARDENONE_CONTENT_MIN) : path.join(ROOT, 'content.min.js');
const CONTENT = fs.readFileSync(CONTENT_PATH, 'utf8');
const SOURCE = fs.readFileSync(path.join(ROOT, 'src', 'content.js'), 'utf8');
const GATE = fs.readFileSync(path.join(ROOT, 'tools', 'check-maintainability.js'), 'utf8');

let pass = 0;
const failures = [];
function check(name, cond, detail) {
  if (cond) { pass++; return; }
  failures.push(name + (detail === undefined ? '' : ' — ' + (typeof detail === 'string' ? detail : JSON.stringify(detail))));
}
let finished = false;
process.exitCode = 1;
process.on('exit', () => { if (!finished) console.log('  FAIL the suite stopped before it finished'); });
const section = (name, fn) => { try { fn(); } catch (e) { check(name, false, 'could not run: ' + (e && e.message || e)); } };

function slice(from, to, what) {
  const i = CONTENT.indexOf(from);
  const j = i >= 0 ? CONTENT.indexOf(to, i + from.length) : -1;
  if (i < 0 || j < 0) throw new Error(what + ' moved in content.min.js');
  return CONTENT.slice(i, j);
}
/* A regex constant as shipped: `NAME=/.../i` up to the comma that ends it. */
function regexConst(name) {
  const at = CONTENT.indexOf(name + '=/');
  if (at < 0) throw new Error(name + ' moved');
  let i = at + name.length + 2;
  let inClass = false;
  for (; i < CONTENT.length; i++) {
    const ch = CONTENT[i];
    if (ch === '\\') { i++; continue; }
    if (ch === '[') inClass = true;
    else if (ch === ']') inClass = false;
    else if (ch === '/' && !inClass) break;
  }
  let end = i + 1;
  while (/[a-z]/.test(CONTENT[end])) end++;
  return CONTENT.slice(at + name.length + 1, end);
}

/* The scheduler's world: a document of text nodes, an observer that hands batches straight to the
   scheduler, and timers that only move when told. */
function world() {
  const state = { now: 0, timers: [], walks: 0, text: 'welcome to the page', hidden: false, href: 'https://app.example/', consumer: null, idle: [] };
  const textNodes = () => [{ nodeValue: state.text }];
  const sandbox = {
    Math, String, Number, Object, Array,
    document: {
      get body() { return {}; },
      get hidden() { return state.hidden; },
      createTreeWalker() { state.walks++; const nodes = textNodes(); let i = 0; return { nextNode: () => (i < nodes.length ? nodes[i++] : null) }; },
    },
    NodeFilter: { SHOW_TEXT: 4 },
    location: { get href() { return state.href; } },
    setTimeout: (fn, ms) => { const id = state.timers.length + 1; state.timers.push({ id, at: state.now + (ms || 0), fn }); return id; },
    __woIdle: (fn) => { state.idle.push(fn); },
    woObserve: (cb) => { state.consumer = cb; },
    woOn: (target, type, fn) => { state.listeners = state.listeners || {}; state.listeners[type] = fn; },
  };
  vm.createContext(sandbox);
  const script = 'const bodyTextCapped=' + slice('bodyTextCapped=cap=>{', ',/* One scheduler for the three page-text detectors', 'bodyTextCapped').slice('bodyTextCapped='.length)
    + ';\nconst __woTextScan=' + slice('__woTextScan=(()=>{', ',SITE_BOUNDARY=', 'the text-scan scheduler').slice('__woTextScan='.length)
    + ';\nthis.scheduler = __woTextScan;';
  vm.runInContext(script, sandbox, { filename: 'text-scan-slice.js' });
  const api = {
    state, scheduler: sandbox.scheduler,
    /* Advance the clock, running due timers and any idle callbacks they queue. */
    advance(ms) {
      const until = state.now + ms;
      while (true) {
        const due = state.timers.filter((t) => t.at <= until).sort((a, b) => a.at - b.at)[0];
        if (!due) break;
        state.now = due.at;
        state.timers = state.timers.filter((t) => t !== due);
        due.fn();
        while (state.idle.length) state.idle.shift()();
      }
      state.now = until;
      while (state.idle.length) state.idle.shift()();
    },
    /* A mutation batch: element roots with text, and/or text nodes with their block. */
    batch(rootTexts, textNodeTexts) {
      const roots = (rootTexts || []).map((t) => ({ nodeType: 1, textContent: t }));
      const muts = [{ addedNodes: roots.concat((textNodeTexts || []).map((t) => ({ nodeType: 3, nodeValue: t, parentElement: { textContent: t } }))) }];
      state.consumer(muts, roots, roots, roots.length > 0);
    },
    setText(t) { state.text = t; },
    visible(v) { state.hidden = !v; if (state.listeners && state.listeners.visibilitychange) state.listeners.visibilitychange(); },
  };
  return api;
}
function consumer(w, spec) {
  const log = { runs: [], relevant: 0 };
  const c = Object.assign({
    id: 'test', delay: 700,
    done: () => false,
    relevant: (text) => { log.relevant++; const m = /alert|virus/i.exec(text); return m ? m[0].toLowerCase() : ''; },
    run: () => { log.runs.push(w.state.now); return false; },
  }, spec || {});
  const handle = w.scheduler.add(c);
  return { log, handle, spec: c };
}

(async () => {
  console.log('\ntext-scan scheduler\n');

  section('irrelevant churn', () => {
    const w = world();
    const c = consumer(w);
    c.handle.now();
    check('the load-time pass runs at once', c.log.runs.length === 1 && c.log.runs[0] === 0);
    const walksAfterLoad = w.state.walks;
    for (let i = 0; i < 1000; i++) { w.batch(['item ' + i + ' loaded'], ['status: ' + i]); w.advance(50); }
    check('a thousand batches of ordinary text buy no pass at all', c.log.runs.length === 1, c.log.runs.length);
    check('...and no page snapshot is taken for them', w.state.walks === walksAfterLoad, w.state.walks - walksAfterLoad);
    check('...though each batch was looked at, cheaply', c.log.relevant === 1000, c.log.relevant);
  });

  section('relevant text', () => {
    const w = world();
    const c = consumer(w);
    c.handle.now();
    w.batch(['WARNING: virus detected on your computer']);
    check('relevant added text schedules a pass, not yet run', c.log.runs.length === 1);
    w.advance(699);
    check('...not before the detector\'s own delay', c.log.runs.length === 1);
    w.advance(1);
    check('...and at it', c.log.runs.length === 2 && c.log.runs[1] === 700, c.log.runs);
    w.batch(['WARNING: virus detected on your computer']);
    w.advance(5000);
    check('the same text arriving again on an unchanged page is not read twice', c.log.runs.length === 2, c.log.runs.length);
    w.setText('welcome to the page and now a virus notice');
    w.batch(['WARNING: virus detected on your computer']);
    w.advance(5000);
    check('...but a changed page is', c.log.runs.length === 3, c.log.runs.length);
  });

  section('backoff', () => {
    const w = world();
    const c = consumer(w);
    c.handle.now();
    const gaps = [];
    let last = 0;
    for (let i = 0; i < 6; i++) {
      w.setText('page text changes every time ' + i);
      w.batch(['virus warning ' + i]);
      const before = c.log.runs.length;
      let waited = 0;
      while (c.log.runs.length === before && waited < 120000) { w.advance(100); waited += 100; }
      gaps.push(c.log.runs[c.log.runs.length - 1] - last);
      last = c.log.runs[c.log.runs.length - 1];
    }
    check('repeated negative passes on the same kind of token double their spacing', gaps[0] === 700 && gaps[1] === 1400 && gaps[2] === 2800 && gaps[3] === 5600, gaps);
    check('...and the spacing is capped at thirty seconds', gaps.every((g) => g <= 30000) && gaps[5] <= 30000, gaps);
    w.setText('a new kind of message');
    w.batch(['ALERT: call now']);
    const before = c.log.runs.length;
    w.advance(700);
    check('a new kind of token brings the base cadence straight back', c.log.runs.length === before + 1, c.log.runs.length - before);
  });

  section('a positive pass, and done', () => {
    const w = world();
    let shown = false;
    const c = consumer(w, { done: () => shown, run: () => { shown = true; return true; } });
    w.batch(['virus']);
    w.advance(700);
    check('a pass that warns is counted as positive', shown === true);
    w.batch(['virus again']);
    w.advance(5000);
    check('...and a detector that is done is never scheduled again', w.state.timers.length === 0);
  });

  section('hidden and route change', () => {
    const w = world();
    const c = consumer(w);
    c.handle.now();
    w.visible(false);
    w.batch(['virus warning']);
    w.advance(5000);
    check('a hidden tab defers its pass', c.log.runs.length === 1, c.log.runs.length);
    w.visible(true);
    w.advance(700);
    check('...and runs it at the base delay once looked at', c.log.runs.length === 2, c.log.runs.length);
    for (let i = 0; i < 3; i++) { w.setText('changing ' + i); w.batch(['virus ' + i]); w.advance(30000); }
    const spaced = c.log.runs.length;
    w.state.href = 'https://app.example/other-route';
    w.setText('a new route');
    w.batch(['virus on the new route']);
    w.advance(700);
    check('a route change resets the backoff so the new page is read at the base delay', c.log.runs.length === spaced + 1, c.log.runs.length - spaced);
  });

  section('sharing', () => {
    const w = world();
    const a = consumer(w, { id: 'a' });
    const b = consumer(w, { id: 'b', delay: 700 });
    const walks = w.state.walks;
    w.batch(['virus warning for both']);
    w.advance(700);
    check('two detectors due in the same tick share one page snapshot', a.log.runs.length === 1 && b.log.runs.length === 1 && w.state.walks - walks === 1, w.state.walks - walks);
    const c = consumer(w, { id: 'c' });
    w.batch(['virus 1']); w.batch(['virus 2']); w.batch(['virus 3']);
    w.advance(700);
    check('batches arriving while a pass is pending fold into it', c.log.runs.length === 1, c.log.runs.length);
    const t = consumer(w, { id: 'text-nodes', relevant: (text) => (/infected/i.test(text) ? 'infected' : '') });
    w.batch([], ['is infected']);
    w.advance(700);
    check('text added as bare text nodes is read through its block', t.log.runs.length === 1);
  });

  /* ---- the detectors go through it, with their own patterns --------------------------------- */
  section('the detectors', () => {
    check('Scam Lock registers through the scheduler with its fear and call patterns', /__woTextScan\.add\(\{id:"scam-lock",delay:700,done:\(\)=>scamShown\|\|trustedMediaHost\|\|conversationHost,/.test(CONTENT) && /const m=FEAR\.exec\(text\)\|\|CALL\.exec\(text\);return m\?m\[0\]\.toLowerCase\(\):""\},run:scamScan\}\)/.test(CONTENT));
    check('ClickFix registers through it, gated on its instruction table', /__woTextScan\.add\(\{id:"clickfix",delay:800,done:\(\)=>!WO\.commandPasteGuard,relevant:text=>\{const value=normalizeClickfixText\(text\);for\(let i=0;i<CLICKFIX_INSTRUCTIONS\.length;i\+\+\)if\(CLICKFIX_INSTRUCTIONS\[i\]\[0\]\.test\(value\)\)return CLICKFIX_INSTRUCTIONS\[i\]\[1\];return""\},run:\(\)=>scanPageForClickFix\(\)\}\)/.test(CONTENT));
    check('Fake Update registers through it with its lure and call-to-action patterns', /__woTextScan\.add\(\{id:"fake-update",delay:800,done:\(\)=>fuWarned\|\|FU_VENDOR\.test\(fuHere\),relevant:text=>\{const m=FU_LURE\.exec\(text\)\|\|FU_CTA\.exec\(text\);return m\?m\[0\]\.toLowerCase\(\):""\},run:fakeUpdateScan\}\)/.test(CONTENT));
    check('none of the three watches mutations on its own any more', !/scamShown\|\|sPending\|\|/.test(CONTENT) && !/fuWarned\|\|fuPending\|\|/.test(CONTENT) && !/pending\|\|\(pending=!0,setTimeout\(\(\)=>\{pending=!1,__woIdle\(scanPageForClickFix/.test(CONTENT));
    check('each pass answers whether it warned', /scamScan=snapshot=>\{if\(scamShown\|\|trustedMediaHost\|\|conversationHost\)return!1;/.test(CONTENT) && /return scamShown\},scamGuard=/.test(CONTENT) && /fakeUpdateScan=snapshot=>\{/.test(CONTENT) && /return fuWarned\},fakeUpdateGuard=/.test(CONTENT) && /let warned=!1;try\{refreshClickfixRouteState\(\);/.test(CONTENT) && /return warned\};if\(WO_TOP\)\{/.test(CONTENT));
    check('the passes read the shared snapshot rather than walking the page again', /const t=snapshot\|\|bodyTextCapped\(2e4\)/.test(CONTENT) && /const bodyText=snapshot\|\|bodyTextCapped\(2e4\)/.test(CONTENT));
    check('the clipboard path still reads the page directly and is not gated', /handleSuspiciousClipboard=\(where,text,blocked\)=>\{if\(!WO\.commandPasteGuard\)return!1;refreshClickfixRouteState\(\);const found=inspectClickfixPage\(\)/.test(CONTENT));
    check('the source and the build agree', /__woTextScan=\(\(\)=>\{/.test(SOURCE) && /BACKOFF_MAX_MS=3e4/.test(SOURCE) && /ADDED_CAP=4096/.test(SOURCE));
  });

  section('the patterns', () => {
    const sb = { RegExp };
    vm.createContext(sb);
    vm.runInContext('const FEAR=' + regexConst('FEAR') + ';const CALL=' + regexConst('CALL') + ';const FU_LURE=' + regexConst('FU_LURE') + ';const FU_CTA=' + regexConst('FU_CTA')
      + ';this.p={FEAR,CALL,FU_LURE,FU_CTA};', sb);
    const p = sb.p;
    const scam = (text) => { const m = p.FEAR.exec(text) || p.CALL.exec(text); return m ? m[0].toLowerCase() : ''; };
    const fu = (text) => { const m = p.FU_LURE.exec(text) || p.FU_CTA.exec(text); return m ? m[0].toLowerCase() : ''; };
    check('Scam Lock: the fear line alone is relevant', scam('Your computer has been locked. Do not close this window.') !== '');
    check('...the call line alone is relevant, so the number arriving after the fear line still triggers a pass', scam('Call Microsoft support now at 1-800-555-0199') !== '');
    check('...and ordinary text is not', scam('Thanks for your order, it will ship on Monday.') === '');
    check('Fake Update: the lure alone and the call to action alone are both relevant', fu('Your browser is out of date') !== '' && fu('Click here to update') !== '');
    check('...and ordinary text is not', fu('Read the latest news on our blog') === '');
    check('none of the four patterns carries the global flag, so exec is stateless', ['FEAR', 'CALL', 'FU_LURE', 'FU_CTA'].every((n) => !/g[a-z]*$/.test(regexConst(n).slice(regexConst(n).lastIndexOf('/')))));
    check('this suite is wired into the gate', /test-text-scan-scheduler\.js/.test(GATE));
  });

  finished = true;
  console.log('');
  if (failures.length) {
    for (const f of failures) console.log('  FAIL ' + f);
    console.log('\n' + failures.length + ' check(s) failed, ' + pass + ' passed');
    process.exit(1);
  }
  process.exitCode = 0;
  console.log('  ok  ' + pass + ' checks: churn buys no pass, a changed page buys one, and the three detectors share it');
})().catch((e) => { finished = true; console.error(e); process.exit(1); });
