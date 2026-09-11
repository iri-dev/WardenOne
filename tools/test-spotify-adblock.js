/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/* Behavioural tests for the real Spotify Web Player module. */
'use strict';

const fs = require('fs');
const vm = require('vm');

const SOURCE = fs.readFileSync('spotify-adblock.js', 'utf8');

let failed = 0;
function check(name, condition, detail) {
  if (condition) {
    console.log('  ok  - ' + name);
    return;
  }
  failed++;
  console.error('  FAIL - ' + name + (detail ? ' :: ' + detail : ''));
}

function makeEventTarget() {
  const listeners = new Map();
  return {
    addEventListener(type, listener) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(listener);
    },
    removeEventListener(type, listener) {
      const list = listeners.get(type) || [];
      const index = list.indexOf(listener);
      if (index !== -1) list.splice(index, 1);
    },
    dispatch(type, event) {
      for (const listener of (listeners.get(type) || []).slice()) listener(event || {});
    },
    listenerCount(type) {
      return (listeners.get(type) || []).length;
    }
  };
}

function createHarness(options) {
  const opts = options || {};
  const windowEvents = makeEventTarget();
  const documentEvents = makeEventTarget();
  const observers = [];
  const audio = { muted: false };
  const root = {
    children: [],
    appendChild(node) {
      if (!this.children.includes(node)) this.children.push(node);
      node.parentNode = this;
      node.isConnected = true;
      return node;
    },
    removeChild(node) {
      const index = this.children.indexOf(node);
      if (index !== -1) this.children.splice(index, 1);
      node.parentNode = null;
      node.isConnected = false;
    }
  };
  const document = Object.assign(documentEvents, {
    head: root,
    documentElement: root,
    adActive: false,
    createElement(tag) {
      return {
        tagName: String(tag || '').toUpperCase(),
        id: '',
        textContent: '',
        disabled: false,
        isConnected: false,
        parentNode: null
      };
    },
    querySelector(selector) {
      if (selector.includes('context-item-info-ad-subtitle')) return this.adActive ? {} : null;
      return null;
    },
    querySelectorAll(selector) {
      return selector === 'audio' ? [audio] : [];
    }
  });

  class MockMutationObserver {
    constructor(callback) {
      this.callback = callback;
      this.disconnected = false;
      observers.push(this);
    }
    observe() {}
    disconnect() { this.disconnected = true; }
  }

  let fetchCalls = 0;
  const queuedResponses = [];
  const nativeFetch = function () {
    fetchCalls++;
    if (!queuedResponses.length) throw new Error('no queued response');
    return Promise.resolve(queuedResponses.shift());
  };
  const context = {
    window: null,
    self: null,
    location: { hostname: opts.hostname || 'open.spotify.com' },
    document,
    MutationObserver: MockMutationObserver,
    Headers,
    Response,
    Request,
    URL,
    Object,
    Array,
    String,
    Promise,
    Reflect,
    WeakMap,
    Set,
    JSON,
    setTimeout,
    clearTimeout,
    console
  };
  context.window = Object.assign(windowEvents, {
    fetch: nativeFetch,
    Headers,
    Response,
    __WO_CONFIG__: opts.config
  });
  context.self = context.window;
  vm.createContext(context);
  vm.runInContext(SOURCE, context, { filename: 'spotify-adblock.js' });

  return {
    context,
    document,
    root,
    audio,
    observers,
    nativeFetch,
    queue(response) { queuedResponses.push(response); },
    fetchCalls() { return fetchCalls; },
    flush() { return new Promise((resolve) => setTimeout(resolve, 120)); },
    sendConfig(config, token) {
      const key = token || 'bridge-token';
      windowEvents.dispatch('message', {
        source: context.window,
        data: { source: 'wardenone-handshake', token: key }
      });
      windowEvents.dispatch('message', {
        source: context.window,
        data: { source: 'wardenone', kind: 'config', token: key, overrides: config }
      });
    }
  };
}

function response(payload, init) {
  const body = typeof payload === 'string' ? payload : JSON.stringify(payload);
  return new Response(body, Object.assign({
    status: 200,
    headers: { 'content-type': 'application/json', 'x-fixture': 'spotify' }
  }, init || {}));
}

