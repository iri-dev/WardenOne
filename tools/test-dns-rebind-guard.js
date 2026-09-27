/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/*
 * DNS rebinding detection. Run: node tools/test-dns-rebind-guard.js
 *
 * Intranet Guard decides from the hostname string, which is correct for what it
 * does and blind to rebinding: evil.example resolves to 192.168.1.1 and no
 * string test will ever see it. background.js said as much in a comment for a
 * long time before anything acted on it.
 *
 * Chromium offers extensions no synchronous "resolve this name before you allow
 * the request" hook, so the first request to a rebound host cannot be stopped by
 * anyone. chrome.webRequest does report details.ip once a response starts, which
 * is enough to answer the question the hostname could not, one request late.
 *
 * That makes the honesty of the boundary part of the feature, so this suite pins
 * both halves: the detection fires on the shapes that matter, and the copy does
 * not claim to prevent what it only detects.
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
const POPUP_HTML = fs.readFileSync(path.join(ROOT, 'popup.html'), 'utf8');
const POPUP_JS = fs.readFileSync(path.join(ROOT, 'popup.js'), 'utf8');

const pending = [];
let pass = 0;
const failures = [];
function check(name, cond, detail) {
  if (cond) { pass++; return; }
  failures.push(name + (detail ? ' — ' + detail : ''));
}

function between(start, end) {
  const from = BG.indexOf(start);
  const to = BG.indexOf(end, from + start.length);
  assert(from >= 0, 'missing marker: ' + start);
  assert(to > from, 'missing marker: ' + end);
  return BG.slice(from, to);
}

/* Run the real detector against a stub chrome. Nothing is mocked away except
   storage and the DNR endpoint, so what is under test is the shipped decision
   logic rather than a paraphrase of it. */
function harness(options) {
  const opts = options || {};
  const state = { quarantined: [], history: [], sessionRules: [], configWrites: [] };
  const config = Object.assign({ enabled: true, intranetProtection: true, dnsRebindGuard: true }, opts.config || {});

  const sandbox = Object.assign({
    console,
    URL,
    Date,
    Promise,
    Map,
    Set,
    Array,
    Object,
    Number,
    String,
    JSON,
    INCOGNITO_CONTEXT: false,
    REBIND_QUARANTINE_RULES_BUDGET: 128,
    localGet: async () => ({ wardenone_config: config }),
    localSet: async (obj) => {
      state.configWrites.push(obj);
      if (obj && obj.wardenone_config) Object.assign(config, obj.wardenone_config);
    },
    queueHistory: (entry) => { state.history.push(entry); },
    hostMatchesAllowlist: (host, allowlist) => (allowlist || []).some((d) => host === d || host.endsWith('.' + d)),
    activeAllowlist: (c) => (c && c.allowlist) || [],
    refreshIntranetNetworkRules: () => {},
    isLocalOrPrivateHost: (host) => /^(localhost|127\.|10\.|192\.168\.|::1)|\.(local|lan|internal)$/i.test(String(host)),
    chrome: {
      webRequest: { onResponseStarted: { addListener() {} } },
      declarativeNetRequest: {
        async getSessionRules() { return state.sessionRules.slice(); },
        async updateSessionRules(update) {
          const remove = new Set(update.removeRuleIds || []);
          state.sessionRules = state.sessionRules
            .filter((r) => !remove.has(r.id))
            .concat(update.addRules || []);
        },
      },
    },
  }, resourceTypes.resolveAll(BG));

  vm.createContext(sandbox);
  vm.runInContext(
    /* The shared IPv6 classifier the rebinding check now calls (tools/test-ip-classifier-agreement.js). */
    between('function ipv4FromMappedIpv6(', '\nfunction normalizeIpLiteral(')
      + between('const REBIND_QUARANTINE_RULE_BASE', '\nconst HEALTH_SHIELD_KEYS = [')
      + '\nthis.__api = { noteResolvedAddress, classifyResolvedIp, forgetRebindTab, REBIND_QUARANTINED };',
    sandbox,
    { filename: 'background.js' }
  );

  const api = sandbox.__api;
  return {
    api,
    state,
    config,
    /* One observed response. Defaults describe an ordinary subresource so each
       test only has to state the part it cares about. */
    see(over) {
      api.noteResolvedAddress(Object.assign({
        type: 'xmlhttprequest',
        tabId: 1,
        url: 'https://tracker.example/pixel',
        ip: '93.184.216.34',
      }, over || {}));
    },
    quarantined() { return Array.from(api.REBIND_QUARANTINED.keys()); },
    async settle() { await new Promise((r) => setTimeout(r, 5)); },
  };
}

