/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/*
 * Does the popup admit where the credential protections stop (M41)?
 *
 * content.min.js is declared all_frames:false, and it carries no top-frame guards of its own --
 * a grep for window.top === window returns nothing, because the manifest already guarantees it.
 * So Payment Card Guard, skimmer detection and token-exfil detection exist only in the top
 * document. They work by wrapping fetch, XMLHttpRequest, sendBeacon and form submission in the
 * realm they run in, and a child frame is a different realm with its own untouched copies.
 *
 * That is a defensible trade -- the engine is 15,000 lines and parsing it into every frame of
 * every page is a real cost, and the canonical Magecart case runs in the top frame beside the
 * checkout form. What was not defensible was the popup listing these as active shields with no
 * hint of the limit, so a user could not know it existed while an attacker reading the public
 * repository would find it in a minute.
 *
 * This suite pins the disclosure. It does NOT claim the gap is closed -- closing it means running
 * the credential-facing subset in all frames, which is scheduled work, not something a line of
 * copy achieves.
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

let failed = 0;
function check(name, condition, extra) {
  if (condition) { console.log('  ok  - ' + name); return; }
  failed++;
  console.error('  FAIL - ' + name + (extra ? ' :: ' + extra : ''));
}

// The premise. If the engine ever does run in every frame, this suite should fail loudly rather
// than keep asserting a disclosure that has become untrue.
const engineEntry = (MANIFEST.content_scripts || [])
  .find((e) => Array.isArray(e.js) && e.js.includes('content.min.js'));
check('the engine entry is still in the manifest', !!engineEntry);
check('the engine still runs in the top frame only', engineEntry && engineEntry.all_frames === false,
  'the engine now covers frames -- update or delete this suite rather than the copy');
// The engine does carry a top-frame notion -- WO_TOP -- and the M41 card originally claimed it did
// not, on the strength of a grep for `window.top === window` that the compact source never spells
// with spaces. Recorded here so the mistake is not repeated: WO_TOP exists, but it is not what
// confines the engine. The manifest is, and WO_TOP is therefore true wherever the engine runs.
check('the engine defines its top-frame flag as expected',
  /WO_TOP=window===window\.top/.test(SRC),
  'WO_TOP moved -- recheck what actually scopes the engine before trusting this suite');

// Each shield whose reach the manifest limits, and the toggle the popup shows for it.
const SHIELDS = [
  ['blockTokenExfil', 'Protect session tokens'],
  ['detectSkimmers', 'Detect &amp; block form skimmers'],
  ['paymentCardGuard', 'Payment card guard'],
];

for (const [key, label] of SHIELDS) {
  const at = POPUP.indexOf('data-key="' + key + '"');
  check(label + ' is still offered in the popup', at > 0);
  if (at <= 0) continue;
  // The description sits in the same .row, just above the toggle.
  const rowStart = POPUP.lastIndexOf('<div class="row">', at);
  const desc = POPUP.slice(rowStart, at);
  check(label + ' tells the user it does not reach embedded frames',
    /embedded frame/i.test(desc) && /out of reach/i.test(desc),
    'the shield claims cover it does not have');
}

if (failed) { console.error('\n' + failed + ' frame-scope-disclosure check(s) failed'); process.exit(1); }
console.log('\nthe popup does not claim reach the engine has not got');
