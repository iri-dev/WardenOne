/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/* WardenOne YouTube module
 *
 * Rebuilt from the active AdGuard YouTube filter rules in:
 *   Extension/filters/chromium/filter_2.txt, lines 37700-37732
 *
 * This file intentionally avoids WardenOne's older YouTube heuristics. The
 * behavior here is a compact, readable port of AdGuard's current YouTube rules:
 * JSON pruning for ad schedule fields, anti-abnormality defusing, native
 * fetch/Request iframe workaround, SSAP timeout/segment handling, and AdGuard's
 * bounded player-request recovery modes.
 */
(function () {
  "use strict";

  var YT_MODULE_VERSION = "1.0.1";
  if (window.__wardenOneYouTubeReadyVersion === YT_MODULE_VERSION) return;
  window.__wardenOneYouTubeVersion = YT_MODULE_VERSION;

  var realFetch = self.fetch;
  var realParse = JSON.parse;
  var realStringify = JSON.stringify;
  var woConfigToken = null;
  var woMasterEnabled = true;
  var cosmeticStyle = null;
  var installSsapPushCapture = function () {};
  var restoreSsapPushCapture = function () {};

  function masterEnabled() {
    return woMasterEnabled !== false;
  }

  function setMasterEnabled(value) {
    woMasterEnabled = value !== false;
    if (!masterEnabled()) {
      restoreSsapPushCapture();
      restoreVisibility();
      removeCosmetics();
    } else {
      applyCosmetics();
      installSsapPushCapture();
    }
  }

  try {
    window.addEventListener("message", function (event) {
      if (event.source !== window) return;
      var message = event.data;
      if (!message || typeof message !== "object") return;
      if (message.source === "wardenone-handshake" && typeof message.token === "string" && woConfigToken === null) {
        woConfigToken = message.token;
        return;
      }
      if (message.source !== "wardenone" || message.kind !== "config" || !message.overrides) return;
      if (woConfigToken === null || message.token !== woConfigToken) return;
      setMasterEnabled(message.overrides.enabled !== false);
    });
  } catch (_) {}

  var host = "";
  try { host = String(location.hostname || "").replace(/^www\./, "").toLowerCase(); } catch (_) {}
  // `host` has already had a leading `www.` removed. Keep the desktop request
  // recovery modes off m.youtube.com, which has its own lighter-weight body
  // stamping path below and is not compatible with desktop client params.
  var isDesktopWatch = host === "youtube.com";
  var isMobileWatch = host === "m.youtube.com";

  var PLAYER_RESPONSE_RE = /playlist\?list=|\/player(?!.*get_drm_license)|player\?|watch\?[tv]=|get_watch\?|get_video_info/i;
  var PLAYER_REQUEST_RE = /\/youtubei\/v1\/player(?:[?/]|$)|\/player\?/i;
  var INITPLAYBACK_RE = /googlevideo\.com\/initplayback\?[^#]*source=youtube(?=[^#]*\bc=TVHTML5\b)(?=[^#]*\boad\b)/i;

  var MODE_PYV = "pyv";
  var MODE_PARAM_FIRST = "param_first";
  var MODE_PARAM_SECOND = "param_second";
  var MODE_CLIENT_SCREEN = "client_screen";
  var MODE_AD_TYPE = "ad_type";
  var MODE_NONE = "none";
  var modes = [MODE_PARAM_FIRST, MODE_PARAM_SECOND, MODE_PYV, MODE_CLIENT_SCREEN, MODE_AD_TYPE, MODE_NONE];
  var mode = MODE_PARAM_FIRST;
  var modeVideoId = "";
  var failedModes = {};
  var visibilityDescriptor = null;

  try {
    if (typeof Document !== "undefined") {
      visibilityDescriptor = Object.getOwnPropertyDescriptor(Document.prototype, "visibilityState");
    }
  } catch (_) {}

  function isObject(value) {
    return value !== null && typeof value === "object";
  }

  function own(obj, key) {
    return Object.prototype.hasOwnProperty.call(obj, key);
  }

  function safeString(value) {
    try { return realStringify(value); } catch (_) { return ""; }
  }

  function currentUrl() {
    try { return String(location.href || ""); } catch (_) { return ""; }
  }

  function playerShapingAllowed() {
    var href = currentUrl();
    return isDesktopWatch &&
      href.indexOf("/shorts/") === -1 &&
      href.indexOf("youtube.com/tv") === -1 &&
      href.indexOf("youtube.com/embed/") === -1;
  }

  function resetModeForVideo(videoId) {
    if (!videoId || videoId === modeVideoId) return;
    modeVideoId = videoId;
    mode = MODE_PARAM_FIRST;
    failedModes = {};
  }

  function advanceMode(videoId, reason) {
    if (videoId) resetModeForVideo(videoId);
    var key = (modeVideoId || "") + "|" + mode + "|" + (reason || "");
    if (failedModes[key]) return false;
    failedModes[key] = true;
    var idx = modes.indexOf(mode);
    if (idx < 0 || idx >= modes.length - 1) {
      mode = MODE_NONE;
      return false;
    }
    mode = modes[idx + 1];
    return mode !== MODE_NONE;
  }

  function forceVisible() {
    try {
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        get: function () { return "visible"; },
      });
    } catch (_) {}
  }

  function restoreVisibility() {
    try {
      if (visibilityDescriptor) Object.defineProperty(document, "visibilityState", visibilityDescriptor);
    } catch (_) {}
  }

  function playbackContexts(body) {
    var out = [];
    if (body && body.playbackContext) out.push(body.playbackContext);
    if (body && body.playerRequest && body.playerRequest.playbackContext) {
      out.push(body.playerRequest.playbackContext);
    }
    return out;
  }

  function ensureContentPlayback(ctx) {
    ctx.contentPlaybackContext = ctx.contentPlaybackContext || {};
    return ctx.contentPlaybackContext;
  }

  function setParams(body, params) {
    body.params = params;
    if (body.playerRequest && body.playerRequest.params !== params) body.playerRequest.params = params;
    if (body.playbackContext && body.playbackContext.params !== params) body.playbackContext.params = params;
  }

  function stripAppInstallData(body) {
    try {
      if ((body.playbackContext || body.playerRequest) &&
          body.context && body.context.client && body.context.client.configInfo) {
        delete body.context.client.configInfo.appInstallData;
      }
    } catch (_) {}
  }

  function currentPlayerStatus() {
    try {
      var mp = document.getElementById("movie_player");
      var pr = mp && mp.getPlayerResponse && mp.getPlayerResponse();
      return pr && pr.playabilityStatus && pr.playabilityStatus.status;
    } catch (_) {
      return "";
    }
  }

  function applyAdGuardMode(body, forcedMode) {
    try {
      if (!playerShapingAllowed() || !isObject(body) || Array.isArray(body)) return false;
      if (!body.context || !body.context.client) return false;
      resetModeForVideo(body.videoId);

      var activeMode = forcedMode || mode;
      var status = currentPlayerStatus();
      if (status === "LOGIN_REQUIRED" || status === "CONTENT_CHECK_REQUIRED") activeMode = MODE_NONE;

      var client = body.context.client;
      var contexts = playbackContexts(body);
      if (!contexts.length) return false;
      var stamp = String(Date.now());
      var changed = false;
      var i;

      function touch() {
        for (i = 0; i < contexts.length; i++) {
          ensureContentPlayback(contexts[i]).lactMilliseconds = stamp;
        }
        stripAppInstallData(body);
        changed = true;
      }

      if (activeMode === MODE_PARAM_FIRST) {
        if (client.clientScreen === "CHANNEL" || String(body.params || "").indexOf("YAHI") === 0) return false;
        setParams(body, "eAFgAQ");
        touch();
        forceVisible();
        return changed;
      }

      if (activeMode === MODE_PARAM_SECOND) {
        if (client.clientScreen === "CHANNEL" || String(body.params || "").indexOf("YAHI") === 0) return false;
        setParams(body, "8AUB");
        if (!body.playlistId) client.clientScreen = "CHANNEL";
        touch();
        forceVisible();
        return changed;
      }

      if (activeMode === MODE_PYV) {
        for (i = 0; i < contexts.length; i++) contexts[i].adPlaybackContext = { pyv: true };
        touch();
        return changed;
      }

      if (activeMode === MODE_CLIENT_SCREEN) {
        if (client.clientName === "WEB") client.clientScreen = "CHANNEL";
        touch();
        forceVisible();
        return changed;
      }

      if (activeMode === MODE_AD_TYPE) {
        for (i = 0; i < contexts.length; i++) contexts[i].adPlaybackContext = { adType: "AD_TYPE_INSTREAM" };
        touch();
        forceVisible();
        return changed;
      }

      if (activeMode === MODE_NONE) {
        for (i = 0; i < contexts.length; i++) delete contexts[i].adPlaybackContext;
        restoreVisibility();
      }
    } catch (_) {}
    return false;
  }

  function shapeOutboundText(text) {
    try {
      if (!playerShapingAllowed()) return null;
      if (typeof text !== "string") return null;
      if (text.indexOf("\"contentPlaybackContext\"") === -1 && text.indexOf("\"adSignalsInfo\"") === -1) return null;
      var body = realParse(text);
      if (!body || !body.context || !body.context.client) return null;
      return applyAdGuardMode(body) ? realStringify(body) : null;
    } catch (_) {
      return null;
    }
  }

  function stampMobileBody(body) {
    try {
      if (!isMobileWatch || !isObject(body) || !body.context || !body.context.client) return false;
      if (currentUrl().indexOf("/shorts/") !== -1 ||
          currentUrl().indexOf("youtube.com/tv") !== -1 ||
          currentUrl().indexOf("youtube.com/embed/") !== -1) return false;
      var contexts = playbackContexts(body);
      var stamp = String(Date.now());
      var changed = false;
      for (var i = 0; i < contexts.length; i++) {
        if (contexts[i].adPlaybackContext === undefined) {
          ensureContentPlayback(contexts[i]).lactMilliseconds = stamp;
          changed = true;
        }
      }
      return changed;
    } catch (_) {
      return false;
    }
  }

  function walkDelete(root, parts, index) {
    if (!isObject(root)) return;
    var part = parts[index];
    if (part === "[]") {
      if (Array.isArray(root)) {
        for (var i = 0; i < root.length; i++) walkDelete(root[i], parts, index + 1);
      }
      return;
    }
    if (part === "[-]") {
      if (!Array.isArray(root)) return;
      var rest = parts.slice(index + 1);
      for (var j = root.length - 1; j >= 0; j--) {
        if (resolvePath(root[j], rest, 0)) root.splice(j, 1);
      }
      return;
    }
    if (index === parts.length - 1) {
      if (own(root, part)) delete root[part];
      return;
    }
    walkDelete(root[part], parts, index + 1);
  }

  function resolvePath(root, parts, index) {
    if (!isObject(root)) return false;
    var value = root[parts[index]];
    if (index === parts.length - 1) return value !== undefined && value !== null && value !== false;
    return resolvePath(value, parts, index + 1);
  }

  var PRUNE_PATHS = [
    "playerResponse.adPlacements",
    "playerResponse.playerAds",
    "playerResponse.adSlots",
    "[].playerResponse.adPlacements",
    "[].playerResponse.playerAds",
    "[].playerResponse.adSlots",
    "adPlacements",
    "playerAds",
    "adSlots",
    "entries.[-].command.reelWatchEndpoint.adClientParams.isAd",
    "playerResponse.messages.[].youThereRenderer",
  ];

  function fixPlayerObject(obj) {
    if (!isObject(obj)) return;
    try {
      if (obj.responseContext || obj.playabilityStatus) {
        delete obj.adSlots;
        delete obj.playerAds;
        delete obj.adPlacements;
      }
      var audio = obj.playerConfig && obj.playerConfig.audioConfig;
      var shouldFixMute = audio && audio.muteOnStart &&
        (currentUrl().indexOf("/watch") !== -1 || (obj.cards && !(obj.playabilityStatus && obj.playabilityStatus.miniplayer)));
      if (shouldFixMute) {
        delete audio.muteOnStart;
        if (obj.messages && obj.messages[0]) delete obj.messages[0].youThereRenderer;
      }
      if (mode === MODE_AD_TYPE &&
          obj.playerConfig &&
          obj.playerConfig.granularVariableSpeedConfig) {
        obj.playerConfig.granularVariableSpeedConfig.maximumPlaybackRate = 200;
        obj.playerConfig.granularVariableSpeedConfig.minimumPlaybackRate = 25;
      }
      if (obj.auxiliaryUi && obj.auxiliaryUi.messageRenderers) {
        delete obj.auxiliaryUi.messageRenderers.bkaEnforcementMessageViewModel;
      }
    } catch (_) {}
  }

  function pruneAdGuard(obj) {
    if (!isObject(obj)) return obj;
    try {
      for (var i = 0; i < PRUNE_PATHS.length; i++) walkDelete(obj, PRUNE_PATHS[i].split("."), 0);
      fixPlayerObject(obj);
      fixPlayerObject(obj.playerResponse);
      if (Array.isArray(obj)) {
        for (var j = 0; j < obj.length; j++) {
          fixPlayerObject(obj[j] && obj[j].playerResponse);
        }
      }
    } catch (_) {}
    return obj;
  }

  function mightContainPlayerAds(obj) {
    if (!isObject(obj)) return false;
    return !!(
      obj.responseContext || obj.playabilityStatus || obj.playerResponse ||
      obj.adPlacements || obj.playerAds || obj.adSlots || obj.entries
    );
  }

  function responseVideoId(obj) {
    try {
      return (obj && obj.videoDetails && obj.videoDetails.videoId) ||
        (obj && obj.playerResponse && obj.playerResponse.videoDetails && obj.playerResponse.videoDetails.videoId) ||
        "";
    } catch (_) {
      return "";
    }
  }

  function responseLooksRecoverableError(obj) {
    try {
      var text = safeString(obj);
      if (text.indexOf("CONTENT_CHECK_REQUIRED") !== -1) return false;
      return text.indexOf("playerErrorMessageRenderer") !== -1 || text.indexOf("UNPLAYABLE") !== -1;
    } catch (_) {
      return false;
    }
  }

  function rotateFromResponse(obj) {
    if (!playerShapingAllowed() || mode === MODE_NONE) return;
    if (responseLooksRecoverableError(obj)) advanceMode(responseVideoId(obj), "parse");
  }

  function definePlain(name, value) {
    try {
      Object.defineProperty(window, name, {
        configurable: true,
        enumerable: true,
        writable: true,
        value: value,
      });
    } catch (_) {}
  }

  function trapInitial(name) {
    try {
      var existing = window[name];
      if (existing !== undefined) {
        definePlain(name, pruneAdGuard(existing));
        return;
      }
      Object.defineProperty(window, name, {
        configurable: true,
        enumerable: true,
        get: function () { return undefined; },
        set: function (value) { definePlain(name, pruneAdGuard(value)); },
      });
    } catch (_) {}
  }

  trapInitial("ytInitialPlayerResponse");
  trapInitial("ytInitialData");

  function urlFromInput(input) {
    try {
      return typeof input === "string" ? input : (input && input.url) || String(input || "");
    } catch (_) {
      return "";
    }
  }

  function isInitPlayback(url) {
    return INITPLAYBACK_RE.test(String(url || ""));
  }

  function shouldPruneUrl(url) {
    return PLAYER_RESPONSE_RE.test(String(url || ""));
  }

  function responseFromText(text, resp) {
    return new Response(text, {
      status: resp.status,
      statusText: resp.statusText,
      headers: resp.headers,
    });
  }

  self.fetch = new Proxy(realFetch, {
    get: function (target, prop, receiver) {
      if (prop === "name") return "fetch";
      if (prop === "length") return 1;
      return Reflect.get(target, prop, receiver);
    },
    apply: function (target, thisArg, args) {
      if (!masterEnabled()) return Reflect.apply(target, thisArg, args);
      var url = urlFromInput(args && args[0]);
      try {
        if (isInitPlayback(url)) {
          return Promise.resolve(new Response("", { status: 204, statusText: "No Content" }));
        }
        if (url && PLAYER_REQUEST_RE.test(url) && args[1] && typeof args[1].body === "string") {
          var shaped = shapeOutboundText(args[1].body);
          if (shaped !== null) {
            args = args.slice();
            args[1] = Object.assign({}, args[1], { body: shaped });
          }
        }
      } catch (_) {}

      var promise = Reflect.apply(target, thisArg, args);
      if (!url || !shouldPruneUrl(url)) return promise;
      return promise.then(function (resp) {
        try {
          if (!resp || typeof resp.clone !== "function") return resp;
          return resp.clone().text().then(function (text) {
            try {
              var obj = realParse(text);
              pruneAdGuard(obj);
              return responseFromText(realStringify(obj), resp);
            } catch (_) {
              return resp;
            }
          }, function () { return resp; });
        } catch (_) {
          return resp;
        }
      });
    },
  });

  try {
    var xhrUrls = new WeakMap();
    var realOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = new Proxy(realOpen, {
      apply: function (target, thisArg, args) {
        try { xhrUrls.set(thisArg, String(args && args[1] || "")); } catch (_) {}
        return Reflect.apply(target, thisArg, args);
      },
    });
    var realSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.send = new Proxy(realSend, {
      apply: function (target, thisArg, args) {
        if (!masterEnabled()) return Reflect.apply(target, thisArg, args);
        try {
          var url = xhrUrls.get(thisArg) || "";
          if (isInitPlayback(url)) return undefined;
          var body = args && args[0];
          if (url && PLAYER_REQUEST_RE.test(url)) {
            var text = Array.isArray(body) ? body[0] : body;
            var shaped = shapeOutboundText(text);
            if (shaped !== null) {
              args = args.slice();
              if (Array.isArray(body)) args[0][0] = shaped;
              else args[0] = shaped;
            }
          }
        } catch (_) {}
        return Reflect.apply(target, thisArg, args);
      },
    });
  } catch (_) {}

  try {
    if (typeof Request === "function") {
      var realRequest = Request;
      Request = new Proxy(realRequest, {
        construct: function (target, args, newTarget) {
          if (!masterEnabled()) return Reflect.construct(target, args, newTarget);
          try {
            var input = args && args[0];
            var init = args && args[1];
            var url = urlFromInput(input);
            var body = init && init.body;
            if (url && PLAYER_REQUEST_RE.test(url) && typeof body === "string") {
              var shaped = shapeOutboundText(body);
              if (shaped !== null) {
                args = args.slice();
                args[1] = Object.assign({}, init, { body: shaped });
              }
            }
          } catch (_) {}
          return Reflect.construct(target, args, newTarget);
        },
      });
    }
  } catch (_) {}

  try {
    if (typeof TextEncoder !== "undefined" && TextEncoder.prototype && TextEncoder.prototype.encode) {
      var realEncode = TextEncoder.prototype.encode;
      TextEncoder.prototype.encode = new Proxy(realEncode, {
        apply: function (target, thisArg, args) {
          if (!masterEnabled()) return Reflect.apply(target, thisArg, args);
          try {
            var shaped = shapeOutboundText(args && args[0]);
            if (shaped !== null) {
              args = args.slice();
              args[0] = shaped;
            }
          } catch (_) {}
          return Reflect.apply(target, thisArg, args);
        },
      });
    }
  } catch (_) {}

  JSON.stringify = new Proxy(realStringify, {
    apply: function (target, thisArg, args) {
      if (!masterEnabled()) return Reflect.apply(target, thisArg, args);
      try {
        var value = args && args[0];
        if (isObject(value)) {
          if (applyAdGuardMode(value) || stampMobileBody(value)) {
            args = args.slice();
            args[0] = value;
          }
        }
      } catch (_) {}
      return Reflect.apply(target, thisArg, args);
    },
  });

  JSON.parse = new Proxy(realParse, {
    apply: function (target, thisArg, args) {
      var obj = Reflect.apply(target, thisArg, args);
      try {
        if (masterEnabled()) {
          if (mightContainPlayerAds(obj)) pruneAdGuard(obj);
          rotateFromResponse(obj);
        }
      } catch (_) {}
      return obj;
    },
  });

  try {
    var realThen = Promise.prototype.then;
    Promise.prototype.then = new Proxy(realThen, {
      apply: function (target, thisArg, args) {
        if (!masterEnabled()) return Reflect.apply(target, thisArg, args);
        try {
          var cb = args && args[0];
          if (typeof cb === "function") {
            var source = String(cb);
            if (source.indexOf("onAbnormalityDetected") !== -1) {
              args = args.slice();
              args[0] = function () {};
            } else if (source.indexOf(".next(") !== -1) {
              args = args.slice();
              args[0] = new Proxy(cb, {
                apply: function (innerTarget, innerThis, innerArgs) {
                  try {
                    var first = innerArgs && innerArgs[0];
                    if (masterEnabled() && first && typeof first.value === "string" && first.value.indexOf("playerResponse") !== -1) {
                      first.value = first.value
                        .replace(/"muteOnStart":true/g, "\"muteOnStart\":false")
                        .replace(/"youThereRenderer":/g, "\"no_youThereRenderer\":")
                        .replace(/"(adSlots|playerAds)":/g, "\"no_ads\":");
                    }
                  } catch (_) {}
                  return Reflect.apply(innerTarget, innerThis, innerArgs);
                },
              });
            } else if (source.indexOf("jspbResponseCtor") !== -1) {
              args = args.slice();
              args[0] = new Proxy(cb, {
                apply: function (innerTarget, innerThis, innerArgs) {
                  var result = Reflect.apply(innerTarget, innerThis, innerArgs);
                  try { if (masterEnabled()) pruneAdGuard(result); } catch (_) {}
                  return result;
                },
              });
            }
          }
        } catch (_) {}
        return Reflect.apply(target, thisArg, args);
      },
    });
  } catch (_) {}

  try {
    if (typeof Node !== "undefined" && typeof HTMLIFrameElement !== "undefined") {
      var realAppendChild = Node.prototype.appendChild;
      Node.prototype.appendChild = new Proxy(realAppendChild, {
        apply: function (target, thisArg, args) {
          var out = Reflect.apply(target, thisArg, args);
          try {
            if (masterEnabled() && out instanceof HTMLIFrameElement && out.src === "about:blank") {
              /* A sandboxed frame without allow-scripts cannot run scripts, so it
                 has no use for a fetch -- and reaching into its contentWindow is
                 what Chrome reports as "Blocked script execution in 'about:blank'
                 because the document's frame is sandboxed". YouTube makes those
                 frames routinely, so the console filled with a warning about a
                 write that could never have helped. */
              var sandboxAttr = null;
              /* Only skip on positive evidence of a sandbox. If the attribute
                 cannot be read at all, assume the frame is ordinary and hook it
                 -- failing the other way would silently stop hooking every
                 about:blank frame, which is the thing this proxy exists for. */
              try { sandboxAttr = out.getAttribute ? out.getAttribute("sandbox") : null; } catch (_) { sandboxAttr = null; }
              var scriptsBlocked = typeof sandboxAttr === "string" && !/(^|\s)allow-scripts(\s|$)/.test(sandboxAttr);
              if (!scriptsBlocked && out.contentWindow) {
                out.contentWindow.fetch = self.fetch;
                out.contentWindow.Request = Request;
              }
            }
          } catch (_) {}
          return out;
        },
      });
    }
  } catch (_) {}

  try {
    var realTimeout = window.setTimeout || setTimeout;
    var timeoutProxy = new Proxy(realTimeout, {
      apply: function (target, thisArg, args) {
        if (!masterEnabled()) return Reflect.apply(target, thisArg, args);
        try {
          var cb = args && args[0];
          var delay = Number(args && args[1]);
          if (delay === 5000 && String(cb).indexOf("(),a,b)") !== -1) {
            return 0;
          }
        } catch (_) {}
        return Reflect.apply(target, thisArg, args);
      },
    });
    window.setTimeout = timeoutProxy;
    try { setTimeout = timeoutProxy; } catch (_) {}
  } catch (_) {}

  try {
    var pageUrl = document.location && document.location.href;
    var ssapSegments = [];
    var ssapIds = [];
    var ssapArmed = false;
    var lastJumpKey = "";
    var realPush = Array.prototype.push;
    var ssapPushProxy = new Proxy(realPush, {
      apply: function (target, thisArg, args) {
        if (!masterEnabled()) return Reflect.apply(target, thisArg, args);
        try {
          var item = args && args[0];
          var flag = window.yt && window.yt.config_ && window.yt.config_.EXPERIMENT_FLAGS &&
            window.yt.config_.EXPERIMENT_FLAGS.html5_enable_ssap_entity_id;
          if (flag && item && item !== window && typeof item.start === "number" &&
              item.end && item.namespace === "ssap" && item.id) {
            if (!ssapArmed || item.start !== 0 || ssapIds.indexOf(item.id) === -1) {
              if (!ssapArmed || item.start === 0) {
                ssapSegments.length = 0;
                ssapIds.length = 0;
                ssapArmed = true;
              }
              realPush.call(ssapSegments, item);
              realPush.call(ssapIds, item.id);
            }
          }
        } catch (_) {}
        return Reflect.apply(target, thisArg, args);
      },
    });
    var ssapPushRestoreTimer = 0;
    restoreSsapPushCapture = function () {
      if (ssapPushRestoreTimer) {
        try { clearTimeout(ssapPushRestoreTimer); } catch (_) {}
        ssapPushRestoreTimer = 0;
      }
      // Do not overwrite a newer page patch installed after ours.
      if (Array.prototype.push === ssapPushProxy) Array.prototype.push = realPush;
    };
    installSsapPushCapture = function () {
      if (!masterEnabled()) return;
      // Array#push is one of the hottest methods on any page, and routing every
      // call on YouTube through a Proxy costs 15.6ns -> 41.5ns each, measured.
      // The capture can only ever collect something while this experiment flag
      // is on, so when the page config has already loaded and says it is off,
      // installing would slow down every push on the page for ten seconds to
      // collect nothing. Before the config arrives we genuinely cannot tell, and
      // catching the early pushes is the whole point, so that case is unchanged
      // -- this only skips the installs we can prove are pointless, which
      // includes every yt-navigate-start within a mix, where config is loaded.
      var ssapFlags = window.yt && window.yt.config_ && window.yt.config_.EXPERIMENT_FLAGS;
      if (ssapFlags && !ssapFlags.html5_enable_ssap_entity_id) return;
      if (Array.prototype.push !== realPush && Array.prototype.push !== ssapPushProxy) return;
      restoreSsapPushCapture();
      Array.prototype.push = ssapPushProxy;
      try {
        if (typeof realTimeout !== "function") throw new Error("timeout unavailable");
        ssapPushRestoreTimer = realTimeout(restoreSsapPushCapture, 10000);
        // Node-based regression harnesses should not be kept alive by the
        // browser-only startup watchdog.
        if (ssapPushRestoreTimer && typeof ssapPushRestoreTimer.unref === "function") {
          ssapPushRestoreTimer.unref();
        }
      } catch (_) {
        // Never leave a page-wide prototype hook installed without a working
        // watchdog to remove it.
        restoreSsapPushCapture();
      }
    };
    installSsapPushCapture();
    window.addEventListener("yt-navigate-start", function () {
      ssapSegments.length = 0;
      ssapIds.length = 0;
      ssapArmed = false;
      lastJumpKey = "";
      installSsapPushCapture();
    });
    window.addEventListener("pagehide", restoreSsapPushCapture, { once: true });
    document.addEventListener("DOMContentLoaded", function () {
      try {
        if (!masterEnabled()) return;
        if (!(window.yt && window.yt.config_ && window.yt.config_.EXPERIMENT_FLAGS &&
            window.yt.config_.EXPERIMENT_FLAGS.html5_enable_ssap_entity_id)) return;
        var check = function () {
          try {
            var video = document.querySelector("video");
            if (!video || !ssapSegments.length) return;
            var duration = Math.round(video.duration);
            var last = ssapSegments[ssapSegments.length - 1];
            var end = Math.round(last.end / 1000);
            var key = ssapIds.join(",");
            if (pageUrl !== document.location.href) {
              pageUrl = document.location.href;
              ssapSegments.length = 0;
              ssapIds.length = 0;
              ssapArmed = false;
              return;
            }
            if (duration && duration === end && ((!video.loop && lastJumpKey !== key) || video.loop)) {
              var start = last.start / 1000;
              if (video.currentTime < start) {
                video.currentTime = start;
                ssapArmed = false;
                lastJumpKey = key;
              }
            }
          } catch (_) {}
        };
        check();
        var checkQueued = false;
        var queueCheck = function () {
          if (checkQueued) return;
          checkQueued = true;
          setTimeout(function () {
            checkQueued = false;
            check();
          }, 150);
        };
        new MutationObserver(queueCheck).observe(document, { childList: true, subtree: true });
      } catch (_) {}
    });
  } catch (_) {}

  try {
    var realCall = Function.prototype.call;
    var sawSnapshot = false;
    var backoffDetected = false;
    var restoredCall = false;
    var restoreCall = function () {
      try {
        if (!restoredCall) {
          Function.prototype.call = realCall;
          restoredCall = true;
        }
      } catch (_) {}
    };
    var hasBackoffTime = function (root) {
      if (!isObject(root)) return false;
      var stack = [{ obj: root, depth: 0 }];
      var seen = new WeakSet();
      while (stack.length) {
        var entry = stack.pop();
        var obj = entry.obj;
        if (!isObject(obj) || seen.has(obj) || entry.depth > 5) continue;
        seen.add(obj);
        if (own(obj, "backoffTimeMs")) return obj.backoffTimeMs !== undefined;
        for (var key in obj) {
          if (!own(obj, key)) continue;
          var value = obj[key];
          if (isObject(value) && !seen.has(value)) stack.push({ obj: value, depth: entry.depth + 1 });
        }
      }
      return false;
    };
    Function.prototype.call = new Proxy(realCall, {
      apply: function (target, thisArg, args) {
        if (!masterEnabled()) return Reflect.apply(target, thisArg, args);
        try {
          var first = args && args[0];
          if (first && first.requestNumber && first.snapshot) {
            sawSnapshot = true;
            backoffDetected = hasBackoffTime(first);
            if (backoffDetected) restoreCall();
          }
        } catch (_) {}
        return Reflect.apply(target, thisArg, args);
      },
    });
    window.addEventListener("load", function () {
      restoreCall();
      if (!masterEnabled()) return;
      // Reloading is a last-resort recovery for an observed transport backoff.
      // If YouTube changed the snapshot shape (or no snapshot was seen), a
      // speculative reload only restarts healthy playback and adds delay.
      if (!backoffDetected) return;
      try {
        var query = window.location.search;
        var videoId = new URLSearchParams(query).get("v");
        if (!videoId) return;
        var waitUntilPlayer = function (selector, interval, timeout) {
          return new Promise(function (resolve) {
            var end = Date.now() + timeout;
            var tick = function () {
              var found = document.querySelector(selector);
              if (found || Date.now() > end) resolve(found || null);
              else setTimeout(tick, interval);
            };
            tick();
          });
        };
        waitUntilPlayer("#movie_player", 200, 10000).then(function (mp) {
          if (!mp || typeof mp.loadVideoById !== "function") return;
          var t = new URLSearchParams(query).get("t") || "0";
          try {
            mp.loadVideoById(videoId, parseInt(t, 10));
          } catch (_) {}
        });
      } catch (_) {}
    });
  } catch (_) {}

  try {
    var flagTimer = setInterval(function () {
      try {
        if (!masterEnabled()) {
          clearInterval(flagTimer);
          return;
        }
        if (window.ytcfg && ytcfg.data_ && ytcfg.data_.EXPERIMENT_FLAGS) {
          ytcfg.data_.EXPERIMENT_FLAGS.web_streaming_watch = false;
          clearInterval(flagTimer);
        }
      } catch (_) {}
    }, 200); // PERF: 50ms was needlessly tight on weak CPUs; flag is read once early. Still bounded by the 5s deadline below.
    setTimeout(function () { try { clearInterval(flagTimer); } catch (_) {} }, 5000);
  } catch (_) {}

  function removeCosmetics() {
    try {
      if (cosmeticStyle && cosmeticStyle.parentNode) cosmeticStyle.parentNode.removeChild(cosmeticStyle);
      cosmeticStyle = null;
    } catch (_) {}
  }

  function applyCosmetics() {
    if (!masterEnabled() || cosmeticStyle) return;
    try {
    var css =
      "ytd-ad-slot-renderer,ytd-in-feed-ad-layout-renderer,ytd-display-ad-renderer," +
      "ytd-promoted-sparkles-web-renderer,ytd-promoted-video-renderer," +
      "ytd-companion-slot-renderer,ytd-action-companion-ad-renderer," +
      "ytd-banner-promo-renderer,#masthead-ad,#player-ads," +
      "ytm-promoted-sparkles-web-renderer,ytm-companion-slot-renderer" +
      "{display:none!important}";
    var style = document.createElement("style");
    style.textContent = css;
    (document.head || document.documentElement).appendChild(style);
      cosmeticStyle = style;
    } catch (_) {}
  }

  applyCosmetics();
  window.__wardenOneYouTubeReadyVersion = YT_MODULE_VERSION;
})();