// --- address classification -------------------------------------------------

(function classifiesAddresses() {
  const h = harness();
  const c = h.api.classifyResolvedIp;
  [
    ['127.0.0.1', 'loopback'], ['0.0.0.0', 'loopback'], ['::1', 'loopback'],
    ['10.0.0.5', 'private'], ['192.168.1.1', 'private'], ['172.16.0.1', 'private'],
    ['172.31.255.254', 'private'], ['100.64.0.1', 'private'], ['fd00::1', 'private'],
    ['169.254.1.1', 'linklocal'], ['fe80::1', 'linklocal'],
    ['93.184.216.34', 'public'], ['8.8.8.8', 'public'], ['2606:4700::1', 'public'],
    ['::ffff:192.168.1.1', 'private'], ['::ffff:93.184.216.34', 'public'],
  ].forEach((pair) => {
    check('classify ' + pair[0] + ' as ' + pair[1], c(pair[0]) === pair[1], 'got ' + c(pair[0]));
  });

  /* 172.15 and 172.32 sit either side of the private block. Getting the edges
     wrong in the safe direction is a missed attack; in the other it is a broken
     public site. */
  check('172.15.0.1 is public (below the private block)', c('172.15.0.1') === 'public');
  check('172.32.0.1 is public (above the private block)', c('172.32.0.1') === 'public');
  check('garbage classifies as nothing', c('not-an-ip') === '' && c('') === '');
  check('999.1.1.1 classifies as nothing', c('999.1.1.1') === '');
}());

// --- what must be caught ----------------------------------------------------

pending.push((async function catchesTheRebindFlip() {
  const h = harness();
  /* The signature: the same name answers publicly, then privately. This is the
     classic attack — the page keeps its origin and the socket moves to the LAN. */
  h.see({ type: 'main_frame', url: 'https://evil.example/', ip: '93.184.216.34' });
  h.see({ url: 'https://evil.example/probe', ip: '192.168.1.1' });
  await h.settle();
  check('public-then-private flip is quarantined', h.quarantined().indexOf('evil.example') >= 0,
    'quarantined: ' + h.quarantined().join(', '));
  const entry = h.state.history.find((e) => e.type === 'dns_rebind_quarantine');
  check('the flip is reported as the high-severity signal',
    !!entry && entry.detail.signal === 'flip' && entry.detail.severity === 'High',
    JSON.stringify(entry && entry.detail));
}()));

pending.push((async function catchesAPublicNameThatIsSimplyPrivate() {
  const h = harness();
  h.see({ type: 'main_frame', url: 'https://news.example/', ip: '93.184.216.34' });
  h.see({ url: 'https://cdn-assets.example/lib.js', ip: '10.0.0.5', type: 'script' });
  await h.settle();
  check('public-looking name resolving privately is quarantined',
    h.quarantined().indexOf('cdn-assets.example') >= 0, h.quarantined().join(', '));
}()));

pending.push((async function quarantineBlocksAndIsPublished() {
  const h = harness();
  h.see({ type: 'main_frame', url: 'https://evil.example/', ip: '93.184.216.34' });
  h.see({ url: 'https://evil.example/probe', ip: '192.168.1.1' });
  await h.settle();

  const rule = h.state.sessionRules.find((r) => (r.condition.requestDomains || []).indexOf('evil.example') >= 0);
  check('a session block rule is installed for the host', !!rule && rule.action.type === 'block');
  check('the block covers every transport, as a security rule should',
    !!rule && rule.condition.resourceTypes.length === resourceTypes.resolve('SECURITY_RESOURCE_TYPES', BG).length);
  /* Below login-compat's 96000. A quarantine that outranked it would let one bad
     resolution lock someone out of their own identity provider. */
  check('the rule sits below the login-compat allow priority', !!rule && rule.priority < 96000);
  check('the quarantine is published for the page guard',
    (h.config.rebindQuarantine || []).indexOf('evil.example') >= 0,
    JSON.stringify(h.config.rebindQuarantine));
}()));

// --- what must be left alone ------------------------------------------------

