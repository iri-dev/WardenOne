/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/*
 * Twitch Rewind's disposer, run against the real twitch-rewind.js on a small fake player page.
 *
 * The published disposer used to release only what the shared registry holds -- listeners,
 * timers, observers, Chrome listeners. Rewind's real holdings are elsewhere: a running
 * MediaRecorder and its capture tracks, a buffer of chunks, replay blob URLs, a live picture it
 * muted during a rewind, and controls in Twitch's player bar. Those are released by shutdown(),
 * which disposal skipped, so a disposed copy kept encoding with nothing listening and a newer copy
 * started a second recorder beside it.
 *
 * Run: node tools/test-twitch-rewind-dispose.js
 */
'use strict';

const fs = require('fs');
const vm = require('vm');
const { installPlatformGlobals } = require('./lib/engine-ambient.js');

const SOURCE = fs.readFileSync('twitch-rewind.js', 'utf8');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

/* ---- a fake page, only as much DOM as Rewind touches -------------------------------------- */

class FakeEventTarget {
  constructor() { this.listeners = []; }
  addEventListener(type, fn, opts) {
    const signal = opts && typeof opts === 'object' ? opts.signal : null;
    if (signal && signal.aborted) return;
    const entry = { type, fn, once: !!(opts && typeof opts === 'object' && opts.once) };
    this.listeners.push(entry);
    if (signal) signal.addEventListener('abort', () => this.removeEventListener(type, fn), { once: true });
  }
  removeEventListener(type, fn) {
    this.listeners = this.listeners.filter((entry) => !(entry.type === type && entry.fn === fn));
  }
  dispatchEvent(event) {
    if (!event.target) event.target = this;
    event.currentTarget = this;
    for (const entry of this.listeners.filter((item) => item.type === event.type)) {
      if (entry.once) this.removeEventListener(entry.type, entry.fn);
      entry.fn.call(this, event);
    }
    return true;
  }
}

function camelToData(name) {
  return 'data-' + name.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase());
}

/* tag, .class, #id, [attr], [attr="v"] and :not(<one of those>), compounded; comma lists. */
function matchesSimple(el, selector) {
  let rest = selector.trim();
  const notMatch = /:not\(([^)]*)\)/g;
  const nots = [];
  rest = rest.replace(notMatch, (_, inner) => { nots.push(inner); return ''; });
  const re = /([a-zA-Z][\w-]*)|#([\w-]+)|\.([\w-]+)|\[([\w-]+)(?:="([^"]*)")?\]/g;
  let m;
  let consumed = 0;
  while ((m = re.exec(rest))) {
    consumed += m[0].length;
    if (m[1] && el.tagName !== m[1].toUpperCase()) return false;
    if (m[2] && el.getAttribute('id') !== m[2]) return false;
    if (m[3] && !el.classList.contains(m[3])) return false;
    if (m[4]) {
      if (!el.hasAttribute(m[4])) return false;
      if (m[5] !== undefined && el.getAttribute(m[4]) !== m[5]) return false;
    }
  }
  if (consumed !== rest.length) throw new Error('fake page: unsupported selector "' + selector + '"');
  return nots.every((inner) => !matchesSimple(el, inner));
}

