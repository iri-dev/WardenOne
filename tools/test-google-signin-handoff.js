/* WardenOne — Copyright (C) 2026 iri; GPL-3.0-or-later. See LICENSE. */
/* SoloLearn's Continue with Google opened Google's window, the account was chosen, and nothing happened
   (2026-11-28). Its sign in is Google's older gapi.auth2 library: a hidden accounts.google.com/o/oauth2/iframe
   frame on the page watches APISID/SAPISID through document.cookie and asks iframerpc?action=issueToken with
   cookies, and cookie isolation (rules 901020/901050, priority 2000) hid both. Opening the relay sign in window
   from a frame on the origin it names now lets that tab's Google frame keep its cookies while the tab stays on
   the site. Everything that did not ask for that window stays isolated. */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const BG = fs.readFileSync(path.join(ROOT, 'background.js'), 'utf8');
let failed = 0, passed = 0;
function check(what, ok) { if (ok) passed++; else { failed++; console.error('FAIL - ' + what); } }
const constant = name => Number((BG.match(new RegExp('const ' + name + ' = (\\d+);')) || [])[1]);

const start = BG.indexOf('const GOOGLE_SIGNIN_HANDOFF_RULE_BASE');
const end = BG.indexOf('// Unclassified cross-site requests keep the existing passive pixel/beacon scope.');
const matcherStart = BG.indexOf('function frameCookieRuleMatches(');
const matcherEnd = BG.indexOf('function notifyFrameCookieRuleChange(');
if (start < 0 || end < start || matcherStart < 0 || matcherEnd < matcherStart) {
  console.error('FAIL - Google sign in handoff band not found in background.js');
  process.exit(1);
}

const reg = host => { const parts = String(host).split('.'); return parts.slice(/\.co\.uk$/.test(host) ? -3 : -2).join('.'); };
function makeWorker(frames) {
  const state = new Map();
  const listeners = {};
  const on = name => ({ addListener: fn => { (listeners[name] = listeners[name] || []).push(fn); } });
  const sandbox = {
    console, URL, JSON, Object, Array, Set, Promise, Number, String, RegExp,
    GOOGLE_SIGNIN_HANDOFF_RULES_BUDGET: constant('GOOGLE_SIGNIN_HANDOFF_RULES_BUDGET'),
    registrableDomainBg: reg,
    serializeSubsystem: (_name, task) => task(),
    registerListener: (_name, register) => register(),
    /* The real writer passes every change through the network policy, so the fake does too. */
    writeSessionRules: async change => {
      sandbox.WONetworkPolicy.validate(change, 'session');
      for (const id of change.removeRuleIds || []) state.delete(id);
      for (const rule of change.addRules || []) {
        if (state.has(rule.id)) throw new Error('duplicate rule id ' + rule.id);
        state.set(rule.id, JSON.parse(JSON.stringify(rule)));
      }
    },
    chrome: {
      declarativeNetRequest: { getSessionRules: async () => [...state.values()].map(rule => JSON.parse(JSON.stringify(rule))) },
      webNavigation: {
        getFrame: async ({ tabId, frameId }) => {
          const url = frames.get(tabId + ':' + frameId);
          if (url === 'throw') throw new Error('No frame');
          return url ? { url, frameId, parentFrameId: frameId ? 0 : -1 } : null;
        },
        onCreatedNavigationTarget: on('created'), onCommitted: on('committed'),
      },
      tabs: { onRemoved: on('removed') },
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'network-policy.js'), 'utf8') + '\nthis.WONetworkPolicy = WONetworkPolicy;', sandbox,
    { filename: 'network-policy.js' });
  vm.runInContext(BG.slice(matcherStart, matcherEnd) + '\n' + BG.slice(start, end)
    + '\nthis.api = { GOOGLE_SIGNIN_HANDOFF_RULE_BASE, GOOGLE_SIGNIN_HANDOFF_PRIORITY, googleSignInRelayOrigin,'
    + ' allowGoogleSignInHandoff, clearGoogleSignInHandoff, frameCookieRuleMatches };',
  sandbox, { filename: 'background.js:google-signin-handoff' });
  return { api: sandbox.api, state, listeners };
}

/* A small DNR matcher for the keys these rules use. The cookie rule stands in for Google's service cookie
   rule (requestDomains accounts.google.com, every top except Google's own, priority 2000). */
