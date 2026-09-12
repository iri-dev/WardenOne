/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/*
 * The Logger's port is a session the page can lose and retake, not a permanent link.
 *
 * Capture lives in the service worker, and MV3 evicts a worker after about thirty seconds
 * idle -- holding a port open does not prevent it, because since Chrome 114 only messages
 * on the port reset the timer, and a Logger watching a quiet browser sends none. The page
 * used to answer the resulting disconnect with "Capture stopped. Reload this page to start
 * again." and nothing else: every later request went unrecorded while the table still
 * looked plausible, so someone checking whether a rule had fired would read the silence as
 * "nothing more happened" (MV3-05).
 *
 * This runs the shipped logger.js in a sandbox with a fake runtime, disconnects its port,
 * and asserts the page takes a new one. The things that make that safe rather than merely
 * automatic are asserted too: rows survive the gap, the gap is admitted in the UI, a
 * closed page stops trying, a hidden tab waits instead of burning its attempts, and
 * nothing pings the worker to hold it alive -- which would defeat the point of MV3.
 *
 * Run: node tools/test-logger-reconnect.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const JS = fs.readFileSync(path.join(ROOT, 'logger.js'), 'utf8');

let failures = 0;
function check(label, condition, extra) {
  if (condition) { console.log('  ok  ' + label); return; }
  failures++;
  console.log('  FAIL ' + label + (extra ? ' :: ' + extra : ''));
}

/* ---- a sandbox that behaves enough like the Logger page ------------------------- */

function makeHarness() {
  const els = new Map();
  const el = (id) => {
    if (!els.has(id)) {
      els.set(id, {
        id, textContent: '', value: '', children: [],
        style: {}, dataset: {},
        listeners: {},
        addEventListener(t, fn) { (this.listeners[t] = this.listeners[t] || []).push(fn); },
        removeEventListener() {},
        setAttribute() {}, getAttribute() { return null; },
        appendChild(c) { this.children.push(c); return c; },
        /* render() builds rows with append(), and a stub without it throws partway
           through -- leaving the count element untouched and every assertion about the
           table reading as an empty table rather than as a broken stub. */
        append(...kids) { kids.forEach((k) => this.children.push(k)); },
        remove() {},
        querySelector() { return null; },
        querySelectorAll() { return []; },
        closest() { return null; },
        focus() {},
        classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
      });
    }
    return els.get(id);
  };

  const ports = [];
  const timers = [];
  let visibility = 'visible';
  const docListeners = {};
  const winListeners = {};

  function newPort() {
    const p = {
      name: 'wardenone-logger',
      messages: [],
      disconnected: false,
      _msg: [],
      _dis: [],
      onMessage: { addListener(fn) { p._msg.push(fn); } },
      onDisconnect: { addListener(fn) { p._dis.push(fn); } },
      postMessage(m) { p.messages.push(m); },
      /* what the worker would send on connect */
      hello(entries) { p._msg.forEach((fn) => fn({ kind: 'hello', max: 1000, entries: entries || [], exactRules: true })); },
      send(msg) { p._msg.forEach((fn) => fn(msg)); },
      drop() { p.disconnected = true; p._dis.forEach((fn) => fn()); },
    };
    ports.push(p);
    return p;
  }

  let connectThrows = false;

  const sandbox = {
    document: {
      getElementById: el,
      createElement: (t) => el('created-' + t + '-' + Math.random()),
      addEventListener(t, fn) { (docListeners[t] = docListeners[t] || []).push(fn); },
      removeEventListener() {},
      querySelector() { return null; },
      querySelectorAll() { return []; },
      body: el('body'),
      get visibilityState() { return visibility; },
    },
    window: {
      addEventListener(t, fn) { (winListeners[t] = winListeners[t] || []).push(fn); },
      removeEventListener() {},
    },
    chrome: {
      runtime: {
        connect() {
          if (connectThrows) throw new Error('extension reloaded');
          return newPort();
        },
        lastError: null,
      },
    },
    setTimeout(fn, ms) { timers.push({ fn, ms }); return timers.length; },
    clearTimeout(id) { if (timers[id - 1]) timers[id - 1].cancelled = true; },
    setInterval() { return 0; },
    clearInterval() {},
    Math, Date, JSON, String, Number, Boolean, Array, Object, Map, Set, RegExp,
    Blob: function Blob() {}, URL: { createObjectURL: () => 'blob:x', revokeObjectURL() {} },
    navigator: { clipboard: { writeText: () => Promise.resolve() } },
    console: { log() {}, warn() {}, error() {} },
  };
  sandbox.globalThis = sandbox;
  sandbox.self = sandbox;
  vm.createContext(sandbox);

  return {
    sandbox, ports, timers, el,
    run() { vm.runInContext(JS, sandbox); },
    state: () => el('capture-state').textContent,
    fire(list, type) { (list[type] || []).forEach((fn) => fn()); },
    docListeners, winListeners,
    setVisibility(v) { visibility = v; },
    setConnectThrows(v) { connectThrows = v; },
    /* run every pending timer whose turn has come, once */
    drain() {
      const pending = timers.filter((t) => !t.cancelled && !t.done);
      pending.forEach((t) => { t.done = true; try { t.fn(); } catch (_) {} });
      return pending.length;
    },
  };
}

