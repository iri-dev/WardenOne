/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/* Derive runtime assets from manifest, imports, injections, extension URLs and
   HTML references; verify the staged package contains them. Ignore filenames
   mentioned only as detection data or export names. */
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { zipEntries, validateEntries, stagedZip } = require('./check-package-archive');

const ROOT = path.resolve(__dirname, '..');

let failed = 0;
function check(name, condition, extra) {
  if (condition) { console.log('  ok  - ' + name); return; }
  failed++;
  console.error('  FAIL - ' + name + (extra ? ' :: ' + extra : ''));
}

/* Internal maintainer notes do not belong in the public repository. This index check catches
 * an accidental add, `git add -f`, case variants, and moving either
 * filename into a subdirectory. */
{
  const trackedResult = spawnSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8' });
  check('the tracked-file list can be inspected', trackedResult.status === 0,
    String(trackedResult.stderr || '').trim());
  if (trackedResult.status === 0) {
    const forbiddenNames = new Set(['cws-submission.md', 'maintainability.md']);
    const forbidden = trackedResult.stdout.split('\0').filter(Boolean).filter((file) =>
      forbiddenNames.has(path.posix.basename(file).toLowerCase()));
    check('private maintainer notes are not tracked', forbidden.length === 0,
      forbidden.join(', '));
  }
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

/* ---- what the release package actually contains --------------------------- *
 * Before a commit, inspect the staged candidate tree. On CI the index and HEAD are identical,
 * while locally this lets the mandatory pre-commit gate validate a newly added runtime asset. */
const tree = spawnSync('git', ['write-tree'], { cwd: ROOT, encoding: 'utf8' });
if (tree.status !== 0 || !String(tree.stdout || '').trim()) {
  console.error('  FAIL - could not inspect the staged release tree :: '
    + String(tree.stderr || '').slice(0, 200));
  process.exit(1);
}
const releaseTree = String(tree.stdout).trim();
const archive = spawnSync('git', ['archive', '--format=tar', releaseTree], {
  cwd: ROOT, encoding: 'buffer', maxBuffer: 1024 * 1024 * 256,
});
if (archive.status !== 0) {
  console.error('  FAIL - could not archive the staged release tree :: '
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

/* The ZIP that CI uploads must contain exactly the reviewed runtime inventory. This check reads
 * the candidate ZIP's central directory, while the workflow checks the final named ZIP again. */
{
  const entries = zipEntries(stagedZip());
  const problems = validateEntries(entries);
  check('the staged release ZIP contains exactly the reviewed files', problems.length === 0, problems.join('; '));
  for (const name of ['_metadata/generated_indexed_rulesets/ruleset', 'old-build.zip',
    'notes/cws-submission.md', 'unexpected.js']) {
    check('an added ' + name + ' is rejected', validateEntries([...entries, name]).length > 0);
  }
}

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

/* ---- every document in the package is there on purpose (REL-03) ------------- *
 * CHANGELOG.md, SECURITY.md and SUPPORT.md shipped in the release zip -- 98 KiB, the changelog the
 * largest non-runtime file in the package -- not because a rule kept them but because no rule
 * removed them, while the comment above the rules said PRIVACY.md was "intentionally kept" and a
 * rule fourteen lines down excluded it. The intent is now written once, in .gitattributes, and
 * checked here against the archive itself: the licence files travel with the work because the GPL
 * requires it, CREDITS.md carries the upstream attribution, and no other document is in the zip.
 * Every excluded document is excluded by a rule with its name on it, and the comments name nothing
 * as kept that a rule removes. */
{
  const INTENDED_DOCS = ['LICENSE', 'NOTICE', 'CREDITS.md'];
  for (const doc of INTENDED_DOCS) check(doc + ' travels with the package', packaged.has(doc));
  const strayDocs = [...packaged].filter((f) => !f.includes('/') && /\.(md|txt|markdown)$/i.test(f) && !INTENDED_DOCS.includes(f)).sort();
  check('no other document is in the package', strayDocs.length === 0, strayDocs.join(', ') + ' -- ships because nothing excludes it');
  const attributes = fs.readFileSync(path.join(ROOT, '.gitattributes'), 'utf8');
  const ignored = new Set([...attributes.matchAll(/^([^\s#]+)\s+export-ignore/gm)].map((m) => m[1]));
  for (const doc of ['CHANGELOG.md', 'SECURITY.md', 'SUPPORT.md', 'PRIVACY.md', 'README.md']) {
    check(doc + ' is excluded by a rule, not by default', ignored.has(doc));
  }
  const keptClaims = attributes.split('\n').filter((l) => /^#/.test(l) && /\bkept\b/i.test(l) && !/\bkept out\b/i.test(l)).join(' ');
  const claimedKept = [...keptClaims.matchAll(/\b([A-Z][A-Za-z-]*(?:\.md)?)\b/g)].map((m) => m[1]).filter((n) => ignored.has(n));
  check('the .gitattributes comment names nothing as kept that a rule excludes', claimedKept.length === 0,
    claimedKept.join(', ') + ' -- two comments disagreeing is how the three files got in');
}

/* ---- the package has to be loadable, not merely complete ------------------- *
 * Shipping every file is not enough if the folder shape defeats "Load unpacked".
 *
 * The v1.0.1 zip was built with `git archive --prefix=WardenOne/`, so the archive contained a
 * WardenOne/ folder holding everything. But every GUI unzipper ALSO creates a folder named after
 * the archive, so Windows "Extract All" produced WardenOne-v1.0.1\WardenOne\manifest.json. Point
 * Chrome at the folder you just extracted -- the obvious thing to do, and what the instructions
 * said -- and it refuses with "Manifest file is missing or unreadable". The extension looks broken
 * before it has run a line of code.
 *
 * So manifest.json belongs at the root of the archive, which is also what the Chrome Web Store
 * expects. The command must stay prefix-free everywhere it is written down. */
{
  check('manifest.json sits at the root of the release package',
    packaged.has('manifest.json'),
    'nothing at the archive root -- "Load unpacked" on the extracted folder will fail');

  // Nothing may be nested under a single wrapper directory.
  const topLevel = new Set([...packaged].map((f) => f.split('/')[0]));
  check('the package is not wrapped in a single folder',
    !(topLevel.size === 1 && [...packaged].every((f) => f.includes('/'))),
    'everything sits under "' + [...topLevel][0] + '/", which unzips one level too deep');

  // The release workflow is the authoritative recipe; a prefix creeping into it reintroduces the
  // broken nested-folder package.
  const sources = [
    ['.github/workflows/gate.yml', '.github/workflows/gate.yml'],
  ];
  for (const [label, file] of sources) {
    const full = path.join(ROOT, file);
    if (!fs.existsSync(full)) continue;
    const text = fs.readFileSync(full, 'utf8');
    // Only real invocations -- prose mentions "git archive" too, and matching those just prints
    // the same check three times.
    const commands = text.split(/\r?\n/).filter((line) =>
      /git archive/.test(line) && /--format|\s-o\s/.test(line) && !/^\s*#/.test(line));
    check('a git archive command was found in ' + label, commands.length > 0,
      'the packaging recipe moved or was renamed, so this guard stopped guarding anything');
    for (const line of commands) {
      check('the git archive command in ' + label + ' has no --prefix',
        !/--prefix/.test(line), line.trim());
    }
  }
}

if (failed) { console.error('\n' + failed + ' package completeness check(s) failed'); process.exit(1); }
console.log('\npackage contains every asset the extension loads (' + required.size + ' checked)'
  + ' and unzips straight into a loadable folder');
