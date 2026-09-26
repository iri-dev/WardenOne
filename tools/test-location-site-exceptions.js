/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/*
 * Pausing WardenOne on a site hands location back to Chrome's own prompt (COMPAT-02).
 * Run: node tools/test-location-site-exceptions.js
 *      WARDENONE_BACKGROUND=<older background.js> node tools/test-location-site-exceptions.js
 *
 * With Block location requests on, the worker writes 'block' for every web URL into Chrome's
 * location content setting. Pausing WardenOne on a map or store-finder site paused the page engine
 * and nothing else: the profile-wide block stayed, the site was still denied, and the popup said the
 * site was excused. The only escape was to weaken Location Privacy everywhere.
 *
 * The one applier that owns Chrome's location rules now also writes an 'ask' -- never an 'allow' --
 * on a more specific pattern for every site WardenOne is paused on and every site the reader switched
 * the block off for; Chrome applies the more specific rule, so the site gets the browser's own prompt.
 * A site that stops being excused is written back to 'block'; a lapsed timed pause is noticed by an
 * alarm at the moment it lapses; turning the block off clears every rule of ours instead of writing a
 * backed-up value over the reader's own choices. Driven here against a fake content-setting store
 * that resolves the effective setting the way Chrome does: the most specific matching pattern wins.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const BG_PATH = process.env.WARDENONE_BACKGROUND ? path.resolve(process.env.WARDENONE_BACKGROUND) : path.join(ROOT, 'background.js');
const BG = fs.readFileSync(BG_PATH, 'utf8');
const DOMAIN_UTILS = fs.readFileSync(path.join(ROOT, 'domain-utils.js'), 'utf8');
const POPUP_HTML = fs.readFileSync(path.join(ROOT, 'popup.html'), 'utf8');
const GATE = fs.readFileSync(path.join(ROOT, 'tools', 'check-maintainability.js'), 'utf8');

let pass = 0;
const failures = [];
function check(name, cond, detail) {
  if (cond) { pass++; return; }
  failures.push(name + (detail === undefined ? '' : ' — ' + (typeof detail === 'string' ? detail : JSON.stringify(detail))));
}
let finished = false;
process.exitCode = 1;
process.on('exit', () => { if (!finished) console.log('  FAIL the suite stopped before it finished'); });

function lift(name) {
  let start = BG.indexOf('function ' + name + '(');
  if (start < 0) return null;
  if (BG.slice(start - 6, start) === 'async ') start -= 6;
  let depth = 0;
  for (let i = BG.indexOf('{', start); i < BG.length; i++) {
    if (BG[i] === '{') depth++;
    else if (BG[i] === '}') { depth--; if (depth === 0) return BG.slice(start, i + 1); }
  }
  return null;
}
const PIECES = ['contentSettingSetDetails', 'contentSettingGetDetails', 'globalContentSettingApi', 'getLocationSettingForProbe',
  'setGlobalLocationSetting', 'localRemove', 'normalizeAllowlistHost', 'normalizeAllowlistHosts', 'normalizeIpLiteral', 'ipv4FromMappedIpv6', 'isLocalOrPrivateHost',
  'activeAllowlist', 'nextSitePauseLapse', 'locationExemptHosts', 'locationPatternsFor', 'setLocationRule', 'clearLocationRules', 'scheduleSitePauseExpiry',
  'applyGlobalLocationBlock', 'refreshGlobalLocationBlock'];
const missing = PIECES.filter((p) => !lift(p));
check('every piece of the location applier is present', missing.length === 0, 'missing: ' + missing.join(', '));
const constBlock = (() => {
  const i = BG.indexOf("const LOCATION_BACKUP_KEY = ");
  const j = BG.indexOf('\nfunction ', i);
  return i >= 0 ? BG.slice(i, j).split('\n').filter((l) => /^const /.test(l)).join('\n') : '';
})();

/* A content-setting store that answers like Chrome: the most specific matching pattern decides. */
function fakeLocationStore(state) {
  const rules = new Map();   // primaryPattern -> { setting, scope }
  const specificity = (pattern) => {
    if (pattern === '<all_urls>') return 0;
    if (/^https?:\/\/\*\/\*$/.test(pattern)) return 1;
    if (/^https?:\/\/\*\./.test(pattern)) return 2 + pattern.length / 1000;
    return 3 + pattern.length / 1000;
  };
  const matches = (pattern, url) => {
    if (pattern === '<all_urls>') return true;
    const m = /^(https?):\/\/([^/]+)\/\*$/.exec(pattern);
    if (!m) return false;
    const u = new URL(url);
    if (u.protocol !== m[1] + ':') return false;
    const host = m[2];
    if (host === '*') return true;
    if (host.startsWith('*.')) { const base = host.slice(2); return u.hostname === base || u.hostname.endsWith('.' + base); }
    return u.hostname === host;
  };
  const effective = (url) => {
    let best = null;
    for (const [pattern, rule] of rules) {
      if (!matches(pattern, url)) continue;
      if (!best || specificity(pattern) > specificity(best.pattern)) best = { pattern, setting: rule.setting };
    }
    return best ? best.setting : 'ask';   // Chrome's default
  };
  const api = {
    set(details, cb) { state.sets.push({ pattern: details.primaryPattern, setting: details.setting, scope: details.scope }); rules.set(details.primaryPattern, { setting: details.setting, scope: details.scope }); cb(); },
    get(details, cb) { state.gets.push(details.primaryUrl); cb({ setting: effective(details.primaryUrl) }); },
    clear(details, cb) { state.clears.push(details.scope); rules.clear(); cb(); },
  };
  if (state.noClear) delete api.clear;
  return { api, rules, effective };
}

