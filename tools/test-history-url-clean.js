/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/*
 * Tracking parameters added through history.pushState / replaceState.
 *
 * A single-page app can rewrite the address bar with no navigation, so /article becomes
 * /article?utm_source=foo without the reader clicking anything and with no link for the
 * link cleaner to see.
 *
 * THE RISK HERE IS OVER-REACH, not under-reach. This runs on the address a page is
 * currently using, so anything it deletes by mistake is live app state: a search page's
 * query, a wizard's step, an auth handoff. Most of this suite is therefore about what
 * must SURVIVE -- unknown parameters, the site's own parameters, the path, the hash --
 * and the per-site rules that are right for a copied link and wrong here.
 *
 * The real wrapper is lifted out of src/content.js and installed on a fake history.
 *
 * Run: node tools/test-history-url-clean.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'src', 'content.js'), 'utf8');
const MIN = fs.readFileSync(path.join(ROOT, 'content.min.js'), 'utf8');
const BG = fs.readFileSync(path.join(ROOT, 'background.js'), 'utf8');
const POPUP_HTML = fs.readFileSync(path.join(ROOT, 'popup.html'), 'utf8');
const HISTORY_JS = fs.readFileSync(path.join(ROOT, 'history.js'), 'utf8');

let failed = 0;
function check(what, ok, why) {
  if (ok) return;
  failed++;
  console.error('[fail] ' + what + (why === undefined ? '' : ' -- ' + why));
}

/* ---- the wrapper, run for real -------------------------------------------- */
const start = SRC.indexOf('let historyCleanCount=0;');
const end = SRC.indexOf('!1!==WO.enabled&&WO.stripTrackingParams&&(patchHistoryClean(', start);
const sliceable = start > 0 && end > start;
check('the wrapper is where the slice expects it', sliceable,
  'the end anchor is also the install guard, so losing it means that guard is gone');
/* If the slice is not there, run nothing rather than running the rest of the file as if
   it were the wrapper. A suite that reports one honest failure is worth more than one
   that dies with a SyntaxError and reports nothing at all. */
if (!sliceable) {
  console.error('history url clean: ' + failed + ' failed');
  process.exit(1);
}
const BLOCK = SRC.slice(start, end).replace(/,\s*$/, ';');

/* The two global lists are what the wrapper is allowed to use, so they come from the
   same source rather than being restated here -- a copy would let this suite keep
   passing after the real list changed. */
const paramsSrc = SRC.slice(SRC.indexOf('const TRACKING_PARAMS=['),
  SRC.indexOf(',\n    toURL=(h,'));
const globalSrc = SRC.slice(SRC.indexOf('COPY_CLEAN_GLOBAL=/^('),
  SRC.indexOf('$/i,', SRC.indexOf('COPY_CLEAN_GLOBAL=/^(')) + 4).replace(/,$/, '');
check('the parameter lists were found', paramsSrc.length > 40 && globalSrc.length > 200);

function install(world) {
  const o = world || {};
  const logs = [];
  const calls = [];
  const sandbox = {
    String, Number, Boolean, Object, Math, Date, RegExp, URL, Array, console,
    WO: Object.assign({ enabled: true, stripTrackingParams: true }, o.WO || {}),
    log: (type, detail) => logs.push({ type, detail }),
    location: { href: 'https://app.example/article', hostname: 'app.example', protocol: 'https:' },
    history: {
      pushState(state, title, url) { calls.push(['pushState', url, arguments.length]); },
      replaceState(state, title, url) { calls.push(['replaceState', url, arguments.length]); },
    },
  };
  sandbox.toURL = (h, b) => { try { return new URL(h, b || sandbox.location.href); } catch (_) { return null; } };
  vm.createContext(sandbox);
  vm.runInContext(paramsSrc + ';const ' + globalSrc + ';' + BLOCK
    + ';if(false!==WO.enabled&&WO.stripTrackingParams){patchHistoryClean("pushState");patchHistoryClean("replaceState");}'
    + 'globalThis.__hist = history;', sandbox, { filename: 'src/content.js:historyclean' });
  return { history: sandbox.history, logs, calls, WO: sandbox.WO };
}

