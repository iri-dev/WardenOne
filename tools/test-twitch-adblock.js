/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/*
 * Page-level and packaging regressions for the dedicated Twitch ad blocker.
 *
 * This suite deliberately executes twitch-adblock.js in a small MAIN-world
 * harness. Playlist behavior lives in test-twitch-playlist-compatibility.js,
 * which executes the worker runtime emitted by this module.
 *
 * Run: node tools/test-twitch-adblock.js
 */
'use strict';

const fs = require('fs');
const vm = require('vm');
/* This suite lifts a region of the engine and runs it in a hand-built sandbox, so it has to be
 * given the helpers the engine declares in its teardown preamble -- a lifted fragment cannot see
 * them otherwise. Only those helpers are supplied, not the whole preamble, so a fragment that
 * reaches for anything else it should not see still fails. */
const { installEngineAmbient } = require('./lib/engine-ambient.js');

const ROOT = process.cwd();
const MODULE_SOURCE = fs.readFileSync('twitch-adblock.js', 'utf8');
const LEGACY_SOURCE = fs.readFileSync('src/content.js', 'utf8');
const LEGACY_RUNTIME = fs.readFileSync('content.min.js', 'utf8');
const MANIFEST = JSON.parse(fs.readFileSync('manifest.json', 'utf8'));

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function equal(actual, expected, message) {
  const left = JSON.stringify(actual);
  const right = JSON.stringify(expected);
  assert(left === right, message + '\nexpected: ' + right + '\nactual:   ' + left);
}

class EventTargetHarness {
  constructor() {
    this.listeners = new Map();
  }

  addEventListener(type, callback) {
    const list = this.listeners.get(type) || [];
    list.push(callback);
    this.listeners.set(type, list);
  }

  removeEventListener(type, callback) {
    const list = this.listeners.get(type);
    if (!list) return;
    const index = list.indexOf(callback);
    if (index >= 0) list.splice(index, 1);
  }

  dispatchEvent(event) {
    const list = this.listeners.get(event && event.type) || [];
    for (const callback of list.slice()) {
      callback.call(this, event);
      if (event && event.immediatePropagationStopped) break;
    }
    return true;
  }
}

class StyleHarness {
  constructor(onMutation) {
    this.values = new Map();
    this.onMutation = typeof onMutation === 'function' ? onMutation : null;
  }

  setProperty(property, value, priority) {
    const entry = { value: String(value), priority: String(priority || '') };
    this.values.set(String(property), entry);
    if (this.onMutation) this.onMutation({ type: 'style-set', property: String(property), ...entry });
  }

  removeProperty(property) {
    const previous = this.getPropertyValue(property);
    this.values.delete(String(property));
    if (this.onMutation) this.onMutation({ type: 'style-remove', property: String(property) });
    return previous;
  }

  getPropertyValue(property) {
    const entry = this.values.get(String(property));
    return entry ? entry.value : '';
  }

  getPropertyPriority(property) {
    const entry = this.values.get(String(property));
    return entry ? entry.priority : '';
  }
}

function harnessTimeRanges(ranges) {
  const list = Array.isArray(ranges) ? ranges : [];
  return {
    length: list.length,
    start(index) { return list[index][0]; },
    end(index) { return list[index][1]; },
  };
}

class ElementHarness extends EventTargetHarness {
  constructor(tagName) {
    super();
    this.tagName = String(tagName || 'div').toUpperCase();
    this.attributes = new Map();
    this.children = [];
    this.parentElement = null;
    this.isConnected = false;
    this.style = new StyleHarness();
  }

  appendChild(node) {
    node.parentElement = this;
    node.isConnected = this.isConnected;
    this.children.push(node);
    return node;
  }

  setAttribute(name, value) {
    this.attributes.set(String(name), String(value));
  }

  getAttribute(name) {
    const key = String(name);
    return this.attributes.has(key) ? this.attributes.get(key) : null;
  }

  removeAttribute(name) {
    this.attributes.delete(String(name));
  }

  hasAttribute(name) {
    return this.attributes.has(String(name));
  }

  closest(selector) {
    let node = this;
    while (node) {
      if (selector === 'video' && node.tagName === 'VIDEO') return node;
      node = node.parentElement;
    }
    return null;
  }

  querySelectorAll(selector) {
    const matches = [];
    const visit = (node) => {
      for (const child of node.children || []) {
        if ((selector === 'video' && child.tagName === 'VIDEO') ||
            (selector === 'source[src]' && child.tagName === 'SOURCE' && child.hasAttribute('src'))) {
          matches.push(child);
        }
        visit(child);
      }
    };
    visit(this);
    return matches;
  }
}

function createPageHarness(config, harnessOptions) {
  harnessOptions = harnessOptions || {};
  const sessionValues = harnessOptions.sessionValues || new Map();
  const sessionStorage = {
    getItem(key) {
      key = String(key);
      return sessionValues.has(key) ? sessionValues.get(key) : null;
    },
    setItem(key, value) {
      sessionValues.set(String(key), String(value));
    },
    removeItem(key) {
      sessionValues.delete(String(key));
    },
  };
  const state = {
    fetchCalls: [],
    xhrOpens: [],
    xhrSends: [],
    workerInstances: [],
    workerSourceReads: 0,
    blobSources: new Map(),
    revokedUrls: [],
    timeouts: [],
    intervals: 0,
    mutationObservers: [],
    videos: [],
    streamDisplayAdSignal: !!harnessOptions.streamDisplayAdSignal,
    documentHidden: !!harnessOptions.documentHidden,
    now: harnessOptions.now == null ? Date.now() : Number(harnessOptions.now),
  };

  let blobId = 0;
  let timerId = 0;

  class HarnessURL extends URL {}
  HarnessURL.createObjectURL = (blob) => {
    const url = 'blob:wardenone-twitch-' + (++blobId);
    state.blobSources.set(url, String(blob && blob.source || ''));
    return url;
  };
  HarnessURL.revokeObjectURL = (url) => state.revokedUrls.push(String(url));

  class HarnessBlob {
    constructor(parts, options) {
      this.source = (parts || []).map(String).join('');
      this.type = options && options.type || '';
    }
  }

  class NativeWorker extends EventTargetHarness {
    constructor(url, options) {
      super();
      this.url = String(url);
      this.options = options;
      this.messages = [];
      this.terminateCalls = 0;
      this.terminated = false;
      state.workerInstances.push(this);
    }

    postMessage(message) {
      this.messages.push(message);
    }

    terminate() {
      this.terminateCalls++;
      this.terminated = true;
    }
  }

  class HarnessXHR {
    open(method, url, async) {
      this.method = method;
      this.url = String(url);
      this.async = async;
      state.xhrOpens.push({
        xhr: this,
        method: String(method),
        url: this.url,
        async: async,
        args: Array.from(arguments),
      });
    }

    overrideMimeType() {}

    send(body) {
      state.xhrSends.push({ xhr: this, method: this.method, url: this.url, async: this.async, body: body });
      if (/^blob:/i.test(String(this.url || ''))) {
        state.workerSourceReads++;
        if (harnessOptions.workerSourceThrows) throw new Error('fixture worker source read failed');
        this.responseText = Object.prototype.hasOwnProperty.call(harnessOptions, 'workerSource')
          ? String(harnessOptions.workerSource || '')
          : 'self.__wardenOneOriginalWorkerRan = true;';
        return;
      }
      this.responseText = Object.prototype.hasOwnProperty.call(harnessOptions, 'xhrResponse')
        ? String(harnessOptions.xhrResponse || '')
        : 'native xhr response';
    }
  }

  class HarnessVideoElement extends ElementHarness {
    constructor(options) {
      super('video');
      options = options || {};
      this.operations = [];
      this.style = new StyleHarness((operation) => this.operations.push(operation));
      this.currentSrc = String(options.currentSrc || '');
      this.paused = options.paused === true;
      this.readyState = options.readyState == null ? 4 : Number(options.readyState);
      this.error = options.error || null;
      this.defaultMuted = !!options.defaultMuted;
      this.muted = !!options.muted;
      this.volume = options.volume == null ? 1 : Number(options.volume);
      this.pauseCalls = 0;
      this.playCalls = 0;
      // Live-timeline surface. Seeks written by the module are recorded
      // separately from playback the fixture models, so a test can tell the two
      // apart; playTo() moves the playhead the way normal playback would.
      this.seeks = [];
      this._currentTime = options.currentTime == null ? 0 : Number(options.currentTime);
      this.duration = options.duration == null ? Infinity : Number(options.duration);
      this.playbackRate = options.playbackRate == null ? 1 : Number(options.playbackRate);
      this.seeking = options.seeking === true;
      this.ended = options.ended === true;
      this.ranges = Array.isArray(options.ranges) ? options.ranges.map((range) => range.slice()) : [];
      if (options.src != null) this.setAttribute('src', options.src);
      if (options.label != null) this.setAttribute('aria-label', options.label);
      for (const [property, entry] of Object.entries(options.style || {})) {
        const value = entry && typeof entry === 'object' ? entry.value : entry;
        const priority = entry && typeof entry === 'object' ? entry.priority : '';
        this.style.setProperty(property, value, priority);
      }
      this.operations.length = 0;
    }

    get defaultMuted() {
      return this._defaultMuted;
    }

    set defaultMuted(value) {
      this._defaultMuted = !!value;
      if (this.operations) this.operations.push({ type: 'defaultMuted', value: this._defaultMuted });
    }

    get muted() {
      return this._muted;
    }

    set muted(value) {
      this._muted = !!value;
      if (this.operations) this.operations.push({ type: 'muted', value: this._muted });
    }

    get volume() {
      return this._volume;
    }

    set volume(value) {
      this._volume = Number(value);
      if (this.operations) this.operations.push({ type: 'volume', value: this._volume });
    }

    setAttribute(name, value) {
      super.setAttribute(name, value);
      if (this.operations) this.operations.push({ type: 'attribute-set', name: String(name), value: String(value) });
    }

    removeAttribute(name) {
      super.removeAttribute(name);
      if (this.operations) this.operations.push({ type: 'attribute-remove', name: String(name) });
    }

    pause() {
      this.pauseCalls++;
      this.paused = true;
      this.operations.push({ type: 'pause' });
    }

    play() {
      this.playCalls++;
      this.paused = false;
      this.operations.push({ type: 'play' });
      return Promise.resolve();
    }

    get currentTime() {
      return this._currentTime;
    }

    set currentTime(value) {
      this._currentTime = Number(value);
      if (this.seeks) this.seeks.push(Number(value));
    }

    get buffered() {
      return harnessTimeRanges(this.ranges);
    }

    get seekable() {
      return harnessTimeRanges(this.ranges);
    }

    playTo(current, bufferedEnd) {
      this._currentTime = Number(current);
      this.ranges = [[0, Number(bufferedEnd)]];
    }
  }

  class HarnessMutationObserver {
    constructor(callback) {
      this.callback = callback;
      this.observeCalls = [];
      this.disconnected = false;
      state.mutationObservers.push(this);
    }

    observe(target, options) {
      this.observeCalls.push({ target, options });
      this.disconnected = false;
    }

    disconnect() {
      this.disconnected = true;
    }

    trigger(records) {
      if (!this.disconnected) this.callback(records || []);
    }
  }

  const document = new EventTargetHarness();
  Object.defineProperty(document, 'hidden', {
    configurable: true,
    get() { return state.documentHidden; },
  });
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get() { return state.documentHidden ? 'hidden' : 'visible'; },
  });
  Object.defineProperty(document, 'webkitHidden', {
    configurable: true,
    get() { return state.documentHidden; },
  });
  const root = new ElementHarness('html');
  root.isConnected = true;
  document.head = root;
  document.documentElement = root;
  document.createElement = (tagName) => {
    const node = new ElementHarness(tagName);
    node.id = '';
    node.textContent = '';
    node.disabled = false;
    return node;
  };
  document.querySelectorAll = (selector) => {
    if (/stream-display-ad|vertical-video-ad|sda-wrapper|ad-banner-default-container|ad-banner-top|tw-ad-label|tw-ad-countdown/i.test(selector)) {
      return state.streamDisplayAdSignal ? [root] : [];
    }
    if (selector === 'video' || selector.includes('video')) {
      return state.videos.filter((video) => video.isConnected &&
        (selector === 'video' || video.inPlayer === true));
    }
    return [];
  };
  document.querySelector = (selector) => document.querySelectorAll(selector)[0] || null;

  const window = new EventTargetHarness();
  window.top = window;
  window.location = {
    hostname: 'www.twitch.tv',
    pathname: '/fixturechannel',
    href: 'https://www.twitch.tv/fixturechannel',
  };
  window.__WO_CONFIG__ = Object.assign({ enabled: true, twitchAdBlock: true }, config || {});
  window.sessionStorage = sessionStorage;
  window.Worker = NativeWorker;
  if (typeof harnessOptions.configureWindow === 'function') {
    harnessOptions.configureWindow(window, state);
  }

  async function nativeFetch(input, init) {
    state.fetchCalls.push({ input: input, init: init });
    if (typeof harnessOptions.nativeFetch === 'function') {
      return harnessOptions.nativeFetch(input, init, state);
    }
    return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
  }
  window.fetch = nativeFetch;

  const NativeDate = Date;
  const HarnessDate = harnessOptions.fakeClock ? class HarnessDate extends NativeDate {
    constructor(...args) {
      super(...(args.length ? args : [state.now]));
    }

    static now() {
      return state.now;
    }
  } : NativeDate;

  const sandbox = {
    window: window,
    document: document,
    location: window.location,
    URL: HarnessURL,
    Blob: HarnessBlob,
    XMLHttpRequest: HarnessXHR,
    Headers,
    Request,
    Response,
    AbortController,
    sessionStorage,
    Date: HarnessDate,
    setTimeout(callback, ms) {
      const id = ++timerId;
      const delay = Number(ms) || 0;
      state.timeouts.push({ id: id, callback: callback, ms: delay, due: state.now + delay,
        cleared: false, fired: false });
      return id;
    },
    clearTimeout(id) {
      const timer = state.timeouts.find((entry) => entry.id === id);
      if (timer) timer.cleared = true;
    },
    setInterval() {
      state.intervals++;
      throw new Error('dedicated Twitch module installed a polling interval');
    },
    Element: ElementHarness,
    HTMLVideoElement: HarnessVideoElement,
    MutationObserver: HarnessMutationObserver,
    console,
  };

  vm.createContext(sandbox);
  installEngineAmbient(sandbox);
  vm.runInContext(MODULE_SOURCE, sandbox, { filename: 'twitch-adblock.js' });
  return {
    sandbox,
    window,
    document,
    state,
    NativeWorker,
    createVideo(options) {
      const video = new HarnessVideoElement(options);
      video.inPlayer = !!(options && options.inPlayer);
      video.isConnected = !options || options.connected !== false;
      state.videos.push(video);
      return video;
    },
    addSource(video, src) {
      const source = new ElementHarness('source');
      source.setAttribute('src', src);
      video.appendChild(source);
      return source;
    },
    fireMedia(type, video) {
      document.dispatchEvent({ type, target: video });
    },
    setStreamDisplayAdSignal(value) {
      state.streamDisplayAdSignal = !!value;
    },
    setDocumentHidden(value, eventName) {
      state.documentHidden = !!value;
      const event = {
        type: eventName || 'visibilitychange',
        defaultPrevented: false,
        propagationStopped: false,
        immediatePropagationStopped: false,
        preventDefault() { this.defaultPrevented = true; },
        stopPropagation() { this.propagationStopped = true; },
        stopImmediatePropagation() { this.immediatePropagationStopped = true; },
      };
      document.dispatchEvent(event);
      return event;
    },
    advance(ms) {
      state.now += Number(ms) || 0;
      while (true) {
        const timer = state.timeouts
          .filter((entry) => !entry.cleared && !entry.fired && entry.due <= state.now)
          .sort((left, right) => left.due - right.due || left.id - right.id)[0];
        if (!timer) break;
        timer.fired = true;
        timer.callback();
      }
    },
  };
}

function exposeWebpackRuntime(window, queueName, requireFn) {
  const queue = [];
  queue.push = function push(entry) {
    Array.prototype.push.call(this, entry);
    if (entry && typeof entry[2] === 'function') entry[2](requireFn);
    return this.length;
  };
  window[queueName] = queue;
  return queue;
}

function exposeWebpackAdManager(window, manager, queueName) {
  const moduleId = 'fixture-twitch-ad-manager';
  function fixtureAdManagerModuleFactory() {
    return ['startProcessingRequests', 'declineReason'];
  }
  function requireFn(id) {
    if (id !== moduleId) throw new Error('unknown fixture webpack module: ' + id);
    return { AdManager: manager };
  }
  requireFn.m = { [moduleId]: fixtureAdManagerModuleFactory };
  exposeWebpackRuntime(window, queueName || 'webpackChunkTwitchFixture', requireFn);
  return requireFn;
}

