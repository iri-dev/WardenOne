/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/*
 * Failure-containment regressions for the dedicated Twitch worker hook.
 *
 * These tests deliberately exercise native network/decode failure boundaries.
 * An ad-block attempt may fall back to Twitch's original response, but it must
 * never turn a usable native response into a rejected fetch or replay a bogus
 * response body as an HLS playlist.
 *
 * Run: node tools/test-twitch-failopen.js
 */
'use strict';

const fs = require('fs');
const vm = require('vm');

const MODULE_SOURCE = fs.readFileSync('twitch-adblock.js', 'utf8');
const VERSION = (/const VERSION = '([^']+)'/.exec(MODULE_SOURCE) || [])[1];
const RUNTIME_START = MODULE_SOURCE.indexOf('function twitchWorkerRuntime(');
const RUNTIME_END = MODULE_SOURCE.indexOf('\n  function installWorkerHook()', RUNTIME_START);

assert(VERSION, 'could not read the Twitch module version');
assert(RUNTIME_START >= 0 && RUNTIME_END > RUNTIME_START,
  'could not extract the Twitch worker runtime');

const WORKER_RUNTIME = MODULE_SOURCE.slice(RUNTIME_START, RUNTIME_END).trim();
const FLAG = '__woTwitchAdblock';
const CHANNEL = 'fixturechannel';
const MASTER_URL = 'https://usher.ttvnw.net/api/v2/channel/hls/' + CHANNEL
  + '.m3u8?allow_source=true&allow_audio_only=true&p=fixture&parent_domains=twitch.tv';
const MEDIA_URL = 'https://video-edge-fixture.ttvnw.net/original/chunked/index-dvr.m3u8?token=native';

const ORIGINAL_MASTER = `#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=8500000,CODECS="avc1.64002A,mp4a.40.2",RESOLUTION=1920x1080,VIDEO="chunked",FRAME-RATE=60.000
${MEDIA_URL}
`;

const CLEAN_MEDIA = `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-TARGETDURATION:2
#EXT-X-MEDIA-SEQUENCE:100
#EXTINF:2.000,live
https://video-edge-fixture.ttvnw.net/live/100.ts
`;

const AD_MEDIA = `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-TARGETDURATION:2
#EXT-X-MEDIA-SEQUENCE:200
#EXT-X-DATERANGE:ID="stitched-ad-fixture",CLASS="twitch-stitched-ad",DURATION=2.0,X-TV-TWITCH-AD-RADS-TOKEN="fixture"
#EXTINF:2.000,advertisement
https://video-weaver-fixture.ttvnw.net/commercial/200.ts
`;

const INVALID_MEDIA = '<!doctype html><title>temporary CDN challenge</title>';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function hls(body, status) {
  return new Response(String(body), {
    status: status == null ? 200 : status,
    headers: { 'content-type': 'application/vnd.apple.mpegurl' },
  });
}

function json(value, status) {
  return new Response(JSON.stringify(value), {
    status: status == null ? 200 : status,
    headers: { 'content-type': 'application/json' },
  });
}