const hostIn = (host, domains) => (domains || []).some(d => host === d || host.endsWith('.' + d));
function matches(rule, req) {
  const c = rule.condition, host = new URL(req.url).hostname, from = req.initiator ? new URL(req.initiator).hostname : '';
  if (c.resourceTypes && !c.resourceTypes.includes(req.type)) return false;
  if (c.requestDomains && !hostIn(host, c.requestDomains)) return false;
  if (c.tabIds && !c.tabIds.includes(req.tabId)) return false;
  if (c.initiatorDomains && !hostIn(from, c.initiatorDomains)) return false;
  if (c.excludedTopDomains && hostIn(req.top, c.excludedTopDomains)) return false;
  const known = ['resourceTypes', 'requestDomains', 'tabIds', 'initiatorDomains', 'excludedTopDomains'];
  return Object.keys(c).every(key => known.includes(key));
}
const COOKIE_RULE = { id: 901020, priority: 2000, action: { type: 'modifyHeaders' },
  condition: { requestDomains: ['accounts.google.com'], excludedTopDomains: ['google.com'],
    resourceTypes: ['sub_frame', 'xmlhttprequest', 'script', 'image'] } };
function cookiesKept(rules, req) {
  const hits = rules.concat([COOKIE_RULE]).filter(rule => matches(rule, req));
  const allow = Math.max(0, ...hits.filter(rule => rule.action.type === 'allow').map(rule => rule.priority));
  return !hits.some(rule => rule.action.type === 'modifyHeaders' && rule.priority > allow);
}

/* The window SoloLearn's button opened, with the parameter names the 2026-11-28 probe recorded. */
const CLIENT = '1029384756-abcdefghij0123456789klmnopqrst.apps.googleusercontent.com';
function relayPopup(overrides = {}) {
  const params = Object.assign({ redirect_uri: 'storagerelay://https/www.sololearn.com?id=auth182736',
    response_type: 'permission id_token', scope: 'email profile openid', 'openid.realm': '', include_granted_scopes: 'true',
    client_id: CLIENT, ss_domain: 'https://www.sololearn.com', fetch_basic_profile: 'true', gsiwebsdk: '2' }, overrides);
  for (const key of Object.keys(params)) if (params[key] === undefined) delete params[key];
  return (overrides.__base || 'https://accounts.google.com/o/oauth2/auth') + '?' + new URLSearchParams(
    Object.fromEntries(Object.entries(params).filter(([key]) => key !== '__base')));
}
const PAGE = 'https://www.sololearn.com/en/users/login';
const created = (url, sourceTabId = 7, sourceFrameId = 0) => ({ sourceTabId, sourceFrameId, sourceProcessId: 1, tabId: 99, url });
const rules = state => [...state.values()];

