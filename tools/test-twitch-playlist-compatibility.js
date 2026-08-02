/*
 * Behavioral compatibility harness for twitch-adblock.js's worker runtime.
 *
 * The runtime is extracted from the dedicated MAIN-world module and executed
 * in a VM with Twitch-shaped HLS/GQL traffic. No legacy content-script hook is
 * used by this suite.
 *
 * Run: node tools/test-twitch-playlist-compatibility.js
 */
'use strict';

const fs = require('fs');
const vm = require('vm');
const { performance } = require('perf_hooks');

const MODULE_SOURCE = fs.readFileSync('twitch-adblock.js', 'utf8');
const RUNTIME_VERSION = (/const VERSION = '([^']+)'/.exec(MODULE_SOURCE) || [])[1];
const RUNTIME_START = MODULE_SOURCE.indexOf('function twitchWorkerRuntime(');
const RUNTIME_END = MODULE_SOURCE.indexOf('\n  function installWorkerHook()', RUNTIME_START);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function equal(actual, expected, message) {
  const left = JSON.stringify(actual);
  const right = JSON.stringify(expected);
  assert(left === right, message + '\nexpected: ' + right + '\nactual:   ' + left);
}

assert(RUNTIME_VERSION, 'could not read dedicated Twitch module version');
assert(RUNTIME_START >= 0 && RUNTIME_END > RUNTIME_START,
  'could not locate twitchWorkerRuntime in dedicated module');
const WORKER_RUNTIME_SOURCE = MODULE_SOURCE.slice(RUNTIME_START, RUNTIME_END).trim();

const FLAG = '__woTwitchAdblock';
const CHANNEL = 'fixturechannel';
const GQL_URL = 'https://gql.twitch.tv/gql';
const MASTER_URL = 'https://usher.ttvnw.net/api/v2/channel/hls/' + CHANNEL
  + '.m3u8?allow_source=true&allow_audio_only=true&p=fixture&parent_domains=twitch.tv';
const ORIGINAL_MEDIA_URL = 'https://video-edge-fixture.ttvnw.net/original/chunked/index-dvr.m3u8?token=original';

const ORIGINAL_MASTER = `#EXTM3U
#EXT-X-TWITCH-INFO:ORIGIN="s3",CLUSTER="fixture",MANIFEST-CLUSTER="fixture"
#EXT-X-MEDIA:TYPE=VIDEO,GROUP-ID="chunked",NAME="1080p60 (source)",AUTOSELECT=YES,DEFAULT=YES
#EXT-X-STREAM-INF:BANDWIDTH=8500000,CODECS="avc1.64002A,mp4a.40.2",RESOLUTION=1920x1080,VIDEO="chunked",FRAME-RATE=60.000
${ORIGINAL_MEDIA_URL}
`;

const CLEAN_MEDIA = `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-TARGETDURATION:2
#EXT-X-MEDIA-SEQUENCE:99100
#EXT-X-PROGRAM-DATE-TIME:2026-07-23T00:00:00.000Z
#EXTINF:2.000,live
https://video-edge-fixture.ttvnw.net/live/99100.ts
#EXT-X-PROGRAM-DATE-TIME:2026-07-23T00:00:02.000Z
#EXTINF:2.000,live
https://video-edge-fixture.ttvnw.net/live/99101.ts
`;
const CLEAN_FMP4_MEDIA = `#EXTM3U
#EXT-X-VERSION:7
#EXT-X-TARGETDURATION:2
#EXT-X-MEDIA-SEQUENCE:99100
#EXT-X-MAP:URI="https://video-edge-fixture.ttvnw.net/live/init.mp4"
#EXTINF:2.000,live
https://video-edge-fixture.ttvnw.net/live/99100.m4s
`;

function markedAd(marker, suffix, title) {
  const segmentTitle = title === undefined ? 'advertisement' : title;
  return `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-TARGETDURATION:2
#EXT-X-MEDIA-SEQUENCE:501
${marker}
#EXTINF:2.000,${segmentTitle}
https://video-weaver-fixture.ttvnw.net/commercial/${suffix || '501'}.ts
`;
}

const STITCHED_AD = markedAd(
  '#EXT-X-DATERANGE:ID="stitched-ad-1784764800",CLASS="twitch-stitched-ad",DURATION=30.0',
  'stitched');
const SHORT_STITCHED_AD = `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-TARGETDURATION:2
#EXT-X-MEDIA-SEQUENCE:501
#EXT-X-DATERANGE:ID="range-1784764800",CLASS="stitched",DURATION=30.0
#EXTINF:2.000,
https://video-edge-fixture.ttvnw.net/live/generic-501.ts
`;
const SHORT_STITCHED_ID_AD = `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-TARGETDURATION:2
#EXT-X-MEDIA-SEQUENCE:502
#EXT-X-DATERANGE:ID="stitched",CLASS="midroll",DURATION=30.0
#EXTINF:2.000,
https://video-edge-fixture.ttvnw.net/live/generic-502.ts
`;
const FMP4_STITCHED_AD = `#EXTM3U
#EXT-X-VERSION:7
#EXT-X-TARGETDURATION:2
#EXT-X-MEDIA-SEQUENCE:501
#EXT-X-MAP:URI="https://video-edge-fixture.ttvnw.net/original/init.mp4"
#EXT-X-DATERANGE:ID="stitched-ad-fmp4",CLASS="twitch-stitched-ad",DURATION=2.0
#EXTINF:2.000,advertisement
https://video-weaver-fixture.ttvnw.net/commercial/501.m4s
`;
const CUE_OUT_AD = markedAd('#EXT-X-CUE-OUT:30', 'cue-out');
const MAF_AD = markedAd('#EXT-X-DATERANGE:ID="maf-1",CLASS="twitch-maf-ad",DURATION=30.0', 'maf');
const TRIGGER_AD = markedAd('#EXT-X-DATERANGE:ID="trigger-1",CLASS="twitch-trigger",DURATION=30.0', 'trigger');
const QUARTILE_ONLY = markedAd('#EXT-X-TWITCH-AD-QUARTILE:FIRST', 'quartile-only', '');
const STALE_STITCHED_MARKER = markedAd(
  '#EXT-X-DATERANGE:ID="stitched-ad-stale",CLASS="twitch-stitched-ad",DURATION=30.0',
  'stale-marker',
  'live');
const AUTHORITATIVE_PREROLL_LIVE_TITLE = `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-TARGETDURATION:2
#EXT-X-MEDIA-SEQUENCE:609
#EXT-X-DATERANGE:ID="stitched-ad-authoritative-preroll",CLASS="twitch-stitched-ad",DURATION=4.0,X-TV-TWITCH-AD-ROLL-TYPE="PREROLL"
#EXTINF:2.000,live
https://video-edge-fixture.ttvnw.net/live/authoritative-preroll-609.ts
`;
const EXPLICIT_PREROLL_AD = `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-TARGETDURATION:2
#EXT-X-MEDIA-SEQUENCE:610
#EXT-X-DATERANGE:ID="stitched-ad-explicit-preroll",CLASS="twitch-stitched-ad",DURATION=4.0,X-TV-TWITCH-AD-ROLL-TYPE="PREROLL"
#EXTINF:2.000,advertisement
https://video-weaver-fixture.ttvnw.net/commercial/explicit-preroll-610.ts
`;
const STRONG_METADATA_ALL_AD = `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-TARGETDURATION:2
#EXT-X-MEDIA-SEQUENCE:610
#EXT-X-DATERANGE:ID="stitched-ad-strong",CLASS="twitch-stitched-ad",DURATION=4.0,X-TV-TWITCH-AD-RADS-TOKEN="strong-fixture"
#EXTINF:2.000,
https://video-weaver-fixture.ttvnw.net/commercial/strong-610.ts
#EXTINF:2.000,
https://video-weaver-fixture.ttvnw.net/commercial/strong-611.ts
`;
// Low-latency playlist carrying one stitched ad segment plus clean live content.
const LOW_LATENCY_MIXED_AD = `#EXTM3U
#EXT-X-VERSION:9
#EXT-X-TARGETDURATION:2
#EXT-X-SERVER-CONTROL:CAN-BLOCK-RELOAD=YES,PART-HOLD-BACK=1.500
#EXT-X-PART-INF:PART-TARGET=0.500
#EXT-X-MEDIA-SEQUENCE:810
#EXT-X-DATERANGE:ID="stitched-ad-ll",CLASS="twitch-stitched-ad",DURATION=2.0,X-TV-TWITCH-AD-RADS-TOKEN="ll-fixture"
#EXTINF:2.000,
https://video-weaver-fixture.ttvnw.net/commercial/ll-810.ts
#EXTINF:2.000,live
https://video-weaver-fixture.ttvnw.net/live/ll-811.ts
#EXT-X-PART:DURATION=0.500,URI="https://video-weaver-fixture.ttvnw.net/live/ll-812-part.m4s"
#EXT-X-PRELOAD-HINT:TYPE=PART,URI="https://video-weaver-fixture.ttvnw.net/live/ll-813-part.m4s"
`;
const PART_ONLY_AD = `#EXTM3U
#EXT-X-VERSION:9
#EXT-X-TARGETDURATION:2
#EXT-X-SERVER-CONTROL:CAN-BLOCK-RELOAD=YES,PART-HOLD-BACK=1.500
#EXT-X-PART-INF:PART-TARGET=0.500
#EXT-X-MEDIA-SEQUENCE:812
#EXT-X-DATERANGE:ID="stitched-ad-parts",CLASS="twitch-stitched-ad",DURATION=1.0
#EXT-X-PART:DURATION=0.500,URI="https://video-weaver-fixture.ttvnw.net/stitched-ad/812.0.m4s"
#EXT-X-PART:DURATION=0.500,URI="https://video-weaver-fixture.ttvnw.net/stitched-ad/812.1.m4s"
`;
const PREFETCH_ONLY_AD = `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-TARGETDURATION:2
#EXT-X-MEDIA-SEQUENCE:813
#EXT-X-DATERANGE:ID="stitched-813",CLASS="stitched",DURATION=2.0
#EXT-X-TWITCH-PREFETCH:https://video-weaver-fixture.ttvnw.net/stitched-ad/813.ts
`;
const KNOWN_AD_URI_NO_MARKER = `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-TARGETDURATION:2
#EXT-X-MEDIA-SEQUENCE:710
#EXTINF:2.000,live
https://video-weaver-fixture.ttvnw.net/adsquared/710.ts
`;
const STITCHED_AD_URI_WITH_LIVE_TITLE = `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-TARGETDURATION:2
#EXT-X-MEDIA-SEQUENCE:720
#EXTINF:2.000,live
https://video-weaver-fixture.ttvnw.net/live/stitched-ad-123.ts
`;
const SLID_MARKER_CONFIRMED_AD = `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-TARGETDURATION:2
#EXT-X-MEDIA-SEQUENCE:900
#EXT-X-DATERANGE:ID="stitched-ad-slide",CLASS="twitch-stitched-ad",DURATION=2.0
#EXT-X-CUE-OUT:2
#EXTINF:2.000,
https://video-weaver-fixture.ttvnw.net/commercial/confirmed-900.ts
`;
const SLID_MARKER_GENERIC_TAIL = `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-TARGETDURATION:2
#EXT-X-MEDIA-SEQUENCE:901
#EXTINF:2.000,
https://video-edge-fixture.ttvnw.net/live/generic-tail-901.ts
`;
const SCTE35_TIMED_PLAYLIST = `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-TARGETDURATION:2
#EXT-X-MEDIA-SEQUENCE:820
#EXT-X-PROGRAM-DATE-TIME:2026-07-23T00:00:00.000Z
#EXTINF:2.000,live
https://video-edge-fixture.ttvnw.net/live/scte-before-820.ts
#EXT-X-DATERANGE:ID="scte35-out-fixture",START-DATE="2026-07-23T00:00:02.000Z",DURATION=2.000,SCTE35-OUT=0xFC302000
#EXTINF:2.000,live
https://video-weaver-fixture.ttvnw.net/live/scte-overlap-821.ts
#EXTINF:2.000,live
https://video-edge-fixture.ttvnw.net/live/scte-after-822.ts
`;
const MIXED_CUE_PLAYLIST = `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-TARGETDURATION:2
#EXT-X-MEDIA-SEQUENCE:810
#EXTINF:2.000,
relative-live-before.ts
#EXT-X-CUE-OUT:2
#EXTINF:2.000,
relative-ad-inside-cue.ts
#EXT-X-CUE-IN
#EXTINF:2.000,
relative-live-after.ts
`;

