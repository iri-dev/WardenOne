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

  dispatchEvent(event) {
    const list = this.listeners.get(event && event.type) || [];
    for (const callback of list.slice()) callback.call(this, event);
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
  const state = {
    fetchCalls: [],
    workerInstances: [],
    blobSources: new Map(),
    revokedUrls: [],
    timeouts: [],
    intervals: 0,
    mutationObservers: [],
    videos: [],
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
      state.workerInstances.push(this);
    }

    postMessage(message) {
      this.messages.push(message);
    }
  }

  class HarnessXHR {
    open(method, url, async) {
      this.method = method;
      this.url = url;
      this.async = async;
    }

    overrideMimeType() {}

    send() {
      this.responseText = 'self.__wardenOneOriginalWorkerRan = true;';
    }
  }

  class HarnessVideoElement extends ElementHarness {
    constructor(options) {
      super('video');
      options = options || {};
      this.operations = [];
      this.style = new StyleHarness((operation) => this.operations.push(operation));
      this.currentSrc = String(options.currentSrc || '');
      this.defaultMuted = !!options.defaultMuted;
      this.muted = !!options.muted;
      this.volume = options.volume == null ? 1 : Number(options.volume);
      this.pauseCalls = 0;
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
      this.operations.push({ type: 'pause' });
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
    if (selector === 'video' || selector.includes('video')) {
      return state.videos.filter((video) => video.isConnected &&
        (selector === 'video' || video.inPlayer === true));
    }
    return [];
  };

  const window = new EventTargetHarness();
  window.top = window;
  window.location = {
    hostname: 'www.twitch.tv',
    href: 'https://www.twitch.tv/fixturechannel',
  };
  window.__WO_CONFIG__ = Object.assign({ enabled: true, twitchAdBlock: true }, config || {});
  window.Worker = NativeWorker;

  async function nativeFetch(input, init) {
    state.fetchCalls.push({ input: input, init: init });
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

const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
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

test('page hook preserves a mixed GQL batch while forcing token player type', async () => {
  const harness = createPageHarness();
  const unrelated = {
    operationName: 'ChannelShell',
    variables: { login: 'fixturechannel' },
    extensions: { persistedQuery: { version: 1, sha256Hash: 'unrelated-hash' } },
  };
  const token = {
    operationName: 'PlaybackAccessToken',
    variables: {
      isLive: true,
      login: 'fixturechannel',
      isVod: false,
      vodID: '',
      playerType: 'picture-by-picture',
      platform: 'android',
      retained: 'yes',
    },
    extensions: { persistedQuery: { version: 1, sha256Hash: 'captured-token-hash' } },
  };
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
    'GQL player-type force corrupted the request into an empty body');
  const parsed = JSON.parse(forwarded.body);
  assert(Array.isArray(parsed) && parsed.length === 2, 'mixed GQL batch shape changed');
  equal(parsed[0], unrelated, 'non-token query in GQL batch was modified');
  assert(parsed[1].variables.playerType === 'popout', 'token playerType was not forced to popout');
  assert(parsed[1].variables.platform === 'web', 'forced popout token did not use web platform');
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
      playerType: 'site',
      platform: 'web',
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

test('independent-video guard uses one targeted observer plus delegated media events', () => {
  const harness = createPageHarness();
  assert(harness.state.mutationObservers.length === 1,
    'independent-video guard must install exactly one MutationObserver');
  const observer = harness.state.mutationObservers[0];
  assert(observer.observeCalls.length === 1, 'independent-video observer was not installed exactly once');
  const options = observer.observeCalls[0].options || {};
  assert(options.childList === true && options.subtree === true && options.attributes === true,
    'independent-video observer is missing its targeted subtree/attribute coverage');
  equal(Array.from(options.attributeFilter || []), ['aria-label', 'src'],
    'independent-video observer watches unexpected attributes');
  for (const eventName of ['loadstart', 'loadedmetadata', 'play', 'playing', 'volumechange']) {
    assert((harness.document.listeners.get(eventName) || []).length === 1,
      'independent-video guard is missing delegated ' + eventName + ' handling');
  }
  assert((MODULE_SOURCE.match(/new\s+MutationObserver\s*\(/g) || []).length === 1,
    'dedicated Twitch module contains more than one MutationObserver constructor');
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
  assert(css && !/video\[(?:aria-label|src)/i.test(css.textContent),
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
  assert(!/\bsetInterval\s*\(/.test(MODULE_SOURCE), 'module contains a polling interval');
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