function rig(options) {
  const o = options || {};
  const state = { sets: [], gets: [], clears: [], local: {}, written: [], removed: [], alarms: { created: [], cleared: [] }, now: o.now || 1758240000000, noClear: !!o.noClear };
  const store = fakeLocationStore(state);
  const sandbox = {
    console: { warn() {} }, Object, Array, String, Number, Set, Map, JSON, Promise, URL, Math, Date: Object.assign(function () { return new Date(state.now); }, { now: () => state.now }),
    setTimeout, clearTimeout,
    INCOGNITO_CONTEXT: !!o.incognito,
    CONTENT_SETTING_SCOPE: o.incognito ? 'incognito_session_only' : 'regular',
    chrome: {
      runtime: { lastError: null },
      contentSettings: { location: store.api },
      alarms: { create: (name, info) => state.alarms.created.push({ name, when: info && info.when }), clear: (name, cb) => { state.alarms.cleared.push(name); if (cb) cb(); } },
    },
    localGet: async (key) => ({ [key]: state.local[key] }),
    localSet: async (obj) => { Object.assign(state.local, JSON.parse(JSON.stringify(obj))); state.written.push(Object.keys(obj)[0]); },
    refreshExtensionState: () => { state.reconciled = (state.reconciled || 0) + 1; },
  };
  vm.createContext(sandbox);
  const src = DOMAIN_UTILS + '\n' + constBlock + '\nlet __globalLocationBlockEnabled = null; let __locationExemptKey = null;\n'
    + PIECES.map(lift).filter(Boolean).join('\n')
    + '\nglobalThis.api = { apply: applyGlobalLocationBlock, exempt: (typeof locationExemptHosts === "function" ? locationExemptHosts : function () { return []; }),'
    + ' patterns: (typeof locationPatternsFor === "function" ? locationPatternsFor : null), schedule: (typeof scheduleSitePauseExpiry === "function" ? scheduleSitePauseExpiry : null),'
    + ' wake: () => { __globalLocationBlockEnabled = null; __locationExemptKey = null; } };';
  vm.runInContext(src, sandbox, { filename: 'location-lift.js' });
  sandbox.localRemove = async (key) => { delete state.local[key]; state.removed.push(key); };
  return { api: sandbox.api, state, store, effective: store.effective,
    /* The worker is torn down: memory forgets, storage and Chrome's rules remain. */
    wake() { sandbox.api.wake(); state.sets.length = 0; state.written.length = 0; } };
}
const cfgWith = (o) => Object.assign({ enabled: true, blockGeolocation: true, allowlist: [], allowlistUntil: {}, siteOverrides: {} }, o || {});
const NOW = 1758240000000;
const MAPS = 'https://maps-demo.com/route';
const SUB = 'https://tiles.maps-demo.com/tile/1';
const OTHER = 'https://other-site.com/';
const STORE = 'https://store-finder.net/';

