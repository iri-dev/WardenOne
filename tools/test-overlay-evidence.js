/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/*
 * Where the overlay cleaner's evidence comes from.
 * Run: node tools/test-overlay-evidence.js
 *
 * Reported live: challengermode.com went blank, with its header, left rail and
 * right sidebar still standing and a "Tidied 1 overlay" chip in the corner.
 *
 * The cleaner builds one blob out of innerText + attributes + class + id, and
 * AD_SIGNAL matches the word "sponsored". Challengermode is an esports site
 * whose actual content is sponsored tournaments, so a single card reading
 * "Sponsored" made the whole content region look like an advertisement. It
 * escaped the tooHuge guard because the surrounding furniture sits outside it,
 * so the region is not ≥92% of the viewport in both directions.
 *
 * The distinction the cleaner was missing: a word in innerText says what a
 * container is ABOUT; a word in a class, id or aria-label is the author naming
 * what it IS. For anything large, only the second kind counts now. Small
 * floating widgets keep the text signal, because there the text IS the pitch
 * ("Download now", "Allow notifications") and there is no article underneath to
 * lose.
 *
 * This is the second false positive of this shape in this cleaner -- it has
 * previously removed an entire site sidebar -- so the rule is pinned rather than
 * remembered.
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SOURCE = fs.readFileSync(path.join(ROOT, 'src', 'content.js'), 'utf8');
const CONTENT = fs.readFileSync(path.join(ROOT, 'content.min.js'), 'utf8');

let pass = 0;
const failures = [];
function check(name, cond, detail) {
  if (cond) { pass++; return; }
  failures.push(name + (detail ? ' — ' + detail : ''));
}

/* The real regexes and the real rule, lifted from the engine so this suite
   cannot drift into testing its own paraphrase of them. */
function lift(name) {
  const at = SOURCE.indexOf(name + '=/');
  assert(at >= 0, 'could not find ' + name);
  const start = SOURCE.indexOf('/', at);
  let end = start + 1;
  for (; end < SOURCE.length; end++) {
    if (SOURCE[end] === '\\') { end++; continue; }
    if (SOURCE[end] === '/') break;
  }
  const flags = /^[a-z]*/.exec(SOURCE.slice(end + 1))[0];
  return new RegExp(SOURCE.slice(start + 1, end), flags);
}

const AD_SIGNAL = lift('AD_SIGNAL');
const NUISANCE = lift('NUISANCE');
const BAIT_SIGNAL = lift('BAIT_SIGNAL');

/* The size rule, lifted rather than restated.
   A first cut of this suite reimplemented the threshold here, so setting the
   engine's `bigEnoughToMatter` to false still passed every check — the suite was
   grading its own copy. Take the expression from the source and run it. */
const BIG_EXPR = (() => {
  const m = /bigEnoughToMatter=([^,]+),/.exec(SOURCE);
  assert(m, 'bigEnoughToMatter is no longer computed in src/content.js');
  return m[1];
})();

function isBigEnoughToMatter(el) {
  /* eslint-disable no-new-func */
  return !!new Function('r', 'innerWidth', 'innerHeight', 'return (' + BIG_EXPR + ');')(
    { width: el.width, height: el.height }, el.viewportWidth, el.viewportHeight);
}

/* The shipped decision, in the same shape the engine computes it. */
function strongAdEvidence(el) {
  const text = el.text || '';
  const attrs = el.attrs || '';
  const structuralBlob = attrs + ' ' + (el.className || '') + ' ' + (el.id || '');
  const blob = text + ' ' + structuralBlob;
  const src = isBigEnoughToMatter(el) ? structuralBlob : blob;
  const ad = AD_SIGNAL.test(src);
  const nuisance = NUISANCE.test(src);
  const bait = BAIT_SIGNAL.test(src);
  return ad || (bait && nuisance);
}

const VIEW = { viewportWidth: 1920, viewportHeight: 1080 };
const el = (o) => Object.assign({ className: '', id: '', attrs: '', text: '' }, VIEW, o);

// --- the reported breakage --------------------------------------------------

