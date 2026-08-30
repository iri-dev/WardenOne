/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/*
 * Worker realms, and the layer that survives them.
 * Run: node tools/test-worker-realm-guard.js
 *
 * Intranet Guard was written entirely in the page: fetch, XHR, WebSocket,
 * EventSource, WebTransport, beacons, forms, element sources. That is a complete
 * list of the page's networking and it is worth nothing inside a Worker, which
 * gets its own realm with a pristine fetch on an object the hooks never touched.
 * Two lines in a worker reached the LAN with every guard still sitting there.
 *
 * Instrumenting workers back is the obvious answer and the wrong one. It means
 * re-serving their source from a blob, which breaks any site whose CSP omits
 * worker-src blob:, breaks module workers by moving the base URL their relative
 * imports resolve against, and cannot be done at all for a service worker --
 * registration from a blob URL is forbidden by spec. Chasing realms means
 * breaking pages in order to protect them.
 *
 * So the guarantee moved to declarativeNetRequest, which sees a request whatever
 * realm produced it. This suite pins that: the network rules exist and are shaped
 * correctly, the local-dashboard case still works, and the in-page front door is
 * closed too so the attempt gets a name in the log.
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
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
  const to = BG.indexOf('// ---------------------------------------------------------------------------\n// DNS rebinding');
  assert(from > 0 && to > from, 'could not delimit the intranet network rules');

  vm.createContext(sandbox);
  vm.runInContext(
    BG.slice(from, to)
      + '\nthis.__api = { applyIntranetNetworkRules, INTRANET_NET_PATTERNS, intranetNetResourceTypes, locallyServedTabIds };',
    sandbox,
    { filename: 'background.js' }
  );
  return { api: sandbox.__api, state, sandbox };
}

const pending = [];

pending.push((async function privateAddressesAreRefusedAtTheNetworkLayer() {
  const h = loadRules();
  await h.api.applyIntranetNetworkRules(true);
  const rules = h.state.updates[0].addRules;
  check('a rule is installed per private-address pattern',
    rules.length === h.api.INTRANET_NET_PATTERNS.length && rules.length > 0, rules.length + ' rules');
  check('every rule blocks', rules.every((r) => r.action.type === 'block'));
  check('every rule is third-party only', rules.every((r) => r.condition.domainType === 'thirdParty'));
  /* A page reaching the LAN under you is the attack. Typing the router's address
     is you asking, and must not be refused. */
  check('navigations are never blocked',
    rules.every((r) => r.condition.resourceTypes.indexOf('main_frame') < 0));
  check('every other transport is covered, workers included',
    rules.every((r) => ['script', 'xmlhttprequest', 'websocket', 'webtransport', 'sub_frame', 'other']
      .every((t) => r.condition.resourceTypes.indexOf(t) >= 0)));
  check('the rules sit below the login-compat allow priority',
    rules.every((r) => r.priority < 96000));
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
    'https://notlocalhost.example/',
    /* The words appear, but not as the host's own suffix. */
    'https://example.com/10.0.0.1',
    'https://example.com/?next=http://192.168.1.1/',
    'https://local.example.com/',
    'https://corp.example.com/',
  ].forEach((url) => check('allowed: ' + url, !matches(url), 'a pattern matched it'));
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
    last.addRules.length === 0 && last.removeRuleIds.length === h.api.INTRANET_NET_PATTERNS.length);
}()));

(function wiredIntoTheConfigPath() {
  check('it is applied when config is applied', /applyIntranetNetworkRules\(on &&/.test(BG));
  check('it is torn down on both disable paths',
    (BG.match(/applyIntranetNetworkRules\(false\)/g) || []).length >= 2);
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
  const note = BG.slice(BG.indexOf('// Intranet Guard, network layer.'), BG.indexOf('const INTRANET_NET_RULE_BASE'))
    .replace(/^\s*\/\/ ?/gm, '').replace(/\s+/g, ' ');
  check('the comment explains why workers are not instrumented',
    /service worker cannot be registered from a blob/i.test(note), note.slice(0, 140));
  check('the comment names the CSP and module-import costs',
    /worker-src blob:/.test(note) && /base URL/.test(note));
  check('the comment says the network layer covers every realm',
    /page, a dedicated worker, a shared worker, a service worker/i.test(note));
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
