/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/*
 * Clear clears, and the last close closes -- including the batch still waiting to be posted.
 * Run: node tools/test-logger-batch-reset.js
 *
 * The Network Logger holds a request in three places between capture and the page: the durable
 * ring, the in-flight joins, and a batch that waits 160 ms so a busy page does not post a message
 * per request. Clear emptied the first two; the last port's disconnect emptied the first two. The
 * third was outside both, so a batch queued just before Clear arrived after the "cleared" answer
 * and repopulated the page, and a batch queued just before the last logger closed was delivered to
 * the next logger to open -- against the page's own promise that the buffer goes with the last
 * close (L29). One reset now drops all three together, cancels the timer, and stamps a generation
 * so a timer callback from an earlier session cannot post into a later one. This suite drives the
 * real port protocol with fake timers through the card's three reproductions.
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const BG = fs.readFileSync(path.join(ROOT, 'background.js'), 'utf8');

let pass = 0;
const failures = [];
function check(name, cond, detail) {
  if (cond) { pass++; return; }
  failures.push(name + (detail ? ' — ' + detail : ''));
}

function balanced(src, start) {
  let depth = 0;
  let seen = false;
  for (let i = start; i < src.length; i++) {
    if (src[i] === '{') { depth++; seen = true; } else if (src[i] === '}') {
      depth--;
      if (seen && depth === 0) return src.slice(start, i + 1);
    }
  }
  throw new Error('unterminated block');
}
function grabFn(name) {
  const m = new RegExp('^(?:async )?function ' + name + '\\(', 'm').exec(BG);
  assert(m, 'missing ' + name);
  return balanced(BG, m.index);
}
const has = (name) => new RegExp('^(?:async )?function ' + name + '\\(', 'm').test(BG);
const line = (name, fallback) => { const m = new RegExp('^(?:const|let) ' + name + ' = [^\\n]+$', 'm').exec(BG); return m ? m[0] : fallback; };

/* The port protocol: the onConnect registration, lifted whole. */
const connectStart = BG.indexOf("  chrome.runtime.onConnect.addListener((port) => {\n    if (!port || port.name !== 'wardenone-logger') return;");
assert(connectStart >= 0, 'the logger port registration moved');
const CONNECT = balanced(BG, connectStart) + ');';

const LIFTED = [
  line('LOG_MAX'), line('LOG_RING'), line('LOG_PENDING'), line('LOG_PORTS'), line('LOG_SEQ'), line('LOG_ATTACHED'), line('LOG_FLUSH_TIMER'), line('LOG_DIRTY'),
  line('LOG_MATCH_POLL_MS'), line('LOG_MATCH_WINDOW_MS'), line('LOG_MATCH_TALLY'), line('LOG_MATCH_TIMER'), line('LOG_MATCH_SINCE'),
  line('LOG_GENERATION', 'let LOG_GENERATION = 0;'),
  has('logReset') ? grabFn('logReset') : 'function logReset() { LOG_RING.length = 0; LOG_PENDING.clear(); }',
  grabFn('logPush'), grabFn('logQueue'), grabFn('logAttach'), grabFn('logDetach'),
  grabFn('logRuleFeedbackAvailable'), grabFn('logMatchedRulesAvailable'),
  'function logOnBeforeRequest() {} function logOnCompleted() {} function logOnErrorOccurred() {} function logOnRuleMatched() {} function logPollMatchedRules() {}',
  'function messageSenderIsExtensionPage() { return true; }',
  CONNECT,
].join('\n');

function realm() {
  const state = { timers: [], timerId: 0, onConnect: null };
  const sandbox = {
    console, Object, Array, String, Number, Set, Map, Math, Date, JSON,
    setTimeout: (fn, ms) => { const id = ++state.timerId; state.timers.push({ id, fn, ms }); return id; },
    clearTimeout: (id) => { state.timers = state.timers.filter((t) => t.id !== id); },
    setInterval: () => 0, clearInterval: () => {},
    chrome: {
      runtime: { onConnect: { addListener: (fn) => { state.onConnect = fn; } } },
      webRequest: { onBeforeRequest: { addListener() {}, removeListener() {} }, onCompleted: { addListener() {}, removeListener() {} }, onErrorOccurred: { addListener() {}, removeListener() {} } },
      declarativeNetRequest: {},
    },
  };
  const ctx = vm.createContext(sandbox);
  vm.runInContext(LIFTED + '\nthis.api = { push: logPush, ring: LOG_RING, dirty: () => LOG_DIRTY, ports: LOG_PORTS, attached: () => LOG_ATTACHED, flushTimer: () => LOG_FLUSH_TIMER };', ctx, { filename: 'logger-ports.js' });
  /* A logger page: a port with the three things the worker touches. */
  const connect = () => {
    const port = { name: 'wardenone-logger', sender: { url: 'chrome-extension://wo/logger.html' }, received: [], handlers: {}, disconnected: [] };
    port.postMessage = (m) => { port.received.push(JSON.parse(JSON.stringify(m))); };
    port.onMessage = { addListener: (fn) => { port.handlers.message = fn; } };
    port.onDisconnect = { addListener: (fn) => { port.disconnected.push(fn); } };
    port.disconnect = () => {};
    state.onConnect(port);
    port.send = (m) => port.handlers.message(m);
    port.close = () => { for (const fn of port.disconnected) fn(); };
    port.kinds = () => port.received.map((m) => m.kind);
    port.entries = () => port.received.filter((m) => m.kind === 'entries').flatMap((m) => m.entries);
    return port;
  };
  const fire = () => { const due = state.timers.splice(0); for (const t of due) t.fn(); };
  const request = (id, url) => sandbox.api.push({ id, rid: 'r' + id, at: Date.now(), method: 'GET', url, host: 'x.example', action: 'pending' });
  return { state, api: sandbox.api, connect, fire, request };
}

