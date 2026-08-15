/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/*
 * How far can a page point the EyeShield stylesheet fetch (M40)?
 *
 * EyeShield recolours CDN-hosted stylesheets, which it cannot read from the page because of CORS.
 * So it asks the service worker to fetch them with the extension's <all_urls> permission. The
 * selection criterion is the awkward part -- collectForeignHrefs keeps precisely the sheets the
 * page was NOT allowed to read (`sheet.cssRules` throwing is the test) -- and the result is
 * injected back into document.head as a plain <style>, where the page can read it.
 *
 * Several guards make that far less alarming than it sounds, and they hold: credentials are
 * omitted, so nothing authenticated is reachable; redirects are manual and revalidated; there is
 * a timeout and a byte ceiling; and the response is re-serialised through a CSS parser, so only
 * colour declarations survive.
 *
 * Two did not hold. isStylesheetLikeContentType returned true for a MISSING Content-Type and
 * accepted text/plain -- between them most of what a small embedded HTTP server answers with. And
 * isLocalOrPrivateHost inspects the hostname STRING, so a perfectly public name that RESOLVES to
 * 192.168.x.x walks straight past it; Chrome's Private Network Access rules constrain pages, not
 * an extension worker holding <all_urls>. Refusing non-default ports removes most of that reach
 * at no cost to a real CDN, which serves stylesheets on 80/443.
 *
 * Both helpers are pure, so they are lifted and driven directly.
 *
 * Run: node tools/test-eyeshield-fetch-scope.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const BG = fs.readFileSync(path.join(ROOT, 'background.js'), 'utf8');

let failed = 0;
function check(name, condition, extra) {
  if (condition) { console.log('  ok  - ' + name); return; }
  failed++;
  console.error('  FAIL - ' + name + (extra ? ' :: ' + extra : ''));
}

function lift(name) {
  const start = BG.indexOf('function ' + name + '(');
  if (start < 0) return null;
  let depth = 0;
  for (let i = BG.indexOf('{', start); i < BG.length; i++) {
    if (BG[i] === '{') depth++;
    else if (BG[i] === '}') { depth--; if (depth === 0) return BG.slice(start, i + 1); }
  }
  throw new Error(name + ' braces unbalanced');
}

// Degrade rather than bail. isStylesheetLikeContentType predates this fix, so if only the port
// guard has gone the suite should still report WHICH content types leaked back in. A suite that
// dies on the first absent symbol tells you nothing about the rest of the surface.
const ctSrc = lift('isStylesheetLikeContentType');
const portSrc = lift('isDefaultPortHttpUrl');

const sandbox = { URL, String, console };
vm.createContext(sandbox);
vm.runInContext((ctSrc || 'function isStylesheetLikeContentType(){return true;}')
  + '\n' + (portSrc || 'function isDefaultPortHttpUrl(){return true;}')
  + '\nglobalThis.__ct=isStylesheetLikeContentType;globalThis.__port=isDefaultPortHttpUrl;', sandbox);
const ctOk = sandbox.__ct;
const portOk = sandbox.__port;

check('the content-type guard exists', !!ctSrc, 'isStylesheetLikeContentType is gone');
check('the port guard exists', !!portSrc,
  'isDefaultPortHttpUrl is gone -- non-default ports are reachable again');

// ---------------------------------------------------------------------------
// 1. Content-Type: real stylesheets in, everything else out.
// ---------------------------------------------------------------------------
{
  for (const ct of ['text/css', 'text/css; charset=utf-8', 'TEXT/CSS', 'application/x-css', 'text/x-css', 'application/vnd.ms-fontobject+css']) {
    check('accepts a stylesheet Content-Type: ' + JSON.stringify(ct), ctOk(ct) === true);
  }
  // The two that widened the reach. An unlabelled body is the common case on embedded servers.
  check('refuses a MISSING Content-Type', ctOk('') === false, 'unlabelled responses are readable again');
  check('refuses a null Content-Type', ctOk(null) === false);
  check('refuses text/plain', ctOk('text/plain') === false, 'plain-text endpoints are readable again');
  for (const ct of ['text/html', 'application/json', 'application/octet-stream', 'image/png', 'text/csv']) {
    check('refuses ' + ct, ctOk(ct) === false);
  }
}

// ---------------------------------------------------------------------------
// 2. Port: a CDN uses the default one. Anything else is, in practice, on the user's network.
// ---------------------------------------------------------------------------
{
  for (const url of ['https://cdn.example.com/a.css', 'http://cdn.example.com/a.css',
    'https://cdn.example.com:443/a.css', 'http://cdn.example.com:80/a.css']) {
    check('allows a default-port URL: ' + url, portOk(url) === true);
  }
  // Hostnames that LOOK public and resolve inward are exactly what the string-based private-host
  // test cannot see, so the port is what is left to refuse them on.
  for (const url of ['http://localtest.me:8080/a.css', 'http://router.example.com:8443/style.css',
    'http://nas.example.com:5000/a.css', 'http://dev.example.com:3000/a.css',
    'https://printer.example.com:9100/a.css']) {
    check('refuses a non-default port: ' + url, portOk(url) === false,
      'the extension can still be pointed at an intranet service');
  }
  check('refuses a URL it cannot parse', portOk('not a url') === false);
  check('refuses an empty URL', portOk('') === false);
}

// ---------------------------------------------------------------------------
// 3. The guards are actually wired into the fetch, not merely defined.
// ---------------------------------------------------------------------------
{
  const fn = lift('fetchPublicStylesheetText');
  check('the initial URL is port-checked', /!url \|\| !isDefaultPortHttpUrl\(url\)/.test(fn));
  check('each redirect target is port-checked too', /!next \|\| !isDefaultPortHttpUrl\(next\)/.test(fn),
    'a redirect could still walk onto another port');
  check('credentials are still omitted', /credentials: 'omit'/.test(fn));
  check('redirects are still manual', /redirect: 'manual'/.test(fn));
  check('the byte ceiling is still applied', /readResponseTextWithByteLimit/.test(fn));
}

if (failed) { console.error('\n' + failed + ' eyeshield-fetch-scope check(s) failed'); process.exit(1); }
console.log('\nthe page-directed stylesheet fetch reaches stylesheets, and not much else');
