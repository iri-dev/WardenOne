/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
// Runs the REAL yt-adblock.js in a mocked browser context and asserts the
// prune logic removes ad fields while preserving playback data.
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const src = fs.readFileSync(path.join(__dirname, "..", "yt-adblock.js"), "utf8");

let pass = 0, fail = 0;
function ok(name, cond) {
  if (cond) { pass++; console.log("  PASS " + name); }
  else { fail++; console.log("  FAIL " + name); }
}

// Minimal Response stub good enough for the fetch path.
class FakeResponse {
  constructor(body, opts) { this._t = body; this.status = (opts && opts.status) || 200; this.statusText = (opts && opts.statusText) || ""; this.headers = (opts && opts.headers) || {}; }
  clone() { return this; }
  text() { return Promise.resolve(this._t); }
}

// Minimal XHR stub: open() records the url, send() records the (possibly
// shaped) body the script passes through to the real send.
class FakeXHR {
  open(method, url) { this._method = method; this._url = url; }
  send(body) { this._sentBody = body; }
}

class FakeRequest {
  constructor(input, init) {
    this.url = typeof input === "string" ? input : (input && input.url) || String(input || "");
    this.method = init && init.method;
    this.body = init && init.body;
  }
}

function newCtx(networkBody) {
  const location = { href: "https://www.youtube.com/watch?v=abc", search: "?v=abc", hostname: "www.youtube.com" };
  const listeners = {};
  const addWindowListener = (type, cb) => {
    listeners[type] = listeners[type] || [];
    listeners[type].push(cb);
  };
  const ctx = {
    window: { location, addEventListener: addWindowListener },
    self: { fetch: function () { return Promise.resolve(new FakeResponse(networkBody, { status: 200 })); } },
    document: { createElement: () => ({}), head: { appendChild() {} }, documentElement: { appendChild() {} }, location },
    Response: FakeResponse,
    XMLHttpRequest: FakeXHR,
    Request: FakeRequest,
    location,
    // Isolated JSON per context: the IIFE reassigns JSON.parse, so it must not
    // mutate the outer test's JSON (the test uses native JSON.parse to assert).
    JSON: { parse: function () { return JSON.parse.apply(JSON, arguments); }, stringify: function () { return JSON.stringify.apply(JSON, arguments); } },
    Promise, Object, Array, String, console, Reflect, Proxy, WeakMap, WeakSet, Date, Map,
    URLSearchParams, setTimeout,
  };
  ctx.__postWindowMessage = (data) => {
    (listeners.message || []).forEach((cb) => cb({ source: ctx.window, data }));
  };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  return ctx;
}

function coldSample() {
  return {
    playabilityStatus: { status: "OK" },
    streamingData: {
      serverAbrStreamingUrl: "https://r1.googlevideo.com/abr",
      adaptiveFormats: [{ itag: 140, url: "x" }],
      formats: [{ itag: 18, playerAds: "must-survive-deep" }],
    },
    adPlacements: [{ adPlacementRenderer: {} }],
    adSlots: [{ adSlotRenderer: {} }],
    playerAds: [{ playerLegacyDesktopWatchAdsRenderer: {} }],
    videoDetails: { videoId: "abc123" },
  };
}
function streamingIntact(r) {
  return r && r.streamingData &&
    r.streamingData.serverAbrStreamingUrl === "https://r1.googlevideo.com/abr" &&
    Array.isArray(r.streamingData.adaptiveFormats) && r.streamingData.adaptiveFormats.length === 1 &&
    Array.isArray(r.streamingData.formats) && r.streamingData.formats.length === 1 &&
    r.streamingData.formats[0].playerAds === "must-survive-deep" &&
    r.videoDetails && r.videoDetails.videoId === "abc123";
}
function adsGone(r) {
  return r && !("adPlacements" in r) && !("adSlots" in r) && !("playerAds" in r);
}

