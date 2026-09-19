/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/*
 * The tabs.onUpdated census, and the model it is reasoned from.
 * Run: node tools/test-listener-census.js
 *
 * tabs.onUpdated cannot be filtered, so every registration receives every title, favicon,
 * audible and status tick of every tab. One such event wakes a stopped worker once and is
 * delivered to every listener; a second listener adds a callback, not a wake. A comment in
 * the worker once said the opposite ("every extra listener is another wake") and a design
 * choice was measured against it. This suite pins three things so that neither the count
 * nor the model drifts again:
 *
 *   1. the number of tabs.onUpdated registrations per worker file -- a new one is a
 *      decision, made in the census note, not a side effect of a feature;
 *   2. that every listener discards, before doing any work, an event that carries nothing
 *      it reads -- the resident worker must not work on the ticks it cannot avoid;
 *   3. that the wrong model is gone from the source and from the tests, and the decided
 *      lifetime is written down where the listeners are.
 *
 * It also holds the reason the badge-reset fallback could go: webNavigation is a required
 * permission, and onBeforeNavigate resets the count before any tabs.onUpdated could.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
/* Every file the worker evaluates: background.js and whatever it importScripts, read from
   the source so a listener added to a newly imported file is counted too. */
const WORKER_FILES = ['background.js'];
for (const m of read('background.js').matchAll(/importScripts\(\s*["']([^"']+)["']/g)) {
  if (!WORKER_FILES.includes(m[1])) WORKER_FILES.push(m[1]);
}
const sources = Object.fromEntries(WORKER_FILES.map((f) => [f, read(f)]));

let pass = 0;
const failures = [];
function check(name, cond, detail) {
  if (cond) { pass++; return; }
  failures.push(name + (detail ? ' — ' + detail : ''));
}

/* ---- 1. the census ---------------------------------------------------------------- */
const REGISTRATION = /chrome\.tabs\??\.onUpdated\??\.addListener\(/g;
const EXPECTED = { 'background.js': 1, 'background-memory.js': 1, 'background-downloads.js': 1 };
const census = {};
for (const f of WORKER_FILES) {
  const n = (sources[f].match(REGISTRATION) || []).length;
  if (n) census[f] = n;
}
const sortedEntries = (o) => JSON.stringify(Object.entries(o).sort());
check('three tabs.onUpdated listeners across the worker, one per file that needs one',
  sortedEntries(census) === sortedEntries(EXPECTED), JSON.stringify(census));
const manifest = JSON.parse(read('manifest.json'));
check('the census read every script the worker loads', WORKER_FILES.length >= 6
  && WORKER_FILES.includes('background-memory.js') && WORKER_FILES.includes('background-downloads.js'), WORKER_FILES.join(','));

/* ---- 2. each listener filters on its first line ------------------------------------ */
function listenerBody(source, from) {
  const open = source.indexOf('{', source.indexOf('=>', from));
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}' && --depth === 0) return source.slice(open + 1, i);
  }
  return '';
}
function firstStatement(body) {
  return body.trim().split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('//') && !l.startsWith('/*'))[0] || '';
}
const bodies = {};
for (const f of Object.keys(EXPECTED)) {
  const at = sources[f].search(REGISTRATION);
  bodies[f] = listenerBody(sources[f], at);
}
check('the Forget-Me listener leaves on any event without a host to read',
  /^const newHost = forgetHostFromUrl\(\(tab && tab\.url\) \|\| change\.url \|\| ''\);$/.test(firstStatement(bodies['background.js']))
    && /^\s*if \(!newHost\) return;/m.test(bodies['background.js']));
check('and refreshes the menu title only on a navigation of the active tab',
  /if \(change && \(change\.url \|\| change\.status === 'complete'\) && tab && tab\.active === true\)/.test(bodies['background.js']));
check('Memory Shield marks activity on a load, a new address or audio and on nothing else',
  /^if \(change\.status === 'loading' \|\| change\.url \|\| change\.audible\) markTabActive\(tabId\);$/.test(firstStatement(bodies['background-memory.js'])),
  firstStatement(bodies['background-memory.js']));
check('Download Guard acts only on a completed load of its own review page',
  /^if \(changeInfo\.status === 'complete' && reviewIdFromUrl\(tab && \(tab\.url \|\| tab\.pendingUrl\)\)\)/.test(firstStatement(bodies['background-downloads.js'])),
  firstStatement(bodies['background-downloads.js']));

/* ---- 3. the model, in the source and in the tests ---------------------------------- */
const WRONG_MODEL = /(every|each) (extra )?listener (is another|wakes|is one more) (wake|a 760KB|worker)/i;
for (const f of WORKER_FILES) check('no worker file still says a listener is a wake: ' + f, !WRONG_MODEL.test(sources[f]));
for (const f of fs.readdirSync(path.join(ROOT, 'tools')).filter((n) => /^test-.*\.js$/.test(n) && n !== 'test-listener-census.js')) {
  const t = read(path.join('tools', f));
  check('no suite still reasons from the wrong model: ' + f, !WRONG_MODEL.test(t));
}
const bg = sources['background.js'];
check('the decided lifetime is written down at the census note',
  /one event wakes a stopped worker ONCE and is then\s+delivered to every listener/.test(bg)
    && /while any tab is loading or playing\s+media this worker stays resident/.test(bg)
    && /tools\/test-listener-census\.js pins that number/.test(bg));
check('the context-menu note no longer claims its own listener would have cost a wake',
  /A listener of its own would not have cost a worker\s+wake/.test(bg));

/* ---- the fallback that could go ---------------------------------------------------- */
check('webNavigation is a required permission, so its events are never absent',
  Array.isArray(manifest.permissions) && manifest.permissions.includes('webNavigation')
    && !(manifest.optional_permissions || []).includes('webNavigation'));
check('the badge count is reset by onBeforeNavigate for the top frame',
  /chrome\.webNavigation\?\.onBeforeNavigate\?\.addListener\(\(details\) => \{\s*if \(details\.frameId === 0\) \{[\s\S]{0,200}counts\[details\.tabId\] = 0;/.test(bg));
check('and no tabs.onUpdated listener resets it a second time',
  !/chrome\.tabs\.onUpdated\.addListener\([\s\S]{0,400}counts\[tabId\] = 0;/.test(bg));

console.log('');
if (failures.length) {
  for (const f of failures) console.log('  FAIL ' + f);
  console.log('\n' + failures.length + ' check(s) failed, ' + pass + ' passed');
  process.exit(1);
}
console.log('  ok  ' + pass + ' checks: three tabs.onUpdated listeners, each filtering first, reasoned from the right model');
