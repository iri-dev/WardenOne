/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/*
 * "Clear it when I leave" survives the worker being put to sleep (LIFE-01).
 * Run: node tools/test-on-leave-durability.js
 *      WARDENONE_BACKGROUND=<older background.js> node tools/test-on-leave-durability.js
 *
 * Clear cookies when I leave and Clear service workers when I leave both remembered "this site
 * accepted a banner / registered a worker" in a heap object, and which site a tab was on in another.
 * A loaded page produces no worker events, so Chrome ended the worker inside most visits; the reader
 * closed the tab later, a fresh worker woke with three empty maps, and both cleanups returned at
 * their first line. Nothing was logged, because each logs only on success. Two opt-in privacy
 * controls were switched off for the rest of most visits by an idle timer.
 *
 * Now both records ride a sessionMirror into storage.session -- bounded, dated, a day's TTL, newest
 * wins on restore -- and the closing tab's site is read the way Forget Me reads it: from the heap
 * when the worker is warm, from the stored record when it is not. This suite crosses the boundary
 * the old code never did: one realm records and persists, a second realm with an empty heap -- the
 * evicted worker, rewoken -- receives the tab close, sharing only the fake storage.session.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const BG_PATH = process.env.WARDENONE_BACKGROUND ? path.resolve(process.env.WARDENONE_BACKGROUND) : path.join(ROOT, 'background.js');
const BG = fs.readFileSync(BG_PATH, 'utf8');
const PRIVACY = fs.readFileSync(path.join(ROOT, 'PRIVACY.md'), 'utf8');
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

function balanced(src, start) {
  let depth = 0; let seen = false;
  for (let i = start; i < src.length; i++) {
    if (src[i] === '{') { depth++; seen = true; } else if (src[i] === '}') { depth--; if (seen && depth === 0) return src.slice(start, i + 1); }
  }
  throw new Error('unterminated block');
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
/* A registered listener body: registerListener('name', () => { ... }); */
function listenerBody(name) {
  const at = BG.indexOf("registerListener('" + name + "', () => {");
  if (at < 0) throw new Error('listener ' + name + ' moved');
  return balanced(BG, at + ("registerListener('" + name + "', () => ").length);
}

const SLICE = between(BG, 'const CONSENT_COOKIE_EXACT = new Set([', 'async function cleanConsentAndTrackingCookies() {', 'the clear-on-leave block');
const NOW = 1758240000000;
const DAY = 86400000;

/* One worker realm. `session` is the fake storage.session, shared across realms to model the worker
   dying and waking; the heap is what a realm holds and loses. */
