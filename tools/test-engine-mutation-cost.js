/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/*
 * What the engine costs per DOM mutation.
 *
 * One shared MutationObserver on document.documentElement fans out to ~18
 * consumers, so everything here runs again every time the page changes. That is
 * fine on a quiet page -- measured on an idle YouTube tab, zero mutations, zero
 * cost -- and it is why the lag people report is intermittent: the bill is
 * proportional to churn, and a YouTube mix page churns hard (a 25-item queue
 * that keeps extending, plus the scrub tooltip moving).
 *
 * Two shapes are expensive and both are guarded here:
 *
 *  1. Whole-document scans per BATCH. collapseLeftovers(document) is a
 *     nine-selector querySelectorAll over the entire page. Measured on a live
 *     mix page (7832 elements): 0.71ms per call -- ~21ms/s at 30 batches a
 *     second, ~71ms/s while a queue rebuilds. The ordinary-page branch always
 *     coalesced it behind collapsePending at 250ms; the video-platform branch
 *     called it directly on every batch, i.e. unthrottled on precisely the pages
 *     that churn most. Both branches must coalesce.
 *
 *  2. Subtree scans per ADDED NODE. Several sweeps run querySelectorAll on each
 *     added node. Measured per added node on a mix page (playlist items average
 *     77 nodes): sweepSocialWidgets 9.8us, sweepLocal 8.8us, sweepMedia 3.3us,
 *     sweepLazy 2.1us, sweepLinks 1.9us. Where the per-element function's first
 *     act is to bail on a flag, that flag belongs ABOVE the traversal -- the
 *     scan could only ever collect work it was about to discard.
 *
 * Run: node tools/test-engine-mutation-cost.js
 */
'use strict';

const fs = require('fs');

const SRC = fs.readFileSync('src/content.js', 'utf8');
const MIN = fs.readFileSync('content.min.js', 'utf8');
let failed = 0;

function check(what, ok, why) {
  if (ok) return;
  failed++;
  console.error('[fail] ' + what + (why ? ' -- ' + why : ''));
}

/* ---- 1. whole-document work must be coalesced, on every branch ----------- */

/* The video-platform branch. It returns early, so its coalesce has to be inside
   the branch rather than relying on the one further down. */
/* Anchored on the mutation-observer consumer, NOT on the first
   `if(scriptletPlayerPage()){` in the file -- that one belongs to the
   rules-arrival path, which is a one-shot and may call the scan directly. */