pending.push((async function leavesLocalDevelopmentAlone() {
  /* The developer case, and the one most likely to make someone uninstall. You
     navigate to a hostname that resolves to your own machine; everything that
     page then loads is a local page talking to itself. */
  const h = harness();
  h.see({ type: 'main_frame', url: 'https://myapp.example/', ip: '127.0.0.1' });
  h.see({ url: 'https://myapp.example/api/data', ip: '127.0.0.1' });
  h.see({ url: 'https://myapp.example/bundle.js', ip: '127.0.0.1', type: 'script' });
  await h.settle();
  check('a page you opened yourself on your own machine is not quarantined',
    h.quarantined().length === 0, h.quarantined().join(', '));
}()));

pending.push((async function leavesNamedLocalTargetsToIntranetGuard() {
  const h = harness();
  h.see({ type: 'main_frame', url: 'https://news.example/', ip: '93.184.216.34' });
  h.see({ url: 'http://192.168.1.1/admin', ip: '192.168.1.1' });
  h.see({ url: 'http://router.local/status', ip: '192.168.1.1' });
  await h.settle();
  check('addresses already local by name are left to Intranet Guard',
    h.quarantined().length === 0, h.quarantined().join(', '));
}()));

pending.push((async function ordinaryBrowsingIsUntouched() {
  const h = harness();
  h.see({ type: 'main_frame', url: 'https://news.example/', ip: '93.184.216.34' });
  for (let i = 0; i < 20; i++) h.see({ url: 'https://cdn.example/a' + i + '.js', ip: '8.8.8.8', type: 'script' });
  await h.settle();
  check('public resolutions never quarantine anything', h.quarantined().length === 0);
  check('public resolutions write no history', h.state.history.length === 0);
}()));

pending.push((async function respectsTheAllowlistAndTheToggles() {
  for (const over of [
    { allowlist: ['evil.example'] },
    { dnsRebindGuard: false },
    { intranetProtection: false },
    { enabled: false },
  ]) {
    const h = harness({ config: over });
    h.see({ type: 'main_frame', url: 'https://evil.example/', ip: '93.184.216.34' });
    h.see({ url: 'https://evil.example/probe', ip: '192.168.1.1' });
    await h.settle();
    check('no quarantine when ' + Object.keys(over)[0] + ' says not to',
      h.quarantined().length === 0, h.quarantined().join(', '));
  }
}()));

pending.push((async function navigationIsNeverQuarantined() {
  /* Typing an address is a statement of intent. Quarantining a main_frame would
     mean the extension deciding the user may not visit their own router. */
  const h = harness();
  h.see({ type: 'main_frame', url: 'https://evil.example/', ip: '192.168.1.1' });
  await h.settle();
  check('a top-level navigation is never quarantined', h.quarantined().length === 0);
}()));

pending.push((async function tabContextIsForgottenWithTheTab() {
  const h = harness();
  h.see({ type: 'main_frame', url: 'https://myapp.example/', ip: '127.0.0.1', tabId: 7 });
  h.api.forgetRebindTab(7);
  h.see({ url: 'https://other.example/probe', ip: '192.168.1.1', tabId: 7 });
  await h.settle();
  check('a reused tab id does not inherit the old page local context',
    h.quarantined().indexOf('other.example') >= 0, h.quarantined().join(', '));
}()));

// --- the page guard reads the answer ---------------------------------------

(function quarantineStaysOutOfPage() {
  const bridge = fs.readFileSync(path.join(ROOT, 'bridge.js'), 'utf8');
  check('quarantined hostnames are removed before config enters MAIN',
    /delete clean\.rebindQuarantine/.test(bridge));
  check('the page guard does not need the private quarantine host list',
    !/WO\.rebindQuarantine/.test(SOURCE));
  check('DNR quarantine covers every browser request type',
    /const SECURITY_RESOURCE_TYPES = ALL_DNR_RESOURCE_TYPES/.test(BG)
    && /condition: \{ requestDomains: \[host\], resourceTypes: SECURITY_RESOURCE_TYPES \}/.test(BG));
}());

// --- the boundary is stated honestly ----------------------------------------

