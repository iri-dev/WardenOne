/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'src', 'content.js');
const OUT = path.join(ROOT, 'content.min.js');

function read(file) {
  return fs.readFileSync(file, 'utf8');
}

function write(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text, 'utf8');
}

// src/content.js is a lossless formatted runtime artifact: only line breaks and
// indentation are generated. Removing those generated runs must recreate the
// exact extension runtime loaded by manifest.json.
function buildFromSource(source) {
  return String(source || '').replace(/\r?\n[ \t]*/g, '');
}

function isRegexStart(prev) {
  if (!prev) return true;
  return /[({[=,:;!&|?+\-*~^<>]/.test(prev);
}

function regexKeywordBefore(input, index) {
  const before = String(input || '').slice(0, index);
  const match = before.match(/[A-Za-z_$][\w$]*$/);
  return !!(match && /^(return|throw|case|delete|void|typeof|new|in|of|yield|await)$/.test(match[0]));
}

// The build strips every newline, so a single // line comment in the source
// swallows the entire rest of the file on the one output line. Nothing else
// catches it: src/content.js still parses on its own, and the built runtime
// parses too whenever the braces happen to balance, so the failure is silent
// and total. Reject the construct at the source instead of relying on memory.
//
// Deliberately reuses the same tokenizer states as formatRuntime below rather
// than grepping for '//', which would fire on every https:// inside a string
// and on regexes like /\//. Only a // reached in code state is a comment.
function findLineComments(source) {
  const input = String(source || '');
  const hits = [];
  let state = 'code';
  let quote = '';
  let escaped = false;
  let regexClass = false;
  let prevSig = '';
  let line = 1;

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    const next = input[i + 1] || '';
    if (ch === '\n') line++;

    if (state === 'string') {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === quote) state = 'code';
      continue;
    }
    if (state === 'template') {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '`') state = 'code';
      continue;
    }
    if (state === 'regex') {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '[') regexClass = true;
      else if (ch === ']') regexClass = false;
      else if (ch === '/' && !regexClass) state = 'code';
      continue;
    }
    if (state === 'block-comment') {
      if (ch === '*' && next === '/') { i++; state = 'code'; }
      continue;
    }

    if (ch === '"' || ch === "'") { state = 'string'; quote = ch; escaped = false; prevSig = ch; continue; }
    if (ch === '`') { state = 'template'; escaped = false; prevSig = ch; continue; }
    if (ch === '/' && next === '/') {
      hits.push(line);
      while (i + 1 < input.length && input[i + 1] !== '\n') i++;
      continue;
    }
    if (ch === '/' && next === '*') { state = 'block-comment'; i++; continue; }
    if (ch === '/' && (isRegexStart(prevSig) || regexKeywordBefore(input, i))) {
      state = 'regex';
      regexClass = false;
      escaped = false;
      prevSig = ch;
      continue;
    }
    if (!/\s/.test(ch)) prevSig = ch;
  }

  return hits;
}

function assertNoLineComments(source) {
  const hits = findLineComments(source);
  if (!hits.length) return;
  const shown = hits.slice(0, 20).join(', ') + (hits.length > 20 ? ', ...' : '');
  console.error('[fail] src/content.js contains ' + hits.length + ' // line comment(s), at line(s): ' + shown);
  console.error('[info] the build strips newlines, so a // comment deletes the rest of the runtime silently. Use /* */ instead.');
  process.exit(1);
}

function formatRuntime(source) {
  const input = String(source || '').replace(/\r?\n/g, '');
  const out = [];
  let indent = 0;
  let state = 'code';
  let quote = '';
  let escaped = false;
  let regexClass = false;
  let prevSig = '';

  function newline(nextIndent) {
    while (out.length && out[out.length - 1] === ' ') out.pop();
    if (out[out.length - 1] !== '\n') out.push('\n');
    out.push('  '.repeat(Math.max(0, nextIndent == null ? indent : nextIndent)));
  }

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    const next = input[i + 1] || '';

    if (state === 'string') {
      out.push(ch);
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === quote) state = 'code';
      continue;
    }

    if (state === 'template') {
      out.push(ch);
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '`') state = 'code';
      continue;
    }

    if (state === 'regex') {
      out.push(ch);
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '[') regexClass = true;
      else if (ch === ']') regexClass = false;
      else if (ch === '/' && !regexClass) state = 'code';
      continue;
    }

    if (state === 'line-comment') {
      out.push(ch);
      if (ch === '\n') state = 'code';
      continue;
    }

    if (state === 'block-comment') {
      out.push(ch);
      if (ch === '*' && next === '/') {
        out.push(next);
        i++;
        state = 'code';
      }
      continue;
    }

    if (ch === '"' || ch === "'") {
      state = 'string';
      quote = ch;
      escaped = false;
      out.push(ch);
      prevSig = ch;
      continue;
    }
    if (ch === '`') {
      state = 'template';
      escaped = false;
      out.push(ch);
      prevSig = ch;
      continue;
    }
    if (ch === '/' && next === '/') {
      state = 'line-comment';
      out.push(ch, next);
      i++;
      continue;
    }
    if (ch === '/' && next === '*') {
      state = 'block-comment';
      out.push(ch, next);
      i++;
      continue;
    }
    if (ch === '/' && (isRegexStart(prevSig) || regexKeywordBefore(input, i))) {
      state = 'regex';
      regexClass = false;
      escaped = false;
      out.push(ch);
      prevSig = ch;
      continue;
    }

    if (ch === '{') {
      out.push(ch);
      prevSig = ch;
      indent++;
      newline();
      continue;
    }
    if (ch === '}') {
      indent = Math.max(0, indent - 1);
      newline();
      out.push(ch);
      prevSig = ch;
      if (next && next !== ';' && next !== ',' && next !== ')' && next !== ']') newline();
      continue;
    }
    if (ch === ';') {
      out.push(ch);
      prevSig = ch;
      newline();
      continue;
    }
    if (ch === ',') {
      out.push(ch);
      prevSig = ch;
      newline();
      continue;
    }

    out.push(ch);
    if (!/\s/.test(ch)) prevSig = ch;
  }

  return out.join('').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trimStart() + '\n';
}

function check() {
  const source = read(SRC);
  assertNoLineComments(source);
  const built = buildFromSource(source);
  const runtime = read(OUT);
  if (built !== runtime) {
    console.error('[fail] src/content.js does not rebuild to content.min.js');
    console.error('[info] built bytes=' + Buffer.byteLength(built) + ' runtime bytes=' + Buffer.byteLength(runtime));
    process.exit(1);
  }
  console.log('[ok] src/content.js rebuilds content.min.js exactly');
}

const arg = process.argv[2] || '--build';
if (arg === '--format-from-runtime') {
  write(SRC, formatRuntime(read(OUT)));
  console.log('[ok] wrote src/content.js from content.min.js');
} else if (arg === '--check') {
  check();
} else if (arg === '--build') {
  const source = read(SRC);
  assertNoLineComments(source);
  write(OUT, buildFromSource(source));
  console.log('[ok] rebuilt content.min.js from src/content.js');
} else {
  console.error('usage: node tools/build-content.js [--build|--check|--format-from-runtime]');
  process.exit(2);
}
