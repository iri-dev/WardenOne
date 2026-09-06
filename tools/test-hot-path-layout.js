/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/*
 * Nothing on an every-interaction path may force layout.
 *
 * Three separate reports in this project traced back to the same mistake, so it is
 * worth a suite of its own rather than a comment each time:
 *   - the badge hit-testing with elementsFromPoint on pointermove (Spotify's volume
 *     slider went laggy),
 *   - scanMedia measuring size inside a MutationObserver, before layout,
 *   - clickText reading innerText on every click (measured inside a 384ms INP on
 *     Spotify, 167ms of it in handlers).
 *
 * The reads that force a synchronous style+layout flush are innerText,
 * offsetWidth/Height, getBoundingClientRect, getComputedStyle, elementFromPoint and
 * elementsFromPoint. None of them belong on a path that runs per click, per pointer
 * move, or per frame -- and where one is genuinely needed, the cheap test that
 * usually rejects the case must come FIRST.
 *
 * Run: node tools/test-hot-path-layout.js
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(ROOT, 'src', 'content.js'), 'utf8');

function slice(from, to, what) {
  const a = source.indexOf(from);
  assert(a >= 0, what + ': start anchor missing (' + from.slice(0, 40) + ')');
  const b = source.indexOf(to, a + from.length);
  assert(b > a, what + ': end anchor missing (' + to.slice(0, 40) + ')');
  return source.slice(a, b);
}
/* Comments explain why a read is avoided and would otherwise fail the check that they
   document -- the ordering assertion below matched the phrase "getComputedStyle" inside
   the comment explaining that getComputedStyle now runs second. Line comments are
   stripped only when they own the whole line, so a "https://" inside real code survives. */
const code = (text) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');

/* ---- the click path -------------------------------------------------------- */
const clickText = code(slice('clickText=el=>{', 'clickTarget=el=>{', 'clickText'));
assert(!/\binnerText\b/.test(clickText),
  'clickText must not read innerText -- it is layout-dependent, and this runs on every '
  + 'click on anything button-shaped, before the filter that rejects almost all of them');
assert(/\btextContent\b/.test(clickText),
  'clickText still has to read the label, just without forcing layout');
for (const forbidden of ['getBoundingClientRect', 'getComputedStyle', 'offsetWidth', 'offsetHeight']) {
  assert(!clickText.includes(forbidden), 'clickText must not call ' + forbidden);
}

/* Ordering: the cheap regex must reject before anything measures the page.
   looksCovered calls elementFromPoint, which is a forced layout -- fine once a label
   has actually matched, never as the opening move. */
const handler = code(slice('const target=clickTarget(e.target);', 'warnedClick.add(target)', 'click handler'));
const filterAt = handler.indexOf('SENSITIVE_CLICK.test');
const coveredAt = handler.indexOf('looksCovered(');
assert(filterAt >= 0, 'the click handler still filters on SENSITIVE_CLICK');
assert(coveredAt >= 0, 'the click handler still checks whether the control was covered');
assert(filterAt < coveredAt,
  'the cheap word test must run before elementFromPoint, not after');

/* ---- the consent scanner --------------------------------------------------- */
/* Measured as the single most expensive thing WardenOne did while dragging Spotify's
   volume slider: 26ms of a 32ms budget. Its MutationObserver watches the 'style'
   attribute across the whole document, and a slider rewrites its inline style on every
   frame it moves -- so a drag became a continuous full-document scan. One scan calls
   isVisible on up to 500 candidates, and isVisible used to compute style before
   testing the rect. */
