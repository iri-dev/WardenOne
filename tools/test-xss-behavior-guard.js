/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/*
 * XSS Behavior Guard source-to-sink correlation.
 *
 * Executes the real shipped behavioral-scanner slice. URL payloads are weak
 * evidence; only exact reflection into an executable HTML/event sink is a hard
 * signal. URL, window.name, referrer, and postMessage provenance must survive
 * bounded normalization; native sink calls must continue unchanged and raw
 * payloads must never appear in logs.
 *
 * Run: node tools/test-xss-behavior-guard.js
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { installEngineAmbient } = require('./lib/engine-ambient.js');

const ROOT = path.resolve(__dirname, '..');
const CONTENT = fs.readFileSync(path.join(ROOT, 'content.min.js'), 'utf8');
const SOURCE = fs.readFileSync(path.join(ROOT, 'src', 'content.js'), 'utf8');
const BACKGROUND = fs.readFileSync(path.join(ROOT, 'background.js'), 'utf8');
const POPUP = fs.readFileSync(path.join(ROOT, 'popup.js'), 'utf8');
const POPUP_HTML = fs.readFileSync(path.join(ROOT, 'popup.html'), 'utf8');
const HISTORY = fs.readFileSync(path.join(ROOT, 'history.js'), 'utf8');
const XSS_ACTIVITY_TYPES = new Set([
  'warned_potential_dom_xss',
  'warned_potential_xss_code_execution',
  'warned_potential_xss_navigation',
  'warned_potential_xss_script_injection',
  'warned_potential_xss_privileged_action',
  'warned_xss_behavior',
]);

function sourceBetween(startNeedle, endNeedle) {
  const start = CONTENT.indexOf(startNeedle);
  assert(start >= 0, 'missing runtime marker: ' + startNeedle);
  const end = CONTENT.indexOf(endNeedle, start + startNeedle.length);
  assert(end > start, 'missing runtime marker after ' + startNeedle + ': ' + endNeedle);
  return CONTENT.slice(start, end);
}

const HELPERS = 'const ' + sourceBetween('SITE_BOUNDARY=(()=>{', 'isGoogleSearchResults=').replace(/,$/, '');
const SCANNER = sourceBetween(
  'if(WO.behavioralScan||WO.xssBehaviorGuard||WO.fingerprintProbeDetection)try{',
  'catch(e){log("behavioral_scan_failed"',
) + 'catch(e){this.__scanError=e}';

function run(options) {
  const opts = options || {};
  const url = new URL(opts.page);
  const clock = { now: 1700000000000 };
  const timers = [];
  const intervals = [];
  const ageRequests = [];
  const logs = [];
  const listeners = Object.create(null);
  const navigationListeners = Object.create(null);

  function connectTree(node, connected, parent) {
    if (!node || typeof node !== 'object') return;
    node.parentNode = parent || null;
    node.isConnected = !!connected;
    const children = node.childNodes || [];
    for (let i = 0; i < children.length; i++) connectTree(children[i], connected, node);
  }

  class Node {
    constructor(nodeType) {
      this._textContent = '';
      this.nodeType = Number(nodeType) || 0;
      this.isConnected = false;
      this.parentNode = null;
      this.childNodes = [];
    }
    _insert(values, replace) {
      const inserted = [];
      for (const value of values) {
        if (!value || typeof value !== 'object') continue;
        if (value.nodeType === 11) {
          inserted.push(...value.childNodes);
          value.childNodes = [];
        } else {
          inserted.push(value);
        }
      }
      if (replace) this.childNodes = [];
      for (const node of inserted) {
        this.childNodes.push(node);
        connectTree(node, this.isConnected, this);
      }
      this.lastInserted = inserted;
      return inserted;
    }
    appendChild(node) {
      if (opts.throwInsertion) throw new TypeError('rejected insertion');
      this._insert([node], false);
      if (opts.selfRemoveInsertedScript && String(node && node.tagName || '').toUpperCase() === 'SCRIPT') {
        node.textContent = '';
        node.isConnected = false;
        node.parentNode = null;
      }
      return node;
    }
    insertBefore(node) { this._insert([node], false); return node; }
    replaceChild(node, oldNode) {
      const index = this.childNodes.indexOf(oldNode);
      if (index >= 0) this.childNodes.splice(index, 1);
      this._insert([node], false);
      return oldNode;
    }
    append(...values) { this._insert(values, false); }
    prepend(...values) { this._insert(values, false); }
    replaceChildren(...values) { this._insert(values, true); }
    before(...values) { if (this.parentNode) this.parentNode._insert(values, false); }
    after(...values) { if (this.parentNode) this.parentNode._insert(values, false); }
    replaceWith(...values) { if (this.parentNode) this.parentNode._insert(values, false); }
  }
  Object.defineProperty(Node.prototype, 'textContent', {
    configurable: true,
    get() { return this._textContent; },
    set(value) { this._textContent = value; },
  });

  class Element extends Node {
    constructor(tagName) {
      super(1);
      this.tagName = String(tagName || 'DIV').toUpperCase();
      this.attrs = {};
      this._innerHTML = '';
      this._outerHTML = '';
    }
    setAttribute(name, value) {
      this.attrs[String(name)] = String(value);
      return undefined;
    }
    get attributes() {
      return Object.keys(this.attrs).map((name) => ({ name, value: this.attrs[name] }));
    }
    getAttribute(name) { return this.attrs[String(name)] || null; }
    insertAdjacentHTML(position, value) {
      this.lastPosition = position;
      this.lastAdjacentHTML = value;
      return undefined;
    }
    insertAdjacentElement(position, value) {
      this.lastPosition = position;
      this._insert([value], false);
      return value;
    }
    querySelectorAll(selector) {
      if (!/script/i.test(String(selector || ''))) return [];
      const out = [];
      const visit = (node) => {
        for (const child of (node && node.childNodes) || []) {
          if (String(child.tagName || '').toUpperCase() === 'SCRIPT') out.push(child);
          visit(child);
        }
      };
      visit(this);
      return out;
    }
  }
  Object.defineProperty(Element.prototype, 'innerHTML', {
    configurable: true,
    get() { return this._innerHTML; },
    set(value) { this._innerHTML = value; },
  });
  Object.defineProperty(Element.prototype, 'outerHTML', {
    configurable: true,
    get() { return this._outerHTML; },
    set(value) { this._outerHTML = value; },
  });

  class ShadowRoot extends Element {}
  class HTMLIFrameElement extends Element {}
  Object.defineProperty(HTMLIFrameElement.prototype, 'srcdoc', {
    configurable: true,
    get() { return this._srcdoc || ''; },
    set(value) { this._srcdoc = value; },
  });
  class HTMLScriptElement extends Element {
    constructor() { super('script'); this._src = ''; this._text = ''; }
  }
  Object.defineProperty(HTMLScriptElement.prototype, 'src', {
    configurable: true,
    get() { return this._src; },
    set(value) { this._src = value; },
  });
  Object.defineProperty(HTMLScriptElement.prototype, 'text', {
    configurable: true,
    get() { return this._text; },
    set(value) { this._text = value; },
  });
  class Range {
    constructor() { this.commonAncestorContainer = null; }
    createContextualFragment(value) { this.lastFragment = value; return { value }; }
    insertNode(value) {
      if (this.commonAncestorContainer) this.commonAncestorContainer._insert([value], false);
      return undefined;
    }
    surroundContents(value) {
      if (this.commonAncestorContainer) this.commonAncestorContainer._insert([value], false);
      return undefined;
    }
  }
  class DOMParser {
    parseFromString(value, type) {
      if (!opts.domParserScriptText) return { value, type, querySelectorAll() { return []; } };
      const parsed = new Document();
      const script = new HTMLScriptElement();
      script.textContent = opts.domParserScriptText;
      parsed.initialNodes = [script];
      parsed.childNodes = [script];
      return parsed;
    }
  }
  class MessageEvent {
    constructor(data, origin, target, source) {
      this._data = data;
      this._origin = origin || '';
      this.target = target || null;
      this.currentTarget = target || null;
      this.source = source || null;
    }
    get data() { return this._data; }
    get origin() { return this._origin; }
  }
  class Location {
    constructor(value) { this._href = new URL(value).href; }
    get href() { return this._href; }
    set href(value) { this._href = new URL(value, this._href).href; }
    get hostname() { return new URL(this._href).hostname; }
    get pathname() { return new URL(this._href).pathname; }
    get search() { return new URL(this._href).search; }
    get hash() { return new URL(this._href).hash; }
    get protocol() { return new URL(this._href).protocol; }
    assign(value) { this.href = value; return undefined; }
    replace(value) { this.href = value; return undefined; }
  }
  class History {
    pushState(_state, _unused, value) {
      this.lastUrl = value;
      if (value != null) location.href = value;
      return undefined;
    }
    replaceState(_state, _unused, value) {
      this.lastUrl = value;
      if (value != null) location.href = value;
      return undefined;
    }
  }
  class DocumentFragment extends Node {
    constructor(children) {
      super(11);
      this.childNodes = Array.isArray(children) ? children : [];
    }
  }
  class Document extends Node {
    constructor() {
      super(9);
      this.isConnected = true;
      this.readyState = 'complete';
      this.initialNodes = opts.initialNodes || [];
      this.referrer = opts.referrer || '';
    }
    addEventListener() {}
    querySelector(selector) {
      return opts.credential && /password/.test(selector) ? new Element('input') : null;
    }
    querySelectorAll() { return this.initialNodes; }
    write(...values) { this.lastWrite = values.join(''); return undefined; }
    writeln(...values) { this.lastWriteln = values.join(''); return undefined; }
  }
  class HTMLCanvasElement { toDataURL() { return 'data:,'; } toBlob() {} }
  class CanvasRenderingContext2D { getImageData() { return { data: [] }; } }
  class WebGLRenderingContext { getParameter() { return ''; } }
  class HTMLImageElement {}
  Object.defineProperty(HTMLImageElement.prototype, 'src', {
    configurable: true,
    get() { return this._src || ''; },
    set(value) { this._src = value; },
  });
  class XMLHttpRequest { open() {} }

  const document = new Document();
  const location = new Location(url.href);
  const history = new History();
  const navigation = {
    addEventListener(type, fn) {
      (navigationListeners[type] || (navigationListeners[type] = [])).push(fn);
    },
  };
  const nativeMessageDataGetter = Object.getOwnPropertyDescriptor(MessageEvent.prototype, 'data').get;
  const sandbox = {
    URL,
    Set,
    Map,
    Array,
    Object,
    String,
    Number,
    Math,
    JSON,
    RegExp,
    Promise,
    parseInt,
    decodeURIComponent,
    Date: { now: () => clock.now },
    Element,
    Node,
    ShadowRoot,
    HTMLIFrameElement,
    HTMLScriptElement,
    Range,
    DOMParser,
    MessageEvent,
    Location,
    History,
    Document,
    DocumentFragment,
    HTMLCanvasElement,
    CanvasRenderingContext2D,
    WebGLRenderingContext,
    WebGL2RenderingContext: null,
    HTMLImageElement,
    XMLHttpRequest,
    document,
    location,
    history,
    navigation,
    name: opts.windowName || '',
    navigator: { sendBeacon() { return true; } },
    performance: { getEntriesByType: () => [{ redirectCount: opts.redirectCount || 0 }] },
    getComputedStyle: () => ({ display: 'block', visibility: 'visible', opacity: '1' }),
    fetch: () => Promise.resolve({ ok: true }),
    setTimeout(fn) { timers.push(fn); return timers.length; },
    setInterval(fn) { intervals.push(fn); return intervals.length; },
    clearTimeout() {},
    open(value) { sandbox.lastOpened = String(value); return { location: value }; },
    regDomain: (host) => String(host || '').replace(/^www\./, '').toLowerCase(),
    log(type, detail) { logs.push({ type, detail }); },
    __woBackgroundRequest(message, callback) { ageRequests.push({ message, callback }); },
    WO: {
      behavioralScan: opts.behavioralScan !== false,
      fingerprintProbeDetection: false,
      xssBehaviorGuard: opts.enabled !== false,
      grabberDomains: opts.grabberDomains || [],
      __pageRisk: opts.pageRisk || undefined,
    },
  };
  sandbox.window = sandbox;
  sandbox.window.addEventListener = (type, fn) => {
    (listeners[type] || (listeners[type] = [])).push(fn);
  };
  vm.createContext(sandbox);
  installEngineAmbient(sandbox);
  vm.runInContext(HELPERS + ';' + SCANNER, sandbox, {
    filename: 'content.min.js:xss-behavior-guard',
  });
  assert(!sandbox.__scanError, 'scanner threw: ' + (sandbox.__scanError && sandbox.__scanError.stack));

  (opts.messages || []).forEach((data, index) => {
    const configuredOrigin = Array.isArray(opts.messageOrigins) ? opts.messageOrigins[index] : opts.messageOrigin;
    const windowMessage = opts.windowMessage !== false;
    const event = new MessageEvent(
      data,
      configuredOrigin == null ? 'https://attacker.example' : configuredOrigin,
      windowMessage ? sandbox : { kind: 'worker' },
      windowMessage ? { postMessage() {} } : null,
    );
    if (opts.readMessageOrigin) void event.origin;
    if (opts.internalMessageRead) void nativeMessageDataGetter.call(event);
    if (opts.readMessageData !== false) void event.data;
    if (opts.readMessageOriginAfterData) void event.origin;
    for (const listener of (listeners.message || [])) listener(event);
  });
  clock.now += Math.max(0, Number(opts.advanceBeforeSinkMs) || 0);
  if (opts.navigateBeforeSink) location.href = opts.navigateBeforeSink;
  if (opts.pushStateBeforeSink) history.pushState({}, '', opts.pushStateBeforeSink);
  const evalResult = vm.runInContext('(function(){const lexicalEvalValue=23;return eval("lexicalEvalValue")})()', sandbox);

  let sinkResult;
  let sinkError = null;
  const repetitions = Math.max(1, Number(opts.repeatSink) || 1);
  for (let i = 0; i < repetitions; i++) {
    if (opts.sink === 'innerHTML') {
      const element = new Element(opts.sinkTag || 'div');
      element.isConnected = opts.sinkConnected !== false;
      element.innerHTML = opts.sinkValue;
      sinkResult = element.innerHTML;
    } else if (opts.sink === 'setAttribute') {
      const element = new Element(opts.sinkTag || 'img');
      element.isConnected = opts.sinkConnected !== false;
      element.setAttribute(opts.attribute || 'onerror', opts.sinkValue);
      sinkResult = element.getAttribute(opts.attribute || 'onerror');
    } else if (opts.sink === 'document.write') {
      document.write(opts.sinkValue);
      sinkResult = document.lastWrite;
    } else if (opts.sink === 'Function') {
      sandbox.__xssSinkBody = opts.sinkValue;
      sinkResult = vm.runInContext('Function(__xssSinkBody)()', sandbox);
    } else if (opts.sink === 'new Function') {
      sandbox.__xssSinkBody = opts.sinkValue;
      sinkResult = vm.runInContext('(new Function(__xssSinkBody))()', sandbox);
    } else if (opts.sink === 'invalid Function') {
      sandbox.__xssSinkBody = opts.sinkValue;
      try {
        vm.runInContext('Function(__xssSinkBody)', sandbox);
      } catch (error) {
        sinkError = error && error.name;
      }
    } else if (opts.sink === 'Function constructor alias') {
      sandbox.__xssSinkBody = opts.sinkValue;
      sinkResult = vm.runInContext('(function(){}).constructor(__xssSinkBody)()', sandbox);
    } else if (opts.sink === 'setTimeout') {
      sinkResult = sandbox.setTimeout(opts.sinkValue, 0);
    } else if (opts.sink === 'setInterval') {
      sinkResult = sandbox.setInterval(opts.sinkValue, 1000);
    } else if (opts.sink === 'navigation.navigate') {
      const event = {
        isTrusted: opts.navigationTrusted !== false,
        navigationType: opts.navigationType || 'push',
        downloadRequest: opts.navigationDownload ? 'download.bin' : null,
        destination: {
          url: String(opts.sinkValue),
          sameDocument: !!opts.navigationSameDocument,
        },
      };
      for (const listener of (navigationListeners.navigate || [])) listener(event);
      location.assign(opts.sinkValue);
      sinkResult = location.href;
    } else if (opts.sink === 'location.assign') {
      location.assign(opts.sinkValue);
      sinkResult = location.href;
    } else if (opts.sink === 'location.href') {
      location.href = opts.sinkValue;
      sinkResult = location.href;
    } else if (opts.sink === 'window.open') {
      sandbox.open(opts.sinkValue);
      sinkResult = sandbox.lastOpened;
    } else if (opts.sink === 'script.src') {
      const script = new HTMLScriptElement();
      script.isConnected = opts.sinkConnected !== false;
      script.src = opts.sinkValue;
      sinkResult = script.src;
    } else if (opts.sink === 'script.textContent') {
      const script = new HTMLScriptElement();
      script.isConnected = opts.sinkConnected !== false;
      script.textContent = opts.sinkValue;
      sinkResult = script.textContent;
    } else if (opts.sink === 'script.setAttribute') {
      const script = new HTMLScriptElement();
      script.isConnected = opts.sinkConnected !== false;
      script.setAttribute('src', opts.sinkValue);
      sinkResult = script.getAttribute('src');
    } else if (opts.sink === 'history.replaceState') {
      history.replaceState({}, '', opts.sinkValue);
      sinkResult = history.lastUrl;
    } else if (opts.sink === 'DOMParser.parseFromString') {
      sinkResult = new DOMParser().parseFromString(opts.sinkValue, 'text/html');
    } else if (opts.sink === 'DOMParser.insertScript') {
      const parsed = new DOMParser().parseFromString(opts.sinkValue, 'text/html');
      const target = new Element('div');
      target.isConnected = true;
      const script = parsed.initialNodes[0];
      target.appendChild(script);
      sinkResult = script;
    } else if (opts.sink === 'DOMParser.scriptText' || opts.sink === 'DOMParser.scriptSrc') {
      const parsed = new DOMParser().parseFromString('<script></script>', 'text/html');
      const target = new Element('div');
      target.isConnected = true;
      const script = parsed.initialNodes[0];
      target.appendChild(script);
      if (opts.sink === 'DOMParser.scriptText') script.textContent = opts.sinkValue;
      else script.src = opts.sinkValue;
      sinkResult = opts.sink === 'DOMParser.scriptText' ? script.textContent : script.src;
    } else if (['appendChild', 'appendFragment', 'shadow.appendChild',
      'Range.insertNode', 'failed appendChild'].includes(opts.sink)) {
      const target = opts.sink === 'shadow.appendChild' ? new ShadowRoot() : new Element('div');
      target.isConnected = opts.sinkConnected !== false;
      const inserted = new Element(opts.insertTag || 'img');
      inserted.noModule = !!opts.insertNoModule;
      for (const [name, value] of Object.entries(opts.insertAttributes || {})) {
        inserted.setAttribute(name, value);
      }
      if (opts.insertScriptText != null) inserted.textContent = opts.insertScriptText;
      inserted.isConnected = !!opts.insertWasConnected;
      const value = opts.sink === 'appendFragment'
        ? new DocumentFragment([inserted]) : inserted;
      try {
        if (opts.sink === 'Range.insertNode') {
          const range = new Range();
          range.commonAncestorContainer = target;
          range.insertNode(value);
        } else {
          target.appendChild(value);
        }
      } catch (error) {
        sinkError = error && error.name;
      }
      sinkResult = inserted;
    }
  }

  if (opts.secondSink === 'script.src') {
    const script = new HTMLScriptElement();
    script.isConnected = true;
    script.src = opts.secondSinkValue == null ? opts.sinkValue : opts.secondSinkValue;
  }

  for (const request of ageRequests) request.callback({ ok: true, ageDays: opts.ageDays == null ? 1000 : opts.ageDays });
  clock.now += 5000;
  while (timers.length) {
    const timer = timers.shift();
    if (typeof timer === 'function') timer();
  }

  return {
    risk: sandbox.WO.__pageRisk || null,
    warnings: logs.filter((entry) => entry.type === 'behavioral_risk'),
    activities: logs.filter((entry) => XSS_ACTIVITY_TYPES.has(entry.type)),
    logs,
    sinkResult,
    sinkError,
    evalResult,
    functionWrapped: !!(sandbox.Function && sandbox.Function.__wardenoneXssBehaviorGuard),
  };
}

const payload = '<img src=x onerror=alert(1)>';
const encoded = encodeURIComponent(payload);

{
  const result = run({ page: 'https://tools.example.org/search?q=' + encoded });
  assert.strictEqual(result.warnings.length, 0, 'URL evidence alone produced a warning');
  assert(result.risk && result.risk.behavioralScore === 15, 'URL evidence did not stay weak');
  assert(result.risk.behavioralReasons.some((reason) => /navigation URL/.test(reason)));
  console.log('ok - encoded URL payload is weak evidence, not proof');
}

{
  const result = run({
    page: 'https://tools.example.org/search?q=' + encoded,
    sink: 'innerHTML',
    sinkValue: payload,
  });
  assert.strictEqual(result.sinkResult, payload, 'native innerHTML behavior changed');
  assert.strictEqual(result.warnings.length, 1, 'exact DOM reflection did not warn');
  assert.strictEqual(result.warnings[0].detail.level, 'Suspicious');
  assert.strictEqual(result.warnings[0].detail.learningEligible, false,
    'XSS evidence alone became eligible for automatic blocklist learning');
  assert(/XSS Behavior Guard/.test(result.warnings[0].detail.why) && /not proof/.test(result.warnings[0].detail.why),
    'the warning does not explain its detection-only confidence');
  assert(result.risk.behavioralReasons.some((reason) => /sensitive sink/.test(reason)));
  assert.strictEqual(result.activities.length, 1, 'high-confidence flow did not reach Activity Center routing');
  assert.strictEqual(result.activities[0].type, 'warned_potential_dom_xss');
  assert.strictEqual(result.activities[0].detail.confidence, 'High');
  assert.strictEqual(result.activities[0].detail.severity, 'Medium');
  assert(/this page's URL query/.test(result.activities[0].detail.why) && /innerHTML/.test(result.activities[0].detail.why));
  assert(/not confirmed a vulnerability/.test(result.activities[0].detail.why));
  assert.strictEqual(result.activities[0].detail.outcome, 'Observed locally; no request or page action was blocked.');
  assert(!JSON.stringify(result.logs).includes('alert(1)'), 'raw payload leaked into a log');
  console.log('ok - DOM-XSS activity is specific, confidence-labelled, and payload-private');
}

{
  for (const sinkValue of [
    '<!-- <template> -->' + payload,
    '<textarea><template></textarea>' + payload,
    '<script>"<template>"</script>' + payload,
    '<i></i>'.repeat(32) + payload,
    'a'.repeat(33000) + payload,
  ]) {
    const result = run({
      page: 'https://tools.example.org/search?q=' + encoded,
      sink: 'innerHTML',
      sinkValue,
    });
    assert.strictEqual(result.activities.length, 1,
      'bounded HTML scanning allowed benign prefix content to hide executable reflection');
  }
  console.log('ok - comments, benign-tag floods, and long prefixes cannot hide active markup');
}

{
  const result = run({
    page: 'https://tools.example.org/search?q=' + encoded,
    sink: 'innerHTML',
    sinkValue: '<p>ordinary application markup</p>',
  });
  assert.strictEqual(result.warnings.length, 0, 'unrelated markup was treated as reflected XSS');
  assert(!result.risk.behavioralReasons.some((reason) => /sensitive sink/.test(reason)));
  console.log('ok - unrelated HTML writes are ignored');
}

{
  const escaped = '&lt;img src=x onerror=alert(1)&gt;';
  const result = run({
    page: 'https://tools.example.org/search?q=' + encoded,
    sink: 'innerHTML',
    sinkValue: '<pre>' + escaped + '</pre>',
  });
  assert.strictEqual(result.warnings.length, 0,
    'safely escaped XSS example text was treated as executable markup');
  assert.strictEqual(result.activities.length, 0);
  console.log('ok - escaped payload examples remain display text, not execution evidence');
}

{
  for (const sinkValue of [
    '<!-- ' + payload + ' -->',
    '<textarea>' + payload + '</textarea>',
    '<style>/* ' + payload + ' */</style>',
  ]) {
    const result = run({
      page: 'https://tools.example.org/search?q=' + encoded,
      sink: 'innerHTML',
      sinkValue,
    });
    assert.strictEqual(result.activities.length, 0,
      'markup inside an inert HTML parsing context was treated as executable');
  }
  console.log('ok - comments, textarea content, and style text remain inert');
}

