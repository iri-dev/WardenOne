/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/*
 * Two pieces of instrumentation hygiene, both raised by the independent review.
 *
 * L22: Notification.requestPermission has two shapes -- it returns a Promise and it accepts a
 * legacy callback -- and a browser may honour both for the same call. Emitting from each path
 * independently reported one prompt twice: two log entries for one decision, and two charges
 * against the rate limit that keeps this instrumentation cheap.
 *
 * L23: every chrome.downloads callback must read chrome.runtime.lastError, or Chromium logs
 * "Unchecked runtime.lastError" for an invalid id or an externally cancelled download. The current
 * call sites all do; this pins that so the next one added cannot quietly not.
 *
 * Run: node tools/test-instrumentation-hygiene.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const PERMISSION_CHAIN = fs.readFileSync(path.join(ROOT, 'permission-chain.js'), 'utf8');
const DOWNLOADS = fs.readFileSync(path.join(ROOT, 'background-downloads.js'), 'utf8');

process.exitCode = 1;

let failed = 0;
function check(name, condition, extra) {
  if (condition) { console.log('  ok  - ' + name); return; }
  failed++;
  console.error('  FAIL - ' + name + (extra ? ' :: ' + extra : ''));
}

function liftFunction(source, name) {
  const m = source.match(new RegExp('^([ \\t]*)(?:async )?function ' + name + '\\(', 'm'));
  if (!m) throw new Error('function not found: ' + name);
  const indent = m[1];
  const end = source.indexOf('\n' + indent + '}\n', m.index);
  if (end < 0) throw new Error('function end not found: ' + name);
  return source.slice(m.index, end + indent.length + 3);
}

const settle = () => new Promise((r) => setTimeout(r, 5));

// ---------------------------------------------------------------------------
// L22 -- one outcome per permission prompt.
// ---------------------------------------------------------------------------
function loadNotificationPatch(behaviour) {
  const emits = [];
  const sandbox = {
    console, Object, String, Promise, setTimeout, clearTimeout,
    emit: (kind, action, detail) => { emits.push({ kind, action, result: detail && detail.result }); },
  };
  sandbox.window = {
    Notification: {
      // The implementation under test: which of the two mechanisms actually fire.
      requestPermission(callback) {
        if (behaviour.callback && typeof callback === 'function') {
          setTimeout(() => callback(behaviour.result), 0);
        }
        if (behaviour.promise) {
          return behaviour.reject
            ? Promise.reject(new Error('denied by policy'))
            : Promise.resolve(behaviour.result);
        }
        return undefined;
      },
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(liftFunction(PERMISSION_CHAIN, 'patchNotifications')
    + '\npatchNotifications();\nthis.__request = window.Notification.requestPermission;',
  sandbox, { filename: 'permission-chain.js' });
  return { emits, request: sandbox.__request, N: sandbox.window.Notification };
}

const outcomes = (emits) => emits.filter((e) => e.action !== 'request');

async function testNotificationEmitsOnce() {
  // The reported case: an implementation that honours BOTH mechanisms for one call.
  {
    const s = loadNotificationPatch({ promise: true, callback: true, result: 'granted' });
    let seen = null;
    const ret = s.request.call(s.N, (r) => { seen = r; });
    await ret;
    await settle();
    check('a prompt honoured by both mechanisms is recorded once',
      outcomes(s.emits).length === 1, JSON.stringify(s.emits));
    check('and it is recorded with the right outcome', outcomes(s.emits)[0].action === 'granted');
    check('the request itself is still recorded once',
      s.emits.filter((e) => e.action === 'request').length === 1);
    check('the caller still gets its callback', seen === 'granted');
  }

  // Promise only, which is what every current browser actually does.
  {
    const s = loadNotificationPatch({ promise: true, result: 'denied' });
    await s.request.call(s.N);
    await settle();
    check('a promise-only implementation still records the outcome',
      outcomes(s.emits).length === 1 && outcomes(s.emits)[0].action === 'denied',
      JSON.stringify(s.emits));
  }

  // Callback only, the legacy shape.
  {
    const s = loadNotificationPatch({ callback: true, result: 'granted' });
    s.request.call(s.N, () => {});
    await settle();
    check('a callback-only implementation still records the outcome',
      outcomes(s.emits).length === 1 && outcomes(s.emits)[0].action === 'granted',
      JSON.stringify(s.emits));
  }

  // A rejection is recorded as an error -- once, and only when nothing else already settled it.
  {
    const s = loadNotificationPatch({ promise: true, reject: true });
    let threw = false;
    try { await s.request.call(s.N); } catch (_) { threw = true; }
    await settle();
    check('a rejected prompt still rejects for the caller', threw);
    check('and the failure is recorded', outcomes(s.emits).length === 1
      && outcomes(s.emits)[0].action === 'error', JSON.stringify(s.emits));
  }

  // Both paths, one rejecting: the outcome that arrived first is the one kept, and there is
  // still exactly one.
  {
    const s = loadNotificationPatch({ promise: true, callback: true, reject: true, result: 'granted' });
    try { await s.request.call(s.N, () => {}); } catch (_) {}
    await settle();
    check('a prompt that both answers and rejects is still recorded once',
      outcomes(s.emits).length === 1, JSON.stringify(s.emits));
  }

  check('the emit-once guard is a shared flag rather than a per-path check',
    /let settled = false;/.test(PERMISSION_CHAIN) && /if \(settled\) return;/.test(PERMISSION_CHAIN));
}

// ---------------------------------------------------------------------------
// L23 -- every downloads callback consumes chrome.runtime.lastError.
// ---------------------------------------------------------------------------
function testDownloadCallbacksConsumeLastError() {
  const sites = [];
  // Both shapes: chrome.downloads.search(...) and chrome.downloads[method](...), which is how
  // pause/resume/cancel all reach the API through one wrapper. Matching only the dotted form
  // would have silently skipped the busiest call site of the three.
  const re = /chrome\.downloads(?:\.([a-zA-Z]+)|\[([a-zA-Z]+)\])\(/g;
  let m;
  while ((m = re.exec(DOWNLOADS))) {
    const method = m[1] || m[2];
    if (/^on[A-Z]/.test(method)) continue;           // event registrations take no callback
    // The call site's body: everything up to the closing `});` that ends the callback.
    const tail = DOWNLOADS.slice(m.index, m.index + 600);
    const end = tail.indexOf('});');
    sites.push({ method, body: tail.slice(0, end < 0 ? 600 : end) });
  }

  check('the downloads call sites are still findable', sites.length >= 3, sites.length + ' found');
  const missing = sites.filter((s) => !/chrome\.runtime\.lastError/.test(s.body)).map((s) => s.method);
  check('every chrome.downloads callback consumes chrome.runtime.lastError',
    missing.length === 0,
    missing.join(', ') + ' -- an invalid id or an externally cancelled download logs an unchecked error');

  // The behaviour that consuming it is FOR: an already-gone download must resolve as a failure
  // rather than throw or hang, so callers can carry on.
  {
    const state = { calls: [] };
    const sandbox = {
      Promise, Number, String, Error, console,
      chrome: {
        runtime: { lastError: null },
        downloads: {
          pause(id, cb) { state.calls.push(id); sandbox.chrome.runtime.lastError = { message: 'Invalid download id' }; cb(); sandbox.chrome.runtime.lastError = null; },
          erase(query, cb) { state.calls.push(query); sandbox.chrome.runtime.lastError = { message: 'Invalid download id' }; cb(); sandbox.chrome.runtime.lastError = null; },
          search(query, cb) { sandbox.chrome.runtime.lastError = { message: 'nope' }; cb(null); sandbox.chrome.runtime.lastError = null; },
        },
      },
    };
    vm.createContext(sandbox);
    vm.runInContext([
      liftFunction(DOWNLOADS, 'downloadApiCall'),
      liftFunction(DOWNLOADS, 'downloadErase'),
      liftFunction(DOWNLOADS, 'downloadSearch'),
    ].join('\n') + '\nthis.__api = { downloadApiCall, downloadErase, downloadSearch };',
    sandbox, { filename: 'background-downloads.js' });
    return sandbox.__api;
  }
}

async function testDownloadFailuresAreOrdinary(api) {
  const paused = await api.downloadApiCall('pause', 9999);
  check('an action on a download that is gone resolves as a failure',
    paused && paused.ok === false && /Invalid download id/.test(paused.error), JSON.stringify(paused));

  const erased = await api.downloadErase(9999);
  check('erasing one that is gone resolves the same way',
    erased && erased.ok === false && /Invalid download id/.test(erased.error), JSON.stringify(erased));

  const found = await api.downloadSearch({ id: 9999 });
  check('a failed search resolves to an empty list rather than throwing',
    Array.isArray(found) && found.length === 0, JSON.stringify(found));
}

async function main() {
  await testNotificationEmitsOnce();
  const api = testDownloadCallbacksConsumeLastError();
  await testDownloadFailuresAreOrdinary(api);

  if (failed) { console.error('\n' + failed + ' instrumentation hygiene check(s) failed'); process.exit(1); }
  console.log('\ninstrumentation reports once and never leaves an error unread');
  process.exitCode = 0;
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
