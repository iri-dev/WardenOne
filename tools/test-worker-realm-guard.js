/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/* Enforce LAN network restrictions across worker realms without re-serving worker source from blobs.
   Run: node tools/test-worker-realm-guard.js */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { installSessionIo } = require('./lib/dynamic-rule-io.js');
const resourceTypes = require('./lib/resource-types.js');

const ROOT = path.resolve(__dirname, '..');
const BG = fs.readFileSync(path.join(ROOT, 'background.js'), 'utf8');
const SOURCE = fs.readFileSync(path.join(ROOT, 'src', 'content.js'), 'utf8');
const CONTENT = fs.readFileSync(path.join(ROOT, 'content.min.js'), 'utf8');

let pass = 0;
const failures = [];
function check(name, cond, detail) {
  if (cond) { pass++; return; }
  failures.push(name + (detail ? ' — ' + detail : ''));
}

// --- the network layer: what a worker cannot escape -------------------------

/* Run the real rule builder. The patterns are the whole point, so they get
   compiled and exercised against URLs rather than eyeballed as strings. */
function loadRules() {
  const state = { updates: [] };
  const sandbox = Object.assign({
    console,
    Map,
    Object,
    Array,
    String,
    Number,
    Promise,
    REBIND_TAB_IS_LOCAL: new Map(),
    localGet: async () => ({ wardenone_config: {} }),
    chrome: {
      declarativeNetRequest: {
        async updateSessionRules(update) { state.updates.push(update); },
      },
    },
  }, resourceTypes.resolveAll(BG));

  const from = BG.indexOf('const INTRANET_NET_RULE_BASE');
  const to = BG.indexOf('const REBIND_QUARANTINE_RULE_BASE');
  assert(from > 0 && to > from, 'could not delimit the intranet network rules');

  vm.createContext(sandbox);
  installSessionIo(sandbox);
  vm.runInContext(
    BG.slice(from, to)
      + '\nthis.__api = { applyIntranetNetworkRules, INTRANET_NET_PATTERNS, INTRANET_LOOPBACK_PATTERNS,'
      + ' INTRANET_NET_RULES_BUDGET, SIGN_IN_CALLBACK_PROVIDERS, INTRANET_LOCAL_INITIATOR_DOMAINS, intranetNetResourceTypes, locallyServedTabIds };',
    sandbox,
    { filename: 'background.js' }
  );
  return { api: sandbox.__api, state, sandbox };
}

/* Enough of Chrome's matcher for these rules. A request without an initiator, like a typed
   address, has an opaque one, and Chrome counts that as third-party. */
function siteOf(host) {
  return /^[\d.]+$|:/.test(host) ? host : host.split('.').slice(-2).join('.');
}
function ruleMatches(rule, req) {
  const c = rule.condition;
  const url = new URL(req.url);
  const initiator = req.initiator ? new URL(req.initiator).hostname : '';
  const under = (host, list) => (list || []).some((d) => host === d || host.endsWith('.' + d));
  if (!new RegExp(c.regexFilter, 'i').test(req.url)) return false;
  if (c.resourceTypes && c.resourceTypes.indexOf(req.type) < 0) return false;
  if (c.requestMethods && c.requestMethods.indexOf(req.method || 'get') < 0) return false;
  if (c.domainType === 'thirdParty' && initiator && siteOf(initiator) === siteOf(url.hostname)) return false;
  if (initiator && under(initiator, c.excludedInitiatorDomains)) return false;
  if (under(url.hostname, c.excludedRequestDomains)) return false;
  if (c.excludedTabIds && c.excludedTabIds.indexOf(req.tabId) >= 0) return false;
  return true;
}
const blockedBy = (rules, req) => rules.some((r) => r.action.type === 'block' && ruleMatches(r, req));

const pending = [];