async function main() {
  console.log("1) Cold-load trap (set before script runs):");
  {
    const ctx = newCtx("{}");
    ctx.window.ytInitialPlayerResponse = coldSample();
    vm.runInContext(src, ctx);
    const r = ctx.window.ytInitialPlayerResponse;
    ok("ads removed", adsGone(r));
    ok("streamingData/videoDetails/deep-field intact", streamingIntact(r));
  }

  console.log("2) Cold-load trap (setter path, assigned after script):");
  {
    const ctx = newCtx("{}");
    vm.runInContext(src, ctx);
    ctx.window.ytInitialPlayerResponse = coldSample();
    const r = ctx.window.ytInitialPlayerResponse;
    ok("ads removed", adsGone(r));
    ok("streamingData intact", streamingIntact(r));
  }

  console.log("3) JSON.parse hook (response.text()+JSON.parse path):");
  {
    const ctx = newCtx("{}");
    vm.runInContext(src, ctx);
    const r = ctx.JSON.parse(JSON.stringify(coldSample()));
    ok("ads removed", adsGone(r));
    ok("streamingData intact", streamingIntact(r));
  }

  console.log("4) JSON.parse hook leaves unrelated JSON untouched:");
  {
    const ctx = newCtx("{}");
    vm.runInContext(src, ctx);
    const r = ctx.JSON.parse('{"foo":1,"bar":{"baz":2}}');
    ok("object unchanged", r.foo === 1 && r.bar.baz === 2);
  }

  console.log("5) fetch-response hook on /youtubei/v1/player:");
  {
    const ctx = newCtx(JSON.stringify(coldSample()));
    vm.runInContext(src, ctx);
    const resp = await ctx.self.fetch("https://www.youtube.com/youtubei/v1/player?key=x");
    const r = JSON.parse(await resp.text());
    ok("ads removed in rebuilt response", adsGone(r));
    ok("streamingData intact in rebuilt response", streamingIntact(r));
  }

  console.log("6) fetch on a NON-player URL is passed through untouched:");
  {
    const ctx = newCtx(JSON.stringify(coldSample()));
    vm.runInContext(src, ctx);
    const resp = await ctx.self.fetch("https://www.youtube.com/api/stats/watchtime");
    const r = JSON.parse(await resp.text());
    ok("non-player response NOT pruned (ads still present)", r && "adPlacements" in r);
  }

  console.log("7) Nested playlist [].playerResponse.* + Shorts [-] splice:");
  {
    const ctx = newCtx("{}");
    vm.runInContext(src, ctx);
    const playlist = ctx.JSON.parse(JSON.stringify([
      { playerResponse: { adPlacements: [1], adSlots: [1], streamingData: { adaptiveFormats: [1] } } },
    ]));
    ok("nested ads removed", !("adPlacements" in playlist[0].playerResponse) && !("adSlots" in playlist[0].playerResponse));
    ok("nested streamingData intact", playlist[0].playerResponse.streamingData.adaptiveFormats.length === 1);

    const shorts = ctx.JSON.parse(JSON.stringify({
      entries: [
        { command: { reelWatchEndpoint: { adClientParams: { isAd: true } } } },
        { command: { reelWatchEndpoint: { videoId: "real" } } },
      ],
    }));
    ok("Shorts ad entry spliced, real kept", shorts.entries.length === 1 && shorts.entries[0].command.reelWatchEndpoint.videoId === "real");
  }

  console.log("8) STEALTH: hooked fetch/JSON.parse report [native code] via toString:");
  {
    const ctx = newCtx("{}");
    vm.runInContext(src, ctx);
    const fStr = Function.prototype.toString.call(ctx.self.fetch);
    const jStr = Function.prototype.toString.call(ctx.JSON.parse);
    ok("fetch toString is [native code] (Proxy stealth)", /\[native code\]/.test(fStr) && !/PLAYER_RE|args\[0\]/.test(fStr));
    ok("JSON.parse toString is [native code] (Proxy stealth)", /\[native code\]/.test(jStr) && !/mightHaveAds/.test(jStr));
    ok("fetch.name spoofed to 'fetch'", ctx.self.fetch.name === "fetch");
    ok("fetch.length spoofed to 1", ctx.self.fetch.length === 1);
    ok("JSON.parse.name native ('parse')", ctx.JSON.parse.name === "parse");
  }

  // Helper: run a /player FETCH with a given client.userAgent and return what
  // the underlying fetch actually received after AdGuard-style shaping.
  async function fetchPlayer(ua, extra) {
    let captured = null;
    const ctx = newCtx("{}");
    ctx.self.fetch = function () { captured = arguments; return Promise.resolve(new FakeResponse("{}", { status: 200 })); };
    vm.runInContext(src, ctx);
    const body = Object.assign({ context: { client: { clientName: "WEB", userAgent: ua } }, videoId: "abc" }, extra);
    await ctx.self.fetch("https://www.youtube.com/youtubei/v1/player?key=x", { method: "POST", body: JSON.stringify(body) });
    return captured && captured[1] && captured[1].body;
  }

  console.log("9) /player shaping follows AdGuard player-body rules:");
  {
    // Non-player-shaped bodies stay untouched.
    const plain = await fetchPlayer("Mozilla/5.0 (Windows NT 10.0)");
    const plainObj = JSON.parse(plain);
    ok("plain /player request is untouched", !("params" in plainObj) && !plainObj.context.client.clientScreen);
    // Real YouTube player bodies include contentPlaybackContext; AdGuard applies param_first.
    const shaped = JSON.parse(await fetchPlayer("Mozilla/5.0 (Windows NT 10.0)", {
      playbackContext: { contentPlaybackContext: {} },
    }));
    ok("AdGuard param_first -> params:eAFgAQ", shaped.params === "eAFgAQ");
    ok("AdGuard param_first stamps lactMilliseconds", /^\d+$/.test(shaped.playbackContext.contentPlaybackContext.lactMilliseconds));
    ok("AdGuard param_first does not set clientScreen", !shaped.context.client.clientScreen);
    ok("fields preserved through shaping", shaped.videoId === "abc" && shaped.context.client.clientName === "WEB");
  }

  console.log("9b) mobile YouTube never receives desktop recovery params:");
  {
    let captured = null;
    const ctx = newCtx("{}");
    ctx.location.hostname = "m.youtube.com";
    ctx.location.href = "https://m.youtube.com/watch?v=mobile";
    ctx.self.fetch = function () {
      captured = arguments;
      return Promise.resolve(new FakeResponse("{}", { status: 200 }));
    };
    vm.runInContext(src, ctx);
    const body = {
      context: { client: { clientName: "MWEB", userAgent: "UA" } },
      videoId: "mobile",
      playbackContext: { contentPlaybackContext: {} },
    };
    await ctx.self.fetch("https://m.youtube.com/youtubei/v1/player?key=x", {
      method: "POST",
      body: ctx.JSON.stringify(body),
    });
    const mobile = JSON.parse(captured[1].body);
    ok("mobile request has no desktop params", !mobile.params);
    ok("mobile request has no desktop clientScreen", !mobile.context.client.clientScreen);
    ok("mobile request retains mobile lact stamp",
      !!mobile.playbackContext.contentPlaybackContext.lactMilliseconds);
  }

  console.log("10) Non-player request body is NOT modified:");
  {
    let captured = null;
    const ctx = newCtx("{}");
    ctx.self.fetch = function () { captured = arguments; return Promise.resolve(new FakeResponse("{}", { status: 200 })); };
    vm.runInContext(src, ctx);
    const original = JSON.stringify({ context: { client: { userAgent: "x" } }, videoId: "xyz", playbackContext: { contentPlaybackContext: {} } });
    await ctx.self.fetch("https://www.youtube.com/youtubei/v1/browse", { method: "POST", body: original });
    ok("browse request body unchanged", captured && captured[1] && captured[1].body === original);
  }

  console.log("11) Promise.then defuser no-ops onAbnormalityDetected callbacks only:");
  {
    const ctx = newCtx("{}");
    vm.runInContext(src, ctx);
    let normalRan = false, abnormalRan = false;
    await Promise.resolve().then(function () { normalRan = true; });
    const abnormalCb = function () { /* onAbnormalityDetected */ abnormalRan = true; };
    await Promise.resolve().then(abnormalCb);
    ok("normal then callback still runs", normalRan === true);
    ok("onAbnormalityDetected callback neutralized", abnormalRan === false);
    const tStr = Function.prototype.toString.call(Promise.prototype.then);
    ok("patched then reports [native code] (Proxy stealth)", /\[native code\]/.test(tStr));
  }

  console.log("12) Outbound /player XHR request gets AdGuard-style shaping (real desktop path):");
  {
    const ctx = newCtx("{}");
    vm.runInContext(src, ctx);
    const xhr = new ctx.XMLHttpRequest();
    xhr.open("POST", "https://www.youtube.com/youtubei/v1/player?key=x");
    xhr.send(JSON.stringify({ context: { client: { clientName: "WEB", userAgent: "UA" } }, videoId: "vid42", playbackContext: { contentPlaybackContext: {} } }));
    const sent = JSON.parse(xhr._sentBody);
    ok("params:eAFgAQ injected via XHR", sent.params === "eAFgAQ");
    ok("lactMilliseconds set via XHR", !!(sent.playbackContext && sent.playbackContext.contentPlaybackContext && /^\d+$/.test(sent.playbackContext.contentPlaybackContext.lactMilliseconds)));
    ok("original XHR fields preserved", sent.videoId === "vid42" && sent.context.client.clientName === "WEB");
    // Body without contentPlaybackContext/adSignalsInfo is untouched.
    const xhr2 = new ctx.XMLHttpRequest();
    const orig = JSON.stringify({ context: { client: { clientName: "WEB", userAgent: "UA-plain" } }, videoId: "v2" });
    xhr2.open("POST", "https://www.youtube.com/youtubei/v1/player?key=x");
    xhr2.send(orig);
    ok("plain XHR /player is untouched", xhr2._sentBody === orig);
    // XHR stealth: send must still report native.
    ok("XHR.send toString native (Proxy stealth)", /\[native code\]/.test(Function.prototype.toString.call(ctx.XMLHttpRequest.prototype.send)));
  }

  console.log("13) Non-player XHR body is NOT modified:");
  {
    const ctx = newCtx("{}");
    vm.runInContext(src, ctx);
    const xhr = new ctx.XMLHttpRequest();
    const original = JSON.stringify({ context: { client: { userAgent: "x; channel" } }, videoId: "zzz" });
    xhr.open("POST", "https://www.youtube.com/youtubei/v1/browse");
    xhr.send(original);
    ok("browse XHR body unchanged", xhr._sentBody === original);
  }

  console.log("14) Request constructor carries AdGuard /player shaping:");
  {
    const ctx = newCtx("{}");
    vm.runInContext(src, ctx);
    const original = JSON.stringify({ context: { client: { clientName: "WEB", userAgent: "UA" } }, videoId: "req1", playbackContext: { contentPlaybackContext: {} } });
    const req = new ctx.Request("https://www.youtube.com/youtubei/v1/player?key=x", { method: "POST", body: original });
    const reqBody = JSON.parse(req.body);
    ok("Request(/player) -> params:eAFgAQ", reqBody.params === "eAFgAQ");
    ok("Request(/player) preserves method", req.method === "POST");
    const browse = new ctx.Request("https://www.youtube.com/youtubei/v1/browse", { method: "POST", body: original });
    ok("Request(non-player) body unchanged", browse.body === original);
  }

  console.log("15) AdGuard iframe workaround shares hooked fetch/Request:");
  {
    const ctx = newCtx("{}");
    ctx.HTMLIFrameElement = class {
      constructor() { this.src = "about:blank"; this.contentWindow = {}; }
    };
    ctx.Node = function () {};
    ctx.Node.prototype.appendChild = function (child) { return child; };
    vm.runInContext(src, ctx);
    const frame = new ctx.HTMLIFrameElement();
    new ctx.Node().appendChild(frame);
    ok("about:blank iframe gets hooked fetch", frame.contentWindow.fetch === ctx.self.fetch);
    ok("about:blank iframe gets hooked Request", frame.contentWindow.Request === ctx.Request);
  }

  console.log("16) unrelated native 17s timers retain their requested delay:");
  {
    let capturedDelay = null;
    const ctx = newCtx("{}");
    ctx.window.setTimeout = function (_cb, delay) { capturedDelay = delay; return 1; };
    ctx.setTimeout = ctx.window.setTimeout;
    vm.runInContext(src, ctx);
    ctx.window.setTimeout(ctx.Array.prototype.push, 17000);
    ok("native 17000ms timeout is unchanged", capturedDelay === 17000);
  }

  console.log("16b) SSAP push interception is bounded and captured segments still work:");
  {
    let restorePush = null;
    let domCb = null;
    const video = { duration: 10, currentTime: 0, loop: false };
    const ctx = newCtx("{}");
    const originalPush = ctx.Array.prototype.push;
    ctx.window.setTimeout = function (cb, delay) {
      if (delay === 10000) restorePush = cb;
      return 1;
    };
    ctx.setTimeout = ctx.window.setTimeout;
    ctx.window.yt = { config_: { EXPERIMENT_FLAGS: { html5_enable_ssap_entity_id: true } } };
    ctx.document.addEventListener = function (ev, cb) { if (ev === "DOMContentLoaded") domCb = cb; };
    ctx.document.querySelector = function (selector) { return selector === "video" ? video : null; };
    ctx.MutationObserver = class { observe() {} };
    vm.runInContext(src, ctx);
    const hookedPush = ctx.Array.prototype.push;
    hookedPush.call([], { start: 0, end: 5000, namespace: "ssap", id: "ssap-1" });
    hookedPush.call([], { start: 5000, end: 10000, namespace: "ssap", id: "ssap-2" });
    ok("SSAP startup capture temporarily hooks push", hookedPush !== originalPush);
    if (restorePush) restorePush();
    ok("SSAP startup capture restores push", ctx.Array.prototype.push === originalPush);
    if (domCb) domCb();
    ok("captured SSAP segments remain actionable after restore", video.currentTime === 5);
  }

  console.log("17) Player errors rotate through AdGuard recovery modes:");
  {
    let captured = null;
    const ctx = newCtx("{}");
    ctx.self.fetch = function () { captured = arguments; return Promise.resolve(new FakeResponse("{}", { status: 200 })); };
    vm.runInContext(src, ctx);
    ctx.JSON.parse(JSON.stringify({ responseContext: {}, playabilityStatus: { status: "UNPLAYABLE" }, videoDetails: { videoId: "rot" } }));
    await ctx.self.fetch("https://www.youtube.com/youtubei/v1/player?key=x", {
      method: "POST",
      body: JSON.stringify({ context: { client: { clientName: "WEB", userAgent: "UA" } }, videoId: "rot", playbackContext: { contentPlaybackContext: {} } }),
    });
    const rotated = JSON.parse(captured[1].body);
    ok("UNPLAYABLE rotates -> params:8AUB", rotated.params === "8AUB");
    ok("UNPLAYABLE rotates -> clientScreen:CHANNEL", rotated.context.client.clientScreen === "CHANNEL");

    captured = null;
    const ctx2 = newCtx("{}");
    ctx2.self.fetch = function () { captured = arguments; return Promise.resolve(new FakeResponse("{}", { status: 200 })); };
    vm.runInContext(src, ctx2);
    ctx2.JSON.parse(JSON.stringify({ responseContext: {}, playabilityStatus: { status: "LOGIN_REQUIRED" }, videoDetails: { videoId: "login" } }));
    await ctx2.self.fetch("https://www.youtube.com/youtubei/v1/player?key=x", {
      method: "POST",
      body: JSON.stringify({ context: { client: { clientName: "WEB", userAgent: "UA" } }, videoId: "login", playbackContext: { contentPlaybackContext: {} } }),
    });
    const login = JSON.parse(captured[1].body);
    ok("LOGIN_REQUIRED does not rotate past param_first", login.params === "eAFgAQ" && !login.context.client.clientScreen);
  }

  console.log("18) bounded recovery section installs without throwing + stays stealthy:");
  {
    const ctx = newCtx("{}");
    // Give the mock document the listener API so the DOMContentLoaded path runs.
    let domCb = null;
    ctx.document.addEventListener = function (ev, cb) { if (ev === "DOMContentLoaded") domCb = cb; };
    ctx.document.getElementById = function () { return null; };
    ctx.MutationObserver = class { observe() {} };
    vm.runInContext(src, ctx);
    // Map.has must still be native (Proxy stealth) and pass through transparently.
    ok("Map.prototype.has toString native", /\[native code\]/.test(Function.prototype.toString.call(ctx.globalThis.Map.prototype.has)));
    const m = new ctx.globalThis.Map([["k", 1]]);
    ok("Map.has passes through (true)", m.has("k") === true);
    ok("Map.has passes through (false)", m.has("nope") === false);
    // Firing DOMContentLoaded with no player must not throw.
    let threw = false;
    try { if (domCb) domCb(); } catch (_) { threw = true; }
    ok("DOMContentLoaded handler safe with no movie_player", threw === false);
  }

  console.log("19) missing transport snapshot never restarts healthy playback:");
  {
    const ctx = newCtx("{}");
    let loadCb = null;
    let loaded = null;
    ctx.location.href = "https://www.youtube.com/watch?v=healthy";
    ctx.location.search = "?v=healthy";
    ctx.window.addEventListener = function (ev, cb) { if (ev === "load") loadCb = cb; };
    ctx.document.addEventListener = function () {};
    ctx.document.getElementById = function (id) {
      if (id !== "movie_player") return null;
      return { loadVideoById: (videoId, start) => { loaded = { videoId, start }; } };
    };
    ctx.document.querySelector = function (selector) {
      return selector === "#movie_player" ? ctx.document.getElementById("movie_player") : null;
    };
    ctx.MutationObserver = class { observe() {} };
    ctx.setTimeout = (cb) => { cb(); return 1; };
    vm.runInContext(src, ctx);
    if (loadCb) loadCb();
    await Promise.resolve();
    ok("no snapshot means no recovery reload", loaded === null);
  }

  console.log("20) backoffTimeMs snapshot triggers one bounded recovery:");
  {
    const ctx = newCtx("{}");
    let loadCb = null;
    let loaded = null;
    let captured = null;
    ctx.self.fetch = function () { captured = arguments; return Promise.resolve(new FakeResponse("{}", { status: 200 })); };
    ctx.location.href = "https://www.youtube.com/watch?v=back";
    ctx.location.search = "?v=back";
    ctx.window.addEventListener = function (ev, cb) { if (ev === "load") loadCb = cb; };
    ctx.document.addEventListener = function () {};
    ctx.document.getElementById = function (id) {
      if (id !== "movie_player") return null;
      return {
        getPlayerResponse: () => ({ videoDetails: { videoId: "back" } }),
        getVideoData: () => ({ video_id: "back" }),
        loadVideoById: (videoId, start) => { loaded = { videoId, start }; },
      };
    };
    ctx.document.querySelector = function (selector) {
      return selector === "#movie_player" ? ctx.document.getElementById("movie_player") : null;
    };
    ctx.MutationObserver = class { observe() {} };
    ctx.setTimeout = (cb) => { cb(); return 1; };
    vm.runInContext(src, ctx);
    vm.runInContext("(function(){}).call({ requestNumber: 1, snapshot: { transport: { backoffTimeMs: 250 } } });", ctx);
    if (loadCb) loadCb();
    await Promise.resolve();
    ok("backoff snapshot reloads current video", loaded && loaded.videoId === "back" && loaded.start === 0);
    await ctx.self.fetch("https://www.youtube.com/youtubei/v1/player?key=x", {
      method: "POST",
      body: JSON.stringify({ context: { client: { clientName: "WEB", userAgent: "UA" } }, videoId: "back", playbackContext: { contentPlaybackContext: {} } }),
    });
    const recovered = JSON.parse(captured[1].body);
    ok("backoff recovery enables params:eAFgAQ", recovered.params === "eAFgAQ");
    ok("backoff first recovery avoids clientScreen", !recovered.context.client.clientScreen);
  }

  console.log("21) master-off config makes YouTube hooks pass through:");
  {
    let receivedBody = "";
    const ctx = newCtx(JSON.stringify(coldSample()));
    ctx.self.fetch = function (_url, init) {
      receivedBody = init && init.body;
      return Promise.resolve(new FakeResponse(JSON.stringify(coldSample()), { status: 200 }));
    };
    vm.runInContext(src, ctx);
    ctx.__postWindowMessage({ source: "wardenone-handshake", token: "master-off-test" });
    ctx.__postWindowMessage({ source: "wardenone", kind: "config", token: "master-off-test", overrides: { enabled: false } });
    const body = { context: { client: { clientName: "WEB", userAgent: "UA" } }, videoId: "off", playbackContext: { contentPlaybackContext: {} } };
    const resp = await ctx.self.fetch("https://www.youtube.com/youtubei/v1/player?key=x", { method: "POST", body: JSON.stringify(body) });
    const sent = JSON.parse(receivedBody);
    const rawResponse = JSON.parse(await resp.text());
    ok("master off leaves /player request body untouched", !sent.params && !sent.playbackContext.contentPlaybackContext.lactMilliseconds);
    ok("master off leaves player response ads intact", rawResponse.adPlacements && rawResponse.playerAds && rawResponse.adSlots);
  }

  {
    /* The appendChild proxy hands every about:blank iframe our fetch, so ad code
       inside one still goes through the hooks. YouTube also makes SANDBOXED
       about:blank frames, and reaching into the contentWindow of one that cannot
       run scripts is what Chrome reports as "Blocked script execution in
       'about:blank' because the document's frame is sandboxed" -- a console full
       of warnings about a write that could never have helped.

       Read out of the shipped guard rather than restated, so a rewrite of the
       condition is what gets tested. */
    const guard = /var scriptsBlocked = ([^;]+);/.exec(src);
    ok("the sandbox guard is in the iframe proxy", !!guard);
    if (guard) {
      const skips = new Function("sandboxAttr", "return " + guard[1] + ";");
      ok("an ordinary about:blank frame still gets our fetch", skips(null) === false);
      ok("a frame allowed to run scripts still gets it", skips("allow-scripts") === false);
      ok("and when allow-scripts is not first", skips("allow-popups allow-scripts") === false);
      ok("a fully sandboxed frame is left alone", skips("") === true);
      ok("so is one sandboxed without allow-scripts", skips("allow-forms allow-modals") === true);
      /* Substring matching would read allow-scripts-extra as permission. */
      ok("a lookalike token does not count as permission", skips("allow-scripts-extra") === true);
      /* Unreadable attribute must fall toward hooking: failing the other way
         silently stops hooking every about:blank frame, which is the thing this
         proxy exists for. Two suite checks caught exactly that. */
      ok("an unreadable sandbox attribute does not disable the hook", skips(undefined) === false);
    }
  }

  console.log("\n" + pass + " passed, " + fail + " failed");
  process.exit(fail ? 1 : 0);
}
main();
