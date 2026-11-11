/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/* A browser test that waits on a call the browser never answers -- an evaluate on a page the test
   then saw torn down -- has nothing left to run, and Node exits 0 in the middle of it. On CI,
   browser-config-race.js "passed" that way without its last checks. perf-profile.js mustFinish()
   turns that exit into a failure; this proves it does, and that every browser test CI runs uses it. */
'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const profile = require('./perf-profile.js');

const root = path.resolve(__dirname, '..');
const profilePath = JSON.stringify(path.join(__dirname, 'perf-profile.js'));
let checks = 0;
const check = (label, ok) => { checks++; assert(ok === true, label); };

function runScript(body) {
  const script = `const profile = require(${profilePath});\n${body}`;
  return spawnSync(process.execPath, ['-e', script], { encoding: 'utf8', timeout: 20000 });
}

const hung = runScript("profile.mustFinish(() => new Promise(() => {}), 'fixture').catch(() => { process.exitCode = 1; });");
check('a test left waiting on an unanswered call fails instead of exiting 0: exit ' + hung.status, hung.status === 1);
check('and says why', /fixture stopped before it finished/.test(hung.stderr));

const finished = runScript("profile.mustFinish(async () => { await new Promise((r) => setTimeout(r, 20)); console.log('done'); }, 'fixture')"
  + ".catch(() => { process.exitCode = 1; });");
check('a test that finishes still passes: exit ' + finished.status + ' ' + finished.stderr, finished.status === 0 && /done/.test(finished.stdout));

const failing = runScript("profile.mustFinish(async () => { throw new Error('boom'); }, 'fixture').catch(() => { process.exitCode = 1; });");
check('a test that fails keeps its own failure and no extra message', failing.status === 1 && !/stopped before it finished/.test(failing.stderr));

