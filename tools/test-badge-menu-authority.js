/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE. */
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { hmac } = require('./lib/wo-auth.js');
const root = path.join(__dirname, '..');
const bridge = fs.readFileSync(path.join(root, 'bridge.js'), 'utf8');
const key = '12'.repeat(32), token = 'public-routing-token';

function between(start, end) {
  const first = bridge.indexOf(start), last = bridge.indexOf(end, first);
  assert.ok(first >= 0 && last > first, 'the production bridge boundary remains locatable: ' + start);
  return bridge.slice(first, last);
}

function build({ frame = false, dark = false, stored = 'light' } = {}) {
  const state = { observed: [], observationDetails: [], worker: [], replies: [], summaries: [], updates: [], configs: [], toggles: 0, closes: 0, open: false };
  const window = {}, document = { dispatchEvent(event) { state.summaries.push(event); } }, listeners = new Map();
  window.top = frame ? {} : window;
  const panel = {
    observe(type, count, destination) { state.observed.push(type); state.observationDetails.push({ type, count, destination }); },
    toggle() { state.toggles++; state.open = !state.open; return state.open; },
    close() { state.closes++; state.open = false; },
    update(snapshot) { state.updates.push(snapshot); },
    setTheme(value) { state.theme = value; },
  };
  const held = [], query = { matches: dark, addEventListener() {} };
  window.matchMedia = value => { assert.equal(value, '(prefers-color-scheme: dark)'); return query; };
  const context = {
    window, document, TOKEN: token, KEY: key, location: { hostname: 'catalog.example' },
    WardenBadgeControls: { create(options) { state.activity = options.onActivity; state.sendControl = options.send; return panel; } },
    CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } },
    postToPage(message) { state.replies.push(JSON.parse(JSON.stringify(message))); },
    regDomain(host) { return String(host || '').replace(/^www\./, ''); },
    bridgeRateOk() { return true; }, boundedBridgeDetail(detail) { return detail; },
    woHold(value) { held.push(value); }, woChromeListeners: [],
    bridgeSnapshot: { appearance: stored },
    bridgeConfigRev: 0, bridgeFrameSite: '',
    setLearnedGrabberDomains() {}, setSupplementalLists() {}, bridgeApplyUserHidden() {},
    normalizeBridgeHost: value => String(value || ''), sendConfig(value) { state.configs.push(JSON.parse(JSON.stringify(value))); }, adoptDownloadNavigationIntent() {},
    woOn(target, type, callback) {
      let registry = listeners.get(target); if (!registry) listeners.set(target, registry = new Map());
      registry.set(type, callback);
    },
    chrome: { runtime: { id: 'extension-id', lastError: null, sendMessage(message, callback) {
      state.worker.push(JSON.parse(JSON.stringify(message))); if (callback) callback({ ok: true });
    } } },
  };
  vm.createContext(context);
  const auth = between('  /* AUTH-BEGIN:', '  /* AUTH-END */');
  const signer = between('  let authSeq = 0;', '  /* Authenticate security events,');
  const observer = between('  const KEY_PADS =', '  let bridgeEventSeq = 0;');
  const publisher = between('  let bridgeEventSeq = 0;', '  const LOCAL_NOTICE_TYPES');
  const update = between("      if (msg && msg.kind === 'badge-activity-update'", "      if (msg && msg.kind === 'config-update'");
  const snapshot = between('  const applyContentSnapshot = (res) => {', '  // Only one acquisition runs');
  context.performance = { timeOrigin: 1800000000000.75 };
  const relay = between('  // Narrow MAIN-world -> background relay.', '  // Cookie reload-loop escape.').replace(
    "    woOn(document, 'wo-background-message'", "    this.relayTest = { allowed: relayAllowedMessage, signed: relayRequestSigned };\n    woOn(document, 'wo-background-message'");
  const eventListener = between("  /* Capture at window before a page's document listener", '  // Navigation attribution signals.');
  vm.runInContext(fs.readFileSync(path.join(root, 'protection-event-settings.js'), 'utf8')
    + '\n' + auth + '\n' + signer + '\n' + observer + '\n' + publisher + '\n' + relay + '\n' + eventListener + '\n' + snapshot
    + '\nthis.receiveActivity = (msg, _sender) => {' + update + '};'
    + '\nthis.authTest = __woAuth;this.installTheme=installBadgeTheme;this.applyBadgeThemePreferenceForTest=value=>applyBadgeThemePreference(value);this.applyWorkerSnapshot=applyContentSnapshot;', context);
  assert.ok(context.relayTest, 'the actual relay registered without swallowing an initialization failure');
  assert.ok(listeners.get(document).get('wo-background-message'));
  assert.ok(listeners.get(window).get('wo-event'));
  const clone = value => value === null ? null : JSON.parse(JSON.stringify(value));
  return {
    state, context,
    packet(body, seq) {
      return Object.assign({}, body, { rseq: seq, rmac: hmac(key, 'bg-request\n' + seq + '\n' + context.authTest.canon(body, 0)) });
    },
    finding(type, seq, overrides) {
      const d = { token, src: 'engine', type, eseq: seq, detail: { silent: true } };
      d.emac = hmac(key, context.authTest.eventText(d.src, d.eseq, d.type, d.detail));
      return Object.assign(d, overrides);
    },
    allowed(message) { return clone(context.relayTest.allowed(message)); },
    send(message, routingToken = token) { listeners.get(document).get('wo-background-message')({ detail: { token: routingToken, id: 'request', message } }); },
    emit(detail) { listeners.get(window).get('wo-event')({ detail }); },
    receive(snapshot, sender = { id: 'extension-id' }) { context.receiveActivity({ kind: 'badge-activity-update', snapshot }, sender); },
    eventText(detail) { return context.authTest.eventText(detail.src, detail.eseq, detail.type, detail.detail); },
    installTheme() { context.installTheme(); },
    theme(value) { context.applyBadgeThemePreferenceForTest(value); },
    workerTheme(value, rev) { return context.applyWorkerSnapshot({ ok: true, rev, appearance: value }); },
    erase() { context.applyBadgeThemePreferenceForTest(undefined); },
    system(value) { query.matches = value; listeners.get(query)?.get('change')(); },
    disposeTheme() { held.forEach(item => item.disconnect()); },
  };
}

