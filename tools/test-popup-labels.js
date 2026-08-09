/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
'use strict';

// Every toggle in the popup is an <input type="checkbox"> inside a <label class="tg">
// that contains only the track and knob spans. A label takes its accessible name from
// its own text content, so all 115 had none: a screen reader announced "checkbox, not
// checked" with nothing to say what it controlled, across the entire settings surface.
//
// popup.js fixes that at runtime by walking each label's PRECEDING siblings for the
// .name (or .lbl) that carries the visible text and pointing aria-labelledby at it. That
// only works while the markup keeps putting a name there, so this file checks the
// precondition: for every toggle, a name must be reachable the same way the runtime walk
// reaches it. If someone adds a toggle with no name, or moves the name after the label,
// the build fails instead of the control silently going unlabelled.
//
// The runtime behaviour itself was verified in a browser: 115 of 115 toggles resolve to
// a name, 110 also carry a description, and no id collides.

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'popup.html'), 'utf8');
const js = fs.readFileSync(path.join(ROOT, 'popup.js'), 'utf8');

const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);

// Minimal element tree. Enough for "walk previous siblings and look inside them",
// which is the only relationship the runtime function depends on.
function parse(src) {
  const body = src.replace(/<!--[\s\S]*?-->/g, '').replace(/<(script|style)[\s\S]*?<\/\1>/gi, '');
  const root = { tag: '#root', cls: [], attrs: '', children: [], parent: null, text: '' };
  let node = root;
  const re = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)([^>]*?)(\/?)>|([^<]+)/g;
  let m;
  while ((m = re.exec(body))) {
    if (m[5] !== undefined) { node.text += m[5]; continue; }
    const closing = m[1] === '/';
    const tag = m[2].toLowerCase();
    const attrs = m[3] || '';
    const selfClose = m[4] === '/' || VOID.has(tag);
    if (closing) { if (node.parent && node.tag === tag) node = node.parent; continue; }
    const clsMatch = /class="([^"]*)"/.exec(attrs);
    const el = {
      tag,
      cls: clsMatch ? clsMatch[1].trim().split(/\s+/) : [],
      attrs,
      children: [],
      parent: node,
      text: '',
    };
    node.children.push(el);
    if (!selfClose) node = el;
  }
  return root;
}

function walk(node, fn) {
  fn(node);
  node.children.forEach((c) => walk(c, fn));
}
function textOf(node) {
  let out = node.text || '';
  node.children.forEach((c) => { out += textOf(c); });
  return out;
}
function findWithin(node, pred) {
  let hit = null;
  walk(node, (n) => { if (!hit && n !== node && pred(n)) hit = n; });
  return hit;
}

const tree = parse(html);
const toggles = [];
walk(tree, (n) => {
  if (n.tag === 'label' && n.cls.includes('tg')) toggles.push(n);
});

let failures = 0;
function check(name, cond, detail) {
  if (cond) { console.log('  [ok] ' + name); return; }
  failures++;
  console.error('  [FAIL] ' + name + (detail ? '  -> ' + detail : ''));
}

check('found the toggle labels in popup.html', toggles.length >= 100, toggles.length + ' found');

// Mirror the runtime walk: previous siblings only, the element itself or something inside it.
const isName = (n) => n.cls.includes('name') || n.cls.includes('lbl');
const unnamed = [];
const noKey = [];
let withDesc = 0;
for (const label of toggles) {
  const siblings = label.parent ? label.parent.children : [];
  const at = siblings.indexOf(label);
  let nameEl = null;
  let descEl = null;
  for (let i = at - 1; i >= 0 && !nameEl; i--) {
    const sib = siblings[i];
    if (isName(sib)) { nameEl = sib; break; }
    nameEl = findWithin(sib, isName);
    if (nameEl) descEl = findWithin(sib, (n) => n.cls.includes('desc'));
  }
  const input = findWithin(label, (n) => n.tag === 'input' && /type="checkbox"/.test(n.attrs));
  const key = input ? (/\bid="([^"]+)"/.exec(input.attrs) || /data-key="([^"]+)"/.exec(input.attrs) || [])[1] : null;
  if (!input) { unnamed.push('(label with no checkbox)'); continue; }
  if (!key) noKey.push(textOf(label).trim().slice(0, 30) || '(unnamed control)');
  if (!nameEl || !textOf(nameEl).trim()) unnamed.push(key || '(no id/data-key)');
  if (descEl && textOf(descEl).trim()) withDesc++;
}

check('every toggle has a visible name reachable from its preceding siblings',
  unnamed.length === 0, 'without one: ' + unnamed.join(', '));
check('every toggle input carries an id or data-key to build its label id from',
  noKey.length === 0, 'without one: ' + noKey.join(', '));
check('most toggles also have a description to expose', withDesc >= toggles.length * 0.8,
  withDesc + ' of ' + toggles.length);

// The labels the runtime pass generates must not collide with ids already in the markup.
const existingIds = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
const collisions = [...existingIds].filter((id) => /^wo-(lbl|desc)-/.test(id));
check('no markup id already uses the generated wo-lbl-/wo-desc- prefix',
  collisions.length === 0, collisions.join(', '));

// Wiring: the pass must exist, run before anything that can throw, and not be
// accidentally reordered behind start-up work.
check('popup.js defines the labelling pass', /^function labelToggleControls\(\)/m.test(js));
check('it points aria-labelledby at the name element', /setAttribute\('aria-labelledby'/.test(js));
check('it exposes the description too', /setAttribute\('aria-describedby'/.test(js));
check('it searches only previous siblings, so a name cannot come from a neighbouring row',
  /previousElementSibling/.test(js) && !/nextElementSibling[\s\S]{0,200}aria-labelledby/.test(js));
// Deliberately not pinned to a variable name. The first version of this assertion
// matched `input.getAttribute('aria-label')` literally and broke the moment the pass was
// generalised and the parameter became `control` -- a passing rename reading as a
// regression. Match the intent: check both attributes before writing either.
check('it never overwrites an existing label',
  /getAttribute\('aria-labelledby'\)\s*\|\|\s*[A-Za-z_$][\w$]*\.getAttribute\('aria-label'\)/.test(js));
check('it labels the other row controls too, not just the toggles',
  /\.row input, \.row select/.test(js));
const callAt = js.indexOf('labelToggleControls();');
const firstChrome = js.indexOf('chrome.');
check('the pass runs before the first chrome.* use, so a start-up throw cannot cost the labels',
  callAt > 0 && callAt < firstChrome, 'call at ' + callAt + ', first chrome. at ' + firstChrome);

if (failures) {
  console.error('[fail] popup label tests: ' + failures + ' failure(s)');
  process.exit(1);
}
console.log('[ok] popup label tests (' + toggles.length + ' toggles, ' + withDesc + ' with descriptions)');
