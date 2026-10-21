/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/* Check download links resolve to the intended published package and match documented release channels.
   Run: node tools/test-download-links.js */
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
/* The website is built from site/: the page bodies in site/src/pages and the shell, with its
   structured data, in site/build.js. A download link can sit on any of them. */
const SITE_PAGES = fs.readdirSync(path.join(ROOT, 'site', 'src', 'pages')).filter((f) => f.endsWith('.html'))
  .map((f) => ['site/src/pages/' + f, read('site/src/pages/' + f)]);
const SITE_BUILD = read('site/build.js');
const SITE_SURFACES = SITE_PAGES.concat([['site/build.js', SITE_BUILD]]);
const SITE = SITE_SURFACES.map(([, text]) => text).join('\n');
const DOWNLOAD_PAGE = read('site/src/pages/download.html');
const WORKFLOW = read('.github/workflows/gate.yml');

const BARE_INDEX = 'https://github.com/iri-dev/WardenOne/releases';
const LATEST_PAGE = BARE_INDEX + '/latest';
const LATEST_ASSET = BARE_INDEX + '/latest/download/WardenOne-latest.zip';

// A link is "bare" when it is the index and not /latest, /tag/... or anything longer.
function bareIndexLinks(text) {
  const out = [];
  const re = /https:\/\/github\.com\/iri-dev\/WardenOne\/releases(\/[A-Za-z0-9._\-/]*)?/g;
  let m;
  while ((m = re.exec(text))) if (!m[1]) out.push(m.index);
  return out;
}

// Release links that are not the rolling ZIP, its checksum, the Latest page or the bare index.
function oddReleaseLinks(text) {
  const allowed = new Set([LATEST_ASSET, LATEST_ASSET + '.sha256', LATEST_PAGE, BARE_INDEX]);
  return [...text.matchAll(/https:\/\/github\.com\/iri-dev\/WardenOne\/releases[^\s"'<>)`]*/g)]
    .map((m) => m[0]).filter((url) => !allowed.has(url));
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

  const ctaLine = /<a class="button button-primary" href="([^"]+)"/.exec(DOWNLOAD_PAGE);
  check('the site download button exists', !!ctaLine);
  if (ctaLine) {
    check('the site download button points straight at the rolling package',
      ctaLine[1] === LATEST_ASSET, ctaLine[1]);
  }

  check('the site install step sends readers to that button for the rolling package',
    /<h3>Download the official ZIP\.<\/h3><p>[^<]*button above[^<]*<code>WardenOne-latest\.zip<\/code>/.test(DOWNLOAD_PAGE));

  /* Every link into the releases, on every page: the rolling ZIP, its checksum, the Latest
     release page or the bare index (held to a count below). A tag or a versioned asset is the
     stale-download trap again, wherever it sits. */
  const releaseLinks = (SITE.match(/https:\/\/github\.com\/iri-dev\/WardenOne\/releases/g) || []).length;
  const odd = oddReleaseLinks(SITE);
  check('every release link on the site is the rolling ZIP, its checksum, the Latest page or the index',
    releaseLinks > 0 && odd.length === 0, odd.join(', '));

  const dl = /downloadUrl:\s*'([^']+)'/.exec(SITE_BUILD);
  check('the structured-data downloadUrl points straight at the rolling package',
    !!dl && dl[1] === LATEST_ASSET, dl ? dl[1] : 'downloadUrl not found');
}