{
  const fileName = 'quarterly-report-final.pdf';
  const result = run({
    page: 'https://upload.example.org/',
    messages: [fileName],
    sink: 'innerHTML',
    sinkValue: '<div class="upload-name">' + fileName
      + '</div><img src="/file-icon.svg" onerror="this.remove()">',
  });
  assert.strictEqual(result.warnings.length, 0,
    'an upload filename was correlated with an unrelated fallback event handler');
  assert.strictEqual(result.activities.length, 0);
  console.log('ok - upload labels do not inherit risk from unrelated executable markup');
}

{
  const workerValue = '<img src=x onerror=alert(1)>';
  const result = run({
    page: 'https://upload.example.org/',
    messages: [workerValue],
    messageOrigin: '',
    windowMessage: false,
    sink: 'innerHTML',
    sinkValue: workerValue,
  });
  assert.strictEqual(result.warnings.length, 0,
    'worker/message-channel data was treated as hostile cross-window postMessage input');
  assert.strictEqual(result.activities.length, 0);
  assert(!result.risk, 'non-window messaging added behavioral risk');
  console.log('ok - worker and message-channel traffic is outside cross-window postMessage scoring');
}

{
  const internalValue = '<img src=x onerror=alert(1)>';
  const result = run({
    page: 'https://app.example.org/',
    messages: [internalValue],
    internalMessageRead: true,
    readMessageData: false,
    sink: 'innerHTML',
    sinkValue: internalValue,
  });
  assert.strictEqual(result.activities.length, 0,
    "WardenOne's own bridge read registered page message data as application taint");
  assert.strictEqual(result.warnings.length, 0);
  console.log('ok - internal bridge message reads cannot self-taint the XSS guard');
}

