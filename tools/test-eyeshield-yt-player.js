/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/*
 * YouTube's player chrome must survive EyeShield.
 *
 * The player is black in every mode, so its controls never follow the page theme.
 * The one thing EyeShield has to supply is a text colour -- white -- so the page's
 * own text colour (near-black in light mode) cannot leak into the player. Every
 * surface in the controls belongs to YouTube.
 *
 * That last part is what went wrong. YouTube's player redesign draws each control
 * on a translucent dark pill, and those pills are the only thing between a white
 * icon and a white frame. Measured on a live watch page (ytp-delhi-modern):
 *
 *   play, prev, next, the volume group, the clock, the chapter title and the
 *   right-hand group     background rgba(0,0,0,0.3)
 *   the autoplay knob    background rgb(255,255,255)
 *
 * The earlier rules forced every button, and every div and span in the bottom
 * chrome, transparent -- a guard against a page remap that does not run on
 * YouTube -- and restated a handful of YouTube's old values by hand. With the
 * same video paused on a white frame, measured in Chrome:
 *
 *   old rules   every pill -> rgba(0,0,0,0), the autoplay knob -> rgba(0,0,0,0);
 *               the controls were white on white, which is the report
 *   new rules   every pill and the knob identical to the page with no theme
 *
 * So the invariant is structural: inside the player, only the shell (black) and
 * the video surfaces (transparent, so the black shows round the picture) may be
 * given a background. Anything else is YouTube's to paint.
 *
 * The stylesheet is only half of it. The readability guard writes INLINE
 * !important paint, which no stylesheet can outrank, and its background walk
 * gives up after 8 ancestors -- the clock sits exactly 8 levels under the
 * player's black. Past that the guard assumed the PAGE background, scored
 * white-on-white at 1.00 and repainted the clock near-black. The guard skips
 * player chrome entirely, and the checks below keep it that way.
 *
 * Run: node tools/test-eyeshield-yt-player.js
 */
'use strict';

const fs = require('fs');
const vm = require('vm');

/* youtubePlayerCSS moved to eyeshield-sites.js with the rest of the per-site themes
   (COST-03). Both files are read so the slice finds it wherever it lives. */
const source = [
  fs.readFileSync('eyeshield.js', 'utf8'),
  fs.readFileSync('eyeshield-sites.js', 'utf8'),
].join('\n');
let failed = 0;

function check(what, ok, why) {
  if (ok) return;
  failed++;
  console.error('[fail] ' + what + (why ? ' -- ' + why : ''));
}

/* Run the shipped function rather than restating what it should say. */
const start = source.indexOf('  function youtubePlayerCSS(text) {');
check('youtubePlayerCSS is still there', start >= 0);
if (start < 0) process.exit(1);
const end = source.indexOf('\n  }', start) + 4;
/* Take the exclusion from the source too. Supplying it here would have meant
   the check below asserted a value this file had just invented. */
const swatchLine = source.match(/^ *const NOT_SWATCH = '([^']*)';$/m);
check('the swatch exclusion is declared in eyeshield', !!swatchLine);
const NOT_SWATCH = swatchLine ? swatchLine[1] : '';
const sandbox = { NOT_SWATCH };
vm.createContext(sandbox);
vm.runInContext(source.slice(start, end), sandbox, { filename: 'eyeshield.js:youtubePlayerCSS' });
const CSS = sandbox.youtubePlayerCSS('#f1f1f1');

/* Split into rules so each check can see which selectors share a body. The player
   stylesheet has no nesting, so a flat split is exact. */
const RULES = [];
CSS.replace(/([^{}]+)\{([^{}]*)\}/g, (_, sel, body) => {
  RULES.push({ selectors: sel.split(',').map((s) => s.trim()), body });
  return '';
});
check('the player stylesheet parses into rules', RULES.length >= 4, RULES.length + ' rules');

/* The shell carries the colour, so anything no rule claims still inherits white
   rather than the page's text colour -- which in light mode is near-black. */
check('the player shell sets its own text colour',
  /#player,#player-container,#movie_player,\.html5-video-player\{background-color:#000000 !important;color:#ffffff !important;\}/.test(CSS),
  'without it, uncovered controls inherit near-black text onto a black player');

/* The invariant. A selector may carry paint only if it is the shell or a video
   surface; the controls, their wrappers and their pills are YouTube's. */