function worker(session, options) {
  const o = options || {};
  const state = { removedCookies: [], swCleared: [], history: [], timers: [], tabs: o.tabs || [], now: o.now || NOW, sessionWrites: 0 };
  const cookies = o.cookies || [];
  const sandbox = {
    console: { warn() {} }, Object, Array, String, Number, Set, Map, JSON, Promise, URL, Math, RegExp,
    Date: Object.assign(function () { return new Date(state.now); }, { now: () => state.now }),
    setTimeout: (fn) => { state.timers.push(fn); return state.timers.length; },
    clearTimeout() {},
    DEFAULT_CONFIG: { enabled: true, clearCookiesOnLeave: false, clearServiceWorkersOnLeave: false },
    localGet: async () => ({ wardenone_config: o.config || {} }),
    localSet: async () => { state.localWrites = (state.localWrites || 0) + 1; },
    siteIdentityBg: (h) => String(h || '').replace(/^www\./, '').split('.').slice(-2).join('.'),
    registrableDomainBg: (h) => String(h || '').replace(/^www\./, '').split('.').slice(-2).join('.'),
    queueHistory: (e) => state.history.push(e),
    hostMatchesAllowlist: () => false,
    activeAllowlist: () => [],
    LAST_TOP_URL: Object.assign({}, o.lastTopUrl || {}),
    FORGET_TAB_HOSTS: Object.assign({}, o.forgetTabHosts || {}),
    FORGET_TAB_HOSTS_KEY: 'wardenone_forget_tab_hosts',
    FORGET_TAB_HOSTS_TTL_MS: DAY,
    REDIRECT_CHAINS: {}, POPUP_OPENED_AT: {},
    forgetNavSignals() {}, forgetRebindTab() {}, forgetWarningRecordsForTab() {}, maybeBlockForcedTopRedirect() {},
    navigationIsFileDownload() { return false; }, frameDrivenRedirectContext() { return null; }, maybeFlagFrameDrivenRedirect() {},
    registerListener: (name, register) => register(),
    chrome: {
      runtime: { lastError: null },
      storage: { session },
      tabs: {
        query: async () => state.tabs,
        onRemoved: { addListener: (fn) => { state.onRemoved = fn; } },
      },
      webNavigation: { onCommitted: { addListener: (fn) => { state.onCommitted = fn; } } },
      cookies: {
        getAll: async () => cookies,
        remove: async (spec) => { state.removedCookies.push(spec.name); },
      },
      browsingData: { removeServiceWorkers: async ({ origins }) => { state.swCleared.push(origins); } },
    },
  };
  vm.createContext(sandbox);
  const parts = [grabFn(BG, 'sessionArea'), grabFn(BG, 'sessionMirror'), grabFn(BG, 'forgetSessionArea'), SLICE,
    listenerBody('tab-close cleanup'), listenerBody('forced-redirect guard'),
    'this.api = { noteConsentAccepted, noteServiceWorkerRegistration, maybeClearOnLeave, maybeClearServiceWorkersOnLeave, CONSENT_ACCEPTED_AT, SW_REGISTERED_AT,'
    + ' domainOfTab, leftSiteOfTab: (typeof leftSiteOfTab === "function" ? leftSiteOfTab : null) };'];
  vm.runInContext(parts.join('\n'), sandbox, { filename: 'worker-realm.js' });
  return {
    api: sandbox.api, state,
    /* Run every coalesced timer (the mirrors' 250 ms persist) and let promises settle. */
    async flush() { const timers = state.timers.splice(0); for (const t of timers) t(); await settle(); },
    close(tabId) { state.onRemoved(tabId); return settle(); },
    navigate(tabId, url) { state.onCommitted({ tabId, frameId: 0, url }); return settle(); },
  };
}
const settle = () => new Promise((r) => setTimeout(r, 20));
/* The fake storage.session: callback-style get/set like Chrome's, one object shared across realms. */
function fakeSession() {
  const data = {};
  return { data,
    get(key, cb) { const keys = Array.isArray(key) ? key : [key]; const out = {}; keys.forEach((k) => { if (k in data) out[k] = JSON.parse(JSON.stringify(data[k])); }); setTimeout(() => cb(out), 0); },
    set(obj, cb) { Object.assign(data, JSON.parse(JSON.stringify(obj))); if (cb) setTimeout(cb, 0); },
  };
}
const COOKIES = [
  { name: '_ga', domain: '.shop.com', secure: true, path: '/' },
  { name: 'euconsent-v2', domain: '.shop.com', secure: true, path: '/' },
  { name: 'sessionid', domain: '.shop.com', secure: true, path: '/' },
];
const ON = { enabled: true, clearCookiesOnLeave: true, clearServiceWorkersOnLeave: true };
/* What Forget Me would have persisted for a tab on shop.com before the worker died. */
const forgetRecord = (tabId, host, at) => ({ wardenone_forget_tab_hosts: { [tabId]: { host, at: at || NOW } } });

