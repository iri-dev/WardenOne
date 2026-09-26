/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/*
 * The XSS sink wrappers stay cheap without changing a verdict (PERF-11).
 * Run: node tools/test-xss-sink-cost.js
 *
 * Every wrapped sink (innerHTML, setAttribute, timers, navigation...) correlates its value with
 * the page's mutable sources after the native call. Three things keep that off the hot path:
 * the URL, path and window.name are re-registered only when they changed (or a static source
 * was pushed out of the list), the analysis tests containment before it walks tags and decodes
 * only a value that can decode, and a verdict is remembered per value, sink and filter for as
 * long as the source set is unchanged. Each of those is a place a stale answer could hide, so
 * this suite drives the real shipped scanner through the fake DOM of
 * tools/test-xss-behavior-guard.js and asserts: the verdicts of the paths the shortcuts touch;
 * that a remembered "clean" is forgotten the moment a new source arrives, the URL moves or the
 * name changes; that a reflected URL value is still caught after ninety-six messages have
 * evicted it; and that the cost has the shape the benchmark measured, with room to spare.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { run } = require('./test-xss-behavior-guard.js');
const bench = require('./bench-xss-sinks.js');

const ROOT = path.resolve(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'src', 'content.js'), 'utf8');

let passed = 0;
const failures = [];
function check(name, cond, detail) {
  if (cond) { passed++; return; }
  failures.push(name + (detail ? ' -- ' + (typeof detail === 'string' ? detail : JSON.stringify(detail)) : ''));
}
const PAYLOAD = '<img src=x onerror=alert(1)>';
const PAGE = 'https://app.example.com/search?q=' + encodeURIComponent(PAYLOAD) + '&ref=sidebar-widget-a';
const activities = (realm) => realm.logs.filter((e) => /^warned_potential_/.test(e.type)).length;
/* Assign through the live realm, so one document can be driven through several states. */
function assign(realm, value, tag) {
  const el = new realm.Element(tag || 'div');
  el.isConnected = true;
  el.innerHTML = value;
  return activities(realm);
}
/* Move the document's URL without going through the wrapped navigation setters: what is under
   test is the next sink call noticing the change, not the navigation sink. */
function moveUrl(realm, href) { realm.sandbox.location._href = new URL(href).href; }
/* A page whose URL carries one harmless value, so the sinks are wrapped (a page with no source
   at all installs no wrapper) but nothing matches until a source moves. */
const QUIET_PAGE = 'https://app.example.com/page?ref=sidebar-widget-a';

