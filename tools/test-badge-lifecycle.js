/* WardenOne — Copyright (C) 2026 iri; GPL-3.0-or-later. See LICENSE. */
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('src/content.js', 'utf8');
const start = source.indexOf('    {\n      const counts=Object.create(null);');
const end = source.indexOf('\n      try{\n        let __woAdCollapseStarted=', start);
assert.ok(start >= 0 && end > start);

function harness() {
  const requests = [], observers = [], timers = new Map(), errors = [];
  let timerId = 0, measurements = 0;
  class Node {
    constructor(tag) {
      this.localName = tag;
      this.nodeType = 1;
      this.children = [];
      this.listeners = new Map();
      this.attributes = {};
      this.style = { setProperty() {} };
      const classes = new Set();
      this.classList = {
        add: (...names) => names.forEach(name => classes.add(name)),
        remove: (...names) => names.forEach(name => classes.delete(name)),
        contains: name => classes.has(name),
        toggle(name, on = !classes.has(name)) { if (on) classes.add(name); else classes.delete(name); },
      };
      Object.defineProperty(this, 'className', {
        get: () => [...classes].join(' '),
        set: value => { classes.clear(); String(value).split(/\s+/).filter(Boolean).forEach(name => classes.add(name)); },
      });
    }
    get isConnected() { return this === document.documentElement || !!this.parentElement?.isConnected || !!this.host?.isConnected; }
    appendChild(node) { node.remove(); this.children.push(node); node.parentElement = this; return node; }
    remove() {
      if (this.parentElement) this.parentElement.children.splice(this.parentElement.children.indexOf(this), 1);
      this.parentElement = null;
    }
    contains(node) { return this === node || this.children.some(child => child.contains(node)); }
    attachShadow() { this.shadowRoot = new Node('shadow-root'); this.shadowRoot.host = this; return this.shadowRoot; }
    setAttribute(name, value) { this.attributes[name] = value; }
    getAttribute(name) { return this.attributes[name]; }
    addEventListener(type, listener) {
      if (!this.listeners.has(type)) this.listeners.set(type, []);
      this.listeners.get(type).push(listener);
    }
    emit(type, event = {}) { for (const listener of this.listeners.get(type) || []) listener(event); }
    getElementById(id) {
      if (this.id === id) return this;
      for (const child of this.children) { const match = child.getElementById(id); if (match) return match; }
      return null;
    }
    getBoundingClientRect() {
      measurements++;
      return { left: 1110, right: 1230, top: 850, bottom: 882, width: 120, height: 32 };
    }
    set textContent(value) { for (const child of [...this.children]) child.remove(); this.text = value; }
    get textContent() { return (this.text || '') + this.children.map(child => child.textContent).join(''); }
  }
  const document = new Node('document');
  document.documentElement = new Node('html');
  document.documentElement.clientWidth = 1280;
  document.body = document.documentElement.appendChild(new Node('body'));
  document.scrollingElement = { scrollHeight: 5000 };
  document.createElement = tag => new Node(tag);
  document.getElementById = id => document.documentElement.getElementById(id);
  document.querySelectorAll = () => [];
  document.elementsFromPoint = () => [];
  const context = {
    document, window: Object.assign(new Node('window'), { innerWidth: 1280, innerHeight: 900 }),
    location: { hostname: 'github.com', pathname: '/iri-dev/WardenOne' },
    WO: { showBadge: true }, discordAppHost: false, PLAYER_SHELL_SELECTOR: '[data-player]',
    __woBadgeThemeDark: true, __woBadgeThemeReady: true,
    __woEventTrusted: detail => detail?.authenticated === true,
    __woSignedRequest: value => value,
    __woBackgroundRequest(message, callback) { requests.push(message); callback({ ok: true, open: true }); },
    CSSStyleSheet: class { replaceSync() {} },
    clearNode: node => { node.textContent = ''; },
    getComputedStyle: () => ({ position: 'static', overflowY: 'visible' }),
    woOn: (node, type, callback) => node.addEventListener(type, callback),
    woObserve: callback => observers.push(callback), __woHold: value => value,
    setTimeout(callback, delay) { const id = ++timerId; timers.set(id, { callback, delay }); return id; },
    clearTimeout: id => timers.delete(id),
    log: (type, detail) => errors.push({ type, detail }),
  };
  vm.runInNewContext(source.slice(start, end), context);
  const changed = (structural = true) => observers.forEach(callback => callback([], [], [], structural));
  const badge = () => document.getElementById('rg-badge-host');
  const button = () => badge()?.shadowRoot.getElementById('rg-b');
  const emit = type => document.emit('wo-event', { detail: { type, authenticated: true } });
  return { context, document, Node, requests, errors, changed, badge, button, emit,
    measurements: () => measurements,
    settle() { for (const [id, timer] of [...timers]) if (timer.delay === 1110) { timers.delete(id); timer.callback(); } },
    configure(showBadge) { context.WO.showBadge = showBadge; document.emit('wo-config-change'); changed(); },
  };
}

for (const removal of ['host', 'body']) {
  const t = harness(), host = t.badge(), button = t.button();
  assert.deepEqual(t.errors, []);
  t.emit('blocked_popup'); t.emit('detected_beacon'); t.settle();
  assert.equal(button.textContent, '1 blocked');
  assert.equal(button.classList.contains('show'), false);
  if (removal === 'host') host.remove();
  else {
    t.document.body.remove();
    t.document.body = t.document.documentElement.appendChild(new t.Node('body'));
  }
  t.changed();
  assert.equal(t.badge(), host, removal + ': retain the owned host');
  assert.equal(t.button(), button, removal + ': retain the button and its listeners');
  assert.equal(host.parentElement, t.document.documentElement);
  assert.equal(button.textContent, '1 blocked');
  assert.equal(button.classList.contains('show'), false, removal + ': keep the settled fade');
  button.emit('click', { isTrusted: false });
  assert.equal(t.requests.length, 0, removal + ': untrusted clicks remain rejected');
  button.emit('click', { isTrusted: true });
  assert.equal(t.requests.at(-1).kind, 'badge-rule-menu', removal + ': controls still open');
  t.emit('blocked_popup');
  assert.equal(button.textContent, '2 blocked', removal + ': later events keep updating the restored badge');
  assert.ok(button.classList.contains('hot'));
  assert.equal(t.document.listeners.get('wo-event').length, 1);
  const measured = t.measurements();
  t.changed(); t.changed(false);
  assert.equal(t.measurements(), measured, removal + ': unrelated mutations perform no layout work');
}

{
  const t = harness();
  for (let i = 0; i < 3; i++) { t.badge().remove(); t.changed(); assert.ok(t.badge()); }
  const host = t.badge(); host.remove(); t.changed();
  assert.equal(t.badge(), null, 'repeated page removal cannot create an observer loop');
}

{
  const t = harness(), original = t.badge();
  t.emit('blocked_popup');
  t.configure(false);
  assert.equal(t.badge(), null, 'turning off the badge suppresses recovery');
  t.changed();
  assert.equal(t.badge(), null);
  t.configure(true);
  assert.notEqual(t.badge(), original, 'turning it back on creates a fresh live badge');
  t.emit('blocked_popup');
  assert.equal(t.button().textContent, '2 blocked', 'settings changes keep one event listener and the existing count');
  assert.equal(t.document.listeners.get('wo-event').length, 1);
  assert.deepEqual(t.errors, []);
}

console.log('[ok] badge survives body replacement, restores detached controls and respects visibility settings');
