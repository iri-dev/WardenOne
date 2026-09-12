/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/*
 * Eye Shield's per-site themes belong to the top frame, and the core has to work without them.
 *
 * eyeshield.js is registered for every frame of every site. 186 KB of it was the ten
 * hand-tuned stylesheets for YouTube, Google, Reddit, Amazon, Twitch, ChatGPT, GitHub,
 * Stack Overflow, Wikipedia and Hacker News -- so an ordinary page compiled Reddit's
 * stylesheet and Google's search-box rules in every one of its iframes and never called
 * them, because themeFooter() picks a builder by hostname and returns '' for anything
 * else (COST-03).
 *
 * They now live in eyeshield-sites.js, registered top-frame-only. Two things have to hold
 * for that to be safe, and both are asserted here:
 *
 *   - the core must never call a moved builder by name. If it does, a child frame throws
 *     a ReferenceError mid-theme instead of quietly theming generically.
 *   - the factory must receive every helper the builders read. A missing one is not a
 *     syntax error; it is a ReferenceError on one site, in one mode, possibly months later.
 *     So every public builder is actually executed here against a stub bag.
 *
 * Run: node tools/test-eyeshield-site-split.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const CORE = fs.readFileSync(path.join(ROOT, 'eyeshield.js'), 'utf8');
const SITES = fs.readFileSync(path.join(ROOT, 'eyeshield-sites.js'), 'utf8');
const BG = fs.readFileSync(path.join(ROOT, 'background.js'), 'utf8');

let failures = 0;
function check(label, condition, extra) {
  if (condition) { console.log('  ok  ' + label); return; }
  failures++;
  console.log('  FAIL ' + label + (extra ? ' :: ' + extra : ''));
}

/* Mask strings and comments before looking for identifiers: this file is built out of CSS
   literals, and a name inside one is not a call. Counting braces without this is what made
   an earlier analysis of the same file wrong. */
function mask(src) {
  const out = src.split('');
  let i = 0; const n = src.length; let prev = '';
  while (i < n) {
    const c = src[i], d = src[i + 1];
    if (c === '/' && d === '/') { while (i < n && src[i] !== '\n') { out[i] = ' '; i++; } continue; }
    if (c === '/' && d === '*') { out[i] = out[i + 1] = ' '; i += 2; while (i < n && !(src[i] === '*' && src[i + 1] === '/')) { out[i] = ' '; i++; } out[i] = ' '; out[i + 1] = ' '; i += 2; continue; }
    if (c === '"' || c === "'" || c === '`') {
      const q = c; out[i] = ' '; i++;
      while (i < n) {
        if (src[i] === '\\') { out[i] = ' '; out[i + 1] = ' '; i += 2; continue; }
        if (src[i] === q) { out[i] = ' '; i++; break; }
        out[i] = ' '; i++;
      }
      prev = 'x'; continue;
    }
    if (!/\s/.test(c)) prev = c;
    i++;
  }
  return out.join('');
}

/* ---- the two files are actually split ------------------------------------------- */

check('eyeshield-sites.js exists and carries the per-site themes', SITES.length > 100000,
  SITES.length + ' B');
check('the core shed most of its weight', CORE.length < 200000,
  CORE.length + ' B -- it was 317,073 before the split');

/* ---- nothing in core calls a moved builder -------------------------------------- */