(async () => {
  console.log('\non-leave cleanup across a worker boundary\n');

  /* ---- 1. warm worker: as before -------------------------------------------------------- */
  {
    const session = fakeSession();
    const w = worker(session, { config: ON, cookies: COOKIES });
    await w.navigate(1, 'https://shop.com/');
    w.api.noteConsentAccepted(1, 'https://shop.com/checkout');
    w.api.noteServiceWorkerRegistration('https://shop.com/sw.js');
    await w.flush();
    await w.close(1);
    await settle();
    check('on a warm worker the consent and tracking cookies go when the tab closes', w.state.removedCookies.includes('_ga') && w.state.removedCookies.includes('euconsent-v2'), w.state.removedCookies);
    check('...the sign-in stays', !w.state.removedCookies.includes('sessionid'));
    check('...and the service worker is removed', w.state.swCleared.length === 1 && w.state.swCleared[0].includes('https://shop.com'), w.state.swCleared);
    check('both records were written to storage.session, dated', !!session.data.wardenone_consent_accepted && (session.data.wardenone_consent_accepted || {})['shop.com'] === NOW && !!session.data.wardenone_sw_registered && (session.data.wardenone_sw_registered || {})['shop.com'] === NOW, session.data);
    check('...and nothing about them to durable storage', !(w.state.localWrites > 0));
  }

  /* ---- 2. the reported case: the worker dies between the acceptance and the close ---------- */
  {
    const session = fakeSession();
    const first = worker(session, { config: ON, cookies: COOKIES });
    await first.navigate(1, 'https://shop.com/');
    first.api.noteConsentAccepted(1, 'https://shop.com/checkout');
    first.api.noteServiceWorkerRegistration('https://shop.com/sw.js');
    await first.flush();
    // Forget Me had persisted which host the tab was on; the worker is then ended by the idle timer.
    session.set(forgetRecord(1, 'shop.com'));
    await settle();
    const woken = worker(session, { config: ON, cookies: COOKIES });   // empty heap: no LAST_TOP_URL, no records
    check('the rewoken worker knows nothing from its heap', woken.api.domainOfTab(1) === '' && Object.keys(woken.api.CONSENT_ACCEPTED_AT).length === 0);
    await woken.close(1);
    await settle(); await settle();
    check('the tab close still finds the site and clears the cookies', woken.state.removedCookies.includes('_ga') && woken.state.removedCookies.includes('euconsent-v2'), woken.state.removedCookies);
    check('...the sign-in still stays', !woken.state.removedCookies.includes('sessionid'));
    check('...and the service worker is still removed', woken.state.swCleared.length === 1, woken.state.swCleared);
    check('...and both are written to the Activity Centre', woken.state.history.some((h) => h.type === 'cleaned_site_cookies') && woken.state.history.some((h) => h.type === 'cleaned_site_service_worker'), woken.state.history.map((h) => h.type));
    await woken.flush();
    check('the used records are gone from storage.session afterwards', !(session.data.wardenone_consent_accepted || {})['shop.com'] && !(session.data.wardenone_sw_registered || {})['shop.com'], session.data);
  }

  /* ---- 3. several tabs of the site: nothing until the last one goes ---------------------- */
  {
    const session = fakeSession();
    const first = worker(session, { config: ON, cookies: COOKIES });
    first.api.noteConsentAccepted(1, 'https://shop.com/');
    await first.flush();
    session.set({ wardenone_forget_tab_hosts: { 1: { host: 'shop.com', at: NOW }, 2: { host: 'shop.com', at: NOW } } });
    await settle();
    const woken = worker(session, { config: ON, cookies: COOKIES, tabs: [{ id: 2, url: 'https://shop.com/other' }] });
    await woken.close(1);
    await settle(); await settle();
    check('closing one of two tabs on the site clears nothing', woken.state.removedCookies.length === 0);
    woken.state.tabs = [];
    session.set(forgetRecord(2, 'shop.com'));
    await settle();
    await woken.close(2);
    await settle(); await settle();
    check('closing the last one clears, once', woken.state.removedCookies.includes('_ga') && woken.state.history.filter((h) => h.type === 'cleaned_site_cookies').length === 1);
  }

  /* ---- 4. navigating away on a cold worker ------------------------------------------------ */
  {
    const session = fakeSession();
    const first = worker(session, { config: ON, cookies: COOKIES });
    first.api.noteConsentAccepted(1, 'https://shop.com/');
    await first.flush();
    session.set(forgetRecord(1, 'shop.com'));
    await settle();
    // Forget Me's onUpdated may already have re-recorded the tab under the new page by the time the
    // restore runs: the live map says other.com, the stored copy still says shop.com.
    const woken = worker(session, { config: ON, cookies: COOKIES, tabs: [{ id: 1, url: 'https://other.com/' }], forgetTabHosts: { 1: { host: 'other.com', at: NOW + 1 } } });
    await woken.navigate(1, 'https://other.com/');
    await settle(); await settle();
    check('leaving the site by navigation, on a cold worker, still clears it', woken.state.removedCookies.includes('_ga'), woken.state.removedCookies);
  }
  {
    const session = fakeSession();
    const first = worker(session, { config: ON, cookies: COOKIES });
    first.api.noteConsentAccepted(1, 'https://shop.com/');
    await first.flush();
    session.set(forgetRecord(1, 'shop.com'));
    await settle();
    const woken = worker(session, { config: ON, cookies: COOKIES, tabs: [{ id: 1, url: 'https://shop.com/page' }] });
    await woken.navigate(1, 'https://shop.com/page');
    await settle(); await settle();
    check('moving within the same site is not leaving it', woken.state.removedCookies.length === 0, woken.state.removedCookies);
  }

  /* ---- 5. the records are bounded, dated and never durable ------------------------------- */
  {
    const session = fakeSession();
    session.set({ wardenone_consent_accepted: { 'stale.com': NOW - DAY - 1, 'fresh.com': NOW - 1000 }, wardenone_forget_tab_hosts: { 1: { host: 'stale.com', at: NOW } } });
    await settle();
    const woken = worker(session, { config: ON, cookies: [{ name: '_ga', domain: '.stale.com', secure: true, path: '/' }] });
    await woken.close(1);
    await settle(); await settle();
    check('a record older than a day is not restored', woken.state.removedCookies.length === 0 && !woken.api.CONSENT_ACCEPTED_AT['stale.com']);
    check('...while a fresh one is', woken.api.CONSENT_ACCEPTED_AT['fresh.com'] === NOW - 1000);
  }
  {
    const session = fakeSession();
    const w = worker(session, { config: ON });
    for (let i = 0; i < 230; i++) { w.state.now = NOW + i; w.api.noteConsentAccepted(1, 'https://site' + i + '.com/'); }
    await w.flush();
    const keys = Object.keys(session.data.wardenone_consent_accepted || {});
    check('the stored record keeps the newest 200 of 230', keys.length === 200 && !keys.includes('site0.com') && keys.includes('site229.com'), keys.length);
    const w2 = worker(session, { config: ON, now: NOW + 500 });
    w2.api.CONSENT_ACCEPTED_AT['site229.com'] = NOW + 900;   // seen again since this worker woke
    await w2.api.maybeClearOnLeave('nothing.com');           // forces the restore
    check('on restore the newer heap entry wins over the stored one', w2.api.CONSENT_ACCEPTED_AT['site229.com'] === NOW + 900 && w2.api.CONSENT_ACCEPTED_AT['site100.com'] === NOW + 100);
  }

  /* ---- 6. the source: the order the tab-close path relies on, and the mirrors ------------- */
  {
    const cleanup = BG.indexOf("registerListener('tab-close cleanup'");
    const forget = BG.indexOf("chrome.tabs.onRemoved.addListener((tabId) => {\n    // The heap answer first");
    check('the cleanup listener is registered before Forget Me\'s, which drops the record it reads', cleanup > 0 && forget > cleanup);
    check('both records ride a sessionMirror', /const CONSENT_ACCEPTED_MIRROR = sessionMirror\(\s*'wardenone_consent_accepted'/.test(BG) && /const SW_REGISTERED_MIRROR = sessionMirror\(\s*'wardenone_sw_registered'/.test(BG));
    check('both cleanups wait for the restore before their first check', /async function maybeClearOnLeave\(domain\) \{\s*if \(!domain\) return;[\s\S]{0,300}await CONSENT_ACCEPTED_MIRROR\.ready\(\);/.test(BG) && /async function maybeClearServiceWorkersOnLeave\(domain\) \{\s*if \(!domain\) return;\s*await SW_REGISTERED_MIRROR\.ready\(\);/.test(BG));
    check('the two listeners read the site durably', /leftSiteOfTab\(tabId, heapSite, ''\)/.test(BG) && /leftSiteOfTab\(details\.tabId, left, arrived\)/.test(BG));
    check('the records never reach chrome.storage.local', !/localSet\(\{[^}]*wardenone_(?:consent_accepted|sw_registered)/.test(BG) && !/wardenone_(?:consent_accepted|sw_registered)['"]?\s*\]?\s*:/.test(BG.replace(/sessionMirror\([\s\S]*?\)/g, '')));
    check('PRIVACY.md says the two records live for the session only', /accepted a cookie banner[\s\S]{0,400}(browser session|storage\.session)/i.test(PRIVACY) || /for the browser session[\s\S]{0,300}(banner|service worker)/i.test(PRIVACY));
    check('this suite is wired into the gate', /test-on-leave-durability\.js/.test(GATE));
  }

  finished = true;
  console.log('');
  if (failures.length) {
    for (const f of failures) console.log('  FAIL ' + f);
    console.log('\n' + failures.length + ' check(s) failed, ' + pass + ' passed');
    process.exit(1);
  }
  process.exitCode = 0;
  console.log('  ok  ' + pass + ' checks: the record outlives the worker, and the cleanup runs when the last tab goes');
})().catch((e) => { finished = true; console.error(e); process.exit(1); });
