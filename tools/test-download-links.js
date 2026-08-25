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
 * Three rules come out of that, and this suite holds all three:
 *
 * 1. Download calls to action point straight at the rolling `WardenOne-latest.zip` asset. There is
 *    no release-page choice to get wrong, and the stable version number never enters the URL.
 *
 * 2. The rolling workflow makes `latest-build` a normal release and explicitly marks it Latest.
 *    That keeps GitHub's own /releases/latest route aligned with the asset after every passing push.
 *
 * 3. Nothing hardcodes a version number. A link to /releases/tag/v1.0.1 is correct for exactly
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
const WORKFLOW = read('.github/workflows/gate.yml');

const BARE_INDEX = 'https://github.com/iri-dev/WardenOne/releases';
const LATEST_PAGE = BARE_INDEX + '/latest';
const LATEST_ASSET = BARE_INDEX + '/download/latest-build/WardenOne-latest.zip';

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
    check('the README install step points straight at the rolling package',
      readmeInstall[0].includes(LATEST_ASSET),
      readmeInstall[0]);
  }

  const readmeBadge = /\[!\[Download latest build\][\s\S]*?\]\((https:\/\/[^)]+)\)/.exec(README);
  check('the README download badge points straight at the rolling package',
    !!readmeBadge && readmeBadge[1] === LATEST_ASSET,
    readmeBadge ? readmeBadge[1] : 'badge not found');

  const ctaLine = /<a class="btn btn-primary" href="([^"]+)"/.exec(SITE);
  check('the site download button exists', !!ctaLine);
  if (ctaLine) {
    check('the site download button points straight at the rolling package',
      ctaLine[1] === LATEST_ASSET, ctaLine[1]);
  }

  const stepLink = /<a href="([^"]+)">current build<\/a>/.exec(SITE);
  check('the site install step points straight at the rolling package',
    !!stepLink && stepLink[1] === LATEST_ASSET, stepLink ? stepLink[1] : 'link not found');

  const dl = /"downloadUrl":\s*"([^"]+)"/.exec(SITE);
  check('the structured-data downloadUrl points straight at the rolling package',
    !!dl && dl[1] === LATEST_ASSET, dl ? dl[1] : 'downloadUrl not found');
}

// ---------------------------------------------------------------------------
// 2. GitHub's own Latest route follows the rolling package too.
// ---------------------------------------------------------------------------
{
  const editLine = WORKFLOW.split(/\r?\n/).find((line) => /gh release edit latest-build/.test(line));
  check('the rolling release edit is present', !!editLine);
  if (editLine) {
    check('an existing rolling release is not left as a prerelease',
      editLine.includes('--prerelease=false'), editLine.trim());
    check('an existing rolling release is explicitly marked Latest',
      editLine.includes('--latest'), editLine.trim());
  }

  const createMatch = /gh release create latest-build[\s\S]*?\n\s*fi\b/.exec(WORKFLOW);
  check('the rolling release creation is present', !!createMatch);
  if (createMatch) {
    check('a new rolling release is explicitly marked Latest',
      /--latest\b/.test(createMatch[0]), createMatch[0].trim());
    check('a new rolling release is not created as a prerelease',
      !/--prerelease(?:\s|$)/m.test(createMatch[0]), createMatch[0].trim());
  }
}

// ---------------------------------------------------------------------------
// 3. No hardcoded version anywhere in a link.
// ---------------------------------------------------------------------------
{
  for (const [label, text] of [['README.md', README], ['site/index.html', SITE]]) {
    const pinned = /github\.com\/iri-dev\/WardenOne\/releases\/(?:tag|download)\/v?\d+\.\d+\.\d+/.exec(text);
    check('no link in ' + label + ' is pinned to one version',
      !pinned, pinned ? pinned[0] + ' goes stale the day the next release ships' : '');
  }
}

// ---------------------------------------------------------------------------
// 4. The index page is still allowed where it is genuinely an index.
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
// 5. Negative control. If these did not fail, the checks above would prove nothing.
// ---------------------------------------------------------------------------
{
  const OLD_README = '1. Download the latest `WardenOne-vX.Y.Z.zip` from the [Releases]('
    + LATEST_PAGE + ') page and unzip it.';
  check('the check would have caught the old README wording',
    !OLD_README.includes(LATEST_ASSET));

  const OLD_CTA = '<a class="btn btn-primary" href="' + LATEST_PAGE + '">';
  const oldParsed = /<a class="btn btn-primary" href="([^"]+)"/.exec(OLD_CTA);
  check('the check would have caught the old download button',
    !!oldParsed && oldParsed[1] !== LATEST_ASSET);

  check('a pinned-version link would be caught',
    /github\.com\/iri-dev\/WardenOne\/releases\/(?:tag|download)\/v?\d+\.\d+\.\d+/
      .test('see https://github.com/iri-dev/WardenOne/releases/tag/v1.0.1 for the build'));

  check('bareIndexLinks does not count /latest as bare',
    bareIndexLinks('go to ' + LATEST_PAGE + ' now').length === 0);
  check('bareIndexLinks does not count the rolling asset as bare',
    bareIndexLinks('download ' + LATEST_ASSET + ' now').length === 0);
  check('bareIndexLinks does count the index',
    bareIndexLinks('go to ' + BARE_INDEX + ' now').length === 1);
}

if (failed) { console.error('\n' + failed + ' download-link check(s) failed'); process.exit(1); }
console.log('\ndownload links point at the rolling package, GitHub marks it Latest, and no link names a version');