(function theChallengermodeShape() {
  /* A site's main content region, on a page whose subject happens to be
     sponsorship. Nothing about the container itself says advertisement. */
  const contentRegion = el({
    width: 1400, height: 800,
    className: 'app-content view-container',
    id: 'content',
    text: 'Upcoming tournaments Sponsored by Red Bull Brawlhalla 1v1 Open Join now '
      + 'Sponsored tournament series Create party YOUR TEAMS YOUR FRIENDS',
  });
  check('a content region is not removed for discussing sponsorship',
    strongAdEvidence(contentRegion) === false,
    'the page would go blank again');

  /* The same words, but the author has named the element. That is a real ad
     container and must still go. */
  const realAdSlot = el({
    width: 1400, height: 800,
    className: 'advertisement-wrapper',
    id: 'ad-slot-top',
    text: 'Upcoming tournaments Join now',
  });
  check('an element the author named as an advertisement is still removed',
    strongAdEvidence(realAdSlot) === true);
}());

(function theSidebarShapeThatWentBefore() {
  /* The earlier false positive of this same kind: a site sidebar removed because
     its text contained "notification". */
  const sidebar = el({
    width: 1000, height: 700,
    className: 'sidebar-panel',
    text: 'Notifications Subscribe to updates Newsletter signup lives here',
  });
  check('a large sidebar is not removed for containing the words',
    strongAdEvidence(sidebar) === false);
}());

// --- what must still be caught ---------------------------------------------

(function smallWidgetsKeepTheTextSignal() {
  /* Below the size threshold the text IS the pitch, and there is no article
     underneath to lose. These are the things the cleaner exists for. */
  const pushNag = el({ width: 380, height: 160, text: 'Allow notifications to subscribe for updates' });
  check('a small push-notification nag is still removed', strongAdEvidence(pushNag) === true);

  const downloadBait = el({ width: 300, height: 120, text: 'Download now to continue' });
  check('a small download-bait widget is still removed', strongAdEvidence(downloadBait) === true);

  const cookieNag = el({ width: 900, height: 200, text: 'We use cookies. Subscribe to our newsletter.' });
  check('a cookie/newsletter nag below the threshold is still removed',
    strongAdEvidence(cookieNag) === true);
}());

(function fullScreenAdsNamedAsSuchStillGo() {
  const interstitial = el({
    width: 1800, height: 900,
    className: 'sponsored-interstitial',
    text: 'Continue to the site',
  });
  check('a full-screen interstitial named sponsored is still removed',
    strongAdEvidence(interstitial) === true);

  const ariaNamed = el({
    width: 1500, height: 800,
    attrs: 'Advertisement',
    text: 'Some article text that happens to be here',
  });
  check('an aria-labelled advertisement is still removed', strongAdEvidence(ariaNamed) === true);
}());

// --- the boundary itself ----------------------------------------------------

(function theThresholdIsWhereItSays() {
  const wide = (w, h) => el({ width: w, height: h, text: 'Sponsored content here' });
  check('just under the threshold still trusts text',
    strongAdEvidence(wide(950, 320)) === true, 'below half the viewport width');
  check('at the threshold it stops trusting text',
    strongAdEvidence(wide(960, 324)) === false, 'half the width and a third the height');
  /* Tall but narrow, or wide but short, is a banner or a rail -- not the page. */
  check('a wide but short banner still trusts text',
    strongAdEvidence(wide(1800, 200)) === true);
  check('a narrow but tall rail still trusts text',
    strongAdEvidence(wide(400, 900)) === true);
}());

(function itShipped() {
  check('the rule is in the built engine', CONTENT.indexOf('structuralBlob') > 0);
  check('the large-element branch reads only structural evidence',
    /bigEnoughToMatter\?AD_SIGNAL\.test\(structuralBlob\)/.test(CONTENT.replace(/\s+/g, '')));
  check('src and build agree',
    (SOURCE.match(/structuralBlob/g) || []).length === (CONTENT.match(/structuralBlob/g) || []).length);
}());

// ---------------------------------------------------------------------------

if (failures.length) {
  console.error('FAIL (' + failures.length + ')');
  failures.forEach((f) => console.error('  - ' + f));
  process.exit(1);
}
console.log('overlay evidence: ' + pass + ' checks passed');