function executeWorkerWrapper(source, queuedMessages, nativeFetch) {
  const listeners = [];
  const state = { calls: [], messages: [] };
  const workerGlobal = {
    async fetch(input, init) {
      const url = typeof input === 'string' ? input : String(input && input.url || input || '');
      state.calls.push({ url, init });
      return nativeFetch(url, init, state);
    },
    addEventListener(type, callback) {
      if (type === 'message') listeners.push(callback);
    },
    postMessage(message) {
      state.messages.push(message);
    },
  };
  const sandbox = {
    self: workerGlobal,
    URL,
    Response,
    Headers,
    Request,
    AbortController,
    Map,
    Set,
    Date,
    Math,
    Promise,
    Error,
    console,
    setTimeout,
    clearTimeout,
  };
  vm.createContext(sandbox);
  installEngineAmbient(sandbox);
  vm.runInContext(String(source || ''), sandbox, { filename: 'wrapped-twitch-worker.js' });
  for (const message of queuedMessages || []) {
    const event = { data: message };
    for (const listener of listeners.slice()) listener(event);
  }
  return { fetch: workerGlobal.fetch, state };
}

function createWorkerFetchHarness(nativeFetch, enabled) {
  const page = createPageHarness();
  const worker = new page.window.Worker('blob:https://www.twitch.tv/worker-fetch-ads-fixture');
  const wrapper = page.state.blobSources.get(worker.url) || '';
  assert(wrapper, 'FetchAds worker fixture was not wrapped');
  const queuedMessages = enabled === false ? [{
    __woTwitchAdblock: page.window.__wardenOneTwitchAdblockReady,
    type: 'config',
    enabled: false,
  }] : [];
  return executeWorkerWrapper(wrapper, queuedMessages, nativeFetch);
}

const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

function fetchAdsOperation(kind) {
  return {
    operationName: 'FetchAdsService_FetchAds',
    variables: {
      input: {
        playerContext: { contentType: 'LIVE', playerType: 'site' },
        rollType: kind || 'PREROLL',
      },
    },
  };
}

function playbackTokenOperation(playerType, platform, retained) {
  return {
    operationName: 'PlaybackAccessToken',
    variables: {
      isLive: true,
      login: 'fixturechannel',
      isVod: false,
      vodID: '',
      playerType: playerType,
      platform: platform,
      retained: retained || 'yes',
    },
    extensions: { persistedQuery: { version: 1, sha256Hash: 'captured-token-hash' } },
  };
}

function deniedPlaybackToken() {
  return { data: { streamPlaybackAccessToken: null, videoPlaybackAccessToken: null } };
}

function mixedPipFailureBody() {
  return JSON.stringify([
    { operationName: 'ChannelShell', variables: { login: 'fixturechannel' } },
    playbackTokenOperation('picture-by-picture', 'web', 'pip'),
    playbackTokenOperation('site', 'android', 'ordinary'),
  ]);
}

function assertMixedPipSubsetDispatchedOnce(harness, label) {
  assert(harness.state.fetchCalls.length === 1,
    label + ' replayed the already-dispatched mixed-token subset');
  const call = harness.state.fetchCalls[0];
  const forwarded = JSON.parse(call.init && call.init.body || 'null');
  assert(Array.isArray(forwarded) && forwarded.length === 2,
    label + ' did not dispatch exactly the non-PiP subset');
  assert(forwarded.every((entry) =>
    !/picture-by-picture/i.test(String(entry && entry.variables && entry.variables.playerType || ''))),
  label + ' leaked a PiP token onto the native request');
}

function videoAdDeclineOperation() {
  return {
    operationName: 'VideoAdRequestDecline',
    variables: {
      context: {
        adSessionID: 'fixture-ad-session',
        playerContext: { playerType: 'site', contentType: 'LIVE' },
        rollType: 'PREROLL',
        adFormat: 'STANDARD_VIDEO',
      },
    },
  };
}

function nativeVideoAdDecline(id) {
  return {
    data: {
      adContext: {
        id: id,
        radToken: 'native-rad-token-' + id,
        declineState: { reason: 'reason_native', shouldDecline: false },
      },
    },
  };
}

function gqlJson(value) {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function fetchedVideoAd(id) {
  return {
    data: {
      fetchAds: {
        requestID: 'request-' + id,
        ads: {
          __typename: 'FetchedVideoAd',
          format: 'STANDARD_VIDEO',
          vast: '<VAST version="3.0"><Ad id="' + id + '"><InLine/></Ad></VAST>',
        },
      },
    },
  };
}

function fetchedDisplayAd(id) {
  return {
    data: {
      fetchAds: {
        requestID: 'request-' + id,
        ads: {
          __typename: 'FetchedDisplayAd',
          ads: [{
            id: id,
            format: 'SQUEEZEBACK',
            html: '<iframe src="https://ads.example/' + id + '"></iframe>',
            impressionURL: 'https://ads.example/impression/' + id,
          }],
        },
      },
    },
  };
}

function assertFetchAdsNoFill(value, label) {
  const data = value && value.data;
  assert(data && Object.prototype.hasOwnProperty.call(data, 'fetchAds'),
    label + ' did not return a GraphQL FetchAds result');
  const fetchAds = data.fetchAds;
  const noFill = fetchAds === null || (fetchAds &&
    Object.prototype.hasOwnProperty.call(fetchAds, 'ads') && fetchAds.ads === null);
  assert(noFill, label + ' did not replace the creative with GraphQL-safe no-fill');
  const encoded = JSON.stringify(value);
  assert(!/<VAST|FetchedVideoAd|FetchedDisplayAd|<iframe|impressionURL/i.test(encoded),
    label + ' still exposed executable ad creative data');
}

function assertVideoAdDecline(value, label) {
  const context = value && value.data && value.data.adContext;
  assert(context && typeof context.id === 'string' && context.id,
    label + ' did not return an adContext id');
  assert(context.radToken === null, label + ' did not clear the RAD token');
  equal(context.declineState, { reason: 'reason_ratelimit', shouldDecline: true },
    label + ' returned the wrong decline state');
}

function videoPresentation(video) {
  const styles = {};
  for (const property of ['display', 'visibility', 'pointer-events']) {
    styles[property] = {
      value: video.style.getPropertyValue(property),
      priority: video.style.getPropertyPriority(property),
    };
  }
  return {
    styles,
    defaultMuted: video.defaultMuted,
    muted: video.muted,
    volume: video.volume,
    guardAttribute: video.getAttribute('data-wo-twitch-independent-ad'),
  };
}

function assertGuarded(video, label) {
  for (const [property, value] of [
    ['display', 'none'],
    ['visibility', 'hidden'],
    ['pointer-events', 'none'],
  ]) {
    assert(video.style.getPropertyValue(property) === value, label + ' did not set ' + property);
    assert(video.style.getPropertyPriority(property) === 'important',
      label + ' did not make ' + property + ' important');
  }
  assert(video.defaultMuted === true, label + ' did not set defaultMuted');
  assert(video.muted === true, label + ' did not mute');
  assert(video.volume === 0, label + ' did not zero volume');
  assert(video.getAttribute('data-wo-twitch-independent-ad') === 'true',
    label + ' omitted the guard marker attribute');
}

function assertDetachedCleanup(video, original, label) {
  assert(video.pauseCalls === 1, label + ' did not pause the detached ad exactly once');
  assert(video.operations.length > 1 && video.operations[0].type === 'pause',
    label + ' restored presentation state before pausing detached media');
  equal(videoPresentation(video), original, label + ' did not restore exact original presentation state');
  assert(video.style.getPropertyValue('display') !== 'none' &&
    video.style.getPropertyValue('visibility') !== 'hidden',
  label + ' left reused media hidden');
  assert(video.muted === original.muted && video.defaultMuted === original.defaultMuted &&
    video.volume === original.volume,
  label + ' left reused media silent');
}

test('manifest injects the dedicated Twitch module in MAIN at document_start', () => {
  const entries = (MANIFEST.content_scripts || []).filter((entry) =>
    Array.isArray(entry.js) && entry.js.includes('twitch-adblock.js'));
  assert(entries.length === 1, 'manifest must have exactly one twitch-adblock.js content-script entry');
  const entry = entries[0];
  assert((entry.matches || []).includes('*://*.twitch.tv/*'), 'Twitch manifest match is missing');
  assert(entry.run_at === 'document_start', 'Twitch module must run at document_start');
  assert(entry.all_frames === true, 'Twitch module must be injected with all_frames');
  assert(entry.world === 'MAIN', 'Twitch module must run in the MAIN world');
  assert(entry.match_origin_as_fallback === true, 'Twitch module must cover Twitch-origin fallback frames');
});

test('legacy worker hook and watchdog remain hard-disabled', () => {
  const sourceGates = LEGACY_SOURCE.match(/if\(!1&&WO\.twitchAdBlock/g) || [];
  const runtimeGates = LEGACY_RUNTIME.match(/if\(!1&&WO\.twitchAdBlock/g) || [];
  assert(sourceGates.length === 2,
    'src/content.js must hard-disable both the legacy worker hook and legacy watchdog');
  assert(runtimeGates.length === 2,
    'content.min.js must ship both legacy Twitch blocks behind constant-false gates');
  assert(MODULE_SOURCE.includes('function twitchWorkerRuntime('),
    'dedicated module no longer contains the current worker runtime');
  assert(!MODULE_SOURCE.includes('__woTwWatch') && !MODULE_SOURCE.includes('installTwitchHook'),
    'dedicated module accidentally reintroduced a legacy Twitch hook/watchdog');
});

test('page hook forces the current primary-channel token to popout/web while retaining template state', async () => {
  const harness = createPageHarness();
  const unrelated = {
    operationName: 'ChannelShell',
    variables: { login: 'fixturechannel' },
    extensions: { persistedQuery: { version: 1, sha256Hash: 'unrelated-hash' } },
  };
  const token = playbackTokenOperation('site', 'android');
  const originalBody = JSON.stringify([unrelated, token]);
  await harness.window.fetch('https://gql.twitch.tv/gql', {
    method: 'POST',
    headers: {
      'Client-ID': 'captured-client-id',
      'X-Device-Id': 'captured-device-id',
      'Client-Version': 'captured-client-version',
      'Client-Session-Id': 'captured-session-id',
      'Client-Integrity': 'captured-integrity',
      Authorization: 'OAuth captured-authorization',
    },
    body: originalBody,
  });

  assert(harness.state.fetchCalls.length === 1, 'page GQL hook made extra requests');
  const forwarded = harness.state.fetchCalls[0].init;
  assert(typeof forwarded.body === 'string' && forwarded.body.length > 2,
    'GQL template capture corrupted the request into an empty body');
  assert(forwarded.body !== originalBody, 'ordinary token retained the ad-auction player identity');
  const parsed = JSON.parse(forwarded.body);
  assert(Array.isArray(parsed) && parsed.length === 2, 'mixed GQL batch shape changed');
  equal(parsed[0], unrelated, 'non-token query in GQL batch was modified');
  assert(parsed[1].variables.playerType === 'popout', 'ordinary token was not forced to popout');
  assert(parsed[1].variables.platform === 'web', 'ordinary token was not forced to the web platform');
  assert(parsed[1].variables.retained === 'yes', 'token-specific variables were discarded');
  assert(parsed[1].extensions.persistedQuery.sha256Hash === 'captured-token-hash',
    'captured persisted-query hash was changed');

  const worker = new harness.window.Worker('blob:https://www.twitch.tv/fixture-player-worker');
  assert(worker instanceof harness.NativeWorker, 'dedicated wrapper did not construct the native worker');
  assert(/^blob:wardenone-twitch-/.test(worker.url), 'Twitch worker was not wrapped (url=' + worker.url +
    ', instances=' + harness.state.workerInstances.length + ', blobs=' + harness.state.blobSources.size + ')');
  const wrapper = harness.state.blobSources.get(worker.url) || '';
  // The worker blob carries only the PUBLIC token state (hash/template). The
  // sensitive page identity (Client-ID, device id, Authorization, integrity,
  // session) is deliberately kept on the page and proxied to the worker on
  // demand via 'gql-request' -- it must never be baked into the worker blob.
  assert(wrapper.includes(JSON.stringify('captured-token-hash')),
    'worker blob did not carry the captured public token hash');
  for (const secret of [
    'captured-client-id',
    'captured-device-id',
    'captured-client-version',
    'captured-session-id',
    'captured-integrity',
    'captured-authorization',
  ]) {
    assert(!wrapper.includes(secret), 'worker blob leaked page identity into the worker: ' + secret);
  }

  const proxyBody = {
    operationName: 'PlaybackAccessToken',
    variables: {
      isLive: true,
      isVod: false,
      login: 'fixturechannel',
      playerType: 'mobile_feed',
      platform: 'android',
    },
    extensions: { persistedQuery: { version: 1, sha256Hash: 'captured-token-hash' } },
  };
  worker.dispatchEvent({
    type: 'message',
    data: {
      __woTwitchAdblock: harness.window.__wardenOneTwitchAdblockReady,
      type: 'gql-request',
      id: 'fixture-proxy-request',
      body: proxyBody,
    },
    stopImmediatePropagation() {},
  });
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));

  assert(harness.state.fetchCalls.length === 2, 'worker GQL proxy did not make exactly one page fetch');
  const proxied = harness.state.fetchCalls[1];
  assert(proxied.input === 'https://gql.twitch.tv/gql', 'worker GQL proxy used the wrong endpoint');
  assert(proxied.init && proxied.init.method === 'POST', 'worker GQL proxy was not a POST');
  assert(proxied.init.credentials === 'omit', 'worker GQL proxy must omit browser credentials');
  equal(JSON.parse(proxied.init.body), proxyBody, 'worker GQL proxy changed the requested token body');
  const proxyHeaders = new Headers(proxied.init.headers);
  for (const [name, value] of [
    ['Client-ID', 'captured-client-id'],
    ['X-Device-Id', 'captured-device-id'],
    ['Client-Version', 'captured-client-version'],
    ['Client-Session-Id', 'captured-session-id'],
    ['Client-Integrity', 'captured-integrity'],
    ['Authorization', 'OAuth captured-authorization'],
  ]) {
    assert(proxyHeaders.get(name) === value, 'worker GQL proxy lost captured ' + name);
  }
  assert(worker.messages.some((message) => message && message.type === 'gql-response' &&
    message.id === 'fixture-proxy-request' && message.response && message.response.status === 200),
  'page proxy did not return the GQL response to the requesting worker');
});

test('embed, preview, and off-channel tokens remain byte-for-byte native', async () => {
  const offChannel = playbackTokenOperation('site', 'android', 'off-channel');
  offChannel.variables.login = 'previewchannel';
  const cases = [
    ['embed', playbackTokenOperation('embed', 'android', 'embed')],
    ['preview', playbackTokenOperation('preview', 'android', 'preview')],
    ['off-channel', offChannel],
  ];
  for (const [label, operation] of cases) {
    const harness = createPageHarness();
    const body = JSON.stringify(operation);
    const init = {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Fixture-Header': label },
      body,
    };
    await harness.window.fetch('https://gql.twitch.tv/gql', init);
    assert(harness.state.fetchCalls.length === 1,
      label + ' token was swallowed or replayed');
    const forwarded = harness.state.fetchCalls[0];
    assert(forwarded.init === init && forwarded.init.body === body,
      label + ' token was rewritten instead of passing through byte-for-byte');
    assert(new Headers(forwarded.init.headers).get('X-Fixture-Header') === label,
      label + ' token lost caller headers');
  }
});

test('all picture-by-picture token requests settle locally with matching response shape', async () => {
  const harness = createPageHarness();
  const singleBody = JSON.stringify(playbackTokenOperation('picture-by-picture', 'web'));
  const singleInit = {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Fixture-Header': 'single' },
    body: singleBody,
  };
  const singleResponse = await harness.window.fetch('https://gql.twitch.tv/gql', singleInit);
  equal(await singleResponse.json(), deniedPlaybackToken(),
    'single picture-by-picture token did not return a local null token');
  assert(singleInit.body === singleBody, 'single picture-by-picture handling mutated caller init');
  assert(harness.state.fetchCalls.length === 0,
    'single picture-by-picture token reached the native network');

  const batchBody = JSON.stringify([
    playbackTokenOperation('picture-by-picture', 'web', 'first'),
    playbackTokenOperation('Picture-By-Picture', 'android', 'second'),
  ]);
  const request = new Request('https://gql.twitch.tv/gql', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Fixture-Header': 'batch' },
    body: batchBody,
  });
  const batchResponse = await harness.window.fetch(request);
  equal(await batchResponse.json(), [deniedPlaybackToken(), deniedPlaybackToken()],
    'all-picture-by-picture batch did not preserve its array shape');
  assert(request.bodyUsed === false,
    'local all-picture-by-picture handling consumed the caller-owned Request body');
  assert(request.headers.get('X-Fixture-Header') === 'batch',
    'local all-picture-by-picture handling changed caller Request headers');
  assert(harness.state.fetchCalls.length === 0,
    'all-picture-by-picture Request reached the native network');
});