function createRuntime(options) {
  options = options || {};
  const listeners = [];
  const state = { calls: [], messages: [], gqlRequests: [] };

  function dispatch(data) {
    const event = { data, stopImmediatePropagation() {} };
    for (const listener of listeners.slice()) listener(event);
  }

  async function nativeFetch(input, init) {
    const url = typeof input === 'string' ? input : String(input && input.url || input || '');
    state.calls.push({ url, init });
    return options.fetchRoute(url, init, state);
  }

  const worker = {
    fetch: nativeFetch,
    addEventListener(type, listener) {
      if (type === 'message') listeners.push(listener);
    },
    postMessage(message) {
      state.messages.push(message);
      if (!message || message.type !== 'gql-request') return;
      state.gqlRequests.push(message);
      Promise.resolve().then(async () => {
        const response = options.gqlRoute
          ? await options.gqlRoute(message, state)
          : json({ errors: [{ message: 'fixture rejects backup token' }] }, 403);
        const body = await response.text();
        dispatch({
          [FLAG]: VERSION,
          type: 'gql-response',
          id: message.id,
          response: {
            status: response.status,
            statusText: response.statusText,
            headers: Array.from(response.headers.entries()),
            body,
          },
        });
      }).catch((error) => dispatch({
        [FLAG]: VERSION,
        type: 'gql-response',
        id: message.id,
        error: String(error && error.message || error),
      }));
    },
  };

  const sandbox = {
    self: worker,
    URL,
    Response: options.ResponseCtor || Response,
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
  vm.runInContext('(' + WORKER_RUNTIME + ')("", {}, ' + JSON.stringify(VERSION) + ');', sandbox,
    { filename: 'twitch-adblock.js:fail-open-runtime' });

  return {
    fetch: worker.fetch,
    state,
    configure(enabled) {
      dispatch({ [FLAG]: VERSION, type: 'config', enabled });
    },
  };
}

async function expectReject(promise, expected, label) {
  try {
    await promise;
  } catch (error) {
    assert(error === expected, label + ' changed the native rejection object');
    return;
  }
  throw new Error(label + ' unexpectedly resolved');
}

const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

test('master requests preserve the exact native URL and response', async () => {
  const runtime = createRuntime({
    fetchRoute(url) {
      assert(url === MASTER_URL, 'worker rewrote the native Usher URL to ' + url);
      return hls(ORIGINAL_MASTER);
    },
  });
  const response = await runtime.fetch(MASTER_URL);
  assert(await response.text() === ORIGINAL_MASTER, 'worker changed the native master body');
  assert(runtime.state.calls.length === 1, 'master pass-through made duplicate requests');
});

test('native master aborts reject once without a hidden retry', async () => {
  const abort = new Error('fixture caller abort');
  abort.name = 'AbortError';
  const runtime = createRuntime({
    fetchRoute() { throw abort; },
  });
  await expectReject(runtime.fetch(MASTER_URL), abort, 'master abort');
  assert(runtime.state.calls.length === 1, 'master abort triggered a retry loop');
});

test('native media network failures reject once without a hidden retry', async () => {
  const failure = new TypeError('fixture network failure');
  const runtime = createRuntime({
    fetchRoute() { throw failure; },
  });
  await expectReject(runtime.fetch(MEDIA_URL), failure, 'media failure');
  assert(runtime.state.calls.length === 1, 'media failure triggered a retry loop');
});

test('unmapped non-Twitch m3u8 traffic is an exact native pass-through', async () => {
  const thirdPartyUrl = 'https://media.example.test/live/playlist.m3u8?fixture=1';
  const native = hls(AD_MEDIA);
  const runtime = createRuntime({
    fetchRoute(url) {
      assert(url === thirdPartyUrl, 'worker rewrote an unrelated m3u8 URL');
      return native;
    },
  });
  const response = await runtime.fetch(thirdPartyUrl);
  assert(response === native, 'worker replaced an unrelated m3u8 response');
  assert(runtime.state.calls.length === 1, 'unrelated m3u8 traffic was duplicated');
  assert(runtime.state.gqlRequests.length === 0, 'unrelated m3u8 traffic started Twitch backup work');
});

test('non-success media responses retain native status and body', async () => {
  const runtime = createRuntime({
    fetchRoute() { return hls('native service unavailable', 503); },
  });
  const response = await runtime.fetch(MEDIA_URL);
  assert(response.status === 503, 'worker replaced native HTTP 503 with ' + response.status);
  assert(await response.text() === 'native service unavailable', 'worker changed the native error body');
  assert(runtime.state.calls.length === 1, 'HTTP failure started hidden backup work');
  assert(runtime.state.gqlRequests.length === 0, 'HTTP failure requested a backup token');
});

test('an unreadable response clone fails open to the fetched native response', async () => {
  const native = hls(CLEAN_MEDIA);
  native.clone = () => { throw new Error('fixture clone failure'); };
  const runtime = createRuntime({
    fetchRoute() { return native; },
  });
  const response = await runtime.fetch(MEDIA_URL);
  assert(response === native, 'worker discarded the already-fetched native response');
  assert(runtime.state.calls.length === 1, 'clone failure refetched native media');
  assert(runtime.state.gqlRequests.length === 0, 'clone failure requested a backup token');
});

test('an internal replacement-construction failure returns native media', async () => {
  class BrokenReplacementResponse {
    constructor() { throw new Error('fixture replacement construction failure'); }
  }
  const runtime = createRuntime({
    ResponseCtor: BrokenReplacementResponse,
    fetchRoute() { return hls(AD_MEDIA); },
  });
  const response = await runtime.fetch(MEDIA_URL);
  assert(await response.text() === AD_MEDIA, 'internal transform failure did not fail open to native media');
  assert(runtime.state.calls.length === 1, 'internal transform failure refetched media');
});

test('invalid HTTP-200 text is never replayed later as a clean HLS snapshot', async () => {
  let mediaPoll = 0;
  const runtime = createRuntime({
    fetchRoute(url) {
      if (url === MASTER_URL) return hls(ORIGINAL_MASTER);
      if (url.startsWith(MEDIA_URL.split('?')[0])) return hls(mediaPoll++ === 0 ? INVALID_MEDIA : AD_MEDIA);
      throw new Error('unexpected backup network request: ' + url);
    },
  });
  await runtime.fetch(MASTER_URL);
  const invalid = await runtime.fetch(MEDIA_URL);
  assert(await invalid.text() === INVALID_MEDIA, 'initial invalid native response was unexpectedly rewritten');

  const recovery = await runtime.fetch(MEDIA_URL);
  const body = await recovery.text();
  assert(body !== INVALID_MEDIA, 'worker replayed HTML as its clean native snapshot');
  assert(/^#EXTM3U(?:\r?\n|$)/.test(body), 'ad recovery returned a non-HLS body');
});

test('low-latency cursor queries are removed only after an intervention starts', async () => {
  const llUrl = MEDIA_URL + '&_HLS_msn=200&_HLS_part=2&_HLS_skip=YES';
  let mediaPoll = 0;
  const observedMediaUrls = [];
  const runtime = createRuntime({
    fetchRoute(url) {
      if (url === MASTER_URL) return hls(ORIGINAL_MASTER);
      if (new URL(url).pathname === new URL(MEDIA_URL).pathname) {
        observedMediaUrls.push(url);
        return hls(mediaPoll++ === 0 ? AD_MEDIA : CLEAN_MEDIA);
      }
      throw new Error('unexpected backup network request: ' + url);
    },
  });
  await runtime.fetch(MASTER_URL);
  await runtime.fetch(llUrl);
  await runtime.fetch(llUrl);

  assert(observedMediaUrls[0] === llUrl, 'worker stripped low-latency cursors before any intervention');
  const recoveryUrl = new URL(observedMediaUrls[1]);
  assert(recoveryUrl.searchParams.get('token') === 'native', 'recovery changed a non-LL media query');
  for (const key of ['_HLS_msn', '_HLS_part', '_HLS_skip']) {
    assert(!recoveryUrl.searchParams.has(key), 'recovery retained blocking cursor ' + key);
  }
  assert(observedMediaUrls.length === 2, 'LL recovery duplicated a native media poll');
});

test('concurrent backup failure stays bounded and resolves every caller', async () => {
  const runtime = createRuntime({
    fetchRoute(url) {
      if (url === MASTER_URL) return hls(ORIGINAL_MASTER);
      if (url.startsWith(MEDIA_URL.split('?')[0])) return hls(AD_MEDIA);
      throw new Error('unexpected backup network request: ' + url);
    },
  });
  await runtime.fetch(MASTER_URL);
  const responses = await Promise.all(Array.from({ length: 20 }, () => runtime.fetch(MEDIA_URL)));
  const bodies = await Promise.all(responses.map((response) => response.text()));
  assert(bodies.every((body) => /^#EXTM3U(?:\r?\n|$)/.test(body)),
    'backup failure returned an invalid media body');
  assert(runtime.state.gqlRequests.length === 4,
    'concurrent backup failure multiplied proxy attempts: ' + runtime.state.gqlRequests.length);

  await runtime.fetch(MEDIA_URL);
  assert(runtime.state.gqlRequests.length === 4,
    'negative backup cache retried immediately after failure');
});

test('disabled mode preserves native response and rejection semantics', async () => {
  let fail = false;
  const nativeFailure = new TypeError('disabled native failure');
  const runtime = createRuntime({
    fetchRoute() {
      if (fail) throw nativeFailure;
      return hls(AD_MEDIA);
    },
  });
  runtime.configure(false);
  const response = await runtime.fetch(MEDIA_URL);
  assert(await response.text() === AD_MEDIA, 'disabled worker changed native media');
  fail = true;
  await expectReject(runtime.fetch(MEDIA_URL), nativeFailure, 'disabled native failure');
  assert(runtime.state.calls.length === 2, 'disabled worker duplicated a native request');
  assert(runtime.state.gqlRequests.length === 0, 'disabled worker started backup work');
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
