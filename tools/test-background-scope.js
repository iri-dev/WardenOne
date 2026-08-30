/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/*
 * Helpers the whole worker uses have to live where the whole worker can see them.
 * Run: node tools/test-background-scope.js
 *
 * background.js ends in one very long chrome.runtime.onMessage listener. A helper
 * written just above the handler that uses it lands INSIDE that listener, and in
 * strict mode a function declaration in a block is scoped to the block. The
 * handler still works, so it reads as correct. Everything else silently does not:
 *
 *   - navigation listeners calling it throw "X is not defined" at runtime, in a
 *     callback, where nothing in the build can see the failure
 *   - every const beside it is rebuilt on EVERY message, so anything meant to be
 *     remembered between messages is always empty
 *
 * That is what happened to the service-worker and consent-cookie helpers: 378
 * lines of module-level code sat inside the listener, so noteServiceWorkerRegistration
 * and maybeClearOnLeave threw on every navigation while their handlers worked fine.
 *
 * This finds the listener, lists what is declared directly in its body, and fails
 * if any of it is used from outside. It says nothing about handler locals -- those
 * are deeper, and are meant to be local.
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const RAW = fs.readFileSync(path.join(ROOT, 'background.js'), 'utf8');

let pass = 0;
const failures = [];
function check(name, cond, detail) {
  if (cond) { pass++; return; }
  failures.push(name + (detail ? ' — ' + detail : ''));
}

/* Blank out comments, strings, templates and regex literals, keeping every
   offset, so a later search sees code and only code. Depth is tracked in the
   same pass because both need the same "is this real syntax" decision. */
