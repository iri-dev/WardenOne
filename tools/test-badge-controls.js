/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE. */
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const rootPath = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(rootPath, 'badge-controls.js'), 'utf8');
const registrySource = fs.readFileSync(path.join(rootPath, 'protection-event-settings.js'), 'utf8');

function build({ site = 'catalog.example', throwSend = false, failReload = false, holdActivity = false, holdBeacons = false, beaconError = false,
  activity = { ok: true, current: { total: 0, observed: 0, networkAvailable: true } } } = {}) {
  const roots = [], messages = [], callbacks = [], timers = new Map();
  const queries = [], summaries = [], reloads = [];
  const activityReplies = [], beaconReplies = [], beaconQueries = [];
  let timerId = 0;
  class Sheet {
    replaceSync(text) { this.text = text; }
  }
  class Node {
    constructor(tag) {
      this.tagName = tag.toUpperCase(); this.children = []; this.attrs = {}; this.listeners = {};
      this.style = { cssText: '', setProperty() {} }; this._text = ''; this.disabled = false;
    }
    set textContent(text) { this._text = String(text); this.replaceChildren(); }
    get textContent() { return this._text + this.children.map(child => child.textContent).join(''); }
    set innerHTML(value) { throw new Error('controls must build nodes rather than parse HTML: ' + value); }
    get shadowRoot() { return null; }
    get isConnected() { return this.baseConnected || !!(this.host && this.host.isConnected) || !!(this.parentNode && this.parentNode.isConnected); }
    setAttribute(name, value) { this.attrs[name] = String(value); }
    getAttribute(name) { return this.attrs[name] || null; }
    addEventListener(type, callback) { (this.listeners[type] || (this.listeners[type] = [])).push(callback); }
    appendChild(child) {
      if (child.parentNode) child.remove(); this.children.push(child); child.parentNode = this; return child;
    }
    replaceChildren(...children) { this.children.forEach(child => { child.parentNode = null; }); this.children = []; children.forEach(child => this.appendChild(child)); }
    remove() {
      if (this.parentNode) this.parentNode.children = this.parentNode.children.filter(child => child !== this);
      this.parentNode = null;
    }
    attachShadow({ mode }) {
      assert.equal(mode, 'closed');
      const shadow = new Node('#shadow-root'); shadow.host = this; shadow.mode = mode; shadow.adoptedStyleSheets = [];
      roots.push(shadow); return shadow;
    }
    emit(type, extra) {
      const event = Object.assign({ isTrusted: true, preventDefault() {}, stopPropagation() {} }, extra);
      (this.listeners[type] || []).forEach(callback => callback(event));
    }
  }
  const body = new Node('body'); body.baseConnected = true;
  const document = {
    body, documentElement: body, defaultView: { CSSStyleSheet: Sheet },
    createElement(tag) {
      assert.notEqual(tag.toLowerCase(), 'style', 'the panel must not depend on page-authorized inline styles');
      return new Node(tag);
    },
    createElementNS(ns, tag) { return new Node(tag); },
  };
  const context = {
    document, CSSStyleSheet: Sheet,
    setTimeout(callback, ms) { assert.ok([8000, 60000].includes(ms)); timers.set(++timerId, callback); return timerId; },
    clearTimeout(id) { timers.delete(id); },
  };
  vm.createContext(context);
  vm.runInContext(registrySource + '\n' + source, context);
  const manager = context.WardenBadgeControls.create({ document, registry: context.WardenProtectionEvents, site,
    onActivity: summary => summaries.push(summary),
    reloadPage() { if (failReload) throw Error('reload failed'); reloads.push('local'); },
    send(message, callback) {
      if (message.kind === 'badge-activity') { queries.push(JSON.parse(JSON.stringify(message))); if (holdActivity) activityReplies.push(callback); else callback(activity); return; }
      if (message.kind === 'badge-beacon-state') {
        beaconQueries.push(JSON.parse(JSON.stringify(message)));
        if (holdBeacons) beaconReplies.push(callback);
        else callback(beaconError ? { ok: false } : { ok: true, beacons: activity.beacons || [] });
        return;
      }
      messages.push(JSON.parse(JSON.stringify(message)));
      if (throwSend) throw new Error('worker unavailable');
      callbacks.push(callback);
    } });
  const walk = node => [node].concat(node.children.flatMap(walk));
  return {
    manager, roots, body, messages, callbacks, timers, queries, summaries, reloads, activityReplies, beaconReplies, beaconQueries,
    get root() { return roots[roots.length - 1]; },
    get nodes() { return this.root ? walk(this.root) : []; },
    get rows() { return this.nodes.filter(node => node.className === 'row'); },
    get text() { return this.root ? this.root.textContent : ''; },
    row(type) { return this.rows.find(row => walk(row).some(node => node.tagName === 'CODE' && node.textContent === type)); },
    buttons(node) { return walk(node || this.root).filter(item => item.tagName === 'BUTTON'); },
    button(label) { return this.buttons().find(node => node.getAttribute('aria-label') === label); },
    pause(type) { return this.buttons(this.row(type)).find(node => /^(Pause|Restore) /.test(node.getAttribute('aria-label'))); },
    review(type) { return this.button('Find ' + type + ' in settings'); },
    click(node, trusted = true) { assert.ok(node, 'the requested control exists'); node.emit('click', { isTrusted: trusted }); },
    reply(result, at = 0) { callbacks.splice(at, 1)[0](result); },
    timeout() { const pending = [...timers.values()]; timers.clear(); pending.forEach(callback => callback()); },
  };
}