{
  const route = 'releases/tag/v1.0';
  const result = run({
    page: 'https://github.com/iri-dev/WardenOne/releases/tag/v1.0',
    messages: [route],
    sink: 'innerHTML',
    sinkValue: '<span>' + route + '</span><img src="/fallback.png" onerror="this.remove()">',
  });
  assert.strictEqual(result.warnings.length, 0,
    'GitHub-style route state was linked to an unrelated image fallback');
  assert.strictEqual(result.activities.length, 0);
  console.log('ok - ordinary GitHub route rendering does not become DOM-XSS evidence');
}

{
  const example = '<img src=x onerror=this.remove()>';
  const result = run({
    page: 'https://github.com/search?q=' + encodeURIComponent(example),
    sink: 'innerHTML',
    sinkValue: '<pre>&lt;img src=x onerror=this.remove()&gt;</pre>'
      + '<img src="/missing" onerror="this.remove()">',
  });
  assert.strictEqual(result.activities.length, 0,
    'a generic fallback handler was detached from its source context and treated as causal XSS');
  assert.strictEqual(result.warnings.length, 0);
  console.log('ok - GitHub code examples do not correlate through unrelated generic fallback handlers');
}

{
  const result = run({
    page: 'https://app.example.org/',
    messages: ['undefined'],
    sink: 'innerHTML',
    sinkValue: '<img src="/fallback.png" onerror="window.fallback ??= undefined">',
  });
  assert.strictEqual(result.warnings.length, 0,
    'a short common message scalar was mistaken for causal executable input');
  assert.strictEqual(result.activities.length, 0);
  console.log('ok - common framework message scalars do not become XSS evidence');
}

{
  const route = 'ordinary-search-term';
  const target = '/issues?q=' + route;
  const result = run({
    page: 'https://github.com/iri-dev/WardenOne/issues?q=' + route,
    sink: 'history.replaceState',
    sinkValue: target,
  });
  assert.strictEqual(result.sinkResult, target, 'native SPA history update changed');
  assert.strictEqual(result.activities.length, 0, 'ordinary SPA history normalization was treated as XSS');
  assert.strictEqual(result.warnings.length, 0, 'GitHub SPA navigation produced a site warning');
  console.log('ok - SPA history updates are not executable XSS sinks');
}

{
  const routePayload = '<img src=x onerror=alert(1)>';
  const result = run({
    page: 'https://app.example.org/',
    pushStateBeforeSink: '/search?q=' + encodeURIComponent(routePayload),
    sink: 'innerHTML',
    sinkValue: routePayload,
  });
  assert.strictEqual(result.activities.length, 1,
    'a shaped URL added by pushState was not available to the later executable sink');
  assert.strictEqual(result.activities[0].type, 'warned_potential_dom_xss');
  console.log('ok - SPA route refresh installs correlation without scoring history itself');
}

{
  const eventPayload = 'onerror=alert(1)';
  const result = run({
    page: 'https://tools.example.org/?value=' + encodeURIComponent('<img ' + eventPayload + '>'),
    sink: 'setAttribute',
    attribute: 'onerror',
    sinkValue: 'alert(1)',
  });
  assert.strictEqual(result.sinkResult, 'alert(1)', 'native setAttribute behavior changed');
  assert.strictEqual(result.warnings.length, 1, 'event-handler reflection was missed');
  console.log('ok - reflected event-handler attributes are correlated without blocking');
}

{
  const svgPayload = '<svg onload=confirm(1)>';
  const result = run({
    page: 'https://tools.example.org/?value=' + encodeURIComponent(encodeURIComponent(svgPayload)),
    sink: 'innerHTML',
    sinkValue: svgPayload,
  });
  assert.strictEqual(result.warnings.length, 1, 'double-encoded SVG payload was missed');
  console.log('ok - bounded repeated decoding catches double-encoded payloads');
}

{
  const padded = 'a'.repeat(5000) + payload;
  const result = run({
    page: 'https://tools.example.org/?value=' + encodeURIComponent(padded),
    sink: 'innerHTML',
    sinkValue: payload,
  });
  assert.strictEqual(result.activities.length, 1,
    'an executable payload beyond the first 4 KB of a URL value was missed');
  console.log('ok - bounded long URL values retain late executable payload extraction');
}

