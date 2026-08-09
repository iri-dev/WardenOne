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

const context = { URL, String, Object, Array, Number };
vm.createContext(context);
vm.runInContext(
  source.slice(start, end)
    + '\nthis.safeUrlForLog = safeUrlForLog;'
    + '\nthis.sanitizeHistoryDetail = sanitizeHistoryDetail;',
  context,
);
const { safeUrlForLog, sanitizeHistoryDetail } = context;

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

if (failed) { console.error('\n' + failed + ' failed'); process.exit(1); }
console.log('\nhistory privacy checks passed');
