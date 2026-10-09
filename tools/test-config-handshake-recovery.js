/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/* MV3 worker failures must not strand a document on default config. Exercise bridge
   retries, revision ordering, visibility recovery, and shared frame acquisition. */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const read = (env, rel) => { try { return fs.readFileSync(process.env[env] || path.join(ROOT, rel), 'utf8'); } catch (_) { return ''; } };
const BRIDGE = read('WARDENONE_BRIDGE', 'bridge.js');
const BG = read('WARDENONE_BACKGROUND', 'background.js');
const POPUP_HEALTH = read('WARDENONE_POPUP_HEALTH', 'popup-health.js');
const MANIFEST = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));

let pass = 0;
const failures = [];
function check(name, cond, detail) {
  if (cond) { pass++; return; }
  failures.push(name + (detail === undefined ? '' : ' -- ' + detail));
}
function section(name, fn) {
  try { fn(); } catch (e) { failures.push(name + ' -- threw: ' + (e && e.stack || e)); }
}

/* ---- lift the acquisition block ------------------------------------------------------------- */
const a = BRIDGE.indexOf("  const CONTENT_CONFIG_NEED = ['overrides', 'learned', 'supplemental', 'hidden'];");
const bMarker = "      bridgeFetchContentConfig(wanted, cb, SIBLING_CONFIG_ATTEMPTS);\n    };\n  } catch (_) {}\n";
const b = a >= 0 ? BRIDGE.indexOf(bMarker, a) : -1;
const BLOCK = a >= 0 && b > a ? BRIDGE.slice(a, b + bMarker.length) : '';
check('the acquisition block is in bridge.js', BLOCK.length > 1000, BLOCK.length + ' chars');

/* A bridge world: fake timers, a scripted runtime, and stubs for the bridge helpers the block
   calls. Every timer is explicit -- nothing runs until the test advances the clock. */
function world(options) {
  const opts = options || {};
  const timers = [];
  let now = 0;
  let nextId = 1;
  const outbox = [];        // content-config-get calls, in order: { msg, cb, answered }
  const boots = [];         // redirect-bootstrap-get calls, kept apart so the snapshot's indices hold
  const order = [];         // every request's kind, in the order it went out
  const posted = [];        // what the bridge posted to the page
  const sent = [];          // sendConfig calls
  const listeners = {};
  const applied = { learned: [], supplemental: [], hidden: [] };
  const sandbox = {
    Number, Math, Array, Object, String,
    console,
    woPending: new Set(),
    woTimeout: (fn, ms) => { const id = nextId++; timers.push({ id, at: now + (Number(ms) || 0), fn }); return id; },
    clearTimeout: (id) => { const i = timers.findIndex((t) => t.id === id); if (i >= 0) timers.splice(i, 1); },
    woOn: (target, type, fn) => { (listeners[type] = listeners[type] || []).push(fn); },
    window: {},
    document: { visibilityState: 'visible' },
    chrome: { runtime: { lastError: undefined, sendMessage: (msg, cb) => {
      order.push(msg && msg.kind);
      (msg && msg.kind === 'redirect-bootstrap-get' ? boots : outbox).push({ msg, cb, answered: 0 });
    } } },
    postToPage: (m) => posted.push(m),
    signed: (kind, text, fields) => Object.assign({ signedAs: kind, signedText: text }, fields),
    TOKEN: 'tok',
    bridgeConfigReady: false,
    bridgeFrameSite: '',
    setLearnedGrabberDomains: (v) => applied.learned.push(v),
    setSupplementalLists: (v) => applied.supplemental.push(v),
    bridgeApplyUserHidden: (v) => applied.hidden.push(v),
    normalizeBridgeHost: (h) => String(h || '').toLowerCase(),
    sendConfig: null,
  };
  sandbox.sendConfig = (overrides) => { sent.push(overrides); sandbox.bridgeConfigReady = true; };
  vm.createContext(sandbox);
  vm.runInContext(BLOCK, sandbox, { filename: 'bridge.js:acquisition' });
  const api = {
    sandbox, outbox, boots, order, posted, sent, listeners, applied,
    now: () => now,
    pending: () => timers.map((t) => t.at - now).sort((x, y) => x - y),
    /* Advance the clock, running every timer that comes due, in order. */
    advance(ms) {
      const until = now + ms;
      for (;;) {
        timers.sort((x, y) => x.at - y.at);
        const next = timers[0];
        if (!next || next.at > until) break;
        timers.shift();
        now = next.at;
        next.fn();
      }
      now = until;
    },
    /* Answer the nth request (0-based). `err` sets runtime.lastError for the callback. */
    reply(n, res, err) {
      const entry = outbox[n];
      if (!entry) throw new Error('no request #' + n);
      entry.answered++;
      sandbox.chrome.runtime.lastError = err ? { message: err } : undefined;
      try { entry.cb(res); } finally { sandbox.chrome.runtime.lastError = undefined; }
    },
    /* Answer the nth bootstrap request (0-based). */
    replyBoot(n, res, err) {
      const entry = boots[n];
      if (!entry) throw new Error('no bootstrap request #' + n);
      entry.answered++;
      sandbox.chrome.runtime.lastError = err ? { message: err } : undefined;
      try { entry.cb(res); } finally { sandbox.chrome.runtime.lastError = undefined; }
    },
    fire(type, event) { (listeners[type] || []).forEach((fn) => fn(event || {})); },
    request: () => vm.runInContext('requestContentConfig()', sandbox),
    snapshot: () => sandbox.window.__wardenOneContentConfig(),
    ask: (need, cb) => sandbox.window.__wardenOneContentConfigRequest(need, cb),
  };
  /* Most sections are about the full snapshot: their bootstrap is answered at once, which leaves
     no timer of its own behind. */
  if (!opts.holdBootstrap && boots[0]) api.replyBoot(0, BOOT_OK);
  return api;
}
const BOOT_OK = { ok: true, overrides: { enabled: true, blockForcedPopups: true, strictPopupShield: true, blockPopupTricks: true } };
const ok = (rev, extra) => Object.assign({ ok: true, rev, overrides: { enabled: true, marker: 'rev' + rev }, learned: {}, supplemental: {}, hidden: [], site: 'example.com' }, extra || {});