(async () => {
  const frames = new Map([['7:0', PAGE], ['7:3', 'https://ads.doubleclick.net/ad/frame'], ['8:0', PAGE],
    ['9:0', 'https://forum.example/t/1'], ['10:0', 'throw'], ['11:0', 'http://www.sololearn.com/en/users/login'],
    ['12:0', 'https://localhost:3000/login'], ['13:0', 'https://accounts.google.com/signin']]);
  const { api, state, listeners } = makeWorker(frames);

  check('the relay window names its opener origin', api.googleSignInRelayOrigin(relayPopup()) === 'https://www.sololearn.com');
  check('the v2 endpoint is the same flow', api.googleSignInRelayOrigin(relayPopup({ __base: 'https://accounts.google.com/o/oauth2/v2/auth' }))
    === 'https://www.sololearn.com');
  check('a relay to a local port keeps the port', api.googleSignInRelayOrigin(relayPopup({ redirect_uri: 'storagerelay://https/localhost:3000?id=auth1',
    ss_domain: 'https://localhost:3000' })) === 'https://localhost:3000');

  for (const [why, url] of [
    ['a GIS popup, which answers the opener itself', 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({ client_id: CLIENT,
      redirect_uri: 'gis_transform', response_mode: 'form_post', origin: 'https://www.sololearn.com', gsiwebsdk: 'gis_attributes' })],
    ['a redirect sign in with no relay', relayPopup({ redirect_uri: 'https://www.sololearn.com/auth/google' })],
    ['a relay naming another origin than ss_domain', relayPopup({ ss_domain: 'https://evil.example' })],
    ['a relay with an origin parameter for another site', relayPopup({ origin: 'https://evil.example' })],
    ['a relay with userinfo in its host', relayPopup({ redirect_uri: 'storagerelay://https/evil.example@www.sololearn.com?id=a' })],
    ['a relay carrying a path', relayPopup({ redirect_uri: 'storagerelay://https/www.sololearn.com/x?id=a' })],
    ['a relay with an unknown scheme', relayPopup({ redirect_uri: 'storagerelay://javascript/www.sololearn.com?id=a' })],
    ['no client id', relayPopup({ client_id: undefined })],
    ['a malformed client id', relayPopup({ client_id: 'sololearn' })],
    ['another Google page', relayPopup({ __base: 'https://accounts.google.com/ServiceLogin' })],
    ['the relay frame itself', relayPopup({ __base: 'https://accounts.google.com/o/oauth2/iframe' })],
    ['a lookalike host', relayPopup({ __base: 'https://accounts.google.com.evil.example/o/oauth2/auth' })],
    ['another Google host', relayPopup({ __base: 'https://accounts.google.co.uk/o/oauth2/auth' })],
    ['plain http', relayPopup({ __base: 'http://accounts.google.com/o/oauth2/auth' })],
    ['an explicit port', relayPopup({ __base: 'https://accounts.google.com:8443/o/oauth2/auth' })],
    ['userinfo on Google', relayPopup({ __base: 'https://user@accounts.google.com/o/oauth2/auth' })],
    ['nothing at all', ''],
  ]) check('no relay origin for ' + why, api.googleSignInRelayOrigin(url) === '');

  check('nothing is allowed before any window opens', state.size === 0);
  check('the press opened the window and the handoff starts', await api.allowGoogleSignInHandoff(created(relayPopup())) === true);
  const [rule] = rules(state);
  check('one rule in the handoff band', state.size === 1 && rule.id === api.GOOGLE_SIGNIN_HANDOFF_RULE_BASE);
  check('the rule is an allow at the handoff priority, just above cookie isolation',
    rule.action.type === 'allow' && rule.priority === api.GOOGLE_SIGNIN_HANDOFF_PRIORITY && rule.priority > COOKIE_RULE.priority && rule.priority < 3000);
  check('the rule is this tab, this site and Google only', JSON.stringify(rule.condition) === JSON.stringify({ tabIds: [7],
    initiatorDomains: ['sololearn.com', 'accounts.google.com'], requestDomains: ['accounts.google.com'], resourceTypes: ['sub_frame', 'xmlhttprequest'] }));

  const req = (over) => Object.assign({ url: 'https://accounts.google.com/o/oauth2/iframerpc?action=issueToken', type: 'xmlhttprequest',
    initiator: 'https://accounts.google.com', tabId: 7, top: 'www.sololearn.com' }, over);
  check('the relay frame asks for its token with cookies', cookiesKept(rules(state), req({})));
  check('the page loads the relay frame with cookies', cookiesKept(rules(state), req({ url: 'https://accounts.google.com/o/oauth2/iframe',
    type: 'sub_frame', initiator: 'https://www.sololearn.com' })));
  check('another tab on the same site stays isolated', !cookiesKept(rules(state), req({ tabId: 8 })));
  check('an ad frame in the same tab stays isolated', !cookiesKept(rules(state), req({ initiator: 'https://ads.doubleclick.net' })));
  check('Google scripts and images in the tab stay isolated', !cookiesKept(rules(state), req({ type: 'script' }))
    && !cookiesKept(rules(state), req({ type: 'image', initiator: 'https://www.sololearn.com' })));
  check('only accounts.google.com is let through', !matches(rule, req({ url: 'https://www.google.com/recaptcha/api2/anchor' }))
    && !matches(rule, req({ url: 'https://www.gstatic.com/_/mss/boq-identity/x.js' })));

  /* Cookie isolation reads the same allows to decide whether a frame gets document.cookie back. */
  const relayFrame = { host: 'accounts.google.com', top: 'www.sololearn.com', initiator: 'www.sololearn.com',
    url: 'https://accounts.google.com/o/oauth2/iframe', tabId: 7 };
  check('the relay frame gets its cookie API back', api.frameCookieRuleMatches(rule, relayFrame, true));
  check('a Google frame in another tab keeps its cookie API hidden', !api.frameCookieRuleMatches(rule, Object.assign({}, relayFrame, { tabId: 8 }), true));
  check('a Google frame inside an ad frame keeps its cookie API hidden',
    !api.frameCookieRuleMatches(rule, Object.assign({}, relayFrame, { initiator: 'ads.doubleclick.net' }), true));

  check('pressing again adds no second rule', await api.allowGoogleSignInHandoff(created(relayPopup())) === true && state.size === 1);

  for (const [why, details] of [
    ['an ad frame opening a window for the page', created(relayPopup(), 7, 3)],
    ['a window naming another site than its opener', created(relayPopup({ redirect_uri: 'storagerelay://https/www.sololearn.com?id=a' }), 9)],
    ['an opener that cannot be read', created(relayPopup(), 10)],
    ['an opener on another scheme', created(relayPopup(), 11)],
    ['an opener frame that is gone', created(relayPopup(), 7, 5)],
    ['a GIS popup', created('https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({ client_id: CLIENT,
      redirect_uri: 'gis_transform', origin: 'https://www.sololearn.com' }), 8)],
    ['Google opening its own relay', created(relayPopup({ redirect_uri: 'storagerelay://https/accounts.google.com?id=a',
      ss_domain: 'https://accounts.google.com' }), 13)],
    ['a window not opened by a tab', Object.assign(created(relayPopup()), { sourceTabId: -1 })],
    ['no details', null],
  ]) {
    const before = JSON.stringify(rules(state));
    check('no handoff for ' + why, await api.allowGoogleSignInHandoff(details) === false && JSON.stringify(rules(state)) === before);
  }
  check('a developer on localhost gets the same handoff', await api.allowGoogleSignInHandoff(created(relayPopup({
    redirect_uri: 'storagerelay://https/localhost:3000?id=auth1', ss_domain: 'https://localhost:3000' }), 12)) === true
    && rules(state).some(r => r.condition.tabIds[0] === 12 && r.condition.initiatorDomains[0] === 'localhost'));
  await api.clearGoogleSignInHandoff(12);

  /* It lasts while the tab stays on the site it was opened for. */
  await api.clearGoogleSignInHandoff(7, 'www.sololearn.com');
  check('moving around the same site keeps the handoff', state.size === 1);
  await api.clearGoogleSignInHandoff(8, 'other.example');
  check('another tab leaving its site does not touch this one', state.size === 1);
  await api.clearGoogleSignInHandoff(7, 'accounts.google.com');
  check('the tab going to Google itself ends the handoff', state.size === 0);
  await api.allowGoogleSignInHandoff(created(relayPopup()));
  await api.clearGoogleSignInHandoff(7, 'news.example');
  check('leaving for another site ends the handoff', state.size === 0);
  await api.allowGoogleSignInHandoff(created(relayPopup()));
  await api.clearGoogleSignInHandoff(7);
  check('closing the tab ends the handoff', state.size === 0);

  /* The band never grows past its budget; the oldest slot is reused. */
  for (let tab = 100; tab < 100 + constant('GOOGLE_SIGNIN_HANDOFF_RULES_BUDGET') + 3; tab++) {
    frames.set(tab + ':0', PAGE);
    await api.allowGoogleSignInHandoff(created(relayPopup(), tab));
  }
  check('the handoff band stays within its budget', state.size === constant('GOOGLE_SIGNIN_HANDOFF_RULES_BUDGET')
    && rules(state).every(r => r.id >= api.GOOGLE_SIGNIN_HANDOFF_RULE_BASE && r.id < api.GOOGLE_SIGNIN_HANDOFF_RULE_BASE + constant('GOOGLE_SIGNIN_HANDOFF_RULES_BUDGET')));
  await api.clearGoogleSignInHandoff();
  check('clearing with no tab clears the band', state.size === 0);

  /* The worker wires it to the browser's own record of which frame opened the window. */
  check('a window the browser saw opened starts the handoff', (listeners.created || []).length === 1);
  listeners.created[0](created(relayPopup()));
  for (let i = 0; i < 20 && !state.size; i++) await new Promise(r => setTimeout(r, 5));
  check('the opened window listener grants the tab', state.size === 1);
  listeners.committed[0]({ tabId: 7, frameId: 1, url: 'https://elsewhere.example/' });
  listeners.committed[0]({ tabId: 7, frameId: 0, url: 'https://www.sololearn.com/en/profile' });
  await new Promise(r => setTimeout(r, 20));
  check('a subframe or same site commit keeps it', state.size === 1);
  listeners.committed[0]({ tabId: 7, frameId: 0, url: 'https://elsewhere.example/' });
  for (let i = 0; i < 20 && state.size; i++) await new Promise(r => setTimeout(r, 5));
  check('a top commit to another site clears it', state.size === 0);
  listeners.created[0](created(relayPopup()));
  for (let i = 0; i < 20 && !state.size; i++) await new Promise(r => setTimeout(r, 5));
  listeners.removed[0](7);
  for (let i = 0; i < 20 && state.size; i++) await new Promise(r => setTimeout(r, 5));
  check('the closed tab listener clears it', state.size === 0);

  /* The log names the band and counts it as letting requests through. */
  check('the activity log names the band', /\[GOOGLE_SIGNIN_HANDOFF_RULE_BASE, 'Google sign in you started'\]/.test(BG));
  const allowing = BG.slice(BG.indexOf('function logAllowingRuleBases'), BG.indexOf('function logAllowingRuleBases') + 1200);
  check('the activity log does not call it a block', /GOOGLE_SIGNIN_HANDOFF_RULE_BASE/.test(allowing));

  console.log((failed ? 'FAIL' : 'PASS') + ' - Google sign in handoff: ' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