(function copyDoesNotOverclaim() {
  const row = POPUP_HTML.slice(POPUP_HTML.indexOf('DNS rebinding detection'));
  const desc = row.slice(0, row.indexOf('</div></div>'));
  check('the feature is named as detection, not prevention',
    /DNS rebinding detection/.test(POPUP_HTML) && !/prevents? DNS rebinding/i.test(POPUP_HTML));
  /* The whole point of the boundary: someone reading this should learn that the
     first request gets through, from the copy, not from an incident. */
  check('the copy admits the first request is not stopped',
    /already happened|not the first/i.test(desc), desc.slice(0, 160));
  check('the copy says the browser gives no way to check first',
    /before the request goes out|no way to check/i.test(desc));
  check('the copy mentions the local dev server exemption', /dev server|own network/i.test(desc));
  check('Intranet Guard copy points at the rebinding row', /resolves to your router|handled below/i.test(POPUP_HTML));
}());

(function toggleIsWiredEverywhere() {
  check('popup exposes the toggle', /data-key="dnsRebindGuard"/.test(POPUP_HTML));
  check('popup knows the key', /'dnsRebindGuard'/.test(POPUP_JS));
  check('popup defaults it on', /dnsRebindGuard: true/.test(POPUP_JS));
  check('background defaults it on', /dnsRebindGuard: true/.test(BG));
  check('it counts as a protection', /'dnsRebindGuard'/.test(BG.slice(BG.indexOf('HEALTH_SHIELD_KEYS'))));
  /* Flipping this needs no page reload: the observer reads config per request
     and the page guard reads the list live. Reloading someone's tab for nothing
     is a small rudeness that adds up. */
  const reloadSet = POPUP_JS.slice(POPUP_JS.indexOf('ACTIVE_TAB_RELOAD_TOGGLES'));
  check('toggling it does not reload the tab',
    !/dnsRebindGuard/.test(reloadSet.slice(0, reloadSet.indexOf(']'))));
}());

// --- lifecycle: what "for the rest of the session" has to mean --------------

(function quarantineOutlivesTheWorkerButNotTheBrowser() {
  /* An MV3 worker is torn down after seconds of idle and re-evaluated on the
     next event, so in-memory state is not session state. Without rehydration a
     quarantine would expire within seconds of being set, while the popup said it
     lasted the session. Without the onStartup clear it would instead last
     forever, stranding a host after one odd resolution on a VPN flip. Both
     halves are the promise. */
  const restore = BG.slice(BG.indexOf('function restoreRebindQuarantine'), BG.indexOf('\nrestoreRebindQuarantine();'));
  check("the quarantine is rehydrated when the worker restarts",
    /rebindQuarantine/.test(restore) && /syncRebindQuarantineRules/.test(restore));
  check('rehydration actually runs at worker evaluation',
    BG.indexOf('\nrestoreRebindQuarantine();') >= 0);
  const startup = BG.slice(BG.indexOf('chrome.runtime.onStartup'));
  check('a browser restart clears it', startup.slice(0, 300).indexOf('clearRebindQuarantine()') >= 0);
  const clearBody = BG.slice(BG.indexOf('function clearRebindQuarantine'), BG.indexOf('function restoreRebindQuarantine'));
  check('clearing drops the rules and the published list',
    clearBody.indexOf('REBIND_QUARANTINED.clear()') >= 0
      && clearBody.indexOf('syncRebindQuarantineRules') >= 0
      && clearBody.indexOf('publishRebindQuarantine') >= 0);
}());

/* MV3-09: the worker-start restore and the browser-start clear used to run independently, and the
   one whose callbacks settled last won. Both orders, with every storage and DNR callback deferred,
   must end with no quarantine from the previous session -- and a worker restart inside one
   session must still bring the quarantine back. */
