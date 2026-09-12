/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/*
 * "Turn off one protection here" offers only what can be turned off here (FEAT-01).
 *
 * The picker was generated from every boolean in the popup's KEYS, so it offered certificate
 * checks, list updates, Download Shield and Memory Shield -- features no page-side script ever
 * reads -- and confirmed "turned off for shop.example" while nothing changed. The only consumer
 * of siteOverrides is bridge.js, which applies them to the config it hands the page; and the
 * bridge's own gates read a copy the override never reached.
 *
 * The popup now carries a scope table: page-resolved protections, and mixed ones whose page
 * half stops here while a network or worker half keeps running, which the picker says. This
 * suite derives the same split from the sources that read each key -- the engine, the MAIN
 * guards, the bridge, the worker -- and fails when the table and the code disagree; then it
 * drives the shipped popup functions through the record's table: a content-only feature, a
 * worker-only one, a DNR-only one, a mixed one, and a global one that makes no sense per site.
 *
 * Run: node tools/test-site-override-scope.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const POPUP = read('popup.js');
const POPUP_HTML = read('popup.html');
const BRIDGE = read('bridge.js');

let failures = 0;
function check(label, condition, extra) {
  if (condition) { console.log('  ok  ' + label); return; }
  failures++;
  console.log('  FAIL ' + label + (extra === undefined ? '' : ' :: ' + (typeof extra === 'string' ? extra : JSON.stringify(extra))));
}
function grabFn(src, name) {
  const at = src.indexOf('function ' + name + '(');
  if (at < 0) throw new Error('no ' + name);
  let depth = 0;
  for (let i = src.indexOf('{', at); i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) return src.slice(at, i + 1); }
  }
  throw new Error(name + ' unterminated');
}
function block(src, startMark, endMark) {
  const a = src.indexOf(startMark); if (a < 0) throw new Error('no ' + startMark);
  const b = src.indexOf(endMark, a); if (b < 0) throw new Error('no end for ' + startMark);
  return src.slice(a, b + endMark.length);
}

/* ---- the popup's tables ------------------------------------------------------------ */
const tables = {};
vm.createContext(tables);
vm.runInContext(block(POPUP, 'const KEYS = [', '];') + '\n' + block(POPUP, 'const DEFAULTS = {', '\n};') + '\n'
  + block(POPUP, 'const SITE_OVERRIDE_SCOPE = {', '\n};') + '\nglobalThis.T = { KEYS, DEFAULTS, SITE_OVERRIDE_SCOPE };', tables);
const { KEYS, DEFAULTS, SITE_OVERRIDE_SCOPE } = tables.T;
const PAGE = new Set(SITE_OVERRIDE_SCOPE.page);
const MIXED = new Set(SITE_OVERRIDE_SCOPE.mixed);

/* ---- who reads what, from the sources ---------------------------------------------- */
const pageReads = new Set();
const workerReads = new Set();
const collect = (set, src, re) => { for (const m of src.matchAll(re)) set.add(m[1]); };
collect(pageReads, read('src/content.js'), /\bWO\.([A-Za-z0-9_]+)/g);
collect(pageReads, read('src/content.js'), /\bcfg\.([A-Za-z0-9_]+)/g);
collect(pageReads, read('anti-redirect.js'), /\bguardConfig\.([A-Za-z0-9_]+)/g);
collect(pageReads, read('anti-redirect.js'), /\bcfg\(\)\.([A-Za-z0-9_]+)/g);
collect(pageReads, read('permission-chain.js'), /\bcfg\.([A-Za-z0-9_]+)/g);
collect(pageReads, read('cryptominer-detect.js'), /\bo\.([A-Za-z0-9_]+)/g);
collect(pageReads, BRIDGE, /\bbridgeConfig\.([A-Za-z0-9_]+)/g);
collect(pageReads, BRIDGE, /\bclean\.([A-Za-z0-9_]+)/g);
for (const f of ['yt-adblock.js', 'twitch-adblock.js', 'spotify-adblock.js', 'eyeshield.js', 'consent-reject.js', 'consent-wall.js',
  'mail-shield.js', 'search-junk.js', 'twitch-rewind.js', 'twitch-vod-rewind.js', 'oauth-guard.js']) {
  try { collect(pageReads, read(f), /\b(?:cfg|config|overrides|o|c|settings)\.([A-Za-z0-9_]+)/g); } catch (_) {}
}
for (const f of ['background.js', 'background-downloads.js', 'background-startup.js', 'background-memory.js', 'background-extension-watch.js']) {
  try { collect(workerReads, read(f), /\b(?:cfg|config|merged|repairCfg|c)\.([A-Za-z0-9_]+)/g); } catch (_) {}
}

