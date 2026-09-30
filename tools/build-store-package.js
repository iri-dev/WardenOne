/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/*
 * The Store package: WardenOne with explicit decisions for its separable utilities (CWS-03).
 *
 * Chrome's Web Store allows one narrow purpose per extension, and the reviewer's question is
 * whether every top-level feature delivers the stated purpose. EyeShield remains for reader-
 * controlled page presentation, and Memory Shield with its Tab Limit control remains for
 * resource protection. Twitch Rewind is omitted as a separate replay goal. The GitHub build
 * carries everything.
 *
 * Deterministic: the package is built from the HEAD tree with git's own plumbing, never from the
 * working copy, and its entries carry the commit's own time, so the same commit always yields the
 * same bytes. build-profile.js is the decision record it reads; the worker and the popup read the
 * same file at run time, which is how a package that lacks a module still runs cleanly.
 *
 *   node tools/build-store-package.js                    # write WardenOne-store.zip from HEAD
 *   node tools/build-store-package.js --out <file.zip>   # elsewhere
 *   node tools/build-store-package.js --staged           # from the staged tree instead of HEAD
 *   node tools/build-store-package.js --doc              # rewrite the generated block of
 *                                                        # docs/store-single-purpose.md
 *   node tools/build-store-package.js --check            # gate: the profile, the table, the guards,
 *                                                        # the doc and a dry-run build all agree
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const PROFILE_FILE = 'build-profile.js';
const DOC = path.join(ROOT, 'docs', 'store-single-purpose.md');
const DOC_BEGIN = '<!-- BEGIN GENERATED FEATURE TABLE -->';
const DOC_END = '<!-- END GENERATED FEATURE TABLE -->';
/* Not part of the product: sources, tooling, the website and the workflow. The GitHub archive
   carries them because it is the repository; the Store package is the extension. The security
   policy and the support note are for people reading the repository, where GitHub shows them
   (REL-03); LICENSE, NOTICE and PRIVACY.md stay -- the licence travels with the work, and a
   reviewer opening the package finds the policy the listing links to. */