(async () => {
  {
    const h = createHarness({ hostname: 'example.com' });
    check('the module is scoped to open.spotify.com', h.context.window.fetch === h.nativeFetch);
    check('an unrelated host gets no ready flag', !h.context.window.__wardenOneSpotifyAdblockReady);
  }

  {
    const h = createHarness();
    const original = response({
      state_machine: {
        tracks: [{
          metadata: { uri: 'spotify:track:real-song' },
          manifest: { file_urls_mp3: [{ file_id: 'music-id', file_url: 'https://audio-fa.scdn.co/audio/music' }] }
        }]
      }
    });
    h.queue(original);
    const result = await h.context.window.fetch('https://gew4-spclient.spotify.com/track-playback/v1/media/spotify:track:real-song');
    check('ordinary music keeps the original Response object', result === original);
    const body = await result.json();
    check('ordinary music keeps its media URL', body.state_machine.tracks[0].manifest.file_urls_mp3[0].file_url === 'https://audio-fa.scdn.co/audio/music');
  }

  {
    const h = createHarness();
    const original = response({
      state_machine: {
        tracks: {
          current: {
            metadata: { uri: 'spotify:ad:campaign:creative' },
            manifest: { file_urls_mp3: [{ file_id: 'ad-id', file_url: 'https://adstudio-assets.scdn.co/creative.mp3' }] }
          },
          next: {
            metadata: { uri: 'spotify:track:next-song' },
            manifest: { file_urls_mp3: [{ file_id: 'next-id', file_url: 'https://audio-fa.scdn.co/audio/next' }] }
          }
        }
      }
    }, { status: 206, statusText: 'Partial Content' });
    h.queue(original);
    const result = await h.context.window.fetch('https://gew4-spclient.spotify.com/track-playback/v1/media/spotify:ad:campaign');
    const body = await result.json();
    const ad = body.state_machine.tracks.current.manifest.file_urls_mp3[0];
    const music = body.state_machine.tracks.next.manifest.file_urls_mp3[0];
    check('an ad-marked track receives the silent media URL', /^data:video\/mp4;base64,/.test(ad.file_url));
    check('the ad candidate receives the Chromium-safe file id', ad.file_id === 1);
    check('a neighbouring real track is not rewritten', music.file_url === 'https://audio-fa.scdn.co/audio/next');
    check('the rewritten response preserves status', result.status === 206 && result.statusText === 'Partial Content');
    check('the rewritten response preserves safe headers', result.headers.get('x-fixture') === 'spotify');
    h.context.__spotifySilentUrlForTest = ad.file_url;
    check('Spotify HTTPS validation accepts only the exact bundled silent URL',
      vm.runInContext('/^https:\\\/\\\//.test(__spotifySilentUrlForTest)', h.context));
    check('unrelated data URLs do not pass HTTPS validation',
      !vm.runInContext('/^https:\\\/\\\//.test("data:video/mp4;base64,unrelated")', h.context));
  }

  {
    const h = createHarness();
    const invalid = response('{not-json');
    h.queue(invalid);
    const result = await h.context.window.fetch('https://spclient.wg.spotify.com/track-playback/v1/media/broken');
    check('an unreadable playback response fails open', result === invalid);
  }

  {
    const h = createHarness();
    const original = response({
      state_machine: { tracks: [{ metadata: { uri: 'spotify:ad:outside-playback' }, manifest: { file_urls_mp3: [{ file_url: 'https://ad.example/ad.mp3' }] } }] }
    });
    h.queue(original);
    const result = await h.context.window.fetch('https://spclient.wg.spotify.com/metadata/v1/ad-campaign');
    check('ad-like JSON outside track playback is not rewritten', result === original);
  }

  {
    const h = createHarness();
    h.context.window.__WO_CONFIG__ = { enabled: false, adShield: false };
    h.document.dispatch('wo-config-change');
    const original = response({
      state_machine: { tracks: [{ metadata: { uri: 'spotify:ad:page-spoof' }, manifest: { file_urls_mp3: [{ file_url: 'https://ad.example/ad.mp3' }] } }] }
    });
    h.queue(original);
    const result = await h.context.window.fetch('https://spclient.wg.spotify.com/track-playback/v1/media/page-spoof');
    check('page-writable config and events cannot disable the module', result !== original);
  }

  {
    const h = createHarness();
    h.sendConfig({ enabled: true, adShield: false });
    const original = response({
      state_machine: { tracks: [{ metadata: { uri: 'spotify:ad:disabled' }, manifest: { file_urls_mp3: [{ file_url: 'https://ad.example/ad.mp3' }] } }] }
    });
    h.queue(original);
    const result = await h.context.window.fetch('https://spclient.wg.spotify.com/track-playback/v1/media/disabled');
    const style = h.root.children.find((node) => node.id === 'wo-spotify-adblock-css');
    check('turning AdShield off makes playback requests pass through', result === original);
    check('turning AdShield off disables Spotify cosmetics', style && style.disabled === true);
  }

  {
    const h = createHarness();
    h.document.adActive = true;
    h.observers[0].callback([]);
    await h.flush();
    check('the current-player ad signal mutes Spotify audio', h.audio.muted === true);
    h.document.adActive = false;
    h.observers[0].callback([]);
    await h.flush();
    check('audio is restored after the current ad signal clears', h.audio.muted === false);
  }

  {
    const h = createHarness();
    const spotifyFetch = h.context.window.fetch;
    const outerFetch = function () { return Reflect.apply(spotifyFetch, this, arguments); };
    h.context.window.fetch = outerFetch;
    h.context.window.__wardenOneSpotifyAdblockDispose();
    const original = response({
      state_machine: { tracks: [{ metadata: { uri: 'spotify:ad:disposed' }, manifest: { file_urls_mp3: [{ file_url: 'https://ad.example/ad.mp3' }] } }] }
    });
    h.queue(original);
    const result = await outerFetch('https://spclient.wg.spotify.com/track-playback/v1/media/disposed');
    check('a disposed hook nested below another fetch wrapper becomes a pass-through', result === original);
  }

  {
    const h = createHarness();
    const firstFetch = h.context.window.fetch;
    const firstObserver = h.observers[0];
    h.context.window.__wardenOneSpotifyAdblockReady = 'wo-stale';
    vm.runInContext(SOURCE, h.context, { filename: 'spotify-adblock.js:repair' });
    check('repair replaces rather than stacks the fetch hook', h.context.window.fetch !== firstFetch);
    check('repair disconnects the previous DOM observer', firstObserver.disconnected === true);
    check('repair leaves one active message listener', h.context.window.listenerCount('message') === 1);
  }

  if (failed) {
    console.error('\n' + failed + ' Spotify adblock test(s) failed');
    process.exit(1);
  }
  console.log('\nSpotify adblock tests passed');
})().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
