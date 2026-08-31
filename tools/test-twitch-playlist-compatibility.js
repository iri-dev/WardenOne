/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
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
#EXT-X-PROGRAM-DATE-TIME:2026-07-23T00:00:04.000Z
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
const TURBO_HOUSE_PRELOAD_HINT = `#EXTM3U
#EXT-X-VERSION:9
#EXT-X-TARGETDURATION:2
#EXT-X-SERVER-CONTROL:CAN-BLOCK-RELOAD=YES,PART-HOLD-BACK=1.500
#EXT-X-PART-INF:PART-TARGET=0.500
#EXT-X-MEDIA-SEQUENCE:302
#EXT-X-PROGRAM-DATE-TIME:2026-07-23T00:01:04.000Z
#EXTINF:2.000,live
https://video-edge-fixture.ttvnw.net/live/turbo-edge-302.ts
#EXT-X-PROGRAM-DATE-TIME:2026-07-23T00:01:06.000Z
#EXTINF:2.000,live
https://video-edge-fixture.ttvnw.net/live/turbo-edge-303.ts
#EXT-X-PROGRAM-DATE-TIME:2026-07-23T00:01:08.000Z
#EXT-X-PART:DURATION=0.500,URI="https://video-edge-fixture.ttvnw.net/live/turbo-edge-304.0.m4s",INDEPENDENT=YES
#EXT-X-PRELOAD-HINT:TYPE=PART,URI="https://video-weaver-fixture.ttvnw.net/stitched-ad/turbo-house-304.1.m4s"
`;
const TURBO_HOUSE_SKIPPED_DELTA = `#EXTM3U
#EXT-X-VERSION:9
#EXT-X-TARGETDURATION:2
#EXT-X-SERVER-CONTROL:CAN-BLOCK-RELOAD=YES,PART-HOLD-BACK=1.500,CAN-SKIP-UNTIL=12.000
#EXT-X-PART-INF:PART-TARGET=0.500
#EXT-X-MEDIA-SEQUENCE:301
#EXT-X-SKIP:SKIPPED-SEGMENTS=2
#EXT-X-PROGRAM-DATE-TIME:2026-07-23T00:01:06.000Z
#EXTINF:2.000,live
https://video-edge-fixture.ttvnw.net/live/turbo-skip-303.ts
#EXT-X-PROGRAM-DATE-TIME:2026-07-23T00:01:08.000Z
#EXT-X-PART:DURATION=0.500,URI="https://video-edge-fixture.ttvnw.net/live/turbo-skip-304.0.m4s",INDEPENDENT=YES
#EXT-X-PRELOAD-HINT:TYPE=PART,URI="https://video-weaver-fixture.ttvnw.net/stitched-ad/turbo-house-skip-304.1.m4s"
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

function explicitLivePoll(sequence, suffix, startMs) {
  return sequencedPlaylist({
    sequence: sequence,
    startMs: startMs,
    title: 'live',
    path: suffix,
  });
}

function assertNativeFailOpen(runtime, body, original, label) {
  assert(body === original, label + ' rewrote the native playlist instead of preserving playback');
  assert(!body.includes('#EXT-X-GAP'), label + ' reintroduced a decoder-stalling HLS gap');
  assert(!body.includes('data:video/mp4'), label + ' injected synthetic decoder bytes');
  const states = runtime.state.messages.filter((message) => message && message.type === 'ad-state');
  assert(!states.some((message) => message.state === 'blocked-native'),
    label + ' reintroduced the failed native cover/mute fallback');
  assert(!states.some((message) => message.state === 'blocked-imminent'),
    label + ' rewrote a warning-only native manifest');
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
    state.calls.push({ url: url, input: input, init: init });
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
    assertNativeFailOpen(runtime, body, fixtures.get(url), name + ' marker');
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
  assertNativeFailOpen(runtime, body, AUTHORITATIVE_PREROLL_LIVE_TITLE,
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
  assertNativeFailOpen(runtime, body, KNOWN_AD_URI_NO_MARKER, 'known ad URI without marker');
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
  assertNativeFailOpen(runtime, body, STITCHED_AD_URI_WITH_LIVE_TITLE, 'stitched-ad URI with live title');
});

test('slid-out markers hold the clean backup until three advancing explicit-live polls', async () => {
  const slideStart = Date.parse('2026-07-23T00:00:00.000Z');
  const confirmedSlideAd = SLID_MARKER_CONFIRMED_AD
    .replace('DURATION=2.0', 'DURATION=30.0')
    .replace('#EXT-X-CUE-OUT:2', '#EXT-X-CUE-OUT:30');
  const livePolls = [
    explicitLivePoll(902, 'explicit-live-902', slideStart + 2000),
    explicitLivePoll(903, 'explicit-live-903', slideStart + 4000),
    explicitLivePoll(904, 'explicit-live-904', slideStart + 6000),
  ];
  const nativePolls = [
    confirmedSlideAd,
    SLID_MARKER_GENERIC_TAIL,
    livePolls[0],
    livePolls[1],
    livePolls[2],
    markedAd('#EXT-X-DATERANGE:ID="stitched-ad-after-learning",CLASS="twitch-stitched-ad",DURATION=2.0',
      'after-learning'),
  ];
  let nativePollIndex = 0;
  let backupPollIndex = 0;
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
        const index = backupPollIndex++;
        return sequencedPlaylist({
          sequence: 99100 + index,
          startMs: slideStart + index * 2000,
          title: 'live',
          path: 'slide-clean-backup',
        });
      },
    }),
    gqlRoute(message) {
      if (rejectNewTokens) return jsonResponse({ errors: [{ message: 'fixture reject' }] }, 403);
      return jsonResponse(nestedToken(message.body.variables.playerType));
    },
  });
  await mapMaster(runtime);

  const adBody = await (await runtime.fetch(ORIGINAL_MEDIA_URL)).text();
  assert(adBody.includes('/slide-clean-backup/'),
    'confirmed stitched/CUE poll did not activate the clean backup');

  const genericBody = await (await runtime.fetch(ORIGINAL_MEDIA_URL)).text();
  assert(genericBody !== SLID_MARKER_GENERIC_TAIL && !genericBody.includes('generic-tail-901.ts'),
    'marker slide-out leaked the generic empty-title tail segment');

  const firstExplicit = await (await runtime.fetch(ORIGINAL_MEDIA_URL)).text();
  assert(firstExplicit !== livePolls[0] && !firstExplicit.includes('/explicit-live-902/'),
    'one explicit live poll released or learned native media too early');
  const secondExplicit = await (await runtime.fetch(ORIGINAL_MEDIA_URL)).text();
  assert(secondExplicit !== livePolls[1] && !secondExplicit.includes('/explicit-live-903/'),
    'two explicit live polls released or learned native media too early');
  const thirdExplicit = await (await runtime.fetch(ORIGINAL_MEDIA_URL)).text();
  assert(thirdExplicit.includes('/explicit-live-904/'),
    'native media content was not released on the third consecutive explicit live poll');
  const servedSequences = [adBody, genericBody, firstExplicit, secondExplicit, thirdExplicit]
    .map((body) => Number((/#EXT-X-MEDIA-SEQUENCE:(\d+)/.exec(body) || [])[1]));
  assert(servedSequences.every(Number.isFinite) && servedSequences.every((value, index) =>
    index === 0 || value >= servedSequences[index - 1]),
  'backup/native transition moved MEDIA-SEQUENCE backwards: ' + JSON.stringify(servedSequences));

  failCachedBackup = true;
  rejectNewTokens = true;
  const failedOpen = await (await runtime.fetch(ORIGINAL_MEDIA_URL)).text();
  assert(failedOpen.includes('after-learning'),
    'a failed clean-session search replayed stale media instead of advancing native playback');
  assert(!failedOpen.includes('#EXT-X-GAP') && !failedOpen.includes('data:video/mp4'),
    'failed clean-session search starved or poisoned the native decoder');
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

test('a clean backup warms its exact edge segment without delaying or duplicating the swap', async () => {
  const cleanBackup = sequencedPlaylist({
    sequence: 99100,
    startMs: SEQUENCE_BASE_TIME,
    title: 'live',
    path: 'warm-edge-segment',
  });
  const standardRoute = standardFetchRoute({ originalMedia: STITCHED_AD, backupMedia: cleanBackup });
  const warmCalls = [];
  let releaseWarm;
  const warmGate = new Promise((resolve) => { releaseWarm = resolve; });
  const runtime = createRuntime({
    fetchRoute(url, init, state) {
      if (/\/warm-edge-segment\/\d+\.ts(?:[?#]|$)/.test(url)) {
        warmCalls.push({ url, init });
        return warmGate.then(() => new Response(new Uint8Array([1, 2, 3]), {
          status: 206,
          headers: { 'content-type': 'video/mp2t' },
        }));
      }
      return standardRoute(url, init, state);
    },
    gqlRoute(message) {
      return jsonResponse(nestedToken(message.body.variables.playerType));
    },
  });
  await mapMaster(runtime);
  runtime.updateClientState({ tokenTemplate: playbackTokenTemplate(CHANNEL) });

  const first = await Promise.race([
    runtime.fetch(ORIGINAL_MEDIA_URL),
    new Promise((_, reject) => setTimeout(() => reject(new Error('segment warm-up delayed the playlist')), 250)),
  ]);
  const firstBody = await first.text();
  assert(firstBody.includes('/warm-edge-segment/'),
    'clean backup was not served while its edge warm-up stayed in flight');
  for (let turn = 0; turn < 8 && warmCalls.length < 1; turn++) await Promise.resolve();
  assert(warmCalls.length === 1,
    'clean backup did not warm exactly one current media segment');
  assert(warmCalls[0].url.endsWith('/warm-edge-segment/99102.ts'),
    'clean backup warmed something other than its newest full media segment');
  assert(warmCalls[0].init && warmCalls[0].init.headers &&
    warmCalls[0].init.headers.Range === 'bytes=0-65535',
  'clean backup warm-up did not use the bounded byte range');

  await runtime.fetch(ORIGINAL_MEDIA_URL);
  await Promise.resolve();
  assert(warmCalls.length === 1,
    'the same clean media edge was warmed more than once');
  releaseWarm();
  await Promise.resolve();
  await Promise.resolve();
});

test('a late cached mid-roll uses one fresh native bridge within the total 900ms budget', async () => {
  const ads = [501, 502, 503].map((sequence) => markedAd(
    '#EXT-X-DATERANGE:ID="stitched-ad-full-bridge-' + sequence +
      '",CLASS="twitch-stitched-ad",DURATION=2.0',
    'full-bridge-' + sequence).replace('#EXT-X-MEDIA-SEQUENCE:501',
      '#EXT-X-MEDIA-SEQUENCE:' + sequence));
  const settledBackup = sequencedPlaylist({
    sequence: 99102,
    startMs: Date.parse('2026-07-23T00:00:04.000Z'),
    title: 'live',
    path: 'settled-full-bridge-backup',
  });
  let nativePoll = 0;
  let delayBackup = false;
  let backupPolls = 0;
  const runtime = createRuntime({
    initialState: { tokenTemplate: playbackTokenTemplate(CHANNEL) },
    fetchRoute: standardFetchRoute({
      originalMedia() {
        if (!nativePoll++) return CLEAN_MEDIA;
        return ads[Math.min(nativePoll - 2, ads.length - 1)];
      },
      backupMedia(url, init) {
        backupPolls++;
        if (!delayBackup) return settledBackup;
        return new Promise((resolve, reject) => {
          let settled = false;
          const timer = setTimeout(() => {
            if (settled) return;
            settled = true;
            resolve(settledBackup);
          }, 1300);
          const signal = init && init.signal;
          const abort = () => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            const error = new Error('fixture delayed clean-backup poll aborted');
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
      return jsonResponse(nestedToken(message.body.variables.playerType));
    },
  });
  await mapMaster(runtime);
  const cleanBody = await (await runtime.fetch(ORIGINAL_MEDIA_URL)).text();
  assert(cleanBody === CLEAN_MEDIA, 'fixture did not establish a clean native bridge');
  for (let turn = 0; turn < 12 && backupPolls < 1; turn++) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert(backupPolls === 1, 'fixture did not cache its initial exact-rendition backup');

  delayBackup = true;
  const bridgeStarted = performance.now();
  const bridged = await (await runtime.fetch(ORIGINAL_MEDIA_URL)).text();
  const bridgeElapsed = performance.now() - bridgeStarted;
  assert(bridgeElapsed < 1150,
    'cached mid-roll escaped the total 900ms budget: ' + bridgeElapsed.toFixed(1) + 'ms');
  assert(bridged === CLEAN_MEDIA && !bridged.includes('/commercial/'),
    'late clean search exposed the first full ad instead of one fresh native bridge');

  await new Promise((resolve) => setTimeout(resolve, 500));
  const settledStarted = performance.now();
  const settled = await (await runtime.fetch(ORIGINAL_MEDIA_URL)).text();
  const settledElapsed = performance.now() - settledStarted;
  assert(settledElapsed <= 250,
    'late clean result was discarded instead of primed: ' + settledElapsed.toFixed(1) + 'ms');
  assert(settled.includes('/settled-full-bridge-backup/') && !settled.includes('/commercial/'),
    'the next poll did not adopt the clean backup that settled behind the bridge');

  const replayStarted = performance.now();
  const notReplayed = await (await runtime.fetch(ORIGINAL_MEDIA_URL)).text();
  const replayElapsed = performance.now() - replayStarted;
  assert(replayElapsed < 1150,
    'second delayed poll escaped the total 900ms budget: ' + replayElapsed.toFixed(1) + 'ms');
  assert(notReplayed.includes('/commercial/full-bridge-503.ts') &&
    !notReplayed.includes('/live/99100.ts'),
  'the consumed clean native bridge replayed again within the same ad episode');
});

test('a late cold backup is primed for the poll after its one native bridge', async () => {
  const lateBackup = sequencedPlaylist({
    sequence: 99102,
    startMs: Date.parse('2026-07-23T00:00:04.000Z'),
    title: 'live',
    path: 'late-cold-backup',
  });
  let nativePoll = 0;
  let backupPolls = 0;
  const runtime = createRuntime({
    fetchRoute: standardFetchRoute({
      originalMedia() { return nativePoll++ === 0 ? CLEAN_MEDIA : STITCHED_AD; },
      backupMedia(url, init) {
        backupPolls++;
        return new Promise((resolve, reject) => {
          let settled = false;
          const timer = setTimeout(() => {
            if (settled) return;
            settled = true;
            resolve(lateBackup);
          }, 1100);
          const signal = init && init.signal;
          const abort = () => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            const error = new Error('fixture delayed cold backup aborted');
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
      return jsonResponse(nestedToken(message.body.variables.playerType));
    },
  });
  await mapMaster(runtime);
  assert(await (await runtime.fetch(ORIGINAL_MEDIA_URL)).text() === CLEAN_MEDIA,
    'late-cold fixture did not establish native playback');
  runtime.updateClientState({ tokenTemplate: playbackTokenTemplate(CHANNEL) });

  const bridged = await (await runtime.fetch(ORIGINAL_MEDIA_URL)).text();
  assert(bridged === CLEAN_MEDIA && !bridged.includes('/commercial/'),
    'late cold acquisition exposed the ad instead of its one native bridge');
  await new Promise((resolve) => setTimeout(resolve, 350));
  const pollsAfterLateResult = backupPolls;
  const started = performance.now();
  const body = await (await runtime.fetch(ORIGINAL_MEDIA_URL)).text();
  const elapsed = performance.now() - started;

  assert(elapsed <= 250, 'primed late cold backup was re-polled: ' + elapsed.toFixed(1) + 'ms');
  assert(body.includes('/late-cold-backup/') && !body.includes('/commercial/'),
    'the poll after a late cold acquisition did not consume its validated result');
  assert(backupPolls === pollsAfterLateResult,
    'the poll after a late cold acquisition started another rendition request');
});

test('a conclusive clean-route failure does not hold old native media as a bridge', async () => {
  let nativePoll = 0;
  const runtime = createRuntime({
    initialState: { tokenTemplate: playbackTokenTemplate(CHANNEL) },
    fetchRoute: standardFetchRoute({
      originalMedia() { return nativePoll++ === 0 ? CLEAN_MEDIA : STITCHED_AD; },
      backupMedia: CLEAN_MEDIA,
    }),
    gqlRoute() {
      return jsonResponse({ errors: [{ message: 'fixture has no clean alternate' }] }, 403);
    },
  });
  await mapMaster(runtime);
  assert(await (await runtime.fetch(ORIGINAL_MEDIA_URL)).text() === CLEAN_MEDIA,
    'definitive-miss fixture did not establish native playback');
  for (let turn = 0; turn < 8; turn++) await new Promise((resolve) => setImmediate(resolve));

  const started = performance.now();
  const body = await (await runtime.fetch(ORIGINAL_MEDIA_URL)).text();
  const elapsed = performance.now() - started;
  assert(elapsed <= 250, 'conclusive clean-route miss exceeded 250ms: ' + elapsed.toFixed(1) + 'ms');
  assertNativeFailOpen(runtime, body, STITCHED_AD, 'conclusive clean-route miss');
});

test('SCTE35-OUT DATERANGE is detected without rewriting the native timeline', async () => {
  const url = 'https://video-edge-fixture.ttvnw.net/unmapped/scte35-timed.m3u8';
  const runtime = createRuntime({
    fetchRoute(requestUrl) {
      if (requestUrl !== url) throw new Error('unexpected SCTE35 fixture request: ' + requestUrl);
      return hlsResponse(SCTE35_TIMED_PLAYLIST);
    },
  });
  const body = await (await runtime.fetch(url)).text();
  assertNativeFailOpen(runtime, body, SCTE35_TIMED_PLAYLIST, 'timed SCTE35 range');
});

test('mixed CUE playlists are detected without rewriting clean or ad segments', async () => {
  const url = 'https://video-edge-fixture.ttvnw.net/unmapped/mixed-cue.m3u8';
  const runtime = createRuntime({
    fetchRoute(requestUrl) {
      if (requestUrl !== url) throw new Error('unexpected mixed-CUE request: ' + requestUrl);
      return hlsResponse(MIXED_CUE_PLAYLIST);
    },
  });
  const body = await (await runtime.fetch(url)).text();
  assertNativeFailOpen(runtime, body, MIXED_CUE_PLAYLIST, 'mixed CUE playlist');
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
  assert(runtime.state.gqlRequests.length === 1,
    'clean mobile_feed route did not stop the ordered backup search after one token');
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
    assert(request.body.variables.playerType === 'mobile_feed' && request.body.variables.platform === 'android',
      'captured template was not retargeted to mobile_feed/android');
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
      assert(!url.searchParams.has('parent_domains'), 'alternate session leaked native parent_domains context');
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

test('backup identities use mobile_feed/android, popout/web, then autoplay/android', async () => {
  const runtime = createRuntime({
    fetchRoute: standardFetchRoute({ originalMedia: STITCHED_AD, backupMedia: CLEAN_MEDIA }),
    gqlRoute() {
      return jsonResponse({ errors: [{ message: 'fixture reject' }] }, 403);
    },
  });
  await mapMaster(runtime);
  const body = await (await runtime.fetch(ORIGINAL_MEDIA_URL)).text();
  const pairs = runtime.state.gqlRequests.map((request) =>
    request.body.variables.playerType + '/' + request.body.variables.platform);
  assertNativeFailOpen(runtime, body, STITCHED_AD, 'exhausted source-capable types');
  equal(pairs, ['mobile_feed/android', 'mobile_feed/android', 'popout/web', 'popout/web',
    'autoplay/android', 'autoplay/android'],
  'backup identity order or persisted-to-document retry changed');
  for (let index = 0; index < runtime.state.gqlRequests.length; index += 2) {
    const persisted = runtime.state.gqlRequests[index].body;
    const document = runtime.state.gqlRequests[index + 1].body;
    assert(persisted.extensions && persisted.extensions.persistedQuery,
      persisted.variables.playerType + ' did not try the captured persisted query first');
    assert(!document.extensions && typeof document.query === 'string' && document.query.includes('$platform'),
      document.variables.playerType + ' did not retry once with the full platform-aware query');
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

test('an in-place backup requires an exact codec, resolution, frame rate, group, and range', async () => {
  const cases = [
    { label: 'H.264 profile', codecs: 'avc1.4D401F,mp4a.40.2', resolution: '1920x1080',
      fps: '60.000', video: 'chunked', videoRange: '' },
    { label: 'resolution', codecs: 'avc1.64002A,mp4a.40.2', resolution: '1280x720',
      fps: '60.000', video: 'chunked', videoRange: '' },
    { label: 'frame rate', codecs: 'avc1.64002A,mp4a.40.2', resolution: '1920x1080',
      fps: '30.000', video: 'chunked', videoRange: '' },
    { label: 'video group', codecs: 'avc1.64002A,mp4a.40.2', resolution: '1920x1080',
      fps: '60.000', video: 'alternate-source', videoRange: '' },
    { label: 'video range', codecs: 'avc1.64002A,mp4a.40.2', resolution: '1920x1080',
      fps: '60.000', video: 'chunked', videoRange: 'PQ' },
  ];

  for (const scenario of cases) {
    const candidate = 'mismatch-' + scenario.label.toLowerCase().replace(/\W+/g, '-');
    const runtime = createRuntime({
      fetchRoute: standardFetchRoute({
        originalMedia: STITCHED_AD,
        backupMaster() {
          return `#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=8500000,CODECS="${scenario.codecs}",RESOLUTION=${scenario.resolution},VIDEO="${scenario.video}",FRAME-RATE=${scenario.fps}${scenario.videoRange ? ',VIDEO-RANGE=' + scenario.videoRange : ''}