test('mixed picture-by-picture token batches preserve order and Request semantics', async () => {
  const channelResult = { data: { channelShell: { login: 'fixturechannel' } } };
  const ordinaryTokenResult = {
    data: { streamPlaybackAccessToken: { value: 'ordinary-token', signature: 'ordinary-signature' } },
  };
  const identityResult = { data: { connectAdIdentity: { opaqueIdentity: 'fixture-identity' } } };
  let nativeBody = '';
  const harness = createPageHarness(null, {
    async nativeFetch(input, init) {
      nativeBody = input instanceof Request ? await input.clone().text() : String(init && init.body || '');
      return new Response(JSON.stringify([channelResult, ordinaryTokenResult, identityResult]), {
        status: 200,
        statusText: 'Fixture OK',
        headers: { 'content-type': 'application/json', 'x-fixture-response': 'preserved' },
      });
    },
  });
  const unrelatedBefore = { operationName: 'ChannelShell', variables: { login: 'fixturechannel' } };
  const pipToken = playbackTokenOperation('picture-by-picture', 'web', 'pip');
  const ordinaryToken = playbackTokenOperation('site', 'android', 'ordinary');
  const unrelatedAfter = {
    operationName: 'ConnectAdIdentityMutation',
    variables: { opaqueIdentity: 'fixture' },
  };
  const originalBatch = [unrelatedBefore, pipToken, ordinaryToken, unrelatedAfter];
  const originalBody = JSON.stringify(originalBatch);
  const controller = new AbortController();
  const request = new Request('https://gql.twitch.tv/gql', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Fixture-Header': 'preserve-me' },
    body: originalBody,
    signal: controller.signal,
  });

  const response = await harness.window.fetch(request);
  assert(request.bodyUsed === false, 'mixed-token handling consumed the caller-owned Request body');
  assert(harness.state.fetchCalls.length === 1,
    'mixed-token handling duplicated or swallowed the native batch');
  const forwarded = harness.state.fetchCalls[0];
  assert(forwarded.input instanceof Request && forwarded.input !== request,
    'mixed-token handling did not use a replacement Request for the rewritten body');
  assert(forwarded.init === undefined, 'mixed-token handling invented a caller init object');
  assert(forwarded.input.method === 'POST' && forwarded.input.url === request.url,
    'mixed-token handling changed Request method or URL');
  assert(forwarded.input.headers.get('X-Fixture-Header') === 'preserve-me',
    'mixed-token handling changed Request headers');
  assert(forwarded.input.signal.aborted === false,
    'mixed-token handling started with an aborted forwarded Request');
  controller.abort();
  assert(forwarded.input.signal.aborted === true,
    'mixed-token handling did not retain caller abort semantics');

  const forwardedBatch = JSON.parse(nativeBody);
  assert(Array.isArray(forwardedBatch) && forwardedBatch.length === 3,
    'mixed-token handling sent the wrong batch shape to Twitch');
  equal(forwardedBatch[0], unrelatedBefore,
    'mixed-token handling changed the entry before the denied token');
  assert(forwardedBatch.every((entry) =>
    !/picture-by-picture/i.test(String(entry && entry.variables && entry.variables.playerType || ''))),
  'picture-by-picture token was forwarded to Twitch');
  assert(forwardedBatch[1].variables.playerType === 'popout' &&
    forwardedBatch[1].variables.platform === 'web',
  'ordinary token in a mixed batch was not forced to popout/web');
  equal(forwardedBatch[2], unrelatedAfter,
    'mixed-token handling changed the entry after the ordinary token');

  assert(response.status === 200 && response.statusText === 'Fixture OK' &&
    response.headers.get('x-fixture-response') === 'preserved',
  'mixed-token response rebuild lost native response metadata');
  equal(await response.json(), [channelResult, deniedPlaybackToken(), ordinaryTokenResult, identityResult],
    'mixed-token response did not restore the original order with a local PiP denial');
});

test('a non-OK mixed-PiP subset response is returned without replaying the original batch', async () => {
  let nativeResponse = null;
  const harness = createPageHarness(null, {
    nativeFetch() {
      nativeResponse = new Response('fixture upstream unavailable', {
        status: 503,
        statusText: 'Fixture Unavailable',
        headers: { 'x-fixture-response': 'non-ok' },
      });
      return nativeResponse;
    },
  });
  const response = await harness.window.fetch('https://gql.twitch.tv/gql', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: mixedPipFailureBody(),
  });

  assertMixedPipSubsetDispatchedOnce(harness, 'non-OK response');
  assert(response === nativeResponse && response.status === 503 &&
    response.statusText === 'Fixture Unavailable' && response.headers.get('x-fixture-response') === 'non-ok',
  'non-OK mixed-PiP handling replaced native response metadata');
  assert(await response.text() === 'fixture upstream unavailable',
    'non-OK mixed-PiP handling changed the native response body');
});

test('a malformed mixed-PiP subset response is returned without replaying the original batch', async () => {
  let nativeResponse = null;
  const malformedBody = '{"fixture":"truncated"';
  const harness = createPageHarness(null, {
    nativeFetch() {
      nativeResponse = new Response(malformedBody, {
        status: 200,
        statusText: 'Fixture Malformed',
        headers: { 'content-type': 'application/json', 'x-fixture-response': 'malformed' },
      });
      return nativeResponse;
    },
  });
  const response = await harness.window.fetch('https://gql.twitch.tv/gql', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: mixedPipFailureBody(),
  });

  assertMixedPipSubsetDispatchedOnce(harness, 'malformed response');
  assert(response === nativeResponse && response.statusText === 'Fixture Malformed' &&
    response.headers.get('x-fixture-response') === 'malformed',
  'malformed mixed-PiP handling replaced native response metadata');
  assert(await response.text() === malformedBody,
    'malformed mixed-PiP handling changed the native response body');
});

test('a rejected mixed-PiP subset request propagates without replaying the original batch', async () => {
  const failure = new Error('fixture native rejection');
  const harness = createPageHarness(null, {
    nativeFetch() { return Promise.reject(failure); },
  });
  let caught = null;
  try {
    await harness.window.fetch('https://gql.twitch.tv/gql', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: mixedPipFailureBody(),
    });
  } catch (error) {
    caught = error;
  }

  assert(caught === failure, 'mixed-PiP rejection did not preserve the native error');
  assertMixedPipSubsetDispatchedOnce(harness, 'rejected request');
});

test('a Request-object AdRequest is byte-preserved and replayed to a replacement worker', async () => {
  const harness = createPageHarness();
  const originalBody = JSON.stringify([{
    operationName: 'AdRequest',
    variables: {
      channelLogin: 'fixturechannel',
      adSessionId: 'fixture-session',
      retained: 'byte-for-byte',
    },
    extensions: { persistedQuery: { version: 1, sha256Hash: 'fixture-ad-hash' } },
  }]);
  const controller = new AbortController();
  const cases = [
    ['without init', undefined],
    ['with empty init', {}],
    ['with signal init', { signal: controller.signal }],
  ];
  for (const [label, init] of cases) {
    const request = new Request('https://gql.twitch.tv/gql', {
      method: 'POST',
      headers: {
        'Client-ID': 'request-client-id',
        'Content-Type': 'application/json',
        'X-Fixture-Header': 'preserve-me',
      },
      body: originalBody,
    });
    const before = harness.state.fetchCalls.length;
    await harness.window.fetch(request, init);
    assert(request.bodyUsed === false, label + ' consumed the caller-owned Request body');
    assert(harness.state.fetchCalls.length === before + 1, label + ' duplicated the Request-object GQL');
    const forwarded = harness.state.fetchCalls.at(-1);
    assert(forwarded.init === init, label + ' replaced the caller init object');
    assert(forwarded.input instanceof Request, label + ' was not forwarded as a Request');
    assert(forwarded.input.method === request.method && forwarded.input.url === request.url,
      label + ' changed the Request method or URL');
    assert(forwarded.input.headers.get('X-Fixture-Header') === 'preserve-me',
      label + ' changed the Request headers');
    assert(await forwarded.input.clone().text() === originalBody,
      label + ' changed the Request body bytes');
  }

  const replacement = new harness.window.Worker('blob:https://www.twitch.tv/request-ad-replacement');
  replacement.dispatchEvent({
    type: 'message',
    data: { __woTwitchAdblock: harness.window.__wardenOneTwitchAdblockReady, type: 'ready' },
    stopImmediatePropagation() {},
  });
  assert(replacement.messages.some((message) => message && message.type === 'ad-imminent'),
    'Request-object AdRequest was not replayed to the replacement worker');
});

test('current FetchAdsService warns the worker while identity cookie sync stays passive', async () => {
  const harness = createPageHarness();
  const worker = new harness.window.Worker('blob:https://www.twitch.tv/fetch-ads-warning-worker');
  worker.dispatchEvent({
    type: 'message',
    data: { __woTwitchAdblock: harness.window.__wardenOneTwitchAdblockReady, type: 'ready' },
    stopImmediatePropagation() {},
  });
  const warnings = () => worker.messages.filter((message) => message && message.type === 'ad-imminent').length;
  const before = warnings();
  const fetchAdsBody = JSON.stringify({
    operationName: 'FetchAdsService_FetchAds',
    variables: { channelLogin: 'fixturechannel' },
  });
  await harness.window.fetch('https://gql.twitch.tv/gql', { method: 'POST', body: fetchAdsBody });
  assert(warnings() > before, 'current FetchAdsService operation did not arm the early clean stream');
  const afterFetchAds = warnings();

  const identityBody = JSON.stringify({
    operationName: 'ConnectAdIdentityMutation',
    variables: { opaqueIdentity: 'fixture' },
  });
  await harness.window.fetch('https://gql.twitch.tv/gql', { method: 'POST', body: identityBody });
  assert(warnings() === afterFetchAds, 'identity cookie sync incorrectly armed live-stream withholding');
  assert(harness.state.fetchCalls.length === 1 &&
    harness.state.fetchCalls[0].init.body === identityBody,
  'identity-cookie detection changed or duplicated the native GQL request');
});

test('FetchAdsService video and display creatives settle as GraphQL no-fill', async () => {
  const fixtures = [
    { label: 'video VAST', response: fetchedVideoAd('single-video') },
    { label: 'display HTML', response: fetchedDisplayAd('single-display') },
  ];
  for (const fixture of fixtures) {
    const harness = createPageHarness(null, {
      nativeFetch() { return gqlJson(fixture.response); },
    });
    const worker = new harness.window.Worker('blob:https://www.twitch.tv/fetch-ads-' +
      fixture.label.replace(/\W+/g, '-'));
    worker.dispatchEvent({
      type: 'message',
      data: { __woTwitchAdblock: harness.window.__wardenOneTwitchAdblockReady, type: 'ready' },
      stopImmediatePropagation() {},
    });
    const requestBody = JSON.stringify(fetchAdsOperation('PREROLL'));
    const response = await harness.window.fetch('https://gql.twitch.tv/gql', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: requestBody,
    });
    assert(response.status === 200, fixture.label + ' no-fill changed the successful GQL status');
    assertFetchAdsNoFill(await response.json(), fixture.label);
    assert(harness.state.fetchCalls.length <= 1,
      fixture.label + ' response handling duplicated the native GQL request');
    if (harness.state.fetchCalls.length) {
      assert(harness.state.fetchCalls[0].init.body === requestBody,
        fixture.label + ' response handling changed the native request body');
    }
    assert(worker.messages.some((message) => message && message.type === 'ad-imminent'),
      fixture.label + ' did not arm the clean-stream fallback');
  }
});

test('a mixed GQL batch redacts only FetchAdsService and preserves result order', async () => {
  const channelResult = { data: { channelShell: { id: 'channel-result', login: 'fixturechannel' } } };
  const identityResult = { data: { connectAdIdentity: { opaqueIdentity: 'identity-result' } } };
  const nativeBatch = [channelResult, fetchedVideoAd('batched-video'), identityResult];
  const harness = createPageHarness(null, {
    nativeFetch() { return gqlJson(nativeBatch); },
  });
  const requestBatch = [
    { operationName: 'ChannelShell', variables: { login: 'fixturechannel' } },
    fetchAdsOperation('PREROLL'),
    { operationName: 'ConnectAdIdentityMutation', variables: { opaqueIdentity: 'fixture' } },
  ];
  const requestBody = JSON.stringify(requestBatch);
  const response = await harness.window.fetch('https://gql.twitch.tv/gql', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: requestBody,
  });
  const result = await response.json();
  assert(Array.isArray(result) && result.length === nativeBatch.length,
    'mixed GQL no-fill changed the response batch length');
  equal(result[0], channelResult, 'mixed GQL no-fill changed the result before FetchAdsService');
  assertFetchAdsNoFill(result[1], 'batched video VAST');
  equal(result[2], identityResult, 'mixed GQL no-fill changed the result after FetchAdsService');
  assert(harness.state.fetchCalls.length === 1, 'mixed GQL no-fill duplicated or swallowed the native batch');
  assert(harness.state.fetchCalls[0].init.body === requestBody,
    'mixed GQL no-fill changed the native request bytes');
});

test('a Request-object FetchAds body stays unconsumed while its response becomes no-fill', async () => {
  const harness = createPageHarness(null, {
    nativeFetch() { return gqlJson(fetchedVideoAd('request-object-video')); },
  });
  const requestBody = JSON.stringify(fetchAdsOperation('PREROLL'));
  const request = new Request('https://gql.twitch.tv/gql', {
    method: 'POST',
    headers: {
      'Client-ID': 'request-client-id',
      'Content-Type': 'application/json',
      'X-Fixture-Header': 'preserve-me',
    },
    body: requestBody,
  });
  const response = await harness.window.fetch(request);
  assert(request.bodyUsed === false, 'FetchAds response handling consumed the caller-owned Request body');
  assertFetchAdsNoFill(await response.json(), 'Request-object video VAST');
  assert(harness.state.fetchCalls.length <= 1,
    'Request-object FetchAds response handling duplicated the native request');
  if (harness.state.fetchCalls.length) {
    const forwarded = harness.state.fetchCalls[0];
    assert(forwarded.input === request, 'Request-object FetchAds replaced the caller Request');
    assert(await forwarded.input.clone().text() === requestBody,
      'Request-object FetchAds changed the forwarded body bytes');
    assert(forwarded.input.headers.get('X-Fixture-Header') === 'preserve-me',
      'Request-object FetchAds changed caller headers');
  }
});

test('identity GQL and config-off FetchAds responses remain untouched', async () => {
  const identityResult = { data: { connectAdIdentity: { opaqueIdentity: 'native-identity-result' } } };
  const identityHarness = createPageHarness(null, {
    nativeFetch() { return gqlJson(identityResult); },
  });
  const identityWorker = new identityHarness.window.Worker('blob:https://www.twitch.tv/identity-pass-through');
  identityWorker.dispatchEvent({
    type: 'message',
    data: { __woTwitchAdblock: identityHarness.window.__wardenOneTwitchAdblockReady, type: 'ready' },
    stopImmediatePropagation() {},
  });
  const identityBody = JSON.stringify({
    operationName: 'ConnectAdIdentityMutation',
    variables: { opaqueIdentity: 'fixture' },
  });
  const identityResponse = await identityHarness.window.fetch('https://gql.twitch.tv/gql', {
    method: 'POST',
    body: identityBody,
  });
  equal(await identityResponse.json(), identityResult, 'identity-cookie response was redacted as an ad creative');
  assert(identityHarness.state.fetchCalls.length === 1 &&
    identityHarness.state.fetchCalls[0].init.body === identityBody,
  'identity-cookie request was swallowed, duplicated, or changed');
  assert(!identityWorker.messages.some((message) => message && message.type === 'ad-imminent'),
    'identity-cookie request armed the clean-stream fallback');

  const disabledAdResult = fetchedVideoAd('config-off-video');
  const disabledHarness = createPageHarness({ twitchAdBlock: false }, {
    nativeFetch() { return gqlJson(disabledAdResult); },
  });
  const disabledBody = JSON.stringify(fetchAdsOperation('PREROLL'));
  const disabledResponse = await disabledHarness.window.fetch('https://gql.twitch.tv/gql', {
    method: 'POST',
    body: disabledBody,
  });
  equal(await disabledResponse.json(), disabledAdResult,
    'config-off FetchAds response was changed instead of passing through');
  assert(disabledHarness.state.fetchCalls.length === 1 &&
    disabledHarness.state.fetchCalls[0].init.body === disabledBody,
  'config-off FetchAds request was swallowed, duplicated, or changed');
});

