/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
'use strict';

/* A very small DOM for suites that need to drive a content script against a page shape:
   elements with a tag, id, classes and attributes; a tree; and enough of the selector
   language to run the real code's queries -- tag, #id, .class, [attr], [attr="v"],
   [attr^="v"], [attr$="v"], [attr*="v"], compound selectors, descendant and child
   combinators, and selector lists. Not a browser: no layout, no styles, no events beyond
   a listener registry. Build a page with h(), hand it to makeDocument(). */

function splitTop(text, sep) {
  const out = [];
  let depth = 0;
  let cur = '';
  let quote = '';
  for (const ch of text) {
    if (quote) { cur += ch; if (ch === quote) quote = ''; continue; }
    if (ch === '"' || ch === "'") { quote = ch; cur += ch; continue; }
    if (ch === '[') depth++;
    if (ch === ']') depth--;
    if (ch === sep && depth === 0) { out.push(cur); cur = ''; continue; }
    cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim()).filter(Boolean);
}

function parseCompound(text) {
  const parts = [];
  const re = /([a-zA-Z][\w-]*)|#([\w-]+)|\.([\w-]+)|\[([\w-]+)(?:([\^$*]?=)"([^"]*)")?\]/g;
  let m;
  let consumed = 0;
  while ((m = re.exec(text))) {
    consumed += m[0].length;
    if (m[1]) parts.push({ kind: 'tag', value: m[1].toUpperCase() });
    else if (m[2]) parts.push({ kind: 'id', value: m[2] });
    else if (m[3]) parts.push({ kind: 'class', value: m[3] });
    else parts.push({ kind: 'attr', name: m[4], op: m[5] || '', value: m[6] });
  }
  if (consumed !== text.length) throw new Error('mini-dom: unsupported selector "' + text + '"');
  return parts;
}

/* "a b > c" -> [{compound}, {combinator:' ', compound}, ...] evaluated right to left. */
function parseComplex(text) {
  /* Tokens are compounds and ">" -- split on whitespace outside brackets and quotes, so an
     attribute value with a space in it stays whole. */
  const tokens = [];
  let cur = '';
  let depth = 0;
  let quote = '';
  for (const ch of text) {
    if (quote) { cur += ch; if (ch === quote) quote = ''; continue; }
    if (ch === '"' || ch === "'") { quote = ch; cur += ch; continue; }
    if (ch === '[') depth++;
    if (ch === ']') depth--;
    if (depth === 0 && (ch === ' ' || ch === '\t' || ch === '>')) {
      if (cur) tokens.push(cur);
      cur = '';
      if (ch === '>') tokens.push('>');
      continue;
    }
    cur += ch;
  }
  if (cur) tokens.push(cur);
  const chain = [];
  let combinator = ' ';
  for (const t of tokens) {
    if (t === '>') { combinator = '>'; continue; }
    chain.push({ combinator, compound: parseCompound(t) });
    combinator = ' ';
  }
  return chain;
}

