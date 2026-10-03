/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/*
 * The Settings page (settings.html), checked without a browser.
 * Run: node tools/test-settings-page.js
 *
 * tools/build-settings-data.js --check keeps settings-data.js in step with the popup and the
 * worker. This keeps the page itself honest about them: every switch the popup offers has a place
 * on it, nothing is a hand copy or a placeholder, a utility a package leaves out takes its controls
 * with it, and the Store package can strip Twitch Rewind from both files. The page's behaviour in
 * a real browser is tools/browser-settings-data.js and tools/browser-settings-arrange.js.
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');
const settingsJs = read('settings.js');
const settingsHtml = read('settings.html');
const dataJs = read('settings-data.js');
const popupJs = read('popup.js');
const manifest = JSON.parse(read('manifest.json'));
const store = require('./build-store-package.js');

let checks = 0;
function check(label, ok) {
  checks++;
  assert(ok, label);
}

/* Switches the popup offers that need the tab it is open over, so have no place on a page of their own. */
const POPUP_ONLY = { 'js-site': 'blocks scripts on the site in the active tab' };

const data = {};
vm.runInNewContext(dataJs + '\nthis.D = SETTINGS_DATA;', data);
const rows = data.D.sections.flatMap((s) => s.rows).concat(data.D.carried.flatMap((c) => c.rows));
const popupKeys = Array.from(new Set(rows.map((r) => r.key)));
check('the generated data names the popup’s switches', popupKeys.length > 120 && popupKeys.includes('blockTrackers') && popupKeys.includes('tl-guard'));

/* Every key the page places: the string arrays handed to G() and every sw() call. */
const placed = new Set();
for (const m of settingsJs.matchAll(/\bsw\(([^)]*)\)/g)) for (const k of m[1].matchAll(/'([A-Za-z-]+)'/g)) placed.add(k[1]);
for (const m of settingsJs.matchAll(/\bG\('i-[a-z-]+',[\s\S]*?,\s*\[((?:\s*'[A-Za-z-]+'\s*,?)+)\]\)/g)) for (const k of m[1].matchAll(/'([A-Za-z-]+)'/g)) placed.add(k[1]);
const unplaced = popupKeys.filter((k) => !placed.has(k) && !POPUP_ONLY[k] && !/^cl-/.test(k));
assert.deepStrictEqual(unplaced, [], 'every switch the popup offers has a place in Settings; add it to a page in settings.js');
check('the exempt list names only switches that still exist', Object.keys(POPUP_ONLY).every((k) => popupKeys.includes(k)));