const movedNames = [...SITES.matchAll(/^\s*function\s+([A-Za-z_$][\w$]*CSS)\s*\(/gm)].map((m) => m[1]);
check('the sites file holds a real set of builders', movedNames.length >= 25, movedNames.length + ' found');
{
  const maskedCore = mask(CORE);
  const dangling = movedNames.filter((n) => new RegExp('\\b' + n + '\\s*\\(').test(maskedCore));
  check('the core never calls a moved builder by name', dangling.length === 0,
    dangling.join(', ') + ' -- a child frame would throw mid-theme');
}

/* ---- the core routes through the registry --------------------------------------- */

check('the core resolves the site themes lazily', /function eyeSites\(\)/.test(CORE),
  'resolving at load would make the two registrations order-dependent');
check('a frame without the file themes generically rather than throwing',
  /return fn \? String\(fn\(a, b\) \|\| ''\) : ''/.test(CORE));
check('every site branch goes through the router',
  (CORE.match(/siteCSSOf\('/g) || []).length >= 14,
  (CORE.match(/siteCSSOf\('/g) || []).length + ' routed call sites');

/* ---- registration scope --------------------------------------------------------- */

check('the sites file is registered', /EYESHIELD_SITES_SCRIPT_ID/.test(BG));
{
  const reg = BG.slice(BG.indexOf('id: EYESHIELD_SITES_SCRIPT_ID'), BG.indexOf('id: EYESHIELD_SITES_SCRIPT_ID') + 600);
  check('and registered TOP FRAME ONLY -- the whole point', /allFrames: false/.test(reg),
    'if this flips to true the split saves nothing');
  check('at document_start, like the core', /runAt: 'document_start'/.test(reg),
    'later than the core would mean a flash of unthemed site chrome');
}
check('turning theming off unregisters both scripts',
  /unregisterContentScripts\(\{ ids: \[EYESHIELD_SCRIPT_ID, EYESHIELD_SITES_SCRIPT_ID\] \}\)/.test(BG),
  'a stale persistAcrossSessions registration would survive a restart');
check('the catch-up injection carries the sites file into the top frame',
  /frameIds: \[0\][^;]*eyeshield-sites\.js/s.test(BG),
  'without it, enabling theming leaves an open YouTube tab generic until reload');

/* ---- the factory bag is complete: run every builder ----------------------------- */

{
  const ctx = { console: { log() {}, warn() {} } };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(SITES, ctx);
  const reg = ctx.__woEyeSites;
  check('the sites file registers a factory', !!(reg && typeof reg.factory === 'function'));

  if (reg && typeof reg.factory === 'function') {
    const palette = () => ({
      bg: '#000', fg: '#fff', text: '#fff', border: '#333', accent: '#888', panel: '#111',
      hover: '#222', muted: '#555', link: '#88f', surface: '#111', shadow: '#000',
    });
    const bag = {};
    ['paletteFor', 'youtubePalette', 'youtubeSubscribePalette', 'youtubeTextVars',
      'googlePaletteFor', 'scopedSelectors'].forEach((n) => { bag[n] = palette; });
    ['isYouTubeHost', 'isTwitchHost', 'isChatGPTHost', 'isGoogleHost', 'isGitHubHost',
      'isStackOverflowHost', 'isHackerNewsHost', 'isWikipediaHost', 'isRedditHost',
      'isAmazonHost'].forEach((n) => { bag[n] = () => true; });
    bag.TWITCH_CHAT_NAME = 'chat';
    bag.TWITCH_NOT_CHAT_NAME = 'notchat';
    bag.NOT_SWATCH = ':not(.sw)';

    let built = null;
    try { built = reg.factory(bag); } catch (e) { check('the factory runs', false, e.message); }
    if (built) {
      const names = Object.keys(built);
      check('it returns the builders the core routes to', names.length >= 16, names.length + ' returned');
      const broken = [];
      for (const n of names) {
        for (const mode of ['dark', 'light']) {
          try {
            const css = built[n](mode, false);
            if (typeof css !== 'string') broken.push(n + ' returned ' + typeof css);
          } catch (e) { broken.push(n + '(' + mode + ') :: ' + String(e.message).slice(0, 60)); }
        }
      }
      check('every builder runs in both modes on the helper bag alone', broken.length === 0,
        broken.slice(0, 4).join(' | ') + ' -- a helper missing from the bag is a ReferenceError on one site, not a syntax error');
    }
  }
}

console.log('');
if (failures) {
  console.log(failures + ' check(s) failed');
  process.exit(1);
}
console.log('all Eye Shield site-split checks passed');