// ---------------------------------------------------------------------------
// 2. GitHub's own Latest route follows the rolling package too.
// ---------------------------------------------------------------------------
{
  const editLine = WORKFLOW.split(/\r?\n/).find((line) => /gh release edit "\$BUILD_TAG"/.test(line));
  check('the commit release publish step is present', !!editLine);
  if (editLine) {
    check('the complete release is published and explicitly marked Latest',
      editLine.includes('--draft=false') && editLine.includes('--latest'), editLine.trim());
    check('the GitHub sidebar names the current release WardenOne Latest',
      editLine.includes('--title "WardenOne Latest"'), editLine.trim());
  }

  const createMatch = /gh release create "\$BUILD_TAG"[\s\S]*?\n\s*fi\b/.exec(WORKFLOW);
  check('the commit release creation is present', !!createMatch);
  if (createMatch) {
    check('a new release is a draft tied to the exact source commit',
      /--target "\$GITHUB_SHA"/.test(createMatch[0]) && /--draft\b/.test(createMatch[0]), createMatch[0].trim());
    check('a draft keeps its commit in the release title until publication',
      /--title "WardenOne Build \$\(git rev-parse --short HEAD\)"/.test(createMatch[0]));
  }
  check('older rolling releases are removed only after the verified build becomes Latest',
    /test "\$\(gh release view --json tagName --jq \.tagName\)" = "\$BUILD_TAG"[\s\S]*?for OLD_TAG in \$\(gh release list --limit 1000[\s\S]*?\[ "\$OLD_TAG" != "\$BUILD_TAG" \] && \[\[ "\$OLD_TAG" =~ \^build-\[0-9a-f\]\{40\}\$ \]\][\s\S]*?gh release delete "\$OLD_TAG" --cleanup-tag --yes/.test(WORKFLOW));
}

// ---------------------------------------------------------------------------
// 3. A complete commit release publishes the digest and provenance of its bytes.
// ---------------------------------------------------------------------------
{
  const rolling = WORKFLOW.split(/\n  rolling-build:/)[1] || '';
  const job = (id) => (WORKFLOW.split(new RegExp('\\n  ' + id + ':\\n'))[1] || '').split(/\n  [\w-]+:\n/)[0];
  const browser = job('browser-popup');
  check('the real popup runs in Edge on a Windows runner',
    /runs-on: windows-2025/.test(browser)
      && /WARDENONE_HEADLESS: '1'/.test(browser)
      && /run: node tools\/browser-popup-regression\.js/.test(browser));
  const settings = job('browser-settings');
  check('the Settings page runs in Edge on a Windows runner, every suite',
    /runs-on: windows-2025/.test(settings)
      && (settings.match(/WARDENONE_HEADLESS: '1'/g) || []).length === 16
      && /run: node tools\/browser-settings-data\.js/.test(settings)
      && /run: node tools\/browser-settings-arrange\.js/.test(settings)
      && /run: node tools\/browser-config-race\.js/.test(settings)
      && /run: node tools\/browser-audit-highs\.js/.test(settings)
      && /run: node tools\/browser-audit-mediums\.js/.test(settings)
      && /run: node tools\/browser-dnr-reconcile\.js/.test(settings)
      && /run: node tools\/browser-element-zapper\.js/.test(settings)
      && /run: node tools\/browser-engine-smoke\.js/.test(settings)
      && /run: node tools\/browser-download-hash-redirects\.js/.test(settings)
      && /run: node tools\/browser-reputation-bypass\.js/.test(settings)
      && /run: node tools\/browser-image-logger-loads\.js/.test(settings)
      && /run: node tools\/browser-media-security\.js/.test(settings)
      && /run: node tools\/browser-grabber-switches\.js/.test(settings)
      && /run: node tools\/browser-eyeshield-frames\.js/.test(settings)
      && /run: node tools\/browser-resource-saver\.js/.test(settings)
      && /run: node tools\/browser-player-ad-layers\.js/.test(settings));
  /* Publication stays serialised while a draft is prepared and promoted. */
  const head = WORKFLOW.split(/\njobs:\n/)[0];
  check('no workflow-wide concurrency can cancel the publish job', !/^concurrency:/m.test(head));
  check('the publish job is serialised and never cancelled once started',
    /concurrency:\s*\n\s*group: publish-latest-build\s*\n\s*cancel-in-progress: false/.test(rolling));
  check('each test job still cancels its own stale run',
    ['gate', 'browser-popup', 'browser-settings', 'browser-minimum'].every((id) => /concurrency:\s*\n\s*group: gate-\$\{\{ github\.ref \}\}-[a-z]+\s*\n\s*cancel-in-progress: true/.test(job(id))));
  /* The manifest's minimum Chrome, proven in that Chrome. */
  const minimum = job('browser-minimum');
  const MANIFEST = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'manifest.json'), 'utf8'));
  const pinnedVersion = (/CHROME_MINIMUM_VERSION: '(\d+)\.\d+\.\d+\.\d+'/.exec(minimum) || [])[1];
  check('the minimum-Chrome job tests the manifest\'s minimum_chrome_version (' + pinnedVersion + ' vs ' + MANIFEST.minimum_chrome_version + ')',
    !!pinnedVersion && pinnedVersion === String(MANIFEST.minimum_chrome_version));
  check('its Chrome download is pinned by SHA-256 and checked before use',
    /CHROME_MINIMUM_SHA256: '[0-9a-f]{64}'/.test(minimum)
      && /Get-FileHash -Algorithm SHA256/.test(minimum) && /-ne \$env:CHROME_MINIMUM_SHA256\) \{ throw/.test(minimum)
      && /-ne \$env:CHROME_MINIMUM_VERSION\) \{ throw/.test(minimum));
  check('it runs the popup, both Settings suites and the config race in that Chrome',
    ['browser-popup-regression', 'browser-settings-data', 'browser-settings-arrange', 'browser-config-race', 'browser-audit-highs', 'browser-audit-mediums', 'browser-dnr-reconcile', 'browser-element-zapper', 'browser-engine-smoke', 'browser-download-hash-redirects', 'browser-reputation-bypass', 'browser-image-logger-loads', 'browser-media-security', 'browser-grabber-switches', 'browser-eyeshield-frames', 'browser-resource-saver']
      .every((t) => new RegExp('run: node tools/' + t + '\\.js').test(minimum))
      && /WARDENONE_BROWSER_NAME: 'Google Chrome'/.test(minimum) && /WARDENONE_HEADLESS: '1'/.test(minimum));
  const browserSteps = minimum.split(/\n      - /).filter(step => /run: node tools\/browser-/.test(step));
  const suites = browserSteps.filter(step => !step.includes('run: node tools/browser-runtime-smoke.js'));
  check('minimum Chrome checks software rendering before extension suites',
    /runs-on: windows-2022/.test(minimum) && /WARDENONE_SOFTWARE_GL: '1'/.test(minimum)
      && browserSteps[0].includes('id: runtime') && browserSteps[0].includes('browser-runtime-smoke.js'));
  check('every extension suite requires the pinned Chrome and a working graphics runtime',
    suites.length === 16 && suites.every(step => step.includes("steps.chrome.outcome == 'success'")
      && step.includes("steps.runtime.outcome == 'success'")) && /id: chrome/.test(minimum));
  const needs = ((/needs: \[([^\]]*)\]/.exec(rolling) || [])[1] || '').split(',').map((s) => s.trim());
  check('the rolling build waits for the gate, the real popup, the real Settings page and the minimum Chrome',
    ['gate', 'browser-popup', 'browser-settings', 'browser-minimum'].every((n) => needs.includes(n)), needs.join(', '));
  check('the publishing job may issue a GitHub attestation',
    /contents: write/.test(rolling) && /id-token: write/.test(rolling)
      && /attestations: write/.test(rolling));
  const steps = [
    'name: Package the extension',
    'name: Verify release archive inventory',
    'name: Write and verify the ZIP checksum',
    'name: Attest the ZIP build provenance',
    'name: Write the notes',
    'name: Prepare the commit release as a draft',
    'name: Verify both assets before publication',
    'name: Make the complete release Latest',
  ].map((name) => rolling.indexOf(name));
  check('package inspection, checksum and attestation all finish before publication',
    steps.every((at) => at >= 0) && steps.every((at, index) => index === 0 || at > steps[index - 1]));
  check('the checksum covers the exact ZIP that is uploaded',
    /sha256sum WardenOne-latest\.zip > WardenOne-latest\.zip\.sha256/.test(rolling)
      && /sha256sum --check WardenOne-latest\.zip\.sha256/.test(rolling));
  check('the pinned GitHub attestation action signs that same ZIP',
    /uses: actions\/attest@[0-9a-f]{40}/.test(rolling)
      && /subject-path: WardenOne-latest\.zip/.test(rolling));
  check('the commit tag is unique and both assets are attached before publication',
    /BUILD_TAG="build-\$GITHUB_SHA"/.test(rolling)
      && /gh release create "\$BUILD_TAG" WardenOne-latest\.zip WardenOne-latest\.zip\.sha256/.test(rolling)
      && /gh release upload "\$BUILD_TAG" WardenOne-latest\.zip WardenOne-latest\.zip\.sha256 --clobber/.test(rolling)
      && /isDraft --jq \.isDraft/.test(rolling));
  check('the job downloads and checks the draft assets before the Latest switch',
    /gh release download "\$BUILD_TAG" --pattern 'WardenOne-latest\.zip\*' --dir downloaded-release/.test(rolling)
      && /cmp WardenOne-latest\.zip downloaded-release\/WardenOne-latest\.zip/.test(rolling)
      && /cmp WardenOne-latest\.zip\.sha256 downloaded-release\/WardenOne-latest\.zip\.sha256/.test(rolling)
      && /cd downloaded-release && sha256sum --check WardenOne-latest\.zip\.sha256/.test(rolling));
  check('the publish step rejects stale pushes and never moves a tag or replaces published assets',
    /git ls-remote origin refs\/heads\/main/.test(rolling)
      && !/git tag -f latest-build|git push -f origin latest-build/.test(rolling)
      && !/gh release upload latest-build/.test(rolling));
  check('the legacy fixed-tag download is removed only after Latest is verified',
    /test "\$\(gh release view --json tagName --jq \.tagName\)" = "\$BUILD_TAG"[\s\S]*gh release delete latest-build --cleanup-tag --yes/.test(rolling));
  check('publication verifies only one rolling release remains',
    /ROLLING_TAGS="\$\(gh release list --limit 1000[\s\S]*?grep -E '\^build-\[0-9a-f\]\{40\}\$'[\s\S]*?test "\$ROLLING_TAGS" = "\$BUILD_TAG"/.test(rolling));
  check('release notes identify the full source commit, ZIP digest and attestation',
    /Source commit:.*\$GITHUB_SHA/.test(rolling)
      && /ZIP SHA-256:.*WardenOne-latest\.zip\.sha256/.test(rolling)
      && /steps\.provenance\.outputs\.attestation-url/.test(rolling));
  check('release notes keep technical verification optional and below installation',
    /echo "## Install"[\s\S]*?echo '<details>'[\s\S]*?echo '<summary>Optional advanced verification/.test(rolling)
      && /Only the ZIP is needed to install WardenOne/.test(rolling)
      && /echo '<\/details>'/.test(rolling));

  check('README gives the checksum asset and an origin-constrained verification command',
    README.includes(LATEST_ASSET + '.sha256')
      && /Get-FileHash .*WardenOne-latest\.zip -Algorithm SHA256/.test(README)
      && /gh attestation verify WardenOne-latest\.zip --repo iri-dev\/WardenOne --signer-workflow iri-dev\/WardenOne\/\.github\/workflows\/gate\.yml --source-ref refs\/heads\/main/.test(README));
  check('README and site say verification is optional for advanced users',
    /\*\*Optional, for advanced users\.\*\*/.test(README)
      && /downloading\s+the `\.sha256` file, calculating a hash and using the GitHub CLI are optional/.test(README)
      && /Optional, for the curious/.test(DOWNLOAD_PAGE)
      && /you don't need them to install/.test(DOWNLOAD_PAGE)
      && DOWNLOAD_PAGE.includes(LATEST_ASSET + '.sha256'));
  check('the site points readers to the verification steps',
    SITE.includes('https://github.com/iri-dev/WardenOne#verify-the-github-download'));
}

