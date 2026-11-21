/* WardenOne — Copyright (C) 2026 iri; GPL-3.0-or-later. See LICENSE. */
'use strict';
/* The content build strips block comments (2026-11-20). Every comment it removes must really be a comment: a
   removal inside a string, regex or template would change the page code while still parsing. */
const assert = require('assert/strict');
const fs = require('fs');
const vm = require('vm');
const { buildFromSource, stripBlockComments, KEPT_COMMENT_RE } = require('./build-content.js');

let checks = 0;
const ok = (cond, label) => { assert(cond, label); checks++; };
const strip = (code) => stripBlockComments(code).replace(/\r?\n[ \t]*/g, '');

/* 1. Text that only looks like a comment stays. */
for (const [code, literal] of [
  ["const a = '/* not a comment */';", "'/* not a comment */'"],
  ['const b = "x /* y */ z";', '"x /* y */ z"'],
  ['const c = `/* in a template */`;', '`/* in a template */`'],
  ['const d = /\\/\\*[^*]*\\*\\//.test(s);', '/\\/\\*[^*]*\\*\\//'],
  ['const e = /[/*]+/g;', '/[/*]+/g'],
  /* A / and a quote inside a class: ending the regex there would turn the next string's text into code. */
  ['const g = /[/"]/.test(s), h = "/* keep */";', '"/* keep */"'],
  ['if (x) return /* gone */ /\\/*x/.test(y);', '/\\/*x/'],
]) {
  const out = strip(code);
  ok(out.includes(literal) && !out.includes('gone'), 'a literal holding /* survives: ' + code + ' -> ' + out);
  assert.doesNotThrow(() => new vm.Script('(function(){' + out + '})'), 'parses: ' + out); checks++;
}

/* 2. Comments go, and nothing fuses where one stood. */
const pairs = [
  ['return\n  /* why */\n  value;', 'return value;'],
  ['const a/* x */= 1;', 'const a = 1;'],
  ['x = a/**/b;', 'x = a b;'],
  ['y = p +/* c */+ q;', 'y = p + + q;'],
  ['f(a, /* c */ b);', 'f(a,  b);'],
  ['if (ok) {\n  /* only a note */\n  go();\n}', 'if (ok) {go();}'],
  ['z = 1; /* trailing */\nw = 2;', 'z = 1; w = 2;'],
];
for (const [code, want] of pairs) ok(strip(code) === want, JSON.stringify(code) + ' -> ' + JSON.stringify(strip(code)) + ', wanted ' + JSON.stringify(want));
ok(strip('let q = 1;/* multi\n   line\n   note */let r = 2;') === 'let q = 1;let r = 2;', 'a comment over several lines goes whole');

/* 3. The licence header, region markers and directives stay. */
for (const kept of ['/* WardenOne — Copyright (C) 2026 iri */', '/* AUTH-BEGIN shared code */', '/* AUTH-END */', '/* @wardenone-include AUTH */'])
  ok(KEPT_COMMENT_RE.test(kept) && strip(kept + 'x();').startsWith(kept), 'kept: ' + kept);
ok(!KEPT_COMMENT_RE.test('/* A note that mentions AUTH-BEGIN later */'), 'a note naming a marker later is still removed');

/* 4. The real engine: each removed span is a comment to V8 itself. A span really inside a string or regex would turn
   invalid with a raw line break in it; one inside a template would be closed early by a backtick. */
const source = fs.readFileSync('src/content.js', 'utf8');
const removed = [];
stripBlockComments(source, removed);
ok(removed.length > 300, 'the engine sheds its comments (' + removed.length + ')');
let probe = '', last = 0;
for (const [a, b] of removed) { probe += source.slice(last, a) + '/*\n`\'"*/'; last = b; }
probe += source.slice(last);
try { new vm.Script(probe, { filename: 'probe.js' }); ok(true, 'every removed span is a comment to V8'); }
catch (e) { assert.fail('a removed span was not a comment: ' + e.message); }

/* 5. The shipped runtime is that build, parses, and keeps its markers and licence. */
const runtime = fs.readFileSync('content.min.js', 'utf8');
ok(buildFromSource(source) === runtime, 'content.min.js is the stripped build of src/content.js');
ok(new vm.Script(runtime, { filename: 'content.min.js' }) instanceof vm.Script, 'the runtime parses');
ok(/^\/\* WardenOne — Copyright/.test(runtime), 'the licence header ships');
for (const name of ['AUTH', 'WEBGL-SAVER', 'CLIENT-HINTS', 'FINGERPRINT-NOISE'])
  ok(runtime.includes('/* ' + name + '-BEGIN') && runtime.includes('/* ' + name + '-END */'), 'region markers ship: ' + name);
ok((runtime.match(/\/\*/g) || []).length < 20, 'ordinary comments are gone from the runtime');

console.log('[ok] content build comment stripping: ' + checks + ' checks');
