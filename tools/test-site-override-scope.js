/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/* Offer per-site overrides only for protections whose runtime can honour them. (FEAT-01)
   Run: node tools/test-site-override-scope.js */
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
const COORDINATED = new Set(SITE_OVERRIDE_SCOPE.coordinated);
const NETWORK = new Set(SITE_OVERRIDE_SCOPE.network);

/* ---- who reads what, from the sources ---------------------------------------------- */
const pageReads = new Set();
const workerReads = new Set();
const workerEnforcementReads = new Set();
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
  'mail-shield.js', 'search-junk.js', 'twitch-rewind.js', 'twitch-vod-rewind.js', 'oauth-guard.js',
  'anti-adblock-shield.js']) {
  try { collect(pageReads, read(f), /\b(?:cfg|config|overrides|o|c|settings)\.([A-Za-z0-9_]+)/g); } catch (_) {}
}
const worker = read('background.js');
/* The worker only decides whether the shield is registered at all; the per-site answer is the
   page script's, which is why it is in the page-script list above. */
const antiAdblockInjection = grabFn(worker, 'reconcileAntiAdblockShieldInjection');
if (!antiAdblockInjection.includes('antiAdblockShieldOn(cfg)')
    || !antiAdblockInjection.includes("js: ['anti-adblock-shield.js']")) {
  throw new Error('the Anti-Adblock Shield injection no longer reads its switch');
}
for (const f of ['background.js', 'background-cname.js', 'background-downloads.js', 'background-startup.js', 'background-memory.js', 'background-extension-watch.js']) {
  try {
    let source = read(f);
    collect(workerReads, source, /\b(?:cfg|config|merged|repairCfg|c)\.([A-Za-z0-9_]+)/g);
    /* Diagnostic snapshots report page choices; they do not enforce a worker feature. */
    if (f === 'background.js') source = source.replace(grabFn(source, 'privacyTestSettings'), '');
    collect(workerEnforcementReads, source, /\b(?:cfg|config|merged|repairCfg|c)\.([A-Za-z0-9_]+)/g);
  } catch (_) {}
}

console.log('\nsite override scope\n');

const toggles = KEYS.filter((k) => typeof DEFAULTS[k] === 'boolean');
const scopedKeys = [...PAGE, ...MIXED, ...COORDINATED, ...NETWORK];
check('the table names only real toggles', scopedKeys.every((k) => toggles.includes(k)), scopedKeys.filter((k) => !toggles.includes(k)).join(', '));
check('no key appears in multiple scopes', new Set(scopedKeys).size === scopedKeys.length);
const pageWrong = [...PAGE].filter((k) => !pageReads.has(k) || workerEnforcementReads.has(k));
check('every page-resolved key has a page reader and no worker enforcement', pageWrong.length === 0, pageWrong.join(', '));
const mixedWrong = [...MIXED].filter((k) => !pageReads.has(k) || !workerReads.has(k));
check('every mixed key is read by a page-side script and by the worker', mixedWrong.length === 0, mixedWrong.join(', '));
const coordinatedWrong = [...COORDINATED].filter((k) => !pageReads.has(k) || !workerReads.has(k));
check('every coordinated key controls page behavior through a worker owner', coordinatedWrong.length === 0, coordinatedWrong.join(', '));
const networkWrong = [...NETWORK].filter((key) => pageReads.has(key) || !workerEnforcementReads.has(key));
check('every network key has a worker owner and no page reader', networkWrong.length === 0, networkWrong.join(', '));
check('CNAME protection has its own network exception', NETWORK.has('blockCnameTrackers'));
check('first-party URL heuristics remain page-resolved', PAGE.has('blockFirstPartyTrackers'));
const missing = toggles.filter((k) => pageReads.has(k) && !PAGE.has(k) && !MIXED.has(k) && !COORDINATED.has(k));
check('every toggle a page-side script reads is offered somewhere', missing.length === 0, missing.join(', '));
const offeredButUnread = toggles.filter((k) => (PAGE.has(k) || MIXED.has(k) || COORDINATED.has(k)) && !pageReads.has(k));
check('nothing is offered that no page-side script reads', offeredButUnread.length === 0, offeredButUnread.join(', '));

/* the record's table, by name */
check('a content-only protection is page-resolved (Media Shield)', PAGE.has('mediaShield'));
check('a worker-only one is not offered (certificate guard)', !PAGE.has('certificateGuard') && !MIXED.has('certificateGuard') && workerReads.has('certificateGuard') && !pageReads.has('certificateGuard'));
check('a DNR-only one is not offered (intranet network rules)', !PAGE.has('intranetNetworkRules') && !MIXED.has('intranetNetworkRules'));
check('third-party cookies coordinate page and worker exceptions', COORDINATED.has('blockThirdPartyCookies') && workerReads.has('blockThirdPartyCookies'));
check('popup guards have a coordinated site override', COORDINATED.has('blockForcedPopups') && COORDINATED.has('strictPopupShield'));
check('a global setting is not offered (list auto-update)', !PAGE.has('autoUpdateLists') && !MIXED.has('autoUpdateLists'));
check('Download Shield and Memory Shield are not offered', ['downloadDomainAge', 'downloadVirusTotal', 'memoryShield', 'memoryNeverForms'].every((k) => !PAGE.has(k) && !MIXED.has(k)));