function sessionHarness(sessionMarked, durableHosts) {
  const state = { sessionRules: [{ id: 932000, action: { type: 'block' }, condition: { requestDomains: durableHosts.slice() } }], session: sessionMarked ? { wardenone_rebind_session: true } : {} };
  const config = { enabled: true, intranetProtection: true, dnsRebindGuard: true, rebindQuarantine: durableHosts.slice() };
  const later = (fn) => new Promise((r) => setTimeout(() => r(fn()), Math.floor(Math.random() * 6)));
  const sandbox = Object.assign({
    console, URL, Date, Promise, Map, Set, Array, Object, Number, String, JSON,
    INCOGNITO_CONTEXT: false,
    REBIND_QUARANTINE_RULES_BUDGET: 128,
    localGet: () => later(() => ({ wardenone_config: JSON.parse(JSON.stringify(config)) })),
    localSet: (obj) => later(() => { if (obj && obj.wardenone_config) Object.assign(config, obj.wardenone_config); }),
    queueHistory: () => {},
    hostMatchesAllowlist: () => false,
    activeAllowlist: () => [],
    refreshIntranetNetworkRules: () => {},
    isLocalOrPrivateHost: () => false,
    chrome: {
      webRequest: { onResponseStarted: { addListener() {} } },
      storage: { session: {
        get: (k) => later(() => ({ [k]: state.session[k] })),
        set: (o) => later(() => { Object.assign(state.session, o); }),
      } },
      declarativeNetRequest: {
        getSessionRules: () => later(() => state.sessionRules.slice()),
        updateSessionRules: (update) => later(() => {
          const remove = new Set(update.removeRuleIds || []);
          state.sessionRules = state.sessionRules.filter((r) => !remove.has(r.id)).concat(update.addRules || []);
        }),
      },
    },
  }, resourceTypes.resolveAll(BG));
  vm.createContext(sandbox);
  /* The region ends with the top-level restoreRebindQuarantine() call: that IS the worker-start
     restore, launched on evaluation exactly as the real worker launches it. */
  vm.runInContext(
    between('function ipv4FromMappedIpv6(', '\nfunction normalizeIpLiteral(')
      + between('const REBIND_QUARANTINE_RULE_BASE', '\nconst HEALTH_SHIELD_KEYS = [')
      + '\nthis.__api = { clearRebindQuarantine, restoreRebindQuarantine, REBIND_QUARANTINED, chain: () => rebindQuarantineChain };',
    sandbox, { filename: 'background.js' });
  return { api: sandbox.__api, state, config };
}

pending.push((async () => {
  for (let round = 0; round < 12; round++) {
    /* New browser session: the durable list is the previous session's. The browser-start clear is
       fired either immediately (before the restore settles) or after it. */
    const h = sessionHarness(false, ['old.example']);
    if (round % 2) await new Promise((r) => setTimeout(r, 3));
    h.api.clearRebindQuarantine();
    await h.api.chain();
    await new Promise((r) => setTimeout(r, 20));
    await h.api.chain();
    const rulesLeft = h.state.sessionRules.filter((r) => r.id >= 932000 && r.id < 932200).length;
    if (h.api.REBIND_QUARANTINED.size || rulesLeft || (h.config.rebindQuarantine || []).length) {
      check('a previous session\'s quarantine never survives a browser restart (round ' + round + ')', false,
        JSON.stringify({ map: h.api.REBIND_QUARANTINED.size, rules: rulesLeft, durable: h.config.rebindQuarantine }));
      return;
    }
  }
  check('a previous session\'s quarantine never survives a browser restart, in either order', true);
  {
    /* The same without onStartup arriving at all: the session mark alone stops the reinstall. */
    const h = sessionHarness(false, ['old.example']);
    await new Promise((r) => setTimeout(r, 20));
    await h.api.chain();
    check('a leftover list is cleared even before the browser-start event arrives',
      h.api.REBIND_QUARANTINED.size === 0 && (h.config.rebindQuarantine || []).length === 0);
  }
  {
    /* A worker restart inside one browser session keeps the quarantine. */
    const h = sessionHarness(true, ['live.example']);
    await new Promise((r) => setTimeout(r, 20));
    await h.api.chain();
    check('a worker restart inside the session still restores the quarantine', h.api.REBIND_QUARANTINED.has('live.example'));
  }
})());
// ---------------------------------------------------------------------------

