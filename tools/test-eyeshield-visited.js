/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/*
 * Which of these have you already read?
 * Run: node tools/test-eyeshield-visited.js
 *
 * EyeShield forces one colour onto every link so that a site's own palette
 * cannot leave unreadable text behind. A forced link colour takes :visited with
 * it -- the same declaration matches both states -- so a page of search results
 * came out uniformly unread. Light mode had a :visited rule from the start;
 * dark and ultra never did, which is exactly where it was reported.
 *
 * Two things have to hold, and they fail in different ways:
 *
 *   1. a :visited rule exists wherever a link colour is forced. Missing on
 *      Google specifically, because an #id selector outranks the generic rule.
 *   2. it re-states -webkit-text-fill-color. The fill paints OVER color, so a
 *      :visited rule that sets only color is overpainted by the fill from the
 *      rule above it and changes nothing on screen.
 *
 * Both were checked against a real Google results page with a genuinely visited
 * result before being written down here.
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const SOURCE = fs.readFileSync(path.join(ROOT, 'eyeshield.js'), 'utf8');

let pass = 0;
const failures = [];
function check(name, cond, detail) {
  if (cond) { pass++; return; }
  failures.push(name + (detail ? ' — ' + detail : ''));
}

function sliceBetween(startNeedle, endNeedle) {
  const start = SOURCE.indexOf(startNeedle);
  assert(start >= 0, 'missing ' + startNeedle);
  const end = SOURCE.indexOf(endNeedle, start + startNeedle.length);
  assert(end > start, 'missing ' + endNeedle + ' after ' + startNeedle);
  return SOURCE.slice(start, end);
}

/* The real palettes, lifted rather than restated. */
const paletteFor = vm.runInNewContext(
  '(function () {\n' + sliceBetween('  function paletteFor(mode)', '  function genericRepairCSS') + '\nreturn paletteFor;\n})()',
  Object.create(null),
  { filename: 'eyeshield.js:paletteFor' },
);

// --- colour maths ------------------------------------------------------------