check('no table is copied into settings.js by hand',
  !/^const (?:DATA|POPUP_DEFAULTS|IMPORT_ONLY_DEFAULTS|TOAST_TITLES|SHIELD_KEYS|WATCH_ONLY_KEYS) = [{[]/m.test(settingsJs));
check('nothing on the page is a placeholder', !/\bmock|data-mock|Would (?:open|save|list|clear|build|fetch|pause|ask)\b/i.test(settingsJs + settingsHtml));

const scripts = Array.from(settingsHtml.matchAll(/<script src="([^"]+)"><\/script>/g)).map((m) => m[1]);
assert.deepStrictEqual(scripts, ['build-profile.js', 'notification-schema.js', 'popup-diagnostics.js', 'settings-data.js', 'config-lock.js', 'settings.js'], 'settings.html loads what settings.js uses, before it');
check('the page loads nothing from outside the package', !/(?:src|href)="(?:https?:)?\/\//.test(settingsHtml.replace(/<a [^>]*>/g, '')) && !settingsHtml.includes('../'));
check('the browser’s Extension options is Settings', manifest.options_page === 'settings.html');
check('the popup’s Settings button opens it as the options page', /settingsBtn\.addEventListener\('click', \(\) => \{\s*try \{\s*chrome\.runtime\.openOptionsPage\(/.test(popupJs));
check('the popup’s Activity link no longer goes through the options page',
  /\$\('open-activity'\)\.addEventListener\('click', \(e\) => \{\s*e\.preventDefault\(\);\s*window\.open\(chrome\.runtime\.getURL\('history\.html'\)\);/.test(popupJs));

/* A utility the package leaves out takes its switches and controls with it, as in the popup. */
function filterFor(build) {
  const ctx = { WARDENONE_BUILD: build, FIELD_OF: { 'tl-guard': 'tabLimitGuard', 'tl-close': 'tabLimitClose', 'tl-warn': 'tabLimitWarn' } };
  const at = settingsJs.indexOf('const BUILD = ');
  const end = settingsJs.indexOf('\n', settingsJs.indexOf('const carriedItem = '));
  assert(at > 0 && end > at, 'the build-profile filter has moved');
  vm.runInNewContext(settingsJs.slice(at, settingsJs.indexOf('\n', end + 1)) + '\nthis.carried = carriedItem;', ctx);
  return ctx.carried;
}
const fullBuild = filterFor({ omitted: [], features: {} });
check('the full build carries everything', fullBuild({ type: 'switch', key: 'tl-guard' }) && fullBuild({ type: 'num', feature: 'tabLimit' }));
const noTabLimit = filterFor({ omitted: ['tabLimit'], features: { tabLimit: { keys: ['tabLimitGuard', 'tabLimitMax', 'tabLimitClose', 'tabLimitMinIdleMinutes', 'tabLimitWarn'] } } });
check('a package without Tab Limit drops its id-wired switches and its numbers',
  !noTabLimit({ type: 'switch', key: 'tl-guard' }) && !noTabLimit({ type: 'num', feature: 'tabLimit', field: 'tabLimitMax' }));
check('and keeps everything else', noTabLimit({ type: 'switch', key: 'blockTrackers' }) && noTabLimit({ type: 'slider', feature: 'eyeShield' }));
check('every number, level and list setting names its utility where it has one',
  /num\('tabLimitMax'[^\n]*'tabLimit'\)/.test(settingsJs) && /num\('twitchRewindMinutes'[^\n]*'twitchRewind'\)/.test(settingsJs)
    && (settingsJs.match(/slider\('eyeShield[A-Za-z]+'[^\n]*'eyeShield'\)/g) || []).length === 5
    && /tagged\(choice\('eyeshield'[^\n]*'eyeShield'\)/.test(settingsJs) && /tagged\(choice\('memoryMode'[^\n]*'memoryShield'\)/.test(settingsJs));

/* The Store package strips Twitch Rewind from both files, and nothing of it is left outside the marks. */
for (const [name, text] of [['settings.js', settingsJs], ['settings-data.js', dataJs]]) {
  const stripped = store.rewriteStoreRuntime(name, text);
  check(name + ' keeps Twitch Rewind inside one Store block', stripped !== text && !store.DEAD_STORE_REWIND.test(stripped));
}
const storeData = {};
vm.runInNewContext(store.rewriteStoreRuntime('settings-data.js', dataJs) + '\nthis.D = SETTINGS_DATA;', storeData);
check('the Store data still parses, with nothing carried back in', Array.isArray(storeData.D.sections) && storeData.D.carried.length === 0);
check('settings.js copes with the block gone', /typeof TWITCH_REPLAY === 'object' \? TWITCH_REPLAY\.sub : /.test(settingsJs)
  && /sw\('twitchAdBlock', 'twitchSteadyPlayback'\)\.concat\(typeof TWITCH_REPLAY === 'object' \? TWITCH_REPLAY\.items : \[\]\)/.test(settingsJs));

/* Protections off for one site come from the popup's own table, and a left-out utility's keys travel
   with its rows. */
check('the per-site table is the popup’s', data.D.siteOverrideScope && data.D.siteOverrideScope.page.length > 20 && data.D.siteOverrideScope.mixed.length > 20);
check('Settings folds a carried block’s per-site keys back in', /extra\.siteOverrideScope/.test(settingsJs));
check('the Store data has no Twitch Rewind per-site keys', !store.DEAD_STORE_REWIND.test(JSON.stringify(storeData.D.siteOverrideScope)));

/* Every health item says where it is put right, and the overview knows each kind of answer. */
const background = read('background.js');
const summaryAt = background.indexOf('async function buildProtectionHealthSummary(tab) {');
const summary = background.slice(summaryAt, background.indexOf('\n}\n', summaryAt));
const calls = [];
for (let at = summary.indexOf('addIssue('); at >= 0; at = summary.indexOf('addIssue(', at + 1)) {
  if (summary.slice(at - 6, at) === 'const ') continue;
  let depth = 0, i = at + 'addIssue'.length;
  for (; i < summary.length; i++) {
    if (summary[i] === '(') depth++;
    else if (summary[i] === ')' && --depth === 0) break;
  }
  calls.push(summary.slice(at, i + 1));
}
const unhinted = calls.filter((call) => !/fix: '[^']+'/.test(call) && !/kind: 'extension-alerts',\s*fix:/.test(call));
check('the health check still raises its issues', calls.length >= 25);
assert.deepStrictEqual(unhinted.map((c) => c.slice(0, 70)), [calls.find((c) => c.includes('startup security finding')).slice(0, 70)],
  'every health issue but the popup-only startup findings carries a fix hint');
const fixes = Array.from(new Set(Array.from(summary.matchAll(/fix: '([^']+)'/g), (m) => m[1])));
const knownFix = (fix) => fix === 'master' || fix === 'repair' || fix === 'page:lists' || fix === 'page:extensions'
  || (fix.startsWith('setting:') && placed.has(fix.slice(8)));
assert.deepStrictEqual(fixes.filter((f) => !knownFix(f)), [], 'every fix hint points at something Settings can show: a placed switch, a page or repair');
check('the overview answers each kind of hint', ["fix.startsWith('setting:')", "fix === 'page:lists'", "fix === 'page:extensions'", "fix === 'repair'", "i.fix !== 'master'"].every((s) => settingsJs.includes(s)));

/* Search: words in any order, everyday words, joined words and small typos, against the real names. */
const engineAt = settingsJs.indexOf('/* ---------- Search engine ----------');
const engineEnd = settingsJs.indexOf('/* ---------- Search engine end ---------- */');
assert(engineAt > 0 && engineEnd > engineAt, 'the search engine block has moved');
const engine = {};
vm.runInNewContext(settingsJs.slice(engineAt, engineEnd) + '\nthis.E = { searchNorm, searchTokens, searchDistance, searchPlan, searchScore, SEARCH_ALIASES, SEARCH_GROUPS };', engine);
const E = engine.E;
check('plurals and apostrophes fold', E.searchNorm('Cookies') === 'cookie' && E.searchNorm('entries') === 'entry' && E.searchNorm('site’s') === 'site' && E.searchNorm('access') === 'access');
check('a hyphenated word is found joined and by its parts', ['thirdparty', 'third', 'party', 'cookie'].every((t) => E.searchTokens('Third-party cookies').has(t)));
check('two swapped letters are one slip', E.searchDistance('cookei', 'cookie', 1) === 1 && E.searchDistance('phising', 'phishing', 1) === 1 && E.searchDistance('dark', 'trackers', 1) > 1);
const searchable = [];
data.D.sections.concat(data.D.carried.flatMap((c) => [{ title: '', rows: c.rows }])).forEach((s) => s.rows.forEach((r) => searchable.push({ key: r.key, fields: [
  { tokens: E.searchTokens(E.SEARCH_ALIASES[r.key] || ''), weight: 7 }, { tokens: E.searchTokens(r.name), weight: 6 },
  { tokens: E.searchTokens(s.title), weight: 3 }, { tokens: E.searchTokens(r.desc), weight: 2 }] })));
const vocab = new Set();
searchable.forEach((x) => x.fields.forEach((f) => f.tokens.forEach((t) => vocab.add(t))));
const search = (q) => {
  const plan = E.searchPlan(q, vocab);
  const hits = searchable.map((x, i) => ({ key: x.key, i, s: E.searchScore(x.fields, plan, false) })).filter((h) => h.s > 0).sort((a, b) => b.s - a.s || a.i - b.i);
  return { keys: hits.map((h) => h.key), corrected: plan.corrected };
};
for (const [q, first] of [['ads', 'adShield'], ['vpn', 'blockWebRTCLeak'], ['third party cookies', 'blockThirdPartyCookies'], ['pop ups', 'blockForcedPopups'],
  ['pop-ups', 'blockForcedPopups'], ['keep me logged in', 'loginCompatibility'], ['phising', 'detectPhishing'], ['cookies third-party', 'blockThirdPartyCookies']]) {
  const found = search(q).keys[0];
  check('“' + q + '” finds ' + first + ' first, not ' + found, found === first);
}
const typo = search('cokie');
check('a typo is read as the word it was one slip from, and says so', typo.corrected.length === 1 && typo.corrected[0][1] === 'cookie' && typo.keys.includes('blockThirdPartyCookies'));
check('a short word is never guessed at', search('dark').corrected.length === 0);
check('nonsense finds nothing', search('zzzz qqqq').keys.length === 0);
const placedOrIds = new Set(Array.from(placed).concat(['eyeshield', 'shortcuts']));
assert.deepStrictEqual(Object.keys(E.SEARCH_ALIASES).filter((k) => !placedOrIds.has(k)), [], 'every search alias names a setting on the page');

/* Keyboard shortcuts are read from the browser, and no key is written into the page's words. */
check('shortcuts come from chrome.commands.getAll()', /chrome\.commands\.getAll\(/.test(settingsJs));
const manifestKeys = Object.values(manifest.commands || {}).map((c) => c.suggested_key && c.suggested_key.default).filter(Boolean);
check('the page never spells out a suggested key itself', manifestKeys.length > 0 && manifestKeys.every((k) => !settingsJs.includes(k)));
check('every command has a line saying what it does', Object.keys(manifest.commands || {}).every((name) => new RegExp("'" + name + "': '").test(settingsJs)));

console.log('settings page: ' + checks + ' checks passed');