const playerBranch = (() => {
  const m = /woObserve\(\(\)=>\{\s*if\(scriptletPlayerPage\(\)\)\{/.exec(SRC);
  if (!m) return '';
  const a = m.index;
  const b = SRC.indexOf('return', a);
  return b > a ? SRC.slice(a, b) : '';
})();
check('the video-platform branch is still there', !!playerBranch);
check('it no longer scans the whole document on every mutation batch',
  !/collapseLeftovers\(document\);/.test(playerBranch),
  'a direct call here is 0.71ms per batch on a mix page, unthrottled');
check('it coalesces behind the same pending flag the other branch uses',
  /collapsePending\|\|\(collapsePending=!0,/.test(playerBranch)
    && /collapseLeftovers\(document\)/.test(playerBranch),
  'the ordinary-page branch has always throttled this; the busy one must too');
check('and at the same 250ms the other branch uses',
  /\},\s*250\)\)/.test(playerBranch),
  'a different interval here would be an accident, not a decision');

/* The ordinary-page branch, unchanged. */
check('the ordinary-page branch still coalesces too',
  (SRC.match(/collapsePending\|\|\(collapsePending=!0,/g) || []).length >= 2,
  'both branches route through the throttle');

/* Direct calls are fine where they are one-shots -- when cosmetic rules arrive.
   What must never come back is a direct call on the MUTATION path, so this pins
   the observer consumer rather than counting calls file-wide. */
check('no woObserve consumer calls the whole-document collapse directly',
  !/woObserve\(\(\)=>\{[\s\S]{0,900}?collapseLeftovers\(document\)[,;]/.test(
    SRC.replace(/collapsePending\|\|\(collapsePending=!0,[\s\S]*?250\)\)/g, 'COALESCED')),
  'a direct call on the mutation path is the 0.71ms-per-batch scan again');

/* ---- 2. a flag that gates the work belongs above the traversal ----------- */

function sweepBody(name) {
  const a = SRC.indexOf(name + '=root=>{');
  if (a < 0) return '';
  const b = SRC.indexOf('querySelectorAll', a);
  return b > a ? SRC.slice(a, b) : '';
}

/* tameMedia's first line is `if(userGestured)return;`, so after the reader's
   first click this traversal could not do anything. On a video page that is
   immediately, and then the page keeps appending nodes for as long as it plays. */
check('sweepMedia checks userGestured before it walks anything',
  /if\(userGestured\)return;/.test(sweepBody('const sweepMedia')),
  '3.3us per added node, forever, for no effect');

/* guardSocialNode tests this flag before it looks at the element at all. */
check('sweepSocialWidgets checks its flag before it walks anything',
  /if\(!WO\.socialWidgetGuard\)return;/.test(sweepBody('sweepSocialWidgets')),
  '9.8us per added node collecting nodes it was about to discard');

/* The pattern this follows -- already correct, and the reason the other two
   looked wrong next to it. */
check('sweepDomLinks still gates before walking, as it always did',
  /if\(!WO\.unshimLinks&&!WO\.stripTrackingParams\)return;/.test(sweepBody('sweepDomLinks')));

/* Guard the guards: a hoist is only valid while the per-element function really
   does bail on that condition first. If those change, the hoist is a behaviour
   change rather than a saving, and this should fail. */
check('tameMedia still bails on userGestured first',
  /const tameMedia=m=>\{\s*try\{\s*if\(userGestured\)return;/.test(SRC),
  'the hoist above is only behaviour-preserving while this holds');
check('guardSocialNode still bails on the flag first',
  /guardSocialNode=el=>\{\s*try\{\s*if\(!WO\.socialWidgetGuard\|\|/.test(SRC),
  'the hoist above is only behaviour-preserving while this holds');

/* ---- 2b. gate the CONSUMER, not just the sweep --------------------------- *
 * Hoisting the flag into the sweep stopped the querySelectorAll, but the
 * consumer still walked every added node to call it. Where every branch of a
 * consumer's loop bails on the same condition, the condition belongs on the
 * consumer, so the walk is skipped too. Each of these is behaviour-identical
 * only because the per-element function tests exactly the same thing first --
 * which the checks below pin. */
check('the media consumer gates before walking added nodes',
  /if\(userGestured\)return;\s*for\(let i=0;\s*i<added\.length;\s*i\+\+\)\{\s*const n=added\[i\];\s*\/\^\(VIDEO\|AUDIO\)\$\/\.test\(n\.tagName\)&&tameMedia\(n\)/.test(SRC),
  'both branches of that loop bail on userGestured anyway');
check('the social consumer gates before walking added nodes',
  /if\(!WO\.socialWidgetGuard\)return;\s*for\(let i=0;\s*i<added\.length;\s*i\+\+\)guardSocialNode\(added\[i\]\)/.test(SRC),
  'guardSocialNode and sweepSocialWidgets both test it first');
check('the dom-link consumer gates before walking added nodes',
  /if\(!WO\.unshimLinks&&!WO\.stripTrackingParams\)return;\s*for\(let i=0;\s*i<added\.length;\s*i\+\+\)scrubDomLink\(added\[i\]\)/.test(SRC),
  'scrubDomLink and sweepDomLinks both test it first');
check('scrubDomLink really does bail on the same condition',
  /const scrubDomLink=el=>\{\s*try\{\s*if\(!WO\.unshimLinks&&!WO\.stripTrackingParams\|\|/.test(SRC),
  'the consumer gate is only behaviour-preserving while this holds');

/* ---- 3. read only as much page text as you are going to look at --------- */

/* scamScan and fakeUpdateScan both wanted the first 20k characters of the page
   and both got them with document.body.textContent.slice(0,2e4) -- which builds
   the ENTIRE page as one string first. On a YouTube watch page that is a 1.23 MB
   string costing 2.58ms, produced about once a second for as long as the tab is
   open, to read 20 KB of it. Walking text nodes and stopping at the cap returns
   a byte-identical string; verified against the shipped helper on that page:
   2.589ms -> 0.001ms, and 2.34 MB of garbage per call avoided. */
check('there is a bounded page-text reader',
  /bodyTextCapped=cap=>\{/.test(SRC),
  'the scanners only ever look at the first cap characters');
check('it stops walking once it has enough',
  /while\(len<cap&&\(node=walker\.nextNode\(\)\)\)/.test(SRC),
  'without the len<cap test it walks the whole document again');
check('and it still returns exactly cap characters, in document order',
  /createTreeWalker\(document\.body,NodeFilter\.SHOW_TEXT\)/.test(SRC)
    && /parts\.join\(""\)\.slice\(0,cap\)/.test(SRC),
  'SHOW_TEXT in document order is what makes it byte-identical to textContent');

/* Neither hot scanner may go back to serialising the whole body. */
const scamBody = (() => {
  const a = SRC.indexOf('scamScan=()=>{');
  return a < 0 ? '' : SRC.slice(a, a + 600);
})();
const fakeBody = (() => {
  const a = SRC.indexOf('fakeUpdateScan=()=>{');
  return a < 0 ? '' : SRC.slice(a, a + 600);
})();
check('scamScan uses the bounded reader', /bodyTextCapped\(2e4\)/.test(scamBody)
  && !/document\.body\.textContent/.test(scamBody));
check('fakeUpdateScan uses the bounded reader', /bodyTextCapped\(2e4\)/.test(fakeBody)
  && !/document\.body\.textContent/.test(fakeBody),
  'this is the one that actually runs on YouTube -- it is not a FU_VENDOR host');
check('the built engine carries the bounded reader',
  /bodyTextCapped=cap=>\{/.test(MIN));

/* ---- 4. keep the periodic cosmetic sweeps out of the frame budget -------- *
 * The lag is episodic: a mix page churns in bursts (a track change or an ad slot
 * rebuilds a lot of DOM at once) and is perfectly smooth in between. Total CPU
 * is not the problem -- WHEN the work lands is. A 0.7ms scan that runs inside a
 * frame during a burst drops that frame; the same scan in idle time does not.
 * These two are cosmetic and the stylesheet has already hidden what they hide,
 * so they are safe to defer. requestIdleCallback carries a timeout, so they
 * still run promptly when the browser never goes idle. The synchronous
 * per-node security guards are deliberately NOT deferred. */
check('there is an idle scheduler with a guaranteed timeout',
  /__woIdle=\(fn,timeout\)=>\{/.test(SRC)
    && /window\.requestIdleCallback\(fn,\{\s*timeout:timeout\|\|250\s*\}\)/.test(SRC),
  'without the timeout a page that never idles would never run them');
check('and it falls back when requestIdleCallback is missing',
  /"function"==typeof window\.requestIdleCallback/.test(SRC) && /setTimeout\(fn,0\)/.test(SRC));
check('every collapse timer hands the scan to idle',
  (SRC.match(/__woIdle\(\(\)=>\{\s*try\{\s*collapseLeftovers\(document\)/g) || []).length === 3,
  'all three collapse sites, or a burst still drops frames on the one that was missed');
check('the ad sweep is idle-scheduled too',
  /__woIdle\(__woSweepAds,300\)/.test(SRC),
  'measured 0.66ms of whole-document scanning every 400ms');
check('the shipped engine carries the idle scheduler',
  (MIN.match(/__woIdle\(/g) || []).length >= 4);

/* ---- 4b. the layout-forcing scans go to idle too ------------------------- *
 * scanPageForClickFix reads body.innerText, which forces a synchronous layout.
 * Every mutation batch re-arms its timer, so while a page is building it fires
 * repeatedly and stalls the pipeline mid-frame. Measured: 0.99ms with layout
 * dirty vs 0.15ms clean -- and during page build it is always dirty. Deferring
 * to idle changes WHEN the layout is forced, not whether the page is scanned;
 * the timeout keeps the protection on the same cadence. */
[['scanPageForClickFix', 'forces a layout via body.innerText'],
 ['fakeUpdateScan', 'reads the page text on every batch'],
 ['scamScan', 'same shape, on every other busy site']].forEach(([fn, why]) => {
  check(fn + ' runs in idle time', SRC.indexOf('__woIdle(' + fn + ',') >= 0, why);
});
check('and each keeps a timeout so it still runs',
  (SRC.match(/__woIdle\((?:scanPageForClickFix|fakeUpdateScan|scamScan),\s*600\)/g) || []).length === 3,
  'without a timeout a page that never idles would never be scanned');

/* ---- 5. a search-page feature must not run off search pages -------------- *
 * googleCleanupSweep(document) hunts for #tads, .commercial-unit-desktop-top and
 * the rest -- Google/Brave results-page furniture. It was gated on the SETTINGS
 * alone, so with search cleanup enabled it ran on every site: a whole-document
 * scan every 250ms for its first 80 mutation batches, then never again. Measured
 * on a YouTube watch page: 0.83ms per sweep, 0 matches, 3.3ms/s while it lasts,
 * 66ms of pure waste per page load -- and it stops on its own, which is exactly
 * the "choppy right after a reload, fine once it settles" shape. */
check('the search cleanup has a host gate',
  /SEARCH_CLEANUP_HOST=/.test(SRC),
  'settings alone let a Google-results feature scan every site');
check('and the gate is host-only, not path-based',
  /SEARCH_CLEANUP_HOST=\/\(\^\|\\.\)google\\.\[a-z\.\]\+\$\/i\.test\(location\.hostname\)\|\|\/\^search\\.brave\\.com\$\/i\.test\(location\.hostname\)/.test(SRC),
  'SEARCH_IS_GOOGLE also tests the path and is computed once, so it cannot gate an SPA');
check('the sweep will not start off a search host',
  /if\(googleCleanupStarted\|\|!SEARCH_CLEANUP_HOST\|\|!SEARCH_AI_ON&&!SEARCH_ADS_ON\)return;/.test(SRC),
  'this is what stopped it running 80 whole-document scans on every YouTube load');
check('the shipped engine carries the gate', /SEARCH_CLEANUP_HOST/.test(MIN));

/* ---- 6. scan each added subtree once, not once per added ancestor -------- *
 * A page that builds itself appends a container and then appends children into
 * it; each child arrives as its own mutation record. Every consumer scanned
 * each added node's subtree, so a container's scan and each descendant's scan
 * returned overlapping sets. Measured over a real page load with the engine's
 * own six selectors:
 *
 *   Wikipedia article  6994 added elements  6762 nested (96.7%)  74.4% less time
 *   github.com/repo    2095 added elements  1794 nested (85.6%)  85.3% less time
 *   bbc.co.uk/news     1356 added elements  1205 nested (88.9%)  62.8% less time
 *
 * On Wikipedia that was 34,489 duplicate matches out of 45,517 -- the same
 * elements found again once per added ancestor. Scanning only the outermost
 * added nodes returns the identical set, because any node with an added
 * ancestor lies inside that ancestor's subtree.
 *
 * The narrowing applies ONLY to the subtree scans. Node-level guards still run
 * on every added node: several test a node in a way the ancestor's selector
 * would not repeat -- the grabber check reads src off any tag, not just
 * img/script/iframe -- so narrowing those would drop checks, not duplicates. */
check('the batch splitter exists', /function __woBatchNodes\(muts\)\{/.test(SRC));
check('the dispatcher computes it once and shares it with every consumer',
  /const batch=__woBatchNodes\(muts\);for\(let i=0;i<__woMoConsumers\.length;i\+\+\)try\{__woMoConsumers\[i\]\(muts,batch\.added,batch\.roots\)\}/.test(MIN),
  'computing it per consumer would pay the ancestor walk once per consumer');
check('the intranet guard still sees every added node',
  /for\(let i=0;i<added\.length;i\+\+\)guardLocalNode\(added\[i\]\);for\(let i=0;i<roots\.length;i\+\+\)sweepLocal\(roots\[i\]\)/.test(MIN),
  'it has to neuter a script pointing at a private address before it loads');
check('the grabber src test still sees every added node',
  /for\(let i=0;i<added\.length;i\+\+\)\{const n=added\[i\],hit=n\.getAttribute&&isGrabberURL\(n\.getAttribute\("src"\)\)/.test(MIN),
  'it reads src off any tag, which sweepNodes\' selector would not repeat');
check('no consumer still walks addedNodes itself',
  !/for\(const mu of muts\)for\(const n of mu\.addedNodes\)/.test(MIN)
    && !/for\(const m of muts\)for\(const n of m\.addedNodes/.test(MIN),
  'a consumer left on the old walk keeps paying the duplicate scans');

/* The root computation, run for real against a tree of the shape that produced
   those numbers. A negative control follows: it must not simply return
   everything, and the roots it returns must cover every added node. */
(() => {
  const vm = require('vm');
  const s = MIN.indexOf('function __woBatchNodes(muts){');
  const e = MIN.indexOf('function woObserve(cb){', s);
  check('the splitter is where the slice expects it', s >= 0 && e > s);
  if (s < 0 || e < s) return;
  const box = { Set };
  vm.createContext(box);
  vm.runInContext(MIN.slice(s, e) + ';globalThis.__split=__woBatchNodes;', box,
    { filename: 'content.min.js:batch' });
  const split = box.__split;

  /* nodeType 1 unless said otherwise; parentElement is the real link. */
  const el = (parent) => ({ nodeType: 1, parentElement: parent || null });
  const covers = (roots, node) => {
    for (const r of roots) {
      if (r === node) return true;
      for (let p = node.parentElement; p; p = p.parentElement) if (p === r) return true;
    }
    return false;
  };

  const container = el();
  const kid1 = el(container);
  const kid2 = el(container);
  const deep = el(kid1);
  /* An intermediate that was NOT itself added -- the grandchild is still
     covered by the container, and must still be recognised as nested. */
  const gap = el(container);
  const belowGap = el(gap);
  const loner = el();
  const text = { nodeType: 3, parentElement: null };

  const batch = [container, kid1, kid2, deep, belowGap, loner, text];
  const out = split([{ addedNodes: batch }]);

  check('text nodes are dropped', out.added.indexOf(text) < 0 && out.added.length === 6);
  check('only the outermost added nodes are roots',
    out.roots.length === 2 && out.roots.indexOf(container) >= 0 && out.roots.indexOf(loner) >= 0,
    'got ' + out.roots.length + ' roots');
  check('a node whose added ancestor is two levels up is still nested',
    out.roots.indexOf(belowGap) < 0,
    'the walk must not stop at the first non-added parent');
  check('every added node is covered by some root',
    out.added.every((n) => covers(out.roots, n)),
    'this is the whole safety argument -- an uncovered node would go unscanned');
  /* Negative control: the containment test above passes trivially if the
     splitter just returns everything, so prove it does not. */
  check('the splitter really narrows the set',
    out.roots.length < out.added.length,
    'returning every node would pass the coverage check and save nothing');

  const flat = [el(), el(), el()];
  const flatOut = split([{ addedNodes: flat }]);
  check('an unnested batch keeps every node as a root', flatOut.roots.length === 3);
  const one = split([{ addedNodes: [el()] }]);
  check('a single-node batch skips the ancestor walk entirely',
    one.roots === one.added && one.roots.length === 1,
    'the common case must not allocate a Set');
  check('an empty batch is empty', split([{ addedNodes: [] }]).roots.length === 0);
})();

/* ---- 7. the rect noise sits in front of the hottest read on a video page - *
 * With anti-fingerprint noise on, Element.prototype.getBoundingClientRect is
 * wrapped, and a video player recomputes the scrub position from it on every
 * mousemove. The wrapper built a string key from the four numbers and then
 * hashed it four separate times -- four concatenations, four walks over ~25
 * characters, four generator closures per call. Seeding once from the numbers
 * and drawing four values from that generator measured 1.052us -> 0.044us per
 * call, 24x cheaper, with the same guarantees: same geometry gives the same
 * noise, a different session seed gives different noise, and the offsets stay
 * inside the same bounds. The checks below are those guarantees, run against
 * the shipped code -- a faster wrapper that stopped varying per session, or
 * per geometry, would be a weaker defence, not a saving. */
check('the rect noise no longer builds a string key per call',
  !/const k=\(r\.x\|\|r\.left\|\|0\)\+","\+/.test(MIN),
  'that string plus four hashes of it was the whole cost');
check('it seeds once from the four numbers instead',
  /const rectSeed=\(a,b,c,d\)=>\{let h=\(_sk\^2166136261\)>>>0;/.test(MIN));
check('the session seed still goes into it',
  /rectSeed=\(a,b,c,d\)=>\{let h=\(_sk\^/.test(MIN),
  'without _sk the noise would be identical for every visitor, i.e. useless');

(() => {
  const vm = require('vm');
  const a = MIN.indexOf('const rectSeed=(a,b,c,d)=>{');
  const b = MIN.indexOf('patchRectProto=proto=>{', a);
  check('the rect wrapper is where the slice expects it', a >= 0 && b > a);
  if (a < 0 || b < a) return;
  class DOMRect {
    constructor(x, y, w, h) { this.x = x; this.y = y; this.width = w; this.height = h; }
  }
  const makeRnd = (seed) => {
    let s = (seed >>> 0) || 1;
    return () => (s = (1664525 * s + 1013904223) >>> 0, s / 4294967296);
  };
  const load = (sk) => {
    const box = { DOMRect, Math, _sk: sk, makeRnd };
    vm.createContext(box);
    vm.runInContext(MIN.slice(a, b) + '__x=0;globalThis.__w=wrapRect;', box,
      { filename: 'content.min.js:wrapRect' });
    return box.__w;
  };
  const wrap = load(123456789);
  const R = { x: 10, y: 20, width: 100, height: 50 };
  const r1 = wrap(R), r2 = wrap({ x: 10, y: 20, width: 100, height: 50 });
  check('the same geometry always gets the same noise',
    r1.x === r2.x && r1.y === r2.y && r1.width === r2.width && r1.height === r2.height,
    'a rect that jittered between reads would break layout maths on real pages');
  check('the offset stays inside the declared bounds',
    Math.abs(r1.x - 10) <= 0.02 && Math.abs(r1.y - 20) <= 0.02
      && Math.abs(r1.width - 100) <= 0.015 && Math.abs(r1.height - 50) <= 0.015,
    'noise larger than a sub-pixel would be visible, not a defence');
  check('a zero-size rect never goes negative', wrap({ x: 0, y: 0, width: 0, height: 0 }).width >= 0);
  check('a missing rect passes straight through', wrap(null) === null);
  check('a different session seed produces different noise',
    load(987654321)({ x: 10, y: 20, width: 100, height: 50 }).x !== r1.x,
    'the defence is that the value cannot be predicted across sessions');
  /* Negative control: constant noise would satisfy every check above except
     this one, and would fingerprint just as well as no noise at all. */
  const offsets = new Set();
  for (let i = 0; i < 500; i++) offsets.add(wrap({ x: i, y: 0, width: 100, height: 20 }).x - i);
  check('the noise really varies per rect', offsets.size > 400,
    'got ' + offsets.size + ' distinct offsets over 500 rects; a constant would pass the rest');
})();

/* ---- the shipped bundle carries all of it ------------------------------- */
check('the built engine has the hoists', /if\(userGestured\)return;/.test(MIN)
  && /if\(!WO\.socialWidgetGuard\)return;/.test(MIN),
  'src and content.min.js are kept in sync by build-content --check');

if (failed) {
  console.error('engine mutation cost: ' + failed + ' failed');
  process.exit(1);
}
console.log('engine mutation cost: all checks passed');