class FakeElement extends FakeEventTarget {
  constructor(tag, page) {
    super();
    this.page = page;
    this.tagName = String(tag).toUpperCase();
    this.nodeType = 1;
    this.attributes = new Map();
    this.childList = [];
    this.parentNode = null;
    this.shadowRoot = null;
    this.style = { cssText: '', setProperty(name, value) { this[name] = String(value); } };
    const el = this;
    this.dataset = new Proxy({}, {
      get: (_, name) => (typeof name === 'string' && el.hasAttribute(camelToData(name)) ? el.getAttribute(camelToData(name)) : undefined),
      set: (_, name, value) => { el.setAttribute(camelToData(name), value); return true; },
      deleteProperty: (_, name) => { el.removeAttribute(camelToData(name)); return true; },
      has: (_, name) => el.hasAttribute(camelToData(name)),
    });
    this.classList = {
      contains: (c) => (el.getAttribute('class') || '').split(/\s+/).includes(c),
      add: (c) => { if (!el.classList.contains(c)) el.setAttribute('class', ((el.getAttribute('class') || '') + ' ' + c).trim()); },
      remove: (c) => el.setAttribute('class', (el.getAttribute('class') || '').split(/\s+/).filter((x) => x && x !== c).join(' ')),
      toggle: (c, force) => {
        const on = force === undefined ? !el.classList.contains(c) : !!force;
        if (on) el.classList.add(c); else el.classList.remove(c);
        return on;
      },
    };
  }
  get id() { return this.getAttribute('id') || ''; }
  set id(value) { this.setAttribute('id', value); }
  get children() { return this.childList.slice(); }
  get parentElement() { return this.parentNode && this.parentNode.nodeType === 1 ? this.parentNode : null; }
  get nextSibling() {
    if (!this.parentNode) return null;
    const siblings = this.parentNode.childList;
    return siblings[siblings.indexOf(this) + 1] || null;
  }
  get isConnected() {
    let node = this;
    while (node) {
      if (node.nodeType === 9) return true;
      node = node.nodeType === 11 ? node.host : node.parentNode;
    }
    return false;
  }
  getAttribute(name) { return this.attributes.has(name) ? this.attributes.get(name) : null; }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  removeAttribute(name) { this.attributes.delete(name); }
  hasAttribute(name) { return this.attributes.has(name); }
  appendChild(node) { return this.insertBefore(node, null); }
  insertBefore(node, ref) {
    if (node.parentNode) node.parentNode.removeChild(node);
    node.parentNode = this;
    const index = ref ? this.childList.indexOf(ref) : -1;
    if (index < 0) this.childList.push(node); else this.childList.splice(index, 0, node);
    return node;
  }
  insertAdjacentElement(where, node) {
    if (where === 'afterend') return this.parentNode.insertBefore(node, this.nextSibling);
    if (where === 'beforeend') return this.appendChild(node);
    throw new Error('fake page: insertAdjacentElement ' + where);
  }
  removeChild(node) {
    const index = this.childList.indexOf(node);
    if (index >= 0) { this.childList.splice(index, 1); node.parentNode = null; }
    return node;
  }
  remove() { if (this.parentNode) this.parentNode.removeChild(this); }
  contains(node) {
    for (let n = node; n; n = n.parentNode) if (n === this) return true;
    return false;
  }
  descendants(out) {
    out = out || [];
    for (const child of this.childList) { out.push(child); child.descendants(out); }
    return out;
  }
  matches(selector) { return selector.split(',').some((part) => matchesSimple(this, part)); }
  querySelectorAll(selector) { return this.descendants().filter((el) => el.matches(selector)); }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  closest(selector) {
    for (let n = this; n && n.nodeType === 1; n = n.parentNode) if (n.matches(selector)) return n;
    return null;
  }
  getBoundingClientRect() { return this.rect || { width: 0, height: 0, top: 0, left: 0 }; }
  attachShadow() {
    this.shadowRoot = new FakeShadowRoot(this);
    return this.shadowRoot;
  }
  set textContent(value) { this.text = String(value); this.childList = []; }
  get textContent() { return this.text || ''; }
}

const VOID_TAGS = new Set(['INPUT', 'BR', 'IMG']);

class FakeShadowRoot extends FakeElement {
  constructor(host) {
    super('#shadow-root', host.page);
    this.nodeType = 11;
    this.host = host;
  }
  /* Enough of an HTML parser for the controls template: tags and quoted attributes. Text is
     dropped; nothing here reads it back. */
  set innerHTML(html) {
    this.childList = [];
    const stack = [this];
    const tagRe = /<(\/)?([a-zA-Z][\w-]*)([^>]*)>/g;
    let m;
    while ((m = tagRe.exec(html))) {
      const tag = m[2].toUpperCase();
      if (m[1]) {
        while (stack.length > 1 && stack.pop().tagName !== tag) { /* unwind */ }
        continue;
      }
      const el = this.page.document.createElement(tag);
      const attrRe = /([^\s=/]+)(?:="([^"]*)")?/g;
      let a;
      while ((a = attrRe.exec(m[3]))) el.setAttribute(a[1], a[2] === undefined ? '' : a[2]);
      stack[stack.length - 1].appendChild(el);
      if (!VOID_TAGS.has(tag) && !/\/\s*$/.test(m[3])) stack.push(el);
    }
  }
}