test('page VideoAdRequestDecline settles locally and warns the current channel', async () => {
  const harness = createPageHarness(null, {
    nativeFetch() { return gqlJson(nativeVideoAdDecline('unexpected-native-page')); },
  });
  const worker = new harness.window.Worker('blob:https://www.twitch.tv/page-video-ad-decline');
  worker.dispatchEvent({
    type: 'message',
    data: { __woTwitchAdblock: harness.window.__wardenOneTwitchAdblockReady, type: 'ready' },
    stopImmediatePropagation() {},
  });
  const warnings = () => worker.messages.filter((message) => message && message.type === 'ad-imminent');
  const before = warnings().length;
  const requestBody = JSON.stringify(videoAdDeclineOperation());
  const response = await harness.window.fetch('https://gql.twitch.tv/gql', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: requestBody,
  });

  assert(response.status === 200, 'page decline contract changed the successful GQL status');
  assertVideoAdDecline(await response.json(), 'page VideoAdRequestDecline');
  assert(harness.state.fetchCalls.length === 0,
    'page VideoAdRequestDecline reached the native network instead of settling locally');
  const armedWarnings = warnings().slice(before);
  assert(armedWarnings.length > 0 && armedWarnings.every((message) => message.channel === 'fixturechannel'),
    'page VideoAdRequestDecline did not arm the current channel warning');
});

test('page mixed GQL batches replace only VideoAdRequestDecline and preserve unrelated entries', async () => {
  const channelResult = { data: { channelShell: { id: 'decline-page-channel', login: 'fixturechannel' } } };
  const identityResult = { data: { connectAdIdentity: { opaqueIdentity: 'decline-page-identity' } } };
  const nativeBatch = [channelResult, nativeVideoAdDecline('native-page-batch'), identityResult];
  const harness = createPageHarness(null, {
    nativeFetch() { return gqlJson(nativeBatch); },
  });
  const worker = new harness.window.Worker('blob:https://www.twitch.tv/page-mixed-video-ad-decline');
  worker.dispatchEvent({
    type: 'message',
    data: { __woTwitchAdblock: harness.window.__wardenOneTwitchAdblockReady, type: 'ready' },
    stopImmediatePropagation() {},
  });
  const warningsBefore = worker.messages.filter((message) => message && message.type === 'ad-imminent').length;
  const requestBatch = [
    { operationName: 'ChannelShell', variables: { login: 'fixturechannel' } },
    videoAdDeclineOperation(),
    { operationName: 'ConnectAdIdentityMutation', variables: { opaqueIdentity: 'fixture' } },
  ];
  const requestBody = JSON.stringify(requestBatch);
  const response = await harness.window.fetch('https://gql.twitch.tv/gql', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: requestBody,
  });
  const result = await response.json();

  assert(Array.isArray(result) && result.length === nativeBatch.length,
    'page mixed decline response changed the batch length');
  equal(result[0], channelResult, 'page mixed decline changed the result before VideoAdRequestDecline');
  assertVideoAdDecline(result[1], 'page batched VideoAdRequestDecline');
  equal(result[2], identityResult, 'page mixed decline changed the result after VideoAdRequestDecline');
  assert(harness.state.fetchCalls.length === 1 && harness.state.fetchCalls[0].init.body === requestBody,
    'page mixed decline duplicated, swallowed, or changed the native batch');
  assert(worker.messages.filter((message) => message && message.type === 'ad-imminent').length > warningsBefore,
    'page mixed decline did not arm an early warning');
});

test('config-off page VideoAdRequestDecline remains byte- and response-preserving', async () => {
  const nativeResult = nativeVideoAdDecline('native-page-config-off');
  const harness = createPageHarness({ twitchAdBlock: false }, {
    nativeFetch() { return gqlJson(nativeResult); },
  });
  const requestBody = JSON.stringify(videoAdDeclineOperation());
  const response = await harness.window.fetch('https://gql.twitch.tv/gql', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: requestBody,
  });

  equal(await response.json(), nativeResult,
    'config-off page VideoAdRequestDecline response was changed instead of passing through');
  assert(harness.state.fetchCalls.length === 1 && harness.state.fetchCalls[0].init.body === requestBody,
    'config-off page VideoAdRequestDecline request was swallowed, duplicated, or changed');
});

test('Twitch AdManager is declined with the exact player-size contract and follows config lifecycle', () => {
  let manager;
  const calls = [];
  const harness = createPageHarness(null, {
    fakeClock: true,
    now: 1000,
    configureWindow(window) {
      manager = function FixtureAdManager() {};
      manager.startProcessingRequests = function startProcessingRequests() {};
      manager.declineReason = null;
      manager.decline = function decline(reason, options) {
        calls.push({ reason, options });
        manager.declineReason = reason;
      };
      exposeWebpackAdManager(window, manager);
    },
  });

  equal(calls, [{ reason: 'player_size', options: { sendEvent: false } }],
    'AdManager decline used the wrong Twitch reason or event option');
  assert(manager.declineReason === 'player_size',
    'AdManager fixture did not enter the declined state');
  assert(!harness.state.timeouts.some((timer) => !timer.cleared && !timer.fired && timer.ms === 500),
    'successful AdManager discovery left the retry loop armed');

  harness.window.__WO_CONFIG__.twitchAdBlock = false;
  harness.document.dispatchEvent({ type: 'wo-config-change', target: harness.document });
  assert(manager.declineReason === null,
    'config-off did not release the player_size decline owned by WardenOne');
  assert(calls.length === 1, 'config-off issued another AdManager decline');

  harness.window.__WO_CONFIG__.twitchAdBlock = true;
  harness.document.dispatchEvent({ type: 'wo-config-change', target: harness.document });
  equal(calls[1], { reason: 'player_size', options: { sendEvent: false } },
    'config-on did not reapply the exact AdManager decline contract');

  manager.declineReason = 'twitch_owned_reason';
  harness.window.__WO_CONFIG__.twitchAdBlock = false;
  harness.document.dispatchEvent({ type: 'wo-config-change', target: harness.document });
  assert(manager.declineReason === 'twitch_owned_reason',
    'config-off erased an AdManager decline reason WardenOne did not own');
  harness.window.__WO_CONFIG__.twitchAdBlock = true;
  harness.document.dispatchEvent({ type: 'wo-config-change', target: harness.document });
  assert(calls.length === 2,
    'config-on overrode an existing Twitch-owned AdManager decline');
});

test('Twitch AdManager discovery searches later webpackChunk runtimes', () => {
  const calls = [];
  let firstQueue;
  let laterQueue;
  const harness = createPageHarness(null, {
    fakeClock: true,
    now: 1000,
    configureWindow(window) {
      function ordinaryRequire(id) {
        if (id !== 'ordinary-module') throw new Error('unknown ordinary module');
        return { ordinaryExport: function ordinaryExport() {} };
      }
      ordinaryRequire.m = {
        'ordinary-module': function ordinaryModuleFactory() { return 'ordinary-module'; },
      };
      firstQueue = exposeWebpackRuntime(window, 'webpackChunkAFirst', ordinaryRequire);

      function LaterAdManager() {}
      LaterAdManager.startProcessingRequests = function startProcessingRequests() {};
      LaterAdManager.declineReason = null;
      LaterAdManager.decline = function decline(reason, options) {
        calls.push({ reason, options });
        LaterAdManager.declineReason = reason;
      };
      exposeWebpackAdManager(window, LaterAdManager, 'webpackChunkZLater');
      laterQueue = window.webpackChunkZLater;
    },
  });

  equal(calls, [{ reason: 'player_size', options: { sendEvent: false } }],
    'AdManager in a later webpack runtime was not declined');
  assert(firstQueue.length === 1 && laterQueue.length === 1,
    'AdManager discovery did not inspect each webpackChunk runtime exactly once');
  assert(!harness.state.timeouts.some((timer) => !timer.cleared && !timer.fired && timer.ms === 500),
    'later-runtime AdManager discovery left its retry timer armed');
});

test('Twitch AdManager discovery retries are bounded and can be rearmed by config', () => {
  const harness = createPageHarness(null, { fakeClock: true, now: 1000 });
  for (let attempt = 1; attempt < 240; attempt++) harness.advance(500);
  const retryTimers = harness.state.timeouts.filter((timer) => timer.ms === 500);
  assert(retryTimers.length === 239 && retryTimers.every((timer) => timer.fired),
    'AdManager discovery did not stop after its bounded 240 attempts');
  const timersAtBound = harness.state.timeouts.length;
  harness.advance(5000);
  assert(harness.state.timeouts.length === timersAtBound,
    'AdManager discovery scheduled work after reaching its retry bound');

  const calls = [];
  function LateAdManager() {}
  LateAdManager.startProcessingRequests = function startProcessingRequests() {};
  LateAdManager.declineReason = null;
  LateAdManager.decline = function decline(reason, options) {
    calls.push({ reason, options });
    LateAdManager.declineReason = reason;
  };
  exposeWebpackAdManager(harness.window, LateAdManager);
  harness.window.__WO_CONFIG__.twitchAdBlock = false;
  harness.document.dispatchEvent({ type: 'wo-config-change', target: harness.document });
  harness.window.__WO_CONFIG__.twitchAdBlock = true;
  harness.document.dispatchEvent({ type: 'wo-config-change', target: harness.document });
  equal(calls, [{ reason: 'player_size', options: { sendEvent: false } }],
    'config cycle did not rearm bounded AdManager discovery');
});

test('worker-originated FetchAdsService settles locally without exposing a VAST creative', async () => {
  const nativeAdResult = fetchedVideoAd('worker-single-video');
  const runtime = createWorkerFetchHarness(() => gqlJson(nativeAdResult), true);
  const requestBody = JSON.stringify(fetchAdsOperation('PREROLL'));
  const response = await runtime.fetch('https://gql.twitch.tv/gql', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: requestBody,
  });

  assert(response.status === 200, 'worker FetchAds no-fill changed the successful GQL status');
  assertFetchAdsNoFill(await response.json(), 'worker-originated video VAST');
  assert(runtime.state.calls.length === 0,
    'all-FetchAds worker request reached the native network instead of settling locally');
});

test('worker-originated FetchAds preserves a nested input.channel.login warning hint', async () => {
  const targetChannel = 'guang233';
  const runtime = createWorkerFetchHarness(() => gqlJson(fetchedVideoAd('unexpected-nested-worker')), true);
  const operation = fetchAdsOperation('PREROLL');
  operation.variables.input.channel = { login: targetChannel };
  const requestBody = JSON.stringify(operation);
  const response = await runtime.fetch('https://gql.twitch.tv/gql', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: requestBody,
  });

  assertFetchAdsNoFill(await response.json(), 'worker nested target-channel FetchAds');
  assert(runtime.state.calls.length === 0,
    'worker nested target-channel FetchAds reached native network instead of settling locally');
  const warnings = runtime.state.messages.filter((message) => message && message.type === 'ad-imminent');
  assert(warnings.length === 1 && warnings[0].channel === targetChannel,
    'worker FetchAds lost its nested input.channel.login warning hint');
});

test('worker-originated mixed GQL batches redact only FetchAdsService and preserve result order', async () => {
  const channelResult = { data: { channelShell: { id: 'worker-channel', login: 'fixturechannel' } } };
  const identityResult = { data: { connectAdIdentity: { opaqueIdentity: 'worker-identity' } } };
  const nativeBatch = [channelResult, fetchedVideoAd('worker-batched-video'), identityResult];
  const runtime = createWorkerFetchHarness(() => gqlJson(nativeBatch), true);
  const requestBatch = [
    { operationName: 'ChannelShell', variables: { login: 'fixturechannel' } },
    fetchAdsOperation('PREROLL'),
    { operationName: 'ConnectAdIdentityMutation', variables: { opaqueIdentity: 'fixture' } },
  ];
  const requestBody = JSON.stringify(requestBatch);
  const response = await runtime.fetch('https://gql.twitch.tv/gql', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: requestBody,
  });
  const result = await response.json();

  assert(Array.isArray(result) && result.length === nativeBatch.length,
    'worker mixed GQL no-fill changed the response batch length');
  equal(result[0], channelResult, 'worker mixed GQL no-fill changed the result before FetchAdsService');
  assertFetchAdsNoFill(result[1], 'worker batched video VAST');
  equal(result[2], identityResult, 'worker mixed GQL no-fill changed the result after FetchAdsService');
  assert(runtime.state.calls.length === 1,
    'worker mixed GQL no-fill duplicated or swallowed the native batch');
  assert(runtime.state.calls[0].init && runtime.state.calls[0].init.body === requestBody,
    'worker mixed GQL no-fill changed the native request bytes');
});

test('config-off worker FetchAds traffic remains byte- and response-preserving', async () => {
  const nativeAdResult = fetchedVideoAd('worker-config-off-video');
  const runtime = createWorkerFetchHarness(() => gqlJson(nativeAdResult), false);
  const requestBody = JSON.stringify(fetchAdsOperation('PREROLL'));
  const response = await runtime.fetch('https://gql.twitch.tv/gql', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: requestBody,
  });

  equal(await response.json(), nativeAdResult,
    'config-off worker FetchAds response was changed instead of passing through');
  assert(runtime.state.calls.length === 1 && runtime.state.calls[0].init &&
    runtime.state.calls[0].init.body === requestBody,
  'config-off worker FetchAds request was swallowed, duplicated, or changed');
});

test('worker VideoAdRequestDecline settles locally with Twitch decline state and arms one warning', async () => {
  const runtime = createWorkerFetchHarness(() => gqlJson(nativeVideoAdDecline('unexpected-native-worker')), true);
  const warnings = () => runtime.state.messages.filter((message) => message && message.type === 'ad-imminent');
  const before = warnings().length;
  const requestBody = JSON.stringify(videoAdDeclineOperation());
  const response = await runtime.fetch('https://gql.twitch.tv/gql', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: requestBody,
  });

  assert(response.status === 200, 'worker decline contract changed the successful GQL status');
  assertVideoAdDecline(await response.json(), 'worker VideoAdRequestDecline');
  assert(runtime.state.calls.length === 0,
    'worker VideoAdRequestDecline reached the native network instead of settling locally');
  assert(warnings().length === before + 1,
    'worker VideoAdRequestDecline did not arm exactly one early warning');
});

test('worker mixed GQL batches replace only VideoAdRequestDecline and preserve unrelated entries', async () => {
  const channelResult = { data: { channelShell: { id: 'decline-worker-channel', login: 'fixturechannel' } } };
  const identityResult = { data: { connectAdIdentity: { opaqueIdentity: 'decline-worker-identity' } } };
  const nativeBatch = [channelResult, nativeVideoAdDecline('native-worker-batch'), identityResult];
  const runtime = createWorkerFetchHarness(() => gqlJson(nativeBatch), true);
  const warningsBefore = runtime.state.messages.filter((message) => message && message.type === 'ad-imminent').length;
  const requestBatch = [
    { operationName: 'ChannelShell', variables: { login: 'fixturechannel' } },
    videoAdDeclineOperation(),
    { operationName: 'ConnectAdIdentityMutation', variables: { opaqueIdentity: 'fixture' } },
  ];
  const requestBody = JSON.stringify(requestBatch);
  const response = await runtime.fetch('https://gql.twitch.tv/gql', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: requestBody,
  });
  const result = await response.json();

  assert(Array.isArray(result) && result.length === nativeBatch.length,
    'worker mixed decline response changed the batch length');
  equal(result[0], channelResult, 'worker mixed decline changed the result before VideoAdRequestDecline');
  assertVideoAdDecline(result[1], 'worker batched VideoAdRequestDecline');
  equal(result[2], identityResult, 'worker mixed decline changed the result after VideoAdRequestDecline');
  assert(runtime.state.calls.length === 1 && runtime.state.calls[0].init &&
    runtime.state.calls[0].init.body === requestBody,
  'worker mixed decline duplicated, swallowed, or changed the native batch');
  assert(runtime.state.messages.filter((message) => message && message.type === 'ad-imminent').length ===
    warningsBefore + 1,
  'worker mixed decline did not arm exactly one early warning');
});

test('config-off worker VideoAdRequestDecline remains byte- and response-preserving', async () => {
  const nativeResult = nativeVideoAdDecline('native-worker-config-off');
  const runtime = createWorkerFetchHarness(() => gqlJson(nativeResult), false);
  const requestBody = JSON.stringify(videoAdDeclineOperation());
  const response = await runtime.fetch('https://gql.twitch.tv/gql', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: requestBody,
  });

  equal(await response.json(), nativeResult,
    'config-off worker VideoAdRequestDecline response was changed instead of passing through');
  assert(runtime.state.calls.length === 1 && runtime.state.calls[0].init &&
    runtime.state.calls[0].init.body === requestBody,
  'config-off worker VideoAdRequestDecline request was swallowed, duplicated, or changed');
});

test('current Twitch module workers are wrapped without changing their worker mode', () => {
  const harness = createPageHarness();
  const worker = new harness.window.Worker('blob:https://www.twitch.tv/module-player-worker', {
    type: 'module',
    name: 'twitch-player',
  });
  assert(/^blob:wardenone-twitch-/.test(worker.url),
    'module player worker bypassed playlist interception');
  assert(worker.options && worker.options.type === 'module' && worker.options.name === 'twitch-player',
    'module player worker options were changed');
  const wrapper = harness.state.blobSources.get(worker.url) || '';
  assert(wrapper.includes('self.__wardenOneOriginalWorkerRan = true;'),
    'module wrapper omitted the original Twitch worker source');
});

