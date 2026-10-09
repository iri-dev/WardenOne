/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/* A browser test that waits on a call the browser never answers -- an evaluate on a page the test
   then saw torn down -- has nothing left to run, and Node exits 0 in the middle of it. On CI,
   browser-config-race.js "passed" that way without its last checks. perf-profile.js mustFinish()
   turns that exit into a failure; this proves it does, and that every browser test CI runs uses it. */
'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const profilePath = JSON.stringify(path.join(__dirname, 'perf-profile.js'));
let checks = 0;
const check = (label, ok) => { checks++; assert(ok === true, label); };

function runScript(body) {
  const script = `const profile = require(${profilePath});\n${body}`;
  return spawnSync(process.execPath, ['-e', script], { encoding: 'utf8', timeout: 20000 });
}

const hung = runScript("profile.mustFinish(() => new Promise(() => {}), 'fixture').catch(() => { process.exitCode = 1; });");
check('a test left waiting on an unanswered call fails instead of exiting 0: exit ' + hung.status, hung.status === 1);
check('and says why', /fixture stopped before it finished/.test(hung.stderr));

const finished = runScript("profile.mustFinish(async () => { await new Promise((r) => setTimeout(r, 20)); console.log('done'); }, 'fixture')"
  + ".catch(() => { process.exitCode = 1; });");
check('a test that finishes still passes: exit ' + finished.status + ' ' + finished.stderr, finished.status === 0 && /done/.test(finished.stdout));

const failing = runScript("profile.mustFinish(async () => { throw new Error('boom'); }, 'fixture').catch(() => { process.exitCode = 1; });");
check('a test that fails keeps its own failure and no extra message', failing.status === 1 && !/stopped before it finished/.test(failing.stderr));

const workflow = fs.readFileSync(path.join(root, '.github', 'workflows', 'gate.yml'), 'utf8');
const browserTests = Array.from(new Set(Array.from(workflow.matchAll(/node (tools\/browser-[\w-]+\.js)/g), (m) => m[1])));
check('the workflow still runs browser tests: ' + browserTests.length, browserTests.length >= 8);
for (const file of browserTests) {
  const source = fs.readFileSync(path.join(root, file), 'utf8');
  check(file + ' runs through mustFinish', /\bmustFinish\(run, '[\w-]+'\)/.test(source) && !/^run\(\)\.catch\(/m.test(source));
}

console.log('[ok] browser tests cannot pass by exiting early: ' + checks + ' checks');
