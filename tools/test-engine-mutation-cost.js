/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/* Guard the shared mutation observer's hot paths. Whole-document sweeps must
   coalesce on video pages, and disabled consumers must skip traversal before
   scanning each added subtree. */
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

/* ---- 1. whole-document work must be coalesced, on every branch ----------- */

/* The video-platform branch. It returns early, so its coalesce has to be inside
   the branch rather than relying on the one further down. */
/* Anchored on the mutation-observer consumer, NOT on the first
   `if(scriptletPlayerPage()){` in the file -- that one belongs to the
   rules-arrival path, which is a one-shot and may call the scan directly. */
const playerBranch = (() => {
  const marker = SRC.indexOf('const routeChanged=observedCosmeticUrl!==location.href;');
  const a = marker < 0 ? -1 : SRC.lastIndexOf('woObserve(', marker);
  const b = SRC.indexOf('if(styleEl&&!styleEl.isConnected)', a);
  return a >= 0 && b > a ? SRC.slice(a, b) : '';
})();
check('the video-platform branch is still there', !!playerBranch);
check('text-only mutation batches cannot schedule the player cosmetic scan',
  /if\(!structural&&!routeChanged\)return void scheduleProcedural\(\);/.test(playerBranch),
  'changing a volume label cannot create an element matched by an ad selector');
check('an SPA route change reaches player safe mode even with only text churn',
  playerBranch.indexOf('routeChanged') < playerBranch.indexOf('scriptletPlayerPage(routeChanged')
    && playerBranch.indexOf('scriptletPlayerPage(routeChanged') < playerBranch.indexOf('procRules=[]'),
  'generic cosmetic CSS must be cleared when an ordinary SPA enters a player route');
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