function scan(src) {
  const out = new Array(src.length).fill(' ');
  const depth = new Array(src.length).fill(0);
  let d = 0;
  let i = 0;
  let prev = '';
  const N = src.length;
  const keep = (j) => { out[j] = src[j]; };
  while (i < N) {
    const c = src[i];
    depth[i] = d;
    if (c === '\n') { keep(i); i++; continue; }
    if (c === '/' && src[i + 1] === '/') {
      while (i < N && src[i] !== '\n') { depth[i] = d; i++; }
      continue;
    }
    if (c === '/' && src[i + 1] === '*') {
      while (i < N && !(src[i] === '*' && src[i + 1] === '/')) { depth[i] = d; if (src[i] === '\n') out[i] = '\n'; i++; }
      i += 2;
      continue;
    }
    if (c === '"' || c === "'") {
      const q = c;
      i++;
      while (i < N) {
        depth[i] = d;
        if (src[i] === '\\') { i += 2; continue; }
        if (src[i] === q) { i++; break; }
        if (src[i] === '\n') out[i] = '\n';
        i++;
      }
      prev = 'x';
      continue;
    }
    if (c === '`') {
      i++;
      while (i < N) {
        depth[i] = d;
        if (src[i] === '\\') { i += 2; continue; }
        if (src[i] === '`') { i++; break; }
        if (src[i] === '\n') out[i] = '\n';
        i++;
      }
      prev = 'x';
      continue;
    }
    if (c === '/' && /[=(,:[!&|?{};+\-*%~^]/.test(prev)) {
      let j = i + 1;
      let ok = false;
      let inClass = false;
      while (j < N) {
        if (src[j] === '\\') { j += 2; continue; }
        if (src[j] === '\n') break;
        if (src[j] === '[') inClass = true;
        else if (src[j] === ']') inClass = false;
        else if (src[j] === '/' && !inClass) { ok = true; break; }
        j++;
      }
      if (ok) {
        while (i <= j) { depth[i] = d; i++; }
        while (i < N && /[a-z]/.test(src[i])) { depth[i] = d; i++; }
        prev = 'x';
        continue;
      }
    }
    if (c === '{') { d++; }
    else if (c === '}') { d--; }
    depth[i] = c === '{' ? d - 1 : d;
    keep(i);
    if (!/\s/.test(c)) prev = c;
    i++;
  }
  return { code: out.join(''), depth };
}

const { code, depth } = scan(RAW);
check('the worker source parses into code and depth', code.length === RAW.length);

/* Names the worker gets from importScripts are globals, so a same-named const
   inside a listener is an ordinary local shadow rather than a helper that
   escaped. Without this the check reports registrableDomain -- which really does
   come from domain-utils.js -- and a false alarm in a test like this one is
   worse than no test, because the next real one gets waved through. */
const IMPORTED = new Set();
const IMP = /importScripts\(\s*['"]([^'"]+)['"]\s*\)/g;
let imp;
while ((imp = IMP.exec(RAW))) {
  let text = '';
  try { text = fs.readFileSync(path.join(ROOT, imp[1]), 'utf8'); } catch (_) { continue; }
  const D = /(?:^|\n)(?:async\s+)?(?:function|const|let|var|class)\s+([A-Za-z_$][A-Za-z0-9_$]*)/g;
  let d;
  while ((d = D.exec(text))) IMPORTED.add(d[1]);
}
check('the imported scripts were readable', IMPORTED.size > 0,
  'nothing was resolved, so every global would look like an escape');

/* ---- find every listener callback, not just the first ----
   There are two onMessage listeners in this file, and the helpers went astray in
   the second one. A check that looked only at the first would have passed while
   the worker was throwing on every navigation, which is the failure it exists to
   catch. The same reasoning applies to any addListener callback, so all of them
   are checked. */
function listenerBlocks() {
  const blocks = [];
  let from = 0;
  for (;;) {
    const call = code.indexOf('.addListener(', from);
    if (call < 0) break;
    from = call + 13;
    /* Inline callback only. addListener(namedHandler) declares nothing. */
    const window = code.slice(call, call + 200);
    const rel = window.search(/=>\s*\{|function\s*[A-Za-z0-9_$]*\s*\([^)]*\)\s*\{/);
    if (rel < 0) continue;
    const bodyAt = code.indexOf('{', call + rel);
    if (bodyAt < 0) continue;
    const baseDepth = depth[bodyAt];
    let end = bodyAt + 1;
    while (end < code.length && !(code[end] === '}' && depth[end] === baseDepth)) end++;
    if (end >= code.length) continue;
    const lineNo = RAW.slice(0, call).split('\n').length;
    blocks.push({ bodyAt, end, baseDepth, lineNo, label: RAW.slice(RAW.lastIndexOf('\n', call) + 1, call + 13).trim() });
  }
  return blocks;
}

const BLOCKS = listenerBlocks();
check('the worker still registers listeners with inline callbacks', BLOCKS.length >= 2,
  'found ' + BLOCKS.length);
const messageBlocks = BLOCKS.filter((b) => b.label.indexOf('onMessage') >= 0);
check('both onMessage listeners are examined', messageBlocks.length === 2,
  'found ' + messageBlocks.length + ' — a helper misplaced in an unexamined one would not be caught');

const DECL = /(?:^|[\s;}])(?:async\s+)?(function|const|let|var|class)\s+([A-Za-z_$][A-Za-z0-9_$]*)/g;
const escaped = [];
BLOCKS.forEach((b) => {
  const inside = code.slice(b.bodyAt, b.end);
  const outside = code.slice(0, b.bodyAt) + code.slice(b.end);
  const bodyDepth = b.baseDepth + 1;
  const declared = new Map();
  DECL.lastIndex = 0;
  let m;
  while ((m = DECL.exec(inside))) {
    const nameAt = b.bodyAt + m.index + m[0].indexOf(m[2]);
    if (depth[nameAt] !== bodyDepth) continue; // a handler's own local, which is fine
    declared.set(m[2], m[1]);
  }
  for (const [name, kind] of declared) {
    /* A name also declared outside resolves out there, whatever is inside. */
    if (IMPORTED.has(name)) continue;
    if (new RegExp('(?:^|[\\s;}])(?:async\\s+)?(?:function|const|let|var|class)\\s+' + name + '\\b').test(outside)) continue;
    if (new RegExp('(?:^|[^A-Za-z0-9_$.])' + name + '\\s*[(=,);.\\]]').test(outside)) {
      escaped.push(kind + ' ' + name + ' (in the listener at line ' + b.lineNo + ')');
    }
  }
});
check('nothing declared inside a listener callback is used outside it',
  escaped.length === 0,
  'block-scoped, so every use outside throws at runtime: ' + escaped.join(', '));

/* Kept for the named checks below. */
const bodyAt = messageBlocks.length ? messageBlocks[messageBlocks.length - 1].bodyAt : 0;
const end = messageBlocks.length ? messageBlocks[messageBlocks.length - 1].end : 0;

/* ---- the specific helpers this went wrong for ---- */
/* Named rather than inferred: these are called from navigation listeners, which
   is exactly where the failure was invisible, and a rename that moves one back
   inside should have to say so out loud. */
const MUST_BE_TOP_LEVEL = [
  'noteServiceWorkerRegistration',
  'maybeClearOnLeave',
  'maybeClearServiceWorkersOnLeave',
  'clearServiceWorkersForDomain',
  'domainOfTab',
  'noteConsentAccepted',
  'recordToastShown',
  'muteToastType',
];
MUST_BE_TOP_LEVEL.forEach((name) => {
  const rx = new RegExp('(?:^|\\n)(?:async\\s+)?function\\s+' + name + '\\s*\\(');
  const found = rx.exec(code);
  check(name + ' is declared at top level', !!found,
    'it is indented or nested, so callers outside its block get a ReferenceError');
  if (found) {
    check(name + ' is not inside the message listener',
      found.index < bodyAt || found.index > end,
      'a function declaration in a block is scoped to that block');
  }
});

/* ---- state that has to survive between messages ---- */
/* The quieter half of the same bug. A const declared in the listener body is
   rebuilt from scratch on every message, so a map meant to accumulate is always
   empty by the time anything reads it -- no error, just a feature that never
   fires. */
['SW_REGISTERED_AT', 'CONSENT_ACCEPTED_AT', 'LAST_TOP_URL'].forEach((name) => {
  const rx = new RegExp('(?:^|\\n)const\\s+' + name + '\\b');
  const found = rx.exec(code);
  check(name + ' is declared at top level', !!found, 'rebuilt empty on every message');
  if (found) {
    check(name + ' outlives a single message',
      found.index < bodyAt || found.index > end,
      'declared inside the listener, so it cannot remember anything');
  }
});

if (failures.length) {
  console.error('FAIL (' + failures.length + ')');
  failures.forEach((f) => console.error('  - ' + f));
  process.exit(1);
}
console.log('background scope: ' + pass + ' checks passed');