pending.push((async function privateAddressesAreRefusedAtTheNetworkLayer() {
  const h = loadRules();
  await h.api.applyIntranetNetworkRules(true);
  const rules = h.state.updates[0].addRules;
  const pageRules = rules.filter((r) => r.condition.resourceTypes.indexOf('main_frame') < 0);
  const formRules = rules.filter((r) => r.condition.resourceTypes.indexOf('main_frame') >= 0);
  check('a page rule and a form-post rule are installed per private-address pattern',
    pageRules.length === h.api.INTRANET_NET_PATTERNS.length && formRules.length === h.api.INTRANET_NET_PATTERNS.length,
    pageRules.length + ' page rules, ' + formRules.length + ' form-post rules');
  check('the rules fit their id budget', rules.length > 0 && rules.length <= h.api.INTRANET_NET_RULES_BUDGET
    && rules.every((r) => r.id - rules[0].id < h.api.INTRANET_NET_RULES_BUDGET), rules.length + ' rules');
  check('every rule blocks', rules.every((r) => r.action.type === 'block'));
  check('every rule is third-party only', rules.every((r) => r.condition.domainType === 'thirdParty'));
  /* A page reaching the LAN under you is the attack. Typing the router's address
     is you asking, and must not be refused. Only a form posts a top-level page. */
  check('a top-level rule matches only a form post, never a typed address or a link',
    formRules.every((r) => r.condition.resourceTypes.join() === 'main_frame' && r.condition.requestMethods.join() === 'post'));
  check('every other transport is covered, workers included',
    pageRules.every((r) => ['script', 'xmlhttprequest', 'websocket', 'webtransport', 'sub_frame', 'other']
      .every((t) => r.condition.resourceTypes.indexOf(t) >= 0)));
  const loginPriority = Number(BG.match(/id: LOGIN_COMPAT_RULE_BASE \+ i,\s*priority:\s*(\d+)/)[1]);
  check('LAN security rules outrank login compatibility',
    rules.every((r) => r.priority > loginPriority));
}()));

pending.push((async function aTopLevelFormPostIsJudgedByWhoSentIt() {
  /* The page hooks never see a form built in a child frame's realm and submitted to _top, so
     this rule is what stops it. Field names play no part: the browser supplies the initiator. */
  const h = loadRules();
  await h.api.applyIntranetNetworkRules(true, ['auth.company.example.com']);
  const rules = h.state.updates[0].addRules;
  const post = (initiator, url) => ({ url, initiator, type: 'main_frame', method: 'post', tabId: 7 });
  [
    ['a public page posting a disguised form to a local service', post('https://evil.example.com/', 'http://localhost:2375/containers/create')],
    ['the same to 127.0.0.1', post('https://evil.example.com/', 'http://127.0.0.1:2375/containers/create')],
    ['the same to [::1]', post('https://evil.example.com/', 'http://[::1]:2375/containers/create')],
    ['a public page posting to the router', post('https://evil.example.com/', 'http://192.168.1.1/apply.cgi')],
    ['a sandboxed or data: page, which has no origin', post('', 'http://localhost:2375/containers/create')],
    ['a sign-in provider posting to the router', post('https://login.microsoftonline.com/', 'http://192.168.1.1/apply.cgi')],
    ['a lookalike of a sign-in provider', post('https://login.microsoftonline.com.evil.example.com/','https://localhost:5001/signin-oidc')],
    ['a public page posting to a bare machine name', post('https://evil.example.com/', 'http://nas:5000/webapi/entry.cgi')],
    ['a sign-in provider posting to a bare machine name', post('https://login.microsoftonline.com/', 'http://nas:5000/')],
    ['a public page posting to localhost with a trailing dot', post('https://evil.example.com/', 'http://localhost.:2375/containers/create')],
    ['a public page posting to a carrier-grade NAT address', post('https://evil.example.com/', 'http://100.64.0.1:9000/')],
  ].forEach(([name, req]) => check('blocked: ' + name, blockedBy(rules, req)));
  [
    ['Microsoft posting a sign-in response to localhost', post('https://login.microsoftonline.com/', 'https://localhost:5001/signin-oidc')],
    ['Google posting one to 127.0.0.1', post('https://accounts.google.com/', 'http://127.0.0.1:8080/auth/callback')],
    ['an allowlisted identity provider posting to localhost', post('https://auth.company.example.com/', 'https://localhost:5001/signin-oidc')],
    ['the router posting its own settings form', post('http://192.168.1.1/', 'http://192.168.1.1/apply.cgi')],
    ['the router address typed into the address bar', { url: 'http://192.168.1.1/', type: 'main_frame', method: 'get', tabId: 7 }],
    ['a link to the router', { url: 'http://192.168.1.1/', initiator: 'https://evil.example.com/', type: 'main_frame', method: 'get', tabId: 7 }],
  ].forEach(([name, req]) => check('allowed: ' + name, !blockedBy(rules, req)));
  check('the provider exemption is on the loopback rules alone',
    rules.every((r) => {
      const exempt = (r.condition.excludedInitiatorDomains || []).indexOf('login.microsoftonline.com') >= 0;
      return exempt === (r.condition.requestMethods !== undefined && h.api.INTRANET_LOOPBACK_PATTERNS.includes(r.condition.regexFilter));
    }));

  const bare = loadRules();
  await bare.api.applyIntranetNetworkRules(true);
  check('an identity provider the reader has not allowlisted cannot post to localhost',
    blockedBy(bare.state.updates[0].addRules, post('https://auth.company.example.com/', 'https://localhost:5001/signin-oidc')));
  await bare.api.applyIntranetNetworkRules(true, ['auth.company.example.com']);
  check('allowlisting it rewrites the rules', bare.state.updates.length === 2);
}()));