function hlsResponse(body, status) {
  return new Response(String(body), {
    status: status == null ? 200 : status,
    headers: { 'content-type': 'application/vnd.apple.mpegurl' },
  });
}

function jsonResponse(value, status) {
  return new Response(typeof value === 'string' ? value : JSON.stringify(value), {
    status: status == null ? 200 : status,
    headers: { 'content-type': 'application/json' },
  });
}

function backupMaster(signature) {
  return `#EXTM3U
#EXT-X-MEDIA:TYPE=VIDEO,GROUP-ID="chunked-av1",NAME="1080p60 AV1"
#EXT-X-MEDIA:TYPE=VIDEO,GROUP-ID="chunked",NAME="1080p60 (source)"
#EXT-X-STREAM-INF:BANDWIDTH=7000000,CODECS="av01.0.08M.08,mp4a.40.2",RESOLUTION=1920x1080,VIDEO="chunked-av1",FRAME-RATE=60.000
https://video-edge-fixture.ttvnw.net/backup/${signature}/av1-1080.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=8500000,CODECS="avc1.64002A,mp4a.40.2",RESOLUTION=1920x1080,VIDEO="chunked",FRAME-RATE=60.000
https://video-edge-fixture.ttvnw.net/backup/${signature}/h264-1080.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=4500000,CODECS="avc1.4D401F,mp4a.40.2",RESOLUTION=1280x720,VIDEO="720p60",FRAME-RATE=60.000
https://video-edge-fixture.ttvnw.net/backup/${signature}/h264-720.m3u8
`;
}

function nestedToken(playerType) {
  return {
    data: {
      streamPlaybackAccessToken: {
        value: 'token-' + playerType,
        signature: 'sig-' + playerType,
        authorization: { isForbidden: false, forbiddenReasonCode: null },
      },
    },
  };
}

function playbackTokenTemplate(channel) {
  return {
    operationName: 'PlaybackAccessToken',
    variables: {
      isLive: true,
      login: channel,
      isVod: false,
      vodID: '',
      playerType: 'site',
      platform: 'web',
    },
    extensions: { persistedQuery: { version: 1, sha256Hash: 'fixture-token-hash' } },
  };
}

function explicitLivePoll(sequence, suffix) {
  return `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-TARGETDURATION:2
#EXT-X-MEDIA-SEQUENCE:${sequence}
#EXTINF:2.000,live
https://video-edge-fixture.ttvnw.net/live/${suffix}.ts
`;
}