https://video-edge-fixture.ttvnw.net/backup/fixture/${candidate}.m3u8
`;
        },
        backupMedia: CLEAN_MEDIA,
      }),
      gqlRoute(message) {
        return jsonResponse(nestedToken(message.body.variables.playerType));
      },
    });
    await mapMaster(runtime);
    const body = await (await runtime.fetch(ORIGINAL_MEDIA_URL)).text();
    assertNativeFailOpen(runtime, body, STITCHED_AD, scenario.label + ' mismatch');
    assert(!runtime.state.calls.some((call) => call.url.includes('/' + candidate + '.m3u8')),
      scenario.label + ' mismatch was probed despite being unsafe in-place');
  }
});

test('an omitted HLS video range remains equivalent to explicit SDR', async () => {
  const explicitSdrMaster = () => `#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=8500000,CODECS="avc1.64002A,mp4a.40.2",RESOLUTION=1920x1080,VIDEO="chunked",FRAME-RATE=60.000,VIDEO-RANGE=SDR
https://video-edge-fixture.ttvnw.net/backup/fixture/explicit-sdr.m3u8
`;
  const runtime = createRuntime({
    fetchRoute: standardFetchRoute({
      originalMedia: STITCHED_AD,
      backupMaster: explicitSdrMaster,
      backupMedia: CLEAN_MEDIA,
    }),
    gqlRoute(message) {
      return jsonResponse(nestedToken(message.body.variables.playerType));
    },
  });
  await mapMaster(runtime);
  const body = await (await runtime.fetch(ORIGINAL_MEDIA_URL)).text();
  assert(body === CLEAN_MEDIA, 'explicit SDR was rejected against an equivalent omitted video range');
  assert(runtime.state.calls.some((call) => /explicit-sdr\.m3u8/.test(call.url)),
    'explicit SDR exact rendition was never probed');
});

test('a stitched preferred rendition does not discard a later clean exact rendition', async () => {
  const twoExactRenditions = () => `#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=8500000,CODECS="avc1.64002A,mp4a.40.2",RESOLUTION=1920x1080,VIDEO="chunked",FRAME-RATE=60.000