pending.push((async function aPageNamedLocalIsNotAPublicPage() {
  /* The engine judges publicPage() from the page's own name at once. The rules used to wait for
     the tab to be marked local from its resolved address, and a page's first requests could lose
     that race. A local name settles it with no wait; a public page is refused as before. */
  const h = loadRules();
  await h.api.applyIntranetNetworkRules(true);
  const rules = h.state.updates[0].addRules;
  const req = (initiator, url, type, method) => ({ url, initiator, type, method: method || 'get', tabId: 9 });
  [
    ['a .example page loading a .test image', req('http://reader.wardenone-smoke.example:8080/', 'http://iplogger.selected-wardenone-smoke.test:8080/selected', 'image')],
    ['a localhost dev page reaching the router', req('http://localhost:3000/', 'http://192.168.1.1/api', 'xmlhttprequest')],
    ['a .test dev site embedding another', req('https://myapp.test/', 'https://admin.othersite.test/', 'sub_frame')],
    ['a home.arpa dashboard posting to a camera', req('http://hub.home.arpa/', 'http://192.168.1.40/settings', 'main_frame', 'post')],
  ].forEach(([name, r]) => check('allowed before the tab is known local: ' + name, !blockedBy(rules, r)));
  check('a public page is still refused the same image',
    blockedBy(rules, req('https://news.example.com/', 'http://iplogger.selected-wardenone-smoke.test:8080/selected', 'image')));
  check('every rule carries the local-name exemption',
    rules.every((r) => h.api.INTRANET_LOCAL_INITIATOR_DOMAINS.every((d) => (r.condition.excludedInitiatorDomains || []).includes(d))));
}()));

pending.push((async function theLoopbackPatternsAreLoopbackOnly() {
  const h = loadRules();
  const loop = h.api.INTRANET_LOOPBACK_PATTERNS.map((p) => new RegExp(p, 'i'));
  const any = (url) => loop.some((r) => r.test(url));
  check('loopback patterns are part of the full set',
    h.api.INTRANET_LOOPBACK_PATTERNS.every((p) => h.api.INTRANET_NET_PATTERNS.includes(p)));
  ['http://localhost:5001/', 'http://127.0.0.1/', 'http://127.1.2.3:8080/', 'http://[::1]:5001/',
    'http://app.localhost:3000/', 'http://localhost.:5001/']
    .forEach((url) => check('loopback: ' + url, any(url)));
  ['http://10.0.0.1/', 'http://192.168.1.1/', 'http://172.16.0.1/', 'http://169.254.1.1/', 'http://0.0.0.0/',
    'http://[fd00::1]/', 'http://[fe80::1]/', 'http://[::ffff:c0a8:101]/', 'http://router.local/', 'http://localhost.lan/',
    'http://nas/', 'http://100.64.0.1/', 'http://[::]/']
    .forEach((url) => check('not loopback: ' + url, !any(url)));
}()));

