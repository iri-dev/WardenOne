/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/*
 * Where does "download WardenOne" actually send somebody?
 *
 * This is not a style question. The v1.0.0 release sat 171 commits behind main while its page
 * still said "download the zip below", and everyone who followed that instruction installed a
 * months-old extension believing it was current. For a security tool that is the worst kind of
 * bug, because nothing looks wrong: the extension loads, the popup opens, and the protections
 * they think they have simply are not there.
 *
 * Two rules come out of that, and this suite holds both:
 *
 * 1. Download links point at /releases/latest, never the bare /releases index. GitHub resolves
 *    /releases/latest to the newest STABLE release and skips prereleases, so it keeps working
 *    without anyone editing a version number into a link. The bare index is sorted by date with
 *    prereleases mixed in, which means the rolling development build published by the gate
 *    workflow sits at the top of it -- directly above the release people actually want.
 *
 * 2. Nothing hardcodes a version number. A link to /releases/tag/v1.0.1 is correct for exactly
 *    as long as it takes to publish v1.0.2, and then it silently becomes the same trap again.
 *
 * The index page is still fine to link to as an index -- the footer nav and the sameAs
 * provenance list both do -- so this checks the download CALLS TO ACTION specifically.
 *
 * Run: node tools/test-download-links.js
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

let failed = 0;
function check(name, condition, extra) {
  if (condition) { console.log('  ok  - ' + name); return; }
  failed++;
  console.error('  FAIL - ' + name + (extra ? ' :: ' + extra : ''));
}

const README = read('README.md');
const SITE = read('site/index.html');

const BARE_INDEX = 'https://github.com/iri-dev/WardenOne/releases';
const LATEST = BARE_INDEX + '/latest';

// A link is "bare" when it is the index and not /latest, /tag/... or anything longer.
function bareIndexLinks(text) {
  const out = [];
  const re = /https:\/\/github\.com\/iri-dev\/WardenOne\/releases(\/[A-Za-z0-9._\-/]*)?/g;
  let m;
  while ((m = re.exec(text))) if (!m[1]) out.push(m.index);
  return out;
}

// ---------------------------------------------------------------------------
// 1. The download calls to action.
// ---------------------------------------------------------------------------
{
  const readmeInstall = /^1\. Download .*$/m.exec(README);
  check('the README install step exists', !!readmeInstall);
  if (readmeInstall) {
    check('the README install step points at the current release',
      readmeInstall[0].includes(LATEST),
      readmeInstall[0]);
  }

  const ctaLine = /<a class="btn btn-primary" href="([^"]+)"/.exec(SITE);
  check('the site download button exists', !!ctaLine);
  if (ctaLine) {
    check('the site download button points at the current release',
      ctaLine[1] === LATEST, ctaLine[1]);
  }

  const stepLink = /<a href="([^"]+)">current release<\/a>/.exec(SITE);
  check('the site install step points at the current release',
    !!stepLink && stepLink[1] === LATEST, stepLink ? stepLink[1] : 'link not found');

  const dl = /"downloadUrl":\s*"([^"]+)"/.exec(SITE);
  check('the structured-data downloadUrl points at the current release',
    !!dl && dl[1] === LATEST, dl ? dl[1] : 'downloadUrl not found');
}

// ---------------------------------------------------------------------------
// 2. No hardcoded version anywhere in a link.
// ---------------------------------------------------------------------------
{
  for (const [label, text] of [['README.md', README], ['site/index.html', SITE]]) {
    const pinned = /github\.com\/iri-dev\/WardenOne\/releases\/(?:tag|download)\/v?\d+\.\d+\.\d+/.exec(text);
    check('no link in ' + label + ' is pinned to one version',
      !pinned, pinned ? pinned[0] + ' goes stale the day the next release ships' : '');
  }
}

// ---------------------------------------------------------------------------
// 3. The index page is still allowed where it is genuinely an index.
//    This is the anti-overcorrection half: if a future edit "fixed" the footer nav and the
//    provenance list too, the checks above would all still pass and nobody would notice the
//    index had stopped being linked at all.
// ---------------------------------------------------------------------------
{
  const bare = bareIndexLinks(SITE);
  check('the site still links the releases index somewhere', bare.length >= 1,
    'the footer nav and the sameAs provenance list should still point at the index');
  check('but not many times', bare.length <= 3,
    bare.length + ' bare index links -- one of them is probably meant to be a download link');
}

// ---------------------------------------------------------------------------
// 4. Negative control. If these did not fail, the checks above would prove nothing.
// ---------------------------------------------------------------------------
{
  const OLD_README = '1. Download the latest `WardenOne-vX.Y.Z.zip` from the [Releases]('
    + BARE_INDEX + ') page and unzip it.';
  check('the check would have caught the old README wording',
    !OLD_README.includes(LATEST));

  const OLD_CTA = '<a class="btn btn-primary" href="' + BARE_INDEX + '">';
  const oldParsed = /<a class="btn btn-primary" href="([^"]+)"/.exec(OLD_CTA);
  check('the check would have caught the old download button',
    !!oldParsed && oldParsed[1] !== LATEST);

  check('a pinned-version link would be caught',
    /github\.com\/iri-dev\/WardenOne\/releases\/(?:tag|download)\/v?\d+\.\d+\.\d+/
      .test('see https://github.com/iri-dev/WardenOne/releases/tag/v1.0.1 for the build'));

  check('bareIndexLinks does not count /latest as bare',
    bareIndexLinks('go to ' + LATEST + ' now').length === 0);
  check('bareIndexLinks does count the index',
    bareIndexLinks('go to ' + BARE_INDEX + ' now').length === 1);
}

if (failed) { console.error('\n' + failed + ' download-link check(s) failed'); process.exit(1); }
console.log('\ndownload links point at the current release, and none of them names a version');