https://video-edge-fixture.ttvnw.net/backup/fixture/h264-1080-first.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=8400000,CODECS="avc1.64002A,mp4a.40.2",RESOLUTION=1920x1080,VIDEO="chunked",FRAME-RATE=60.000
https://video-edge-fixture.ttvnw.net/backup/fixture/h264-1080-second.m3u8
`;
  const runtime = createRuntime({
    fetchRoute: standardFetchRoute({
      originalMedia: STITCHED_AD,
      backupMaster: twoExactRenditions,
      backupMedia(url) {
        if (/h264-1080-first/.test(url)) return STITCHED_AD;
        if (/h264-1080-second/.test(url)) return CLEAN_MEDIA;
        throw new Error('unexpected exact-rendition candidate: ' + url);
      },
    }),
    gqlRoute(message) {
      return jsonResponse(nestedToken(message.body.variables.playerType));
    },
  });
  await mapMaster(runtime);
  const body = await (await runtime.fetch(ORIGINAL_MEDIA_URL)).text();
  assert(body === CLEAN_MEDIA, 'second exact rendition was not returned');
  const mediaCalls = runtime.state.calls.filter((call) => /\/backup\/.+h264-1080-.+\.m3u8/.test(call.url));
  assert(mediaCalls.length >= 2 && /h264-1080-first/.test(mediaCalls[0].url) &&
    mediaCalls.some((call) => /h264-1080-second/.test(call.url)),
  'exact renditions were not searched in ranked order: ' + JSON.stringify(mediaCalls.map((call) => call.url)));
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
  assertNativeFailOpen(runtime, body, STITCHED_AD, 'cross-container backup rejection');
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

test('part-only ad deltas retry one cursor-free manifest before clean-backup or native fail-open', async () => {
  const scenarios = [
    { label: 'mapped clean backup', url: ORIGINAL_MEDIA_URL, mapped: true },
    {
      label: 'unmapped native fail-open',
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
      assertNativeFailOpen(runtime, body, STITCHED_AD,
        scenario.label + ' did not continue into the complete-manifest fail-open path');
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
    assert(runtime.state.gqlRequests.length > 0 && runtime.state.gqlRequests.length <= 3,
      fixture.label + ' did not keep clean-backup work within three identities');
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

test('a stale native snapshot is never replayed as a part-only bridge', async () => {
  const blockingUrl = ORIGINAL_MEDIA_URL + '&_HLS_msn=812&_HLS_part=1&_HLS_skip=YES';
  const mediaPath = new URL(ORIGINAL_MEDIA_URL).pathname;
  let cleanEstablished = false;
  const standardRoute = standardFetchRoute({ originalMedia: CLEAN_MEDIA, backupMedia: CLEAN_MEDIA });
  const runtime = createRuntime({
    fakeClock: true,
    now: 100000,
    initialState: { tokenTemplate: playbackTokenTemplate(CHANNEL) },
    fetchRoute(url, init, state) {
      const parsed = new URL(url);
      if (parsed.pathname !== mediaPath) return standardRoute(url, init, state);
      if (!cleanEstablished) {
        cleanEstablished = true;
        return hlsResponse(CLEAN_MEDIA);
      }
      if (parsed.searchParams.has('_HLS_msn')) return hlsResponse(PART_ONLY_AD);
      throw new Error('fixture ordinary retry failed after the bridge became stale');
    },
    gqlRoute() {
      return jsonResponse({ errors: [{ message: 'fixture has no clean alternate' }] }, 403);
    },
  });
  await mapMaster(runtime);
  assert(await (await runtime.fetch(ORIGINAL_MEDIA_URL)).text() === CLEAN_MEDIA,
    'stale-bridge fixture did not establish its native snapshot');
  for (let turn = 0; turn < 8; turn++) await new Promise((resolve) => setImmediate(resolve));
  runtime.advance(6001);

  const body = await (await runtime.fetch(blockingUrl)).text();
  assert(body === PART_ONLY_AD && !body.includes('/live/99100.ts'),
    'a native snapshot older than the bridge freshness window was replayed');
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
#EXT-X-MEDIA-SEQUENCE:8800
#EXT-X-MAP:URI="../init/init.mp4"
#EXT-X-KEY:METHOD=AES-128,URI="keys/key.bin"
#EXT-X-PART:DURATION=0.500,URI="parts/part-1.m4s"
#EXT-X-PRELOAD-HINT:TYPE=PART,URI="parts/part-2.m4s"
#EXT-X-PROGRAM-DATE-TIME:2026-07-23T00:00:00.000Z
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

test('strong-metadata all-ad backups fail open on native media within 250ms', async () => {
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
  assertNativeFailOpen(runtime, body, STRONG_METADATA_ALL_AD, 'strong-metadata all-ad fallback');
  const pairs = runtime.state.gqlRequests.map((request) =>
    request.body.variables.playerType + '/' + request.body.variables.platform);
  equal(pairs, ['mobile_feed/android', 'popout/web', 'autoplay/android'],
    'all-ad fallback did not stop after the three ordered local identities');
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

test('captured token identity prewarms mobile_feed/android before the first ad', async () => {
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
  equal(runtime.state.gqlRequests.map((request) =>
    request.body.variables.playerType + '/' + request.body.variables.platform),
  ['mobile_feed/android'], 'clean prewarm did not use mobile_feed/android');
  const prewarmMasters = runtime.state.calls.filter((call) => {
    const url = new URL(call.url);
    return url.hostname === 'usher.ttvnw.net' && url.searchParams.has('sig');
  });
  assert(prewarmMasters.length === 1, 'clean prewarm did not make exactly one alternate master request: ' +
    JSON.stringify(prewarmMasters.map((call) => call.url)));
  assert(prewarmMasters.every((call) => !new URL(call.url).searchParams.has('parent_domains')),
    'mobile_feed prewarm leaked native parent_domains context');
  assert(runtime.state.calls.filter((call) => /\/backup\//.test(call.url)).length === 1,
    'clean prewarm did not probe exactly one alternate media playlist');

  await runtime.fetch(ORIGINAL_MEDIA_URL);
  assert(runtime.state.gqlRequests.length === 1,
    'subsequent clean polling duplicated the in-flight/cached prewarm');

  runtime.advance(2 * 60 * 1000 - 1);
  await runtime.fetch(ORIGINAL_MEDIA_URL);
  assert(runtime.state.gqlRequests.length === 1,
    'clean prewarm refreshed before its two-minute cache TTL');
  runtime.advance(1);
  await runtime.fetch(ORIGINAL_MEDIA_URL);
  for (let turn = 0; turn < 6; turn++) await new Promise((resolve) => setImmediate(resolve));
  assert(runtime.state.gqlRequests.length === 2,
    'expired clean prewarm did not refresh mobile_feed exactly once');
  equal(runtime.state.gqlRequests.slice(1).map((request) =>
    request.body.variables.playerType + '/' + request.body.variables.platform),
  ['mobile_feed/android'], 'expired clean prewarm refreshed a different identity');
});

test('explicit preroll keeps the long clean-backup wait after an earlier clean native poll', async () => {
  let nativePolls = 0;
  const delayedBackupMs = 1100;
  const progressedBackup = sequencedPlaylist({
    sequence: 99101,
    startMs: Date.parse('2026-07-23T00:00:02.000Z'),
    title: 'live',
    path: 'explicit-preroll-clean',
  });
  const runtime = createRuntime({
    fakeClock: true,
    now: 100000,
    fetchRoute: standardFetchRoute({
      originalMedia() {
        return nativePolls++ === 0 ? CLEAN_MEDIA : EXPLICIT_PREROLL_AD;
      },
      backupMedia: progressedBackup,
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
  assert(body.includes('/explicit-preroll-clean/') && !body.includes('/commercial/explicit-preroll-610.ts'),
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
  for (let turn = 0; turn < 12 && runtime.state.gqlRequests.length < 1; turn++) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  const earlyPairs = runtime.state.gqlRequests.map((request) =>
    request.body.variables.playerType + '/' + request.body.variables.platform);
  const backupStartedEarly = !nativeReleased && earlyPairs.length === 1;
  releaseNative();
  const body = await (await pending).text();

  assert(backupStartedEarly,
    'cold pre-roll waited for native ad media before starting the full alternate-token race');
  equal(earlyPairs, ['mobile_feed/android'],
    'ad-imminent pre-roll did not start mobile_feed/android first');
  assert(body === CLEAN_MEDIA, 'early pre-roll backup did not replace the deferred native ad playlist');
});

test('ad-imminent refreshes a cached backup early and the following ad poll shares that flight', async () => {
  let nativePoll = 0;
  let backupPoll = 0;
  let releaseRefresh;
  const events = [];
  const refreshGate = new Promise((resolve) => { releaseRefresh = resolve; });
  const nativeClean = sequencedPlaylist({
    sequence: 100,
    startMs: SEQUENCE_BASE_TIME,
    title: 'live',
    path: 'front-leak-native-clean',
  });
  const nativeAd = sequencedPlaylist({
    sequence: 101,
    startMs: SEQUENCE_BASE_TIME + 2000,
    marker: '#EXT-X-DATERANGE:ID="stitched-ad-front-leak",CLASS="twitch-stitched-ad",DURATION=4.0',
    title: 'advertisement',
    path: 'front-leak-native-ad',
  });
  const cachedClean = sequencedPlaylist({
    sequence: 9100,
    startMs: SEQUENCE_BASE_TIME,
    title: 'live',
    path: 'front-leak-clean-backup',
  });
  const refreshedClean = sequencedPlaylist({
    sequence: 9101,
    startMs: SEQUENCE_BASE_TIME + 2000,
    title: 'live',
    path: 'front-leak-clean-backup',
  });
  const runtime = createRuntime({
    initialState: { tokenTemplate: playbackTokenTemplate(CHANNEL) },
    fetchRoute: standardFetchRoute({
      originalMedia() {
        const ad = nativePoll++ > 0;
        events.push(ad ? 'native-ad-start' : 'native-clean-start');
        return ad ? nativeAd : nativeClean;
      },
      backupMedia() {
        const refresh = backupPoll++ > 0;
        events.push(refresh ? 'backup-refresh-start' : 'backup-acquire');
        return refresh ? refreshGate.then(() => refreshedClean) : cachedClean;
      },
    }),
    gqlRoute(message) {
      return jsonResponse(nestedToken(message.body.variables.playerType));
    },
  });
  await mapMaster(runtime);
  const setup = await (await runtime.fetch(ORIGINAL_MEDIA_URL)).text();
  assert(setup.includes('/front-leak-native-clean/'),
    'front-leak fixture did not establish native playback before the warning');
  for (let turn = 0; turn < 12 && backupPoll < 1; turn++) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  for (let turn = 0; turn < 4; turn++) await new Promise((resolve) => setImmediate(resolve));
  assert(backupPoll === 1, 'front-leak fixture did not establish exactly one cached mobile_feed backup');
  const tokenRequestsAtWarning = runtime.state.gqlRequests.length;
  equal(runtime.state.gqlRequests.map((request) =>
    request.body.variables.playerType + '/' + request.body.variables.platform),
  ['mobile_feed/android'], 'front-leak fixture cached a different clean identity');

  events.length = 0;
  runtime.announceAdImminent(CHANNEL);
  for (let turn = 0; turn < 12 && backupPoll < 2; turn++) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  const refreshStartedBeforeNative = events.includes('backup-refresh-start');

  const adPending = runtime.fetch(ORIGINAL_MEDIA_URL);
  for (let turn = 0; turn < 12 &&
       (!events.includes('native-ad-start') || !events.includes('backup-refresh-start')); turn++) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  for (let turn = 0; turn < 4; turn++) await new Promise((resolve) => setImmediate(resolve));
  releaseRefresh();
  const body = await (await adPending).text();

  assert(refreshStartedBeforeNative &&
    events.indexOf('backup-refresh-start') < events.indexOf('native-ad-start'),
  'ad-imminent warning waited for the native ad poll before refreshing its cached backup');
  assert(backupPoll === 2,
    'the ad poll duplicated the warning-time cached refresh: ' + (backupPoll - 1) + ' refresh calls');
  assert(runtime.state.gqlRequests.length === tokenRequestsAtWarning,
    'warning-time cached refresh unnecessarily minted another playback token');
  assert(body.includes('/front-leak-clean-backup/') && !body.includes('/front-leak-native-ad/'),
    'the ad poll did not reuse the already-started clean refresh');
});

test('a completed warning-time refresh is primed for the next ad poll and cleared on config reset', async () => {
  let nativePoll = 0;
  let backupPoll = 0;
  let tokensAllowed = true;
  const nativeClean = sequencedPlaylist({
    sequence: 200,
    startMs: SEQUENCE_BASE_TIME,
    title: 'live',
    path: 'completed-prime-native-clean',
  });
  const nativeAd = (sequence, suffix) => sequencedPlaylist({
    sequence: sequence,
    startMs: SEQUENCE_BASE_TIME + (sequence - 200) * 2000,
    marker: '#EXT-X-DATERANGE:ID="stitched-ad-completed-prime-' + suffix +
      '",CLASS="twitch-stitched-ad",DURATION=4.0',
    title: 'advertisement',
    path: 'completed-prime-native-ad-' + suffix,
  });
  const cachedClean = sequencedPlaylist({
    sequence: 9200,
    startMs: SEQUENCE_BASE_TIME,
    title: 'live',
    path: 'completed-prime-cached-backup',
  });
  const warningRefresh = sequencedPlaylist({
    sequence: 9201,
    startMs: SEQUENCE_BASE_TIME + 2000,
    title: 'live',
    path: 'completed-prime-warning-refresh',
  });
  const duplicateRefresh = sequencedPlaylist({
    sequence: 9202,
    startMs: SEQUENCE_BASE_TIME + 4000,
    title: 'live',
    path: 'completed-prime-duplicate-refresh',
  });
  const runtime = createRuntime({
    fakeClock: true,
    now: 3000000,
    initialState: { tokenTemplate: playbackTokenTemplate(CHANNEL) },
    fetchRoute: standardFetchRoute({
      originalMedia() {
        const index = nativePoll++;
        if (index === 0) return nativeClean;
        return nativeAd(200 + index, index === 1 ? 'first' : 'after-clear');
      },
      backupMedia() {
        const index = backupPoll++;
        if (index === 0) return cachedClean;
        if (index === 1) return warningRefresh;
        return duplicateRefresh;
      },
    }),
    gqlRoute(message) {
      if (tokensAllowed) return jsonResponse(nestedToken(message.body.variables.playerType));
      return jsonResponse({ errors: [{ message: 'fixture token disabled after config reset' }] }, 403);
    },
  });
  await mapMaster(runtime);
  await runtime.fetch(ORIGINAL_MEDIA_URL);
  for (let turn = 0; turn < 12 && backupPoll < 1; turn++) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  for (let turn = 0; turn < 4; turn++) await new Promise((resolve) => setImmediate(resolve));
  assert(backupPoll === 1, 'completed-prime fixture did not establish its cached mobile_feed backup');
  const tokenRequestsAtWarning = runtime.state.gqlRequests.length;

  runtime.announceAdImminent(CHANNEL);
  for (let turn = 0; turn < 12 && backupPoll < 2; turn++) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  for (let turn = 0; turn < 4; turn++) await new Promise((resolve) => setImmediate(resolve));
  const warningRefreshCompleted = backupPoll === 2;
  runtime.advance(100);
  const firstAd = await (await runtime.fetch(ORIGINAL_MEDIA_URL)).text();

  assert(warningRefreshCompleted,
    'ad-imminent warning did not complete a cached refresh before the following native ad poll');
  assert(backupPoll === 2,
    'the ad poll re-fetched a very-recent warning-time snapshot: ' + (backupPoll - 1) + ' refresh calls');
  assert(runtime.state.gqlRequests.length === tokenRequestsAtWarning,
    'the primed warning snapshot minted another playback token');
  assert(firstAd.includes('/completed-prime-warning-refresh/') &&
    !firstAd.includes('/completed-prime-duplicate-refresh/') &&
    !firstAd.includes('/completed-prime-native-ad-first/'),
  'the first ad poll did not reuse the validated warning-time snapshot');

  tokensAllowed = false;
  runtime.configure(false);
  runtime.configure(true);
  const tokenRequestsBeforeClearedAd = runtime.state.gqlRequests.length;
  const afterClear = await (await runtime.fetch(ORIGINAL_MEDIA_URL)).text();
  assert(afterClear.includes('/completed-prime-native-ad-after-clear/') &&
    !afterClear.includes('/completed-prime-warning-refresh/'),
  'config reset left the warning-time prime eligible for a later ad poll');
  assert(runtime.state.gqlRequests.length > tokenRequestsBeforeClearedAd,
    'cleared prime bypassed a fresh clean-session search after config reset');
});

test('a pre-warning native clean response cannot consume the prime needed by the first Turbo preload hint', async () => {
  let nativePoll = 0;
  let backupPoll = 0;
  let releasePreWarningNative;
  const preWarningNativeGate = new Promise((resolve) => { releasePreWarningNative = resolve; });
  const setupNative = sequencedPlaylist({
    sequence: 300,
    startMs: SEQUENCE_BASE_TIME,
    title: 'live',
    path: 'turbo-prime-native-setup',
  });
  const preWarningNative = sequencedPlaylist({
    sequence: 301,
    startMs: SEQUENCE_BASE_TIME + 2000,
    title: 'live',
    path: 'turbo-prime-native-prewarning',
  });
  const cachedClean = sequencedPlaylist({
    sequence: 9300,
    startMs: SEQUENCE_BASE_TIME,
    title: 'live',
    path: 'turbo-prime-cached',
  });
  const warningPrime = sequencedPlaylist({
    sequence: 9301,
    startMs: SEQUENCE_BASE_TIME + 4000,
    title: 'live',
    path: 'turbo-prime-warning',
  });
  const runtime = createRuntime({
    initialState: { tokenTemplate: playbackTokenTemplate(CHANNEL) },
    fetchRoute: standardFetchRoute({
      originalMedia() {
        const index = nativePoll++;
        if (index === 0) return setupNative;
        if (index === 1) return preWarningNativeGate.then(() => preWarningNative);
        return TURBO_HOUSE_PRELOAD_HINT;
      },
      backupMedia() {
        const index = backupPoll++;
        if (index === 0) return cachedClean;
        if (index === 1) return warningPrime;
        return STRONG_METADATA_ALL_AD;
      },
    }),
    gqlRoute(message) {
      return jsonResponse(nestedToken(message.body.variables.playerType));
    },
  });
  await mapMaster(runtime);
  const setup = await (await runtime.fetch(ORIGINAL_MEDIA_URL)).text();
  assert(setup.includes('/turbo-prime-native-setup/'),
    'Turbo-prime fixture did not establish native playback');
  for (let turn = 0; turn < 12 && backupPoll < 1; turn++) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  for (let turn = 0; turn < 4; turn++) await new Promise((resolve) => setImmediate(resolve));
  assert(backupPoll === 1, 'Turbo-prime fixture did not cache its clean mobile_feed session');

  const cleanPending = runtime.fetch(ORIGINAL_MEDIA_URL);
  for (let turn = 0; turn < 4 && nativePoll < 2; turn++) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert(nativePoll === 2, 'pre-warning native request did not enter flight before the warning');
  runtime.announceAdImminent(CHANNEL);
  for (let turn = 0; turn < 12 && backupPoll < 2; turn++) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  for (let turn = 0; turn < 4; turn++) await new Promise((resolve) => setImmediate(resolve));
  assert(backupPoll === 2, 'warning did not finish its clean refresh while native media was pending');
  const tokenRequestsAtPrime = runtime.state.gqlRequests.length;

  releasePreWarningNative();
  const preWarningBody = await (await cleanPending).text();
  const turboBody = await (await runtime.fetch(ORIGINAL_MEDIA_URL)).text();

  assert(preWarningBody === preWarningNative,
    'a warning that arrived after the clean request consumed its prime on that older native response');
  assert(backupPoll === 2,
    'the first Turbo preload hint missed the warning prime and started another backup flight');
  assert(runtime.state.gqlRequests.length === tokenRequestsAtPrime,
    'the first Turbo preload hint minted replacement tokens after a completed warning prime');
  assert(turboBody.includes('/turbo-prime-warning/') &&
    !turboBody.includes('/stitched-ad/turbo-house-304.1.m4s'),
  'the first Turbo preload hint was not replaced by the reserved warning-time snapshot');
  assert(!turboBody.includes('#EXT-X-GAP') && !turboBody.includes('data:video/mp4'),
    'the Turbo preload intervention starved or poisoned the media decoder');
});

test('a late warning with no clean route fails open on the exact Turbo preload manifest', async () => {
  let releaseNative;
  const nativeGate = new Promise((resolve) => { releaseNative = resolve; });
  const nativeResponse = hlsResponse(TURBO_HOUSE_PRELOAD_HINT);
  const standardRoute = standardFetchRoute({ backupMedia: STRONG_METADATA_ALL_AD });
  const runtime = createRuntime({
    initialState: { tokenTemplate: playbackTokenTemplate(CHANNEL) },
    fetchRoute(url, init, state) {
      if (new URL(url).pathname === new URL(ORIGINAL_MEDIA_URL).pathname) {
        return nativeGate.then(() => nativeResponse);
      }
      return standardRoute(url, init, state);
    },
    gqlRoute(message) {
      return jsonResponse(nestedToken(message.body.variables.playerType));
    },
  });
  await mapMaster(runtime);
  const blockingUrl = ORIGINAL_MEDIA_URL + '&_HLS_msn=304&_HLS_part=1&_HLS_skip=YES';
  const pending = runtime.fetch(blockingUrl);
  await new Promise((resolve) => setImmediate(resolve));
  runtime.announceAdImminent(CHANNEL);
  for (let turn = 0; turn < 12 && runtime.state.gqlRequests.length < 1; turn++) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  releaseNative();
  const body = await (await pending).text();

  assertNativeFailOpen(runtime, body, TURBO_HOUSE_PRELOAD_HINT,
    'late-warning Turbo preload miss');
  const nativeCalls = runtime.state.calls.filter((call) =>
    new URL(call.url).pathname === new URL(ORIGINAL_MEDIA_URL).pathname);
  assert(nativeCalls.length === 1,
    'late-warning Turbo fail-open retried or starved the native media request');
  const forwarded = new URL(nativeCalls[0].url);
  assert(forwarded.searchParams.get('_HLS_msn') === '304' &&
    forwarded.searchParams.get('_HLS_part') === '1' && forwarded.searchParams.get('_HLS_skip') === 'YES',
  'late-warning Turbo fail-open changed the native blocking cursors');
});

test('an EXT-X-SKIP Turbo delta uses its logical tail for warning-prime replacement and exact fail-open', async () => {
  const fullNative = sequencedPlaylist({
    sequence: 301,
    startMs: SEQUENCE_BASE_TIME + 2000,
    title: 'live',
    path: 'turbo-skip-native-full',
  });
  const cachedClean = sequencedPlaylist({
    sequence: 9400,
    startMs: SEQUENCE_BASE_TIME + 2000,
    title: 'live',
    path: 'turbo-skip-cached',
  });
  const warningPrime = sequencedPlaylist({
    sequence: 9401,
    startMs: SEQUENCE_BASE_TIME + 4000,
    title: 'live',
    path: 'turbo-skip-warning-prime',
  });
  let nativePoll = 0;
  let backupPoll = 0;
  const runtime = createRuntime({
    initialState: { tokenTemplate: playbackTokenTemplate(CHANNEL) },
    fetchRoute: standardFetchRoute({
      originalMedia() {
        return nativePoll++ === 0 ? fullNative : TURBO_HOUSE_SKIPPED_DELTA;
      },
      backupMedia() {
        const index = backupPoll++;
        if (index === 0) return cachedClean;
        if (index === 1) return warningPrime;
        return STRONG_METADATA_ALL_AD;
      },
    }),
    gqlRoute(message) {
      return jsonResponse(nestedToken(message.body.variables.playerType));
    },
  });
  await mapMaster(runtime);
  const preceding = await (await runtime.fetch(ORIGINAL_MEDIA_URL)).text();
  assert(preceding === fullNative && preceding.includes('/turbo-skip-native-full/'),
    'EXT-X-SKIP fixture did not establish the preceding full native window');
  for (let turn = 0; turn < 12 && backupPoll < 1; turn++) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  for (let turn = 0; turn < 4; turn++) await new Promise((resolve) => setImmediate(resolve));
  assert(backupPoll === 1, 'EXT-X-SKIP fixture did not cache its clean session');
  runtime.announceAdImminent(CHANNEL);
  for (let turn = 0; turn < 12 && backupPoll < 2; turn++) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  for (let turn = 0; turn < 4; turn++) await new Promise((resolve) => setImmediate(resolve));
  const tokensAtPrime = runtime.state.gqlRequests.length;
  const replaced = await (await runtime.fetch(ORIGINAL_MEDIA_URL)).text();

  let missNativePoll = 0;
  const missRuntime = createRuntime({
    initialState: { tokenTemplate: playbackTokenTemplate(CHANNEL) },
    fetchRoute: standardFetchRoute({
      originalMedia() {
        return missNativePoll++ === 0 ? fullNative : TURBO_HOUSE_SKIPPED_DELTA;
      },
      backupMedia: STRONG_METADATA_ALL_AD,
    }),
    gqlRoute(message) {
      return jsonResponse(nestedToken(message.body.variables.playerType));
    },
  });
  await mapMaster(missRuntime);
  await missRuntime.fetch(ORIGINAL_MEDIA_URL);
  missRuntime.announceAdImminent(CHANNEL);
  for (let turn = 0; turn < 30 && missRuntime.state.gqlRequests.length < 6; turn++) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  const blockingUrl = ORIGINAL_MEDIA_URL + '&_HLS_msn=304&_HLS_part=1&_HLS_skip=YES';
  const failedOpen = await (await missRuntime.fetch(blockingUrl)).text();
  assertNativeFailOpen(missRuntime, failedOpen, TURBO_HOUSE_SKIPPED_DELTA,
    'EXT-X-SKIP Turbo delta miss');
  const missNativeCalls = missRuntime.state.calls.filter((call) =>
    new URL(call.url).pathname === new URL(ORIGINAL_MEDIA_URL).pathname);
  const forwarded = new URL(missNativeCalls[missNativeCalls.length - 1].url);
  assert(forwarded.searchParams.get('_HLS_msn') === '304' &&
    forwarded.searchParams.get('_HLS_part') === '1' && forwarded.searchParams.get('_HLS_skip') === 'YES',
  'EXT-X-SKIP Turbo fail-open changed the native blocking cursors');

  assert(backupPoll === 2,
    'logical EXT-X-SKIP tail missed the completed warning prime and started another backup poll');
  assert(runtime.state.gqlRequests.length === tokensAtPrime,
    'logical EXT-X-SKIP tail unnecessarily minted another replacement token');
  assert(replaced.includes('/turbo-skip-warning-prime/') &&
    !replaced.includes('/stitched-ad/turbo-house-skip-304.1.m4s'),
  'EXT-X-SKIP made an advancing Turbo hint look stale and bypass the warning prime');
  assert(!replaced.includes('#EXT-X-GAP') && !replaced.includes('data:video/mp4'),
    'EXT-X-SKIP warning-prime replacement starved or poisoned the decoder');
});

test('invalid EXT-X-SKIP counts fail open byte-for-byte without consuming a clean prime', async () => {
  const skipLine = '#EXT-X-SKIP:SKIPPED-SEGMENTS=2';
  const invalidDeltas = [
    {
      label: 'malformed',
      body: TURBO_HOUSE_SKIPPED_DELTA.replace(skipLine,
        '#EXT-X-SKIP:SKIPPED-SEGMENTS=not-a-number'),
    },
    {
      label: 'negative',
      body: TURBO_HOUSE_SKIPPED_DELTA.replace(skipLine,
        '#EXT-X-SKIP:SKIPPED-SEGMENTS=-1'),
    },
    {
      label: 'unsafe integer',
      body: TURBO_HOUSE_SKIPPED_DELTA.replace(skipLine,
        '#EXT-X-SKIP:SKIPPED-SEGMENTS=9007199254740992'),
    },
    {
      label: 'duplicate attribute',
      body: TURBO_HOUSE_SKIPPED_DELTA.replace(skipLine,
        '#EXT-X-SKIP:SKIPPED-SEGMENTS=2,SKIPPED-SEGMENTS=3'),
    },
    {
      label: 'duplicate tag',
      body: TURBO_HOUSE_SKIPPED_DELTA.replace(skipLine,
        '#EXT-X-SKIP:SKIPPED-SEGMENTS=2\n#EXT-X-SKIP:SKIPPED-SEGMENTS=3'),
    },
  ];
  const fullNative = sequencedPlaylist({
    sequence: 301,
    startMs: SEQUENCE_BASE_TIME + 2000,
    title: 'live',
    path: 'invalid-skip-native-full',
  });
  const cachedClean = sequencedPlaylist({
    sequence: 9500,
    startMs: SEQUENCE_BASE_TIME + 2000,
    title: 'live',
    path: 'invalid-skip-cached',
  });
  const warningPrime = sequencedPlaylist({
    sequence: 9501,
    startMs: SEQUENCE_BASE_TIME + 4000,
    title: 'live',
    path: 'invalid-skip-warning-prime',
  });
  let nativePoll = 0;
  let backupPoll = 0;
  const runtime = createRuntime({
    initialState: { tokenTemplate: playbackTokenTemplate(CHANNEL) },
    fetchRoute: standardFetchRoute({
      originalMedia() {
        if (nativePoll++ === 0) return fullNative;
        return invalidDeltas[nativePoll - 2].body;
      },
      backupMedia() {
        const index = backupPoll++;
        if (index === 0) return cachedClean;
        if (index === 1) return warningPrime;
        return STRONG_METADATA_ALL_AD;
      },
    }),
    gqlRoute(message) {
      return jsonResponse(nestedToken(message.body.variables.playerType));
    },
  });
  await mapMaster(runtime);
  const preceding = await (await runtime.fetch(ORIGINAL_MEDIA_URL)).text();
  assert(preceding === fullNative, 'invalid EXT-X-SKIP fixture did not establish its full native window');
  for (let turn = 0; turn < 12 && backupPoll < 1; turn++) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  runtime.announceAdImminent(CHANNEL);
  for (let turn = 0; turn < 12 && backupPoll < 2; turn++) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  for (let turn = 0; turn < 4; turn++) await new Promise((resolve) => setImmediate(resolve));
  assert(backupPoll === 2, 'invalid EXT-X-SKIP fixture did not complete its clean warning prime');
  const tokensAtPrime = runtime.state.gqlRequests.length;

  for (const fixture of invalidDeltas) {
    const body = await (await runtime.fetch(ORIGINAL_MEDIA_URL)).text();
    assertNativeFailOpen(runtime, body, fixture.body, fixture.label + ' EXT-X-SKIP count');
  }
  assert(backupPoll === 2,
    'an invalid EXT-X-SKIP count consumed the warning prime or started semantic backup polling');
  assert(runtime.state.gqlRequests.length === tokensAtPrime,
    'an invalid EXT-X-SKIP count minted a replacement token instead of failing open');
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
  let backupPolls = 0;
  const runtime = createRuntime({
    fakeClock: true,
    now: startedAt,
    initialState: { tokenTemplate: playbackTokenTemplate(CHANNEL) },
    fetchRoute: standardFetchRoute({
      originalMedia() {
        return showAd ? sequencedPlaylist({
          sequence: 99101,
          startMs: Date.parse('2026-07-23T00:00:02.000Z'),
          marker: '#EXT-X-DATERANGE:ID="stitched-ad-active-profile",CLASS="twitch-stitched-ad",DURATION=4.0',
          title: 'advertisement',
          path: 'active-profile-ad',
        }) : CLEAN_MEDIA;
      },
      backupMedia() {
        const index = backupPolls++;
        return sequencedPlaylist({
          sequence: 99100 + index,
          startMs: Date.parse('2026-07-23T00:00:00.000Z') + index * 2000,
          title: 'live',
          path: 'active-profile-clean',
        });
      },
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
  assert(body.includes('/active-profile-clean/') && !body.includes('/active-profile-ad/'),
    'actively used profile expired five minutes after its master instead of five minutes after last use');
  assert(runtime.state.messages.some((message) => message && message.state === 'blocked-clean'),
    'active profile did not report its clean replacement');
});

test('one transient lower-rendition poll cannot steal a sustained source-quality backup', async () => {
  const lowerMediaUrl = 'https://video-edge-fixture.ttvnw.net/original/720p60/index-dvr.m3u8?token=lower';
  const detachedAdUrl = 'https://video-edge-fixture.ttvnw.net/original/detached-quality-ad.m3u8?token=ad';
  const qualityMaster = `#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=8500000,CODECS="avc1.64002A,mp4a.40.2",RESOLUTION=1920x1080,VIDEO="chunked",FRAME-RATE=60.000