/* ---- it cleans what it should --------------------------------------------- */
{
  const h = install({});
  h.history.pushState({}, '', 'https://app.example/article?utm_source=foo&fbclid=bar');
  check('tracking parameters are removed', h.calls[0] && h.calls[0][1] === 'https://app.example/article',
    'got ' + (h.calls[0] || [])[1]);
  check('and it happens BEFORE the real call, not after',
    /if\(hit\)return[\s\S]{0,500}real\.call\(this,[\s\S]{0,80}hit\.url\)/.test(SRC),
    'the real history call has to receive the CLEANED url; cleaning up afterwards would '
    + 'leave the tracked address in session history, one Back press away');
}
{
  const h = install({});
  h.history.replaceState({}, '', '?utm_campaign=spring&mkt_tok=abc');
  check('replaceState is covered too', h.calls[0] && h.calls[0][1] === 'https://app.example/article',
    'got ' + (h.calls[0] || [])[1]);
}
{
  const h = install({});
  h.history.pushState({}, '', 'https://app.example/a?gclid=1&msclkid=2&_ga=3&igshid=4&ttclid=5');
  check('the wider global list is used, not only the short one',
    h.calls[0] && h.calls[0][1] === 'https://app.example/a', 'got ' + (h.calls[0] || [])[1]);
}

/* ---- what must SURVIVE ----------------------------------------------------- */
{
  const h = install({});
  const url = 'https://app.example/search?q=boots&page=3&sort=price&sessionToken=xyz';
  h.history.pushState({}, '', url);
  check('an unrecognised parameter is never removed', h.calls[0] && h.calls[0][1] === url,
    'got ' + (h.calls[0] || [])[1] + '; deleting an unknown parameter is deleting app state');
  check('and with nothing to clean, the page\'s own argument goes through untouched',
    h.calls[0] && h.calls[0][1] === url,
    'a relative argument rewritten to an absolute one is a change with no cleaning in it');
}
{
  const h = install({});
  h.history.pushState({}, '', '?tab=reviews');
  check('a relative argument stays relative when nothing is removed',
    h.calls[0] && h.calls[0][1] === '?tab=reviews', 'got ' + (h.calls[0] || [])[1]);
}
for (const [what, url] of [
  ["Amazon's search state", 'https://app.example/s?qid=1712&sr=8-1&keywords=boots&crid=X'],
  ["YouTube's app parameters", 'https://app.example/watch?v=abc&app=desktop&persist_app=1'],
  ["Spotify's context", 'https://app.example/track/1?context=spotify%3Aplaylist%3A2'],
  ['an OAuth handoff', 'https://app.example/cb?code=abc123&state=xyz789&scope=openid'],
]) {
  const h = install({});
  h.history.pushState({}, '', url);
  check(what + ' survives', h.calls[0] && h.calls[0][1] === url,
    'got ' + (h.calls[0] || [])[1] + '; these are right to strip off a COPIED link and '
    + 'wrong to strip off the address an app is running on');
}
check('the per-site rules are not reachable from here',
  !/COPY_CLEAN_SITES/.test(BLOCK) && !/cleanCopyUrl/.test(BLOCK),
  'that list exists for the clipboard, where deleting a search term is the point');
{
  const h = install({});
  h.history.pushState({}, '', 'https://app.example/deep/path?utm_source=x#section-2');
  check('the path and hash are left alone',
    h.calls[0] && h.calls[0][1] === 'https://app.example/deep/path#section-2',
    'got ' + (h.calls[0] || [])[1]);
}
check('no path surgery is even written here',
  !/\.pathname\s*=/.test(BLOCK) && !/\.hash\s*=/.test(BLOCK),
  'cleanCopyUrl rewrites both, correctly, for a link on its way to the clipboard');
{
  const h = install({});
  h.history.pushState({}, '');
  check('a two-argument call is passed straight through', h.calls[0] && h.calls[0][2] === 2);
  h.history.pushState({}, '', null);
  check('and so is a null url', h.calls[1] && h.calls[1][1] === null);
}
{
  /* A query string parses on a non-special scheme too, so without the protocol guard
     this would come back rewritten. Chrome would refuse the call either way, but not
     before WardenOne had rewritten what the page passed. */
  const h = install({});
  const js = 'javascript:alert(1)?utm_source=x';
  h.history.pushState({}, '', js);
  check('a non-http url is not rewritten', h.calls[0] && h.calls[0][1] === js,
    'got ' + (h.calls[0] || [])[1]);
}