if (BLOCK) {
  section('the first request is made at once', () => {
    const w = world();
    check('one request goes out on start', w.outbox.length === 1);
    check('for the bridge\'s four parts', JSON.stringify(w.outbox[0].msg) === JSON.stringify({ kind: 'content-config-get', need: ['overrides', 'learned', 'supplemental', 'hidden'] }));
    check('a deadline is armed against a reply that never comes', w.pending().length === 1 && w.pending()[0] === 8000);
    w.reply(0, ok(100));
    check('a good answer is applied once', w.sent.length === 1 && w.sent[0].marker === 'rev100');
    check('and the frame learns its site', w.sandbox.bridgeFrameSite === 'example.com');
    check('the lists reach their setters', w.applied.learned.length === 1 && w.applied.supplemental.length === 1);
    check('the deadline is cleared', w.pending().length === 0);
    check('the snapshot is held for the frame\'s other scripts', w.snapshot() && w.snapshot().rev === 100);
  });

  section('THE CARD: the worker dies mid-reply', () => {
    const w = world();
    w.reply(0, undefined, 'The message port closed before a response was received.');
    check('lastError does not end the handshake: a retry is scheduled', w.pending().length === 1 && w.pending()[0] === 300, JSON.stringify(w.pending()));
    check('nothing is applied from a dead reply', w.sent.length === 0 && !w.sandbox.bridgeConfigReady);
    w.advance(300);
    check('the second request goes out at 300 ms', w.outbox.length === 2);
    w.reply(1, ok(100));
    check('and its answer configures the document', w.sent.length === 1 && w.sandbox.bridgeConfigReady === true);
    w.advance(60000);
    check('nothing further is asked once answered', w.outbox.length === 2);
  });

  section('the schedule is exponential and bounded', () => {
    const w = world();
    const delays = [];
    for (let i = 0; i < 8; i++) {
      w.reply(i, undefined, 'Could not establish connection. Receiving end does not exist.');
      const p = w.pending();
      if (p.length) delays.push(p[0]);
      w.advance(p.length ? p[0] : 0);
    }
    check('eight attempts are made', w.outbox.length === 8, w.outbox.length);
    check('spaced 300, 600, 1200, 2400, 4800, then capped at 5 s', JSON.stringify(delays) === JSON.stringify([300, 600, 1200, 2400, 4800, 5000, 5000]), JSON.stringify(delays));
    w.advance(60000);
    check('and then it stops -- a worker that is really gone is not asked forever', w.outbox.length === 8 && w.pending().length === 0);
    check('the document is still marked unconfigured', w.sandbox.bridgeConfigReady === false);
    /* ...until the page is shown or looked at again. */
    w.fire('visibilitychange');
    check('becoming visible while unanswered asks again', w.outbox.length === 9);
    w.reply(8, ok(7));
    check('and the late worker configures the document after all', w.sent.length === 1 && w.sandbox.bridgeConfigReady);
    w.fire('visibilitychange');
    check('once configured, a visibility change asks nothing', w.outbox.length === 9);
  });

  section('malformed and missing answers', () => {
    const w = world();
    w.reply(0, { ok: false, error: 'busy' });
    check('an answer without ok is retried', w.pending()[0] === 300 && w.sent.length === 0);
    w.advance(300);
    w.reply(1, null);
    check('a null answer is retried', w.pending()[0] === 600 && w.sent.length === 0);
    w.advance(600);
    check('a third request goes out', w.outbox.length === 3);
    /* No reply at all this time: the 8 s deadline fires, then the next backoff step (1200 ms). */
    w.advance(8000 + 1200);
    check('a reply that never comes is treated as failed after the deadline', w.outbox.length === 4, w.outbox.length);
    w.reply(3, ok(5));
    check('and the next good answer is applied', w.sent.length === 1);
    /* A very late callback for the request that timed out is ignored. */
    w.reply(2, ok(6));
    check('a callback that arrives after its deadline is ignored', w.sent.length === 1 && w.snapshot().rev === 5);
    w.reply(3, ok(9));
    check('a second callback for one request is ignored', w.sent.length === 1);
  });

  section('revisions: newest wins, stale is dropped', () => {
    const w = world();
    w.reply(0, ok(200));
    check('rev 200 applied', w.sent.length === 1 && w.snapshot().rev === 200);
    w.request();                 // a refresh
    w.reply(1, ok(100));
    check('an older revision arriving later is dropped', w.sent.length === 1 && w.snapshot().rev === 200,
      'the worker has rebuilt since; this reply is from before that');
    w.request();
    w.reply(2, ok(300));
    check('a newer one is applied', w.sent.length === 2 && w.snapshot().rev === 300 && w.sent[1].marker === 'rev300');
    w.request();
    w.reply(3, ok(300));
    check('the same revision is applied again harmlessly (a refresh that changed nothing)', w.sent.length === 3);
    w.request();
    w.reply(4, ok(undefined));
    check('an answer without a revision (an older worker) is still applied', w.sent.length === 4);
  });

  section('a superseded acquisition cannot apply', () => {
    const w = world();
    w.request();                 // second acquisition while the first is pending
    check('two requests are in flight', w.outbox.length === 2);
    w.reply(0, ok(50));
    check('the first acquisition\'s late answer is ignored', w.sent.length === 0);
    w.reply(1, ok(60));
    check('the current one applies', w.sent.length === 1 && w.snapshot().rev === 60);
  });

  section('pageshow', () => {
    const w = world();
    w.reply(0, ok(1));
    w.fire('pageshow', { persisted: false });
    check('an ordinary pageshow on a configured document asks nothing', w.outbox.length === 1);
    w.fire('pageshow', { persisted: true });
    check('a document restored from the back/forward cache asks again', w.outbox.length === 2,
      'the worker may have changed while the page was frozen and could not reach it');
    const w2 = world();
    w2.reply(0, undefined, 'gone');
    w2.advance(100000);
    w2.fire('pageshow', { persisted: false });
    check('a never-configured document asks again on any pageshow', w2.outbox.length === 9);
  });

  section('the frame\'s other isolated scripts ask the bridge', () => {
    const w = world();
    check('no snapshot before the first answer', w.snapshot() === null);
    let got = 'unset';
    w.ask(['overrides'], (res) => { got = res; });
    check('a sibling asking before the answer makes its own request', w.outbox.length === 2 && JSON.stringify(w.outbox[1].msg.need) === '["overrides"]');
    w.reply(1, undefined, 'dead');
    check('and it retries too', w.pending().some((d) => d === 300));
    w.advance(300);
    w.reply(2, ok(3));
    check('a sibling\'s own answer reaches it', got && got.rev === 3);
    check('without configuring the bridge itself', w.sent.length === 0);
    w.reply(0, ok(4));
    check('the bridge is configured by its own answer', w.sent.length === 1);
    let cached = 'unset';
    w.ask(['overrides'], (res) => { cached = res; });
    check('a sibling asking afterwards makes no request', w.outbox.length === 3);
    check('and is answered asynchronously', cached === 'unset');
    w.advance(0);
    check('from the bridge\'s snapshot', cached && cached.rev === 4);
    let junk = 'unset';
    w.ask(['overrides', 'searchJunk'], (res) => { junk = res; });
    check('a need the bridge did not fetch is a real request', w.outbox.length === 4 && w.outbox[3].msg.need.indexOf('searchJunk') >= 0);
    w.reply(3, ok(4, { searchJunkDomains: ['x.example'] }));
    check('answered directly', junk && Array.isArray(junk.searchJunkDomains));
  });

  /* A settings change: the worker tells every tab to refresh, the bridge re-fetches, and Eye
     Shield -- told the same thing -- asks the bridge while that re-fetch is still in flight. It
     used to be answered at once from the snapshot being replaced, put the previous mode back, and
     was never told again; measured on a live GitHub tab, a switch to Light was still Ultra 1.2 s
     later. It now waits for the refresh. */
  section('a sibling asking during a refresh gets the refreshed snapshot', () => {
    const w = world();
    w.reply(0, ok(1));
    w.request();
    check('the refresh is a real request', w.outbox.length === 2);
    let got = 'unset';
    w.ask(['overrides'], (res) => { got = res; });
    w.advance(0);
    check('the sibling is not answered from the old snapshot while the refresh is in flight', got === 'unset');
    check('and makes no request of its own', w.outbox.length === 2);
    w.reply(1, ok(2));
    w.advance(0);
    check('it is answered with the refreshed snapshot', got && got.rev === 2, JSON.stringify(got));
    let after = 'unset';
    w.ask(['overrides'], (res) => { after = res; });
    w.advance(0);
    check('with nothing in flight, the held snapshot answers at once', after && after.rev === 2);
  });
  section('a refresh that never lands does not strand the sibling', () => {
    const w = world();
    w.reply(0, ok(1));
    w.request();
    let got = 'unset';
    w.ask(['overrides'], (res) => { got = res; });
    w.advance(7999);
    check('it waits for the refresh', got === 'unset');
    w.advance(1);
    check('then is answered from what the bridge holds', got && got.rev === 1, JSON.stringify(got));
  });

  section('a sibling\'s budget is short', () => {
    const w = world();
    w.reply(0, ok(1));           // the bridge itself is answered, so only the sibling's requests remain
    let got = 'unset';
    w.ask(['overrides', 'searchJunk'], (res) => { got = res; });   // not covered by the bridge's parts: a real request
    const mine = () => w.outbox.filter((e) => e.msg.need.indexOf('searchJunk') >= 0);
    for (let i = 0; i < 6; i++) {
      const open = mine().find((e) => !e.answered);
      if (open) w.reply(w.outbox.indexOf(open), undefined, 'dead');
      w.advance(5000);
    }
    check('four attempts, then null: a default-on protection does not wait half a minute', got === null && mine().length === 4, mine().length + ' requests, got=' + JSON.stringify(got));
  });

  /* The quick popup-switch bootstrap. It arms the popup guards and the player-frame guards before
     the full snapshot lands, and it was asked for once: a cold worker answered that one request
     with lastError and a freshly loaded player frame stayed unguarded until the full snapshot. It
     is asked until answered now, on a short budget, and only for as long as it can still matter.
     It never arms anything by itself: until an answer says what the reader chose, nothing does. */
  section('the bootstrap is asked for first, and posted once answered', () => {
    const w = world({ holdBootstrap: true });
    check('the bootstrap goes out before the full snapshot, so it stays the quick one',
      JSON.stringify(w.order) === JSON.stringify(['redirect-bootstrap-get', 'content-config-get']), JSON.stringify(w.order));
    check('nothing is posted to the page before an answer', w.posted.length === 0);
    w.replyBoot(0, BOOT_OK);
    check('an answer is posted to the page, signed, once',
      w.posted.length === 1 && w.posted[0].signedAs === 'redirect-bootstrap' && w.posted[0].kind === 'redirect-bootstrap'
        && w.posted[0].overrides.blockPopupTricks === true && w.posted[0].token === 'tok', JSON.stringify(w.posted));
    w.advance(60000);
    check('and it is not asked for again', w.boots.length === 1, w.boots.length);
  });

  section('THE CARD: a cold worker fails the bootstrap', () => {
    const w = world({ holdBootstrap: true });
    w.replyBoot(0, undefined, 'Could not establish connection. Receiving end does not exist.');
    check('lastError does not end it: a retry is scheduled at 150 ms', w.pending().includes(150), JSON.stringify(w.pending()));
    w.advance(150);
    check('the second request goes out', w.boots.length === 2);
    w.replyBoot(1, BOOT_OK);
    check('and its answer reaches the page', w.posted.length === 1 && w.posted[0].overrides.blockPopupTricks === true);
  });

  section('a bootstrap reply that never comes, or comes without the switches, is asked again', () => {
    const w = world({ holdBootstrap: true });
    w.advance(1999);
    check('it waits two seconds for an answer', w.boots.length === 1);
    w.advance(1 + 150);
    check('then asks again', w.boots.length === 2);
    w.replyBoot(1, { ok: true });
    w.advance(300);
    check('an answer without the switches does not count', w.boots.length === 3 && w.posted.length === 0, w.boots.length + ' requests');
  });

  section('the bootstrap\'s budget is short, and the full snapshot keeps its own', () => {
    const w = world({ holdBootstrap: true });
    for (let i = 0; i < 8; i++) {
      const open = w.boots.find((e) => !e.answered);
      if (open) w.replyBoot(w.boots.indexOf(open), undefined, 'dead');
      w.advance(1500);
    }
    check('five attempts, then it stops', w.boots.length === 5, w.boots.length + ' requests');
    check('and nothing was posted on a guess', w.posted.length === 0);
    /* Twelve seconds in, the full snapshot is on its own retry by now: answer the request still open. */
    w.reply(w.outbox.length - 1, ok(7));
    check('the full snapshot still arrives and is applied', w.sent.length === 1 && w.sent[0].marker === 'rev7',
      w.outbox.length + ' snapshot requests, sent=' + JSON.stringify(w.sent));
  });

  section('once the full snapshot is in, the bootstrap stops', () => {
    const w = world({ holdBootstrap: true });
    w.replyBoot(0, undefined, 'dead');
    w.reply(0, ok(3));
    w.advance(10000);
    check('no further bootstrap is asked for after the full snapshot', w.boots.length === 1, w.boots.length + ' requests');
    const late = world({ holdBootstrap: true });
    late.reply(0, ok(4));
    late.replyBoot(0, BOOT_OK);
    check('and a late bootstrap is not posted over it', late.posted.length === 0, JSON.stringify(late.posted));
  });
}