console.log('\nsite override scope\n');

const toggles = KEYS.filter((k) => typeof DEFAULTS[k] === 'boolean');
check('the table names only real toggles', [...PAGE, ...MIXED].every((k) => toggles.includes(k)), [...PAGE, ...MIXED].filter((k) => !toggles.includes(k)).join(', '));
check('no key is in both halves', [...PAGE].every((k) => !MIXED.has(k)));
const pageWrong = [...PAGE].filter((k) => !pageReads.has(k) || workerReads.has(k));
check('every page-resolved key is read by a page-side script and by no worker file', pageWrong.length === 0, pageWrong.join(', '));
const mixedWrong = [...MIXED].filter((k) => !pageReads.has(k) || !workerReads.has(k));
check('every mixed key is read by a page-side script and by the worker', mixedWrong.length === 0, mixedWrong.join(', '));
const missing = toggles.filter((k) => pageReads.has(k) && !PAGE.has(k) && !MIXED.has(k));
check('every toggle a page-side script reads is offered somewhere', missing.length === 0, missing.join(', '));
const offeredButUnread = toggles.filter((k) => (PAGE.has(k) || MIXED.has(k)) && !pageReads.has(k));
check('nothing is offered that no page-side script reads', offeredButUnread.length === 0, offeredButUnread.join(', '));

/* the record's table, by name */
check('a content-only protection is page-resolved (Media Shield)', PAGE.has('mediaShield'));
check('a worker-only one is not offered (certificate guard)', !PAGE.has('certificateGuard') && !MIXED.has('certificateGuard') && workerReads.has('certificateGuard') && !pageReads.has('certificateGuard'));
check('a DNR-only one is not offered (intranet network rules)', !PAGE.has('intranetNetworkRules') && !MIXED.has('intranetNetworkRules'));
check('a mixed one is offered as page-part-only (third-party cookies)', MIXED.has('blockThirdPartyCookies') && workerReads.has('blockThirdPartyCookies'));
check('a global setting is not offered (list auto-update)', !PAGE.has('autoUpdateLists') && !MIXED.has('autoUpdateLists'));
check('Download Shield and Memory Shield are not offered', ['downloadDomainAge', 'downloadVirusTotal', 'memoryShield', 'memoryNeverForms'].every((k) => !PAGE.has(k) && !MIXED.has(k)));