{
  const quoted = '<img src=x onerror="alert(\'quoted\')">';
  const result = run({
    page: 'https://tools.example.org/?value=' + encodeURIComponent(quoted),
    sink: 'setAttribute',
    attribute: 'onerror',
    sinkValue: "alert('quoted')",
  });
  assert.strictEqual(result.activities.length, 1,
    'quote-aware event-handler extraction lost nested JavaScript quotes');
  console.log('ok - quoted event-handler values preserve exact source correlation');
}

{
  const quoted = '<img src=x onerror="x>0&&alert(1)">';
  const result = run({
    page: 'https://tools.example.org/?value=' + encodeURIComponent(quoted),
    sink: 'setAttribute',
    attribute: 'onerror',
    sinkValue: 'x>0&&alert(1)',
  });
  assert.strictEqual(result.activities.length, 1,
    'a greater-than character inside a quoted handler truncated the HTML tag');
  console.log('ok - quoted greater-than characters do not truncate handler correlation');
}

{
  const scheme = 'javascript:alert(1)';
  const result = run({
    page: 'https://tools.example.org/?next=' + encodeURIComponent(scheme),
    sink: 'setAttribute',
    attribute: 'href',
    sinkValue: scheme,
  });
  assert.strictEqual(result.warnings.length, 1, 'reflected javascript: attribute was missed');
  console.log('ok - dangerous URL schemes reaching executable attributes are correlated');
}

{
  const scheme = 'data:text/html,<svg onload=alert(1)>';
  const result = run({
    page: 'https://tools.example.org/?frame=' + encodeURIComponent(scheme),
    sink: 'setAttribute',
    attribute: 'src',
    sinkValue: scheme,
  });
  assert.strictEqual(result.warnings.length, 1, 'reflected data:text/html attribute was missed');
  console.log('ok - data:text/html navigation values reaching executable attributes are correlated');
}

{
  const scriptPayload = '<script>confirm(1)</script>';
  const result = run({
    page: 'https://tools.example.org/?value=' + encodeURIComponent(scriptPayload),
    initialNodes: [{ tagName: 'SCRIPT', outerHTML: scriptPayload }],
  });
  assert.strictEqual(result.warnings.length, 1, 'initial server-reflected script was missed');
  console.log('ok - initial reflected markup is covered as well as DOM sinks');
}

{
  const handler = 'globalThis.compromised=1';
  const result = run({
    page: 'https://app.example.org/?callback=' + encodeURIComponent(handler),
    initialNodes: [{
      tagName: 'IMG',
      outerHTML: '<img src="fallback.png" onload="' + handler + '">',
    }],
  });
  assert.strictEqual(result.activities.length, 1,
    'a plain URL value reflected into an initial event handler was missed');
  assert.strictEqual(result.activities[0].detail.sink, 'initial reflected markup');
  console.log('ok - initial event-handler correlation does not require XSS-shaped URL text');
}

{
  const handler = 'globalThis.submitted=1';
  const dataScripts = Array.from({ length: 120 }, (_, index) => ({
    tagName: 'SCRIPT',
    type: 'application/json',
    outerHTML: '<script type="application/json">{"index":' + index + '}</script>',
  }));
  dataScripts.push({
    tagName: 'FORM',
    outerHTML: '<form onsubmit="' + handler + '"></form>',
  });
  const result = run({
    page: 'https://app.example.org/?callback=' + encodeURIComponent(handler),
    initialNodes: dataScripts,
  });
  assert.strictEqual(result.activities.length, 1,
    'data scripts exhausted initial scanning before a reflected onsubmit handler');
  assert(/"onsubmit"/.test(SOURCE) && /"oninput"/.test(SOURCE) && /"oncanplay"/.test(SOURCE),
    'initial scanning does not select broad event-handler families');
  console.log('ok - inert data scripts cannot hide broader initial event-handler reflection');
}

{
  const code = 'globalThis.legacyProbe=1';
  const result = run({
    page: 'https://app.example.org/?code=' + encodeURIComponent(code),
    initialNodes: [{
      tagName: 'SCRIPT',
      noModule: true,
      outerHTML: '<script nomodule>' + code + '</script>',
    }],
  });
  assert.strictEqual(result.activities.length, 0,
    'a nomodule script ignored by modern Chrome was treated as executable');
  console.log('ok - initial nomodule scripts remain inert in supported Chrome');
}

{
  const reflected = '<script>window.release="releases/tag/v1.0"</script>';
  const result = run({
    page: 'https://github.com/iri-dev/WardenOne/releases/tag/v1.0',
    messages: ['releases/tag/v1.0'],
    initialNodes: [{ tagName: 'SCRIPT', outerHTML: reflected }],
  });
  assert.strictEqual(result.activities.length, 0,
    'postMessage text was causally attributed to markup that existed before the message');
  assert(!result.risk || !result.risk.behavioralReasons.some((reason) => /initial reflected markup/.test(reason)),
    'pre-existing framework markup received a postMessage source-to-sink score');
  assert(HISTORY.includes('isImpossibleInitialXssFlow') &&
    HISTORY.includes("String(d.source || '').toLowerCase() === 'postmessage event.data'") &&
    HISTORY.includes("String(d.sink || '').toLowerCase() === 'initial reflected markup'"),
    'the known-impossible legacy Activity Center entry is still displayed');
  console.log('ok - postMessage data cannot be correlated backwards into initial page markup');
}

{
  const route = 'releases/tag/v1.0';
  const result = run({
    page: 'https://github.com/iri-dev/WardenOne/releases?route=' + encodeURIComponent(route),
    initialNodes: [{ tagName: 'SCRIPT', outerHTML: '<script>window.route="' + route + '"</script>' }],
  });
  assert.strictEqual(result.activities.length, 0,
    'ordinary navigation text embedded in framework state was treated as executable XSS input');
  assert.strictEqual(result.warnings.length, 0);
  console.log('ok - benign URL state inside executable script markup is not XSS evidence');
}

{
  const codeSearch = 'return 7';
  const result = run({
    page: 'https://github.com/search?q=' + encodeURIComponent(codeSearch),
    initialNodes: [{
      tagName: 'SCRIPT',
      outerHTML: '<script>window.__INITIAL_STATE__={"query":"' + codeSearch + '"}</script>',
    }],
  });
  assert.strictEqual(result.activities.length, 0,
    'quoted GitHub search text inside hydration state was treated as executable code');
  assert.strictEqual(result.warnings.length, 0);
  console.log('ok - code-search text in serialized page state is inert');
}

{
  const shapedState = '<img src=x onerror=alert(1)>';
  const result = run({
    page: 'https://github.com/search?q=' + encodeURIComponent(shapedState),
    initialNodes: [{
      tagName: 'SCRIPT',
      outerHTML: '<script>window.__INITIAL_STATE__={"query":"' + shapedState + '"}</script>',
    }],
  });
  assert.strictEqual(result.activities.length, 0,
    'XSS-shaped text safely quoted in executable hydration state was treated as running code');
  assert.strictEqual(result.warnings.length, 0);
  console.log('ok - shaped hydration strings remain data rather than executed reflection');
}

{
  const breakout = '";alert(1);//';
  const result = run({
    page: 'https://app.example.org/?q=' + encodeURIComponent(breakout),
    initialNodes: [{
      tagName: 'SCRIPT',
      outerHTML: '<script>window.query="' + breakout + '"</script>',
    }],
  });
  assert.strictEqual(result.activities.length, 1,
    'a URL value that broke out of a JavaScript string was missed');
  assert.strictEqual(result.activities[0].type, 'warned_potential_xss_code_execution');
  console.log('ok - actual JavaScript string breakouts remain detectable');
}

{
  const jsonPayload = '<img src=x onerror=alert(1)>';
  const result = run({
    page: 'https://app.example.org/?state=' + encodeURIComponent(jsonPayload),
    initialNodes: [{
      tagName: 'SCRIPT',
      type: 'application/json',
      outerHTML: '<script type="application/json">' + jsonPayload + '</script>',
    }],
  });
  assert.strictEqual(result.activities.length, 0,
    'non-executable JSON state script was treated as an execution sink');
  console.log('ok - JSON/import data scripts are excluded from initial executable markup checks');
}

{
  const result = run({
    page: 'https://research.example.org/docs/xss?example=' + encoded,
    ageDays: 1000,
  });
  assert.strictEqual(result.warnings.length, 0, 'documentation URL was warned about');
  assert(!result.risk, 'documentation URL text was scored without executable reflection');
  console.log('ok - documentation and security examples are not blindly scored');
}

{
  const result = run({
    page: 'https://developer.mozilla.org/docs/playground?code=' + encodeURIComponent('return 7'),
    sink: 'Function',
    sinkValue: 'return 7',
  });
  assert.strictEqual(result.sinkResult, 7, 'documentation playground Function behavior changed');
  assert.strictEqual(result.activities.length, 0,
    'intentional documentation playground code produced an XSS event');
  assert.strictEqual(result.warnings.length, 0);
  console.log('ok - intentional documentation playground execution stays compatible');
}

{
  const result = run({
    page: 'https://app.example.org/docs?code=' + encodeURIComponent('return 17'),
    sink: 'Function',
    sinkValue: 'return 17',
  });
  assert.strictEqual(result.sinkResult, 17);
  assert.strictEqual(result.activities.length, 1,
    'an arbitrary /docs path disabled exact source-to-code correlation');
  console.log('ok - untrusted sites cannot evade exact correlation with a documentation path');
}

{
  const code = 'globalThis.compromised=1';
  const result = run({
    page: 'https://github.com/iri-dev/WardenOne?code=' + encodeURIComponent(code),
    sink: 'Function',
    sinkValue: code,
  });
  assert.strictEqual(result.activities.length, 1,
    'reputable-site status suppressed an exact non-benign source-to-code flow');
  console.log('ok - reputable sites are not blanket documentation exemptions for exact code flow');
}

{
  const result = run({
    page: 'https://github.com/iri-dev/WardenOne/issues?q=' + encoded,
    sink: 'innerHTML',
    sinkValue: payload,
  });
  assert.strictEqual(result.warnings.length, 1,
    'reputable-site compatibility exemption hid an exact executable reflection');
  assert.strictEqual(result.risk.behavioralScore, 60,
    'reputable site received URL-only or unrelated baseline points');
  console.log('ok - reputable sites suppress weak URL scoring, not exact reflection evidence');
}