function rgb(hex) {
  const h = String(hex).replace('#', '');
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
}
function luminance(hex) {
  const [r, g, b] = rgb(hex).map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a, b) {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
function hue(hex) {
  const [r, g, b] = rgb(hex).map((v) => v / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  if (!d) return 0;
  let h;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  h *= 60;
  return h < 0 ? h + 360 : h;
}
function hueGap(a, b) {
  const d = Math.abs(hue(a) - hue(b)) % 360;
  return d > 180 ? 360 - d : d;
}
/* Distance from grey, not from black. A pale tint and a strong colour can share
   a hue and only one of them looks like that hue on screen. */
function saturation(hex) {
  const [r, g, b] = rgb(hex).map((v) => v / 255);
  const max = Math.max(r, g, b);
  return max === 0 ? 0 : (max - Math.min(r, g, b)) / max;
}

// --- every mode names a visited colour ---------------------------------------

const MODES = ['light', 'dark', 'ultra'];
MODES.forEach((mode) => {
  const p = paletteFor(mode);
  check(mode + ' has a visited colour', !!p.visited, 'links keep one colour whether read or not');
  if (!p.visited) return;

  /* Same colour as an unread link is the bug wearing a different hat. */
  check(mode + ': visited differs from unvisited', p.visited !== p.link,
    'both ' + p.link);

  /* A shade apart is not enough -- these are read at a glance, in a column, at
     small sizes. Two blues one step apart is a distinction nobody makes while
     scanning. A different hue survives that; a different lightness does not. */
  check(mode + ': visited is a different hue, not a different shade',
    hueGap(p.visited, p.link) >= 30,
    'hue gap ' + hueGap(p.visited, p.link).toFixed(0) + 'deg between ' + p.link + ' and ' + p.visited);

  /* Hue distance alone passed a colour that was reported as unreadable. The
     first violet here sat 49deg off the blue and still read as "a lighter blue"
     next to it, because it was pale: a colour close to grey does not announce
     its hue at 20px on a dark background, whatever the hue is. Saturation is
     the thing that was actually missing, so it is the thing measured. */
  check(mode + ': visited is saturated enough to read as a colour',
    saturation(p.visited) >= 0.4,
    p.visited + ' is ' + (saturation(p.visited) * 100).toFixed(0) + '% saturated — pale enough to pass for a shade of the link colour');

  /* It still has to be readable. A visited link that has been dimmed into the
     background is a different way of losing the same information. */
  const c = contrast(p.visited, p.bg);
  check(mode + ': visited is readable on the page', c >= 4.5,
    p.visited + ' on ' + p.bg + ' is ' + c.toFixed(2) + ':1, want 4.5:1');
});

/* Ultra is the OLED mode and its background is true black, so its visited
   colour has further to travel than dark's. Named because a copy-paste of the
   dark palette into ultra is the likely way this regresses. */
const ultra = paletteFor('ultra');
check('ultra is readable against true black', contrast(ultra.visited, '#000000') >= 7,
  contrast(ultra.visited, '#000000').toFixed(2) + ':1');

// --- the rules are actually emitted ------------------------------------------

const generic = sliceBetween('function genericRepairCSS', 'function ');
check('the generic sheet forces a link colour at all',
  /a\[href\],\[role="link"\]\{color:/.test(generic),
  'if this is gone the rest of this file is checking nothing');
check('the generic sheet restores :visited',
  /a\[href\]:visited,\[role="link"\]:visited\{color:'\s*\+\s*p\.visited/.test(generic),
  'every site outside the special-cased ones loses the distinction');

/* The subtle half. -webkit-text-fill-color paints over color, so the fill set
   by the unvisited rule keeps painting unless the visited rule sets it too.
   A :visited rule with only color in it looks right in the source and does
   nothing on screen. */
const genericVisited = /a\[href\]:visited[\s\S]{0,400}?\}'/.exec(generic);
check('the generic :visited rule re-states the text fill',
  !!genericVisited && /-webkit-text-fill-color:currentColor/.test(genericVisited[0]),
  'the fill from the rule above would keep painting the unvisited colour');

const googleDark = sliceBetween('function googleDarkCSS', '\n  function ');
check('the Google dark sheet forces a link colour',
  /#search a,#rso a,#rhs a/.test(googleDark));
check('the Google dark sheet restores :visited',
  /#search a:visited,#rso a:visited,#rhs a:visited/.test(googleDark),
  'this is the reported case: dark and ultra on a results page');
/* A result title is an h3 inside the anchor. Style only the anchor and the
   title -- the part anyone actually looks at -- keeps the unvisited colour. */
check('the Google dark sheet covers what is inside the link too',
  /#search a:visited \*/.test(googleDark),
  'the anchor changes colour and the result title does not');
const gdVisited = /#search a:visited[\s\S]{0,500}?\}'/.exec(googleDark);
check('the Google dark :visited rule re-states the text fill',
  !!gdVisited && /-webkit-text-fill-color:currentColor/.test(gdVisited[0]));
check('the Google dark sheet takes its colour from the palette',
  !!gdVisited && /\+ visited \+/.test(googleDark),
  'a hardcoded purple would not follow dark vs ultra');

/* Light mode already had this. Kept as a check so that a later tidy-up which
   unifies the sheets cannot quietly drop the case that was working. */
const googleLight = sliceBetween('function googleLightCSS', '\n  function ');
check('the Google light sheet still restores :visited',
  /#search a:visited,#rso a:visited,#rhs a:visited/.test(googleLight));

// --- the result title needs naming, because Chrome ignores inheritance -------

/* The check this file was missing, and the reason it passed while the headline
   on every visited result stayed the wrong colour.
 *
 * Chrome will not apply an author colour to anything INSIDE a visited link. Set
 * the h3 green and an unvisited title goes green while a visited one does not --
 * it takes the browser's own visited colour, a pale lavender that on a dark page
 * reads as washed-out blue. So neither the plain title rule nor the generic
 * '#search a:visited *' reaches the title, however specific either one is.
 *
 * The only thing that does is a rule naming the title element with :visited on
 * the anchor. Every sheet that colours a result title therefore owes it a
 * partner, and the old check -- "is there a :visited rule somewhere" -- was
 * satisfied by a rule that Chrome discards. */
[['dark', googleDark], ['light', googleLight]].forEach(([name, sheet]) => {
  const colorsTitle = /(#search a h3|\.LC20lb|yuRUbf a h3)/.test(sheet);
  check('the Google ' + name + ' sheet still colours the result title',
    colorsTitle, 'if it stopped, the partner rule below is no longer needed');
  if (!colorsTitle) return;
  check('the Google ' + name + ' sheet names the title in a :visited rule too',
    /a:visited h3|a:visited \.LC20lb|h3 a:visited/.test(sheet),
    'the headline keeps the browser default while the site-name line changes — the reported bug');
  /* Order matters as much as presence: the partner has to come after the rule
     it is answering, or it loses to it at the same specificity. */
  const titleAt = Math.max(sheet.indexOf('#search a h3'), sheet.indexOf('.LC20lb,.DKV0Md'));
  const visitedTitleAt = sheet.search(/a:visited h3|a:visited \.LC20lb/);
  check('the Google ' + name + ' title :visited rule comes after the rule it answers',
    visitedTitleAt > titleAt, 'at ' + visitedTitleAt + ' vs ' + titleAt);
});

if (failures.length) {
  console.error('FAIL (' + failures.length + ')');
  failures.forEach((f) => console.error('  - ' + f));
  process.exit(1);
}
console.log('eyeshield visited: ' + pass + ' checks passed');
