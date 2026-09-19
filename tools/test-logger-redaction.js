/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/*
 * The Network Logger keeps no secret it was not told the name of.
 * Run: node tools/test-logger-redaction.js
 *
 * The logger records every request while it is open and can export the lot as JSON -- the file
 * a reader attaches to a bug report. Its redactor used to be a denylist: a fixed list of query
 * parameter names, plus "any value over 64 characters" and "any fragment over 12". A denylist has
 * to know every secret's name and shape in advance, so it kept https://alice:secret@site/ whole,
 * kept a password-reset token that travelled in the path, and kept ?card=4111111111111111 because
 * "card" was not on the list and sixteen digits are not long -- while the page promised that
 * anything resembling a token, key, password or address was removed (M49, PRIV-09).
 *
 * The direction is reversed now, the way the Activity Centre's own URL sanitiser already works:
 * everything goes unless it is recognisably harmless. Sign-in details always go; the fragment goes
 * whole; a path segment stays only when it reads as route vocabulary, with a known file extension
 * kept so the row still says what kind of resource it was; parameter names stay and a value stays
 * only when it is a flag, a small number or a lowercase word, never under a name that says it is
 * a secret. This suite runs the card's adversarial fixtures through the real redactor and the real
 * capture path, and asserts the raw secret is in neither the ring nor the batch a page receives.
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const BG = fs.readFileSync(path.join(ROOT, 'background.js'), 'utf8');
const PAGE_JS = fs.readFileSync(path.join(ROOT, 'logger.js'), 'utf8');
const PAGE_HTML = fs.readFileSync(path.join(ROOT, 'logger.html'), 'utf8');
const README = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');

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
function grabFn(src, name) {
  const m = new RegExp('^(?:async )?function ' + name + '\\(', 'm').exec(src);
  assert(m, 'missing ' + name);
  return balanced(src, m.index);
}
const has = (name) => new RegExp('^(?:async )?function ' + name + '\\(', 'm').test(BG);
const orElse = (name, fallback) => (has(name) ? grabFn(BG, name) : fallback);
const line = (name, fallback) => { const m = new RegExp('^(?:const|let) ' + name + ' = [^\\n]+$', 'm').exec(BG); return m ? m[0] : fallback; };

const LIFTED = [
  line('LOG_URL_MAX'), line('LOG_SEGMENT_MAX'),
  /* The route-word shape the path sanitiser keeps (PRIV-08). */
  line('LOG_ROUTE_PART', "const LOG_ROUTE_PART = '';"), line('LOG_ROUTE_WORD', 'const LOG_ROUTE_WORD = /^$/;'),
  grabFn(BG, 'safeLogSegment'), grabFn(BG, 'safeLogPath'),
  line('LOG_SECRET_PARAM'),
  line('LOG_HARMLESS_VALUE', 'const LOG_HARMLESS_VALUE = /^$/;'),
  line('LOG_VALUE_MAX', 'const LOG_VALUE_MAX = 0;'),
  line('LOG_KEEP_EXTENSION', 'const LOG_KEEP_EXTENSION = /^$/;'),
  orElse('logRedactSegment', 'function logRedactSegment(s) { return s; }'),
  orElse('logRedactPath', 'function logRedactPath(p) { return p; }'),
  orElse('logRedactKey', 'function logRedactKey(k) { return k; }'),
  grabFn(BG, 'logRedactUrl'),
  /* The capture path, so the ring and the batch are checked and not just the function. */
  line('LOG_MAX'), line('LOG_RING'), line('LOG_PENDING'), line('LOG_PORTS'), line('LOG_SEQ'), line('LOG_FLUSH_TIMER'), line('LOG_DIRTY'),
  line('LOG_GENERATION', 'let LOG_GENERATION = 0;'),
  grabFn(BG, 'logHostOf'), grabFn(BG, 'logParty'), grabFn(BG, 'logPush'), grabFn(BG, 'logQueue'), grabFn(BG, 'logOnBeforeRequest'),
].join('\n');

function realm() {
  const posted = [];
  const timers = [];
  const sandbox = {
    URL, String, Number, Array, Object, Math, JSON, Map, Set, Date, RegExp, console,
    decodeURIComponent, encodeURIComponent,
    setTimeout: (fn) => { timers.push(fn); return timers.length; },
    registrableDomainBg: (h) => String(h || '').split('.').slice(-2).join('.'),
  };
  sandbox.__posted = posted;
  const ctx = vm.createContext(sandbox);
  vm.runInContext(LIFTED + "\nLOG_PORTS.add({ postMessage(m) { this.__posted.push(m); }, __posted: this.__posted });"
    + '\nthis.api = { redact: logRedactUrl, capture: logOnBeforeRequest, ring: LOG_RING, flush: () => {} };', ctx, { filename: 'logger-redaction.js' });
  return {
    redact: (u) => sandbox.api.redact(u),
    capture: (d) => sandbox.api.capture(d),
    ring: () => sandbox.api.ring,
    flush: () => { for (const t of timers.splice(0)) t(); },
    posted,
  };
}