/* ---- the popup, driven --------------------------------------------------------------- */
{
  const notes = [];
  const persisted = [];
  const ctx = {
    Object, Array, String, JSON, Number, Set,
    config: { siteOverrides: { 'shop.example': { mediaShield: false, certificateGuard: false, autoUpdateLists: false }, 'news.example': { intranetNetworkRules: false } } },
    $: () => null,
    setNote: (el, parts) => notes.push((parts || []).map((p) => p.t).join('')),
    persistConfig: (onSaved) => { persisted.push(JSON.parse(JSON.stringify(ctx.config.siteOverrides))); if (onSaved) onSaved([]); },
    paintSiteControls: () => {},
    repaintExternalConfigKeys: () => {},
    protectionLabel: (k) => k,
  };
  vm.createContext(ctx);
  vm.runInContext(block(POPUP, 'const SITE_OVERRIDE_SCOPE = {', '\n};') + '\n'
    + block(POPUP, 'const SITE_OVERRIDE_KEYS = new Set(', ');') + '\n' + block(POPUP, 'const SITE_OVERRIDE_MIXED = new Set(', ');') + '\n'
    + grabFn(POPUP, 'pruneUnsupportedSiteOverrides') + '\n' + grabFn(POPUP, 'siteOverridesFor') + '\n' + grabFn(POPUP, 'setSiteOverride')
    + '\nglobalThis.api = { prune: pruneUnsupportedSiteOverrides, set: setSiteOverride, forHost: siteOverridesFor };', ctx);
  const stale = ctx.api.prune('shop.example');
  check('stored overrides for what never applied are dropped and named', JSON.stringify(stale) === JSON.stringify(['certificateGuard', 'autoUpdateLists']), stale);
  check('the one that does apply stays', JSON.stringify(ctx.config.siteOverrides['shop.example']) === JSON.stringify({ mediaShield: false }));
  check('and the pruning is persisted', persisted.length === 1);
  check('a host left with nothing is removed', ctx.api.prune('news.example').length === 1 && !('news.example' in ctx.config.siteOverrides));
  check('a second look finds nothing to drop', ctx.api.prune('shop.example').length === 0 && persisted.length === 2);

  ctx.api.set('shop.example', 'certificateGuard', false);
  check('turning off a worker-only protection here is refused, and said', !('certificateGuard' in (ctx.config.siteOverrides['shop.example'] || {})) && /cannot be turned off for one site/.test(notes[notes.length - 1] || ''), notes);
  ctx.api.set('shop.example', 'blockThirdPartyCookies', false);
  check('a mixed one is stored', ctx.config.siteOverrides['shop.example'].blockThirdPartyCookies === false);
  ctx.api.set('shop.example', 'mediaShield', true);
  check('undo removes the entry rather than storing true', !('mediaShield' in ctx.config.siteOverrides['shop.example']));
}

/* ---- what the reader sees --------------------------------------------------------- */
check('the picker draws from the registry', /\.filter\(\(key\) => typeof DEFAULTS\[key\] === 'boolean' && SITE_OVERRIDE_KEYS\.has\(key\)\)/.test(POPUP));
check('and marks the mixed ones', /SITE_OVERRIDE_MIXED\.has\(key\) \? ' \(page part only\)' : ''/.test(POPUP));
check('the list of what is off says it too', /' — page part off here \(network part still on\)'/.test(POPUP));
check('the panel explains the marking', /one marked <em>page part only<\/em> also has a network part that keeps working here/.test(POPUP_HTML));
check('the one-time note has a place', /id="site-off-stale"/.test(POPUP_HTML) && /Removed ' \+ stale\.length \+ ' earlier setting/.test(POPUP));

/* ---- the bridge honours the override for its own gates ------------------------------- */
{
  const ctx = { Object, String, RegExp };
  vm.createContext(ctx);
  vm.runInContext('const bridgeCleanHost = (h) => String(h || "").replace(/^www\\./, "").toLowerCase(); const hostMatchesSite = (h, d) => h === d || h.endsWith("." + d);\n'
    + grabFn(BRIDGE, 'bridgeSiteOverridesFor') + '\nglobalThis.f = bridgeSiteOverridesFor;', ctx);
  const off = ctx.f({ siteOverrides: { 'shop.example': { mediaShield: false, scriptDriftGuard: false, sneaky: true } } }, 'www.shop.example');
  check('the bridge resolves the override for the host', JSON.stringify(off) === JSON.stringify({ mediaShield: false, scriptDriftGuard: false }), off);
  const loop = block(BRIDGE, "    const siteOff = bridgeSiteOverridesFor(clean, location.hostname);", "    clean.siteOverridesApplied");
  check('it applies the override to the copy the page gets', /if \(typeof clean\[key\] === 'boolean'\) clean\[key\] = false;/.test(loop));
  check('and to the copy its own gates read (FEAT-01)', /if \(typeof bridgeConfig\[key\] === 'boolean'\) bridgeConfig\[key\] = false;/.test(loop));
  check('those gates read bridgeConfig', /bridgeConfig\.scriptDriftGuard !== false/.test(BRIDGE) && /bridgeConfig\.loginAgeCheck !== false/.test(BRIDGE) && /bridgeConfig\.permissionChainGuard !== false/.test(BRIDGE));
}

console.log('');
if (failures) { console.log(failures + ' check(s) failed'); process.exit(1); }
console.log('the picker offers only what it can deliver');
