/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/*
 * The Eye Shield anti-flash backdrop learns its mode without touching the site's storage.
 * Run: node tools/test-eyeshield-preload-hint.js
 *
 * eyeshield.js paints a dark or light backdrop at document_start, before the async config
 * snapshot answers, so a themed page does not flash its native colours first. It used to learn
 * the mode from a key it kept in each site's own localStorage (__woEyeShieldMode, including the
 * value "off"): readable by every site it ran on, and left behind after uninstall (PRIV-12).
 *
 * Now the worker registers a one-line eyeshield-preload-<mode>.js AHEAD of eyeshield.js in the
 * same registration. It sets a property in the extension's isolated world, which the page
 * cannot see, and the script reads that. Nothing is written to site storage any more; the old
 * key is removed wherever the script still runs, and from open tabs when theming is switched off.
 *
 * This suite pins: the script never writes site storage; the three hint files say what their
 * names say; the worker registers the hint first, swaps it when the mode changes, drops it for
 * a mode of "off", and erases the legacy key on the way out; and the page-side block paints from
 * the hint, skips the hosts it always skipped, and survives a frame whose storage throws.
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const EYESHIELD = read('eyeshield.js');
const BG = read('background.js');
const WOEyeShieldProfiles = require('../eyeshield-profiles.js');
const MODES = ['dark', 'ultra', 'light'];
const HINT = '__wardenOneEyeShieldPreloadMode';
const LEGACY_KEY = '__woEyeShieldMode';

let passed = 0;
const failures = [];
function check(name, cond, detail) {
  if (cond) { passed++; return; }
  failures.push(name + (detail ? ' -- ' + (typeof detail === 'string' ? detail : JSON.stringify(detail)) : ''));
}
function balanced(src, from) {
  let depth = 0;
  for (let i = src.indexOf('{', from); i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) return src.slice(from, i + 1);
  }
  throw new Error('unbalanced from ' + from);
}
function grabFn(src, name) {
  const m = new RegExp('^[ \\t]*(?:async )?function ' + name + '\\(', 'm').exec(src);
  if (!m) throw new Error('missing ' + name);
  return balanced(src, m.index);
}
function between(src, from, to, what) {
  const i = src.indexOf(from);
  const j = i >= 0 ? src.indexOf(to, i + from.length) : -1;
  if (i < 0 || j < 0) throw new Error((what || from) + ' moved');
  return src.slice(i, j);
}

/* ---- 1. the script never writes site storage ------------------------------------------- */
check('eyeshield.js never writes to localStorage or sessionStorage',
  !/(?:localStorage|sessionStorage)\s*\.\s*setItem/.test(EYESHIELD) && !/\bcacheMode\b/.test(EYESHIELD));
check('...and never reads a mode from it either',
  !/localStorage\s*\.\s*getItem/.test(EYESHIELD));
const legacyRemoval = new RegExp("localStorage\\.removeItem\\(LEGACY_MODE_CACHE_KEY\\)");
check('the only storage call left removes the legacy key', legacyRemoval.test(EYESHIELD)
  && (EYESHIELD.match(/localStorage\s*\./g) || []).length === 1);
check('the legacy key name is kept for that removal', /LEGACY_MODE_CACHE_KEY = '__woEyeShieldMode'/.test(EYESHIELD));
check('the script reads the hint from its own isolated world', EYESHIELD.includes('window.' + HINT));

/* ---- 2. the three hint files ------------------------------------------------------------- */
for (const mode of MODES) {
  const file = 'eyeshield-preload-' + mode + '.js';
  const text = fs.existsSync(path.join(ROOT, file)) ? read(file) : '';
  const statements = text.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map((l) => l.trim()).filter((l) => l && l !== "'use strict';");
  check(file + ' exists and is a single statement', text.length > 0 && statements.length === 1, statements);
  check(file + ' sets the hint to ' + mode, statements[0] === "window." + HINT + " = '" + mode + "';", statements[0]);
  check(file + ' is listed as an Eye Shield file in the build profile', new RegExp("'" + file.replace('.', '\\.') + "'").test(read('build-profile.js')));
  check(file + ' is in the integrity list', BG.includes("'" + file + "'"));
}