const r = realm();
const seen = (text, secret) => String(text || '').indexOf(secret) >= 0;

(async () => {
  /* ---- the card's fixtures ------------------------------------------------------------------ */
  const FIXTURES = [
    ['sign-in details in the URL', 'https://alice:s3cretPW@site.com/inbox', ['alice', 's3cretPW']],
    ['a password-reset token in the path', 'https://site.com/reset-password/SECRET123', ['SECRET123']],
    ['a magic link', 'https://site.com/auth/magic/k9Jd2QzPa8Lm', ['k9Jd2QzPa8Lm']],
    ['a JWT in the path', 'https://api.site.com/v1/session/eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0In0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c',
      ['eyJhbGciOiJIUzI1NiJ9', 'eyJzdWIiOiIxMjM0In0', 'SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c']],
    ['a JWT in a query value', 'https://api.site.com/v1/me?jwt=eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0In0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c', ['eyJhbGciOiJIUzI1NiJ9']],
    ['an email address in a query value', 'https://site.com/subscribe?user=alice@example.com', ['alice@example.com', 'alice%40example.com']],
    ['an email address in the path', 'https://site.com/users/alice@example.com/profile', ['alice@example.com', 'alice%40example.com']],
    ['a phone number under a plain name', 'https://site.com/verify?number=4155551212', ['4155551212']],
    ['a phone number with spaces', 'https://site.com/verify?q=%2B1%20415%20555%201212', ['415 555 1212', '415%20555%201212']],
    ['a card number under an unlisted name', 'https://shop.com/pay?card=4111111111111111', ['4111111111111111']],
    ['a card number in the path', 'https://shop.com/pay/4111111111111111/confirm', ['4111111111111111']],
    ['a nineteen-digit Luhn value', 'https://shop.com/pay/6011000990139424224', ['6011000990139424224']],
    ['a short secret under an unknown name', 'https://site.com/cb?x=k3Jd9Qz1', ['k3Jd9Qz1']],
    ['a lowercase hex secret under an unknown name', 'https://site.com/cb?ref=3f9a8c2b1d', ['3f9a8c2b1d']],
    ['a mixed word-and-digits value', 'https://site.com/cb?ref=abc123def', ['abc123def']],
    ['a Unicode value', 'https://site.com/search?q=' + encodeURIComponent('пароль'), ['пароль', encodeURIComponent('пароль')]],
    ['a Unicode path', 'https://site.com/' + encodeURIComponent('секрет') + '/x', ['секрет', encodeURIComponent('секрет')]],
    ['a nested redirect carrying a token', 'https://site.com/login?next=' + encodeURIComponent('https://a.example/reset/TOKEN99'), ['TOKEN99']],
    ['an implicit-flow fragment', 'https://site.com/cb#access_token=abcDEF123&state=x', ['abcDEF123']],
    ['a short fragment', 'https://site.com/doc#secret7', ['secret7']],
    ['a token-shaped query NAME', 'https://site.com/t?AbCdEfGhIjKlMnOpQrSt=1', ['AbCdEfGhIjKlMnOpQrSt']],
    ['a percent-encoded token in the path', 'https://site.com/dl/%53%45%43%52%45%54%31%32%33', ['SECRET123', '%53%45%43']],
    ['a signed download filename', 'https://files.site.com/get/AbCdEf1234567890XyZ.pdf', ['AbCdEf1234567890XyZ']],
  ];
  for (const [label, url, secrets] of FIXTURES) {
    const out = r.redact(url);
    const leaked = secrets.filter((s) => seen(out.url, s));
    check('the redactor removes ' + label, leaked.length === 0 && out.redacted === true, JSON.stringify(out));
  }

  /* ---- and keeps what a rule needs ----------------------------------------------------------- */
  const KEPT = [
    ['a static asset with a cache-buster', 'https://cdn.site.com/static/app.js?v=3', 'https://cdn.site.com/static/app.js?v=3'],
    ['an API route with paging and a sort word', 'https://site.com/api/v2/items?page=2&sort=newest', 'https://site.com/api/v2/items?page=2&sort=newest'],
    ['a record id and a locale', 'https://site.com/orders/12345?lang=en-us&debug=true', 'https://site.com/orders/12345?lang=en-us&debug=true'],
    ['a flag with no value', 'https://site.com/feed?compact', 'https://site.com/feed?compact='],
    ['a bare host', 'https://site.com/', 'https://site.com/'],
  ];
  for (const [label, url, want] of KEPT) {
    const out = r.redact(url);
    check('keeps ' + label, out.url === want && out.redacted === false, JSON.stringify(out));
  }
  {
    const out = r.redact('https://files.site.com/get/AbCdEf1234567890XyZ.pdf');
    check('a redacted filename keeps its extension, so the row still says what it was', out.url === 'https://files.site.com/get/*.pdf', out.url);
    const hashed = r.redact('https://cdn.site.com/assets/app.3f9a8c2b1d7e6f5a4b.js');
    check('a hashed asset name reads as a wildcard with its extension', hashed.url === 'https://cdn.site.com/assets/*.js', hashed.url);
    const reset = r.redact('https://site.com/reset-password/SECRET123?utm_source=mail');
    check('the route survives around the token, and a harmless parameter with it', reset.url === 'https://site.com/reset-password/*?utm_source=mail', reset.url);
    const named = r.redact('https://site.com/x?pin=1234&page=3');
    check('a harmless-looking value under a secret name is still removed', named.url === 'https://site.com/x?pin=[removed]&page=3', named.url);
    const secretKey = r.redact('https://site.com/t?AbCdEfGhIjKlMnOpQrSt=1');
    check('a token-shaped parameter name is replaced, not kept', /\?\[removed\]=1$/.test(secretKey.url), secretKey.url);
    const anchored = r.redact('https://site.com/doc#top');
    check('a fragment is removed whole -- that is where implicit-flow tokens travel', anchored.url === 'https://site.com/doc#[removed]' && anchored.redacted === true, anchored.url);
    const junk = r.redact('not a url at all ' + 'x'.repeat(600));
    check('an unparseable URL is withheld rather than stored raw', junk.url === '[removed]' && junk.redacted === true, junk.url);
  }

  /* ---- the capture path: the ring and the batch hold only the redacted form ------------------- */
  {
    const before = r.ring().length;
    for (const [, url] of FIXTURES) {
      r.capture({ requestId: String(Math.random()), url, method: 'GET', type: 'xmlhttprequest', tabId: 3, initiator: 'https://site.com' });
    }
    r.flush();
    const ringText = JSON.stringify(r.ring().slice(before));
    const batchText = JSON.stringify(r.posted);
    const leaked = [];
    for (const [label, , secrets] of FIXTURES) for (const s of secrets) if (seen(ringText, s) || seen(batchText, s)) leaked.push(label + ':' + s);
    check('no fixture secret reaches the ring or the batch a logger page receives', leaked.length === 0 && r.posted.length >= 1, leaked.join(', ').slice(0, 200));
    check('every captured row is marked as redacted', r.ring().slice(before).every((e) => e.redacted === true));
    check('the row keeps host, base and page as hostnames only', r.ring().slice(before).every((e) => /^[a-z0-9.-]*$/.test(e.host) && /^[a-z0-9.-]*$/.test(e.base) && /^[a-z0-9.-]*$/.test(e.page)));
  }

  /* ---- the wiring and the words ---------------------------------------------------------------- */
  check('redaction runs before the entry is stored, and the stored url is the redacted one',
    /const red = logRedactUrl\(d\.url\);[\s\S]{0,400}url: red\.url,/.test(BG));
  check('the export writes the stored url and nothing rawer', /party: e\.party, page: e\.page, url: e\.url, rule: e\.rule/.test(PAGE_JS) && !/d\.url|rawUrl|originalUrl/.test(PAGE_JS));
  check('the page says what is kept rather than promising to recognise every secret',
    /Sign-in details, query values, the fragment and any part of a path that is not plain route vocabulary are removed/.test(PAGE_HTML)
      && !/Anything that looks like a token, key, password or address is replaced/.test(PAGE_HTML));
  check('the README makes the same promise',
    /Sign-in details, query values, the fragment and any part of a path that is not plain route vocabulary are removed/.test(README)
      && !/Token-, key-, password- and address-like values become/.test(README));
  check('a path rule built from a redacted path says its wildcard is a wildcard', /redacted part of the path is a wildcard/.test(PAGE_JS));

  finished = true;
  console.log('');
  if (failures.length) {
    for (const f of failures) console.log('  FAIL ' + f);
    console.log('\n' + failures.length + ' check(s) failed, ' + pass + ' passed');
    process.exit(1);
  }
  process.exitCode = 0;
  console.log('  ok  ' + pass + ' checks: the logger keeps the route and the parameter names, and nothing that could be a secret');
})().catch((e) => { finished = true; console.error(e); process.exit(1); });