test('page master capture finishes before the native response is handed to Twitch', async () => {
  const masterUrl = 'https://usher.ttvnw.net/api/v2/channel/hls/fixturechannel.m3u8' +
    '?allow_source=true&player_backend=mediaplayer';
  const mediaUrl = 'https://video-weaver.fixture.ttvnw.net/v2/fixturechannel/capture-source.m3u8';
  const masterText = [
    '#EXTM3U',
    '#EXT-X-STREAM-INF:BANDWIDTH=6000000,CODECS="avc1.64002A,mp4a.40.2",RESOLUTION=1920x1080',
    mediaUrl,
    '',
  ].join('\n');
  let finishClone;
  const cloneText = new Promise((resolve) => { finishClone = resolve; });
  const nativeResponse = {
    ok: true,
    url: masterUrl,
    clone() {
      return { text() { return cloneText; } };
    },
  };
  const harness = createPageHarness(null, {
    nativeFetch() { return nativeResponse; },
  });
  const worker = new harness.window.Worker('blob:https://www.twitch.tv/master-ordering-worker');
  let delivered = false;
  const pending = harness.window.fetch(masterUrl).then((response) => {
    delivered = true;
    return response;
  });

  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  const deliveredBeforeCapture = delivered;
  finishClone(masterText);
  const response = await pending;
  await new Promise((resolve) => setImmediate(resolve));

  assert(response === nativeResponse, 'page master capture replaced the native response object');
  const captured = worker.messages.find((message) => message && message.type === 'master');
  assert(captured && captured.url === masterUrl && captured.text === masterText,
    'delayed page master clone was not captured byte-for-byte');
  assert(deliveredBeforeCapture === false,
    'Twitch received the native master response before its clone populated the worker map');
});

test('replacement worker maps its first media fetch before the ready handshake', async () => {
  const masterUrl = 'https://usher.ttvnw.net/api/v2/channel/hls/fixturechannel.m3u8' +
    '?allow_source=true&player_backend=mediaplayer';
  const mediaUrl = 'https://video-weaver.fixture.ttvnw.net/v2/fixturechannel/first-media.m3u8' +
    '?token=opaque%2Bfixture';
  const masterText = [
    '#EXTM3U',
    '#EXT-X-TWITCH-INFO:CLUSTER="fixture",MANIFEST-CLUSTER="fixture"',
    '#EXT-X-STREAM-INF:BANDWIDTH=6000000,CODECS="avc1.64002A,mp4a.40.2",RESOLUTION=1920x1080',
    mediaUrl,
    '',
  ].join('\n');
  const cleanMedia = [
    '#EXTM3U',
    '#EXT-X-VERSION:3',
    '#EXT-X-TARGETDURATION:2',
    '#EXT-X-MEDIA-SEQUENCE:100',
    '#EXTINF:2.000,live',
    'https://video-weaver.fixture.ttvnw.net/v2/fixturechannel/live-100.ts',
    '',
  ].join('\n');
  const page = createPageHarness(null, {
    nativeFetch(input) {
      const url = typeof input === 'string' ? input : String(input && input.url || '');
      return new Response(url === masterUrl ? masterText : '{}', {
        status: 200,
        headers: { 'content-type': url === masterUrl ? 'application/vnd.apple.mpegurl' : 'application/json' },
      });
    },
  });

  await page.window.fetch(masterUrl);
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  const replacement = new page.window.Worker('blob:https://www.twitch.tv/first-media-replacement');
  const wrapper = page.state.blobSources.get(replacement.url) || '';
  assert(wrapper, 'replacement Twitch worker was not wrapped');

  const runtime = executeWorkerWrapper(wrapper, replacement.messages.slice(), async (url) => {
    return new Response(url === mediaUrl ? cleanMedia : '{}', {
      status: 200,
      headers: { 'content-type': url === mediaUrl ? 'application/vnd.apple.mpegurl' : 'application/json' },
    });
  });
  await runtime.fetch(mediaUrl);
  const firstState = runtime.state.messages.find((message) =>
    message && message.type === 'ad-state' && message.state === 'clear');
  assert(firstState && firstState.channel === 'fixturechannel',
    'first media fetch ran without the cached master profile before ready/config replay');
});

test('a V2 master fetched before worker replacement is replayed byte-for-byte', async () => {
  const masterUrl = 'https://usher.ttvnw.net/api/v2/channel/hls/fixturechannel.m3u8' +
    '?allow_source=true&fast_bread=true&player_backend=mediaplayer';
  const masterText = [
    '#EXTM3U',
    '#EXT-X-TWITCH-INFO:CLUSTER="fixture",MANIFEST-CLUSTER="fixture",NODE="video-weaver.fixture",SERVER-TIME=1720000000.000',
    '#EXT-X-MEDIA:TYPE=VIDEO,GROUP-ID="chunked",NAME="1080p60",AUTOSELECT=YES,DEFAULT=YES',
    '#EXT-X-STREAM-INF:BANDWIDTH=6000000,CODECS="avc1.64002A,mp4a.40.2",RESOLUTION=1920x1080,VIDEO="chunked"',
    'https://video-weaver.fixture.ttvnw.net/v2/fixturechannel/fixture-source.m3u8?token=opaque%2Bvalue',
    '',
  ].join('\n');
  const harness = createPageHarness(null, {
    fakeClock: true,
    now: 1000,
    nativeFetch(input) {
      const url = typeof input === 'string' ? input : input.url;
      return new Response(url === masterUrl ? masterText : '{}', {
        status: 200,
        headers: { 'content-type': url === masterUrl ? 'application/vnd.apple.mpegurl' : 'application/json' },
      });
    },
  });
  const original = new harness.window.Worker('blob:https://www.twitch.tv/v2-master-original');
  original.dispatchEvent({
    type: 'message',
    data: { __woTwitchAdblock: harness.window.__wardenOneTwitchAdblockReady, type: 'ready' },
    stopImmediatePropagation() {},
  });

  await harness.window.fetch(masterUrl);
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  const liveMaster = original.messages.filter((message) => message && message.type === 'master').at(-1);
  assert(liveMaster && liveMaster.url === masterUrl && liveMaster.text === masterText,
    'live worker did not receive the fetched V2 master bytes');
  assert(liveMaster.channel === 'fixturechannel', 'live V2 master lost its page channel');

  harness.advance(121000);
  original.dispatchEvent({ type: 'error' });
  const replacement = new harness.window.Worker('blob:https://www.twitch.tv/v2-master-replacement');
  replacement.dispatchEvent({
    type: 'message',
    data: { __woTwitchAdblock: harness.window.__wardenOneTwitchAdblockReady, type: 'ready' },
    stopImmediatePropagation() {},
  });
  const replayed = replacement.messages.filter((message) => message && message.type === 'master');
  assert(replayed.length === 1, 'replacement worker did not receive exactly one cached V2 master');
  assert(replayed[0].url === masterUrl && replayed[0].text === masterText &&
    replayed[0].channel === 'fixturechannel',
  'replacement worker received a changed or incomplete V2 master');
});

test('a target master fetched before a SPA route flip is replayed current to its replacement worker', async () => {
  const targetChannel = 'guang233';
  const targetMasterUrl = 'https://usher.ttvnw.net/api/v2/channel/hls/' + targetChannel + '.m3u8' +
    '?allow_source=true&fast_bread=true&player_backend=mediaplayer';
  const targetMediaUrl = 'https://video-weaver.fixture.ttvnw.net/v2/' + targetChannel +
    '/route-flip-source.m3u8?token=opaque%2Btarget';
  const targetMasterText = [
    '#EXTM3U',
    '#EXT-X-TWITCH-INFO:CLUSTER="fixture",MANIFEST-CLUSTER="fixture"',
    '#EXT-X-STREAM-INF:BANDWIDTH=6000000,CODECS="avc1.64002A,mp4a.40.2",RESOLUTION=1920x1080,VIDEO="chunked"',
    targetMediaUrl,
    '',
  ].join('\n');
  const harness = createPageHarness(null, {
    nativeFetch(input) {
      const url = typeof input === 'string' ? input : String(input && input.url || '');
      return new Response(url === targetMasterUrl ? targetMasterText : '{}', {
        status: 200,
        headers: { 'content-type': url === targetMasterUrl ? 'application/vnd.apple.mpegurl' : 'application/json' },
      });
    },
  });
  const existing = new harness.window.Worker('blob:https://www.twitch.tv/pre-route-flip-worker');
  existing.dispatchEvent({
    type: 'message',
    data: { __woTwitchAdblock: harness.window.__wardenOneTwitchAdblockReady, type: 'ready' },
    stopImmediatePropagation() {},
  });

  await harness.window.fetch(targetMasterUrl);
  const existingTargetMasters = existing.messages.filter((message) =>
    message && message.type === 'master' && message.channel === targetChannel);
  assert(existingTargetMasters.length === 1 && existingTargetMasters[0].current === false,
    'target master activated over the old pathname before the SPA route changed');
  assert(existingTargetMasters[0].url === targetMasterUrl && existingTargetMasters[0].text === targetMasterText,
    'existing worker received changed target master bytes');

  harness.window.location.pathname = '/' + targetChannel;
  harness.window.location.href = 'https://www.twitch.tv/' + targetChannel;
  const replacement = new harness.window.Worker('blob:https://www.twitch.tv/post-route-flip-worker');
  replacement.dispatchEvent({
    type: 'message',
    data: { __woTwitchAdblock: harness.window.__wardenOneTwitchAdblockReady, type: 'ready' },
    stopImmediatePropagation() {},
  });
  const replayedTargetMasters = replacement.messages.filter((message) =>
    message && message.type === 'master' && message.channel === targetChannel);
  assert(replayedTargetMasters.length === 1 && replayedTargetMasters[0].current === true,
    'replacement worker did not activate the cached target master after the SPA route flip');
  assert(replayedTargetMasters[0].url === targetMasterUrl && replayedTargetMasters[0].text === targetMasterText,
    'replacement worker did not receive the cached target master byte-for-byte');
  assert(existing.messages.filter((message) => message && message.type === 'master' &&
    message.channel === targetChannel && message.current === true).length === 0,
  'route flip retroactively activated the target master in the existing worker');
});

test('unreadable and throwing Twitch worker blobs fail open to the native Worker', () => {
  for (const [label, options] of [
    ['empty source', { workerSource: '' }],
    ['throwing source read', { workerSourceThrows: true }],
  ]) {
    const harness = createPageHarness(null, options);
    const originalUrl = 'blob:https://www.twitch.tv/' + label.replace(/\s+/g, '-');
    const worker = new harness.window.Worker(originalUrl, { name: label });
    assert(worker.url === originalUrl, label + ' was wrapped without readable source bytes');
    assert(worker.options && worker.options.name === label, label + ' changed native Worker options');
    assert(harness.state.workerSourceReads === 1, label + ' did not attempt exactly one source read');
    assert(harness.state.blobSources.size === 0, label + ' created a partial wrapper Blob');
  }
});

test('terminated workers receive no later page broadcasts', () => {
  const harness = createPageHarness();
  const worker = new harness.window.Worker('blob:https://www.twitch.tv/terminated-player');
  worker.dispatchEvent({
    type: 'message',
    data: { __woTwitchAdblock: harness.window.__wardenOneTwitchAdblockReady, type: 'ready' },
    stopImmediatePropagation() {},
  });
  const beforeTerminate = worker.messages.length;
  worker.terminate();
  assert(worker.terminateCalls === 1 && worker.terminated === true,
    'wrapped terminate did not call the native Worker termination exactly once');
  harness.window.__WO_CONFIG__.twitchAdBlock = false;
  harness.document.dispatchEvent({ type: 'wo-config-change', target: harness.document });
  assert(worker.messages.length === beforeTerminate,
    'terminated worker remained registered for config broadcasts');
});

test('blocking state is reference-counted across concurrent player workers', () => {
  const harness = createPageHarness();
  const ready = harness.window.__wardenOneTwitchAdblockReady;
  const first = new harness.window.Worker('blob:https://www.twitch.tv/refcount-first');
  const second = new harness.window.Worker('blob:https://www.twitch.tv/refcount-second');
  const send = (worker, type, state) => worker.dispatchEvent({
    type: 'message',
    data: { __woTwitchAdblock: ready, type, state },
    stopImmediatePropagation() {},
  });
  send(first, 'ready');
  send(second, 'ready');
  send(first, 'ad-state', 'blocked-clean');
  send(second, 'ad-state', 'blocked-clean');
  send(second, 'ad-state', 'clear');
  assert(harness.document.documentElement.hasAttribute('data-wo-twitch-adblock'),
    'one worker cleared the shared blocking state while another was still blocking');
  first.terminate();
  assert(!harness.document.documentElement.hasAttribute('data-wo-twitch-adblock'),
    'terminating the last blocking worker left stale shared blocking state');
});

test('only blocked-clean gates ad chrome and worker states never mutate live playback', () => {
  const harness = createPageHarness();
  const live = harness.createVideo({
    currentSrc: 'blob:https://www.twitch.tv/state-only-live',
    inPlayer: true,
    label: 'Twitch video player',
    defaultMuted: false,
    muted: false,
    volume: 0.65,
    currentTime: 42,
  });
  const original = videoPresentation(live);
  const worker = new harness.window.Worker('blob:https://www.twitch.tv/state-only-worker');
  const send = (state, extra) => worker.dispatchEvent({
    type: 'message',
    data: Object.assign({
      __woTwitchAdblock: harness.window.__wardenOneTwitchAdblockReady,
      type: 'ad-state',
      state,
    }, extra || {}),
    stopImmediatePropagation() {},
  });

  for (const staleState of ['blocked-native', 'blocked-gap', 'blocked-hold', 'blocked-imminent']) {
    send(staleState);
    assert(!harness.document.documentElement.hasAttribute('data-wo-twitch-adblock'),
      staleState + ' incorrectly gated page ad chrome');
  }
  assert(!harness.document.documentElement.children.some((node) => node.id === 'wo-twitch-ad-chrome'),
    'a native fail-open state mounted the ad-chrome stylesheet');

  send('blocked-clean');
  assert(harness.document.documentElement.getAttribute('data-wo-twitch-adblock') === 'blocked-clean',
    'clean backup state did not gate ad chrome');
  assert(harness.document.documentElement.children.some((node) => node.id === 'wo-twitch-ad-chrome'),
    'clean backup state did not mount the ad-chrome stylesheet');
  send('clear', { offsetMs: 20000 });
  assert(!harness.document.documentElement.hasAttribute('data-wo-twitch-adblock'),
    'clean backup state did not clear at the native boundary');

  equal(videoPresentation(live), original,
    'worker state handling changed the live player presentation or audio');
  assert(live.pauseCalls === 0 && live.playCalls === 0,
    'worker state handling paused or restarted native playback');
  assert(live.currentTime === 42 && live.seeks.length === 0,
    'worker state handling retained post-swap catch-up seeking');
  for (const eventName of ['pause', 'waiting', 'stalled', 'seeking', 'ratechange', 'emptied', 'error']) {
    assert((live.listeners.get(eventName) || []).length === 0,
      'removed post-swap catch-up retained a ' + eventName + ' listener');
  }
  assert(!/closeCatchUpEpisode|blockingSwapOffsetMs|CATCHUP_SETTLE_MS/.test(MODULE_SOURCE),
    'removed post-swap catch-up implementation remains in the module');
});

test('a late delegating Worker wrapper composes with Twitch and non-Twitch workers', () => {
  const harness = createPageHarness();
  const installed = harness.window.Worker;
  const customCalls = [];
  harness.window.Worker = function LatePageWorker(url, options) {
    customCalls.push({ url: String(url), options });
    return new installed(url, options);
  };
  assert(harness.window.Worker === installed,
    'late custom wrapper removed the outer Twitch interception hook');

  const externalUrl = 'https://example.test/ordinary-worker.js';
  const external = new harness.window.Worker(externalUrl, { name: 'ordinary' });
  assert(external.url === externalUrl && customCalls.length === 1 && customCalls[0].url === externalUrl,
    'non-Twitch worker did not pass through the late custom wrapper exactly once');

  const worker = new harness.window.Worker('blob:https://www.twitch.tv/late-assignment-player');
  assert(/^blob:wardenone-twitch-/.test(worker.url),
    'player worker bypassed interception after a late Worker assignment');
  assert(customCalls.length === 2 && customCalls[1].url === worker.url,
    'wrapped Twitch worker did not compose with the late custom wrapper exactly once');

  harness.window.Worker = harness.NativeWorker;
  const afterCachedNative = new harness.window.Worker('blob:https://www.twitch.tv/cached-native-assignment');
  assert(/^blob:wardenone-twitch-/.test(afterCachedNative.url),
    'cached native Worker assignment bypassed Twitch interception');
  assert(customCalls.length === 3,
    'cached native assignment unexpectedly discarded the compatible custom delegate');
});