/* The refresh early-out key must carry the mode. It encoded only eyeShieldThemingActive, so a
   change from dark to light with theming staying on produced an identical key and the whole
   refresh returned before reaching the reconciler: found live, in Edge, with the registration
   still naming the dark file after the reader chose light. */
{
  const keyBlock = between(BG, "cfg.blockAllCookies === true ? 1 : 0,", "].join('|');", 'the refresh state key');
  check('the refresh state key includes the preload file, not only on/off', /eyeShieldThemingActive\(cfg\) \? 1 : 0,[\s\S]*?eyeShieldPreloadFile\(cfg\),/.test(keyBlock));
  check('adding a profile under active global theming changes the registration key',
    /eyeShieldUsesBootstrap\(cfg\) \? 1 : 0/.test(keyBlock));
  check('a Custom profile becoming active on an open site changes the registration key',
    /eyeShieldActiveProfileHosts\(cfg\)\.join\(','\)/.test(keyBlock));
}

/* ---- 3. the worker: hint first, swapped on change, dropped for off, erased on exit ------- */
function worker(opts) {
  const o = opts || {};
  const state = { registered: [], updated: [], unregistered: [], executed: [], injected: false };
  const sandbox = {
    Object, String, Array, Number, JSON, Promise, Math, RegExp, console,
    WOEyeShieldProfiles,
    chrome: {
      runtime: { lastError: null },
      scripting: {
        registerContentScripts: async (list) => { state.registered.push(...list); },
        updateContentScripts: async (list) => { state.updated.push(...list); },
        unregisterContentScripts: async (q) => { state.unregistered.push(...(q.ids || [])); },
        getRegisteredContentScripts: async () => {
          const registered = (o.registered || []).map((r) => r.id === 'wo-eyeshield-dynamic'
            ? Object.assign({ matches: ['<all_urls>'], excludeMatches: [] }, r) : r);
          return registered.some((r) => r.id === 'wo-eyeshield-dynamic') && !registered.some((r) => r.id === 'wo-eyeshield-sites-dynamic') && !o.omitSites
            ? [...registered, { id: 'wo-eyeshield-sites-dynamic', matches: ['<all_urls>'], excludeMatches: [] }] : registered;
        },
        executeScript: (spec, cb) => { state.executed.push(spec); cb && cb(); },
      },
      tabs: { query: (q, cb) => cb(o.tabs || []) },
    },
    localGet: async () => ({ wardenone_config: o.cfg || {} }),
    EYESHIELD_SCRIPT_ID: 'wo-eyeshield-dynamic', EYESHIELD_SITES_SCRIPT_ID: 'wo-eyeshield-sites-dynamic',
    woFeatureOmitted: () => false,
    injectEyeShieldIntoOpenTabs: () => { state.injected = true; },
    state,
  };
  vm.createContext(sandbox);
  const parts = [
    grabFn(BG, 'eyeShieldThemingActive'),
    between(BG, 'const EYESHIELD_PRELOAD_MODES = [', ';', 'the preload mode list') + ';',
    grabFn(BG, 'eyeShieldPreloadFile'),
    grabFn(BG, 'eyeShieldScriptFiles'),
    grabFn(BG, 'eyeShieldRegistrationScope'),
    grabFn(BG, 'eyeShieldUsesBootstrap'),
    grabFn(BG, 'eyeShieldActiveProfileHosts'),
    "let eyeShieldBootstrapCatchupKey = '';",
    grabFn(BG, 'eraseEyeShieldSiteMarkerFromOpenTabs'),
    grabFn(BG, 'reconcileEyeShieldInjection'),
    'this.api = { reconcileEyeShieldInjection, eyeShieldScriptFiles };',
  ];
  vm.runInContext(parts.join('\n'), sandbox, { filename: 'worker-eyeshield.js' });
  return { api: sandbox.api, state };
}
const filesOf = (w) => (w.state.registered.find((r) => r.id === 'wo-eyeshield-dynamic') || {}).js;