pending.push((async function thePatternsMatchWhatTheyShould() {
  const h = loadRules();
  const res = h.api.INTRANET_NET_PATTERNS.map((p) => new RegExp(p));
  const matches = (url) => res.some((r) => r.test(url));

  [
    'http://192.168.1.1/admin',
    'https://10.0.0.5/api',
    'http://127.0.0.1:8080/',
    'http://172.16.0.1/',
    'http://172.31.255.254/',
    'ws://192.168.1.50:9000/socket',
    'wss://10.1.2.3/stream',
    'http://169.254.1.1/',
    'http://localhost:3000/',
    'http://router.local/status',
    'http://nas.lan/files',
    'http://[::1]:8080/',
    'http://[fd00::1]/',
    'http://[fe80::1]/',
    /* The same request wearing a hat. A pattern anchored straight from scheme to
       host misses this, and it is a one-character bypass. */
    'http://user@192.168.1.1/admin',
    'http://x:y@10.0.0.1/',
  ].forEach((url) => check('blocked: ' + url, matches(url), 'no pattern matched'));

  [
    'https://example.com/',
    'https://93.184.216.34/',
    /* Either side of the 172.16–31 block. Wrong here in one direction is a missed
       attack; in the other it is a broken public site. */
    'http://172.15.0.1/',
    'http://172.32.0.1/',
    'http://110.0.0.1/',
    'http://1027.0.0.1/',
    'https://mylocalhost.com/',
    'https://notlocalhost.example.com/',
    /* The words appear, but not as the host's own suffix. */
    'https://example.com/10.0.0.1',
    'https://example.com/?next=http://192.168.1.1/',
    'https://local.example.com/',
    'https://corp.example.com/',
    /* Public names that only begin like a private address. The address must be the whole host. */
    'https://10.example.com/app.js',
    'https://127.example.org/sdk.js',
    'https://192.168.advertiser.com/sdk.js',
    'https://169.254.example.net/',
    'https://172.16.cdn.example.com/',
    'https://10.0.0.1.example.com/',
    'wss://192.168.1.1.example.com/socket',
    'https://user@10.example.com/',
  ].forEach((url) => check('allowed: ' + url, !matches(url), 'a pattern matched it'));
  [
    'http://10.0.0.1:8080/',
    'http://127.0.0.1',
    'http://192.168.1.1:8443/admin',
    'http://172.20.10.5/',
    'http://169.254.169.254/latest/meta-data/',
    'http://[::1]/',
    'http://[fe80::1]:8080/',
  ].forEach((url) => check('blocked with a port or bare host: ' + url, matches(url), 'no pattern matched'));
}()));

pending.push((async function aLocalDashboardStillReachesItsOwnDevices() {
  /* domainType:'thirdParty' already exempts a local page talking to itself. It
     does not exempt a home dashboard pulling a camera on a second address, which
     is a real setup and would break. Those tabs are excluded by id, using the
     local-context map the rebinding detector keeps from the resolved address —
     so a name like camera.lan counts as local too. */
  const h = loadRules();
  h.sandbox.REBIND_TAB_IS_LOCAL.set(4, true);
  h.sandbox.REBIND_TAB_IS_LOCAL.set(5, false);
  h.sandbox.REBIND_TAB_IS_LOCAL.set(6, true);
  await h.api.applyIntranetNetworkRules(true);
  const rules = (h.state.updates[0] || {}).addRules || [];
  /* Report an empty rule set as the failure it is. Indexing straight into it
     turns "the feature installed nothing" into a TypeError, which reads like a
     broken test rather than a broken guard. */
  check('rules were installed to inspect', rules.length > 0);
  const excluded = (rules[0] && rules[0].condition.excludedTabIds) || [];
  check('tabs served from the LAN are excluded', excluded.indexOf(4) >= 0 && excluded.indexOf(6) >= 0,
    JSON.stringify(excluded));
  check('ordinary tabs are not excluded', excluded.indexOf(5) < 0, JSON.stringify(excluded));
}()));

pending.push((async function ruleWritesAreNotPerNavigation() {
  /* The exclusion list follows tabs, so a naive implementation rewrites every
     DNR rule on every page load. */
  const h = loadRules();
  await h.api.applyIntranetNetworkRules(true);
  await h.api.applyIntranetNetworkRules(true);
  await h.api.applyIntranetNetworkRules(true);
  check('an unchanged rule set is written once', h.state.updates.length === 1,
    h.state.updates.length + ' writes');
  h.sandbox.REBIND_TAB_IS_LOCAL.set(9, true);
  await h.api.applyIntranetNetworkRules(true);
  check('a changed exclusion list does write again', h.state.updates.length === 2);
}()));

pending.push((async function itCanBeTurnedOff() {
  const h = loadRules();
  await h.api.applyIntranetNetworkRules(true);
  await h.api.applyIntranetNetworkRules(false);
  const last = h.state.updates[h.state.updates.length - 1];
  check('turning it off removes every owned rule',
    last.addRules.length === 0 && h.state.updates[0].addRules.every((r) => last.removeRuleIds.indexOf(r.id) >= 0));
}()));