const NON_RUNTIME = [/^\.github\//, /^tools\//, /^docs\//, /^site\//, /^src\//, /^\.gitignore$/, /^\.gitattributes$/, /^CHANGELOG\.md$/, /^CREDITS\.md$/, /^README\.md$/, /^SECURITY\.md$/, /^SUPPORT\.md$/, /\.zip$/i];
/* The only places the package may still name an omitted file: loaders that check the profile first.
   Each entry here has a guard in the --check list below; a name anywhere else is a build failure. */
const GUARDED_REFERENCES = {
  // The guarded module loader, the guarded EyeShield registration, and the integrity list, which
  // drops omitted names at run time through woOmittedFiles().
  'background.js': ['background-memory.js', 'eyeshield.js', 'eyeshield-sites.js', 'eyeshield-preload-dark.js', 'eyeshield-preload-ultra.js', 'eyeshield-preload-light.js', 'twitch-rewind.js', 'twitch-vod-rewind.js'],
  'popup.js': ['eyeshield.js', 'eyeshield-sites.js'],
};
function guardedReference(file, target) {
  return Array.isArray(GUARDED_REFERENCES[file]) && GUARDED_REFERENCES[file].includes(target);
}

function git(args, opts) {
  const res = spawnSync('git', args, Object.assign({ cwd: ROOT, encoding: 'utf8', maxBuffer: 1024 * 1024 * 256 }, opts || {}));
  if (res.status !== 0) throw new Error('git ' + args.join(' ') + ' failed: ' + String(res.stderr || res.stdout || '').trim().slice(0, 300));
  return res.stdout;
}
function gitBuffer(args, input) {
  const res = spawnSync('git', args, { cwd: ROOT, encoding: 'buffer', input, maxBuffer: 1024 * 1024 * 256 });
  if (res.status !== 0) throw new Error('git ' + args.join(' ') + ' failed: ' + String(res.stderr || '').trim().slice(0, 300));
  return res.stdout;
}

/* The decision record, evaluated rather than parsed, so the worker, the popup and this tool cannot
   read it three different ways. */
function loadProfile(source) {
  const text = source !== undefined ? source : fs.readFileSync(path.join(ROOT, PROFILE_FILE), 'utf8');
  const sandbox = { Object, String, Array };
  vm.createContext(sandbox);
  vm.runInContext(text + '\nthis.build = WARDENONE_BUILD; this.omittedFiles = woOmittedFiles; this.omittedKeys = woOmittedKeys;', sandbox);
  return { build: sandbox.build, text };
}

/* The Store profile follows the explicit decision for each utility in the table. */
function storeOmitted(build) {
  const ids = Object.keys(build.features);
  /* Commits made before the explicit decision field omitted every recorded utility. Keep a
     candidate built from one of those commits tied to that commit's actual decision. */
  if (ids.every((id) => build.features[id].store === undefined)) return ids;
  return ids.filter((id) => build.features[id].store === 'omit');
}

function rewriteProfile(text, ids) {
  const begin = text.indexOf('// BUILD-PROFILE-BEGIN');
  const end = text.indexOf('// BUILD-PROFILE-END');
  if (begin < 0 || end < 0 || end < begin) throw new Error(PROFILE_FILE + ' has lost its BUILD-PROFILE markers');
  const lineEnd = text.indexOf('\n', begin) + 1;
  const body = "  profile: 'store',\n  omitted: Object.freeze(" + JSON.stringify(ids).replace(/"/g, "'").replace(/,/g, ', ') + '),\n  ';
  return text.slice(0, lineEnd) + body + text.slice(end);
}

function omittedFilesFor(build, ids) {
  const out = [];
  ids.forEach((id) => (build.features[id] ? build.features[id].files : []).forEach((f) => { if (!out.includes(f)) out.push(f); }));
  return out;
}

function rewriteManifest(manifest, omittedFiles) {
  const gone = new Set(omittedFiles);
  const out = JSON.parse(JSON.stringify(manifest));
  if (Array.isArray(out.content_scripts)) {
    out.content_scripts = out.content_scripts.map((entry) => {
      const e = Object.assign({}, entry);
      if (Array.isArray(e.js)) e.js = e.js.filter((f) => !gone.has(f));
      if (Array.isArray(e.css)) e.css = e.css.filter((f) => !gone.has(f));
      return e;
    }).filter((e) => (Array.isArray(e.js) && e.js.length) || (Array.isArray(e.css) && e.css.length));
  }
  if (Array.isArray(out.web_accessible_resources)) {
    out.web_accessible_resources = out.web_accessible_resources.map((entry) => {
      const e = Object.assign({}, entry);
      if (Array.isArray(e.resources)) e.resources = e.resources.filter((f) => !gone.has(f));
      return e;
    }).filter((e) => Array.isArray(e.resources) && e.resources.length);
  }
  return out;
}

/* Every local file the package asks for by name: manifest entries, script and stylesheet tags in
   its pages, importScripts calls in worker files, and getURL literals with a file extension. */
function referencedFiles(files) {
  const refs = new Map();
  const note = (file, by) => { if (!refs.has(file)) refs.set(file, new Set()); refs.get(file).add(by); };
  const manifest = JSON.parse(files.get('manifest.json'));
  (manifest.content_scripts || []).forEach((e) => { (e.js || []).forEach((f) => note(f, 'manifest content_scripts')); (e.css || []).forEach((f) => note(f, 'manifest content_scripts')); });
  if (manifest.background && manifest.background.service_worker) note(manifest.background.service_worker, 'manifest background');
  if (manifest.action && manifest.action.default_popup) note(manifest.action.default_popup, 'manifest action');
  Object.values(manifest.icons || {}).forEach((f) => note(f, 'manifest icons'));
  Object.values((manifest.action && manifest.action.default_icon) || {}).forEach((f) => note(f, 'manifest action icons'));
  (manifest.web_accessible_resources || []).forEach((e) => (e.resources || []).forEach((f) => { if (!/[*]/.test(f)) note(f, 'manifest web_accessible_resources'); }));
  (manifest.declarative_net_request && manifest.declarative_net_request.rule_resources || []).forEach((r) => note(r.path, 'manifest rule_resources'));
  for (const [name, text] of files) {
    if (/\.html$/.test(name)) {
      for (const m of text.matchAll(/<(?:script|link|img)[^>]+(?:src|href)="([^"]+)"/g)) {
        const f = m[1];
        if (/^(?:https?:|data:|#|chrome)/.test(f)) continue;
        note(f.replace(/^\.\//, '').split(/[?#]/)[0], name);
      }
    }
    if (/\.js$/.test(name)) {
      // A file name only: the engine and the Spotify blocker build importScripts calls for blob
      // workers out of JSON.stringify(...) and those are not files of this package.
      for (const m of text.matchAll(/importScripts\(\s*['"]([A-Za-z0-9_./-]+\.js)['"]\s*\)/g)) note(m[1], name + ' importScripts');
      for (const m of text.matchAll(/getURL\(\s*['"]([a-zA-Z0-9_./-]+\.(?:html|js|css|json|png|svg|mp4|webp))['"]/g)) note(m[1], name + ' getURL');
    }
  }
  return refs;
}

/* The Store tree, in memory: every path the package will carry, with the bytes of the rewritten
   files and the oid of the untouched ones. */
function buildStoreTree(options) {
  const o = options || {};
  const treeish = o.treeish || 'HEAD';
  const { build, text: profileText } = loadProfile(o.profileSource);
  const ids = storeOmitted(build);
  const omittedFiles = omittedFilesFor(build, ids);
  const listing = git(['ls-tree', '-r', treeish]).split('\n').filter(Boolean).map((line) => {
    const m = /^(\d{6}) (\w+) ([0-9a-f]{40})\t(.+)$/.exec(line);
    return m && { mode: m[1], type: m[2], oid: m[3], path: m[4] };
  }).filter(Boolean);
  const present = new Set(listing.map((e) => e.path));
  const missing = omittedFiles.filter((f) => !present.has(f));
  if (missing.length) throw new Error('the profile names files the tree does not have: ' + missing.join(', '));
  const removed = [];
  const kept = listing.filter((e) => {
    if (omittedFiles.includes(e.path) || NON_RUNTIME.some((re) => re.test(e.path))) { removed.push(e.path); return false; }
    return true;
  });
  const show = (p) => git(['show', treeish + ':' + p]);
  const manifest = rewriteManifest(JSON.parse(show('manifest.json')), omittedFiles);
  const rewritten = new Map();
  rewritten.set('manifest.json', JSON.stringify(manifest, null, 2) + '\n');
  rewritten.set(PROFILE_FILE, rewriteProfile(profileText, ids));
  // Text of every runtime file, for the reference scan.
  const files = new Map();
  for (const e of kept) {
    if (rewritten.has(e.path)) { files.set(e.path, rewritten.get(e.path)); continue; }
    if (/\.(?:js|html|json|css)$/.test(e.path)) files.set(e.path, show(e.path));
    else files.set(e.path, '');
  }
  const refs = referencedFiles(files);
  const dangling = [];
  for (const [file, by] of refs) {
    if (files.has(file)) continue;
    // An omitted file asked for only by a guarded loader is the design, not a hole.
    const wanters = Array.from(by).map((w) => w.split(' ')[0]);
    if (omittedFiles.includes(file) && wanters.every((w) => guardedReference(w, file))) continue;
    dangling.push(file + ' (wanted by ' + Array.from(by).join(', ') + ')');
  }
  // Nothing left in the package may name an omitted file, except the profile's own table and the
  // guarded loaders listed above.
  const stray = [];
  for (const [name, text] of files) {
    if (!/\.(?:js|html|json)$/.test(name) || name === PROFILE_FILE) continue;
    for (const f of omittedFiles) {
      if (!text.includes(f) || guardedReference(name, f)) continue;
      stray.push(name + ' -> ' + f);
    }
  }
  return { treeish, ids, omittedFiles, kept, removed, rewritten, files, manifest, dangling, stray, profile: JSON.parse(JSON.stringify(build)) };
}

/* A git tree object for the package, built in a scratch index so the real index is never touched,
   and a zip of it stamped with the commit's own time. */
function writeZip(tree, outPath) {
  const indexFile = path.join(os.tmpdir(), 'wardenone-store-index-' + process.pid);
  const env = Object.assign({}, process.env, { GIT_INDEX_FILE: indexFile });
  try {
    git(['read-tree', tree.treeish], { env });
    if (tree.removed.length) git(['update-index', '--force-remove', '--'].concat(tree.removed), { env });
    for (const [p, text] of tree.rewritten) {
      const oid = git(['hash-object', '-w', '--stdin'], { input: text, env }).trim();
      git(['update-index', '--add', '--cacheinfo', '100644,' + oid + ',' + p], { env });
    }
    const treeId = git(['write-tree'], { env }).trim();
    // The commit's own time, so two builds of one commit are byte-identical. A build from the
    // staged tree (--check) has no commit of its own and takes HEAD's.
    const when = git(['log', '-1', '--format=%cI', /^[0-9a-f]{40}$/.test(tree.treeish) ? 'HEAD' : tree.treeish]).trim();
    gitBuffer(['archive', '--format=zip', '--mtime=' + when, '-o', outPath, treeId]);
    return { treeId, when };
  } finally {
    try { fs.unlinkSync(indexFile); } catch (_) {}
  }
}

/* The generated half of docs/store-single-purpose.md: the utilities and their decisions. */
function featureTable(build) {
  const omitted = new Set(storeOmitted(build));
  const lines = [DOC_BEGIN, '',
    '_Generated by `tools/build-store-package.js --doc` from the `features` table in `build-profile.js`._',
    '_Do not edit this block by hand; the gate rebuilds and checks it._', '',
    '| Utility | Store decision | Its goal | Files omitted | Settings omitted |',
    '| --- | --- | --- | --- | --- |'];
  for (const id of Object.keys(build.features)) {
    const f = build.features[id];
    const dropped = omitted.has(id);
    lines.push('| ' + f.label + ' (`' + id + '`) | ' + (dropped ? 'Omitted' : 'Included') + ' | ' + f.goal + ' | ' + (dropped ? (f.files.length ? f.files.map((x) => '`' + x + '`').join(', ') : '_none of its own (inside Memory Shield)_') : '—') + ' | ' + (dropped ? f.keys.map((k) => '`' + k + '`').join(', ') : '—') + ' |');
  }
  lines.push('', DOC_END);
  return lines.join('\n');
}
function renderDoc(build) {
  const current = fs.existsSync(DOC) ? fs.readFileSync(DOC, 'utf8') : '';
  const begin = current.indexOf(DOC_BEGIN);
  const end = current.indexOf(DOC_END);
  if (begin < 0 || end < 0) throw new Error(path.relative(ROOT, DOC) + ' is missing its generated-block markers');
  return current.slice(0, begin) + featureTable(build) + current.slice(end + DOC_END.length);
}

function defaultConfigKeys() {
  const bg = fs.readFileSync(path.join(ROOT, 'background.js'), 'utf8');
  const start = bg.indexOf('const DEFAULT_CONFIG = {');
  const end = bg.indexOf('\n};', start);
  const keys = new Set();
  for (const m of bg.slice(start, end).matchAll(/^\s{2}([A-Za-z][A-Za-z0-9]*):/gm)) keys.add(m[1]);
  return keys;
}
function popupSections() {
  const html = fs.readFileSync(path.join(ROOT, 'popup.html'), 'utf8');
  return Array.from(html.matchAll(/<h2[^>]*>([^<]+)<\/h2>/g)).map((m) => m[1].replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim());
}

function check() {
  const problems = [];
  const { build, text } = loadProfile();
  if (build.profile !== 'full' || build.omitted.length) problems.push('the repository copy of ' + PROFILE_FILE + ' must say profile full and omit nothing; it says ' + build.profile + ' / ' + JSON.stringify(build.omitted));
  if (!/\/\/ BUILD-PROFILE-BEGIN[\s\S]*\/\/ BUILD-PROFILE-END/.test(text)) problems.push(PROFILE_FILE + ' has lost its BUILD-PROFILE markers');
  const keys = defaultConfigKeys();
  // The staged tree, the same one the dry run below builds from, so a file added together with
  // the profile entry that names it passes with it rather than only once both are committed.
  const tracked = new Set(git(['ls-files', '--cached']).split('\n').filter(Boolean));
  for (const id of Object.keys(build.features)) {
    const f = build.features[id];
    if (!['include', 'omit'].includes(f.store)) problems.push(id + ' must have a Store decision of include or omit');
    f.files.forEach((file) => { if (!tracked.has(file)) problems.push(id + ' names a file the tree does not track: ' + file); });
    f.keys.forEach((k) => { if (!keys.has(k)) problems.push(id + ' names a setting DEFAULT_CONFIG does not have: ' + k); });
  }
  const bg = fs.readFileSync(path.join(ROOT, 'background.js'), 'utf8');
  const popupJs = fs.readFileSync(path.join(ROOT, 'popup.js'), 'utf8');
  const popupHtml = fs.readFileSync(path.join(ROOT, 'popup.html'), 'utf8');
  const guards = [
    ["the worker imports the profile", /importScripts\('build-profile\.js'\);/, bg],
    ["the memory module is loaded only when carried, and its absence is caught", /if \(!woFeatureOmitted\('memoryShield'\)\) \{\s*try \{\s*importScripts\("background-memory\.js"\);/, bg],
    ["memory-* messages answer 'not in this build' without the module", /String\(msg\.kind\)\.indexOf\('memory-'\) === 0 && !MODULE_LOADED\.memory/, bg],
    ["the tab menu leaves out the module's entries", /if \(!MODULE_LOADED\.memory\) \{\s*for \(let i = WO_MENU_ITEMS\.length - 1; i >= 0; i--\) if \(WO_MENU_MODULE_ITEMS\.has\(WO_MENU_ITEMS\[i\]\.id\)\) WO_MENU_ITEMS\.splice\(i, 1\);/, bg],
    ["EyeShield is never registered by a package that lacks it", /if \(woFeatureOmitted\('eyeShield'\)\) \{\s*try \{ await chrome\.scripting\.unregisterContentScripts/, bg],
    ["the integrity check does not ask for omitted files", /for \(const omitted of woOmittedFiles\(\)\)/, bg],
    ["the popup loads the profile", /<script src="build-profile\.js"><\/script>/, popupHtml],
    ["the popup applies it before painting", /const OMITTED_FEATURES = applyBuildProfile\(\);/, popupJs],
    ["the popup does not boot the memory tools it lacks", /\(function initMemoryShield\(\) \{\s*if \(featureOmitted\('memoryShield'\)\) return;/, popupJs],
    ["the popup does not inject an EyeShield it lacks", /function injectEyeShieldActiveTab\(\) \{\s*if \(featureOmitted\('eyeShield'\)\) return;/, popupJs],
  ];
  for (const [what, re, src] of guards) if (!re.test(src)) problems.push('guard missing: ' + what);
  // Every element that belongs to an omitted feature is marked, at least once per feature with UI.
  for (const id of ['eyeShield', 'memoryShield', 'tabLimit', 'twitchRewind']) {
    if (!popupHtml.includes('data-feature="' + id + '"')) problems.push('popup.html marks nothing for ' + id);
  }
  // The doc: generated block current, and every popup section has a row in the hand-written table.
  if (!fs.existsSync(DOC)) problems.push(path.relative(ROOT, DOC) + ' is missing');
  else {
    const doc = fs.readFileSync(DOC, 'utf8');
    if (renderDoc(build) !== doc) problems.push(path.relative(ROOT, DOC) + ' generated block is out of date; run node tools/build-store-package.js --doc');
    for (const section of popupSections()) {
      if (!doc.includes('| ' + section + ' |')) problems.push('popup section has no row in the single-purpose table: ' + section);
    }
  }
  // And the build itself, dry, from the staged candidate tree -- the same tree the package
  // completeness check inspects, so a change that is not yet committed is judged before it is.
  try {
    const tree = buildStoreTree({ treeish: git(['write-tree']).trim() });
    if (tree.dangling.length) problems.push('the Store tree has dangling references: ' + tree.dangling.join('; '));
    if (tree.stray.length) problems.push('the Store tree still names omitted files: ' + tree.stray.join('; '));
    for (const f of tree.omittedFiles) if (tree.files.has(f)) problems.push('omitted file still in the tree: ' + f);
  } catch (e) {
    problems.push('dry-run build failed: ' + (e && e.message || e));
  }
  if (problems.length) {
    for (const p of problems) console.error('store package: ' + p);
    process.exit(1);
  }
  console.log('store package ok: profile full in the repository, ' + storeOmitted(build).length + ' utilities omitted, guards present, doc current, dry-run build clean');
}

function main() {
  const args = process.argv.slice(2);
  if (args.includes('--check')) return check();
  const { build } = loadProfile();
  if (args.includes('--doc')) {
    fs.writeFileSync(DOC, renderDoc(build));
    console.log('wrote ' + path.relative(ROOT, DOC));
    return;
  }
  const outAt = args.indexOf('--out');
  const out = path.resolve(outAt >= 0 ? args[outAt + 1] : path.join(ROOT, 'WardenOne-store.zip'));
  const staged = args.includes('--staged');
  const tree = buildStoreTree({
    treeish: staged ? git(['write-tree']).trim() : 'HEAD',
    profileSource: git(['show', staged ? ':build-profile.js' : 'HEAD:build-profile.js']),
  });
  if (tree.dangling.length || tree.stray.length) {
    tree.dangling.forEach((d) => console.error('dangling: ' + d));
    tree.stray.forEach((d) => console.error('names an omitted file: ' + d));
    process.exit(1);
  }
  const { treeId, when } = writeZip(tree, out);
  console.log('wrote ' + out);
  console.log('  from ' + tree.treeish + ' as tree ' + treeId + ', entries dated ' + when);
  console.log('  omitted ' + tree.ids.join(', ') + ': ' + tree.omittedFiles.join(', '));
  console.log('  left out ' + (tree.removed.length - tree.omittedFiles.length) + ' non-runtime files; ' + tree.kept.length + ' files in the package');
}

module.exports = { loadProfile, storeOmitted, rewriteProfile, rewriteManifest, referencedFiles, buildStoreTree, writeZip, featureTable, renderDoc, popupSections, defaultConfigKeys, NON_RUNTIME };
if (require.main === module) main();
