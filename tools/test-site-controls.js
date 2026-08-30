/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/*
 * Per-site control: pausing a site, and turning off one protection on one site.
 *
 * Until these existed the only site-level lever was the allowlist, which turns the
 * whole engine off, permanently, until someone remembers to undo it -- so a single
 * guard misreading a single site cost either that guard everywhere or every guard
 * there. Two narrower levers replace that trade:
 *
 *   allowlistUntil[host]        when the pause lapses. Same effect as the
 *                               allowlist, but it expires on its own.
 *   siteOverrides[host][key]    one protection off, on one site, everything else
 *                               still running.
 *
 * Both are resolved in bridge.js before the config reaches any content script, and
 * again in background.js for the decisions the worker makes on its own. This file
 * pins that the two agree, that a site can only ever turn something OFF, and that
 * host matching is on a label boundary so a lookalike cannot inherit a pass.
 *
 * Run: node tools/test-site-controls.js
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const BRIDGE = fs.readFileSync(path.join(ROOT, 'bridge.js'), 'utf8');
const BACKGROUND = fs.readFileSync(path.join(ROOT, 'background.js'), 'utf8');
const POPUP = fs.readFileSync(path.join(ROOT, 'popup.js'), 'utf8');
const POPUP_HTML = fs.readFileSync(path.join(ROOT, 'popup.html'), 'utf8');
const ANTI_REDIRECT = fs.readFileSync(path.join(ROOT, 'anti-redirect.js'), 'utf8');
const SOURCE = fs.readFileSync(path.join(ROOT, 'src', 'content.js'), 'utf8');

function grabFn(src, name, label) {
  const at = src.indexOf('function ' + name);
  assert(at >= 0, label + ' no longer declares ' + name);
  let depth = 0;
  let seen = false;
  for (let i = at; i < src.length; i++) {
    const c = src[i];
    if (c === '{') { depth++; seen = true; }
    else if (c === '}') { depth--; if (seen && depth === 0) return src.slice(at, i + 1); }
  }
  throw new Error('unterminated ' + name + ' in ' + label);
}

const sandbox = { console, Date, Number, Object, Array, String, Set, Math, JSON };
vm.createContext(sandbox);
for (const name of ['bridgeCleanHost', 'bridgeHostMatchesList', 'bridgeActiveAllowlist', 'bridgeSiteOverridesFor']) {
  vm.runInContext(grabFn(BRIDGE, name, 'bridge.js'), sandbox);
}
/* Every host in this file is public, so the private-address branch of the
   background's normaliser is not what is under test here. */
sandbox.isLocalOrPrivateHost = () => false;
for (const name of ['normalizeAllowlistHost', 'normalizeAllowlistHosts', 'activeAllowlist', 'hostMatchesAllowlist']) {
  vm.runInContext(grabFn(BACKGROUND, name, 'background.js'), sandbox);
}
const call = (expr) => vm.runInContext(expr, sandbox);

let passed = 0;
function check(name, condition, extra) {
  if (condition) { passed++; console.log('  ok  - ' + name); return; }
  console.error('  FAIL - ' + name + (extra === undefined ? '' : ' :: ' + JSON.stringify(extra)));
  process.exitCode = 1;
}

// For assertions about a VALUE rather than a condition. check() would happily
// take the expected value as its "extra" and pass on the truthy actual, so the
// two shapes are kept apart deliberately.
function is(name, got, want, extra) {
  const a = JSON.stringify(got);
  const b = JSON.stringify(want);
  check(name, a === b, a === b ? undefined : 'got ' + a + ', wanted ' + b + (extra ? ' -- ' + extra : ''));
}

// ---------------------------------------------------------------------------
// 1. A pause lapses on its own, and both resolvers agree on when.
// ---------------------------------------------------------------------------
{
  const now = Date.now();
  sandbox.CFG = {
    allowlist: ['permanent.example'],
    allowlistUntil: { 'paused.example': now + 60000, 'lapsed.example': now - 1 },
  };
  check('a permanent allowlist entry is untouched by the new field',
    call('bridgeActiveAllowlist(CFG).includes("permanent.example")'));
  check('an unlapsed pause counts as allowlisted',
    call('bridgeActiveAllowlist(CFG).includes("paused.example")'));
  check('a lapsed pause stops counting without anyone cleaning it up',
    !call('bridgeActiveAllowlist(CFG).includes("lapsed.example")'));
  check('the worker reaches the same answer as the bridge',
    call('hostMatchesAllowlist("paused.example", activeAllowlist(CFG))') === true
    && call('hostMatchesAllowlist("lapsed.example", activeAllowlist(CFG))') === false);
  check('a pause covers subdomains',
    call('hostMatchesAllowlist("a.b.paused.example", activeAllowlist(CFG))'));
  check('a lookalike host cannot inherit a pause',
    !call('hostMatchesAllowlist("notpaused.example", activeAllowlist(CFG))'));
}