(function wiredIntoTheConfigPath() {
  check('it is applied when config is applied', /applyIntranetNetworkRules\(on &&/.test(BG));
  /* Off follows the master switch through the one reconcile list. (This used to count two hard
     applyIntranetNetworkRules(false) calls -- the pasted-twice fallback BUG-08 removed.) */
  check('it is torn down when the master switch is off, through the reconcile list',
    /run\('intranet', \(\) => applyIntranetNetworkRules\(on && cfg\.intranetProtection !== false && cfg\.intranetNetworkRules !== false, activeAllowlist\(cfg\)\)\);/.test(BG));
  check('the tab re-sync passes the allowlist too', /applyIntranetNetworkRules\(on, activeAllowlist\(cfg\)\);/.test(BG));
  check('it follows the intranet switch', /cfg\.intranetProtection !== false && cfg\.intranetNetworkRules !== false/.test(BG));
  check('a tab changing local context re-syncs the rules',
    /REBIND_TAB_IS_LOCAL\.get\(tabId\) !== local/.test(BG) && /refreshIntranetNetworkRules\(\)/.test(BG));
  check('a closing tab re-syncs the rules',
    /REBIND_TAB_IS_LOCAL\.delete\(tabId\);\s*refreshIntranetNetworkRules\(\)/.test(BG));
  check('it counts as a protection', /'intranetNetworkRules'/.test(BG.slice(BG.indexOf('HEALTH_SHIELD_KEYS'))));
  check('it has a rule budget', /INTRANET_NETWORK_RULES_BUDGET/.test(BG));
}());

// --- the in-page front door -------------------------------------------------

(function bothGuardsRefuseWorkerConstruction() {
  /* Defence in depth, and the part that gives the attempt a name in the log: the
     network rule drops the request but cannot say which page tried to spawn what.
     Both guards must cover both constructors — the same per-guard drift that left
     WebTransport and EventSource half-covered applies here. */
  const coverage = {};
  ['Worker', 'SharedWorker'].forEach((ctor) => {
    SOURCE.split('window.' + ctor + '=function').slice(1).forEach((tail) => {
      const head = tail.slice(0, 400);
      ['blockLocal', 'blockRisk'].forEach((gate) => {
        if (head.indexOf(gate) >= 0) (coverage[gate] = coverage[gate] || new Set()).add(ctor);
      });
    });
  });
  [['blockLocal', 'Intranet Guard'], ['blockRisk', 'Risky-site Mode']].forEach((pair) => {
    ['Worker', 'SharedWorker'].forEach((ctor) => {
      check(pair[1] + ' refuses ' + ctor + ' construction',
        !!coverage[pair[0]] && coverage[pair[0]].has(ctor),
        'no ' + ctor + ' wrapper consults ' + pair[0]);
    });
  });
}());

(function workerWrappersBehaveLikeTheOthers() {
  const wraps = SOURCE.split('window.Worker=function').slice(1)
    .concat(SOURCE.split('window.SharedWorker=function').slice(1));
  check('every worker wrapper keeps the real prototype',
    wraps.length === 4 && wraps.every((t) => /\.prototype=Real(Worker|Shared)\.prototype/.test(t.slice(0, 700))),
    wraps.length + ' wrappers');
  check('every worker wrapper keeps constructor statics reachable',
    wraps.every((t) => t.slice(0, 700).indexOf('setPrototypeOf') >= 0));
  check('the built engine carries them',
    (CONTENT.match(/window\.Worker=function/g) || []).length === 2
      && (CONTENT.match(/window\.SharedWorker=function/g) || []).length === 2);
}());

(function theHonestLimitIsWrittenDown() {
  /* A service worker cannot be instrumented at all — registration from a blob URL
     is forbidden — so the network layer is not merely the better answer there, it
     is the only one. Someone reading this later should not have to rediscover
     that by trying it. */
  /* The comment wraps across lines behind // prefixes, so match the prose rather
     than the layout — otherwise this check breaks on a reflow and says nothing
     about whether the reasoning is still there. */
  const note = BG.slice(BG.indexOf('// Workers have separate networking realms'), BG.indexOf('const INTRANET_NET_RULE_BASE'))
    .replace(/^\s*\/\/ ?/gm, '').replace(/\s+/g, ' ');
  check('the comment explains why workers are not instrumented',
    /networking realms that page hooks cannot cover/.test(note), note.slice(0, 140));
  check('the comment names the CSP and module-import costs',
    /CSP/.test(note) && /module imports/.test(note));
  check('the comment says the network layer covers every realm',
    /DNR blocks private-address requests from every realm/.test(note));
}());

// ---------------------------------------------------------------------------

Promise.all(pending).then(() => {
  if (failures.length) {
    console.error('FAIL (' + failures.length + ')');
    failures.forEach((f) => console.error('  - ' + f));
    process.exit(1);
  }
  console.log('worker realm guard: ' + pass + ' checks passed');
});