(async () => {
  for (const mode of MODES) {
    const w = worker();
    await w.api.reconcileEyeShieldInjection({ enabled: true, eyeShieldMode: mode });
    check('mode ' + mode + ' registers the hint file AHEAD of eyeshield.js',
      JSON.stringify(filesOf(w)) === JSON.stringify(['eyeshield-preload-' + mode + '.js', 'eyeshield-profiles.js', 'eyeshield.js']), filesOf(w));
    check('...at document_start in every frame, as before',
      w.state.registered[0].runAt === 'document_start' && w.state.registered[0].allFrames === true && w.state.registered[0].persistAcrossSessions === true);
    check('...and the per-site themes registration is untouched by it',
      w.state.registered[1] && w.state.registered[1].id === 'wo-eyeshield-sites-dynamic' && JSON.stringify(w.state.registered[1].js) === '["eyeshield-sites.js"]');
  }
  {
    /* Theming on for the filters alone: the script runs, paints no backdrop, carries no hint. */
    const w = worker();
    await w.api.reconcileEyeShieldInjection({ enabled: true, eyeShieldMode: 'off', eyeShieldBrightness: 70 });
    check('mode off with a filter touched registers EyeShield without a hint', JSON.stringify(filesOf(w)) === '["eyeshield-profiles.js","eyeshield.js"]', filesOf(w));
    check('an unknown mode carries no hint either', JSON.stringify(w.api.eyeShieldScriptFiles({ eyeShieldMode: 'sepia' })) === '["eyeshield-profiles.js","eyeshield.js"]');
    check('the mode is matched case-insensitively, as eyeShieldThemingActive matches it',
      JSON.stringify(w.api.eyeShieldScriptFiles({ eyeShieldMode: 'Dark' })) === '["eyeshield-preload-dark.js","eyeshield-profiles.js","eyeshield.js"]');
  }
  {
    /* Registered for dark; the reader picks light. */
    const w = worker({ registered: [{ id: 'wo-eyeshield-dynamic', js: ['eyeshield-preload-dark.js', 'eyeshield-profiles.js', 'eyeshield.js'] }] });
    await w.api.reconcileEyeShieldInjection({ enabled: true, eyeShieldMode: 'light' });
    check('a mode change swaps the hint through updateContentScripts, without re-registering',
      w.state.registered.length === 0 && w.state.updated.length === 1
      && w.state.updated[0].id === 'wo-eyeshield-dynamic'
      && JSON.stringify(w.state.updated[0].js) === '["eyeshield-preload-light.js","eyeshield-profiles.js","eyeshield.js"]', w.state);
    check('...and does not unregister or inject', w.state.unregistered.length === 0 && !w.state.injected);
  }
  {
    /* Registered for dark; nothing changed. Chrome may report the paths with a leading slash. */
    const w = worker({ registered: [{ id: 'wo-eyeshield-dynamic', js: ['/eyeshield-preload-dark.js', '/eyeshield-profiles.js', '/eyeshield.js'] }] });
    await w.api.reconcileEyeShieldInjection({ enabled: true, eyeShieldMode: 'dark' });
    check('an unchanged mode makes no registration call at all',
      w.state.registered.length === 0 && w.state.updated.length === 0 && w.state.unregistered.length === 0, w.state);
  }
  {
    /* Registered for dark; the reader turns the mode off but leaves brightness: the hint goes. */
    const w = worker({ registered: [{ id: 'wo-eyeshield-dynamic', js: ['eyeshield-preload-dark.js', 'eyeshield-profiles.js', 'eyeshield.js'] }] });
    await w.api.reconcileEyeShieldInjection({ enabled: true, eyeShieldMode: 'off', eyeShieldBrightness: 70 });
    check('mode off with theming still active drops the hint from the registration',
      w.state.updated.length === 1 && JSON.stringify(w.state.updated[0].js) === '["eyeshield-profiles.js","eyeshield.js"]', w.state.updated);
  }
  {
    const w = worker();
    await w.api.reconcileEyeShieldInjection({ enabled: true, eyeShieldMode: 'dark', eyeShieldSites: { 'github.com': { mode: 'off' } } });
    check('a site Off profile registers only the small frame bootstrap',
      w.state.registered.length === 1 && JSON.stringify(filesOf(w)) === '["eyeshield-bootstrap.js"]'
      && JSON.stringify(w.state.registered[0].matches) === '["<all_urls>"]');
  }
  {
    const w = worker();
    await w.api.reconcileEyeShieldInjection({ enabled: true, eyeShieldMode: 'off', eyeShieldSites: { 'youtube.com': { mode: 'custom', theme: 'dark' } } });
    check('a custom-only setup sends the bootstrap to every frame origin',
      w.state.registered.length === 1 && JSON.stringify(filesOf(w)) === '["eyeshield-bootstrap.js"]'
      && w.state.registered[0].allFrames === true && JSON.stringify(w.state.registered[0].matches) === '["<all_urls>"]');
  }
  {
    const w = worker({ registered: [{ id: 'wo-eyeshield-dynamic', js: ['eyeshield-preload-dark.js', 'eyeshield-profiles.js', 'eyeshield.js'], matches: ['<all_urls>'] }] });
    await w.api.reconcileEyeShieldInjection({ enabled: true, eyeShieldMode: 'dark', eyeShieldSites: { 'github.com': { mode: 'off' } } });
    check('adding Off swaps the core for the bootstrap and removes direct site themes',
      w.state.updated.length === 1 && JSON.stringify(w.state.updated[0].js) === '["eyeshield-bootstrap.js"]'
      && w.state.unregistered.includes('wo-eyeshield-sites-dynamic'));
  }
  {
    const w = worker({ registered: [{ id: 'wo-eyeshield-dynamic', js: ['eyeshield-bootstrap.js'], matches: ['<all_urls>'] }], omitSites: true });
    await w.api.reconcileEyeShieldInjection({ enabled: true, eyeShieldMode: 'dark' });
    check('removing the last profile restores direct document-start injection and top-frame themes',
      w.state.updated.length === 1 && JSON.stringify(w.state.updated[0].js) === '["eyeshield-preload-dark.js","eyeshield-profiles.js","eyeshield.js"]'
      && w.state.registered.some((script) => script.id === 'wo-eyeshield-sites-dynamic') && w.state.injected);
  }
  {
    const w = worker({ registered: [{ id: 'wo-eyeshield-dynamic', js: ['eyeshield-bootstrap.js'], matches: ['<all_urls>'] }], omitSites: true });
    const profile = (theme) => ({ enabled: true, eyeShieldMode: 'off', eyeShieldSites: { 'youtube.com': { mode: 'custom', theme } } });
    await w.api.reconcileEyeShieldInjection(profile('off'));
    w.state.injected = false;
    await w.api.reconcileEyeShieldInjection(profile('dark'));
    check('activating Custom on an open tab triggers catch-up without changing registration',
      w.state.injected && w.state.updated.length === 0);
  }
  {
    /* Registered; theming switched off entirely: unregister, and erase the legacy key from open tabs. */
    const tabs = [{ id: 7, url: 'https://example.com/' }, { id: 8, url: 'chrome://extensions' }, { id: 9, url: 'https://news.example/a' }];
    const w = worker({ registered: [{ id: 'wo-eyeshield-dynamic', js: ['eyeshield-preload-dark.js', 'eyeshield.js'] }], tabs });
    await w.api.reconcileEyeShieldInjection({ enabled: true, eyeShieldMode: 'off' });
    check('theming off unregisters both scripts', w.state.unregistered.includes('wo-eyeshield-dynamic') && w.state.unregistered.includes('wo-eyeshield-sites-dynamic'));
    check('...and runs the legacy-key erase in every http tab, all frames, never a chrome:// tab',
      w.state.executed.length === 2 && w.state.executed.every((s) => s.target.allFrames === true) && JSON.stringify(w.state.executed.map((s) => s.target.tabId)) === '[7,9]', w.state.executed);
    const eraseSrc = w.state.executed[0] && typeof w.state.executed[0].func === 'function' ? '(' + w.state.executed[0].func.toString() + ')()' : '';
    const store = { [LEGACY_KEY]: 'dark', other: '1' };
    if (eraseSrc) vm.runInNewContext(eraseSrc, { localStorage: { removeItem: (k) => { delete store[k]; } } });
    check('the erase removes exactly the legacy key', eraseSrc && !(LEGACY_KEY in store) && store.other === '1', store);
    check('...and survives a frame whose storage throws', eraseSrc && (() => {
      try { vm.runInNewContext(eraseSrc, { localStorage: { removeItem() { throw new Error('SecurityError'); } } }); return true; } catch (_) { return false; }
    })());
    check('the erase never writes anything', eraseSrc && !/setItem/.test(eraseSrc));
  }
  /* ---- 4. the page-side block: paints from the hint, never from storage ------------------- */
  const block = between(EYESHIELD, '  // Anti-flash:', '  function removePreload()', 'the anti-flash block');
  function page(o) {
    const calls = [];
    const appended = [];
    const local = {
      getItem: (k) => { calls.push(['getItem', k]); return o.stored === undefined ? null : o.stored; },
      setItem: (k, v) => { calls.push(['setItem', k, v]); },
      removeItem: (k) => { calls.push(['removeItem', k]); if (o.storageThrows) throw new Error('SecurityError'); },
    };
    const win = { localStorage: local };
    if (o.hint !== undefined) win[HINT] = o.hint;
    const doc = {
      head: { appendChild: (el) => appended.push(el) },
      documentElement: { appendChild: (el) => appended.push(el) },
      createElement: (tag) => ({ tag, id: '', textContent: '' }),
    };
    const ctx = {
      window: win, document: doc, location: { hostname: o.host || 'example.com' },
      BASE_BG: { dark: '#16181a', ultra: '#000000', light: '#f7f8fb' }, PRELOAD_ID: 'wardenone-eyeshield-preload', LEGACY_MODE_CACHE_KEY: LEGACY_KEY,
      String, RegExp,
    };
    vm.runInNewContext(block, ctx, { filename: 'eyeshield.js:anti-flash' });
    return { calls, appended };
  }
  for (const mode of MODES) {
    const p = page({ hint: mode });
    check('hint ' + mode + ' paints the backdrop before config arrives', p.appended.length === 1 && p.appended[0].id === 'wardenone-eyeshield-preload'
      && p.appended[0].textContent.includes({ dark: '#16181a', ultra: '#000000', light: '#f7f8fb' }[mode])
      && p.appended[0].textContent.includes('color-scheme:' + (mode === 'light' ? 'light' : 'dark')), p.appended);
  }
  {
    const p = page({ hint: 'dark', stored: 'light' });
    check('the site\'s stored value is never consulted, even when present', !p.calls.some((c) => c[0] === 'getItem') && p.appended[0].textContent.includes('#16181a'), p.calls);
    check('...and never written', !p.calls.some((c) => c[0] === 'setItem'), p.calls);
    check('the legacy key is removed on the way through', p.calls.some((c) => c[0] === 'removeItem' && c[1] === LEGACY_KEY), p.calls);
  }
  {
    const p = page({});
    check('no hint means no backdrop (a mode of off, or an injection into an open tab)', p.appended.length === 0);
    check('...and the legacy key is still removed', p.calls.some((c) => c[0] === 'removeItem' && c[1] === LEGACY_KEY));
  }
  check('a hint the script does not recognise paints nothing', page({ hint: 'sepia' }).appended.length === 0);
  check('Discord keeps its own theme: no backdrop there', page({ hint: 'dark', host: 'discord.com' }).appended.length === 0);
  check('...nor on Spotify', page({ hint: 'light', host: 'open.spotify.com' }).appended.length === 0);
  check('a frame whose storage throws still gets its backdrop and nothing escapes', (() => {
    try { return page({ hint: 'dark', storageThrows: true }).appended.length === 1; } catch (_) { return false; }
  })());

  if (failures.length) {
    console.error('eyeshield preload hint: ' + failures.length + ' check(s) failed, ' + passed + ' passed');
    for (const f of failures) console.error('  FAIL ' + f);
    process.exit(1);
  }
  console.log('eyeshield preload hint: ' + passed + ' checks passed');
})().catch((e) => { console.error(e); process.exit(1); });