${ORIGINAL_MEDIA_URL}
#EXT-X-STREAM-INF:BANDWIDTH=4500000,CODECS="avc1.4D401F,mp4a.40.2",RESOLUTION=1280x720,VIDEO="720p60",FRAME-RATE=60.000
${lowerMediaUrl}
`;
  const sustainedBackup = sequencedPlaylist({
    sequence: 99102,
    startMs: Date.parse('2026-07-23T00:00:04.000Z'),
    title: 'live',
    path: 'sustained-quality-backup',
  });
  let delaySourceBackup = false;
  const standardRoute = standardFetchRoute({
    originalMaster: qualityMaster,
    originalMedia: CLEAN_MEDIA,
    backupMedia(url, init) {
      if (!delaySourceBackup || !/h264-1080\.m3u8/.test(url)) return sustainedBackup;
      return new Promise((resolve, reject) => {
        let settled = false;
        const timer = setTimeout(() => {
          if (settled) return;
          settled = true;
          resolve(sustainedBackup);
        }, 1300);
        const signal = init && init.signal;
        const abort = () => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          const error = new Error('fixture delayed source-quality backup poll aborted');
          error.name = 'AbortError';
          reject(error);
        };
        if (signal) {
          if (signal.aborted) abort();
          else signal.addEventListener('abort', abort, { once: true });
        }
      });
    },
  });
  let sourcePolls = 0;
  let lowerPolls = 0;
  const runtime = createRuntime({
    initialState: { tokenTemplate: playbackTokenTemplate(CHANNEL) },
    fetchRoute(url, init, state) {
      const path = new URL(url).pathname;
      if (path === new URL(ORIGINAL_MEDIA_URL).pathname) {
        const index = sourcePolls++;
        const sourceBody = sequencedPlaylist({
          sequence: 99100 + index,
          startMs: Date.parse('2026-07-23T00:00:00.000Z') + index * 2000,
          title: 'live',
          path: 'sustained-source-native',
        }).replace(/https:\/\/video-edge-fixture\.ttvnw\.net\/sustained-source-native\//g, 'segments/');
        return hlsResponse(sourceBody);
      }
      if (path === new URL(lowerMediaUrl).pathname) {
        const index = lowerPolls++;
        return hlsResponse(sequencedPlaylist({
          sequence: 88100 + index,
          startMs: Date.parse('2026-07-23T00:00:00.000Z') + index * 2000,
          title: 'live',
          path: 'transient-lower-native',
        }));
      }
      if (path === new URL(detachedAdUrl).pathname) return hlsResponse(STITCHED_AD);
      return standardRoute(url, init, state);
    },
    gqlRoute(message) {
      return jsonResponse(nestedToken(message.body.variables.playerType));
    },
  });
  await mapMaster(runtime);
  const firstSource = await (await runtime.fetch(ORIGINAL_MEDIA_URL)).text();
  const secondSource = await (await runtime.fetch(ORIGINAL_MEDIA_URL)).text();
  assert(firstSource.includes('segments/99100.ts') && secondSource.includes('segments/99101.ts'),
    'source-quality fixture did not establish two advancing native polls');
  for (let turn = 0; turn < 10; turn++) await new Promise((resolve) => setImmediate(resolve));

  assert((await (await runtime.fetch(lowerMediaUrl)).text()).includes('/transient-lower-native/'),
    'transient lower-rendition probe did not stay native');
  for (let turn = 0; turn < 10; turn++) await new Promise((resolve) => setImmediate(resolve));
  delaySourceBackup = true;
  const beforeDetached = runtime.state.calls.length;
  const detachedStarted = performance.now();
  const body = await (await runtime.fetch(detachedAdUrl)).text();
  const detachedElapsed = performance.now() - detachedStarted;
  const detachedBackupCalls = runtime.state.calls.slice(beforeDetached)
    .filter((call) => /\/backup\/.+\.m3u8/.test(call.url));

  assert(detachedElapsed < 1150,
    'source-quality bridge escaped the total 900ms budget: ' + detachedElapsed.toFixed(1) + 'ms');
  assert(body.includes(new URL('segments/99101.ts', ORIGINAL_MEDIA_URL).href) &&
    !body.includes('/transient-lower-native/') && !body.includes('/commercial/'),
  'detached ad bridged the wrong rendition or resolved its relative media against the ad URL');
  assert(detachedBackupCalls.length > 0 && detachedBackupCalls.every((call) =>
    /h264-1080\.m3u8/.test(call.url)),
  'one transient 720p poll stole the 1080p backup target: ' +
    JSON.stringify(detachedBackupCalls.map((call) => call.url)));
});

test('one transient same-metadata fMP4 poll cannot steal sustained MPEG-TS ownership', async () => {
  const fmp4MediaUrl = 'https://video-edge-fixture.ttvnw.net/container-owner/fmp4.m3u8?token=fmp4';
  const detachedAdUrl = 'https://video-edge-fixture.ttvnw.net/container-owner/detached-ad.m3u8?token=ad';
  const containerMaster = `#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=8500000,CODECS="avc1.64002A,mp4a.40.2",RESOLUTION=1920x1080,VIDEO="chunked",FRAME-RATE=60.000
