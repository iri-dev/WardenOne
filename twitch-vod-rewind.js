/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
// WardenOne — Twitch "watch from earlier" (live VOD rewind)
//
// The chunk-URL walk-back approach is impossible on Twitch (segment URLs are
// opaque signed tokens, not a walkable index). But when a streamer has "Store
// past broadcasts" enabled, Twitch is already recording the whole stream to a
// VOD in real time, and that VOD is seekable from minute zero WHILE the stream
// is still live. So instead of reconstructing anything, we just find that
// in-progress VOD's id and hand the viewer off to Twitch's own VOD player at the
// moment they joined (or earlier) — real quality, full seekbar, no transmuxing.
//
// This file is dual-mode: require()d in Node it exports the pure helpers for the
// test suite; loaded as a content script (ISOLATED world, twitch.tv, top frame)
// it runs the runtime.
(function () {
  'use strict';

  // ---- Pure, testable helpers ------------------------------------------

  // First-path-segments that are Twitch routes, not channel logins.
  var RESERVED_ROUTES = {
    '': 1, 'directory': 1, 'videos': 1, 'video': 1, 'settings': 1, 'u': 1,
    'subscriptions': 1, 'wallet': 1, 'inventory': 1, 'drops': 1, 'friends': 1,
    'messages': 1, 'prime': 1, 'turbo': 1, 'bits': 1, 'store': 1, 'downloads': 1,
    'jobs': 1, 'p': 1, 'popout': 1, 'moderator': 1, 'search': 1, 'following': 1,
    'clips': 1, 'collections': 1, 'team': 1, 'communities': 1, 'dashboard': 1,
    'broadcast': 1, 'products': 1, 'redeem': 1, 'activate': 1, 'creatorcamp': 1,
    'partner': 1, 'privacy': 1, 'admin': 1, 'user': 1, 'login': 1, 'signup': 1,
    'help': 1, 'about': 1, 'payments': 1, 'event': 1, 'events': 1, 'wiki': 1
  };

  // Return the channel login from a pathname, or null if it isn't a channel page.
  function parseChannelLogin(pathname) {
    if (typeof pathname !== 'string') return null;
    var parts = pathname.split('/');
    var seg = '';
    for (var i = 0; i < parts.length; i++) { if (parts[i]) { seg = parts[i]; break; } }
    seg = seg.toLowerCase();
    if (!seg || RESERVED_ROUTES[seg]) return null;
    if (!/^[a-z0-9_]{1,25}$/.test(seg)) return null;
    return seg;
  }

  // Twitch VOD ?t= wants an XhYmZs string.
  function formatVodTime(seconds) {
    var s = Math.max(0, Math.floor(Number(seconds) || 0));
    var h = Math.floor(s / 3600);
    var m = Math.floor((s % 3600) / 60);
    var sec = s % 60;
    return h + 'h' + m + 'm' + sec + 's';
  }

  function isoDiffSeconds(a, b) {
    var ta = Date.parse(a), tb = Date.parse(b);
    if (isNaN(ta) || isNaN(tb)) return Infinity;
    return Math.abs(ta - tb) / 1000;
  }

  // Decide from a GQL user response whether a seekable live VOD exists. The
  // in-progress broadcast's archive shares the stream's start time, which lets
  // us tell "this VOD is the current stream" from "the newest saved VOD is an
  // old broadcast" (i.e. this streamer isn't saving the current one).
  function pickLiveVod(data, toleranceSec) {
    var tol = typeof toleranceSec === 'number' ? toleranceSec : 900;
    var user = data && data.user;
    if (!user) return { available: false, reason: 'no-user' };
    if (!user.stream) return { available: false, reason: 'offline' };
    var edges = user.videos && user.videos.edges;
    var node = edges && edges[0] && edges[0].node;
    if (!node || !node.id) return { available: false, reason: 'no-vod' };
    if (user.stream.createdAt && node.createdAt &&
        isoDiffSeconds(user.stream.createdAt, node.createdAt) > tol) {
      return { available: false, reason: 'stale-vod' };
    }
    return {
      available: true,
      id: String(node.id),
      lengthSeconds: Math.max(0, Math.floor(Number(node.lengthSeconds) || 0)),
      createdAt: node.createdAt || null
    };
  }

  // Seconds into the VOD for each rewind choice. joinLen = VOD length when the
  // viewer arrived (≈ their join point); elapsedSec = seconds on the page since.
  function computeSeekSeconds(kind, vod, elapsedSec, leadSec) {
    var joinLen = Math.max(0, Math.floor((vod && vod.lengthSeconds) || 0));
    var elapsed = Math.max(0, Math.floor(elapsedSec || 0));
    var lead = typeof leadSec === 'number' ? leadSec : 90;
    var liveEdge = joinLen + elapsed;
    switch (kind) {
      case 'join': return Math.max(0, joinLen - lead);
      case 'back10': return Math.max(0, liveEdge - 600);
      case 'back30': return Math.max(0, liveEdge - 1800);
      case 'back60': return Math.max(0, liveEdge - 3600);
      case 'start': return 0;
      default: return Math.max(0, joinLen - lead);
    }
  }

  function vodUrl(id, seconds) {
    return 'https://www.twitch.tv/videos/' + encodeURIComponent(id) + '?t=' + formatVodTime(seconds);
  }

  var api = {
    parseChannelLogin: parseChannelLogin,
    formatVodTime: formatVodTime,
    isoDiffSeconds: isoDiffSeconds,
    pickLiveVod: pickLiveVod,
    computeSeekSeconds: computeSeekSeconds,
    vodUrl: vodUrl
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
    return;
  }

  // ---- Browser runtime --------------------------------------------------

  if (typeof window === 'undefined' || window.top !== window) return;
  const WO_GUARD_VERSION = '1.0.0';
  /* Chrome does not re-inject into tabs that are already open when the extension updates, so a
     tab that outlives an update keeps this script's old copy. A bare boolean flag made that
     permanent -- the new copy saw a truthy flag and returned, so Repair could never re-arm the
     tab, only report honestly that it could not. Comparing versions lets a newer copy replace an
     older one, and it must release the old one's listeners, observers and timers first or both
     copies stay live and are charged for the same work. */
  if (window.__wardenOneVodRewind === WO_GUARD_VERSION) return;
  if (window.__wardenOneVodRewind) {
    try {
      if (typeof window.__wardenOneVodRewindDispose === 'function') window.__wardenOneVodRewindDispose();
    } catch (_) {}
  }
  window.__wardenOneVodRewind = WO_GUARD_VERSION;

  /* Everything this copy holds, so the next one can let it go. Listeners ride a single abort
     signal; observers and intervals are collected; timeouts remove their own id when they fire,
     so a self-rescheduling loop cannot grow this set without bound. */
  const woAbort = new AbortController();
  const woKeep = [];
  const woPending = new Set();
  const woHold = (item) => { woKeep.push(item); return item; };
  const woOn = (target, type, fn, opts) => {
    const base = (opts && typeof opts === 'object')
      ? Object.assign({}, opts)
      : (opts === true ? { capture: true } : {});
    base.signal = woAbort.signal;
    try { target.addEventListener(type, fn, base); } catch (_) {}
  };
  const woObserver = (...a) => woHold(new MutationObserver(...a));
  const woInterval = (...a) => woHold(setInterval(...a));
  /* A normal function, not an arrow: three call sites pass function-keyword callbacks, and
     forwarding `this` keeps them behaving exactly as the host would call them. */
  const woTimeout = (fn, ms, ...rest) => {
    let id;
    id = setTimeout(function (...a) {
      woPending.delete(id);
      return typeof fn === 'function' ? fn.apply(this, a) : undefined;
    }, ms, ...rest);
    woPending.add(id);
    return id;
  };
  // Chrome's extension events are not DOM events: they are not covered by the abort signal above
  // and they have no equivalent of removeEventListener-by-signal. Repair reinstalls this script in
  // every frame, so a listener registered here and never removed accumulates one more copy per
  // Repair -- and every copy answers, so old and new bridges race on form and media health.
  //
  // The exact callback reference has to be kept, because removeListener matches by identity.
  const woChromeListeners = [];
  const woOnMessage = (fn) => {
    try {
      woOnMessage(fn);
      woChromeListeners.push([chrome.runtime.onMessage, fn]);
    } catch (_) {}
    return fn;
  };

  window.__wardenOneVodRewindDispose = () => {
    try { woAbort.abort(); } catch (_) {}
    woPending.forEach((id) => { try { clearTimeout(id); } catch (_) {} });
    woPending.clear();
    const held = woKeep.splice(0, woKeep.length);
    for (const item of held) {
      try {
        if (item && typeof item.disconnect === 'function') item.disconnect();
        else clearInterval(item);
      } catch (_) {}
    }
    const chromeHeld = woChromeListeners.splice(0, woChromeListeners.length);
    for (const [event, fn] of chromeHeld) {
      try { event.removeListener(fn); } catch (_) {}
    }
  };

  // Public Twitch web client id — the same one the site sends for anonymous
  // reads. We only read public video metadata; we never request a playback
  // token, so no auth/integrity is involved and no user session is touched.
  var CLIENT_ID = 'kimne78kx3ncx6brgo4mv6wki5h1ko';
  var QUERY = 'query WWVodRewind($login: String!) {' +
    ' user(login: $login) { id login stream { id createdAt }' +
    ' videos(first: 1, sort: TIME, type: ARCHIVE) { edges { node { id lengthSeconds createdAt } } } } }';

  var enabled = false;
  var started = false;
  var currentLogin = null;
  var vod = null;          // last pickLiveVod result when available
  var detectTime = 0;      // Date.now() at detection (≈ when viewer joined)
  var checking = false;
  var retryAt = 0;
  var requestGeneration = 0;
  var requestController = null;
  var requestTimer = 0;
  var scanTimer = 0;
  var button = null;
  var popover = null;
  var styleEl = null;

  // Plain-English diagnostics so it's never a mystery why the button is/ isn't
  // there. Open DevTools console (F12) and filter for "WardenOne Rewind".
  // console.debug, not console.info: every caller below runs unconditionally, once per channel
  // visit, so at info level a normal Twitch session printed WardenOne's diagnostics into the page
  // console of a site we do not own. debug is hidden at Chrome's default log level and still there
  // under Verbose, which is where someone diagnosing this feature would be looking anyway.
  function report(msg) { try { console.debug('[WardenOne Rewind] ' + msg); } catch (_) {} }

  function ensureStyle() {
    if (styleEl || !document.documentElement) return;
    styleEl = document.createElement('style');
    styleEl.id = 'wardenone-vod-rewind-style';
    styleEl.textContent = [
      '.wo-vodr-btn{display:inline-flex;align-items:center;justify-content:center;height:30px;min-width:30px;padding:0 8px;margin:0 2px;border:0;background:transparent;color:#efeff1;cursor:pointer;border-radius:4px;font:600 12px/1 Inter,Roobert,Helvetica,Arial,sans-serif;position:relative}',
      '.wo-vodr-btn:hover{background:rgba(255,255,255,.16)}',
      '.wo-vodr-btn svg{width:20px;height:20px;fill:currentColor;flex:none}',
      '.wo-vodr-btn .wo-vodr-lbl{margin-left:6px;white-space:nowrap}',
      '.wo-vodr-pop{position:absolute;bottom:40px;left:0;background:#18181b;border:1px solid rgba(255,255,255,.15);border-radius:6px;padding:6px;min-width:210px;box-shadow:0 6px 24px rgba(0,0,0,.5);z-index:2147483000;display:none;flex-direction:column;gap:2px}',
      '.wo-vodr-pop.open{display:flex}',
      '.wo-vodr-title{color:#adadb8;font:600 11px/1.4 Inter,Helvetica,Arial,sans-serif;padding:4px 8px 6px;text-transform:uppercase;letter-spacing:.04em}',
      '.wo-vodr-opt{display:flex;flex-direction:column;align-items:flex-start;gap:2px;background:transparent;border:0;color:#efeff1;text-align:left;padding:8px 10px;border-radius:4px;cursor:pointer;font:600 13px/1.2 Inter,Helvetica,Arial,sans-serif;width:100%}',
      '.wo-vodr-opt:hover{background:rgba(145,71,255,.25)}',
      '.wo-vodr-opt .wo-vodr-sub{color:#adadb8;font-weight:400;font-size:11px}',
      '.wo-vodr-note{color:#adadb8;font:400 11px/1.4 Inter,Helvetica,Arial,sans-serif;padding:8px 10px 4px;border-top:1px solid rgba(255,255,255,.1);margin-top:4px}'
    ].join('\n');
    document.documentElement.appendChild(styleEl);
  }

  // Counter-clockwise "rewind to earlier" arrow, built as real DOM nodes (no
  // innerHTML anywhere in this file, matching the extension's sink policy).
  var SVG_NS = 'http://www.w3.org/2000/svg';
  function makeIcon() {
    var svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 20 20');
    svg.setAttribute('aria-hidden', 'true');
    var path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', 'M10 3a7 7 0 1 1-6.32 4h1.7A5.3 5.3 0 1 0 10 4.7V7L6 3.9 10 1v2z');
    svg.appendChild(path);
    return svg;
  }

  function findControlGroup() {
    return document.querySelector('.player-controls__left-control-group');
  }

  function elapsedSeconds() {
    return detectTime ? (Date.now() - detectTime) / 1000 : 0;
  }

  function closePopover() { if (popover) popover.classList.remove('open'); }

  function openVod(kind) {
    if (!vod || !vod.available) return;
    var t = computeSeekSeconds(kind, vod, elapsedSeconds());
    var a = document.createElement('a');
    a.href = vodUrl(vod.id, t);
    a.target = '_blank';
    a.rel = 'noopener';
    (document.body || document.documentElement).appendChild(a);
    a.click();
    if (a.parentNode) a.parentNode.removeChild(a);
    closePopover();
  }

  function buildPopover() {
    var pop = document.createElement('div');
    pop.className = 'wo-vodr-pop';
    var title = document.createElement('div');
    title.className = 'wo-vodr-title';
    title.textContent = 'Rewind this stream';
    pop.appendChild(title);
    [
      { kind: 'join', label: 'From when you joined', sub: 'catch what you missed' },
      { kind: 'back30', label: '30 minutes back', sub: '' },
      { kind: 'start', label: 'From the start', sub: 'the whole broadcast' }
    ].forEach(function (o) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'wo-vodr-opt';
      var main = document.createElement('span');
      main.textContent = o.label;
      b.appendChild(main);
      if (o.sub) {
        var sub = document.createElement('span');
        sub.className = 'wo-vodr-sub';
        sub.textContent = o.sub;
        b.appendChild(sub);
      }
      woOn(b, 'click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        openVod(o.kind);
      });
      pop.appendChild(b);
    });
    // Sub-only VODs can't be detected reliably from Twitch's public API, so we
    // set the expectation once, always: if this streamer locks VODs to subs,
    // Twitch itself shows a clear "subscribe to watch" prompt on open.
    var note = document.createElement('div');
    note.className = 'wo-vodr-note';
    note.textContent = 'If a streamer keeps past broadcasts for subscribers, Twitch will show a subscribe prompt.';
    pop.appendChild(note);
    return pop;
  }

  function buildButton() {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'wo-vodr-btn';
    btn.setAttribute('aria-label', 'Rewind this stream to earlier');
    btn.title = 'Watch from earlier in this stream (opens the broadcast VOD)';
    btn.appendChild(makeIcon());
    var lbl = document.createElement('span');
    lbl.className = 'wo-vodr-lbl';
    lbl.textContent = 'Rewind';
    btn.appendChild(lbl);
    popover = buildPopover();
    btn.appendChild(popover);
    woOn(btn, 'click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      popover.classList.toggle('open');
    });
    return btn;
  }

  function mountButton() {
    if (button && button.isConnected) return;
    var group = findControlGroup();
    if (!group) return;
    ensureStyle();
    if (!button) button = buildButton();
    group.appendChild(button);
  }

  function unmount() {
    closePopover();
    if (button && button.parentNode) button.parentNode.removeChild(button);
  }

  var REQUEST_TIMEOUT_MS = 7000;
  var TRANSIENT_RETRY_MS = 15000;

  function gql(query, login, signal) {
    return fetch('https://gql.twitch.tv/gql', {
      method: 'POST',
      headers: { 'Client-Id': CLIENT_ID, 'Content-Type': 'text/plain;charset=UTF-8' },
      body: JSON.stringify({ query: query, variables: { login: login } }),
      credentials: 'omit',
      signal: signal
    }).then(function (r) {
      if (!r.ok) throw new Error('Twitch request failed (HTTP ' + r.status + ')');
      return r.json();
    });
  }

  var REASONS = {
    'offline': 'the streamer is offline right now — there is no live broadcast to rewind',
    'no-vod': "no saved broadcast is listed yet for this stream — retrying in 60s",
    'stale-vod': "this streamer isn't saving the current broadcast (past broadcasts off, or subs-only listing) — nothing to rewind to",
    'no-user': 'Twitch returned no channel for this page',
    'no-data': 'the Twitch data request came back empty (query may have failed)'
  };

  function cancelQuery() {
    requestGeneration += 1;
    checking = false;
    if (requestTimer) { clearTimeout(requestTimer); requestTimer = 0; }
    if (requestController) {
      try { requestController.abort(); } catch (_) {}
      requestController = null;
    }
  }

  function finishQuery(generation) {
    if (generation !== requestGeneration) return false;
    if (requestTimer) { clearTimeout(requestTimer); requestTimer = 0; }
    requestController = null;
    checking = false;
    return true;
  }

  function queryVod(login) {
    if (checking || !enabled || login !== currentLogin) return;
    checking = true;
    var generation = ++requestGeneration;
    requestController = typeof AbortController === 'function' ? new AbortController() : null;
    var signal = requestController ? requestController.signal : undefined;
    requestTimer = woTimeout(function () {
      if (generation !== requestGeneration) return;
      if (requestController) {
        try { requestController.abort(); } catch (_) {}
      }
    }, REQUEST_TIMEOUT_MS);
    report('checking "' + login + '" for a live broadcast…');
    gql(QUERY, login, signal).then(function (json) {
      if (!finishQuery(generation) || login !== currentLogin || !enabled) return;
      var result = json && json.data ? pickLiveVod(json.data) : { available: false, reason: 'no-data' };
      if (result.available) {
        vod = result;
        detectTime = Date.now();
        retryAt = 0;
        mountButton();
        report('✓ live VOD found for "' + login + '" — Rewind button shown');
      } else {
        vod = null;
        unmount();
        report('button hidden for "' + login + '": ' + (REASONS[result.reason] || result.reason));
        // Live but the VOD isn't listed yet? Give it one more try shortly.
        if (result.reason === 'no-vod' || result.reason === 'stale-vod') retryAt = Date.now() + 60000;
      }
    }).catch(function (err) {
      if (!finishQuery(generation) || login !== currentLogin || !enabled) return;
      retryAt = Date.now() + TRANSIENT_RETRY_MS;
      report('button hidden for "' + login + '": the Twitch request failed (' + (err && err.message || err) + ')');
    });
  }

  function scan() {
    if (!enabled) return;
    var login = parseChannelLogin(location.pathname);
    if (login !== currentLogin) {
      cancelQuery();
      currentLogin = login;
      vod = null; detectTime = 0; retryAt = 0;
      unmount();
      if (login) queryVod(login);
      return;
    }
    if (!login) return;
    if (vod && vod.available) { mountButton(); return; } // survive Twitch's DOM churn
    if (!checking && retryAt && Date.now() >= retryAt) { retryAt = 0; queryVod(login); }
  }

  function onDocClick(e) {
    if (!popover || !popover.classList.contains('open')) return;
    if (button && !button.contains(e.target)) closePopover();
  }

  function start() {
    if (started) return;
    started = true;
    scan();
    scanTimer = woInterval(scan, 1500);
    woOn(document, 'click', onDocClick, true);
  }

  function shutdown() {
    started = false;
    if (scanTimer) { clearInterval(scanTimer); scanTimer = 0; }
    cancelQuery();
    document.removeEventListener('click', onDocClick, true);
    currentLogin = null; vod = null; detectTime = 0; retryAt = 0;
    unmount();
  }

  function applyConfig(config) {
    var next = !!(config && config.enabled !== false && config.twitchVodRewind !== false);
    if (next === enabled) return;
    enabled = next;
    report(next ? 'feature ON — will show the Rewind button on live streams that save broadcasts' : 'feature OFF (toggle disabled in the popup)');
    if (enabled) start(); else shutdown();
  }

  try {
    chrome.storage.local.get('wardenone_config', function (result) {
      applyConfig(result && result.wardenone_config);
    });
    chrome.storage.onChanged.addListener(function (changes, area) {
      if (area === 'local' && changes.wardenone_config) applyConfig(changes.wardenone_config.newValue || {});
    });
  } catch (_) {}
  woOn(window, 'pagehide', shutdown, { once: true });
})();
