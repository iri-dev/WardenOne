/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/*
 * Checking a password without handing it over.
 * Run: node tools/test-pwned-password-check.js
 *
 * The feature is a range query: hash locally, send five characters of the hash,
 * get back every suffix sharing that prefix, match locally. Everything valuable
 * about it lives in the word "five". Send six and the anonymity set shrinks by a
 * factor of sixteen; send the hash and there is no anonymity at all; send the
 * password and it is not a privacy feature, it is a password form.
 *
 * So this suite is about what leaves the machine, and it runs the real lookup
 * against a stub server rather than reading the source for reassuring strings.
 *
 * There is history here. The last password checker was removed because it lived
 * in the worker behind a message kind that nothing in the interface could reach:
 * a documented feature that did not exist, and a channel a page could post hash
 * prefixes into that did. Both halves are checked.
 */
'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const POPUP_JS = fs.readFileSync(path.join(ROOT, 'popup.js'), 'utf8');
const POPUP_HTML = fs.readFileSync(path.join(ROOT, 'popup.html'), 'utf8');
const BG = fs.readFileSync(path.join(ROOT, 'background.js'), 'utf8');
const MANIFEST = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));

let pass = 0;
const failures = [];
function check(name, cond, detail) {
  if (cond) { pass++; return; }
  failures.push(name + (detail ? ' — ' + detail : ''));
}

const sha1 = (s) => crypto.createHash('sha1').update(s, 'utf8').digest('hex').toUpperCase();

/* ---- run the real click handler against a stub service ------------------- */

function loadHandler() {
  const at = POPUP_JS.indexOf("$('ss-pwned').addEventListener('click'");
  assert(at > 0, 'the password check handler is not in popup.js');
  const helpersAt = POPUP_JS.indexOf('const PWNED_PREFIX_LEN');
  assert(helpersAt > 0 && helpersAt < at, 'the helpers moved away from the handler');
  const end = POPUP_JS.indexOf("$('ss-domage')", at);
  assert(end > at, 'could not find the end of the handler');
  return POPUP_JS.slice(helpersAt, end);
}

const HANDLER = loadHandler();