/* ---- 1. it connects, and a disconnect is not the end ---------------------------- */

{
  const h = makeHarness();
  h.run();
  check('the page opens a port on load', h.ports.length === 1);

  h.ports[0].hello([{ id: 'a', url: 'https://example.test/one', type: 'script' }]);
  check('a row from before the gap is on the page', /Recording/.test(h.state()), h.state());

  h.ports[0].drop();
  check('a disconnect does not tell the reader to reload',
    !/Reload this page to start again/.test(h.state()), h.state());
  check('it says capture is interrupted', /Reconnect|gap/i.test(h.state()), h.state());

  const ran = h.drain();
  check('a reconnect was scheduled, not attempted inline', ran >= 1);
  check('the page took a replacement port', h.ports.length === 2,
    h.ports.length + ' ports opened');

  /* a cold worker's ring is empty -- the page must not treat that as "clear the table" */
  h.ports[1].hello([]);
  check('the gap is admitted once capture resumes', /restarted 1 time/.test(h.state()), h.state());
  check('and it says the gap was not recorded', /not recorded/.test(h.state()), h.state());
}

/* ---- 2. rows survive the gap ---------------------------------------------------- */

{
  const h = makeHarness();
  h.run();
  h.ports[0].hello([{ id: 'a', url: 'https://example.test/a', type: 'script' }]);
  h.ports[0].send({ kind: 'entries', entries: [{ id: 'b', url: 'https://example.test/b', type: 'image' }] });
  h.ports[0].drop();
  h.drain();
  h.ports[1].hello([]);          // cold worker, nothing to replay
  /* logger.js is strict-mode with top-level `let`, so ENTRIES is lexical and never
     reaches the sandbox object -- read what the render publishes instead, which is the
     honest observable anyway: it is what the reader sees. */
  h.drain();
  check('rows captured before the gap are still held',
    /\b2\b/.test(h.el('count').textContent),
    'count reads "' + h.el('count').textContent + '" -- a cold worker\'s empty hello must not wipe the table');
}

/* ---- 3. a closed page stops, and a hidden one waits ----------------------------- */

{
  const h = makeHarness();
  h.run();
  h.ports[0].hello([]);
  h.fire(h.winListeners, 'pagehide');
  h.ports[0].drop();
  h.drain();
  check('a closed page does not reconnect', h.ports.length === 1,
    h.ports.length + ' ports -- a closing page must not chase a port nobody will read');
}

{
  const h = makeHarness();
  h.run();
  h.ports[0].hello([]);
  h.setVisibility('hidden');
  h.ports[0].drop();
  h.drain();
  check('a hidden tab does not spend attempts in the background', h.ports.length === 1,
    h.ports.length + ' ports');
  h.setVisibility('visible');
  h.fire(h.docListeners, 'visibilitychange');
  check('and reconnects the moment it is looked at', h.ports.length === 2,
    h.ports.length + ' ports');
}

/* ---- 4. it gives up rather than spinning forever -------------------------------- */

{
  const h = makeHarness();
  h.run();
  h.ports[0].hello([]);
  h.setConnectThrows(true);
  h.ports[0].drop();
  for (let i = 0; i < 40; i++) h.drain();
  check('a permanently gone extension stops being asked',
    /could not restart|Reload this page/i.test(h.state()), h.state());
  check('and it stopped opening ports', h.ports.length === 1, h.ports.length + ' ports');
}

/* ---- 5. no keepalive, and the backoff is real ----------------------------------- */

/* Matched against code, not prose: an earlier version of this check searched the whole
   file for the word "keepalive" and tripped on the comment explaining why there isn't one. */
{
  const code = JS.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
  check('nothing pings the worker to keep it alive',
    !/kind:\s*['"]ping['"]/.test(code) && !/setInterval\s*\([^)]*postMessage/.test(code),
    'holding a worker up with traffic is exactly what MV3 exists to stop');
}
check('the retry backs off', /RECONNECT_BASE_MS \* Math\.pow\(2, reconnectAttempts\)/.test(JS));
check('the backoff is capped', /Math\.min\(RECONNECT_MAX_MS/.test(JS));
check('the retry is jittered', /Math\.random\(\)/.test(JS),
  'several Logger tabs reopened together would otherwise retry in lockstep');
check('a superseded port cannot trigger a reconnect', /if \(next !== port\) return;/.test(JS));
check('the clear button tolerates a dead port', /if \(port\) port\.postMessage/.test(JS));

console.log('');
if (failures) {
  console.log(failures + ' check(s) failed');
  process.exit(1);
}
console.log('all logger reconnect checks passed');