{
  const result = run({
    page: 'https://app.example.org/?markup=' + encoded,
    navigateBeforeSink: 'https://app.example.org/dashboard',
    sink: 'innerHTML',
    sinkValue: payload,
  });
  assert.strictEqual(result.activities.length, 0,
    'a previous SPA location remained eligible after the URL changed');
  assert.strictEqual(result.warnings.length, 0);
  console.log('ok - stale location candidates are removed on SPA URL changes');
}

{
  const result = run({
    page: 'https://new-login.example.org/?q=' + encoded,
    ageDays: 3,
    redirectCount: 2,
  });
  assert.strictEqual(result.warnings.length, 1, 'correlated new-domain redirect risk did not warn');
  assert(result.risk.behavioralScore >= 60, 'correlated signals were not strengthened');
  assert.strictEqual(result.warnings[0].detail.learningEligible, false,
    'XSS points pushed otherwise-subthreshold evidence into automatic learning');
  assert(!result.risk.behavioralReasons.some((reason) => /sensitive sink/.test(reason)),
    'URL-only combination was mislabeled as sink execution');
  console.log('ok - URL evidence gains weight through the existing domain and redirect scorer');
}

{
  const result = run({
    page: 'https://login-check.example.org/?q=' + encoded,
    pageRisk: { phishing: true },
    credential: true,
  });
  assert.strictEqual(result.warnings.length, 1, 'deceptive credential-page correlation did not warn');
  assert(result.risk.behavioralReasons.some((reason) => /deceptive look-alike page/.test(reason)));
  assert(result.risk.behavioralReasons.some((reason) => /requesting credentials/.test(reason)));
  assert(!result.risk.behavioralReasons.some((reason) => /sensitive sink/.test(reason)),
    'phishing correlation was mislabeled as observed sink execution');
  console.log('ok - deceptive login context strengthens URL evidence without claiming execution');
}

{
  const result = run({
    page: 'https://tools.example.org/?code=' + encodeURIComponent('return 7'),
    sink: 'Function',
    sinkValue: 'return 7',
    repeatSink: 4,
  });
  assert.strictEqual(result.sinkResult, 7, 'Function constructor behavior changed');
  assert.strictEqual(result.warnings.length, 1, 'URL-to-Function flow did not raise behavioral risk');
  assert.strictEqual(result.functionWrapped, true, 'dynamic-code instrumentation was not installed for a tracked source');
  assert.strictEqual(result.activities.length, 1, 'repeated identical flow flooded Activity Center');
  assert.strictEqual(result.risk.behavioralScore, 65, 'one repeated code sink accumulated risk repeatedly');
  assert.strictEqual(result.activities[0].type, 'warned_potential_xss_code_execution');
  assert.strictEqual(result.activities[0].detail.source, 'location.search');
  assert.strictEqual(result.activities[0].detail.sink, 'Function constructor');
  assert(/compile or execute strings/.test(result.activities[0].detail.why));
  assert(!JSON.stringify(result.logs).includes('return 7'), 'dynamic-code payload leaked into a log');
  console.log('ok - URL-to-Function correlation preserves execution and deduplicates activity');
}

{
  const result = run({
    page: 'https://tools.example.org/',
    windowName: payload,
    sink: 'innerHTML',
    sinkValue: payload,
  });
  assert.strictEqual(result.warnings.length, 1, 'window.name-to-HTML flow was missed');
  assert.strictEqual(result.activities[0].detail.source, 'window.name');
  assert.strictEqual(result.risk.behavioralScore, 60, 'window.name was incorrectly given URL-only points');
  console.log('ok - window.name is correlated without being scored merely for existing');
}

{
  const result = run({
    page: 'https://tools.example.org/',
    referrer: 'https://sender.example/?markup=' + encoded,
    sink: 'document.write',
    sinkValue: payload,
  });
  assert.strictEqual(result.warnings.length, 1, 'referrer-to-document.write flow was missed');
  assert.strictEqual(result.activities[0].detail.source, 'document.referrer');
  console.log('ok - referrer parameters are bounded sources for HTML sinks');
}

{
  const result = run({
    page: 'https://tools.example.org/',
    messages: [{ command: 'return 11' }],
    sink: 'new Function',
    sinkValue: 'return 11',
  });
  assert.strictEqual(result.sinkResult, 11, 'new Function behavior changed');
  assert.strictEqual(result.warnings.length, 1, 'postMessage-to-Function flow was missed');
  assert.strictEqual(result.activities[0].detail.source, 'postMessage event.data');
  console.log('ok - postMessage event.data is captured before dynamic code construction');
}

{
  const result = run({
    page: 'https://tools.example.org/',
    messages: ['harmless-message-data'],
  });
  assert(result.risk && result.risk.behavioralScore === 5,
    'missing cross-origin origin access was not kept to a weak five-point signal');
  assert.strictEqual(result.warnings.length, 0, 'weak message-origin evidence warned by itself');
  assert.strictEqual(result.activities.length, 0, 'weak message-origin evidence entered Activity Center');
  console.log('ok - missing runtime origin access is weak supporting evidence only');
}

{
  const result = run({
    page: 'https://tools.example.org/',
    messages: ['harmless-message-data'],
    readMessageOriginAfterData: true,
  });
  assert(!result.risk, 'origin access in a helper/later path was treated as absent');
  console.log('ok - origin access anywhere on the same event suppresses the weak signal');
}

{
  const result = run({
    page: 'https://tools.example.org/',
    messages: ['harmless-message-data'],
    messageOrigin: 'https://tools.example.org',
  });
  assert(!result.risk, 'same-origin message traffic was treated as attacker-controlled');
  console.log('ok - same-origin messages do not create cross-origin suspicion');
}

{
  const result = run({
    page: 'https://tools.example.org/',
    messages: [payload],
    messageOrigin: 'https://tools.example.org',
    sink: 'innerHTML',
    sinkValue: payload,
  });
  assert.strictEqual(result.activities.length, 0,
    'trusted same-origin framework HTML was registered as attacker-controlled data');
  assert.strictEqual(result.warnings.length, 0);
  assert(!result.risk, 'same-origin message rendering added behavioral risk');
  console.log('ok - same-origin framework rendering is not mislabeled as attacker-controlled XSS');
}

{
  const result = run({
    page: 'https://victim.github.io/app',
    messages: ['harmless-message-data'],
    messageOrigin: 'https://attacker.github.io',
  });
  assert(result.risk && result.risk.behavioralScore === 5,
    'separate github.io tenants were treated as one trusted site');
  assert.strictEqual(result.warnings.length, 0);
  console.log('ok - shared-hosting tenants retain separate postMessage trust boundaries');
}

{
  const uploadTarget = 'https://github.com/iri-dev/WardenOne/releases/new';
  const result = run({
    page: 'https://github.com/iri-dev/WardenOne/releases/new',
    messages: [uploadTarget],
    messageOrigin: 'https://uploads.github.com',
    sink: 'window.open',
    sinkValue: uploadTarget,
  });
  assert.strictEqual(result.activities.length, 0,
    'same-site GitHub upload messaging was treated as attacker-controlled navigation');
  assert.strictEqual(result.warnings.length, 0);
  assert(!result.risk, 'same-site upload traffic added behavioral risk');
  console.log('ok - same-site upload messaging keeps first-party compatibility');
}

{
  const uploadTarget = 'https://files.example-cdn.test/result/complete';
  const result = run({
    page: 'https://upload.example.org/',
    messages: [uploadTarget],
    readMessageOrigin: true,
    sink: 'window.open',
    sinkValue: uploadTarget,
  });
  assert.strictEqual(result.activities.length, 0,
    'origin-checked upload navigation was promoted to an XSS signal');
  assert.strictEqual(result.warnings.length, 0);
  console.log('ok - origin-checked cross-site upload navigation does not warn');
}

{
  const stale = '<img src=x onerror=alert(1)>';
  const result = run({
    page: 'https://app.example.org/',
    messages: [stale],
    readMessageOrigin: true,
    advanceBeforeSinkMs: 11000,
    sink: 'innerHTML',
    sinkValue: stale,
  });
  assert.strictEqual(result.activities.length, 0, 'stale message text was treated as a fresh causal flow');
  assert.strictEqual(result.warnings.length, 0);
  console.log('ok - cross-window source evidence expires before unrelated later rendering');
}

{
  const result = run({
    page: 'https://tools.example.org/',
    messages: [payload],
    readMessageOrigin: true,
    sink: 'innerHTML',
    sinkValue: payload,
  });
  assert.strictEqual(result.warnings.length, 1, 'origin property access incorrectly made a dangerous flow safe');
  assert.strictEqual(result.risk.behavioralScore, 60,
    'origin access changed the weight of an actually correlated HTML flow');
  assert.strictEqual(result.activities[0].detail.source, 'postMessage event.data');
  console.log('ok - reading event.origin does not excuse data that reaches an HTML sink');
}

{
  const target = 'https://attacker.example/landing?access_token=SUPERSECRET#account';
  const result = run({
    page: 'https://tools.example.org/',
    messages: [target],
    sink: 'navigation.navigate',
    sinkValue: target,
  });
  assert.strictEqual(result.sinkResult, target, 'passive Navigation API observation changed navigation');
  assert.strictEqual(result.warnings.length, 0,
    'supporting navigation evidence was promoted to a hard XSS/site warning');
  assert.strictEqual(result.activities.length, 0,
    'ordinary upload/OAuth-style http navigation was presented as an XSS finding');
  assert.strictEqual(result.risk.behavioralScore, 15,
    'navigation correlation was not kept to supporting evidence');
  assert(!/landing|SUPERSECRET|access_token|#account/.test(JSON.stringify(result.logs)),
    'navigation URL or token leaked into an Activity Center event');
  console.log('ok - ordinary message-driven navigation stays weak internal evidence only');
}

{
  for (const variant of [
    { navigationTrusted: false },
    { navigationDownload: true },
    { navigationSameDocument: true },
    { navigationType: 'reload' },
    { navigationType: 'traverse' },
  ]) {
    const target = 'https://attacker.example/ordinary-upload-complete';
    const result = run(Object.assign({
      page: 'https://tools.example.org/',
      messages: [target],
      sink: 'navigation.navigate',
      sinkValue: target,
    }, variant));
    assert.strictEqual(result.activities.length, 0,
      'an ignored Navigation API event produced XSS activity');
    assert.strictEqual(result.risk.behavioralScore, 5,
      'ignored navigation added more than the independent weak origin signal');
  }
  console.log('ok - synthetic, download, same-document, reload, and traverse navigation stays ignored');
}

