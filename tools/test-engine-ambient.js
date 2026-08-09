/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
'use strict';

/*
 * Guards tools/lib/engine-ambient.js against the engine drifting away from it.
 *
 * The lifting suites -- the ones that slice a region of src/content.js out by string marker and
 * eval it in a hand-built sandbox -- cannot see anything the engine declares in its teardown
 * preamble. engine-ambient.js supplies those helpers as shims so a lifted fragment that calls one
 * still runs. That only holds while the shim list covers what the preamble actually declares, so
 * this suite parses the preamble and fails if the engine grows a helper that has no shim.
 *
 * Without this, adding a helper produces a confusing "<name> is not defined" in whichever
 * unrelated suite happens to lift a region containing a call. With it, the failure lands here and
 * names the missing helper.
 */

const vm = require('vm');
const fs = require('fs');
const {
  declaredAmbientNames,
  shimmedNames,
  ambientSource,
  installEngineAmbient,
  enginePreamble,
} = require('./lib/engine-ambient.js');

let passed = 0;
function check(name, condition) {
  if (!condition) {
    console.error('[fail] ' + name);
    process.exit(1);
  }
  console.log('[ok] ' + name);
  passed++;
}

/* The parse has to actually find the preamble. If the engine's markers move, every check below
   would pass vacuously on an empty string, so prove it found something real first. */
const preamble = enginePreamble();
check('the engine preamble is locatable', preamble.length > 200);

const declared = declaredAmbientNames();
check('the preamble declares ambient helpers', declared.length >= 5);
check('dispose-related helpers are among them',
  declared.includes('__woKeep') && declared.includes('woOn'));

const shimmed = shimmedNames();
const missing = declared.filter((n) => !shimmed.includes(n));
if (missing.length) {
  console.error('[fail] the engine declares helpers with no shim: ' + missing.join(', '));
  console.error('       add them to SHIMS in tools/lib/engine-ambient.js, or the lifting suites');
  console.error('       will fail with "<name> is not defined" somewhere unrelated.');
  process.exit(1);
}
console.log('[ok] every declared helper has a shim (' + declared.length + ')');
passed++;

/* A shim list that parses but does not evaluate is worse than none -- it would fail inside a
   sandbox at the point of use. Evaluate the whole set and confirm each name resolves. */
const sandbox = { MutationObserver: function () {}, IntersectionObserver: function () {} };
vm.createContext(sandbox);
installEngineAmbient(sandbox);
const unresolved = declared.filter(
  (n) => vm.runInContext('typeof ' + n, sandbox) === 'undefined');
check('every shim evaluates and resolves in a sandbox', unresolved.length === 0);

/* woOn is the one shim with behaviour worth pinning: a fragment that registers a listener must
   still see it fire, or the suite lifting it tests nothing. */
const behaviour = { calls: [] };
behaviour.target = {
  addEventListener(type, fn) { behaviour.calls.push(type); fn({ type }); },
};
vm.createContext(behaviour);
installEngineAmbient(behaviour);
vm.runInContext('woOn(target,"click",function(){calls.push("fired")})', behaviour);
check('the woOn shim registers and the listener runs',
  behaviour.calls.join(',') === 'click,fired');

/* Called twice is normal -- a suite may install per sandbox in a loop. Redeclaring a const would
   throw, so the shims must not use const. */
let twice = true;
try {
  installEngineAmbient(behaviour);
} catch (_) {
  twice = false;
}
check('installing twice into one sandbox is safe', twice);
check('shims avoid const so re-install cannot throw', !/\bconst\s/.test(ambientSource()));

/* The suites that use this must keep using it. If one drops the require but keeps lifting code,
   it reverts to the fragile state silently. */
const users = fs.readdirSync('tools')
  .filter((f) => f.startsWith('test-') && f.endsWith('.js'))
  .filter((f) => fs.readFileSync('tools/' + f, 'utf8').includes('engine-ambient'));
check('the lifting suites still install the shims', users.length >= 2);

console.log('[ok] engine ambient checks passed (' + passed + ')');