function assertDecodeSafeGap(body, original, label) {
  assert(body && body !== original, label + ' returned the original ad playlist');
  assert(body.includes('#EXT-X-GAP'), label + ' omitted the standard HLS gap');
  assert(!body.includes('data:video/mp4'), label + ' injected MP4 bytes into the native stream');
  assert(!body.includes('#EXT-X-KEY:METHOD=NONE'), label + ' invented an encryption transition');
  const originalSequence = Number((/#EXT-X-MEDIA-SEQUENCE:(\d+)/i.exec(original) || [])[1]);
  const gapSequence = Number((/#EXT-X-MEDIA-SEQUENCE:(\d+)/i.exec(body) || [])[1]);
  assert(Number.isFinite(gapSequence) && gapSequence === originalSequence,
    label + ' rewrote the native media sequence');

  const lines = body.replace(/\r/g, '').split('\n').map((line) => line.trim());
  const segmentIndexes = lines.map((line, index) => line && line[0] !== '#' ? index : -1)
    .filter((index) => index >= 0);
  assert(segmentIndexes.length > 0, label + ' removed every native segment URI');
  for (const index of segmentIndexes) {
    let start = index - 1;
    while (start >= 0 && !/^#EXTINF:/i.test(lines[start])) start--;
    if (start < 0) start = Math.max(0, index - 3);
    assert(lines.slice(start, index).includes('#EXT-X-GAP'), label + ' left a media URI fetchable');
  }
}

function createRuntime(options) {
  options = options || {};
  const messageListeners = [];
  const nativeSetTimeout = setTimeout;
  const nativeClearTimeout = clearTimeout;
  const state = {
    calls: [],
    messages: [],
    gqlRequests: [],
    timers: [],
    dispatches: [],
    clearedTimers: 0,
    now: options.now == null ? Date.now() : Number(options.now),
  };

  function dispatchMessage(data) {
    state.dispatches.push({ type: data && data.type, id: data && data.id,
      status: data && data.response && data.response.status, error: data && data.error });
    const event = { data: data };
    for (const callback of messageListeners.slice()) callback(event);
  }

  async function nativeFetch(input, init) {
    const url = typeof input === 'string' ? input : String(input && input.url || input || '');
    state.calls.push({ url: url, init: init });
    const value = await (options.fetchRoute
      ? options.fetchRoute(url, init, state)
      : hlsResponse(''));
    if (value instanceof Response) return value;
    if (value && value.error) throw value.error;
    if (value && Object.prototype.hasOwnProperty.call(value, 'json')) {
      return jsonResponse(value.json, value.status);
    }
    return hlsResponse(value == null ? '' : value);
  }

  const workerGlobal = {
    fetch: nativeFetch,
    addEventListener(type, callback) {
      if (type === 'message') messageListeners.push(callback);
    },
    postMessage(message) {
      state.messages.push(message);
      if (!message || message.type !== 'gql-request') return;
      // The worker posts the GQL request body as an already-parsed OBJECT under
      // message.body (see proxyGql/post in twitch-adblock.js); the page stringifies
      // it and adds identity headers. Older fixtures expected message.options.body
      // as a JSON string, which silently produced a null body.
      const parsedBody = message.body || null;
      state.gqlRequests.push({
        body: parsedBody,
        headers: Object.assign({}, message.headers || {}),
        message: message,
      });
      Promise.resolve().then(async () => {
        const value = options.gqlRoute
          ? await options.gqlRoute(message, state)
          : jsonResponse(nestedToken(parsedBody && parsedBody.variables && parsedBody.variables.playerType || 'site'));
        if (value && value.hang) return;
        if (value && value.error) throw value.error;
        const response = value instanceof Response
          ? value
          : jsonResponse(value && Object.prototype.hasOwnProperty.call(value, 'json') ? value.json : value,
            value && value.status);
        const body = await response.text();
        dispatchMessage({
          [FLAG]: RUNTIME_VERSION,
          type: 'gql-response',
          id: message.id,
          response: {
            status: response.status,
            statusText: response.statusText,
            headers: Array.from(response.headers.entries()),
            body: body,
          },
        });
      }).catch((error) => {
        dispatchMessage({
          [FLAG]: RUNTIME_VERSION,
          type: 'gql-response',
          id: message.id,
          error: String(error && error.message || error),
        });
      });
    },
  };

  const RuntimeDate = options.fakeClock ? class RuntimeDate extends Date {
    static now() { return state.now; }
  } : Date;
  const sandbox = {
    self: workerGlobal,
    URL,
    Response,
    Headers,
    Request,
    AbortController,
    Map,
    Set,
    Date: RuntimeDate,
    Math,
    Promise,
    Error,
    console,
    setTimeout(callback, ms) {
      state.timers.push(Number(ms));
      const delay = options.maxTimerDelayMs == null
        ? Number(ms)
        : Math.min(Number(ms), Number(options.maxTimerDelayMs));
      return nativeSetTimeout(callback, delay);
    },
    clearTimeout(timer) {
      state.clearedTimers++;
      return nativeClearTimeout(timer);
    },
  };
  sandbox.__initialState = options.initialState || {};
  vm.createContext(sandbox);
  vm.runInContext('(' + WORKER_RUNTIME_SOURCE + ')("", __initialState, ' +
    JSON.stringify(RUNTIME_VERSION) + ');', sandbox, { filename: 'twitch-adblock.js:worker-runtime' });

  return {
    fetch: workerGlobal.fetch,
    state: state,
    configure(enabled) {
      dispatchMessage({ [FLAG]: RUNTIME_VERSION, type: 'config', enabled: enabled });
    },
    updateClientState(next) {
      dispatchMessage({ [FLAG]: RUNTIME_VERSION, type: 'client-state', state: next });
    },
    announceAdImminent(channel) {
      dispatchMessage({ [FLAG]: RUNTIME_VERSION, type: 'ad-imminent', channel: channel });
    },
    sendMaster(url, text, channel, current) {
      dispatchMessage({
        [FLAG]: RUNTIME_VERSION,
        type: 'master',
        url: url,
        text: text,
        channel: channel,
        current: current === true,
      });
    },
    advance(ms) {
      state.now += Number(ms) || 0;
    },
  };
}

function standardFetchRoute(options) {
  options = options || {};
  const originalMedia = options.originalMedia || CLEAN_MEDIA;
  const backupMedia = options.backupMedia || CLEAN_MEDIA;
  return async (url, init, state) => {
    const parsed = new URL(url);
    if (parsed.hostname === 'gql.twitch.tv') return jsonResponse([]);
    if (parsed.hostname === 'usher.ttvnw.net') {
      const signature = parsed.searchParams.get('sig');
      if (!signature) return hlsResponse(options.originalMaster || ORIGINAL_MASTER);
      return hlsResponse((options.backupMaster || backupMaster)(signature, url, state));
    }
    if (parsed.pathname === new URL(ORIGINAL_MEDIA_URL).pathname) {
      if (typeof originalMedia === 'function') return hlsResponse(await originalMedia(url, init, state));
      return hlsResponse(originalMedia);
    }
    if (parsed.pathname.includes('/backup/')) {
      if (typeof backupMedia === 'function') return hlsResponse(await backupMedia(url, init, state));
      return hlsResponse(backupMedia);
    }
    throw new Error('unexpected fixture request: ' + url);
  };
}

async function mapMaster(runtime) {
  const response = await runtime.fetch(MASTER_URL);
  assert(response.ok, 'original V2 Usher master request failed');
  return response;
}

const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

test('exact ad markers are blocked while twitch-ad-quartile alone is ignored', async () => {
  const fixtures = new Map([
    ['https://video-edge-fixture.ttvnw.net/unmapped/stitched.m3u8', STITCHED_AD],
    ['https://video-edge-fixture.ttvnw.net/unmapped/short-stitched.m3u8', SHORT_STITCHED_AD],
    ['https://video-edge-fixture.ttvnw.net/unmapped/short-stitched-id.m3u8', SHORT_STITCHED_ID_AD],
    ['https://video-edge-fixture.ttvnw.net/unmapped/cue-out.m3u8', CUE_OUT_AD],
    ['https://video-edge-fixture.ttvnw.net/unmapped/maf.m3u8', MAF_AD],
    ['https://video-edge-fixture.ttvnw.net/unmapped/trigger.m3u8', TRIGGER_AD],
    ['https://video-edge-fixture.ttvnw.net/unmapped/quartile.m3u8', QUARTILE_ONLY],
  ]);
  const runtime = createRuntime({
    fetchRoute(url) {
      if (!fixtures.has(url)) throw new Error('unexpected marker fixture request: ' + url);
      return hlsResponse(fixtures.get(url));
    },
  });

  for (const name of ['stitched', 'short-stitched', 'short-stitched-id', 'cue-out', 'maf', 'trigger']) {
    const url = 'https://video-edge-fixture.ttvnw.net/unmapped/' + name + '.m3u8';
    const body = await (await runtime.fetch(url)).text();
    assertDecodeSafeGap(body, fixtures.get(url), name + ' marker');
  }

  const quartileUrl = 'https://video-edge-fixture.ttvnw.net/unmapped/quartile.m3u8';
  const quartileBody = await (await runtime.fetch(quartileUrl)).text();
  assert(quartileBody === QUARTILE_ONLY,
    'twitch-ad-quartile alone was incorrectly classified as an ad marker');
  assert(runtime.state.gqlRequests.length === 0, 'unmapped marker checks unexpectedly requested tokens');
});

test('stale stitched metadata attached to explicitly live media passes through unchanged', async () => {
  const url = 'https://video-edge-fixture.ttvnw.net/unmapped/stale-marker.m3u8';
  const runtime = createRuntime({
    fetchRoute(requestUrl) {
      if (requestUrl !== url) throw new Error('unexpected stale-marker request: ' + requestUrl);
      return hlsResponse(STALE_STITCHED_MARKER);
    },
  });
  const body = await (await runtime.fetch(url)).text();
  assert(body === STALE_STITCHED_MARKER,
    'marker-only CSAI snapshot was falsely destroyed as server-side ad media');
  assert(runtime.state.gqlRequests.length === 0, 'unmapped stale marker started backup traffic');
});

test('authoritative X-TV preroll metadata overrides an explicitly live EXTINF title', async () => {
  const url = 'https://video-edge-fixture.ttvnw.net/unmapped/authoritative-preroll.m3u8';
  const runtime = createRuntime({
    fetchRoute(requestUrl) {
      if (requestUrl !== url) throw new Error('unexpected authoritative-preroll request: ' + requestUrl);
      return hlsResponse(AUTHORITATIVE_PREROLL_LIVE_TITLE);
    },
  });
  const body = await (await runtime.fetch(url)).text();
  assertDecodeSafeGap(body, AUTHORITATIVE_PREROLL_LIVE_TITLE,
    'authoritative X-TV preroll metadata with a live EXTINF title');
  assert(runtime.state.gqlRequests.length === 0,
    'unmapped authoritative preroll unexpectedly requested alternate tokens');
});

test('known ad URI is blocked even when no Twitch marker is present', async () => {
  const url = 'https://video-edge-fixture.ttvnw.net/unmapped/known-uri.m3u8';
  const runtime = createRuntime({
    fetchRoute(requestUrl) {
      if (requestUrl !== url) throw new Error('unexpected known-ad-URI request: ' + requestUrl);
      return hlsResponse(KNOWN_AD_URI_NO_MARKER);
    },
  });
  const body = await (await runtime.fetch(url)).text();
  assertDecodeSafeGap(body, KNOWN_AD_URI_NO_MARKER, 'known ad URI without marker');
});

test('stitched-ad media URI is blocked even when EXTINF explicitly says live', async () => {
  const url = 'https://video-edge-fixture.ttvnw.net/unmapped/stitched-ad-uri.m3u8';
  const runtime = createRuntime({
    fetchRoute(requestUrl) {
      if (requestUrl !== url) throw new Error('unexpected stitched-ad-URI request: ' + requestUrl);
      return hlsResponse(STITCHED_AD_URI_WITH_LIVE_TITLE);
    },
  });
  const body = await (await runtime.fetch(url)).text();
  assertDecodeSafeGap(body, STITCHED_AD_URI_WITH_LIVE_TITLE, 'stitched-ad URI with live title');
});

test('slid-out markers cannot leak generic tails and release needs three explicit live polls', async () => {
  const livePolls = [
    explicitLivePoll(902, 'explicit-live-902'),
    explicitLivePoll(903, 'explicit-live-903'),
    explicitLivePoll(904, 'explicit-live-904'),
  ];
  const nativePolls = [
    SLID_MARKER_CONFIRMED_AD,
    SLID_MARKER_GENERIC_TAIL,
    livePolls[0],
    livePolls[1],
    livePolls[2],
    markedAd('#EXT-X-DATERANGE:ID="stitched-ad-after-learning",CLASS="twitch-stitched-ad",DURATION=2.0',
      'after-learning'),
  ];
  let nativePollIndex = 0;
  let failCachedBackup = false;
  let rejectNewTokens = false;
  const runtime = createRuntime({
    fetchRoute: standardFetchRoute({
      originalMedia() {
        assert(nativePollIndex < nativePolls.length, 'stateful native fixture was polled too many times');
        return nativePolls[nativePollIndex++];
      },
      backupMedia() {
        if (failCachedBackup) throw new Error('fixture cached backup expired');
        return CLEAN_MEDIA;
      },
    }),
    gqlRoute(message) {
      if (rejectNewTokens) return jsonResponse({ errors: [{ message: 'fixture reject' }] }, 403);
      return jsonResponse(nestedToken(message.body.variables.playerType));
    },
  });
  await mapMaster(runtime);

  const adBody = await (await runtime.fetch(ORIGINAL_MEDIA_URL)).text();
  assert(adBody === CLEAN_MEDIA, 'confirmed stitched/CUE poll did not activate the clean backup');

  const genericBody = await (await runtime.fetch(ORIGINAL_MEDIA_URL)).text();
  assert(genericBody !== SLID_MARKER_GENERIC_TAIL && !genericBody.includes('generic-tail-901.ts'),
    'marker slide-out leaked the generic empty-title tail segment');

  const firstExplicit = await (await runtime.fetch(ORIGINAL_MEDIA_URL)).text();
  assert(firstExplicit !== livePolls[0] && !firstExplicit.includes('explicit-live-902.ts'),
    'one explicit live poll released or learned native media too early');
  const secondExplicit = await (await runtime.fetch(ORIGINAL_MEDIA_URL)).text();
  assert(secondExplicit !== livePolls[1] && !secondExplicit.includes('explicit-live-903.ts'),
    'two explicit live polls released or learned native media too early');
  const thirdExplicit = await (await runtime.fetch(ORIGINAL_MEDIA_URL)).text();
  assert(thirdExplicit === livePolls[2],
    'native media was not released on the third consecutive explicit live poll');

  failCachedBackup = true;
  rejectNewTokens = true;
  const learnedBridge = await (await runtime.fetch(ORIGINAL_MEDIA_URL)).text();
  assert(learnedBridge === livePolls[2],
    'third explicit live poll was not learned as the safe native bridge snapshot');
  assert(!learnedBridge.includes('after-learning'),
    'post-learning ad media leaked when the cached backup failed');
});

test('cached clean-backup polling tolerates an 800ms media leg without refreshing its token', async () => {
  let slowCachedPoll = false;
  let rejectNewTokens = false;
  const runtime = createRuntime({
    initialState: { tokenTemplate: playbackTokenTemplate(CHANNEL) },
    fetchRoute: standardFetchRoute({
      originalMedia: STITCHED_AD,
      backupMedia(url, init) {
        if (!slowCachedPoll) return CLEAN_MEDIA;
        return new Promise((resolve, reject) => {
          let settled = false;
          const timer = setTimeout(() => {
            if (settled) return;
            settled = true;
            resolve(CLEAN_MEDIA);
          }, 800);
          const signal = init && init.signal;
          const abort = () => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            const error = new Error('fixture cached backup poll timed out');
            error.name = 'AbortError';
            reject(error);
          };
          if (signal) {
            if (signal.aborted) abort();
            else signal.addEventListener('abort', abort, { once: true });
          }
        });
      },
    }),
    gqlRoute(message) {
      if (rejectNewTokens) return jsonResponse({ errors: [{ message: 'fixture token refresh disabled' }] }, 403);
      return jsonResponse(nestedToken(message.body.variables.playerType));
    },
  });
  await mapMaster(runtime);
  const primed = await (await runtime.fetch(ORIGINAL_MEDIA_URL)).text();
  assert(primed === CLEAN_MEDIA, 'fixture did not prime a reusable clean backup');
  for (let turn = 0; turn < 4; turn++) await new Promise((resolve) => setImmediate(resolve));

  slowCachedPoll = true;
  rejectNewTokens = true;
  const gqlBeforeCachedPoll = runtime.state.gqlRequests.length;
  const started = performance.now();
  const body = await (await runtime.fetch(ORIGINAL_MEDIA_URL)).text();
  const elapsed = performance.now() - started;

  assert(body === CLEAN_MEDIA,
    '800ms cached clean-media leg exceeded the backup poll timeout and fell back to ad replacement');
  assert(elapsed >= 700,
    'slow cached-media fixture returned before exercising its 800ms response leg: ' + elapsed.toFixed(1) + 'ms');
  assert(runtime.state.gqlRequests.length === gqlBeforeCachedPoll,
    'slow cached-media poll discarded its valid token and attempted a forbidden refresh');
});

test('SCTE35-OUT DATERANGE gaps only media overlapping its timed range', async () => {
  const url = 'https://video-edge-fixture.ttvnw.net/unmapped/scte35-timed.m3u8';
  const runtime = createRuntime({
    fetchRoute(requestUrl) {
      if (requestUrl !== url) throw new Error('unexpected SCTE35 fixture request: ' + requestUrl);
      return hlsResponse(SCTE35_TIMED_PLAYLIST);
    },
  });
  const body = await (await runtime.fetch(url)).text();
  const lines = body.replace(/\r/g, '').split('\n');
  const gapIndexes = [];
  for (let index = 0; index < lines.length; index++) {
    if (lines[index] === '#EXT-X-GAP') gapIndexes.push(index);
  }
  assert(gapIndexes.length === 1, 'timed SCTE35 range must gap exactly one overlapping segment');
  assert(lines[gapIndexes[0] + 1] ===
    'https://video-weaver-fixture.ttvnw.net/live/scte-overlap-821.ts',
  'SCTE35 gap was not attached to the overlapping media segment');
  for (const cleanUri of [
    'https://video-edge-fixture.ttvnw.net/live/scte-before-820.ts',
    'https://video-edge-fixture.ttvnw.net/live/scte-after-822.ts',
  ]) {
    const index = lines.indexOf(cleanUri);
    assert(index >= 0, 'timed SCTE35 stripping removed clean media: ' + cleanUri);
    assert(lines[index - 1] !== '#EXT-X-GAP', 'timed SCTE35 range gapped non-overlapping media: ' + cleanUri);
  }
});

test('mixed CUE playlists gap only segments inside CUE-OUT/CUE-IN', async () => {
  const url = 'https://video-edge-fixture.ttvnw.net/unmapped/mixed-cue.m3u8';
  const runtime = createRuntime({
    fetchRoute(requestUrl) {
      if (requestUrl !== url) throw new Error('unexpected mixed-CUE request: ' + requestUrl);
      return hlsResponse(MIXED_CUE_PLAYLIST);
    },
  });
  const body = await (await runtime.fetch(url)).text();
  const lines = body.replace(/\r/g, '').split('\n');
  const gapIndexes = [];
  for (let index = 0; index < lines.length; index++) {
    if (lines[index] === '#EXT-X-GAP') gapIndexes.push(index);
  }
  assert(gapIndexes.length === 1, 'mixed CUE playlist must gap exactly one in-cue segment');
  assert(lines[gapIndexes[0] + 1] === 'relative-ad-inside-cue.ts',
    'mixed CUE gap was not scoped to the in-cue ad segment');
  assert(lines.includes('relative-live-before.ts') && lines.includes('relative-live-after.ts'),
    'mixed CUE stripping removed clean segments');
  assert(lines[lines.indexOf('relative-live-before.ts') - 1] !== '#EXT-X-GAP',
    'clean segment before CUE-OUT was gapped');
  assert(lines[lines.indexOf('relative-live-after.ts') - 1] !== '#EXT-X-GAP',
    'clean segment after CUE-IN was gapped');
  assert(!lines.some((line) => /^#EXT-X-CUE-(?:OUT|IN)/i.test(line)),
    'mixed CUE stripping left ad-control markers in the returned playlist');
});

test('worker captures persisted GQL identity, preserves a batch, and keeps Usher V2', async () => {
  const runtime = createRuntime({
    fetchRoute: standardFetchRoute({ originalMedia: STITCHED_AD, backupMedia: CLEAN_MEDIA }),
    gqlRoute(message) {
      const body = message.body;
      return jsonResponse(nestedToken(body.variables.playerType));
    },
  });
  const unrelated = {
    operationName: 'ChannelShell',
    variables: { login: CHANNEL },
    extensions: { persistedQuery: { version: 1, sha256Hash: 'unrelated-hash' } },
  };
  const token = {
    operationName: 'PlaybackAccessToken',
    variables: {
      isLive: true,
      login: CHANNEL,
      isVod: false,
      vodID: '',
      playerType: 'picture-by-picture',
      platform: 'android',
      retained: 'fixture-retained',
    },
    extensions: { persistedQuery: { version: 1, sha256Hash: 'fixture-persisted-hash' } },
  };
  const directBody = JSON.stringify([unrelated, token]);
  await runtime.fetch(GQL_URL, {
    method: 'POST',
    headers: {
      'Client-ID': 'fixture-client-id',
      'X-Device-Id': 'fixture-device-id',
      'Client-Version': 'fixture-client-version',
      'Client-Session-Id': 'fixture-session-id',
      'Client-Integrity': 'fixture-integrity',
      Authorization: 'OAuth fixture-authorization',
    },
    body: directBody,
  });
  const directCall = runtime.state.calls[0];
  assert(typeof directCall.init.body === 'string' && directCall.init.body.length > 2,
    'worker GQL capture produced an empty request body');
  assert(directCall.init.body === directBody, 'worker changed the native token request bytes');
  const forwardedBatch = JSON.parse(directCall.init.body);
  equal(forwardedBatch[0], unrelated, 'worker changed an unrelated batched GQL query');
  assert(forwardedBatch[1].variables.playerType === 'picture-by-picture',
    'worker changed the native token playerType');
  assert(forwardedBatch[1].variables.platform === 'android',
    'worker changed the native token platform');
  assert(forwardedBatch[1].variables.retained === 'fixture-retained', 'worker discarded token variables');

  await mapMaster(runtime);
  const replaced = await (await runtime.fetch(ORIGINAL_MEDIA_URL)).text();
  assert(replaced === CLEAN_MEDIA, 'captured-token backup did not replace the ad playlist');
  assert(runtime.state.gqlRequests.length === 4, 'primary backup phase did not issue four bounded token requests');
  for (const request of runtime.state.gqlRequests) {
    // Identity headers (Client-ID / Authorization / ...) are attached by the PAGE
    // when it proxies the worker's gql-request; the worker posts only { id, body }
    // (identity deliberately stays on the page), so they are not present here.
    // What the worker MUST preserve is the captured token template it will reuse
    // for backup requests: the persisted-query hash and template-specific vars.
    assert(request.body.extensions.persistedQuery.sha256Hash === 'fixture-persisted-hash',
      'backup GQL lost the captured persisted-query hash');
    assert(request.body.variables.retained === 'fixture-retained',
      'backup GQL did not retain captured token-template variables');
  }

  const usherCalls = runtime.state.calls.filter((call) => {
    const url = new URL(call.url);
    return url.hostname === 'usher.ttvnw.net';
  });
  assert(usherCalls.length >= 2, 'backup flow did not request a replacement Usher master');
  for (const call of usherCalls) {
    const url = new URL(call.url);
    assert(url.pathname === '/api/v2/channel/hls/' + CHANNEL + '.m3u8',
      'Usher request downgraded or changed its V2 path: ' + url.pathname);
    assert(url.searchParams.get('allow_source') === 'true', 'Usher request lost allow_source');
    assert(url.searchParams.get('allow_audio_only') === 'true', 'Usher request lost allow_audio_only');
    assert(url.searchParams.get('p') === 'fixture', 'Usher request lost unrelated query state');
    if (url.searchParams.has('sig')) {
      if (url.searchParams.get('sig') === 'sig-embed') {
        assert(url.searchParams.get('parent_domains') === 'twitchplayer',
          'embed backup omitted its required parent_domains context');
      } else {
        assert(!url.searchParams.has('parent_domains'), 'non-embed backup leaked parent_domains');
      }
    } else {
      assert(url.searchParams.get('parent_domains') === 'twitch.tv',
        'native Usher request did not preserve its authorization context');
    }
  }
});

test('nested standard tokens and top-level sig/token aliases are accepted', async () => {
  const cases = [
    {
      label: 'nested signature/value',
      response: { data: { streamPlaybackAccessToken: { signature: 'nested-signature', value: 'nested-value' } } },
      signature: 'nested-signature',
      value: 'nested-value',
    },
    {
      label: 'top-level sig/token',
      response: { sig: 'top-sig', token: 'top-token' },
      signature: 'top-sig',
      value: 'top-token',
    },
  ];

  for (const fixture of cases) {
    const runtime = createRuntime({
      fetchRoute: standardFetchRoute({ originalMedia: STITCHED_AD, backupMedia: CLEAN_MEDIA }),
      gqlRoute() { return jsonResponse(fixture.response); },
    });
    await mapMaster(runtime);
    const body = await (await runtime.fetch(ORIGINAL_MEDIA_URL)).text();
    assert(body === CLEAN_MEDIA, fixture.label + ' token was not accepted');
    const backupUsher = runtime.state.calls.map((call) => new URL(call.url)).find((url) =>
      url.hostname === 'usher.ttvnw.net' && url.searchParams.has('sig'));
    assert(backupUsher, fixture.label + ' did not reach backup Usher');
    assert(backupUsher.searchParams.get('sig') === fixture.signature,
      fixture.label + ' signature alias was not applied');
    assert(backupUsher.searchParams.get('token') === fixture.value,
      fixture.label + ' token/value alias was not applied');
  }
});

test('backup types are exactly site/popout/mobile_web/embed, never autoplay/frontpage', async () => {
  const runtime = createRuntime({
    fetchRoute: standardFetchRoute({ originalMedia: STITCHED_AD, backupMedia: CLEAN_MEDIA }),
    gqlRoute() {
      return jsonResponse({ errors: [{ message: 'fixture reject' }] }, 403);
    },
  });
  await mapMaster(runtime);
  const body = await (await runtime.fetch(ORIGINAL_MEDIA_URL)).text();
  const types = runtime.state.gqlRequests.map((request) => request.body.variables.playerType);
  assertDecodeSafeGap(body, STITCHED_AD, 'exhausted source-capable types');
  equal(types, ['site', 'popout', 'mobile_web', 'embed'], 'backup player-type set changed');
  assert(!types.some((type) => /autoplay|frontpage|carousel/i.test(type)),
    'unsafe low-quality/player-shell fallback entered the committed backup cycle');
  for (const request of runtime.state.gqlRequests) {
    assert(request.body.variables.platform === 'web',
      request.body.variables.playerType + ' backup used an unexpected platform: ' + request.body.variables.platform);
  }
});

test('backup selection never crosses the original H.264 codec family', async () => {
  const runtime = createRuntime({
    fetchRoute: standardFetchRoute({
      originalMedia: STITCHED_AD,
      backupMedia(url) {
        if (/av1-1080|h264-720/.test(url)) {
          throw new Error('codec/quality picker fetched an unsafe variant: ' + url);
        }
        assert(/h264-1080/.test(url), 'unexpected backup variant: ' + url);
        return CLEAN_MEDIA;
      },
    }),
    gqlRoute(message) {
      const body = message.body;
      return jsonResponse(nestedToken(body.variables.playerType));
    },
  });
  await mapMaster(runtime);
  const body = await (await runtime.fetch(ORIGINAL_MEDIA_URL)).text();
  assert(body === CLEAN_MEDIA, 'codec-safe H.264 backup was not returned');
  const mediaCalls = runtime.state.calls.filter((call) => /\/backup\//.test(call.url) && call.url.includes('.m3u8'));
  assert(mediaCalls.length > 0, 'no backup media variants were fetched');
  assert(mediaCalls.every((call) => /h264-1080\.m3u8/.test(call.url)),
    'backup selection changed codec or resolution');
});

test('backup selection requires the exact codec profile and audio codec', async () => {
  const wrongProfileMaster = () => `#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=8500000,CODECS="avc1.4D401F,mp4a.40.2",RESOLUTION=1920x1080,VIDEO="chunked",FRAME-RATE=60.000
https://video-edge-fixture.ttvnw.net/backup/wrong-profile/index.m3u8
`;
  const runtime = createRuntime({
    fetchRoute: standardFetchRoute({
      originalMedia: STITCHED_AD,
      backupMaster: wrongProfileMaster,
      backupMedia() { throw new Error('same-family wrong-profile media must never be fetched'); },
    }),
    gqlRoute(message) {
      return jsonResponse(nestedToken(message.body.variables.playerType));
    },
  });
  await mapMaster(runtime);
  const body = await (await runtime.fetch(ORIGINAL_MEDIA_URL)).text();
  assertDecodeSafeGap(body, STITCHED_AD, 'wrong-profile backup rejection');
  assert(!runtime.state.calls.some((call) => /wrong-profile/.test(call.url)),
    'H.264 profile change reached the media decoder path');
});

test('backup selection never crosses MPEG-TS and fragmented-MP4 containers', async () => {
  const runtime = createRuntime({
    fetchRoute: standardFetchRoute({ originalMedia: STITCHED_AD, backupMedia: CLEAN_FMP4_MEDIA }),
    gqlRoute(message) {
      return jsonResponse(nestedToken(message.body.variables.playerType));
    },
  });
  await mapMaster(runtime);
  const body = await (await runtime.fetch(ORIGINAL_MEDIA_URL)).text();
  assertDecodeSafeGap(body, STITCHED_AD, 'cross-container backup rejection');
  assert(!body.includes('#EXT-X-MAP') && !body.includes('.m4s'),
    'fragmented-MP4 backup was spliced into the MPEG-TS media URL');
});

test('part-only ad deltas fail open instead of returning an empty or synthetic playlist', async () => {
  const url = 'https://video-edge-fixture.ttvnw.net/unmapped/part-only.m3u8?_HLS_msn=812&_HLS_part=1';
  const runtime = createRuntime({
    fetchRoute(requestUrl) {
      if (requestUrl !== url) throw new Error('unexpected part-only request: ' + requestUrl);
      return hlsResponse(PART_ONLY_AD);
    },
  });
  const body = await (await runtime.fetch(url)).text();
  assert(body === PART_ONLY_AD, 'part-only delta was rewritten into a malformed ordinary playlist');
  assert(!body.includes('data:video/mp4'), 'part-only delta received synthetic decoder bytes');
});

test('part-only ad deltas retry one cursor-free manifest before clean-backup or gap handling', async () => {
  const scenarios = [
    { label: 'mapped clean backup', url: ORIGINAL_MEDIA_URL, mapped: true },
    {
      label: 'unmapped decode-safe gap',
      url: 'https://video-edge-fixture.ttvnw.net/unmapped/part-retry.m3u8?token=fixture',
      mapped: false,
    },
  ];
  for (const scenario of scenarios) {
    const blockingUrl = scenario.url + '&_HLS_msn=812&_HLS_part=1&_HLS_skip=YES';
    const mediaPath = new URL(scenario.url).pathname;
    const standardRoute = standardFetchRoute({ originalMedia: STITCHED_AD, backupMedia: CLEAN_MEDIA });
    const runtime = createRuntime({
      fetchRoute(url, init, state) {
        const parsed = new URL(url);
        if (parsed.pathname === mediaPath) {
          return hlsResponse(parsed.searchParams.has('_HLS_msn') ? PART_ONLY_AD : STITCHED_AD);
        }
        return standardRoute(url, init, state);
      },
      gqlRoute(message) {
        return jsonResponse(nestedToken(message.body.variables.playerType));
      },
    });
    if (scenario.mapped) await mapMaster(runtime);

    const body = await (await runtime.fetch(blockingUrl)).text();
    if (scenario.mapped) {
      assert(body === CLEAN_MEDIA,
        scenario.label + ' did not continue into the existing clean-backup path');
    } else {
      assertDecodeSafeGap(body, STITCHED_AD,
        scenario.label + ' did not continue into the existing complete-manifest gap path');
    }

    const nativeCalls = runtime.state.calls.filter((call) => new URL(call.url).pathname === mediaPath);
    assert(nativeCalls.length === 2,
      scenario.label + ' did not issue exactly one bounded ordinary-manifest retry: ' + nativeCalls.length);
    const retry = new URL(nativeCalls[1].url);
    assert(retry.searchParams.get('token') === new URL(scenario.url).searchParams.get('token'),
      scenario.label + ' dropped signed native query state during the retry');
    assert(!retry.searchParams.has('_HLS_msn') && !retry.searchParams.has('_HLS_part') &&
      !retry.searchParams.has('_HLS_skip'),
    scenario.label + ' retained a blocking LL-HLS cursor on the ordinary retry');
  }
});

test('failed and still-part-only ordinary retries use one bounded clean backup without recursion', async () => {
  const cases = [
    {
      label: 'network failure',
      retry() { throw new Error('fixture ordinary retry failed'); },
    },
    {
      label: 'AbortError rejection',
      retry() {
        const error = new Error('fixture ordinary retry aborted');
        error.name = 'AbortError';
        throw error;
      },
    },
    {
      label: 'second part-only response',
      retry() { return hlsResponse(PART_ONLY_AD); },
    },
  ];
  for (const fixture of cases) {
    const blockingUrl = ORIGINAL_MEDIA_URL + '&_HLS_msn=812&_HLS_part=1&_HLS_skip=YES';
    const mediaPath = new URL(ORIGINAL_MEDIA_URL).pathname;
    const standardRoute = standardFetchRoute({ originalMedia: STITCHED_AD, backupMedia: CLEAN_MEDIA });
    const runtime = createRuntime({
      fetchRoute(url, init, state) {
        const parsed = new URL(url);
        if (parsed.pathname === mediaPath) {
          if (parsed.searchParams.has('_HLS_msn')) return hlsResponse(PART_ONLY_AD);
          return fixture.retry(url, init, state);
        }
        return standardRoute(url, init, state);
      },
      gqlRoute(message) {
        return jsonResponse(nestedToken(message.body.variables.playerType));
      },
    });
    await mapMaster(runtime);
    const body = await (await runtime.fetch(blockingUrl)).text();
    assert(body === CLEAN_MEDIA, fixture.label + ' returned confirmed ad parts instead of the clean backup');
    const nativeCalls = runtime.state.calls.filter((call) => new URL(call.url).pathname === mediaPath);
    assert(nativeCalls.length === 2,
      fixture.label + ' retried the part-only response more than once: ' + nativeCalls.length);
    assert(runtime.state.gqlRequests.length > 0 && runtime.state.gqlRequests.length <= 4,
      fixture.label + ' did not keep clean-backup work within four identities');
    assert(runtime.state.messages.some((message) => message && message.type === 'ad-state' &&
      message.state === 'blocked-clean'),
    fixture.label + ' did not report its clean replacement');
  }
});

test('failed part-only retry uses the fresh clean native bridge instead of returning ad parts', async () => {
  const blockingUrl = ORIGINAL_MEDIA_URL + '&_HLS_msn=812&_HLS_part=1&_HLS_skip=YES';
  const mediaPath = new URL(ORIGINAL_MEDIA_URL).pathname;
  let primed = false;
  const standardRoute = standardFetchRoute({ originalMedia: CLEAN_MEDIA, backupMedia: CLEAN_MEDIA });
  const runtime = createRuntime({
    fetchRoute(url, init, state) {
      const parsed = new URL(url);
      if (parsed.pathname !== mediaPath) return standardRoute(url, init, state);
      if (!primed) {
        primed = true;
        return hlsResponse(CLEAN_MEDIA);
      }
      if (parsed.searchParams.has('_HLS_msn')) return hlsResponse(PART_ONLY_AD);
      throw new Error('fixture ordinary retry failed after a clean native poll');
    },
  });
  await mapMaster(runtime);
  const cleanBody = await (await runtime.fetch(ORIGINAL_MEDIA_URL)).text();
  assert(cleanBody === CLEAN_MEDIA, 'fixture did not prime a clean native bridge');

  const body = await (await runtime.fetch(blockingUrl)).text();
  assert(body !== PART_ONLY_AD, 'confirmed ad parts escaped even though a clean bridge was available');
  assert(body.includes('/live/99100.ts') && !body.includes('/stitched-ad/'),
    'failed part-only retry did not return the fresh clean native bridge');
});

test('part-only ordinary retry times out once at 650ms then uses a clean backup', async () => {
  const blockingUrl = ORIGINAL_MEDIA_URL + '&_HLS_msn=812&_HLS_part=1&_HLS_skip=YES';
  const mediaPath = new URL(ORIGINAL_MEDIA_URL).pathname;
  let retrySignalSeen = false;
  const standardRoute = standardFetchRoute({ originalMedia: STITCHED_AD, backupMedia: CLEAN_MEDIA });
  const runtime = createRuntime({
    maxTimerDelayMs: 10,
    fetchRoute(url, init, state) {
      const parsed = new URL(url);
      if (parsed.pathname === mediaPath) {
        if (parsed.searchParams.has('_HLS_msn')) return hlsResponse(PART_ONLY_AD);
        const signal = init && init.signal;
        retrySignalSeen = !!signal;
        return new Promise((resolve, reject) => {
          if (!signal) return reject(new Error('ordinary retry omitted its timeout signal'));
          const rejectAbort = () => {
            const error = new Error('fixture retry timeout');
            error.name = 'AbortError';
            reject(error);
          };
          if (signal.aborted) rejectAbort();
          else signal.addEventListener('abort', rejectAbort, { once: true });
        });
      }
      return standardRoute(url, init, state);
    },
  });
  await mapMaster(runtime);
  const body = await (await runtime.fetch(blockingUrl)).text();
  assert(body === CLEAN_MEDIA, 'timed-out ordinary retry returned confirmed ad parts');
  assert(retrySignalSeen, 'ordinary retry did not carry a bounded abort signal');
  assert(runtime.state.timers.filter((delay) => delay === 650).length === 1,
    'ordinary retry did not use exactly one 650ms timeout');
  const nativeCalls = runtime.state.calls.filter((call) => new URL(call.url).pathname === mediaPath);
  assert(nativeCalls.length === 2, 'timed-out part-only response retried recursively: ' + nativeCalls.length);
});

test('caller abort ends the one part-only retry promptly and still returns the original response', async () => {
  const blockingUrl = ORIGINAL_MEDIA_URL + '&_HLS_msn=812&_HLS_part=1&_HLS_skip=YES';
  const mediaPath = new URL(ORIGINAL_MEDIA_URL).pathname;
  const caller = new AbortController();
  let retryStarted;
  const started = new Promise((resolve) => { retryStarted = resolve; });
  const standardRoute = standardFetchRoute({ originalMedia: STITCHED_AD, backupMedia: CLEAN_MEDIA });
  const runtime = createRuntime({
    fetchRoute(url, init, state) {
      const parsed = new URL(url);
      if (parsed.pathname === mediaPath) {
        if (parsed.searchParams.has('_HLS_msn')) return hlsResponse(PART_ONLY_AD);
        const signal = init && init.signal;
        retryStarted();
        return new Promise((resolve, reject) => {
          if (!signal) return reject(new Error('ordinary retry omitted its linked abort signal'));
          const rejectAbort = () => {
            const error = new Error('fixture caller abort');
            error.name = 'AbortError';
            reject(error);
          };
          if (signal.aborted) rejectAbort();
          else signal.addEventListener('abort', rejectAbort, { once: true });
        });
      }
      return standardRoute(url, init, state);
    },
  });
  await mapMaster(runtime);
  const pending = runtime.fetch(blockingUrl, { signal: caller.signal });
  await Promise.race([
    started,
    new Promise((resolve, reject) => setTimeout(() => reject(new Error('ordinary retry never started')), 100)),
  ]);
  const abortedAt = performance.now();
  caller.abort();
  const response = await Promise.race([
    pending,
    new Promise((resolve, reject) => setTimeout(() => reject(new Error('caller abort did not settle promptly')), 150)),
  ]);
  const body = await response.text();
  assert(performance.now() - abortedAt < 150, 'caller abort waited for the 650ms retry timeout');
  assert(body === PART_ONLY_AD, 'caller-aborted retry did not return the original response');
  const nativeCalls = runtime.state.calls.filter((call) => new URL(call.url).pathname === mediaPath);
  assert(nativeCalls.length === 2, 'caller-aborted part-only response retried recursively: ' + nativeCalls.length);
});

test('prefetch-only Twitch ad snapshots still activate a clean mapped backup', async () => {
  const runtime = createRuntime({
    fetchRoute: standardFetchRoute({ originalMedia: PREFETCH_ONLY_AD, backupMedia: CLEAN_MEDIA }),
    gqlRoute(message) {
      return jsonResponse(nestedToken(message.body.variables.playerType));
    },
  });
  await mapMaster(runtime);
  const body = await (await runtime.fetch(ORIGINAL_MEDIA_URL)).text();
  assert(body === CLEAN_MEDIA,
    'prefetch-only ad snapshot bypassed the clean-stream replacement path');
});

test('relative backup variant URIs are absolutized against the V2 Usher master', async () => {
  const relativeVariant = 'relative-media/h264-1080.m3u8';
  const expected = 'https://usher.ttvnw.net/api/v2/channel/hls/relative-media/h264-1080.m3u8';
  const relativeMedia = `#EXTM3U
#EXT-X-VERSION:7
#EXT-X-TARGETDURATION:2
#EXT-X-MAP:URI="../init/init.mp4"
#EXT-X-KEY:METHOD=AES-128,URI="keys/key.bin"
#EXT-X-PART:DURATION=0.500,URI="parts/part-1.m4s"
#EXT-X-PRELOAD-HINT:TYPE=PART,URI="parts/part-2.m4s"
#EXTINF:2.000,live
segments/live-1.ts
#EXT-X-TWITCH-PREFETCH:prefetch/live-2.ts
`;
  const runtime = createRuntime({
    fetchRoute(url) {
      const parsed = new URL(url);
      if (parsed.hostname === 'usher.ttvnw.net' &&
          parsed.pathname === '/api/v2/channel/hls/' + CHANNEL + '.m3u8') {
        if (!parsed.searchParams.has('sig')) return hlsResponse(ORIGINAL_MASTER);
        return hlsResponse(`#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=8500000,CODECS="avc1.64002A,mp4a.40.2",RESOLUTION=1920x1080,VIDEO="chunked",FRAME-RATE=60.000
${relativeVariant}
`);
      }
      if (url === expected) return hlsResponse(relativeMedia);
      if (parsed.pathname === new URL(ORIGINAL_MEDIA_URL).pathname) return hlsResponse(FMP4_STITCHED_AD);
      throw new Error('relative variant was not absolutized correctly: ' + url);
    },
    gqlRoute(message) {
      const body = message.body;
      return jsonResponse(nestedToken(body.variables.playerType));
    },
  });
  await mapMaster(runtime);
  const body = await (await runtime.fetch(ORIGINAL_MEDIA_URL)).text();
  assert(runtime.state.calls.some((call) => call.url === expected),
    'worker never fetched the absolutized relative backup URI');
  for (const absolute of [
    'https://usher.ttvnw.net/api/v2/channel/hls/init/init.mp4',
    'https://usher.ttvnw.net/api/v2/channel/hls/relative-media/keys/key.bin',
    'https://usher.ttvnw.net/api/v2/channel/hls/relative-media/segments/live-1.ts',
  ]) {
    assert(body.includes(absolute), 'returned backup left a relative media URI unresolved: ' + absolute);
  }
  for (const rawLine of body.replace(/\r/g, '').split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line[0] !== '#') {
      assert(/^https?:\/\//i.test(line), 'returned backup retained relative media line: ' + line);
    }
    for (const match of line.matchAll(/\bURI="([^"]+)"/gi)) {
      assert(/^https?:\/\//i.test(match[1]), 'returned backup retained relative URI attribute: ' + match[1]);
    }
    const prefetch = /^#EXT-X-TWITCH-PREFETCH:(.+)$/i.exec(line);
    if (prefetch) {
      assert(/^https?:\/\//i.test(prefetch[1].trim()),
        'returned backup retained relative Twitch prefetch URI: ' + prefetch[1].trim());
    }
  }
});

test('strong-metadata all-ad backups return a decode-safe gap within 250ms', async () => {
  const runtime = createRuntime({
    fetchRoute: standardFetchRoute({
      originalMedia: STRONG_METADATA_ALL_AD,
      backupMedia: STRONG_METADATA_ALL_AD,
    }),
    gqlRoute(message) {
      const body = message.body;
      return jsonResponse(nestedToken(body.variables.playerType));
    },
  });
  await mapMaster(runtime);
  const started = performance.now();
  const body = await (await runtime.fetch(ORIGINAL_MEDIA_URL)).text();
  const elapsed = performance.now() - started;
  assert(elapsed <= 250, 'all-ad fallback exceeded 250ms: ' + elapsed.toFixed(1) + 'ms');
  assertDecodeSafeGap(body, STRONG_METADATA_ALL_AD, 'strong-metadata all-ad fallback');
  const types = runtime.state.gqlRequests.map((request) => request.body.variables.playerType);
  equal(types, ['site', 'popout', 'mobile_web', 'embed'],
    'all-ad fallback did not stop after the four source-capable web types');
});

test('50 clean media requests take a zero-backup fast path', async () => {
  const runtime = createRuntime({
    fetchRoute: standardFetchRoute({ originalMedia: CLEAN_MEDIA, backupMedia: CLEAN_MEDIA }),
  });
  await mapMaster(runtime);
  const before = runtime.state.calls.length;
  for (let index = 0; index < 50; index++) {
    const body = await (await runtime.fetch(ORIGINAL_MEDIA_URL)).text();
    assert(body === CLEAN_MEDIA, 'clean playlist body changed at request ' + index);
  }
  assert(runtime.state.calls.length === before + 50, 'clean path made hidden network requests');
  assert(runtime.state.gqlRequests.length === 0, 'clean path requested a backup access token');
  assert(runtime.state.timers.length === 0, 'clean path scheduled backup or timeout work');
  assert(!runtime.state.calls.some((call) => /\/backup\//.test(call.url)), 'clean path fetched a backup variant');
});

test('captured token identity prewarms a diversified popout/mobile_web race before the first ad', async () => {
  const runtime = createRuntime({
    fakeClock: true,
    now: 100000,
    fetchRoute: standardFetchRoute({ originalMedia: CLEAN_MEDIA, backupMedia: CLEAN_MEDIA }),
    gqlRoute(message) {
      return jsonResponse(nestedToken(message.body.variables.playerType));
    },
  });
  const tokenBody = JSON.stringify({
    operationName: 'PlaybackAccessToken',
    variables: {
      isLive: true,
      login: CHANNEL,
      isVod: false,
      vodID: '',
      playerType: 'site',
      platform: 'web',
    },
    extensions: { persistedQuery: { version: 1, sha256Hash: 'prewarm-token-hash' } },
  });
  await runtime.fetch(GQL_URL, { method: 'POST', body: tokenBody });
  await mapMaster(runtime);

  const body = await (await runtime.fetch(ORIGINAL_MEDIA_URL)).text();
  assert(body === CLEAN_MEDIA, 'prewarm changed the native clean playlist');
  for (let turn = 0; turn < 6; turn++) await new Promise((resolve) => setImmediate(resolve));
  equal(runtime.state.gqlRequests.map((request) => request.body.variables.playerType).sort(),
    ['mobile_web', 'popout'],
    'clean prewarm did not diversify across the two currently clean identities');
  const prewarmMasters = runtime.state.calls.filter((call) => {
    const url = new URL(call.url);
    return url.hostname === 'usher.ttvnw.net' && url.searchParams.has('sig');
  });
  assert(prewarmMasters.length === 2, 'clean prewarm did not make exactly two alternate master requests: ' +
    JSON.stringify(prewarmMasters.map((call) => call.url)));
  assert(prewarmMasters.every((call) => !new URL(call.url).searchParams.has('parent_domains')),
    'popout/mobile_web prewarm leaked embed-only parent_domains context');
  assert(runtime.state.calls.filter((call) => /\/backup\//.test(call.url)).length === 2,
    'clean prewarm did not probe both alternate media playlists');

  await runtime.fetch(ORIGINAL_MEDIA_URL);
  assert(runtime.state.gqlRequests.length === 2,
    'subsequent clean polling duplicated the in-flight/cached prewarm');

  runtime.advance(2 * 60 * 1000 - 1);
  await runtime.fetch(ORIGINAL_MEDIA_URL);
  assert(runtime.state.gqlRequests.length === 2,
    'clean prewarm refreshed before its two-minute cache TTL');
  runtime.advance(1);
  await runtime.fetch(ORIGINAL_MEDIA_URL);
  for (let turn = 0; turn < 6; turn++) await new Promise((resolve) => setImmediate(resolve));
  assert(runtime.state.gqlRequests.length === 4,
    'expired clean prewarm did not refresh exactly the two diversified identities');
  equal(runtime.state.gqlRequests.slice(2).map((request) => request.body.variables.playerType).sort(),
    ['mobile_web', 'popout'],
    'expired clean prewarm refreshed a different identity set');
});

test('explicit preroll keeps the long clean-backup wait after an earlier clean native poll', async () => {
  let nativePolls = 0;
  const delayedBackupMs = 1100;
  const runtime = createRuntime({
    fakeClock: true,
    now: 100000,
    fetchRoute: standardFetchRoute({
      originalMedia() {
        return nativePolls++ === 0 ? CLEAN_MEDIA : EXPLICIT_PREROLL_AD;
      },
      backupMedia: CLEAN_MEDIA,
    }),
    gqlRoute(message) {
      return new Promise((resolve) => {
        setTimeout(() => resolve(jsonResponse(nestedToken(message.body.variables.playerType))), delayedBackupMs);
      });
    },
  });
  await mapMaster(runtime);
  const clean = await (await runtime.fetch(ORIGINAL_MEDIA_URL)).text();
  assert(clean === CLEAN_MEDIA, 'fixture did not establish the earlier clean native poll');
  assert(runtime.state.gqlRequests.length === 0,
    'clean poll prewarmed before a token identity was available');
  runtime.advance(2501);
  runtime.updateClientState({ tokenTemplate: playbackTokenTemplate(CHANNEL) });

  const started = performance.now();
  const body = await (await runtime.fetch(ORIGINAL_MEDIA_URL)).text();
  const elapsed = performance.now() - started;
  assert(body === CLEAN_MEDIA,
    'explicit preroll used the short post-clean wait and fell back before a clean alternate arrived');
  assert(elapsed >= 950,
    'explicit preroll did not wait for the deliberately delayed clean alternate: ' + elapsed.toFixed(1) + 'ms');
});

test('ad-imminent pre-roll starts the full clean backup before the native media poll resolves', async () => {
  let releaseNative;
  let nativeReleased = false;
  const nativeGate = new Promise((resolve) => {
    releaseNative = () => {
      nativeReleased = true;
      resolve();
    };
  });
  const standardRoute = standardFetchRoute({ originalMedia: STITCHED_AD, backupMedia: CLEAN_MEDIA });
  const runtime = createRuntime({
    initialState: { tokenTemplate: playbackTokenTemplate(CHANNEL) },
    fetchRoute(url, init, state) {
      if (new URL(url).pathname === new URL(ORIGINAL_MEDIA_URL).pathname) {
        return nativeGate.then(() => hlsResponse(STITCHED_AD));
      }
      return standardRoute(url, init, state);
    },
    gqlRoute(message) {
      return jsonResponse(nestedToken(message.body.variables.playerType));
    },
  });
  await mapMaster(runtime);
  runtime.announceAdImminent();
  const pending = runtime.fetch(ORIGINAL_MEDIA_URL);
  for (let turn = 0; turn < 12 && runtime.state.gqlRequests.length < 4; turn++) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  const earlyTypes = runtime.state.gqlRequests.map((request) => request.body.variables.playerType).sort();
  const backupStartedEarly = !nativeReleased && earlyTypes.length === 4;
  releaseNative();
  const body = await (await pending).text();

  assert(backupStartedEarly,
    'cold pre-roll waited for native ad media before starting the full alternate-token race');
  equal(earlyTypes, ['embed', 'mobile_web', 'popout', 'site'],
    'ad-imminent pre-roll did not start exactly the four bounded clean identities');
  assert(body === CLEAN_MEDIA, 'early pre-roll backup did not replace the deferred native ad playlist');
});

test('master arriving during the first media request maps and cleans that in-flight pre-roll', async () => {
  let releaseNative;
  const nativeGate = new Promise((resolve) => { releaseNative = resolve; });
  const standardRoute = standardFetchRoute({ originalMedia: STITCHED_AD, backupMedia: CLEAN_MEDIA });
  const runtime = createRuntime({
    initialState: { tokenTemplate: playbackTokenTemplate(CHANNEL) },
    fetchRoute(url, init, state) {
      if (new URL(url).pathname === new URL(ORIGINAL_MEDIA_URL).pathname) {
        return nativeGate.then(() => hlsResponse(STITCHED_AD));
      }
      return standardRoute(url, init, state);
    },
    gqlRoute(message) {
      return jsonResponse(nestedToken(message.body.variables.playerType));
    },
  });

  const pending = runtime.fetch(ORIGINAL_MEDIA_URL);
  await new Promise((resolve) => setImmediate(resolve));
  runtime.sendMaster(MASTER_URL, ORIGINAL_MASTER, CHANNEL);
  releaseNative();
  const body = await (await pending).text();

  assert(body === CLEAN_MEDIA,
    'first media request stayed unmapped after its master arrived while native fetch was pending');
  assert(runtime.state.gqlRequests.length > 0 && runtime.state.gqlRequests.every((request) =>
    request.body.variables.login === CHANNEL),
  'in-flight pre-roll did not use the newly mapped channel for its clean backup');
});

test('master arriving during a failed part-only retry re-resolves the in-flight pre-roll profile', async () => {
  const targetChannel = 'guang233';
  const targetMasterUrl = 'https://usher.ttvnw.net/api/v2/channel/hls/' + targetChannel + '.m3u8?p=target';
  const targetMediaUrl = 'https://video-edge-fixture.ttvnw.net/' + targetChannel +
    '/chunked/index.m3u8?token=target';
  const detachedUrl = 'https://video-edge-fixture.ttvnw.net/' + targetChannel +
    '/detached-preroll.m3u8?token=ad&_HLS_msn=812&_HLS_part=1&_HLS_skip=YES';
  const targetMaster = `#EXTM3U
#EXT-X-MEDIA:TYPE=VIDEO,GROUP-ID="chunked",NAME="1080p60 (source)",AUTOSELECT=YES,DEFAULT=YES
#EXT-X-STREAM-INF:BANDWIDTH=8500000,CODECS="avc1.64002A,mp4a.40.2",RESOLUTION=1920x1080,VIDEO="chunked",FRAME-RATE=60.000
${targetMediaUrl}
`;
  let rejectRetry;
  let markRetryStarted;
  const retryStarted = new Promise((resolve) => { markRetryStarted = resolve; });
  const detachedPath = new URL(detachedUrl).pathname;
  const standardRoute = standardFetchRoute({ originalMedia: CLEAN_MEDIA, backupMedia: CLEAN_MEDIA });
  const runtime = createRuntime({
    initialState: { tokenTemplate: playbackTokenTemplate(targetChannel) },
    fetchRoute(url, init, state) {
      const parsed = new URL(url);
      if (parsed.pathname === detachedPath) {
        if (parsed.searchParams.has('_HLS_msn')) return hlsResponse(PART_ONLY_AD);
        return new Promise((resolve, reject) => {
          rejectRetry = reject;
          markRetryStarted();
        });
      }
      return standardRoute(url, init, state);
    },
    gqlRoute(message) {
      return jsonResponse(nestedToken(message.body.variables.playerType));
    },
  });

  const pending = runtime.fetch(detachedUrl);
  await retryStarted;
  assert(runtime.state.gqlRequests.length === 0,
    'unmapped part-only pre-roll started backup work before its master arrived');
  runtime.sendMaster(targetMasterUrl, targetMaster, targetChannel, true);
  rejectRetry(new Error('fixture cursor-free retry failed after target master arrived'));
  const body = await (await pending).text();

  assert(body === CLEAN_MEDIA,
    'late master mapping was not re-resolved after the cursor-free retry failed');
  assert(body !== PART_ONLY_AD,
    'confirmed part-only pre-roll escaped after its target master arrived in flight');
  assert(runtime.state.gqlRequests.length > 0 && runtime.state.gqlRequests.every((request) =>
    request.body.variables.login === targetChannel),
  'late-mapped part-only pre-roll requested a clean token for the wrong channel');
  assert(runtime.state.messages.some((message) => message && message.type === 'ad-state' &&
    message.state === 'blocked-clean' && message.channel === targetChannel),
  'late-mapped part-only pre-roll did not report its clean replacement');
  assert(runtime.state.calls.filter((call) => new URL(call.url).pathname === detachedPath).length === 2,
    'late-master fixture did not perform exactly the initial poll and one cursor-free retry');
});

test('an actively polled media profile remains mapped beyond five minutes', async () => {
  const startedAt = 100000;
  let showAd = false;
  const runtime = createRuntime({
    fakeClock: true,
    now: startedAt,
    initialState: { tokenTemplate: playbackTokenTemplate(CHANNEL) },
    fetchRoute: standardFetchRoute({
      originalMedia() { return showAd ? STITCHED_AD : CLEAN_MEDIA; },
      backupMedia: CLEAN_MEDIA,
    }),
    gqlRoute(message) {
      return jsonResponse(nestedToken(message.body.variables.playerType));
    },
  });
  await mapMaster(runtime);
  runtime.advance(4 * 60 * 1000 + 30 * 1000);
  const activeBody = await (await runtime.fetch(ORIGINAL_MEDIA_URL)).text();
  assert(activeBody === CLEAN_MEDIA, 'active media poll changed before the mapping TTL boundary');
  for (let turn = 0; turn < 6; turn++) await new Promise((resolve) => setImmediate(resolve));
  runtime.advance(40 * 1000);
  showAd = true;

  const body = await (await runtime.fetch(ORIGINAL_MEDIA_URL)).text();
  assert(body === CLEAN_MEDIA,
    'actively used profile expired five minutes after its master instead of five minutes after last use');
});

test('detached ad fallback stays on the active channel even when another channel maps later', async () => {
  const otherChannel = 'otherfixture';
  const otherMasterUrl = 'https://usher.ttvnw.net/api/v2/channel/hls/' + otherChannel + '.m3u8?p=other';
  const otherMediaUrl = 'https://video-edge-fixture.ttvnw.net/other/live/index.m3u8?token=other';
  const detachedAdUrl = 'https://video-edge-fixture.ttvnw.net/other/ad/index.m3u8?token=detached';
  const otherMaster = `#EXTM3U
#EXT-X-MEDIA:TYPE=VIDEO,GROUP-ID="chunked",NAME="1080p60 (source)",AUTOSELECT=YES,DEFAULT=YES
#EXT-X-STREAM-INF:BANDWIDTH=8500000,CODECS="avc1.64002A,mp4a.40.2",RESOLUTION=1920x1080,VIDEO="chunked",FRAME-RATE=60.000
${otherMediaUrl}
`;
  const standardRoute = standardFetchRoute({ originalMedia: CLEAN_MEDIA, backupMedia: CLEAN_MEDIA });
  const runtime = createRuntime({
    fakeClock: true,
    now: 100000,
    fetchRoute(url, init, state) {
      const parsed = new URL(url);
      if (parsed.pathname === new URL(otherMediaUrl).pathname) return hlsResponse(CLEAN_MEDIA);
      if (parsed.pathname === new URL(detachedAdUrl).pathname) return hlsResponse(STITCHED_AD);
      return standardRoute(url, init, state);
    },
    gqlRoute(message) {
      return jsonResponse(nestedToken(message.body.variables.playerType));
    },
  });
  runtime.sendMaster(otherMasterUrl, otherMaster, otherChannel);
  runtime.advance(4 * 60 * 1000 + 30 * 1000);
  await runtime.fetch(otherMediaUrl);
  runtime.advance(40 * 1000);
  runtime.sendMaster(MASTER_URL, ORIGINAL_MASTER, CHANNEL);
  const before = runtime.state.gqlRequests.length;

  await runtime.fetch(detachedAdUrl);
  const fallbackRequests = runtime.state.gqlRequests.slice(before);
  assert(fallbackRequests.length > 0, 'detached ad fixture did not exercise clean-backup fallback');
  assert(fallbackRequests.every((request) => request.body.variables.login === otherChannel),
    'detached ad fallback crossed from the active channel to a later unrelated master');
});

test('a queued warning from the previous channel cannot roll back rapid-switch pre-roll recovery', async () => {
  const firstChannel = 'firstswitch';
  const secondChannel = 'secondswitch';
  const firstMasterUrl = 'https://usher.ttvnw.net/api/v2/channel/hls/' + firstChannel + '.m3u8?p=first';
  const secondMasterUrl = 'https://usher.ttvnw.net/api/v2/channel/hls/' + secondChannel + '.m3u8?p=second';
  const firstMediaUrl = 'https://video-edge-fixture.ttvnw.net/switch-a/chunked/index.m3u8?token=first';
  const secondMediaUrl = 'https://video-edge-fixture.ttvnw.net/switch-b/chunked/index.m3u8?token=second';
  const detachedSecondAdUrl = 'https://video-edge-fixture.ttvnw.net/switch-b/detached.m3u8' +
    '?token=ad&_HLS_msn=812&_HLS_part=1';
  const switchMaster = (mediaUrl) => `#EXTM3U
#EXT-X-MEDIA:TYPE=VIDEO,GROUP-ID="chunked",NAME="1080p60 (source)",AUTOSELECT=YES,DEFAULT=YES
#EXT-X-STREAM-INF:BANDWIDTH=8500000,CODECS="avc1.64002A,mp4a.40.2",RESOLUTION=1920x1080,VIDEO="chunked",FRAME-RATE=60.000
${mediaUrl}
`;
  const standardRoute = standardFetchRoute({ originalMedia: CLEAN_MEDIA, backupMedia: CLEAN_MEDIA });
  const detachedPath = new URL(detachedSecondAdUrl).pathname;
  const runtime = createRuntime({
    initialState: { tokenTemplate: playbackTokenTemplate(secondChannel) },
    fetchRoute(url, init, state) {
      const parsed = new URL(url);
      if (parsed.pathname === detachedPath) {
        if (parsed.searchParams.has('_HLS_msn')) return hlsResponse(PART_ONLY_AD);
        throw new Error('fixture cursor-free retry failed');
      }
      return standardRoute(url, init, state);
    },
    gqlRoute(message) {
      return jsonResponse(nestedToken(message.body.variables.playerType));
    },
  });

  runtime.sendMaster(firstMasterUrl, switchMaster(firstMediaUrl), firstChannel, true);
  runtime.sendMaster(secondMasterUrl, switchMaster(secondMediaUrl), secondChannel, true);
  runtime.announceAdImminent(firstChannel);

  const body = await (await runtime.fetch(detachedSecondAdUrl)).text();
  assert(body === CLEAN_MEDIA,
    'late warning for the previous channel returned confirmed pre-roll parts after switching');
  assert(runtime.state.gqlRequests.length > 0,
    'rapid-switch fixture never attempted the current channel clean fallback');
  assert(runtime.state.gqlRequests.every((request) => request.body.variables.login === secondChannel),
    'late warning rolled clean-backup token requests back to the previous channel');
  assert(runtime.state.messages.some((message) => message && message.type === 'ad-state' &&
    message.state === 'blocked-clean' && message.channel === secondChannel),
  'rapid-switch pre-roll did not report a clean replacement for the current channel');
});

test('detached pre-roll fallback never selects a last-listed audio-only rendition', async () => {
  const audioUrl = 'https://video-edge-fixture.ttvnw.net/original/audio-only.m3u8?token=audio';
  const detachedUrl = 'https://video-edge-fixture.ttvnw.net/original/detached-preroll.m3u8?token=ad';
  const sourceFirstAudioLast = `#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=8500000,CODECS="avc1.64002A,mp4a.40.2",RESOLUTION=1920x1080,VIDEO="chunked",FRAME-RATE=60.000
${ORIGINAL_MEDIA_URL}
#EXT-X-STREAM-INF:BANDWIDTH=192000,CODECS="mp4a.40.2",VIDEO="audio_only"
${audioUrl}
`;
  const standardRoute = standardFetchRoute({
    originalMaster: sourceFirstAudioLast,
    originalMedia: CLEAN_MEDIA,
    backupMedia: CLEAN_MEDIA,
  });
  const runtime = createRuntime({
    initialState: { tokenTemplate: playbackTokenTemplate(CHANNEL) },
    fetchRoute(url, init, state) {
      if (new URL(url).pathname === new URL(detachedUrl).pathname) return hlsResponse(STITCHED_AD);
      return standardRoute(url, init, state);
    },
  });
  await mapMaster(runtime);
  const body = await (await runtime.fetch(detachedUrl)).text();
  assert(body === CLEAN_MEDIA,
    'detached pre-roll inherited the audio-only profile instead of the video/source profile');
});

test('ad-imminent fallback leaves LL-HLS coherently for ordinary polling when every clean route misses', async () => {
  const imminentLl = `#EXTM3U
#EXT-X-VERSION:9
#EXT-X-TARGETDURATION:2
#EXT-X-SERVER-CONTROL:CAN-BLOCK-RELOAD=YES,PART-HOLD-BACK=1.500
#EXT-X-PART-INF:PART-TARGET=0.500
#EXT-X-MEDIA-SEQUENCE:900
#EXTINF:2.000,live
https://video-weaver-fixture.ttvnw.net/live/imminent-900.ts
#EXT-X-PART:DURATION=0.500,URI="https://video-weaver-fixture.ttvnw.net/future/imminent-901.0.m4s"
#EXT-X-PRELOAD-HINT:TYPE=PART,URI="https://video-weaver-fixture.ttvnw.net/future/imminent-901.1.m4s"
`;
  const blockingUrl = ORIGINAL_MEDIA_URL + '&_HLS_msn=901&_HLS_part=1&_HLS_skip=YES';
  const runtime = createRuntime({
    initialState: { tokenTemplate: playbackTokenTemplate(CHANNEL) },
    fetchRoute: standardFetchRoute({ originalMedia: imminentLl, backupMedia: STRONG_METADATA_ALL_AD }),
  });
  await mapMaster(runtime);
  runtime.announceAdImminent();
  const first = await (await runtime.fetch(blockingUrl)).text();
  assert(first.includes('imminent-900.ts'), 'ordinary fallback removed the complete native live segment');
  assert(!/^#EXT-X-(?:SERVER-CONTROL|PART-INF|PART|PRELOAD-HINT|RENDITION-REPORT|SKIP|TWITCH-PREFETCH)\b/im.test(first),
    'ad-imminent fallback returned an internally mixed LL-HLS manifest');

  await runtime.fetch(blockingUrl);
  const nativeCalls = runtime.state.calls.filter((call) =>
    new URL(call.url).pathname === new URL(ORIGINAL_MEDIA_URL).pathname);
  assert(nativeCalls.length === 2, 'imminent fallback issued unexpected native media requests');
  const secondUrl = new URL(nativeCalls[1].url);
  assert(!secondUrl.searchParams.has('_HLS_msn') && !secondUrl.searchParams.has('_HLS_part') &&
    !secondUrl.searchParams.has('_HLS_skip'),
  'ordinary fallback kept issuing blocking part cursors after leaving LL-HLS');
});

test('concurrent ad playlists share one bounded backup flight', async () => {
  const runtime = createRuntime({
    fetchRoute: standardFetchRoute({ originalMedia: STITCHED_AD, backupMedia: CLEAN_MEDIA }),
    gqlRoute(message) {
      const body = message.body;
      return jsonResponse(nestedToken(body.variables.playerType));
    },
  });
  await mapMaster(runtime);
  const responses = await Promise.all(Array.from({ length: 24 }, () => runtime.fetch(ORIGINAL_MEDIA_URL)));
  const bodies = await Promise.all(responses.map((response) => response.text()));
  assert(bodies.every((body) => body === CLEAN_MEDIA), 'single-flight callers did not all receive clean media');
  assert(runtime.state.gqlRequests.length === 4,
    'concurrent ads multiplied token flights: ' + runtime.state.gqlRequests.length);
  const backupMasters = runtime.state.calls.filter((call) => {
    const url = new URL(call.url);
    return url.hostname === 'usher.ttvnw.net' && url.searchParams.has('sig');
  });
  assert(backupMasters.length === 4,
    'concurrent ads multiplied backup master requests: ' + backupMasters.length);
});

test('negative backup cache stays bounded and never returns its failed sentinel as success', async () => {
  const runtime = createRuntime({
    fakeClock: true,
    now: 100000,
    fetchRoute: standardFetchRoute({ originalMedia: STITCHED_AD, backupMedia: STITCHED_AD }),
    gqlRoute() {
      return jsonResponse({ errors: [{ message: 'fixture reject' }] }, 403);
    },
  });
  await mapMaster(runtime);
  const firstWave = await Promise.all(Array.from({ length: 16 }, () => runtime.fetch(ORIGINAL_MEDIA_URL)));
  const firstBodies = await Promise.all(firstWave.map((response) => response.text()));
  assert(firstBodies.every((body) => {
    try {
      assertDecodeSafeGap(body, STITCHED_AD, 'failed single-flight caller');
      return true;
    } catch (_) {
      return false;
    }
  }), 'failed single-flight callers did not all receive decode-safe gaps');
  assert(runtime.state.gqlRequests.length === 4,
    'failed concurrent flight was not bounded to four source-capable token requests');

  const beforeRetry = runtime.state.gqlRequests.length;
  const retryBody = await (await runtime.fetch(ORIGINAL_MEDIA_URL)).text();
  assert(runtime.state.gqlRequests.length === beforeRetry,
    'negative-cache retry launched another token flight inside its TTL');
  assert(typeof retryBody === 'string' && retryBody.length > 0,
    'failed-cache sentinel became an empty successful playlist');
  assertDecodeSafeGap(retryBody, STITCHED_AD, 'negative-cache retry inside TTL');

  runtime.advance(30001);
  const expiredBody = await (await runtime.fetch(ORIGINAL_MEDIA_URL)).text();
  assert(runtime.state.gqlRequests.length === beforeRetry + 4,
    'expired negative sentinel was not deleted and retried exactly once');
  assertDecodeSafeGap(expiredBody, STITCHED_AD, 'negative-cache retry after TTL');
});

test('worker config-off is a byte-for-byte pass-through with no backup work', async () => {
  const runtime = createRuntime({
    fetchRoute: standardFetchRoute({ originalMedia: STITCHED_AD, backupMedia: CLEAN_MEDIA }),
  });
  runtime.configure(false);
  const master = await runtime.fetch(MASTER_URL);
  assert(master.ok, 'config-off master request failed');
  const adBody = await (await runtime.fetch(ORIGINAL_MEDIA_URL)).text();
  assert(adBody === STITCHED_AD, 'config-off worker changed the media playlist');

  const gqlBody = JSON.stringify([{
    operationName: 'PlaybackAccessToken',
    variables: { isLive: true, login: CHANNEL, playerType: 'site', platform: 'android' },
  }]);
  await runtime.fetch(GQL_URL, { method: 'POST', body: gqlBody, headers: { 'Client-ID': 'off' } });
  const gqlCall = runtime.state.calls.find((call) => call.url === GQL_URL);
  assert(gqlCall && gqlCall.init.body === gqlBody, 'config-off worker changed the GQL body');
  assert(runtime.state.gqlRequests.length === 0, 'config-off worker initiated backup GQL');
  assert(runtime.state.timers.length === 0, 'config-off worker scheduled backup/timeout work');
  const masterCall = runtime.state.calls.find((call) => call.url.includes('/api/v2/channel/hls/'));
  assert(masterCall && new URL(masterCall.url).searchParams.has('parent_domains'),
    'config-off worker still rewrote the Usher URL');
});

test('worker re-announces the same blocking state after a config off/on cycle', async () => {
  const runtime = createRuntime({
    fetchRoute: standardFetchRoute({ originalMedia: STITCHED_AD, backupMedia: CLEAN_MEDIA }),
    gqlRoute(message) {
      return jsonResponse(nestedToken(message.body.variables.playerType));
    },
  });
  await mapMaster(runtime);
  await runtime.fetch(ORIGINAL_MEDIA_URL);
  const blockedStates = () => runtime.state.messages.filter((message) =>
    message && message.type === 'ad-state' && /^blocked-/.test(String(message.state || '')));
  assert(blockedStates().length === 1, 'first intervention did not report one blocking state');

  runtime.configure(false);
  runtime.configure(true);
  await runtime.fetch(ORIGINAL_MEDIA_URL);
  assert(blockedStates().length === 2,
    're-enabled worker suppressed the unchanged blocking state needed to resync the page');
});

// A player left in low-latency mode keeps issuing blocking _HLS_msn/_HLS_part
// reloads for parts an ad-time playlist can no longer supply, which Twitch reports
// as network "Error #2000". Anything we synthesize during a break must therefore
// come back as ordinary HLS.
test('ad-time playlists drop low-latency signalling so the player stops blocking on parts', async () => {
  const runtime = createRuntime({
    fetchRoute: standardFetchRoute({
      originalMedia: LOW_LATENCY_MIXED_AD,
      backupMedia: STRONG_METADATA_ALL_AD,
    }),
    gqlRoute(message) {
      const body = message.body;
      return jsonResponse(nestedToken(body.variables.playerType));
    },
  });
  await mapMaster(runtime);
  const body = await (await runtime.fetch(ORIGINAL_MEDIA_URL)).text();
  for (const rawLine of body.replace(/\r/g, '').split('\n')) {
    const line = rawLine.trim();
    assert(!/^#EXT-X-(?:SERVER-CONTROL|PART-INF|PART|PRELOAD-HINT|RENDITION-REPORT|SKIP|TWITCH-PREFETCH)\b/i.test(line),
      'ad-time playlist kept low-latency tag: ' + line);
  }
  assert(body.includes('https://video-weaver-fixture.ttvnw.net/live/ll-811.ts'),
    'ad-time playlist dropped the clean live segment');
});

test('active intervention removes blocking LL-HLS cursors but preserves signed query state', async () => {
  const runtime = createRuntime({
    fetchRoute: standardFetchRoute({
      originalMedia: LOW_LATENCY_MIXED_AD,
      backupMedia: STRONG_METADATA_ALL_AD,
    }),
    gqlRoute(message) {
      return jsonResponse(nestedToken(message.body.variables.playerType));
    },
  });
  await mapMaster(runtime);
  await runtime.fetch(ORIGINAL_MEDIA_URL);

  const blockingUrl = ORIGINAL_MEDIA_URL + '&_HLS_msn=812&_HLS_part=3&_HLS_skip=YES';
  const body = await (await runtime.fetch(blockingUrl)).text();
  const originalPath = new URL(ORIGINAL_MEDIA_URL).pathname;
  const nativePolls = runtime.state.calls.filter((call) => new URL(call.url).pathname === originalPath);
  const forwarded = new URL(nativePolls[nativePolls.length - 1].url);
  assert(forwarded.searchParams.get('token') === 'original',
    'intervention dropped the native signed query state');
  assert(!forwarded.searchParams.has('_HLS_msn') && !forwarded.searchParams.has('_HLS_part') &&
    !forwarded.searchParams.has('_HLS_skip'),
  'intervention forwarded a blocking LL-HLS cursor that its response cannot satisfy');
  assert(!/^#EXT-X-(?:SERVER-CONTROL|PART-INF|PART|PRELOAD-HINT|RENDITION-REPORT|SKIP)\b/im.test(body),
    'cursor-sanitized intervention still returned low-latency signalling');
});

// The page cannot observe how far behind live a backup session runs: a swap does
// not stop the media element, so currentTime keeps advancing at 1x and only the
// wall-clock age of the content changes. Here both playlists are in hand at the
// same instant and both carry PROGRAM-DATE-TIME, so the difference between their
// live edges is a direct reading. It is the entire budget the page-side catch-up
// is allowed to spend, so a regression here silently disables that feature -- or,
// worse, hands it a number it did not measure.
const SWAP_OFFSET_MS = 20000;
const SWAP_NATIVE_EDGE = Date.parse('2026-07-23T00:01:00.000Z');
const CLEAN_MEDIA_UNDATED = `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-TARGETDURATION:2
#EXT-X-MEDIA-SEQUENCE:99100
#EXTINF:2.000,live
https://video-edge-fixture.ttvnw.net/live/undated-99100.ts
`;

function datedPlaylist(options) {
  return ['#EXTM3U',
    '#EXT-X-VERSION:3',
    '#EXT-X-TARGETDURATION:2',
    '#EXT-X-MEDIA-SEQUENCE:' + options.sequence,
    options.marker || null,
    '#EXT-X-PROGRAM-DATE-TIME:' + new Date(options.startMs).toISOString(),
    '#EXTINF:2.000,' + (options.title || ''),
    'https://video-edge-fixture.ttvnw.net/dated/' + options.sequence + '.ts',
    ''].filter((line) => line !== null).join('\n');
}

test('the swap offset is measured from both playlists and reported once with clear', async () => {
  let nativePolls = 0;
  const runtime = createRuntime({
    fetchRoute: standardFetchRoute({
      originalMedia() {
        const index = nativePolls++;
        // Poll 0 is the confirmed ad; the three after it are ordinary live media
        // and release the intervention on the third.
        return datedPlaylist({
          sequence: 701 + index,
          startMs: SWAP_NATIVE_EDGE + index * 2000,
          marker: index === 0
            ? '#EXT-X-DATERANGE:ID="stitched-ad-offset",CLASS="twitch-stitched-ad",DURATION=30.0'
            : null,
          title: index === 0 ? 'advertisement' : 'live',
        });
      },
      // The backup session advances in lockstep with the native one, a fixed
      // distance behind it, exactly as a second live session would.
      backupMedia() {
        const index = Math.max(0, nativePolls - 1);
        return datedPlaylist({
          sequence: 99100 + index,
          startMs: SWAP_NATIVE_EDGE - SWAP_OFFSET_MS + index * 2000,
          title: 'live',
        });
      },
    }),
    gqlRoute(message) {
      return jsonResponse(nestedToken(message.body.variables.playerType));
    },
  });
  await mapMaster(runtime);

  for (let poll = 0; poll < 4; poll++) await runtime.fetch(ORIGINAL_MEDIA_URL);
  const states = runtime.state.messages.filter((message) => message && message.type === 'ad-state');
  equal(states.map((message) => message.state), ['blocked-clean', 'clear'],
    'measured-offset fixture did not run one clean swap and release');
  assert(states[0].offsetMs === 0, 'a blocking transition carried a latency budget it cannot bound');
  assert(states[1].offsetMs === SWAP_OFFSET_MS,
    'clear reported ' + states[1].offsetMs + 'ms instead of the measured ' + SWAP_OFFSET_MS + 'ms swap offset');
});

test('an undated or impossible playlist pair reports no swap offset at all', async () => {
  let nativePolls = 0;
  const runtime = createRuntime({
    fetchRoute: standardFetchRoute({
      originalMedia() {
        const index = nativePolls++;
        // No PROGRAM-DATE-TIME anywhere: nothing to difference, so nothing to
        // report. The page treats a missing budget as a refusal.
        if (index === 0) return STITCHED_AD;
        return CLEAN_MEDIA_UNDATED;
      },
      backupMedia: CLEAN_MEDIA_UNDATED,
    }),
    gqlRoute(message) {
      return jsonResponse(nestedToken(message.body.variables.playerType));
    },
  });
  await mapMaster(runtime);

  for (let poll = 0; poll < 4; poll++) await runtime.fetch(ORIGINAL_MEDIA_URL);
  const states = runtime.state.messages.filter((message) => message && message.type === 'ad-state');
  const clear = states.find((message) => message.state === 'clear');
  assert(clear, 'undated fixture never released the intervention');
  assert(clear.offsetMs === 0, 'an undated playlist pair produced a fabricated latency budget');
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
