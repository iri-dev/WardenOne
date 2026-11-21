/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/* De-AMP is on by default (Round 5, 2026-11-14). AMP cache and viewer links go to the publisher's real article, and a
   canonical page that keeps sending the visitor back to AMP cannot make the tab loop.
   Run: node tools/test-deamp-default.js */
'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const BG = read('background.js'), POPUP = read('popup.js'), MIN = read('content.min.js'), SRC = read('src/content.js');
let checks = 0;
const ok = (cond, label) => { assert.ok(cond, label); checks++; };

ok(/\n  deAmp: true,/.test(BG), 'the worker default turns De-AMP on');
ok(/deAmp: true, clientHintProtection/.test(POPUP), 'the popup shows the same default');
ok(/webglDisabled:!1,deAmp:!0,/.test(MIN) && /webglDisabled:!1,\s*deAmp:!0,/.test(SRC), 'the page engine starts with De-AMP on before settings arrive');
ok(/const ONBOARDING_MAX_PRIVACY = Object\.assign\(\{\}, ONBOARDING_RECOMMENDED, \{[\s\S]*?deAmp: true,/.test(BG),
  'Maximum privacy still turns De-AMP on for people who had switched it off');

/* The loop guard, run as shipped: lift the statement from the built engine and drive it with a fake sessionStorage. */
const start = MIN.indexOf('const seenKey="__woDeAmpFrom"');
const end = MIN.indexOf('}catch(_){}', start);
ok(start > 0 && end > start, 'the built engine carries the De-AMP loop guard');
const guard = new vm.Script('(function(){' + MIN.slice(start, end) + ';return "redirect"})()');
function visit(store, href, now) {
  const sandbox = { sessionStorage: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)) },
    location: { href }, Date: { now: () => now }, String, Number };
  return guard.runInNewContext(sandbox) === 'redirect';
}
{
  const store = new Map();
  const amp = 'https://news.example/story/amp';
  ok(visit(store, amp, 1000), 'the first visit to an AMP page goes to its real article');
  ok(visit(store, amp, 4000), 'opening the same AMP article again a few seconds later still goes to the real article');
  ok(!visit(store, amp, 6000), 'a third bounce back to the same AMP page within 30 seconds stays, so the tab cannot loop');
  ok(visit(store, amp, 40000), 'after 30 seconds the same AMP page redirects again');
  ok(visit(store, 'https://news.example/other/amp', 41000), 'a different AMP page is not held back by the first one');
}

console.log('De-AMP default checks passed: ' + checks);
