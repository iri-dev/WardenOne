/* Every fresh install opens onboarding, and it stays open until the reader closes it. Its orbs,
   welcome ring and pulse used to animate forever, and while anything moves the browser draws a
   frame on every refresh: 61-66% of a core in Edge's GPU process and renderer for as long as the
   tab was visible (Edge 150, 2026-10-17), 41% for the small pulse ring alone. The blurred orbs
   were the dearest part, because filter: blur() on a moving layer is redone every frame.
   These checks keep the motion bounded, keep the orbs' blur painted into their images, and keep
   reduced motion able to stop all of it. */
'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'onboarding.html'), 'utf8');
const styleMatch = /<style>([\s\S]*?)<\/style>/.exec(html);
assert(styleMatch, 'onboarding keeps its page styles inline');
const css = styleMatch[1].replace(/\/\*[\s\S]*?\*\//g, '');

/* Every rule as { selectors, body, media }, @keyframes skipped, one level of @media deep. */
function rules(source) {
  const out = [];
  const blockEnd = (open) => {
    let depth = 1, j = open + 1;
    while (depth && j < source.length) { if (source[j] === '{') depth++; else if (source[j] === '}') depth--; j++; }
    return j;
  };
  const walk = (from, to, media) => {
    let i = from;
    while (i < to) {
      const open = source.indexOf('{', i);
      if (open < 0 || open >= to) return;
      const head = source.slice(i, open).trim();
      if (/^@media/.test(head)) {
        const end = blockEnd(open);
        walk(open + 1, end - 1, head);
        i = end;
      } else if (/^@keyframes/.test(head)) {
        i = blockEnd(open);
      } else {
        const close = source.indexOf('}', open);
        out.push({ selectors: head.split(',').map((s) => s.trim()).filter(Boolean), body: source.slice(open + 1, close), media });
        i = close + 1;
      }
    }
  };
  walk(0, source.length, '');
  return out;
}
const decl = (body, prop) => {
  const m = new RegExp('(?:^|;)\\s*' + prop + '\\s*:\\s*([^;]+)').exec(body);
  return m ? m[1].trim() : null;
};
const seconds = (token) => (/ms$/.test(token) ? parseFloat(token) / 1000 : parseFloat(token));

const all = rules(css);
const screen = all.filter((r) => !/prefers-reduced-motion/.test(r.media));
const animated = screen.filter((r) => decl(r.body, 'animation'));
const byName = (name) => animated.find((r) => (decl(r.body, 'animation') || '').split(/\s+/)[0] === name);
for (const name of ['drift', 'spin', 'pulse']) assert(byName(name), 'the welcome motion is still there: ' + name);

/* 1. Nothing loops forever, and the decorative motion settles within about a minute. */
for (const r of animated) {
  const value = decl(r.body, 'animation');
  assert(!/\binfinite\b/.test(value), r.selectors.join(', ') + ' animates forever (' + value + '); the page then draws every frame for as long as it is open');
  const parts = value.split(/\s+/);
  const times = parts.filter((p) => /^-?[\d.]+m?s$/.test(p)).map(seconds);
  const count = Number(parts.find((p) => /^\d+(\.\d+)?$/.test(p)) || 1);
  const ends = (times[0] || 0) * count + (times[1] || 0);
  assert(ends <= 60, r.selectors.join(', ') + ' is still moving ' + ends + 's after the page opens');
}
assert(!screen.some((r) => /\binfinite\b/.test(decl(r.body, 'animation-iteration-count') || '')), 'no animation-iteration-count: infinite');

/* 2. The orbs are the largest moving layers; their softness is painted, never filtered. */
const orbRules = screen.filter((r) => r.selectors.some((s) => /^\.orb\b/.test(s)));
assert(orbRules.length >= 4, 'the orb rules are still there');
for (const r of orbRules) {
  for (const prop of ['filter', 'backdrop-filter', '-webkit-backdrop-filter']) {
    const value = decl(r.body, prop);
    assert(!value || value === 'none', r.selectors.join(', ') + ' sets ' + prop + ': ' + value + '; on a moving layer it is redone every frame');
  }
}
for (const orb of ['.orb.a', '.orb.b', '.orb.c']) {
  const r = orbRules.find((x) => x.selectors.includes(orb));
  const image = r && decl(r.body, 'background-image');
  assert(image && /feGaussianBlur stdDeviation='8'/.test(image), orb + ' paints the same 8px softness into its image');
}

/* 3. Reduced motion still stops every one of them. */
const reduced = all.filter((r) => /prefers-reduced-motion:\s*reduce/.test(r.media) && /^none\b/.test(decl(r.body, 'animation') || ''));
for (const selector of ['.orb', '.mark .ring', '.mark .pulse']) {
  assert(reduced.some((r) => r.selectors.includes(selector)), selector + ' moves, but reduced motion does not stop it');
}

console.log('[ok] onboarding motion: ' + animated.length + ' animated rules, none forever, orbs unfiltered, reduced motion stops them');
