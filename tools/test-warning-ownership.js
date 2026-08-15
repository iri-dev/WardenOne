/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/*
 * Can a page suppress a warning by planting an element with its id (M44)?
 *
 * Four high-stakes warnings decided whether they were already showing by asking the document:
 *
 *     if (document.getElementById('wo-cmd-warn')) return;
 *
 * content.min.js is world:MAIN, so the page answers that question. A page shipping
 * <div id="wo-cmd-warn" hidden></div> in its own markup silently suppressed the warning entirely,
 * and none of the four has a toast or badge fallback -- so nothing at all reached the user.
 *
 * The one that matters most is commandPasteGuard: a ClickFix / fake-CAPTCHA page talks the user
 * into pasting `powershell -w hidden -c iwr ...|iex` into the Run dialog, and the guard that is
 * meant to interrupt that is turned off by one line of the attacker's own HTML.
 *
 * Same defect as the full-page blockers (H15, tools/test-blocker-durability.js), so the same
 * answer: hold the node we built and ask it, not the document. __woWarn is a private registry the
 * page has no reference to, so a decoy carrying our id is simply not in it.
 *
 * Run: node tools/test-warning-ownership.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'src', 'content.js'), 'utf8');
const MIN = fs.readFileSync(path.join(ROOT, 'content.min.js'), 'utf8');

const WARNINGS = ['wo-scam-lock', 'wo-cmd-warn', 'wo-formtrap-warn', 'wo-clip-swap'];

let failed = 0;
function check(name, condition, extra) {
  if (condition) { console.log('  ok  - ' + name); return; }
  failed++;
  console.error('  FAIL - ' + name + (extra ? ' :: ' + extra : ''));
}

// ---------------------------------------------------------------------------
// 1. The registry itself, lifted from the engine rather than re-described here.
// ---------------------------------------------------------------------------
const decl = /const __woWarn=\{[\s\S]*?\n  \};/.exec(SRC);
if (!decl) throw new Error('__woWarn declaration not found in src/content.js');

const sandbox = { Map, console };
vm.createContext(sandbox);
vm.runInContext(decl[0].replace(/^const /, 'var ') + '\nglobalThis.__W=__woWarn;', sandbox);
const W = sandbox.__W;

{
  const ours = { isConnected: true };
  check('a warning that has never been shown is not "up"', W.up('wo-cmd-warn') === false);

  W.mark('wo-cmd-warn', ours);
  check('after marking, the warning reports itself up', W.up('wo-cmd-warn') === true);

  ours.isConnected = false;
  check('a warning removed from the page is no longer up, so it can be re-shown',
    W.up('wo-cmd-warn') === false, 'a removed warning would never reappear');

  // The decoy: an element the page created. It is not in the registry, so it cannot answer for us.
  check('a page-planted element carrying our id does not count as our warning',
    W.up('wo-formtrap-warn') === false, 'a decoy still suppresses the warning');

  check('warnings are tracked independently', W.up('wo-scam-lock') === false && W.up('wo-clip-swap') === false);
}

// ---------------------------------------------------------------------------
// 2. Every one of the four asks the registry, and none of them asks the document.
//    Checked in the shipped build, because that is the file the browser loads.
// ---------------------------------------------------------------------------
{
  const codeOnly = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '');
  const src = codeOnly(SRC);
  const min = codeOnly(MIN);

  for (const id of WARNINGS) {
    check(id + ' no longer asks the document whether it is showing',
      !src.includes('getElementById("' + id + '")'),
      'the decoy suppression is back');
    check(id + ' asks the private registry instead',
      src.includes('__woWarn.up("' + id + '")'));
    check(id + ' records the node it built',
      src.includes('__woWarn.mark("' + id + '"'));
    check(id + ' carries the same arrangement into the shipped build',
      min.includes('__woWarn.up("' + id + '")') && !min.includes('getElementById("' + id + '")'));
  }
}

if (failed) { console.error('\n' + failed + ' warning-ownership check(s) failed'); process.exit(1); }
console.log('\nthe warned-about page cannot suppress its own warning with a decoy');
