/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/*
 * Outbound requests do not introduce WardenOne, or its version, unless the API demands it.
 * Run: node tools/test-request-self-identification.js
 *
 * Every PhishTank lookup carried `X-WardenOne-Client: wardenone/<version>` -- a header PhishTank
 * neither documents nor reads (its API identifies applications by app_key and asks for a
 * descriptive User-Agent, which an extension's fetch cannot set). On a request that already
 * carries the reader's own key and the full URL, it narrowed "a client of this API" to "a
 * WardenOne 1.0.1 installation" and made readers separable by build, for nothing (DATA-03).
 *
 * The rule checked here, statically and by running the shipped request builder: no outbound
 * header names WardenOne or carries the extension version, and the one place the version does
 * travel -- Safe Browsing's `client` object, a field that API's schema requires -- says so in a
 * comment beside it. A new WO_CLIENT_VERSION use without such a comment fails the gate.
 *
 * Control: WARDENONE_BACKGROUND points at a pre-fix copy of the worker.
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const BG_PATH = process.env.WARDENONE_BACKGROUND || path.join(ROOT, 'background.js');
const BG = fs.readFileSync(BG_PATH, 'utf8');
const WORKER_FILES = fs.readdirSync(ROOT).filter((f) => /^background(-[a-z-]+)?\.js$/.test(f) || f === 'network.js').sort();
const WORKER = WORKER_FILES.map((f) => ({ file: f, text: f === 'background.js' ? BG : fs.readFileSync(path.join(ROOT, f), 'utf8') }));

let failed = 0;
let passed = 0;
function check(name, ok, extra) {
  if (ok) { passed++; console.log('  ok  - ' + name); return; }
  failed++;
  console.error('  FAIL - ' + name + (extra ? ' :: ' + extra : ''));
}
function lift(src, name) {
  const m = new RegExp('^(?:async )?function ' + name + '\\(', 'm').exec(src);
  assert(m, 'background.js no longer declares ' + name);
  let depth = 0;
  let seen = false;
  for (let i = m.index; i < src.length; i++) {
    if (src[i] === '{') { depth++; seen = true; } else if (src[i] === '}') {
      depth--;
      if (seen && depth === 0) return src.slice(m.index, i + 1);
    }
  }
  throw new Error('unterminated ' + name);
}

check('the worker files were found', WORKER_FILES.length >= 6 && WORKER_FILES.includes('background.js'), WORKER_FILES.join(', '));

/* ---- 1. statically: no header introduces WardenOne or its version ------------------------ */
{
  const offenders = [];
  for (const w of WORKER) {
    const lines = w.text.split('\n');
    lines.forEach((line, i) => {
      // A header literal: 'Name': value inside a headers object, or headers.set('Name', value).
      const literal = /['"]([A-Za-z][A-Za-z0-9-]*)['"]\s*:\s*([^,\n]+)/.exec(line);
      const set = /\.set\(\s*['"]([A-Za-z][A-Za-z0-9-]*)['"]\s*,\s*([^)\n]+)\)/.exec(line);
      const m = literal || set;
      if (!m) return;
      const name = m[1];
      const value = m[2];
      const nearHeaders = lines.slice(Math.max(0, i - 6), i + 1).join('\n');
      if (!/headers/i.test(nearHeaders)) return;
      if (/warden|^x-wo\b/i.test(name)) offenders.push(w.file + ':' + (i + 1) + ' header name ' + name);
      if (/WO_CLIENT_VERSION|getManifest\(\)\.version|wardenone\//i.test(value)) offenders.push(w.file + ':' + (i + 1) + ' header value ' + value.trim());
    });
  }
  check('no outbound header names WardenOne or carries the extension version', offenders.length === 0, offenders.join('; '));
}

/* ---- 2. every use of the version on the wire is one an API requires ---------------------- */
{
  const uses = [];
  for (const w of WORKER) {
    const lines = w.text.split('\n');
    lines.forEach((line, i) => {
      if (!/WO_CLIENT_VERSION/.test(line) || /^const WO_CLIENT_VERSION =/.test(line.trim())) return;
      const above = lines.slice(Math.max(0, i - 4), i).join('\n');
      const justified = /requir|mandatory|schema/i.test(above) && /\/\/|\/\*|^\s*\*/m.test(above);
      uses.push({ where: w.file + ':' + (i + 1), line: line.trim(), justified });
    });
  }
  check('the version travels in at most one request', uses.length <= 1, uses.map((u) => u.where).join(', '));
  for (const u of uses) {
    check('the version use at ' + u.where + ' names the API requirement that forces it, in a comment beside it', u.justified, u.line);
  }
  check('that one is the Safe Browsing client object, a field its schema requires',
    uses.length === 1 && /clientVersion: WO_CLIENT_VERSION/.test(uses[0].line) && /background\.js/.test(uses[0].where), JSON.stringify(uses));
}

/* ---- 3. the PhishTank request, run for real -------------------------------------------- */
{
  const sent = [];
  const sandbox = {
    URLSearchParams, String, Object, Number, Promise, JSON,
    PHISHTANK_ENDPOINT: 'https://checkurl.phishtank.com/checkurl/',
    EXTERNAL_REPUTATION_TIMEOUT_MS: 5000,
    WO_CLIENT_VERSION: '9.9.9',
    reputationQueryUrl: (u) => String(u),
    fetchJsonWithTimeout: async (url, init) => {
      sent.push({ url, init });
      return { ok: true, status: 200, json: { results: { in_database: false } }, headers: { get: () => null } };
    },
    phishTankChallengeText: () => '',
    console,
  };
  vm.createContext(sandbox);
  vm.runInContext(lift(BG, 'fetchPhishTankUrl') + '\nthis.__fetch = fetchPhishTankUrl;', sandbox, { filename: 'background.js:phishtank' });
  Promise.resolve(sandbox.__fetch('https://login.example/verify', 'reader-app-key')).then(() => {
    check('the lookup was sent', sent.length === 1 && /checkurl\.phishtank\.com/.test(sent[0].url));
    const headers = (sent[0] && sent[0].init && sent[0].init.headers) || {};
    const names = Object.keys(headers);
    check('it sends no X-WardenOne-* header', !names.some((n) => /warden/i.test(n)), names.join(', '));
    check('no header value names WardenOne or the version', !names.some((n) => /wardenone|9\.9\.9/i.test(String(headers[n]))), JSON.stringify(headers));
    check('the body is the URL, the format and the reader\'s own key, nothing more',
      String(sent[0].init.body) === new URLSearchParams({ url: 'https://login.example/verify', format: 'json', app_key: 'reader-app-key' }).toString(), String(sent[0].init.body));
    check('it still asks for JSON and posts a form', headers.Accept === 'application/json' && /x-www-form-urlencoded/.test(headers['Content-Type']) && sent[0].init.method === 'POST');
    check('the worker no longer builds the header at all', !/['"]X-WardenOne-Client['"]\s*:/.test(BG));

    if (failed) { console.error('\n' + failed + ' failed, ' + passed + ' passed'); process.exit(1); }
    console.log('\nrequest self-identification: ' + passed + ' checks passed -- WardenOne introduces itself to no provider that did not ask');
  }).catch((e) => { console.error(e); process.exit(1); });
}
