/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/*
 * Everything the extension loads at runtime has to be in the package (H14).
 *
 * The code was correct, the manifest was correct, and `git archive` was correct -- and the staged
 * store ZIP was still missing cosmetic-rules.json, because it had been built before that file
 * entered the tree. Nothing noticed, and nothing could have: no suite compares what the extension
 * asks for against what the package contains.
 *
 * The failure that made it dangerous is that it is silent. getPackagedCosmetics wraps its fetch in
 * a try/catch and falls back to empty scriptlet and procedural sets, so a package missing that file
 * runs with a chunk of cosmetic filtering quietly switched off. No error, no health signal, and the
 * popup still reports protection as active.
 *
 * So this derives the asset list from the code rather than restating it. A hand-written list would
 * drift exactly the way the ZIP did. Five real load paths are scanned:
 *
 *   1. chrome.runtime.getURL('literal')            -- runtime fetches and page navigations
 *   2. manifest declarations                        -- content scripts, rulesets, icons, pages
 *   3. importScripts('literal')                     -- service-worker modules
 *   4. executeScript/insertCSS/registerContentScripts -- on-demand injection
 *   5. <script src> / <link href> in shipped HTML   -- extension page assets
 *
 * Deliberately NOT a blanket scan for filename-shaped strings. background.js carries
 * 'clientjs.min.js' in a list of fingerprinting libraries to DETECT, and the settings export is
 * named wardenone-settings.json; neither is a packaged asset, and a looser matcher reports both.
 *
 * Run: node tools/test-package-completeness.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');

let failed = 0;
function check(name, condition, extra) {
  if (condition) { console.log('  ok  - ' + name); return; }
  failed++;
  console.error('  FAIL - ' + name + (extra ? ' :: ' + extra : ''));
}

const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const shippedJs = fs.readdirSync(ROOT).filter((f) => /\.js$/.test(f));
const shippedHtml = fs.readdirSync(ROOT).filter((f) => /\.html$/.test(f));

// file -> the reasons it is required, so a failure says which load path wants it.
const required = new Map();
function need(file, why) {
  const clean = String(file || '').replace(/^\.?\//, '').split(/[?#]/)[0];
  if (!clean || /^(https?:)?\/\//i.test(clean) || /^data:/i.test(clean)) return;
  if (!required.has(clean)) required.set(clean, new Set());
  required.get(clean).add(why);
}

/* ---- 1. chrome.runtime.getURL('literal') ---------------------------------- */
for (const file of shippedJs) {
  const src = read(file);
  for (const m of src.matchAll(/getURL\(\s*['"]([^'"]+)['"]\s*\)/g)) need(m[1], file + ' getURL');
}

/* ---- 2. the manifest ------------------------------------------------------ */
{
  const m = JSON.parse(read('manifest.json'));
  for (const entry of m.content_scripts || []) {
    for (const f of entry.js || []) need(f, 'manifest content_scripts.js');
    for (const f of entry.css || []) need(f, 'manifest content_scripts.css');
  }
  for (const r of (m.declarative_net_request || {}).rule_resources || []) need(r.path, 'manifest ruleset');
  for (const f of Object.values(m.icons || {})) need(f, 'manifest icons');
  for (const f of Object.values((m.action || {}).default_icon || {})) need(f, 'manifest action icon');
  if ((m.action || {}).default_popup) need(m.action.default_popup, 'manifest action popup');
  if (m.options_page) need(m.options_page, 'manifest options_page');
  if ((m.background || {}).service_worker) need(m.background.service_worker, 'manifest service_worker');
  for (const entry of m.web_accessible_resources || []) {
    for (const f of entry.resources || []) need(f, 'manifest web_accessible_resources');
  }
}

/* ---- 3. importScripts ----------------------------------------------------- */
for (const file of shippedJs) {
  const src = read(file);
  for (const m of src.matchAll(/importScripts\s*\(([^)]*)\)/g)) {
    for (const q of m[1].matchAll(/['"]([^'"]+)['"]/g)) need(q[1], file + ' importScripts');
  }
}

/* ---- 4. on-demand injection ----------------------------------------------- */
// files:[...] and css:[...] on the scripting API. Only literal array members are read; a computed
// `files: [file]` is skipped on purpose rather than guessed at -- see the canary below, which is
// what stops that skip from quietly swallowing everything.
for (const file of shippedJs) {
  const src = read(file);
  for (const m of src.matchAll(/\b(?:files|css|js)\s*:\s*\[([^\]]*)\]/g)) {
    for (const q of m[1].matchAll(/['"]([^'"]+\.(?:js|css|json))['"]/g)) need(q[1], file + ' injection');
  }
}

/* ---- 5. shipped HTML pages ------------------------------------------------ */
for (const file of shippedHtml) {
  const src = read(file);
  for (const m of src.matchAll(/<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi)) need(m[1], file + ' <script>');
  for (const m of src.matchAll(/<link\b[^>]*\bhref\s*=\s*["']([^"']+)["']/gi)) {
    if (/\.css($|[?#])/i.test(m[1])) need(m[1], file + ' <link>');
  }
}

/* ---- what the release package actually contains --------------------------- */
const archive = spawnSync('git', ['archive', '--format=tar', 'HEAD'], {
  cwd: ROOT, encoding: 'buffer', maxBuffer: 1024 * 1024 * 256,
});
if (archive.status !== 0) {
  console.error('  FAIL - could not run `git archive HEAD` :: '
    + String(archive.stderr || '').slice(0, 200));
  process.exit(1);
}
// tar: 512-byte headers, name in the first 100 bytes, size at offset 124 (octal).
const packaged = new Set();
{
  const buf = archive.stdout;
  let off = 0;
  while (off + 512 <= buf.length) {
    const name = buf.slice(off, off + 100).toString('utf8').replace(/\0.*$/, '');
    if (!name) break;
    const size = parseInt(buf.slice(off + 124, off + 136).toString('utf8').replace(/\0.*$/, '').trim(), 8) || 0;
    if (!name.endsWith('/')) packaged.add(name);
    off += 512 + Math.ceil(size / 512) * 512;
  }
}
check('the release package was read', packaged.size > 40, packaged.size + ' entries');

/* ---- the canary ----------------------------------------------------------- *
 * A scanner that silently stops finding things passes forever. These three are the runtime-fetched
 * data files -- the class H14 was about, and the ones no manifest mentions -- so if the getURL scan
 * ever stops seeing them, this fails instead of the suite going quietly green. */
for (const canary of ['cosmetic-rules.json', 'grabber-extra.json', 'cryptominer-domains.json']) {
  check('the scan still finds ' + canary, required.has(canary));
}
check('the scan covers a realistic surface', required.size >= 30, required.size + ' assets found');

/* ---- the assertion H14 needed --------------------------------------------- */
{
  const missing = [...required.keys()].filter((f) => !packaged.has(f)).sort();
  check('every asset the extension loads is in the release package',
    missing.length === 0,
    missing.map((f) => f + ' (wanted by: ' + [...required.get(f)].join(', ') + ')').join('; '));
}

/* A reference to a file that is not even on disk is a typo or a deletion that took a caller with
 * it. Same scan, different failure, and cheap to add while the list is already built. */
{
  const absent = [...required.keys()].filter((f) => !fs.existsSync(path.join(ROOT, f))).sort();
  check('every referenced asset exists on disk', absent.length === 0, absent.join(', '));
}

if (failed) { console.error('\n' + failed + ' package completeness check(s) failed'); process.exit(1); }
console.log('\npackage contains every asset the extension loads (' + required.size + ' checked)');
