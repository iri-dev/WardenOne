/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/*
 * What WardenOne actually does on YouTube, and whether it says so.
 *
 * The engine derives a per-host config, and the YouTube branch used to be the
 * opposite of a list: it turned EVERY boolean off and switched two back on. That
 * paused 64 default-on protections on all of youtube.com -- detectPhishing,
 * blockTrackers, sessionShield, blockTokenExfil, detectSkimmers,
 * paymentCardGuard, intranetProtection, blockCameraMic and cleanCopyLinks among
 * them -- while every one of those switches still read as ON in the popup.
 *
 * It was also self-defeating: it restored adShield and scriptletEngine and then
 * set enabled:false, and scriptletRuntimeOn reads WO.enabled first, so the two
 * exemptions it went out of its way to keep were dead anyway.
 *
 * The rule now: name what is paused, never what survives. A protection can only
 * be off on YouTube by being listed, and the list says why. YouTube is also the
 * ONLY host that pauses anything -- Amazon and Shopify used to take a whole-
 * engine exit, which is gone. These checks run the real derivation over the real
 * defaults.
 *
 * Run: node tools/test-youtube-compat.js
 */
'use strict';

const fs = require('fs');
const vm = require('vm');

const SRC = fs.readFileSync('src/content.js', 'utf8');
const MIN = fs.readFileSync('content.min.js', 'utf8');
let failed = 0;

function check(what, ok, why) {
  if (ok) return;
  failed++;
  console.error('[fail] ' + what + (why ? ' -- ' + why : ''));
}

/* ---- the shipped pause list ------------------------------------------- */
const a = MIN.indexOf('const YT_COMPAT_PAUSED=[');
const b = MIN.indexOf('],WO={}', a);
check('the pause list is in the shipped engine', a >= 0 && b > a);
if (a < 0 || b < a) { console.error('youtube compat: cannot continue'); process.exit(2); }
const box = {};
vm.createContext(box);
vm.runInContext(MIN.slice(a, b + 1) + ';globalThis.L=YT_COMPAT_PAUSED;', box,
  { filename: 'content.min.js:yt-compat' });
const PAUSED = box.L;

check('it is a non-empty list of names', Array.isArray(PAUSED) && PAUSED.length > 0);
check('every entry is a string', PAUSED.every((k) => typeof k === 'string' && k));

/* ---- the real defaults ------------------------------------------------- */
const region = SRC.slice(SRC.indexOf('enabled:!0'), SRC.indexOf('enabled:!0') + 14000);
const defaults = {};
for (const m of region.matchAll(/^\s*([A-Za-z_][A-Za-z0-9_]*):(!0|!1),?$/gm)) {
  defaults[m[1]] = m[2] === '!0';
}
check('the defaults block was found', Object.keys(defaults).length > 50,
  'got ' + Object.keys(defaults).length + ' keys');

/* Every paused name must be a real setting. A typo would silently pause
   nothing, which is the failure mode this whole file exists to prevent. */
const unknown = PAUSED.filter((k) => typeof defaults[k] !== 'boolean');
check('every paused name is a real boolean setting', unknown.length === 0,
  'unknown: ' + unknown.join(', '));

/* ---- what the list means for a default install ------------------------- *
 * This applies the shipped LIST to the shipped DEFAULTS. The other half -- that
 * the engine's branch really applies the list and nothing else -- is pinned in
 * tools/test-engine-config-ownership.js, which boots the actual config chain for
 * www.youtube.com and reads WO back. Verified: reintroducing the blanket kill
 * there fails two of its checks. Keep both; this one alone would not notice a
 * branch that ignored the list. */
const derived = Object.assign({}, defaults);
for (const k of PAUSED) if (typeof derived[k] === 'boolean') derived[k] = false;
const liveOnYouTube = Object.keys(derived).filter((k) => derived[k]);

/* The regression this file was written for. Before, exactly two survived. */
check('YouTube is no longer stripped back to two protections',
  liveOnYouTube.length > 30,
  'only ' + liveOnYouTube.length + ' live; the blanket kill is back');

/* Named protections that must be live on YouTube. Each was silently off, and
   each is one the popup claims is on. cleanCopyLinks is the sharpest: the
   right-click "Copy clean link" entry and the automatic copy cleaning are the
   same feature, and a YouTube watch URL is the exact case it was built for. */
for (const key of [
  'enabled', 'cleanCopyLinks', 'stripTrackingParams', 'unshimLinks',
  'detectPhishing', 'blockTrackers', 'blockThirdPartyCookies',
  'sessionShield', 'blockTokenExfil', 'detectSkimmers', 'paymentCardGuard',
  'intranetProtection', 'blockGrabberResources', 'blockCameraMic',
  'blockScreenCapture', 'blockGeolocation', 'formTrapDetector',
  'fingerprintProbeDetection', 'blockFingerprintScripts',
]) {
  check('YouTube keeps ' + key, derived[key] === true,
    'the popup shows it as on, so it has to be on');
}

/* enabled:false was the self-defeating part -- it killed adShield and
   scriptletEngine through scriptletRuntimeOn after the branch restored them. */
check('scriptletRuntimeOn still reads WO.enabled first',
  /scriptletRuntimeOn=\(\)=>!!\(WO\.enabled&&WO\.adShield&&WO\.scriptletEngine\)/.test(MIN),
  'if this changes, the reason enabled:false was harmful changes with it');
check('so the derivation must leave enabled on', derived.enabled === true,
  'enabled:false silently disabled the ad blocking the branch tried to keep');

/* And the things that genuinely do break a video page must STAY paused. This is
   the other direction: restoring these would break playback or navigation. */
for (const key of [
  'removeOverlays', 'autoRejectConsent', 'blockAutoplay', 'mediaShield',
  'fullscreenGuard', 'blockGesturelessNav', 'blockMetaRefresh',
  'detectRedirectChains', 'gateAdultSites', 'antiClickjacking',
]) {
  check('YouTube still pauses ' + key, derived[key] === false,
    'this one can break playback or the page\'s own navigation');
}

/* The blanket form must not come back. */
check('nothing turns every boolean off wholesale any more',
  !/for\(const k of Object\.keys\(safe\)\)"boolean"==typeof safe\[k\]&&\(safe\[k\]=!1\);\s*safe\.adShield/.test(MIN),
  'the blanket kill is what hid 64 paused protections');
check('the branch marks itself for the popup',
  /safe\.__youtubeCompatibilityMode=!0/.test(MIN));

/* YouTube is the only host that pauses anything. Amazon and Shopify used to
   take a much larger exit -- the runtime returned before installing, and the
   config derivation turned every boolean off -- while both still stamped
   __wardenOneInstalled, so the tab reported itself protected. Removed. */
check('no host takes a whole-engine compatibility exit',
  !/__amazonCompatibilityMode/.test(MIN)
    && !/if\(__woAmazonHost\.test\(location\.hostname\)\|\|\/\(\^\|\\.\)shopify/.test(MIN),
  'a site-wide off switch is exactly what this file exists to prevent');
check('and the config derivation has only the YouTube branch',
  (MIN.match(/const safe=Object\.assign\(\{\},cfg\);/g) || []).length === 1,
  'a second derived copy means a second site is being quietly stripped');

if (failed) {
  console.error('youtube compat: ' + failed + ' failed');
  process.exit(1);
}
console.log('youtube compat: all checks passed (' + liveOnYouTube.length
  + ' protections live on YouTube, ' + PAUSED.length + ' paused by name)');