${ORIGINAL_MEDIA_URL}
#EXT-X-STREAM-INF:BANDWIDTH=8400000,CODECS="avc1.64002A,mp4a.40.2",RESOLUTION=1920x1080,VIDEO="chunked",FRAME-RATE=60.000
${fmp4MediaUrl}
`;
  const containerBackupMaster = (signature) => `#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=8500000,CODECS="avc1.64002A,mp4a.40.2",RESOLUTION=1920x1080,VIDEO="chunked",FRAME-RATE=60.000
https://video-edge-fixture.ttvnw.net/backup/${signature}/container-owner-source-ts.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=8400000,CODECS="avc1.64002A,mp4a.40.2",RESOLUTION=1920x1080,VIDEO="chunked",FRAME-RATE=60.000
https://video-edge-fixture.ttvnw.net/backup/${signature}/container-owner-transient-fmp4.m3u8
`;
  const sourceBackup = sequencedPlaylist({
    sequence: 99103,
    startMs: Date.parse('2026-07-23T00:00:06.000Z'),
    title: 'live',
    path: 'container-owner-source-backup',
  });
  const transientFmp4 = fmp4SequencedPlaylist({
    sequence: 99500,
    startMs: Date.parse('2026-07-23T00:10:00.000Z'),
    title: 'live',
    path: 'container-owner-transient-native',
  });
  const transientBackup = fmp4SequencedPlaylist({
    sequence: 99503,
    startMs: Date.parse('2026-07-23T00:10:06.000Z'),
    title: 'live',
    path: 'container-owner-transient-backup',
  });
  const opaqueAd = `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-TARGETDURATION:2
#EXT-X-MEDIA-SEQUENCE:99600
#EXT-X-DATERANGE:ID="stitched-ad-container-owner",CLASS="twitch-stitched-ad",DURATION=2.0
#EXTINF:2.000,advertisement
https://video-weaver-fixture.ttvnw.net/commercial/opaque-container
`;
  let sourcePolls = 0;
  let delaySourceBackup = false;
  const standardRoute = standardFetchRoute({
    originalMaster: containerMaster,
    originalMedia: CLEAN_MEDIA,
    backupMaster: containerBackupMaster,
    backupMedia(url, init) {
      if (/container-owner-transient-fmp4/.test(url)) return transientBackup;
      if (!/container-owner-source-ts/.test(url)) throw new Error('unexpected container backup: ' + url);
      if (!delaySourceBackup) return sourceBackup;
      return new Promise((resolve, reject) => {
        let settled = false;
        const timer = setTimeout(() => {
          if (settled) return;
          settled = true;
          resolve(sourceBackup);
        }, 1300);
        const signal = init && init.signal;
        const abort = () => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          const error = new Error('fixture delayed sustained-container backup poll aborted');
          error.name = 'AbortError';
          reject(error);
        };
        if (signal) {
          if (signal.aborted) abort();
          else signal.addEventListener('abort', abort, { once: true });
        }
      });
    },
  });
  const runtime = createRuntime({
    initialState: { tokenTemplate: playbackTokenTemplate(CHANNEL) },
    fetchRoute(url, init, state) {
      const path = new URL(url).pathname;
      if (path === new URL(ORIGINAL_MEDIA_URL).pathname) {
        const index = sourcePolls++;
        return hlsResponse(sequencedPlaylist({
          sequence: 99100 + index,
          startMs: Date.parse('2026-07-23T00:00:00.000Z') + index * 2000,
          title: 'live',
          path: 'container-owner-source-native',
        }));
      }
      if (path === new URL(fmp4MediaUrl).pathname) return hlsResponse(transientFmp4);
      if (path === new URL(detachedAdUrl).pathname) return hlsResponse(opaqueAd);
      return standardRoute(url, init, state);
    },
    gqlRoute(message) {
      return jsonResponse(nestedToken(message.body.variables.playerType));
    },
  });
  await mapMaster(runtime);
  await runtime.fetch(ORIGINAL_MEDIA_URL);
  await runtime.fetch(ORIGINAL_MEDIA_URL);
  for (let turn = 0; turn < 10; turn++) await new Promise((resolve) => setImmediate(resolve));
  await runtime.fetch(fmp4MediaUrl);
  for (let turn = 0; turn < 10; turn++) await new Promise((resolve) => setImmediate(resolve));
  delaySourceBackup = true;

  const body = await (await runtime.fetch(detachedAdUrl)).text();
  assert(body.includes('/container-owner-source-native/') && body.includes('.ts') &&
    !body.includes('#EXT-X-MAP') && !body.includes('/container-owner-transient-native/') &&
    !body.includes('/commercial/opaque-container'),
  'one transient fMP4 poll inherited MPEG-TS ownership counters or supplied its bridge');
});

test('concurrent same-metadata TS and fMP4 ads never share a backup flight', async () => {
  const tsMediaUrl = 'https://video-edge-fixture.ttvnw.net/container-flight/source.m3u8?format=ts&token=ts';
  const fmp4MediaUrl = 'https://video-edge-fixture.ttvnw.net/container-flight/source.m3u8?format=fmp4&token=fmp4';
  const sourceMaster = `#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=8500000,CODECS="avc1.64002A,mp4a.40.2",RESOLUTION=1920x1080,VIDEO="chunked",FRAME-RATE=60.000
${tsMediaUrl}
#EXT-X-STREAM-INF:BANDWIDTH=8400000,CODECS="avc1.64002A,mp4a.40.2",RESOLUTION=1920x1080,VIDEO="chunked",FRAME-RATE=60.000
${fmp4MediaUrl}
`;
  const replacementMaster = (signature) => `#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=8500000,CODECS="avc1.64002A,mp4a.40.2",RESOLUTION=1920x1080,VIDEO="chunked",FRAME-RATE=60.000