{
  const inert = '<img src=x onerror=alert(1)>';
  const result = run({
    page: 'https://tools.example.org/?template=' + encodeURIComponent(inert),
    sink: 'DOMParser.parseFromString',
    sinkValue: inert,
  });
  assert(result.sinkResult && result.sinkResult.value === inert, 'native DOMParser behavior changed');
  assert.strictEqual(result.activities.length, 0, 'inert DOM parsing was treated as execution');
  assert.strictEqual(result.warnings.length, 0, 'inert DOM parsing produced a site warning');
  console.log('ok - inert DOM parsing is not an execution sink');
}

{
  const inert = '<img src=x onerror=alert(1)>';
  const jsonScript = '<script type="application/json">' + inert + '</script>';
  const result = run({
    page: 'https://app.example.org/?state=' + encodeURIComponent(inert),
    sink: 'innerHTML',
    sinkValue: jsonScript,
  });
  assert.strictEqual(result.activities.length, 0,
    'runtime application/json state was treated as executable script content');
  console.log('ok - runtime data-script content remains inert');
}

{
  const inert = '<img src=x onerror=alert(1)>';
  const result = run({
    page: 'https://app.example.org/?template=' + encodeURIComponent(inert),
    sink: 'innerHTML',
    sinkTag: 'template',
    sinkValue: inert,
  });
  assert.strictEqual(result.activities.length, 0,
    'template.innerHTML was treated as immediate DOM execution');
  console.log('ok - template HTML remains inert until a separate insertion sink');
}

{
  const code = 'alert(1)';
  const result = run({
    page: 'https://app.example.org/?code=' + encodeURIComponent(code),
    sink: 'innerHTML',
    sinkValue: '<script>' + code + '</script>',
  });
  assert.strictEqual(result.activities.length, 0,
    'an inert script created through innerHTML was treated as executed');
  console.log('ok - HTML-string script elements remain inert');
}

{
  const code = 'alert(1)';
  const result = run({
    page: 'https://app.example.org/?code=' + encodeURIComponent(code),
    sink: 'document.write',
    sinkValue: '<script>' + code + '</script>',
  });
  assert.strictEqual(result.activities.length, 1,
    'parser-executed document.write script content was missed');
  console.log('ok - document.write keeps executable script-body correlation');
}

{
  const inert = '<img src=x onerror=alert(1)>';
  const result = run({
    page: 'https://app.example.org/?template=' + encodeURIComponent(inert),
    sink: 'innerHTML',
    sinkValue: inert,
    sinkConnected: false,
  });
  assert.strictEqual(result.activities.length, 0,
    'detached innerHTML construction was treated as live execution');
  assert.strictEqual(result.warnings.length, 0);
  console.log('ok - detached HTML construction remains inert until connected');
}

{
  const inert = '<img src=x onerror=alert(1)>';
  const result = run({
    page: 'https://app.example.org/?template=' + encodeURIComponent(inert),
    sink: 'appendFragment',
    insertAttributes: { onerror: 'alert(1)' },
  });
  assert.strictEqual(result.activities.length, 1,
    'template/fragment content was not correlated when activated in the live DOM');
  assert.strictEqual(result.activities[0].detail.sink, 'DOM insertion');
  assert.strictEqual(result.activities[0].type, 'warned_potential_dom_xss');
  console.log('ok - deferred fragment content is evaluated at its live insertion boundary');
}

{
  const code = 'alert(1)';
  const result = run({
    page: 'https://app.example.org/?code=' + encodeURIComponent(code),
    sink: 'appendChild',
    insertTag: 'script',
    insertScriptText: code,
  });
  assert.strictEqual(result.activities.length, 1,
    'a programmatic executable script insertion was missed');
  assert.strictEqual(result.activities[0].type, 'warned_potential_xss_script_injection');
  console.log('ok - programmatic script insertion remains a strong executable sink');
}

{
  const code = 'alert(1)';
  const result = run({
    page: 'https://app.example.org/?code=' + encodeURIComponent(code),
    sink: 'appendChild',
    insertTag: 'script',
    insertNoModule: true,
    insertScriptText: code,
  });
  assert.strictEqual(result.activities.length, 0,
    'a dynamically inserted nomodule script was treated as executable');
  console.log('ok - dynamic nomodule scripts remain inert in supported Chrome');
}

{
  const code = 'alert(1)';
  const result = run({
    page: 'https://app.example.org/?code=' + encodeURIComponent(code),
    sink: 'appendChild',
    insertTag: 'script',
    insertScriptText: code,
    selfRemoveInsertedScript: true,
  });
  assert.strictEqual(result.activities.length, 1,
    'a synchronously executing self-removing script erased insertion evidence');
  console.log('ok - synchronous script activation is snapshotted before native insertion returns');
}

{
  const code = 'alert(1)';
  const result = run({
    page: 'https://app.example.org/?code=' + encodeURIComponent(code),
    sink: 'DOMParser.insertScript',
    sinkValue: '<script>' + code + '</script>',
    domParserScriptText: code,
  });
  assert.strictEqual(result.activities.length, 0,
    'a DOMParser-created inert script was treated as executable after adoption');
  console.log('ok - DOMParser script provenance remains inert after insertion');
}

{
  const code = 'globalThis.inertParserState=1';
  for (const sink of ['DOMParser.scriptText', 'DOMParser.scriptSrc']) {
    const sinkValue = sink.endsWith('Src') ? 'https://attacker.example/inert.js' : code;
    const result = run({
      page: 'https://app.example.org/?value=' + encodeURIComponent(sinkValue),
      sink,
      sinkValue,
      domParserScriptText: '/* inert parser script */',
    });
    assert.strictEqual(result.activities.length, 0,
      'a later property write made a DOMParser-inert script look executable');
  }
  console.log('ok - inert parser scripts remain inert across later src and text writes');
}

{
  const inert = '<img src=x onerror=alert(1)>';
  const result = run({
    page: 'https://app.example.org/?template=' + encodeURIComponent(inert),
    sink: 'appendChild',
    insertTag: 'template',
  });
  assert.strictEqual(result.activities.length, 0,
    'inserting a template element activated its inert contents');
  console.log('ok - inserting a template element remains inert');
}

{
  const inert = '<img src=x onerror=alert(1)>';
  const result = run({
    page: 'https://app.example.org/?template=' + encodeURIComponent(inert),
    sink: 'shadow.appendChild',
    insertAttributes: { onerror: 'alert(1)' },
  });
  assert.strictEqual(result.activities.length, 1,
    'connected shadow-root insertion was not treated as live DOM');
  console.log('ok - connected shadow-root insertion retains correlation');
}

{
  const inert = '<img src=x onerror=alert(1)>';
  const result = run({
    page: 'https://app.example.org/?template=' + encodeURIComponent(inert),
    sink: 'Range.insertNode',
    insertAttributes: { onerror: 'alert(1)' },
  });
  assert.strictEqual(result.activities.length, 1,
    'Range insertion into live DOM was missed');
  console.log('ok - Range parsing stays inert while Range insertion is observed');
}

{
  const inert = '<img src=x onerror=alert(1)>';
  const result = run({
    page: 'https://app.example.org/?template=' + encodeURIComponent(inert),
    sink: 'appendChild',
    insertWasConnected: true,
    insertAttributes: { onerror: 'alert(1)' },
  });
  assert.strictEqual(result.activities.length, 0,
    'reordering an already-connected node manufactured a new activation');
  console.log('ok - connected-node reordering does not create a new XSS flow');
}

{
  const inert = '<img src=x onerror=alert(1)>';
  const result = run({
    page: 'https://app.example.org/?template=' + encodeURIComponent(inert),
    sink: 'failed appendChild',
    throwInsertion: true,
    insertAttributes: { onerror: 'alert(1)' },
  });
  assert.strictEqual(result.sinkError, 'TypeError');
  assert.strictEqual(result.activities.length, 0,
    'a rejected native insertion produced an XSS finding');
  console.log('ok - failed native insertion preserves its exception without warning');
}

{
  const inert = '<img src=x onerror=alert(1)>';
  const result = run({
    page: 'https://app.example.org/?template=' + encodeURIComponent(inert),
    sink: 'appendChild',
    sinkConnected: false,
    insertAttributes: { onerror: 'alert(1)' },
  });
  assert.strictEqual(result.activities.length, 0,
    'insertion into a detached subtree was treated as activation');
  console.log('ok - detached subtree insertion stays quiet until the subtree is connected');
}

{
  const inert = '<img src=x onerror=alert(1)>';
  const result = run({
    page: 'https://app.example.org/?template=' + encodeURIComponent(inert),
    sink: 'appendFragment',
    insertAttributes: { alt: 'sanitized image' },
  });
  assert.strictEqual(result.activities.length, 0,
    'sanitized fragment content retained stale dangerous-sink evidence');
  console.log('ok - sanitizing before insertion prevents stale XSS correlation');
}

{
  const scriptUrl = 'https://attacker.example/payload.js';
  const result = run({
    page: 'https://tools.example.org/',
    messages: [scriptUrl],
    sink: 'script.src',
    sinkValue: scriptUrl,
  });
  assert.strictEqual(result.sinkResult, scriptUrl, 'native script.src behavior changed');
  assert.strictEqual(result.warnings.length, 1, 'cross-origin message-to-script flow was missed');
  assert.strictEqual(result.activities[0].type, 'warned_potential_xss_script_injection');
  assert.strictEqual(result.activities[0].detail.category, 'script');
  assert.strictEqual(result.activities[0].detail.confidence, 'Very high');
  assert.strictEqual(result.activities[0].detail.severity, 'High');
  assert(/script creation or loading/.test(result.activities[0].detail.why));
  assert.strictEqual(result.risk.behavioralScore, 80,
    'script correlation did not receive very-strong weighting plus weak origin evidence');
  console.log('ok - untrusted message data selecting a script receives very-strong weight');
}

{
  const shapedState = '<img src=x onerror=alert(1)>';
  const result = run({
    page: 'https://app.example.org/?q=' + encodeURIComponent(shapedState),
    sink: 'script.textContent',
    sinkValue: 'window.state={"q":"' + shapedState + '"}',
  });
  assert.strictEqual(result.activities.length, 0,
    'safely quoted state in a dynamic script was treated as executable input');
  console.log('ok - dynamic script state strings do not masquerade as code flow');
}