class Element {
  constructor(tag, attrs, children) {
    this.tagName = String(tag).toUpperCase();
    this.nodeType = 1;
    this.attrs = Object.assign({}, attrs || {});
    this.childNodes = [];
    this.parentNode = null;
    this.ownerDocument = null;
    this.listeners = [];
    for (const c of children || []) this.appendChild(typeof c === 'string' ? new Text(c) : c);
  }
  get id() { return this.attrs.id || ''; }
  set id(v) { this.attrs.id = String(v); }
  get className() { return this.attrs.class || ''; }
  set className(v) { this.attrs.class = String(v); }
  get classList() {
    const el = this;
    const list = {
      contains: (c) => el.className.split(/\s+/).includes(c),
      add: (c) => { if (!list.contains(c)) el.className = (el.className + ' ' + c).trim(); },
      remove: (c) => { el.className = el.className.split(/\s+/).filter((x) => x && x !== c).join(' '); },
      toggle: (c, force) => { const on = force === undefined ? !list.contains(c) : !!force; if (on) list.add(c); else list.remove(c); return on; },
    };
    return list;
  }
  get children() { return this.childNodes.filter((n) => n.nodeType === 1); }
  get firstChild() { return this.childNodes[0] || null; }
  get firstElementChild() { return this.children[0] || null; }
  get parentElement() { return this.parentNode && this.parentNode.nodeType === 1 ? this.parentNode : null; }
  get isConnected() { let n = this; while (n) { if (n.nodeType === 9) return true; n = n.parentNode; } return false; }
  get textContent() { return this.childNodes.map((n) => n.textContent).join(''); }
  set textContent(v) { this.childNodes = []; if (v !== '') this.appendChild(new Text(String(v))); }
  get innerText() { return this.textContent; }
  get href() {
    const raw = this.attrs.href;
    if (raw === undefined) return '';
    try { return new URL(raw, (this.ownerDocument && this.ownerDocument.URL) || 'https://example.test/').href; } catch (_) { return raw; }
  }
  set href(v) { this.attrs.href = String(v); }
  get type() { return this.attrs.type || ''; }
  set type(v) { this.attrs.type = String(v); }
  get outerTag() { return this.tagName.toLowerCase() + (this.id ? '#' + this.id : '') + (this.className ? '.' + this.className.trim().split(/\s+/).join('.') : ''); }
  getAttribute(name) { return Object.prototype.hasOwnProperty.call(this.attrs, name) ? this.attrs[name] : null; }
  setAttribute(name, value) { this.attrs[name] = String(value); }
  hasAttribute(name) { return Object.prototype.hasOwnProperty.call(this.attrs, name); }
  removeAttribute(name) { delete this.attrs[name]; }
  appendChild(node) { this.insertBefore(node, null); return node; }
  insertBefore(node, ref) {
    if (node.parentNode) node.parentNode.removeChild(node);
    node.parentNode = this;
    const setDoc = (n) => { n.ownerDocument = this.ownerDocument; (n.childNodes || []).forEach(setDoc); };
    setDoc(node);
    const i = ref ? this.childNodes.indexOf(ref) : -1;
    if (i < 0) this.childNodes.push(node); else this.childNodes.splice(i, 0, node);
    if (this.ownerDocument) this.ownerDocument.mutations++;
    return node;
  }
  removeChild(node) { const i = this.childNodes.indexOf(node); if (i >= 0) { this.childNodes.splice(i, 1); node.parentNode = null; if (this.ownerDocument) this.ownerDocument.mutations++; } return node; }
  remove() { if (this.parentNode) this.parentNode.removeChild(this); }
  contains(node) { let n = node; while (n) { if (n === this) return true; n = n.parentNode; } return false; }
  addEventListener(type, fn, opts) { this.listeners.push({ type, fn, opts }); }
  removeEventListener(type, fn) { this.listeners = this.listeners.filter((l) => !(l.type === type && l.fn === fn)); }
  dispatchEvent(evt) { this.listeners.filter((l) => l.type === evt.type).forEach((l) => l.fn(evt)); return true; }
  descendants(out) { out = out || []; for (const c of this.children) { out.push(c); c.descendants(out); } return out; }
  matchesCompound(parts) {
    for (const p of parts) {
      if (p.kind === 'tag' && this.tagName !== p.value) return false;
      if (p.kind === 'id' && this.id !== p.value) return false;
      if (p.kind === 'class' && !this.className.split(/\s+/).includes(p.value)) return false;
      if (p.kind === 'attr') {
        if (!this.hasAttribute(p.name)) return false;
        const v = String(this.getAttribute(p.name));
        if (p.op === '=' && v !== p.value) return false;
        if (p.op === '^=' && !v.startsWith(p.value)) return false;
        if (p.op === '$=' && !v.endsWith(p.value)) return false;
        if (p.op === '*=' && v.indexOf(p.value) < 0) return false;
      }
    }
    return true;
  }
  matchesChain(chain, index) {
    const step = chain[index];
    if (!this.matchesCompound(step.compound)) return false;
    if (index === 0) return true;
    const prev = chain[index - 1];
    if (step.combinator === '>') return !!(this.parentElement && this.parentElement.matchesChain(chain, index - 1));
    let n = this.parentElement;
    while (n) { if (n.matchesChain(chain, index - 1)) return true; n = n.parentElement; }
    return false;
  }
  matches(selector) { return splitTop(selector, ',').some((s) => { const chain = parseComplex(s); return this.matchesChain(chain, chain.length - 1); }); }
  querySelectorAll(selector) { return this.descendants().filter((el) => el.matches(selector)); }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  closest(selector) { let n = this; while (n && n.nodeType === 1) { if (n.matches(selector)) return n; n = n.parentElement; } return null; }
}

class Text {
  constructor(text) { this.nodeType = 3; this.nodeValue = String(text); this.parentNode = null; this.childNodes = []; }
  get textContent() { return this.nodeValue; }
  set textContent(v) { this.nodeValue = String(v); }
}

/* h('div', { id: 'x', class: 'a b', 'data-testid': 't' }, [child, 'text']) */
function h(tag, attrs, children) {
  if (Array.isArray(attrs)) { children = attrs; attrs = {}; }
  return new Element(tag, attrs, children);
}

function makeDocument(url, bodyChildren) {
  const html = new Element('html');
  const head = new Element('head');
  const body = new Element('body');
  html.appendChild(head); html.appendChild(body);
  const document = {
    nodeType: 9,
    URL: url,
    readyState: 'complete',
    documentElement: html, head, body,
    mutations: 0,
    listeners: [],
    createElement: (tag) => { const el = new Element(tag); el.ownerDocument = document; return el; },
    createTextNode: (text) => new Text(text),
    getElementById: (id) => html.descendants().find((el) => el.id === id) || null,
    querySelector: (sel) => html.querySelector(sel),
    querySelectorAll: (sel) => html.querySelectorAll(sel),
    addEventListener(type, fn, opts) { this.listeners.push({ type, fn, opts }); },
    removeEventListener() {},
    dispatchEvent(evt) { this.listeners.filter((l) => l.type === evt.type).forEach((l) => l.fn(evt)); return true; },
  };
  html.parentNode = document;
  const setDoc = (n) => { n.ownerDocument = document; (n.childNodes || []).forEach(setDoc); };
  setDoc(html);
  for (const c of bodyChildren || []) body.appendChild(c);
  return document;
}

module.exports = { Element, Text, h, makeDocument, splitTop, parseComplex };
