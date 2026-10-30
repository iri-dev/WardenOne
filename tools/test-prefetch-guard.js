/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE. */
'use strict';
/* Block prefetch & preload, run from the shipped content.min.js slice. Signed-in ChatGPT stopped
   replying because the guard removed <link> elements React 19 had rendered; React later removes its
   own node with an unguarded parentNode.removeChild and the whole conversation view threw. */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { installEngineAmbient } = require('./lib/engine-ambient.js');

const MIN = fs.readFileSync(path.join(__dirname, '..', 'content.min.js'), 'utf8');
const START = MIN.indexOf('if(WO.killPrefetch)try{');
const END = MIN.indexOf('if(WO.throttleBackgroundTabs', START);
assert(START >= 0 && END > START, 'prefetch guard markers not found in content.min.js');
const SLICE = MIN.slice(START, END);

class Node {
  constructor(tagName, attrs, reactKey) {
    this.tagName = tagName;
    this.attrs = Object.assign({}, attrs);
    this.parentNode = null;
    if (reactKey) this[reactKey] = { tag: 26 };
  }
  get type() { return this.attrs.type || ''; }
  getAttribute(name) { return Object.prototype.hasOwnProperty.call(this.attrs, name) ? this.attrs[name] : null; }
  setAttribute(name, value) { this.attrs[name] = String(value); }
}
class Head {
  constructor() { this.children = []; }
  appendChild(node) { node.parentNode = this; this.children.push(node); return node; }
  removeChild(node) {
    const at = this.children.indexOf(node);
    if (at < 0) throw new Error('not a child');
    this.children.splice(at, 1);
    node.parentNode = null;
    return node;
  }
  querySelectorAll() { return this.children.filter((n) => n.tagName === 'LINK' || (n.tagName === 'SCRIPT' && /speculationrules/.test(n.type))); }
}
/* What React's deletion pass does for a hoisted element: no null check. */
const reactUnmount = (node) => node.parentNode.removeChild(node);

function run(nodes) {
  const head = new Head();
  nodes.forEach((n) => head.appendChild(n));
  let observer = null;
  const logs = [];
  const sandbox = {
    WO: { killPrefetch: true },
    document: { documentElement: {}, querySelectorAll: (s) => head.querySelectorAll(s) },
    woObserve(fn) { observer = fn; },
    log(type) { logs.push(type); },
    Object, String,
  };
  vm.createContext(sandbox);
  installEngineAmbient(sandbox);
  vm.runInContext(SLICE, sandbox);
  return { head, logs, add(node) { head.appendChild(node); observer([], [node], []); } };
}

const plainPrefetch = new Node('LINK', { rel: 'prefetch', href: '/next-page' });
const plainPreconnect = new Node('LINK', { rel: 'preconnect', href: 'https://cdn.example' });
const reactPreload = new Node('LINK', { rel: 'preload', as: 'script', href: '/chunk.js' }, '__reactFiber$abc123');
const reactModule = new Node('LINK', { rel: 'modulepreload', href: '/mod.js' }, '__reactMarker$abc123');
const stylesheet = new Node('LINK', { rel: 'stylesheet', href: '/app.css' });
const plainRules = new Node('SCRIPT', { type: 'speculationrules' });
const page = run([plainPrefetch, plainPreconnect, reactPreload, reactModule, stylesheet, plainRules]);

assert(page.logs.includes('resource_prefetch_off'), 'the guard must still switch on');
assert.strictEqual(plainPrefetch.parentNode, null, 'a page prefetch hint must still be removed');
assert.strictEqual(plainPreconnect.parentNode, null, 'a page preconnect hint must still be removed');
assert.strictEqual(plainRules.parentNode, null, 'page speculation rules must still be removed');
assert.strictEqual(stylesheet.parentNode, page.head, 'a stylesheet is never touched');
assert.strictEqual(stylesheet.getAttribute('rel'), 'stylesheet');

for (const [node, rel] of [[reactPreload, 'preload'], [reactModule, 'modulepreload']]) {
  assert.strictEqual(node.parentNode, page.head, 'a link React rendered must stay in the document: ' + rel);
  assert.strictEqual(node.getAttribute('rel'), 'wo-off-' + rel, 'a link React rendered must be switched off in place: ' + rel);
  assert.doesNotThrow(() => reactUnmount(node), 'React unmounting its own link must not throw: ' + rel);
}

/* The same through the live observer, which is the path ChatGPT hit as a reply rendered. */
const lateReact = new Node('LINK', { rel: 'preconnect', href: 'https://files.example' }, '__reactFiber$late');
const latePlain = new Node('LINK', { rel: 'dns-prefetch', href: 'https://dns.example' });
page.add(lateReact);
page.add(latePlain);
assert.strictEqual(latePlain.parentNode, null, 'a late page hint must still be removed');
assert.strictEqual(lateReact.getAttribute('rel'), 'wo-off-preconnect');
assert.doesNotThrow(() => reactUnmount(lateReact), 'React unmounting a late link must not throw');

/* A speculation-rules script React rendered is left for React to remove. */
const reactRules = new Node('SCRIPT', { type: 'speculationrules' }, '__reactFiber$rules');
page.add(reactRules);
assert.doesNotThrow(() => reactUnmount(reactRules), 'React unmounting its own speculation rules must not throw');

console.log('[ok] prefetch guard removes page hints and leaves React-owned links in place');