test('anonymous first-ad token proxy receives a page-scoped device id fallback', async () => {
  const harness = createPageHarness();
  const worker = new harness.window.Worker('blob:https://www.twitch.tv/anonymous-token-player');
  worker.dispatchEvent({
    type: 'message',
    data: {
      __woTwitchAdblock: harness.window.__wardenOneTwitchAdblockReady,
      type: 'gql-request',
      id: 'anonymous-token',
      body: {
        operationName: 'PlaybackAccessToken',
        variables: {
          isLive: true,
          login: 'fixturechannel',
          isVod: false,
          vodID: '',
          playerType: 'embed',
          platform: 'web',
        },
        extensions: { persistedQuery: { version: 1, sha256Hash: 'fixture-hash' } },
      },
    },
    stopImmediatePropagation() {},
  });
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  const proxied = harness.state.fetchCalls.at(-1);
  const deviceId = new Headers(proxied.init && proxied.init.headers).get('X-Device-Id') || '';
  assert(/^[a-z0-9]{32}$/.test(deviceId),
    'anonymous backup token request omitted its valid device id fallback');
});

test('page config-off path forwards GQL and workers untouched', async () => {
  const harness = createPageHarness({ twitchAdBlock: false });
  const body = JSON.stringify([{
    operationName: 'PlaybackAccessToken',
    variables: { isLive: true, login: 'fixturechannel', playerType: 'site', platform: 'android' },
  }]);
  const init = { method: 'POST', headers: { 'Client-ID': 'untouched' }, body: body };
  await harness.window.fetch('https://gql.twitch.tv/gql', init);
  assert(harness.state.fetchCalls.length === 1, 'config-off GQL request was duplicated');
  assert(harness.state.fetchCalls[0].init === init, 'config-off GQL init was replaced');
  assert(harness.state.fetchCalls[0].init.body === body, 'config-off GQL body was modified');

  const workerUrl = 'blob:https://www.twitch.tv/config-off-worker';
  const worker = new harness.window.Worker(workerUrl);
  assert(worker.url === workerUrl,
    'config-off path still wrapped the Twitch worker');
  assert(harness.state.blobSources.size === 0, 'config-off path created a worker wrapper Blob');
  assert(harness.state.mutationObservers.length === 0,
    'config-off path installed the independent-video observer');
});

// A pre-roll is the client-side ad path, so the playlist engine never sees it.
// It must be ANSWERED rather than refused: the player does not leave its ad
// state until the request settles, so a blocked one freezes the break.
test('the client-side ad request is answered locally with Twitch own no-fill status', async () => {
  const harness = createPageHarness();
  for (const url of [
    'https://edge.ads.twitch.tv/ads/format?afmt=STANDARD_VIDEO&bp=preroll',
    'https://edge.ads.twitch.tv/ads?afmt=PAUSE_ADS',
    'https://edge.ads.twitch.tv/2018-01-01/ads?sid=current-session&afmt=STANDARD_VIDEO',
    'https://edge.ads.twitch.tv/2018-01-01/3p/ads?sid=current-session&afmt=STANDARD_VIDEO',
    'https://vaes.amazon-adsystem.com/2018-01-01/3p/ads?sid=current-session&afmt=STANDARD_VIDEO',
  ]) {
    const response = await harness.window.fetch(url);
    // 204 is the branch the ad SDK resolves on immediately. A 200 would be
    // content-type sniffed and run through a bid validator that throws.
    assert(response.status === 204, 'ad request must settle as no-fill: ' + url);
    const text = await response.text();
    assert(text === '', 'a no-fill answer must carry no body: ' + url);
  }
  assert(harness.state.fetchCalls.length === 0,
    'the ad request was put on the network instead of being answered');
});

test('ad-service XHR stays exactly native while video requests still arm an early warning', () => {
  const harness = createPageHarness();
  const worker = new harness.window.Worker('blob:https://www.twitch.tv/xhr-ad-warning-player');
  worker.dispatchEvent({
    type: 'message',
    data: { __woTwitchAdblock: harness.window.__wardenOneTwitchAdblockReady, type: 'ready' },
    stopImmediatePropagation() {},
  });
  const warnings = () => worker.messages.filter((message) => message && message.type === 'ad-imminent').length;
  const adRequests = [
    ['https://edge.ads.twitch.tv/ads/format?afmt=STANDARD_VIDEO&bp=preroll', true],
    ['https://edge.ads.twitch.tv/ads?afmt=SQUEEZEBACK', false],
    ['https://edge.ads.twitch.tv/2018-01-01/ads?sid=current-session&afmt=STANDARD_VIDEO', true],
    ['https://edge.ads.twitch.tv/2018-01-01/3p/ads?sid=current-session&afmt=STANDARD_VIDEO', true],
    ['https://vaes.amazon-adsystem.com/2018-01-01/3p/ads?sid=current-session&afmt=STANDARD_VIDEO', true],
  ];
  for (let index = 0; index < adRequests.length; index++) {
    const [url, warns] = adRequests[index];
    const xhr = new harness.sandbox.XMLHttpRequest();
    const opensBefore = harness.state.xhrOpens.length;
    const sendsBefore = harness.state.xhrSends.length;
    const warningsBefore = warnings();
    const openArgs = ['pOsT', url, false, 'fixture-user-' + index, 'fixture-password-' + index];
    xhr.open(...openArgs);
    assert(warnings() === warningsBefore + (warns ? 1 : 0),
      'ad-service XHR warning classification changed: ' + url);
    const body = { fixture: 'ad-body-' + index };
    xhr.send(body);
    assert(harness.state.xhrOpens.length === opensBefore + 1,
      'ad-service XHR did not reach native open exactly once: ' + url);
    assert(harness.state.xhrSends.length === sendsBefore + 1,
      'ad-service XHR did not reach native send exactly once: ' + url);
    const opened = harness.state.xhrOpens.at(-1);
    const sent = harness.state.xhrSends.at(-1);
    equal(opened.args, openArgs, 'ad-service XHR changed native open arguments: ' + url);
    assert(opened.xhr === xhr && sent.xhr === xhr && sent.body === body,
      'ad-service XHR changed native receiver or send body: ' + url);
    assert(xhr.responseText === 'native xhr response',
      'ad-service XHR lost its native response: ' + url);
  }

  const ordinaryUrl = 'https://edge.ads.twitch.tv/health?fixture=ordinary';
  const ordinary = new harness.sandbox.XMLHttpRequest();
  ordinary.open('GET', ordinaryUrl, true);
  ordinary.send('ordinary-body');
  const ordinaryOpen = harness.state.xhrOpens.at(-1);
  const ordinarySend = harness.state.xhrSends.at(-1);
  assert(ordinaryOpen && ordinaryOpen.url === ordinaryUrl && ordinaryOpen.method === 'GET' &&
    ordinaryOpen.async === true,
  'ordinary HTTPS XHR was not passed to native open byte-for-byte');
  assert(ordinarySend && ordinarySend.url === ordinaryUrl && ordinarySend.body === 'ordinary-body',
    'ordinary HTTPS XHR was not passed to native send');
  assert(ordinary.responseText === 'native xhr response',
    'ordinary HTTPS XHR lost its native response');

  const blobUrl = 'blob:https://www.twitch.tv/native-worker-source-fixture';
  const blob = new harness.sandbox.XMLHttpRequest();
  const sourceReadsBefore = harness.state.workerSourceReads;
  blob.open('GET', blobUrl, false);
  blob.overrideMimeType('application/javascript');
  blob.send(null);
  assert(harness.state.workerSourceReads === sourceReadsBefore + 1,
    'blob worker-source XHR no longer used the native synchronous path');
  assert(blob.responseText.includes('__wardenOneOriginalWorkerRan'),
    'blob worker-source XHR lost its native source bytes');

  const disabled = createPageHarness({ twitchAdBlock: false });
  const disabledUrl = adRequests[0][0];
  const disabledXhr = new disabled.sandbox.XMLHttpRequest();
  disabledXhr.open('GET', disabledUrl, true);
  disabledXhr.send(null);
  assert(disabled.state.xhrOpens.length === 1 && disabled.state.xhrOpens[0].url === disabledUrl,
    'config-off ad XHR did not reach native open');
  assert(disabled.state.xhrSends.length === 1 && disabled.state.xhrSends[0].url === disabledUrl,
    'config-off ad XHR did not reach native send');
});

test('video ad-format requests announce pre-roll and mid-roll before their local no-fill', async () => {
  const harness = createPageHarness();
  const worker = new harness.window.Worker('blob:https://www.twitch.tv/direct-ad-warning-player');
  worker.dispatchEvent({
    type: 'message',
    data: { __woTwitchAdblock: harness.window.__wardenOneTwitchAdblockReady, type: 'ready' },
    stopImmediatePropagation() {},
  });
  const warnings = () => worker.messages.filter((message) => message && message.type === 'ad-imminent').length;

  for (const breakPosition of ['preroll', 'midroll']) {
    const before = warnings();
    const pending = harness.window.fetch(
      'https://edge.ads.twitch.tv/ads/format?afmt=STANDARD_VIDEO&bp=' + breakPosition,
    );
    assert(warnings() === before + 1,
      breakPosition + ' warning was posted after, rather than before, the local response settled');
    const response = await pending;
    assert(response.status === 204, breakPosition + ' video ad did not retain local no-fill handling');
  }

  const beforePause = warnings();
  const pausePending = harness.window.fetch('https://edge.ads.twitch.tv/ads?afmt=PAUSE_ADS&bp=pause');
  assert(warnings() === beforePause, 'pause-ad request incorrectly armed live-stream withholding');
  assert((await pausePending).status === 204, 'pause-ad request lost its local no-fill handling');
  assert(harness.state.fetchCalls.length === 0, 'direct ad warning path issued ad traffic on the network');
});

test('a cached ad warning is never replayed onto a different channel', async () => {
  const harness = createPageHarness(null, { fakeClock: true, now: 1000 });
  const first = new harness.window.Worker('blob:https://www.twitch.tv/first-channel-warning');
  first.dispatchEvent({
    type: 'message',
    data: { __woTwitchAdblock: harness.window.__wardenOneTwitchAdblockReady, type: 'ready' },
    stopImmediatePropagation() {},
  });
  await harness.window.fetch('https://edge.ads.twitch.tv/ads/format?afmt=STANDARD_VIDEO&bp=preroll');
  const firstWarning = first.messages.find((message) => message && message.type === 'ad-imminent');
  assert(firstWarning && firstWarning.channel === 'fixturechannel',
    'fixture did not cache the first channel warning');

  harness.window.location.pathname = '/otherchannel';
  harness.window.location.href = 'https://www.twitch.tv/otherchannel';
  const replacement = new harness.window.Worker('blob:https://www.twitch.tv/other-channel-worker');
  replacement.dispatchEvent({
    type: 'message',
    data: { __woTwitchAdblock: harness.window.__wardenOneTwitchAdblockReady, type: 'ready' },
    stopImmediatePropagation() {},
  });
  assert(!replacement.messages.some((message) => message && message.type === 'ad-imminent'),
    'replacement worker inherited a recent warning from a different channel');
});

test('nested FetchAds input.channel.login targets the next channel before the pathname changes', async () => {
  const targetChannel = 'guang233';
  const harness = createPageHarness(null, { fakeClock: true, now: 1000 });
  const existing = new harness.window.Worker('blob:https://www.twitch.tv/nested-channel-old-path-worker');
  existing.dispatchEvent({
    type: 'message',
    data: { __woTwitchAdblock: harness.window.__wardenOneTwitchAdblockReady, type: 'ready' },
    stopImmediatePropagation() {},
  });
  const operation = fetchAdsOperation('PREROLL');
  operation.variables.input.channel = { login: targetChannel };
  const requestBody = JSON.stringify(operation);
  const response = await harness.window.fetch('https://gql.twitch.tv/gql', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: requestBody,
  });

  assertFetchAdsNoFill(await response.json(), 'nested target-channel FetchAds');
  assert(harness.state.fetchCalls.length === 0,
    'nested target-channel FetchAds reached native network instead of settling locally');
  const liveWarnings = existing.messages.filter((message) => message && message.type === 'ad-imminent');
  assert(liveWarnings.length > 0 && liveWarnings.every((message) => message.channel === targetChannel),
    'old-path worker replaced the nested target-channel hint with the current pathname');

  harness.window.location.pathname = '/' + targetChannel;
  harness.window.location.href = 'https://www.twitch.tv/' + targetChannel;
  const replacement = new harness.window.Worker('blob:https://www.twitch.tv/nested-channel-new-path-worker');
  replacement.dispatchEvent({
    type: 'message',
    data: { __woTwitchAdblock: harness.window.__wardenOneTwitchAdblockReady, type: 'ready' },
    stopImmediatePropagation() {},
  });
  const replayedWarnings = replacement.messages.filter((message) => message && message.type === 'ad-imminent');
  assert(replayedWarnings.length === 1 && replayedWarnings[0].channel === targetChannel,
    'replacement worker did not inherit the cached nested hint for its new target pathname');
});

test('the ad responder never intercepts ordinary Twitch traffic', async () => {
  const harness = createPageHarness();
  for (const url of [
    'https://www.twitch.tv/adsomething',
    'https://edge.ads.twitch.tv/health',
    'https://usher.ttvnw.net/api/channel/hls/fixture.m3u8',
  ]) {
    await harness.window.fetch(url);
  }
  assert(harness.state.fetchCalls.length === 3,
    'the ad responder swallowed a request that was not an ad request');
});

test('with the Twitch ad block off, the ad request is left alone', async () => {
  const harness = createPageHarness({ twitchAdBlock: false });
  await harness.window.fetch('https://edge.ads.twitch.tv/ads/format?afmt=STANDARD_VIDEO');
  assert(harness.state.fetchCalls.length === 1,
    'config-off path still answered the ad request locally');
});

test('only intervention-linked network/decode errors enter a short recovery window', async () => {
  const harness = createPageHarness(null, { fakeClock: true, now: 1000 });
  const worker = new harness.window.Worker('blob:https://www.twitch.tv/fail-open-worker');
  worker.dispatchEvent({
    type: 'message',
    data: {
      __woTwitchAdblock: harness.window.__wardenOneTwitchAdblockReady,
      type: 'ready',
    },
    stopImmediatePropagation() {},
  });
  const configs = () => worker.messages.filter((message) => message && message.type === 'config');
  assert(configs().length === 1 && configs()[0].enabled === true,
    'ready worker did not receive the enabled user config');

  const independent = harness.createVideo({
    currentSrc: 'https://cdn.media-amazon.com/twitch/independent-ad.mp4',
  });
  harness.fireMedia('loadstart', independent);
  independent.error = { code: 3 };
  harness.document.dispatchEvent({ type: 'error', target: independent });
  assert(configs().length === 1, 'independent ad-video error tripped the stream circuit breaker');

  const primary = harness.createVideo({
    currentSrc: 'blob:https://www.twitch.tv/primary-playback',
    inPlayer: true,
  });
  primary.error = { code: 2 };
  harness.document.dispatchEvent({ type: 'error', target: primary });
  assert(configs().length === 1,
    'unrelated native player error disabled ad interception');

  worker.dispatchEvent({
    type: 'message',
    data: {
      __woTwitchAdblock: harness.window.__wardenOneTwitchAdblockReady,
      type: 'ad-state',
      state: 'blocked-clean',
    },
    stopImmediatePropagation() {},
  });
  harness.document.dispatchEvent({ type: 'error', target: primary });
  assert(configs().length === 2 && configs()[1].enabled === false,
    'intervention-linked MEDIA_ERR_NETWORK did not temporarily disable worker interception');
  assert(harness.document.documentElement.getAttribute('data-wo-twitch-fail-open') === 'network',
    'network recovery state was not exposed for diagnostics');
  assert(harness.document.documentElement.getAttribute('data-wo-twitch-adblock') === null,
    'network recovery left the stale blocking state on the native stream');
  assert(!/armStallWatch|nudgeStalledPlayback|STALL_POLL_MS/.test(MODULE_SOURCE),
    'network recovery retained the intervention stall watchdog');

  const nativeTokenBody = JSON.stringify([{
    operationName: 'PlaybackAccessToken',
    variables: {
      isLive: true,
      isVod: false,
      login: 'fixturechannel',
      playerType: 'site',
      platform: 'web',
    },
  }]);
  const nativeInit = {
    method: 'POST',
    headers: { 'Client-ID': 'recovery-client', 'X-Device-Id': 'recovery-device' },
    body: nativeTokenBody,
  };
  await harness.window.fetch('https://gql.twitch.tv/gql', nativeInit);
  const recoveryTokenCall = harness.state.fetchCalls.at(-1);
  const recoveryToken = JSON.parse(recoveryTokenCall.init.body)[0];
  assert(recoveryTokenCall.init !== nativeInit &&
    recoveryToken.variables.playerType === 'popout' && recoveryToken.variables.platform === 'web',
  'circuit breaker bypassed the ordinary popout/web token identity');
  assert(new Headers(recoveryTokenCall.init.headers).get('Client-ID') === 'recovery-client',
    'recovery token rewrite lost caller headers');

  worker.dispatchEvent({
    type: 'message',
    data: {
      __woTwitchAdblock: harness.window.__wardenOneTwitchAdblockReady,
      type: 'gql-request',
      id: 'recovery-proxy-request',
      body: JSON.parse(nativeTokenBody)[0],
    },
    stopImmediatePropagation() {},
  });
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  const recoveryProxy = harness.state.fetchCalls.at(-1);
  const recoveryHeaders = new Headers(recoveryProxy.init && recoveryProxy.init.headers);
  assert(recoveryHeaders.get('Client-ID') === 'recovery-client' &&
    recoveryHeaders.get('X-Device-Id') === 'recovery-device',
  'recovery pass-through stopped passive client-state capture');

  harness.advance(7999);
  assert(configs().at(-1).enabled === false, 'worker interception resumed before the bounded recovery window');
  harness.advance(1);
  assert(configs().at(-1).enabled === true, 'worker interception did not automatically resume');
  assert(harness.document.documentElement.getAttribute('data-wo-twitch-fail-open') === null,
    'expired recovery state remained on the page');

  primary.error = { code: 3 };
  harness.document.dispatchEvent({ type: 'error', target: primary });
  assert(configs().at(-1).enabled === false &&
    harness.document.documentElement.getAttribute('data-wo-twitch-fail-open') === 'decode',
  'primary MEDIA_ERR_DECODE did not trip the stream circuit breaker');
  harness.window.__WO_CONFIG__.twitchAdBlock = false;
  harness.document.dispatchEvent({ type: 'wo-config-change' });
  harness.advance(8000);
  assert(configs().at(-1).enabled === false,
    'circuit breaker expiry overrode the user-disabled configuration');
});