{
  const breakout = '";alert(1);//';
  const result = run({
    page: 'https://app.example.org/?q=' + encodeURIComponent(breakout),
    sink: 'script.textContent',
    sinkValue: 'window.query="' + breakout + '"',
  });
  assert.strictEqual(result.activities.length, 1,
    'a dynamic script string breakout was hidden with safe hydration state');
  assert.strictEqual(result.activities[0].type, 'warned_potential_xss_script_injection');
  console.log('ok - dynamic script breakouts retain high-confidence detection');
}

{
  const scriptUrl = 'https://attacker.example/payload.js';
  const result = run({
    page: 'https://tools.example.org/',
    messages: [scriptUrl],
    sink: 'navigation.navigate',
    sinkValue: scriptUrl,
    secondSink: 'script.src',
    secondSinkValue: scriptUrl,
  });
  assert(!result.activities.some((entry) => entry.type === 'warned_potential_xss_navigation'),
    'ordinary navigation was shown as XSS before stronger evidence arrived');
  assert(result.activities.some((entry) => entry.type === 'warned_potential_xss_script_injection'),
    'later critical script event was discarded by Activity rate limiting');
  console.log('ok - later high-confidence evidence is not hidden by an earlier weak event');
}

{
  const result = run({
    page: 'https://new-login.xyz/?q=' + encoded,
    sink: 'innerHTML',
    sinkValue: payload,
    ageDays: 3,
    redirectCount: 2,
  });
  const strongest = result.warnings[result.warnings.length - 1];
  assert(result.risk.behavioralScore >= 130, 'very-strong combined risk did not reach Dangerous');
  assert.strictEqual(strongest.detail.learningEligible, false,
    'XSS-influenced heuristics learned a domain without 100 independent points');
  assert(strongest.detail.independentEvidenceScore < 100,
    'test did not exercise the strengthened independent-evidence threshold');
  console.log('ok - even Dangerous XSS-heavy combinations require stronger independent evidence to learn');
}

{
  const result = run({
    page: 'https://tools.example.org/?code=' + encodeURIComponent('return 13'),
    sink: 'Function constructor alias',
    sinkValue: 'return 13',
  });
  assert.strictEqual(result.sinkResult, 13, 'Function.prototype.constructor behavior changed');
  assert.strictEqual(result.activities[0].detail.sink, 'Function constructor');
  console.log('ok - Function constructor aliases retain behavior and correlation coverage');
}

{
  const invalid = 'return ) invalid';
  const result = run({
    page: 'https://tools.example.org/?code=' + encodeURIComponent(invalid),
    sink: 'invalid Function',
    sinkValue: invalid,
  });
  assert.strictEqual(result.sinkError, 'SyntaxError', 'native Function syntax failure changed');
  assert.strictEqual(result.activities.length, 0,
    'code rejected by the Function constructor was reported as executed');
  assert.strictEqual(result.warnings.length, 0);
  console.log('ok - failed Function compilation preserves its error without an XSS finding');
}

{
  const result = run({
    page: 'https://tools.example.org/#markup=' + encoded,
    sink: 'innerHTML',
    sinkValue: payload,
  });
  assert.strictEqual(result.warnings.length, 1, 'location.hash-to-HTML flow was missed');
  assert.strictEqual(result.activities[0].detail.source, 'location.hash');
  console.log('ok - decoded hash values participate in exact source-to-sink correlation');
}

{
  const code = 'globalThis.timerProbe=1';
  const result = run({
    page: 'https://tools.example.org/?later=' + encodeURIComponent(code),
    sink: 'setTimeout',
    sinkValue: code,
  });
  assert.strictEqual(result.warnings.length, 1, 'string setTimeout flow was missed');
  assert.strictEqual(result.activities[0].detail.sink, 'setTimeout');
  assert(!JSON.stringify(result.logs).includes('timerProbe'), 'string-timer payload leaked into a log');
  console.log('ok - string timers are correlated without executing or recording their source');
}

{
  const code = 'globalThis.intervalProbe=1';
  const result = run({
    page: 'https://tools.example.org/',
    messages: [code],
    sink: 'setInterval',
    sinkValue: code,
  });
  assert.strictEqual(result.warnings.length, 1, 'string setInterval flow was missed');
  assert.strictEqual(result.activities[0].detail.sink, 'setInterval');
  console.log('ok - postMessage-sourced string intervals are correlated and rate-bounded');
}

{
  const result = run({
    page: 'https://tools.example.org/',
    sink: 'Function',
    sinkValue: 'return 9',
  });
  assert.strictEqual(result.sinkResult, 9, 'uncorrelated Function call changed behavior');
  assert.strictEqual(result.evalResult, 23, 'direct eval lost its lexical-scope semantics');
  assert.strictEqual(result.functionWrapped, false, 'Function was patched on a page with no tracked source');
  assert.strictEqual(result.warnings.length, 0, 'uncorrelated dynamic code was scored');
  assert.strictEqual(result.activities.length, 0, 'uncorrelated dynamic code entered Activity Center');
  console.log('ok - uncorrelated Function and direct eval semantics remain compatible');
}

{
  const result = run({
    page: 'https://tools.example.org/?q=' + encoded,
    sink: 'document.write',
    sinkValue: payload,
    enabled: false,
  });
  assert.strictEqual(result.sinkResult, payload, 'disabled guard changed document.write');
  assert.strictEqual(result.warnings.length, 0, 'disabled guard still warned');
  assert(!result.risk, 'disabled guard still added risk');
  console.log('ok - disabling the guard removes its instrumentation and scoring');
}

{
  const result = run({
    page: 'https://tools.example.org/?q=' + encoded,
    sink: 'innerHTML',
    sinkValue: payload,
    behavioralScan: false,
  });
  assert.strictEqual(result.activities.length, 1,
    'the XSS toggle silently depended on the separate behavioral-scanner toggle');
  assert.strictEqual(result.warnings.length, 1);
  console.log('ok - XSS Behavior Guard remains active when generic behavioral scanning is off');
}

assert(/xssBehaviorGuard:\s*true/.test(BACKGROUND) && /xssBehaviorGuard:\s*true/.test(POPUP),
  'fresh-install defaults do not enable the detection-only guard');
const xssRow = (POPUP_HTML.match(/XSS Behavior Guard<\/div><div class="desc">([^<]*)/) || [])[1] || '';
assert(xssRow, 'the XSS Behavior Guard row is no longer findable in the popup');
assert(/\bwarns?\b/i.test(xssRow),
  'the XSS row must say it warns, so nobody reads it as prevention');
assert(!/\bblocks?\b|\bprevents?\b|\bstops?\b|\bprotects? (?:you )?(?:from|against)\b|complete|full protection/i
  .test(xssRow), 'popup overclaims XSS protection');
console.log('ok - configuration defaults and UI describe detection-only scope honestly');

assert(!/else if \(tabHost && msg\.type === 'behavioral_risk'\)/.test(BACKGROUND)
  && /learningEligible:\s*false/.test(BACKGROUND),
  'page-forgeable XSS/behavioral events can still create learned blocking rules');
assert(/learningEligible:score-xssRiskPoints>=\(xssRiskPoints\?100:60\)/.test(SOURCE),
  'the local risk detail no longer exposes its independent-evidence boundary');
console.log('ok - XSS and behavioral findings remain warning-only at the trusted boundary');

