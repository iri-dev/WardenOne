/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/*
 * Activity-history retention checks.
 *
 * Every history write goes through queueHistory, which is the one place that can
 * guarantee a secret never reaches storage. Callers pass whole tab URLs and
 * redirect targets, and a URL's query string is where access tokens, OAuth
 * codes, password-reset tokens and email addresses live. The history is local
 * but long-lived and exportable, so retaining those would be a real leak in a
 * tool people install for privacy.
 *
 * Run: node tools/test-history-privacy.js
 */
'use strict';

const fs = require('fs');
const vm = require('vm');

const source = fs.readFileSync('background.js', 'utf8');
const start = source.indexOf('const LOG_URL_MAX = 300;');
const end = source.indexOf('function queueHistory(entry)', start);
if (start < 0 || end <= start) throw new Error('history sanitizer source markers not found');

// sanitizeHistoryDetail depends on the prototype-key guard, which is declared further up so that
// normalizeTabBlockMessage can share it. Lift that region too rather than stubbing it: a stub would
// let the guard be deleted from background.js while these tests kept passing.
const guardStart = source.indexOf('const UNSAFE_DETAIL_KEYS = new Set(');
const guardEnd = source.indexOf('function normalizeTabBlockMessage(msg, sender)', guardStart);
if (guardStart < 0 || guardEnd <= guardStart) throw new Error('prototype-key guard source markers not found');

const context = { URL, String, Object, Array, Number, Set };
vm.createContext(context);
vm.runInContext(
  source.slice(guardStart, guardEnd)
    + '\n' + source.slice(start, end)
    + '\nthis.safeUrlForLog = safeUrlForLog;'
    + '\nthis.sanitizeHistoryDetail = sanitizeHistoryDetail;'
    + '\nthis.safeDetailAssign = safeDetailAssign;',
  context,
);
const { safeUrlForLog, sanitizeHistoryDetail, safeDetailAssign } = context;

let failed = 0;
function check(name, condition, extra) {
  if (condition) { console.log('  ok  - ' + name); return; }
  failed++;
  console.error('  FAIL - ' + name + (extra ? ' :: ' + extra : ''));
}

const SECRETS = [
  'https://site.example/callback?access_token=SECRET123',
  'https://site.example/login?code=SECRET123&state=x',
  'https://site.example/reset?reset_token=SECRET123',
  'https://site.example/signup?email=person%40example.com',
  'https://site.example/path#access_token=SECRET123',
];