const SHELL = new Set(['#player', '#player-container', '#movie_player', '.html5-video-player']);
const VIDEO_SURFACE = /^#movie_player (\.html5-video-container( \*)?|\.video-stream|video|\.ytp-cued-thumbnail-overlay(-image)?|\.ytp-iv-video-content)$/;
const PAINT = /(^|;)\s*(background(-color|-image)?|box-shadow)\s*:/;
RULES.forEach((rule) => {
  if (!PAINT.test(rule.body)) return;
  rule.selectors.forEach((sel) => {
    check('only the shell and the video surfaces are painted: ' + sel,
      SHELL.has(sel) || VIDEO_SURFACE.test(sel),
      'the player draws its controls on its own pills; a background here erases them');
  });
});
/* The shapes that did the erasing, named so a returning one fails by name. */
check('no net clears the bottom chrome', !/\.ytp-chrome-bottom :where\(/.test(CSS),
  'it flattened every pill in the redesigned player');
const buttonRules = RULES.filter((r) => r.selectors.indexOf('#movie_player .ytp-button' + NOT_SWATCH) >= 0);
check('the button rule sets a colour and nothing else',
  buttonRules.length === 1 && /color:#f1f1f1 !important/.test(buttonRules[0].body)
    && !PAINT.test(buttonRules[0].body) && !/border-color/.test(buttonRules[0].body),
  'play, next and the chapter title are buttons, and each sits on a pill');
['.ytp-right-controls', '.ytp-volume-area', '.ytp-time-wrapper', '.ytp-chapter-title',
  '.ytp-autonav-toggle-button', '.ytp-progress-list', '.ytp-load-progress', '.ytp-bound-time-left',
].forEach((part) => {
  check('YouTube\'s own ' + part + ' is not restated or cleared',
    !RULES.some((r) => PAINT.test(r.body) && r.selectors.some((s) => s.indexOf(part) >= 0)),
    'hand-copied values go stale the next time the player is redesigned');
});
check('the whole in-video overlay layer is not cleared',
  CSS.indexOf('.ytp-player-content *') < 0,
  'it holds pill-backed overlays of its own');

/* The guard is the other half: a stylesheet cannot beat what it writes inline. */
const chromeLine = source.match(/^ *const EW_PLAYER_CHROME = ([\s\S]*?);$/m);
check('the guard knows what player chrome is', !!chromeLine);
const PLAYER_CHROME = chromeLine ? chromeLine[1] : '';
['#movie_player', '.html5-video-player', '.ytp-chrome-bottom', '.video-player', '.persistent-player']
  .forEach((sel) => {
    check('player chrome covers ' + sel, PLAYER_CHROME.indexOf(sel) >= 0);
  });
check('and the readability guard stands off it',
  /if \(playerRoots\.length && ewInPlayer\(playerRoots, el\)\) return;/.test(source),
  'its 8-ancestor background walk does not reach the player background reliably');
/* Asked once per run, not once per element. The first version called closest()
   with this list on every element on the page: measured at 9.38ms per guard run
   on a YouTube watch page against 1.64ms for resolving the roots once and using
   contains() -- 83% less, identifying exactly the same 715 elements. */
check('the player test is resolved once per run, not per element',
  /const playerRoots = ewPlayerRoots\(\);/.test(source)
    && /function ewPlayerRoots\(\)/.test(source),
  'closest() per element is the expensive way to ask this');
check('and nothing calls closest with the player list per element',
  !/closest\(EW_PLAYER_CHROME\)/.test(source));
check('a page with no player pays nothing for the check',
  /playerRoots\.length && ewInPlayer/.test(source),
  'the length test short-circuits before any tree work');
/* The guard still has to do its job everywhere else. Verified in Chrome: white
   text on a white page outside the player is still repainted rgb(18,19,24). */
check('the guard still runs outside the player',
  /walkElements\(document\.body, managed \? 8000 : 14000/.test(source));
check('the version records it', /contrast-guard-skips-player-chrome/.test(source));

/* The clock is where this started. It gets YouTube's own white, not a whiter one
   of our own: #eee across the display, #fff on the elapsed time. */
check('the clock is painted the white YouTube itself uses',
  /#movie_player \.ytp-time-display,#movie_player \.ytp-time-display \*/.test(CSS)
    && /color:#eeeeee !important;-webkit-text-fill-color:#eeeeee !important/.test(CSS),
  'it is not a button and has no "button" in its class, so nothing else claims it');
check('and the elapsed time keeps the brighter shade YouTube gives it',
  CSS.indexOf("#movie_player .ytp-time-current{color:#ffffff !important;-webkit-text-fill-color:#ffffff !important;}") >= 0,
  'same specificity as the rule above, so it has to come after it');
check('and it does come after it',
  CSS.indexOf('.ytp-time-current{color:#ffffff') > CSS.indexOf('.ytp-time-display *'));

/* The bar and the knob are the channel's colour -- yellow on the video this was
   first reported from, not red -- so nothing may paint them at all. */
check('nothing paints the swatch',
  !RULES.some((r) => r.selectors.some((s) => /ytp-swatch-background-color$/.test(s))),
  'the play progress and scrubber knob carry the channel colour');
check('and the button rule still steps round the scrubber knob',
  NOT_SWATCH === ':not(.ytp-swatch-background-color)'
    && CSS.indexOf('[class*="button" i]' + NOT_SWATCH) >= 0,
  'ytp-scrubber-button matches [class*="button"]');

/* Both callers still exist: the player is black in light mode too, so the light
   theme passes white rather than its own near-black text. */
check('the light theme still paints the player white',
  /youtubePlayerCSS\('#ffffff'\)/.test(source));
check('the dark theme still passes its text colour',
  /youtubePlayerCSS\(p\.text\)/.test(source));
check('the version records the change',
  /yt-native-player-controls/.test(source) && /yt-player-keeps-own-pills/.test(source));

if (failed) {
  console.error('eyeshield youtube player: ' + failed + ' failed');
  process.exit(1);
}
console.log('eyeshield youtube player: all checks passed');
