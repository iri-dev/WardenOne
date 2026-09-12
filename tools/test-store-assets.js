/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/*
 * A Store screenshot is a claim about the package, and it has to be traceable to one (CWS-04).
 *
 * docs/store held seven 1280x800 frames from August: one still said WebWarden in three places,
 * one said "16 browser permissions" against a manifest declaring 19, one showed the popup
 * mid-load with a state the product no longer has. Nothing tied any of them to a capture, a
 * build or a date, so nothing could say they were stale, and Chrome treats a misleading
 * screenshot as removable metadata.
 *
 * Now every frame in that folder is generated from docs/store/candidates.json by
 * tools/build-store-assets.py, from a named capture in docs/screenshots, with its caption
 * drawn in. This suite holds the folder and the manifest to each other: no frame without an
 * entry, no entry without a frame, at most five, every one exactly Store-sized, every one
 * captioned, every controlled threat example saying so on the image, and no old branding
 * anywhere a listing could be built from.
 *
 * Run: node tools/test-store-assets.js
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const STORE = path.join(ROOT, 'docs', 'store');
const MANIFEST = JSON.parse(fs.readFileSync(path.join(STORE, 'candidates.json'), 'utf8'));
const PROMO = 'promo-440x280.png';

let failures = 0;
function check(label, condition, extra) {
  if (condition) { console.log('  ok  ' + label); return; }
  failures++;
  console.log('  FAIL ' + label + (extra ? ' :: ' + extra : ''));
}

function pngSize(file) {
  const b = fs.readFileSync(file);
  if (b.length < 24 || b.toString('ascii', 1, 4) !== 'PNG') return null;
  return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
}

/* ---- the folder and the manifest agree ------------------------------------------- */

const onDisk = fs.readdirSync(STORE).filter((f) => /\.png$/i.test(f) && f !== PROMO).sort();
const listed = (MANIFEST.screenshots || []).map((s) => s.file).sort();
check('the manifest lists at most five screenshots', listed.length >= 1 && listed.length <= 5, listed.length + ' listed');
check('every frame on disk is a manifest entry', onDisk.every((f) => listed.includes(f)),
  onDisk.filter((f) => !listed.includes(f)).join(', ') + ' -- a frame nobody can trace to a capture');
check('every manifest entry has its frame on disk', listed.every((f) => onDisk.includes(f)),
  listed.filter((f) => !onDisk.includes(f)).join(', ') + ' -- run tools/build-store-assets.py');
check('the promo tile the site uses is still there', fs.existsSync(path.join(STORE, PROMO)));

/* ---- the old frames are gone ---------------------------------------------------- */

for (const stale of ['redirect.png', 'permissions.png', 'popup.png', 'activity.png', 'network.png', 'onboarding.png', 'site-blocked.png']) {
  check('the August frame ' + stale + ' is gone', !fs.existsSync(path.join(STORE, stale)),
    'it carried WebWarden branding, a wrong permission count, or a state the product no longer has');
}

/* ---- each frame is Store-sized, sourced, and captioned --------------------------- */

const frame = MANIFEST.frame || {};
check('the frame is the Store size', frame.width === 1280 && frame.height === 800);
for (const entry of MANIFEST.screenshots || []) {
  const size = pngSize(path.join(STORE, entry.file));
  check(entry.file + ' is exactly ' + frame.width + 'x' + frame.height,
    size && size.width === frame.width && size.height === frame.height, size && (size.width + 'x' + size.height));
  check(entry.file + ' names the capture it came from', /^docs\/screenshots\/[^/]+\.png$/.test(String(entry.source || '')), entry.source);
  check(entry.file + '\'s capture exists', fs.existsSync(path.join(ROOT, String(entry.source || '').replace(/\//g, path.sep))));
  check(entry.file + ' has a caption', typeof entry.caption === 'string' && entry.caption.trim().length >= 12);
  if (entry.controlled) {
    check(entry.file + ' says on the image that it is a controlled example',
      /controlled example/i.test(entry.caption) && /(test|local)/i.test(entry.caption), entry.caption);
  }
  check(entry.file + ' carries no old branding in its caption', !/webwarden/i.test(entry.caption));
}

/* ---- the package the frames describe is recorded -------------------------------- */

const pkg = MANIFEST.package || {};
check('the manifest records the package version', pkg.version === JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8')).version,
  'manifest.json is ' + JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8')).version + ', candidates say ' + pkg.version);
check('and a commit', /^[0-9a-f]{7,40}$/.test(String(pkg.commit || '')), pkg.commit);
check('and a capture date', /^\d{4}-\d{2}-\d{2}$/.test(String(MANIFEST.captured || '')), MANIFEST.captured);
check('and says whether the tree was clean', typeof pkg.dirty === 'boolean');
if (pkg.dirty === true) {
  check('a dirty capture says it must be regenerated before submission', /[Rr]egenerate/.test(String(pkg.note || '')));
}

/* ---- exclusions are reasons, not silence ---------------------------------------- */

for (const ex of MANIFEST.excluded || []) {
  check('excluded ' + path.basename(String(ex.source || '')) + ' says why', typeof ex.why === 'string' && ex.why.length >= 20);
}
check('the popup is not a candidate while FEAT-02 and FEAT-05 are open',
  !(MANIFEST.screenshots || []).some((s) => /popup|protection-health/.test(String(s.source)))
  && (MANIFEST.excluded || []).some((e) => /FEAT-05/.test(e.why)) && (MANIFEST.excluded || []).some((e) => /FEAT-02/.test(e.why)),
  'the popup shows "Turn everything on" and "You\'re safe", both of which are open findings about the product, not the picture');

/* ---- the site shows the current build ------------------------------------------- */

const sitePopup = pngSize(path.join(ROOT, 'docs', 'popup.png'));
const capture = pngSize(path.join(ROOT, 'docs', 'screenshots', '01-popup-master-switch.png'));
check('the site\'s popup image is the current capture, not the August one',
  sitePopup && capture && sitePopup.width === capture.width && sitePopup.height === capture.height
  && fs.readFileSync(path.join(ROOT, 'docs', 'popup.png')).equals(fs.readFileSync(path.join(ROOT, 'docs', 'screenshots', '01-popup-master-switch.png'))),
  'docs/popup.png is what the landing page serves');
const site = fs.readFileSync(path.join(ROOT, 'site', 'index.html'), 'utf8');
check('and the page declares that image\'s real size',
  sitePopup && site.includes('width="' + sitePopup.width + '" height="' + sitePopup.height + '"'));
check('and does not describe a scan the image does not show', !/live per-site security scan/.test(site));

/* ---- no old branding anywhere a listing is built from --------------------------- */

for (const file of ['README.md', 'PRIVACY.md', 'site/index.html', 'popup.html', 'permissions.html', 'manifest.json', 'docs/store/candidates.json']) {
  check(file + ' carries no WebWarden branding', !/webwarden/i.test(fs.readFileSync(path.join(ROOT, file.replace(/\//g, path.sep)), 'utf8')));
}

console.log('');
if (failures) { console.log(failures + ' check(s) failed'); process.exit(1); }
console.log('all Store asset checks passed');