// ---------------------------------------------------------------------------
// 2. Malformed stored state must never widen the allowlist.
// ---------------------------------------------------------------------------
{
  is('a missing map changes nothing',
    call('bridgeActiveAllowlist({allowlist:["a.example"]})'), ['a.example']);
  is('a non-object map changes nothing',
    call('bridgeActiveAllowlist({allowlist:[],allowlistUntil:"soon"})'), []);
  is('a non-numeric expiry does not allowlist',
    call('bridgeActiveAllowlist({allowlist:[],allowlistUntil:{"x.example":"soon"}})'), []);
  is('an expiry of zero does not allowlist',
    call('bridgeActiveAllowlist({allowlist:[],allowlistUntil:{"x.example":0}})'), []);
}

// ---------------------------------------------------------------------------
// 3. A site may turn a protection OFF. It may never turn one on.
// ---------------------------------------------------------------------------
{
  sandbox.RULES = {
    siteOverrides: {
      'example.test': { commandPasteGuard: false, behavioralScan: false },
      'wants-more.test': { commandPasteGuard: true },
      'malformed.test': { 'not a key': false },
    },
  };
  is('an override applies to the host it names',
    call('Object.keys(bridgeSiteOverridesFor(RULES,"example.test")).sort()'),
    ['behavioralScan', 'commandPasteGuard']);
  is('an override applies to subdomains of that host',
    call('Object.keys(bridgeSiteOverridesFor(RULES,"a.example.test")).sort()'),
    ['behavioralScan', 'commandPasteGuard']);
  is('an unrelated host gets nothing', call('bridgeSiteOverridesFor(RULES,"unrelated.test")'), {});
  is('a lookalike host gets nothing', call('bridgeSiteOverridesFor(RULES,"notexample.test")'), {});
  is('a site cannot switch a protection back on',
    call('bridgeSiteOverridesFor(RULES,"wants-more.test")'), {},
    'a stored true would let a page-adjacent setting re-enable something disabled globally');
  is('a malformed key is discarded',
    call('Object.keys(bridgeSiteOverridesFor(RULES,"malformed.test"))'), []);
  check('resolving an override does not pollute Object.prototype',
    call('({}).commandPasteGuard === undefined'));
}

// ---------------------------------------------------------------------------
// 4. Resolution happens once, at the boundary, and only ever narrows.
// ---------------------------------------------------------------------------
{
  check('the bridge folds pauses into the list it hands out',
    /clean\.allowlist = sanitizeBridgeHostList\(bridgeActiveAllowlist\(clean\), 1000\)/.test(BRIDGE));
  check('the raw expiry map does not travel to content scripts',
    /delete clean\.allowlistUntil/.test(BRIDGE),
    'shipping it would invite a second, disagreeing interpretation downstream');
  check('the rules themselves do not travel either',
    /delete clean\.siteOverrides/.test(BRIDGE));
  check('an override can only clear a boolean the config already had',
    /if \(typeof clean\[key\] === 'boolean'\) clean\[key\] = false;/.test(BRIDGE),
    'assigning unknown keys would let stored state invent config');

  const bgReads = (BACKGROUND.match(/cfg\.allowlist/g) || []).length;
  check('the worker has no raw allowlist reads left outside its resolver', bgReads === 2,
    bgReads + ' remaining; expected only the two inside activeAllowlist()');
}

// ---------------------------------------------------------------------------
// 5. anti-redirect.js honours the allowlist at all.
//
//    It is a separate <all_urls> content script, statically declared so it cannot
//    be skipped per host at injection time, and the bridge hands it the raw
//    toggles rather than the allowlist-gated ones the engine computes for itself.
//    "Allow this site" therefore left forced-popup, gestureless-navigation and
//    meta-refresh blocking running there anyway.
// ---------------------------------------------------------------------------
{
  check('the redirect guard checks the allowlist', /function hostAllowedByUser\(\)/.test(ANTI_REDIRECT));
  check('and it checks it on the master gate, not one feature',
    /return configReady\(\) && c\.enabled !== false && !hostAllowedByUser\(\);/.test(ANTI_REDIRECT));
  check('its host match is on a label boundary',
    /h === d \|\| h\.endsWith\('\.' \+ d\)/.test(ANTI_REDIRECT) || /host === d \|\| host\.endsWith\('\.' \+ d\)/.test(ANTI_REDIRECT));
}

