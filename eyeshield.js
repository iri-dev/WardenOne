/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/* WardenOne EyeShield: dynamic site theming (dark / ultra / light / brightness)
 *
 * Instead of slapping `filter: invert()` on <html> (which negative-izes every
 * image and washes everything to muddy mid-grays), we rewrite the COLOR VALUES
 * inside the page's own stylesheets (CSSOM), its CSS custom properties, and any
 * inline style="" colors. Each color is transformed by ROLE:
 *   - foreground (text/icons) -> pushed bright   (high contrast on dark)
 *   - background/surfaces     -> pushed dark
 *   - borders                 -> kept subtle
 * Hue is preserved; images/video/canvas are never touched.
 *
 * Modes:
 *   dark  : remap a light page to a comfortable dark theme.
 *   ultra : like dark, but OLED-black backgrounds with still-readable text.
 *   light : remap a dark page to light.
 *   off   : no color change.
 * Already-dark pages are left alone in dark/ultra; already-light pages are left
 * alone in light. Brightness is a separate full-screen dim scrim (no filter).
 */
(function () {
  'use strict';

  const WO_GUARD_VERSION = '1.0.1';
  /* Chrome does not re-inject into tabs that are already open when the extension updates, so a
     tab that outlives an update keeps this script's old copy. A bare boolean flag made that
     permanent -- the new copy saw a truthy flag and returned, so Repair could never re-arm the
     tab, only report honestly that it could not. A same-version re-injection still refreshes,
     which is what this guard has always done and what the popup relies on; an older copy is now
     released first instead of being left running alongside its replacement. */
  if (window.__wardenOneEyeShieldInstalled === WO_GUARD_VERSION) {
    try {
      if (typeof window.__wardenOneEyeShieldRefresh === 'function') window.__wardenOneEyeShieldRefresh();
    } catch (e) {}
    return;
  }
  if (window.__wardenOneEyeShieldInstalled) {
    try {
      if (typeof window.__wardenOneEyeShieldDispose === 'function') window.__wardenOneEyeShieldDispose();
    } catch (_) {}
  }
  window.__wardenOneEyeShieldInstalled = WO_GUARD_VERSION;

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
      chrome.runtime.onMessage.addListener(fn);
      woChromeListeners.push([chrome.runtime.onMessage, fn]);
    } catch (_) {}
    return fn;
  };

  window.__wardenOneEyeShieldDispose = () => {
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
  window.__wardenOneEyeShieldVersion = 'chroma+bgtent+selection+clipguard+varrole-darksite+semantic-controls+managed-chatgpt+twitch-managed+google-autocomplete-light+google-frame-light-native-nav+google-native-search+yt-native-subscribe-join-notifications+twitch-native-player-range+comments+popup-eye+force-cleanup+twitch-player-surface-guard+reddit-managed+reddit-inbox-search-fix+amazon-managed+amazon-polish+amazon-specificity-is-wrapper+amazon-dcl-navassistant+skip-ext-twitch-overlay+github-cta-green+github-floatlabel-placeholder+suppress-nonfocus-outlines+no-invented-surface-box+flatten-shell-app+discord-native-theme-all-elements+spotify-encore-vars-theme+spotify-light-shell-repair+spotify-light-polish+spotify-player-gap-fade-fix+spotify-blank-revert+spotify-player-shadow-rightwash+spotify-right-art-shadow+spotify-right-text-bg+spotify-right-title-overlay+spotify-light-home-filters+spotify-light-root-shell-gaps+common-site-contrast-fixes+yt-consent-x-auth-fixes+spotify-sidebar-legal-light+site-profile-lazy-eyeshield+skip-wardenone-owned-ui+readability-guard-v2+twitch-video-scoped-adjust+yt-native-player-controls+contrast-guard-skips-player-chrome';

  // Twitch EXTENSION overlay iframes (*.ext-twitch.tv) sit transparently ON TOP of the
  // stream <video>. They are NOT matched by isTwitchHost() (the "-twitch.tv" suffix), so
  // they fell through to the GENERIC remap, whose forced html/body background made the
  // overlay OPAQUE and covered the stream with black — but only on streams that actually
  // run an overlay extension, hence "not every stream". Never theme these frames: bail so
  // EyeShield is a complete no-op here and the overlay stays transparent over the video.
  if (/(^|\.)ext-twitch\.tv$/i.test(String(location.hostname || '').toLowerCase())) return;
  const compatibilityHost = String(location.hostname || '').toLowerCase();
  if (/^(drive|docs|mail|calendar|classroom|meet|chat|myaccount)\.google\.com$/i.test(compatibilityHost)
      || /(^|\.)ucas\.com$/i.test(compatibilityHost)
      || /\.ac\.uk$|\.edu$|\.edu\.au$|\.ac\.nz$|\.ac\.za$|\.ac\.in$|\.edu\.sg$|\.edu\.hk$/i.test(compatibilityHost)) return;

  const THEME_ID = 'wardenone-eyeshield-theme';
  const SCRIM_ID = 'wardenone-eyeshield-scrim';
  const ADJUST_ID = 'wardenone-eyeshield-adjust';
  const PRELOAD_ID = 'wardenone-eyeshield-preload';
  const MODE_CACHE_KEY = '__woEyeShieldMode';
  const DEFAULTS = {
    enabled: true,
    eyeShieldMode: 'off',
    eyeShieldBrightness: 100,
    eyeShieldBrightnessByHost: {},
    eyeShieldContrast: 100,
    eyeShieldContrastByHost: {},
    eyeShieldSaturation: 100,
    eyeShieldSaturationByHost: {},
    eyeShieldWarmth: 0,
    eyeShieldWarmthByHost: {},
    eyeShieldGrayscale: 0,
    eyeShieldGrayscaleByHost: {},
  };

  const BASE_BG = { dark: '#16181a', ultra: '#000000', light: '#f7f8fb' };
  const YOUTUBE_HOST_RE = /(^|\.)youtube(-nocookie)?\.com$|(^|\.)youtu\.be$/i;
  const TWITCH_HOST_RE = /(^|\.)twitch\.tv$/i;
  const CHATGPT_HOST_RE = /(^|\.)chatgpt\.com$|(^|\.)chat\.openai\.com$/i;
  const GOOGLE_HOST_RE = /(^|\.)google\.[a-z.]+$/i;
  const GITHUB_HOST_RE = /(^|\.)github\.com$/i;
  const STACKOVERFLOW_HOST_RE = /(^|\.)stackoverflow\.com$|(^|\.)stackexchange\.com$|(^|\.)superuser\.com$|(^|\.)serverfault\.com$|(^|\.)askubuntu\.com$/i;
  const HACKERNEWS_HOST_RE = /^news\.ycombinator\.com$/i;
  const WIKIPEDIA_HOST_RE = /(^|\.)wikipedia\.org$/i;
  const REDDIT_HOST_RE = /(^|\.)reddit\.com$/i;
  const AMAZON_HOST_RE = /(^|\.)amazon\.[a-z.]+$/i;

  function isYouTubeHost() {
    return YOUTUBE_HOST_RE.test(String(location.hostname || '').toLowerCase());
  }

  function isTwitchHost() {
    return TWITCH_HOST_RE.test(String(location.hostname || '').toLowerCase());
  }

  function isChatGPTHost() {
    return CHATGPT_HOST_RE.test(String(location.hostname || '').toLowerCase());
  }

  function isGoogleHost() {
    const host = String(location.hostname || '').toLowerCase();
    if (/^(drive|docs|mail|calendar|classroom|meet|chat|myaccount)\.google\.com$/i.test(host)) return false;
    if (GOOGLE_HOST_RE.test(host)) return true;
    if (host) return false;
    try {
      const refHost = document.referrer ? new URL(document.referrer).hostname.toLowerCase() : '';
      if (/^(drive|docs|mail|calendar|classroom|meet|chat|myaccount)\.google\.com$/i.test(refHost)) return false;
      return GOOGLE_HOST_RE.test(refHost);
    } catch (e) {
      return false;
    }
  }

  function isGitHubHost() {
    return GITHUB_HOST_RE.test(String(location.hostname || '').toLowerCase());
  }

  function isStackOverflowHost() {
    return STACKOVERFLOW_HOST_RE.test(String(location.hostname || '').toLowerCase());
  }

  function isHackerNewsHost() {
    return HACKERNEWS_HOST_RE.test(String(location.hostname || '').toLowerCase());
  }

  function isWikipediaHost() {
    return WIKIPEDIA_HOST_RE.test(String(location.hostname || '').toLowerCase());
  }

  function isRedditHost() {
    return REDDIT_HOST_RE.test(String(location.hostname || '').toLowerCase());
  }

  function isAmazonHost() {
    return AMAZON_HOST_RE.test(String(location.hostname || '').toLowerCase());
  }

  function isWardenOneOwnedNode(node) {
    if (!node || node.nodeType !== 1) return false;
    const ownedSel = '#rg-toast-host,#rg-badge-host,#wo-sb-block,#rg-reload-loop,[data-wo-ui="1"]';
    if (node.id === THEME_ID || node.id === SCRIM_ID || node.id === PRELOAD_ID) return true;
    try {
      if (node.matches && node.matches(ownedSel)) return true;
      if (node.closest && node.closest(ownedSel)) return true;
      const root = node.getRootNode && node.getRootNode();
      if (root && root.host && root.host.id === 'rg-badge-host') return true;
    } catch (e) {}
    return false;
  }

  function managedThemeHostName() {
    if (isYouTubeHost()) return 'youtube';
    if (isTwitchHost()) return 'twitch';
    if (isGoogleHost()) return 'google';
    if (isGitHubHost()) return 'github';
    if (isStackOverflowHost()) return 'stackoverflow';
    if (isHackerNewsHost()) return 'hackernews';
    if (isWikipediaHost()) return 'wikipedia';
    if (isChatGPTHost()) return 'chatgpt';
    if (isRedditHost()) return 'reddit';
    if (isAmazonHost()) return 'amazon';
    return '';
  }

  function isManagedThemeHost() {
    return !!managedThemeHostName();
  }

  function needsManagedObserverHost() {
    const host = managedThemeHostName();
    return host === 'youtube' || host === 'google';
  }

  function themeRootsForCurrentHost() {
    return isManagedThemeHost() && !needsManagedObserverHost() ? [document] : rootsList();
  }

  // Anti-flash: the trusted config snapshot is async, so at document_start the page would
  // paint in its native colours (white flash on YouTube etc.) before our theme
  // lands. We cache the last mode in the page's localStorage (synchronous) and
  // paint a dark/light backdrop immediately. Replaced by the real theme once
  // config loads, and removed if the mode turns out to be off.
  try {
    const cached = window.localStorage.getItem(MODE_CACHE_KEY);
    // Discord themes itself via <html> classes (its own light/dark themes) — skip the
    // backdrop preload there so we don't briefly paint over its native theme.
    if (!/(^|\.)discord\.com$|(^|\.)spotify\.com$/i.test(String(location.hostname || '')) &&
        (cached === 'dark' || cached === 'ultra' || cached === 'light')) {
      const pre = document.createElement('style');
      pre.id = PRELOAD_ID;
      pre.textContent = 'html{background-color:' + BASE_BG[cached] + ' !important;color-scheme:'
        + (cached === 'light' ? 'light' : 'dark') + ' !important;}';
      (document.head || document.documentElement).appendChild(pre);
    }
  } catch (e) {}
  function removePreload() { const p = document.getElementById(PRELOAD_ID); if (p) p.remove(); }
  function cacheMode(m) { try { window.localStorage.setItem(MODE_CACHE_KEY, m); } catch (e) {} }

  // Color properties grouped by role.
  const FG = new Set(['color', '-webkit-text-fill-color', 'caret-color', 'text-decoration-color', 'fill', 'stroke', 'stop-color', 'flood-color']);
  const BG = new Set(['background', 'background-color', 'background-image']);
  const BORDER = new Set(['border-color', 'border-top-color', 'border-right-color', 'border-bottom-color', 'border-left-color', 'outline-color', 'column-rule-color']);
  const COLOR_PROPS = [].concat([...FG], [...BG], [...BORDER]);
  const SKIP_VAL = /^(transparent|currentcolor|inherit|initial|unset|revert|none|auto)$/i;

  const NAMED = {
    black: '#000', white: '#fff', red: '#f00', lime: '#0f0', blue: '#00f',
    yellow: '#ff0', cyan: '#0ff', aqua: '#0ff', magenta: '#f0f', fuchsia: '#f0f',
    silver: '#c0c0c0', gray: '#808080', grey: '#808080', maroon: '#800000',
    olive: '#808000', green: '#008000', purple: '#800080', teal: '#008080',
    navy: '#000080', orange: '#ffa500', pink: '#ffc0cb', brown: '#a52a2a',
    gold: '#ffd700', darkgray: '#a9a9a9', darkgrey: '#a9a9a9',
    lightgray: '#d3d3d3', lightgrey: '#d3d3d3', whitesmoke: '#f5f5f5',
    gainsboro: '#dcdcdc', ivory: '#fffff0', beige: '#f5f5dc', azure: '#f0ffff',
    snow: '#fffafa', linen: '#faf0e6',
  };

  // ---------- color math ----------
  function hexToRgb(h) {
    h = h.replace('#', '');
    if (h.length === 3) h = h.split('').map((c) => c + c).join('');
    else if (h.length === 4) { const a = h[3] + h[3]; h = h.slice(0, 3).split('').map((c) => c + c).join('') + a; }
    if (h.length === 6) return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16), 1];
    if (h.length === 8) return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16), parseInt(h.slice(6, 8), 16) / 255];
    return null;
  }
  function rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    let h, s, l = (mx + mn) / 2;
    if (mx === mn) { h = s = 0; }
    else {
      const d = mx - mn;
      s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
      switch (mx) { case r: h = (g - b) / d + (g < b ? 6 : 0); break; case g: h = (b - r) / d + 2; break; default: h = (r - g) / d + 4; }
      h /= 6;
    }
    return [h, s, l];
  }
  function hslToRgb(h, s, l) {
    let r, g, b;
    if (s === 0) { r = g = b = l; }
    else {
      const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
      const f = (t) => { if (t < 0) t += 1; if (t > 1) t -= 1; if (t < 1 / 6) return p + (q - p) * 6 * t; if (t < 1 / 2) return q; if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6; return p; };
      r = f(h + 1 / 3); g = f(h); b = f(h - 1 / 3);
    }
    return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
  }
  function num(s, base) { s = String(s).trim(); return s.endsWith('%') ? parseFloat(s) / 100 * base : parseFloat(s); }
  function pctf(s) { s = String(s).trim(); return s.endsWith('%') ? parseFloat(s) / 100 : parseFloat(s); }
  function alphaF(s) { s = String(s).trim(); return s.endsWith('%') ? parseFloat(s) / 100 : parseFloat(s); }
  function parseFunc(str) {
    // `.*` (not `[^)]*`) so a nested function in the alpha slot is captured too —
    // Tailwind writes `rgb(255 255 255 / var(--tw-text-opacity))`. Modern
    // space + `/` syntax is handled by the separator split below.
    const m = str.match(/^(rgba?|hsla?)\((.*)\)$/i);
    if (!m) return null;
    const t = m[1].toLowerCase();
    const p = m[2].split(/[\s,\/]+/).filter(Boolean);
    let a = p[3] == null ? 1 : alphaF(p[3]);
    if (!Number.isFinite(a)) a = 1; // alpha given as var()/calc -> treat as opaque
    if (t[0] === 'r') return [num(p[0], 255), num(p[1], 255), num(p[2], 255), a];
    const rgb = hslToRgb((((parseFloat(p[0]) % 360) + 360) % 360) / 360, pctf(p[1]), pctf(p[2]));
    return [rgb[0], rgb[1], rgb[2], a];
  }
  function clean(rgba) { return rgba && rgba.length >= 3 && rgba.slice(0, 3).every((n) => !Number.isNaN(n)) ? rgba : null; }
  function clamp01(x) { return x < 0 ? 0 : x > 1 ? 1 : x; }

  // role: 'fg' | 'bg' | 'border'   mode: 'dark' | 'ultra' | 'light'
  //
  // ABSOLUTE mapping by role, NOT lightness inversion. Text is forced into a
  // bright band and backgrounds into a dark band regardless of the input's
  // lightness. This is what makes it look clean whether the page started light
  // OR already dark: a light page's dark text -> bright, and an already-dark
  // page's light text STAYS bright (inversion would wrongly darken it -> the
  // muddy/unreadable bug). Relative ordering within each band is preserved so
  // hierarchy (headings vs body, canvas vs cards) survives.
  function transform(rgba, mode, role) {
    const hsl = rgbToHsl(rgba[0], rgba[1], rgba[2]);
    const l0 = hsl[2];
    let l;
    if (mode === 'light') {
      // Identity-preserving: a page that is already light is left essentially
      // untouched — links keep their colour, white stays white. Only colours
      // that are wrong for a light theme get pulled in: light / on-dark text is
      // darkened, and dark surfaces are lightened. (The old `l0*0.22` crushed
      // every foreground — incl. blue links — to near-black, which made a
      // search page of links look broken.)
      if (role === 'fg') l = l0 > 0.58 ? 0.10 + (1 - l0) * 0.18 : Math.min(l0, 0.36);
      else if (role === 'bg') l = l0 > 0.70 ? Math.max(l0, 0.94) : 0.965 - l0 * 0.10;
      else l = l0 > 0.60 ? Math.max(l0, 0.84) : 0.82 + l0 * 0.12; // subtle light borders
    } else { // dark or ultra: text always bright, surfaces always dark
      if (role === 'fg') {
        // Prominence is DISTANCE FROM MID-TONE, not raw lightness.
        //
        // The old map was one upward line (0.68 + l0*0.22). It only ordered text
        // correctly on a page that started dark. On a light page it ran backwards:
        // Google's body text #202124 (l0 .13, the most important text there is)
        // came out at .71 while its throwaway snippet grey #70757a (l0 .46) came
        // out at .78 -- the least important text rendered BRIGHTER than the most
        // important. It also topped out at .90, so pure white text could never be
        // white; it painted #e5e5e5, which is the "white but not white" that makes
        // a page tiring to read on OLED black.
        //
        // A page's prominent text sits far from its mid-tone: near-black on a
        // light page, near-white on a dark one. Both should land near-white here,
        // and mid-greys -- secondary text either way -- should stay secondary. So
        // the curve is a V: brightest at both ends, dimmest in the middle. That
        // orders text correctly whichever kind of page it came from, and roughly
        // doubles the spread between a page's brightest and dimmest text, which is
        // the hierarchy that was collapsing into one flat wash of grey.
        const top = mode === 'ultra' ? 0.98 : 0.95; // ultra can go brighter: its background is true black
        const mid = mode === 'ultra' ? 0.78 : 0.76;
        const slope = (top - mid) * 2;
        l = l0 <= 0.5 ? top - l0 * slope : mid + (l0 - 0.5) * slope;
      }
      else if (role === 'bg') {
        // Tent curve, NOT a straight crush. The old `l0*0.05` flattened EVERY surface
        // to near-black, so on already-dark pages cards, buttons, chips and Google's
        // AI-Overview highlight all merged into the background (the "flat, not clean
        // like Dark Reader" look). This keeps near-white page surfaces dark while
        // lifting genuinely dark / coloured surfaces into a visible band, so the
        // surface hierarchy survives. The page base is still forced to BASE_BG, so
        // ultra stays OLED-black overall — only sub-surfaces lift slightly.
        l = mode === 'ultra'
          ? (l0 <= 0.5 ? 0.012 + l0 * 0.30 : 0.162 - (l0 - 0.5) * 0.30)
          : (l0 <= 0.5 ? 0.035 + l0 * 0.34 : 0.205 - (l0 - 0.5) * 0.28);
      }
      else l = 0.18 + l0 * 0.12; // borders subtle
    }
    l = clamp01(l);
    let s = hsl[1];
    // Chroma preservation for text. HSL saturation lies at the extremes: a near-white
    // like #eef0ff (Google's AI-Overview headings) reads as s≈1.0, so naively lowering
    // its lightness made the faint tint BLOOM into vivid periwinkle (the "purple
    // headings" bug). Chroma C = s*(1-|2l-1|) is the honest colourfulness; hold the
    // ORIGINAL chroma at the new lightness so near-white stays near-white while a
    // genuinely-coloured link/error keeps its hue. Hue itself is never touched.
    if (role === 'fg') {
      const c0 = s * (1 - Math.abs(2 * l0 - 1));
      const den = 1 - Math.abs(2 * l - 1);
      if (den > 0.0001) s = clamp01(c0 / den);
    }
    if (mode === 'light' && role === 'bg' && s > 0.32) s = 0.32; // clean, low-tint surfaces
    else if (mode === 'light' && role === 'border' && s > 0.24) s = 0.24;
    else if (role === 'bg' && s > 0.5) s = 0.5; // tame loud backgrounds
    const rgb = hslToRgb(hsl[0], s, l);
    const a = rgba[3] == null ? 1 : rgba[3];
    return a >= 1 ? 'rgb(' + rgb[0] + ', ' + rgb[1] + ', ' + rgb[2] + ')'
      : 'rgba(' + rgb[0] + ', ' + rgb[1] + ', ' + rgb[2] + ', ' + (+a.toFixed(3)) + ')';
  }

  const HEX = /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{4}|[0-9a-fA-F]{3})\b/g;
  const FUNC = /(?:rgba?|hsla?)\((?:[^()]+|\([^()]*\))*\)/gi; // allows one nested ( ) e.g. var()
  const NAMEDRE = new RegExp('(?<![\\w-])(' + Object.keys(NAMED).join('|') + ')(?![\\w-])', 'gi');

  // Memoise the colour transform. replaceColors runs for every colour in every CSS rule on every
  // (re)build, and CSS repeats the same values constantly (e.g. dozens of rules use `#fff`/`#333`).
  // transform() is a pure function of (val, mode, role), so caching its output is always correct;
  // the key includes mode+role so switching themes never returns a stale colour. Capped so it
  // can't grow without bound. This is the single biggest CPU cost of the engine on heavy pages.
  let colorMemo = new Map();
  function cssStringEnd(value, start) {
    const quote = value[start];
    let i = start + 1;
    while (i < value.length) {
      if (value[i] === '\\') { i += 2; continue; }
      if (value[i] === quote) return i + 1;
      i++;
    }
    return value.length;
  }
  function cssUrlOpenAt(value, start) {
    if (start > 0 && /[\w-]/.test(value[start - 1])) return -1;
    if (value.slice(start, start + 3).toLowerCase() !== 'url') return -1;
    let i = start + 3;
    while (i < value.length && /\s/.test(value[i])) i++;
    return value[i] === '(' ? i : -1;
  }
  function cssUrlEnd(value, open) {
    let depth = 1;
    let i = open + 1;
    while (i < value.length) {
      const c = value[i];
      if (c === '\\') { i += 2; continue; }
      if (c === '"' || c === "'") { i = cssStringEnd(value, i); continue; }
      if (c === '(') depth++;
      else if (c === ')' && --depth === 0) return i + 1;
      i++;
    }
    return value.length;
  }
  function transformColorTokens(value, mode, role) {
    let out = value.replace(FUNC, (m) => { const c = clean(parseFunc(m)); return c ? transform(c, mode, role) : m; });
    out = out.replace(HEX, (m) => { const c = clean(hexToRgb(m)); return c ? transform(c, mode, role) : m; });
    return out.replace(NAMEDRE, (m) => { const c = clean(hexToRgb(NAMED[m.toLowerCase()])); return c ? transform(c, mode, role) : m; });
  }
  function transformOutsideCssLiterals(value, mode, role) {
    let out = '';
    let plainStart = 0;
    let i = 0;
    while (i < value.length) {
      let protectedEnd = -1;
      const c = value[i];
      if (c === '"' || c === "'") protectedEnd = cssStringEnd(value, i);
      else if (c === 'u' || c === 'U') {
        const open = cssUrlOpenAt(value, i);
        if (open >= 0) protectedEnd = cssUrlEnd(value, open);
      }
      if (protectedEnd < 0) { i++; continue; }
      if (plainStart < i) out += transformColorTokens(value.slice(plainStart, i), mode, role);
      out += value.slice(i, protectedEnd);
      i = protectedEnd;
      plainStart = i;
    }
    if (plainStart < value.length) out += transformColorTokens(value.slice(plainStart), mode, role);
    return out;
  }
  function replaceColors(val, mode, role) {
    if (!val || SKIP_VAL.test(val)) return val;
    const key = mode + '|' + role + '|' + val;
    const hit = colorMemo.get(key);
    if (hit !== undefined) return hit;
    const out = transformOutsideCssLiterals(val, mode, role);
    if (colorMemo.size > 8000) colorMemo.clear();
    colorMemo.set(key, out);
    return out;
  }
  function roleForProp(p) { if (BG.has(p)) return 'bg'; if (BORDER.has(p)) return 'border'; return 'fg'; }
  // Custom properties carry no inherent role; guess from the name, then from the
  // value's own lightness (a near-white var is probably a background, etc.).
  // A custom property carries no inherent role, so we infer one. The reliable
  // signal is USAGE — which kind of property the variable is plugged into
  // (`color:var(--x)` => fg, `background:var(--x)` => bg). buildVarRoles() scans
  // every rule once and tallies this. Name and value-lightness are only weak
  // fallbacks. (Value-lightness alone is WRONG on dark-themed sites: there a
  // light value is the TEXT, not a background — that flipped text/bg roles and
  // made text invisible, e.g. on Google which defaults dark.)
  let varRoles = new Map(); // '--x' -> { fg, bg, border } usage counts
  let varDeps = [];         // [childVar, parentVar]: parentVar's value contains var(childVar)
  const VARRE = /var\(\s*(--[\w-]+)/g;
  function bumpVar(name, role) {
    let e = varRoles.get(name);
    if (!e) { e = { fg: 0, bg: 0, border: 0 }; varRoles.set(name, e); }
    e[role]++;
  }
  function scanVarUsage(rules) {
    for (let i = 0; i < rules.length; i++) {
      const r = rules[i];
      if (r.type === 1 && r.style) {
        const st = r.style;
        // role signal: which color property a var is plugged into
        for (let j = 0; j < COLOR_PROPS.length; j++) {
          const v = st.getPropertyValue(COLOR_PROPS[j]);
          if (!v || v.indexOf('var(') < 0) continue;
          const role = roleForProp(COLOR_PROPS[j]);
          let m; VARRE.lastIndex = 0;
          while ((m = VARRE.exec(v))) bumpVar(m[1], role);
        }
        // var-to-var dependencies (e.g. --text: var(--gray-900)) so the leaf
        // variable that actually holds the color inherits the role.
        for (let k = 0; k < st.length; k++) {
          const p = st[k];
          if (p.charCodeAt(0) === 45 && p.charCodeAt(1) === 45) {
            const v = st.getPropertyValue(p);
            if (v && v.indexOf('var(') >= 0) {
              let m; VARRE.lastIndex = 0;
              while ((m = VARRE.exec(v))) varDeps.push([m[1], p]);
            }
          }
        }
      } else if (r.cssRules && r.type !== 7) {
        try { scanVarUsage(r.cssRules); } catch (e) {}
      }
    }
  }
  function walkElements(root, limit, visit) {
    limit = Math.max(0, limit | 0);
    if (!root || !limit || typeof visit !== 'function') return 0;
    let count = 0;
    const run = (el) => {
      count++;
      return visit(el);
    };
    try {
      const start = root.nodeType === 9 ? root.documentElement : root;
      if (!start) return 0;
      if (start.nodeType === 1) {
        if (run(start) === false || count >= limit) return count;
      }
      const walker = document.createTreeWalker(start, 1);
      let node;
      while (count < limit && (node = walker.nextNode())) {
        if (run(node) === false) break;
      }
    } catch (_) {
      let q; try { q = root.querySelectorAll ? root.querySelectorAll('*') : []; } catch (__) { return count; }
      for (let i = 0; i < q.length && count < limit; i++) {
        if (run(q[i]) === false) break;
      }
    }
    return count;
  }

  // The document plus every open shadow root (recursively). Shadow-DOM apps
  // (YouTube, many web-component sites) keep their theme in shadow roots and in
  // adoptedStyleSheets, neither of which is in document.styleSheets.
  function rootsList() {
    if (isManagedThemeHost() && !needsManagedObserverHost()) return [document];
    const roots = [document];
    const stack = [document];
    let budget = 80000; // safety cap on elements visited, so a huge DOM can't freeze
    while (stack.length && budget > 0) {
      const root = stack.pop();
      budget -= walkElements(root, budget, (el) => {
        if (isWardenOneOwnedNode(el)) return;
        const sr = el.shadowRoot;
        if (sr) { roots.push(sr); stack.push(sr); }
      });
    }
    return roots;
  }
  function sheetsOfRoot(root) {
    const out = [];
    const ss = root.styleSheets;
    if (ss) for (let i = 0; i < ss.length; i++) out.push(ss[i]);
    const ad = root.adoptedStyleSheets; // constructable sheets (not in styleSheets)
    if (ad) for (let i = 0; i < ad.length; i++) out.push(ad[i]);
    return out;
  }
  function buildVarRoles(roots) {
    varRoles = new Map();
    varDeps = [];
    roots = roots || rootsList();
    for (let r = 0; r < roots.length; r++) {
      const sheets = sheetsOfRoot(roots[r]);
      for (let i = 0; i < sheets.length; i++) {
        const sheet = sheets[i];
        if (sheet.ownerNode && sheet.ownerNode.id === THEME_ID) continue;
        let rules; try { rules = sheet.cssRules; } catch (e) { continue; }
        if (rules) try { scanVarUsage(rules); } catch (e) {}
      }
    }
    // Propagate roles down dependency chains to a fixpoint (bounded).
    const applied = new Set();
    for (let iter = 0; iter < 6; iter++) {
      let changed = false;
      for (let i = 0; i < varDeps.length; i++) {
        const child = varDeps[i][0], parent = varDeps[i][1];
        const pr = usageRole(parent);
        if (!pr) continue;
        const key = child + '|' + pr;
        if (applied.has(key)) continue;
        applied.add(key);
        bumpVar(child, pr);
        changed = true;
      }
      if (!changed) break;
    }
  }
  function usageRole(name) {
    const e = varRoles.get(name);
    if (!e) return null;
    if (e.fg >= e.bg && e.fg >= e.border && e.fg > 0) return 'fg';
    if (e.bg >= e.border && e.bg > 0) return 'bg';
    if (e.border > 0) return 'border';
    return null;
  }
  function roleForVar(name, value, mode) {
    const used = usageRole(name);
    if (used) return used;
    if (/(^|[-_])(bg|background|surface|fill|backdrop|paper|canvas|elevation|scrim|overlay|shadow)([0-9-_]|$)/i.test(name)) return 'bg';
    // NB: "color" is deliberately NOT a foreground signal. Design systems prefix
    // EVERY colour token with it (Twitch & GitHub `--color-*`, Material
    // `--color-background-*`, etc.), so treating "color" as foreground routed whole
    // dark palettes — surfaces, black scrims, colour ramps — down the bright path
    // and washed their surfaces out to light grey.
    if (/(^|[-_])(text|fg|foreground|ink|label|content|heading|title|link|icon|on)([0-9-_]|$)/i.test(name)) return 'fg';
    if (/(border|outline|divider|stroke|separator|rule)/i.test(name)) return 'border';
    const c = clean(parseFunc(value)) || clean(hexToRgb((value.match(HEX) || [])[0] || ''));
    if (c) {
      const lightVal = rgbToHsl(c[0], c[1], c[2])[2] > 0.5;
      // Value-lightness is only a guess for orphan vars (no usage, no name hint), and
      // its correct DIRECTION depends on the theme being built. When darkening a page
      // (dark/ultra), a dark orphan value is almost always a surface — keep it dark
      // (bg) — and a light value is almost always text — keep it bright (fg). In light
      // mode the opposite holds. The old code always assumed the light-mode direction
      // (dark = text), which inverted every dark-native surface var -> the washed-out
      // Twitch chrome. Mode-awareness fixes it without per-site rules.
      if (mode === 'light') return lightVal ? 'bg' : 'fg';
      return lightVal ? 'fg' : 'bg';
    }
    return 'fg';
  }

  function transformDecl(style, mode) {
    let css = '';
    const seen = new Set();
    for (let i = 0; i < style.length; i++) {
      const prop = style[i];
      if (prop.charCodeAt(0) === 45 && prop.charCodeAt(1) === 45) { // --custom
        const v = style.getPropertyValue(prop);
        if (v) {
          const nv = replaceColors(v, mode, roleForVar(prop, v, mode));
          if (nv !== v) css += prop + ':' + nv + ' !important;';
        }
        seen.add(prop);
      }
    }
    // When a background is clipped to text (gradient headings:
    // `-webkit-background-clip:text;color:transparent`) the background IS the
    // visible text, so it must be treated as foreground, not a surface —
    // otherwise it gets lightened/darkened into invisibility.
    // BUT `background-clip:text` only makes the background act as the text when the
    // text itself is transparent. Some elements set clip:text yet paint a solid
    // text colour and have their clip overridden to border-box by the cascade
    // (Google's AI-Overview highlight <mark>) — there the background is a real
    // visible box, and lightening it as "text" washed the highlight out. Only honour
    // clip:text as foreground when the rule makes its text transparent (or declares
    // no text colour at all, so a transparent fill can cascade in).
    const clip = style.getPropertyValue('-webkit-background-clip') || style.getPropertyValue('background-clip') || '';
    const fillVal = style.getPropertyValue('-webkit-text-fill-color');
    const colorVal = style.getPropertyValue('color');
    const textClip = /text/i.test(clip)
      && (/transparent/i.test(fillVal) || /transparent/i.test(colorVal) || (!fillVal && !colorVal));
    for (let i = 0; i < COLOR_PROPS.length; i++) {
      const prop = COLOR_PROPS[i];
      if (seen.has(prop)) continue;
      const v = style.getPropertyValue(prop);
      if (!v) continue;
      let role = roleForProp(prop);
      if (textClip && (prop === 'background' || prop === 'background-image')) role = 'fg';
      const nv = mode === 'light' && prop === '-webkit-text-fill-color' && !/transparent/i.test(v)
        ? 'currentColor'
        : replaceColors(v, mode, role);
      if (nv !== v) css += prop + ':' + nv + ' !important;';
    }
    return css;
  }

  // Walk style rules, preserving each @media condition (incl. prefers-color-scheme)
  // so conditional colors stay conditional. We transform colors in place and keep
  // the wrapper — skipping prefers-color-scheme blocks would drop exactly the
  // colors a site serves to the OS theme that is currently active.
  function eachStyleRule(rules, cond, cb) {
    for (let i = 0; i < rules.length; i++) {
      const r = rules[i], t = r.type;
      if (t === 1) { cb(r, cond); }
      else if (t === 4) {
        const c = (r.conditionText || (r.media && r.media.mediaText) || '');
        eachStyleRule(r.cssRules, cond ? cond + ' and ' + c : c, cb);
      } else if (t === 12) { eachStyleRule(r.cssRules, cond, cb); }
      else if (r.cssRules && t !== 7) { eachStyleRule(r.cssRules, cond, cb); }
    }
  }

  function buildThemeCSS(mode, sheets) {
    let css = '';
    for (let i = 0; i < sheets.length; i++) {
      const sheet = sheets[i];
      if (sheet.ownerNode && sheet.ownerNode.id === THEME_ID) continue;
      let rules;
      try { rules = sheet.cssRules; } catch (e) { continue; } // cross-origin: unreadable
      if (!rules) continue;
      eachStyleRule(rules, '', (rule, cond) => {
        try {
          const d = transformDecl(rule.style, mode);
          if (!d) return;
          const body = rule.selectorText + '{' + d + '}';
          css += cond ? '@media ' + cond + '{' + body + '}\n' : body + '\n';
        } catch (e) { /* skip pathological rule */ }
      });
    }
    return css;
  }

  // Apply the theme to the document AND into every shadow root (its own override
  // <style>, so :host/component rules and shadow adoptedStyleSheets are themed).
  let themeEls = [];
  // PERF (weak machines): true only after we've actually applied a theme. Lets the
  // common default (eyeShieldMode 'off') skip the full-document rootsList() walk in
  // removeThemeEls() — there is nothing to remove until a theme has been built.
  let themedOnce = false;
  function removeAllThemeStyleEls() {
    const sel = 'style#' + THEME_ID + ',style[data-wo-eyeshield="1"]';
    const roots = rootsList();
    for (let r = 0; r < roots.length; r++) {
      let nodes;
      try { nodes = roots[r].querySelectorAll(sel); } catch (e) { nodes = null; }
      if (!nodes) continue;
      for (let i = 0; i < nodes.length; i++) {
        try { nodes[i].remove(); } catch (e) {}
      }
    }
  }
  function removeThemeEls() {
    // Nothing has ever been themed (default 'off' path): skip the whole-document walk.
    if (!themedOnce && themeEls.length === 0 && foreignEls.length === 0) return;
    for (let i = 0; i < themeEls.length; i++) { try { themeEls[i].remove(); } catch (e) {} }
    themeEls = [];
    removeAllThemeStyleEls();
    removeForeignEls();
    clearContrastFixes(); // revert any forced high-contrast text colours from the contrast guard
  }
  function themeShadowRoot(mode, sr) {
    if (isTwitchHost()) return;
    observeRoot(sr); // watch this shadow root for its own lazily-added children
    if (sr.querySelector('style#' + THEME_ID)) return; // already themed (and not wiped)
    let body;
    try { body = isManagedThemeHost() ? '' : buildThemeCSS(mode, sheetsOfRoot(sr)); } catch (e) { body = ''; }
    const css = body + (isManagedThemeHost() ? managedShadowCSS(mode) : genericRepairCSS(mode, true)) + selectionCSS(mode);
    if (!css) return;
    const st = document.createElement('style');
    st.id = THEME_ID;
    st.setAttribute('data-wo-eyeshield', '1');
    st.setAttribute('data-wo-eyeshield-mode', mode);
    try { sr.appendChild(st); st.textContent = css; themeEls.push(st); } catch (e) {}
  }
  function applyTheme(mode, roots) {
    removeThemeEls();
    roots = roots || rootsList();
    for (let r = 0; r < roots.length; r++) {
      const root = roots[r];
      if (root !== document) observeRoot(root); // watch shadow roots for new children
      let body;
      try { body = isManagedThemeHost() ? '' : buildThemeCSS(mode, sheetsOfRoot(root)); } catch (e) { body = ''; }
      const repair = isManagedThemeHost() ? (root !== document ? managedShadowCSS(mode) : '') : genericRepairCSS(mode, root !== document);
      const css = (root === document ? themeHeader(mode) : '') + body + repair + (root === document ? themeFooter(mode) : selectionCSS(mode));
      if (!css) continue;
      const st = document.createElement('style');
      st.id = THEME_ID;
      st.setAttribute('data-wo-eyeshield', '1');
      st.setAttribute('data-wo-eyeshield-mode', mode);
      try { (root === document ? (document.head || document.documentElement) : root).appendChild(st); } catch (e) { continue; }
      st.textContent = css;
      themeEls.push(st);
    }
    scheduleContrastGuard(mode);
  }

  // ---------- post-remap contrast guard ----------
  // The absolute role remap (fg -> bright, bg -> dark) can occasionally land text and its
  // background on near-equal colours on un-tuned sites (heavy CSS-variable theming, gradient
  // text fill, or site !important rules out-specifying the remap), producing invisible /
  // very-low-contrast text. After a theme is applied we sample real text controls and, where
  // rendered contrast is below WCAG text thresholds, force a guaranteed high-contrast inline
  // text colour. Original inline paint is saved in a WeakMap so the fix can be cleanly
  // reverted when the theme is removed or re-evaluated.
  function ewParseRgb(str) {
    const rgba = clean(parseFunc(String(str || '').trim()));
    if (!rgba) return null;
    return { r: rgba[0], g: rgba[1], b: rgba[2], a: rgba[3] == null ? 1 : rgba[3] };
  }
  function ewLum(c) {
    const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
  }
  function ewContrast(a, b) { const hi = Math.max(ewLum(a), ewLum(b)); const lo = Math.min(ewLum(a), ewLum(b)); return (hi + 0.05) / (lo + 0.05); }
  const ewRgbCss = (c) => 'rgb(' + Math.round(c.r) + ', ' + Math.round(c.g) + ', ' + Math.round(c.b) + ')';
  // Keep the hue the site chose and move only its lightness until it clears the threshold.
  //
  // The flat fallback in contrastGuard is right for text that is merely hard to read, and wrong
  // wherever the COLOUR IS the information. Twitch gives every chat participant their own hue, and
  // on a dark theme a good number of those fail the contrast check -- so rewriting each failure to
  // one near-white turned a room full of distinguishable names into a wall of identical text. The
  // same applies to any tag, label or legend that encodes meaning as colour.
  //
  // Near-greys are deliberately left to the fallback: they carry no identity to preserve, and a
  // grey nudged along its own lightness is just the flat colour arrived at less predictably.
  function ewReadableVariant(fg, bg, threshold) {
    let hsl;
    try { hsl = rgbToHsl(fg.r, fg.g, fg.b); } catch (_) { return null; }
    if (!hsl || hsl[1] < 0.15) return null;
    const lighten = ewLum(bg) <= 0.45;
    for (let i = 1; i <= 24; i++) {
      const l = lighten ? Math.min(1, hsl[2] + i * 0.035) : Math.max(0, hsl[2] - i * 0.035);
      let rgb;
      try { rgb = hslToRgb(hsl[0], hsl[1], l); } catch (_) { return null; }
      if (!rgb) return null;
      const cand = { r: rgb[0], g: rgb[1], b: rgb[2] };
      if (ewContrast(cand, bg) >= threshold) return cand;
      if (l <= 0 || l >= 1) break;
    }
    return null;
  }
  function ewTextPaint(cs) {
    let fill = '';
    try { fill = cs.getPropertyValue && cs.getPropertyValue('-webkit-text-fill-color'); } catch (_) {}
    fill = String(fill || '').trim();
    if (fill && !/^(currentcolor|transparent|inherit|initial|unset|revert)$/i.test(fill)) {
      const fillRgb = ewParseRgb(fill);
      if (fillRgb && fillRgb.a >= 0.4) return fillRgb;
    }
    return ewParseRgb(cs.color);
  }
  function ewContrastThreshold(cs) {
    const size = parseFloat(cs.fontSize) || 16;
    const rawWeight = String(cs.fontWeight || '');
    const weight = /bold/i.test(rawWeight) ? 700 : (parseInt(rawWeight, 10) || 400);
    const largeText = size >= 24 || (size >= 18.66 && weight >= 600);
    return largeText ? 3 : 4.5;
  }
  const EW_CONTRAST_SKIP_TAGS = /^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE|META|LINK|BASE|HEAD|TITLE|BR|HR|IMG|PICTURE|VIDEO|AUDIO|CANVAS|IFRAME|EMBED|OBJECT|SVG|PATH|USE|CLIPPATH|MASK|SOURCE|TRACK)$/i;
  const EW_CONTRAST_FIELD_SEL = 'input:not([type="hidden"]):not([type="image"]):not([type="range"]):not([type="checkbox"]):not([type="radio"]),textarea,select,[contenteditable="true"],[role="textbox"]';
  function ewHasDirectText(el) {
    for (let n = el.firstChild; n; n = n.nextSibling) {
      if (n.nodeType === 3 && n.nodeValue && n.nodeValue.trim()) return true;
    }
    return false;
  }
  /* A video player's chrome sits on the video, not on the page, and it is fully
     specified by the site profiles. The guard must not touch it: its background
     walk stops after 8 ancestors, and on a YouTube watch page the player's black
     is found at the 8th -- the last one that fits. One more wrapper (chapters, a
     live badge, a hover tooltip) and the walk returns nothing, the guard falls
     back to the PAGE background, and white player text against an assumed white
     page scores 1.00 -- so it repaints the clock near-black, inline and
     important, which no stylesheet can outrank. That is the clock going white
     and then black a moment later. */
  const EW_PLAYER_CHROME = '#movie_player,.html5-video-player,.ytp-chrome-top,.ytp-chrome-bottom,'
    + '.video-player,.persistent-player,[data-a-target="video-player"],[data-a-target="player-controls"]';
  /* Resolved once per run rather than asked per element. `closest()` with this
     list cost 8.4ms of every guard run on a YouTube watch page -- 5401 elements
     interrogated to spare the 67 that are actually in the player. Against the
     handful of roots `contains()` is a native tree test, and on a page with no
     player at all the list is empty and the check costs nothing. */
  function ewPlayerRoots() {
    try { return Array.prototype.slice.call(document.querySelectorAll(EW_PLAYER_CHROME)); }
    catch (_) { return []; }
  }
  function ewInPlayer(roots, el) {
    for (let i = 0; i < roots.length; i++) {
      try { if (roots[i].contains(el)) return true; } catch (_) {}
    }
    return false;
  }
  function ewReadableTextCandidate(el) {
    if (!el || el.nodeType !== 1 || EW_CONTRAST_SKIP_TAGS.test(el.tagName || '')) return false;
    try { if (el.closest && el.closest('svg,canvas,video,audio,iframe,embed,object')) return false; } catch (_) {}
    try { if (el.matches && el.matches(EW_CONTRAST_FIELD_SEL)) return true; } catch (_) {}
    return ewHasDirectText(el);
  }
  function ewStyleSnapshot(el, prop) {
    let value = '', priority = '';
    try {
      value = el.style.getPropertyValue(prop) || '';
      priority = el.style.getPropertyPriority(prop) || '';
    } catch (_) {}
    return { value, priority };
  }
  function ewRestoreStyle(el, prop, snapshot) {
    try {
      if (snapshot && snapshot.value) el.style.setProperty(prop, snapshot.value, snapshot.priority || '');
      else el.style.removeProperty(prop);
    } catch (_) {}
  }
  function ewEffectiveBg(el) {
    let node = el;
    // Bounded ancestor walk: an opaque background is almost always within a few levels; if not
    // found we fall back to the theme's base bg. Keeps the (debounced, one-shot) getComputedStyle
    // count low on large pages.
    for (let i = 0; i < 8 && node && node.nodeType === 1; i++) {
      let cs; try { cs = getComputedStyle(node); } catch (_) { return null; }
      const bg = ewParseRgb(cs.backgroundColor);
      if (bg && bg.a >= 0.5) return bg;
      node = node.parentElement;
    }
    return null;
  }
  let __ewContrastTimer = null;
  let __ewContrastOriginals = new WeakMap();
  function scheduleContrastGuard(mode) {
    if (!mode || mode === 'off') return;
    if (__ewContrastTimer) clearTimeout(__ewContrastTimer);
    __ewContrastTimer = woTimeout(() => { __ewContrastTimer = null; try { contrastGuard(mode); } catch (_) {} }, 600);
  }
  function ewClearContrastFixNode(el) {
    if (!el || el.nodeType !== 1) return;
    const original = __ewContrastOriginals.get(el);
    ewRestoreStyle(el, 'color', original && original.color);
    ewRestoreStyle(el, '-webkit-text-fill-color', original && original.textFill);
    ewRestoreStyle(el, 'text-shadow', original && original.textShadow);
    try { el.removeAttribute('data-wo-contrast'); } catch (_) {}
    try { __ewContrastOriginals.delete(el); } catch (_) {}
  }
  function clearContrastFixes() {
    let nodes; try { nodes = document.querySelectorAll('[data-wo-contrast]'); } catch (_) { return; }
    for (let i = 0; i < nodes.length; i++) {
      try { ewClearContrastFixNode(nodes[i]); } catch (_) {}
    }
  }
  function contrastGuard(mode) {
    const fallbackBg = /light/i.test(mode) ? { r: 255, g: 255, b: 255 } : { r: 20, g: 20, b: 22 };
    if (!document.body) return;
    const managed = isManagedThemeHost();
    const playerRoots = ewPlayerRoots();
    let budget = managed ? 450 : 900;
    walkElements(document.body, managed ? 8000 : 14000, (el) => {
      if (budget <= 0) return false;
      if (el === document.body) return;
      if (isWardenOneOwnedNode(el)) return;
      /* Cleared first, so a fix an older build left inside the player is undone
         rather than stranded there for the life of the page. */
      if (el.hasAttribute('data-wo-contrast')) ewClearContrastFixNode(el);
      if (playerRoots.length && ewInPlayer(playerRoots, el)) return;
      if (!ewReadableTextCandidate(el)) return;
      budget--;
      let cs; try { cs = getComputedStyle(el); } catch (_) { return; }
      if (cs.visibility === 'hidden' || cs.display === 'none' || parseFloat(cs.opacity) === 0) return;
      const fg = ewTextPaint(cs);
      if (!fg || fg.a < 0.4) return;
      const bg = ewEffectiveBg(el) || fallbackBg;
      const threshold = ewContrastThreshold(cs);
      if (ewContrast(fg, bg) >= threshold) return;
      // Try to keep the colour first, and only flatten it when its hue cannot be made readable.
      const kept = ewReadableVariant(fg, bg, threshold);
      const safe = kept ? ewRgbCss(kept)
        : (ewLum(bg) > 0.45 ? '#121318' : (mode === 'ultra' ? '#f5f6f8' : '#eef0f4'));
      try {
        __ewContrastOriginals.set(el, {
          color: ewStyleSnapshot(el, 'color'),
          textFill: ewStyleSnapshot(el, '-webkit-text-fill-color'),
          textShadow: ewStyleSnapshot(el, 'text-shadow'),
        });
        el.style.setProperty('color', safe, 'important');
        el.style.setProperty('-webkit-text-fill-color', 'currentColor', 'important');
        if (cs.textShadow && cs.textShadow !== 'none') el.style.setProperty('text-shadow', 'none', 'important');
        el.setAttribute('data-wo-contrast', '1');
      } catch (_) {}
    });
  }
  // Incrementally theme shadow roots within a freshly-added subtree. YouTube and
  // other component apps mount shadow components AFTER first paint; without this
  // they'd keep their own theme -> the half-dark/half-light look.
  function themeShadowsIn(node, mode) {
    if (isManagedThemeHost() && !needsManagedObserverHost()) return;
    if (!node || node.nodeType !== 1) return;
    let budget = 15000;
    const stack = [node];
    while (stack.length && budget > 0) {
      const el = stack.pop();
      budget--;
      if (el.nodeType !== 1) continue;
      const sr = el.shadowRoot;
      if (sr) {
        themeShadowRoot(mode, sr);
        let k; try { k = sr.children; } catch (e) { k = null; }
        if (k) for (let i = 0; i < k.length && budget > 0; i++) { stack.push(k[i]); budget--; }
      }
      const c = el.children;
      if (c) for (let i = 0; i < c.length && budget > 0; i++) { stack.push(c[i]); budget--; }
    }
  }

  // ---------- inline style="" colors ----------
  let inlineChanges = [];
  function applyInline(mode, root) {
    let nodes;
    if (root) { // incremental: only this added subtree
      nodes = [];
      if (root.hasAttribute && root.hasAttribute('style')) nodes.push(root);
      if (root.querySelectorAll) { const q = root.querySelectorAll('[style]'); for (let i = 0; i < q.length; i++) nodes.push(q[i]); }
    } else {
      nodes = document.querySelectorAll('[style]');
    }
    for (let i = 0; i < nodes.length; i++) {
      const el = nodes[i];
      if (el.id === SCRIM_ID || el.id === THEME_ID || el.__woInline || isWardenOneOwnedNode(el)) continue;
      let touched = false;
      for (let j = 0; j < COLOR_PROPS.length; j++) {
        const prop = COLOR_PROPS[j];
        const v = el.style.getPropertyValue(prop);
        if (!v) continue;
        const nv = mode === 'light' && prop === '-webkit-text-fill-color' && !/transparent/i.test(v)
          ? 'currentColor'
          : replaceColors(v, mode, roleForProp(prop));
        if (nv === v) continue;
        inlineChanges.push({ el: el, prop: prop, prev: v, pri: el.style.getPropertyPriority(prop) });
        el.style.setProperty(prop, nv, 'important');
        touched = true;
      }
      if (touched) el.__woInline = true;
    }
  }
  function restoreInline() {
    for (let i = 0; i < inlineChanges.length; i++) {
      const c = inlineChanges[i];
      try {
        if (c.prev) c.el.style.setProperty(c.prop, c.prev, c.pri);
        else c.el.style.removeProperty(c.prop);
        c.el.__woInline = false;
        if (c.el.__woInlineProps) delete c.el.__woInlineProps[c.prop];
      } catch (e) { /* element gone */ }
    }
    inlineChanges = [];
  }

  function lightnessOfPaint(value) {
    if (!value || SKIP_VAL.test(value)) return null;
    const rgba = clean(parseFunc(value)) || clean(hexToRgb((String(value).match(HEX) || [])[0] || ''));
    if (!rgba || (rgba[3] != null && rgba[3] <= 0.02)) return null;
    return rgbToHsl(rgba[0], rgba[1], rgba[2])[2];
  }

  function setTrackedInline(el, prop, value) {
    if (!el || !el.style) return;
    if (!el.__woInlineProps) el.__woInlineProps = Object.create(null);
    if (el.__woInlineProps[prop] === value) return;
    const prev = el.style.getPropertyValue(prop);
    const pri = el.style.getPropertyPriority(prop);
    if (prev === value && pri === 'important') return;
    inlineChanges.push({ el: el, prop: prop, prev: prev, pri: pri });
    el.style.setProperty(prop, value, 'important');
    el.__woInline = true;
    el.__woInlineProps[prop] = value;
  }

  function applyGoogleLightInline(root) {
    if (!isGoogleHost() || activeRemap !== 'light') return;
    const scope = root && root.querySelectorAll ? root : document;
    const nodes = [];
    const sel = 'body,#main,#cnt,#rcnt,#center_col,#search,#rso,#rhs,[role="main"],[data-async-context],form[role="search"],#searchform,body *';
    try {
      if (scope.matches && scope.matches(sel)) nodes.push(scope);
      const q = scope.querySelectorAll(sel);
      for (let i = 0; i < q.length && nodes.length < 6500; i++) nodes.push(q[i]);
    } catch (e) { return; }
    const textSel = 'p,li,span,div,section,article,h1,h2,h3,h4,h5,h6,em,strong,small,cite,yt-formatted-string,[role="heading"]';
    const mediaSel = 'img,picture,video,canvas,svg,path,iframe,embed,object';
    const controlSel = 'button,[role="button"],[aria-expanded],[aria-controls],[aria-selected="true"],[aria-pressed="true"],a[role="button"]';
    const nativeGoogleSel = '#navcnt,#navcnt *,#foot,#foot *,#bres,#bres *,#swml,#swml *';
    for (let i = 0; i < nodes.length; i++) {
      const el = nodes[i];
      if (!el || !el.isConnected || el.id === THEME_ID || el.id === SCRIM_ID || el.matches(mediaSel)) continue;
      if (el.matches(nativeGoogleSel)) continue;
      // Leave the search box + autocomplete dropdown entirely to googleSearchBoxCSS.
      // This JS pass writes inline styles with !important (setTrackedInline), which
      // beat the panel stylesheet and repaint the dropdown's layers grey/transparent
      // -> the "light dropdown looks wrong / dingy" bug. Skip the whole subtree.
      if (el.closest && el.closest('.UUbT9,form[role="search"],#searchform')) continue;
      let cs;
      try { cs = getComputedStyle(el); } catch (e) { continue; }
      const bgL = lightnessOfPaint(cs.backgroundColor);
      if (bgL != null && bgL < 0.45) {
        setTrackedInline(el, 'background-color', el.matches(controlSel) ? '#f1f3f4' : 'transparent');
      }
      if (cs.backgroundImage && cs.backgroundImage !== 'none' && /gradient/i.test(cs.backgroundImage)) {
        setTrackedInline(el, 'background-image', 'none');
      }
      if (el.matches(textSel)) {
        const fgL = lightnessOfPaint(cs.color);
        if (fgL == null || fgL > 0.62) {
          setTrackedInline(el, 'color', '#202124');
          setTrackedInline(el, '-webkit-text-fill-color', 'currentColor');
        }
      }
    }
  }

  // Generic dark/ultra FALLBACK: force any element whose COMPUTED background is light
  // to a dark surface (+ lighten dark text on it). Catches backgrounds the CSSOM remap
  // + applyForeignCSS + applyInline can't reach — most importantly CROSS-ORIGIN CDN CSS
  // whose re-theme fetch yields nothing (e.g. Amazon's white .dcl-* deal cards). Non-
  // managed hosts only; budget-capped; mirrors applyGoogleLightInline. Sets background-
  // COLOR only (never the shorthand or background-image) so thumbnails/sprites survive.
  function applyComputedBgFix(mode, root) {
    if (isManagedThemeHost() || (mode !== 'dark' && mode !== 'ultra')) return;
    const pal = paletteFor(mode);
    const scope = root && root.querySelectorAll ? root : document.body;
    if (!scope) return;
    const nodes = [];
    try {
      if (scope.nodeType === 1 && scope !== document.body) nodes.push(scope);
      walkElements(scope, 6000 - nodes.length, (el) => {
        if (el === scope && scope.nodeType === 1) return;
        nodes.push(el);
        if (nodes.length >= 6000) return false;
      });
    } catch (e) { return; }
    const mediaSel = 'img,picture,video,canvas,svg,path,iframe,embed,object,input,textarea,select';
    const textSel = 'p,li,span,a,b,strong,em,small,cite,h1,h2,h3,h4,h5,h6,label,button,td,th,dt,dd,figcaption,[role="heading"]';
    for (let i = 0; i < nodes.length; i++) {
      const el = nodes[i];
      if (!el || el.nodeType !== 1 || !el.isConnected || el.id === THEME_ID || el.id === SCRIM_ID || isWardenOneOwnedNode(el)) continue;
      let cs; try { cs = getComputedStyle(el); } catch (e) { continue; }
      let isMedia = false; try { isMedia = el.matches(mediaSel); } catch (e) {}
      if (!isMedia) {
        const bgL = lightnessOfPaint(cs.backgroundColor);
        if (bgL != null && bgL > 0.6) setTrackedInline(el, 'background-color', pal.raised);
      }
      let isText = false; try { isText = el.matches(textSel); } catch (e) {}
      if (isText) {
        const fgL = lightnessOfPaint(cs.color);
        if (fgL != null && fgL < 0.5) { setTrackedInline(el, 'color', pal.text); setTrackedInline(el, '-webkit-text-fill-color', 'currentColor'); }
      }
    }
  }

  // ---------- scrim (brightness) ----------
  function ensureScrim(brightness) {
    const host = document.body || document.documentElement;
    if (!host) return;
    let s = document.getElementById(SCRIM_ID);
    if (!s) { s = document.createElement('div'); s.id = SCRIM_ID; }
    if (s.parentNode !== host) host.appendChild(s);
    const op = Math.min(0.9, Math.max(0, (100 - brightness) / 100 * 0.9));
    s.style.cssText = 'position:fixed!important;inset:0!important;width:100vw!important;height:100vh!important;'
      + 'z-index:2147483646!important;pointer-events:none!important;background:#000!important;'
      + 'opacity:' + op.toFixed(3) + '!important;mix-blend-mode:normal!important;transition:opacity .12s ease!important;margin:0!important;border:0!important;';
  }
  function removeScrim() { const s = document.getElementById(SCRIM_ID); if (s) s.remove(); }

  // ---------- config helpers ----------
  let cfg = DEFAULTS;
  function currentHost() { return String(location.hostname || '').replace(/^www\./, '').toLowerCase(); }
  function normalizeMode(m) { return m === 'light' || m === 'dark' || m === 'ultra' ? m : 'off'; }
  function clampBrightness(v) { const n = Math.round(Number(v)); if (!Number.isFinite(n)) return 100; return Math.max(0, Math.min(200, n)); }
  // EyeShield brightness / contrast / saturation / warmth / grayscale are GLOBAL
  // (apply to all sites). The per-host maps are no longer consulted — kept in the
  // config shape only so old saved data doesn't error. `dflt` is the neutral value.
  function getBrightness() {
    return clampBrightness(cfg.eyeShieldBrightness == null ? 100 : cfg.eyeShieldBrightness);
  }
  function clampPct(v, lo, hi, dflt) { const n = Math.round(Number(v)); if (!Number.isFinite(n)) return dflt; return Math.max(lo, Math.min(hi, n)); }
  function getPct(globalKey, mapKey, lo, hi, dflt) {
    return clampPct(cfg[globalKey] == null ? dflt : cfg[globalKey], lo, hi, dflt);
  }
  function getContrast() { return getPct('eyeShieldContrast', 'eyeShieldContrastByHost', 0, 300, 100); }
  function getSaturation() { return getPct('eyeShieldSaturation', 'eyeShieldSaturationByHost', 0, 300, 100); }
  function getWarmth() { return getPct('eyeShieldWarmth', 'eyeShieldWarmthByHost', 0, 100, 0); }
  function getGrayscale() { return getPct('eyeShieldGrayscale', 'eyeShieldGrayscaleByHost', 0, 100, 0); }

  // ---------- adjustment filter (brightness / contrast / saturation / warmth / grayscale) ----------
  // Applied as a single CSS filter on <html>, independent of the colour-remap so it
  // works in every mode (including Normal/off), exactly like the brightness scrim.
  // It sits on the document element (not a child) so position:fixed layouts keep
  // working — the root stays the containing block. Warmth is sepia() and grayscale()
  // is last after sepia so a warm tint still shows through a grayscale pass. All at
  // neutral (100/100/100/0/0) means the filter is removed (no-op).
  //
  // EXCEPTION — Twitch: a filter on <html> makes every <video> descendant a filter
  // input, which drags the stream off the GPU's zero-copy video overlay and forces
  // a viewport-sized filter pass on every decoded frame (awful stream performance).
  // There, scope the identical filter to the <video> surfaces via a stylesheet so
  // the page composites normally and only the small video texture is shaded.
  function setAdjustStyle(css) {
    let st = document.getElementById(ADJUST_ID);
    if (!css) { if (st) st.remove(); return; }
    if (!st) { st = document.createElement('style'); st.id = ADJUST_ID; }
    if (!st.parentNode) (document.head || document.documentElement).appendChild(st);
    if (st.textContent !== css) st.textContent = css;
  }
  function applyAdjustFilter(brightness, contrast, saturation, warmth, grayscale) {
    const de = document.documentElement;
    if (!de) return;
    const bright = brightness > 100 ? brightness : 100;
    if (bright === 100 && contrast === 100 && saturation === 100 && warmth === 0 && grayscale === 0) {
      de.style.removeProperty('filter'); setAdjustStyle(''); return;
    }
    const filter = 'brightness(' + bright + '%) contrast(' + contrast + '%) saturate(' + saturation + '%) grayscale(' + grayscale + '%) sepia(' + warmth + '%)';
    if (isTwitchHost()) {
      de.style.removeProperty('filter');
      // EyeShield's own Twitch dark theme forces `filter:none !important` on the
      // player media (its `media`/`playerMedia` rules, specificity ~0,1,1) to keep
      // the remap off the stream. This adjustment must out-specify that, so scope
      // it to the player video with an html-prefixed, player-scoped selector
      // (specificity 0,1,2) — it wins the cascade and reaches the stream (and the
      // twitch-rewind replay surfaces) while staying a cheap per-video GPU shader.
      const sel = 'html :is(.persistent-player,.video-player,.video-player__container,'
        + '[data-a-target="video-player"],[data-a-target="video-ref"],.live-video-player,'
        + '.channel-root__player,.twilight-player-root) video, html video[data-wardenone-replay]';
      setAdjustStyle(sel + '{filter:' + filter + ' !important;}');
      return;
    }
    setAdjustStyle('');
    de.style.setProperty('filter', filter, 'important');
  }
  function removeAdjustFilter() { const de = document.documentElement; if (de) de.style.removeProperty('filter'); setAdjustStyle(''); }

  // ---------- observer (catch lazily added stylesheets / nodes) ----------
  let observer = null, rebuildTimer = 0, activeRemap = null;
  let pendingSheet = false, pendingNodes = [];
  let observedRoots = new WeakSet();
  // Throttle the FULL re-theme. A full re-theme re-walks the entire DOM + every
  // shadow root (rootsList -> querySelectorAll('*') per root). Sites whose web
  // components lazy-load their own (shadow/adopted) stylesheets on hydration and
  // infinite scroll (Reddit) would otherwise trigger this every 250ms -> the page
  // spins / takes forever to load. Cap full re-themes to once per window; cheap
  // incremental node theming still runs on the normal cadence.
  let lastFullTheme = 0;
  const FULL_THEME_MIN_MS = 1500;
  // A document observer can't see mutations inside shadow roots, so we point the
  // same observer at each shadow root we theme — otherwise YouTube's lazily
  // mounted components (added inside shadow DOM) are never re-themed.
  function observeRoot(root) {
    if (!observer) return;
    const target = root === document ? document.documentElement : root;
    if (!target || observedRoots.has(target)) return;
    try {
      observer.observe(target, {
        childList: true,
        subtree: true,
        characterData: true,
        attributes: true,
        attributeFilter: ['href', 'rel', 'media', 'disabled'],
      });
      observedRoots.add(target);
    } catch (e) {}
  }
  function isStylesheetNode(n) {
    const tag = n.tagName;
    if (tag === 'STYLE' || tag === 'LINK') return true;
    return !!(n.querySelector && n.querySelector('style,link[rel~="stylesheet"]'));
  }
  function connectObserver() {
    if (observer) return;
    observedRoots = new WeakSet();
    observer = woObserver((muts) => {
      let trigger = false;
      for (let i = 0; i < muts.length; i++) {
        if (muts[i].type === 'characterData') {
          const p = muts[i].target && muts[i].target.parentElement;
          if (p && p.id !== THEME_ID && p.tagName === 'STYLE') {
            pendingSheet = true;
            trigger = true;
          }
          continue;
        }
        if (muts[i].type === 'attributes') {
          const n = muts[i].target;
          if (n && n.nodeType === 1 && n.id !== THEME_ID && (n.tagName === 'STYLE' || n.tagName === 'LINK')) {
            pendingSheet = true;
            trigger = true;
          }
          continue;
        }
        const added = muts[i].addedNodes;
        for (let j = 0; j < added.length; j++) {
          const n = added[j];
          // Ignore text nodes (our own <style> textContent updates land here —
          // observing them is what caused an infinite 250ms rebuild loop) and our
          // own theme/scrim elements.
          if (n.nodeType !== 1 || n.id === THEME_ID || n.id === SCRIM_ID || isWardenOneOwnedNode(n)) continue;
          if (isStylesheetNode(n)) pendingSheet = true; else pendingNodes.push(n);
          trigger = true;
        }
      }
      if (trigger) scheduleRebuild();
    });
    observeRoot(document);
  }
  function disconnectObserver() { if (observer) { observer.disconnect(); observer = null; } observedRoots = new WeakSet(); pendingSheet = false; pendingNodes = []; }
  function scheduleRebuild() {
    if (rebuildTimer) return;
    rebuildTimer = woTimeout(() => {
      rebuildTimer = 0;
      if (!activeRemap) return;
      if (pendingSheet) {
        // a new stylesheet appeared -> full re-theme across all roots, but
        // THROTTLED: if we did a full re-theme recently, defer (keep pendingSheet
        // set and re-arm) so lazy stylesheet bursts coalesce into one walk instead
        // of one-per-250ms. This is what stops Reddit (etc.) from spinning.
        if (Date.now() - lastFullTheme < FULL_THEME_MIN_MS) { scheduleRebuild(); return; }
        lastFullTheme = Date.now();
        pendingSheet = false; pendingNodes = [];
        const roots = themeRootsForCurrentHost();
        if (!isManagedThemeHost()) buildVarRoles(roots);
        applyTheme(activeRemap, roots);
        if (isGoogleHost() && activeRemap === 'light') applyGoogleLightInline();
        else if (!isManagedThemeHost()) { applyInline(activeRemap); applyComputedBgFix(activeRemap); }
        applyForeignCSS(activeRemap, roots);
      } else {
        // only DOM nodes added -> theme their inline colors AND any shadow
        // components they brought in (so lazily-mounted YouTube components don't
        // stay in YouTube's own theme -> the half-dark/half-light mix).
        const nodes = pendingNodes; pendingNodes = [];
        for (let i = 0; i < nodes.length; i++) {
          if (!nodes[i].isConnected) continue;
          if (isGoogleHost() && activeRemap === 'light') applyGoogleLightInline(nodes[i]);
          else if (!isManagedThemeHost()) { applyInline(activeRemap, nodes[i]); applyComputedBgFix(activeRemap, nodes[i]); }
          themeShadowsIn(nodes[i], activeRemap);
        }
        scheduleContrastGuard(activeRemap);
      }
    }, 250);
  }

  // ---------- cross-origin (foreign) stylesheets ----------
  // Same-origin sheets are read straight from `cssRules`; cross-origin (CDN-hosted)
  // sheets throw on `cssRules` and were previously skipped, so their colours were
  // never remapped — that is the "dark page with white patches / unreadable text on
  // dark" breakage on many sites. We fetch the sheet TEXT through the background
  // service worker (its host_permissions bypass CORS), parse it into a constructable
  // stylesheet we CAN read, and run it through the SAME transform pipeline. This only
  // ADDS coverage: every existing readable-CSS / inline / repair path is untouched,
  // and any failure here just falls back to today's behaviour. We emit ONLY the
  // recoloured declarations (selectorText + transformed colour props), so a sheet's
  // relative url() backgrounds are never re-hosted/broken.
  let foreignCache = new Map();   // href -> css text ('' = fetch failed/none)
  let foreignXform = new Map();    // href + '|' + mode -> transformed css (memo; raw text is immutable)
  let foreignPending = new Set(); // href -> fetch in flight
  let foreignEls = [];
  let foreignToken = 0;           // bumped on mode change/disable to drop stale async work
  function removeForeignEls() {
    for (let i = 0; i < foreignEls.length; i++) { try { foreignEls[i].remove(); } catch (e) {} }
    foreignEls = [];
  }
  function collectForeignHrefs(roots) {
    const out = [], seen = new Set();
    for (let r = 0; r < roots.length; r++) {
      let ss; try { ss = roots[r].styleSheets; } catch (e) { continue; }
      if (!ss) continue;
      for (let i = 0; i < ss.length; i++) {
        const sheet = ss[i];
        let href = '';
        try { href = sheet.href || ''; } catch (e) { continue; }
        if (!href || !/^https?:/i.test(href) || seen.has(href)) continue;
        try { if (sheet.disabled) continue; } catch (e) {}
        try { if (sheet.ownerNode && sheet.ownerNode.id === THEME_ID) continue; } catch (e) {}
        let readable = true;
        try { readable = sheet.cssRules != null; } catch (e) { readable = false; }
        if (readable) continue; // same-origin -> already handled by buildThemeCSS
        seen.add(href);
        out.push(href);
      }
    }
    return out;
  }
  // A foreign rule's color-bearing shorthand can carry a RELATIVE url()
  // (e.g. `background:#222 url(sprite.png)`). Emitted in our own <style> it would
  // resolve against the PAGE origin, not the CDN sheet -> broken image. Resolve any
  // relative url() against the sheet's own href so the image still loads.
  function absolutizeForeignUrls(css, base) {
    if (!css || css.indexOf('url(') < 0 || !base) return css;
    return css.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi, (m, q, u) => {
      const s = String(u).trim();
      if (!s || /^(data:|blob:|https?:|\/\/|#)/i.test(s)) return m;
      try { return 'url(' + q + new URL(s, base).href + q + ')'; } catch (e) { return m; }
    });
  }
  function transformForeignText(text, mode, baseHref) {
    if (!text || typeof CSSStyleSheet === 'undefined') return '';
    let sheet;
    try { sheet = new CSSStyleSheet(); sheet.replaceSync(text); } catch (e) { return ''; }
    let rules; try { rules = sheet.cssRules; } catch (e) { return ''; }
    if (!rules) return '';
    let css = '';
    try {
      eachStyleRule(rules, '', (rule, cond) => {
        try {
          const d = transformDecl(rule.style, mode);
          if (!d) return;
          const body = rule.selectorText + '{' + d + '}';
          css += cond ? '@media ' + cond + '{' + body + '}\n' : body + '\n';
        } catch (e) {}
      });
    } catch (e) {}
    return absolutizeForeignUrls(css, baseHref);
  }
  function injectForeignCSS(mode) {
    let css = '';
    foreignCache.forEach((text, href) => {
      if (!text) return;
      const key = href + '|' + mode;
      let t = foreignXform.get(key);
      if (t === undefined) { t = transformForeignText(text, mode, href); foreignXform.set(key, t); }
      css += t;
    });
    removeForeignEls();
    if (!css) return;
    try {
      const st = document.createElement('style');
      st.id = THEME_ID; // so buildThemeCSS / collectForeignHrefs skip it
      st.setAttribute('data-wo-eyeshield', '1');
      st.setAttribute('data-wo-eyeshield-mode', mode);
      st.setAttribute('data-wo-foreign', '1');
      (document.head || document.documentElement).appendChild(st);
      st.textContent = css;
      foreignEls.push(st);
    } catch (e) {}
  }
  function applyForeignCSS(mode, roots) {
    try {
      if (isManagedThemeHost()) return; // managed hosts use bespoke CSS, not the generic remap
      if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.sendMessage) return;
      if (typeof CSSStyleSheet === 'undefined') return;
      const hrefs = collectForeignHrefs(roots || rootsList());
      if (!hrefs.length) return;
      const token = ++foreignToken;
      let cachedAny = false;
      for (let i = 0; i < hrefs.length; i++) {
        const href = hrefs[i];
        if (foreignCache.has(href)) { cachedAny = true; continue; }
        if (foreignPending.has(href)) continue;
        foreignPending.add(href);
        try {
          chrome.runtime.sendMessage({ kind: 'eyeshield-fetch-css', url: href }, (resp) => {
            try { void chrome.runtime.lastError; } catch (e) {}
            foreignPending.delete(href);
            foreignCache.set(href, (resp && resp.ok && typeof resp.css === 'string') ? resp.css : '');
            if (token === foreignToken && activeRemap === mode) injectForeignCSS(mode);
          });
        } catch (e) { foreignPending.delete(href); foreignCache.set(href, ''); }
      }
      if (cachedAny) injectForeignCSS(mode); // reflect current mode immediately for already-fetched sheets
    } catch (e) {}
  }

  function paletteFor(mode) {
    if (mode === 'light') {
      return {
        scheme: 'light',
        bg: '#ffffff',
        surface: '#f7f8fb',
      raised: '#eef0f4',
      input: '#ffffff',
      control: '#eef0f4',
      controlHover: '#e3e7ef',
      selected: '#e7f0ff',
      selectedText: '#0b3d91',
      primary: '#1a73e8',
      primaryText: '#ffffff',
      danger: '#c5221f',
      dangerText: '#ffffff',
      border: '#d5d9e2',
      text: '#111318',
      muted: '#555c68',
      link: '#1558c0',
      // Which of these have you already opened? Every mode forces one colour
      // onto every link, and a forced link colour silently takes :visited with
      // it -- so a page of search results all looked equally unread. This is
      // the one piece of state the browser keeps FOR the reader, and it is the
      // difference between a results page and a list.
      visited: '#681da8',
      focus: '#4b7bec',
      selection: '#285fbd',
    };
  }
  if (mode === 'ultra') {
    return {
        scheme: 'dark',
        bg: '#000000',
        surface: '#08090c',
      raised: '#111319',
      input: '#0d0f14',
      control: '#151821',
      controlHover: '#1d2230',
      selected: '#182947',
      selectedText: '#d8e8ff',
      primary: '#3b82f6',
      primaryText: '#ffffff',
      danger: '#f87171',
      dangerText: '#1b0505',
      border: '#2a2f3a',
      // True white on true black. #f3f5f8 was a cool off-white: bright enough on
      // paper (19:1) but it reads as "white, but not quite", which is more tiring
      // than either a clean white or an honestly dimmer grey. Ultra is the OLED
      // mode -- if any mode should commit to #fff, it is this one.
      text: '#ffffff',
      muted: '#a9b0bc',
      link: '#8ab4ff',
      // Violet against the blue of an unread link -- a hue apart, not a shade
      // apart, so it survives being read quickly and does not depend on anyone
      // remembering which of two blues means what.
      //
      // The first attempt at this was #cba6f7, and it was the right hue and the
      // wrong colour: pale enough that beside a light blue it read as a lighter
      // blue. Hue distance was never the problem -- that was already 49deg --
      // saturation was. This carries the same hue further from grey. 7.4:1 on
      // true black.
      visited: '#c07cf0',
      focus: '#6ea8ff',
      selection: '#2f5fb0',
    };
  }
  return {
      scheme: 'dark',
      bg: '#111316',
      surface: '#181b20',
    raised: '#22262d',
    input: '#1b1f26',
    control: '#252a32',
    controlHover: '#2e3440',
    selected: '#233555',
    selectedText: '#d8e8ff',
    primary: '#3b82f6',
    primaryText: '#ffffff',
    danger: '#f87171',
    dangerText: '#1b0505',
    border: '#343a46',
    text: '#f1f3f6',
    muted: '#a8afbb',
    link: '#8ab4ff',
    visited: '#c07cf0',
    focus: '#7ba7ff',
    selection: '#2f5fb0',
  };
}

  function genericRepairCSS(mode, inShadow) {
    const p = paletteFor(mode);
    const isGH = /(^|\.)github\.com$/i.test(String(location.hostname || '').toLowerCase());
    const isXSite = /(^|\.)(x|twitter)\.com$/i.test(String(location.hostname || '').toLowerCase());
    const root = inShadow ? ':host' : ':root,html,body';
    const app = inShadow
      ? ':host,:host > *'
      : 'html,body,#root,#__next,#app,#application,.app,.application,[data-reactroot],main,[role="main"]';
    const shell = ':where(header,nav,aside,footer,[role="banner"],[role="navigation"],[role="complementary"],[role="contentinfo"],[role="toolbar"],[role="menubar"],[class*="navbar" i],[class*="topbar" i],[class*="toolbar" i],[class*="sidebar" i],[class*="sidenav" i],[class*="header" i],[class*="footer" i])';
    const surface = ':where(section,article,table,thead,tbody,tfoot,tr,[role="region"],[role="tabpanel"],[role="tablist"],[role="status"],[role="alert"],[role="log"],[role="feed"],[class*="card" i],[class*="panel" i],[class*="pane" i],[class*="surface" i],[class*="paper" i],[class*="sheet" i],[class*="tile" i],[class*="badge" i],[class*="chip" i],[class*="tag" i],[class*="pill" i],[class*="chat" i],[class*="message" i],[class*="comment" i])';
    const raised = ':where(dialog,[popover],[open][role="dialog"],[role="dialog"],[role="alertdialog"],[role="menu"],[role="listbox"],[role="tooltip"],[class*="modal" i],[class*="dialog" i],[class*="drawer" i],[class*="popover" i],[class*="dropdown" i],[class*="menu" i],[class*="toast" i],[class*="tooltip" i],[class*="flyout" i])';
    const text = ':where(h1,h2,h3,h4,h5,h6,p,li,dt,dd,label,small,strong,em,blockquote,figcaption,summary,legend,caption,th,td,button,[role="heading"],[class*="text" i],[class*="title" i],[class*="label" i],[class*="caption" i],[class*="description" i],[class*="subtitle" i],[class*="headline" i],[class*="message" i],[class*="comment" i])';
    const muted = ':where([class*="muted" i],[class*="secondary" i],[class*="subtle" i],[class*="meta" i],[class*="timestamp" i],[aria-disabled="true"],[disabled])';
    const field = ':where(input:not([type="image"]):not([type="range"]):not([type="checkbox"]):not([type="radio"]),textarea,select,[contenteditable="true"],[role="textbox"])';
    const button = ':where(button,input[type="button"],input[type="submit"],input[type="reset"],summary,[role="button"],a[class*="button" i],.btn,[class~="button" i],[class$="-button" i])';
    const buttonSafe = button + ':not(.ytp-button):not([class*="player" i]):not([class*="video" i]):not([class*="media" i])';
    const selectedControl = ':where(button,[role="button"],.btn,[class~="button" i],[class$="-button" i],[role="tab"]):where([aria-pressed="true"],[aria-selected="true"],[aria-current="page"],.active,.selected,.is-active,[data-active="true"])';
    const primaryControl = ':where(button,input[type="submit"],[role="button"],.btn,[class~="button" i],[class$="-button" i]):where([type="submit"],[class*="primary" i],[class*="accent" i],[class*="brand" i],[data-variant*="primary" i],[data-primary="true"])';
    const dangerControl = ':where(button,[role="button"],.btn,[class~="button" i],[class$="-button" i]):where([class*="danger" i],[class*="destructive" i],[class*="delete" i],[class*="remove" i],[data-variant*="danger" i])';
    const mediaControl = ':where([class*="player" i],[class*="video" i],[class*="media" i],[class*="audio" i]) :where(button,[role="button"],svg,path)';
    const code = ':where(pre,code,kbd,samp,mark)';
    const vars = [
      '--bs-body-bg:' + p.bg,
      '--bs-body-color:' + p.text,
      '--bs-secondary-bg:' + p.surface,
      '--bs-tertiary-bg:' + p.raised,
      '--bs-border-color:' + p.border,
      '--bs-link-color:' + p.link,
      '--mui-palette-background-default:' + p.bg,
      '--mui-palette-background-paper:' + p.surface,
      '--mui-palette-text-primary:' + p.text,
      '--mui-palette-text-secondary:' + p.muted,
      '--mat-sys-background:' + p.bg,
      '--mat-sys-surface:' + p.surface,
      '--mat-sys-surface-container:' + p.raised,
      '--mat-sys-on-background:' + p.text,
      '--mat-sys-on-surface:' + p.text,
      '--mantine-color-body:' + p.bg,
      '--mantine-color-text:' + p.text,
      '--chakra-colors-bg:' + p.bg,
      '--chakra-colors-fg:' + p.text,
      '--ant-color-bg-base:' + p.bg,
      '--ant-color-bg-container:' + p.surface,
      '--ant-color-bg-elevated:' + p.raised,
      '--ant-color-text:' + p.text,
      '--ant-color-text-secondary:' + p.muted,
      '--ant-color-border:' + p.border,
      '--ant-color-primary:' + p.primary,
      '--color-canvas-default:' + p.bg,
      '--color-canvas-subtle:' + p.surface,
      '--color-canvas-inset:' + p.raised,
      '--color-fg-default:' + p.text,
      '--color-fg-muted:' + p.muted,
      '--color-border-default:' + p.border,
      '--color-accent-fg:' + p.link,
      '--bgColor-default:' + p.bg,
      '--bgColor-muted:' + p.surface,
      '--fgColor-default:' + p.text,
      '--fgColor-muted:' + p.muted,
      '--borderColor-default:' + p.border,
      '--button-default-bgColor-rest:' + p.control,
      '--button-default-fgColor-rest:' + p.text,
      '--button-primary-bgColor-rest:' + p.primary,
      '--button-primary-fgColor-rest:' + p.primaryText,
    ].join(' !important;') + ' !important;';
    return root + '{' + vars + 'color-scheme:' + p.scheme + ' !important;accent-color:' + p.link + ' !important;background-color:' + p.bg + ' !important;color:' + p.text + ' !important;}'
      + app + '{background-color:' + p.bg + ' !important;color:' + p.text + ' !important;}'
      // shell (header/nav/sidebar/footer): like surface, don't invent a bg/border box — the
      // remap darkens the nav's own background, so forcing p.surface just made a lighter bar
      // + a border line at the top. Recolour text only; real nav bg comes from the remap.
      + shell + '{color:' + p.text + ' !important;}'
      // surface: DON'T invent a background/border on generic content containers (section,
      // article, role-regions, card/panel/chat/message classes). That painted a visible
      // box on every transparent layout container (GitHub hero band, Discord content
      // panels). The main colour-remap already darkens any background a site actually has,
      // and applyComputedBgFix catches light ones, so we only recolour the TEXT here and
      // let real surfaces keep their (remapped) own background. Overlays (raised) + shells
      // (nav/sidebar) still get a background below so they stay defined.
      + surface + '{color:' + p.text + ' !important;}'
      + raised + '{background-color:' + p.raised + ' !important;color:' + p.text + ' !important;border-color:' + p.border + ' !important;}'
      + text + '{color:' + p.text + ' !important;-webkit-text-fill-color:currentColor !important;text-shadow:none !important;}'
      + muted + '{color:' + p.muted + ' !important;-webkit-text-fill-color:currentColor !important;}'
      + 'a[href],[role="link"]{color:' + p.link + ' !important;-webkit-text-fill-color:currentColor !important;}'
      // The line above takes :visited down with it. A forced link colour applies
      // to both states, so on a page of results every link came out the same
      // colour whether or not the reader had already opened it. Restoring it
      // costs one rule, and :visited outranks the plain selector, so the order
      // here is for reading rather than for the cascade.
      //
      // -webkit-text-fill-color paints OVER color, so it has to be repeated
      // here or the fill from the rule above keeps painting the unvisited
      // colour on top. currentColor is correct and was checked on a real
      // search page rather than reasoned about: Chrome resolves it against the
      // visited colour, and the purple comes back.
      + 'a[href]:visited,[role="link"]:visited{color:' + p.visited + ' !important;-webkit-text-fill-color:currentColor !important;}'
      + field + '{background-color:' + p.input + ' !important;color:' + p.text + ' !important;-webkit-text-fill-color:currentColor !important;caret-color:' + p.text + ' !important;border-color:' + p.border + ' !important;box-shadow:none !important;}'
      + field + '::placeholder{color:' + p.muted + ' !important;-webkit-text-fill-color:' + p.muted + ' !important;opacity:1 !important;}'
      + 'input[type="checkbox"],input[type="radio"],input[type="range"]{accent-color:' + p.primary + ' !important;}'
      + buttonSafe + '{background-color:' + p.control + ' !important;color:' + p.text + ' !important;-webkit-text-fill-color:currentColor !important;border-color:' + p.border + ' !important;box-shadow:none !important;}'
      + buttonSafe + ':hover{background-color:' + p.controlHover + ' !important;color:' + p.text + ' !important;-webkit-text-fill-color:currentColor !important;}'
      + buttonSafe + ':focus-visible,' + field + ':focus-visible{outline:2px solid ' + p.focus + ' !important;outline-offset:2px !important;border-color:' + p.focus + ' !important;}'
      + buttonSafe + ' :where(svg,path,use),'+ buttonSafe + ':where(svg,path,use){color:currentColor !important;fill:currentColor !important;stroke:currentColor !important;}'
      + selectedControl + '{background-color:' + p.selected + ' !important;color:' + p.selectedText + ' !important;-webkit-text-fill-color:currentColor !important;border-color:' + p.focus + ' !important;box-shadow:none !important;}'
      + selectedControl + ' *{color:inherit !important;-webkit-text-fill-color:currentColor !important;fill:currentColor !important;stroke:currentColor !important;text-shadow:none !important;}'
      + primaryControl + '{background-color:' + p.primary + ' !important;color:' + p.primaryText + ' !important;-webkit-text-fill-color:currentColor !important;border-color:' + p.primary + ' !important;box-shadow:none !important;}'
      + primaryControl + ' *{color:inherit !important;-webkit-text-fill-color:currentColor !important;fill:currentColor !important;stroke:currentColor !important;text-shadow:none !important;}'
      + dangerControl + '{background-color:' + p.danger + ' !important;color:' + p.dangerText + ' !important;-webkit-text-fill-color:currentColor !important;border-color:' + p.danger + ' !important;box-shadow:none !important;}'
      + dangerControl + ' *{color:inherit !important;-webkit-text-fill-color:currentColor !important;fill:currentColor !important;stroke:currentColor !important;text-shadow:none !important;}'
      + buttonSafe + ':disabled,' + buttonSafe + '[disabled],' + buttonSafe + '[aria-disabled="true"]{background-color:' + p.surface + ' !important;color:' + p.muted + ' !important;-webkit-text-fill-color:currentColor !important;border-color:' + p.border + ' !important;opacity:.72 !important;box-shadow:none !important;}'
      + mediaControl + '{background-color:transparent !important;background-image:none !important;color:inherit !important;-webkit-text-fill-color:currentColor !important;border-color:transparent !important;box-shadow:none !important;filter:none !important;}'
      + code + '{background-color:' + p.raised + ' !important;color:' + p.text + ' !important;-webkit-text-fill-color:currentColor !important;border-color:' + p.border + ' !important;}'
      + 'hr{border-color:' + p.border + ' !important;}'
      // Suppress PERSISTENT (non-focus) outlines. Sites (e.g. GitHub's landing page) put a
      // light outline on layout containers that is invisible on their native background but
      // shows as lines-around-everything once EyeShield darkens the page; the colour-remap can
      // miss it (outline set via the shorthand / cross-origin CSS). Real focus rings are kept
      // (:focus / :focus-visible are excluded), so accessibility is unaffected.
      + '*:not(:focus):not(:focus-visible){outline-color:transparent !important;}'
      + 'img,picture,video,canvas,svg,iframe,embed,object{filter:none !important;}'
      // GitHub-scoped repairs (github.com is non-managed -> generic path):
      // (1) the green primary CTA was crushed to the neutral control colour because
      //     buttonSafe's :not(.class) chain (specificity 0,4,0) out-weighs the all-:where
      //     primaryControl rule (0,0,0); re-assert GitHub's brand green at >buttonSafe
      //     specificity (buttonSafe + a class = 0,5,0) so the primary CTA stays branded.
      // (2) GitHub's floating-label inputs (CtaFormControl) hide their placeholder until
      //     focus; line ~1140 force-shows EVERY placeholder, revealing it ON TOP of the
      //     label -> doubled text. Keep it hidden while unfocused (focus still shows it).
      + (isGH
        ? buttonSafe + '[class*="primary" i]{background-color:#2da44e !important;border-color:#2da44e !important;color:#ffffff !important;-webkit-text-fill-color:#ffffff !important;}'
          + buttonSafe + '[class*="primary" i]:hover{background-color:#2c974b !important;border-color:#2c974b !important;}'
          + '[class*="CtaFormControl" i] input:not(:focus)::placeholder,[class*="FormControl" i]:has(label[class*="FormControl-label" i]) input:not(:focus)::placeholder{color:transparent !important;-webkit-text-fill-color:transparent !important;}'
        : '')
      + (isXSite && mode === 'light'
        ? 'html body :where(button,[role="button"],a[role="button"],div[role="button"]){background-color:' + p.control + ' !important;background-image:none !important;color:' + p.text + ' !important;-webkit-text-fill-color:currentColor !important;border-color:' + p.border + ' !important;box-shadow:none !important;}'
          + 'html body :where(button,[role="button"],a[role="button"],div[role="button"]) *{color:' + p.text + ' !important;-webkit-text-fill-color:currentColor !important;fill:currentColor !important;stroke:currentColor !important;text-shadow:none !important;}'
          + 'html body :where(div,section,aside):has([href*="privacy" i]),html body :where(div,section,aside):has([href*="cookies" i]),html body :where(div,section,aside):has(button):has(a[href*="privacy" i]){background-color:' + p.surface + ' !important;background-image:none !important;color:' + p.text + ' !important;-webkit-text-fill-color:currentColor !important;border-color:' + p.border + ' !important;box-shadow:none !important;}'
          + 'html body :where(div,section,aside):has([href*="privacy" i]) *,html body :where(div,section,aside):has([href*="cookies" i]) *,html body :where(div,section,aside):has(button):has(a[href*="privacy" i]) *{color:' + p.text + ' !important;-webkit-text-fill-color:currentColor !important;text-shadow:none !important;}'
          + 'html body :where([class*="bg-black" i],[class*="bg-\\[black\\]" i],[class*="bg-\\[\\#000" i],[class*="bg-neutral-950" i],[class*="bg-zinc-950" i],[class*="bg-slate-950" i],[class*="bg-gray-950" i]){background-color:#111318 !important;background-image:none !important;color:#ffffff !important;-webkit-text-fill-color:#ffffff !important;border-color:#111318 !important;}'
          + 'html body :where([class*="bg-black" i],[class*="bg-\\[black\\]" i],[class*="bg-\\[\\#000" i],[class*="bg-neutral-950" i],[class*="bg-zinc-950" i],[class*="bg-slate-950" i],[class*="bg-gray-950" i]) *{color:#ffffff !important;-webkit-text-fill-color:#ffffff !important;fill:currentColor !important;stroke:currentColor !important;text-shadow:none !important;}'
          + 'html body :where(div,section,aside,footer)[class*="two-col" i],html body :where(div,section,aside,footer)[class*="cookie" i],html body :where(div,section,aside,footer)[class*="privacy" i]{background-color:' + p.surface + ' !important;background-image:none !important;color:' + p.text + ' !important;-webkit-text-fill-color:currentColor !important;border-color:' + p.border + ' !important;box-shadow:none !important;}'
          + 'html body :where(div,section,aside,footer)[class*="two-col" i] *,html body :where(div,section,aside,footer)[class*="cookie" i] *,html body :where(div,section,aside,footer)[class*="privacy" i] *{color:' + p.text + ' !important;-webkit-text-fill-color:currentColor !important;text-shadow:none !important;}'
          + 'html body :where(div,section,aside)[class*="end-[3vw]" i][class*="bottom-[3vw]" i],html body :where(div,section,aside)[class*="z-[1000]" i][class*="rounded" i][class*="fixed" i]{background-color:' + p.surface + ' !important;background-image:none !important;color:' + p.text + ' !important;-webkit-text-fill-color:currentColor !important;border-color:' + p.border + ' !important;box-shadow:0 12px 28px rgba(15,23,42,.16) !important;}'
          + 'html body :where(div,section,aside)[class*="end-[3vw]" i][class*="bottom-[3vw]" i] *,html body :where(div,section,aside)[class*="z-[1000]" i][class*="rounded" i][class*="fixed" i] *{color:' + p.text + ' !important;-webkit-text-fill-color:currentColor !important;text-shadow:none !important;}'
        : '');
  }

  /* Anything painted by the channel swatch keeps its own colour. */
  const NOT_SWATCH = ':not(.ytp-swatch-background-color)';



  function managedShadowCSS(mode) {
    switch (managedThemeHostName()) {
      case 'youtube': return siteCSSOf('youtubeShadowCSS', mode);
      case 'reddit': return siteCSSOf('redditShadowCSS', mode);
      case 'chatgpt': return siteCSSOf('chatGPTCSS', mode, true);
      case 'google': return siteCSSOf('googleShadowCSS', mode);
      default: return '';
    }
  }

  function youtubePalette(remap) {
    if (remap === 'light') return {
      scheme: 'light', bg: '#ffffff', surface: '#ffffff', raised: '#f1f1f1',
      chip: '#f1f1f1', selected: '#ffffff', selectedText: '#0f0f0f',
      input: '#ffffff', button: '#f8f8f8', border: '#d3d3d3',
      text: '#0f0f0f', muted: '#606060', disabled: '#909090', link: '#065fd4',
    };
    const ultra = remap === 'ultra';
    return {
      scheme: 'dark', bg: ultra ? '#000000' : '#0f0f0f', surface: ultra ? '#050505' : '#0f0f0f',
      raised: ultra ? '#080808' : '#212121', chip: ultra ? '#151515' : '#272727',
      selected: ultra ? '#262626' : '#f1f1f1', selectedText: ultra ? '#f1f1f1' : '#0f0f0f',
      input: ultra ? '#050505' : '#121212', button: ultra ? '#111111' : '#272727',
      border: ultra ? '#242424' : '#303030', text: '#f1f1f1',
      muted: '#aaaaaa', disabled: '#717171', link: '#3ea6ff',
    };
  }









  function scopedSelectors(bases, suffixes) {
    const baseList = Array.isArray(bases) ? bases : String(bases || '').split(',');
    const suffixList = Array.isArray(suffixes) ? suffixes : [suffixes || ''];
    const out = [];
    for (let i = 0; i < baseList.length; i++) {
      const base = String(baseList[i] || '').trim();
      if (!base) continue;
      for (let j = 0; j < suffixList.length; j++) out.push(base + String(suffixList[j] || ''));
    }
    return out.join(',');
  }

  function youtubeTextVars(text) {
    return '--yt-spec-text-primary:' + text + ' !important;'
      + '--yt-spec-text-primary-inverse:' + text + ' !important;'
      + '--yt-spec-static-brand-black:' + text + ' !important;'
      + '--yt-spec-static-brand-white:' + text + ' !important;'
      + '--yt-spec-text-secondary:' + text + ' !important;';
  }

  function youtubeSubscribePalette(p) {
    const light = p.scheme === 'light';
    return {
      bg: light ? '#ffffff' : p.chip,
      text: light ? '#0f0f0f' : p.text,
      border: light ? '#d3d3d3' : p.border,
    };
  }


















  // Twitch chat names, and the exclusion every broad text rule has to carry.
  //
  // A name's colour is data: Twitch gives each participant a hue and sets it as an INLINE style.
  // An important stylesheet declaration outranks a normal inline one, so any `!important` colour
  // rule that reaches these elements repaints the whole room to a single value -- which is what
  // made chat a wall of identical white text. Two rules could reach them: the chat text rule
  // named them outright, and the site-wide text rule matches `[class*="Text"]`, which catches the
  // styled-component classes Twitch generates around chat.
  const TWITCH_CHAT_NAME = '.chat-line__username,.chat-author__display-name';
  const TWITCH_NOT_CHAT_NAME = ':not(.chat-line__username):not(.chat-author__display-name)'
    + ':not(.chat-line__username *):not(.chat-author__display-name *)';








  function googlePaletteFor(mode) {
    const p = paletteFor(mode);
    if (mode === 'light') {
      return {
        scheme: 'light',
        bg: '#ffffff',
        surface: '#ffffff',
        raised: '#f8fafd',
        input: '#ffffff',
        chip: '#f1f3f4',
        row: '#f1f3f4',
        hover: '#f1f3f4',
        border: '#dadce0',
        text: '#202124',
        muted: '#5f6368',
        icon: '#3c4043',
        link: '#1a0dab',
        visited: '#681da8',
      };
    }
    return {
      scheme: p.scheme,
      bg: p.bg,
      surface: p.surface,
      raised: p.raised,
      input: p.input,
      chip: p.control,
      row: p.surface,
      hover: p.raised,
      border: p.border,
      text: p.text,
      muted: p.muted,
      icon: p.text,
      link: p.link,
      visited: p.visited,
    };
  }























  // A clean, consistent text-selection colour in EVERY mode. Previously only light
  // mode set one; dark/ultra fell back to the page's native ::selection run through
  // the remap, which produced a muddy, low-contrast highlight (the "weird highlighted
  // text" over Google's AI Overview). Light keeps the familiar blue; dark/ultra get a
  // slightly brighter blue that stays crisp on a near-black surface. Forcing white
  // text + no text-shadow keeps the selected words readable over the highlight.
  function selectionCSS(mode) {
    const bg = mode === 'light' ? '#285fbd' : '#2f5fb0';
    return '::selection,*::selection,#search ::selection,#search *::selection,#rso ::selection,#rso *::selection{background:' + bg + ' !important;background-color:' + bg + ' !important;color:#ffffff !important;-webkit-text-fill-color:#ffffff !important;text-shadow:none !important;}'
      + '::-moz-selection,*::-moz-selection,#search ::-moz-selection,#search *::-moz-selection,#rso ::-moz-selection,#rso *::-moz-selection{background:' + bg + ' !important;background-color:' + bg + ' !important;color:#ffffff !important;text-shadow:none !important;}';
  }
  function themeHeader(remap) {
    return 'html{color-scheme:' + (remap === 'light' ? 'light' : 'dark') + ' !important;}'
      + 'html,body{background-color:' + BASE_BG[remap] + ' !important;' + (remap === 'light' ? 'color:#202124 !important;' : '') + '}'
      + 'img,picture,video,canvas,svg,iframe,embed,object{filter:none !important;}'
      + '@media print{#' + SCRIM_ID + '{display:none !important;}}';
  }
  /* Per-site themes live in eyeshield-sites.js, which is registered top-frame-only so
     the ten managed stylesheets are not compiled into every iframe on every site
     (COST-03). Resolved on first use rather than at load, so the two registrations can
     arrive in either order. A frame without the file themes generically, which is the
     intended behaviour there and also the safe failure if the file is ever missing. */
  var __eyeSitesResolved = false;
  var __eyeSites = null;
  function eyeSites() {
    if (__eyeSitesResolved) return __eyeSites;
    __eyeSitesResolved = true;
    try {
      var reg = globalThis.__woEyeSites;
      if (reg && typeof reg.factory === 'function') {
        __eyeSites = reg.factory({
          paletteFor: paletteFor,
          isYouTubeHost: isYouTubeHost,
          youtubePalette: youtubePalette,
          TWITCH_NOT_CHAT_NAME: TWITCH_NOT_CHAT_NAME,
          youtubeSubscribePalette: youtubeSubscribePalette,
          youtubeTextVars: youtubeTextVars,
          isTwitchHost: isTwitchHost,
          googlePaletteFor: googlePaletteFor,
          NOT_SWATCH: NOT_SWATCH,
          scopedSelectors: scopedSelectors,
          TWITCH_CHAT_NAME: TWITCH_CHAT_NAME,
          isChatGPTHost: isChatGPTHost,
          isGoogleHost: isGoogleHost,
          isGitHubHost: isGitHubHost,
          isStackOverflowHost: isStackOverflowHost,
          isHackerNewsHost: isHackerNewsHost,
          isWikipediaHost: isWikipediaHost,
          isRedditHost: isRedditHost,
          isAmazonHost: isAmazonHost,
        });
      }
    } catch (_) { __eyeSites = null; }
    return __eyeSites;
  }
  function siteCSSOf(name, a, b) {
    try {
      var set = eyeSites();
      var fn = set && set[name];
      return fn ? String(fn(a, b) || '') : '';
    } catch (_) { return ''; }
  }

  function themeFooter(remap) {
    let siteCSS = '';
    switch (managedThemeHostName()) {
      case 'google':
        siteCSS = remap === 'light' ? siteCSSOf('googleLightCSS') : siteCSSOf('googleDarkCSS', remap);
        break;
      case 'github':
        siteCSS = siteCSSOf('githubCSS', remap);
        break;
      case 'stackoverflow':
        siteCSS = siteCSSOf('stackOverflowCSS', remap);
        break;
      case 'hackernews':
        siteCSS = siteCSSOf('hackerNewsCSS', remap);
        break;
      case 'wikipedia':
        siteCSS = siteCSSOf('wikipediaCSS', remap);
        break;
      case 'youtube':
        siteCSS = remap === 'light' ? siteCSSOf('youtubeLightCSS') : siteCSSOf('youtubeDarkCSS', remap);
        break;
      case 'twitch':
        siteCSS = remap === 'light' ? siteCSSOf('twitchLightCSS') : siteCSSOf('twitchDarkCSS', remap);
        break;
      case 'chatgpt':
        siteCSS = siteCSSOf('chatGPTCSS', remap, false);
        break;
      case 'reddit':
        siteCSS = siteCSSOf('redditCSS', remap);
        break;
      case 'amazon':
        siteCSS = siteCSSOf('amazonCSS', remap);
        break;
      default:
        siteCSS = '';
    }
    return siteCSS + selectionCSS(remap); // dark / ultra: give them the same crisp selection
  }
  // ---------- main ----------
  let lastAppliedMode = null;
  // ---------- Discord: drive its NATIVE theme (it ships polished light + dark themes via
  // <html> classes theme-dark/theme-darker/images-dark). Remapping a dark-built app to light
  // produced the broken half-dark/half-light look, so for Discord we just flip its own
  // theme classes per mode and skip the generic remap entirely.
  const DISCORD_HOST_RE = /(^|\.)discord\.com$/i;
  function isDiscordHost() { return DISCORD_HOST_RE.test(String(location.hostname || '').toLowerCase()); }
  // Spotify web is a DARK-NATIVE app. The generic remap strips its panel backgrounds and
  // blanks parts of the library/player UI, so Spotify gets a managed Encore-variable path
  // plus explicit shell repairs instead of the generic stylesheet remap.
  const SPOTIFY_HOST_RE = /(^|\.)spotify\.com$/i;
  function isSpotifyHost() { return SPOTIFY_HOST_RE.test(String(location.hostname || '').toLowerCase()); }
  // Spotify web themes itself entirely through its Encore CSS variables. Drive THOSE per mode
  // (instead of the generic remap, which strips its panel backgrounds and blanks the main view).
  // Brand/semantic colours (green/blue/red/orange) are left untouched. !important + the encore
  // class selectors override Spotify's own theme rule; our <style> is appended last so it wins.
  function spotifyThemeCSS(mode) {
    var p;
    if (mode === 'light') p = {
      bg: '#f4f5f7', hi: '#eef0f4', press: '#e2e5eb', elev: '#ffffff', elevHi: '#f1f3f6', elevPress: '#e4e8ef',
      text: '#121212', sub: '#5b6068', ess: '#121212', essSub: '#6a6f78', dec: '#121212', decSub: '#dadbe0',
      tinted: '#0000000d', tintedHi: '#00000017', tintedPress: '#00000024',
      control: '#f1f3f6', controlHi: '#e5e8ee', border: '#d8dbe2', input: '#ffffff',
    };
    else if (mode === 'ultra') p = {
      bg: '#000000', hi: '#0b0c0e', press: '#000000', elev: '#0d0e11', elevHi: '#16181c', elevPress: '#08090b',
      text: '#f3f5f8', sub: '#a9b0bc', ess: '#f3f5f8', essSub: '#8a909b', dec: '#f3f5f8', decSub: '#1a1c20',
      tinted: '#ffffff12', tintedHi: '#ffffff20', tintedPress: '#ffffff30',
      control: '#15171b', controlHi: '#20242a', border: '#252a31', input: '#0d0e11',
    };
    else p = { // dark
      bg: '#16181a', hi: '#1f2227', press: '#000000', elev: '#1f2227', elevHi: '#2a2e34', elevPress: '#191b1f',
      text: '#f3f5f8', sub: '#b3b6bd', ess: '#f3f5f8', essSub: '#8a8f97', dec: '#f3f5f8', decSub: '#2a2e34',
      tinted: '#ffffff1a', tintedHi: '#ffffff24', tintedPress: '#ffffff36',
      control: '#24282f', controlHi: '#2f343d', border: '#343a44', input: '#1f2227',
    };
    var sel = ':root,html,body,.encore-dark-theme,.encore-light-theme,[class*="encore-dark-theme" i],[class*="encore-light-theme" i]';
    var appShell = 'html body :is(#main,[data-testid="root"],.Root,.Root__top-container,.Root__main-view,.main-view-container,.main-view-container__scroll-node)';
    var chromeShell = 'html body :is([data-testid="global-nav-bar"],[data-testid="now-playing-bar"],[data-testid="left-sidebar"],[data-testid="right-sidebar"],.Root__globalNav,.Root__top-bar,.Root__now-playing-bar,.Root__nav-bar,.Root__right-sidebar,.main-topBar-container,.main-nowPlayingBar-container)';
    var panelShell = 'html body :is(.main-yourLibraryX-library,.main-yourLibraryX-entryPoints,.main-card-card,.main-shelf-shelf,.main-trackList-trackList,[data-testid="playlist-tracklist"],[data-testid="tracklist-row"],[data-testid="entityTitle"],[data-testid="artist-page"],[data-testid="album-page"],[data-testid="playlist-page"],[data-testid="home-page"],[data-testid="right-sidebar"])';
    var controls = 'html :where(input:not([type="range"]),textarea,select,[role="textbox"],[contenteditable="true"],button,[role="button"],a[role="button"],[data-testid*="button" i])';
    var icons = 'html body :is([data-testid="global-nav-bar"],[data-testid="now-playing-bar"],[data-testid="left-sidebar"],[data-testid="right-sidebar"],.Root__globalNav,.Root__now-playing-bar,.Root__nav-bar,.Root__right-sidebar,.main-view-container) :where(svg,path,use)';
    var textScopes = 'html body :is(.main-view-container,.Root__nav-bar,.Root__right-sidebar,.Root__globalNav,.Root__now-playing-bar,[data-testid="global-nav-bar"],[data-testid="left-sidebar"],[data-testid="right-sidebar"],[data-testid="now-playing-bar"])';
    var lightBackdrop = 'html body :is(.Root,.Root__top-container,.Root__main-view,.Root__now-playing-bar,.Root__globalNav,[data-testid="root"],#main)';
    var lightGradientBits = 'html body :is(.main-home-homeHeader,.main-home-filterChipsContainer,.main-home-content,.main-topBar-background,.main-topBar-overlay,.main-actionBarBackground-background,.main-entityHeader-background,.main-entityHeader-overlay,.main-entityHeader-gradient,.main-view-container__mh-header,.main-view-container__mh-footer,[data-testid="home-page"] > div:first-child)';
    var lightHomeFilterBackdrop = 'html body .main-view-container__scroll-node main[aria-label] > div > div:has([aria-label="Home filters"]) > div:first-child';
    var lightRightPanel = 'html body :is(.Root__right-sidebar,[data-testid="right-sidebar"]) :where([class*="nowPlayingView" i],[class*="contextItemInfo" i],[class*="aboutArtist" i],[class*="section" i],[data-testid*="now-playing" i],[data-testid*="context" i],[data-testid*="artist" i])';
    var lightRightPanelFades = 'html body :is(.Root__right-sidebar,[data-testid="right-sidebar"]) :where([class*="background" i],[class*="gradient" i],[class*="overlay" i],[class*="scrim" i],[class*="shade" i],[class*="blur" i],[style*="gradient" i],[style*="rgba(0" i],[style*="rgb(0" i],[style*="#000" i]):not(img):not(picture):not(video):not(canvas):not(svg):not(path):not([style*="url"])';
    var lightRightPanelWash = 'html body :is(.Root__right-sidebar,[data-testid="right-sidebar"]) :where(div,section,article,aside,header,footer):not(img):not(picture):not(video):not(canvas):not(svg):not(path):not([style*="url"])';
    var lightRightArtShadow = 'html body :is(.Root__right-sidebar,[data-testid="right-sidebar"]) :where(img,picture,[data-testid*="cover" i],[data-testid*="art" i],[data-testid*="image" i],[class*="cover" i],[class*="artwork" i],[class*="image" i],[class*="shadow" i],[style*="drop-shadow" i],[style*="box-shadow" i])';
    var lightRightTextBg = 'html body :is(.Root__right-sidebar,[data-testid="right-sidebar"]) :where(div,section,article,aside,header,footer):has(:where(h1,h2,h3,p,span,a,[data-encore-id="text"],[data-encore-id="type"]))';
    var lightRightTitleOverlay = 'html body [data-testid="NPV_Panel_OpenDiv"] div:has([data-testid="context-item-info-title"])';
    var lightPlayerBar = 'html body :is(.Root__now-playing-bar,[data-testid="now-playing-bar"],.main-nowPlayingBar-container,.main-nowPlayingBar-nowPlayingBar,footer[role="contentinfo"])';
    var lightRootShell = 'html.spotify__container--is-web,html.spotify__container--is-web body,html.spotify__container--is-web body #main,html.spotify__container--is-web body #main > div,html.spotify__container--is-web body .Root,html.spotify__container--is-web body .Root > div,html.spotify__container--is-web body [data-testid="root"],html.spotify__container--is-web body [data-testid="root"] > div';
    var lightLayoutSurfaces = 'html.spotify__container--is-web body :is(#Desktop_LeftSidebar_Id,#Desktop_RightSidebar_Id,[id^="Desktop_LeftSidebar"],[id^="Desktop_RightSidebar"],[data-testid="global-nav-bar"],[data-testid="left-sidebar"],[data-testid="right-sidebar"],[data-testid="now-playing-bar"],[data-testid="LayoutResizer__resize-bar"],footer[role="contentinfo"],#main > div > div:last-child,#main div:has(> [data-testid="now-playing-bar"]),#main div:has([data-testid="signup-bar"]),.Root__globalNav,.Root__nav-bar,.Root__right-sidebar,.Root__now-playing-bar,.main-nowPlayingBar-container,.main-nowPlayingBar-nowPlayingBar,.YourLibraryX,[class*="YourLibrary" i])';
    var lightLegalLinks = 'html.spotify__container--is-web body :is(#Desktop_LeftSidebar_Id,[id^="Desktop_LeftSidebar"],.Root__nav-bar,[data-testid="left-sidebar"],[data-testid="left-sidebar-footer"],[data-testid="left-sidebar-legal-links"]) :where(footer,[class*="legal" i],[class*="privacy" i],a[href*="privacy" i],a[href*="cookie" i],a[href*="accessibility" i])';
    var lightSidebarLegalText = 'html.spotify__container--is-web body :is([data-testid="left-sidebar-footer"],[data-testid="left-sidebar-legal-links"]) :where(a,span,p,small,button,div)';
    var lightScrollFooter = 'html.spotify__container--is-web body :is(.main-view-container__scroll-node footer,.main-view-container__scroll-node [data-testid*="footer" i],.main-view-container__scroll-node [class*="links-group" i])';
    return sel + '{'
      + '--background-base:' + p.bg + ' !important;--background-highlight:' + p.hi + ' !important;--background-press:' + p.press + ' !important;'
      + '--background-elevated-base:' + p.elev + ' !important;--background-elevated-highlight:' + p.elevHi + ' !important;--background-elevated-press:' + p.elevPress + ' !important;'
      + '--background-tinted-base:' + p.tinted + ' !important;--background-tinted-highlight:' + p.tintedHi + ' !important;--background-tinted-press:' + p.tintedPress + ' !important;'
      + '--text-base:' + p.text + ' !important;--text-subdued:' + p.sub + ' !important;'
      + '--essential-base:' + p.ess + ' !important;--essential-subdued:' + p.essSub + ' !important;'
      + '--decorative-base:' + p.dec + ' !important;--decorative-subdued:' + p.decSub + ' !important;color-scheme:' + (mode === 'light' ? 'light' : 'dark') + ' !important;}'
      // Force the root backdrop so no native dark shows through as black bars (esp. in light mode).
      + 'html,body,#main{background:' + p.bg + ' !important;}'
      + appShell + '{background:' + p.bg + ' !important;color:' + p.text + ' !important;}'
      + chromeShell + '{background:' + p.elev + ' !important;color:' + p.text + ' !important;border-color:' + p.border + ' !important;box-shadow:none !important;}'
      + panelShell + '{background-color:' + p.elev + ' !important;background-image:none !important;color:' + p.text + ' !important;border-color:' + p.border + ' !important;box-shadow:none !important;}'
      + controls + '{color:' + p.text + ' !important;-webkit-text-fill-color:currentColor !important;border-color:' + p.border + ' !important;box-shadow:none !important;}'
      + controls + ':where(:hover,[aria-expanded="true"],[aria-pressed="true"],[aria-selected="true"]){background-color:' + p.controlHi + ' !important;color:' + p.text + ' !important;}'
      + 'html :where(input:not([type="range"]),textarea,select,[role="textbox"],[contenteditable="true"]){background-color:' + p.input + ' !important;color:' + p.text + ' !important;-webkit-text-fill-color:currentColor !important;caret-color:' + p.text + ' !important;}'
      + icons + '{color:currentColor !important;fill:currentColor !important;stroke:currentColor !important;}'
      + 'html :where(img,picture,video,canvas,iframe,embed,object){filter:none !important;background-color:transparent !important;}'
      + (mode === 'light'
        ? lightRootShell + '{background:' + p.bg + ' !important;background-image:none !important;color:' + p.text + ' !important;}'
          + lightRootShell + '::before,' + lightRootShell + '::after{background:transparent !important;background-image:none !important;box-shadow:none !important;}'
          + lightLayoutSurfaces + '{background:' + p.elev + ' !important;background-image:none !important;color:' + p.text + ' !important;border-color:' + p.border + ' !important;box-shadow:none !important;}'
          + lightLayoutSurfaces + '::before,' + lightLayoutSurfaces + '::after{background:transparent !important;background-image:none !important;border-color:transparent !important;box-shadow:none !important;}'
          + lightBackdrop + '{background:' + p.bg + ' !important;}'
          + lightGradientBits + '{background:' + p.elev + ' !important;background-image:none !important;color:' + p.text + ' !important;box-shadow:none !important;}'
          + lightHomeFilterBackdrop + ',' + lightHomeFilterBackdrop + '[class]{background-color:' + p.elev + ' !important;background-image:none !important;box-shadow:none !important;}'
          + lightHomeFilterBackdrop + '::before,' + lightHomeFilterBackdrop + '::after{background:transparent !important;background-color:transparent !important;background-image:none !important;box-shadow:none !important;}'
          + lightRightPanel + '{background:' + p.elev + ' !important;background-image:none !important;color:' + p.text + ' !important;border-color:' + p.border + ' !important;box-shadow:none !important;}'
          + lightRightPanelWash + '{background:' + p.elev + ' !important;background-image:none !important;box-shadow:none !important;filter:none !important;}'
          + lightRightTextBg + '{background:' + p.elev + ' !important;background-image:none !important;box-shadow:none !important;filter:none !important;}'
          + lightRightTextBg + '::before,' + lightRightTextBg + '::after{background:' + p.elev + ' !important;background-image:none !important;box-shadow:none !important;filter:none !important;}'
          + lightRightTitleOverlay + '{background-image:none !important;box-shadow:none !important;filter:none !important;}'
          + lightRightTitleOverlay + '::before,' + lightRightTitleOverlay + '::after{background:' + p.elev + ' !important;background-image:none !important;box-shadow:none !important;filter:none !important;opacity:1 !important;}'
          + lightRightArtShadow + '{box-shadow:none !important;filter:none !important;text-shadow:none !important;}'
          + lightRightArtShadow + '::before,' + lightRightArtShadow + '::after{box-shadow:none !important;filter:none !important;background:transparent !important;background-image:none !important;}'
          + lightGradientBits + '::before,' + lightGradientBits + '::after,' + lightRightPanel + '::before,' + lightRightPanel + '::after{background:' + p.elev + ' !important;background-image:none !important;box-shadow:none !important;}'
          + lightRightPanelFades + ',' + lightRightPanelFades + '::before,' + lightRightPanelFades + '::after{background:' + p.elev + ' !important;background-image:none !important;box-shadow:none !important;filter:none !important;}'
          + lightPlayerBar + '{background:' + p.elev + ' !important;background-image:none !important;border-top:0 !important;box-shadow:0 -8px 0 0 ' + p.elev + ' !important;outline-color:transparent !important;}'
          + lightPlayerBar + ' > :where(div,section,footer){background:' + p.elev + ' !important;background-image:none !important;border-top:0 !important;box-shadow:none !important;outline-color:transparent !important;}'
          + lightPlayerBar + '::before,' + lightPlayerBar + '::after{background:' + p.elev + ' !important;background-image:none !important;border-color:transparent !important;box-shadow:none !important;}'
          + lightLegalLinks + '{color:' + p.text + ' !important;-webkit-text-fill-color:currentColor !important;text-shadow:none !important;}'
          + lightLegalLinks + ' :where(a,span,p,small,button,div){color:' + p.text + ' !important;-webkit-text-fill-color:currentColor !important;text-shadow:none !important;}'
          + lightSidebarLegalText + '{color:' + p.text + ' !important;-webkit-text-fill-color:currentColor !important;text-shadow:none !important;}'
          + lightScrollFooter + '{background:' + p.elev + ' !important;background-image:none !important;color:' + p.text + ' !important;border-color:' + p.border + ' !important;box-shadow:none !important;}'
          + lightScrollFooter + ' :where(h1,h2,h3,h4,p,span,a,li,button,small,strong,em){color:' + p.text + ' !important;-webkit-text-fill-color:currentColor !important;text-shadow:none !important;}'
          + 'html body [data-testid="home-page"] :is([class*="background" i],[class*="gradient" i]):not(img):not(picture):not(video):not(canvas):not(svg):not(path){background:' + p.elev + ' !important;background-image:none !important;}'
          + 'html body :is(.Root__nav-bar,[data-testid="left-sidebar"],.Root__right-sidebar,[data-testid="right-sidebar"],.Root__now-playing-bar,[data-testid="now-playing-bar"])::before,html body :is(.Root__nav-bar,[data-testid="left-sidebar"],.Root__right-sidebar,[data-testid="right-sidebar"],.Root__now-playing-bar,[data-testid="now-playing-bar"])::after{background:' + p.elev + ' !important;background-image:none !important;}'
        : '')
      // Spotify is dark-built: a lot of its text is HARDCODED white (rgba(255,255,255,.x)),
      // not driven by --text-base — so on a light background it's invisible (the "empty" centre).
      // In LIGHT mode only, force content text dark. Encore wraps text in [data-encore-id="text"/"type"];
      // also cover raw text in the main view, sidebars, top nav, and player bar. Album art is untouched.
      + (mode === 'light'
        ? textScopes + ' :where(h1,h2,h3,h4,h5,h6,p,span,a,li,button,small,strong,em,[role="text"],[data-encore-id="text"],[data-encore-id="type"]),' +
          'html [data-encore-id="text"],html [data-encore-id="type"]{background-color:transparent !important;color:#121212 !important;-webkit-text-fill-color:#121212 !important;text-shadow:none !important;}'
          + 'html :where([data-testid="global-nav-bar"],[data-testid="now-playing-bar"],.Root__globalNav,.Root__now-playing-bar) :where(button,[role="button"],a,span,svg,path,use){color:#121212 !important;-webkit-text-fill-color:currentColor !important;fill:currentColor !important;stroke:currentColor !important;}'
          + 'html :where([data-testid="now-playing-bar"],.Root__now-playing-bar,.main-nowPlayingBar-container) :where(.playback-bar,.progress-bar,[data-testid*="progress" i]){background-color:transparent !important;color:#121212 !important;}'
        : 'html.spotify__container--is-web body :where(button,[role="button"],a[role="button"],[data-testid*="button" i]){color:' + p.text + ' !important;-webkit-text-fill-color:currentColor !important;}'
          + 'html.spotify__container--is-web body :where(button,[role="button"],a[role="button"],[data-testid*="button" i]) :where(span,div,[data-encore-id="text"],[data-encore-id="type"],svg,path,use){color:' + p.text + ' !important;-webkit-text-fill-color:currentColor !important;fill:currentColor !important;stroke:currentColor !important;text-shadow:none !important;}'
          + 'html.spotify__container--is-web body :where(.encore-inverted-light-set,.encore-inverted-dark-set,[class*="button-primary" i],[class*="legacy-button-primary" i]){color:' + p.text + ' !important;-webkit-text-fill-color:' + p.text + ' !important;}'
          + 'html.spotify__container--is-web body :where(.encore-inverted-light-set,.encore-inverted-dark-set,[class*="button-primary" i],[class*="legacy-button-primary" i]) *{color:' + p.text + ' !important;-webkit-text-fill-color:currentColor !important;fill:currentColor !important;stroke:currentColor !important;}');
  }
  // Re-inject Spotify's theme <style> at the END of <head> so it beats Spotify's own
  // stylesheets (which load AFTER our early inject) in the source-order/!important tie.
  let __woSpotReapplyScheduled = false;
  function injectSpotifyTheme(mode) {
    if (!isSpotifyHost()) return;
    removeThemeEls(); activeRemap = mode; themedOnce = true;
    const sst = document.createElement('style');
    sst.id = THEME_ID; sst.setAttribute('data-wo-eyeshield', '1'); sst.setAttribute('data-wo-eyeshield-mode', mode);
    sst.textContent = spotifyThemeCSS(mode);
    try { (document.head || document.documentElement).appendChild(sst); themeEls.push(sst); } catch (e) {}
  }
  const DISCORD_THEME_CLASSES = ['theme-light', 'theme-lighter', 'theme-dark', 'theme-darker'];
  const DISCORD_IMG_CLASSES = ['images-light', 'images-dark'];
  let discordOrigTheme = null; // Discord's own theme classes, captured once so 'off' can restore them
  let discordObserver = null;
  function discordDesired(mode) {
    if (mode === 'light') return { theme: ['theme-light', 'theme-lighter'], img: 'images-light' };
    if (mode === 'ultra') return { theme: ['theme-dark', 'theme-darker'], img: 'images-dark' };
    return { theme: ['theme-dark'], img: 'images-dark' }; // dark
  }
  // Discord re-scopes its theme on CHILD elements too (div/nav/section all carry
  // theme-dark/theme-darker/images-dark), so swapping only <html> left those subtrees dark.
  // We swap EVERY theme-scoped element and re-fix as Discord mounts new themed nodes (popouts/modals).
  const DISCORD_THEME_SEL = '[class*="theme-light"],[class*="theme-lighter"],[class*="theme-dark"],[class*="theme-darker"]';
  let discordWant = null, discordRescanT = 0;
  function discordHasTheme(el) {
    const cl = el.classList; if (!cl) return false;
    for (var i = 0; i < DISCORD_THEME_CLASSES.length; i++) if (cl.contains(DISCORD_THEME_CLASSES[i])) return true;
    return false;
  }
  function discordElOk(el, want) {
    const cl = el.classList; if (!cl) return true;
    for (var i = 0; i < want.theme.length; i++) if (!cl.contains(want.theme[i])) return false;
    if (!cl.contains(want.img)) return false;
    var all = DISCORD_THEME_CLASSES.concat(DISCORD_IMG_CLASSES);
    for (var j = 0; j < all.length; j++) {
      if (want.theme.indexOf(all[j]) < 0 && all[j] !== want.img && cl.contains(all[j])) return false;
    }
    return true;
  }
  function discordFixEl(el, want) {
    const cl = el.classList; if (!cl) return;
    DISCORD_THEME_CLASSES.concat(DISCORD_IMG_CLASSES).forEach(function (c) { cl.remove(c); });
    want.theme.forEach(function (c) { cl.add(c); });
    cl.add(want.img);
  }
  function discordAllThemeEls() {
    var out = [];
    try { var n = document.querySelectorAll(DISCORD_THEME_SEL); for (var i = 0; i < n.length; i++) out.push(n[i]); } catch (e) {}
    var h = document.documentElement; // ensure <html> is themed even if it currently lacks the class
    if (h && out.indexOf(h) < 0) out.push(h);
    return out;
  }
  function discordRescan() {
    if (!discordWant) return;
    var els = discordAllThemeEls();
    for (var i = 0; i < els.length; i++) if (!discordElOk(els[i], discordWant)) discordFixEl(els[i], discordWant);
  }
  function discordSchedule() {
    if (discordRescanT) return;
    discordRescanT = woTimeout(function () { discordRescanT = 0; discordRescan(); }, 50);
  }
  function applyDiscordTheme(mode) {
    discordWant = discordDesired(mode);
    if (discordOrigTheme === null) {
      var hcl = document.documentElement && document.documentElement.classList;
      discordOrigTheme = hcl ? DISCORD_THEME_CLASSES.concat(DISCORD_IMG_CLASSES).filter(function (c) { return hcl.contains(c); }) : [];
    }
    discordRescan(); // swap all currently themed elements now
    if (discordObserver) { try { discordObserver.disconnect(); } catch (e) {} }
    try {
      discordObserver = woObserver(function (muts) {
        for (var k = 0; k < muts.length; k++) {
          var m = muts[k];
          if (m.type === 'attributes') {
            if (m.target && m.target.nodeType === 1 && discordHasTheme(m.target) && !discordElOk(m.target, discordWant)) { discordSchedule(); return; }
          } else if (m.type === 'childList' && m.addedNodes) {
            for (var a = 0; a < m.addedNodes.length; a++) {
              var nd = m.addedNodes[a];
              if (nd && nd.nodeType === 1 && discordHasTheme(nd)) { discordSchedule(); return; }
            }
          }
        }
      });
      discordObserver.observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ['class'] });
    } catch (e) { discordObserver = null; }
  }
  function restoreDiscordTheme() {
    if (discordObserver) { try { discordObserver.disconnect(); } catch (e) {} discordObserver = null; }
    if (discordRescanT) { try { clearTimeout(discordRescanT); } catch (e) {} discordRescanT = 0; }
    discordWant = null;
    if (discordOrigTheme === null) return;
    var want = {
      theme: discordOrigTheme.filter(function (c) { return c.indexOf('theme-') === 0; }),
      img: (discordOrigTheme.filter(function (c) { return c.indexOf('images-') === 0; })[0] || 'images-dark')
    };
    var els = discordAllThemeEls();
    for (var i = 0; i < els.length; i++) discordFixEl(els[i], want);
  }

  function apply() {
    const enabled = cfg.enabled !== false;
    const mode = normalizeMode(cfg.eyeShieldMode);
    const brightness = getBrightness();
    cacheMode(enabled ? mode : 'off');

    // Discord: native-theme path (no remap). Handles every case and returns.
    if (isDiscordHost()) {
      removeThemeEls(); restoreInline(); disconnectObserver(); activeRemap = null; removePreload();
      if (!enabled || mode === 'off') {
        restoreDiscordTheme(); removeScrim(); removeAdjustFilter(); lastAppliedMode = mode;
        return;
      }
      if (brightness < 100) ensureScrim(brightness); else removeScrim();
      applyAdjustFilter(brightness, getContrast(), getSaturation(), getWarmth(), getGrayscale());
      applyDiscordTheme(mode);
      lastAppliedMode = mode;
      return;
    }

    // Spotify: theme via its OWN Encore CSS variables (the generic remap blanks it). off/disabled
    // -> remove our var-style so it reverts to native. light/dark/ultra -> inject the var theme.
    if (isSpotifyHost()) {
      disconnectObserver();
      if (!enabled || mode === 'off') {
        removeThemeEls(); restoreInline(); removeScrim(); removeAdjustFilter(); activeRemap = null; lastAppliedMode = 'off'; removePreload();
        return;
      }
      if (brightness < 100) ensureScrim(brightness); else removeScrim();
      // NEVER put the Extras filter on Spotify: a `filter` on <html> creates a containing
      // block that collapses Spotify's absolutely-positioned center pane (black middle). The
      // Encore var theme recolours it without a filter; Extras (contrast/sat) are dropped here.
      removeAdjustFilter();
      if (mode !== lastAppliedMode || !themeEls.length) {
        injectSpotifyTheme(mode);
        lastAppliedMode = mode;
      }
      // Spotify hydrates + loads its CSS async; re-inject a few times after load so our style
      // ends up last and wins (this is what a manual Dark->Light swap was doing by hand).
      if (!__woSpotReapplyScheduled) {
        __woSpotReapplyScheduled = true;
        var reinj = function () { try { if (cfg.enabled !== false && normalizeMode(cfg.eyeShieldMode) !== 'off' && isSpotifyHost()) injectSpotifyTheme(normalizeMode(cfg.eyeShieldMode)); } catch (e) {} };
        [500, 1500, 3500, 6000].forEach(function (ms) { try { woTimeout(reinj, ms); } catch (e) {} });
        try { woOn(window, 'load', function () { woTimeout(reinj, 300); }, { once: true }); } catch (e) {}
      }
      removePreload();
      return;
    }

    if (!enabled) {
      restoreInline(); removeThemeEls(); activeRemap = null; lastAppliedMode = null;
      removeScrim(); removeAdjustFilter(); disconnectObserver(); removePreload();
      return;
    }

    // Cheap, flash-free adjustments — always refreshed, no theme rebuild needed.
    if (brightness < 100 && !(mode === 'light' && isYouTubeHost())) ensureScrim(brightness);
    else removeScrim();
    applyAdjustFilter(brightness, getContrast(), getSaturation(), getWarmth(), getGrayscale());

    if (mode === 'off') {
      restoreInline(); removeThemeEls(); activeRemap = null; lastAppliedMode = 'off';
      disconnectObserver(); removePreload();
      return;
    }

    // Only rebuild the colour theme when the MODE actually changes (or it isn't
    // applied yet). Brightness / contrast / saturation slider tweaks keep the same
    // mode, so we skip the expensive remove+rebuild that was flashing the page on
    // every drag step. The remap is absolute by role, so re-running it is a no-op
    // for an unchanged mode anyway.
    if (mode !== lastAppliedMode || !themeEls.length) {
      restoreInline();
      removeThemeEls();
      activeRemap = mode;
      themedOnce = true;
      if (!isManagedThemeHost() || needsManagedObserverHost()) connectObserver(); // before applyTheme, so each shadow root gets observed as it's themed
      else disconnectObserver();
      const roots = themeRootsForCurrentHost();
      if (!isManagedThemeHost()) buildVarRoles(roots);
      applyTheme(mode, roots);
      if (isGoogleHost() && mode === 'light') applyGoogleLightInline();
      else if (!isManagedThemeHost()) { applyInline(mode); applyComputedBgFix(mode); }
      applyForeignCSS(mode, roots); // recolour cross-origin (CDN) sheets we can't read directly
      lastAppliedMode = mode;
    }
    removePreload(); // real theme is in place now
  }

  function setConfig(raw) {
    cfg = Object.assign({}, DEFAULTS, raw || {});
    if (document.readyState === 'loading') {
      apply();
      woOn(document, 'DOMContentLoaded', apply, { once: true });
    } else {
      apply();
    }
  }

  function loadConfig() {
    try {
      chrome.runtime.sendMessage({ kind: 'content-config-get' }, (res) => {
        void chrome.runtime.lastError;
        if (!chrome.runtime.lastError && res && res.ok) setConfig(res.overrides || {});
      });
    } catch (_) {}
  }

  window.__wardenOneEyeShieldApplyConfig = setConfig;
  window.__wardenOneEyeShieldRefresh = function () {
    loadConfig();
  };

  // late-loading stylesheets (web fonts, async CSS) — re-theme after full load
  woOn(window, 'load', () => {
    if (!activeRemap || isTwitchHost()) return;
    pendingSheet = true;
    scheduleRebuild();
  });

  loadConfig();

  try {
    woOnMessage((msg) => {
      if (!msg) return;
      if (msg.kind === 'config-update') setConfig(msg.overrides || {});
      if (msg.kind === 'content-config-refresh') loadConfig();
    });
  } catch (e) {}
}());