let passed = 0;
function check(name, test) { test(); passed++; console.log('[ok] ' + name); }

check('YouTube keeps an actionable control before any removal event, without inventing a block', () => {
  const t = build({ site: 'www.youtube.com' });
  t.manager.configure({ global: { enabled: true, scriptletEngine: true }, paused: [], local: [] });
  t.manager.toggle();
  assert.ok(t.row('youtube_ads_removed')); assert.ok(t.pause('youtube_ads_removed'));
  assert.match(t.pause('youtube_ads_removed').getAttribute('aria-label'), /^Pause /);
  assert.match(t.text, /Guard active/); assert.doesNotMatch(t.text, /1 blocked/);
  t.manager.configure({ global: { enabled: true, scriptletEngine: true }, paused: ['scriptletEngine'], local: ['scriptletEngine'] });
  assert.match(t.pause('youtube_ads_removed').getAttribute('aria-label'), /^Restore /);
  assert.match(t.text, /Paused for this site/);
});

check('the ISOLATED panel owns a closed shadow root and styles survive page CSP', () => {
  const t = build({ activity: { ok: false, reloadRequired: true } }); assert.equal(t.manager.toggle(), true);
  assert.equal(t.body.children[0].shadowRoot, null);
  assert.equal(t.root.mode, 'closed');
  assert.ok(t.root.adoptedStyleSheets.length > 0);
  assert.ok(t.root.adoptedStyleSheets.some(sheet => /\.panel/.test(sheet.text)));
  assert.match(t.text, /Refresh this page to reconnect WardenOne/);
  assert.ok(t.button('Reload page to apply paused protections'));
  assert.ok(!t.text.includes('No protection events'));
  assert.deepEqual(t.queries, [{ kind: 'badge-activity' }]);
  assert.equal(t.rows.length, 0);
  assert.equal(t.messages.length, 0);
  assert.equal(t.manager.toggle(), false);
  assert.equal(t.body.children.length, 0);
});
check('only observed valid event IDs render, without interpreting raw HTML', () => {
  const t = build();
  for (const type of [null, {}, '<img src=x onerror=alert(1)>', 'blocked_<script>', 'cookie_blocked<img>']) t.manager.observe(type);
  t.manager.observe('blocked_thirdparty_cookie'); t.manager.observe('blocked_thirdparty_cookie');
  t.manager.toggle();
  assert.equal(t.rows.length, 1);
  assert.ok(t.row('blocked_thirdparty_cookie'));
  assert.ok(!t.row('blocked_meta_refresh'));
  assert.equal(t.row('blocked_thirdparty_cookie').children.find(node => node.className === 'count').textContent, '2');
});
check('ambiguous popup events and the cookie alias offer settings review without a pause', () => {
  const t = build(); t.manager.observe('blocked_popup'); t.manager.observe('cookie_blocked'); t.manager.toggle();
  for (const type of ['blocked_popup', 'cookie_blocked']) {
    assert.ok(t.row(type)); assert.equal(t.pause(type), undefined); assert.equal(t.review(type).disabled, false);
    t.click(t.review(type), false); assert.equal(t.messages.length, 0);
    t.click(t.review(type));
    assert.deepEqual(t.messages.pop(), { kind: 'badge-rule-settings', type });
    t.reply({ ok: true });
  }
});
check('a trusted owner-specific pause sends only its event ID and requires an explicit reload', () => {
  const t = build(); t.manager.observe('blocked_thirdparty_cookie'); t.manager.toggle();
  t.click(t.pause('blocked_thirdparty_cookie'), false); assert.equal(t.messages.length, 0);
  t.click(t.pause('blocked_thirdparty_cookie'));
  assert.deepEqual(t.messages, [{ kind: 'badge-rule-pause', type: 'blocked_thirdparty_cookie' }]);
  assert.equal(t.pause('blocked_thirdparty_cookie').disabled, true);
  t.click(t.pause('blocked_thirdparty_cookie')); assert.equal(t.messages.length, 1);
  t.reply({ ok: true, key: 'blockThirdPartyCookies' });
  assert.match(t.text, /Paused for this site\. Reload to apply/);
  assert.equal(t.pause('blocked_thirdparty_cookie').disabled, false);
  assert.match(t.pause('blocked_thirdparty_cookie').getAttribute('aria-label'), /^Restore /);
  assert.equal(t.messages.length, 1, 'a successful pause does not reload automatically');
  const reload = t.button('Reload page to apply paused protections');
  t.click(reload, false); assert.equal(t.messages.length, 1);
  t.click(reload);
  assert.deepEqual(t.messages[1], { kind: 'badge-rule-reload' });
  t.reply({ ok: true }); assert.equal(t.timers.size, 0);
});
check('several observed events sharing one setting pause together and cannot send duplicate changes', () => {
  const t = build();
  for (const type of ['blocked_grabber_fetch', 'blocked_grabber_xhr']) t.manager.observe(type);
  t.manager.toggle(); t.click(t.pause('blocked_grabber_fetch'));
  assert.equal(t.pause('blocked_grabber_xhr').disabled, true);
  t.click(t.pause('blocked_grabber_xhr')); assert.equal(t.messages.length, 1);
  t.reply({ ok: true, key: 'blockGrabberResources' });
  for (const type of ['blocked_grabber_fetch', 'blocked_grabber_xhr']) {
    assert.equal(t.pause(type).disabled, false);
    assert.match(t.row(type).textContent, /Paused for this site/);
  }
});
for (const [name, response] of [['refusal', { ok: false }], ['wrong owner', { ok: true, key: 'blockAllCookies' }], ['missing response', undefined]]) {
  check(name + ' keeps the panel available without pretending the protection paused', () => {
    const t = build(); t.manager.observe('blocked_thirdparty_cookie'); t.manager.toggle();
    t.click(t.pause('blocked_thirdparty_cookie')); t.reply(response);
    assert.match(t.text, /Could not pause this protection/);
    assert.equal(t.pause('blocked_thirdparty_cookie').disabled, false);
    assert.equal(t.button('Reload page to apply paused protections'), undefined);
    assert.equal(t.body.children.length, 1);
  });
}
for (const mode of ['timeout', 'throw']) {
  check(mode + ' releases a pending pause and keeps the warning visible', () => {
    const t = build({ throwSend: mode === 'throw' }); t.manager.observe('blocked_thirdparty_cookie'); t.manager.toggle();
    t.click(t.pause('blocked_thirdparty_cookie')); if (mode === 'timeout') t.timeout();
    assert.match(t.text, mode === 'throw' ? /Refresh this page to reconnect/ : /Could not pause this protection/);
    assert.equal(t.pause('blocked_thirdparty_cookie').disabled, mode === 'throw');
    assert.equal(t.body.children.length, 1);
  });
}
check('settings and reload failures show recovery instructions without blank navigation', () => {
  const t = build({ failReload: true }); t.manager.observe('blocked_thirdparty_cookie'); t.manager.observe('blocked_popup'); t.manager.toggle();
  t.click(t.review('blocked_popup')); t.timeout();
  assert.match(t.text, /Open WardenOne Options and search for blocked_popup/);
  t.click(t.pause('blocked_thirdparty_cookie')); t.reply({ ok: true, key: 'blockThirdPartyCookies' }, 1);
  t.click(t.button('Reload page to apply paused protections')); t.reply({ ok: false }, 1);
  assert.match(t.text, /Reload this page with your browser to apply the change/);
  assert.equal(t.button('Reload page to apply paused protections').disabled, false);
});
check('mixed protections identify their page-only scope before and after pausing', () => {
  const t = build(); t.manager.observe('blocked_grabber_fetch'); t.manager.toggle();
  assert.match(t.pause('blocked_grabber_fetch').getAttribute('aria-label'), /Pause page checks for /);
  t.click(t.pause('blocked_grabber_fetch')); t.reply({ ok: true, key: 'blockGrabberResources' });
  assert.match(t.text, /Page checks paused/);
  assert.match(t.text, /Network rules can still apply/);
});
check('unknown signed event types render no actionable mapped setting', () => {
  const t = build(); t.manager.observe('warned_unknown_probe'); t.manager.toggle();
  assert.equal(t.row('warned_unknown_probe'), undefined);
  assert.equal(t.review('warned_unknown_probe'), undefined);
  assert.equal(t.pause('warned_unknown_probe'), undefined);
  assert.ok(!t.text.includes('observation')); assert.equal(t.messages.length, 0);
});
check('a late response to an expired request cannot confirm or replace a newer pause attempt', () => {
  const t = build(); t.manager.observe('blocked_thirdparty_cookie'); t.manager.toggle();
  t.click(t.pause('blocked_thirdparty_cookie')); const late = t.callbacks[0]; t.timeout();
  t.click(t.pause('blocked_thirdparty_cookie'));
  late({ ok: true, key: 'blockThirdPartyCookies' });
  assert.equal(t.button('Reload page to apply paused protections'), undefined);
  assert.equal(t.pause('blocked_thirdparty_cookie').disabled, true);
  t.reply({ ok: true, key: 'blockThirdPartyCookies' }, 1);
  assert.match(t.text, /Paused for this site/);
  assert.ok(t.button('Reload page to apply paused protections'));
});
check('the observed-event set is bounded while existing event counters keep working', () => {
  const t = build();
  for (let i = 0; i < 129; i++) t.manager.observe('blocked_unknown_' + i);
  t.manager.observe('blocked_unknown_0'); t.manager.toggle();
  assert.equal(t.rows.length, 128);
  assert.equal(t.row('blocked_unknown_128'), undefined);
  assert.equal(t.row('blocked_unknown_0').children.find(node => node.className === 'count').textContent, '2');
});
check('closing while a request is pending never reopens the panel', () => {
  const t = build(); t.manager.observe('blocked_thirdparty_cookie'); t.manager.toggle();
  t.click(t.pause('blocked_thirdparty_cookie')); t.manager.close();
  t.reply({ ok: true, key: 'blockThirdPartyCookies' });
  assert.equal(t.body.children.length, 0);
  t.manager.toggle(); assert.match(t.text, /Paused for this site/);
});

