/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/*
 * The activity log forgets on a clock, and keeps less of a path.
 * Run: node tools/test-history-retention.js
 *
 * The Activity Centre's history kept its last 200 events for as long as the profile lived: a
 * count cap and no time cap, so a quiet month left a security-event trail from the month before
 * sitting in storage, while the notification copy of the same events expired after 30 days. And
 * its path sanitiser, written to keep route words and blank tokens, kept two shapes that are
 * identifiers as often as they are routes: any run of digits, however long, and short runs that
 * mix letters and digits -- an order number, an account number, a document id (PRIV-08).
 *
 * Now the history store has the same 30-day retention as the notifications, applied on every
 * write, on browser start and on the daily alarm, and the page ignores an entry past it even
 * before the worker has pruned; a digit run of nine or more is blanked, and a segment mixing
 * letters and digits without a separator is blanked unless it is a word with a small number on
 * the end (v2, oauth2). This suite runs the real writer, the real sanitiser and the real pruner
 * against a fake store and clock, with the card's fixtures: numeric ids, short tokens, account
 * names, nested URL objects, and the two copies of one event.
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const BG = fs.readFileSync(path.join(ROOT, 'background.js'), 'utf8');
const HISTORY_JS = fs.readFileSync(path.join(ROOT, 'history.js'), 'utf8');
const HISTORY_HTML = fs.readFileSync(path.join(ROOT, 'history.html'), 'utf8');
const PRIVACY = fs.readFileSync(path.join(ROOT, 'PRIVACY.md'), 'utf8');

let pass = 0;
const failures = [];
function check(name, cond, detail) {
  if (cond) { pass++; return; }
  failures.push(name + (detail ? ' — ' + detail : ''));
}
let finished = false;
process.exitCode = 1;
process.on('exit', () => { if (!finished) console.log('  FAIL the suite stopped before it finished'); });

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
const orElse = (name, fallback) => (has(name) ? grabFn(name) : fallback);
const line = (name, fallback) => { const m = new RegExp('^(?:const|let) ' + name + ' = [^\\n]+$', 'm').exec(BG); return m ? m[0] : fallback; };
const constSet = (name) => { const i = BG.indexOf('const ' + name + ' = new Set(['); assert(i >= 0, 'missing ' + name); return BG.slice(i, BG.indexOf(']);', i) + 3); };

const LIFTED = [
  line('LOG_URL_MAX'), line('LOG_SEGMENT_MAX'),
  line('LOG_ROUTE_PART', "const LOG_ROUTE_PART = '';"), line('LOG_ROUTE_WORD', 'const LOG_ROUTE_WORD = /^$/;'),
  line('HISTORY_MAX', 'const HISTORY_MAX = 200;'), line('HISTORY_RETENTION_MS', 'const HISTORY_RETENTION_MS = Infinity;'),
  constSet('UNSAFE_DETAIL_KEYS'),
  grabFn('safeLogSegment'), grabFn('safeLogPath'), grabFn('safeUrlForLog'), grabFn('sanitizeHistoryDetail'),
  orElse('pruneHistoryEntries', 'function pruneHistoryEntries(hist) { const h = Array.isArray(hist) ? hist.slice() : []; if (h.length > 200) h.length = 200; return h; }'),
  orElse('pruneHistoryStore', 'async function pruneHistoryStore() { return false; }'),
  'let __histBuffer = []; let __histTimer = null; let __histWriting = false; let __histPersistTimer = null; let __histRecoveryDone = true;',
  'const INCOGNITO_CONTEXT = false;',
  grabFn('persistHistBufferNow'), grabFn('persistHistBuffer'), grabFn('queueHistory'), grabFn('scheduleHistoryFlush'), grabFn('flushHistory'),
].join('\n');

function realm() {
  const state = { clock: Date.UTC(2026, 8, 19, 12, 0, 0), local: {}, session: {}, notified: [], timers: [], timerId: 0, sets: 0 };
  const clone = (v) => JSON.parse(JSON.stringify(v));
  class FakeDate extends Date { static now() { return state.clock; } }
  const sandbox = {
    console: { warn() {}, log() {} }, Promise, Object, Array, String, Number, Boolean, Set, Map, JSON, Math, RegExp, Error, URL,
    Date: FakeDate, decodeURIComponent, encodeURIComponent,
    setTimeout: (fn, ms) => { const id = ++state.timerId; state.timers.push({ id, fn, ms }); return id; },
    clearTimeout: (id) => { state.timers = state.timers.filter((t) => t.id !== id); },
    chrome: {
      runtime: { lastError: null },
      storage: {
        local: {
          get: (key, cb) => cb(state.local[key] === undefined ? {} : { [key]: clone(state.local[key]) }),
          set: (items, cb) => { state.sets++; Object.assign(state.local, clone(items)); cb && cb(); },
        },
        session: {
          get: (key, cb) => cb({}),
          set: async (items) => { Object.assign(state.session, clone(items)); },
          remove: async (key) => { delete state.session[key]; },
        },
      },
    },
    localGet: (key) => new Promise((r) => sandbox.chrome.storage.local.get(key, r)),
    localSet: (items) => new Promise((r) => sandbox.chrome.storage.local.set(items, r)),
    recordWardenNotification: (entry) => { state.notified.push(clone(entry)); },
    pruneStorageIfNeeded: async () => {},
  };
  const ctx = vm.createContext(sandbox);
  vm.runInContext(LIFTED + '\nthis.api = { queueHistory, flushHistory, pruneHistoryStore, pruneHistoryEntries, safeUrlForLog, safeLogSegment, sanitizeHistoryDetail };', ctx, { filename: 'history-retention.js' });
  const fire = async () => { for (let round = 0; round < 6; round++) { const due = state.timers.splice(0); for (const t of due) t.fn(); for (let i = 0; i < 6; i++) await new Promise((r) => setImmediate(r)); } };
  return { state, api: sandbox.api, fire, stored: () => state.local.wardenone_history || [] };
}
const DAY = 24 * 60 * 60 * 1000;

(async () => {
  /* ---- the path sanitiser, on the shapes the card named ---------------------------------------- */
  {
    const r = realm();
    const seg = (s) => r.api.safeLogSegment(s);
    const CASES = [
      ['a record id stays', '12345', '12345'],
      ['an eight-digit id stays', '20260919', '20260919'],
      ['a nine-digit number is an account or a phone, and goes', '415555121', '*'],
      ['a card number goes', '4111111111111111', '*'],
      ['a short token mixing letters and digits goes', 'x7k2p9', '*'],
      ['an order token goes', 'ord7f3k2', '*'],
      ['a hex fragment goes', '3f9a8c2b1d', '*'],
      ['a route word stays', 'reset-password', 'reset-password'],
      ['a versioned route stays', 'v2', 'v2'],
      ['oauth2 stays', 'oauth2', 'oauth2'],
      ['a locale stays', 'en-us', 'en-us'],
      ['a slug with a year stays', 'my-post-2024', 'my-post-2024'],
      ['a filename stays', 'bootstrap.min.css', 'bootstrap.min.css'],
      ['a hashed filename goes', 'app.3f9a8c2b1d7e6f5a4b.js', '*'],
      ['a token after a separator goes', 'id-7f3k2p9x', '*'],
      ['upper case goes, as before', 'SECRET123', '*'],
      ['an address goes, as before', 'alice@example.com', '*'],
      ['a long unbroken run goes, as before', 'abcdefghijklmnopq', '*'],
      ['a percent-encoded token is judged decoded', '%53%45%43%52%45%54', '*'],
    ];
    for (const [label, input, want] of CASES) check(label, seg(input) === want, JSON.stringify(input) + ' -> ' + JSON.stringify(seg(input)));
    /* A plain word cannot be told from a name; the card asked, and this is the honest answer. */
    check('a lowercase name reads as a route word and stays -- host and category are the retained context', seg('alice') === 'alice');
    const url = r.api.safeUrlForLog('https://shop.example/orders/123456789012/receipt/ord7f3k2?token=abc#x');
    check('a logged URL keeps scheme, host and route and nothing else', url === 'https://shop.example/orders/*/receipt/*', url);
    const nested = r.api.sanitizeHistoryDetail({ target: 'https://a.example/reset/SECRET1?code=9', chain: ['https://b.example/dl/x7k2p9', 'plain text'], nested: { deeper: 'https://c.example/users/alice/t/ord7f3k2' } }, 0);
    check('nested URL objects in a detail are sanitised at every level',
      nested.target === 'https://a.example/reset/*' && nested.chain[0] === 'https://b.example/dl/*' && nested.chain[1] === 'plain text' && nested.nested.deeper === 'https://c.example/users/alice/t/*',
      JSON.stringify(nested));
  }

  /* ---- retention on write ------------------------------------------------------------------------ */
  {
    const r = realm();
    const push = (type, host, daysAgo) => {
      r.state.clock = Date.UTC(2026, 8, 19, 12, 0, 0) - daysAgo * DAY;
      r.api.queueHistory({ type, detail: { matched: host }, url: 'https://' + host + '/orders/123456789012', at: r.state.clock });
    };
    /* A store as the old writer left it: a year-old event and a forty-day-old one, never aged. */
    const now = Date.UTC(2026, 8, 19, 12, 0, 0);
    r.state.local.wardenone_history = [
      { type: 'blocked_tracker', detail: { matched: 'stale.example' }, url: 'https://stale.example/', at: now - 40 * DAY },
      { type: 'blocked_forced_redirect', detail: { matched: 'old.example' }, url: 'https://old.example/', at: now - 365 * DAY },
    ];
    push('blocked_grabber', 'fresh.example', 0); await r.fire();
    const hosts = r.stored().map((e) => e.detail.matched);
    check('a write prunes what is past the retention: the year-old and the 40-day-old entries are gone, the new one stays',
      hosts.join(',') === 'fresh.example', hosts.join(','));
    check('and the retention is the notifications\' thirty days', r.api.pruneHistoryEntries([{ at: r.state.clock - 29 * DAY }, { at: r.state.clock - 31 * DAY }], r.state.clock).length === 1);
    check('the stored URL is the sanitised one', r.stored()[0].url === 'https://fresh.example/orders/*', r.stored()[0].url);
    check('and the notification copy was handed the same sanitised entry', r.state.notified.length === 1 && r.state.notified[0].url === 'https://fresh.example/orders/*', JSON.stringify(r.state.notified[0]));
  }
  /* ---- retention without a new event -------------------------------------------------------------- */
  {
    const r = realm();
    r.state.local.wardenone_history = [
      { type: 'blocked_x', url: 'https://a.example/', at: r.state.clock - 2 * DAY },
      { type: 'blocked_y', url: 'https://b.example/', at: r.state.clock - 45 * DAY },
      { type: 'blocked_z', url: 'https://c.example/' },
    ];
    const changed = await r.api.pruneHistoryStore('startup');
    check('a start or a daily alarm prunes the store with no event needed', changed === true && r.stored().length === 1 && r.stored()[0].type === 'blocked_x', JSON.stringify(r.stored()));
    check('an entry with no time is treated as expired, not kept forever', r.stored().every((e) => Number.isFinite(e.at)));
    const sets = r.state.sets;
    const again = await r.api.pruneHistoryStore('alarm');
    check('and does not write when there is nothing to prune', again === false && r.state.sets === sets);
  }
  /* ---- the count cap still holds ----------------------------------------------------------------- */
  {
    const r = realm();
    const many = [];
    for (let i = 0; i < 250; i++) many.push({ type: 'blocked_n', url: 'https://n.example/', at: r.state.clock - i * 1000 });
    const kept = r.api.pruneHistoryEntries(many, r.state.clock);
    check('the store still holds at most HISTORY_MAX entries, the newest', kept.length === 200 && kept[0].at === r.state.clock);
  }

  /* ---- the words ---------------------------------------------------------------------------------- */
  check('the page reads the retention as the worker keeps it', /HISTORY_RETENTION_MS/.test(HISTORY_JS) && /Date\.now\(\) - Number\(e && e\.at\)/.test(HISTORY_JS));
  check('the page says how long it keeps events', /30 days/.test(HISTORY_HTML) && /Last 200 events/.test(HISTORY_HTML));
  check('the privacy policy says what is kept, for how long, and how to clear it',
    /security events WardenOne itself acted on, not the pages\s+you visited/.test(PRIVACY) && /30 days/.test(PRIVACY) && /Clear history/.test(PRIVACY));
  check('the writer prunes by time before it caps by count', /const kept = pruneHistoryEntries\(hist, Date\.now\(\)\);/.test(BG) && !/if \(hist\.length > 200\) hist\.length = 200;/.test(BG));
  check('the pruner runs on browser start and on the daily alarm', /pruneHistoryStore\('startup'\)/.test(BG) && /pruneHistoryStore\('alarm'\)/.test(BG));

  finished = true;
  console.log('');
  if (failures.length) {
    for (const f of failures) console.log('  FAIL ' + f);
    console.log('\n' + failures.length + ' check(s) failed, ' + pass + ' passed');
    process.exit(1);
  }
  process.exitCode = 0;
  console.log('  ok  ' + pass + ' checks: the activity log keeps thirty days of route-shaped events, and both copies expire together');
})().catch((e) => { finished = true; console.error(e); process.exit(1); });
