/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/*
 * Tripwires for the things this extension deliberately does NOT do.
 * Run: node tools/test-known-limits.js
 *
 * Every check here guards a decision to leave something alone. That is unusual
 * for a test suite and it is the point: a deliberate non-change is only correct
 * while the reason for it holds, and reasons go stale silently. Nothing in the
 * codebase would otherwise notice the day one stopped being true, and the
 * decision would keep looking considered while having quietly become a bug.
 *
 * Each check therefore pins the PREMISE, not the behaviour. When a premise
 * changes, this suite fails and hands whoever changed it the decision that was
 * resting on it.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SOURCE = fs.readFileSync(path.join(ROOT, 'src', 'content.js'), 'utf8');
const CONTENT = fs.readFileSync(path.join(ROOT, 'content.min.js'), 'utf8');
const BG = fs.readFileSync(path.join(ROOT, 'background.js'), 'utf8');
const README = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');
const POPUP = fs.readFileSync(path.join(ROOT, 'popup.html'), 'utf8');

let pass = 0;
const failures = [];
function check(name, cond, detail) {
  if (cond) { pass++; return; }
  failures.push(name + (detail ? ' — ' + detail : ''));
}

// --- WebGPU: getPreferredCanvasFormat is left alone -------------------------

(function preferredCanvasFormatRestsOnPlatformNotBeingSpoofed() {
  /* getPreferredCanvasFormat() returns bgra8unorm on desktop and rgba8unorm on
     Android, so it leaks the platform family. It is left untouched, and the
     reason is not "leaking is fine" -- it is that nothing here claims a different
     platform. navigator.platform is not masked and the Client Hints wrapper
     blanks detail rather than substituting a platform, so the real format already
     agrees with everything else the browser says.

     Spoof it to bgra8unorm and a real Android user would report a desktop canvas
     format beside an Android platform: a contradiction, which identifies better
     than the truth it replaced. That is the trade, and it only stays the right
     way round while the premise below is true. */
  check('navigator.platform is not spoofed',
    !/defp\(Navigator\.prototype,\s*"platform"/.test(SOURCE.replace(/\s+/g, ' '))
      && !/maskNavigatorValue\("platform"/.test(SOURCE.replace(/\s+/g, ' ')),
    'a platform spoof appeared — getPreferredCanvasFormat must now agree with it');
  const chAt = SOURCE.indexOf('origHigh.call');
  const chWrapper = chAt > 0 ? SOURCE.slice(chAt, chAt + 1400) : '';
  check('the Client Hints wrapper blanks detail rather than substituting a platform',
    /platformVersion=""/.test(chWrapper.replace(/\s+/g, '')) && !/\bout\.platform\s*=[^=]/.test(chWrapper),
    'the wrapper now claims a platform — revisit the canvas format');
  check('getPreferredCanvasFormat is still untouched',
    CONTENT.indexOf('getPreferredCanvasFormat=') < 0,
    'it is now wrapped — check it agrees with whatever platform is claimed');
}());

(function webgpuFeaturesRestOnRequestDeviceValidatingAgainstTheRealAdapter() {
  /* adapter.features carries a real signal: bc versus etc2 versus astc texture
     compression splits desktop from mobile. It is left intact because hiding a
     feature does not stop a page needing it -- the page takes its fallback path
     or fails outright, which is a visible cost for a partial gain.

     The limits ARE clamped, and that is only safe because requestDevice validates
     what a page asks for against the real adapter rather than against what was
     reported. If the wrapper ever starts intercepting requiredLimits, clamping
     stops being free and becomes a cap on what pages can allocate. */
  const shieldAt = CONTENT.indexOf('const woGpuLimits=');
  check('the WebGPU shield is present to reason about', shieldAt > 0);
  const shield = CONTENT.slice(shieldAt, shieldAt + 4000);
  check('features are still passed through untouched',
    shield.indexOf('features') < 0, 'features are now rewritten — check the fallback paths still work');
  check('requestDevice still forwards its arguments unchanged',
    /realDevice\.apply\(real,args\)/.test(shield),
    'requiredLimits are now being intercepted — clamped limits are no longer free');
}());

// --- Workers: the realm that cannot be reached ------------------------------