class FakeVideo extends FakeElement {
  constructor(page) {
    super('video', page);
    this.muted = false;
    this.volume = 1;
    this.playbackRate = 1;
    this.currentTime = 0;
    this.readyState = 0;
    this.ended = false;
    this.paused = true;
  }
  get src() { return this.getAttribute('src') || ''; }
  set src(value) { this.setAttribute('src', value); }
  play() { this.paused = false; return Promise.resolve(); }
  pause() { this.paused = true; }
  load() {}
}

function fakeTrack(kind) {
  return {
    kind,
    readyState: 'live',
    stop() { this.readyState = 'ended'; },
    getSettings() { return { frameRate: 30 }; },
    applyConstraints() { return Promise.resolve(); },
  };
}

function createPage() {
  const page = {
    now: 1000,
    recorders: [],
    streams: [],
    createdUrls: [],
    revokedUrls: new Set(),
    configAnswer: { ok: true, overrides: { enabled: true, twitchRewind: true, twitchRewindMinutes: 5 } },
    deferConfig: false,
    pendingConfig: [],
    onMessage: [],
  };

  const document = new FakeEventTarget();
  page.document = document;
  document.nodeType = 9;
  document.hidden = false;
  document.createElement = (tag) => (String(tag).toLowerCase() === 'video' ? new FakeVideo(page) : new FakeElement(tag, page));
  const html = document.createElement('html');
  html.parentNode = document;
  document.documentElement = html;
  document.head = html.appendChild(document.createElement('head'));
  document.body = html.appendChild(document.createElement('body'));
  document.querySelectorAll = (selector) => [html].concat(html.descendants()).filter((el) => el.matches(selector));
  document.querySelector = (selector) => document.querySelectorAll(selector)[0] || null;
  document.getElementById = (id) => html.descendants().find((el) => el.id === id) || null;

  const el = (tag, attrs, children) => {
    const node = document.createElement(tag);
    for (const [name, value] of Object.entries(attrs || {})) node.setAttribute(name, value);
    for (const child of children || []) node.appendChild(child);
    return node;
  };

  /* Twitch's player, as Rewind finds it. */
  const source = document.createElement('video');
  source.rect = { width: 1280, height: 720, top: 0, left: 0 };
  source.readyState = 4;
  source.paused = false;
  source.volume = 0.8;
  source.videoWidth = 1280;
  source.videoHeight = 720;
  source.captureStream = function captureStream() {
    /* Each call is a new stream with its own tracks, as Chromium's element capturer does. */
    const tracks = [fakeTrack('video'), fakeTrack('audio')];
    const stream = {
      tracks,
      getTracks() { return tracks.slice(); },
      getVideoTracks() { return tracks.filter((t) => t.kind === 'video'); },
    };
    page.streams.push(stream);
    return stream;
  };
  const muteButton = el('button', { 'data-a-target': 'player-mute-unmute-button' });
  const playButton = el('button', { 'data-a-target': 'player-play-pause-button', 'aria-label': 'Pause' });
  const controlGroup = el('div', { class: 'player-controls__left-control-group' }, [el('div', {}, [muteButton]), playButton]);
  document.body.appendChild(el('div', { class: 'video-player' }, [
    el('div', { class: 'video-player__container' }, [el('div', { class: 'video-ref' }, [source])]),
    el('div', { class: 'video-player__overlay' }, [controlGroup]),
  ]));
  page.source = source;
  page.controlGroup = controlGroup;

  class FakeMediaRecorder extends FakeEventTarget {
    static isTypeSupported() { return true; }
    constructor(stream, options) {
      super();
      this.stream = stream;
      this.options = options;
      this.state = 'inactive';
      page.recorders.push(this);
    }
    start(timeslice) { this.state = 'recording'; this.timeslice = timeslice; }
    stop() {
      if (this.state === 'inactive') return;
      this.state = 'inactive';
      this.dispatchEvent({ type: 'stop' });
    }
    emit(size) { this.dispatchEvent({ type: 'dataavailable', data: { size } }); }
  }

  class FakeURL extends URL {}
  FakeURL.createObjectURL = () => {
    const url = 'blob:https://www.twitch.tv/rewind-' + (page.createdUrls.length + 1);
    page.createdUrls.push(url);
    return url;
  };
  FakeURL.revokeObjectURL = (url) => { page.revokedUrls.add(String(url)); };

  const win = new FakeEventTarget();
  win.top = win;
  page.window = win;

  let timerId = 0;
  page.intervals = new Set();
  const sandbox = {
    window: win,
    document,
    location: { hostname: 'www.twitch.tv', pathname: '/fixturechannel', href: 'https://www.twitch.tv/fixturechannel' },
    MediaRecorder: FakeMediaRecorder,
    URL: FakeURL,
    Blob: class FakeBlob { constructor(parts, options) { this.parts = parts; this.type = options && options.type; } },
    MutationObserver: class { observe() {} disconnect() {} },
    getComputedStyle: (node) => ({ display: node.style.display || 'block', visibility: node.style.visibility || 'visible' }),
    performance: { now: () => page.now },
    setTimeout: () => ++timerId,
    clearTimeout() {},
    setInterval: () => { const id = ++timerId; page.intervals.add(id); return id; },
    clearInterval: (id) => { page.intervals.delete(id); },
    AbortController,
    console,
    chrome: {
      runtime: {
        lastError: undefined,
        sendMessage(message, callback) {
          if (page.deferConfig) page.pendingConfig.push(callback);
          else callback(page.configAnswer);
        },
        onMessage: {
          addListener: (fn) => { page.onMessage.push(fn); },
          removeListener: (fn) => { page.onMessage = page.onMessage.filter((item) => item !== fn); },
        },
      },
    },
  };
  sandbox.globalThis = sandbox;
  installPlatformGlobals(sandbox);
  vm.createContext(sandbox);
  page.sandbox = sandbox;

  page.load = (source, version) => {
    let text = source;
    if (version) {
      text = source.replace(/const WO_GUARD_VERSION = '[^']+';/, "const WO_GUARD_VERSION = '" + version + "';");
      assert(text !== source, 'could not set the fixture copy\'s version');
    }
    vm.runInContext(text, sandbox, { filename: 'twitch-rewind.js' });
  };
  page.flushConfig = () => {
    const pending = page.pendingConfig.splice(0, page.pendingConfig.length);
    for (const callback of pending) callback(page.configAnswer);
  };
  page.recording = () => page.recorders.filter((recorder) => recorder.state === 'recording');
  page.byId = (id) => document.querySelectorAll('#' + id);
  return page;
}