(async () => {
  console.log('\nlocation exceptions for paused sites\n');

  /* ---- 1. the reported case ------------------------------------------------------------ */
  try {
    const r = rig();
    check('locationExemptHosts exists', typeof lift('locationExemptHosts') === 'string');
    const plain = cfgWith();
    await r.api.apply(true, r.api.exempt ? r.api.exempt(plain) : []);
    check('with the block on and nothing excused, a map site is blocked', r.effective(MAPS) === 'block' && r.effective(OTHER) === 'block');
    const paused = cfgWith({ allowlistUntil: { 'maps-demo.com': NOW + 15 * 60000 } });
    await r.api.apply(true, r.api.exempt ? r.api.exempt(paused) : []);
    check('pause WardenOne on the map site and it gets Chrome\'s own prompt', r.effective(MAPS) === 'ask', r.effective(MAPS));
    check('...its subdomains too', r.effective(SUB) === 'ask');
    check('...and every other site stays blocked', r.effective(OTHER) === 'block');
    check('a pause never grants: no rule of ours is ever "allow"', Array.from(r.store.rules.values()).every((rule) => rule.setting !== 'allow') && r.state.sets.every((s) => s.setting !== 'allow'));
    check('the exception is written on both schemes of the site pattern', r.state.sets.some((s) => s.pattern === 'https://*.maps-demo.com/*' && s.setting === 'ask') && r.state.sets.some((s) => s.pattern === 'http://*.maps-demo.com/*' && s.setting === 'ask'));
    check('the excused sites are remembered so they can be found again', JSON.stringify(r.state.local.wardenone_location_site_rules) === '["maps-demo.com"]', r.state.local.wardenone_location_site_rules);
  } catch (e) { check('the reported case', false, 'could not run: ' + (e && e.message || e)); }

  /* ---- 2. every way a site is excused --------------------------------------------------- */
  try {
    const r = rig();
    const cfg = cfgWith({
      allowlist: ['store-finder.net'],
      allowlistUntil: { 'maps-demo.com': NOW + 60000, 'lapsed-site.com': NOW - 1 },
      siteOverrides: { 'weather-now.com': { blockGeolocation: false }, 'news-daily.com': { adShield: false }, 'bad host!': { blockGeolocation: false } },
    });
    const hosts = r.api.exempt(cfg);
    check('a permanent allowlist entry, a live pause and a per-site switch all excuse a site', JSON.stringify(hosts) === JSON.stringify(['maps-demo.com', 'store-finder.net', 'weather-now.com']), hosts);
    check('...a lapsed pause, an override for another switch and an invalid host do not', !hosts.includes('lapsed-site.com') && !hosts.includes('news-daily.com') && hosts.length === 3);
    await r.api.apply(true, hosts);
    check('all three answer "ask"', r.effective(MAPS) === 'ask' && r.effective(STORE) === 'ask' && r.effective('https://weather-now.com/') === 'ask');
    check('...and the rest is blocked', r.effective(OTHER) === 'block' && r.effective('https://news-daily.com/') === 'block' && r.effective('https://lapsed-site.com/') === 'block');
  } catch (e) { check('every way a site is excused', false, 'could not run: ' + (e && e.message || e)); }

  /* ---- 3. a pause lapses ----------------------------------------------------------------- */
  try {
    const r = rig();
    const paused = cfgWith({ allowlistUntil: { 'maps-demo.com': NOW + 60000 } });
    await r.api.apply(true, r.api.exempt(paused));
    check('excused while the pause runs', r.effective(MAPS) === 'ask');
    r.state.now = NOW + 61000;
    r.state.sets.length = 0;
    await r.api.apply(true, r.api.exempt(paused));
    check('when the pause lapses the site is blocked again', r.effective(MAPS) === 'block' && r.effective(SUB) === 'block', r.effective(MAPS));
    check('...written explicitly on its own two patterns, and nothing else touched', r.state.sets.length === 2 && r.state.sets.every((s) => s.setting === 'block' && /maps-demo\.com/.test(s.pattern)), r.state.sets);
    check('...and the remembered list is empty', JSON.stringify(r.state.local.wardenone_location_site_rules) === '[]');
  } catch (e) { check('a pause lapses', false, 'could not run: ' + (e && e.message || e)); }

  /* ---- 4. the alarm that notices the lapse ---------------------------------------------- */
  try {
    const r = rig();
    check('scheduleSitePauseExpiry exists', typeof r.api.schedule === 'function');
    if (r.api.schedule) {
      r.api.schedule(cfgWith({ allowlistUntil: { 'alpha-site.com': NOW + 300000, 'beta-site.com': NOW + 60000, 'gone-site.com': NOW - 5 } }));
      const created = r.state.alarms.created[0];
      check('one alarm is armed just after the earliest live pause lapses', !!created && created.name === 'wardenone-site-pause-expiry' && created.when === NOW + 61000, created);
      r.api.schedule(cfgWith());
      check('with no pause pending the alarm is cleared', r.state.alarms.cleared.includes('wardenone-site-pause-expiry'));
    }
    const listener = BG.slice(BG.indexOf("chrome.alarms?.onAlarm.addListener"), BG.indexOf("chrome.alarms?.onAlarm.addListener") + 1400);
    check('the alarm re-runs the whole reconcile, which derives the pass and the exception alike', /alarm\.name === SITE_PAUSE_EXPIRY_ALARM\) refreshExtensionState\(\);/.test(listener));
    const reconcile = lift('refreshExtensionState') || '';
    check('the reconcile arms it on every pass, before its own early-out, and never lets that stop the pass', /try \{ scheduleSitePauseExpiry\(cfg\); \} catch \(_\) \{\}[\s\S]{0,400}const stateKey = \[/.test(reconcile));
    check('the lapse is read through the pause resolver, the one place allowed to read the map', /function nextSitePauseLapse\(cfg\)/.test(BG) && /const earliest = nextSitePauseLapse\(cfg\);/.test(lift('scheduleSitePauseExpiry') || '') && !/cfg\.allowlistUntil/.test(lift('scheduleSitePauseExpiry') || ''));
    check('the excused sites are part of the desired state the reconcile keys on', /locationExemptHosts\(cfg\)\.join\(','\),/.test(reconcile));
    check('the reconcile hands them to the applier', /run\('geolocation', \(\) => applyGlobalLocationBlock\(on && cfg\.blockGeolocation === true, locationExemptHosts\(cfg\)\)\);/.test(reconcile));
    check('the standalone refresh does too', /applyGlobalLocationBlock\(on && cfg\.blockGeolocation === true, locationExemptHosts\(cfg\)\);/.test(lift('refreshGlobalLocationBlock') || ''));
  } catch (e) { check('the alarm that notices the lapse', false, 'could not run: ' + (e && e.message || e)); }

  /* ---- 5. a worker wake changes nothing it does not have to ------------------------------ */
  try {
    const r = rig();
    const cfg = cfgWith({ allowlist: ['maps-demo.com', 'store-finder.net'] });
    await r.api.apply(true, r.api.exempt(cfg));
    r.wake();
    await r.api.apply(true, r.api.exempt(cfg));
    check('after a wake with nothing changed, no site rule is rewritten and nothing is stored', r.state.sets.every((s) => !/maps|store/.test(s.pattern)) && r.state.written.length === 0, { sets: r.state.sets.map((s) => s.pattern), written: r.state.written });
    check('...and the sites still answer "ask"', r.effective(MAPS) === 'ask' && r.effective(STORE) === 'ask');
  } catch (e) { check('a worker wake changes nothing it does not have to', false, 'could not run: ' + (e && e.message || e)); }

  /* ---- 6. the block goes off -------------------------------------------------------------- */
  try {
    const r = rig();
    await r.api.apply(true, r.api.exempt(cfgWith({ allowlist: ['maps-demo.com'] })));
    await r.api.apply(false, []);
    check('turning the block off clears every rule of ours', r.state.clears.length === 1 && r.store.rules.size === 0);
    check('...so the browser\'s own default answers everywhere', r.effective(MAPS) === 'ask' && r.effective(OTHER) === 'ask');
    check('...and both records are removed', r.state.removed.includes('wardenone_location_previous_setting') && r.state.removed.includes('wardenone_location_site_rules'));
    check('the clear carries the profile scope', r.state.clears[0] === 'regular');
  } catch (e) { check('the block goes off (1)', false, 'could not run: ' + (e && e.message || e)); }
  try {
    const r = rig({ noClear: true });
    await r.api.apply(true, r.api.exempt(cfgWith({ allowlist: ['maps-demo.com'] })));
    await r.api.apply(false, []);
    check('a browser without clear() gets the backed-up value on every pattern this extension touched', r.store.rules.size === 5 && Array.from(r.store.rules.values()).every((rule) => rule.setting === 'ask'), Array.from(r.store.rules.entries()));
  } catch (e) { check('the block goes off (2)', false, 'could not run: ' + (e && e.message || e)); }
  try {
    const r = rig({ incognito: true });
    await r.api.apply(true, r.api.exempt(cfgWith({ allowlist: ['maps-demo.com'] })));
    check('in a split incognito worker the exceptions carry the incognito scope', r.state.sets.length > 0 && r.state.sets.every((s) => s.scope === 'incognito_session_only'));
    await r.api.apply(false, []);
    check('...and so does the clear', r.state.clears[0] === 'incognito_session_only');
  } catch (e) { check('the block goes off (3)', false, 'could not run: ' + (e && e.message || e)); }

  /* ---- 7. patterns, and what is never written -------------------------------------------- */
  try {
    const r = rig();
    if (r.api.patterns) {
      check('a site pattern covers the host and everything under it, on both schemes', JSON.stringify(r.api.patterns('maps-demo.com')) === JSON.stringify(['https://*.maps-demo.com/*', 'http://*.maps-demo.com/*']));
      check('an address literal names itself alone', JSON.stringify(r.api.patterns('203.0.113.9')) === JSON.stringify(['https://203.0.113.9/*', 'http://203.0.113.9/*']));
      check('an empty host has no patterns', r.api.patterns('').length === 0);
    }
    check('the applier is still the one serialized owner of the location setting; no second applier was added', /'applyGlobalLocationBlock',/.test(BG) && !/^(?:async )?function apply\w*Location\w*\(/m.test(BG.replace('function applyGlobalLocationBlock(', '').replace('function applyLocationPrivacyHeaderRule(', '')));
    check('the popup says a pause hands location back to Chrome\'s prompt and never grants it', /hands that site back to Chrome&rsquo;s own location prompt/.test(POPUP_HTML) && /never grants location by itself/.test(POPUP_HTML));
    check('...and says so on the pause control too', /location goes back to Chrome&rsquo;s own prompt, never to automatic access/.test(POPUP_HTML));
    check('this suite is wired into the gate', /test-location-site-exceptions\.js/.test(GATE));
  } catch (e) { check('patterns, and what is never written', false, 'could not run: ' + (e && e.message || e)); }

  finished = true;
  console.log('');
  if (failures.length) {
    for (const f of failures) console.log('  FAIL ' + f);
    console.log('\n' + failures.length + ' check(s) failed, ' + pass + ' passed');
    process.exit(1);
  }
  process.exitCode = 0;
  console.log('  ok  ' + pass + ' checks: a paused site gets the browser\'s own prompt, and nothing gets location for free');
})().catch((e) => { finished = true; console.error(e); process.exit(1); });