assert(/WO\.__pageRisk=Object\.assign\(\{[\s\S]*?WO\.__pageRisk\|\|\{[\s\S]*?phishing:!0/.test(SOURCE),
  'phishing detection overwrites existing behavioral evidence');
console.log('ok - phishing findings merge with, rather than erase, behavioral evidence');

assert(/ACTIVE_TAB_RELOAD_TOGGLES[^\n]*xssBehaviorGuard/.test(POPUP),
  'the live page is not reloaded when sink instrumentation changes');
console.log('ok - toggling the guard refreshes page instrumentation immediately');

assert(/"behavioral_risk"===type&&detail&&detail\.xssObserved/.test(SOURCE),
  'a specific XSS finding still produces a duplicate generic toast');
console.log('ok - specific XSS findings do not also produce a generic site-risk toast');

assert(/__woNativeMessageDataGetter/.test(SOURCE)
  && (SOURCE.match(/const m=__woMessageData\(e\)/g) || []).length === 3,
  'internal bridge listeners still consume instrumented MessageEvent.data');
assert(/patchXssRouteRefresh\("pushState"\)/.test(SOURCE)
  && /patchXssRouteRefresh\("replaceState"\)/.test(SOURCE),
  'SPA routes cannot refresh sources without becoming XSS sinks');
assert(/BEHAVE_SHARED_TENANT_SUFFIXES/.test(SOURCE) && /xssTenantBoundary/.test(SOURCE),
  'shared hosting tenants still collapse into one postMessage trust boundary');
console.log('ok - full-runtime message, SPA, and shared-hosting trust boundaries stay explicit');

for (const sink of ['innerHTML', 'outerHTML', 'insertAdjacentHTML', 'document.write', 'document.writeln',
  'Function constructor', 'setTimeout', 'setInterval', 'iframe.srcdoc', 'Navigation API',
  'DOM insertion', 'window.open', 'script.src', 'script.text', 'script.textContent',
  'script.setAttribute', 'setHTMLUnsafe']) {
  assert(SOURCE.includes(sink), 'missing monitored sink: ' + sink);
}
assert(!/patchXss(?:Setter|Method)\(window\.Location/.test(SOURCE)
  && /patchXssNavigationApi/.test(SOURCE),
  'navigation still depends on non-configurable Location.prototype members');
for (const method of ['appendChild', 'insertBefore', 'replaceChild', 'append', 'prepend',
  'replaceChildren', 'before', 'after', 'replaceWith', 'insertAdjacentElement',
  'insertNode', 'surroundContents']) {
  assert(SOURCE.includes('"' + method + '"'), 'missing activation-time DOM insertion coverage: ' + method);
}
assert(!/patchXssMethod\(window\.(?:Range|DOMParser|History)/.test(SOURCE),
  'inert parsing or SPA history APIs are still treated as executable XSS sinks');
assert(/untrustedMessage&&registerMessageData/.test(SOURCE),
  'trusted same-origin message data is still registered as attacker-controlled input');
for (const [type, label] of [
  ['warned_potential_dom_xss', 'Potential DOM XSS detected'],
  ['warned_potential_xss_code_execution', 'Potential dynamic-code injection'],
  ['warned_potential_xss_navigation', 'Suspicious source-controlled navigation'],
  ['warned_potential_xss_script_injection', 'Potential script injection'],
  ['warned_potential_xss_privileged_action', 'Suspicious message-driven action'],
]) {
  assert(HISTORY.includes(type + ": '" + label + "'"), 'missing Activity Center title: ' + label);
  assert(!/blocked/i.test(label), 'XSS warning title falsely claims blocking: ' + label);
}
assert(HISTORY.includes("warned_xss_behavior: 'Potential XSS behavior detected'") &&
  HISTORY.includes('XSS_ACTIVITY_TYPES.has(e.type)'), 'legacy XSS history entries are no longer readable');
assert(HISTORY.includes("'Confidence: ' + d.confidence") && HISTORY.includes("'Severity: ' + d.severity") &&
  HISTORY.includes("'Technical: ' + flow") && HISTORY.includes('d.outcome'),
  'Activity Center omits XSS confidence, severity, technical flow, or outcome');
assert(/xssActivitySources=\{/.test(SOURCE) && /xssActivitySinks=new Set/.test(SOURCE) &&
  !/payload\s*:|matched\s*:|value\s*:safe/.test(SOURCE.slice(SOURCE.indexOf('noteXssActivity='), SOURCE.indexOf('noteXssSink='))),
  'XSS activity detail is not constrained to safe source and sink labels');
assert(/xssActivityCount>=3/.test(SOURCE) && /xssStrongActivityLogged/.test(SOURCE),
  'Activity Center events do not keep a bounded reserve for later strong evidence');
assert(/xssSources\.length>=96/.test(SOURCE) && /count>=16/.test(SOURCE),
  'source provenance is not bounded against message or framework floods');
assert(/xssMessageOriginRead\.has\(event\)/.test(SOURCE) && /addXssSignal\(5,/.test(SOURCE),
  'missing message-origin access is not based on runtime evidence or is overweighted');
assert(!/window\.eval\s*=/.test(SOURCE), 'direct eval was wrapped despite lexical-scope incompatibility');
console.log('ok - XSS event taxonomy, safe technical detail, and legacy rendering stay explicit');

/*
 * Ordinary sites constantly feed URL data into code and script sinks: analytics
 * configs, JSONP callback names, hydration blobs, cache-busting build hashes,
 * campaign parameters on a CDN tag. None of that changes what executes, and
 * scoring it turned routine browsing into "Suspicious site behavior" warnings.
 * A code sink only counts when the reflected value is shaped like code AND
 * lands where code runs; a script URL only counts when the source controls
 * where the script comes from.
 */
for (const benign of [
  {
    what: 'analytics config holding the whole query string',
    page: 'https://shop.example.com/products?category=winter-jackets&sort=price_asc',
    sink: 'Function',
    sinkValue: 'return {"query":"category=winter-jackets&sort=price_asc"}',
  },
  {
    what: 'session id quoted inside evaluated code',
    page: 'https://portal.example.com/session?sid=8f3c1a9b47e2d05c6a1f',
    sink: 'Function',
    sinkValue: 'return String("8f3c1a9b47e2d05c6a1f")',
  },
  {
    what: 'JSONP callback name from the URL',
    page: 'https://widget.example.com/?callback=jsonpCallback_17004',
    sink: 'Function',
    sinkValue: 'return "jsonpCallback_17004"',
  },
  {
    what: 'order id inside a string timer literal',
    page: 'https://shop.example.com/orders?id=order-12345678',
    sink: 'setTimeout',
    sinkValue: 'checkStatus("order-12345678")',
  },
  {
    what: 'framework hydration state in a dynamic script',
    page: 'https://news.example.com/story?ref=homepage-top-carousel',
    sink: 'script.textContent',
    sinkValue: 'window.__NEXT_DATA__={"query":{"ref":"homepage-top-carousel"}};',
  },
  {
    what: 'admin console tab parameters',
    page: 'https://blog.example.com/wp-admin/admin.php?page=my-plugin-settings&tab=integrations',
    sink: 'Function',
    sinkValue: 'return {page:"my-plugin-settings",tab:"integrations"}',
  },
]) {
  const result = run(benign);
  assert.strictEqual(result.warnings.length, 0, 'benign code-sink data warned: ' + benign.what);
  assert.strictEqual(result.activities.length, 0, 'benign code-sink data reached Activity Center: ' + benign.what);
}
console.log('ok - ordinary URL data passing through a code sink is not evidence of anything');

for (const benign of [
  {
    what: 'campaign parameters appended to a tag manager URL',
    page: 'https://shop.example.com/checkout?utm_medium=cpc&gclid=EAIaIQobChMI9271abcdef',
    sink: 'script.src',
    sinkValue: 'https://www.googletagmanager.com/gtag/js?id=G-ABCD1234&l=utm_medium=cpc&gclid=EAIaIQobChMI9271abcdef',
  },
  {
    what: 'build hash from the URL used to cache-bust a bundle',
    page: 'https://app.example.com/?build=8f21c94ad0be47',
    sink: 'script.src',
    sinkValue: '/static/js/main.8f21c94ad0be47.chunk.js',
  },
  {
    what: 'referrer campaign code on a CDN pixel',
    page: 'https://shop.example.com/landing',
    referrer: 'https://partner.example.org/?promo=SUMMER-SALE-2026-BIG',
    sink: 'script.src',
    sinkValue: 'https://cdn.example.net/pixel.js?promo=SUMMER-SALE-2026-BIG',
  },
  {
    what: 'embedded player frame id echoed back to the player origin',
    page: 'https://blog.example.com/post/9',
    messages: ['{"event":"ready","frameId":"widget-frame-88213"}'],
    messageOrigin: 'https://player.example.net',
    sink: 'script.src',
    sinkValue: 'https://player.example.net/api.js?frame=widget-frame-88213',
  },
]) {
  const result = run(benign);
  assert.strictEqual(result.warnings.length, 0, 'a query parameter on a script URL warned: ' + benign.what);
  assert.strictEqual(result.activities.length, 0,
    'a query parameter on a script URL reached Activity Center: ' + benign.what);
}
for (const takeover of [
  { what: 'absolute URL from the query', value: 'https://attacker.example/evil.js' },
  { what: 'protocol-relative URL from the query', value: '//attacker.example/evil.js' },
]) {
  const result = run({
    page: 'https://victim.example.com/?mod=' + encodeURIComponent(takeover.value),
    sink: 'script.src',
    sinkValue: takeover.value,
  });
  assert.strictEqual(result.activities.length, 1, 'script origin takeover was missed: ' + takeover.what);
  assert.strictEqual(result.activities[0].type, 'warned_potential_xss_script_injection');
}
{
  const result = run({
    page: 'https://victim.example.com/#https://attacker.example',
    sink: 'script.src',
    sinkValue: 'https://attacker.example/loader.js',
  });
  assert.strictEqual(result.activities.length, 1, 'a source controlling only the script host was missed');
}
console.log('ok - script URLs score on who serves the script, not on appended parameters');

{
  /* The old executable-position test could only recognise a breakout whose body
     called one of a fixed list of functions, so ";alert(1);//" was caught and
     ";window.__pwn=1;//" walked straight through. Compare the code after the
     closing quote instead. */
  const breakout = '";window.__pwn=1;//';
  const result = run({
    page: 'https://victim.example.com/?q=' + encodeURIComponent(breakout),
    sink: 'script.textContent',
    sinkValue: 'window.query="' + breakout + '"',
  });
  assert.strictEqual(result.activities.length, 1, 'a string breakout without a known call name was missed');
  assert.strictEqual(result.activities[0].type, 'warned_potential_xss_script_injection');
  const quoted = run({
    page: 'https://victim.example.com/?q=' + encodeURIComponent('plain-catalogue-value'),
    sink: 'script.textContent',
    sinkValue: 'window.query="plain-catalogue-value"',
  });
  assert.strictEqual(quoted.activities.length, 0, 'a safely quoted value was read as a breakout');
  console.log('ok - string breakouts are recognised by their code, not by a list of call names');
}

{
  const shaped = '<img src=x onerror=alert(1)>';
  const result = run({
    page: 'https://victim.example.com/?next=' + encodeURIComponent(shaped),
    sink: 'window.open',
    sinkValue: shaped,
  });
  const reason = (result.risk && result.risk.behavioralReasons || []).find((entry) => /navigation target/.test(entry));
  assert(reason, 'a URL-derived navigation influence was not recorded');
  assert(!/message data/.test(reason), 'a URL-derived value was described as message data: ' + reason);
  assert(/location\.search/.test(reason), 'the navigation reason does not name its real source: ' + reason);
  console.log('ok - weak navigation evidence names the source it actually came from');
}

{
  /* iframe.setAttribute('srcdoc', x) is the same sink as iframe.srcdoc = x. It
     was reported under the generic setAttribute label, and that label is what
     decides whether script content inside the markup gets scanned at all -- so a
     reflected script written this way was invisible. */
  const payloadScript = '<scr' + 'ipt>alert(1)</scr' + 'ipt>';
  const result = run({
    page: 'https://victim.example.com/?f=' + encodeURIComponent(payloadScript),
    sink: 'setAttribute',
    sinkTag: 'iframe',
    attribute: 'srcdoc',
    sinkValue: payloadScript,
  });
  assert.strictEqual(result.activities.length, 1, 'a reflected script in srcdoc via setAttribute was missed');
  assert.strictEqual(result.activities[0].detail.sink, 'iframe.srcdoc',
    'the srcdoc attribute was reported under the generic setAttribute label');
  const benign = run({
    page: 'https://blog.example.com/post?ref=sidebar-widget-a',
    sink: 'setAttribute',
    sinkTag: 'iframe',
    attribute: 'srcdoc',
    sinkValue: '<html><body><img src="https://ads.example.net/i.gif"></body></html>',
  });
  assert.strictEqual(benign.activities.length, 0, 'ordinary iframe srcdoc content was scored');
  console.log('ok - srcdoc set through setAttribute is the same sink as the srcdoc property');
}

console.log('\n98 XSS Behavior Guard checks passed.');