check('the compact badge shows shared page/network counts, visible rule IDs and one action per rule', () => {
  const activity = { ok: true, site: 'catalog.example', since: 1800000000000,
    current: { total: 15, trackers: 7, ads: 5, other: 3, observed: 1, networkAvailable: true },
    recent: { day: { trackers: 41, ads: 39, other: 10 }, week: { trackers: 177, ads: 265, other: 37 } },
    events: [{ type: 'detected_beacon', count: 1, kind: 'noticed' }, { type: 'blocked_meta_refresh', count: 1, kind: 'popups' }],
    sources: [{ name: 'AdShield', count: 5 }] };
  const t = build({ activity }); t.manager.toggle();
  assert.match(t.text, /15 blocked/); assert.ok(!t.text.includes('1 observation'));
  assert.equal(t.nodes.filter(node => node.tagName === 'TABLE' || node.className === 'metric').length, 0);
  for (const value of ['24 hours', '7 days', '177', '265', 'AdShield']) assert.ok(!t.text.includes(value));
  assert.equal(t.review('detected_beacon'), undefined);
  assert.ok(t.row('detected_beacon'));
  assert.equal(t.buttons(t.row('detected_beacon')).length, 0, 'a recording has no invented pause or settings control');
  const code = t.row('blocked_meta_refresh').children[0].children.find(node => node.tagName === 'CODE');
  assert.notEqual(code.hidden, true);
  assert.equal(t.buttons(t.row('blocked_meta_refresh')).length, 2, 'settings link and one pause icon');
  assert.equal(t.pause('blocked_meta_refresh').textContent, '', 'the pause action is an icon with an accessible name');
  assert.match(t.root.adoptedStyleSheets[0].text, /width:min\(360px/);
  assert.equal(t.summaries[0], activity);
  t.manager.close(); t.manager.toggle();
  assert.equal(t.queries.length, 1, 'reopening reuses the short-lived snapshot rather than polling Chrome');
});
check('partial network data is labelled and Activity opens only after its own trusted click', () => {
  const t = build({ activity: { ok: true, current: { total: 3, trackers: 1, ads: 0, other: 2, observed: 0, networkAvailable: false } } });
  t.manager.toggle();
  assert.match(t.text, /Recent network counts are unavailable/);
  assert.match(t.text, /3\+ blocked/);
  t.click(t.button('Open Activity Centre'), false); assert.equal(t.messages.length, 0);
  t.click(t.button('Open Activity Centre'));
  assert.deepEqual(t.messages, [{ kind: 'badge-open-activity' }]);
});
check('beacon-only pages identify what was recorded and offer a scoped block control', () => {
  const t = build({ activity: { ok: true, current: { total: 0, trackers: 0, ads: 0, other: 0, observed: 2, networkAvailable: true },
    events: [{ type: 'detected_beacon', count: 2, kind: 'noticed', destinations: ['telemetry.example.net'] }],
    beacons: [{ host: 'telemetry.example.net', blocked: false, saved: false, recommendation: 'unknown' }] } });
  t.manager.toggle();
  assert.ok(!t.text.includes('observations'));
  assert.match(t.text, /Third-party beacon/);
  assert.match(t.text, /detected_beacon/);
  assert.match(t.text, /telemetry.example.net/);
  assert.match(t.text, /Recorded/); assert.match(t.text, /No recommendation/);
  assert.ok(!t.text.includes('0 blocked'));
  assert.equal(t.rows.length, 1); assert.equal(t.buttons().length, 4);
  assert.equal(t.pause('detected_beacon'), undefined);
  assert.equal(t.row('detected_beacon').children[1].getAttribute('aria-label'), '2 recorded events');
});
check('beacon blocks toggle through trusted clicks and the same saved choice stays reversible', () => {
  const host = 'collector.github.com';
  const activity = { ok: true, current: { total: 0, observed: 1, networkAvailable: true },
    events: [{ type: 'detected_beacon', kind: 'noticed', count: 1, destinations: [host] }],
    beacons: [{ host, blocked: false, saved: false, recommendation: 'keep', reason: 'Not recommended: site service.' }] };
  const t = build({ activity }); t.manager.toggle();
  const label = ' beacons to ' + host + ' on this site';
  assert.match(t.text, /Not recommended/);
  t.click(t.button('Block' + label), false); assert.equal(t.messages.length, 0);
  t.click(t.button('Block' + label));
  assert.deepEqual(t.messages, [{ kind: 'badge-beacon-set', destination: host, blocked: true }]);
  assert.equal(t.button('Block' + label).disabled, true);
  t.reply({ ok: true, host, blocked: true, beacons: [{ ...activity.beacons[0], blocked: true, saved: true }] });
  assert.match(t.text, /Saved block for this site/); assert.equal(t.button('Unblock' + label).getAttribute('aria-pressed'), 'true');
  t.click(t.button('Unblock' + label)); t.reply({ ok: true, host, blocked: false, beacons: [{ ...activity.beacons[0], saved: true }] });
  assert.match(t.text, /Unblocked · saved/); assert.ok(t.button('Block' + label));
});
check('a fresh page exposes saved beacon blocks even when no request was observed yet', () => {
  const t = build({ activity: { ok: true, current: { total: 0, observed: 0, networkAvailable: true }, events: [],
    beacons: [{ host: 'tracker.example.net', blocked: true, saved: true, recommendation: 'block' }] } });
  t.manager.toggle(); assert.ok(t.button('Unblock beacons to tracker.example.net on this site'));
  assert.match(t.text, /Recommended/); assert.ok(!t.text.includes('1 blocked'));
  t.click(t.button('Manage saved beacon blocks')); assert.deepEqual(t.messages, [{ kind: 'badge-beacon-settings' }]);
});
check('a slow native beacon write stays pending and accepts its confirmed result instead of reporting a false failure', () => {
  const host = 'tracker.example.net', state = { host, blocked: false, recommendation: 'unknown' };
  const t = build({ activity: { ok: true, current: { total: 0, networkAvailable: true }, beacons: [state] } });
  t.manager.toggle(); t.click(t.button('Block beacons to ' + host + ' on this site'));
  assert.match(t.text, /Applying beacon rule/);
  [...t.timers.values()][0]();
  assert.match(t.text, /browser is still applying/);
  assert.equal(t.button('Block beacons to ' + host + ' on this site').disabled, true);
  t.reply({ ok: true, host, blocked: true, beacons: [{ ...state, saved: true, blocked: true }] });
  assert.ok(t.button('Unblock beacons to ' + host + ' on this site')); assert.doesNotMatch(t.text, /Could not save|still applying/);
});
check('failed beacon saves retain the previous state and unreadable rules offer Reload', () => {
  const t = build({ holdBeacons: true, activity: { ok: true, current: { total: 0, observed: 0, networkAvailable: true },
    beacons: [{ host: 'tracker.example.net', blocked: false, recommendation: 'unknown' }] } });
  t.manager.toggle(); t.beaconReplies.shift()({ ok: true, beacons: [{ host: 'tracker.example.net', blocked: false, recommendation: 'unknown' }] });
  t.click(t.button('Block beacons to tracker.example.net on this site'));
  t.reply({ ok: false, error: 'Browser rejected the change.' });
  assert.match(t.text, /Browser rejected/); assert.ok(t.button('Block beacons to tracker.example.net on this site'));
  t.manager.close(); t.manager.toggle(); t.beaconReplies.shift()({ ok: false });
  assert.equal(t.button('Block beacons to tracker.example.net on this site').disabled, true);
  assert.ok(t.button('Reload page to apply paused protections'));
});
check('the menu shows live beacon details and working saved controls before network counts return', () => {
  const host = 'collector.github.com';
  const t = build({ holdActivity: true, activity: { beacons: [{ host, blocked: false, recommendation: 'keep' }] } });
  t.manager.observe('detected_beacon', 1, host); t.manager.toggle();
  assert.match(t.text, /1 beacon/); assert.match(t.text, /detected_beacon/); assert.match(t.text, /collector\.github\.com/);
  assert.doesNotMatch(t.text, /Checking|Loading/);
  assert.ok(t.button('Block beacons to collector.github.com on this site'));
  assert.equal(t.activityReplies.length, 1); assert.equal(t.beaconQueries.length, 1);
});
check('a late saved-state read cannot overwrite a newer completed beacon decision', () => {
  const host = 'collector.github.com';
  const t = build({ holdBeacons: true }); t.manager.observe('detected_beacon', 1, host); t.manager.toggle();
  t.beaconReplies.shift()({ ok: true, beacons: [{ host, blocked: false, recommendation: 'keep' }] });
  t.manager.close(); t.manager.toggle();
  t.click(t.button('Block beacons to collector.github.com on this site'));
  t.reply({ ok: true, host, blocked: true, beacons: [{ host, blocked: true, saved: true, recommendation: 'keep' }] });
  t.beaconReplies.shift()({ ok: true, beacons: [{ host, blocked: false, recommendation: 'keep' }] });
  assert.ok(t.button('Unblock beacons to collector.github.com on this site'));
});
check('live beacon details are bounded hostnames and refresh an already open panel', () => {
  const t = build(); t.manager.toggle();
  t.manager.observe('detected_beacon', 1, 'collector.example.net');
  assert.match(t.text, /collector.example.net/);
  for (const host of ['https://secret.example/private?token=SECRET', '<img src=x>', 'user@private.example', 'a'.repeat(64) + '.example'])
    t.manager.observe('detected_beacon', 1, host);
  for (let i = 0; i < 9; i++) t.manager.observe('detected_beacon', 1, 'host' + i + '.example');
  assert.doesNotMatch(t.text, /SECRET|private\.example|<img|host4\.example|host8\.example/);
  assert.match(t.text, /host3\.example/);
  t.manager.observe('detected_thirdparty_tracker', 1, 'tracker.example.net');
  assert.match(t.text, /Third-party tracker request/); assert.match(t.text, /tracker.example.net/);
});
check('a beacon arriving during a saved-state read gets its own fresh state without waiting for network totals', () => {
  const t = build({ holdActivity: true, holdBeacons: true }); t.manager.toggle();
  t.manager.observe('detected_beacon', 1, 'collector.example.net');
  assert.match(t.text, /collector\.example\.net/);
  t.beaconReplies.shift()({ ok: true, beacons: [] });
  assert.deepEqual(t.beaconQueries.at(-1).destinations, ['collector.example.net']);
  t.beaconReplies.shift()({ ok: true, beacons: [{ host: 'collector.example.net', blocked: false, recommendation: 'unknown' }] });
  assert.equal(t.button('Block beacons to collector.example.net on this site').textContent, 'Block');
  assert.equal(t.activityReplies.length, 1);
});
check('older retained observations explain a missing destination instead of hiding the event', () => {
  const t = build(); t.manager.observe('detected_beacon'); t.manager.toggle();
  assert.match(t.text, /Third-party beacon/); assert.match(t.text, /Destination was not retained for this event/);
});
check('a gated warning keeps its reviewed site-pause control without counting as a block', () => {
  const t = build({ activity: { ok: true, current: { total: 0, observed: 1, networkAvailable: true },
    events: [{ type: 'gated_adult_site', count: 1, kind: 'noticed' }] } });
  t.manager.toggle(); assert.ok(t.pause('gated_adult_site'));
  t.click(t.pause('gated_adult_site')); assert.deepEqual(t.messages, [{ kind: 'badge-rule-pause', type: 'gated_adult_site' }]);
});
check('malformed activity does not replace a valid summary', () => {
  const t = build(); t.manager.toggle();
  const received = t.summaries.length;
  for (const current of [null, { total: -1 }, { total: Infinity }, { total: 1000000001 }]) {
    assert.equal(t.manager.update({ ok: true, current }), false);
  }
  assert.equal(t.summaries.length, received);
});
check('YouTube ad rows are clickable and pause the real YouTube control with an explicit reload', () => {
  const t = build(); t.manager.toggle();
  t.manager.observe('youtube_ads_removed', 2);
  assert.equal(t.row('youtube_ads_removed').children.find(node => node.className === 'count').textContent, '2');
  const label = t.button('Open settings for youtube_ads_removed');
  t.click(label, false); assert.equal(t.messages.length, 0);
  t.click(label); assert.deepEqual(t.messages[0], { kind: 'badge-rule-settings', type: 'youtube_ads_removed' });
  t.reply({ ok: true });
  t.click(t.pause('youtube_ads_removed')); assert.deepEqual(t.messages[1], { kind: 'badge-rule-pause', type: 'youtube_ads_removed' });
  t.reply({ ok: true, key: 'scriptletEngine' });
  assert.ok(t.button('Reload page to apply paused protections'));
  assert.equal(t.pause('youtube_ads_removed').disabled, false);
});
check('a closed lock pauses and its open lock restores the same site rule', () => {
  const t = build(); t.manager.observe('youtube_ads_removed'); t.manager.toggle();
  const lock = () => t.pause('youtube_ads_removed').children[0].children[0].getAttribute('d');
  assert.match(lock(), /a4 4 0 0 1 8 0v3/);
  t.click(t.pause('youtube_ads_removed')); t.reply({ ok: true, key: 'scriptletEngine' });
  assert.match(lock(), /7\.5-2/);
  t.click(t.pause('youtube_ads_removed'), false); assert.equal(t.messages.length, 1);
  t.click(t.pause('youtube_ads_removed'));
  assert.deepEqual(t.messages[1], { kind: 'badge-rule-resume', type: 'youtube_ads_removed' });
  t.reply({ ok: false });
  assert.match(t.text, /Could not restore/); assert.equal(t.pause('youtube_ads_removed').disabled, false);
  t.click(t.pause('youtube_ads_removed')); t.reply({ ok: true, key: 'scriptletEngine' });
  assert.match(lock(), /a4 4 0 0 1 8 0v3/); assert.match(t.text, /Reload to restore protection/);
  assert.equal(t.pause('youtube_ads_removed').getAttribute('aria-pressed'), 'false');
});
check('a saved site pause remains restorable on a fresh page with no new findings', () => {
  const t = build();
  t.manager.configure({ global: { enabled: true, scriptletEngine: true }, paused: ['scriptletEngine', 'unknown'], local: ['scriptletEngine'] });
  t.manager.toggle();
  assert.equal(t.rows.length, 1); assert.ok(t.row('youtube_ads_removed'));
  assert.ok(!t.row('youtube_ads_removed').children.some(node => node.className === 'count'));
  assert.match(t.text, /Paused for this site/); assert.match(t.pause('youtube_ads_removed').getAttribute('aria-label'), /^Restore /);
  t.click(t.pause('youtube_ads_removed')); t.reply({ ok: true, key: 'scriptletEngine' });
  assert.equal(t.pause('youtube_ads_removed').disabled, false);
  assert.match(t.pause('youtube_ads_removed').getAttribute('aria-label'), /^Pause /);
});
check('a disconnected extension offers a working local Reload rather than dead Activity actions', () => {
  const t = build({ activity: { ok: false, reloadRequired: true } }); t.manager.toggle();
  assert.match(t.text, /Refresh this page to reconnect/);
  assert.equal(t.button('Open Activity Centre').disabled, true);
  t.click(t.button('Reload page to apply paused protections'), false); assert.equal(t.reloads.length, 0);
  t.click(t.button('Reload page to apply paused protections'));
  assert.deepEqual(t.reloads, ['local']); assert.equal(t.messages.length, 0);
});
check('an external restore clears the stale failure and updates the lock without hiding Reload', () => {
  const t = build();
  t.manager.configure({ global: { scriptletEngine: true }, paused: ['scriptletEngine'], local: ['scriptletEngine'] }); t.manager.toggle();
  t.click(t.pause('youtube_ads_removed')); t.reply({ ok: false });
  assert.match(t.text, /Could not restore/);
  t.manager.configure({ global: { scriptletEngine: true }, paused: [], local: [] });
  assert.ok(!t.text.includes('Could not restore')); assert.ok(!t.text.includes('Paused for this site'));
  assert.match(t.pause('youtube_ads_removed').getAttribute('aria-label'), /^Pause /);
  assert.ok(t.button('Reload page to apply paused protections'));
});
check('Reload falls back to its own document if the worker no longer answers', () => {
  const t = build(); t.manager.observe('youtube_ads_removed'); t.manager.toggle();
  t.click(t.pause('youtube_ads_removed')); t.reply({ ok: true, key: 'scriptletEngine' });
  t.click(t.button('Reload page to apply paused protections')); t.reply({ ok: false, reloadRequired: true });
  assert.deepEqual(t.reloads, ['local']);
});
check('global and inherited pauses cannot be overridden by a page control', () => {
  for (const global of [{ enabled: false }, { scriptletEngine: false }, {}]) {
    const t = build(); t.manager.configure({ global, paused: ['scriptletEngine'], local: [] }); t.manager.toggle();
    assert.equal(t.pause('youtube_ads_removed').disabled, true);
    t.click(t.pause('youtube_ads_removed')); assert.equal(t.messages.length, 0);
  }
});
check('both badge palettes use the shared theme tokens and appearance updates preserve active controls', () => {
  const css = fs.readFileSync(path.join(rootPath, 'theme.css'), 'utf8');
  const t = build(); t.manager.observe('blocked_thirdparty_cookie'); t.manager.toggle();
  t.click(t.pause('blocked_thirdparty_cookie'));
  const pause = t.pause('blocked_thirdparty_cookie');
  for (const mode of ['light', 'dark']) {
    assert.equal(t.manager.setTheme(mode), true);
    assert.ok(t.pause('blocked_thirdparty_cookie') === pause, 'theme changes must not replace a pending action');
    const palette = t.root.adoptedStyleSheets[1].text;
    assert.ok(palette.includes('color-scheme:' + mode));
    const shared = mode === 'dark' ? css.slice(css.indexOf(':root[data-wardenone-theme-resolved="dark"]')) : css;
    const tokens = [...palette.matchAll(/(--wo-[a-z-]+):([^;]+);/g)]; assert.ok(tokens.length >= 10);
    for (const [, key, value] of tokens) {
      const expected = shared.match(new RegExp(key + ':\\s*([^;]+);')) || css.match(new RegExp(key + ':\\s*([^;]+);'));
      assert.ok(expected, key); assert.equal(value.replace(/\s/g, ''), expected[1].replace(/\s/g, ''), mode + ': ' + key);
    }
  }
  assert.equal(t.manager.setTheme('invalid'), false);
  t.reply({ ok: true, key: 'blockThirdPartyCookies' }); assert.ok(t.button('Reload page to apply paused protections'));
});

console.log(passed + ' badge control checks passed');