// ---------------------------------------------------------------------------
// 4. No hardcoded version anywhere in a link.
// ---------------------------------------------------------------------------
{
  for (const [label, text] of [['README.md', README]].concat(SITE_SURFACES)) {
    const pinned = /github\.com\/iri-dev\/WardenOne\/releases\/(?:tag|download)\/v?\d+\.\d+\.\d+/.exec(text);
    check('no link in ' + label + ' is pinned to one version',
      !pinned, pinned ? pinned[0] + ' goes stale the day the next release ships' : '');
  }
}

// ---------------------------------------------------------------------------
// 5. The release index remains an allowed browsing destination; no site page must link it.
// ---------------------------------------------------------------------------
{
  const bare = bareIndexLinks(SITE);
  check('the link policy allows browsing the releases index', oddReleaseLinks(BARE_INDEX).length === 0);
  check('but not many times', bare.length <= 3,
    bare.length + ' bare index links -- one of them is probably meant to be a download link');
}

// ---------------------------------------------------------------------------
// 6. Negative control. If these did not fail, the checks above would prove nothing.
// ---------------------------------------------------------------------------
{
  const OLD_README = '1. Download the latest `WardenOne-vX.Y.Z.zip` from the [Releases]('
    + LATEST_PAGE + ') page and unzip it.';
  check('the check would have caught the old README wording',
    !OLD_README.includes(LATEST_ASSET));

  const OLD_CTA = '<a class="button button-primary" href="' + LATEST_PAGE + '">';
  const oldParsed = /<a class="button button-primary" href="([^"]+)"/.exec(OLD_CTA);
  check('the check would have caught the old download button',
    !!oldParsed && oldParsed[1] !== LATEST_ASSET);

  check('a versioned asset link on a site page would be caught',
    oddReleaseLinks('<a href="https://github.com/iri-dev/WardenOne/releases/download/v1.0.1/WardenOne-v1.0.1.zip">').length === 1);
  check('the allowed release links are not',
    oddReleaseLinks('<a href="' + LATEST_ASSET + '">' + LATEST_ASSET + '.sha256 ' + LATEST_PAGE + ' ' + BARE_INDEX + '"').length === 0);

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