/* ---- 1. the shortcuts are in the source, in the shape described ------------------------- */
{
  check('the mutable-source refresh returns early when the URL is unchanged and nothing was evicted',
    /registerLocationSources=force=>\{[\s\S]*?else if\(!force\)return;/.test(SRC));
  check('window.name is re-registered only when it changed or after an eviction',
    /if\(currentName!==xssWindowNameKey\)xssWindowNameKey=currentName,[\s\S]*?else evicted&&registerXssSource\(currentName,\s*"window\.name"\)/.test(SRC));
  check('an evicted static source raises the flag', /\/\^\(\?:location\\\.\|window\\\.name\$\)\/\.test\(String\(oldest\.source\|\|""\)\)&&\(xssStaticSourcesEvicted=!0\)/.test(SRC));
  check('every add and remove moves the generation', (SRC.match(/xssSourceGeneration\+\+/g) || []).length >= 2);
  check('the memo is dropped whole when the generation moves', /xssVerdictMemoGeneration!==xssSourceGeneration&&\(xssVerdictMemo\.clear\(\)/.test(SRC));
  check('the memo is bounded in entries and characters', /XSS_VERDICT_MEMO_ENTRIES=24/.test(SRC) && /XSS_VERDICT_MEMO_CHARS=524288/.test(SRC));
  check('containment is tested before the shape walk, and decoding waits for a decodable value',
    /const decodable=\/\[%&\+\]\/\.test\(raw\)[\s\S]*?if\(!contained\(comparableRaw\)\)\{\s*if\(!decodable\)return null;[\s\S]*?if\("html"===kind&&!xssExecutableShape\(raw\)\)return null;/.test(SRC));
  check('the executable fragments are parsed once per call and shared by the candidates',
    /let fragmentSamples=null;[\s\S]*?xssCandidateInExecutableHtml\(fragmentSamples\|\|\(fragmentSamples=xssExecutableFragmentSamples\(raw,/.test(SRC));
  check('the native call still comes first in both wrapper kinds',
    /const result=real\.apply\(this,\s*args\);[\s\S]*?noteXssSink\(sinkLabel,/.test(SRC));
}

/* ---- 2. verdicts on the paths the shortcuts touch ---------------------------------------- */
{
  const r = run({ page: PAGE, sink: 'innerHTML', sinkValue: '<p>Results for</p>' + PAYLOAD });
  check('a reflected URL payload in innerHTML is still caught', activities(r) === 1, r.logs.map((l) => l.type));
  const benign = run({ page: PAGE, sink: 'innerHTML', sinkValue: bench.benignHtml(8192) });
  check('benign markup on the same page is not', activities(benign) === 0);
  /* the containment shortcut compares the raw text first; a value whose match appears only after
     decoding must still reach the decode step, as it did before */
  const decodable = run({ page: 'https://app.example.com/?cb=alert(1)%3B', sink: 'innerHTML', sinkValue: '<img src=x onerror="alert%281%29%3B">' });
  check('an attribute value that matches the URL only after decoding is still caught', activities(decodable) === 1, decodable.logs.map((l) => l.type));
  const code = run({ page: 'https://app.example.com/?cb=alert(1)%3B', sink: 'setTimeout', sinkValue: 'alert(1);' });
  check('a timer string matching the URL is still caught', activities(code) === 1, code.logs.map((l) => l.type));
  const encodedCode = run({ page: 'https://app.example.com/?cb=alert(1)%3B', sink: 'setTimeout', sinkValue: 'alert%281%29%3B' });
  check('a percent-encoded timer string is not code and stays quiet, as before', activities(encodedCode) === 0);
  const entity = run({ page: PAGE, sink: 'innerHTML', sinkValue: '<p>' + PAYLOAD.replace(/</g, '&lt;').replace(/>/g, '&gt;') + '</p>' });
  check('an entity-escaped payload is text, not a detection, as before', activities(entity) === 0);
  const plusOnly = run({ page: 'https://app.example.com/?q=hello+world+sidebar', sink: 'innerHTML', sinkValue: '<b>hello world sidebar</b>' });
  check('a value with no decodable character is compared as it is', activities(plusOnly) === 0);
  const repeated = run({ page: PAGE, sink: 'innerHTML', sinkValue: '<p>Results for</p>' + PAYLOAD, repeatSink: 25 });
  check('twenty-five identical assignments produce the same single, deduplicated finding', activities(repeated) === 1);
}

/* ---- 3. a remembered verdict is forgotten when the sources move ------------------------- */
{
  /* a clean value is assigned and remembered; then the URL fragment starts carrying it */
  const realm = run({ page: QUIET_PAGE });
  const value = '<div><img src=x onerror=alert(1)></div>';
  check('no matching source, no finding, and the verdict is now remembered', assign(realm, value) === 0 && assign(realm, value) === 0);
  moveUrl(realm, QUIET_PAGE + '#' + encodeURIComponent('<img src=x onerror=alert(1)>'));
  const after = assign(realm, value);
  check('the same value assigned after the URL changed is judged afresh and caught', after === 1, { after, logs: realm.logs.map((l) => l.type) });
}
{
  const realm = run({ page: QUIET_PAGE });
  const value = '<div><img src=x onerror=alert(1)></div>';
  check('clean before window.name changes', assign(realm, value) === 0);
  realm.sandbox.name = '<img src=x onerror=alert(1)>';
  check('window.name changing invalidates the remembered clean verdict', assign(realm, value) === 1, realm.logs.map((l) => l.type));
}
{
  const realm = run({ page: QUIET_PAGE, messages: ['harmless-message-value-here'] });
  const value = '<div><img src=x onerror=alert(1)></div>';
  check('clean while the only message is harmless', assign(realm, value) === 0);
  const msgs = run({ page: QUIET_PAGE, messages: ['harmless-message-value-here', '<img src=x onerror=alert(1)>'], sink: 'innerHTML', sinkValue: value });
  check('a message that carries the value is a source the assignment sees', activities(msgs) === 1, msgs.logs.map((l) => l.type));
}
{
  /* the memo must not outlive the URL: a value caught on one URL, clean on the next */
  const realm = run({ page: PAGE });
  const value = '<p>Results for</p>' + PAYLOAD;
  check('caught on the URL that carries the payload', assign(realm, value) === 1);
  moveUrl(realm, 'https://app.example.com/search?q=plain-words-only-here');
  const before = activities(realm);
  assign(realm, value);
  check('after the URL stops carrying it, the same value raises nothing new', activities(realm) === before, realm.logs.map((l) => l.type));
}

/* ---- 4. eviction: ninety-six messages push the URL's value out; it must come back --------- */
{
  const messages = [];
  for (let i = 0; i < 100; i++) messages.push('message-payload-number-' + i + '-<b>' + i + '</b>');
  const realm = run({ page: PAGE, messages });
  const caught = assign(realm, '<p>Results for</p>' + PAYLOAD);
  check('after a hundred message sources, the reflected URL payload is still caught', caught === 1, { caught, logs: realm.logs.map((l) => l.type) });
}

/* ---- 5. the cost has the measured shape, with room ---------------------------------------- */
{
  const CALLS = 200;
  const benignRepeated = bench.measure('benign 8 KiB', bench.benignHtml(8192), 'innerHTML', CALLS, false);
  const benignDistinct = bench.measure('benign 8 KiB', bench.benignHtml(8192), 'innerHTML', CALLS, true);
  const bigDistinct = bench.measure('benign 64 KiB', bench.benignHtml(65536), 'innerHTML', CALLS, true);
  const badRepeated = bench.measure('malicious 8 KiB', bench.maliciousHtml(8192), 'innerHTML', CALLS, false);
  const badDistinct = bench.measure('malicious 8 KiB', bench.maliciousHtml(8192), 'innerHTML', CALLS, true);
  /* Bounds are several times the measured medians (11 / 47 / 264 / 16 / 470 us on the machine
     that landed this), and each is below what the pre-fix path cost (108 / 352 / 2295 / 1326 /
     1316 us), so a return to that path fails here even on a slower machine. */
  check('a benign 8 KiB fragment assigned repeatedly costs a memo hit (median < 150 us)', benignRepeated.medianUs < 150, benignRepeated);
  check('benign 8 KiB fragments that all differ cost the containment pass, not a tag walk (median < 250 us)', benignDistinct.medianUs < 250, benignDistinct);
  check('a benign 64 KiB fragment costs well under the old tag walk (median < 1200 us)', bigDistinct.medianUs < 1200, bigDistinct);
  check('a matching fragment assigned repeatedly is analysed once (median < 150 us)', badRepeated.medianUs < 150, badRepeated);
  check('a matching 8 KiB fragment parses its fragments once per call (median < 1000 us)', badDistinct.medianUs < 1000, badDistinct);
  check('the shortcuts change no detection: repeated and distinct runs find the same', badRepeated.detections === 1 && badDistinct.detections === 1 && benignRepeated.detections === 0 && benignDistinct.detections === 0 && bigDistinct.detections === 0);
}

if (failures.length) {
  console.error('xss sink cost: ' + failures.length + ' check(s) failed, ' + passed + ' passed');
  for (const f of failures) console.error('  FAIL ' + f);
  process.exit(1);
}
console.log('xss sink cost: ' + passed + ' checks passed');