(() => {
  const vm = require('vm');
  const detectorStart = SRC.indexOf('playerPageDetected=(()=>{');
  const detectorEnd = SRC.indexOf(';\n    !function', detectorStart);
  check('the cached player detector is where the test expects it',
    detectorStart >= 0 && detectorEnd > detectorStart);
  if (detectorStart < 0 || detectorEnd <= detectorStart) return;
  const box = {
    now: 1000,
    hasPlayer: false,
    location: { pathname: '/home' },
    Date: { now: () => box.now },
    document: { querySelector: () => (box.hasPlayer ? {} : null) },
  };
  vm.createContext(box);
  vm.runInContext('const PLAYER_ROUTE_RE=/watch/;const PLAYER_PAGE_SELECTOR="video";const '
    + SRC.slice(detectorStart, detectorEnd) + ';this.__detect=playerPageDetected;', box,
  { filename: 'content.js:player-cache' });
  check('the negative player scan is cached normally', box.__detect() === false);
  box.hasPlayer = true;
  box.now = 1100;
  check('an ordinary read still sees the short-lived cached result', box.__detect() === false);
  check('a structural player candidate forces a fresh read', box.__detect(true) === true);

  const batchStart = SRC.indexOf('adBatchAddsPlayer=(added,');
  const batchEnd = SRC.indexOf(',\n      pageMutationScriptletRuntimeOn=', batchStart);
  check('the added-player detector is where the test expects it', batchStart >= 0 && batchEnd > batchStart);
  check('player selectors are captured before the runtime starts',
    SRC.indexOf('const __woNativeMatches=Element.prototype.matches,') >= 0
      && SRC.indexOf('const __woNativeMatches=Element.prototype.matches,') < SRC.indexOf('const __woStartRuntime='));
  if (batchStart < 0 || batchEnd <= batchStart) return;
  box.__woNativeMatches = function (selector) {
    return this.nativeMatches ? this.nativeMatches(selector) : this.matches(selector);
  };
  box.__woNativeQuerySelector = function (selector) {
    return this.nativeQuerySelector ? this.nativeQuerySelector(selector)
      : this.querySelector ? this.querySelector(selector) : null;
  };
  vm.runInContext('const ' + SRC.slice(batchStart, batchEnd)
    + ';this.__batchAddsPlayer=adBatchAddsPlayer;', box,
  { filename: 'content.js:added-player' });
  const nestedPlayer = { matches: () => false, querySelector: () => ({ tagName: 'VIDEO' }) };
  box.nestedPlayer = nestedPlayer;
  check('a player nested in a newly added subtree is detected',
    vm.runInContext('__batchAddsPlayer([nestedPlayer], [nestedPlayer])', box) === true);
  let redundantMatches = 0;
  const plainRoot = { isConnected: true, matches: () => false, querySelector: () => null };
  const connectedChildren = Array.from({ length: 1000 }, () => ({
    isConnected: true, matches: () => { redundantMatches++; return false; },
  }));
  box.plainRoot = plainRoot;
  box.connectedChildren = connectedChildren;
  check('connected descendants are covered by the root scan once',
    vm.runInContext('__batchAddsPlayer([plainRoot, ...connectedChildren], [plainRoot])', box) === false
      && redundantMatches === 0);
  const removedPlayer = { isConnected: false, matches: () => true };
  box.removedPlayer = removedPlayer;
  check('a player removed before mutation delivery is still detected',
    vm.runInContext('__batchAddsPlayer([plainRoot, removedPlayer], [plainRoot])', box) === true);
  const playerRoot = { isConnected: true, matches: () => true };
  box.playerRoot = playerRoot;
  check('a player added as the root enters safe mode',
    vm.runInContext('__batchAddsPlayer([playerRoot], [playerRoot])', box) === true);
  const patchedRoot = { isConnected: true, matches: () => false,
    querySelector: () => { throw new Error('page-patched selector'); } };
  const connectedPlayer = { isConnected: true, matches: () => true };
  box.patchedRoot = patchedRoot;
  box.connectedPlayer = connectedPlayer;
  check('a patched root selector falls back to connected added nodes',
    vm.runInContext('__batchAddsPlayer([patchedRoot, connectedPlayer], [patchedRoot])', box) === true);
  const patchedPlayerRoot = { isConnected: true, matches: () => false,
    nativeMatches: () => true, querySelector: () => null };
  box.patchedPlayerRoot = patchedPlayerRoot;
  check('a page-patched matches method cannot hide a player root',
    vm.runInContext('__batchAddsPlayer([patchedPlayerRoot], [patchedPlayerRoot])', box) === true);

  const observerStart = SRC.indexOf('woObserve((muts,added,roots,structural)=>{',
    SRC.indexOf('observedCosmeticUrl=location.href,'));
  const observerEnd = SRC.indexOf('\n                })', observerStart);
  check('the AdShield observer is where the test expects it', observerStart >= 0 && observerEnd > observerStart);
  if (observerStart < 0 || observerEnd <= observerStart) return;
  const observer = SRC.slice(observerStart + 'woObserve('.length, observerEnd) + '\n}';
  const runtime = (pathname = '/home') => {
    const state = {
      now: 1000, hasPlayer: false, documentQueries: 0, rootQueries: 0, nodeMatches: 0,
      scheduled: 0, timeouts: [],
      location: { pathname, href: 'https://example.test' + pathname },
      observedCosmeticUrl: 'https://example.test' + pathname,
      procRules: [{}], collapsePending: false, adShieldVideoPlatform: false,
      styleEl: { isConnected: true, textContent: '.generic-ad{display:none}' },
      Date: { now: () => state.now },
      document: { querySelector: () => {
        state.documentQueries++;
        return state.hasPlayer ? {} : null;
      } },
      __woNativeMatches: function () { state.nodeMatches++; return !!this.player; },
      __woNativeQuerySelector: function () { state.rootQueries++; return this.nestedPlayer || null; },
      scheduleProcedural: () => state.scheduled++,
      setTimeout: (callback, delay) => state.timeouts.push({ callback, delay }),
    };
    vm.createContext(state);
    vm.runInContext('const PLAYER_ROUTE_RE=/watch/;const PLAYER_PAGE_SELECTOR="video";const '
      + SRC.slice(detectorStart, detectorEnd) + ';const ' + SRC.slice(batchStart, batchEnd)
      + ';const scriptletPlayerPage=force=>playerPageDetected(force);this.__detect=playerPageDetected;'
      + 'this.__observe=' + observer + ';', state, { filename: 'content.js:player-observer' });
    return state;
  };
  const plain = { isConnected: true };
  for (const known of ['route', 'cached player']) {
    const state = runtime(known === 'route' ? '/watch' : '/home');
    if (known === 'cached player') {
      state.hasPlayer = true;
      state.__detect();
    }
    const documentQueries = state.documentQueries;
    state.__observe([], [plain], [plain], true);
    check('a known ' + known + ' skips every added-subtree player query',
      state.rootQueries === 0 && state.nodeMatches === 0
        && state.documentQueries === documentQueries && state.styleEl.textContent === ''
        && state.procRules.length === 0);
  }
  const staleFalse = runtime();
  staleFalse.__detect();
  staleFalse.hasPlayer = true;
  const inserted = { isConnected: true, nestedPlayer: {} };
  staleFalse.__observe([], [inserted], [inserted], true);
  check('a player added inside the negative cache window still enters safe mode',
    staleFalse.documentQueries === 1 && staleFalse.rootQueries === 1
      && staleFalse.styleEl.textContent === '' && staleFalse.procRules.length === 0);

  const detached = runtime();
  detached.__detect();
  detached.__observe([], [plain, { isConnected: false, player: true }], [plain], true);
  check('an added player detached before delivery still bypasses the negative cache',
    detached.documentQueries === 1 && detached.rootQueries === 1
      && detached.styleEl.textContent === '' && detached.procRules.length === 0);

  for (const remains of [false, true]) {
    const state = runtime();
    state.hasPlayer = true;
    state.__detect();
    state.hasPlayer = remains;
    state.__observe([], [], [], true);
    check('a removal-only batch refreshes cached player presence: ' + remains,
      state.documentQueries === 2 && state.rootQueries === 0
        && state.scheduled === (remains ? 0 : 1)
        && (state.styleEl.textContent === '') === remains);
  }
  const textOnly = runtime('/watch');
  textOnly.__observe([], [], [], false);
  check('text-only player churn skips both player detection and cosmetic collapse',
    textOnly.documentQueries === 0 && textOnly.rootQueries === 0
      && textOnly.nodeMatches === 0 && textOnly.timeouts.length === 0
      && textOnly.scheduled === 1 && textOnly.procRules.length === 1);

  const routeChange = runtime();
  routeChange.__detect();
  routeChange.location.pathname = '/watch';
  routeChange.location.href = 'https://example.test/watch';
  routeChange.__observe([], [], [], false);
  check('an SPA player route change clears generic cosmetics during text-only churn',
    routeChange.styleEl.textContent === '' && routeChange.procRules.length === 0
      && routeChange.observedCosmeticUrl === routeChange.location.href
      && routeChange.rootQueries === 0);
})();

