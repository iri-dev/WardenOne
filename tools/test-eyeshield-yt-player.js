/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/*
 * YouTube's player chrome must survive EyeShield.
 *
 * The player is black in every mode -- YouTube builds its controls for a black
 * surface and EyeShield forces one -- so nothing down there follows the page
 * theme. What went wrong is that only buttons and icons were ever claimed: the
 * clock, the seek bar and the volume slider are plain divs with no "button" in
 * their class, so the page remap painted them like ordinary furniture.
 *
 * Measured in Chrome against the shipped rules, with the remap standing in as a
 * flat repaint of everything unclaimed:
 *
 *   before, dark   every seek-bar part -> rgb(15,15,15) on a black player
 *   before, light  the clock -> rgb(15,15,15), contrast 1.10 against the player
 *   after,  both   every part matches the value measured on youtube.com --
 *                  the clock included, at #eee for the duration and #fff for
 *                  the elapsed time, which is the shade difference YouTube
 *                  itself draws (18.10 and 21.00 against the black player)
 *
 * The expected values below are YouTube's own, read off a live watch page, not
 * numbers chosen here.
 *
 * The stylesheet is only half of it. The readability guard writes INLINE
 * !important paint, which no stylesheet can outrank, and its background walk
 * gives up after 8 ancestors. Measured on a live watch page: the clock sits
 * exactly 8 levels under the player's black -- the last level that fits. Add one
 * wrapper (chapters, a live badge, a hover tooltip) and the walk returns null,
 * the guard assumes the PAGE background, scores white-on-white at 1.00 and
 * repaints the clock rgb(18,19,24). That is the clock going white and then black
 * a moment later, and in light mode every time. The guard now skips player
 * chrome entirely; measured with a chain one level too deep, before and after:
 *
 *   without the skip   .ytp-time-current -> rgb(18, 19, 24), inline !important
 *   with the skip      .ytp-time-current -> rgb(255, 255, 255), no inline paint
 *
 * Run: node tools/test-eyeshield-yt-player.js
 */
'use strict';

const fs = require('fs');
const vm = require('vm');

const source = fs.readFileSync('eyeshield.js', 'utf8');
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

/* The shell carries the colour, so anything no rule claims still inherits white
   rather than the page's text colour -- which in light mode is near-black. */
check('the player shell sets its own text colour',
  /#player,#player-container,#movie_player,\.html5-video-player\{background-color:#000000 !important;color:#ffffff !important;\}/.test(CSS),
  'without it, uncovered controls inherit near-black text onto a black player');

/* YouTube's own paint, measured on a live watch page. */
const NATIVE = [
  ['.ytp-progress-list', 'rgba(40,40,40,.6)'],
  ['.ytp-load-progress', 'rgba(255,255,255,.4)'],
  ['.ytp-hover-progress', 'rgba(0,0,0,.125)'],
  ['.ytp-volume-slider-handle', '#ffffff'],
];
NATIVE.forEach(([sel, value]) => {
  check('the seek bar keeps YouTube\'s own ' + sel,
    CSS.indexOf('#movie_player ' + sel + '{background-color:' + value + ' !important;}') >= 0,
    'the remap painted it flat, so it went black on a black player');
});

/* The parts that are transparent on YouTube must stay transparent, or the remap
   draws a block where there was nothing. */
['.ytp-chrome-controls', '.ytp-left-controls', '.ytp-right-controls', '.ytp-progress-bar-container',
  '.ytp-progress-bar', '.ytp-scrubber-container', '.ytp-volume-slider', '.ytp-volume-panel',
].forEach((sel) => {
  check(sel + ' is held transparent', CSS.indexOf('#movie_player ' + sel + ',') >= 0
    || CSS.indexOf('#movie_player ' + sel + '{') >= 0);
});

/* Naming the parts one at a time leaves whatever was not named to the remap,
   which paints it like a card -- the pale box behind the controls. Verified in
   Chrome with a wrapper this file invented: without the net it is painted, with
   it it comes out clear, and all six genuinely painted parts keep their values. */
const NET = '#movie_player .ytp-chrome-bottom :where(div,span)';
check('every unnamed wrapper in the bottom chrome is cleared', CSS.indexOf(NET) >= 0,
  'a wrapper nobody named is the one that shows up as a box');
const netAt = CSS.indexOf(NET);
const netSelector = netAt < 0 ? '' : CSS.slice(netAt, CSS.indexOf('{', netAt));
['.ytp-swatch-background-color', '.ytp-progress-list', '.ytp-load-progress',
  '.ytp-hover-progress', '.ytp-volume-slider-handle'].forEach((sel) => {
  check('the net spares ' + sel, netSelector.indexOf(':not(' + sel + ')') >= 0,
    'a :not() carries its argument specificity, so the net outranks the rule painting this');
});

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

/* YouTube's faint pill behind the clock, which the net was flattening. */
check('the clock keeps the dark pill YouTube puts behind it',
  CSS.indexOf('#movie_player .ytp-time-wrapper{background-color:rgba(0,0,0,.3) !important;}') >= 0);
check('and the net spares it', netSelector.indexOf(':not(.ytp-time-wrapper)') >= 0);

/* The clock is the thing that was reported. It gets YouTube's own white, not a
   whiter one of our own: #eee across the display, #fff on the elapsed time. */
check('the clock is painted the white YouTube itself uses',
  /#movie_player \.ytp-time-display,#movie_player \.ytp-time-display \*/.test(CSS)
    && /color:#eeeeee !important;-webkit-text-fill-color:#eeeeee !important/.test(CSS),
  'it is not a button and has no "button" in its class, so nothing else claims it');
check('and the elapsed time keeps the brighter shade YouTube gives it',
  CSS.indexOf("#movie_player .ytp-time-current{color:#ffffff !important;-webkit-text-fill-color:#ffffff !important;}") >= 0,
  'same specificity as the rule above, so it has to come after it');
check('and it does come after it',
  CSS.indexOf('.ytp-time-current{color:#ffffff') > CSS.indexOf('.ytp-time-display *'));
check('and its children are named too, not just the wrapper',
  CSS.indexOf('.ytp-time-display *') >= 0,
  'the current time and duration are separate spans inside it');

/* The bar and the knob are the channel's colour -- yellow on the video this was
   reported from, not red -- so nothing may assign them one. */
check('nothing assigns the swatch a background',
  !/\.ytp-swatch-background-color\{[^}]*background-color:(?!transparent)/.test(CSS),
  'the play progress and scrubber knob carry the channel colour');
check('and the button rule no longer erases the scrubber knob',
  NOT_SWATCH === ':not(.ytp-swatch-background-color)'
    && CSS.indexOf('[class*="button" i]' + NOT_SWATCH) >= 0,
  'ytp-scrubber-button matched [class*="button"] and was forced transparent');

/* Both callers still exist: the player is black in light mode too, so the light
   theme passes white rather than its own near-black text. */
check('the light theme still paints the player white',
  /youtubePlayerCSS\('#ffffff'\)/.test(source));
check('the dark theme still passes its text colour',
  /youtubePlayerCSS\(p\.text\)/.test(source));
check('the version records the change',
  /yt-native-player-controls/.test(source));

if (failed) {
  console.error('eyeshield youtube player: ' + failed + ' failed');
  process.exit(1);
}
console.log('eyeshield youtube player: all checks passed');
