/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/*
 * Shared resolver for background.js's DNR resource-type lists.
 *
 * The lists used to be independent array literals, so a harness could pick one
 * up with a regex, or stub it by pasting a copy into a sandbox. Both habits went
 * stale silently: tools/test-streaming-compatibility.js carried its own copy of
 * a seven-entry list and went on asserting against it long after the shipped
 * list had changed, which is a test that passes by describing a program that no
 * longer exists.
 *
 * The lists now derive from one ALL_DNR_RESOURCE_TYPES inventory, so harnesses
 * ask here instead. `prelude()` returns the declarations as source, for sandboxes
 * that evaluate a slice of background.js and need the constants in scope;
 * `resolve()` returns the values, for assertions.
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const BACKGROUND_PATH = path.join(__dirname, '..', '..', 'background.js');

function declarations(source) {
  const src = source || fs.readFileSync(BACKGROUND_PATH, 'utf8');
  const re = /const\s+((?:[A-Z0-9_]+_)?RESOURCE_TYPES)\s*=/g;
  const out = [];
  let m;
  while ((m = re.exec(src))) {
    const end = src.indexOf(';', m.index);
    assert(end > m.index, 'unterminated resource-type declaration for ' + m[1]);
    out.push({ name: m[1], text: src.slice(m.index, end + 1) });
  }
  assert(out.length, 'no resource-type declarations found in background.js');
  return out;
}

/* Source text of every resource-type declaration, in the order background.js
 * declares them. Order matters: the derived lists reference the inventory, so
 * shuffling them would produce the same temporal-dead-zone error the real
 * service worker would hit. */
function prelude(source) {
  return declarations(source).map((d) => d.text).join('\n');
}

function resolveAll(source) {
  const decls = declarations(source);
  const sandbox = {};
  vm.runInNewContext(
    decls.map((d) => d.text).join('\n')
      + '\n__all = { ' + decls.map((d) => d.name + ': ' + d.name).join(', ') + ' };',
    sandbox
  );
  return sandbox.__all;
}

function resolve(name, source) {
  const all = resolveAll(source);
  assert(Object.prototype.hasOwnProperty.call(all, name), 'missing resource-type constant: ' + name);
  assert(Array.isArray(all[name]), name + ' did not resolve to an array');
  return all[name];
}

module.exports = { prelude, resolve, resolveAll, declarations };