test('stable native playback ends intervention recovery early', () => {
  const harness = createPageHarness(null, { fakeClock: true, now: 1000 });
  const worker = new harness.window.Worker('blob:https://www.twitch.tv/early-resume-worker');
  worker.dispatchEvent({
    type: 'message',
    data: { __woTwitchAdblock: harness.window.__wardenOneTwitchAdblockReady, type: 'ready' },
    stopImmediatePropagation() {},
  });
  worker.dispatchEvent({
    type: 'message',
    data: {
      __woTwitchAdblock: harness.window.__wardenOneTwitchAdblockReady,
      type: 'ad-state',
      state: 'blocked-clean',
    },
    stopImmediatePropagation() {},
  });
  const primary = harness.createVideo({
    currentSrc: 'blob:https://www.twitch.tv/early-resume-primary',
    inPlayer: true,
  });
  primary.error = { code: 3 };
  harness.document.dispatchEvent({ type: 'error', target: primary });
  const configs = () => worker.messages.filter((message) => message && message.type === 'config');
  assert(configs().at(-1).enabled === false, 'linked decode error did not enter recovery');

  primary.error = null;
  harness.document.dispatchEvent({ type: 'playing', target: primary });
  harness.advance(1199);
  assert(configs().at(-1).enabled === false, 'recovery ended before playback settled');
  harness.advance(1);
  assert(configs().at(-1).enabled === true, 'stable native playback did not resume ad interception early');
  assert(harness.document.documentElement.getAttribute('data-wo-twitch-fail-open') === null,
    'early recovery completion left stale diagnostics');
});

test('unstable playback cancels the pending early recovery resume', () => {
  const harness = createPageHarness(null, { fakeClock: true, now: 1000 });
  const worker = new harness.window.Worker('blob:https://www.twitch.tv/unstable-resume-worker');
  worker.dispatchEvent({
    type: 'message',
    data: { __woTwitchAdblock: harness.window.__wardenOneTwitchAdblockReady, type: 'ready' },
    stopImmediatePropagation() {},
  });
  worker.dispatchEvent({
    type: 'message',
    data: {
      __woTwitchAdblock: harness.window.__wardenOneTwitchAdblockReady,
      type: 'ad-state',
      state: 'blocked-clean',
    },
    stopImmediatePropagation() {},
  });
  const primary = harness.createVideo({
    currentSrc: 'blob:https://www.twitch.tv/unstable-resume-primary',
    inPlayer: true,
    error: { code: 2 },
  });
  harness.document.dispatchEvent({ type: 'error', target: primary });
  const configs = () => worker.messages.filter((message) => message && message.type === 'config');
  assert(configs().at(-1).enabled === false, 'linked error did not enter recovery');

  primary.error = null;
  harness.document.dispatchEvent({ type: 'playing', target: primary });
  harness.advance(600);
  harness.document.dispatchEvent({ type: 'waiting', target: primary });
  harness.advance(600);
  assert(configs().at(-1).enabled === false,
    'stale settle timer re-enabled interception after playback became unstable');

  harness.document.dispatchEvent({ type: 'playing', target: primary });
  harness.advance(400);
  primary.error = { code: 3 };
  harness.document.dispatchEvent({ type: 'error', target: primary });
  primary.error = null;
  harness.advance(800);
  assert(configs().at(-1).enabled === false,
    'second media error re-enabled interception through a stale resume timer');

  harness.advance(5600);
  assert(configs().at(-1).enabled === true,
    'unstable playback extended the original bounded recovery deadline');
});

test('removed stall watchdog can never pause or restart Twitch media', () => {
  const harness = createPageHarness(null, { fakeClock: true, now: 10000 });
  const creative = harness.createVideo({
    currentSrc: 'blob:https://www.twitch.tv/first-display-ad-creative',
    inPlayer: true,
    label: 'Video Advertisement',
    currentTime: 25,
  });
  const live = harness.createVideo({
    currentSrc: 'blob:https://www.twitch.tv/primary-live-player',
    inPlayer: true,
    label: 'Twitch video player',
    currentTime: 100,
  });
  const worker = new harness.window.Worker('blob:https://www.twitch.tv/stall-primary-player-worker');
  worker.dispatchEvent({
    type: 'message',
    data: {
      __woTwitchAdblock: harness.window.__wardenOneTwitchAdblockReady,
      type: 'ad-state',
      state: 'blocked-gap',
    },
    stopImmediatePropagation() {},
  });

  harness.advance(1000);
  assert(creative.pauseCalls === 0 && creative.playCalls === 0,
    'legacy gap state paused or restarted the first ad creative');
  assert(live.pauseCalls === 0 && live.playCalls === 0,
    'legacy gap state retained the freeze-prone live-player pause/play nudge');
  assert(!/armStallWatch|nudgeStalledPlayback|STALL_POLL_MS/.test(MODULE_SOURCE),
    'legacy gap state retained the self-scheduling stall watchdog');
});

test('Twitch visibility recovery preserves native events and resumes only the same stream that was playing', () => {
  const harness = createPageHarness();
  let lateTwitchVisibilityEvents = 0;
  harness.document.addEventListener('visibilitychange', () => { lateTwitchVisibilityEvents++; }, true);
  const live = harness.createVideo({
    currentSrc: 'blob:https://www.twitch.tv/visibility-primary',
    inPlayer: true,
    label: 'Twitch video player',
    muted: false,
  });
  assert(harness.document.hidden === false && harness.document.visibilityState === 'visible',
    'visible Twitch fixture did not expose its native visibility state');

  const hiddenEvent = harness.setDocumentHidden(true);
  assert(!hiddenEvent.defaultPrevented && !hiddenEvent.propagationStopped &&
    !hiddenEvent.immediatePropagationStopped,
  'visibility recovery swallowed the browser native hide event');
  assert(lateTwitchVisibilityEvents === 1,
    'a later Twitch listener did not receive the native hide event');
  assert(harness.document.hidden === true && harness.document.visibilityState === 'hidden',
    'visibility recovery spoofed a hidden tab as visible');
  live.paused = true;
  harness.setDocumentHidden(true, 'webkitvisibilitychange');
  harness.setDocumentHidden(false);
  assert(live.playCalls === 1 && live.paused === false,
    'a duplicate hidden event erased the playing stream that needed resuming');
  assert(lateTwitchVisibilityEvents === 2,
    'a later Twitch listener did not receive the native show event');

  live.paused = true;
  harness.setDocumentHidden(true);
  harness.setDocumentHidden(false);
  assert(live.playCalls === 1,
    'visibility recovery overrode a deliberate pause that existed before tab hide');

  live.paused = false;
  harness.setDocumentHidden(true);
  live.currentSrc = 'blob:https://www.twitch.tv/replacement-player';
  live.paused = true;
  harness.setDocumentHidden(false);
  assert(live.playCalls === 1,
    'visibility recovery resumed a replacement media source from a previous channel');

  harness.setDocumentHidden(true);
  harness.window.__WO_CONFIG__.twitchAdBlock = false;
  harness.document.dispatchEvent({ type: 'wo-config-change', target: harness.document });
  assert(harness.document.hidden === true && harness.document.visibilityState === 'hidden',
    'config-off did not restore the browser native visibility surface');
  const disabledEvent = harness.setDocumentHidden(false);
  assert(!disabledEvent.defaultPrevented && !disabledEvent.immediatePropagationStopped,
    'config-off visibility listener still blocked the page event');
  assert(lateTwitchVisibilityEvents === 8,
    'visibility events were not delivered continuously before and after config-off');
});

test('a page opened in a background tab keeps the native hidden surface and safely resumes its stream', () => {
  const harness = createPageHarness(null, { documentHidden: true });
  assert(harness.state.documentHidden === true && harness.document.hidden === true &&
    harness.document.visibilityState === 'hidden',
  'initially hidden page did not expose its native background state');
  let lateEvents = 0;
  harness.document.addEventListener('visibilitychange', () => { lateEvents++; }, true);
  const live = harness.createVideo({
    currentSrc: 'blob:https://www.twitch.tv/background-open-primary',
    inPlayer: true,
    label: 'Twitch video player',
    muted: true,
  });
  harness.setDocumentHidden(true);
  live.paused = true;
  harness.setDocumentHidden(false);
  assert(lateEvents === 2, 'initially hidden Twitch page did not receive native visibility transitions');
  assert(live.playCalls === 1 && live.paused === false,
    'background-opened stream that had started was not resumed on first focus');
});

test('the fail-open deadline survives Twitch recovery reloads without extending itself', () => {
  const sessionValues = new Map();
  const first = createPageHarness(null, { fakeClock: true, now: 1000, sessionValues });
  const primary = first.createVideo({
    currentSrc: 'blob:https://www.twitch.tv/reload-primary',
    inPlayer: true,
  });
  const firstWorker = new first.window.Worker('blob:https://www.twitch.tv/first-recovery-worker');
  firstWorker.dispatchEvent({
    type: 'message',
    data: {
      __woTwitchAdblock: first.window.__wardenOneTwitchAdblockReady,
      type: 'ad-state',
      state: 'blocked-clean',
    },
    stopImmediatePropagation() {},
  });
  primary.error = { code: 2 };
  first.document.dispatchEvent({ type: 'error', target: primary });
  const storedDeadline = Number(sessionValues.get('__woTwitchFailOpenUntil'));
  assert(storedDeadline === 9000, 'page did not persist the bounded recovery deadline');

  // Simulate Twitch/content recovery reloading the document three seconds later.
  const reloaded = createPageHarness(null, { fakeClock: true, now: 4000, sessionValues });
  assert(reloaded.document.documentElement.getAttribute('data-wo-twitch-fail-open') === 'recovery',
    'reloaded page did not resume the stored pass-through window');
  const worker = new reloaded.window.Worker('blob:https://www.twitch.tv/reloaded-player-worker');
  const wrapper = reloaded.state.blobSources.get(worker.url) || '';
  assert(wrapper.includes(JSON.stringify(reloaded.window.__wardenOneTwitchAdblockReady) + ',false,'),
    'replacement worker did not start pass-through before its ready handshake');
  worker.dispatchEvent({
    type: 'message',
    data: {
      __woTwitchAdblock: reloaded.window.__wardenOneTwitchAdblockReady,
      type: 'ready',
    },
    stopImmediatePropagation() {},
  });
  const configs = () => worker.messages.filter((message) => message && message.type === 'config');
  assert(configs().length === 1 && configs()[0].enabled === false,
    'reloaded worker resumed intervention inside the stored recovery window');

  reloaded.advance(4999);
  assert(configs().at(-1).enabled === false, 'reload shortened the stored recovery window');
  reloaded.advance(1);
  assert(configs().at(-1).enabled === true, 'stored recovery window did not expire at its original deadline');
  assert(!sessionValues.has('__woTwitchFailOpenUntil'), 'expired recovery deadline remained in session storage');
});