https://video-edge-fixture.ttvnw.net/backup/${signature}/container-flight-ts.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=8400000,CODECS="avc1.64002A,mp4a.40.2",RESOLUTION=1920x1080,VIDEO="chunked",FRAME-RATE=60.000
https://video-edge-fixture.ttvnw.net/backup/${signature}/container-flight-fmp4.m3u8
`;
  const tsClean = sequencedPlaylist({ sequence: 100, startMs: SEQUENCE_BASE_TIME,
    title: 'live', path: 'container-flight-ts-native' });
  const tsAd = sequencedPlaylist({ sequence: 101, startMs: SEQUENCE_BASE_TIME + 2000,
    marker: '#EXT-X-DATERANGE:ID="stitched-ad-container-flight-ts",CLASS="twitch-stitched-ad",DURATION=4.0',
    title: 'advertisement', path: 'commercial/container-flight-ts' });
  const tsBackup = sequencedPlaylist({ sequence: 101, startMs: SEQUENCE_BASE_TIME + 2000,
    title: 'live', path: 'container-flight-ts-backup' });
  const fmp4Clean = fmp4SequencedPlaylist({ sequence: 100, startMs: SEQUENCE_BASE_TIME,
    title: 'live', path: 'container-flight-fmp4-native' });
  const fmp4Ad = fmp4SequencedPlaylist({ sequence: 101, startMs: SEQUENCE_BASE_TIME + 2000,
    marker: '#EXT-X-DATERANGE:ID="stitched-ad-container-flight-fmp4",CLASS="twitch-stitched-ad",DURATION=4.0',
    title: 'advertisement', path: 'commercial/container-flight-fmp4' });
  const fmp4Backup = fmp4SequencedPlaylist({ sequence: 101, startMs: SEQUENCE_BASE_TIME + 2000,
    title: 'live', path: 'container-flight-fmp4-backup' });
  let ads = false;
  const runtime = createRuntime({
    fetchRoute(url, init) {
      const parsed = new URL(url);
      if (parsed.hostname === 'gql.twitch.tv') return jsonResponse([]);
      if (parsed.hostname === 'usher.ttvnw.net') {
        const signature = parsed.searchParams.get('sig');
        return hlsResponse(signature ? replacementMaster(signature) : sourceMaster);
      }
      if (parsed.pathname === new URL(tsMediaUrl).pathname && parsed.searchParams.get('format') === 'ts') {
        return hlsResponse(ads ? tsAd : tsClean);
      }
      if (parsed.pathname === new URL(fmp4MediaUrl).pathname && parsed.searchParams.get('format') === 'fmp4') {
        return hlsResponse(ads ? fmp4Ad : fmp4Clean);
      }
      if (/container-flight-ts\.m3u8$/.test(parsed.pathname)) {
        return new Promise((resolve) => setTimeout(() => resolve(hlsResponse(tsBackup)), 120));
      }
      if (/container-flight-fmp4\.m3u8$/.test(parsed.pathname)) {
        return new Promise((resolve) => setTimeout(() => resolve(hlsResponse(fmp4Backup)), 120));
      }
      throw new Error('unexpected container-flight request: ' + url);
    },
    gqlRoute(message) {
      return jsonResponse(nestedToken(message.body.variables.playerType));
    },
  });
  await runtime.fetch(MASTER_URL);
  await runtime.fetch(tsMediaUrl);
  await runtime.fetch(fmp4MediaUrl);
  runtime.updateClientState({ tokenTemplate: playbackTokenTemplate(CHANNEL) });
  ads = true;

  const responses = await Promise.all([runtime.fetch(tsMediaUrl), runtime.fetch(fmp4MediaUrl)]);
  const bodies = await Promise.all(responses.map((response) => response.text()));
  assert(bodies[0].includes('/container-flight-ts-backup/') && bodies[0].includes('.ts') &&
    !bodies[0].includes('#EXT-X-MAP') && !bodies[0].includes('/commercial/'),
  'MPEG-TS ad did not receive its own exact-container backup');
  assert(bodies[1].includes('/container-flight-fmp4-backup/') && bodies[1].includes('#EXT-X-MAP') &&
    bodies[1].includes('.m4s') && !bodies[1].includes('/commercial/'),
  'fMP4 ad shared the MPEG-TS flight or failed open on its native ad');
  const backupCalls = runtime.state.calls.filter((call) => /container-flight-(?:ts|fmp4)\.m3u8/.test(call.url));
  assert(backupCalls.some((call) => /container-flight-ts\.m3u8/.test(call.url)) &&
    backupCalls.some((call) => /container-flight-fmp4\.m3u8/.test(call.url)),
  'same-metadata containers were not acquired through independent backup flights');
});

test('the first clean lower rendition owns a detached backup before its second poll', async () => {
  const lowerMediaUrl = 'https://video-edge-fixture.ttvnw.net/lower-first/720p60.m3u8?token=lower';
  const detachedAdUrl = 'https://video-edge-fixture.ttvnw.net/lower-first/detached-ad.m3u8?token=ad';
  const lowerFirstMaster = `#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=8500000,CODECS="avc1.64002A,mp4a.40.2",RESOLUTION=1920x1080,VIDEO="chunked",FRAME-RATE=60.000
${ORIGINAL_MEDIA_URL}
#EXT-X-STREAM-INF:BANDWIDTH=4500000,CODECS="avc1.4D401F,mp4a.40.2",RESOLUTION=1280x720,VIDEO="720p60",FRAME-RATE=60.000
${lowerMediaUrl}
`;
  const lowerNative = sequencedPlaylist({
    sequence: 88100,
    startMs: Date.parse('2026-07-23T00:00:00.000Z'),
    title: 'live',
    path: 'lower-first-native',
  });
  const lowerBackup = sequencedPlaylist({
    sequence: 88102,
    startMs: Date.parse('2026-07-23T00:00:04.000Z'),
    title: 'live',
    path: 'lower-first-backup',
  });
  const standardRoute = standardFetchRoute({
    originalMaster: lowerFirstMaster,
    originalMedia: CLEAN_MEDIA,
    backupMedia: lowerBackup,
  });
  const runtime = createRuntime({
    initialState: { tokenTemplate: playbackTokenTemplate(CHANNEL) },
    fetchRoute(url, init, state) {
      const path = new URL(url).pathname;
      if (path === new URL(lowerMediaUrl).pathname) return hlsResponse(lowerNative);
      if (path === new URL(detachedAdUrl).pathname) return hlsResponse(STITCHED_AD);
      return standardRoute(url, init, state);
    },
    gqlRoute(message) {
      return jsonResponse(nestedToken(message.body.variables.playerType));
    },
  });
  await mapMaster(runtime);
  assert((await (await runtime.fetch(lowerMediaUrl)).text()).includes('/lower-first-native/'),
    'lower-first fixture did not establish its one real clean poll');
  for (let turn = 0; turn < 10; turn++) await new Promise((resolve) => setImmediate(resolve));
  const beforeDetached = runtime.state.calls.length;
  const body = await (await runtime.fetch(detachedAdUrl)).text();
  const backupCalls = runtime.state.calls.slice(beforeDetached)
    .filter((call) => /\/backup\/.+\.m3u8/.test(call.url));

  assert(body.includes('/lower-first-backup/') && !body.includes('/commercial/'),
    'detached ad did not preserve the first real lower rendition');
  assert(backupCalls.length > 0 && backupCalls.every((call) => /h264-720\.m3u8/.test(call.url)),
    'detached ad guessed source quality before a second lower poll: ' +
      JSON.stringify(backupCalls.map((call) => call.url)));
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

test('blocked-clean state is reannounced when the active channel changes without a clear', async () => {
  const firstChannel = 'statefirst';
  const secondChannel = 'statesecond';
  const firstMasterUrl = 'https://usher.ttvnw.net/api/v2/channel/hls/' + firstChannel + '.m3u8?p=first';
  const secondMasterUrl = 'https://usher.ttvnw.net/api/v2/channel/hls/' + secondChannel + '.m3u8?p=second';
  const firstMediaUrl = 'https://video-edge-fixture.ttvnw.net/state-first/chunked/index.m3u8?token=first';
  const secondMediaUrl = 'https://video-edge-fixture.ttvnw.net/state-second/chunked/index.m3u8?token=second';
  const channelMaster = (mediaUrl) => `#EXTM3U