const workflow = fs.readFileSync(path.join(root, '.github', 'workflows', 'gate.yml'), 'utf8');
const browserTests = Array.from(new Set(Array.from(workflow.matchAll(/node (tools\/browser-[\w-]+\.js)/g), (m) => m[1])));
check('the workflow still runs browser tests: ' + browserTests.length, browserTests.length >= 8);
for (const file of browserTests) {
  const source = fs.readFileSync(path.join(root, file), 'utf8');
  check(file + ' runs through mustFinish', /\bmustFinish\(run, '[\w-]+'\)/.test(source) && !/^run\(\)\.catch\(/m.test(source));
}

async function checkCdpLifecycle() {
  const originalWebSocket = globalThis.WebSocket;
  const originalFetch = globalThis.fetch;
  class MockWebSocket {
    static OPEN = 1;
    constructor() {
      MockWebSocket.last = this; this.readyState = 0; this.listeners = new Map(); this.sent = [];
      if (MockWebSocket.autoOpen) queueMicrotask(() => this.open());
    }
    addEventListener(type, fn) {
      if (!this.listeners.has(type)) this.listeners.set(type, []);
      this.listeners.get(type).push(fn);
    }
    emit(type, event = {}) { for (const fn of this.listeners.get(type) || []) fn(event); }
    open() { this.readyState = MockWebSocket.OPEN; this.emit('open'); }
    send(payload) { if (this.sendError) throw this.sendError; this.sent.push(JSON.parse(payload)); }
    message(payload) { this.emit('message', { data: JSON.stringify(payload) }); }
    close() { this.readyState = 3; this.emit('close', { code: 1000, reason: 'browser stopped' }); }
  }
  async function connected() {
    const cdp = new profile.Cdp('ws://fixture');
    const opened = cdp.connect();
    const ws = MockWebSocket.last;
    ws.open();
    await opened;
    return { cdp, ws };
  }
  async function rejects(label, promise, pattern) { checks++; await assert.rejects(promise, pattern, label); }
  globalThis.WebSocket = MockWebSocket;
  try {
    {
      const { cdp, ws } = await connected();
      const response = cdp.send('Runtime.evaluate', { expression: '42' }, 'page');
      assert.deepEqual(ws.sent[0], { id: 1, method: 'Runtime.evaluate', params: { expression: '42' }, sessionId: 'page' });
      checks++;
      ws.message({ id: 1, result: { value: 42 } });
      assert.deepEqual(await response, { value: 42 });
      checks++;
      const failed = rejects('protocol errors still reject', cdp.send('Runtime.evaluate', {}, 'page'), /evaluation failed/);
      ws.message({ id: 2, error: { message: 'evaluation failed' } });
      await failed;
      check('normal replies remove pending commands', cdp.pending.size === 0);
    }
    {
      const cdp = new profile.Cdp('ws://fixture');
      await rejects('send before connect rejects with its method', cdp.send('Target.getTargets'), /Target\.getTargets: devtools socket is not open/);
      const opening = rejects('socket closure before open rejects connect', cdp.connect(), /devtools socket closed/);
      MockWebSocket.last.close();
      await opening;
      check('a closed connection retains no pending command', cdp.pending.size === 0);
    }
    {
      const cdp = new profile.Cdp('ws://fixture');
      const opening = rejects('socket error before open rejects connect', cdp.connect(), /devtools socket failed: refused/);
      MockWebSocket.last.emit('error', { message: 'refused' });
      await opening;
    }
    {
      const { cdp, ws } = await connected();
      ws.readyState = 2;
      await rejects('send on a closing socket rejects', cdp.send('Target.getTargets'), /Target\.getTargets: devtools socket is not open/);
      check('send on a closing socket leaves no pending command', cdp.pending.size === 0 && ws.sent.length === 0);
      ws.readyState = MockWebSocket.OPEN;
      ws.sendError = new Error('write failed');
      await rejects('a synchronous send failure identifies the command and session', cdp.send('Runtime.evaluate', {}, 'page'), /Runtime\.evaluate \(session page\): devtools send failed: write failed/);
      check('a synchronous send failure removes its pending entry', cdp.pending.size === 0);
    }
    {
      const { cdp, ws } = await connected();
      const pending = Promise.all([
        rejects('socket error rejects a pending page command', cdp.send('Runtime.evaluate', {}, 'page'), /Runtime\.evaluate \(session page\): devtools socket failed: reset/),
        rejects('socket error rejects every pending command', cdp.send('Target.getTargets'), /Target\.getTargets: devtools socket failed: reset/),
      ]);
      ws.emit('error', { message: 'reset' });
      await pending;
      await rejects('send after a socket error rejects immediately', cdp.send('Browser.getVersion'), /Browser\.getVersion: devtools socket failed: reset/);
      check('socket errors drain pending commands', cdp.pending.size === 0);
    }
    {
      const { cdp, ws } = await connected();
      await rejects('a working connection cannot be replaced', cdp.reconnect(9222), /refusing to replace a working devtools socket/);
      ws.emit('error', { error: new Error('invalid frame') });
      check('native WebSocket errors retain their underlying diagnostic', cdp.failure.includes('invalid frame'));
      globalThis.fetch = async url => {
        check('reconnect probes only its original local browser port', url === 'http://127.0.0.1:9222/json/version');
        return { json: async () => ({ webSocketDebuggerUrl: 'ws://fixture' }) };
      };
      MockWebSocket.autoOpen = true;
      const replacement = await cdp.reconnect(9222);
      check('explicit reconnect opens a fresh transport without carrying old sessions or commands',
        replacement !== cdp && replacement.wsUrl === cdp.wsUrl && replacement.pending.size === 0
          && replacement.listeners.length === 0 && replacement.failure === '' && ws.readyState === 3);
      replacement.close();
      globalThis.fetch = async () => ({ json: async () => ({ webSocketDebuggerUrl: 'ws://different-browser' }) });
      await rejects('a restarted browser cannot replace the original test instance', cdp.reconnect(9222), /original browser is no longer running/);
      globalThis.fetch = async () => { throw new Error('connection refused'); };
      await rejects('a crashed browser still fails reconnection', cdp.reconnect(9222), /connection refused/);
      MockWebSocket.autoOpen = false;
    }
    {
      const { cdp, ws } = await connected();
      const failed = rejects('socket close identifies the interrupted page call', cdp.send('Runtime.evaluate', {}, 'page'), /Runtime\.evaluate \(session page\): devtools socket closed \(1000\): browser stopped/);
      const closing = cdp.send('Browser.close');
      ws.close();
      await failed;
      assert.deepEqual(await closing, {});
      checks++;
      check('shutdown without a Browser.close acknowledgement drains pending commands', cdp.pending.size === 0);
      await rejects('send after close rejects immediately', cdp.send('Target.getTargets'), /Target\.getTargets: devtools socket closed/);
    }
    for (const method of ['Target.detachedFromTarget', 'Inspector.detached']) {
      const { cdp, ws } = await connected();
      let delivered = false;
      cdp.on((event) => { if (event.method === method) delivered = true; });
      const failed = rejects(method + ' rejects only its session', cdp.send('Runtime.evaluate', {}, 'removed'), /Runtime\.evaluate \(session removed\): devtools session detached/);
      const unaffected = cdp.send('Runtime.evaluate', {}, 'kept');
      const event = method === 'Target.detachedFromTarget'
        ? { method, sessionId: 'parent', params: { sessionId: 'removed' } }
        : { method, sessionId: 'removed', params: { reason: 'target closed' } };
      ws.message(event);
      await failed;
      check(method + ' leaves other sessions pending and still reaches listeners', cdp.pending.size === 1 && delivered);
      ws.message({ method: 'Inspector.detached', params: { reason: 'no session supplied' } });
      check('a detach event without a session cannot reject unrelated commands', cdp.pending.size === 1);
      ws.message({ id: 2, result: { value: 'still attached' } });
      assert.deepEqual(await unaffected, { value: 'still attached' });
      checks++;
    }
  } finally { globalThis.WebSocket = originalWebSocket; globalThis.fetch = originalFetch; }
}

profile.mustFinish(checkCdpLifecycle, 'CDP transport tests').then(() => {
  console.log('[ok] browser tests finish or report interrupted calls: ' + checks + ' checks');
}).catch((error) => { console.error(error); process.exitCode = 1; });