/* ---- the worker's half ----------------------------------------------------------------------- */
section('worker', () => {
  check('the shared snapshot carries its build time as the revision', /rev,\s*\n\s*overrides: sanitizeContentConfig/.test(BG));
  /* Stamped when the inputs were read, before the read: stamped after it, a build that read the old
     settings just before a save and finished just after the popup's push carried a revision newer
     than the push, and Eye Shield would have taken it and put the previous mode back. */
  check('and that time is taken before the settings are read, not after',
    /const rev = Date\.now\(\);\s*\n\s*const store = await localGet\(contentConfigInputKeys\(\)\);/.test(BG));
  check('and every answer carries it', /ok: true,\s*\n\s*rev: shared\.rev,/.test(BG));
  check('the memo is dropped when an input key changes, so a newer configuration is a newer build',
    /if \(Object\.keys\(payload\)\.some\(\(key\) => contentConfigInputKeys\(\)\.includes\(key\)\)\) invalidateContentConfigMemo\(\);/.test(BG));
  check('the engine status carries whether the document is configured', /configured: bridgeConfigReady/.test(BRIDGE));
  check('and Protection Health tells running from configured', /answer\.alive && answer\.configured === false/.test(BG) && /state: 'unconfigured'/.test(BG));
  check('with a plain-language label in the popup',
    /state: 'unconfigured', host, summary: 'Page protection is starting\.'/.test(BG)
      && /tabLine\.textContent = String\(tab\.text \|\| ''\)/.test(POPUP_HEALTH));
});

