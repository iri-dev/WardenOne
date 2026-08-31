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
    between('const REBIND_QUARANTINE_RULE_BASE', '\nasync function fetchPublicStylesheetText')
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

(function pageGuardHonoursTheQuarantine() {
  const fn = SOURCE.slice(SOURCE.indexOf('const localAdminTarget='), SOURCE.indexOf('publicPage=()=>'));
  check('localAdminTarget consults the quarantine list', /WO\.rebindQuarantine/.test(fn));
  check('the quarantine covers subdomains of a caught host', /endsWith\("\."\+q\)/.test(fn));
  check('the quarantine list is read live rather than latched',
    fn.indexOf('WO.rebindQuarantine') > fn.indexOf('const localAdminTarget='));
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
  const restore = BG.slice(BG.indexOf("async function restoreRebindQuarantine"));
  check("the quarantine is rehydrated when the worker restarts",
    /rebindQuarantine/.test(restore.slice(0, 700)) && /syncRebindQuarantineRules/.test(restore.slice(0, 900)));
  check('rehydration actually runs at worker evaluation',
    BG.indexOf('\nrestoreRebindQuarantine();') >= 0);
  const startup = BG.slice(BG.indexOf('chrome.runtime.onStartup'));
  check('a browser restart clears it', startup.slice(0, 300).indexOf('clearRebindQuarantine()') >= 0);
  const clearBody = BG.slice(BG.indexOf('async function clearRebindQuarantine'), BG.indexOf('async function restoreRebindQuarantine'));
  check('clearing drops the rules and the published list',
    clearBody.indexOf('REBIND_QUARANTINED.clear()') >= 0
      && clearBody.indexOf('syncRebindQuarantineRules') >= 0
      && clearBody.indexOf('publishRebindQuarantine') >= 0);
}());
// ---------------------------------------------------------------------------

Promise.all(pending).then(() => {
  if (failures.length) {
    console.error('FAIL (' + failures.length + ')');
    failures.forEach((f) => console.error('  - ' + f));
    process.exit(1);
  }
  console.log('dns rebind guard: ' + pass + ' checks passed');
});