/* The ordinary-page branch, unchanged. */
check('the ordinary-page branch still coalesces too',
  (SRC.match(/collapsePending\|\|\(collapsePending=!0,/g) || []).length >= 2,
  'both branches route through the throttle');

/* Direct calls are fine where they are one-shots -- when cosmetic rules arrive.
   What must never come back is a direct call on the MUTATION path, so this pins
   the observer consumer rather than counting calls file-wide. */
check('no woObserve consumer calls the whole-document collapse directly',
  !/woObserve\((?:\(\)|muts)=>\{[\s\S]{0,900}?collapseLeftovers\(document\)[,;]/.test(
    SRC.replace(/collapsePending\|\|\(collapsePending=!0,[\s\S]*?250\)\)/g, 'COALESCED')),
  'a direct call on the mutation path is the 0.71ms-per-batch scan again');

/* Meta Refresh is a security check, so it stays synchronous. What cannot stay is
   its old shape: every child-list mutation queried the entire document for metas,
   including a player replacing one numeric volume label. Run the actual callback
   to pin both halves of the contract -- text churn is free, inserted metas are not
   missed. */
(() => {
  const vm = require('vm');
  const a = SRC.indexOf('const META_REFRESH_SELECTOR=');
  const b = SRC.indexOf('killMeta(),', a);
  check('the node-local meta-refresh scanner is where the test expects it', a >= 0 && b > a);
  if (a < 0 || b <= a) return;
  let documentQueries = 0;
  const logs = [];
  const box = {
    WO: { __frozen: false },
    location: { href: 'https://safe.example/' },
    sameSite: () => false,
    isFederatedAuthTarget: () => false,
    isHighRiskNavigationTarget: () => true,
    log: (type) => logs.push(type),
    document: {
      querySelectorAll() { documentQueries++; return []; },
    },
  };
  vm.createContext(box);
  vm.runInContext(SRC.slice(a, b)
    + 'this.__killMeta=killMeta;this.__auditMetaAttributes=auditMetaAttributes;', box,
    { filename: 'content.js:meta-refresh-mutation' });

  for (let i = 0; i < 2000; i++) box.__killMeta([{
    type: 'childList', addedNodes: [{ nodeType: 3, nodeValue: String(i % 101) }],
  }], [], []);
  check('text-only slider churn performs no document-wide meta queries', documentQueries === 0,
    'a full query per volume update is the residual Spotify hot path');

  const attrs = { 'http-equiv': 'refresh', content: '0; url=https://danger.example/' };
  const meta = {
    matches: (selector) => selector === 'meta[http-equiv="refresh" i]',
    querySelectorAll: () => [],
    getAttribute: (name) => attrs[name] || '',
    setAttribute: (name, value) => { attrs[name] = value; },
    removeAttribute: (name) => { delete attrs[name]; },
  };
  const root = {
    matches: () => false,
    querySelectorAll: () => [meta],
  };
  box.__killMeta([{ type: 'childList', addedNodes: [root] }], [root], [root]);
  check('a refresh meta nested in an added subtree is still blocked',
    attrs.content === undefined && attrs['data-wo-disabled'] === '0; url=https://danger.example/'
      && logs.includes('blocked_meta_refresh'));

  const changedAttrs = {
    'http-equiv': 'refresh', content: '5; url=https://later-danger.example/',
  };
  const changedMeta = {
    matches: (selector) => selector === 'meta[http-equiv="refresh" i]',
    getAttribute: (name) => changedAttrs[name] || '',
    setAttribute: (name, value) => { changedAttrs[name] = value; },
    removeAttribute: (name) => { delete changedAttrs[name]; },
  };
  box.__auditMetaAttributes([{
    type: 'attributes', attributeName: 'content', target: changedMeta,
  }]);
  check('activating an existing meta refresh through attributes is still blocked',
    changedAttrs.content === undefined
      && changedAttrs['data-wo-disabled'] === '5; url=https://later-danger.example/');
  const metaObserver = SRC.slice(b, SRC.indexOf('if(WO.detectRedirectChains)', b));
  check('meta attribute coverage is narrow enough to avoid ordinary UI state churn',
    /attributeFilter:\["http-equiv",\s*"content"\]/.test(metaObserver)
      && !/attributeFilter:[\s\S]*?(?:class|aria-|value)/.test(metaObserver),
    'watching broad attributes would move player changes onto another observer');
})();

/* ---- 2. a flag that gates the work belongs above the traversal ----------- */

function sweepBody(name) {
  const a = SRC.indexOf(name + '=root=>{');
  if (a < 0) return '';
  const b = SRC.indexOf('querySelectorAll', a);
  return b > a ? SRC.slice(a, b) : '';
}

check('disabled autoplay protection skips subtree media scans',
  /if\(!WO\.blockAutoplay\)return;/.test(sweepBody('const sweepMedia')));

/* guardSocialNode tests this flag before it looks at the element at all. */
check('sweepSocialWidgets checks its flag before it walks anything',
  /if\(!WO\.socialWidgetGuard\)return;/.test(sweepBody('sweepSocialWidgets')),
  '9.8us per added node collecting nodes it was about to discard');

/* The pattern this follows -- already correct, and the reason the other two
   looked wrong next to it. */
check('sweepDomLinks still gates before walking, as it always did',
  /if\(!WO\.unshimLinks\)return;/.test(sweepBody('sweepDomLinks')));

/* Guard the guards: a hoist is only valid while the per-element function really
   does bail on that condition first. If those change, the hoist is a behaviour
   change rather than a saving, and this should fail. */
check('approved media is skipped before reading or changing author state',
  /const tameMedia=m=>\{\s*try\{\s*if\(!WO\.blockAutoplay\|\|autoplayApprovedMedia\.has\(m\)\)return;/.test(SRC));
check('guardSocialNode still bails on the flag first',
  /guardSocialNode=el=>\{\s*try\{\s*if\(!WO\.socialWidgetGuard\|\|/.test(SRC),
  'the hoist above is only behaviour-preserving while this holds');
{
  const body = SRC.slice(SRC.indexOf('guardSocialNode=el=>{'), SRC.indexOf('sweepSocialWidgets=root=>{'));
  let reads = 0;
  let placeholders = 0;
  const sandbox = {
    WO: { socialWidgetGuard: true },
    makeSocialPlaceholder() { placeholders++; return {}; },
    log() {},
  };
  vm.createContext(sandbox);
  vm.runInContext('let guardSocialNode;\n' + body.replace(/,\s*$/, ';') + '\nthis.guard = guardSocialNode;', sandbox);
  const node = (cls, attrs = {}) => ({
    tagName: 'DIV', className: cls, id: '',
    getAttribute(name) { reads++; return attrs[name] || null; },
    getBoundingClientRect() { return { height: 100 }; },
    cloneNode() { return {}; },
    parentNode: { replaceChild() {} },
  });
  sandbox.guard(node('ordinary-card'));
  check('ordinary added nodes need no social marker reads', reads === 0);
  sandbox.guard(node('fb-post', { 'data-wo-social-loaded': '1' }));
  check('loaded social widgets keep their marker exemption', placeholders === 0);
  sandbox.guard(node('fb-post'));
  check('unmarked social widgets still get a placeholder', placeholders === 1);
}

/* ---- 2b. gate the CONSUMER, not just the sweep --------------------------- *
 * Hoisting the flag into the sweep stopped the querySelectorAll, but the
 * consumer still walked every added node to call it. Where every branch of a
 * consumer's loop bails on the same condition, the condition belongs on the
 * consumer, so the walk is skipped too. Each of these is behaviour-identical
 * only because the per-element function tests exactly the same thing first --
 * which the checks below pin. */
check('the disabled media consumer gates before walking added nodes',
  /if\(!WO\.blockAutoplay\)return;\s*for\(let i=0;\s*i<added\.length;\s*i\+\+\)\{\s*const n=added\[i\];\s*\/\^\(VIDEO\|AUDIO\)\$\/\.test\(n\.tagName\)&&tameMedia\(n\)/.test(SRC));
check('the social consumer gates before walking added nodes',
  /if\(!WO\.socialWidgetGuard\)return;\s*for\(let i=0;\s*i<added\.length;\s*i\+\+\)guardSocialNode\(added\[i\]\)/.test(SRC),
  'guardSocialNode and sweepSocialWidgets both test it first');
check('the dom-link consumer gates before walking added nodes',
  /if\(!WO\.unshimLinks\)return;\s*for\(let i=0;\s*i<added\.length;\s*i\+\+\)scrubDomLink\(added\[i\]\)/.test(SRC),
  'scrubDomLink and sweepDomLinks both test it first');
/* Not anchored on `const`: scrubDomLink shares its declaration with the ping-attribute
   scrubber that now sits above it, so the keyword is on that one. The bail condition is
   what this check is about, and it is unchanged. */
check('scrubDomLink really does bail on the same condition',
  /\bscrubDomLink=el=>\{\s*try\{\s*if\(!WO\.unshimLinks\|\|/.test(SRC),
  'the consumer gate is only behaviour-preserving while this holds');

/* Range controls can only carry a bounded numeric UI value. Running password,
   card-hint and Luhn classification on every seek/volume input cannot discover a
   credential, but it does put those guards directly on the drag path. */
const sensitiveFieldBody = (() => {
  const a = SRC.indexOf('const isSensitiveField=');
  const b = SRC.indexOf('skimmerPageSensitive=', a);
  return a >= 0 && b > a ? SRC.slice(a, b) : '';
})();
const cardFieldBody = (() => {
  const a = SRC.indexOf('fieldLooksCard=');
  const b = SRC.indexOf('seenCards=', a);
  return a >= 0 && b > a ? SRC.slice(a, b) : '';
})();
check('the skimmer input classifier rejects range controls before hint matching',
  /"range"!==String\(el\.type\|\|""\)\.toLowerCase\(\)/.test(sensitiveFieldBody));
check('the payment input classifier rejects range controls before hint and Luhn work',
  /"range"===String\(el\.type\|\|""\)\.toLowerCase\(\)/.test(cardFieldBody));

const formTrapObserver = (() => {
  const a = SRC.indexOf('woObserve((muts,added,roots,structural)=>{', SRC.indexOf('TRAP_THRESHOLD='));
  const b = SRC.indexOf('log("form_trap_detector_on"', a);
  return a >= 0 && b > a ? SRC.slice(a, b) : '';
})();
const formTrapTextFilter = (() => {
  const a = SRC.indexOf('passwordUiRoots=new WeakSet,');
  const b = SRC.indexOf(',\n      scanForms=', a);
  return a >= 0 && b > a ? SRC.slice(a, b) : '';
})();
check('form-trap skips only unrelated non-structural batches',
  /if\(!structural&&!trapTextTouchesPasswordUi\(muts\)\)return;/.test(formTrapObserver),
  'removing a visible password field can expose a hidden autofill trap and must rescan');
check('a newly discovered password field is added to the local UI index',
  /for\(const pw of pwFields\)\{\s*notePasswordUi\(pw\),\s*initialPw\.has\(pw\)\|\|injectedForms\.add\(pw\);/.test(SRC),
  'an existing input can become type=password without being inserted as a new node');

(() => {
  const vm = require('vm');
  check('the form-trap text filter is where the test expects it', !!formTrapTextFilter);
  if (!formTrapTextFilter) return;
  const box = {
    WeakSet, WeakMap, Set, Array, String,
    credentialTrapFilled: (pw) => !!(pw && pw.value),
    document: { body: {}, documentElement: {} },
  };
  vm.createContext(box);
  vm.runInContext('const ' + formTrapTextFilter
    + ';this.__touches=trapTextTouchesPasswordUi;this.__note=notePasswordUi;', box,
  { filename: 'content.js:form-trap-text-filter' });
  const text = { nodeType: 3, nodeValue: 'Volume 61' };
  const unrelated = {
    addedNodes: [text],
    target: {
      textContent: 'Volume 61', closest: () => null, querySelector: () => null, parentElement: null,
    },
  };
  check('ordinary text-only player churn is ignored', !box.__touches([unrelated]));
  const loginText = { nodeType: 3, nodeValue: 'Sign in to Coinbase' };
  const password = { type: 'password' };
  const form = {
    parentElement: box.document.body,
    querySelector: () => (password.type === 'password' ? password : null),
  };
  password.closest = () => form;
  password.parentElement = form;
  box.__note(password);
  const inForm = {
    addedNodes: [loginText],
    target: {
      textContent: 'Sign in to Coinbase',
      parentElement: form,
    },
  };
  check('text inserted into an existing password form still rescans', box.__touches([inForm]));
  const localPassword = { type: 'password', closest: () => null };
  const localContainer = {
    parentElement: box.document.body,
    querySelector: () => (localPassword.type === 'password' ? localPassword : null),
  };
  localPassword.parentElement = localContainer;
  box.__note(localPassword);
  let innerContainer = localContainer;
  for (let i = 0; i < 12; i++) {
    innerContainer = { parentElement: innerContainer };
  }
  const formless = {
    addedNodes: [loginText],
    target: {
      textContent: 'Sign in to Coinbase',
      parentElement: innerContainer,
    },
  };
  check('nested text inserted in a form-less password UI still rescans', box.__touches([formless]));
  localPassword.type = 'text';
  check('a reused UI root stops waking scans after losing its password field',
    !box.__touches([formless]));
  const broadPassword = {
    type: 'password', value: '', isConnected: true,
    closest: () => null, parentElement: box.document.body,
  };
  box.__note(broadPassword);
  broadPassword.value = 'password-manager-fill';
  check('a direct-body password fill is noticed without scanning every body mutation',
    box.__touches([unrelated]));
  check('an unchanged direct-body password does not keep waking scans',
    !box.__touches([unrelated]));
  const bodyBrandText = { nodeType: 3, nodeValue: 'Sign in to Google' };
  check('brand text still wakes a direct-body form-less password UI', box.__touches([{
    addedNodes: [bodyBrandText], removedNodes: [],
    target: { childNodes: [bodyBrandText], parentElement: box.document.body },
  }]));
  const afterRemoval = {
    addedNodes: [],
    removedNodes: [{ nodeType: 3, nodeValue: 'securely ' }],
    target: {
      textContent: 'Sign in to Google',
      parentElement: form,
    },
  };
  check('removing text that reveals a login claim still rescans', box.__touches([afterRemoval]));
  const fragmentTarget = {
    textContent: 'Sign in to Google',
    parentElement: form,
  };
  check('a fragmented login claim still rescans', box.__touches([{
    addedNodes: [{ nodeType: 3, nodeValue: 'Google' }], target: fragmentTarget,
  }]));
})();

check('text-only form-trap rescans stay within a local password UI',
  /passwordUiRoots=new WeakSet/.test(formTrapTextFilter)
    && /broadPasswordFields=new Set/.test(formTrapTextFilter)
    && /broadPasswordFilled=new WeakMap/.test(formTrapTextFilter)
    && /trapTextTouchesPasswordUi=muts=>\{/.test(formTrapTextFilter)
    && !/textContent/.test(formTrapTextFilter)
    && /for\(;scope;scope=scope\.parentElement\)/.test(formTrapTextFilter)
    && /passwordUiRoots\.has\(scope\)[\s\S]{0,350}?scope\.querySelector/.test(formTrapTextFilter)
    && /passwordUiRoots\.delete\(scope\)/.test(formTrapTextFilter)
    && /pruneBroadPasswordFields\(\);[\s\S]{0,350}?filled!==previous/.test(formTrapTextFilter)
    && /broadPasswordFields\.size&&trapMutationHasLoginText\(muts\)/.test(formTrapTextFilter)
    && /scope===document\.body\|\|scope===document\.documentElement/.test(formTrapTextFilter),
  'a player changing a text label must not serialize or scan a DOM subtree');

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
/* Since PERF-03 both passes take the scheduler's shared snapshot and fall back to the bounded
   reader only when called without one. */
const scamBody = (() => {
  const a = SRC.indexOf('scamScan=snapshot=>{');
  return a < 0 ? '' : SRC.slice(a, a + 600);
})();
const fakeBody = (() => {
  const a = SRC.indexOf('fakeUpdateScan=snapshot=>{');
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
check('selector-only AdShield paths ignore text-only batches',
  (SRC.match(/woObserve\(\(muts,added,roots,structural\)=>\{\s*if\(!structural\)return;/g) || []).length >= 1
    && /woObserve\(\(muts,added,roots,structural\)=>\{\s*structural&&__woSchedAds\(\)/.test(SRC),
  'selector-based ad cleanup only needs to run when the element structure changes');
const textProceduralRules = (fs.readFileSync('cosmetic-rules.json', 'utf8')
  .match(/:(?:has-text|contains|-abp-contains|min-text-length)\(/g) || []).length;
check('the shipped cosmetic data actually contains text-sensitive procedural rules',
  textProceduralRules > 0, 'without a real rule this regression check would be hypothetical');
check('text-only batches still coalesce a procedural-rule scan',
  /scheduleProcedural=\(\)=>\{[\s\S]{0,500}?runProcedural\(\)/.test(SRC)
    && /if\(!structural&&!routeChanged\)return void scheduleProcedural\(\);/.test(SRC),
  'pre-existing ad shells can become matches when only their text changes');
check('the generic ad observer reuses the shared mutation dispatcher',
  !/__woObserver\(muts=>\{\s*__woHasElementMutation/.test(SRC)
    && /woObserve\(\(muts,added,roots,structural\)=>\{\s*structural&&__woSchedAds\(\)/.test(SRC),
  'a second document observer adds another callback to every slider mutation');
check('the shipped engine carries the idle scheduler',
  (MIN.match(/__woIdle\(/g) || []).length >= 4);

/* ---- 4b. the layout-forcing scans go to idle too ------------------------- *
 * scanPageForClickFix reads body.innerText, which forces a synchronous layout.
 * Every mutation batch re-arms its timer, so while a page is building it fires
 * repeatedly and stalls the pipeline mid-frame. Measured: 0.99ms with layout
 * dirty vs 0.15ms clean -- and during page build it is always dirty. Deferring
 * to idle changes WHEN the layout is forced, not whether the page is scanned;
 * the timeout keeps the protection on the same cadence. */
/* Since PERF-03 the three passes reach idle time through one shared scheduler rather than three
   observers of their own: each registers with __woTextScan, which arms a timer only for a batch
   whose added text matches the detector's own patterns, and then runs the pass in idle time with
   the same 600 ms timeout the three used to carry separately. */
const scheduler = (() => {
  const a = SRC.indexOf('__woTextScan=(()=>{');
  const b = SRC.indexOf('SITE_BOUNDARY=(()=>{', a);
  return a < 0 || b < 0 ? '' : SRC.slice(a, b);
})();
[['clickfix', 'scanPageForClickFix', 'forces a layout via body.innerText'],
 ['fake-update', 'fakeUpdateScan', 'reads the page text on every batch'],
 ['scam-lock', 'scamScan', 'same shape, on every other busy site']].forEach(([id, fn, why]) => {
  check(fn + ' runs through the shared scheduler, in idle time', SRC.indexOf('__woTextScan.add({\n        id:"' + id + '"') >= 0 || SRC.indexOf('__woTextScan.add({\n          id:"' + id + '"') >= 0, why);
});
check('and the scheduler keeps the timeout so a pass still runs on a page that never idles',
  /__woIdle\(\(\)=>\{[\s\S]{0,200}pass\(c,\s*trigger\)\s*\},\s*600\)/.test(scheduler),
  'without a timeout a page that never idles would never be scanned');
check('and no pass watches mutations on its own any more',
  !/__woIdle\((?:scanPageForClickFix|fakeUpdateScan|scamScan),/.test(SRC));

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

/* Scan only outermost added subtrees to eliminate duplicate matches.
   Node-level guards still need every added node because their checks are not equivalent to subtree selectors. */
check('the batch splitter exists', /function __woBatchNodes\(muts\)\{/.test(SRC));
check('the dispatcher computes it once and shares it with every consumer',
  /const batch=__woBatchNodes\(muts\);const consumers=batch\.sourceOnly\?__woMoSourceConsumers:__woMoConsumers;for\(let i=0;i<consumers\.length;i\+\+\)try\{consumers\[i\]\(muts,batch\.added,batch\.roots,batch\.structural\)\}/.test(MIN),
  'computing it per consumer would pay the ancestor walk once per consumer');
check('the shared observer limits source attributes to the image warning mode',
  /attributeFilter:__woMoImageSources\?\["type","src","srcset"\]:\["type"\]/.test(MIN),
  'ordinary UI attributes must stay outside the shared observer');
check('the intranet guard still sees every added node',
  /for\(let i=0;i<added\.length;i\+\+\)guardLocalNode\(added\[i\]\);for\(let i=0;i<roots\.length;i\+\+\)sweepLocal\(roots\[i\]\)/.test(MIN),
  'it has to neuter a script pointing at a private address before it loads');
check('the grabber src test still sees every added node',
  /for\(let i=0;i<added\.length;i\+\+\)\{const n=added\[i\],src=n\.getAttribute&&n\.getAttribute\("src"\),hit=!!src&&isGrabberURL\(src\)/.test(MIN),
  'it reads src off any tag, which sweepNodes\' selector would not repeat');
check('no consumer still walks addedNodes itself',
  !/for\(const mu of muts\)for\(const n of mu\.addedNodes\)/.test(MIN)
    && !/for\(const m of muts\)for\(const n of m\.addedNodes/.test(MIN),
  'a consumer left on the old walk keeps paying the duplicate scans');

(() => {
  const vm = require('vm');
  const start = SRC.indexOf('const __woMoConsumers=[]');
  const end = SRC.indexOf('/* The engine\'s authoritative config.', start);
  check('the shared observer can be tested in isolation', start >= 0 && end > start);
  if (start < 0 || end <= start) return;
  const options = [];
  let deliver;
  const box = {
    Set,
    document: { documentElement: {} },
    __woObserver(callback) {
      deliver = callback;
      return { observe(_target, option) { options.push(option); } };
    },
  };
  vm.runInNewContext(SRC.slice(start, end) + ';globalThis.register=woObserve;', box);
  let ordinary = 0;
  let images = 0;
  box.register(() => ordinary++);
  check('source attributes are not observed before image warnings start',
    options.length === 1 && options[0].attributeFilter.join(',') === 'type');
  box.register(() => images++, true);
  check('image warnings extend the existing observer',
    options.length === 2 && options[1].attributeFilter.join(',') === 'type,src,srcset');
  deliver([{ type: 'attributes', attributeName: 'src', target: { tagName: 'IMG' } }]);
  deliver([{ type: 'attributes', attributeName: 'srcset', target: { tagName: 'IMG' } }]);
  check('source-only changes reach just the image consumer', ordinary === 0 && images === 2);
  deliver([{ type: 'attributes', attributeName: 'type', target: { tagName: 'INPUT' } }]);
  check('input type transitions still reach all consumers', ordinary === 1 && images === 3);
  deliver([{ type: 'childList', addedNodes: [{ nodeType: 1, parentElement: null }] }]);
  check('added nodes still reach all consumers', ordinary === 2 && images === 4);
})();

/* The root computation, run for real against a tree of the shape that produced
   those numbers. A negative control follows: it must not simply return
   everything, and the roots it returns must cover every added node. */
(() => {
  const vm = require('vm');
  const s = MIN.indexOf('function __woBatchNodes(muts){');
  const e = MIN.indexOf('function woObserve(cb,imageSources){', s);
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
  const out = split([{ addedNodes: batch, removedNodes: [] }]);

  check('text nodes are dropped', out.added.indexOf(text) < 0 && out.added.length === 6);
  check('added elements mark the shared batch as structural', out.structural === true);
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
  const flatOut = split([{ addedNodes: flat, removedNodes: [] }]);
  check('an unnested batch keeps every node as a root', flatOut.roots.length === 3);
  const one = split([{ addedNodes: [el()], removedNodes: [] }]);
  check('a single-node batch skips the ancestor walk entirely',
    one.roots === one.added && one.roots.length === 1,
    'the common case must not allocate a Set');
  const textOnly = split([{
    addedNodes: [{ nodeType: 3, nodeValue: 'Volume 61' }],
    removedNodes: [{ nodeType: 3, nodeValue: 'Volume 60' }],
  }]);
  check('numeric text replacement is not structural', textOnly.structural === false);
  const removedOnly = split([{ addedNodes: [], removedNodes: [el()] }]);
  check('removed elements still wake stylesheet durability checks', removedOnly.structural === true);
  const inputType = split([{
    type: 'attributes', attributeName: 'type',
    target: { nodeType: 1, tagName: 'INPUT' }, addedNodes: [], removedNodes: [],
  }]);
  check('an existing input changing type is structural', inputType.structural === true);
  const unrelatedType = split([{
    type: 'attributes', attributeName: 'type',
    target: { nodeType: 1, tagName: 'DIV' }, addedNodes: [], removedNodes: [],
  }]);
  check('a non-input type attribute does not wake structural consumers', unrelatedType.structural === false);
  check('an empty batch is empty and non-structural',
    split([{ addedNodes: [], removedNodes: [] }]).roots.length === 0
      && split([{ addedNodes: [], removedNodes: [] }]).structural === false);
})();

/* Rect noise must stay bounded and deterministic per geometry/session without repeated string hashing. */
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

/* ---- per-added-node work that answered nothing ---------------------------
   Measured on the perf profile's churn page (16 batches of 1,093 elements):
   the grabber watch built a URL for every added element, src or not, and the
   overlay cleaner serialised innerText for containers that could never answer
   yes. Both answers are unchanged; only the wasted work is gone. */
check('the grabber watch skips added nodes with no src before any URL is built',
  /src=n\.getAttribute&&n\.getAttribute\("src"\),\s*hit=!!src&&isGrabberURL\(src\);/.test(SRC),
  'isGrabberURL(null) parsed "null" against the page address for every added element');
(() => {
  const vm = require('vm');
  const start = SRC.lastIndexOf('      isOverlay=el=>{');
  let end = -1;
  for (let i = SRC.indexOf('{', start), depth = 0; start >= 0 && i < SRC.length; i++) {
    if (SRC[i] === '{') depth++;
    else if (SRC[i] === '}' && --depth === 0) { end = i + 1; break; }
  }
  const body = start >= 0 && end > start ? SRC.slice(start + 6, end) : '';
  check('the overlay cleaner\'s isOverlay is where the test expects it',
    /return!!\(strongAdEvidence&&looksModal&&!tooHuge&&!hasLoginUi\(el\)\)/.test(body));
  if (!body) return;
  const box = {
    innerWidth: 1200, innerHeight: 800, seen: new Set(), position: 'static',
    getComputedStyle: () => ({ position: box.position, display: 'block', visibility: 'visible', opacity: '1', zIndex: '50' }),
    closeMarkedPlayerPopup: () => false, mediaUiProtected: () => false, fakeNotifyVisual: () => false, hasLoginUi: () => false,
    PROTECT: /(?!)/, AD_SIGNAL: /\bad-overlay\b/, NUISANCE: /(?!)/, BAIT_SIGNAL: /(?!)/,
  };
  vm.createContext(box);
  vm.runInContext('const ' + body + ';this.__isOverlay=isOverlay;', box, { filename: 'content.js:isOverlay' });
  let textReads = 0;
  let geometryReads = 0;
  let dimensions = { top: 250, bottom: 550, left: 400, right: 800, width: 400, height: 300 };
  const el = {
    nodeType: 1, id: 'promo', className: 'ad-overlay',
    getAttribute: () => null, querySelector: () => null,
    getBoundingClientRect: () => {
      geometryReads++;
      return dimensions;
    },
    get innerText() { textReads++; return 'Special offer'; },
  };
  box.el = el;
  check('a box in normal flow skips geometry and text',
    vm.runInContext('__isOverlay(el)', box) === false && geometryReads === 0 && textReads === 0,
    'geometry / innerText reads: ' + geometryReads + ' / ' + textReads);
  box.position = 'fixed';
  check('the same box positioned fixed and centred is still caught',
    vm.runInContext('__isOverlay(el)', box) === true && geometryReads === 1 && textReads === 1,
    'geometry / innerText reads: ' + geometryReads + ' / ' + textReads);
  dimensions = { top: 250, bottom: 290, left: 400, right: 440, width: 40, height: 40 };
  check('a tiny positioned box skips text that cannot establish an overlay',
    vm.runInContext('__isOverlay(el)', box) === false && geometryReads === 2 && textReads === 1,
    'geometry / innerText reads: ' + geometryReads + ' / ' + textReads);
})();
(() => {
  const vm = require('vm');
  const arrow = (marker) => {
    const start = SRC.indexOf(marker);
    if (start < 0) return '';
    for (let i = SRC.indexOf('{', start), depth = 0; i < SRC.length; i++) {
      if (SRC[i] === '{') depth++;
      else if (SRC[i] === '}' && --depth === 0) return SRC.slice(start, i + 1);
    }
    return '';
  };
  const sweep = arrow('      sweep=()=>{\n        if(!overlayCleanerOn())return;');
  const climb = arrow('      overlayCandidate=(el,');
  check('the overlay sweep and its parent climb are where the test expects them', !!sweep && !!climb);
  if (!sweep || !climb) return;
  const asked = [];
  const box = {
    WO: {}, NUISANCE: /(?!)/, Map,
    overlayCleanerOn: () => true, installHardOverlayCss() {}, hide() {},
    document: { querySelectorAll: () => box.candidates },
    overlayCandidate: (el) => el.floatParent || el,
    isOverlay: (el) => { asked.push(el.name); return el.name === box.hit; },
  };
  vm.createContext(box);
  vm.runInContext('const ' + sweep.trim() + ';this.__sweep=sweep;', box, { filename: 'content.js:sweep' });
  const plain = { name: 'plain' };
  const floating = { name: 'inner', floatParent: { name: 'bell' } };
  box.candidates = [plain, floating];
  box.hit = null;
  vm.runInContext('__sweep()', box);
  check('a candidate with no floating parent is asked about once, not twice',
    asked.join(',') === 'plain,bell,inner', asked.join(','));
  asked.length = 0;
  box.hit = 'bell';
  vm.runInContext('__sweep()', box);
  check('a floating parent that is an overlay is still the one hidden', asked.join(',') === 'plain,bell', asked.join(','));
  check('a hide drops the sweep\'s remembered parent verdicts', /hide\(hit,[\s\S]{0,140}climbs\.clear\(\)/.test(sweep));

  let styleReads = 0;
  let geometryReads = 0;
  const cbox = {
    position: 'static',
    document: { body: { name: 'body' }, documentElement: { name: 'html' } },
    getComputedStyle: () => { styleReads++; return { position: cbox.position, zIndex: 'auto' }; },
    Map, parseInt,
  };
  vm.createContext(cbox);
  vm.runInContext('const ' + climb.trim() + ';this.__climb=overlayCandidate;', cbox, { filename: 'content.js:overlayCandidate' });
  const parent = { className: 'row', id: '', getAttribute: () => null,
    getBoundingClientRect: () => { geometryReads++; return { width: 150, height: 100 }; },
    parentElement: cbox.document.body };
  cbox.a = { parentElement: parent };
  cbox.b = { parentElement: parent };
  vm.runInContext('const climbs = new Map(); this.r = [__climb(a, climbs), __climb(b, climbs)];', cbox);
  check('siblings share one style read and skip geometry for a normal-flow parent',
    styleReads === 1 && geometryReads === 0 && cbox.r[0] === cbox.a && cbox.r[1] === cbox.b,
    'style / geometry reads: ' + styleReads + ' / ' + geometryReads);
  styleReads = 0;
  vm.runInContext('this.r = [__climb(a), __climb(b)];', cbox);
  check('without a sweep\'s memo every call still reads for itself', styleReads === 2);
  cbox.position = 'fixed';
  vm.runInContext('this.r = __climb(a, new Map());', cbox);
  check('a small fixed parent still passes the floating-parent test',
    cbox.r === parent && geometryReads === 1, 'geometry reads: ' + geometryReads);
})();

/* ---- the shipped bundle carries all of it ------------------------------- */
check('the built engine has the hoists', /if\(!WO\.blockAutoplay\)return;/.test(MIN)
  && /autoplayApprovedMedia\.has\(m\)/.test(MIN)
  && /if\(!WO\.socialWidgetGuard\)return;/.test(MIN),
  'src and content.min.js are kept in sync by build-content --check');

if (failed) {
  console.error('engine mutation cost: ' + failed + ' failed');
  process.exit(1);
}
console.log('engine mutation cost: all checks passed');