let passed = 0;
function check(name, run) { run(); passed++; console.log('[ok] ' + name); }

check('a pending appearance never publishes a speculative light theme', () => {
  const t = build({ dark: true }); t.context.bridgeSnapshot = null; t.installTheme();
  assert.equal(t.state.theme, undefined);
  assert.equal(t.state.summaries.filter(event => event.detail.type === 'badge_theme').length, 0);
  t.workerTheme('dark', 1);
  assert.equal(t.state.theme, 'dark');
  assert.equal(t.state.summaries.find(event => event.detail.type === 'badge_theme').detail.detail.dark, true);
});

check('worker summary pushes require this extension and the current document start', () => {
  const t = build(), snapshot = { ok: true, since: 1800000000000, current: { total: 17, networkAvailable: true } };
  t.receive(snapshot, { id: 'other-extension' }); t.receive(snapshot, { id: 'extension-id', tab: { id: 7 } });
  t.receive({ ...snapshot, since: snapshot.since - 20 }); t.receive({ ...snapshot, since: 'invalid' });
  assert.equal(t.state.updates.length, 0);
  t.receive(snapshot); assert.equal(t.state.updates.length, 1);
  const framed = build({ frame: true }); framed.receive(snapshot); assert.equal(framed.state.updates.length, 0);
});
check('header counts are separately signed and expose no event details or site history', () => {
  const t = build();
  t.state.activity({ current: { total: 17, networkAvailable: true, secret: 'private' }, recent: { secret: 'private' } });
  t.state.activity({ current: { total: 19, networkAvailable: false } });
  assert.equal(t.state.worker.length, 0, 'summary display must not produce a new block record');
  for (const [index, event] of t.state.summaries.entries()) {
    assert.equal(event.type, 'wo-badge-activity');
    assert.equal(event.detail.eseq, index + 1);
    assert.equal(event.detail.emac, hmac(key, t.eventText(event.detail)));
    assert.deepEqual(Object.keys(event.detail.detail).sort(), ['networkAvailable', 'total']);
    assert.equal(JSON.stringify(event).includes('private'), false);
  }
});
check('the badge follows the existing Light, Dark and System choice without changing settings', () => {
  const t = build({ stored: 'dark' }); t.installTheme(); assert.equal(t.state.theme, 'dark');
  t.system(false); assert.equal(t.state.theme, 'dark');
  t.theme('light'); t.system(true); assert.equal(t.state.theme, 'light');
  t.theme('system'); assert.equal(t.state.theme, 'dark');
  t.system(false); assert.equal(t.state.theme, 'light');
  t.theme('dark'); t.erase(); assert.equal(t.state.theme, 'light');
  for (const event of t.state.summaries) {
    assert.equal(event.detail.type, 'badge_theme');
    assert.deepEqual(Object.keys(event.detail.detail), ['dark']);
    assert.equal(event.detail.emac, hmac(key, t.eventText(event.detail)));
  }
  assert.equal(t.state.worker.length, 0);
});
check('an unset or invalid appearance stays Light and disposal releases the appearance receiver', () => {
  for (const stored of [undefined, 'invalid', {}, null]) {
    const t = build({ dark: true, stored }); t.installTheme(); assert.equal(t.state.theme, 'light');
  }
  const disposed = build(); disposed.installTheme(); disposed.disposeTheme(); disposed.theme('dark');
  assert.equal(disposed.state.theme, 'light'); assert.equal(disposed.state.closes, 1);
});
check('worker snapshot revisions prevent late appearance replies from undoing a newer preference', () => {
  const t = build(); t.installTheme();
  assert.equal(t.workerTheme('dark', 2), true); assert.equal(t.state.theme, 'dark');
  assert.equal(t.workerTheme('light', 1), false); assert.equal(t.state.theme, 'dark');
  assert.equal(t.workerTheme('light', 3), true); assert.equal(t.state.theme, 'light');
});
check('full snapshots explicitly clear absent site overrides rather than replaying a stale pause', () => {
  const t = build();
  t.context.applyWorkerSnapshot({ ok: true, rev: 1, overrides: { enabled: true, siteOverrides: { 'catalog.example': { scriptletEngine: false } } } });
  t.context.applyWorkerSnapshot({ ok: true, rev: 2, overrides: { enabled: true } });
  assert.deepEqual(t.state.configs[1], { enabled: true, siteOverrides: {} });
});
check('invalidated bridge contexts return a narrow reconnect flag instead of swallowing the failure', () => {
  for (const mode of ['missing-id', 'throw', 'last-error']) {
    const t = build(); let reply;
    if (mode === 'missing-id') t.context.chrome.runtime.id = undefined;
    else t.context.chrome.runtime.sendMessage = (_message, callback) => {
      if (mode === 'throw') throw Error('Extension context invalidated.');
      t.context.chrome.runtime.lastError = { message: 'Extension context invalidated.' }; callback();
    };
    t.state.sendControl({ kind: 'badge-activity' }, result => { reply = JSON.parse(JSON.stringify(result)); });
    assert.deepEqual(reply, { ok: false, reloadRequired: true });
  }
});
check('the protection panel and registry are owned by ISOLATED, outside the MAIN manifest', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
  for (const file of ['badge-controls.js', 'protection-event-settings.js']) {
    const owners = manifest.content_scripts.filter(entry => entry.js.includes(file));
    assert.ok(owners.length > 0); assert.ok(owners.every(entry => entry.world === 'ISOLATED'));
  }
});
check('authenticated MAIN requests can open and close only the local panel', () => {
  const t = build();
  t.send(t.packet({ kind: 'badge-rule-menu' }, 1));
  assert.equal(t.state.toggles, 1); assert.equal(t.state.open, true);
  assert.deepEqual(t.state.replies[0].result, { ok: true, open: true });
  t.send(t.packet({ kind: 'badge-rule-menu-close' }, 2));
  assert.equal(t.state.closes, 1); assert.equal(t.state.open, false);
  assert.deepEqual(t.state.replies[1].result, { ok: true, open: false });
  assert.equal(t.state.worker.length, 0, 'menu messages never reach worker mutation handlers');
});
for (const kind of ['badge-rule-pause', 'badge-rule-resume', 'badge-rule-settings', 'badge-rule-reload', 'badge-activity', 'badge-open-activity', 'badge-beacon-state', 'badge-beacon-set', 'badge-beacon-settings']) {
  check('MAIN cannot relay ' + kind + ', even with the correct key and sequence', () => {
    const t = build(), body = kind === 'badge-beacon-set' ? { kind, destination: 'collector.example.net', blocked: true }
      : kind === 'badge-beacon-state' ? { kind, destinations: ['collector.example.net'] }
      : ['badge-rule-reload', 'badge-activity', 'badge-open-activity', 'badge-beacon-settings'].includes(kind) ? { kind } : { kind, type: 'blocked_thirdparty_cookie' };
    const message = t.packet(body, 1);
    assert.equal(t.allowed(message), null); t.send(message);
    assert.deepEqual(t.state.worker, []); assert.equal(t.state.toggles, 0); assert.equal(t.state.closes, 0);
  });
}
check('a public token alone, forged MAC and wrong routing token cannot open the menu', () => {
  const t = build(), valid = t.packet({ kind: 'badge-rule-menu' }, 1);
  t.send({ kind: 'badge-rule-menu' }); t.send(Object.assign({}, valid, { rmac: '0'.repeat(64) }));
  t.send(valid, 'forged-routing-token'); assert.equal(t.state.toggles, 0);
  t.send(valid); assert.equal(t.state.toggles, 1, 'rejected forgeries cannot consume a legitimate request sequence');
  assert.equal(t.state.worker.length, 0);
});
check('replayed and reordered menu signatures cannot reopen or close the panel', () => {
  const t = build(), open = t.packet({ kind: 'badge-rule-menu' }, 2);
  t.send(open); t.send(open); t.send(t.packet({ kind: 'badge-rule-menu-close' }, 1));
  assert.equal(t.state.toggles, 1); assert.equal(t.state.closes, 0);
  t.send(t.packet({ kind: 'badge-rule-menu-close' }, 3)); t.send(open);
  assert.equal(t.state.open, false); assert.equal(t.state.toggles, 1);
});
for (const extra of [{ type: 'blocked_thirdparty_cookie' }, { host: 'other.example' }, { tabId: 7 },
  { key: 'enabled' }, { enabled: false }, { patch: { blockAllCookies: false } }, { site: 'other.example' }]) {
  check('the signed menu shape rejects extra ' + Object.keys(extra)[0] + ' authority fields', () => {
    const t = build(), message = Object.assign(t.packet({ kind: 'badge-rule-menu' }, 1), extra);
    assert.equal(t.allowed(message), null); t.send(message);
    assert.equal(t.state.toggles, 0); assert.deepEqual(t.state.worker, []);
  });
}
check('framed MAIN callers cannot control the top-level panel', () => {
  const t = build({ frame: true });
  for (const kind of ['badge-rule-menu', 'badge-rule-menu-close']) {
    const message = t.packet({ kind }, 1); assert.equal(t.allowed(message), null); t.send(message);
  }
  assert.equal(t.state.toggles + t.state.closes, 0); assert.equal(t.state.worker.length, 0);
});
check('only an authentic current engine finding reaches the ISOLATED controller', () => {
  const t = build(), valid = t.finding('blocked_thirdparty_cookie', 1);
  t.emit(Object.assign({}, valid, { emac: '0'.repeat(64) }));
  t.emit(Object.assign({}, valid, { token: 'forged-token' }));
  assert.deepEqual(t.state.observed, []); assert.deepEqual(t.state.worker, []);
  t.emit(valid); t.emit(valid);
  assert.deepEqual(t.state.observed, ['blocked_thirdparty_cookie']);
  assert.equal(t.state.worker.length, 1); assert.equal(t.state.worker[0].kind, 'rg-block');
  t.emit(t.finding('blocked_meta_refresh', 2));
  assert.deepEqual(t.state.observed, ['blocked_thirdparty_cookie', 'blocked_meta_refresh']);
});

check('only authenticated beacon destinations enter the private panel, without publishing them to MAIN', () => {
  const t = build(), finding = t.finding('detected_beacon', 1);
  finding.detail = { matched: 'collector.example.net', quiet: true };
  finding.emac = hmac(key, t.eventText(finding));
  t.emit({ ...finding, emac: '0'.repeat(64) }); assert.equal(t.state.observationDetails.length, 0);
  t.emit(finding);
  assert.deepEqual(t.state.observationDetails, [{ type: 'detected_beacon', count: 1, destination: 'collector.example.net' }]);
  assert.ok(!JSON.stringify(t.state.summaries).includes('collector.example.net'));
});

console.log(passed + ' badge menu authority checks passed');