for (const raw of SECRETS) {
  const out = safeUrlForLog(raw);
  check('strips secret-bearing query/fragment: ' + raw.slice(0, 46),
    !/SECRET123|person%40example|access_token|reset_token|[?#]/.test(out), 'got ' + out);
}

check('keeps scheme, host and path',
  safeUrlForLog('https://site.example/a/b?t=1') === 'https://site.example/a/b',
  'got ' + safeUrlForLog('https://site.example/a/b?t=1'));

check('keeps a bare domain rather than blanking it',
  safeUrlForLog('example.com') === 'example.com/',
  'got ' + safeUrlForLog('example.com'));

check('strips a query from a scheme-less host/path too',
  !/token/.test(safeUrlForLog('example.com/reset?token=SECRET123')),
  'got ' + safeUrlForLog('example.com/reset?token=SECRET123'));

check('empty input stays empty', safeUrlForLog('') === '' && safeUrlForLog(null) === '');

check('output is bounded', safeUrlForLog('https://e.example/' + 'a'.repeat(5000)).length <= 300);

// Details carry URLs one field over -- redirect targets, script sources.
const detail = {
  target: 'https://evil.example/grab?access_token=SECRET123',
  reason: 'redirect chain looked hostile',
  nested: { src: 'https://cdn.example/x.js?sig=SECRET123' },
  list: ['https://a.example/p?code=SECRET123', 'not a url at all'],
  count: 3,
  flag: true,
};
const clean = sanitizeHistoryDetail(detail, 0);

check('detail: top-level URL sanitized', !/SECRET123/.test(clean.target), 'got ' + clean.target);
check('detail: nested URL sanitized', !/SECRET123/.test(clean.nested.src), 'got ' + clean.nested.src);
check('detail: URL inside array sanitized', !/SECRET123/.test(clean.list[0]), 'got ' + clean.list[0]);
check('detail: non-URL string untouched', clean.reason === detail.reason);
check('detail: plain array entry untouched', clean.list[1] === 'not a url at all');
check('detail: non-string values preserved', clean.count === 3 && clean.flag === true);
check('detail: no secret survives anywhere', !/SECRET123/.test(JSON.stringify(clean)));

// queueHistory must be the choke point, so no caller can reintroduce this.
const queueBody = source.slice(source.indexOf('function queueHistory(entry)'),
  source.indexOf('function queueHistory(entry)') + 700);
check('queueHistory sanitizes url before buffering',
  /safe\.url = safeUrlForLog\(safe\.url\)/.test(queueBody));
check('queueHistory sanitizes detail before buffering',
  /safe\.detail = sanitizeHistoryDetail\(safe\.detail, 0\)/.test(queueBody));
check('queueHistory buffers the sanitized copy, not the caller entry',
  /__histBuffer\.push\(safe\)/.test(queueBody) && !/__histBuffer\.push\(entry\)/.test(queueBody));

// ---------------------------------------------------------------------------
// H11. A detail object reaches here from a content script, across a JSON boundary. JSON.parse
// creates "__proto__" as an own ENUMERABLE property, so Object.keys lists it and both a plain
// assignment and Object.assign go through [[Set]] -- which invokes the prototype setter on our
// output instead of storing a value. The damage is per-object, not global, so a global-pollution
// test can pass while this is live. That is why these assert on the RESULT object.
// ---------------------------------------------------------------------------
{
  const hostilePayload = () => JSON.parse('{"__proto__":{"pwned":true},"matched":"real"}');

  // Prototype identity is per-realm. sanitizeHistoryDetail builds its output with `{}` INSIDE the
  // vm, so that object's prototype is the vm's intrinsic Object.prototype, not this file's -- a
  // direct comparison against the host's would fail on correct code. Compare against a control the
  // same function built from a harmless input instead, which is realm-correct either way.
  const cleanControl = sanitizeHistoryDetail({ matched: 'real' }, 0);
  const expectedProto = Object.getPrototypeOf(cleanControl);

  for (const [label, build] of [
    ['sanitizeHistoryDetail', (src) => sanitizeHistoryDetail(src, 0)],
    ['safeDetailAssign', (src) => safeDetailAssign({}, src)],
  ]) {
    const out = build(hostilePayload());
    check(label + ' does not let __proto__ replace the result prototype',
      Object.getPrototypeOf(out) === Object.getPrototypeOf(build({ matched: 'real' })),
      'prototype was replaced');
    check(label + ' does not expose an inherited property from __proto__',
      out.pwned === undefined, 'out.pwned = ' + out.pwned);
    check(label + ' keeps the legitimate sibling key',
      out.matched === 'real', 'matched = ' + out.matched);
    check(label + ' drops __proto__ rather than storing it as data',
      !Object.prototype.hasOwnProperty.call(out, '__proto__'));
  }

  // constructor and prototype do not hijack the prototype chain, but a detail object carrying them
  // still has no business reaching a log, and code that reads detail.constructor would be misled.
  for (const key of ['constructor', 'prototype']) {
    const src = JSON.parse('{"' + key + '":{"pwned":true},"matched":"real"}');
    const out = sanitizeHistoryDetail(src, 0);
    check('sanitizeHistoryDetail drops ' + key,
      !Object.prototype.hasOwnProperty.call(out, key), key + ' survived');
    check('sanitizeHistoryDetail keeps siblings alongside a dropped ' + key,
      out.matched === 'real');
    check('sanitizeHistoryDetail leaves ' + key + ' meaning intact',
      out.constructor === cleanControl.constructor);
  }

  // Nested, because the sanitizer recurses and each level builds a fresh object.
  {
    const nested = JSON.parse('{"outer":{"__proto__":{"pwned":true},"keep":"yes"}}');
    const out = sanitizeHistoryDetail(nested, 0);
    check('sanitizeHistoryDetail guards nested levels too',
      Object.getPrototypeOf(out.outer) === expectedProto && out.outer.pwned === undefined,
      'nested prototype was replaced');
    check('sanitizeHistoryDetail keeps nested legitimate data',
      out.outer.keep === 'yes');
  }

  // And the separate global property, so a regression here cannot be mistaken for the other bug.
  check('no global Object.prototype pollution from any of the above',
    ({}).pwned === undefined && Object.prototype.pwned === undefined);

  // Both live call sites must actually use the guard -- fixing the helper is worthless if a caller
  // still hands a hostile object to a bare Object.assign.
  const normalizeBody = source.slice(
    source.indexOf('function normalizeTabBlockMessage(msg, sender)'),
    source.indexOf('const UNSAFE_DETAIL_KEYS') > 0
      ? source.indexOf('// Seed the counters from what Chrome is already showing')
      : undefined,
  );
  check('normalizeTabBlockMessage copies detail through the guard',
    /safeDetailAssign\(\{\}, msg\.detail\)/.test(normalizeBody)
      && !/Object\.assign\(\{\}, msg\.detail\)/.test(normalizeBody));
  check('the token-exfil detail merge also goes through the guard',
    /Object\.assign\(safeDetailAssign\(\{\}, detailObj\)/.test(normalizeBody));
}

if (failed) { console.error('\n' + failed + ' failed'); process.exit(1); }
console.log('\nhistory privacy checks passed');

// ---------------------------------------------------------------------------
// M16. The writer wedge.
//
// flushHistory takes the whole batch, empties the live buffer, and sets __histWriting. The value it
// then read back was accepted with `(x && x.wardenone_history) || []` -- no array check -- so a
// truthy non-array made unshift throw. That throw happened inside an ASYNC callback, which the
// surrounding try never covered, so the lock was never released: the batch was gone from memory and
// from session storage, and every future write returned early for the rest of the worker's life.
//
// One corrupt stored value, history dead until the extension restarted.
// ---------------------------------------------------------------------------
{
  const writerFrom = source.indexOf('function scheduleHistoryFlush()');
  const writerTo = source.indexOf('// Reset the count when a tab starts loading');
  if (writerFrom < 0 || writerTo <= writerFrom) throw new Error('history writer source markers not found');

  function runWriter(storedValue, opts) {
    const options = opts || {};
    const timers = [];
    const box = {
      __histTimer: null,
      __histWriting: false,
      __histBuffer: [{ url: 'https://a.example/', t: 1 }, { url: 'https://b.example/', t: 2 }],
      __histPersistTimer: null,
      persistCalls: 0,
      sessionRemoved: 0,
      setCalls: [],
      thrown: null,
    };
    const sandbox = {
      Object, Array, Set, String, Number, Math, JSON,
      setTimeout: (fn) => { timers.push(fn); return timers.length; },
      clearTimeout: () => {},
      persistHistBuffer() { box.persistCalls++; },
      pruneStorageIfNeeded: () => ({ catch: () => ({ finally: (f) => { f(); } }) }),
      chrome: {
        runtime: { lastError: options.getError || null },
        storage: {
          session: { remove() { box.sessionRemoved++; return { catch: () => {} }; } },
          local: {
            get(_k, cb) { cb({ wardenone_history: storedValue }); },
            set(obj, cb) {
              box.setCalls.push(obj.wardenone_history);
              sandbox.chrome.runtime.lastError = options.setError || null;
              cb();
            },
          },
        },
      },
    };
    // The module-scope history state lives in the sandbox so the lifted code mutates the same
    // bindings the assertions read.
    Object.defineProperties(sandbox, {
      __histTimer: { get: () => box.__histTimer, set: (v) => { box.__histTimer = v; }, configurable: true },
      __histWriting: { get: () => box.__histWriting, set: (v) => { box.__histWriting = v; }, configurable: true },
      __histBuffer: { get: () => box.__histBuffer, set: (v) => { box.__histBuffer = v; }, configurable: true },
      __histPersistTimer: { get: () => box.__histPersistTimer, set: (v) => { box.__histPersistTimer = v; }, configurable: true },
    });
    vm.createContext(sandbox);
    vm.runInContext(source.slice(writerFrom, writerTo) + '\nthis.__flush = flushHistory;', sandbox);
    try { sandbox.__flush(); } catch (e) { box.thrown = e; }
    return box;
  }

  for (const [label, value] of [
    ['a corrupt object', { corrupt: true }],
    ['a corrupt string', 'not-an-array'],
    ['a number', 42],
    ['a null value', null],
  ]) {
    const r = runWriter(value);
    check('M16 ' + label + ' does not wedge the writer lock',
      r.__histWriting === false, '__histWriting stayed true');
    check('M16 ' + label + ' does not lose the batch',
      r.setCalls.length === 1 ? r.setCalls[0].length === 2 : r.__histBuffer.length === 2,
      'batch was neither written nor restored');
    check('M16 ' + label + ' throws nothing out of flushHistory',
      r.thrown === null, String(r.thrown));
  }

  // A healthy array still writes, newest first, and only then drops the write-ahead copy.
  {
    const r = runWriter([{ url: 'https://old.example/', t: 0 }]);
    check('M16 a valid array still writes', r.setCalls.length === 1);
    check('M16 the batch is written newest-first ahead of existing history',
      r.setCalls[0].length === 3 && r.setCalls[0][2].url === 'https://old.example/');
    check('M16 the write-ahead copy is dropped only after the write is confirmed',
      r.sessionRemoved === 1 && r.__histWriting === false);
  }

  // A failed set must restore, unlock and re-persist -- never silently drop.
  {
    const r = runWriter([], { setError: { message: 'QUOTA_BYTES exceeded' } });
    check('M16 a failed write restores the batch', r.__histBuffer.length === 2);
    check('M16 a failed write unlocks', r.__histWriting === false);
    check('M16 a failed write re-persists the write-ahead copy', r.persistCalls >= 1);
    check('M16 a failed write does not drop the write-ahead copy', r.sessionRemoved === 0);
  }

  // The Activity Log must survive the same corrupt value.
  {
    const ui = fs.readFileSync('history.js', 'utf8');
    check('M16 the Activity Log normalises a corrupt history value',
      /Array\.isArray\(raw\)\s*\?\s*raw\s*:\s*\[\]/.test(ui)
        && !/render\(\(x && x\.wardenone_history\) \|\| \[\]\)/.test(ui));
  }
}