// ---------------------------------------------------------------------------
// 6. The popup writes what the resolvers read, and cleans up after itself.
// ---------------------------------------------------------------------------
{
  check('the engine ships defaults for both fields',
    /allowlistUntil:\{/.test(SOURCE) && /siteOverrides:\{/.test(SOURCE));
  check('the popup ships defaults for both fields',
    /allowlistUntil: \{\}/.test(POPUP) && /siteOverrides: \{\}/.test(POPUP));
  check('the worker ships defaults for both fields',
    /allowlistUntil: \{\}/.test(BACKGROUND) && /siteOverrides: \{\}/.test(BACKGROUND));
  check('lapsed pauses are pruned when the popup writes', /function prunePausedSites\(\)/.test(POPUP));
  check('undoing an override removes it rather than storing a true',
    /if \(on\) delete entry\[key\];/.test(POPUP),
    'storing true would try to re-enable something the global config disabled');
  check('an emptied override entry is removed, not left behind',
    /else delete config\.siteOverrides\[host\];/.test(POPUP));
  check('the per-site list reuses each protection\'s own label',
    /function protectionLabel\(key\)/.test(POPUP) && /input\[data-key="' \+ key \+ '"\]/.test(POPUP),
    'a second copy of the wording would drift from the rows it describes');
  check('only real boolean protections are offered per site',
    /typeof DEFAULTS\[key\] === 'boolean'/.test(POPUP));
  check('the per-site panel uses the popup section and card structure',
    /<section class="group site-controls-section" id="site-controls-group"[^>]*>\s*<h2 id="site-controls-title">This site<\/h2>\s*<div class="card-group" id="site-controls"(?![^>]*style=)/.test(POPUP_HTML),
    'a heading outside .group falls back to the browser\'s large flush-left h2 styling');
  check('the three pause choices sit below the copy in an equal-width action grid',
    /class="row site-pause-row"[\s\S]*?class="site-pause-actions"/.test(POPUP_HTML)
      && /\.site-pause-actions\s*\{[^}]*grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\)/.test(POPUP_HTML),
    'side-by-side copy and three fixed buttons squeeze the explanation into a narrow column');
  check('a tab with no site hides the complete per-site section',
    /const section = \$\('site-controls-group'\) \|\| panel;[\s\S]*?if \(!host\) \{\s*section\.hidden = true;[\s\S]*?section\.hidden = false;/.test(POPUP),
    'hiding only the card would leave its heading orphaned');
  check('the paused-status row stays hidden until a pause is active',
    /\.site-pause-active-row\[hidden\]\s*\{\s*display:\s*none;\s*\}/.test(POPUP_HTML),
    'the generic .row display rule otherwise overrides the hidden attribute');
}

// ---------------------------------------------------------------------------
// 7. A blocked request has to fail, not hang.
//
//    Every XHR block called abort() INSTEAD of send(). XMLHttpRequest only fires
//    abort/error/loadend when the send() flag is set, so a request stopped that
//    way never settles: the page waits forever for a callback that cannot arrive.
//    Attaching a file to a Microsoft Form sat on "sending" for exactly this
//    reason. fetch rejects and sendBeacon returns false; XHR now gets the same
//    treatment -- the terminal state of a network error.
// ---------------------------------------------------------------------------
{
  const MIN_ENGINE = fs.readFileSync(path.join(ROOT, 'content.min.js'), 'utf8');
  const start = MIN_ENGINE.indexOf('const __woFailXhr=');
  check('the engine has one way to fail a blocked request', start >= 0);
  if (start >= 0) {
    let depth = 0;
    let seen = false;
    let stop = start;
    for (let i = start; i < MIN_ENGINE.length; i++) {
      const c = MIN_ENGINE[i];
      if (c === '{') { depth++; seen = true; }
      else if (c === '}') { depth--; if (seen && depth === 0) { stop = i + 1; break; } }
    }
    const helper = MIN_ENGINE.slice(start, stop);

    class FakeEvent { constructor(type) { this.type = type; } }
    const box = {
      Object, Date, setTimeout, console,
      Event: FakeEvent, ProgressEvent: FakeEvent,
      document: { createEvent: () => ({ initEvent() {} }) },
    };
    vm.createContext(box);
    vm.runInContext(helper + ';\nglobalThis.__fail = __woFailXhr;', box);

    const fired = [];
    const xhr = {
      readyState: 1,
      status: null,
      addEventListener() {},
      dispatchEvent(ev) { fired.push(ev.type); return true; },
    };
    box.__fail(xhr);
    /* setTimeout is real here, so the assertions run once the queue drains. */
    setTimeout(() => {
      check('a blocked request reaches the page as a failure',
        fired.join(',') === 'readystatechange,error,loadend', fired);
      check('and it looks like the network error it is',
        xhr.readyState === 4 && xhr.status === 0, { readyState: xhr.readyState, status: xhr.status });
      report();
    }, 0);
  }

  check('no blocked-XHR site still calls abort() instead',
    !/this\.abort\(\)/.test(SOURCE),
    'abort() before send() fires nothing, so that request would hang');
}

// ---------------------------------------------------------------------------
// 8. Microsoft 365 can reach its own storage.
//
//    The token guard's Microsoft family listed only the sign-in and mail hosts,
//    and sharepoint.com -- where Office actually puts what you upload -- was not
//    a global destination either. Attaching a file to a Microsoft Form therefore
//    read as a token leaving forms.office.com for an unrelated host.
// ---------------------------------------------------------------------------
{
  const MIN_ENGINE = fs.readFileSync(path.join(ROOT, 'content.min.js'), 'utf8');
  const start = MIN_ENGINE.indexOf('TOKEN_EXFIL_TRUST_POLICY=(()=>{');
  check('the token guard still has a trust policy', start >= 0);
  if (start >= 0) {
    let depth = 0;
    let seen = false;
    let stop = start;
    for (let i = start + 'TOKEN_EXFIL_TRUST_POLICY='.length; i < MIN_ENGINE.length; i++) {
      const c = MIN_ENGINE[i];
      if (c === '(' || c === '{') { depth++; seen = true; }
      else if (c === ')' || c === '}') { depth--; if (seen && depth === 0) { stop = i + 1; break; } }
    }
    /* Without the trailing () this captures the factory, and every call returns a
       truthy function -- which reads as "everything is trusted" and passes. */
    check('the policy is captured invoked, not as its factory',
      MIN_ENGINE.slice(stop, stop + 2) === '()');
    stop += 2;
    const box = { console, String, Array, Map, Set, Object, Number };
    vm.createContext(box);
    vm.runInContext('var ' + MIN_ENGINE.slice(start, stop) + ';\nglobalThis.__p = TOKEN_EXFIL_TRUST_POLICY;', box);
    check('the policy answers with a boolean',
      typeof vm.runInContext('__p("a.example","b.example")', box) === 'boolean');
    const trusts = (page, target) => vm.runInContext('__p(' + JSON.stringify(page) + ',' + JSON.stringify(target) + ')', box);

    for (const [page, target, why] of [
      ['forms.office.com', 'contoso.sharepoint.com', 'a Forms attachment'],
      ['forms.office.com', 'contoso-my.sharepoint.com', 'a personal OneDrive'],
      ['forms.office.com', 'p.svc.ms', 'OneDrive file content'],
      ['word.office.com', 'contoso.sharepoint.com', 'the same gap in Word'],
      ['contoso.sharepoint.com', 'contoso-my.sharepoint.com', 'SharePoint to OneDrive'],
    ]) check('Microsoft 365 may reach its own storage: ' + why, trusts(page, target));

    for (const [page, target, why] of [
      ['forms.office.com', 'evil-collector.example', 'an unrelated destination'],
      ['mybank.example', 'contoso.sharepoint.com', 'an unrelated page reaching SharePoint'],
      ['forms.office.com.evil.tld', 'contoso.sharepoint.com', 'a lookalike page host'],
      ['forms.office.com', 'sharepoint.com.evil.tld', 'a lookalike target host'],
    ]) check('the guard still holds for ' + why, !trusts(page, target));

    check('federated sign-in was already trusted and stays so',
      trusts('www.pinterest.com', 'accounts.google.com'));
  }
}

function report() {
if (process.exitCode) {
  console.error('\nsite-control checks failed');
} else {
  console.log('\n' + passed + ' site-control checks passed.');
}
}
