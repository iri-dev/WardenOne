/* Every write of wardenone_config holds the config lock (config-lock.js).

   Writers used to read, merge and write on their own, and two that read at the same moment wrote
   over each other: fired together in Edge, a Settings change was lost in 20 of 40 tries and a
   notification mute in the worker in 34 of 40. Each write now sits inside withConfigLock(...),
   directly or through the worker's updateStoredConfig, whose own write is inside one. This finds
   every write of the config in every shipped script and fails on one outside the lock, so a new
   writer cannot quietly reopen the race. tools/browser-config-race.js proves the lock in Edge. */
'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
let checks = 0;
const check = (label, ok) => { checks++; assert(ok === true, label); };

/* The source with comments and string, template and regex contents blanked to spaces, so brackets
   inside them cannot unbalance the count below. Offsets are kept, so positions still line up. */
function codeOnly(src) {
  const out = src.split('');
  let i = 0;
  let prevSignificant = '';
  const blank = (from, to) => { for (let k = from; k < to; k++) if (out[k] !== '\n') out[k] = ' '; };
  while (i < src.length) {
    const c = src[i];
    const next = src[i + 1];
    if (c === '/' && next === '/') { const end = src.indexOf('\n', i); const to = end < 0 ? src.length : end; blank(i, to); i = to; continue; }
    if (c === '/' && next === '*') { const end = src.indexOf('*/', i + 2); const to = end < 0 ? src.length : end + 2; blank(i, to); i = to; continue; }
    if (c === '"' || c === "'" || c === '`') {
      let k = i + 1;
      while (k < src.length && src[k] !== c) { if (src[k] === '\\') k++; k++; }
      blank(i + 1, k);
      i = k + 1; prevSignificant = c; continue;
    }
    if (c === '/' && /[(,=:[!&|?{};]|^$/.test(prevSignificant)) {
      let k = i + 1;
      let inClass = false;
      while (k < src.length && (inClass || src[k] !== '/') && src[k] !== '\n') {
        if (src[k] === '\\') k++;
        else if (src[k] === '[') inClass = true;
        else if (src[k] === ']') inClass = false;
        k++;
      }
      blank(i + 1, k);
      i = k + 1; prevSignificant = '/'; continue;
    }
    if (!/\s/.test(c)) prevSignificant = c;
    i++;
  }
  return out.join('');
}

/* [start, end) of each withConfigLock( ... ) call's arguments. */
function lockedRanges(code) {
  const ranges = [];
  for (const m of code.matchAll(/\bwithConfigLock\s*\(/g)) {
    const open = m.index + m[0].length - 1;
    let depth = 0;
    for (let k = open; k < code.length; k++) {
      if (code[k] === '(') depth++;
      else if (code[k] === ')' && --depth === 0) { ranges.push([open, k]); break; }
    }
  }
  return ranges;
}

const WRITE_RE = /\b(?:set|localSet|storageSet|localWrite|checkedLocalSet)\s*\(\s*\{\s*(?:wardenone_config|\[CONFIG_KEY\])\s*:/g;

function unlockedWrites(src) {
  const code = codeOnly(src);
  const ranges = lockedRanges(code);
  const writes = [];
  for (const m of code.matchAll(WRITE_RE)) {
    const line = code.slice(0, m.index).split('\n').length;
    writes.push({ line, locked: ranges.some(([a, b]) => m.index > a && m.index < b) });
  }
  return writes;
}

/* The scanner itself: a locked write passes, an unlocked one is caught, and brackets in strings,
   comments and regexes do not hide one. */
{
  const locked = unlockedWrites("withConfigLock(async () => { const s = ')'; /* ) */ await localSet({ wardenone_config: c }); });");
  check('a write inside withConfigLock counts as locked', locked.length === 1 && locked[0].locked);
  const open = unlockedWrites("withConfigLock(() => x(/\\)/)); chrome.storage.local.set({ wardenone_config: next }, cb);");
  check('a write after the lock is let go is caught', open.length === 1 && !open[0].locked);
  const configKey = unlockedWrites('await localWrite({ [CONFIG_KEY]: next });');
  check('a write by the Settings key constant is found too', configKey.length === 1 && !configKey[0].locked);
}

const packaged = JSON.parse(fs.readFileSync(path.join(root, 'tools/package-allowlist.json'), 'utf8'))
  .filter((f) => /\.js$/.test(f) && f !== 'content.min.js');
const found = [];
for (const file of packaged.concat(['src/content.js'])) {
  const full = path.join(root, file);
  if (!fs.existsSync(full)) continue;
  for (const w of unlockedWrites(fs.readFileSync(full, 'utf8'))) found.push(Object.assign({ file }, w));
}
const byFile = (name) => found.filter((w) => w.file === name).length;
/* The writers there are today, so a scanner that stopped seeing them fails instead of passing
   empty. The worker writes in two places, updateStoredConfig and the reset; everything else in
   it changes the config through updateStoredConfig. */
for (const [file, count] of [['background.js', 2], ['settings.js', 1], ['popup.js', 1], ['history.js', 1], ['notifications.js', 1], ['onboarding.js', 1]]) {
  check(file + ' has its ' + count + ' config write(s) found, not ' + byFile(file), byFile(file) === count);
}
const updates = ['background.js', 'background-memory.js']
  .map((f) => (fs.readFileSync(path.join(root, f), 'utf8').match(/\bupdateStoredConfig\(/g) || []).length - (f === 'background.js' ? 1 : 0))
  .reduce((a, b) => a + b, 0);
check('the worker changes the config through updateStoredConfig (' + updates + ' callers)', updates >= 9);
const open = found.filter((w) => !w.locked);
check('every write of wardenone_config holds the config lock: '
  + (open.map((w) => w.file + ':' + w.line).join(', ') || 'none outside'), open.length === 0);

const pages = ['settings.html', 'popup.html', 'history.html', 'notifications.html', 'onboarding.html'];
for (const page of pages) {
  const html = fs.readFileSync(path.join(root, page), 'utf8');
  const scripts = Array.from(html.matchAll(/<script src="([^"]+)"/g)).map((m) => m[1]);
  const own = page.replace(/\.html$/, '.js');
  check(page + ' loads config-lock.js before ' + own, scripts.indexOf('config-lock.js') >= 0 && scripts.indexOf('config-lock.js') < scripts.indexOf(own));
}
check('the worker imports config-lock.js', /importScripts\('config-lock\.js'\)/.test(fs.readFileSync(path.join(root, 'background.js'), 'utf8')));
check('config-lock.js ships', packaged.includes('config-lock.js'));

console.log('[ok] config write lock: ' + checks + ' checks, ' + found.length + ' config writes found, all locked');