/* A running recorder with twenty seconds buffered, rewound ten seconds: the state with the most
   to release -- a live picture muted under a replay surface, a replay blob URL, the DVR marker. */
function recordingAndRewound(page) {
  page.load(SOURCE);
  const recorder = page.recording()[0];
  assert(page.recording().length === 1, 'fixture: Rewind did not start a recorder');
  for (let i = 0; i < 20; i++) {
    page.now += 1000;
    recorder.emit(4096);
  }
  const controls = page.document.getElementById('wardenone-twitch-rewind');
  assert(controls && page.controlGroup.contains(controls), 'fixture: the controls were not mounted in Twitch\'s player bar');
  controls.shadowRoot.querySelector('.back10').dispatchEvent({ type: 'click' });
  assert(page.document.documentElement.getAttribute('data-wo-twitch-dvr') === 'replay', 'fixture: the rewind did not start');
  assert(page.source.muted === true && page.createdUrls.length === 1, 'fixture: the rewind did not take over the picture');
  return {
    recorder,
    stream: recorder.stream,
    controls,
    layer: page.document.getElementById('wardenone-twitch-replay-layer'),
    style: page.document.getElementById('wardenone-twitch-playback-style'),
    urls: page.createdUrls.slice(),
  };
}

function assertReleased(page, held, label) {
  assert(held.recorder.state === 'inactive', label + ': the MediaRecorder was left recording');
  assert(held.stream.getTracks().every((track) => track.readyState === 'ended'), label + ': the capture tracks were left live');
  assert(held.urls.every((url) => page.revokedUrls.has(url)), label + ': a replay blob URL was not revoked');
  assert(!held.controls.isConnected, label + ': the controls were left in Twitch\'s player bar');
  assert(!held.layer.isConnected, label + ': the replay layer was left over the live picture');
  assert(!held.style.isConnected, label + ': the playback-button stylesheet was left in the page');
  assert(page.source.muted === false && page.source.volume === 0.8, label + ': the live picture was left muted');
  assert(!page.document.documentElement.hasAttribute('data-wo-twitch-dvr'), label + ': the DVR marker was left on the page');
}

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

