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

(function workerNavigatorIsAKnownAndUnfixedContradiction() {
  /* The hardware spoofs are installed on Navigator.prototype. A worker's
     navigator is a WorkerNavigator, in a separate realm, on a prototype this
     code never touches -- so a page that reads hardwareConcurrency from a worker
     gets the real number while the main thread reports the rounded one.

     That is a contradiction, and contradictions have been treated as worse than
     either answer everywhere else in this codebase. It is unfixed because the
     only way in is to re-serve the worker's source from a blob, which changes
     self.location under scripts that use it to resolve their own resources,
     breaks module workers' relative imports, and is forbidden outright for
     service workers.

     Pinned rather than papered over. If someone later adds a worker shim, this
     check should be the thing that reminds them what it was for; if someone
     removes the hardware spoof, the contradiction goes with it and this check
     should be deleted deliberately rather than left passing by accident. */
  check('the hardware spoofs are on Navigator.prototype, which workers do not share',
    /defp\(Navigator\.prototype,\s*"hardwareConcurrency"/.test(SOURCE.replace(/\s+/g, ' ')),
    'the hardwareConcurrency spoof moved — recheck whether workers now agree');
  check('nothing pretends to cover WorkerNavigator',
    SOURCE.indexOf('WorkerNavigator') < 0,
    'something now touches WorkerNavigator — this limitation may be closed');

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
  /* The engine watches the network from inside the page's own realm: it assigns
     over window.fetch, XMLHttpRequest.prototype.open and navigator.sendBeacon.
     Everything reading those -- token-exfil, the card skimmer detector, beacon
     logging -- is only as durable as the assignment.

     It is not durable, and this was checked rather than assumed. A page can put
     a same-origin iframe in the document and take the copies out of it:

       const w = document.body.appendChild(document.createElement('iframe')).contentWindow;
       w.fetch(url);                                     // never reaches the wrapper
       XMLHttpRequest.prototype.open = w.XMLHttpRequest.prototype.open;  // disarms it

     The second line is the one that matters: it does not dodge the wrapper for
     one call, it removes it from the top frame for the rest of the page's life,
     with nothing shown to the reader.

     Two fixes suggest themselves and both are worse than the problem:

     - defineProperty with writable:false. It stops the second line and not the
       first, and it breaks every site that legitimately wraps fetch -- error
       reporters, analytics SDKs, polyfills. Paying real breakage for half a
       mitigation is the wrong side of the trade this codebase keeps making.
     - re-arming on a timer. Same objection to the first line, and re-wrapping
       whatever a site installed is its own source of breakage.

     What actually closes it is the work already scheduled against the frame
     scope: running the credential-facing subset with all_frames and
     match_about_blank, so a child realm arrives patched instead of pristine.
     That is worth recording here because it means the frame-scope item buys
     more than its own disclosure claims -- it is also the fix for this.

     So the premise being pinned is NOT "the wrappers are safe". It is: the
     network-blocking spine does not depend on them. DNR rules are enforced by
     the browser, outside the page's reach, and stay up whatever the page does
     to our assignments. The day the blocking starts depending on a page-realm
     wrapper, this stops being an accepted limit. */
  check('the network wrappers are still plain assignments, not hardened property definitions',
    /window\.fetch=function/.test(CONTENT) && !/defineProperty\(window,\s*["']fetch["'][^)]*writable:\s*!1/.test(CONTENT),
    'if these became non-writable, the site-breakage trade above was taken and needs revisiting');

  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
  const dnr = manifest.declarative_net_request || {};
  const files = dnr.rule_resources || [];
  check('blocking is still carried by browser-enforced DNR rules, not by the page realm',
    files.length > 0 && files.some((r) => r.enabled !== false),
    'if blocking moved into the page realm it inherits every bypass described above');

  let ruleCount = 0;
  files.forEach((r) => {
    try { ruleCount += JSON.parse(fs.readFileSync(path.join(ROOT, r.path), 'utf8')).length; } catch (_) {}
  });
  check('the rule set is still substantial rather than a stub', ruleCount > 1000,
    'only ' + ruleCount + ' rules — the spine this limit leans on has thinned out');

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
