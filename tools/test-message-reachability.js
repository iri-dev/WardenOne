/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/*
 * Every message the worker answers is one some surface actually sends.
 * Run: node tools/test-message-reachability.js
 *
 * Successive rewrites of the extension, permission and memory surfaces added new message names
 * without retiring the old ones, so the worker kept answering seven kinds that nothing sent:
 * list-extensions and get-extension-alerts (superseded by extension-security-report),
 * list-site-permissions (a note nobody read), reset-all-site-permissions (the sitePermissions
 * branch of clean-browser), memory-sweep-now (memory-free-ram), memory-sleep-groups (the group
 * sleeper runs from the Memory Shield alarm and never had a control), and adshield-status (a
 * popup panel that no longer exists). Each was a second place where a behaviour could be changed,
 * and a reader of the worker could not tell which of two handlers was the live one without
 * checking every sender (PI-07). Nothing noticed, because no gate asked.
 *
 * This one asks. Every `msg.kind === '...'` the worker handles must have a literal emitter in a
 * shipped surface -- a page, a content script, the bridge -- or sit on the short reviewed list of
 * kinds that are sent under a computed name. A handler with neither fails the build by name, and
 * so does a reviewed entry that turns out to have an emitter after all, so the list cannot rot.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const tracked = execSync('git ls-files', { cwd: ROOT, encoding: 'utf8' }).split(/\r?\n/).filter(Boolean);
const shipped = tracked.filter((f) => /\.(js|html)$/.test(f) && !/^(tools|site|docs)\//.test(f));
const WORKERS = shipped.filter((f) => /^background.*\.js$/.test(f));
const SURFACES = shipped.filter((f) => !WORKERS.includes(f));

/* Kinds the worker handles that are sent under a name computed at run time, or by a route this
   scan cannot see. Each entry names the sender so the next reader can check it. Empty today. */
const INTERNAL_ONLY = {
  // 'example-kind': 'sent by popup.js askWorker(kind) from a table of names',
};

let pass = 0;
const failures = [];
function check(name, cond, detail) {
  if (cond) { pass++; return; }
  failures.push(name + (detail ? ' — ' + detail : ''));
}

const handled = new Map();     // kind -> worker file
for (const f of WORKERS) {
  const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
  for (const m of src.matchAll(/msg\.kind === '([a-zA-Z0-9_-]+)'/g)) if (!handled.has(m[1])) handled.set(m[1], f);
}
const emitted = new Map();     // kind -> surfaces
for (const f of SURFACES) {
  const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
  for (const m of src.matchAll(/kind\s*:\s*['"]([a-zA-Z0-9_-]+)['"]/g)) {
    if (!emitted.has(m[1])) emitted.set(m[1], new Set());
    emitted.get(m[1]).add(f);
  }
}

check('the worker handles messages and the surfaces send them', handled.size > 50 && emitted.size > 50,
  handled.size + ' handled, ' + emitted.size + ' emitted');

const unreached = [...handled.keys()].filter((k) => !emitted.has(k) && !INTERNAL_ONLY[k]);
check('every handled kind has an emitter in a shipped surface, or a reviewed reason not to',
  unreached.length === 0, unreached.length + ' with neither: ' + unreached.join(', '));

const stale = Object.keys(INTERNAL_ONLY).filter((k) => emitted.has(k) || !handled.has(k));
check('the reviewed list holds only kinds that are handled and have no literal emitter', stale.length === 0, stale.join(', '));

/* The seven the census named, by name, so their return is caught as what it is. */
const RETIRED = ['list-extensions', 'get-extension-alerts', 'list-site-permissions', 'reset-all-site-permissions', 'memory-sweep-now', 'memory-sleep-groups', 'adshield-status'];
const back = RETIRED.filter((k) => handled.has(k));
check('the retired handlers stay retired', back.length === 0, back.join(', '));
const BG = fs.readFileSync(path.join(ROOT, 'background.js'), 'utf8');
check('their replacements are still handled and still sent',
  ['extension-security-report', 'clean-browser', 'memory-free-ram', 'scan-site-permissions'].every((k) => handled.has(k) && emitted.has(k)));
check('the group sleeper still runs from the Memory Shield alarm', /memorySweep\('alarm', cfg\); throttleInactiveTabs\(cfg\); sleepIdleGroups\(cfg\);/.test(BG));
check('the permission sweep is still reachable through the cleaner', /if \(t\.sitePermissions\) perms = await resetSensitiveSitePermissionsGlobally\(\);/.test(BG));

console.log('');
console.log('  handled ' + handled.size + ' kinds in ' + WORKERS.join(', ') + '; ' + emitted.size + ' kinds sent from ' + SURFACES.length + ' surface files');
if (failures.length) {
  for (const f of failures) console.log('  FAIL ' + f);
  console.log('\n' + failures.length + ' check(s) failed, ' + pass + ' passed');
  process.exit(1);
}
console.log('  ok  ' + pass + ' checks: every message the worker answers is one a surface sends');