/* A DOM just real enough for one button, one box and one result area. */
function world(opts) {
  const o = opts || {};
  const calls = [];
  const nodes = {};
  const mk = (id) => {
    const el = {
      id,
      value: o.password !== undefined ? o.password : '',
      textContent: '',
      disabled: false,
      style: { display: 'none', color: '' },
      children: [],
      appendChild(c) { this.children.push(c); this.textContent += (c && c.textContent) || ''; return c; },
      addEventListener(type, fn) { (this._on = this._on || {})[type] = fn; },
    };
    nodes[id] = el;
    return el;
  };
  ['ss-pwned', 'ss-pwned-input', 'ss-pwned-result'].forEach(mk);

  const sandbox = {
    $: (id) => nodes[id] || null,
    makeLine: (text) => ({ textContent: String(text) + ' ' }),
    TextEncoder,
    Uint8Array, Array, Object, String, Number, Math, JSON, Promise, Error,
    setTimeout, clearTimeout,
    AbortController,
    console,
    crypto: {
      subtle: {
        async digest(alg, bytes) {
          assert.strictEqual(alg, 'SHA-1', 'the range protocol is defined over SHA-1');
          const h = crypto.createHash('sha1').update(Buffer.from(bytes)).digest();
          return h.buffer.slice(h.byteOffset, h.byteOffset + h.byteLength);
        },
      },
    },
    async fetch(url, init) {
      calls.push({ url: String(url), init: init || {} });
      if (o.reject) throw o.reject;
      if (o.status && o.status !== 200) return { ok: false, status: o.status };
      return { ok: true, status: 200, text: async () => (o.body || '') };
    },
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(HANDLER, sandbox, { filename: 'popup.js:pwned' });
  return { nodes, calls, click: () => nodes['ss-pwned']._on.click() };
}

/* ---- what actually leaves the machine ------------------------------------ */

(async function onlyFiveCharactersOfTheHashAreSent() {
  const password = 'correct horse battery staple';
  const hash = sha1(password);
  const w = world({ password, body: 'FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF:3\n' });
  await w.click();

  check('one request is made', w.calls.length === 1, String(w.calls.length));
  const url = w.calls[0] ? w.calls[0].url : '';

  /* The load-bearing assertion. Everything else is hygiene. */
  const sent = url.split('/range/')[1] || '';
  check('exactly five characters are sent', sent.length === 5, JSON.stringify(sent));
  check('and they are the first five of the hash', sent === hash.slice(0, 5), sent + ' vs ' + hash.slice(0, 5));

  check('the password itself is never in the request', url.indexOf(password) < 0, url);
  check('the full hash is never in the request', url.indexOf(hash) < 0, url);
  /* The suffix is what identifies the password within the bucket. Sending it
     with the prefix would defeat the entire protocol while still looking like
     a range query. */
  check('the hash suffix is never in the request', url.indexOf(hash.slice(5)) < 0, url);

  const init = w.calls[0] ? w.calls[0].init : {};
  const headers = init.headers || {};
  check('the response is padded', String(headers['Add-Padding']) === 'true',
    'reply size narrows down which prefix was asked for');
  check('no cookies are sent', init.credentials === 'omit', String(init.credentials));
  check('no referrer is sent', init.referrerPolicy === 'no-referrer', String(init.referrerPolicy));
  check('the lookup can time out', !!init.signal, 'a service that accepts and never answers leaves the button dead');
}());

(async function theMatchIsMadeLocally() {
  const password = 'hunter2';
  const hash = sha1(password);
  /* A realistic bucket: the answer sits among unrelated suffixes. */
  const body = [
    'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA:12',
    hash.slice(5) + ':4823',
    'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB:7',
  ].join('\r\n');
  const w = world({ password, body });
  await w.click();
  const out = w.nodes['ss-pwned-result'].textContent;
  check('a breached password is reported as found', /Found in known breaches/.test(out), out.slice(0, 90));
  check('and the count is read from the reply', /4,823|4823/.test(out), out.slice(0, 90));
}());

(async function anAbsentPasswordIsReportedClean() {
  const w = world({ password: 'a-password-not-in-the-bucket', body: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA:12\n' });
  await w.click();
  const out = w.nodes['ss-pwned-result'].textContent;
  check('an unbreached password is reported as not found', /Not found in any known breach/.test(out), out.slice(0, 90));
  check('without claiming it is a good password', /not the same as it being a strong password/i.test(out));
}());

/* ---- failure must never read as good news -------------------------------- */

(async function aFailureIsNotAnAllClear() {
  for (const [label, opts] of [
    ['a network error', { password: 'x', reject: new Error('offline') }],
    ['a timeout', { password: 'x', reject: Object.assign(new Error('aborted'), { name: 'AbortError' }) }],
    ['a server error', { password: 'x', status: 503 }],
    ['rate limiting', { password: 'x', status: 429 }],
  ]) {
    const w = world(opts);
    await w.click();
    const out = w.nodes['ss-pwned-result'].textContent;
    check(label + ' does not read as not-found', !/Not found in any known breach/.test(out), out.slice(0, 80));
    check(label + ' leaves the button usable', w.nodes['ss-pwned'].disabled === false);
  }
}());

/* ---- the password does not outlive the click ----------------------------- */

(async function theBoxIsClearedAfterwards() {
  const w = world({ password: 'hunter2', body: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA:1\n' });
  await w.click();
  check('the password is cleared from the box', w.nodes['ss-pwned-input'].value === '',
    JSON.stringify(w.nodes['ss-pwned-input'].value));

  const failed = world({ password: 'hunter2', reject: new Error('offline') });
  await failed.click();
  check('and cleared even when the lookup failed', failed.nodes['ss-pwned-input'].value === '',
    'a failed check must not leave it sitting in the box');
}());

(async function nothingIsWrittenDown() {
  /* The result is a fact about the reader worth nobody having, including us.
     A history entry saying a breached password was checked is exactly the sort
     of thing a local log should not be carrying. */
  const at = POPUP_JS.indexOf('const PWNED_PREFIX_LEN');
  const block = POPUP_JS.slice(at, POPUP_JS.indexOf("$('ss-domage')", at));
  check('the answer is not written to storage',
    block.indexOf('storage.local.set') < 0 && block.indexOf('persistConfig') < 0);
  check('the answer is not logged to history',
    block.indexOf('queueHistory') < 0 && block.indexOf("'rg-block'") < 0);
}());

/* ---- the shape of the mistake that got the last one removed -------------- */

(function itIsReachableAndNotAlsoAChannel() {
  check('the control exists in the interface', /id="ss-pwned"/.test(POPUP_HTML),
    'the last one was removed for being documented but unreachable');
  check('the box does not remember passwords', /id="ss-pwned-input"[^>]*autocomplete="off"/.test(POPUP_HTML));
  check('the box masks what is typed', /id="ss-pwned-input"[^>]*type="password"|type="password"[^>]*id="ss-pwned-input"/.test(POPUP_HTML));

  check('no page-reachable message kind was reintroduced', !BG.includes("kind === 'breach-check'"),
    'a channel pages can post hash prefixes into');
  check('the worker does not perform the lookup', !BG.includes('api.pwnedpasswords.com'),
    'it belongs in the extension page, which no tab can reach');

  const hosts = (MANIFEST.host_permissions || []).join(' ');
  check('the host permission it needs is granted', hosts.indexOf('api.pwnedpasswords.com') >= 0);
}());

/* ---- the claim printed next to the box has to be true -------------------- */

(function wardenOneReallyDoesNotReadWhatYouType() {
  /* The box says so, so it has to hold. The keystroke guard watches the RATE of
     typing to spot a site monitoring it; if it ever starts carrying the text,
     the sentence beside this feature becomes a lie. */
  const CONTENT = fs.readFileSync(path.join(ROOT, 'content.min.js'), 'utf8');
  const at = CONTENT.indexOf('warned_keystroke_pressure');
  check('the keystroke guard still exists to be checked', at > 0);
  const block = CONTENT.slice(at, at + 400);
  check('the keystroke guard records counts, not text',
    !/value|text|content|key:/i.test(block.replace(/warned_keystroke_pressure/g, '')),
    block.slice(0, 160));
  check('the interface makes the claim next to the box',
    /does not read what you type/i.test(POPUP_HTML));
}());

process.on('exit', () => {
  if (failures.length) {
    console.error('FAIL (' + failures.length + ')');
    failures.forEach((f) => console.error('  - ' + f));
    process.exitCode = 1;
    return;
  }
  console.log('pwned password check: ' + pass + ' checks passed');
});