/* ---- 1. Clear, then the batch fires ------------------------------------------------------ */
{
  const r = realm();
  const page = r.connect();
  r.request(1, 'https://x.example/a');
  r.request(2, 'https://x.example/b');
  check('setup: two requests are waiting in the batch', r.api.dirty().length === 2 && r.api.ring.length === 2 && r.state.timers.length === 1);
  page.send({ kind: 'clear' });
  check('Clear empties the ring and the waiting batch, and cancels the timer', r.api.ring.length === 0 && r.api.dirty().length === 0 && r.state.timers.length === 0,
    JSON.stringify({ ring: r.api.ring.length, dirty: r.api.dirty().length, timers: r.state.timers.length }));
  r.fire();
  check('nothing arrives after "cleared"', page.kinds().join(',') === 'hello,cleared', page.kinds().join(','));
  r.request(3, 'https://x.example/c');
  r.fire();
  check('and capture carries on afterwards', page.entries().length === 1 && page.entries()[0].id === 3, JSON.stringify(page.entries()));
}
/* ---- 2. the last logger closes, another opens inside the batching window ------------------ */
{
  const r = realm();
  const first = r.connect();
  r.request(1, 'https://old.example/secret-page');
  first.close();
  check('the last close detaches and drops the ring', !r.api.attached() && r.api.ring.length === 0);
  const second = r.connect();
  check('a logger opened next starts empty', second.received[0].kind === 'hello' && second.received[0].entries.length === 0, JSON.stringify(second.received[0]));
  r.fire();
  check('and receives nothing captured for the window that closed', second.entries().length === 0 && !JSON.stringify(second.received).includes('old.example'),
    JSON.stringify(second.received).slice(0, 200));
}
/* ---- 3. several pages open at once ----------------------------------------------------- */
{
  const r = realm();
  const a = r.connect();
  const b = r.connect();
  r.request(1, 'https://x.example/a');
  a.send({ kind: 'clear' });
  r.fire();
  check('Clear from one page keeps the batch from every page', a.entries().length === 0 && b.entries().length === 0);
  r.request(2, 'https://x.example/b');
  r.fire();
  check('the next batch reaches both pages', a.entries().length === 1 && b.entries().length === 1);
  a.close();
  r.request(3, 'https://x.example/c');
  r.fire();
  check('one page closing does not detach while another is open', r.api.attached() && b.entries().length === 2);
}
/* ---- 4. a stale timer callback cannot post into a later session --------------------------- */
{
  const r = realm();
  const page = r.connect();
  r.request(1, 'https://x.example/a');
  const stale = r.state.timers.splice(0);              // the callback, taken before Clear
  page.send({ kind: 'clear' });
  r.request(2, 'https://x.example/b');
  for (const t of stale) t.fn();                       // the old callback runs late
  check('a callback from before Clear posts nothing', page.entries().length === 0, JSON.stringify(page.entries()));
  r.fire();
  check('while the batch queued after Clear arrives on its own timer', page.entries().length === 1 && page.entries()[0].id === 2);
}
/* ---- 5. the ordinary path is untouched ---------------------------------------------------- */
{
  const r = realm();
  const page = r.connect();
  for (let i = 1; i <= 5; i++) r.request(i, 'https://x.example/' + i);
  check('five requests wait as one batch on one timer', r.state.timers.length === 1 && r.state.timers[0].ms === 160);
  r.fire();
  check('and arrive as one message', page.received.filter((m) => m.kind === 'entries').length === 1 && page.entries().length === 5);
}

/* ---- the wiring --------------------------------------------------------------------------- */
check('one reset is called from Clear and from the last close', /if \(msg\.kind === 'clear'\) \{\s*logReset\(\);/.test(BG) && /function logDetach\(\) \{[\s\S]{0,1200}logReset\(\);/.test(BG));
check('the reset drops all three buffers and the timer', /function logReset\(\) \{[\s\S]{0,600}clearTimeout\(LOG_FLUSH_TIMER\)[\s\S]{0,300}LOG_DIRTY = \[\];[\s\S]{0,200}LOG_RING\.length = 0;[\s\S]{0,100}LOG_PENDING\.clear\(\);/.test(BG));
check('a batch is stamped with the session it belongs to', /const generation = LOG_GENERATION;/.test(BG) && /if \(generation !== LOG_GENERATION\) return;/.test(BG));

console.log('');
if (failures.length) {
  for (const f of failures) console.log('  FAIL ' + f);
  console.log('\n' + failures.length + ' check(s) failed, ' + pass + ' passed');
  process.exit(1);
}
console.log('  ok  ' + pass + ' checks: Clear and the last close take the waiting batch with them');
