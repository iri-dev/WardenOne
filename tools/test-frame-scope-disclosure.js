/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/*
 * Does the compact credential layer close the embedded-frame gap (M41)?
 *
 * content.min.js deliberately remains top-frame-only. Loading the whole engine in every frame is
 * not proportionate, but leaving a child realm's fetch, XHR, beacon and form APIs untouched is not
 * acceptable either. anti-redirect.js already has the required MAIN/all-frames/about:blank reach,
 * so it now carries a bounded credential-only layer for child frames.
 *
 * This suite pins that architecture and keeps the popup honest about the deliberately lighter
 * frame analysis. Runtime blocking behaviour is exercised by test-frame-credential-guard.js.
 *
 * Run: node tools/test-frame-scope-disclosure.js
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const POPUP = fs.readFileSync(path.join(ROOT, 'popup.html'), 'utf8');
const MANIFEST = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
const SRC = fs.readFileSync(path.join(ROOT, 'src', 'content.js'), 'utf8');
const FRAME_GUARD = fs.readFileSync(path.join(ROOT, 'anti-redirect.js'), 'utf8');

let failed = 0;
function check(name, condition, extra) {
  if (condition) { console.log('  ok  - ' + name); return; }
  failed++;
  console.error('  FAIL - ' + name + (extra ? ' :: ' + extra : ''));
}

// Keep the expensive engine scoped to the top document.
const engineEntry = (MANIFEST.content_scripts || [])
  .find((e) => Array.isArray(e.js) && e.js.includes('content.min.js'));
check('the engine entry is still in the manifest', !!engineEntry);
check('the engine still runs in the top frame only', engineEntry && engineEntry.all_frames === false,
  'do not pay the full-engine parse/runtime cost in every frame');
check('the engine defines its top-frame flag as expected',
  /WO_TOP=window===window\.top/.test(SRC),
  'WO_TOP moved -- recheck what actually scopes the engine before trusting this suite');

// The compact layer must run in the page realm of normal and inherited-origin child frames.
const frameEntry = (MANIFEST.content_scripts || [])
  .find((e) => Array.isArray(e.js) && e.js.includes('anti-redirect.js'));
check('the frame credential carrier is declared', !!frameEntry);
check('the frame credential carrier runs in MAIN world', frameEntry && frameEntry.world === 'MAIN');
check('the frame credential carrier runs in every frame', frameEntry && frameEntry.all_frames === true);
check('the frame credential carrier reaches inherited-origin frames',
  frameEntry && frameEntry.match_origin_as_fallback === true && frameEntry.match_about_blank === true);
check('the compact guard is installed only for child frames',
  /function installCredentialFrameGuard\(\)[\s\S]*?if \(TOP_FRAME\) return;/.test(FRAME_GUARD));
for (const surface of ['fetch', 'XMLHttpRequest', 'sendBeacon', 'WebSocket', 'HTMLFormElement']) {
  check('the frame guard covers ' + surface, FRAME_GUARD.includes(surface));
}

// Each affected toggle must independently control its corresponding frame check.
const SHIELDS = [
  ['blockTokenExfil', 'Protect session tokens'],
  ['detectSkimmers', 'Detect &amp; block form skimmers'],
  ['paymentCardGuard', 'Payment card guard'],
];

for (const [key, label] of SHIELDS) {
  const at = POPUP.indexOf('data-key="' + key + '"');
  check(label + ' is still offered in the popup', at > 0);
  check(label + ' is consulted by the frame guard', FRAME_GUARD.includes("credentialFrameEnabled('" + key + "')"));
  if (at <= 0) continue;
  const rowStart = POPUP.lastIndexOf('<div class="row">', at);
  const desc = POPUP.slice(rowStart, at);
  check(label + ' now describes embedded-frame coverage', /embedded frame/i.test(desc));
  check(label + ' no longer claims embedded frames are out of reach', !/out of reach/i.test(desc));
}

if (failed) { console.error('\n' + failed + ' frame-scope-disclosure check(s) failed'); process.exit(1); }
console.log('\nthe compact credential guard closes the disclosed frame scope gap');