/* ---- the siblings ---------------------------------------------------------------------------- */
section('siblings', () => {
  for (const f of ['consent-reject.js', 'consent-wall.js', 'eyeshield.js', 'mail-shield.js', 'oauth-guard.js', 'search-junk.js', 'twitch-rewind.js', 'twitch-vod-rewind.js']) {
    const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
    const helper = /function askContentConfig\(need, cb\) \{[\s\S]*?window\.__wardenOneContentConfigRequest[\s\S]*?\n  \}/.exec(src);
    check(f + ' asks through the bridge', !!helper);
    check(f + ' keeps exactly one direct request, inside the fallback', (src.match(/content-config-get/g) || []).length === 1 && !!helper && helper[0].indexOf('content-config-get') > 0);
    check(f + ' uses it', /askContentConfig\(\[/.test(src.replace(helper ? helper[0] : '', '')));
  }
  const bridgeEntry = (MANIFEST.content_scripts || []).find((e) => (e.js || []).includes('bridge.js'));
  check('the bridge runs in the isolated world, so the requester it exposes is not the page\'s', !!bridgeEntry && bridgeEntry.world === 'ISOLATED');
  check('in every frame, so every sibling has one', !!bridgeEntry && bridgeEntry.all_frames === true && bridgeEntry.run_at === 'document_start');
});

if (failures.length) {
  console.error('FAIL (' + failures.length + ')');
  failures.forEach((f) => console.error('  - ' + f));
  process.exit(1);
}
console.log('config handshake recovery: ' + pass + ' checks passed');