const consent = fs.readFileSync(path.join(ROOT, 'consent-reject.js'), 'utf8');
const isVisibleAt = consent.indexOf('function isVisible(el)');
assert(isVisibleAt > 0, 'isVisible is where the slice expects it');
const isVisible = code(consent.slice(isVisibleAt, consent.indexOf('function collectRoots', isVisibleAt)));
{
  const rectAt = isVisible.indexOf('getBoundingClientRect');
  const styleAt = isVisible.indexOf('getComputedStyle');
  assert(rectAt > 0 && styleAt > 0, 'isVisible still does both reads');
  assert(rectAt < styleAt,
    'isVisible must test the rect BEFORE computing style -- both conditions must hold, so '
    + 'the order is free, and style is the expensive half paid for every off-screen candidate');
}
{
  const elementText = code(consent.slice(consent.indexOf('function elementText(el)'),
    consent.indexOf('function ', consent.indexOf('function elementText(el)') + 10)));
  assert(!/\bel\.innerText\b/.test(elementText),
    'elementText must not read innerText -- it forces layout, and textContent is already '
    + 'in the same joined string');
  assert(/\bel\.textContent\b/.test(elementText), 'elementText still needs the text');
}
{
  /* controlLabel takes the FIRST truthy bit rather than joining, so innerText there is
     load-bearing -- this asserts the distinction was understood, not copied. */
  const controlLabel = code(consent.slice(consent.indexOf('function controlLabel(el)'),
    consent.indexOf('function ', consent.indexOf('function controlLabel(el)') + 10)));
  assert(/\bel\.innerText\b/.test(controlLabel),
    'controlLabel picks the first truthy label, so dropping innerText there would change '
    + 'which label wins -- it must stay');
}
{
  const queueScan = code(consent.slice(consent.indexOf('function queueScan('),
    consent.indexOf('function startObserver')));
  assert(/scanFinished/.test(queueScan),
    'a completed reject/save must make later startup timers and mutation callbacks cheap no-ops');
  /* Mentioning the constant is not enough -- a disabled gate still mentions it. The
     gate itself has to be there and has to compare against it. */
  assert(/throttled\s*===\s*true/.test(queueScan),
    'queueScan must actually branch on the mutation-driven flag');
  assert(/<\s*SCAN_MIN_GAP_MS/.test(queueScan),
    'mutation-driven scans must be rate-limited, or a slider drag scans every frame');
  assert(/scanDeferred/.test(queueScan),
    'a throttled request must be deferred rather than dropped, or a banner arriving '
    + 'inside the window is never acted on');
  const observer = code(consent.slice(consent.indexOf('function startObserver'),
    consent.indexOf('function start()')));
  assert(/mutationsMayAffectConsent\(records\)/.test(observer),
    'the consent observer must reject unrelated mutations before waking the full scanner');
  assert(/queueScan\(true\)/.test(observer),
    'the observer must ask for the throttle explicitly -- a MutationObserver passes its '
    + 'records array, which is truthy, so it cannot be inferred from the argument');
  /* Inline style is what animations and drag feedback rewrite. Watching it document-wide
     meant a full consent scan per frame of any drag, on any site. */
  const filter = (observer.match(/attributeFilter:\s*\[[^\]]*\]/) || [''])[0];
  assert(filter, 'the consent observer still declares an attributeFilter');
  assert(!/['"]style['"]/.test(filter),
    "the consent observer must not watch 'style' -- a range slider rewrites it every "
    + 'frame it moves, and banners that reveal that way are covered by the timed passes');
  assert(/['"]class['"]/.test(filter),
    'class must still be watched -- it is how banners actually toggle visible');
}
{
  /* The 250ms throttle only caps how often a scan can happen; it does not make an
     1800-node scan cheap. Run the real mutation filter so a range control changing
     its state class and value label cannot wake that scan at all. */
  const declarations = [
    (consent.match(/const CONSENT_FRAME_HINT_RE = [^\n]+;/) || [''])[0],
    consent.slice(consent.indexOf('const CONTAINER_SELECTOR = ['), consent.indexOf('const CONTROL_SELECTOR = [')),
    (consent.match(/const STRONG_CONSENT_TEXT_RE = [^\n]+;/) || [''])[0],
    (consent.match(/const WEAK_CONSENT_TEXT_RE = [^\n]+;/) || [''])[0],
    (consent.match(/const CONSENT_ACTION_TEXT_RE = [^\n]+;/) || [''])[0],
    consent.slice(consent.indexOf('function hasConsentLanguage('), consent.indexOf('function hasStrongConsentLanguage(')),
    consent.slice(consent.indexOf('function mutationNodeMayAffectConsent('), consent.indexOf('function startObserver(')),
  ].join('\n');
  const sandbox = {};
  vm.createContext(sandbox);
  vm.runInContext(declarations + '\nthis.testMutations = mutationsMayAffectConsent;', sandbox);
  const node = (values) => Object.assign({
    nodeType: 1, id: '', className: '', textContent: '', parentElement: null,
    getAttribute() { return null; }, matches() { return false; }, querySelector() { return null; },
  }, values || {});
  const slider = node({ className: 'volume-slider active', textContent: 'Volume 61' });
  assert.strictEqual(sandbox.testMutations([
    { type: 'attributes', target: slider, attributeName: 'class' },
    { type: 'childList', target: slider, addedNodes: [{ nodeType: 3, nodeValue: '61' }] },
  ]), false, 'volume feedback must not wake the document-wide consent scan');
  assert.strictEqual(sandbox.testMutations([
    { type: 'childList', addedNodes: [node({ id: 'onetrust-banner-sdk' })] },
  ]), true, 'a known consent vendor inserted late must still wake the scanner');
  assert.strictEqual(sandbox.testMutations([
    { type: 'childList', addedNodes: [node({ textContent: 'We use cookies. Reject all or accept all.' })] },
  ]), true, 'an obfuscated consent banner with no useful attributes must still wake the scanner');
}
{
  /* A page that has gone twenty seconds without a banner does not have one. Without
     this, every DOM change for the rest of the 120s window buys another 1800-node walk. */
  const scanFn = code(consent.slice(consent.indexOf('function scan()'),
    consent.indexOf('function queueScan(')));
  assert(/SCAN_GIVE_UP_MS/.test(scanFn) && /observer\.disconnect/.test(scanFn),
    'scan must stop reacting to mutations once a page has proven it has no banner');
  /* PROTECTION, not just cost: stepping down must not become giving up. A banner that
     reveals late -- or reveals by inline style, which the attributeFilter deliberately
     no longer watches -- still has to be caught. */
  assert(/slowTimer/.test(scanFn) && /SLOW_SCAN_MS/.test(scanFn),
    'disconnecting the observer must step DOWN to a slow poll, never stop scanning: '
    + 'coverage must not shrink, only cost');
  assert(/OBSERVER_LIFETIME_MS/.test(scanFn),
    'the slow poll must end on the same deadline the observer had, not run forever');
  /* The poll must run in IDLE time. Scheduling it on the next frame instead traded a
     per-frame cost for a ~50ms hitch every few seconds -- measurably worse during a
     drag, which is the exact thing being fixed. */
  assert(/idleScan\(\)/.test(scanFn),
    'the slow poll must go through idleScan, not queueScan -- queueScan lands the work '
    + 'inside a rAF callback, i.e. in the middle of frame production');
  const idleScan = code(consent.slice(consent.indexOf('function idleScan()'),
    consent.indexOf('function queueScan(')));
  assert(/requestIdleCallback/.test(idleScan),
    'idleScan must actually wait for idle time');
  assert(/timeout/.test(idleScan),
    'idle work needs a timeout or a permanently busy page starves the scan entirely');
  assert(/!everActed/.test(scanFn),
    'the no-banner give-up must not stop an unfinished settings flow before its save button appears');
  const logAction = code(consent.slice(consent.indexOf('function logAction('),
    consent.indexOf('function scan()')));
  assert(logAction.indexOf('everActed = true') < logAction.indexOf('lastLogAt < 1200'),
    'everActed must be set before the log rate limit, or a coalesced log would leave a '
    + 'page that DOES have a banner looking like one that never found anything');
}
{
  /* Rejecting or saving is terminal. Spotify removes its OneTrust banner immediately,
     but then keeps changing classes as its player renders. Leaving the observer alive
     converted that harmless churn into another full-document scan every 250ms for two
     minutes, even though there was no consent UI left to find. */
  const finish = code(consent.slice(consent.indexOf('function finishConsentWork()'),
    consent.indexOf('function idleScan()')));
  assert(/scanFinished\s*=\s*true/.test(finish),
    'finishing consent work must gate every later scan source');
  assert(/observer\.disconnect/.test(finish),
    'finishing consent work must disconnect the document-wide observer');
  assert(/clearTimeout\(scanDeferred\)/.test(finish),
    'finishing consent work must cancel a mutation scan already waiting to run');
  assert(/clearInterval\(slowTimer\)/.test(finish),
    'finishing consent work must stop the fallback poll too');
  const calls = (code(consent).match(/finishConsentWork\(\)/g) || []).length;
  assert.strictEqual(calls, 5,
    'all four terminal choices (Twitch reject, generic reject, banner reject, saved choices) '
    + 'must finish scanning; the fifth occurrence is the function declaration');
  const start = code(consent.slice(consent.indexOf('function start()'),
    consent.indexOf('const refreshConfigState')));
  assert(/scanFinished/.test(start),
    'the 95ms startup poll must stop after a successful choice instead of running all 24 passes');
}

/* ---- the badge path -------------------------------------------------------- */
const badgeWiring = code(slice('!badgeEventsBound){', 'const NO_BADGE_TYPES=', 'badge wiring'));
for (const ev of ['pointermove', 'mousemove', 'pointerover', 'scroll']) {
  assert(!badgeWiring.includes('"' + ev + '"'),
    'the badge must not hit-test from ' + ev + ' -- elementsFromPoint forces layout');
}
/* pointerenter on the badge element is allowed -- it fires once per crossing, not per
   move. But it must NOT force: forcing skips the layout cache, so each crossing pays
   ~43 forced-layout reads again. That is the accumulation iri found ("it starts to lag
   after the badge activates too many times"). Asserted on the WIRING, because the unit
   test calls updateBadgeYield directly and so cannot see how it is hooked up. */
assert(/"pointerenter"/.test(badgeWiring), 'the hover re-check must still exist');
assert(/"pointerenter",[\s\S]{0,80}?updateBadgeYield\(\)/.test(badgeWiring),
  'the pointerenter handler must call updateBadgeYield() unforced -- forcing it past '
  + 'the cache is what made repeated crossings degrade');

/* ---- what the badge animates ------------------------------------------------ */
/* transform and opacity are composited on the GPU. box-shadow and background are not:
   transitioning those repaints the badge and everything under it for the whole
   duration. The badge sits in the corner a player's volume slider sits in, so crossing
   it quickly re-triggered overlapping repaint-driving transitions right where something
   else was already repainting. Reported as "fine going slowly, not fast". */
{
  const badgeCss = (source.match(/\.b\{[^}]*\}/) || [''])[0];
  assert(badgeCss, 'the badge rule is still where the test expects it');
  const transition = (badgeCss.match(/transition:[^;}]*/) || [''])[0];
  assert(transition, 'the badge still declares a transition');
  for (const prop of ['box-shadow', 'background', 'filter', 'width', 'height', 'top', 'left']) {
    assert(!transition.includes(prop),
      'the badge must not transition ' + prop + ' -- it is not GPU-composited, so every '
      + 'frame of that transition is a repaint under the badge');
  }
  assert(/opacity|transform/.test(transition),
    'the badge should still animate something -- opacity and transform are free');
}

/* ---- the media path -------------------------------------------------------- */
const consider = code(slice('considerMedia=el=>{', 'scanMedia=root=>{', 'considerMedia'));
assert(/mediaHiddenDefinitely\(el\)/.test(consider),
  'the definitive, layout-free signals must be what is acted on immediately');
assert(/setTimeout\(/.test(consider),
  'a size verdict must be deferred until layout has actually happened');

console.log('hot path layout tests passed (57 assertions)');
