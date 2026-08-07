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

  if (window.__wardenOneEyeShieldInstalled) {
    try {
      if (typeof window.__wardenOneEyeShieldRefresh === 'function') window.__wardenOneEyeShieldRefresh();
    } catch (e) {}
    return;
  }
  window.__wardenOneEyeShieldInstalled = true;
  window.__wardenOneEyeShieldVersion = 'chroma+bgtent+selection+clipguard+varrole-darksite+semantic-controls+managed-chatgpt+twitch-managed+google-autocomplete-light+google-frame-light-native-nav+google-native-search+yt-native-subscribe-join-notifications+twitch-native-player-range+comments+popup-eye+force-cleanup+twitch-player-surface-guard+reddit-managed+reddit-inbox-search-fix+amazon-managed+amazon-polish+amazon-specificity-is-wrapper+amazon-dcl-navassistant+skip-ext-twitch-overlay+github-cta-green+github-floatlabel-placeholder+suppress-nonfocus-outlines+no-invented-surface-box+flatten-shell-app+discord-native-theme-all-elements+spotify-encore-vars-theme+spotify-light-shell-repair+spotify-light-polish+spotify-player-gap-fade-fix+spotify-blank-revert+spotify-player-shadow-rightwash+spotify-right-art-shadow+spotify-right-text-bg+spotify-right-title-overlay+spotify-light-home-filters+spotify-light-root-shell-gaps+common-site-contrast-fixes+yt-consent-x-auth-fixes+spotify-sidebar-legal-light+site-profile-lazy-eyeshield+skip-wardenone-owned-ui+readability-guard-v2+twitch-video-scoped-adjust';

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

  // Anti-flash: chrome.storage is async, so at document_start the page would
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
    __ewContrastTimer = setTimeout(() => { __ewContrastTimer = null; try { contrastGuard(mode); } catch (_) {} }, 600);
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
    let budget = managed ? 450 : 900;
    walkElements(document.body, managed ? 8000 : 14000, (el) => {
      if (budget <= 0) return false;
      if (el === document.body) return;
      if (isWardenOneOwnedNode(el)) return;
      if (el.hasAttribute('data-wo-contrast')) ewClearContrastFixNode(el);
      if (!ewReadableTextCandidate(el)) return;
      budget--;
      let cs; try { cs = getComputedStyle(el); } catch (_) { return; }
      if (cs.visibility === 'hidden' || cs.display === 'none' || parseFloat(cs.opacity) === 0) return;
      const fg = ewTextPaint(cs);
      if (!fg || fg.a < 0.4) return;
      const bg = ewEffectiveBg(el) || fallbackBg;
      if (ewContrast(fg, bg) >= ewContrastThreshold(cs)) return;
      const safe = ewLum(bg) > 0.45 ? '#121318' : (mode === 'ultra' ? '#f5f6f8' : '#eef0f4');
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
    observer = new MutationObserver((muts) => {
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
    rebuildTimer = setTimeout(() => {
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

  function youtubePlayerCSS(text) {
    return '#player,#player-container,#movie_player,.html5-video-player{background-color:#000000 !important;}'
      + '#movie_player .html5-video-container,#movie_player .html5-video-container *,#movie_player .video-stream,#movie_player video,#movie_player .ytp-player-content,#movie_player .ytp-player-content *,#movie_player .ytp-cued-thumbnail-overlay,#movie_player .ytp-cued-thumbnail-overlay-image,#movie_player .ytp-iv-video-content,#movie_player .ytp-ad-player-overlay,#movie_player .ytp-ad-overlay-container{background-color:transparent !important;border-color:transparent !important;box-shadow:none !important;}'
      + '#movie_player .ytp-chrome-top,#movie_player .ytp-chrome-bottom,#movie_player .ytp-gradient-top,#movie_player .ytp-gradient-bottom,#movie_player .ytp-caption-window-container,#movie_player .ytp-subtitles-player-content,#movie_player .ytp-ce-element{background-color:transparent !important;}'
      + '#movie_player button,#movie_player [role="button"],#movie_player .ytp-button,#movie_player [class*="button" i]{background-color:transparent !important;color:' + text + ' !important;-webkit-text-fill-color:currentColor !important;border-color:transparent !important;box-shadow:none !important;}'
      + '#movie_player svg,#movie_player path,#movie_player yt-icon{background-color:transparent !important;}';
  }

  function managedShadowCSS(mode) {
    switch (managedThemeHostName()) {
      case 'youtube': return youtubeShadowCSS(mode);
      case 'reddit': return redditShadowCSS(mode);
      case 'chatgpt': return chatGPTCSS(mode, true);
      case 'google': return googleShadowCSS(mode);
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

  function youtubeVarsCSS(p) {
    const vars = [
      '--yt-spec-base-background:' + p.bg,
      '--yt-spec-raised-background:' + p.raised,
      '--yt-spec-menu-background:' + p.raised,
      '--yt-spec-general-background-a:' + p.bg,
      '--yt-spec-general-background-b:' + p.surface,
      '--yt-spec-general-background-c:' + p.raised,
      '--yt-spec-touch-response:' + (p.scheme === 'light' ? '#0000001a' : '#ffffff1a'),
      '--yt-spec-text-primary:' + p.text,
      '--yt-spec-text-secondary:' + p.muted,
      '--yt-spec-text-disabled:' + p.disabled,
      '--yt-spec-icon-active-other:' + p.text,
      '--yt-spec-icon-inactive:' + p.muted,
      '--yt-spec-call-to-action:' + p.link,
      '--yt-spec-themed-blue:' + p.link,
      '--yt-spec-outline:' + p.border,
      '--yt-spec-badge-chip-background:' + p.chip,
      '--yt-spec-button-chip-background-hover:' + (p.scheme === 'light' ? '#e5e5e5' : '#3f3f3f'),
      '--paper-dialog-background-color:' + p.raised,
      '--paper-listbox-background-color:' + p.raised,
      '--ytd-searchbox-background:' + p.input,
      '--ytd-searchbox-text-color:' + p.text,
      '--ytd-searchbox-placeholder-color:' + p.muted,
      '--ytd-searchbox-legacy-border-color:' + p.border,
      '--ytd-searchbox-legacy-button-color:' + p.button,
      '--ytd-searchbox-legacy-button-hover-color:' + p.raised,
      '--ytd-searchbox-legacy-button-border-color:' + p.border,
    ].join(' !important;') + ' !important;';
    return vars;
  }

  function youtubeShadowCSS(remap) {
    if (!isYouTubeHost()) return '';
    const p = youtubePalette(remap);
    return ':host{' + youtubeVarsCSS(p) + 'color-scheme:' + p.scheme + ' !important;background:' + p.surface + ' !important;color:' + p.text + ' !important;}'
      + '#chip-container,.ytChipShapeChip,yt-chip-cloud-chip-renderer,#button.yt-chip-cloud-chip-renderer{background:' + p.chip + ' !important;color:' + p.text + ' !important;-webkit-text-fill-color:currentColor !important;border-color:' + p.border + ' !important;}'
      + ':host([selected]) #chip-container,:host([iron-selected]) #chip-container,:host([aria-selected="true"]) #chip-container,#chip-container[selected],#chip-container[aria-selected="true"],.ytChipShapeChip[aria-selected="true"]{background:' + p.selected + ' !important;color:' + p.selectedText + ' !important;-webkit-text-fill-color:currentColor !important;}'
      + ':host([selected]) #chip-container *,:host([iron-selected]) #chip-container *,:host([aria-selected="true"]) #chip-container *,#chip-container[selected] *,#chip-container[aria-selected="true"] *,.ytChipShapeChip[aria-selected="true"] *{color:' + p.selectedText + ' !important;-webkit-text-fill-color:currentColor !important;}'
      + youtubeChipRailCSS(p)
      + '#text,#label,yt-formatted-string,paper-item,tp-yt-paper-item,a,#endpoint,#title,.title,.style-scope{color:' + p.text + ' !important;-webkit-text-fill-color:currentColor !important;text-shadow:none !important;}'
      + '.yt-core-attributed-string,.yt-core-attributed-string *,[class*="yt-lockup" i],[class*="yt-lockup" i] *{color:' + p.text + ' !important;-webkit-text-fill-color:currentColor !important;text-shadow:none !important;}'
      + ':host([selected]) #text,:host([selected]) #label,:host([selected]) yt-formatted-string,:host([selected]) #chip-container *,:host([iron-selected]) #text,:host([iron-selected]) #label,:host([iron-selected]) yt-formatted-string,:host([iron-selected]) #chip-container *,:host([aria-selected="true"]) #text,:host([aria-selected="true"]) #label,:host([aria-selected="true"]) yt-formatted-string,:host([aria-selected="true"]) #chip-container *,#chip-container[selected] *,#chip-container[aria-selected="true"] *,.ytChipShapeChip[aria-selected="true"],.ytChipShapeChip[aria-selected="true"] *{color:' + p.selectedText + ' !important;-webkit-text-fill-color:currentColor !important;text-shadow:none !important;}'
      + '#metadata-line,#metadata-line span,#byline-container,#channel-name,#subtitle,#description,.secondary,.metadata{color:' + p.muted + ' !important;-webkit-text-fill-color:currentColor !important;}'
      + youtubeSearchControlCSS(p)
      + ':host(:not(ytd-searchbox):not(yt-searchbox)) #button,:host(:not(ytd-searchbox):not(yt-searchbox)) button,:host(:not(ytd-searchbox):not(yt-searchbox)) yt-icon-button{background:transparent !important;color:' + p.text + ' !important;-webkit-text-fill-color:currentColor !important;border-color:transparent !important;box-shadow:none !important;}'
      + 'yt-icon,yt-icon-shape,.yt-icon-shape,svg,path{color:' + p.text + ' !important;fill:currentColor !important;}'
      + youtubeShadowChipCSS(p)
      + youtubeShadowSubscribeButtonCSS(p);
  }

  function youtubeSearchControlCSS(p) {
    const frame = 'ytd-searchbox #search-form,yt-searchbox #search-form,#search-form.ytd-searchbox,#search-form.yt-searchbox,.ytSearchboxComponentSearchForm,[class*="ytSearchboxComponentSearchForm" i]';
    const box = 'ytd-searchbox #container,yt-searchbox #container,#container.ytd-searchbox,#container.yt-searchbox,.ytSearchboxComponentInputBox,[class*="ytSearchboxComponentInputBox" i]';
    const input = '#search-input,#search-input input,ytd-searchbox input,yt-searchbox input,input#search,input.ytd-searchbox,input.yt-searchbox,#search.ytd-searchbox,#search.yt-searchbox,.ytSearchboxComponentInput,.ytSearchboxComponentInputBox input,[class*="ytSearchboxComponentInput" i]';
    const button = 'ytd-searchbox #search-icon-legacy,yt-searchbox #search-icon-legacy,#search-icon-legacy.ytd-searchbox,#search-icon-legacy.yt-searchbox,.ytSearchboxComponentSearchButton,.ytSearchboxComponentSearchButton button,[class*="ytSearchboxComponentSearchButton" i]';
    const icon = 'ytd-searchbox yt-icon,ytd-searchbox yt-icon-shape,ytd-searchbox svg,ytd-searchbox path,yt-searchbox yt-icon,yt-searchbox yt-icon-shape,yt-searchbox svg,yt-searchbox path,.ytSearchboxComponentSearchIcon,.ytSearchboxComponentSearchIcon svg,.ytSearchboxComponentSearchIcon path,.ytSearchboxComponentClearButton svg,.ytSearchboxComponentClearButton path,[class*="ytSearchboxComponentSearchIcon" i],[class*="ytSearchboxComponentSearchIcon" i] svg,[class*="ytSearchboxComponentSearchIcon" i] path';
    return frame + '{color:' + p.text + ' !important;}'
      + box + '{background:' + p.input + ' !important;background-color:' + p.input + ' !important;color:' + p.text + ' !important;border-color:' + p.border + ' !important;}'
      + input + '{background:transparent !important;background-color:transparent !important;color:' + p.text + ' !important;-webkit-text-fill-color:currentColor !important;caret-color:' + p.text + ' !important;}'
      + input + '::placeholder{color:' + p.muted + ' !important;-webkit-text-fill-color:' + p.muted + ' !important;opacity:1 !important;}'
      + button + '{background:' + p.button + ' !important;background-color:' + p.button + ' !important;color:' + p.text + ' !important;border-color:' + p.border + ' !important;}'
      + icon + '{color:' + p.text + ' !important;fill:currentColor !important;stroke:currentColor !important;}'
      + youtubeSearchSuggestionsCSS(p);
  }

  function youtubeShadowChipCSS(p) {
    const chip = '#chip-container,.ytChipShapeChip,[class*="ytChipShape" i],[class*="yt-chip-shape" i],:host([chip-style]) #button,:host([chip-style]) button,:host-context(yt-chip-cloud-chip-renderer) button';
    const selected = ':host([chip-style][selected]) #chip-container,:host([chip-style][selected]) #button,:host([chip-style][selected]) button,:host([chip-style][selected]) .ytChipShapeChip,:host([chip-style][selected]) [class*="ytChipShape" i],:host([chip-style][selected]) [class*="yt-chip-shape" i],:host([chip-style][iron-selected]) #chip-container,:host([chip-style][iron-selected]) #button,:host([chip-style][iron-selected]) button,:host([chip-style][iron-selected]) .ytChipShapeChip,:host([chip-style][iron-selected]) [class*="ytChipShape" i],:host([chip-style][iron-selected]) [class*="yt-chip-shape" i],:host([chip-style][aria-selected="true"]) #chip-container,:host([chip-style][aria-selected="true"]) #button,:host([chip-style][aria-selected="true"]) button,:host([chip-style][aria-selected="true"]) .ytChipShapeChip,:host([chip-style][aria-selected="true"]) [class*="ytChipShape" i],:host([chip-style][aria-selected="true"]) [class*="yt-chip-shape" i],:host-context(yt-chip-cloud-chip-renderer[selected]) button,:host-context(yt-chip-cloud-chip-renderer[iron-selected]) button,:host-context(yt-chip-cloud-chip-renderer[aria-selected="true"]) button,:host-context(yt-chip-cloud-chip-renderer[class*="selected" i]) button,#chip-container[selected],#chip-container[aria-selected="true"],.ytChipShapeChip[selected],.ytChipShapeChip[aria-selected="true"],.ytChipShapeChip[aria-pressed="true"],.ytChipShapeChip[class*="selected" i],[class*="ytChipShape" i][class*="selected" i],[class*="yt-chip-shape" i][class*="selected" i]';
    return chip + '{background:' + p.chip + ' !important;background-color:' + p.chip + ' !important;background-image:none !important;color:' + p.text + ' !important;-webkit-text-fill-color:currentColor !important;border-color:' + p.border + ' !important;box-shadow:none !important;}'
      + selected + '{background:' + p.selected + ' !important;background-color:' + p.selected + ' !important;background-image:none !important;color:' + p.selectedText + ' !important;-webkit-text-fill-color:currentColor !important;border-color:' + p.border + ' !important;box-shadow:none !important;}'
      + selected + ' *{color:' + p.selectedText + ' !important;-webkit-text-fill-color:currentColor !important;text-shadow:none !important;}';
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

  function youtubeShadowSubscribeButtonCSS(p) {
    const sub = youtubeSubscribePalette(p);
    const subBg = sub.bg;
    const subText = sub.text;
    const subBorder = sub.border;
    const subscribedBg = sub.bg;
    const subscribedText = sub.text;
    const subscribedBorder = sub.border;
    const subHost = [
      ':host-context(#subscribe-button)',
      ':host-context(ytd-subscribe-button-renderer)',
      ':host-context(yt-subscribe-button-view-model)'
    ];
    const joinHost = [
      ':host-context(#sponsor-button)',
      ':host-context(ytd-button-renderer#sponsor-button)',
      ':host-context(ytd-sponsor-button-renderer)',
      ':host-context(ytd-sponsorships-button-renderer)',
      ':host-context(yt-sponsorships-button-view-model)'
    ];
    const subscribedHost = [
      ':host-context(ytd-subscribe-button-renderer[subscribed])',
      ':host-context(yt-subscribe-button-view-model[subscribed])'
    ];
    const notifyHost = [
      ':host-context(#notification-preference-button)',
      ':host-context(ytd-subscription-notification-toggle-button-renderer)',
      ':host-context(notification-button-view-model)'
    ];
    const buttonParts = [' button', ' .yt-spec-button-shape-next'];
    const textParts = [' #text', ' #label', ' span', ' yt-formatted-string', ' .yt-core-attributed-string', ' .yt-spec-button-shape-next__button-text-content', ' [class*="button-text" i]', ' [class*="text-content" i]', ' slot', '::slotted(*)'];
    const subscribe = scopedSelectors(subHost, buttonParts) + ',button[aria-label*="Subscribe" i],.yt-spec-button-shape-next[aria-label*="Subscribe" i]';
    const subscribeText = scopedSelectors(subHost, textParts);
    const join = scopedSelectors(joinHost, buttonParts) + ',button[aria-label*="Join" i],.yt-spec-button-shape-next[aria-label*="Join" i]';
    const joinText = scopedSelectors(joinHost, textParts);
    const subscribed = scopedSelectors(subscribedHost, buttonParts) + ',button[aria-label*="Subscribed" i],button[aria-label*="Unsubscribe" i],.yt-spec-button-shape-next[aria-label*="Subscribed" i],.yt-spec-button-shape-next[aria-label*="Unsubscribe" i]';
    const subscribedTextSel = scopedSelectors(subscribedHost, textParts);
    const notify = scopedSelectors(notifyHost, buttonParts);
    const notifyText = scopedSelectors(notifyHost, textParts);
    const notifyIcon = scopedSelectors(notifyHost, [' yt-icon', ' yt-icon-shape', ' yt-animated-icon', ' .yt-icon-shape', ' svg', ' path', ' use', ' .yt-spec-icon-shape']);
    return scopedSelectors(subHost, ['']) + '{' + youtubeTextVars(subText) + 'color:' + subText + ' !important;-webkit-text-fill-color:' + subText + ' !important;}'
      + subscribe + '{background:' + subBg + ' !important;background-color:' + subBg + ' !important;background-image:none !important;color:' + subText + ' !important;-webkit-text-fill-color:' + subText + ' !important;border:1px solid ' + subBorder + ' !important;border-color:' + subBorder + ' !important;border-radius:9999px !important;box-shadow:none !important;overflow:hidden !important;}'
      + subscribe + ' *,' + subscribeText + ',' + subscribeText + ' *{color:' + subText + ' !important;-webkit-text-fill-color:' + subText + ' !important;fill:currentColor !important;stroke:currentColor !important;text-shadow:none !important;}'
      + scopedSelectors(joinHost, ['']) + '{' + youtubeTextVars(subText) + 'color:' + subText + ' !important;-webkit-text-fill-color:' + subText + ' !important;}'
      + join + '{background:' + subBg + ' !important;background-color:' + subBg + ' !important;background-image:none !important;color:' + subText + ' !important;-webkit-text-fill-color:' + subText + ' !important;border:1px solid ' + subBorder + ' !important;border-color:' + subBorder + ' !important;border-radius:9999px !important;box-shadow:none !important;overflow:hidden !important;}'
      + join + ' *,' + joinText + ',' + joinText + ' *{color:' + subText + ' !important;-webkit-text-fill-color:' + subText + ' !important;fill:currentColor !important;stroke:currentColor !important;text-shadow:none !important;}'
      + scopedSelectors(subscribedHost, ['']) + '{' + youtubeTextVars(subscribedText) + 'color:' + subscribedText + ' !important;-webkit-text-fill-color:' + subscribedText + ' !important;}'
      + subscribed + '{background:' + subscribedBg + ' !important;background-color:' + subscribedBg + ' !important;background-image:none !important;color:' + subscribedText + ' !important;-webkit-text-fill-color:' + subscribedText + ' !important;border:1px solid ' + subscribedBorder + ' !important;border-color:' + subscribedBorder + ' !important;border-radius:9999px !important;box-shadow:none !important;overflow:hidden !important;}'
      + subscribed + ' *,' + subscribedTextSel + ',' + subscribedTextSel + ' *{color:' + subscribedText + ' !important;-webkit-text-fill-color:' + subscribedText + ' !important;fill:currentColor !important;stroke:currentColor !important;text-shadow:none !important;}'
      + notify + '{background:' + subscribedBg + ' !important;background-color:' + subscribedBg + ' !important;background-image:none !important;color:' + subscribedText + ' !important;-webkit-text-fill-color:' + subscribedText + ' !important;border:1px solid ' + subscribedBorder + ' !important;border-color:' + subscribedBorder + ' !important;border-radius:9999px !important;box-shadow:none !important;overflow:hidden !important;}'
      + notify + ' *,' + notifyText + ',' + notifyText + ' *{color:' + subscribedText + ' !important;-webkit-text-fill-color:' + subscribedText + ' !important;fill:currentColor !important;stroke:currentColor !important;text-shadow:none !important;}'
      + notifyIcon + ',' + notifyIcon + ' *{color:' + subscribedText + ' !important;-webkit-text-fill-color:' + subscribedText + ' !important;fill:currentColor !important;stroke:currentColor !important;text-shadow:none !important;}';
  }

  function youtubeDocumentChipCSS(p) {
    const chip = 'yt-chip-cloud-chip-renderer,yt-chip-cloud-chip-renderer[chip-style="STYLE_DEFAULT"],yt-chip-cloud-chip-renderer #chip-container,yt-chip-cloud-chip-renderer #button,yt-chip-cloud-chip-renderer button,yt-chip-cloud-chip-renderer .ytChipShapeChip,yt-chip-cloud-chip-renderer [class*="ytChipShape" i],yt-chip-cloud-chip-renderer [class*="yt-chip-shape" i]';
    const selected = 'yt-chip-cloud-chip-renderer[selected],yt-chip-cloud-chip-renderer[iron-selected],yt-chip-cloud-chip-renderer[aria-selected="true"],yt-chip-cloud-chip-renderer[class*="selected" i],yt-chip-cloud-chip-renderer[selected] #chip-container,yt-chip-cloud-chip-renderer[iron-selected] #chip-container,yt-chip-cloud-chip-renderer[aria-selected="true"] #chip-container,yt-chip-cloud-chip-renderer[class*="selected" i] #chip-container,yt-chip-cloud-chip-renderer[selected] #button,yt-chip-cloud-chip-renderer[iron-selected] #button,yt-chip-cloud-chip-renderer[aria-selected="true"] #button,yt-chip-cloud-chip-renderer[class*="selected" i] #button,yt-chip-cloud-chip-renderer[selected] button,yt-chip-cloud-chip-renderer[iron-selected] button,yt-chip-cloud-chip-renderer[aria-selected="true"] button,yt-chip-cloud-chip-renderer[class*="selected" i] button,yt-chip-cloud-chip-renderer .ytChipShapeChip[selected],yt-chip-cloud-chip-renderer .ytChipShapeChip[aria-selected="true"],yt-chip-cloud-chip-renderer .ytChipShapeChip[aria-pressed="true"],yt-chip-cloud-chip-renderer .ytChipShapeChip[class*="selected" i],yt-chip-cloud-chip-renderer [class*="ytChipShape" i][class*="selected" i],yt-chip-cloud-chip-renderer [class*="yt-chip-shape" i][class*="selected" i]';
    return chip + '{background:' + p.chip + ' !important;background-color:' + p.chip + ' !important;background-image:none !important;color:' + p.text + ' !important;-webkit-text-fill-color:currentColor !important;border-color:' + p.border + ' !important;box-shadow:none !important;}'
      + chip + ' *{color:inherit !important;-webkit-text-fill-color:currentColor !important;}'
      + selected + '{background:' + p.selected + ' !important;background-color:' + p.selected + ' !important;background-image:none !important;color:' + p.selectedText + ' !important;-webkit-text-fill-color:currentColor !important;border-color:' + p.border + ' !important;box-shadow:none !important;}'
      + selected + ' *{color:' + p.selectedText + ' !important;-webkit-text-fill-color:currentColor !important;text-shadow:none !important;}';
  }

  function youtubeSearchSuggestionsCSS(p) {
    const panel = p.scheme === 'light' ? '#ffffff' : p.raised;
    const hover = p.scheme === 'light' ? '#f1f1f1' : p.chip;
    const shadow = p.scheme === 'light' ? '0 4px 16px #00000024' : '0 4px 18px #00000080';
    const popup = 'ytd-searchbox #suggestions,yt-searchbox #suggestions,ytd-searchbox tp-yt-paper-listbox,yt-searchbox tp-yt-paper-listbox,yt-searchbox-suggestions,yt-searchbox-suggestions #container,.ytSearchboxComponentSuggestionsContainer,.ytSearchboxComponentSuggestions,.ytSearchboxComponentSuggestionsList,[class*="ytSearchboxComponentSuggestions" i],.sbdd_b,.sbsb_a,.sbsb_b';
    const item = 'ytd-searchbox tp-yt-paper-item,yt-searchbox tp-yt-paper-item,yt-searchbox-suggestions [role="option"],yt-searchbox-suggestions li,yt-searchbox-suggestions yt-searchbox-suggestion,.ytSearchboxComponentSuggestion,.ytSuggestionComponent,[class*="ytSearchboxComponentSuggestion" i],[class*="ytSuggestionComponent" i],.sbsb_c,.sbqs_c,.sbpqs_a';
    const text = item + ',' + item + ' *,yt-searchbox-suggestions .yt-core-attributed-string,yt-searchbox-suggestions .yt-core-attributed-string *';
    const icon = 'yt-searchbox-suggestions yt-icon,yt-searchbox-suggestions yt-icon-shape,yt-searchbox-suggestions svg,yt-searchbox-suggestions path,ytd-searchbox #suggestions yt-icon,ytd-searchbox #suggestions svg,ytd-searchbox #suggestions path,.ytSearchboxComponentSuggestionsContainer yt-icon,.ytSearchboxComponentSuggestionsContainer svg,.ytSearchboxComponentSuggestionsContainer path,[class*="ytSearchboxComponentSuggestions" i] yt-icon,[class*="ytSearchboxComponentSuggestions" i] svg,[class*="ytSearchboxComponentSuggestions" i] path';
    const hoverItem = item.split(',').map((sel) => sel + ':hover,' + sel + '[selected],' + sel + '[aria-selected="true"]').join(',');
    return popup + '{background:' + panel + ' !important;background-color:' + panel + ' !important;color:' + p.text + ' !important;border-color:' + p.border + ' !important;box-shadow:' + shadow + ' !important;}'
      + item + '{background:' + panel + ' !important;background-color:' + panel + ' !important;color:' + p.text + ' !important;-webkit-text-fill-color:currentColor !important;}'
      + hoverItem + '{background:' + hover + ' !important;background-color:' + hover + ' !important;color:' + p.text + ' !important;-webkit-text-fill-color:currentColor !important;}'
      + text + '{color:' + p.text + ' !important;-webkit-text-fill-color:currentColor !important;text-shadow:none !important;}'
      + icon + '{color:' + p.muted + ' !important;fill:currentColor !important;stroke:currentColor !important;}';
  }

  function youtubeNotificationsPanelCSS(p) {
    const panel = p.scheme === 'light' ? '#ffffff' : p.raised;
    const item = p.scheme === 'light' ? '#ffffff' : p.raised;
    const hover = p.scheme === 'light' ? '#f1f1f1' : p.chip;
    const unread = p.scheme === 'light' ? '#f8fafd' : p.chip;
    const shadow = p.scheme === 'light' ? '0 4px 18px #00000024' : '0 4px 18px #00000080';
    const shell = 'ytd-popup-container,ytd-popup-container tp-yt-iron-dropdown,ytd-popup-container tp-yt-paper-dialog,ytd-popup-container ytd-multi-page-menu-renderer,ytd-popup-container ytd-menu-popup-renderer,ytd-popup-container tp-yt-paper-listbox,ytd-multi-page-menu-renderer,ytd-menu-popup-renderer,tp-yt-paper-dialog,tp-yt-paper-listbox';
    const header = 'ytd-popup-container ytd-multi-page-menu-renderer #header,ytd-popup-container ytd-multi-page-menu-renderer #header *,ytd-popup-container ytd-multi-page-menu-renderer ytd-simple-menu-header-renderer,ytd-popup-container ytd-multi-page-menu-renderer ytd-simple-menu-header-renderer *';
    const notification = 'ytd-popup-container ytd-notification-renderer,ytd-popup-container ytd-notification-renderer #content,ytd-popup-container ytd-notification-renderer #body,ytd-popup-container ytd-notification-renderer #metadata,ytd-popup-container ytd-notification-renderer #details,ytd-popup-container ytd-notification-renderer #text,ytd-popup-container ytd-notification-renderer #message';
    const notificationText = 'ytd-popup-container ytd-notification-renderer yt-formatted-string,ytd-popup-container ytd-notification-renderer .yt-core-attributed-string,ytd-popup-container ytd-notification-renderer .yt-core-attributed-string *,ytd-popup-container ytd-notification-renderer #message,ytd-popup-container ytd-notification-renderer #title,ytd-popup-container ytd-multi-page-menu-renderer #title,ytd-popup-container ytd-multi-page-menu-renderer #label';
    const notificationMuted = 'ytd-popup-container ytd-notification-renderer #metadata,ytd-popup-container ytd-notification-renderer #metadata *,ytd-popup-container ytd-notification-renderer #time,ytd-popup-container ytd-notification-renderer #time *,ytd-popup-container ytd-multi-page-menu-renderer #subtitle,ytd-popup-container ytd-multi-page-menu-renderer #subtitle *';
    const icons = 'ytd-popup-container ytd-multi-page-menu-renderer yt-icon,ytd-popup-container ytd-multi-page-menu-renderer yt-icon-shape,ytd-popup-container ytd-multi-page-menu-renderer svg,ytd-popup-container ytd-multi-page-menu-renderer path,ytd-popup-container ytd-notification-renderer yt-icon,ytd-popup-container ytd-notification-renderer yt-icon-shape,ytd-popup-container ytd-notification-renderer svg,ytd-popup-container ytd-notification-renderer path';
    return shell + '{background:' + panel + ' !important;background-color:' + panel + ' !important;color:' + p.text + ' !important;border-color:' + p.border + ' !important;box-shadow:' + shadow + ' !important;}'
      + header + '{background:' + panel + ' !important;background-color:' + panel + ' !important;color:' + p.text + ' !important;-webkit-text-fill-color:currentColor !important;border-color:' + p.border + ' !important;text-shadow:none !important;}'
      + notification + '{background:' + item + ' !important;background-color:' + item + ' !important;color:' + p.text + ' !important;-webkit-text-fill-color:currentColor !important;border-color:' + p.border + ' !important;box-shadow:none !important;text-shadow:none !important;}'
      + 'ytd-popup-container ytd-notification-renderer:hover,ytd-popup-container ytd-notification-renderer:focus-within,ytd-popup-container ytd-notification-renderer[selected]{background:' + hover + ' !important;background-color:' + hover + ' !important;color:' + p.text + ' !important;}'
      + 'ytd-popup-container ytd-notification-renderer[unread],ytd-popup-container ytd-notification-renderer[is-unread],ytd-popup-container ytd-notification-renderer[aria-label*="unread" i]{background:' + unread + ' !important;background-color:' + unread + ' !important;color:' + p.text + ' !important;}'
      + notificationText + '{color:' + p.text + ' !important;-webkit-text-fill-color:currentColor !important;text-shadow:none !important;}'
      + notificationMuted + '{color:' + p.muted + ' !important;-webkit-text-fill-color:currentColor !important;text-shadow:none !important;}'
      + icons + '{color:' + p.text + ' !important;fill:currentColor !important;stroke:currentColor !important;}'
      + 'ytd-popup-container ytd-notification-renderer img,ytd-popup-container ytd-notification-renderer yt-img-shadow,ytd-popup-container ytd-notification-renderer ytd-thumbnail,ytd-popup-container ytd-notification-renderer video{filter:none !important;background:transparent !important;}';
  }

  function youtubeChipRailCSS(p) {
    const rail = 'ytd-feed-filter-chip-bar-renderer,ytd-feed-filter-chip-bar-renderer #chips-wrapper,ytd-feed-filter-chip-bar-renderer #chips-content,ytd-feed-filter-chip-bar-renderer #chips,yt-chip-cloud-renderer,yt-chip-cloud-renderer #chips,yt-chip-cloud-renderer #chips-wrapper,yt-chip-cloud-renderer #scroll-container,[class*="ytChipCloudRenderer" i],[class*="ytHorizontalListRenderer" i]';
    const arrows = 'ytd-feed-filter-chip-bar-renderer #left-arrow,ytd-feed-filter-chip-bar-renderer #right-arrow,ytd-feed-filter-chip-bar-renderer #left-arrow-button,ytd-feed-filter-chip-bar-renderer #right-arrow-button,yt-chip-cloud-renderer #left-arrow,yt-chip-cloud-renderer #right-arrow,yt-chip-cloud-renderer #left-arrow-button,yt-chip-cloud-renderer #right-arrow-button,yt-chip-cloud-renderer yt-icon-button,ytd-feed-filter-chip-bar-renderer yt-icon-button,[class*="leftArrow" i],[class*="rightArrow" i],[class*="chipCloudArrow" i]';
    const beforeAfter = 'ytd-feed-filter-chip-bar-renderer #left-arrow::before,ytd-feed-filter-chip-bar-renderer #left-arrow:before,ytd-feed-filter-chip-bar-renderer #right-arrow::before,ytd-feed-filter-chip-bar-renderer #right-arrow:before,yt-chip-cloud-renderer #left-arrow::before,yt-chip-cloud-renderer #left-arrow:before,yt-chip-cloud-renderer #right-arrow::before,yt-chip-cloud-renderer #right-arrow:before';
    return rail + '{background:' + p.bg + ' !important;background-color:' + p.bg + ' !important;color:' + p.text + ' !important;border-color:' + p.border + ' !important;}'
      + arrows + '{background:' + p.bg + ' !important;background-color:' + p.bg + ' !important;color:' + p.text + ' !important;-webkit-text-fill-color:currentColor !important;border-color:transparent !important;box-shadow:none !important;}'
      + arrows + ' *,ytd-feed-filter-chip-bar-renderer #left-arrow svg,ytd-feed-filter-chip-bar-renderer #right-arrow svg,yt-chip-cloud-renderer #left-arrow svg,yt-chip-cloud-renderer #right-arrow svg{background:transparent !important;color:' + p.text + ' !important;fill:currentColor !important;stroke:currentColor !important;}'
      + beforeAfter + '{background:' + p.bg + ' !important;background-color:' + p.bg + ' !important;box-shadow:none !important;}';
  }

  function youtubeWatchPageCSS(p) {
    const surface = p.scheme === 'light' ? '#ffffff' : p.surface;
    const panel = p.scheme === 'light' ? '#ffffff' : p.raised;
    const soft = p.scheme === 'light' ? '#f1f1f1' : p.chip;
    const card = p.scheme === 'light' ? '#f8f8f8' : p.raised;
    const link = p.link;
    return 'ytd-watch-flexy:not([fullscreen]) #columns,ytd-watch-flexy:not([fullscreen]) #primary,ytd-watch-flexy:not([fullscreen]) #secondary,ytd-watch-flexy:not([fullscreen]) #below,ytd-watch-flexy:not([fullscreen]) #below #comments{background:' + surface + ' !important;color:' + p.text + ' !important;}'
      + 'ytd-watch-metadata,ytd-watch-metadata #above-the-fold,ytd-watch-metadata #title,ytd-watch-metadata #bottom-row,ytd-video-primary-info-renderer,ytd-video-secondary-info-renderer,ytd-structured-description-content-renderer,ytd-text-inline-expander,ytd-expander{background:transparent !important;color:' + p.text + ' !important;border-color:' + p.border + ' !important;}'
      + 'ytd-watch-metadata h1,ytd-watch-metadata h1 *,ytd-watch-metadata #title,ytd-watch-metadata #title *,ytd-watch-metadata yt-formatted-string,ytd-watch-metadata yt-attributed-string,ytd-watch-metadata .yt-core-attributed-string,ytd-watch-metadata .yt-core-attributed-string *{color:' + p.text + ' !important;-webkit-text-fill-color:currentColor !important;text-shadow:none !important;}'
      + 'ytd-watch-metadata #owner,ytd-watch-metadata #owner *,ytd-watch-metadata #channel-name,ytd-watch-metadata #channel-name *,ytd-watch-metadata #upload-info,ytd-watch-metadata #upload-info *{color:' + p.text + ' !important;-webkit-text-fill-color:currentColor !important;}'
      + 'ytd-watch-metadata #info,ytd-watch-metadata #info *,ytd-watch-metadata #metadata,ytd-watch-metadata #metadata *,ytd-watch-metadata #description,ytd-watch-metadata #description *,ytd-text-inline-expander #content,ytd-text-inline-expander #content *{color:' + p.muted + ' !important;-webkit-text-fill-color:currentColor !important;text-shadow:none !important;}'
      + 'ytd-watch-metadata #description,ytd-watch-metadata #description-inner,ytd-watch-metadata #description-container,ytd-watch-metadata #description.ytd-watch-metadata,ytd-text-inline-expander,ytd-text-inline-expander[expanded],ytd-text-inline-expander #content,ytd-structured-description-content-renderer,ytd-structured-description-content-renderer #items,ytd-video-description-infocards-section-renderer,ytd-compact-infocard-renderer,ytd-info-panel-container-renderer,ytd-metadata-row-container-renderer,ytd-metadata-row-renderer,ytd-horizontal-card-list-renderer,ytd-compact-link-renderer,ytd-universal-watch-card-renderer,ytd-event-ticket-button-renderer{background:' + card + ' !important;background-color:' + card + ' !important;color:' + p.text + ' !important;-webkit-text-fill-color:currentColor !important;border-color:' + p.border + ' !important;box-shadow:none !important;}'
      + 'ytd-watch-metadata #description:hover,ytd-watch-metadata #description:active,ytd-watch-metadata #description:focus-within,ytd-text-inline-expander:hover,ytd-text-inline-expander:active,ytd-text-inline-expander:focus-within,ytd-structured-description-content-renderer:hover,ytd-compact-link-renderer:hover,ytd-compact-link-renderer:active,ytd-metadata-row-renderer:hover,ytd-metadata-row-renderer:active,ytd-horizontal-card-list-renderer:hover,ytd-horizontal-card-list-renderer:active{background:' + card + ' !important;background-color:' + card + ' !important;color:' + p.text + ' !important;-webkit-text-fill-color:currentColor !important;}'
      + 'ytd-structured-description-content-renderer *,ytd-video-description-infocards-section-renderer *,ytd-compact-infocard-renderer *,ytd-info-panel-container-renderer *,ytd-metadata-row-container-renderer *,ytd-metadata-row-renderer *,ytd-horizontal-card-list-renderer *,ytd-compact-link-renderer *,ytd-universal-watch-card-renderer *,ytd-event-ticket-button-renderer *{color:inherit !important;-webkit-text-fill-color:currentColor !important;text-shadow:none !important;}'
      + 'ytd-watch-metadata a,ytd-watch-metadata a *,ytd-text-inline-expander a,ytd-text-inline-expander a *,ytd-comments a,ytd-comments a *{color:' + link + ' !important;-webkit-text-fill-color:currentColor !important;}'
      + 'ytd-playlist-panel-renderer,ytd-playlist-panel-renderer #container,ytd-playlist-panel-renderer #header-container,ytd-playlist-panel-renderer #header-contents,ytd-playlist-panel-renderer #items,ytd-playlist-panel-renderer #contents,ytd-playlist-panel-renderer ytd-playlist-panel-video-renderer{background:' + panel + ' !important;color:' + p.text + ' !important;border-color:' + p.border + ' !important;}'
      + 'ytd-playlist-panel-renderer ytd-playlist-panel-video-renderer[selected],ytd-playlist-panel-renderer ytd-playlist-panel-video-renderer[active],ytd-playlist-panel-renderer ytd-playlist-panel-video-renderer:hover{background:' + soft + ' !important;color:' + p.text + ' !important;}'
      + 'ytd-playlist-panel-renderer #video-title,ytd-playlist-panel-renderer #video-title *,ytd-playlist-panel-renderer #playlist-title,ytd-playlist-panel-renderer #playlist-title *,ytd-playlist-panel-renderer #title,ytd-playlist-panel-renderer #title *,ytd-playlist-panel-renderer yt-formatted-string,ytd-playlist-panel-renderer .yt-core-attributed-string,ytd-playlist-panel-renderer .yt-core-attributed-string *{color:' + p.text + ' !important;-webkit-text-fill-color:currentColor !important;text-shadow:none !important;}'
      + 'ytd-playlist-panel-renderer #byline,ytd-playlist-panel-renderer #byline *,ytd-playlist-panel-renderer #video-info,ytd-playlist-panel-renderer #video-info *,ytd-playlist-panel-renderer #publisher-container,ytd-playlist-panel-renderer #publisher-container *{color:' + p.muted + ' !important;-webkit-text-fill-color:currentColor !important;}'
      + 'ytd-playlist-panel-renderer yt-icon,ytd-playlist-panel-renderer yt-icon-shape,ytd-playlist-panel-renderer svg,ytd-playlist-panel-renderer path{color:' + p.text + ' !important;fill:currentColor !important;stroke:currentColor !important;}'
      + 'ytd-comments,ytd-comments #sections,ytd-comments #contents,ytd-comments-header-renderer,ytd-comment-thread-renderer,ytd-comment-view-model,ytd-comment-renderer,ytd-comment-replies-renderer,ytd-comment-reply-dialog-renderer{background:' + surface + ' !important;color:' + p.text + ' !important;border-color:' + p.border + ' !important;}'
      + 'ytd-comments ytd-comment-thread-renderer,ytd-comments ytd-comment-view-model,ytd-comments ytd-comment-renderer,ytd-comments ytd-comment-replies-renderer,ytd-comments #comment,ytd-comments #main,ytd-comments #main *,ytd-comments #body,ytd-comments #body *,ytd-comments #content,ytd-comments #content-text,ytd-comments #content-text *,ytd-comments #comment-content,ytd-comments #comment-content *,ytd-comments yt-formatted-string,ytd-comments yt-attributed-string,ytd-comments .yt-core-attributed-string,ytd-comments .yt-core-attributed-string *{background:transparent !important;background-color:transparent !important;box-shadow:none !important;}'
      + 'ytd-comments h2,ytd-comments h2 *,ytd-comments #title,ytd-comments #title *,ytd-comments #content-text,ytd-comments #content-text *,ytd-comments #comment-content,ytd-comments #comment-content *,ytd-comments #main,ytd-comments #main *,ytd-comments yt-formatted-string,ytd-comments yt-attributed-string,ytd-comments .yt-core-attributed-string,ytd-comments .yt-core-attributed-string *{color:' + p.text + ' !important;-webkit-text-fill-color:currentColor !important;text-shadow:none !important;}'
      + 'ytd-comments #author-text,ytd-comments #author-text *,ytd-comments #header-author,ytd-comments #header-author *,ytd-comments #published-time-text,ytd-comments #published-time-text *,ytd-comments #vote-count-middle,ytd-comments #vote-count-middle *,ytd-comments #simplebox-placeholder,ytd-comments #placeholder-area,ytd-comments #placeholder-area *{color:' + p.muted + ' !important;-webkit-text-fill-color:currentColor !important;text-shadow:none !important;}'
      + 'ytd-comments yt-icon,ytd-comments yt-icon-shape,ytd-comments svg,ytd-comments path,ytd-comments button,ytd-comments yt-icon-button{background:transparent !important;color:' + p.text + ' !important;fill:currentColor !important;stroke:currentColor !important;border-color:transparent !important;box-shadow:none !important;}'
      + 'ytd-watch-metadata #top-level-buttons-computed,ytd-watch-metadata ytd-menu-renderer,ytd-watch-metadata segmented-like-dislike-button-view-model,ytd-watch-metadata like-button-view-model,ytd-watch-metadata dislike-button-view-model,ytd-watch-metadata ytd-segmented-like-dislike-button-renderer{background:transparent !important;color:' + p.text + ' !important;border-color:transparent !important;}'
      + 'ytd-watch-metadata #top-level-buttons-computed button,ytd-watch-metadata #top-level-buttons-computed yt-button-shape,ytd-watch-metadata #top-level-buttons-computed button-view-model,ytd-watch-metadata #top-level-buttons-computed .yt-spec-button-shape-next,ytd-watch-metadata #top-level-buttons-computed .yt-spec-button-shape-next__button-text-content,ytd-watch-metadata segmented-like-dislike-button-view-model button,ytd-watch-metadata like-button-view-model button,ytd-watch-metadata dislike-button-view-model button{background:transparent !important;color:' + p.text + ' !important;-webkit-text-fill-color:currentColor !important;border-color:transparent !important;box-shadow:none !important;}'
      + 'ytd-watch-metadata #top-level-buttons-computed yt-icon,ytd-watch-metadata #top-level-buttons-computed yt-icon-shape,ytd-watch-metadata #top-level-buttons-computed .yt-icon-shape,ytd-watch-metadata #top-level-buttons-computed yt-animated-icon,ytd-watch-metadata #top-level-buttons-computed svg,ytd-watch-metadata #top-level-buttons-computed path,ytd-watch-metadata segmented-like-dislike-button-view-model yt-icon,ytd-watch-metadata segmented-like-dislike-button-view-model yt-icon-shape,ytd-watch-metadata segmented-like-dislike-button-view-model svg,ytd-watch-metadata segmented-like-dislike-button-view-model path,ytd-watch-metadata like-button-view-model yt-icon,ytd-watch-metadata like-button-view-model yt-icon-shape,ytd-watch-metadata like-button-view-model svg,ytd-watch-metadata like-button-view-model path,ytd-watch-metadata dislike-button-view-model yt-icon,ytd-watch-metadata dislike-button-view-model yt-icon-shape,ytd-watch-metadata dislike-button-view-model svg,ytd-watch-metadata dislike-button-view-model path{background:transparent !important;color:' + p.text + ' !important;fill:currentColor !important;stroke:currentColor !important;}'
      + youtubeSubscribeButtonCSS(p)
      + 'ytd-logo,#logo,ytd-topbar-logo-renderer,#country-code{color:' + p.text + ' !important;-webkit-text-fill-color:currentColor !important;}'
      + 'ytd-logo #country-code,#country-code.ytd-topbar-logo-renderer{color:' + p.muted + ' !important;-webkit-text-fill-color:currentColor !important;}'
      + 'ytd-logo svg,ytd-logo yt-icon,ytd-topbar-logo-renderer svg,ytd-topbar-logo-renderer yt-icon{color:' + p.text + ' !important;}'
      + 'ytd-logo #youtube-paths path:not(:first-child),ytd-logo #youtube-paths_yt1 path:not(:first-child),ytd-topbar-logo-renderer #youtube-paths path:not(:first-child),ytd-topbar-logo-renderer #youtube-paths_yt1 path:not(:first-child){fill:' + p.text + ' !important;}';
  }

  function youtubeSubscribeButtonCSS(p) {
    const sub = youtubeSubscribePalette(p);
    const subBg = sub.bg;
    const subText = sub.text;
    const subBorder = sub.border;
    const subscribedBg = sub.bg;
    const subscribedText = sub.text;
    const subscribedBorder = sub.border;
    const subHost = 'ytd-subscribe-button-renderer,yt-subscribe-button-view-model,#subscribe-button,#owner ytd-subscribe-button-renderer,#owner yt-subscribe-button-view-model,#owner #subscribe-button';
    const joinHost = 'ytd-button-renderer#sponsor-button,#sponsor-button,ytd-sponsor-button-renderer,ytd-sponsorships-button-renderer,yt-sponsorships-button-view-model,#owner ytd-button-renderer#sponsor-button,#owner #sponsor-button,#owner ytd-sponsor-button-renderer,#owner ytd-sponsorships-button-renderer,#owner yt-sponsorships-button-view-model';
    const subscribedHost = 'ytd-subscribe-button-renderer[subscribed],yt-subscribe-button-view-model[subscribed],#subscribe-button[subscribed]';
    const subscribe = 'ytd-subscribe-button-renderer button,ytd-subscribe-button-renderer .yt-spec-button-shape-next,yt-subscribe-button-view-model button,yt-subscribe-button-view-model .yt-spec-button-shape-next,#subscribe-button button,#subscribe-button .yt-spec-button-shape-next,button[aria-label*="Subscribe" i],.yt-spec-button-shape-next[aria-label*="Subscribe" i]';
    const subscribeText = 'ytd-subscribe-button-renderer #text,ytd-subscribe-button-renderer #label,ytd-subscribe-button-renderer span,ytd-subscribe-button-renderer yt-formatted-string,ytd-subscribe-button-renderer .yt-core-attributed-string,ytd-subscribe-button-renderer .yt-spec-button-shape-next__button-text-content,ytd-subscribe-button-renderer [class*="button-text" i],ytd-subscribe-button-renderer [class*="text-content" i],yt-subscribe-button-view-model #text,yt-subscribe-button-view-model #label,yt-subscribe-button-view-model span,yt-subscribe-button-view-model yt-formatted-string,yt-subscribe-button-view-model .yt-core-attributed-string,yt-subscribe-button-view-model .yt-spec-button-shape-next__button-text-content,yt-subscribe-button-view-model [class*="button-text" i],yt-subscribe-button-view-model [class*="text-content" i],#subscribe-button #text,#subscribe-button #label,#subscribe-button span,#subscribe-button yt-formatted-string,#subscribe-button .yt-core-attributed-string,#subscribe-button .yt-spec-button-shape-next__button-text-content,#subscribe-button [class*="button-text" i],#subscribe-button [class*="text-content" i]';
    const join = 'ytd-button-renderer#sponsor-button button,ytd-button-renderer#sponsor-button .yt-spec-button-shape-next,#sponsor-button button,#sponsor-button .yt-spec-button-shape-next,ytd-sponsor-button-renderer button,ytd-sponsor-button-renderer .yt-spec-button-shape-next,ytd-sponsorships-button-renderer button,ytd-sponsorships-button-renderer .yt-spec-button-shape-next,yt-sponsorships-button-view-model button,yt-sponsorships-button-view-model .yt-spec-button-shape-next,#owner #sponsor-button button,#owner #sponsor-button .yt-spec-button-shape-next,button[aria-label*="Join" i],.yt-spec-button-shape-next[aria-label*="Join" i]';
    const joinText = 'ytd-button-renderer#sponsor-button #text,ytd-button-renderer#sponsor-button #label,ytd-button-renderer#sponsor-button span,ytd-button-renderer#sponsor-button yt-formatted-string,ytd-button-renderer#sponsor-button .yt-core-attributed-string,ytd-button-renderer#sponsor-button .yt-spec-button-shape-next__button-text-content,ytd-button-renderer#sponsor-button [class*="button-text" i],ytd-button-renderer#sponsor-button [class*="text-content" i],#sponsor-button #text,#sponsor-button #label,#sponsor-button span,#sponsor-button yt-formatted-string,#sponsor-button .yt-core-attributed-string,#sponsor-button .yt-spec-button-shape-next__button-text-content,#sponsor-button [class*="button-text" i],#sponsor-button [class*="text-content" i],ytd-sponsor-button-renderer #text,ytd-sponsor-button-renderer #label,ytd-sponsor-button-renderer span,ytd-sponsor-button-renderer yt-formatted-string,ytd-sponsor-button-renderer .yt-core-attributed-string,ytd-sponsor-button-renderer .yt-spec-button-shape-next__button-text-content,ytd-sponsorships-button-renderer #text,ytd-sponsorships-button-renderer #label,ytd-sponsorships-button-renderer span,ytd-sponsorships-button-renderer yt-formatted-string,ytd-sponsorships-button-renderer .yt-core-attributed-string,ytd-sponsorships-button-renderer .yt-spec-button-shape-next__button-text-content,yt-sponsorships-button-view-model #text,yt-sponsorships-button-view-model #label,yt-sponsorships-button-view-model span,yt-sponsorships-button-view-model yt-formatted-string,yt-sponsorships-button-view-model .yt-core-attributed-string,yt-sponsorships-button-view-model .yt-spec-button-shape-next__button-text-content';
    const subscribed = 'button[aria-label*="Subscribed" i],button[aria-label*="Unsubscribe" i],.yt-spec-button-shape-next[aria-label*="Subscribed" i],.yt-spec-button-shape-next[aria-label*="Unsubscribe" i],ytd-subscribe-button-renderer[subscribed] button,ytd-subscribe-button-renderer[subscribed] .yt-spec-button-shape-next,yt-subscribe-button-view-model[subscribed] button,yt-subscribe-button-view-model[subscribed] .yt-spec-button-shape-next';
    const subscribedTextSel = 'ytd-subscribe-button-renderer[subscribed] #text,ytd-subscribe-button-renderer[subscribed] #label,ytd-subscribe-button-renderer[subscribed] span,ytd-subscribe-button-renderer[subscribed] yt-formatted-string,ytd-subscribe-button-renderer[subscribed] .yt-core-attributed-string,ytd-subscribe-button-renderer[subscribed] .yt-spec-button-shape-next__button-text-content,ytd-subscribe-button-renderer[subscribed] [class*="button-text" i],ytd-subscribe-button-renderer[subscribed] [class*="text-content" i],yt-subscribe-button-view-model[subscribed] #text,yt-subscribe-button-view-model[subscribed] #label,yt-subscribe-button-view-model[subscribed] span,yt-subscribe-button-view-model[subscribed] yt-formatted-string,yt-subscribe-button-view-model[subscribed] .yt-core-attributed-string,yt-subscribe-button-view-model[subscribed] .yt-spec-button-shape-next__button-text-content,yt-subscribe-button-view-model[subscribed] [class*="button-text" i],yt-subscribe-button-view-model[subscribed] [class*="text-content" i]';
    const notify = '#notification-preference-button button,#notification-preference-button .yt-spec-button-shape-next,ytd-subscription-notification-toggle-button-renderer button,ytd-subscription-notification-toggle-button-renderer .yt-spec-button-shape-next,notification-button-view-model button,notification-button-view-model .yt-spec-button-shape-next,#owner #notification-preference-button button,#owner ytd-subscription-notification-toggle-button-renderer button,#owner notification-button-view-model button';
    const notifyText = '#notification-preference-button #text,#notification-preference-button #label,#notification-preference-button span,#notification-preference-button yt-formatted-string,ytd-subscription-notification-toggle-button-renderer #text,ytd-subscription-notification-toggle-button-renderer #label,ytd-subscription-notification-toggle-button-renderer span,ytd-subscription-notification-toggle-button-renderer yt-formatted-string,notification-button-view-model #text,notification-button-view-model #label,notification-button-view-model span,notification-button-view-model yt-formatted-string';
    const notifyIcon = '#notification-preference-button yt-icon,#notification-preference-button yt-icon-shape,#notification-preference-button yt-animated-icon,#notification-preference-button .yt-icon-shape,#notification-preference-button svg,#notification-preference-button path,#notification-preference-button use,ytd-subscription-notification-toggle-button-renderer yt-icon,ytd-subscription-notification-toggle-button-renderer yt-icon-shape,ytd-subscription-notification-toggle-button-renderer yt-animated-icon,ytd-subscription-notification-toggle-button-renderer .yt-icon-shape,ytd-subscription-notification-toggle-button-renderer svg,ytd-subscription-notification-toggle-button-renderer path,ytd-subscription-notification-toggle-button-renderer use,notification-button-view-model yt-icon,notification-button-view-model yt-icon-shape,notification-button-view-model yt-animated-icon,notification-button-view-model .yt-icon-shape,notification-button-view-model svg,notification-button-view-model path,notification-button-view-model use,#owner #notification-preference-button yt-icon,#owner #notification-preference-button yt-icon-shape,#owner #notification-preference-button svg,#owner #notification-preference-button path';
    return subHost + '{' + youtubeTextVars(subText) + 'color:' + subText + ' !important;-webkit-text-fill-color:' + subText + ' !important;}'
      + subscribe + '{background:' + subBg + ' !important;background-color:' + subBg + ' !important;background-image:none !important;color:' + subText + ' !important;-webkit-text-fill-color:' + subText + ' !important;border:1px solid ' + subBorder + ' !important;border-color:' + subBorder + ' !important;border-radius:9999px !important;box-shadow:none !important;overflow:hidden !important;}'
      + subscribe + ' *,' + subscribeText + ',' + subscribeText + ' *{color:' + subText + ' !important;-webkit-text-fill-color:' + subText + ' !important;fill:currentColor !important;stroke:currentColor !important;text-shadow:none !important;}'
      + joinHost + '{' + youtubeTextVars(subText) + 'color:' + subText + ' !important;-webkit-text-fill-color:' + subText + ' !important;}'
      + join + '{background:' + subBg + ' !important;background-color:' + subBg + ' !important;background-image:none !important;color:' + subText + ' !important;-webkit-text-fill-color:' + subText + ' !important;border:1px solid ' + subBorder + ' !important;border-color:' + subBorder + ' !important;border-radius:9999px !important;box-shadow:none !important;overflow:hidden !important;}'
      + join + ' *,' + joinText + ',' + joinText + ' *{color:' + subText + ' !important;-webkit-text-fill-color:' + subText + ' !important;fill:currentColor !important;stroke:currentColor !important;text-shadow:none !important;}'
      + subscribedHost + '{' + youtubeTextVars(subscribedText) + 'color:' + subscribedText + ' !important;-webkit-text-fill-color:' + subscribedText + ' !important;}'
      + subscribed + '{background:' + subscribedBg + ' !important;background-color:' + subscribedBg + ' !important;background-image:none !important;color:' + subscribedText + ' !important;-webkit-text-fill-color:' + subscribedText + ' !important;border:1px solid ' + subscribedBorder + ' !important;border-color:' + subscribedBorder + ' !important;border-radius:9999px !important;box-shadow:none !important;overflow:hidden !important;}'
      + subscribed + ' *,' + subscribedTextSel + ',' + subscribedTextSel + ' *{color:' + subscribedText + ' !important;-webkit-text-fill-color:' + subscribedText + ' !important;fill:currentColor !important;stroke:currentColor !important;text-shadow:none !important;}'
      + notify + '{background:' + subscribedBg + ' !important;background-color:' + subscribedBg + ' !important;background-image:none !important;color:' + subscribedText + ' !important;-webkit-text-fill-color:' + subscribedText + ' !important;border:1px solid ' + subscribedBorder + ' !important;border-color:' + subscribedBorder + ' !important;border-radius:9999px !important;box-shadow:none !important;overflow:hidden !important;}'
      + notify + ' *,' + notifyText + ',' + notifyText + ' *{color:' + subscribedText + ' !important;-webkit-text-fill-color:' + subscribedText + ' !important;fill:currentColor !important;stroke:currentColor !important;text-shadow:none !important;}'
      + notifyIcon + ',' + notifyIcon + ' *{color:' + subscribedText + ' !important;-webkit-text-fill-color:' + subscribedText + ' !important;fill:currentColor !important;stroke:currentColor !important;text-shadow:none !important;}';
  }

  function youtubeLightCSS() {
    if (!isYouTubeHost()) return '';
    const p = youtubePalette('light');
    const vars = youtubeVarsCSS(p);
    return ':root,html,html[dark],body,ytd-app{' + vars + 'color-scheme:light !important;background:#ffffff !important;color:#0f0f0f !important;}'
      + 'html,body,ytd-app,ytd-page-manager,#content,#page-manager,ytd-watch-flexy,#columns,#primary,#secondary,ytd-browse,ytd-two-column-browse-results-renderer{background:#ffffff !important;color:#0f0f0f !important;}'
      + 'ytd-masthead,#masthead-container,#container.ytd-masthead,#background.ytd-masthead,#guide-content.ytd-app,ytd-mini-guide-renderer,tp-yt-app-drawer,ytd-guide-renderer,ytd-mini-guide-entry-renderer,ytd-guide-entry-renderer{background:#ffffff !important;color:#0f0f0f !important;border-color:#d3d3d3 !important;}'
      + youtubeChipRailCSS(p)
      + 'yt-chip-cloud-chip-renderer,yt-chip-cloud-chip-renderer[chip-style="STYLE_DEFAULT"],yt-chip-cloud-chip-renderer #chip-container{background:#f1f1f1 !important;color:#0f0f0f !important;-webkit-text-fill-color:currentColor !important;border-color:#d3d3d3 !important;}'
      + 'yt-chip-cloud-chip-renderer *,yt-chip-cloud-chip-renderer yt-formatted-string{color:inherit !important;-webkit-text-fill-color:currentColor !important;}'
      + 'yt-chip-cloud-chip-renderer[selected],yt-chip-cloud-chip-renderer[iron-selected],yt-chip-cloud-chip-renderer[aria-selected="true"],yt-chip-cloud-chip-renderer[selected] #chip-container,yt-chip-cloud-chip-renderer[iron-selected] #chip-container,yt-chip-cloud-chip-renderer[aria-selected="true"] #chip-container{background:' + p.selected + ' !important;color:' + p.selectedText + ' !important;-webkit-text-fill-color:currentColor !important;border-color:#d3d3d3 !important;}'
      + 'yt-chip-cloud-chip-renderer[selected] *,yt-chip-cloud-chip-renderer[iron-selected] *,yt-chip-cloud-chip-renderer[aria-selected="true"] *{color:' + p.selectedText + ' !important;-webkit-text-fill-color:currentColor !important;}'
      + youtubeDocumentChipCSS(p)
      + 'ytd-masthead #center,ytd-masthead #end,#buttons.ytd-masthead{background:#ffffff !important;color:#0f0f0f !important;}'
      + youtubeSearchControlCSS(p)
      + youtubeNotificationsPanelCSS(p)
      + '#buttons.ytd-masthead yt-icon,#buttons.ytd-masthead yt-icon-shape,#buttons.ytd-masthead .yt-icon-shape,#buttons.ytd-masthead svg,#buttons.ytd-masthead path,#end.ytd-masthead yt-icon,#end.ytd-masthead yt-icon-shape,#end.ytd-masthead .yt-icon-shape,#end.ytd-masthead svg,#end.ytd-masthead path,ytd-topbar-menu-button-renderer yt-icon,ytd-notification-topbar-button-renderer yt-icon,#buttons.ytd-masthead ytd-button-renderer yt-icon,#end.ytd-masthead ytd-button-renderer yt-icon,#buttons.ytd-masthead button-view-model yt-icon,#end.ytd-masthead button-view-model yt-icon,#buttons.ytd-masthead yt-button-shape yt-icon,#end.ytd-masthead yt-button-shape yt-icon{color:#0f0f0f !important;fill:currentColor !important;}'
      + '#buttons.ytd-masthead button,#end.ytd-masthead button,ytd-topbar-menu-button-renderer,ytd-notification-topbar-button-renderer,#buttons.ytd-masthead ytd-button-renderer,#end.ytd-masthead ytd-button-renderer,#buttons.ytd-masthead yt-button-shape,#end.ytd-masthead yt-button-shape,#buttons.ytd-masthead button-view-model,#end.ytd-masthead button-view-model,#buttons.ytd-masthead .yt-spec-button-shape-next,#end.ytd-masthead .yt-spec-button-shape-next,#buttons.ytd-masthead .yt-spec-button-shape-next__button-text-content,#end.ytd-masthead .yt-spec-button-shape-next__button-text-content{background:transparent !important;color:#0f0f0f !important;-webkit-text-fill-color:currentColor !important;border-color:transparent !important;box-shadow:none !important;}'
      + 'ytd-masthead #voice-search-button,ytd-masthead #voice-search-button button,ytd-masthead #voice-search-button yt-icon,ytd-masthead button yt-icon,ytd-masthead button yt-icon-shape,ytd-masthead button svg,ytd-masthead button path,ytd-masthead yt-icon-button yt-icon,ytd-masthead yt-icon-button svg,ytd-masthead yt-icon-button path{background:transparent !important;color:#0f0f0f !important;-webkit-text-fill-color:currentColor !important;fill:currentColor !important;stroke:currentColor !important;border-color:transparent !important;box-shadow:none !important;}'
      + youtubeWatchPageCSS(p)
      + 'ytd-guide-entry-renderer yt-formatted-string,ytd-mini-guide-entry-renderer yt-formatted-string,ytd-guide-section-renderer yt-formatted-string,ytd-guide-collapsible-section-entry-renderer yt-formatted-string,ytd-guide-entry-renderer a,ytd-mini-guide-entry-renderer a,ytd-guide-renderer yt-icon,ytd-mini-guide-renderer yt-icon{color:#0f0f0f !important;-webkit-text-fill-color:currentColor !important;}'
      + 'ytd-rich-grid-media,ytd-rich-grid-media #dismissible,ytd-rich-grid-media #details,ytd-rich-grid-media #meta,ytd-rich-grid-media h3,ytd-rich-item-renderer,ytd-video-renderer,ytd-video-renderer #dismissible,ytd-video-renderer #details,ytd-video-renderer #meta,ytd-video-renderer h3,ytd-compact-video-renderer,ytd-grid-video-renderer,ytd-playlist-renderer,ytd-reel-item-renderer,#contents.ytd-rich-grid-row{background:transparent !important;color:#0f0f0f !important;border-color:transparent !important;}'
      + 'a#video-title,#video-title,yt-formatted-string#video-title,#video-title-link,#video-title-link yt-formatted-string,ytd-rich-grid-media #video-title,ytd-rich-grid-media #video-title-link,ytd-rich-grid-media #video-title-link *,ytd-video-renderer #video-title,ytd-video-renderer #video-title-link,ytd-video-renderer #video-title-link *,ytd-compact-video-renderer #video-title,ytd-compact-video-renderer #video-title-link,ytd-grid-video-renderer #video-title,ytd-grid-video-renderer #video-title-link{background:transparent !important;color:#0f0f0f !important;-webkit-text-fill-color:currentColor !important;text-shadow:none !important;}'
      + '.yt-core-attributed-string,.yt-core-attributed-string *,yt-lockup-view-model,yt-lockup-view-model *,yt-lockup-metadata-view-model,yt-lockup-metadata-view-model *,.yt-lockup-metadata-view-model__title,.yt-lockup-metadata-view-model__title *,.yt-lockup-metadata-view-model__heading-reset,.yt-lockup-metadata-view-model__heading-reset *{background:transparent !important;color:#0f0f0f !important;-webkit-text-fill-color:currentColor !important;text-shadow:none !important;}'
      + '#metadata-line,#metadata-line span,ytd-video-meta-block,ytd-video-meta-block *,#byline-container,#channel-name,#channel-name a,ytd-channel-name a,ytd-channel-name yt-formatted-string,ytd-video-owner-renderer,ytd-video-owner-renderer a{background:transparent !important;color:#606060 !important;-webkit-text-fill-color:currentColor !important;text-shadow:none !important;}'
      + 'yt-icon-button,ytd-menu-renderer yt-icon-button,ytd-menu-renderer button,#button.yt-icon-button,#button.ytd-menu-renderer,ytd-rich-grid-media ytd-menu-renderer,ytd-video-renderer ytd-menu-renderer{background:transparent !important;color:#0f0f0f !important;border-color:transparent !important;box-shadow:none !important;}'
      + 'ytd-rich-grid-media #details *,ytd-video-renderer #details *,ytd-video-meta-block *{background:transparent !important;}'
      + youtubePlayerCSS('#ffffff')
      + '#cinematics-container,#cinematics-container *{display:none !important;opacity:0 !important;background:transparent !important;}'
      + 'video,.html5-video-player,.ytp-player-content,.ytp-chrome-bottom,.ytp-gradient-top,.ytp-gradient-bottom{filter:none !important;}';
  }
  function youtubeDarkCSS(remap) {
    if (!isYouTubeHost() || (remap !== 'dark' && remap !== 'ultra')) return '';
    const p = youtubePalette(remap);
    const vars = youtubeVarsCSS(p);
    return ':root,html,html[dark],body,ytd-app{' + vars + 'color-scheme:dark !important;background:' + p.bg + ' !important;color:' + p.text + ' !important;}'
      + 'html,body,ytd-app,ytd-page-manager,#content,#page-manager,ytd-watch-flexy,#columns,#primary,#secondary,ytd-browse,ytd-two-column-browse-results-renderer{background:' + p.bg + ' !important;color:' + p.text + ' !important;}'
      + 'ytd-masthead,#masthead-container,#container.ytd-masthead,#background.ytd-masthead,#guide-content.ytd-app,ytd-mini-guide-renderer,tp-yt-app-drawer,ytd-guide-renderer,ytd-mini-guide-entry-renderer,ytd-guide-entry-renderer{background:' + p.surface + ' !important;color:' + p.text + ' !important;border-color:' + p.border + ' !important;}'
      + 'ytd-popup-container,tp-yt-paper-dialog,ytd-menu-popup-renderer,ytd-multi-page-menu-renderer,tp-yt-paper-listbox,ytd-engagement-panel-section-list-renderer{background:' + p.raised + ' !important;color:' + p.text + ' !important;border-color:' + p.border + ' !important;}'
      + 'ytd-consent-bump-v2-lightbox,tp-yt-paper-dialog#dialog,tp-yt-paper-dialog.eom-v1-dialog,.eom-v1-dialog,ytd-consent-bump-v2-lightbox #dialog{background:' + p.raised + ' !important;background-color:' + p.raised + ' !important;color:' + p.text + ' !important;border-color:' + p.border + ' !important;box-shadow:none !important;}'
      + 'ytd-consent-bump-v2-lightbox :where(h1,h2,h3,h4,p,span,div,yt-formatted-string,.legal-text,a),tp-yt-paper-dialog#dialog :where(h1,h2,h3,h4,p,span,div,yt-formatted-string,.legal-text,a),tp-yt-paper-dialog.eom-v1-dialog :where(h1,h2,h3,h4,p,span,div,yt-formatted-string,.legal-text,a),.eom-v1-dialog :where(h1,h2,h3,h4,p,span,div,yt-formatted-string,.legal-text,a){color:' + p.text + ' !important;-webkit-text-fill-color:currentColor !important;text-shadow:none !important;}'
      + 'ytd-consent-bump-v2-lightbox a,tp-yt-paper-dialog#dialog a,tp-yt-paper-dialog.eom-v1-dialog a,.eom-v1-dialog a{color:' + p.link + ' !important;-webkit-text-fill-color:currentColor !important;}'
      + 'ytd-consent-bump-v2-lightbox :where(button,tp-yt-paper-button,[role="button"]),tp-yt-paper-dialog#dialog :where(button,tp-yt-paper-button,[role="button"]),tp-yt-paper-dialog.eom-v1-dialog :where(button,tp-yt-paper-button,[role="button"]),.eom-v1-dialog :where(button,tp-yt-paper-button,[role="button"]){background:' + p.button + ' !important;color:' + p.text + ' !important;-webkit-text-fill-color:currentColor !important;border-color:' + p.border + ' !important;box-shadow:none !important;}'
      + youtubeChipRailCSS(p)
      + 'yt-chip-cloud-chip-renderer,yt-chip-cloud-chip-renderer[chip-style="STYLE_DEFAULT"],yt-chip-cloud-chip-renderer #chip-container,ytd-thumbnail-overlay-time-status-renderer{background:' + p.chip + ' !important;color:' + p.text + ' !important;border-color:' + p.border + ' !important;-webkit-text-fill-color:currentColor !important;}'
      + 'yt-chip-cloud-chip-renderer *,yt-chip-cloud-chip-renderer yt-formatted-string{color:inherit !important;-webkit-text-fill-color:currentColor !important;}'
      + 'yt-chip-cloud-chip-renderer[selected],yt-chip-cloud-chip-renderer[iron-selected],yt-chip-cloud-chip-renderer[aria-selected="true"],yt-chip-cloud-chip-renderer[selected] #chip-container,yt-chip-cloud-chip-renderer[iron-selected] #chip-container,yt-chip-cloud-chip-renderer[aria-selected="true"] #chip-container{background:' + p.selected + ' !important;color:' + p.selectedText + ' !important;-webkit-text-fill-color:currentColor !important;}'
      + 'yt-chip-cloud-chip-renderer[selected] *,yt-chip-cloud-chip-renderer[iron-selected] *,yt-chip-cloud-chip-renderer[aria-selected="true"] *{color:' + p.selectedText + ' !important;-webkit-text-fill-color:currentColor !important;}'
      + youtubeDocumentChipCSS(p)
      + 'ytd-masthead #center,ytd-masthead #end,#buttons.ytd-masthead{background:' + p.surface + ' !important;color:' + p.text + ' !important;}'
      + youtubeSearchControlCSS(p)
      + youtubeNotificationsPanelCSS(p)
      + '#buttons.ytd-masthead yt-icon,#buttons.ytd-masthead yt-icon-shape,#buttons.ytd-masthead .yt-icon-shape,#buttons.ytd-masthead svg,#buttons.ytd-masthead path,#end.ytd-masthead yt-icon,#end.ytd-masthead yt-icon-shape,#end.ytd-masthead .yt-icon-shape,#end.ytd-masthead svg,#end.ytd-masthead path,ytd-topbar-menu-button-renderer yt-icon,ytd-notification-topbar-button-renderer yt-icon,#buttons.ytd-masthead ytd-button-renderer yt-icon,#end.ytd-masthead ytd-button-renderer yt-icon,#buttons.ytd-masthead button-view-model yt-icon,#end.ytd-masthead button-view-model yt-icon,#buttons.ytd-masthead yt-button-shape yt-icon,#end.ytd-masthead yt-button-shape yt-icon{color:' + p.text + ' !important;fill:currentColor !important;}'
      + '#buttons.ytd-masthead button,#end.ytd-masthead button,ytd-topbar-menu-button-renderer,ytd-notification-topbar-button-renderer,#buttons.ytd-masthead ytd-button-renderer,#end.ytd-masthead ytd-button-renderer,#buttons.ytd-masthead yt-button-shape,#end.ytd-masthead yt-button-shape,#buttons.ytd-masthead button-view-model,#end.ytd-masthead button-view-model,#buttons.ytd-masthead .yt-spec-button-shape-next,#end.ytd-masthead .yt-spec-button-shape-next,#buttons.ytd-masthead .yt-spec-button-shape-next__button-text-content,#end.ytd-masthead .yt-spec-button-shape-next__button-text-content{background:transparent !important;color:' + p.text + ' !important;-webkit-text-fill-color:currentColor !important;border-color:transparent !important;box-shadow:none !important;}'
      + youtubeWatchPageCSS(p)
      + 'ytd-guide-entry-renderer yt-formatted-string,ytd-mini-guide-entry-renderer yt-formatted-string,ytd-guide-section-renderer yt-formatted-string,ytd-guide-collapsible-section-entry-renderer yt-formatted-string,ytd-guide-entry-renderer a,ytd-mini-guide-entry-renderer a,ytd-guide-renderer yt-icon,ytd-mini-guide-renderer yt-icon{color:' + p.text + ' !important;-webkit-text-fill-color:currentColor !important;}'
      + 'ytd-rich-grid-media,ytd-rich-grid-media #dismissible,ytd-rich-grid-media #details,ytd-rich-grid-media #meta,ytd-rich-grid-media h3,ytd-rich-item-renderer,ytd-video-renderer,ytd-video-renderer #dismissible,ytd-video-renderer #details,ytd-video-renderer #meta,ytd-video-renderer h3,ytd-compact-video-renderer,ytd-grid-video-renderer,ytd-playlist-renderer,ytd-reel-item-renderer,#contents.ytd-rich-grid-row{background:transparent !important;color:' + p.text + ' !important;border-color:transparent !important;}'
      + 'ytd-background-promo-renderer,ytd-feed-nudge-renderer,ytd-rich-section-renderer,ytd-rich-section-renderer #content,ytd-rich-section-renderer #dismissible,ytd-browse ytd-rich-section-renderer :where(div,section,article){background:' + p.raised + ' !important;background-color:' + p.raised + ' !important;background-image:none !important;color:' + p.text + ' !important;border-color:' + p.border + ' !important;box-shadow:none !important;}'
      + 'ytd-background-promo-renderer *,ytd-feed-nudge-renderer *,ytd-rich-section-renderer #content *,ytd-rich-section-renderer #dismissible *{color:' + p.text + ' !important;-webkit-text-fill-color:currentColor !important;fill:currentColor !important;stroke:currentColor !important;text-shadow:none !important;}'
      + 'a#video-title,#video-title,yt-formatted-string#video-title,#video-title-link,#video-title-link yt-formatted-string,ytd-rich-grid-media #video-title,ytd-rich-grid-media #video-title-link,ytd-rich-grid-media #video-title-link *,ytd-video-renderer #video-title,ytd-video-renderer #video-title-link,ytd-video-renderer #video-title-link *,ytd-compact-video-renderer #video-title,ytd-compact-video-renderer #video-title-link,ytd-grid-video-renderer #video-title,ytd-grid-video-renderer #video-title-link{background:transparent !important;color:' + p.text + ' !important;-webkit-text-fill-color:currentColor !important;text-shadow:none !important;}'
      + '#metadata-line,#metadata-line span,ytd-video-meta-block,ytd-video-meta-block *,#byline-container,#channel-name,#channel-name a,ytd-channel-name a,ytd-channel-name yt-formatted-string,ytd-video-owner-renderer,ytd-video-owner-renderer a{background:transparent !important;color:' + p.muted + ' !important;-webkit-text-fill-color:currentColor !important;text-shadow:none !important;}'
      + 'yt-icon-button,ytd-menu-renderer yt-icon-button,ytd-menu-renderer button,#button.yt-icon-button,#button.ytd-menu-renderer,ytd-rich-grid-media ytd-menu-renderer,ytd-video-renderer ytd-menu-renderer{background:transparent !important;color:' + p.text + ' !important;border-color:transparent !important;box-shadow:none !important;}'
      + 'ytd-rich-grid-media #details *,ytd-video-renderer #details *,ytd-video-meta-block *{background:transparent !important;}'
      + youtubePlayerCSS(p.text)
      + '#cinematics-container,#cinematics-container *{display:none !important;opacity:0 !important;background:transparent !important;}'
      + 'video,.html5-video-player,.ytp-player-content,.ytp-chrome-bottom,.ytp-gradient-top,.ytp-gradient-bottom{filter:none !important;}';
  }

  function twitchChatAndPlayerCSS(bg, surface, raised, border, text, muted, accent) {
    const chatShell = '[data-a-target="stream-chat"],[data-a-target="stream-chat-header"],[data-test-selector="chat-room-component-layout"],.stream-chat,.chat-room,.chat-shell,.chat-list,.chat-list--default';
    const chatList = '[data-a-target="chat-scroller"],[data-test-selector="chat-scrollable-area__message-container"],.chat-scrollable-area__message-container,.chat-list__lines,[role="log"]';
    const chatMessage = '[data-a-target="chat-line-message"],[data-test-selector="chat-line-message"],.chat-line__message,.chat-line__message-container,.chat-line__message-body,.chat-line__message--emote-button';
    const chatText = chatMessage + ',' + chatMessage + ' span,' + chatMessage + ' a,' + chatMessage + ' button,[data-a-target="chat-message-text"],[data-a-target="chat-message-text"] *,.text-fragment,.chat-line__username,.chat-author__display-name';
    const chatMeta = '[data-a-target="chat-line-timestamp"],.chat-line__timestamp,.chat-author__intl-login,.chat-line__message .tw-c-text-alt,.chat-line__message .tw-c-text-alt-2';
    const chatInput = '[data-a-target="chat-input"] textarea,[data-a-target="chat-input"] [contenteditable="true"],textarea[data-a-target="chat-input"],.chat-wysiwyg-input__editor';
    const media = '.persistent-player,.persistent-player video,.persistent-player canvas,.video-player,.video-player__container,.video-player video,.video-player canvas,[data-a-target="video-player"],[data-a-target="video-player"] video,[data-a-target="video-player"] canvas,[data-a-target="video-ref"],[data-a-target="video-ref"] video,[data-a-target="video-ref"] canvas';
    // Twitch reuses generated layout wrappers inside the player; keep those transparent so page theming cannot cover the stream.
    const playerShell = ':is(.persistent-player,.video-player,.video-player__container,[data-a-target="video-player"],.channel-root__player,.channel-root__player-container,.live-video-player,.twilight-player-root)';
    const playerScope = ':is(.persistent-player,.video-player,.video-player__container,[data-a-target="video-player"],[data-a-target="video-ref"],.channel-root__player,.channel-root__player-container,.live-video-player,.twilight-player-root,[data-a-target="player-overlay-click-handler"],[data-a-target="player-overlay-mouseover-area"],[data-a-target="player-controls"],[data-a-player-state])';
    const playerSurface = playerScope + ':where(.tw-box,.tw-c-background-base,.tw-c-background-alt,.tw-c-background-alt-2),'
      + playerScope + ' :where(.tw-box,.tw-c-background-base,.tw-c-background-alt,.tw-c-background-alt-2),'
      + playerScope + ' :where([class*="Layout-sc" i],[class*="InjectLayout-sc" i],[class*="ScAspectRatio" i],[class*="overlay" i]):not(:where(.video-player,.video-player__container,.player-controls,.player-controls *,.top-bar,.top-bar *,[data-a-target="player-controls"],[data-a-target="player-controls"] *,[role="menu"],[role="menu"] *,[role="dialog"],[role="dialog"] *))';
    const playerMedia = playerScope + ' :where(video,canvas,picture,img),'
      + playerScope + ':where(video,canvas,picture,img)';
    const playerControls = playerScope + ' :where(button,[role="button"],svg,path,[data-a-target*="player" i],[data-a-target*="volume" i])';
    return chatShell + '{background:' + surface + ' !important;background-color:' + surface + ' !important;color:' + text + ' !important;border-color:' + border + ' !important;}'
      + chatList + '{background:' + bg + ' !important;background-color:' + bg + ' !important;color:' + text + ' !important;border-color:' + border + ' !important;}'
      + chatMessage + '{background:transparent !important;background-color:transparent !important;color:' + text + ' !important;-webkit-text-fill-color:currentColor !important;text-shadow:none !important;box-shadow:none !important;}'
      + chatText + '{color:' + text + ' !important;-webkit-text-fill-color:currentColor !important;text-shadow:none !important;}'
      + chatMeta + '{color:' + muted + ' !important;-webkit-text-fill-color:currentColor !important;text-shadow:none !important;}'
      + '[data-a-target="chat-badge"],[data-a-target="chat-badge"] img,.chat-badge,.chat-badge img,.chat-line__message img,.chat-line__message svg{background:transparent !important;filter:none !important;}'
      + chatInput + '{color:' + text + ' !important;-webkit-text-fill-color:currentColor !important;caret-color:' + text + ' !important;}'
      + chatInput + '::placeholder{color:' + muted + ' !important;-webkit-text-fill-color:' + muted + ' !important;opacity:1 !important;}'
      + '[data-a-target="chat-line-message"] a,.chat-line__message a{color:' + accent + ' !important;-webkit-text-fill-color:currentColor !important;}'
      + playerShell + '{background:#000000 !important;background-color:#000000 !important;color:#ffffff !important;}'
      + playerSurface + '{background:transparent !important;background-color:transparent !important;background-image:none !important;box-shadow:none !important;text-shadow:none !important;}'
      + playerMedia + '{background:#000000 !important;background-color:#000000 !important;filter:none !important;backdrop-filter:none !important;opacity:1 !important;visibility:visible !important;}'
      + playerControls + '{filter:none !important;backdrop-filter:none !important;}'
      + media + '{filter:none !important;backdrop-filter:none !important;}';
  }

  function twitchLightCSS() {
    if (!isTwitchHost()) return '';
    const bg = '#ffffff';
    const surface = '#f7f7f8';
    const raised = '#efeff1';
    const soft = '#e3e3e8';
    const border = '#d4d4dd';
    const text = '#0e0e10';
    const muted = '#53535f';
    const accent = '#5c16c5';
    const vars = [
      '--color-background-body:' + bg,
      '--color-background-base:' + bg,
      '--color-background-alt:' + surface,
      '--color-background-alt-2:' + raised,
      '--color-background-float:' + bg,
      '--color-background-input:' + bg,
      '--color-background-button-secondary-default:' + raised,
      '--color-background-button-secondary-hover:' + soft,
      '--color-background-button-text-default:' + surface,
      '--color-background-button-text-hover:' + raised,
      '--color-fill-base:' + bg,
      '--color-fill-current:' + text,
      '--color-text-base:' + text,
      '--color-text-alt:' + muted,
      '--color-text-input:' + text,
      '--color-text-button:' + text,
      '--color-text-overlay:#ffffff',
      '--color-text-link:' + accent,
      '--color-border-base:' + border,
      '--color-border-region:' + border,
      '--color-accent:' + accent,
      '--color-accent-label:#ffffff',
    ].join(' !important;') + ' !important;';
    return ':root,html,body,#root,.tw-root--theme-dark,.tw-root--theme-light{' + vars + 'color-scheme:light !important;background:' + bg + ' !important;color:' + text + ' !important;}'
      + 'body,#root,main,.twilight-main,.twilight-minimal-root,.channel-root,.channel-page,.channel-root__main,.channel-root__info,.channel-info-content,.channel-info-section,.about-section,.side-nav,.side-nav__overlay-wrapper,.stream-chat,.chat-room,.chat-list,.chat-list--default,.chat-shell{background:' + bg + ' !important;color:' + text + ' !important;}'
      + '#root header,#root nav,.top-nav,[data-a-target="top-nav-container"],[data-a-target="side-nav-card"],[data-a-target="stream-chat"],[data-a-target="stream-chat-header"],[data-a-target="chat-input-container"],[data-test-selector="chat-input-buttons-container"],[data-test-selector="chat-room-component-layout"]{background:' + surface + ' !important;color:' + text + ' !important;border-color:' + border + ' !important;}'
      + '[data-a-target="stream-info-card-component"],[data-a-target="channel-info-content"],[data-a-target="channel-info-header"],[data-test-selector="channel-panels-container"],[data-test-selector="chat-scrollable-area__message-container"],.metadata-layout__support,.channel-info-content,.channel-root__info,.tw-card,.tw-c-background-base,.tw-c-background-alt,.tw-c-background-alt-2{background:' + bg + ' !important;color:' + text + ' !important;border-color:' + border + ' !important;}'
      + '#root input:not([type="range"]):not([data-a-target="chat-input"]),#root textarea:not([data-a-target="chat-input"]):not(.chat-input__textarea),#root [contenteditable="true"]:not(.chat-wysiwyg-input__editor),#root [role="textbox"]:not([data-a-target="chat-input"]):not(.chat-wysiwyg-input__editor),#root [data-a-target="tw-input"],#root [data-a-target="search-input"]{background:' + bg + ' !important;color:' + text + ' !important;-webkit-text-fill-color:currentColor !important;caret-color:' + text + ' !important;border-color:' + border + ' !important;}'
      + '#root input::placeholder,#root textarea::placeholder{color:' + muted + ' !important;-webkit-text-fill-color:' + muted + ' !important;}'
      + '#root :where(h1,h2,h3,h4,p,label,small,strong),#root .tw-c-text-base,#root .tw-c-text-alt,#root [class*="CoreText"],#root [class*="Text"],#root [data-a-target="stream-title"],#root [data-a-target="channel-info-title"]{color:' + text + ' !important;-webkit-text-fill-color:currentColor !important;text-shadow:none !important;}'
      + '#root .tw-c-text-alt-2,#root [data-a-target="stream-game-link"],#root [data-a-target="preview-card-channel-link"]{color:' + muted + ' !important;-webkit-text-fill-color:currentColor !important;}'
      + '#root .tw-link,#root a[href^="/directory"],#root a[href^="/downloads"],#root a[href^="/legal"],#root a[href^="/p/"]{color:' + accent + ' !important;-webkit-text-fill-color:currentColor !important;}'
      + '#root button:not([data-a-target*="player" i]):not([data-a-target*="volume" i]),#root [role="button"]:not([data-a-target*="player" i]):not([data-a-target*="volume" i]),#root [data-a-target="chat-settings"],#root [data-a-target="emote-picker-button"]{border-color:' + border + ' !important;color:' + text + ' !important;-webkit-text-fill-color:currentColor !important;}'
      + '#root [data-a-target="tw-pill"],#root .tw-tag{background:' + raised + ' !important;color:' + text + ' !important;border-color:' + border + ' !important;}'
      + 'video,.video-player,.persistent-player,.persistent-player video,.tw-image,.tw-avatar,.tw-avatar img{filter:none !important;}'
      + twitchChatAndPlayerCSS(bg, surface, raised, border, text, muted, accent);
  }
  function twitchDarkCSS(remap) {
    if (!isTwitchHost() || (remap !== 'dark' && remap !== 'ultra')) return '';
    const ultra = remap === 'ultra';
    const bg = ultra ? '#000000' : '#0e0e10';
    const surface = ultra ? '#08080b' : '#18181b';
    const raised = ultra ? '#121217' : '#1f1f23';
    const soft = ultra ? '#19191f' : '#26262c';
    const border = ultra ? '#30303a' : '#3a3a44';
    const text = '#f4f4f5';
    const muted = '#adadb8';
    const accent = '#bf94ff';
    const vars = [
      '--color-background-body:' + bg,
      '--color-background-base:' + bg,
      '--color-background-alt:' + surface,
      '--color-background-alt-2:' + raised,
      '--color-background-float:' + raised,
      '--color-background-input:' + raised,
      '--color-background-button-secondary-default:' + soft,
      '--color-background-button-text-default:' + surface,
      '--color-background-button-text-hover:' + raised,
      '--color-fill-base:' + surface,
      '--color-fill-current:' + text,
      '--color-text-base:' + text,
      '--color-text-alt:' + muted,
      '--color-text-link:' + accent,
      '--color-border-base:' + border,
      '--color-border-region:' + border,
      '--color-accent:' + accent,
      '--color-accent-label:' + text,
    ].join(' !important;') + ' !important;';
    return ':root,html,body,#root,.tw-root--theme-dark,.tw-root--theme-light{' + vars + 'color-scheme:dark !important;background:' + bg + ' !important;color:' + text + ' !important;}'
      + 'body,#root,main,.twilight-main,.twilight-minimal-root,.channel-root,.channel-page,.channel-root__main,.channel-root__info,.channel-info-content,.channel-info-section,.about-section,.side-nav,.side-nav__overlay-wrapper,.stream-chat,.chat-room,.chat-list,.chat-list--default,.chat-shell{background:' + bg + ' !important;color:' + text + ' !important;}'
      + '#root header,#root nav,.top-nav,[data-a-target="top-nav-container"],[data-a-target="side-nav-card"],[data-a-target="stream-chat"],[data-a-target="stream-chat-header"],[data-a-target="chat-input-container"],[data-test-selector="chat-input-buttons-container"],[data-test-selector="chat-room-component-layout"]{background:' + surface + ' !important;color:' + text + ' !important;border-color:' + border + ' !important;}'
      + '[data-a-target="stream-info-card-component"],[data-a-target="channel-info-content"],[data-a-target="channel-info-header"],[data-test-selector="channel-panels-container"],[data-test-selector="chat-scrollable-area__message-container"],.metadata-layout__support,.channel-info-content,.channel-root__info,.tw-card,.tw-c-background-base,.tw-c-background-alt,.tw-c-background-alt-2{background:' + bg + ' !important;color:' + text + ' !important;border-color:' + border + ' !important;}'
      + '#root input:not([type="range"]):not([data-a-target="chat-input"]),#root textarea:not([data-a-target="chat-input"]):not(.chat-input__textarea),#root [contenteditable="true"]:not(.chat-wysiwyg-input__editor),#root [role="textbox"]:not([data-a-target="chat-input"]):not(.chat-wysiwyg-input__editor),#root [data-a-target="tw-input"]{background:' + raised + ' !important;color:' + text + ' !important;-webkit-text-fill-color:currentColor !important;caret-color:' + text + ' !important;border-color:' + border + ' !important;}'
      + '#root input::placeholder,#root textarea::placeholder{color:' + muted + ' !important;-webkit-text-fill-color:' + muted + ' !important;}'
      + '#root :where(h1,h2,h3,h4,p,label,small,strong),#root .tw-c-text-base,#root .tw-c-text-alt,#root [class*="CoreText"],#root [class*="Text"],#root [data-a-target="stream-title"],#root [data-a-target="channel-info-title"]{color:' + text + ' !important;-webkit-text-fill-color:currentColor !important;text-shadow:none !important;}'
      + '#root .tw-link,#root a[href^="/directory"],#root a[href^="/downloads"],#root a[href^="/legal"],#root a[href^="/p/"]{color:' + accent + ' !important;-webkit-text-fill-color:currentColor !important;}'
      + '#root button:not([data-a-target*="player" i]):not([data-a-target*="volume" i]),#root [role="button"]:not([data-a-target*="player" i]):not([data-a-target*="volume" i]),#root [data-a-target="chat-settings"],#root [data-a-target="emote-picker-button"]{border-color:' + border + ' !important;color:' + text + ' !important;-webkit-text-fill-color:currentColor !important;}'
      + 'video,.video-player,.persistent-player,.persistent-player video,.tw-image,.tw-avatar,.tw-avatar img{filter:none !important;}'
      + twitchChatAndPlayerCSS(bg, surface, raised, border, text, muted, accent);
  }

  function chatGPTCSS(mode, inShadow) {
    if (!isChatGPTHost()) return '';
    const ultra = mode === 'ultra';
    const light = mode === 'light';
    const p = light ? {
      scheme: 'light',
      bg: '#ffffff',
      surface: '#f7f7f8',
      raised: '#ececf1',
      input: '#ffffff',
      control: '#f4f4f5',
      border: '#d9d9e3',
      text: '#111111',
      muted: '#5f6368',
      link: '#0b57d0',
    } : {
      scheme: 'dark',
      bg: ultra ? '#000000' : '#111318',
      surface: ultra ? '#090a0d' : '#171a21',
      raised: ultra ? '#111318' : '#20242d',
      input: ultra ? '#0c0e12' : '#1c2028',
      control: ultra ? '#151820' : '#252a34',
      border: ultra ? '#2a2f3a' : '#363c49',
      text: '#f3f5f7',
      muted: '#a8afb9',
      link: '#8ab4ff',
    };
    const root = inShadow ? ':host' : ':root,html,body,#root,#__next';
    const vars = [
      '--text-primary:' + p.text,
      '--text-secondary:' + p.muted,
      '--text-tertiary:' + p.muted,
      '--text-quaternary:' + p.muted,
      '--text-default:' + p.text,
      '--surface-primary:' + p.bg,
      '--surface-secondary:' + p.surface,
      '--surface-tertiary:' + p.raised,
      '--surface-hover:' + p.raised,
      '--surface-active:' + p.raised,
      '--main-surface-primary:' + p.bg,
      '--main-surface-secondary:' + p.surface,
      '--main-surface-tertiary:' + p.raised,
      '--sidebar-surface-primary:' + p.surface,
      '--sidebar-surface-secondary:' + p.raised,
      '--sidebar-surface-tertiary:' + p.control,
      '--composer-surface:' + p.input,
      '--message-surface:' + p.bg,
      '--border-light:' + p.border,
      '--border-medium:' + p.border,
      '--border-heavy:' + p.border,
      '--link:' + p.link,
    ].join(' !important;') + ' !important;';
    const app = inShadow ? ':host,:host > *' : 'html,body,#root,#__next,main,[role="main"],[data-testid="conversation-turn"]';
    const sidebar = inShadow ? ':host([data-sidebar]),:host [data-sidebar]' : 'aside,nav,[data-testid*="sidebar" i],[class*="sidebar" i],[class*="bg-token-sidebar-surface-primary" i]';
    const tokenBg = '[class*="bg-token-main-surface-primary" i],[class*="bg-token-main-surface-secondary" i],[class*="bg-token-main-surface-tertiary" i],[class*="bg-token-surface-primary" i],[class*="bg-token-surface-secondary" i]';
    const tokenText = '[class*="text-token-text-primary" i],[class*="text-token-text-secondary" i],[class*="text-token-text-tertiary" i],[class*="text-token-text-quaternary" i]';
    const composerShell = 'form[data-type="unified-composer"],.composer-parent form';
    const textbox = '#prompt-textarea,#prompt-textarea *,textarea,[contenteditable="true"],[role="textbox"]';
    const bottom = '.composer-parent,[class*="bottom-0" i],[class*="sticky" i][class*="bottom" i],[class*="fixed" i][class*="bottom" i],[class*="bg-gradient-to-t" i],[class*="from-token-main-surface-primary" i],[class*="to-token-main-surface-primary" i]';
    return root + '{' + vars + 'color-scheme:' + p.scheme + ' !important;background:' + p.bg + ' !important;background-color:' + p.bg + ' !important;color:' + p.text + ' !important;}'
      + app + '{background:' + p.bg + ' !important;background-color:' + p.bg + ' !important;color:' + p.text + ' !important;border-color:' + p.border + ' !important;}'
      + sidebar + '{background:' + p.surface + ' !important;background-color:' + p.surface + ' !important;color:' + p.text + ' !important;border-color:' + p.border + ' !important;}'
      + tokenBg + '{background:' + p.bg + ' !important;background-color:' + p.bg + ' !important;color:' + p.text + ' !important;border-color:' + p.border + ' !important;}'
      + tokenText + ',p,li,h1,h2,h3,h4,h5,h6,article,article *{color:' + p.text + ' !important;-webkit-text-fill-color:currentColor !important;text-shadow:none !important;}'
      + '[class*="text-token-text-secondary" i],[class*="text-token-text-tertiary" i],[class*="text-token-text-quaternary" i],small,time{color:' + p.muted + ' !important;-webkit-text-fill-color:currentColor !important;}'
      + 'a[href],[role="link"]{color:' + p.link + ' !important;-webkit-text-fill-color:currentColor !important;}'
      + composerShell + '{background:' + p.input + ' !important;background-color:' + p.input + ' !important;color:' + p.text + ' !important;-webkit-text-fill-color:currentColor !important;caret-color:' + p.text + ' !important;border-color:' + p.border + ' !important;box-shadow:none !important;}'
      + textbox + '{background:transparent !important;background-color:transparent !important;color:' + p.text + ' !important;-webkit-text-fill-color:currentColor !important;caret-color:' + p.text + ' !important;border-color:transparent !important;box-shadow:none !important;}'
      + bottom + '{background:' + p.bg + ' !important;background-color:' + p.bg + ' !important;background-image:none !important;color:' + p.text + ' !important;border-color:' + p.border + ' !important;box-shadow:none !important;}'
      + 'button,[role="button"]{color:' + p.text + ' !important;-webkit-text-fill-color:currentColor !important;border-color:transparent !important;}'
      + 'form[data-type="unified-composer"] button,[data-testid*="composer" i] button,.composer-parent button{background:transparent !important;background-color:transparent !important;border-color:transparent !important;border-radius:9999px !important;box-shadow:none !important;overflow:visible !important;}'
      + 'svg,path{color:currentColor !important;fill:currentColor !important;stroke:currentColor !important;}'
      + 'img,picture,video,canvas,iframe,embed,object{filter:none !important;}';
  }

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
    };
  }

  function googleShadowCSS(mode) {
    const dark = mode !== 'light';
    const gp = googlePaletteFor(mode);
    const bg = gp.bg;
    const surface = gp.surface;
    const raised = gp.raised;
    const input = gp.input;
    const chip = gp.chip;
    const border = gp.border;
    const text = gp.text;
    const muted = gp.muted;
    const link = gp.link;
    const vars = [
      '--gm3-sys-color-background:' + bg,
      '--gm3-sys-color-surface:' + surface,
      '--gm3-sys-color-surface-container:' + raised,
      '--gm3-sys-color-on-surface:' + text,
      '--gm3-sys-color-on-surface-variant:' + muted,
      '--gm3-sys-color-outline:' + border,
      '--gm3-sys-color-primary:' + link,
    ].join(' !important;') + ' !important;';
    return ':host{color-scheme:' + (dark ? 'dark' : 'light') + ' !important;' + vars + 'background:' + bg + ' !important;background-color:' + bg + ' !important;color:' + text + ' !important;border-color:' + border + ' !important;}'
      + ':host,:host *{text-shadow:none !important;}'
      + ':host :where(div,section,article,aside,main,header,footer,nav,g-inner-card,g-section-with-header,block-component){background-color:transparent !important;color:' + text + ' !important;border-color:' + border + ' !important;box-shadow:none !important;}'
      + ':host :where([style*="gradient" i],[class*="gradient" i],[class*="fade" i],[class*="overlay" i],[class*="shadow" i],[style*="rgba(0" i],[style*="rgb(0" i],[style*="#000" i]),:host :where([style*="gradient" i],[class*="gradient" i],[class*="fade" i],[class*="overlay" i],[class*="shadow" i],[style*="rgba(0" i],[style*="rgb(0" i],[style*="#000" i])::before,:host :where([style*="gradient" i],[class*="gradient" i],[class*="fade" i],[class*="overlay" i],[class*="shadow" i],[style*="rgba(0" i],[style*="rgb(0" i],[style*="#000" i])::after{background:transparent !important;background-color:transparent !important;background-image:none !important;box-shadow:none !important;}'
      + ':host :where(.MjjYud,.ULSxyf,.g,.Ww4FFb,.kp-blk,.kp-wholepage,.wDYxhc,.CBPhSb,.Wt5Tfe,.EyBRub,.LGOjhe,.X5LH0c,.M8OgIe,.mnr-c,.related-question-pair,[data-attrid],[data-md],[data-hveid]){background-color:' + surface + ' !important;color:' + text + ' !important;border-color:' + border + ' !important;box-shadow:none !important;}'
      + ':host :where(button,[role="button"],[aria-expanded],[aria-controls],[data-q],.KFFQ0c,.B3tYJb,.hqzQac){background-color:' + chip + ' !important;color:' + text + ' !important;-webkit-text-fill-color:currentColor !important;border-color:' + border + ' !important;box-shadow:none !important;}'
      + ':host :where(input,textarea,[contenteditable="true"],[role="textbox"]){background:' + input + ' !important;background-color:' + input + ' !important;color:' + text + ' !important;-webkit-text-fill-color:currentColor !important;caret-color:' + text + ' !important;border-color:' + border + ' !important;}'
      + ':host :where([role="listbox"],[role="option"],.aajZCb,.erkvQe,.UUbT9,.OBMEnb,.sbct,.G43f7e,.pcTkSc,.wM6W7d,.eIPGRd,.ClJ9Yb){background-color:' + bg + ' !important;color:' + text + ' !important;-webkit-text-fill-color:currentColor !important;border-color:' + border + ' !important;box-shadow:none !important;}'
      + ':host :where(p,li,span,div,section,article,h1,h2,h3,h4,h5,h6,em,strong,small,cite):not(a):not(a *){color:' + text + ' !important;-webkit-text-fill-color:currentColor !important;text-shadow:none !important;}'
      + ':host :where(cite,small,time,[class*="secondary" i],[class*="muted" i]){color:' + muted + ' !important;-webkit-text-fill-color:currentColor !important;}'
      + ':host a,:host a *{color:' + link + ' !important;-webkit-text-fill-color:currentColor !important;}'
      + ':host :where(svg,path){color:' + text + ' !important;fill:currentColor !important;stroke:currentColor !important;}'
      + ':host :where(img,picture,video,canvas,iframe,embed,object){filter:none !important;background:transparent !important;}';
  }

  function googleLightCSS() {
    if (!isGoogleHost()) return '';
    const bg = '#ffffff';
    const surface = '#ffffff';
    const raised = '#f8fafd';
    const chip = '#f1f3f4';
    const border = '#dadce0';
    const text = '#202124';
    const muted = '#5f6368';
    const link = '#1a0dab';
    const visited = '#681da8';
    const resultFrame = '#search :where(div,section,article,aside,g-inner-card,g-section-with-header,block-component),#rso :where(div,section,article,aside,g-inner-card,g-section-with-header,block-component),#rhs :where(div,section,article,aside,g-inner-card,g-section-with-header,block-component)';
    const resultText = '#search :where(p,li,span,div,section,article,h1,h2,h3,h4,h5,h6,em,strong,small,cite,yt-formatted-string):not(a):not(a *),#rso :where(p,li,span,div,section,article,h1,h2,h3,h4,h5,h6,em,strong,small,cite):not(a):not(a *),#rhs :where(p,li,span,div,section,article,h1,h2,h3,h4,h5,h6,em,strong,small,cite):not(a):not(a *)';
    const resultSurface = '#search :where(.MjjYud,.ULSxyf,.g,.Ww4FFb,.kp-blk,.kp-wholepage,.wDYxhc,.CBPhSb,.Wt5Tfe,.EyBRub,.LGOjhe,.X5LH0c,.M8OgIe,.mnr-c,.related-question-pair,g-inner-card,g-section-with-header,block-component,[data-attrid],[data-md],[data-hveid]),#rso :where(.MjjYud,.ULSxyf,.g,.Ww4FFb,.kp-blk,.kp-wholepage,.wDYxhc,.CBPhSb,.Wt5Tfe,.EyBRub,.LGOjhe,.X5LH0c,.M8OgIe,.mnr-c,.related-question-pair,g-inner-card,g-section-with-header,block-component,[data-attrid],[data-md],[data-hveid]),#rhs :where(.MjjYud,.ULSxyf,.g,.Ww4FFb,.kp-blk,.kp-wholepage,.wDYxhc,.CBPhSb,.Wt5Tfe,.EyBRub,.LGOjhe,.X5LH0c,.M8OgIe,.mnr-c,.related-question-pair,g-inner-card,g-section-with-header,block-component,[data-attrid],[data-md],[data-hveid])';
    const resultChip = '#search :where(button,[role="button"],[aria-expanded],[aria-controls],g-expandable-container,[data-q],.KFFQ0c,.B3tYJb,.hqzQac),#rhs :where(button,[role="button"],[aria-expanded],[aria-controls],g-expandable-container,[data-q])';
    const nativeNav = '#navcnt,#navcnt *,#foot,#foot *,#bres,#bres *,#swml,#swml *';
    const resultScope = '#cnt,#rcnt,#center_col,#search,#rso,#rhs,[data-async-context]';
    const googleContainers = resultScope + ' :where(div,section,article,aside,main,header,footer,nav,ul,ol,li,g-inner-card,g-section-with-header,block-component):not([role="img"]):not(#navcnt):not(#navcnt *):not(#foot):not(#foot *):not(#bres):not(#bres *):not(#swml):not(#swml *):not(.UUbT9):not(.UUbT9 *):not(form[role="search"] *):not(#searchform *)';
    const googleText = resultScope + ' :where(p,li,span,div,section,article,h1,h2,h3,h4,h5,h6,em,strong,small,cite,yt-formatted-string,[role="heading"]):not(a):not(a *):not(#navcnt):not(#navcnt *):not(#foot):not(#foot *):not(#bres):not(#bres *):not(#swml):not(#swml *)';
    const googleFades = resultScope + ' :where([style*="gradient" i],[class*="gradient" i],[class*="fade" i],[class*="overlay" i],[class*="shadow" i],[style*="rgba(0" i],[style*="rgb(0" i],[style*="#000" i])';
    const bodyContainers = 'body :where(c-wiz,div,section,article,aside,main,header,footer,nav,ul,ol,li,g-inner-card,g-section-with-header,block-component,[jscontroller],[jsname],[data-ved],[data-hveid]):not([role="img"]):not(#navcnt):not(#navcnt *):not(#foot):not(#foot *):not(#bres):not(#bres *):not(#swml):not(#swml *):not(.UUbT9):not(.UUbT9 *):not(form[role="search"] *):not(#searchform *)';
    const bodyText = 'body :where(p,li,span,div,section,article,h1,h2,h3,h4,h5,h6,em,strong,small,cite,yt-formatted-string,[role="heading"]):not(a):not(a *):not(#navcnt):not(#navcnt *):not(#foot):not(#foot *):not(#bres):not(#bres *):not(#swml):not(#swml *)';
    const bodyDarkish = 'body :where([style*="gradient" i],[class*="gradient" i],[class*="fade" i],[class*="overlay" i],[style*="rgba(0" i],[style*="rgb(0" i],[style*="#000" i])';
    const vars = [
      '--gm3-sys-color-background:' + bg,
      '--gm3-sys-color-surface:' + surface,
      '--gm3-sys-color-surface-container:' + raised,
      '--gm3-sys-color-surface-container-low:' + surface,
      '--gm3-sys-color-surface-container-high:' + raised,
      '--gm3-sys-color-on-surface:' + text,
      '--gm3-sys-color-on-surface-variant:' + muted,
      '--gm3-sys-color-outline:' + border,
      '--gm3-sys-color-primary:' + link,
      '--gm3-sys-color-on-primary-container:' + text,
      '--gm3-sys-color-primary-container:' + chip,
      '--m3-sys-color-background:' + bg,
      '--m3-sys-color-surface:' + surface,
      '--m3-sys-color-on-surface:' + text,
      '--m3-sys-color-on-surface-variant:' + muted,
      '--m3-sys-color-outline:' + border,
    ].join(' !important;') + ' !important;';
    return ':root,html,body,#cnt,#rcnt{color-scheme:light !important;' + vars + '}'
      + 'html,body,#main,#cnt,#rcnt,#center_col,#rso,#rhs,[role="main"]{background:' + bg + ' !important;background-color:' + bg + ' !important;color:' + text + ' !important;}'
      + '#gb,#gb *,#sfcnt,#sfcnt *,#hdtb,#hdtbSum,.sfbg,.appbar,.minidiv,.A8SBwf,.RNNXgb{background-color:' + bg + ' !important;color:' + text + ' !important;border-color:' + border + ' !important;text-shadow:none !important;}'
      + '#hdtb a,#hdtb [role="button"],#hdtb button,#hdtb .hdtb-mitem,#hdtb .KFFQ0c,.KFFQ0c,.B3tYJb,.hqzQac{background:' + chip + ' !important;background-color:' + chip + ' !important;background-image:none !important;color:' + text + ' !important;-webkit-text-fill-color:currentColor !important;border-color:' + border + ' !important;box-shadow:none !important;}'
      + '#search,#rso,#rhs,#center_col,.MjjYud,.ULSxyf,.g,.Ww4FFb,.kp-blk{background-color:' + bg + ' !important;color:' + text + ' !important;border-color:' + border + ' !important;box-shadow:none !important;}'
      + bodyContainers + '{background-color:transparent !important;color:' + text + ' !important;-webkit-text-fill-color:currentColor !important;border-color:' + border + ' !important;box-shadow:none !important;text-shadow:none !important;}'
      + bodyContainers + '::before,' + bodyContainers + '::after{background-color:transparent !important;box-shadow:none !important;text-shadow:none !important;}'
      + bodyDarkish + ',' + bodyDarkish + '::before,' + bodyDarkish + '::after{background:transparent !important;background-color:transparent !important;background-image:none !important;box-shadow:none !important;text-shadow:none !important;}'
      + bodyText + '{color:' + text + ' !important;-webkit-text-fill-color:currentColor !important;text-shadow:none !important;}'
      + nativeNav + '{background-color:transparent !important;box-shadow:none !important;text-shadow:none !important;-webkit-text-fill-color:initial !important;}'
      + '#navcnt a,#navcnt a span,#foot a,#bres a,#swml a{color:#1a0dab !important;-webkit-text-fill-color:currentColor !important;text-decoration:none !important;}'
      + '#navcnt .csb,#navcnt span[style*="background-position"],#foot .csb,#foot span[style*="background-position"]{background-image:url("/images/nav_logo321.webp") !important;background-repeat:no-repeat !important;background-color:transparent !important;color:transparent !important;-webkit-text-fill-color:transparent !important;}'
      + '#hdtb a,#hdtb [role="button"],#hdtb button,#hdtb .hdtb-mitem,#hdtb .KFFQ0c,.KFFQ0c,.B3tYJb,.hqzQac,body button,body [role="button"],body [aria-expanded],body [aria-controls]{background-color:' + chip + ' !important;color:' + text + ' !important;-webkit-text-fill-color:currentColor !important;border-color:' + border + ' !important;box-shadow:none !important;}'
      + resultScope + '{background-color:' + bg + ' !important;color:' + text + ' !important;border-color:' + border + ' !important;text-shadow:none !important;}'
      + googleContainers + '{background-color:transparent !important;color:' + text + ' !important;-webkit-text-fill-color:currentColor !important;border-color:' + border + ' !important;box-shadow:none !important;text-shadow:none !important;}'
      + googleContainers + '::before,' + googleContainers + '::after{background-color:transparent !important;box-shadow:none !important;text-shadow:none !important;}'
      + googleFades + ',' + googleFades + '::before,' + googleFades + '::after{background:transparent !important;background-color:transparent !important;background-image:none !important;box-shadow:none !important;}'
      + googleText + '{color:' + text + ' !important;-webkit-text-fill-color:currentColor !important;text-shadow:none !important;}'
      + resultFrame + '{background-color:transparent !important;color:' + text + ' !important;border-color:' + border + ' !important;box-shadow:none !important;text-shadow:none !important;}'
      + resultSurface + '{background-color:' + surface + ' !important;color:' + text + ' !important;border-color:' + border + ' !important;box-shadow:none !important;}'
      + resultChip + '{background-color:' + chip + ' !important;color:' + text + ' !important;-webkit-text-fill-color:currentColor !important;border-color:' + border + ' !important;box-shadow:none !important;}'
      + '#search :where([class*="gradient" i],[style*="gradient"],[style*="rgba(0"],[style*="#000"],[style*="rgb(0"]){background-image:none !important;}'
      + resultText + ',.VuuXrf,.IsZvec,.VwiC3b,.MUxGbd,.hgKElc,.LEwnzc,.kno-rdesc,.kb0PBd{color:' + text + ' !important;-webkit-text-fill-color:currentColor !important;text-shadow:none !important;}'
      + '#search cite,#search small,#rso cite,#rso small,#rhs cite,#rhs small,#search .MUxGbd,#search .hgKElc,#search .LEwnzc,#search .VwiC3b{color:' + muted + ' !important;-webkit-text-fill-color:currentColor !important;}'
      + '#search p *,#search li *,#rso p *,#rso li *,.VuuXrf *,.IsZvec *,.VwiC3b *,.MUxGbd *,.hgKElc *,.LEwnzc *{color:inherit !important;-webkit-text-fill-color:currentColor !important;text-shadow:none !important;}'
      + '#search a,#rso a,#rhs a,#search a *,#rso a *,#rhs a *{color:' + link + ' !important;-webkit-text-fill-color:currentColor !important;}'
      + '#search a:visited,#rso a:visited,#rhs a:visited,#search a:visited *,#rso a:visited *,#rhs a:visited *{color:' + visited + ' !important;-webkit-text-fill-color:currentColor !important;}'
      + '#search h1,#search h2,#search h3,#rso h2,#rso h3,#rhs h2,#rhs h3{color:' + text + ' !important;-webkit-text-fill-color:currentColor !important;text-shadow:none !important;}'
      + '#search button,#search [role="button"],#search [aria-label*="More" i],#search [aria-label*="Tools" i],#rhs button,#rhs [role="button"]{background:' + chip + ' !important;background-color:' + chip + ' !important;color:' + text + ' !important;-webkit-text-fill-color:currentColor !important;border-color:' + border + ' !important;box-shadow:none !important;}'
      + '#search svg,#search path,#rhs svg,#rhs path,#gb svg,#gb path{color:' + text + ' !important;fill:currentColor !important;stroke:currentColor !important;}'
      + '.LC20lb,.DKV0Md,.yuRUbf a h3{color:#1a0dab !important;-webkit-text-fill-color:currentColor !important;}'
      + nativeNav + '{background-color:transparent !important;box-shadow:none !important;text-shadow:none !important;-webkit-text-fill-color:initial !important;}'
      + '#navcnt a,#navcnt a span,#foot a,#bres a,#swml a{color:#1a0dab !important;-webkit-text-fill-color:currentColor !important;text-decoration:none !important;}'
      + '#navcnt .csb,#navcnt span[style*="background-position"],#foot .csb,#foot span[style*="background-position"]{background-image:url("/images/nav_logo321.webp") !important;background-repeat:no-repeat !important;background-color:transparent !important;color:transparent !important;-webkit-text-fill-color:transparent !important;}'
      // "People also search for" / related-search tiles live in the BOTTOM area
      // (#botstuff/#bres/#brs), which the result-scope text rules don't reach, so their
      // text kept Google's native light grey -> near-invisible on white. Force that text
      // (incl. inside the tile <a>) dark, and give the suggestion tiles a real chip
      // surface + border so they read as tiles. PASF tiles link to /search?q=...
      + '#botstuff,#bres,#brs,#botabar,#extrares{background-color:transparent !important;}'
      + '#botstuff :where(p,li,span,div,h3,b,em,cite,a,a *,[role="link"],[role="link"] *),#bres :where(p,li,span,div,h3,b,em,cite,a,a *,[role="link"],[role="link"] *),#brs :where(p,li,span,div,h3,b,em,cite,a,a *,[role="link"],[role="link"] *){color:' + text + ' !important;-webkit-text-fill-color:currentColor !important;text-shadow:none !important;}'
      // chip surface for PASF/related tiles ONLY — exclude pagination & nav (their links are
      // also /search?… links, which is what boxed every page number into "weird boxes").
      + '#botstuff :where(a[href*="/search"],[role="link"]):not(:where([role="navigation"],nav,table,#navcnt,#nav,#pnnext) *),#bres :where(a[href*="/search"],[role="link"]):not(:where([role="navigation"],nav,table,#navcnt) *),#brs :where(a[href*="/search"],[role="link"]):not(:where([role="navigation"],nav,table,#navcnt) *){background-color:' + chip + ' !important;border:1px solid ' + border + ' !important;box-shadow:none !important;}'
      + '#botstuff svg,#botstuff path,#bres svg,#bres path,#brs svg,#brs path{color:' + muted + ' !important;fill:currentColor !important;stroke:currentColor !important;}'
      // The "Goooogle" pagination is a sprite (.SJajHc / nav_logo). When Google itself is dark,
      // it serves the WHITE (dark-theme) sprite letters; on EyeShield's forced-white light bg
      // those are invisible. Force them black so the pagination is readable. (verified live)
      + '#botstuff .SJajHc{filter:brightness(0) !important;}'
      + googleSearchBoxCSS('light');
  }

  function googleSearchBoxCSS(remap) {
    const dark = remap !== 'light';
    const gp = googlePaletteFor(remap);
    // Dark/Ultra use EyeShield's paletteFor(mode) colours directly here. Keep the
    // dropdown flat on that palette instead of reintroducing Google's native grey
    // rich-panel boxes, which were visibly lighter in Dark and darker in Ultra.
    const panel = gp.bg;
    const card = panel;
    const hover = gp.hover;
    const border = gp.border;
    const text = gp.text;
    const muted = gp.muted;
    const icon = gp.icon;
    const shadow = dark ? '0 6px 18px rgba(0,0,0,.55)' : '0 4px 12px rgba(60,64,67,.18)';
    const link = gp.link;
    const inputSel = 'form[role="search"] input[name="q"],form[role="search"] textarea[name="q"],textarea[name="q"],input[name="q"],.gLFyf,#APjFqb';
    const shellSel = 'form[role="search"],#searchform form';
    const searchOuterSel = 'form[role="search"] > div,form[role="search"] .A8SBwf,#searchform form > div,#searchform .A8SBwf';
    const searchPillSel = 'form[role="search"] .RNNXgb,#searchform .RNNXgb';
    const searchActionsSel = 'form[role="search"] .dRYYxd,form[role="search"] .BKRPef,#searchform .dRYYxd,#searchform .BKRPef';
    const inputShellSel = 'form[role="search"] .SDkEP,form[role="search"] .a4bIc,form[role="search"] .YacQv,form[role="search"] .iblpc,#searchform .SDkEP,#searchform .a4bIc,#searchform .YacQv,#searchform .iblpc';
    const iconSel = 'form[role="search"] svg,form[role="search"] path,form[role="search"] .z1asCe,form[role="search"] .z1asCe svg,form[role="search"] .z1asCe path,form[role="search"] .nDcEnd,form[role="search"] .Tg7LZd,form[role="search"] .XDyW0e,#searchform svg,#searchform path,#searchform .z1asCe,#searchform .z1asCe svg,#searchform .z1asCe path,#searchform .nDcEnd,#searchform .Tg7LZd,#searchform .XDyW0e';
    const rowSel = 'form[role="search"] .sbct,form[role="search"] .G43f7e,form[role="search"] .pcTkSc,form[role="search"] .wM6W7d,form[role="search"] .eIPGRd,form[role="search"] .ClJ9Yb,form[role="search"] [role="option"],#searchform .sbct,#searchform .G43f7e,#searchform .pcTkSc,#searchform .wM6W7d,#searchform .eIPGRd,#searchform .ClJ9Yb,#searchform [role="option"],.aajZCb .sbct,.aajZCb .G43f7e,.aajZCb .pcTkSc,.aajZCb .wM6W7d,.aajZCb .eIPGRd,.aajZCb .ClJ9Yb,.erkvQe .sbct,.erkvQe .G43f7e,.erkvQe .pcTkSc,.erkvQe .wM6W7d';
    const suggestionText = rowSel + ',form[role="search"] .sbl1,form[role="search"] .sbl2,form[role="search"] .wM6W7d span,form[role="search"] .pcTkSc span,form[role="search"] .G43f7e span,.aajZCb .sbl1,.aajZCb .sbl2,.aajZCb span,.erkvQe .sbl1,.erkvQe .sbl2,.erkvQe span';
    const suggestionMuted = 'form[role="search"] .sbl2,form[role="search"] .ClJ9Yb,form[role="search"] .aVbWac,.aajZCb .sbl2,.aajZCb .ClJ9Yb,.aajZCb .aVbWac,.erkvQe .sbl2,.erkvQe .ClJ9Yb,.erkvQe .aVbWac';
    const suggestionIcons = 'form[role="search"] .sbic,form[role="search"] .sbic svg,form[role="search"] .sbic path,form[role="search"] .wM6W7d svg,form[role="search"] .wM6W7d path,.aajZCb .sbic,.aajZCb .sbic svg,.aajZCb .sbic path,.erkvQe .sbic,.erkvQe .sbic svg,.erkvQe .sbic path';
    const googleSuggestNames = '.UUbT9,.aajZCb,.erkvQe,.OBMEnb,.xtSCL,.mkHrUc,.ynRric,.lnnVSe,.G43f7e,#Alh6id,#jZ2SBf,#shJ2Vb,#ERWdKc,#GZcH3e,[role="listbox"]';
    const googleSuggestGlobalNames = '.UUbT9,.aajZCb,.erkvQe,.OBMEnb,.xtSCL,#Alh6id,#jZ2SBf,#shJ2Vb,#ERWdKc,#GZcH3e';
    const googleSuggestRoot = ':where(form[role="search"],#searchform) :where(' + googleSuggestNames + '),:where(' + googleSuggestGlobalNames + ')';
    const googleSuggestInner = ':where(form[role="search"],#searchform) :where(' + googleSuggestNames + ') :where(div,section,ul,ol,li,table,tbody,tr,td,g-inner-card,g-section-with-header,block-component):not([role="option"]):not([style*="url"]):not(img):not(picture):not(video):not(canvas):not(svg):not(path),:where(' + googleSuggestGlobalNames + ') :where(div,section,ul,ol,li,table,tbody,tr,td,g-inner-card,g-section-with-header,block-component):not([role="option"]):not([style*="url"]):not(img):not(picture):not(video):not(canvas):not(svg):not(path)';
    const googleSuggestStrongRoot = ':is(form[role="search"],#searchform) :is(' + googleSuggestNames + '),:is(' + googleSuggestGlobalNames + ')';
    const googleSuggestStrongLayers = ':is(form[role="search"],#searchform) :is(' + googleSuggestNames + ') :is(div,section,ul,ol,li,table,tbody,tr,td,g-inner-card,g-section-with-header,block-component):not([role="option"]):not([role="option"] *):not([style*="url"]):not(img):not(picture):not(video):not(canvas):not(svg):not(path),:is(' + googleSuggestGlobalNames + ') :is(div,section,ul,ol,li,table,tbody,tr,td,g-inner-card,g-section-with-header,block-component):not([role="option"]):not([role="option"] *):not([style*="url"]):not(img):not(picture):not(video):not(canvas):not(svg):not(path)';
    const googleSuggestStrongRich = ':is(form[role="search"],#searchform) :is(' + googleSuggestNames + ') :is(.Ww4FFb,.wDYxhc,.ULSxyf,.related-question-pair,.CBPhSb,.Wt5Tfe,.EyBRub,.LGOjhe,.X5LH0c,.M8OgIe,.mnr-c,g-inner-card,g-section-with-header,block-component,[data-attrid],[data-md],[data-hveid]):not([style*="url"]),:is(' + googleSuggestGlobalNames + ') :is(.Ww4FFb,.wDYxhc,.ULSxyf,.related-question-pair,.CBPhSb,.Wt5Tfe,.EyBRub,.LGOjhe,.X5LH0c,.M8OgIe,.mnr-c,g-inner-card,g-section-with-header,block-component,[data-attrid],[data-md],[data-hveid]):not([style*="url"])';
    const googleSuggestStrongControls = ':is(form[role="search"],#searchform) :is(' + googleSuggestNames + ') :is(button,[role="button"],[aria-expanded],[aria-controls],[role="link"]),:is(' + googleSuggestGlobalNames + ') :is(button,[role="button"],[aria-expanded],[aria-controls],[role="link"])';
    const googleSuggestStrongSearchLinks = ':is(form[role="search"],#searchform) :is(' + googleSuggestNames + ') :is(a[href*="/search"],[role="link"]):not(:where([role="navigation"],nav,table,#navcnt,#nav,#pnnext) *),:is(' + googleSuggestGlobalNames + ') :is(a[href*="/search"],[role="link"]):not(:where([role="navigation"],nav,table,#navcnt,#nav,#pnnext) *)';
    const googleSuggestTileText = ':is(form[role="search"],#searchform) :is(' + googleSuggestNames + ') :is(a[href*="/search"],[role="link"]) :is(div,span,p,cite,small,b,strong):not([style*="url"]):not(img):not(picture):not(video):not(canvas):not(svg):not(path),:is(' + googleSuggestGlobalNames + ') :is(a[href*="/search"],[role="link"]) :is(div,span,p,cite,small,b,strong):not([style*="url"]):not(img):not(picture):not(video):not(canvas):not(svg):not(path)';
    const googleSuggestStrongText = ':is(form[role="search"],#searchform) :is(' + googleSuggestNames + ') :is(p,li,span,div,cite,b,strong,em,small,h1,h2,h3,h4,[role="heading"]):not(a):not(a *),:is(' + googleSuggestGlobalNames + ') :is(p,li,span,div,cite,b,strong,em,small,h1,h2,h3,h4,[role="heading"]):not(a):not(a *)';
    const googleSuggestStrongLinks = ':is(form[role="search"],#searchform) :is(' + googleSuggestNames + ') a,:is(form[role="search"],#searchform) :is(' + googleSuggestNames + ') a *,:is(' + googleSuggestGlobalNames + ') a,:is(' + googleSuggestGlobalNames + ') a *';
    const googleSuggestStrongIcons = ':is(form[role="search"],#searchform) :is(' + googleSuggestNames + ') :is(svg,path,.sbic,.z1asCe),:is(' + googleSuggestGlobalNames + ') :is(svg,path,.sbic,.z1asCe)';
    return shellSel + '{color-scheme:' + (dark ? 'dark' : 'light') + ' !important;background:transparent !important;background-color:transparent !important;color:' + text + ' !important;border-color:transparent !important;box-shadow:none !important;text-shadow:none !important;}'
      + searchOuterSel + '{background:transparent !important;background-color:transparent !important;color:' + text + ' !important;border-color:transparent !important;box-shadow:none !important;text-shadow:none !important;}'
      + searchPillSel + '{background:' + panel + ' !important;background-color:' + panel + ' !important;color:' + text + ' !important;border:1px solid ' + border + ' !important;border-radius:9999px !important;box-shadow:none !important;text-shadow:none !important;}'
      + searchActionsSel + '{background-color:transparent !important;color:' + icon + ' !important;border-color:transparent !important;box-shadow:none !important;text-shadow:none !important;}'
      + inputShellSel + '{background-color:transparent !important;background-image:none !important;color:' + text + ' !important;border-color:transparent !important;border-bottom-color:transparent !important;box-shadow:none !important;outline:0 !important;text-shadow:none !important;}'
      + inputShellSel + '::before,' + inputShellSel + '::after{background:transparent !important;background-color:transparent !important;background-image:none !important;border-color:transparent !important;box-shadow:none !important;}'
      + inputSel + '{color:' + text + ' !important;-webkit-text-fill-color:currentColor !important;caret-color:' + text + ' !important;background:transparent !important;background-color:transparent !important;border-color:transparent !important;border-bottom-color:transparent !important;box-shadow:none !important;outline:0 !important;}'
      + inputSel + '::placeholder{color:' + muted + ' !important;-webkit-text-fill-color:' + muted + ' !important;opacity:1 !important;}'
      + iconSel + '{background-color:transparent !important;color:' + icon + ' !important;fill:currentColor !important;stroke:currentColor !important;border-color:transparent !important;box-shadow:none !important;}'
      // The dropdown is ONE opaque surface: paint only the OUTER wrapper (.UUbT9) and
      // give IT the single shadow + border. Make every inner layer transparent so the
      // nested panels (incl. the right-hand "People also ask / People also search for"
      // rich panel) inherit it instead of stacking shadows/borders or leaking native
      // (dark) colours through. The old panel selector painted bg+shadow+border on all 5
      // nested layers -> concentric outlines + a dingy/off box in every mode.
      + googleSuggestRoot + '{background-color:' + panel + ' !important;color:' + text + ' !important;border-color:' + border + ' !important;box-shadow:none !important;text-shadow:none !important;}'
      + googleSuggestInner + '{background-color:transparent !important;color:' + text + ' !important;border-color:transparent !important;box-shadow:none !important;text-shadow:none !important;}'
      + googleSuggestStrongRoot + '{background-color:' + panel + ' !important;color:' + text + ' !important;border-color:' + border + ' !important;box-shadow:none !important;text-shadow:none !important;}'
      + googleSuggestStrongLayers + '{background-color:' + panel + ' !important;color:' + text + ' !important;border-color:transparent !important;box-shadow:none !important;text-shadow:none !important;}'
      + 'form[role="search"] .UUbT9,#searchform .UUbT9,.UUbT9{background:' + panel + ' !important;background-color:' + panel + ' !important;background-image:none !important;color:' + text + ' !important;border:1px solid ' + border + ' !important;box-shadow:' + shadow + ' !important;}'
      + '.UUbT9 *{box-shadow:none !important;}'
      // Paint inner layers via background-COLOR only - NOT the `background`
      // shorthand and NOT background-image:none, both of which would wipe the
      // "People also search for" tile THUMBNAILS (Google renders them as background-image
      // on a div). This keeps the single-surface look while preserving thumbnails.
      + '.UUbT9 :is(div,section,ul,ol,li,table,tbody,tr,td,g-inner-card,g-section-with-header,block-component):not([role="option"]):not([role="option"] *):not([style*="url"]):not(a):not(a *){background-color:' + panel + ' !important;border-color:transparent !important;box-shadow:none !important;}'
      // Google paints a subtle elevation GRADIENT (background-image) on the panel /
      // "People also ask" / rich-panel boxes. It can survive colour overrides and
      // render as a lighter box. Strip it so the dropdown is one flat surface, but
      // EXCLUDE anything inside a tile link (a / [role=link]) or with an inline url(),
      // which is where the "People also search for" THUMBNAILS live - don't touch those.
      + '.UUbT9 :where([style*="gradient" i],[class*="gradient" i],[class*="fade" i],[class*="overlay" i],[class*="shadow" i]):not([role="option"]):not([role="link"]):not([role="link"] *):not(a):not(a *):not([style*="url"]){background-image:none !important;}'
      // Newer Google search dropdowns use nested rich panels for "People also ask"
      // and "People also search for". Flatten those containers to the dropdown
      // background so Dark and Ultra differ by the real mode background only.
      + '.UUbT9 .OBMEnb,.UUbT9 .aajZCb,.UUbT9 .erkvQe,.UUbT9 .mkHrUc,.UUbT9 .ynRric,.UUbT9 .lnnVSe,.UUbT9 .G43f7e,.UUbT9 [role="listbox"]{background-color:' + panel + ' !important;color:' + text + ' !important;border-color:' + border + ' !important;box-shadow:none !important;}'
      + '.UUbT9 :where(.Ww4FFb,.wDYxhc,.ULSxyf,.related-question-pair,.CBPhSb,.Wt5Tfe,.EyBRub,.LGOjhe,.X5LH0c,.M8OgIe,.mnr-c,g-inner-card,g-section-with-header,block-component,[data-attrid],[data-md],[data-hveid]):not([style*="url"]){background-color:' + card + ' !important;color:' + text + ' !important;border-color:' + border + ' !important;box-shadow:none !important;}'
      + googleSuggestStrongRich + '{background-color:' + panel + ' !important;color:' + text + ' !important;border-color:transparent !important;box-shadow:none !important;text-shadow:none !important;}'
      + rowSel + '{background-color:transparent !important;color:' + text + ' !important;-webkit-text-fill-color:currentColor !important;border-color:transparent !important;text-shadow:none !important;}'
      + rowSel + ':hover,' + rowSel + '[aria-selected="true"]{background:' + hover + ' !important;background-color:' + hover + ' !important;color:' + text + ' !important;}'
      + suggestionText + '{background-color:transparent !important;color:' + text + ' !important;-webkit-text-fill-color:currentColor !important;border-color:transparent !important;box-shadow:none !important;text-shadow:none !important;}'
      // Reclaim PAA/PASF pills + any aria/role control inside the dropdown from
      // googleLightCSS's "body [aria-*]/[role=button]{background:chip}" grey rule
      // (.UUbT9 X out-specifies body [aria-*], so this wins -> no grey pills).
      + '.UUbT9 button,.UUbT9 [role="button"],.UUbT9 [aria-expanded],.UUbT9 [aria-controls],.UUbT9 [role="link"]{background-color:transparent !important;color:' + text + ' !important;-webkit-text-fill-color:currentColor !important;border-color:' + border + ' !important;}'
      + googleSuggestStrongControls + '{background-color:transparent !important;color:' + text + ' !important;-webkit-text-fill-color:currentColor !important;border-color:transparent !important;box-shadow:none !important;text-shadow:none !important;}'
      + '.UUbT9 :where(a[href*="/search"],[role="link"]):not(:where([role="navigation"],nav,table,#navcnt,#nav,#pnnext) *){background-color:transparent !important;color:' + text + ' !important;-webkit-text-fill-color:currentColor !important;border:1px solid transparent !important;border-radius:8px !important;box-shadow:none !important;}'
      + googleSuggestStrongSearchLinks + '{background-color:transparent !important;color:' + text + ' !important;-webkit-text-fill-color:currentColor !important;border:1px solid transparent !important;border-radius:8px !important;box-shadow:none !important;text-shadow:none !important;}'
      + googleSuggestTileText + '{background-color:transparent !important;color:' + text + ' !important;-webkit-text-fill-color:currentColor !important;border-color:transparent !important;box-shadow:none !important;text-shadow:none !important;}'
      // Text + anchors across the WHOLE dropdown (covers the rich panel, not just rows).
      + '.UUbT9 :where(p,li,span,div,cite,b,strong,em,small,h1,h2,h3,h4,[role="heading"]):not(a):not(a *){background-color:transparent !important;color:' + text + ' !important;-webkit-text-fill-color:currentColor !important;border-color:transparent !important;box-shadow:none !important;text-shadow:none !important;}'
      + '.UUbT9 a,.UUbT9 a *{background-color:transparent !important;color:' + link + ' !important;-webkit-text-fill-color:currentColor !important;box-shadow:none !important;text-shadow:none !important;}'
      + googleSuggestStrongText + '{background-color:transparent !important;color:' + text + ' !important;-webkit-text-fill-color:currentColor !important;border-color:transparent !important;box-shadow:none !important;text-shadow:none !important;}'
      + googleSuggestStrongLinks + '{background-color:transparent !important;color:' + link + ' !important;-webkit-text-fill-color:currentColor !important;border-color:transparent !important;box-shadow:none !important;text-shadow:none !important;}'
      + suggestionMuted + '{background-color:transparent !important;color:' + muted + ' !important;-webkit-text-fill-color:currentColor !important;border-color:transparent !important;box-shadow:none !important;text-shadow:none !important;}'
      + suggestionIcons + '{background-color:transparent !important;color:' + icon + ' !important;fill:currentColor !important;stroke:currentColor !important;}'
      + googleSuggestStrongIcons + '{background-color:transparent !important;color:' + icon + ' !important;fill:currentColor !important;stroke:currentColor !important;box-shadow:none !important;}'
      + '.UUbT9 svg,.UUbT9 path{color:' + icon + ' !important;fill:currentColor !important;stroke:currentColor !important;}'
      + '.UUbT9 img,.aajZCb img,.erkvQe img{filter:none !important;background:transparent !important;}';
  }

  function googleDarkCSS(remap) {
    if (!isGoogleHost() || (remap !== 'dark' && remap !== 'ultra')) return '';
    const gp = googlePaletteFor(remap);
    const bg = gp.bg;
    const surface = gp.surface;
    const raised = gp.raised;
    const row = gp.row;
    const border = gp.border;
    const text = gp.text;
    const muted = gp.muted;
    const link = gp.link;
    return 'html,body,#main,#cnt,#rcnt,#center_col,#rso,#rhs,[role="main"]{background:' + bg + ' !important;background-color:' + bg + ' !important;color:' + text + ' !important;}'
      + '#search,#rso,#rhs,#center_col,.MjjYud,.ULSxyf,.g,.Ww4FFb,.kp-blk{background:transparent !important;color:' + text + ' !important;border-color:' + border + ' !important;}'
      + '#search p,#search li,#rso p,#rso li,#search span,#rso span,.VuuXrf,.IsZvec,.VwiC3b,.MUxGbd,.hgKElc,.LEwnzc,.kno-rdesc,.kb0PBd{color:' + text + ' !important;-webkit-text-fill-color:currentColor !important;text-shadow:none !important;}'
      + '#search p *,#search li *,#rso p *,#rso li *,.VuuXrf *,.IsZvec *,.VwiC3b *,.MUxGbd *,.hgKElc *,.LEwnzc *{color:inherit !important;-webkit-text-fill-color:currentColor !important;text-shadow:none !important;}'
      + '#search a,#rso a,#rhs a,#search a *,#rso a *,#rhs a *{color:' + link + ' !important;-webkit-text-fill-color:currentColor !important;}'
      + '[aria-label="AI Overview"],[aria-label="AI Overview"]{background:' + bg + ' !important;background-color:' + bg + ' !important;color:' + text + ' !important;border-color:' + border + ' !important;text-shadow:none !important;}'
      + '[aria-label="AI Overview"] *,[aria-label="AI Overview"] ~ div *{text-shadow:none !important;}'
      + '[aria-label="AI Overview"] div[role="button"],[aria-label="AI Overview"] button,#search [aria-expanded],#search [aria-controls],#search g-expandable-container,#search g-inner-card,#search .Ww4FFb,#search .wDYxhc{background:' + surface + ' !important;background-color:' + surface + ' !important;color:' + text + ' !important;border-color:' + border + ' !important;box-shadow:none !important;}'
      + '#search [role="button"],#search button,#search [aria-label*="More" i],#search [aria-label*="Tools" i]{color:' + text + ' !important;-webkit-text-fill-color:currentColor !important;border-color:' + border + ' !important;}'
      + '#search [data-q],#search .related-question-pair,#search .CBPhSb,#search .Wt5Tfe,#search .EyBRub,#search .ULSxyf,#search .sh-dgr__grid-result,#search .LGOjhe,#search .X5LH0c{background:' + row + ' !important;background-color:' + row + ' !important;color:' + text + ' !important;border-color:' + border + ' !important;box-shadow:none !important;}'
      + '#search .related-question-pair:hover,#search .CBPhSb:hover,#search .Wt5Tfe:hover,#search [role="button"]:hover{background:' + raised + ' !important;background-color:' + raised + ' !important;color:' + text + ' !important;}'
      + '#search h1,#search h2,#search h3,#rso h2,#rso h3,#rhs h2,#rhs h3{color:' + text + ' !important;-webkit-text-fill-color:currentColor !important;text-shadow:none !important;}'
      + '#search cite,#search small,#search .MUxGbd,#search .hgKElc,#search .LEwnzc,#search .VwiC3b,#rso cite,#rso small{color:' + muted + ' !important;-webkit-text-fill-color:currentColor !important;}'
      // FLATTEN result containers to the page bg (verified live). The old surface/row rules
      // boxed every organic result + PAA + group container into a grey rectangle that Google's
      // native dark mode never shows ("weird boxes / you still see backgrounds"). Forcing them to
      // bg (not transparent) keeps them flat AND still overrides a light-served Google. Late rule
      // => same specificity as the surface/row rules above but wins by source order.
      + '#search .Ww4FFb,#search .wHYlTd,#search .tF2Cxc,#search .ULSxyf,#search .Wt5Tfe,#search .related-question-pair,#search .dnXCYb,#search .EyBRub,#search .LGOjhe,#search .X5LH0c,#search .g,#rso .Ww4FFb,#rso .ULSxyf,#rso .tF2Cxc{background:' + bg + ' !important;background-color:' + bg + ' !important;border-color:transparent !important;box-shadow:none !important;}'
      // Put the result title and the site-name line back the right way round.
      // Google's markup is <a href><h3>Title</h3></a>, with a SEPARATE anchor for
      // the site name above it. Two rules above collide at equal specificity
      // (`#search a *` and `#search h3`, both 101), so source order decided it and
      // the h3 rule -- being later -- painted titles with `text` while the generic
      // anchor rule painted the site-name line with `link`. The result was the
      // exact inverse of Google's own dark mode: white titles and blue site names,
      // i.e. the least important line on every result was the loudest thing on it.
      // These two win on specificity (102 and 110), not on ordering luck.
      + '#search a h3,#rso a h3,#rhs a h3,#search h3 a,#rso h3 a,#search a .LC20lb,#rso a .LC20lb{color:' + link + ' !important;-webkit-text-fill-color:currentColor !important;}'
      + '#search cite,#rso cite,#search .VuuXrf,#rso .VuuXrf,#search .UdQCqe,#rso .UdQCqe,#search .byrV5b,#rso .byrV5b,#search .tjvcx,#rso .tjvcx{color:' + muted + ' !important;-webkit-text-fill-color:currentColor !important;}'
      + googleSearchBoxCSS(remap);
  }

  function githubCSS(mode) {
    if (!isGitHubHost()) return '';
    const p = paletteFor(mode);
    const scheme = mode === 'light' ? 'light' : 'dark';
    const vars = [
      '--color-canvas-default:' + p.bg,
      '--color-canvas-subtle:' + p.surface,
      '--color-canvas-inset:' + p.raised,
      '--color-canvas-overlay:' + p.raised,
      '--color-fg-default:' + p.text,
      '--color-fg-muted:' + p.muted,
      '--color-fg-subtle:' + p.muted,
      '--color-border-default:' + p.border,
      '--color-border-muted:' + p.border,
      '--color-accent-fg:' + p.link,
      '--bgColor-default:' + p.bg,
      '--bgColor-muted:' + p.surface,
      '--bgColor-inset:' + p.raised,
      '--fgColor-default:' + p.text,
      '--fgColor-muted:' + p.muted,
      '--borderColor-default:' + p.border,
      '--button-default-bgColor-rest:' + p.control,
      '--button-default-fgColor-rest:' + p.text,
      '--button-default-borderColor-rest:' + p.border,
      '--button-primary-bgColor-rest:#1f883d',
      '--button-primary-fgColor-rest:#ffffff',
    ].join(' !important;') + ' !important;';
    return ':root,html,body{color-scheme:' + scheme + ' !important;' + vars + 'background:' + p.bg + ' !important;color:' + p.text + ' !important;}'
      + 'body,.application-main,main,#js-repo-pjax-container,#repo-content-pjax-container,.Layout,.PageLayout,.feed-background{background:' + p.bg + ' !important;color:' + p.text + ' !important;}'
      + '.Header,.AppHeader,.AppHeader-globalBar,.UnderlineNav,.Box,.Box-row,.Popover,.Popover-message,.SelectMenu-modal,.Overlay,.flash,.color-bg-default,.color-bg-subtle,.color-bg-inset,.markdown-body table tr{background:' + p.surface + ' !important;color:' + p.text + ' !important;border-color:' + p.border + ' !important;box-shadow:none !important;}'
      + 'html body :is(header,.Header,.AppHeader,.AppHeader-globalBar,.HeaderMenu,.HeaderMenu--logged-out) :where(a,span,button,div,summary,svg,path){color:' + p.text + ' !important;-webkit-text-fill-color:currentColor !important;fill:currentColor !important;stroke:currentColor !important;text-shadow:none !important;}'
      + 'html body :is(header,.Header,.AppHeader) .search-input-container.search-with-dialog,html body :is(header,.Header,.AppHeader) .search-input-container.search-with-dialog :where(div,span,input,button){background:' + p.input + ' !important;background-color:' + p.input + ' !important;background-image:none !important;color:' + p.text + ' !important;-webkit-text-fill-color:currentColor !important;border-color:' + p.border + ' !important;box-shadow:none !important;text-shadow:none !important;}'
      + 'html body [class*="Primer_Brand__FormControl" i] :where(label,span,div),html body [class*="FormControl-label" i]{color:#ffffff !important;-webkit-text-fill-color:#ffffff !important;text-shadow:none !important;}'
      + 'html body [class*="Primer_Brand__Button" i]{color:#ffffff !important;-webkit-text-fill-color:#ffffff !important;text-shadow:none !important;}'
      + '.markdown-body,.markdown-body p,.markdown-body li,.markdown-body td,.markdown-body th,.markdown-body blockquote,.repo-list-item,.feed-item-content,.js-navigation-item,.text-normal,.fgColor-default{color:' + p.text + ' !important;-webkit-text-fill-color:currentColor !important;text-shadow:none !important;}'
      + '.color-fg-muted,.fgColor-muted,.text-small,.note,.Counter,[class*="muted" i]{color:' + p.muted + ' !important;-webkit-text-fill-color:currentColor !important;}'
      + 'a,a.Link--primary,.Link--muted:hover{color:' + p.link + ' !important;-webkit-text-fill-color:currentColor !important;}'
      + '.btn,.Button,[role="button"],button:not(.HeaderMenu-link){background:' + p.control + ' !important;color:' + p.text + ' !important;-webkit-text-fill-color:currentColor !important;border-color:' + p.border + ' !important;box-shadow:none !important;}'
      + '.btn-primary,.Button--primary,[class*="primary" i][class*="Button" i],a[href="/signup"]{background:#1f883d !important;border-color:#1f883d !important;color:#ffffff !important;-webkit-text-fill-color:#ffffff !important;}'
      + 'html body input,html body textarea,html body select,html body [contenteditable="true"]{background:' + p.input + ' !important;color:' + p.text + ' !important;-webkit-text-fill-color:currentColor !important;caret-color:' + p.text + ' !important;border-color:' + p.border + ' !important;}'
      + 'html body input::placeholder,html body textarea::placeholder{color:' + p.muted + ' !important;-webkit-text-fill-color:' + p.muted + ' !important;opacity:1 !important;}'
      + 'svg,path,octicon-icon{color:currentColor !important;fill:currentColor !important;stroke:currentColor !important;}'
      + 'img,picture,video,canvas,iframe,embed,object{filter:none !important;background:transparent !important;}';
  }

  function stackOverflowCSS(mode) {
    if (!isStackOverflowHost()) return '';
    const p = paletteFor(mode);
    const scheme = mode === 'light' ? 'light' : 'dark';
    return ':root,html,body{color-scheme:' + scheme + ' !important;--theme-body-background-color:' + p.bg + ' !important;--theme-content-background-color:' + p.bg + ' !important;--theme-primary-color:' + p.link + ' !important;--theme-link-color:' + p.link + ' !important;background:' + p.bg + ' !important;color:' + p.text + ' !important;}'
      + 'html,body,#content,.container,.wmx12,.js-main-container,.snippet-hidden,.question-summary,.s-post-summary,.s-post-summary--content,.answer,.question,.post-layout,.left-sidebar,.s-sidebarwidget,.site-footer,#mainbar,#questions,.questions,.flush-left{background:' + p.bg + ' !important;color:' + p.text + ' !important;border-color:' + p.border + ' !important;}'
      + '.s-topbar,.topbar-dialog,.s-sidebarwidget,.s-card,.s-notice,.js-dismissable-hero,.js-consent-banner,.fc-black-050,.bg-black-050,.bg-white,.bar-sm,.ba{background:' + p.surface + ' !important;color:' + p.text + ' !important;border-color:' + p.border + ' !important;box-shadow:none !important;}'
      + '.s-notice *,.js-dismissable-hero *,.js-consent-banner *,.s-sidebarwidget *,.s-card *,.question-hyperlink,.s-link,.s-navigation--item,p,li,td,th,label,.fc-black-900,.fc-black-800,.fc-black-700,.fc-black-600,.fc-dark{color:' + p.text + ' !important;-webkit-text-fill-color:currentColor !important;text-shadow:none !important;}'
      + '.fc-black-500,.fc-black-400,.fc-medium,.s-post-summary--meta,.relativetime,.user-action-time{color:' + p.muted + ' !important;-webkit-text-fill-color:currentColor !important;}'
      + '.s-post-summary--stats,.s-post-summary--stats *,.s-post-summary--stats-item,.s-post-summary--stats-item *{background:transparent !important;color:' + p.muted + ' !important;-webkit-text-fill-color:currentColor !important;text-shadow:none !important;}'
      + '.s-post-summary--stats-item__emphasized,.s-post-summary--stats-item__emphasized *{color:' + p.text + ' !important;-webkit-text-fill-color:currentColor !important;}'
      + 'a,.s-link{color:' + p.link + ' !important;-webkit-text-fill-color:currentColor !important;}'
      + 'html body :is(.s-navigation,.nav-links,#left-sidebar) :is(.s-navigation--item,.s-navigation--item.is-selected,.s-navigation--item.youarehere,.youarehere,a){background:' + p.control + ' !important;color:' + p.text + ' !important;-webkit-text-fill-color:currentColor !important;border-color:' + p.border + ' !important;box-shadow:none !important;}'
      + 'html body :is(.s-navigation,.nav-links,#left-sidebar) :is(.s-navigation--item,.s-navigation--item.is-selected,.s-navigation--item.youarehere,.youarehere,a) *{color:inherit !important;-webkit-text-fill-color:currentColor !important;text-shadow:none !important;}'
      + 'button,.s-btn,[role="button"],input[type="submit"]{background:' + p.control + ' !important;color:' + p.text + ' !important;-webkit-text-fill-color:currentColor !important;border-color:' + p.border + ' !important;box-shadow:none !important;}'
      + 'input,textarea,select{background:' + p.input + ' !important;color:' + p.text + ' !important;-webkit-text-fill-color:currentColor !important;caret-color:' + p.text + ' !important;border-color:' + p.border + ' !important;}'
      + '.js-vote-count,.s-badge,.post-tag{background:' + p.control + ' !important;color:' + p.text + ' !important;border-color:' + p.border + ' !important;}'
      + 'img,picture,video,canvas,iframe,embed,object{filter:none !important;background:transparent !important;}';
  }

  function hackerNewsCSS(mode) {
    if (!isHackerNewsHost()) return '';
    const p = paletteFor(mode);
    const scheme = mode === 'light' ? 'light' : 'dark';
    return ':root,html,body{color-scheme:' + scheme + ' !important;background:' + p.bg + ' !important;color:' + p.text + ' !important;}'
      + 'body,center,#hnmain,#hnmain > tbody,#hnmain > tbody > tr,#hnmain > tbody > tr > td,.itemlist,.itemlist tbody,.itemlist tr,.itemlist td{background:' + p.bg + ' !important;color:' + p.text + ' !important;}'
      + '#hnmain > tbody > tr:first-child > td,.pagetop,.pagetop *,td.title,span.titleline,span.titleline a{background:' + p.surface + ' !important;color:' + p.text + ' !important;-webkit-text-fill-color:currentColor !important;text-shadow:none !important;}'
      + '.title,.title a,.athing,.athing td,.athing a,.comment,.comment span,.commtext,.commtext *{color:' + p.text + ' !important;-webkit-text-fill-color:currentColor !important;text-shadow:none !important;}'
      + '.subtext,.subtext a,.hnuser,.age,.score,.comhead,.sitestr{color:' + p.muted + ' !important;-webkit-text-fill-color:currentColor !important;text-shadow:none !important;}'
      + 'a{color:' + p.link + ' !important;-webkit-text-fill-color:currentColor !important;}'
      + 'input,textarea,select{background:' + p.input + ' !important;color:' + p.text + ' !important;-webkit-text-fill-color:currentColor !important;border-color:' + p.border + ' !important;}'
      + 'img{filter:none !important;background:transparent !important;}';
  }

  function wikipediaCSS(mode) {
    if (!isWikipediaHost()) return '';
    const p = paletteFor(mode);
    const scheme = mode === 'light' ? 'light' : 'dark';
    return ':root,html,body{color-scheme:' + scheme + ' !important;--background-color-base:' + p.bg + ' !important;--background-color-neutral-subtle:' + p.surface + ' !important;--color-base:' + p.text + ' !important;--color-subtle:' + p.muted + ' !important;--border-color-base:' + p.border + ' !important;background:' + p.bg + ' !important;color:' + p.text + ' !important;}'
      + 'html,body,#content,.mw-body,.vector-body,.vector-page-titlebar,.vector-header-container,.vector-column-start,.vector-column-end,.vector-sticky-header,.mw-page-container,.mw-parser-output,.infobox,.sidebar,.navbox,.wikitable,.metadata{background:' + p.bg + ' !important;color:' + p.text + ' !important;border-color:' + p.border + ' !important;}'
      + '#content :where(div,section,article,aside,table,thead,tbody,tfoot,tr,td,th,ul,ol,li,figure,figcaption):not(img):not(picture):not(video):not(canvas):not(svg):not(path):not([style*="url"]){background-color:transparent !important;color:' + p.text + ' !important;border-color:' + p.border + ' !important;box-shadow:none !important;text-shadow:none !important;}'
      + '.vector-header-container,.vector-sticky-header,.infobox,.sidebar,.navbox,.wikitable,.toc,.catlinks,.mw-footer{background:' + p.surface + ' !important;color:' + p.text + ' !important;border-color:' + p.border + ' !important;box-shadow:none !important;}'
      + '#mp-topbanner,#mp-left,#mp-right,#mp-middle,.mp-box,.MainPageBG,.nomobile,.mw-parser-output [style*="background"]{background:' + p.surface + ' !important;background-image:none !important;color:' + p.text + ' !important;border-color:' + p.border + ' !important;box-shadow:none !important;}'
      + '#mp-topbanner h2,#mp-left h2,#mp-right h2,#mp-middle h2,.mp-box h2,.MainPageBG h2,.mw-parser-output [style*="background"] :where(h1,h2,h3,h4){background:' + p.control + ' !important;background-image:none !important;color:' + p.text + ' !important;-webkit-text-fill-color:currentColor !important;border-color:' + p.border + ' !important;box-shadow:none !important;text-shadow:none !important;}'
      + 'p,li,td,th,caption,h1,h2,h3,h4,h5,h6,label,legend,.mw-headline,.vector-menu-heading{color:' + p.text + ' !important;-webkit-text-fill-color:currentColor !important;text-shadow:none !important;}'
      + '.reference,.mw-editsection,.vector-menu-content,.metadata,.ambox,.hatnote{color:' + p.muted + ' !important;-webkit-text-fill-color:currentColor !important;}'
      + 'a{color:' + p.link + ' !important;-webkit-text-fill-color:currentColor !important;}'
      + 'input,textarea,select,button,.cdx-button{background:' + p.control + ' !important;color:' + p.text + ' !important;-webkit-text-fill-color:currentColor !important;border-color:' + p.border + ' !important;box-shadow:none !important;}'
      + 'img,picture,video,canvas,iframe,embed,object{filter:none !important;background:transparent !important;}';
  }

  function redditCSS(mode) {
    if (!isRedditHost()) return '';
    const p = paletteFor(mode);
    const weakText = mode === 'light' ? p.text : p.muted;
    const vars = [
      '--color-neutral-background:' + p.bg,
      '--color-neutral-background-weak:' + p.bg,
      '--color-neutral-background-medium:' + p.surface,
      '--color-neutral-background-strong:' + p.raised,
      '--color-neutral-background-inverted:' + p.surface,
      '--color-neutral-background-selected:' + p.surface,
      '--color-neutral-background-hover:' + p.controlHover,
      '--color-neutral-content:' + p.text,
      '--color-neutral-content-weak:' + weakText,
      '--color-neutral-content-strong:' + p.text,
      '--color-neutral-content-disabled:' + weakText,
      '--color-neutral-content-inverted:' + p.text,
      '--color-neutral-border:' + p.border,
      '--color-neutral-border-weak:' + p.border,
      '--color-tone-1:' + p.text,
      '--color-tone-2:' + weakText,
      '--color-tone-3:' + weakText,
      '--color-tone-4:' + p.border,
      '--color-tone-5:' + p.control,
      '--color-tone-6:' + p.surface,
      '--color-tone-7:' + p.bg,
      '--color-media-background:' + p.surface,
      '--color-primary:' + p.link,
      '--color-primary-hover:' + p.focus,
      '--color-primary-background:' + p.selected,
      '--color-primary-background-hover:' + p.selected,
      '--color-primary-onBackground:' + p.selectedText,
      '--color-secondary:' + p.control,
      '--color-secondary-hover:' + p.controlHover,
      '--color-secondary-background:' + p.control,
      '--color-secondary-background-hover:' + p.controlHover,
      '--color-secondary-plain:' + p.text,
      '--color-secondary-plain-hover:' + p.text,
      '--color-button-secondary-background:' + p.control,
      '--color-button-secondary-background-hover:' + p.controlHover,
      '--color-button-secondary-text:' + p.text,
      '--color-button-plain-text:' + p.text,
      '--color-interactive-content:' + p.link,
      '--color-interactive-content-hover:' + p.focus,
      '--color-a-default:' + p.link,
      '--color-a-hover:' + p.focus,
      '--shreddit-content-background:' + p.bg,
      '--shreddit-color-wordmark:' + p.text,
      '--newCommunityTheme-body:' + p.bg,
      '--newCommunityTheme-bodyText:' + p.text,
      '--newCommunityTheme-line:' + p.border,
      '--newCommunityTheme-metaText:' + weakText,
      '--newCommunityTheme-field:' + p.input,
      '--newCommunityTheme-linkText:' + p.link,
      '--newCommunityTheme-button:' + p.primary,
      '--newCommunityTheme-buttonText:' + p.primaryText,
      '--newRedditTheme-body:' + p.bg,
      '--newRedditTheme-bodyText:' + p.text,
      '--newRedditTheme-line:' + p.border,
      '--newRedditTheme-metaText:' + weakText,
      '--newRedditTheme-field:' + p.input,
      '--newRedditTheme-linkText:' + p.link,
      '--newRedditTheme-button:' + p.primary,
      '--newRedditTheme-buttonText:' + p.primaryText
    ].join(' !important;') + ' !important;';
    const root = ':root,html,body,shreddit-app';
    const app = 'html,body,shreddit-app,main,[role="main"],#main-content,[data-testid="frontpage-main"],[data-testid="post-container"]';
    const chrome = 'reddit-header-large,reddit-header-action-items,reddit-sidebar-nav,left-nav-top-section,left-nav-topic-tracker,[slot="left-nav"],[slot="right-sidebar"],#left-sidebar,#right-sidebar,aside,nav,header';
    const panels = 'shreddit-post,[data-testid="post-container"],[data-testid="post"],article,[role="article"],reddit-sidebar,reddit-recent-posts,community-highlight-card,faceplate-tracker,faceplate-hovercard,faceplate-batch';
    const inboxRows = 'notifications-main-manager,notifications-main-manager faceplate-tracker,notification-item,rpl-inbox-row,rpl-inbox-row[class],faceplate-tracker rpl-inbox-row,faceplate-tracker notification-item rpl-inbox-row';
    const inboxText = 'notifications-main-manager :where(h1,h2,h3,h4,h5,h6,p,span,small,strong,em,faceplate-timeago,faceplate-number,[class*="text" i],[class*="title" i],[class*="truncate" i])';
    const headers = 'reddit-sidebar-nav h1,reddit-sidebar-nav h2,reddit-sidebar-nav h3,left-nav-top-section h1,left-nav-top-section h2,left-nav-top-section h3,[slot="left-nav"] h1,[slot="left-nav"] h2,[slot="left-nav"] h3,shreddit-post h1,shreddit-post h2,shreddit-post h3';
    const textBits = 'shreddit-app :where(h1,h2,h3,h4,h5,h6,p,span,small,strong,em,blockquote,figcaption,summary,legend,caption,th,td,faceplate-timeago,faceplate-number,shreddit-post-title,[slot="title"],[slot="text-body"],[slot="subredditName"],[slot="authorName"],[slot="communityName"],[slot="description"],[class*="truncate" i],[class*="line-clamp" i],[class*="font-" i],[class*="text-" i]):not(img):not(picture):not(video):not(canvas):not(svg):not(path)';
    const mutedBits = 'shreddit-app :where([class*="muted" i],[class*="secondary" i],[class*="subtle" i],[class*="meta" i],[class*="caption" i],[class*="timestamp" i],faceplate-timeago,[slot="credit-bar"],[slot="subtitle"])';
    const links = 'shreddit-app :where(main,[role="main"],shreddit-post,[data-testid="post-container"],[data-testid="post"]) a,shreddit-app :where(main,[role="main"],shreddit-post,[data-testid="post-container"],[data-testid="post"]) a *,shreddit-app :where(main,[role="main"],shreddit-post,[data-testid="post-container"],[data-testid="post"]) [role="link"],shreddit-app :where(main,[role="main"],shreddit-post,[data-testid="post-container"],[data-testid="post"]) [role="link"] *';
    const navLinks = 'reddit-sidebar-nav a,reddit-sidebar-nav a *,left-nav-top-section a,left-nav-top-section a *,[slot="left-nav"] a,[slot="left-nav"] a *';
    const sideText = 'reddit-sidebar-nav *,left-nav-top-section *,left-nav-topic-tracker *,[slot="left-nav"] *,#left-sidebar *';
    const fields = 'shreddit-app input:not([type="range"]):not([type="checkbox"]):not([type="radio"]),shreddit-app textarea,shreddit-app select,shreddit-app [contenteditable="true"],shreddit-app [role="textbox"],reddit-search-large input,reddit-search-large [role="textbox"]';
    const searchHost = 'reddit-search-large';
    const controls = 'shreddit-app :where(button,[role="button"],summary,shreddit-async-loader,faceplate-dropdown-menu,faceplate-menu,faceplate-tooltip),reddit-header-action-items :where(button,[role="button"])';
    const controlHover = 'shreddit-app :where(button,[role="button"],summary,shreddit-async-loader,faceplate-dropdown-menu,faceplate-menu,faceplate-tooltip):where(:hover,[aria-expanded="true"],[aria-pressed="true"],[aria-selected="true"]),reddit-header-action-items :where(button,[role="button"]):where(:hover,[aria-expanded="true"],[aria-pressed="true"],[aria-selected="true"])';
    const media = 'shreddit-app img,shreddit-app picture,shreddit-app video,shreddit-app canvas,shreddit-app svg,shreddit-app iframe,shreddit-app embed,shreddit-app object';
    const bgUtilities = 'shreddit-app :where([class*="bg-neutral" i],[class*="bg-secondary" i],[class*="bg-ui" i],[class*="bg-tone" i],[class*="bg-black" i],[class*="bg-white" i],[class*="background" i],reddit-recent-posts,[slot="right-sidebar"],reddit-search-large):not(img):not(picture):not(video):not(canvas):not(svg):not(path):not([style*="url"])';
    const lightRepair = mode === 'light'
      ? bgUtilities + '{background-color:' + p.surface + ' !important;color:' + p.text + ' !important;border-color:' + p.border + ' !important;box-shadow:none !important;}'
        + 'reddit-search-large,reddit-search-large form,reddit-search-large label,reddit-search-large :where(div,span,button,[role="button"]):not(svg):not(path){background-color:' + p.surface + ' !important;color:' + p.text + ' !important;-webkit-text-fill-color:currentColor !important;border-color:' + p.border + ' !important;box-shadow:none !important;text-shadow:none !important;}'
        + 'reddit-search-large input,reddit-search-large [role="textbox"],reddit-search-large textarea{background-color:' + p.input + ' !important;color:' + p.text + ' !important;-webkit-text-fill-color:currentColor !important;caret-color:' + p.text + ' !important;border-color:' + p.border + ' !important;box-shadow:none !important;}'
        + 'reddit-search-large input::placeholder,reddit-search-large textarea::placeholder{color:' + p.muted + ' !important;-webkit-text-fill-color:' + p.muted + ' !important;opacity:1 !important;}'
        + 'reddit-recent-posts,reddit-recent-posts :where(div,section,article,li),[slot="right-sidebar"],[slot="right-sidebar"] :where(div,section,article,li){background-color:' + p.surface + ' !important;color:' + p.text + ' !important;border-color:' + p.border + ' !important;box-shadow:none !important;text-shadow:none !important;}'
        + 'reddit-recent-posts :where(a,span,p,small,strong,em,faceplate-timeago,faceplate-number,[class*="text" i],[class*="title" i]),[slot="right-sidebar"] :where(a,span,p,small,strong,em,faceplate-timeago,faceplate-number,[class*="text" i],[class*="title" i]){background-color:transparent !important;color:' + p.text + ' !important;-webkit-text-fill-color:currentColor !important;opacity:1 !important;text-shadow:none !important;}'
        + 'reddit-sidebar-nav :where(a,span,p,small,strong,em,faceplate-number,[class*="text" i],[class*="truncate" i],[class*="community" i],[class*="subreddit" i]),left-nav-top-section :where(a,span,p,small,strong,em,faceplate-number,[class*="text" i],[class*="truncate" i],[class*="community" i],[class*="subreddit" i]),left-nav-topic-tracker :where(a,span,p,small,strong,em,faceplate-number,[class*="text" i],[class*="truncate" i],[class*="community" i],[class*="subreddit" i]),[slot="left-nav"] :where(a,span,p,small,strong,em,faceplate-number,[class*="text" i],[class*="truncate" i],[class*="community" i],[class*="subreddit" i]),#left-sidebar :where(a,span,p,small,strong,em,faceplate-number,[class*="text" i],[class*="truncate" i],[class*="community" i],[class*="subreddit" i]){background-color:transparent !important;color:' + p.text + ' !important;-webkit-text-fill-color:currentColor !important;opacity:1 !important;filter:none !important;text-shadow:none !important;}'
        + 'body :where(reddit-sidebar-nav,left-nav-top-section,left-nav-topic-tracker,[slot="left-nav"],#left-sidebar,nav,aside,[role="navigation"]) :where(div,section,article):not([style*="url"]):not(img):not(picture):not(video):not(canvas):not(svg):not(path){background-color:' + p.surface + ' !important;color:' + p.text + ' !important;border-color:' + p.border + ' !important;box-shadow:none !important;text-shadow:none !important;}'
        + '#flex-left-nav-container,#left-sidebar-container,#left-sidebar-container #flex-left-nav-container{background-color:' + p.surface + ' !important;background-image:none !important;color:' + p.text + ' !important;-webkit-text-fill-color:currentColor !important;border-color:' + p.border + ' !important;box-shadow:none !important;text-shadow:none !important;}'
        + '#flex-left-nav-container *{color:' + p.text + ' !important;-webkit-text-fill-color:currentColor !important;fill:currentColor !important;stroke:currentColor !important;text-shadow:none !important;}'
        + 'body :where(aside,nav,[role="navigation"],[data-testid*="left" i],[id*="left" i],[class*="left-nav" i],[class*="sidebar" i],[aria-label*="commun" i],[aria-label*="sidebar" i]) :where(a,span,p,small,strong,em,faceplate-number,[class*="text" i],[class*="truncate" i],[class*="community" i],[class*="subreddit" i]){background-color:transparent !important;color:' + p.text + ' !important;-webkit-text-fill-color:currentColor !important;opacity:1 !important;filter:none !important;text-shadow:none !important;}'
        + 'body :where([slot="right-sidebar"],#right-sidebar,[data-testid*="right" i],[class*="right-sidebar" i],reddit-recent-posts) :where(a,span,p,small,strong,em,faceplate-timeago,faceplate-number,[class*="text" i],[class*="title" i]){background-color:transparent !important;color:' + p.text + ' !important;-webkit-text-fill-color:currentColor !important;opacity:1 !important;filter:none !important;text-shadow:none !important;}'
        + 'body :where([slot="right-sidebar"],#right-sidebar,[data-testid*="right" i],[class*="right-sidebar" i],reddit-recent-posts) :where(div,section,article,li):not([style*="url"]):not([class*="text" i]):not([class*="title" i]):not([class*="truncate" i]){background-color:' + p.surface + ' !important;color:' + p.text + ' !important;border-color:' + p.border + ' !important;box-shadow:none !important;}'
        + 'reddit-sidebar-nav :where(svg,path),left-nav-top-section :where(svg,path),left-nav-topic-tracker :where(svg,path),[slot="left-nav"] :where(svg,path),#left-sidebar :where(svg,path){color:' + p.text + ' !important;fill:currentColor !important;stroke:currentColor !important;opacity:1 !important;filter:none !important;}'
        + 'body :where(button,[role="button"],a):where([aria-label*="Collapse" i],[title*="Collapse" i]){background-color:' + p.control + ' !important;color:' + p.text + ' !important;-webkit-text-fill-color:currentColor !important;border-color:' + p.border + ' !important;box-shadow:none !important;text-shadow:none !important;}'
        + 'body :where(button,[role="button"],a):where([aria-label*="Collapse" i],[title*="Collapse" i]) *{color:' + p.text + ' !important;-webkit-text-fill-color:currentColor !important;fill:currentColor !important;stroke:currentColor !important;text-shadow:none !important;}'
      : '';
    return root + '{' + vars + 'color-scheme:' + p.scheme + ' !important;background-color:' + p.bg + ' !important;color:' + p.text + ' !important;}'
      + app + '{background-color:' + p.bg + ' !important;color:' + p.text + ' !important;border-color:' + p.border + ' !important;text-shadow:none !important;}'
      + chrome + '{background-color:' + p.surface + ' !important;color:' + p.text + ' !important;border-color:' + p.border + ' !important;box-shadow:none !important;text-shadow:none !important;}'
      + panels + '{background-color:' + p.surface + ' !important;color:' + p.text + ' !important;border-color:' + p.border + ' !important;box-shadow:none !important;text-shadow:none !important;}'
      + inboxRows + '{background-color:' + p.surface + ' !important;background-image:none !important;color:' + p.text + ' !important;-webkit-text-fill-color:currentColor !important;border-color:' + p.border + ' !important;box-shadow:none !important;text-shadow:none !important;}'
      + inboxText + '{background-color:transparent !important;color:' + p.text + ' !important;-webkit-text-fill-color:currentColor !important;opacity:1 !important;text-shadow:none !important;}'
      + 'notifications-main-manager a,notifications-main-manager a *{background-color:transparent !important;color:' + p.link + ' !important;-webkit-text-fill-color:currentColor !important;opacity:1 !important;text-shadow:none !important;}'
      + 'shreddit-post::part(background),shreddit-post::part(container),reddit-sidebar-nav::part(container),left-nav-top-section::part(container){background-color:' + p.surface + ' !important;border-color:' + p.border + ' !important;box-shadow:none !important;}'
      + 'shreddit-post [slot="text-body"],shreddit-post [slot="text-body"] *,shreddit-post [slot="title"],shreddit-post [slot="title"] *{background-color:transparent !important;color:' + p.text + ' !important;-webkit-text-fill-color:currentColor !important;text-shadow:none !important;}'
      + textBits + '{background-color:transparent !important;color:' + p.text + ' !important;-webkit-text-fill-color:currentColor !important;border-color:transparent !important;box-shadow:none !important;text-shadow:none !important;}'
      + headers + '{background-color:transparent !important;color:' + p.text + ' !important;-webkit-text-fill-color:currentColor !important;border-color:transparent !important;text-shadow:none !important;}'
      + mutedBits + '{background-color:transparent !important;color:' + p.muted + ' !important;-webkit-text-fill-color:currentColor !important;border-color:transparent !important;box-shadow:none !important;text-shadow:none !important;}'
      + links + '{background-color:transparent !important;color:' + p.link + ' !important;-webkit-text-fill-color:currentColor !important;text-shadow:none !important;}'
      + navLinks + '{background-color:transparent !important;color:' + p.text + ' !important;-webkit-text-fill-color:currentColor !important;text-shadow:none !important;}'
      + sideText + '{color:' + p.text + ' !important;-webkit-text-fill-color:currentColor !important;opacity:1 !important;text-shadow:none !important;}'
      + fields + '{background-color:' + p.input + ' !important;color:' + p.text + ' !important;-webkit-text-fill-color:currentColor !important;caret-color:' + p.text + ' !important;border-color:' + p.border + ' !important;box-shadow:none !important;outline-color:' + p.focus + ' !important;text-shadow:none !important;}'
      + fields + '::placeholder{color:' + p.muted + ' !important;-webkit-text-fill-color:' + p.muted + ' !important;opacity:1 !important;}'
      + searchHost + ',' + searchHost + '[class]{background-color:' + p.input + ' !important;background-image:none !important;color:' + p.text + ' !important;-webkit-text-fill-color:currentColor !important;border:1px solid ' + p.border + ' !important;border-radius:999px !important;box-shadow:none !important;outline:0 !important;overflow:visible !important;text-shadow:none !important;}'
      + searchHost + '::before,' + searchHost + '::after,' + searchHost + '[class]::before,' + searchHost + '[class]::after,' + searchHost + ':focus::before,' + searchHost + ':focus::after,' + searchHost + ':focus-within::before,' + searchHost + ':focus-within::after{content:none !important;display:none !important;background:transparent !important;background-color:transparent !important;background-image:none !important;border:0 !important;box-shadow:none !important;opacity:0 !important;}'
      + searchHost + ':focus-within{border-color:' + p.border + ' !important;box-shadow:none !important;}'
      + controls + '{background-color:' + p.control + ' !important;color:' + p.text + ' !important;-webkit-text-fill-color:currentColor !important;border-color:' + p.border + ' !important;box-shadow:none !important;text-shadow:none !important;}'
      + controlHover + '{background-color:' + p.controlHover + ' !important;color:' + p.text + ' !important;}'
      + bgUtilities + '{color:' + p.text + ' !important;border-color:' + p.border + ' !important;box-shadow:none !important;}'
      + 'shreddit-app :where([class*="bg-neutral" i],[class*="bg-secondary" i],[class*="bg-ui" i],[class*="bg-tone" i]):where(span,p,small,strong,em,h1,h2,h3,h4,h5,h6,[slot]){background-color:transparent !important;}'
      + 'shreddit-app :where(hr,[role="separator"]){border-color:' + p.border + ' !important;background-color:' + p.border + ' !important;}'
      + media + '{filter:none !important;}'
      + 'reddit-header-large :where(svg,path),reddit-header-action-items :where(svg,path),shreddit-app :where(button,[role="button"]) :where(svg,path){fill:currentColor !important;stroke:currentColor !important;}'
      + lightRepair;
  }

  function redditShadowCSS(mode) {
    const p = paletteFor(mode);
    const weakText = mode === 'light' ? p.text : p.muted;
    const vars = [
      '--color-neutral-background:' + p.bg,
      '--color-neutral-background-weak:' + p.bg,
      '--color-neutral-background-medium:' + p.surface,
      '--color-neutral-background-strong:' + p.raised,
      '--color-neutral-background-inverted:' + p.surface,
      '--color-neutral-background-selected:' + p.surface,
      '--color-neutral-background-hover:' + p.controlHover,
      '--color-neutral-content:' + p.text,
      '--color-neutral-content-weak:' + weakText,
      '--color-neutral-content-strong:' + p.text,
      '--color-neutral-content-disabled:' + weakText,
      '--color-neutral-content-inverted:' + p.text,
      '--color-neutral-border:' + p.border,
      '--color-neutral-border-weak:' + p.border,
      '--color-tone-1:' + p.text,
      '--color-tone-2:' + weakText,
      '--color-tone-3:' + weakText,
      '--color-tone-4:' + p.border,
      '--color-tone-5:' + p.control,
      '--color-tone-6:' + p.surface,
      '--color-tone-7:' + p.bg,
      '--color-media-background:' + p.surface,
      '--color-a-default:' + p.link,
      '--color-a-hover:' + p.focus,
      '--color-interactive-content:' + p.link,
      '--color-interactive-content-hover:' + p.focus
    ].join(' !important;') + ' !important;';
    const text = ':where(a,span,p,small,strong,em,h1,h2,h3,h4,h5,h6,faceplate-number,faceplate-timeago,[class*="text" i],[class*="title" i],[class*="truncate" i],[class*="community" i],[class*="subreddit" i])';
    const field = ':where(input:not([type="range"]):not([type="checkbox"]):not([type="radio"]),textarea,select,[contenteditable="true"],[role="textbox"])';
    const control = ':where(button,[role="button"],summary)';
    const blackSurface = mode === 'light'
      ? ':where([class*="bg-black" i],[class*="bg-neutral-background-inverted" i],[class*="bg-neutral-background-strong" i],[class*="bg-tone-1" i],[class*="bg-tone-2" i]):not(img):not(picture):not(video):not(canvas):not(svg):not(path):not([style*="url"]){background-color:' + p.surface + ' !important;color:' + p.text + ' !important;border-color:' + p.border + ' !important;box-shadow:none !important;}'
      : '';
    return ':host,:host *{' + vars + 'color-scheme:' + p.scheme + ' !important;}'
      + ':host{color:' + p.text + ' !important;border-color:' + p.border + ' !important;text-shadow:none !important;}'
      + text + '{background-color:transparent !important;color:' + p.text + ' !important;-webkit-text-fill-color:currentColor !important;opacity:1 !important;filter:none !important;text-shadow:none !important;}'
      + ':where([class*="muted" i],[class*="secondary" i],[class*="subtle" i],[class*="meta" i],[class*="caption" i],faceplate-timeago){color:' + weakText + ' !important;-webkit-text-fill-color:currentColor !important;opacity:1 !important;text-shadow:none !important;}'
      + field + '{background-color:' + p.input + ' !important;color:' + p.text + ' !important;-webkit-text-fill-color:currentColor !important;caret-color:' + p.text + ' !important;border-color:' + p.border + ' !important;box-shadow:none !important;outline:0 !important;text-shadow:none !important;}'
      + control + '{background-color:' + p.control + ' !important;color:' + p.text + ' !important;-webkit-text-fill-color:currentColor !important;border-color:' + p.border + ' !important;box-shadow:none !important;text-shadow:none !important;}'
      + control + ':where(:hover,[aria-expanded="true"],[aria-pressed="true"],[aria-selected="true"]){background-color:' + p.controlHover + ' !important;color:' + p.text + ' !important;}'
      + ':where(hr,[role="separator"]){border-color:' + p.border + ' !important;background-color:' + p.border + ' !important;}'
      + ':where(img,picture,video,canvas,iframe,embed,object){filter:none !important;}'
      + ':host(reddit-search-large){background-color:' + p.input + ' !important;background-image:none !important;color:' + p.text + ' !important;-webkit-text-fill-color:currentColor !important;border:1px solid ' + p.border + ' !important;box-shadow:none !important;outline:0 !important;overflow:visible !important;text-shadow:none !important;}'
      + ':host(faceplate-search-input) :where(.label-container,.input-container,input,textarea,[role="textbox"]),:host(faceplate-search-input:focus-within) :where(.label-container,.input-container,input,textarea,[role="textbox"]){background-color:' + p.input + ' !important;color:' + p.text + ' !important;-webkit-text-fill-color:currentColor !important;border-color:transparent !important;box-shadow:none !important;outline:0 !important;text-shadow:none !important;}'
      + ':host(reddit-search-large) .reddit-search-bar,:host(reddit-search-large) .reddit-search-bar[class]{background-color:transparent !important;background-image:none !important;color:' + p.text + ' !important;-webkit-text-fill-color:currentColor !important;border:0 !important;border-radius:0 !important;box-shadow:none !important;outline:0 !important;overflow:visible !important;text-shadow:none !important;}'
      + ':host(reddit-search-large:focus-within) .reddit-search-bar,:host(reddit-search-large:focus-within) .reddit-search-bar[class]{border:0 !important;border-radius:0 !important;box-shadow:none !important;outline:0 !important;overflow:visible !important;}'
      + ':host(reddit-search-large) :where(.reddit-search-bar > :first-child,form,label,faceplate-search-input,.search-input){background-color:' + p.input + ' !important;background-image:none !important;color:' + p.text + ' !important;-webkit-text-fill-color:currentColor !important;border-color:' + p.border + ' !important;box-shadow:none !important;text-shadow:none !important;}'
      + ':host(reddit-search-large) :where(#search-dropdown-results-container,.search-results-list,[id*="search-dropdown" i],[class*="search-results" i]){background-color:' + p.surface + ' !important;background-image:none !important;color:' + p.text + ' !important;-webkit-text-fill-color:currentColor !important;border-color:' + p.border + ' !important;box-shadow:none !important;outline:0 !important;border-radius:0 !important;text-shadow:none !important;}'
      + ':host(reddit-search-large) :where(#search-dropdown-results-container,.search-results-list,[id*="search-dropdown" i],[class*="search-results" i]) :where(li,a,span,p,small,strong,em,div){background-color:transparent !important;color:' + p.text + ' !important;-webkit-text-fill-color:currentColor !important;text-shadow:none !important;}'
      + ':host(reddit-search-large)::before,:host(reddit-search-large)::after,:host(reddit-search-large:focus)::before,:host(reddit-search-large:focus)::after,:host(reddit-search-large:focus-within)::before,:host(reddit-search-large:focus-within)::after,:host(reddit-search-large) .reddit-search-bar::before,:host(reddit-search-large) .reddit-search-bar::after{content:none !important;display:none !important;background:transparent !important;background-color:transparent !important;background-image:none !important;border:0 !important;box-shadow:none !important;opacity:0 !important;}'
      + ':host(reddit-search-large:focus-within){border-color:' + p.border + ' !important;box-shadow:none !important;}'
      + blackSurface;
  }

  function amazonCSS(mode) {
    if (!isAmazonHost()) return '';
    const p = paletteFor(mode);
    const light = mode === 'light';
    const pageBg = light ? '#eaeded' : p.bg;
    const panel = light ? '#ffffff' : p.surface;
    const card = light ? '#ffffff' : p.raised;
    const mediaMat = '#ffffff';
    const navBg = light ? '#ffffff' : '#161a20';
    const navSub = light ? '#f7f8fb' : '#20242c';
    const text = light ? '#111318' : p.text;
    const muted = light ? '#5b6270' : p.muted;
    const link = light ? '#0066c0' : p.link;
    const price = light ? '#b12704' : '#ffb089';
    const root = 'html,body,#a-page';
    const top = 'body :where(#a-page,#dp,#search,#zg,#pageContent,#centerCol,#rightCol,#leftCol,#main,#content,#gw-content-grid,#desktop-grid,#rhf,#navFooter,#navFooter,#navFooterAmazon)';
    const nav = 'body :where(#navbar,#nav-belt,#nav-main,#nav-subnav,#nav-flyout-searchAjax,#nav-flyout-iss-anchor,#nav-progressive-subnav)';
    const navInner = '#navbar :where(div,span,a,label,form,button,[role="button"],.nav-a,.nav-line-1,.nav-line-2,.nav-search-label,.nav-search-dropdown)';
    const sections = 'body :where(.a-cardui,.a-cardui-body,.a-box,.a-box-inner,.a-section,.celwidget,.bxc-grid__container,.bxc-grid__row,.bxc-grid__content,.bxc-grid__column,.feed-carousel,.a-carousel-container,.a-carousel-viewport,.a-carousel,.a-carousel-row-inner,[data-a-card-type],[data-card-metrics-id],[data-cel-widget],[cel_widget_id],[class*="gw-card" i],[class*="desktop-grid" i],[class*="card-layout" i],[class*="carousel" i],[class*="deal" i]):not(img):not(picture):not(video):not(canvas):not(svg):not(path):not([style*="url"])';
    const cards = 'body :where(.a-carousel-card,.s-result-item,.s-card-container,.puis-card-container,.sg-col-inner,[data-asin],[data-component-type="s-search-result"],[class*="product-card" i],[class*="deal-card" i],[class*="dealCard" i]):not(img):not(picture):not(video):not(canvas):not(svg):not(path):not([style*="url"])';
    const textBits = 'body :is(#a-page,#navbar) :where(h1,h2,h3,h4,h5,h6,p,span,li,td,th,small,strong,em,label,legend,.a-size-base,.a-size-medium,.a-size-small,.a-size-mini,.a-text-normal,.a-color-base,.a-row,.a-list-item,.s-title-instructions-style,.a-truncate,.a-price,.a-offscreen,.a-price-whole,.a-price-fraction)';
    const mutedBits = 'body :is(#a-page,#navbar) :where(.a-color-secondary,.a-color-tertiary,.s-color-swatch-link,[class*="secondary" i],[class*="subtitle" i],[class*="byline" i],[class*="availability" i])';
    const field = 'body :is(#a-page,#nav-search) :where(input:not([type="image"]):not([type="range"]):not([type="checkbox"]):not([type="radio"]),textarea,select,[role="textbox"])';
    const control = 'body :is(#a-page,#nav-search) :where(button,[role="button"],.a-button,.a-button-inner,.a-button-text,.a-dropdown-prompt,.nav-search-submit,.nav-search-scope)';
    const media = 'body :where(#a-page) :where(img,picture,video,canvas,iframe,embed,object)';
    const mediaWrap = 'body :where(#a-page) :where(.a-image-container,.s-product-image-container,.s-image-square-aspect,.s-image-fixed-height,.a-dynamic-image-container,[class*="image-container" i],[class*="imageWrapper" i],[class*="image-wrapper" i]):not([style*="url"])';
    const sectionHeadings = 'body :is(#a-page) :where(.a-cardui-header,.a-cardui-header *,h1,h2,h3,h4,[class*="headline" i],[class*="heading" i])';
    return root + '{background-color:' + pageBg + ' !important;color:' + text + ' !important;color-scheme:' + p.scheme + ' !important;}'
      + top + '{background-color:' + pageBg + ' !important;color:' + text + ' !important;border-color:' + p.border + ' !important;box-shadow:none !important;text-shadow:none !important;}'
      + nav + '{background-color:' + navBg + ' !important;color:' + text + ' !important;border-color:' + p.border + ' !important;box-shadow:none !important;text-shadow:none !important;}'
      + '#nav-main,#nav-subnav,#nav-progressive-subnav{background-color:' + navSub + ' !important;}'
      + navInner + '{color:' + text + ' !important;-webkit-text-fill-color:currentColor !important;border-color:' + p.border + ' !important;text-shadow:none !important;}'
      + sections + '{background-color:' + panel + ' !important;color:' + text + ' !important;border-color:' + p.border + ' !important;box-shadow:none !important;text-shadow:none !important;}'
      + cards + '{background-color:' + card + ' !important;color:' + text + ' !important;border:1px solid ' + p.border + ' !important;box-shadow:none !important;text-shadow:none !important;}'
      + cards + ':hover{background-color:' + p.controlHover + ' !important;}'
      + sectionHeadings + '{background-color:transparent !important;color:' + text + ' !important;-webkit-text-fill-color:currentColor !important;text-shadow:none !important;}'
      + textBits + '{background-color:transparent !important;color:' + text + ' !important;-webkit-text-fill-color:currentColor !important;text-shadow:none !important;}'
      + mutedBits + '{background-color:transparent !important;color:' + muted + ' !important;-webkit-text-fill-color:currentColor !important;text-shadow:none !important;}'
      + 'body :is(#a-page) :where(.a-price,.a-price-whole,.a-price-fraction,.a-color-price,.p13n-sc-price){color:' + price + ' !important;-webkit-text-fill-color:currentColor !important;}'
      + 'body :is(#a-page,#navbar) a,body :is(#a-page,#navbar) a *{background-color:transparent !important;color:' + link + ' !important;-webkit-text-fill-color:currentColor !important;text-shadow:none !important;}'
      + field + '{background-color:' + p.input + ' !important;color:' + text + ' !important;-webkit-text-fill-color:currentColor !important;caret-color:' + text + ' !important;border-color:' + p.border + ' !important;box-shadow:none !important;text-shadow:none !important;}'
      + field + '::placeholder{color:' + muted + ' !important;-webkit-text-fill-color:' + muted + ' !important;opacity:1 !important;}'
      + '#nav-search-bar-form,#nav-search form,#nav-search .nav-search-field,#nav-search .nav-search-scope,#nav-search .nav-search-submit{background-color:' + p.input + ' !important;color:' + text + ' !important;border-color:' + p.border + ' !important;box-shadow:none !important;}'
      + control + '{background-color:' + p.control + ' !important;color:' + text + ' !important;-webkit-text-fill-color:currentColor !important;border-color:' + p.border + ' !important;box-shadow:none !important;text-shadow:none !important;}'
      + control + ':hover{background-color:' + p.controlHover + ' !important;color:' + text + ' !important;}'
      + mediaWrap + '{background-color:' + mediaMat + ' !important;border-color:' + (light ? p.border : '#ffffff') + ' !important;box-shadow:none !important;}'
      + media + '{filter:none !important;background:transparent !important;}'
      // Deals (dcl-*) widget outer wrappers + nav-assistant shortcut panel ship native
      // WHITE backgrounds via class !important rules that the :where()-wrapped selectors
      // above can't out-specify, so they stayed as bright patches. Cover them explicitly
      // with id-level specificity (#a-page + :is) so the page reads dark end to end.
      + 'body #a-page :is(.dcl-container,.dcl-container-inner){background-color:' + pageBg + ' !important;}'
      + 'body #a-page :is(nav.nav-assistant,.nav-assistant,.shortcut-help-container,#shortcut-menu){background-color:' + panel + ' !important;border-color:' + p.border + ' !important;}'
      + 'body #a-page :is(.nav-assistant,#shortcut-menu) :is(h1,h2,h3,h4,span,li,a,div,p){color:' + text + ' !important;-webkit-text-fill-color:currentColor !important;}'
      + 'body :is(#a-page) :where(hr,[role="separator"],.a-divider,.a-spacing-top-base){border-color:' + p.border + ' !important;background-color:' + p.border + ' !important;}';
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
  function themeFooter(remap) {
    let siteCSS = '';
    switch (managedThemeHostName()) {
      case 'google':
        siteCSS = remap === 'light' ? googleLightCSS() : googleDarkCSS(remap);
        break;
      case 'github':
        siteCSS = githubCSS(remap);
        break;
      case 'stackoverflow':
        siteCSS = stackOverflowCSS(remap);
        break;
      case 'hackernews':
        siteCSS = hackerNewsCSS(remap);
        break;
      case 'wikipedia':
        siteCSS = wikipediaCSS(remap);
        break;
      case 'youtube':
        siteCSS = remap === 'light' ? youtubeLightCSS() : youtubeDarkCSS(remap);
        break;
      case 'twitch':
        siteCSS = remap === 'light' ? twitchLightCSS() : twitchDarkCSS(remap);
        break;
      case 'chatgpt':
        siteCSS = chatGPTCSS(remap, false);
        break;
      case 'reddit':
        siteCSS = redditCSS(remap);
        break;
      case 'amazon':
        siteCSS = amazonCSS(remap);
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
    discordRescanT = setTimeout(function () { discordRescanT = 0; discordRescan(); }, 50);
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
      discordObserver = new MutationObserver(function (muts) {
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
        [500, 1500, 3500, 6000].forEach(function (ms) { try { setTimeout(reinj, ms); } catch (e) {} });
        try { window.addEventListener('load', function () { setTimeout(reinj, 300); }, { once: true }); } catch (e) {}
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
      document.addEventListener('DOMContentLoaded', apply, { once: true });
    } else {
      apply();
    }
  }

  function loadConfig() {
    if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) return;
    chrome.storage.local.get('wardenone_config', (res) => { setConfig(res && res.wardenone_config); });
  }

  window.__wardenOneEyeShieldApplyConfig = setConfig;
  window.__wardenOneEyeShieldRefresh = function () {
    try {
      if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) return;
      chrome.storage.local.get('wardenone_config', (res) => { setConfig(res && res.wardenone_config); });
    } catch (e) {}
  };

  // late-loading stylesheets (web fonts, async CSS) — re-theme after full load
  window.addEventListener('load', () => {
    if (!activeRemap || isTwitchHost()) return;
    pendingSheet = true;
    scheduleRebuild();
  });

  loadConfig();

  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && changes.wardenone_config) {
        setConfig(changes.wardenone_config.newValue || {});
      }
    });
  } catch (e) {}

  try {
    chrome.runtime.onMessage.addListener((msg) => {
      if (!msg || msg.kind !== 'config-update') return;
      setConfig(msg.overrides || {});
    });
  } catch (e) {}
}());
