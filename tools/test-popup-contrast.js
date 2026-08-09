/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
'use strict';

// The popup is the whole settings surface, and its status text is the highest-stakes
// text the extension shows: "Could not reach the breach database", "3 known
// breach(es)", "Not installed from the Web Store". Those all used to fail WCAG AA.
//
// A blunt "every colour must clear 4.5:1 on the card" check is wrong here, because
// several colours sit on their OWN background (a pink danger button, a tinted health
// chip) and a couple are icon glyphs rather than text, which WCAG 1.4.11 holds to
// 3:1 rather than 1.4.3's 4.5:1. So this file pairs each colour with the surface it
// is actually painted on.
//
// The important property is the last check: any NEW colour that reaches a `color:`
// declaration must either clear 4.5:1 on the darkest page surface or be listed in
// EXEMPT with a reason. A colour cannot quietly appear and fail.

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'popup.html'), 'utf8');
const js = fs.readFileSync(path.join(ROOT, 'popup.js'), 'utf8');

function lum(hex) {
  let h = String(hex).replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const v = [0, 2, 4].map((i) => parseInt(h.substr(i, 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)));
  return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
}
function ratio(a, b) {
  const la = lum(a), lb = lum(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
function rgb(hex) {
  let h = String(hex).replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  return [0, 2, 4].map((i) => parseInt(h.substr(i, 2), 16));
}
function over(fg, alpha, bg) {
  const f = rgb(fg), b = rgb(bg);
  return '#' + [0, 1, 2].map((i) => Math.round(f[i] * alpha + b[i] * (1 - alpha)).toString(16).padStart(2, '0')).join('');
}

// ---------------------------------------------------------------------------
// Surfaces. The page background is a hand-written gradient in body{}, not a token,
// and its darkest stop is the strictest surface real text can land on.
// ---------------------------------------------------------------------------
const BODY_DARKEST = '#e3cdf4';
const PAGE_SURFACES = ['#f4ebfb', '#ede1f8', '#ece0f7', '#e2d2f2', BODY_DARKEST, '#f2cee4', '#ffffff'];

const AA_TEXT = 4.5;
const AA_NON_TEXT = 3.0;   // WCAG 1.4.11, for icon glyphs and status dots

// A chip paints its text on its own translucent wash, not on the page. Read that
// wash out of the CSS rather than assuming it tracks the token it was derived from:
// the tints are written as rgba() decimals, so darkening a hex token does NOT change
// them, and hardcoding the composite here would silently test the wrong surface.
function chipSurfaces(selectorPart) {
  const css = html.slice(html.indexOf('<style>'), html.lastIndexOf('</style>'));
  const re = new RegExp(selectorPart.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[^{}]*\\{([^}]*)\\}');
  const m = re.exec(css);
  assert(m, 'popup.html no longer has a rule for ' + selectorPart);
  const bg = m[1].match(/background:\s*rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*([\d.]+)\s*\)/);
  assert(bg, selectorPart + ' no longer paints an rgba() background');
  const tint = '#' + [1, 2, 3].map((i) => Number(bg[i]).toString(16).padStart(2, '0')).join('');
  const alpha = Number(bg[4]);
  // Composited over the two card surfaces a health panel can sit on.
  return ['#f4ebfb', '#faf3fe'].map((base) => over(tint, alpha, base));
}

// Colours that do NOT sit on the page surfaces, or are not text. Each needs a
// reason and the surface it is genuinely painted on.
const EXEMPT = {
  '#b06fd6': { why: 'brand gradient / accent-color / slider thumb; white text sits on it, it is never text', skip: true },
  '#d76a9a': { why: 'gradient partner for the danger icon, never text', skip: true },
  '#c0392b': { why: 'survives ONLY as the other half of the danger-icon gradient, never as text', skip: true },
  '#e0cef2': { why: 'border colour in an inline cssText, not text', skip: true },
  '#fff':    { why: 'white text, used on the dark/brand surfaces', skip: true },
  '#ffffff': { why: 'white text, used on the dark/brand surfaces', skip: true },
  // Text painted on its own background rather than the page.
  '#953a69': { why: '.btn.soft-danger text on its own pink button', surfaces: ['#f1d5e8', '#edc8df'], min: AA_TEXT },
  '#905927': { why: '.health-panel.is-warning .health-chip text on its own rgba wash', surfaces: chipSurfaces('.health-panel.is-warning .health-chip'), min: AA_TEXT },
  '#b2352a': { why: '.health-panel.is-danger .health-chip text on its own rgba wash', surfaces: chipSurfaces('.health-panel.is-danger .health-chip'), min: AA_TEXT },
  // Non-text, held to 1.4.11's 3:1.
  '#8c6ba4': { why: 'search icon glyph, non-text UI', surfaces: PAGE_SURFACES, min: AA_NON_TEXT },
  '#81522c': { why: '--warn: the warning status dot, non-text UI (also kept text-safe)', surfaces: PAGE_SURFACES, min: AA_NON_TEXT },
};

let failures = 0;
function check(name, cond, detail) {
  if (cond) { console.log('  [ok] ' + name); return; }
  failures++;
  console.error('  [FAIL] ' + name + (detail ? '  -> ' + detail : ''));
}
function worstOn(hex, surfaces) {
  return Math.min.apply(null, surfaces.map((s) => ratio(hex, s)));
}

// ---------------------------------------------------------------------------
// 1. The palette tokens that carry text.
// ---------------------------------------------------------------------------
const rootBlock = html.match(/:root\s*\{([^}]*)\}/);
assert(rootBlock, 'popup.html no longer has a :root block');
const vars = {};
rootBlock[1].split(';').forEach((d) => {
  const m = d.match(/(--[\w-]+)\s*:\s*(#[0-9a-fA-F]{3,8})\s*$/);
  if (m) vars[m[1]] = m[2].toLowerCase();
});

const TEXT_TOKENS = ['--ink', '--ink-soft', '--ink-faint', '--rose', '--rose-deep', '--plum'];
for (const tok of TEXT_TOKENS) {
  assert(vars[tok], 'popup.html no longer defines ' + tok);
  const worst = worstOn(vars[tok], PAGE_SURFACES);
  check(tok + ' (' + vars[tok] + ') clears AA on every page surface',
    worst >= AA_TEXT, worst.toFixed(2) + ':1');
}

// The token names promise a hierarchy. A flat 4.5 target for both --ink-soft and
// --ink-faint inverts it, which is a design regression rather than a fix.
check('ink hierarchy holds: --ink darker than --ink-soft darker than --ink-faint',
  lum(vars['--ink']) < lum(vars['--ink-soft']) && lum(vars['--ink-soft']) < lum(vars['--ink-faint']),
  vars['--ink'] + ' / ' + vars['--ink-soft'] + ' / ' + vars['--ink-faint']);

// ---------------------------------------------------------------------------
// 2. The status dot tokens, held to 1.4.11.
// ---------------------------------------------------------------------------
for (const tok of ['--warn', '--rose-deep']) {
  const worst = worstOn(vars[tok], PAGE_SURFACES);
  check(tok + ' status dot clears 3:1 for non-text UI', worst >= AA_NON_TEXT, worst.toFixed(2) + ':1');
}

// ---------------------------------------------------------------------------
// 3. Every colour that reaches a text declaration, from both files.
// ---------------------------------------------------------------------------
const textColours = new Set();
for (const src of [html, js]) {
  const patterns = [
    /color\s*:\s*['"`]?(#[0-9a-fA-F]{3,6})/g,
    /color\s*=\s*['"`](#[0-9a-fA-F]{3,6})/g,
    /var\(--[\w-]+\s*,\s*(#[0-9a-fA-F]{3,6})\)/g,
    /makeLine\([^,]+,\s*'(#[0-9a-fA-F]{3,6})'/g,
    /mkTag\([^,]+,[^,]+,\s*'(#[0-9a-fA-F]{3,6})'/g,
    /(?:riskColor|sev|level|riskCol)\s*=\s*[^;]*?'(#[0-9a-fA-F]{6})'/g,
    /\b[A-F]:\s*'(#[0-9a-fA-F]{6})'/g,
    /stroke'?\s*:\s*'(#[0-9a-fA-F]{3,6})'/g,
  ];
  for (const re of patterns) {
    let m;
    while ((m = re.exec(src))) textColours.add(m[1].toLowerCase());
  }
}
check('found a plausible number of text colours to audit', textColours.size >= 15, 'found ' + textColours.size);

const unlisted = [];
for (const hex of textColours) {
  const ex = EXEMPT[hex];
  if (ex && ex.skip) continue;
  const surfaces = (ex && ex.surfaces) || PAGE_SURFACES;
  const min = (ex && ex.min) || AA_TEXT;
  const worst = worstOn(hex, surfaces);
  if (worst < min) unlisted.push(hex + ' worst ' + worst.toFixed(2) + ' needs ' + min + (ex ? ' (exempt: ' + ex.why + ')' : ''));
}
check('every text colour clears its threshold on the surface it is painted on',
  unlisted.length === 0, unlisted.join(' | '));

// ---------------------------------------------------------------------------
// 4. Guard against the old values coming back.
// ---------------------------------------------------------------------------
const RETIRED = {
  '#8b3fb0': '--plum',
  '#a98fc0': '--ink-faint', '#7a5f93': '--ink-soft', '#d65f9a': '--rose',
  '#c84f8b': '--rose-deep', '#d98b4a': '--warn', '#2e9e5b': 'success text',
  '#bd7a2a': 'warning text', '#8b6fb0': 'muted text', '#5aa84a': 'grade B',
  '#d06a2a': 'grade D', '#b94882': 'soft-danger text', '#a7672d': 'warn chip text',
  '#9b76b5': 'search icon', '#7a6b8a': 'no-sign-in label', '#7a4fb0': 'link text',
};
const back = [];
for (const [hex, what] of Object.entries(RETIRED)) {
  // #c0392b legitimately survives inside the danger-icon gradient; the rest must be gone.
  if (html.toLowerCase().includes(hex) || js.toLowerCase().includes(hex)) back.push(hex + ' (' + what + ')');
}
check('no retired low-contrast value has returned', back.length === 0, back.join(', '));

// The danger-icon gradient must survive: it is the one #c0392b that is not text.
check('the danger-icon gradient is left intact',
  /linear-gradient\(135deg,\s*#d76a9a,\s*#c0392b\)/.test(html));

if (failures) {
  console.error('[fail] popup contrast tests: ' + failures + ' failure(s)');
  process.exit(1);
}
console.log('[ok] popup contrast tests (' + textColours.size + ' text colours audited)');
