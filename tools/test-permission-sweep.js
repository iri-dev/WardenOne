/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/*
 * Does the site-permission sweep actually run (M-privacy-cleaner)?
 *
 * Camera, microphone and location grants pile up the way consent cookies do, so the Privacy
 * cleaner offers to hand them all back to "ask". contentSettings cannot enumerate which sites hold
 * a grant -- that is a Chrome limitation the list-site-permissions handler already records -- but
 * it can clear a type, and that is the useful half.
 *
 * This suite exists because the first version of that sweep PARSED PERFECTLY and failed on every
 * click. It was declared inside the message listener and read two consts declared further down the
 * same function, so calling it from the clean-browser branch above them threw ReferenceError before
 * it executed a line. A syntax check cannot see that, and neither can reading it. Only running it
 * can. So this suite runs it, against the Chrome shapes that matter:
 *
 *   - every content-setting type available
 *   - a realistic Chrome, where several types are simply not exposed to extensions
 *   - one type erroring while the rest succeed
 *   - contentSettings missing altogether
 *
 * Run: node tools/test-permission-sweep.js
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

const from = BG.indexOf('const SWEEPABLE_SITE_PERMISSIONS');
const to = BG.indexOf('const SAFE_BROWSING_BYPASS_KEY');
check('the sweep is declared at module scope', from >= 0 && to > from,
  'if it moved back inside the message listener it will throw on every click again');
if (from < 0 || to <= from) { process.exit(1); }

// The bug this suite is named for: the sweep must not depend on bindings that live inside the
// message listener, because the branch that calls it runs earlier in that same function.
{
  const body = BG.slice(from, to);
  check('the sweep does not read SITE_PERMISSION_TYPES', !body.includes('SITE_PERMISSION_TYPES'),
    'that const is declared inside the listener, below the caller');
  check('the sweep does not read contentSettingApi', !body.includes('contentSettingApi'),
    'same problem: declared inside the listener, below the caller');
}

function sweepWith(contentSettings) {
  const sandbox = {
    console, Promise, setTimeout, clearTimeout, Object, Array,
    CONTENT_SETTING_SCOPE: 'regular',
    chrome: { runtime: { lastError: null }, contentSettings },
  };
  vm.createContext(sandbox);
  vm.runInContext(BG.slice(from, to) + '\nglobalThis.__go = resetSensitiveSitePermissionsGlobally;', sandbox);
  return sandbox.__go();
}
const okType = () => ({ clear: (opts, cb) => cb() });

(async () => {
  // -------------------------------------------------------------------------
  // 1. It runs at all, and reports what it cleared.
  // -------------------------------------------------------------------------
  {
    const r = await sweepWith({
      camera: okType(), microphone: okType(), location: okType(), notifications: okType(),
      clipboard: okType(), automaticDownloads: okType(), midiSysex: okType(),
    });
    check('every available permission type is reset', r.reset.length === 7, JSON.stringify(r));
    check('nothing is reported as failed', r.failed.length === 0);
    check('camera is among them', r.reset.some((x) => /camera/i.test(x)));
  }

  // -------------------------------------------------------------------------
  // 2. A realistic Chrome. Several of these types are not exposed to extensions, and an absent
  //    type is not a failure -- there is simply nothing to clear.
  // -------------------------------------------------------------------------
  {
    const r = await sweepWith({
      camera: okType(), microphone: okType(), location: okType(),
      notifications: okType(), automaticDownloads: okType(),
    });
    check('the types that exist are still reset', r.reset.length === 5, JSON.stringify(r));
    check('the absent ones are reported as unsupported, not failed',
      r.unsupported.length === 2 && r.failed.length === 0, JSON.stringify(r));
  }

  // -------------------------------------------------------------------------
  // 3. One type erroring must not stop the others.
  // -------------------------------------------------------------------------
  {
    const cs = { camera: okType(), location: okType(), notifications: okType(), automaticDownloads: okType() };
    const sandbox = {
      console, Promise, setTimeout, clearTimeout, Object, Array,
      CONTENT_SETTING_SCOPE: 'regular',
      chrome: { runtime: { lastError: null }, contentSettings: cs },
    };
    cs.microphone = { clear: (opts, cb) => { sandbox.chrome.runtime.lastError = { message: 'denied' }; cb(); sandbox.chrome.runtime.lastError = null; } };
    vm.createContext(sandbox);
    vm.runInContext(BG.slice(from, to) + '\nglobalThis.__go = resetSensitiveSitePermissionsGlobally;', sandbox);
    const r = await sandbox.__go();
    check('a failing type is recorded as failed', r.failed.some((x) => /microphone/i.test(x)), JSON.stringify(r));
    check('and the rest are still reset', r.reset.length === 4, JSON.stringify(r));
  }

  // -------------------------------------------------------------------------
  // 4. No contentSettings at all: report honestly, do not throw.
  // -------------------------------------------------------------------------
  {
    const r = await sweepWith(undefined);
    check('a browser without contentSettings does not throw', !!r);
    check('and nothing is claimed to have been reset', r.reset.length === 0, JSON.stringify(r));
  }

  if (failed) { console.error('\n' + failed + ' permission-sweep check(s) failed'); process.exit(1); }
  console.log('\nthe site-permission sweep runs, and says honestly what it could and could not reset');
})().catch((e) => { console.error('permission-sweep suite threw: ' + e.message); process.exit(1); });