test('dispose releases the recorder, capture, replay and controls', () => {
  const page = createPage();
  const held = recordingAndRewound(page);
  page.window.__wardenOneTwitchRewindDispose();
  assertReleased(page, held, 'dispose');
  assert(page.recording().length === 0, 'dispose left a recorder running');
  assert(page.intervals.size === 0, 'dispose left a scan or UI interval running');
});

test('a newer copy replaces the running one and leaves exactly one recorder', () => {
  const page = createPage();
  const held = recordingAndRewound(page);
  page.load(SOURCE, '999.0.0-replacement');
  assertReleased(page, held, 'replacement');
  const running = page.recording();
  assert(running.length === 1 && running[0] !== held.recorder, 'replacement did not leave exactly one recorder, its own');
  assert(running[0].stream !== held.stream && running[0].stream.getTracks().every((track) => track.readyState === 'live'),
    'the replacement recorder is not on a fresh live capture');
  for (const id of ['wardenone-twitch-rewind', 'wardenone-twitch-replay-layer', 'wardenone-twitch-playback-style']) {
    assert(page.byId(id).length === 1, 'the page holds ' + page.byId(id).length + ' copies of #' + id);
  }
});

test('a settings reply that lands after disposal cannot start the released copy again', () => {
  const page = createPage();
  const held = recordingAndRewound(page);
  page.deferConfig = true;
  page.onMessage.slice().forEach((fn) => fn({ kind: 'content-config-refresh' }));
  assert(page.pendingConfig.length === 1, 'fixture: the released copy did not ask for its settings');
  page.load(SOURCE, '999.0.0-replacement');
  page.flushConfig();
  assertReleased(page, held, 'late settings');
  assert(page.recording().length === 1, 'a late settings reply restarted the released copy beside the new one');
  assert(page.byId('wardenone-twitch-rewind').length === 1, 'a late settings reply remounted the released copy\'s controls');
});

/* What 1.0.1 shipped: a disposer that released listeners and timers but never called shutdown(), so
   it left the recorder, capture and controls running, and carried no __woReleases mark. A newer
   copy does not replace such a copy in place -- that put a second recorder on the same video -- so
   the tab keeps the old one, whole, until it reloads. */
test('a newer copy leaves an older one that cannot release its recorder in charge', () => {
  const shutdownCall = '    try { shutdown(); } catch (_) {}\n';
  const releaseMark = "  Object.defineProperty(window.__wardenOneTwitchRewindDispose, '__woReleases', { value: true });\n";
  assert(SOURCE.includes(shutdownCall) && SOURCE.includes(releaseMark), 'legacy fixture could not find the release to remove');
  const legacySource = SOURCE.replace(shutdownCall, '').replace(releaseMark, '');
  const page = createPage();
  page.load(legacySource, '0.0.0-legacy-rewind');
  const recorder = page.recording()[0];
  assert(page.recording().length === 1, 'fixture: the legacy copy did not start a recorder');
  const dispose = page.window.__wardenOneTwitchRewindDispose;

  page.load(SOURCE);
  assert(page.window.__wardenOneTwitchRewindReady === '0.0.0-legacy-rewind' && page.window.__wardenOneTwitchRewindDispose === dispose,
    'the current copy installed over a legacy copy it cannot release');
  const running = page.recording();
  assert(running.length === 1 && running[0] === recorder, 'the page does not hold exactly one recorder, the legacy copy\'s');
  for (const id of ['wardenone-twitch-rewind', 'wardenone-twitch-playback-style']) {
    assert(page.byId(id).length === 1, 'the page holds ' + page.byId(id).length + ' copies of #' + id);
  }
});

let failed = 0;
for (const item of tests) {
  try {
    item.fn();
    console.log('  ok  - ' + item.name);
  } catch (error) {
    failed++;
    console.error('  FAIL - ' + item.name + ' :: ' + (error && error.message || error));
  }
}
console.log('\n' + (tests.length - failed) + ' passed, ' + failed + ' failed');
if (failed) process.exit(1);