#EXT-X-MEDIA:TYPE=VIDEO,GROUP-ID="chunked",NAME="1080p60 (source)",AUTOSELECT=YES,DEFAULT=YES
#EXT-X-STREAM-INF:BANDWIDTH=8500000,CODECS="avc1.64002A,mp4a.40.2",RESOLUTION=1920x1080,VIDEO="chunked",FRAME-RATE=60.000
${mediaUrl}
`;
  const adPaths = new Set([
    new URL(firstMediaUrl).pathname,
    new URL(secondMediaUrl).pathname,
  ]);
  const standardRoute = standardFetchRoute({ backupMedia: CLEAN_MEDIA });
  const runtime = createRuntime({
    initialState: { tokenTemplate: playbackTokenTemplate(firstChannel) },
    fetchRoute(url, init, state) {
      if (adPaths.has(new URL(url).pathname)) return hlsResponse(STITCHED_AD);
      return standardRoute(url, init, state);
    },
    gqlRoute(message) {
      return jsonResponse(nestedToken(message.body.variables.playerType));
    },
  });

  runtime.sendMaster(firstMasterUrl, channelMaster(firstMediaUrl), firstChannel, true);
  const firstBody = await (await runtime.fetch(firstMediaUrl)).text();
  runtime.sendMaster(secondMasterUrl, channelMaster(secondMediaUrl), secondChannel, true);
  const secondBody = await (await runtime.fetch(secondMediaUrl)).text();
  assert(firstBody === CLEAN_MEDIA && secondBody === CLEAN_MEDIA,
    'channel-state fixture did not clean both consecutive ad playlists');
  const blockedStates = runtime.state.messages.filter((message) =>
    message && message.type === 'ad-state' && message.state === 'blocked-clean');
  assert(blockedStates.some((message) => message.channel === firstChannel) &&
    blockedStates.some((message) => message.channel === secondChannel),
  'same blocking state was deduplicated across two active channels');
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

test('ad-imminent failure preserves native LL-HLS byte-for-byte when every clean route misses', async () => {
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
  assert(first === imminentLl, 'warning-only fallback changed the native LL-HLS manifest');
  assert(!first.includes('#EXT-X-GAP') && !first.includes('data:video/mp4'),
    'warning-only fallback starved or poisoned the decoder');

  await runtime.fetch(blockingUrl);
  const nativeCalls = runtime.state.calls.filter((call) =>
    new URL(call.url).pathname === new URL(ORIGINAL_MEDIA_URL).pathname);
  assert(nativeCalls.length === 2, 'imminent fallback issued unexpected native media requests');
  const secondUrl = new URL(nativeCalls[1].url);
  assert(secondUrl.searchParams.get('_HLS_msn') === '901' &&
    secondUrl.searchParams.get('_HLS_part') === '1' && secondUrl.searchParams.get('_HLS_skip') === 'YES',
  'warning-only fallback changed the native blocking cursors');
  assert(!runtime.state.messages.some((message) => message && message.state === 'blocked-imminent'),
    'warning-only fallback reintroduced blocked-imminent manifest rewriting');
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
  assert(runtime.state.gqlRequests.length === 1,
    'concurrent ads multiplied token flights: ' + runtime.state.gqlRequests.length);
  const backupMasters = runtime.state.calls.filter((call) => {
    const url = new URL(call.url);
    return url.hostname === 'usher.ttvnw.net' && url.searchParams.has('sig');
  });
  assert(backupMasters.length === 1,
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
      assertNativeFailOpen(runtime, body, STITCHED_AD, 'failed single-flight caller');
      return true;
    } catch (_) {
      return false;
    }
  }), 'failed single-flight callers did not all receive native pass-through media');
  assert(runtime.state.gqlRequests.length === 6,
    'failed concurrent flight was not bounded to three identities with one full-query retry each');

  const beforeRetry = runtime.state.gqlRequests.length;
  const retryBody = await (await runtime.fetch(ORIGINAL_MEDIA_URL)).text();
  assert(runtime.state.gqlRequests.length === beforeRetry,
    'negative-cache retry launched another token flight inside its TTL');
  assert(typeof retryBody === 'string' && retryBody.length > 0,
    'failed-cache sentinel became an empty successful playlist');
  assertNativeFailOpen(runtime, retryBody, STITCHED_AD, 'negative-cache retry inside TTL');

  runtime.advance(30001);
  const expiredBody = await (await runtime.fetch(ORIGINAL_MEDIA_URL)).text();
  assert(runtime.state.gqlRequests.length === beforeRetry + 6,
    'expired negative sentinel was not deleted and retried exactly once');
  assertNativeFailOpen(runtime, expiredBody, STITCHED_AD, 'negative-cache retry after TTL');
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

// Native fail-open does not synthesize a playlist: the player keeps its exact
// LL-HLS contract so playback continues even when no clean session exists.
test('native fail-open preserves low-latency signalling and media byte-for-byte', async () => {
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
  assertNativeFailOpen(runtime, body, LOW_LATENCY_MIXED_AD, 'low-latency native fail-open');
});

test('native fail-open preserves blocking LL-HLS cursors and signed query state', async () => {
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
  assert(forwarded.searchParams.get('_HLS_msn') === '812' &&
    forwarded.searchParams.get('_HLS_part') === '3' && forwarded.searchParams.get('_HLS_skip') === 'YES',
  'native fail-open changed the blocking LL-HLS cursor');
  assertNativeFailOpen(runtime, body, LOW_LATENCY_MIXED_AD,
    'cursor-preserving low-latency fail-open');
});

const SEQUENCE_BASE_TIME = Date.parse('2026-07-23T00:01:00.000Z');

function sequencedPlaylist(options) {
  const lines = ['#EXTM3U', '#EXT-X-VERSION:3', '#EXT-X-TARGETDURATION:2',
    '#EXT-X-MEDIA-SEQUENCE:' + options.sequence];
  if (options.marker) lines.push(options.marker);
  for (let index = 0; index < 3; index++) {
    lines.push('#EXT-X-PROGRAM-DATE-TIME:' + new Date(options.startMs + index * 2000).toISOString());
    lines.push('#EXTINF:2.000,' + (options.title || 'live'));
    lines.push('https://video-edge-fixture.ttvnw.net/' + (options.path || 'sequence') + '/' +
      (options.sequence + index) + '.ts');
  }
  return lines.concat('').join('\n');
}

function fmp4SequencedPlaylist(options) {
  const lines = ['#EXTM3U', '#EXT-X-VERSION:7', '#EXT-X-TARGETDURATION:2',
    '#EXT-X-MEDIA-SEQUENCE:' + options.sequence,
    '#EXT-X-MAP:URI="https://video-edge-fixture.ttvnw.net/' + (options.path || 'fmp4-sequence') +
      '/init.mp4"'];
  if (options.marker) lines.push(options.marker);
  for (let index = 0; index < 3; index++) {
    lines.push('#EXT-X-PROGRAM-DATE-TIME:' + new Date(options.startMs + index * 2000).toISOString());
    lines.push('#EXTINF:2.000,' + (options.title || 'live'));
    lines.push('https://video-edge-fixture.ttvnw.net/' + (options.path || 'fmp4-sequence') + '/' +
      (options.sequence + index) + '.m4s');
  }
  return lines.concat('').join('\n');
}

function servedSequence(text) {
  return Number((/#EXT-X-MEDIA-SEQUENCE:(\d+)/.exec(text) || [])[1]);
}

test('MEDIA-SEQUENCE stays continuous across a drifted exit and a second ad break', async () => {
  let nativePolls = 0;
  const runtime = createRuntime({
    fetchRoute: standardFetchRoute({
      originalMedia() {
        const index = nativePolls++;
        const inAd = index === 1 || index === 2 || index === 6;
        const nativeSequence = index < 3 ? 100 + index : 110 + index;
        return sequencedPlaylist({
          sequence: nativeSequence,
          startMs: SEQUENCE_BASE_TIME + index * 2000,
          marker: inAd
            ? '#EXT-X-DATERANGE:ID="stitched-ad-sequence-' + index +
              '",CLASS="twitch-stitched-ad",DURATION=4.0'
            : '',
          title: inAd ? 'advertisement' : 'live',
          path: inAd ? 'native-ad' : 'native-live',
        });
      },
      backupMedia() {
        const index = Math.max(1, nativePolls - 1);
        return sequencedPlaylist({
          sequence: 4999 + index,
          startMs: SEQUENCE_BASE_TIME + index * 2000,
          title: 'live',
          path: 'clean-backup',
        });
      },
    }),
    gqlRoute(message) {
      return jsonResponse(nestedToken(message.body.variables.playerType));
    },
  });
  await mapMaster(runtime);
  const bodies = [];
  bodies.push(await (await runtime.fetch(ORIGINAL_MEDIA_URL)).text());
  runtime.updateClientState({ tokenTemplate: playbackTokenTemplate(CHANNEL) });
  for (let poll = 1; poll <= 6; poll++) {
    bodies.push(await (await runtime.fetch(ORIGINAL_MEDIA_URL)).text());
  }

  equal(bodies.map(servedSequence), [100, 101, 102, 103, 104, 105, 106],
    'session-relative native numbering leaked across clean-session swaps');
  assert(bodies[1].includes('/clean-backup/') && bodies[2].includes('/clean-backup/'),
    'first ad break did not use the clean alternate session');
  assert(bodies[5].includes('/native-live/'), 'exit did not return to native live media');
  assert(bodies[6].includes('/clean-backup/'), 'second ad break did not reuse the clean alternate session');
  const states = runtime.state.messages.filter((message) => message && message.type === 'ad-state');
  equal(states.map((message) => message.state), ['clear', 'blocked-clean', 'clear', 'blocked-clean'],
    'sequence fixture did not enter, exit, and re-enter one clean swap at a time');
  assert(states.every((message) => !Object.prototype.hasOwnProperty.call(message, 'offsetMs')),
    'worker retained the removed page-seek latency signal');
});

test('missing PDT refuses an unsafe mid-stream swap and keeps native media intact', async () => {
  let nativePolls = 0;
  const runtime = createRuntime({
    fetchRoute: standardFetchRoute({
      originalMedia() { return nativePolls++ === 0 ? CLEAN_MEDIA : STITCHED_AD; },
      backupMedia: CLEAN_MEDIA,
    }),
    gqlRoute(message) {
      return jsonResponse(nestedToken(message.body.variables.playerType));
    },
  });
  await mapMaster(runtime);
  await runtime.fetch(ORIGINAL_MEDIA_URL);
  runtime.updateClientState({ tokenTemplate: playbackTokenTemplate(CHANNEL) });
  const body = await (await runtime.fetch(ORIGINAL_MEDIA_URL)).text();
  const normalizeSequence = (text) => String(text).replace(/#EXT-X-MEDIA-SEQUENCE:\d+/, '#EXT-X-MEDIA-SEQUENCE:N');
  assert(normalizeSequence(body) === normalizeSequence(STITCHED_AD),
    'undated mid-stream swap changed native media beyond monotonic sequence numbering');
  assert(!body.includes('#EXT-X-GAP') && !body.includes('data:video/mp4'),
    'undated mid-stream swap refusal starved or poisoned the decoder');
  assert(!runtime.state.messages.some((message) => message && /^blocked-/.test(String(message.state || ''))),
    'undated mid-stream swap claimed a clean intervention it could not align');
});

test('an identical current-master replay preserves its generation while a changed master starts a new one', async () => {
  let nativePoll = 0;
  let backupPoll = 0;
  const changedMaster = ORIGINAL_MASTER.replace('BANDWIDTH=8500000', 'BANDWIDTH=8500001');
  const runtime = createRuntime({
    fetchRoute: standardFetchRoute({
      originalMedia() {
        const index = nativePoll++;
        return sequencedPlaylist({
          sequence: 100 + index,
          startMs: SEQUENCE_BASE_TIME + index * 2000,
          marker: index === 0 ? '' :
            '#EXT-X-DATERANGE:ID="stitched-ad-generation-' + index +
              '",CLASS="twitch-stitched-ad",DURATION=4.0',
          title: index === 0 ? 'live' : 'advertisement',
          path: index === 0 ? 'generation-native-live' : 'generation-native-ad',
        });
      },
      backupMedia() {
        const index = backupPoll++;
        return sequencedPlaylist({
          sequence: 9000 + index,
          startMs: SEQUENCE_BASE_TIME + (index + 1) * 2000,
          title: 'live',
          path: 'generation-clean-backup',
        });
      },
    }),
    gqlRoute(message) {
      return jsonResponse(nestedToken(message.body.variables.playerType));
    },
  });
  await mapMaster(runtime);
  const native = await (await runtime.fetch(ORIGINAL_MEDIA_URL)).text();
  assert(servedSequence(native) === 100, 'generation fixture did not establish its native sequence');

  runtime.sendMaster(MASTER_URL, ORIGINAL_MASTER, CHANNEL, true);
  runtime.updateClientState({ tokenTemplate: playbackTokenTemplate(CHANNEL) });
  const afterReplay = await (await runtime.fetch(ORIGINAL_MEDIA_URL)).text();
  assert(afterReplay.includes('/generation-clean-backup/'),
    'identical-master fixture did not acquire its clean alternate session');
  assert(servedSequence(afterReplay) === 101,
    'replaying the identical current master reset sequence/session state');

  runtime.sendMaster(MASTER_URL, changedMaster, CHANNEL, true);
  const afterChange = await (await runtime.fetch(ORIGINAL_MEDIA_URL)).text();
  assert(afterChange.includes('/generation-clean-backup/'),
    'changed-master fixture lost its clean alternate session');
  assert(servedSequence(afterChange) >= 9000,
    'a genuinely changed current master reused the previous generation sequence state');
});

test('backup acquisition refuses ENDLIST and playlists without a usable sequence/PDT anchor', async () => {
  const valid = sequencedPlaylist({
    sequence: 7000,
    startMs: SEQUENCE_BASE_TIME,
    title: 'live',
    path: 'invalid-backup',
  });
  const scenarios = [
    { label: 'ENDLIST', body: valid + '#EXT-X-ENDLIST\n' },
    { label: 'missing MEDIA-SEQUENCE', body: valid.replace(/^#EXT-X-MEDIA-SEQUENCE:.*\n/im, '') },
    { label: 'missing PROGRAM-DATE-TIME', body: valid.replace(/^#EXT-X-PROGRAM-DATE-TIME:.*\n/gim, '') },
  ];
  for (const scenario of scenarios) {
    const nativeAd = sequencedPlaylist({
      sequence: 300,
      startMs: SEQUENCE_BASE_TIME,
      marker: '#EXT-X-DATERANGE:ID="stitched-ad-invalid-backup",CLASS="twitch-stitched-ad",DURATION=4.0',
      title: 'advertisement',
      path: 'native-invalid-backup',
    });
    const runtime = createRuntime({
      fetchRoute: standardFetchRoute({ originalMedia: nativeAd, backupMedia: scenario.body }),
      gqlRoute(message) {
        return jsonResponse(nestedToken(message.body.variables.playerType));
      },
    });
    await mapMaster(runtime);
    runtime.updateClientState({ tokenTemplate: playbackTokenTemplate(CHANNEL) });
    const body = await (await runtime.fetch(ORIGINAL_MEDIA_URL)).text();
    assert(body.includes('/native-invalid-backup/'),
      scenario.label + ' backup replaced the native stream');
    assert(!body.includes('/invalid-backup/'),
      scenario.label + ' backup reached the player despite lacking a live alignment anchor');
    assert(!runtime.state.messages.some((message) => message && message.state === 'blocked-clean'),
      scenario.label + ' backup announced a clean intervention');
  }
});

test('cached backups have an immutable two-minute acquisition lifetime', async () => {
  let nativePoll = 0;
  let backupPoll = 0;
  const runtime = createRuntime({
    fakeClock: true,
    now: 1000000,
    fetchRoute: standardFetchRoute({
      originalMedia() {
        const index = nativePoll++;
        return sequencedPlaylist({
          sequence: 400 + index,
          startMs: SEQUENCE_BASE_TIME + index * 2000,
          marker: '#EXT-X-DATERANGE:ID="stitched-ad-cache-life-' + index +
            '",CLASS="twitch-stitched-ad",DURATION=4.0',
          title: 'advertisement',
          path: 'cache-life-native-ad',
        });
      },
      backupMedia() {
        const index = backupPoll++;
        return sequencedPlaylist({
          sequence: 9400 + index,
          startMs: SEQUENCE_BASE_TIME + index * 2000,
          title: 'live',
          path: 'cache-life-clean-backup',
        });
      },
    }),
    gqlRoute(message) {
      return jsonResponse(nestedToken(message.body.variables.playerType));
    },
  });
  await mapMaster(runtime);
  runtime.updateClientState({ tokenTemplate: playbackTokenTemplate(CHANNEL) });
  await runtime.fetch(ORIGINAL_MEDIA_URL);
  const initialTokenRequests = runtime.state.gqlRequests.length;
  assert(initialTokenRequests > 0, 'cache-lifetime fixture never acquired its first backup');

  runtime.advance(60000);
  await runtime.fetch(ORIGINAL_MEDIA_URL);
  runtime.advance(59000);
  await runtime.fetch(ORIGINAL_MEDIA_URL);
  runtime.advance(2000);
  const refreshed = await (await runtime.fetch(ORIGINAL_MEDIA_URL)).text();
  assert(refreshed.includes('/cache-life-clean-backup/'),
    'expired cache could not be replaced by a fresh clean session');
  assert(runtime.state.gqlRequests.length > initialTokenRequests,
    'successful cache polls refreshed the original acquisition timestamp indefinitely');
});

test('cached backup polls reject backward and long-stale live windows', async () => {
  const scenarios = [
    { label: 'backward', sequence: 9899, startMs: SEQUENCE_BASE_TIME - 2000, advanceMs: 1000 },
    { label: 'long-stale', sequence: 9900, startMs: SEQUENCE_BASE_TIME, advanceMs: 30000 },
  ];
  for (const scenario of scenarios) {
    let nativePoll = 0;
    let backupPoll = 0;
    let tokensAllowed = true;
    const runtime = createRuntime({
      fakeClock: true,
      now: 2000000,
      fetchRoute: standardFetchRoute({
        originalMedia() {
          const index = nativePoll++;
          return sequencedPlaylist({
            sequence: 500 + index,
            startMs: SEQUENCE_BASE_TIME + index * 2000,
            marker: '#EXT-X-DATERANGE:ID="stitched-ad-cache-' + scenario.label + '-' + index +
              '",CLASS="twitch-stitched-ad",DURATION=4.0',
            title: 'advertisement',
            path: 'cache-' + scenario.label + '-native-ad',
          });
        },
        backupMedia() {
          const first = backupPoll++ === 0;
          return sequencedPlaylist({
            sequence: first ? 9900 : scenario.sequence,
            startMs: first ? SEQUENCE_BASE_TIME : scenario.startMs,
            title: 'live',
            path: 'cache-' + scenario.label + '-clean-backup',
          });
        },
      }),
      gqlRoute(message) {
        if (tokensAllowed) return jsonResponse(nestedToken(message.body.variables.playerType));
        return jsonResponse({ data: { streamPlaybackAccessToken: null } });
      },
    });
    await mapMaster(runtime);
    runtime.updateClientState({ tokenTemplate: playbackTokenTemplate(CHANNEL) });
    const first = await (await runtime.fetch(ORIGINAL_MEDIA_URL)).text();
    assert(first.includes('/cache-' + scenario.label + '-clean-backup/'),
      scenario.label + ' fixture did not establish its cached backup');
    tokensAllowed = false;
    runtime.advance(scenario.advanceMs);
    const second = await (await runtime.fetch(ORIGINAL_MEDIA_URL)).text();
    assert(second.includes('/cache-' + scenario.label + '-native-ad/'),
      scenario.label + ' cached playlist was replayed instead of being rejected');
    const states = runtime.state.messages.filter((message) => message && message.type === 'ad-state');
    assert(states.length && states[states.length - 1].state === 'clear',
      scenario.label + ' cached playlist left a clean intervention active');
  }
});

test('a reacquired backup cannot replay the same frozen media window forever', async () => {
  let nativePoll = 0;
  let backupPoll = 0;
  let backupSequence = 9900;
  let backupStart = SEQUENCE_BASE_TIME;
  const runtime = createRuntime({
    fakeClock: true,
    now: 3000000,
    fetchRoute: standardFetchRoute({
      originalMedia() {
        const index = nativePoll++;
        return sequencedPlaylist({
          sequence: 700 + index,
          startMs: SEQUENCE_BASE_TIME + index * 2000,
          marker: '#EXT-X-DATERANGE:ID="stitched-ad-frozen-reacquire-' + index +
            '",CLASS="twitch-stitched-ad",DURATION=30.0',
          title: 'advertisement',
          path: 'frozen-reacquire-native-ad',
        });
      },
      backupMedia() {
        backupPoll++;
        return sequencedPlaylist({
          sequence: backupSequence,
          startMs: backupStart,
          title: 'live',
          path: 'frozen-reacquire-clean-backup',
        });
      },
    }),
    gqlRoute(message) {
      return jsonResponse(nestedToken(message.body.variables.playerType));
    },
  });
  await mapMaster(runtime);
  runtime.updateClientState({ tokenTemplate: playbackTokenTemplate(CHANNEL) });

  const first = await (await runtime.fetch(ORIGINAL_MEDIA_URL)).text();
  assert(first.includes('/frozen-reacquire-clean-backup/'),
    'frozen-window fixture did not establish its first clean replacement');

  runtime.advance(9000);
  const stale = await (await runtime.fetch(ORIGINAL_MEDIA_URL)).text();
  assert(backupPoll >= 3,
    'fixture did not poll then reacquire the stale route: ' + backupPoll);
  assert(stale.includes('/frozen-reacquire-native-ad/') &&
    !stale.includes('/frozen-reacquire-clean-backup/'),
  'a freshly reacquired route replayed the already-consumed media window');
  const statesAfterStale = runtime.state.messages.filter((message) =>
    message && message.type === 'ad-state');
  assert(statesAfterStale.length && statesAfterStale[statesAfterStale.length - 1].state === 'clear',
    'frozen replacement did not release the clean intervention before native fail-open');

  backupSequence++;
  backupStart += 2000;
  runtime.advance(1000);
  const recovered = await (await runtime.fetch(ORIGINAL_MEDIA_URL)).text();
  assert(recovered.includes('/frozen-reacquire-clean-backup/') &&
    !recovered.includes('/frozen-reacquire-native-ad/'),
  'the exact clean route was not reusable after its media window advanced');
});

test('an out-of-order native response is not renumbered upward or allowed to rewrite sequence state', async () => {
  let nativeCall = 0;
  let releaseOlder;
  const older = sequencedPlaylist({
    sequence: 600,
    startMs: SEQUENCE_BASE_TIME,
    title: 'live',
    path: 'out-of-order-older',
  });
  const newer = sequencedPlaylist({
    sequence: 601,
    startMs: SEQUENCE_BASE_TIME + 2000,
    title: 'live',
    path: 'out-of-order-newer',
  });
  const newest = sequencedPlaylist({
    sequence: 602,
    startMs: SEQUENCE_BASE_TIME + 4000,
    title: 'live',
    path: 'out-of-order-newest',
  });
  const runtime = createRuntime({
    fetchRoute: standardFetchRoute({
      originalMedia() {
        const index = nativeCall++;
        if (index === 0) return new Promise((resolve) => { releaseOlder = resolve; });
        if (index === 1) return newer;
        return newest;
      },
    }),
  });
  await mapMaster(runtime);
  const olderPending = runtime.fetch(ORIGINAL_MEDIA_URL);
  const newerBody = await (await runtime.fetch(ORIGINAL_MEDIA_URL)).text();
  assert(newerBody === newer, 'newer native response was unexpectedly transformed');
  assert(typeof releaseOlder === 'function', 'older native response was not held in flight');
  releaseOlder(older);
  const olderBody = await (await olderPending).text();
  assert(olderBody === older,
    'late older native response was renumbered upward and given newer content identity');
  const newestBody = await (await runtime.fetch(ORIGINAL_MEDIA_URL)).text();
  assert(newestBody === newest,
    'late older response rewrote sequence state used by the following native poll');
});

test('a later clean identity can win the bounded mid-roll budget while the first identity is pending', async () => {
  let nativePoll = 0;
  let releaseMobile;
  const mobileGate = new Promise((resolve) => { releaseMobile = resolve; });
  const runtime = createRuntime({
    fetchRoute: standardFetchRoute({
      originalMedia() {
        const index = nativePoll++;
        return sequencedPlaylist({
          sequence: 700 + index,
          startMs: SEQUENCE_BASE_TIME + index * 2000,
          marker: index === 0 ? '' :
            '#EXT-X-DATERANGE:ID="stitched-ad-identity-race",CLASS="twitch-stitched-ad",DURATION=4.0',
          title: index === 0 ? 'live' : 'advertisement',
          path: index === 0 ? 'identity-race-native-live' : 'identity-race-native-ad',
        });
      },
      backupMedia: sequencedPlaylist({
        sequence: 9700,
        startMs: SEQUENCE_BASE_TIME + 2000,
        title: 'live',
        path: 'identity-race-clean-backup',
      }),
    }),
    gqlRoute(message) {
      const playerType = message.body.variables.playerType;
      if (playerType === 'mobile_feed') return mobileGate;
      return jsonResponse(nestedToken(playerType));
    },
  });
  await mapMaster(runtime);
  await runtime.fetch(ORIGINAL_MEDIA_URL);
  runtime.updateClientState({ tokenTemplate: playbackTokenTemplate(CHANNEL) });
  const body = await (await runtime.fetch(ORIGINAL_MEDIA_URL)).text();
  const requestedTypes = runtime.state.gqlRequests.map((request) => request.body.variables.playerType);
  releaseMobile(jsonResponse(nestedToken('mobile_feed')));
  await Promise.resolve();
  await Promise.resolve();
  assert(requestedTypes.includes('popout'),
    'the later popout identity did not start while mobile_feed was pending');
  assert(body.includes('/identity-race-clean-backup/'),
    'the later clean identity missed the bounded mid-roll serving budget');
});

test('config-off during an in-flight backup returns the exact native response without post-disable state', async () => {
  let resolveToken;
  const tokenGate = new Promise((resolve) => { resolveToken = resolve; });
  const nativeResponse = hlsResponse(sequencedPlaylist({
    sequence: 800,
    startMs: SEQUENCE_BASE_TIME,
    marker: '#EXT-X-DATERANGE:ID="stitched-ad-config-off",CLASS="twitch-stitched-ad",DURATION=4.0',
    title: 'advertisement',
    path: 'config-off-native-ad',
  }));
  const runtime = createRuntime({
    fetchRoute(url) {
      const parsed = new URL(url);
      if (parsed.hostname === 'usher.ttvnw.net') {
        if (!parsed.searchParams.has('sig')) return hlsResponse(ORIGINAL_MASTER);
        return hlsResponse(backupMaster(parsed.searchParams.get('sig')));
      }
      if (parsed.pathname === new URL(ORIGINAL_MEDIA_URL).pathname) return nativeResponse;
      if (parsed.pathname.includes('/backup/')) return hlsResponse(CLEAN_MEDIA);
      throw new Error('unexpected config-off fixture request: ' + url);
    },
    gqlRoute() { return tokenGate; },
  });
  await mapMaster(runtime);
  runtime.updateClientState({ tokenTemplate: playbackTokenTemplate(CHANNEL) });
  const pending = runtime.fetch(ORIGINAL_MEDIA_URL);
  for (let spin = 0; spin < 50 && runtime.state.gqlRequests.length < 1; spin++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  assert(runtime.state.gqlRequests.length === 1, 'config-off fixture never entered its backup request');
  runtime.configure(false);
  const messagesAtDisable = runtime.state.messages.length;
  resolveToken(jsonResponse(nestedToken('mobile_feed')));
  const returned = await pending;
  assert(returned === nativeResponse,
    'config-off replaced the native Response object after disabling the intervention');
  assert(!runtime.state.messages.slice(messagesAtDisable)
    .some((message) => message && message.type === 'ad-state'),
  'config-off allowed the in-flight backup to publish post-disable ad state');
});

test('a failed cursorless native poll retries the exact LL-HLS request once and clears intervention', async () => {
  let phase = 'setup';
  const retryResponse = hlsResponse(sequencedPlaylist({
    sequence: 901,
    startMs: SEQUENCE_BASE_TIME + 2000,
    title: 'live',
    path: 'll-retry-native',
  }));
  const verifyResponse = hlsResponse(sequencedPlaylist({
    sequence: 902,
    startMs: SEQUENCE_BASE_TIME + 4000,
    title: 'live',
    path: 'll-retry-verify',
  }));
  const runtime = createRuntime({
    fetchRoute(url) {
      const parsed = new URL(url);
      if (parsed.hostname === 'usher.ttvnw.net') {
        if (!parsed.searchParams.has('sig')) return hlsResponse(ORIGINAL_MASTER);
        return hlsResponse(backupMaster(parsed.searchParams.get('sig')));
      }
      if (parsed.pathname.includes('/backup/')) {
        return hlsResponse(sequencedPlaylist({
          sequence: 9900,
          startMs: SEQUENCE_BASE_TIME,
          title: 'live',
          path: 'll-retry-clean-backup',
        }));
      }
      if (parsed.pathname === new URL(ORIGINAL_MEDIA_URL).pathname) {
        if (phase === 'setup') {
          return hlsResponse(sequencedPlaylist({
            sequence: 900,
            startMs: SEQUENCE_BASE_TIME,
            marker: '#EXT-X-DATERANGE:ID="stitched-ad-ll-retry",CLASS="twitch-stitched-ad",DURATION=4.0',
            title: 'advertisement',
            path: 'll-retry-native-ad',
          }));
        }
        if (!parsed.searchParams.has('_HLS_msn')) throw new Error('cursorless native request failed');
        return phase === 'retry' ? retryResponse : verifyResponse;
      }
      throw new Error('unexpected LL-HLS retry fixture request: ' + url);
    },
    gqlRoute(message) {
      return jsonResponse(nestedToken(message.body.variables.playerType));
    },
  });
  await mapMaster(runtime);
  runtime.updateClientState({ tokenTemplate: playbackTokenTemplate(CHANNEL) });
  const setup = await (await runtime.fetch(ORIGINAL_MEDIA_URL)).text();
  assert(setup.includes('/ll-retry-clean-backup/'),
    'LL-HLS retry fixture did not establish an active clean intervention');

  phase = 'retry';
  const llUrl = ORIGINAL_MEDIA_URL + '&_HLS_msn=901&_HLS_part=2&_HLS_skip=YES';
  const originalRequest = new Request(llUrl, { headers: { 'x-fixture-request': 'exact' } });
  const originalInit = { cache: 'no-store' };
  const retryStart = runtime.state.calls.length;
  const returned = await runtime.fetch(originalRequest, originalInit);
  const retryCalls = runtime.state.calls.slice(retryStart)
    .filter((call) => new URL(call.url).pathname === new URL(ORIGINAL_MEDIA_URL).pathname);
  assert(returned === retryResponse,
    'failed cursorless poll did not return the exact native retry Response');
  assert(retryCalls.length === 2,
    'failed cursorless poll did not perform exactly one native retry: ' + retryCalls.length);
  assert(!new URL(retryCalls[0].url).searchParams.has('_HLS_msn'),
    'intervention did not begin with its cursorless native poll');
  assert(retryCalls[1].url === originalRequest.url && retryCalls[1].input === originalRequest &&
    retryCalls[1].init === originalInit,
  'native retry did not preserve the exact original Request and init');

  phase = 'verify';
  const verifyRequest = new Request(llUrl.replace('_HLS_msn=901', '_HLS_msn=902'));
  const verifyStart = runtime.state.calls.length;
  await runtime.fetch(verifyRequest);
  const verifyCalls = runtime.state.calls.slice(verifyStart)
    .filter((call) => new URL(call.url).pathname === new URL(ORIGINAL_MEDIA_URL).pathname);
  assert(verifyCalls.length === 1 && verifyCalls[0].url === verifyRequest.url,
    'failed modified request left cursor stripping active on the next native poll');
  const states = runtime.state.messages.filter((message) => message && message.type === 'ad-state');
  assert(states.length && states.some((message) => message.state === 'clear'),
    'failed modified request did not clear the visible intervention state');
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