(function workerHardwareValuesRemainNative() {
  /* Worker values remain native; page-only substitutions would expose a mismatch. */
  const noise = SOURCE.slice(SOURCE.indexOf('/* FINGERPRINT-NOISE-BEGIN'), SOURCE.indexOf('/* FINGERPRINT-NOISE-END'));
  check('core count and memory are not spoofed only in the page realm',
    !/defp\(Navigator\.prototype,\s*"(?:hardwareConcurrency|deviceMemory)"/.test(noise.replace(/\s+/g, ' '))
      && !/woPick\([^;]*"(?:hwc|devmem)"/.test(noise),
    'recheck worker parity before changing either value');
  check('nothing pretends to cover WorkerNavigator',
    SOURCE.indexOf('WorkerNavigator') < 0,
    'worker injection now needs its own compatibility review');

  /* The network layer is the part that DOES reach every realm, and it is what
     the intranet guarantee rests on. If those rules go, worker requests stop
     being covered by anything at all. */
  check('the intranet guarantee still has its network-layer half',
    /const INTRANET_NET_PATTERNS = \[/.test(BG),
    'the network rules are gone — nothing now covers workers');
  check('the rebinding quarantine is enforced at the network layer too',
    /condition: \{ requestDomains: \[host\], resourceTypes: SECURITY_RESOURCE_TYPES \}/.test(BG),
    'quarantine is page-only now — a worker would walk past it');
}());

(function theEngineIsStillTopFrameOnly() {
  /* Three separate guards have shipped dead in this codebase because they tested
     for a subframe from a script that is never in one. The manifest fact is the
     premise under all of them, and under the decision not to build a frame-level
     engine at all. */
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
  const engine = (manifest.content_scripts || []).find((cs) => (cs.js || []).indexOf('content.min.js') >= 0);
  check('the main engine is still injected top-frame only',
    !!engine && engine.all_frames !== true,
    'the engine now runs in frames — frame-level guards can move back into it');
  /* Two shapes look alike and are opposites. "if framed, bail" is correct and
     harmless here: it never fires today, and if injection ever widened it would
     correctly hold that block to the top frame. "act only if framed" is the one
     that shipped dead three times — it reads as coverage and can never run. Only
     the second is flagged. */
  check('no "act only when framed" branch has crept back into the engine',
    !/window\.top===window\.self/.test(SOURCE)
      && !/return window\.top!==window\.self&&/.test(SOURCE),
    'a branch that only runs inside a frame is back in a top-frame-only script');

  const frameHost = (manifest.content_scripts || []).find((cs) => (cs.js || []).indexOf('anti-redirect.js') >= 0);
  check('the frame-capable script that carries that work still reaches every frame',
    !!frameHost && frameHost.all_frames === true && frameHost.world === 'MAIN');
}());

// --- third-party cookies: narrow on purpose ---------------------------------

(function theBlanketCookieRuleStaysNarrowWhileAuthUsesThoseTypes() {
  /* The blanket rule covers image and ping only because sign-in and federation
     set their cookies on frames, scripts and XHR. The wide behaviour exists, but
     scoped to hosts that are only ever trackers. If the blanket rule widens, the
     scoping was pointless and sign-in is what pays for it. */
  const narrow = BG.match(/const THIRD_PARTY_COOKIE_RESOURCE_TYPES = \[([^\]]*)\]/);
  check('the blanket rule is still image and ping only',
    !!narrow && !/sub_frame|script|xmlhttprequest/.test(narrow[1]), narrow && narrow[1]);
  check('the wide behaviour still exists, scoped to trackers',
    /const TRACKER_COOKIE_RULE_ID/.test(BG) && /requestDomains: domains/.test(BG));
  check('the scoped rule still refuses to install without a list',
    /if \(!domains\.length\)/.test(BG),
    'an empty requestDomains array matches everything — that guard must stay');
}());

// --- page-realm wrappers are replaceable, and stay that way -----------------

(function theNetworkWrappersAreReplaceableByThePageOnPurpose() {
  /* Hostile pages can replace these hooks or borrow another realm's methods.
     Keep them writable for compatibility; exact-value checks remain best-effort. */
  check('the network wrappers are still plain assignments, not hardened property definitions',
    /window\.fetch=function/.test(CONTENT) && !/defineProperty\(window,\s*["']fetch["'][^)]*writable:\s*!1/.test(CONTENT),
    'if these became non-writable, the site-breakage trade above was taken and needs revisiting');

  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
  const dnr = manifest.declarative_net_request || {};
  const files = dnr.rule_resources || [];
  check('known-destination blocking retains browser-enforced DNR rules',
    files.length > 0 && files.some((r) => r.enabled !== false),
    'listed destinations would lose their page-independent rule set');

  let ruleCount = 0;
  files.forEach((r) => {
    try { ruleCount += JSON.parse(fs.readFileSync(path.join(ROOT, r.path), 'utf8')).length; } catch (_) {}
  });
  check('the browser rule set is still substantial rather than a stub', ruleCount > 1000,
    'only ' + ruleCount + ' rules remain');

  check('README distinguishes page hooks from browser rules',
    README.includes('Browser-enforced network rules remain in force if a website changes its JavaScript.')
      && README.includes('cannot guarantee that malicious code already running in a page'));
  check('popup discloses bypassable SessionShield hooks',
    POPUP.includes('Hostile page code can bypass these JavaScript hooks; browser rules still block listed destinations.'));

  /* The isolated world is the other thing a page cannot touch. If the bridge
     ever moved into the page's realm, the message channel would join the list
     of things three lines of script can take apart. */
  const bridge = (manifest.content_scripts || []).find((cs) => (cs.js || []).indexOf('bridge.js') >= 0);
  check('the bridge still runs where the page cannot reach it',
    !!bridge && bridge.world === 'ISOLATED', bridge && bridge.world);
}());

// ---------------------------------------------------------------------------

if (failures.length) {
  console.error('FAIL (' + failures.length + ')');
  failures.forEach((f) => console.error('  - ' + f));
  process.exit(1);
}
console.log('known limits: ' + pass + ' premises still hold');