test('independent-video guard uses one targeted observer plus delegated media events', () => {
  const harness = createPageHarness();
  assert(harness.state.mutationObservers.length === 1,
    'independent-video guard must install exactly one MutationObserver');
  const observer = harness.state.mutationObservers[0];
  assert(observer.observeCalls.length === 1, 'independent-video observer was not installed exactly once');
  const options = observer.observeCalls[0].options || {};
  assert(options.childList === true && options.subtree === true && options.attributes === true,
    'independent-video observer is missing its targeted subtree/attribute coverage');
  assert(options.attributeOldValue === true,
    'independent-video observer cannot recognize a removed display-ad identity');
  equal(Array.from(options.attributeFilter || []),
    ['aria-label', 'src', 'class', 'aria-hidden', 'data-a-target', 'data-test-selector'],
    'independent-video observer watches unexpected attributes');
  for (const eventName of ['loadstart', 'loadedmetadata', 'play', 'playing', 'volumechange']) {
    const expected = eventName === 'playing' ? 2 : 1;
    assert((harness.document.listeners.get(eventName) || []).length === expected,
      'independent-video guard is missing delegated ' + eventName + ' handling');
  }
  assert((MODULE_SOURCE.match(/new\s+MutationObserver\s*\(/g) || []).length === 1,
    'dedicated Twitch module contains more than one MutationObserver constructor');
});

test('unrelated attribute mutations never scan descendant subtrees or videos', () => {
  const harness = createPageHarness();
  const largeUnrelatedNode = harness.document.createElement('section');
  largeUnrelatedNode.setAttribute('class', 'chat-scrollable-area__message-container');
  harness.document.documentElement.appendChild(largeUnrelatedNode);
  let branch = largeUnrelatedNode;
  for (let index = 0; index < 250; index++) {
    const child = harness.document.createElement('div');
    branch.appendChild(child);
    branch = child;
  }

  let descendantQueries = 0;
  largeUnrelatedNode.querySelector = () => {
    descendantQueries++;
    return null;
  };
  largeUnrelatedNode.querySelectorAll = () => {
    descendantQueries++;
    return [];
  };

  harness.state.mutationObservers[0].trigger([{
    type: 'attributes',
    target: largeUnrelatedNode,
    attributeName: 'class',
    oldValue: 'chat-scrollable-area',
  }]);
  assert(descendantQueries === 0,
    'unrelated Twitch attribute mutation traversed a large descendant subtree');
});

test('display-ad CSS hides creative leaves but never player/root modifiers', () => {
  const harness = createPageHarness();
  const style = harness.document.documentElement.children.find((node) => node.id === 'wo-twitch-adblock-css');
  assert(style && typeof style.textContent === 'string', 'Twitch ad CSS did not mount');
  const hideEnd = style.textContent.indexOf('{display:none!important');
  assert(hideEnd > 0, 'Twitch ad CSS hide rule is missing');
  const hideSelectors = style.textContent.slice(0, hideEnd);
  for (const selector of [
    '[data-test-selector*="stream-display-ad" i]',
    '[data-test-selector*="vertical-video-ad" i]',
    '[data-a-target*="stream-display-ad" i]',
    '[data-a-target*="vertical-video-ad" i]',
    '[class*="stream-display-ad" i]',
    '[class*="vertical-video-ad" i]',
    '[class*="video-player--stream-display-ad" i]',
  ]) {
    assert(!hideSelectors.includes(selector), 'live player/root selector entered the display:none rule: ' + selector);
  }
  assert(hideSelectors.includes('[class*="stream-display-ad__creative"]') &&
      hideSelectors.includes('[class*="vertical-video-ad__creative"]') &&
      hideSelectors.includes('[data-test-selector="sda-wrapper"]'),
    'confirmed display-ad creative leaves are no longer hidden');
  const layoutRule = style.textContent.slice(hideEnd);
  assert(layoutRule.includes('[class*="video-player--stream-display-ad" i]') &&
      layoutRule.includes('[class*="video-player"][class*="vertical-video-ad" i]'),
    'display/vertical live player modifiers are not restored to full size');
  assert(!style.textContent.includes('blocked-native') &&
      !style.textContent.includes('Ad hidden · Stream resumes automatically'),
    'native fallback still covers the live player or mounts status copy');
});

// Selector lists carry :where()/:is() groups, so a naive comma split would tear
// them apart and make the guard assertions below pass on rules that do not have
// the guard at all.
function splitSelectorList(text) {
  const selectors = [];
  let depth = 0;
  let current = '';
  for (const character of String(text)) {
    if (character === '(') depth++;
    else if (character === ')') depth--;
    if (character === ',' && depth === 0) {
      if (current.trim()) selectors.push(current.trim());
      current = '';
      continue;
    }
    current += character;
  }
  if (current.trim()) selectors.push(current.trim());
  return selectors;
}

function gatedAdChromeSheet() {
  const harness = createPageHarness(null, { fakeClock: true, now: 1000 });
  const worker = new harness.window.Worker('blob:https://www.twitch.tv/ad-chrome-worker');
  const ready = harness.window.__wardenOneTwitchAdblockReady;
  worker.dispatchEvent({
    type: 'message',
    data: { __woTwitchAdblock: ready, type: 'ready' },
    stopImmediatePropagation() {},
  });
  worker.dispatchEvent({
    type: 'message',
    data: { __woTwitchAdblock: ready, type: 'ad-state', state: 'blocked-clean' },
    stopImmediatePropagation() {},
  });
  const style = harness.document.documentElement.children.find((node) => node.id === 'wo-twitch-ad-chrome');
  assert(style && typeof style.textContent === 'string' && style.textContent,
    'gated Twitch ad-chrome sheet did not mount on the first blocked state');
  return style.textContent;
}

test('gated ad-chrome CSS stays gated and can never hide an ancestor of the live player', () => {
  const sheet = gatedAdChromeSheet();
  const gate = 'html[data-wo-twitch-adblock="blocked-clean"] ';
  const selectors = [];
  for (const rule of sheet.split('}')) {
    const head = rule.split('{')[0].trim();
    if (head) selectors.push(...splitSelectorList(head));
  }
  assert(selectors.length > 0, 'gated Twitch ad-chrome sheet declared no selectors');
  for (const selector of selectors) {
    assert(selector.startsWith(gate), 'ad-chrome selector is not gated on an active swap: ' + selector);
  }
  // display:none on any ancestor blanks the picture regardless of what the rule
  // meant to hide, so every selector that could name a wrapper must refuse to
  // match an element that contains a video.
  for (const selector of selectors) {
    for (const token of [
      '[data-a-target*="video-ad" i]',
      '[aria-label*="advertisement" i]',
      '.video-player__ad-info-container',
      '.picture-by-picture-player',
      '[data-a-target="pbyp-player-instance"]',
      '.picture-by-picture-overlay',
    ]) {
      if (!selector.includes(token)) continue;
      assert(selector.includes(':not(:has('),
        'ancestor-capable ad-chrome selector ships without a structural guard: ' + selector);
    }
  }
  for (const selector of selectors) {
    if (!selector.includes('.picture-by-picture-player') && !selector.includes('pbyp-player-instance')) continue;
    for (const identity of [
      'video[aria-label="Twitch video player" i]',
      '[data-a-target="video-ref"]',
      '[data-test-selector="video-player__video-container"]',
    ]) {
      assert(selector.includes(':not(:has(' + identity + '))'),
        'picture-by-picture rule does not spare live player identity ' + identity + ': ' + selector);
    }
  }
  assert(!selectors.includes(gate + '.picture-by-picture-overlay'),
    'the pbyp overlay is hidden unconditionally again, stripping the chrome off the box rule 3 spares');
  assert(selectors.some((selector) => selector.includes('.picture-by-picture-overlay') &&
      selector.includes('.picture-by-picture-player')),
    'the pbyp overlay rule is no longer scoped to a non-live pbyp box');
  // The badge rule is deliberately kept out of the :has() family so an engine
  // without :has() still applies it.
  assert(!sheet.split('}')[0].includes(':has('),
    'the leaf ad-marker rule now depends on :has() and dies with it');
  assert(sheet.includes('/how-to-allow-ads-browser'),
    'the Turbo/allow-ads overlay probe was dropped');
});

test('Turbo house overlay is hidden at startup without ungating generic ad chrome', () => {
  const harness = createPageHarness();
  assert(!harness.document.documentElement.hasAttribute('data-wo-twitch-adblock'),
    'startup Turbo-overlay fixture unexpectedly began in blocked-clean state');
  const style = harness.document.documentElement.children.find((node) => node.id === 'wo-twitch-adblock-css');
  assert(style && typeof style.textContent === 'string' && style.textContent,
    'startup Twitch ad CSS did not mount before the first worker state');
  const hideEnd = style.textContent.indexOf('{display:none!important');
  assert(hideEnd > 0, 'startup Twitch ad CSS hide rule is missing');
  const startupSelectors = splitSelectorList(style.textContent.slice(0, hideEnd));
  const turboOverlaySelector = '.video-player__overlay .player-overlay-background:has(' +
    '> div[class^="Layout-"] > div[class^="Layout-"] > div[class^="Layout-"]' +
    ' > a:is([href*="/how-to-allow-ads-browser"],[href="https://www.twitch.tv/turbo"]))';
  assert(startupSelectors.includes(turboOverlaySelector),
    'the Twitch Turbo/allow-ads house overlay waits for blocked-clean before it is hidden');

  for (const unsafeGeneric of [
    '[data-a-target*="video-ad" i]',
    '[aria-label*="advertisement" i]',
    '.video-player__ad-info-container',
    '.picture-by-picture-player',
    '[data-a-target="pbyp-player-instance"]',
    '.picture-by-picture-overlay',
  ]) {
    assert(!startupSelectors.some((selector) => selector.includes(unsafeGeneric)),
      'generic ancestor-capable ad chrome escaped its blocked-clean gate: ' + unsafeGeneric);
  }
});

test('media-amazon direct and child sources are guarded without pausing attached media', () => {
  const harness = createPageHarness();
  const direct = harness.createVideo({
    currentSrc: 'https://cdn.media-amazon.com/twitch/direct-ad.mp4',
    volume: 0.65,
  });
  harness.fireMedia('loadedmetadata', direct);
  assertGuarded(direct, 'direct media-amazon video');
  assert(direct.pauseCalls === 0, 'attached direct ad video was paused');

  const childBacked = harness.createVideo({ volume: 0.4 });
  const source = harness.addSource(childBacked,
    'https://delivery.media-amazon.com/twitch/child-source-ad.mp4');
  harness.state.mutationObservers[0].trigger([{
    type: 'childList',
    target: childBacked,
    addedNodes: [source],
  }]);
  assertGuarded(childBacked, 'child-source media-amazon video');
  assert(childBacked.pauseCalls === 0, 'attached child-source ad video was paused');
});

test('active Stream Display Ad shell rescans, guards, and restores with reversed video order', () => {
  const harness = createPageHarness();
  const creative = harness.createVideo({
    currentSrc: 'blob:https://www.twitch.tv/display-creative',
    inPlayer: true,
    volume: 1,
  });
  const live = harness.createVideo({
    currentSrc: 'blob:https://www.twitch.tv/live-stream',
    inPlayer: true,
    label: 'Twitch video player',
    volume: 0.7,
  });
  const originalCreative = videoPresentation(creative);

  // Twitch keeps a stream-display scaffold with wrapper-hidden on normal pages.
  // With no active signal, a second video must remain untouched.
  harness.fireMedia('loadedmetadata', creative);
  equal(videoPresentation(creative), originalCreative,
    'persistent hidden SDA scaffold misclassified the second video');

  const shell = harness.document.createElement('div');
  shell.setAttribute('data-test-selector', 'sda-wrapper');
  shell.setAttribute('class', 'stream-display-ad__wrapper');
  harness.setStreamDisplayAdSignal(true);
  harness.state.mutationObservers[0].trigger([{
    type: 'childList',
    target: harness.document.documentElement,
    addedNodes: [shell],
    removedNodes: [],
  }]);
  assertGuarded(creative, 'stream-display creative');
  assert(live.getAttribute('data-wo-twitch-independent-ad') === null && live.volume === 0.7,
    'stream-display fallback altered the blob-backed live stream');

  shell.setAttribute('class', 'stream-display-ad__wrapper stream-display-ad__wrapper-hidden');
  harness.setStreamDisplayAdSignal(false);
  harness.state.mutationObservers[0].trigger([{
    type: 'attributes',
    target: shell,
    attributeName: 'class',
  }]);
  equal(videoPresentation(creative), originalCreative,
    'SDA shell deactivation did not restore the creative video exactly');
  assert(MODULE_SOURCE.includes('[class*="video-player"][class*="display-ad" i]'),
    'stream-display fallback no longer restores the live player to full size');
});

test('label fallback requires a distinct blob primary and never guards primary or unresolved video', () => {
  const withoutPrimary = createPageHarness();
  const loneLabel = withoutPrimary.createVideo({
    currentSrc: 'https://video-edge-fixture.ttvnw.net/live/labeled-secondary.mp4',
    label: 'Video Advertisement',
  });
  withoutPrimary.fireMedia('playing', loneLabel);
  assert(loneLabel.getAttribute('data-wo-twitch-independent-ad') === null,
    'label-only video was guarded without a distinct blob primary');

  const harness = createPageHarness();
  const primary = harness.createVideo({
    currentSrc: 'blob:https://www.twitch.tv/primary-player',
    label: 'Video Advertisement',
    inPlayer: true,
  });
  harness.fireMedia('playing', primary);
  assert(primary.getAttribute('data-wo-twitch-independent-ad') === null,
    'primary blob video was guarded by its label');
  assert(primary.muted === false && primary.volume === 1 && primary.pauseCalls === 0,
    'primary blob video presentation/playback was changed');

  const secondary = harness.createVideo({
    currentSrc: 'https://video-edge-fixture.ttvnw.net/live/labeled-secondary.mp4',
    label: 'This advertisement supports the streamer',
  });
  harness.fireMedia('playing', secondary);
  assertGuarded(secondary, 'labeled non-blob secondary video');

  const unresolved = harness.createVideo({ label: 'Video Advertisement' });
  harness.fireMedia('playing', unresolved);
  assert(unresolved.getAttribute('data-wo-twitch-independent-ad') === null,
    'unresolved label-only video was guarded without a concrete non-blob source');
  assert(unresolved.muted === false && unresolved.volume === 1 && unresolved.pauseCalls === 0,
    'unresolved label-only video presentation/playback was changed');

  const css = harness.document.head.children.find((node) => node.id === 'wo-twitch-adblock-css');
  const videoRootSelectors = css ? css.textContent.slice(0, css.textContent.indexOf('{display:none!important'))
    .split(',').filter((selector) => /^\s*video\[(?:aria-label|src)/i.test(selector)) : [];
  assert(css && videoRootSelectors.length === 0,
    'blanket video CSS bypasses the independent-video source/primary safety checks');
});

test('guard re-silences volume changes, restores on source reuse, and restores exactly on toggle-off', () => {
  const harness = createPageHarness();
  const video = harness.createVideo({
    currentSrc: 'https://cdn.media-amazon.com/twitch/reused-ad.mp4',
    defaultMuted: false,
    muted: false,
    volume: 0.37,
    style: {
      display: { value: 'inline-flex', priority: 'important' },
      visibility: { value: 'visible', priority: '' },
      'pointer-events': { value: 'auto', priority: 'important' },
    },
  });
  const original = videoPresentation(video);
  harness.fireMedia('playing', video);
  assertGuarded(video, 'initial independent ad');

  video.defaultMuted = false;
  video.muted = false;
  video.volume = 0.9;
  harness.fireMedia('volumechange', video);
  assertGuarded(video, 'volumechange independent ad');
  assert(video.pauseCalls === 0, 'attached ad was paused while being re-silenced');

  video.currentSrc = 'blob:https://www.twitch.tv/reused-primary';
  harness.fireMedia('loadstart', video);
  equal(videoPresentation(video), original, 'source reuse did not restore exact original presentation state');
  assert(video.pauseCalls === 0, 'attached reused video was paused during restoration');

  video.currentSrc = 'https://cdn.media-amazon.com/twitch/reused-ad-again.mp4';
  harness.fireMedia('loadedmetadata', video);
  assertGuarded(video, 'reused independent ad');
  harness.window.__WO_CONFIG__.twitchAdBlock = false;
  harness.document.dispatchEvent({ type: 'wo-config-change', target: harness.document });
  equal(videoPresentation(video), original, 'toggle-off did not restore exact original presentation state');
  assert(video.pauseCalls === 0, 'toggle-off paused an attached guarded video');
  assert(harness.state.mutationObservers[0].disconnected === true,
    'toggle-off did not disconnect the independent-video observer');
});

test('toggle-off pauses then restores a detached ad before blob-video reuse', () => {
  const harness = createPageHarness(undefined, { fakeClock: true, now: 1000 });
  const video = harness.createVideo({
    currentSrc: 'https://cdn.media-amazon.com/twitch/detached-toggle-ad.mp4',
    defaultMuted: false,
    muted: false,
    volume: 0.42,
    style: {
      display: { value: 'inline-block', priority: '' },
      visibility: { value: 'visible', priority: 'important' },
      'pointer-events': { value: 'auto', priority: '' },
    },
  });
  const original = videoPresentation(video);
  harness.fireMedia('playing', video);
  assertGuarded(video, 'toggle-off detached fixture');

  video.operations.length = 0;
  video.pauseCalls = 0;
  video.isConnected = false;
  harness.window.__WO_CONFIG__.twitchAdBlock = false;
  harness.document.dispatchEvent({ type: 'wo-config-change', target: harness.document });
  assertDetachedCleanup(video, original, 'toggle-off detached cleanup');

  video.currentSrc = 'blob:https://www.twitch.tv/reused-after-toggle';
  video.isConnected = true;
  harness.fireMedia('loadstart', video);
  assertDetachedCleanup(video, original, 'toggle-off blob reuse');
});

test('10-second prune pauses then restores a detached ad before blob-video reuse', () => {
  const harness = createPageHarness(undefined, { fakeClock: true, now: 1000 });
  const video = harness.createVideo({
    currentSrc: 'https://delivery.media-amazon.com/twitch/detached-prune-ad.mp4',
    defaultMuted: false,
    muted: false,
    volume: 0.42,
    style: {
      display: { value: 'inline-block', priority: '' },
      visibility: { value: 'visible', priority: 'important' },
      'pointer-events': { value: 'auto', priority: '' },
    },
  });
  const original = videoPresentation(video);
  harness.fireMedia('playing', video);
  assertGuarded(video, 'timed-prune detached fixture');

  video.operations.length = 0;
  video.pauseCalls = 0;
  video.isConnected = false;
  harness.state.mutationObservers[0].trigger([{
    type: 'childList',
    target: harness.document.documentElement,
    addedNodes: [],
  }]);
  harness.advance(9999);
  assert(video.pauseCalls === 0, 'detached ad was pruned before the 10-second grace period');
  assert(video.getAttribute('data-wo-twitch-independent-ad') === 'true' &&
    video.style.getPropertyValue('display') === 'none' && video.muted === true && video.volume === 0,
  'detached ad lost suppression before its prune deadline');

  harness.advance(1);
  assertDetachedCleanup(video, original, '10-second detached prune');
  video.currentSrc = 'blob:https://www.twitch.tv/reused-after-prune';
  video.isConnected = true;
  harness.fireMedia('loadstart', video);
  assertDetachedCleanup(video, original, 'pruned blob reuse');
});

test('dedicated module installs no React/reload/polling recovery', () => {
  const harness = createPageHarness();
  assert(harness.state.intervals === 0, 'module installed a setInterval watchdog');
  assert(!/\bsetSrc\s*\(/.test(MODULE_SOURCE), 'module calls React player setSrc');
  assert(!/(?:window\.)?location\.(?:reload|assign|replace)\s*\(/.test(MODULE_SOURCE),
    'module performs a page navigation/reload');
  assert(!/history\.(?:go|back|forward|pushState|replaceState)\s*\(/.test(MODULE_SOURCE),
    'module navigates browser history');
  // The claim is that this module never polls. Since it gained a woInterval helper so teardown
  // can clear timers, a bare "contains no setInterval" search now matches the helper's own
  // declaration rather than any polling. What matters is that nothing CALLS it, and that the one
  // raw setInterval in the file is the helper.
  assert(!/woInterval\(/.test(MODULE_SOURCE), 'module contains a polling interval');
  assert((MODULE_SOURCE.match(/\bsetInterval\s*\(/g) || []).length <= 1,
    'module has a raw polling interval outside the teardown helper');
  assert(!/__react|_reactRootContainer|mediaPlayerInstance/i.test(MODULE_SOURCE),
    'module depends on Twitch React internals');
});

(async () => {
  let passed = 0;
  let failed = 0;
  for (const item of tests) {
    try {
      await item.fn();
      passed++;
      console.log('  ok  - ' + item.name);
    } catch (error) {
      failed++;
      console.error('  FAIL - ' + item.name + ' :: ' + (error && error.message || error));
    }
  }
  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  if (failed) process.exit(1);
})().catch((error) => {
  console.error(error && error.stack || error);
  process.exit(1);
});
