/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE. */
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../src/content.js'), 'utf8');

function fragments(text = source) {
  const start = text.indexOf('  const __woRedirectChainControl=');
  const end = text.indexOf('  /* abort() before send()', start);
  const detector = text.indexOf('    if(WO.detectRedirectChains){');
  const after = text.indexOf('    if(WO.blockGrabberResources', detector);
  assert.ok(detector >= 0 && after > detector, 'actual redirect-chain detector is locatable');
  return { control: start < 0 ? '' : text.slice(start, end), detector: text.slice(detector, after) };
}

function build({ navigationAvailable = true, href } = {}) {
  const logs = [], buttons = new Map(), meta = new Map([['content', '0;url=https://fake.example/']]);
  class Destination {
    constructor(sameDocument) { this.same = sameDocument; }
    get sameDocument() { return this.same; }
  }
  class Navigate extends Event {
    constructor({ userInitiated = false, sameDocument = false, cancelable = true } = {}) {
      super('navigate', { cancelable });
      this.initiated = userInitiated;
      this.dest = new Destination(sameDocument);
    }
    get userInitiated() { return this.initiated; }
    get destination() { return this.dest; }
  }
  const nav = new EventTarget();
  const context = {
    Event, EventTarget, AbortController, NavigateEvent: Navigate, NavigationDestination: Destination,
    window: { navigation: navigationAvailable ? nav : null },
    __woAbort: new AbortController(), WO: { enabled: true, detectRedirectChains: true },
    location: new URL(href || 'https://relay.example/?data=' + Buffer.from(JSON.stringify({ step: 2, next: 'https://fake.example/' })).toString('base64url')),
    toURL: value => { try { return new URL(value); } catch (_) { return null; } },
    atob: value => Buffer.from(value, 'base64').toString(),
    document: {
      querySelectorAll: () => [{ getAttribute: k => meta.get(k), setAttribute: (k, v) => meta.set(k, v), removeAttribute: k => meta.delete(k) }],
      documentElement: { appendChild() {} },
    },
    buildOverlay: () => ({}), oDiv: (parent, style, text) => { if (text) logs.push(text); return {}; },
    oTextDiv() {}, appendShieldSvg() {}, woDialog: () => () => {},
    oBtn: (parent, style, label, callback) => buttons.set(label, callback),
    mountBlocker: (id, paint) => { paint(); return () => { context.WO.__frozen = false; }; },
    log: (type, detail) => logs.push({ type, detail }),
    realGoBack: () => logs.push('back'),
  };
  vm.createContext(context);
  const parts = fragments();
  vm.runInContext(parts.control + '\n__woRedirectChainControl.configure(true);\n' + parts.detector, context);
  return {
    context, logs, meta,
    navigate(extra) { const event = new Navigate(extra); nav.dispatchEvent(event); return event.defaultPrevented; },
    click(label, trusted = true) { buttons.get(label)({ isTrusted: trusted }); },
    run(code) { return vm.runInContext(code, context); },
    configure(enabled) { this.run('__woRedirectChainControl.configure(' + enabled + ')'); },
  };
}