(function () {
  /* The response listener watches the channels a rebind travels on, and NOT the
     image/media flood a video-timeline scrub produces. It used to watch every
     response type on <all_urls>, so it ran new URL() + an IP classify per
     storyboard sprite and per video segment in the service worker -- pure cost,
     since an opaque cross-origin image from a rebound host is not the threat.
     Both directions are pinned: it must keep the detection channels, and it must
     not creep back to watching images/media. */
  const m = BG.match(/const REBIND_WATCH_TYPES = (\[[^\]]*\]);/);
  check('the rebind listener declares an explicit type filter', !!m,
    'watching all response types ran per storyboard image during a scrub');
  const types = m ? JSON.parse(m[1].replace(/'/g, '"')) : [];
  check('it registers that filter on the listener',
    /onResponseStarted\?\.addListener\(noteResolvedAddress,\s*\{ urls: \['<all_urls>'\], types: REBIND_WATCH_TYPES \}\)/.test(BG));
  /* Every type the detection actually uses must be kept. */
  ['main_frame', 'sub_frame', 'script', 'xmlhttprequest', 'websocket', 'other'].forEach((t) => {
    check('keeps the ' + t + ' channel', types.indexOf(t) >= 0,
      'a rebind reaching an internal service on ' + t + ' must still be seen');
  });
  /* The scrub flood must be gone. */
  ['image', 'media', 'font', 'stylesheet', 'ping'].forEach((t) => {
    check('drops the inert ' + t + ' channel', types.indexOf(t) < 0,
      'an opaque ' + t + ' from a rebound host gives the attacker nothing');
  });
  /* main_frame is what sets a tab's local context; losing it would break the
     developer-on-localhost quiet path. */
  check('main_frame is still watched so tab context still resolves',
    types.indexOf('main_frame') >= 0);
}());
// ---------------------------------------------------------------------------

// --- PERF-04: the host memory is bounded and cheap --------------------------

(function hostMemoryIsBounded() {
  const sandbox = { console, URL, Date, Promise, Map, Set, Array, Object, String, Number, RegExp, parseInt, Math, JSON };
  let urlParses = 0;
  sandbox.URL = class extends URL { constructor(...a) { urlParses++; super(...a); } };
  sandbox.chrome = { declarativeNetRequest: {}, storage: { local: { get: async () => ({}), set: async () => {} } } };
  sandbox.localGet = async () => ({ wardenone_config: { enabled: true } });
  sandbox.localSet = async () => {};
  sandbox.queueHistory = () => {};
  sandbox.isLocalOrPrivateHost = (h) => /^(localhost|127\.|10\.|192\.168\.)/.test(h);
  sandbox.hostMatchesAllowlist = () => false;
  sandbox.activeAllowlist = () => [];
  sandbox.refreshIntranetNetworkRules = () => {};
  vm.createContext(sandbox);
  vm.runInContext(
    between('function ipv4FromMappedIpv6(', '\nfunction normalizeIpLiteral(')
      + between('const REBIND_QUARANTINE_RULE_BASE', '\nconst HEALTH_SHIELD_KEYS = [')
      + '\nthis.__api = { noteResolvedAddress, REBIND_HOST_CLASS, REBIND_HOST_CLASS_MAX };',
    sandbox, { filename: 'background.js' });
  const api = sandbox.__api;
  const max = api.REBIND_HOST_CLASS_MAX;
  check('the host memory has a ceiling', Number.isInteger(max) && max > 0 && max <= 10000, String(max));
  for (let i = 0; i < max + 500; i++) {
    api.noteResolvedAddress({ type: 'script', tabId: 1, url: 'https://h' + i + '.example/a.js', ip: '93.184.216.34' });
  }
  check('a long browsing session never grows it past the ceiling', api.REBIND_HOST_CLASS.size === max, String(api.REBIND_HOST_CLASS.size));
  check('the oldest hosts are the ones let go', !api.REBIND_HOST_CLASS.has('h0.example') && api.REBIND_HOST_CLASS.has('h' + (max + 499) + '.example'));
  const before = urlParses;
  api.noteResolvedAddress({ type: 'script', tabId: 1, url: 'https://cached.example/a.js', ip: '' });
  api.noteResolvedAddress({ type: 'script', tabId: 1, url: 'https://cached.example/a.js', ip: 'not-an-ip' });
  check('a response with no usable address costs no URL parse', urlParses === before, (urlParses - before) + ' parses');
  api.noteResolvedAddress({ type: 'script', tabId: 1, url: 'https://steady.example/a.js', ip: '93.184.216.34' });
  const order = Array.from(api.REBIND_HOST_CLASS.keys());
  api.noteResolvedAddress({ type: 'script', tabId: 1, url: 'https://steady.example/b.js', ip: '93.184.216.35' });
  check('seeing a host again with the same class does not rewrite it',
    Array.from(api.REBIND_HOST_CLASS.keys()).join() === order.join());
  api.noteResolvedAddress({ type: 'script', tabId: 1, url: 'https://steady.example/c.js', ip: '10.0.0.8' });
  check('and a public name turning private is still recorded as the change', api.REBIND_HOST_CLASS.get('steady.example') === 'private');
})();

Promise.all(pending).then(() => {
  if (failures.length) {
    console.error('FAIL (' + failures.length + ')');
    failures.forEach((f) => console.error('  - ' + f));
    process.exit(1);
  }
  console.log('dns rebind guard: ' + pass + ' checks passed');
});