/* ---- it cannot loop -------------------------------------------------------- */
{
  const h = install({});
  const clean = 'https://app.example/article?page=2';
  h.history.replaceState({}, '', clean);
  h.history.replaceState({}, '', clean);
  check('cleaning an already-clean address changes nothing',
    h.calls.every((c) => c[1] === clean),
    'a page that re-pushes what it reads back must not be able to start a cycle');
  check('and nothing is logged for it', h.logs.length === 0);
}

/* ---- the switch, live ------------------------------------------------------ */
{
  const h = install({});
  h.WO.stripTrackingParams = false;
  h.history.pushState({}, '', 'https://app.example/a?utm_source=x');
  check('turning the cleaner off takes effect on the page already open',
    h.calls[0] && h.calls[0][1] === 'https://app.example/a?utm_source=x',
    'the wrapper must re-read the switch, not trust the one that installed it');
}
{
  const h = install({});
  h.WO.enabled = false;
  h.history.pushState({}, '', 'https://app.example/a?utm_source=x');
  check('and so does switching WardenOne off entirely',
    h.calls[0] && h.calls[0][1] === 'https://app.example/a?utm_source=x');
}
check('nothing is patched at all while WardenOne is off',
  /!1!==WO\.enabled&&WO\.stripTrackingParams&&\(patchHistoryClean\("pushState"\)/.test(SRC),
  'patching two native methods on a page the extension is not running on is not free');
check('it does not wrap itself twice',
  /if\("function"!=typeof real\|\|real\.__wardenoneUrlClean\)return;/.test(SRC),
  'the back-trap guard wraps pushState too; two guards must not become four');
check('BOTH history methods are actually installed',
  /patchHistoryClean\("pushState"\),\s*patchHistoryClean\("replaceState"\)\);/.test(SRC),
  'an app rewrites its address with replaceState far more often than with pushState, so '
  + 'covering only pushState would miss most of what this exists for');

/* ---- recorded, quietly ----------------------------------------------------- */
{
  const h = install({});
  h.history.pushState({}, '', 'https://app.example/a?utm_source=foo&fbclid=bar');
  const first = h.logs[0] || {};
  check('the clean is recorded', h.logs.length === 1 && first.type === 'cleaned_history_url');
  const detail = first.detail || {};
  check('with the parameter names', Array.isArray(detail.params)
    && detail.params.join(',') === 'utm_source,fbclid', JSON.stringify(detail));
  check('and no values', !JSON.stringify(detail).includes('foo')
    && !JSON.stringify(detail).includes('bar'),
    'which trackers were told is worth showing; what they were told is not');
}
{
  const h = install({});
  for (let i = 0; i < 40; i++) h.history.pushState({}, '', 'https://app.example/a' + i + '?utm_source=x');
  check('logging is capped', h.logs.length <= 20);
  check('but cleaning keeps going past the cap',
    h.calls.length === 40 && h.calls[39][1] === 'https://app.example/a39');
}
check('Activity names the event', /cleaned_history_url: 'Tracking added to the address/.test(HISTORY_JS));
check('and shows which parameters went',
  /e\.type === 'cleaned_history_url'/.test(HISTORY_JS) && /'Removed: ' \+ names\.join/.test(HISTORY_JS),
  'without this it renders as a row with a blank detail');
check('it raises no toast', !/toast\([^)]*cleaned_history_url/.test(SRC));

/* ---- merged, not a new feature -------------------------------------------- */
check('there is no toggle of its own',
  !/spaTrackingCleaner|historyUrlClean|cleanHistoryParams/i.test(BG)
  && !/data-key="[a-zA-Z]*[Hh]istory[a-zA-Z]*"/.test(POPUP_HTML));
check('and no entry in the protection count',
  !/'cleanHistoryUrl'|'spaTracking'/.test(BG.match(/const HEALTH_SHIELD_KEYS = \[[\s\S]*?\];/)[0]));
check('it rides the parameter-stripping flag the link cleaner already uses',
  /WO\.stripTrackingParams&&arguments\.length>=3/.test(SRC),
  'one policy for a link and for an address bar, or the two drift apart');

/* ---- shipped --------------------------------------------------------------- */
check('the built runtime carries it', /__wardenoneUrlClean/.test(MIN),
  'src/content.js is not what the browser loads');

if (failed) {
  console.error('history url clean: ' + failed + ' failed');
  process.exit(1);
}
console.log('history url clean: all checks passed');