function test() {
  let passed = 0;
  function check(name, fn) { fn(); passed++; console.log('[ok] ' + name); }
  check('the real warning arms cancellation before announcing a blocked chain', () => {
    const t = build();
    assert.ok(t.logs.includes('Redirect chain blocked'));
    assert.equal(t.meta.has('content'), false);
    assert.equal(t.navigate(), true);
    assert.ok(source.indexOf('__woRedirectChainControl.arm();') < source.indexOf('log("blocked_redirect_chain"'));
  });
  check('repeated automatic cross-document events remain cancelled', () => {
    const t = build();
    for (let i = 0; i < 5; i++) assert.equal(t.navigate(), true);
  });
  check('dismissing the warning keeps retries blocked after overlay teardown', () => {
    const t = build();
    t.click('Dismiss & stay here');
    assert.equal(t.context.WO.__frozen, true);
    for (let i = 0; i < 5; i++) assert.equal(t.navigate(), true);
  });
  check('clearing public flags and replacing native prototypes cannot release the private stop', () => {
    const t = build();
    t.run('delete WO.__frozen; window.__wardenOneReadyVersion=false;');
    const originalPrevent = Event.prototype.preventDefault;
    const descriptor = Object.getOwnPropertyDescriptor(t.context.NavigateEvent.prototype, 'userInitiated');
    try {
      Event.prototype.preventDefault = () => {};
      Object.defineProperty(t.context.NavigateEvent.prototype, 'userInitiated', { get: () => true, configurable: true });
      assert.equal(t.navigate(), true);
    } finally {
      Event.prototype.preventDefault = originalPrevent;
      Object.defineProperty(t.context.NavigateEvent.prototype, 'userInitiated', descriptor);
    }
  });
  check('trusted native navigation, in-document changes and browser traversal stay available', () => {
    const t = build();
    assert.equal(t.navigate({ userInitiated: true }), false);
    assert.equal(t.navigate({ sameDocument: true }), false);
    assert.equal(t.navigate({ cancelable: false }), false);
  });
  for (const label of ['Resume page redirects', '<- Go back to safety']) {
    check('synthetic ' + label + ' does not release the stop', () => {
      const t = build(); t.click(label, false); assert.equal(t.navigate(), true);
    });
    check('trusted ' + label + ' releases the stop explicitly', () => {
      const t = build(); t.click(label); assert.equal(t.navigate(), false);
      assert.ok(t.logs.some(entry => entry.type === 'allowed_redirect_chain'));
    });
  }
  check('settings changes pause and restore enforcement without losing chain evidence', () => {
    const t = build(); t.configure(false); assert.equal(t.navigate(), false);
    t.configure(true); assert.equal(t.navigate(), true);
    assert.match(source, /__woRedirectChainControl\.configure\(next\.enabled!==!1&&next\.detectRedirectChains===!0\)/);
  });
  check('missing browser support never claims the native navigation was blocked', () => {
    const t = build({ navigationAvailable: false });
    assert.ok(t.logs.includes('Suspicious redirect chain detected'));
    assert.ok(!t.logs.includes('Redirect chain blocked'));
  });
  check('ordinary pages retain navigation and do not show the chain warning', () => {
    const t = build({ href: 'https://store.example/product' });
    assert.equal(t.navigate(), false);
    assert.ok(!t.logs.includes('Redirect chain blocked'));
  });
  check('reported rotating download hosts have a native pre-request rule and fixed local warning', () => {
    const root = path.join(__dirname, '..');
    const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
    const pack = manifest.declarative_net_request.rule_resources.find(entry => entry.id === 'download_landings');
    assert.equal(pack.enabled, true);
    const rules = JSON.parse(fs.readFileSync(path.join(root, pack.path), 'utf8'));
    assert.equal(rules.length, 2);
    const rule = rules[0];
    assert.deepEqual(rule.condition, { requestDomains: ['whuw8g.site'], resourceTypes: ['main_frame', 'sub_frame'] });
    assert.equal(rule.priority, 3001);
    assert.deepEqual(rule.action, { type: 'redirect', redirect: { extensionPath: '/download-site-blocked.html' } });
    assert.deepEqual(rules[1], { id: 2, priority: 3000, action: { type: 'block' }, condition: { requestDomains: ['whuw8g.site'] } });
    assert.ok(rule.priority > rules[1].priority, 'page warning wins while every other request type is blocked');
    assert.ok(manifest.web_accessible_resources.some(entry => entry.resources.includes('download-site-blocked.html')));
    const page = fs.readFileSync(path.join(root, 'download-site-blocked.html'), 'utf8');
    assert.ok(page.includes('reported deceptive download network'));
    assert.ok(!/<iframe|<form/i.test(page));
    assert.deepEqual([...page.matchAll(/<script src="([^"]+)"><\/script>/g)].map(m => m[1]), ['theme.js', 'download-site-blocked.js']);
    assert.ok(!page.includes('about:blank'));
  });
  console.log(passed + ' redirect-chain stop checks passed');
}

module.exports = { fragments };
if (require.main === module) test();