/* ---- the popup, driven --------------------------------------------------------------- */
{
  const notes = [];
  const persisted = [];
  const ctx = {
    Object, Array, String, JSON, Number, Set,
    hostMatchesSite: (host, pattern) => host === pattern || host.endsWith('.' + pattern),
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
    + '\n' + grabFn(POPUP, 'paintSiteOverrideIndicators')
    + '\nglobalThis.api = { prune: pruneUnsupportedSiteOverrides, set: setSiteOverride, forHost: siteOverridesFor, paint: paintSiteOverrideIndicators };', ctx);
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
  ctx.api.set('shop.example', 'blockCnameTrackers', false);
  check('a supported network exception is stored', ctx.config.siteOverrides['shop.example'].blockCnameTrackers === false);
  ctx.api.set('shop.example', 'mediaShield', true);
  check('undo removes the entry rather than storing true', !('mediaShield' in ctx.config.siteOverrides['shop.example']));
  const notices = [], buttons = [];
  const input = { checked: true, closest: () => ({ querySelector: () => ({ parentElement: { appendChild: node => notices.push(node) } }) }) };
  ctx.document = {
    querySelectorAll: selector => selector === '.site-override-state' ? notices.splice(0).map(() => ({ remove() {} }))
      : selector === 'input[data-key="scriptletEngine"]' ? [input] : [],
    createTextNode: text => ({ textContent: text }),
    createElement: tag => {
      const node = { children: [], style: {}, appendChild(child) { this.children.push(child); }, addEventListener(type, fn) { this[type] = fn; } };
      if (tag === 'button') buttons.push(node);
      return node;
    },
  };
  ctx.config.siteOverrides['shop.example'].scriptletEngine = false;
  ctx.api.paint('shop.example');
  check('a global switch shows its active-site pause beside the control', input.checked === true && notices[0].children[0].textContent === 'Off on shop.example. ');
  buttons[0].click();
  check('the popup can restore that site without changing the global preference', !('scriptletEngine' in ctx.config.siteOverrides['shop.example']) && input.checked === true);
  ctx.api.paint('shop.example');
  check('restoring removes the stale site-pause notice', notices.length === 0);
  ctx.config.siteOverrides.example = { mediaShield: false };
  check('effective site state includes a matching parent exception', ctx.api.forHost('shop.example').mediaShield === false);
  ctx.api.set('shop.example', 'mediaShield', true);
  check('a wider exception cannot be falsely restored here', /wider site exception/.test(notes[notes.length - 1]));
  let enables = 0; ctx.enableYoutubeFromPopup = () => { enables++; };
  ctx.config.scriptletEngine = true;
  ctx.api.paint('youtube.com');
  check('an on YouTube engine is left to get on with it', notices.length === 0);
  ctx.config.siteOverrides['youtube.com'] = { scriptletEngine: false };
  ctx.api.paint('youtube.com');
  check('the global switch explains a local YouTube pause', input.checked && notices[0].children[0].textContent === 'Off for youtube.com. '
    && buttons[buttons.length - 1].textContent === 'Turn on & reload');
  buttons[buttons.length - 1].click();
  check('the restore action uses the coordinated YouTube worker command', enables === 1);
}

{
  for (const success of [true, false]) {
    const calls = [], painted = [], ticks = [];
    const saved = { scriptletEngine: true, siteOverrides: {} };
    const ctx = { Number, DEFAULTS, config: { scriptletEngine: true, siteOverrides: { 'youtube.com': { scriptletEngine: false } } },
      savedConfigSnapshot: { scriptletEngine: true },
      setSavedTick: (...args) => ticks.push(args), applyToUI() {}, paintSiteControls: () => painted.push('site'),
      repaintExternalConfigKeys: keys => painted.push(keys),
      adoptExternalConfigChange: value => Object.assign(ctx.config, value),
      chrome: { tabs: { query: (_filter, callback) => callback([{ id: 7 }]) },
        runtime: { sendMessage: (message, callback) => { calls.push(message); callback(success ? { ok: true, reloaded: true } : { ok: false, error: 'Browser rules need retry' }); } },
        storage: { local: { get: (_key, callback) => callback({ wardenone_config: saved }) } } },
    };
    vm.createContext(ctx); vm.runInContext(grabFn(POPUP, 'enableYoutubeFromPopup') + '\nenableYoutubeFromPopup();', ctx);
    check('the popup sends only the selected tab for ' + (success ? 'restore' : 'retry'),
      JSON.stringify(calls) === JSON.stringify([{ kind: 'enable-youtube-for-site', tabId: 7 }]));
    check('the popup refreshes saved state after ' + (success ? 'success' : 'an apply failure'),
      !ctx.config.siteOverrides['youtube.com'] && painted.length > 0 && ticks[0][1] === !success);
  }
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
