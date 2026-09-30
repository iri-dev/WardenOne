/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/*
 * The Store package carries one purpose, and the code knows which package it is in (CWS-03).
 * Run: node tools/test-store-profile.js
 *
 * Chrome's Web Store allows one narrow purpose per extension. The Store package includes
 * EyeShield's display settings and Memory Shield's resource controls, including Tab Limit, and
 * omits Twitch Rewind. That is only honest if the code runs with exactly those choices, so this
 * suite does three things. It builds the Store tree the way the tool does and checks what is and is
 * not in it. It lifts the worker's guarded paths and the popup's applier and runs them under the
 * Store profile -- the module loader, the memory-* messages, the tab menu, EyeShield's registration,
 * the integrity list -- and again under the full profile, where none of them may change anything.
 * And it builds the zip twice and compares the bytes, because "deterministic" is a claim with a test.
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const BG = fs.readFileSync(path.join(ROOT, 'background.js'), 'utf8');
const POPUP_JS = fs.readFileSync(path.join(ROOT, 'popup.js'), 'utf8');
const POPUP_HTML = fs.readFileSync(path.join(ROOT, 'popup.html'), 'utf8');
const README = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');
const CHANGELOG = fs.readFileSync(path.join(ROOT, 'CHANGELOG.md'), 'utf8');
const GATE = fs.readFileSync(path.join(ROOT, 'tools', 'check-maintainability.js'), 'utf8');
const ATTRIBUTES = fs.readFileSync(path.join(ROOT, '.gitattributes'), 'utf8');
const DOC = fs.existsSync(path.join(ROOT, 'docs', 'store-single-purpose.md')) ? fs.readFileSync(path.join(ROOT, 'docs', 'store-single-purpose.md'), 'utf8') : '';
const { h, makeDocument } = require('./lib/mini-dom.js');

let pass = 0;
const failures = [];
function check(name, cond, detail) {
  if (cond) { pass++; return; }
  failures.push(name + (detail === undefined ? '' : ' — ' + (typeof detail === 'string' ? detail : JSON.stringify(detail))));
}
let finished = false;
process.exitCode = 1;
process.on('exit', () => { if (!finished) console.log('  FAIL the suite stopped before it finished'); });
const pending = [];
function section(name, fn) {
  try {
    const r = fn();
    if (r && typeof r.then === 'function') pending.push(r.catch((e) => { check(name, false, 'could not run: ' + (e && e.message || e)); }));
  } catch (e) { check(name, false, 'could not run: ' + (e && e.message || e)); }
}
/* The entry names of a zip, from its local file headers: enough to say what the archive holds. */
function zipEntries(buf) {
  const names = [];
  let at = 0;
  while ((at = buf.indexOf('PK\u0003\u0004', at, 'latin1')) !== -1) {
    const nameLen = buf.readUInt16LE(at + 26);
    const extraLen = buf.readUInt16LE(at + 28);
    names.push(buf.slice(at + 30, at + 30 + nameLen).toString('utf8'));
    at += 30 + nameLen + extraLen;
  }
  return names;
}
function balanced(src, start) {
  let depth = 0; let seen = false;
  for (let i = start; i < src.length; i++) {
    if (src[i] === '{') { depth++; seen = true; } else if (src[i] === '}') { depth--; if (seen && depth === 0) return src.slice(start, i + 1); }
  }
  throw new Error('unterminated block');
}
function grabFn(src, name) {
  const m = new RegExp('^[ \\t]*(?:async )?function ' + name + '\\(', 'm').exec(src);
  if (!m) throw new Error('missing ' + name);
  return balanced(src, m.index);
}
function between(src, from, to, what) {
  const i = src.indexOf(from);
  const j = i >= 0 ? src.indexOf(to, i + from.length) : -1;
  if (i < 0 || j < 0) throw new Error((what || from) + ' moved');
  return src.slice(i, j);
}

let tool = null;
try { tool = require('./build-store-package.js'); } catch (e) { check('the Store build tool loads', false, String(e && e.message)); }
const PROFILE_TEXT = fs.existsSync(path.join(ROOT, 'build-profile.js')) ? fs.readFileSync(path.join(ROOT, 'build-profile.js'), 'utf8') : '';
const FEATURE_IDS = ['eyeShield', 'memoryShield', 'tabLimit', 'twitchRewind'];
const STORE_IDS = ['twitchRewind'];
/* The profile as the package would carry it: the repository text for the full build, the tool's
   rewrite for the Store build. */
function profileSource(store) {
  return store && tool ? tool.rewriteProfile(PROFILE_TEXT, STORE_IDS) : PROFILE_TEXT;
}

/* ---- 1. the decision record ---------------------------------------------------------- */
section('the profile', () => {
  check('build-profile.js exists', PROFILE_TEXT.length > 0);
  const { build } = tool.loadProfile();
  check('the repository copy is the full build', build.profile === 'full' && build.omitted.length === 0, [build.profile, build.omitted]);
  check('it records the four utilities the audit named', JSON.stringify(Object.keys(build.features)) === JSON.stringify(FEATURE_IDS), Object.keys(build.features));
  check('each carries a goal in words', FEATURE_IDS.every((id) => /\w+ ?: .{20,}/.test(build.features[id].goal)));
  check('EyeShield and resource controls are included; only replay is omitted', ['eyeShield', 'memoryShield', 'tabLimit'].every((id) => build.features[id].store === 'include') && JSON.stringify(tool.storeOmitted(build)) === JSON.stringify(STORE_IDS));
  const store = tool.loadProfile(profileSource(true)).build;
  check('the Store rewrite omits only replay', store.profile === 'store' && JSON.stringify(store.omitted) === JSON.stringify(STORE_IDS));
  check('the rewrite touches only the two marked lines', PROFILE_TEXT.split('\n').length === profileSource(true).split('\n').length
    && PROFILE_TEXT.replace(/profile: 'full',\n  omitted: Object\.freeze\(\[\]\),/, '') === profileSource(true).replace(/profile: 'store',\n  omitted: Object\.freeze\(\[[^\]]*\]\),/, ''));
});

/* ---- 2. the Store tree ------------------------------------------------------------------ */
let TREE = null;
section('the Store tree', () => {
  const staged = spawnSync('git', ['write-tree'], { cwd: ROOT, encoding: 'utf8' });
  if (staged.status !== 0) throw new Error('git write-tree failed');
  TREE = tool.buildStoreTree({ treeish: staged.stdout.trim() });
  check('the replay files are gone', ['twitch-rewind.js', 'twitch-vod-rewind.js'].every((f) => TREE.removed.includes(f) && !TREE.files.has(f)), TREE.omittedFiles);
  check('the Memory Shield module remains', TREE.files.has('background-memory.js') && !TREE.removed.includes('background-memory.js'));
  check('EyeShield and its preload files remain', ['eyeshield.js', 'eyeshield-sites.js', 'eyeshield-preload-dark.js', 'eyeshield-preload-ultra.js', 'eyeshield-preload-light.js'].every((f) => TREE.files.has(f) && !TREE.removed.includes(f)));
  check('tooling, sources, docs, the site and the workflow are not in the package', !Array.from(TREE.files.keys()).some((f) => /^(?:tools|src|docs|site|\.github)\//.test(f)));
  check('the runtime is', ['manifest.json', 'background.js', 'content.min.js', 'popup.html', 'popup.js', 'build-profile.js', 'domain-utils.js', 'psl-private.js', 'bridge.js', 'anti-redirect.js', 'LICENSE', 'NOTICE', 'PRIVACY.md'].every((f) => TREE.files.has(f)));
  /* Every document in the package is there on purpose (REL-03): the repository's own notes are not. */
  check('the changelog, the security policy and the support note are not in the package', ['CHANGELOG.md', 'SECURITY.md', 'SUPPORT.md', 'README.md'].every((f) => !TREE.files.has(f) && TREE.removed.includes(f)));
  check('the manifest no longer injects Twitch Rewind', !TREE.manifest.content_scripts.some((e) => (e.js || []).some((f) => /rewind/.test(f))));
  check('...and every other content script survived', TREE.manifest.content_scripts.length >= 6 && TREE.manifest.content_scripts.some((e) => (e.js || []).includes('anti-redirect.js')));
  check('the profile inside the package says store', /profile: 'store'/.test(TREE.files.get('build-profile.js')) && /omitted: Object\.freeze\(\['twitchRewind'\]\)/.test(TREE.files.get('build-profile.js')));
  check('nothing left asks for a file that is gone', TREE.dangling.length === 0, TREE.dangling);
  check('nothing left names an omitted file outside the guarded loaders', TREE.stray.length === 0, TREE.stray);
});

/* ---- 3. the worker under each profile --------------------------------------------------- */
function workerRealm(store, extra) {
  const state = { imported: [], registered: [], unregistered: [], responses: [], created: [] };
  const sandbox = Object.assign({
    Object, String, Array, Number, JSON, Promise, Math, console,
    importScripts: (file) => { state.imported.push(file); if (extra && extra.importThrows) throw new Error('NetworkError: ' + file); },
    chrome: {
      runtime: { getManifest: () => ({ version: '1.0.1' }), lastError: null, getURL: (p) => 'chrome-extension://x/' + p },
      scripting: {
        registerContentScripts: async (list) => { state.registered.push(...list.map((s) => s.id)); },
        unregisterContentScripts: async (o) => { state.unregistered.push(...(o.ids || [])); },
        getRegisteredContentScripts: async () => [],
      },
      tabs: { query: (q, cb) => cb([]) },
    },
    localGet: async () => ({ wardenone_config: { enabled: true, eyeShield: true, eyeShieldMode: 'dark' } }),
    EYESHIELD_SCRIPT_ID: 'wo-eyeshield-dynamic', EYESHIELD_SITES_SCRIPT_ID: 'wo-eyeshield-sites-dynamic',
    eyeShieldThemingActive: () => true,
    injectEyeShieldIntoOpenTabs: () => { state.injected = true; },
    WO_MENU_ZAP: 'zap', WO_MENU_COPY_LINK: 'copy', WO_MENU_LINK: 'link', WO_MENU_SELECTION: 'sel', WO_MENU_MEDIA: 'media', WO_MENU_FRAME: 'frame',
    WO_MENU_SLEEP_TAB: 'sleep', WO_MENU_NEVER_SLEEP: 'never', WO_MENU_CLOSE_TAB: 'close', WO_MENU_BLOCK: 'block',
    state,
  }, extra || {});
  vm.createContext(sandbox);
  const parts = [profileSource(store)];
  parts.push(between(BG, 'const MODULE_LOADED = { memory: false };', '\n// ---- Forget Me When I Leave', 'the module loader'));
  parts.push(between(BG, 'const WO_MENU_ITEMS = [', '\n/* Built only when the definition changed', 'the menu table'));
  parts.push(grabFn(BG, 'wardenMenuFingerprint'));
  // The registration's file list and its helpers (the preload hint file per mode, PRIV-12).
  parts.push(between(BG, 'const EYESHIELD_PRELOAD_MODES = [', ';', 'the preload mode list') + ';');
  parts.push(grabFn(BG, 'eyeShieldPreloadFile'));
  parts.push(grabFn(BG, 'eyeShieldScriptFiles'));
  parts.push(grabFn(BG, 'eraseEyeShieldSiteMarkerFromOpenTabs'));
  parts.push(grabFn(BG, 'reconcileEyeShieldInjection'));
  // The integrity list, as the repair handler assembles it, up to the loop that fetches it.
  parts.push('async function coreFiles() {' + between(BG, 'const CORE_FILES = [', '\n      // 1. core files present', 'the integrity list') + '\nreturn CORE_FILES; }');
  // The message guard, alone: the first statement of the memory-* block.
  const guard = between(BG, "if (msg && msg.kind && (woOmittedMessage(msg.kind)", "if (msg && msg.kind === 'memory-score')", 'the message guard');
  parts.push('function guardMessage(msg, sendResponse) {' + guard + '\nreturn false; }');
  parts.push('this.api = { MODULE_LOADED, WO_MENU_ITEMS, wardenMenuFingerprint, reconcileEyeShieldInjection, coreFiles, guardMessage, woFeatureOmitted, woOmittedFiles, woOmittedMessage, WARDENONE_BUILD };');
  vm.runInContext(parts.join('\n'), sandbox, { filename: 'worker-' + (store ? 'store' : 'full') + '.js' });
  return { api: sandbox.api, state };
}

section('the Store worker with resource protection', () => {
  const w = workerRealm(true);
  check('the Store worker imports background-memory.js', w.state.imported.includes('background-memory.js') && w.api.MODULE_LOADED.memory === true, w.state.imported);
  const responses = [];
  const handled = w.api.guardMessage({ kind: 'memory-score' }, (r) => responses.push(r));
  check('memory-score reaches its module', handled === false && responses.length === 0, responses);
  const other = [];
  check('a message for anything else passes the guard', w.api.guardMessage({ kind: 'tracker-learner-status' }, (r) => other.push(r)) === false && other.length === 0);
  const ids = w.api.WO_MENU_ITEMS.map((i) => i.id);
  check('the tab menu keeps its sleep, never-sleep and close actions', ids.includes('sleep') && ids.includes('never') && ids.includes('close') && ids.includes('wardenone-sep-tab') && ids.includes('block') && ids.includes('zap'), ids);
  return w.api.reconcileEyeShieldInjection({ enabled: true, eyeShield: true }).then(() => {
    check('EyeShield stays active in the Store worker', w.state.registered.includes('wo-eyeshield-dynamic') && w.state.unregistered.length === 0, w.state);
    return w.api.coreFiles();
  }).then((files) => {
    check('the integrity list asks for none of the omitted files', !files.some((f) => ['twitch-rewind.js', 'twitch-vod-rewind.js'].includes(f)), files.filter((f) => /rewind/.test(f)));
    check('the integrity list still asks for Memory Shield', files.includes('background-memory.js'));
    check('the integrity list still asks for EyeShield and its preloads', ['eyeshield.js', 'eyeshield-preload-dark.js', 'eyeshield-preload-ultra.js', 'eyeshield-preload-light.js'].every((f) => files.includes(f)));
    check('...and does ask for the profile', files.includes('build-profile.js') && files.includes('background.js'));
  });
});

section('the worker with everything, and the module missing anyway', () => {
  const full = workerRealm(false);
  check('the full worker imports the module', full.state.imported.includes('background-memory.js') && full.api.MODULE_LOADED.memory === true);
  const ids = full.api.WO_MENU_ITEMS.map((i) => i.id);
  check('...and offers the whole menu', ids.includes('sleep') && ids.includes('never') && ids.includes('close') && ids.includes('wardenone-sep-tab'));
  check('the menu fingerprint is the same when both packages have Memory Shield', full.api.wardenMenuFingerprint(true) === workerRealm(true).api.wardenMenuFingerprint(true));
  const broken = workerRealm(false, { importThrows: true });
  check('a full build whose module file is missing still starts, with the module marked absent', broken.api.MODULE_LOADED.memory === false);
  const handled = [];
  broken.api.guardMessage({ kind: 'memory-free-ram' }, (r) => handled.push(r));
  check('...and answers memory-* honestly rather than throwing', handled.length === 1 && handled[0].ok === false);
  return full.api.reconcileEyeShieldInjection({ enabled: true, eyeShield: true }).then(() => {
    check('the full worker registers EyeShield as before', full.state.registered.includes('wo-eyeshield-dynamic') && full.state.unregistered.length === 0);
    return full.api.coreFiles();
  }).then((files) => {
    check('...and its integrity list still names every file', ['eyeshield.js', 'background-memory.js', 'twitch-rewind.js', 'build-profile.js'].every((f) => files.includes(f)));
  });
});

section('the worker source', () => {
  const alarm = between(BG, "if (alarm && alarm.name === 'wardenone-memory-sweep') {", 'getMemoryConfig()', 'the sweep alarm branch');
  check('the sweep alarm does nothing without the module', /if \(!MODULE_LOADED\.memory\) return;/.test(alarm));
  for (const name of ['runWardenTabSleep', 'runWardenTabClose', 'toggleWardenNeverSleep', 'refreshWardenNeverSleepMenuTitle']) {
    check(name + ' returns before touching the module when it is absent', /^\s*if \(!MODULE_LOADED\.memory\) return;/m.test(grabFn(BG, name).split('\n').slice(1, 3).join('\n')), grabFn(BG, name).split('\n').slice(0, 3));
  }
  const settings = between(BG, 'if (MODULE_LOADED.memory && n.tabLimitGuard', 'reconcileMemorySweepAlarm();', 'the settings guards');
  check('settings changes reach the module only when it loaded', /MODULE_LOADED\.memory && \(o\.memoryShield !== n\.memoryShield/.test(settings));
  check('the worker imports the profile before the modules it gates', BG.indexOf("importScripts('build-profile.js')") > 0 && BG.indexOf("importScripts('build-profile.js')") < BG.indexOf('importScripts("background-memory.js")'));
  check('injectEyeShieldIntoOpenTabs is a no-op without EyeShield', /function injectEyeShieldIntoOpenTabs\(\) \{\s*if \(woFeatureOmitted\('eyeShield'\)\) return;/.test(BG));
});

/* ---- 4. the popup ----------------------------------------------------------------------- */
function popupRealm(store) {
  const doc = makeDocument('chrome-extension://x/popup.html', [
    h('h2', { id: 'eyeshield-title', 'data-feature': 'eyeShield' }, ['EyeShield']),
    h('section', { id: 'eyeshield-panel', 'data-feature': 'eyeShield' }, [h('button', { class: 'eyeshield-mode' })]),
    h('details', { class: 'rewind-drop', 'data-feature': 'twitchRewind' }, [h('input', { 'data-key': 'twitchRewind' })]),
    h('h2', { id: 'mem-title', 'data-feature': 'memoryShield', 'data-feature-fallback': 'Resource Saver' }, ['Memory Shield']),
    h('div', { class: 'row', 'data-feature': 'memoryShield' }, [h('input', { 'data-key': 'memoryShield' })]),
    h('div', { class: 'row', 'data-feature': 'tabLimit' }, [h('input', { id: 'tl-guard' })]),
    h('div', { class: 'row', 'data-feature': 'memoryShield' }, [h('div', { id: 'mem-score' })]),
    h('div', { class: 'row', id: 'resource-saver' }, [h('input', { 'data-key': 'throttleBackgroundTabs' })]),
    h('h2', { id: 'privacy-title' }, ['Privacy']),
  ]);
  const sandbox = { document: doc, Object, String, Array, console };
  vm.createContext(sandbox);
  vm.runInContext(profileSource(store) + '\n' + grabFn(POPUP_JS, 'applyBuildProfile') + '\nthis.omitted = applyBuildProfile();', sandbox);
  return { doc, omitted: sandbox.omitted };
}
section('the popup', () => {
  const store = popupRealm(true);
  const q = (s) => store.doc.querySelectorAll(s);
  check('under the Store profile the EyeShield heading and panel remain', q('#eyeshield-title').length === 1 && q('#eyeshield-panel').length === 1);
  check('...the Twitch Rewind block is gone', q('.rewind-drop').length === 0 && q('input[data-key="twitchRewind"]').length === 0);
  check('...Memory Shield and Tab Limit controls remain', q('input[data-key="memoryShield"]').length === 1 && q('#tl-guard').length === 1 && q('#mem-score').length === 1);
  check('...the Memory Shield heading remains', q('#mem-title').length === 1 && q('#mem-title')[0].textContent === 'Memory Shield');
  check('...the Resource Saver row and the rest of the popup stay', q('#resource-saver').length === 1 && q('#privacy-title').length === 1);
  check('...and the applier reports what it removed', JSON.stringify(store.omitted) === JSON.stringify(STORE_IDS));
  const full = popupRealm(false);
  const fq = (s) => full.doc.querySelectorAll(s);
  check('under the full profile nothing moves', fq('#eyeshield-panel').length === 1 && fq('.rewind-drop').length === 1 && fq('#tl-guard').length === 1 && fq('#mem-title')[0].textContent === 'Memory Shield' && full.omitted.length === 0);
  check('the popup loads the profile before its own script', POPUP_HTML.indexOf('<script src="build-profile.js"></script>') > 0 && POPUP_HTML.indexOf('<script src="build-profile.js"></script>') < POPUP_HTML.indexOf('<script src="popup.js"></script>'));
  check('the applier runs before anything paints', /const OMITTED_FEATURES = applyBuildProfile\(\);/.test(POPUP_JS) && POPUP_JS.indexOf('const OMITTED_FEATURES = applyBuildProfile();') < POPUP_JS.indexOf('(function initMemoryShield() {'));
  /* Every control for an omitted setting in the real popup sits under a marked element. */
  const { build } = tool.loadProfile();
  const unmarked = [];
  const controls = [];
  for (const id of STORE_IDS) build.features[id].keys.forEach((k) => controls.push('data-key="' + k + '"'));
  ['id="tr-minutes"'].forEach((c) => controls.push(c));
  for (const c of controls) {
    const at = POPUP_HTML.indexOf(c);
    if (at < 0) continue;   // a setting with no control of its own (per-host maps, the mode string)
    const before = POPUP_HTML.slice(0, at);
    const marker = before.lastIndexOf('data-feature="');
    const heading = before.lastIndexOf('<h2');
    // Inside a marked element: the nearest marker comes after the nearest section heading, or the
    // heading itself is the marked element.
    const headingMarked = heading >= 0 && /<h2[^>]*data-feature=/.test(POPUP_HTML.slice(heading, POPUP_HTML.indexOf('>', heading) + 1));
    if (!(marker > heading || headingMarked)) unmarked.push(c);
  }
  check('every control of an omitted setting in the real popup sits under a marked element', unmarked.length === 0, unmarked);
});

/* ---- 5. the zip, twice ------------------------------------------------------------------ */
section('determinism', () => {
  if (!TREE) throw new Error('no tree');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wardenone-store-'));
  try {
    const a = path.join(dir, 'a.zip');
    const b = path.join(dir, 'b.zip');
    tool.writeZip(TREE, a);
    tool.writeZip(TREE, b);
    const ha = crypto.createHash('sha256').update(fs.readFileSync(a)).digest('hex');
    const hb = crypto.createHash('sha256').update(fs.readFileSync(b)).digest('hex');
    check('two builds of one tree are byte-identical', ha === hb && fs.statSync(a).size > 100000, [ha.slice(0, 12), hb.slice(0, 12)]);
    const names = zipEntries(fs.readFileSync(a));
    check('the archive carries EyeShield and Memory Shield and excludes replay', names.includes('manifest.json') && names.includes('build-profile.js') && names.includes('background.js') && names.includes('background-memory.js')
      && ['eyeshield.js', 'eyeshield-sites.js', 'eyeshield-preload-dark.js', 'eyeshield-preload-ultra.js', 'eyeshield-preload-light.js'].every((n) => names.includes(n))
      && !names.some((n) => ['twitch-rewind.js', 'twitch-vod-rewind.js'].includes(n)), names.filter((n) => /eyeshield|memory|rewind/.test(n)));
    check('...and no tooling, sources or docs', !names.some((n) => /^(?:tools|src|docs|site|\.github)\//.test(n)), names.filter((n) => /^(?:tools|src|docs|site|\.github)\//.test(n)).slice(0, 5));
    check('manifest.json sits at the root of the archive', names.includes('manifest.json') && !names.some((n) => /\/manifest\.json$/.test(n)));
    check('the entry count matches the tree', names.filter((n) => !n.endsWith('/')).length === TREE.kept.length, [names.filter((n) => !n.endsWith('/')).length, TREE.kept.length]);
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
  }
});

/* ---- 6. what the reader and the reviewer are told ---------------------------------------- */
section('the record', () => {
  check('the decision page exists and states the purpose', /WardenOne helps readers browse with more control/.test(DOC) && /## The decision/.test(DOC));
  check('...records all four utility decisions', FEATURE_IDS.every((id) => DOC.includes('`' + id + '`')) && ['eyeShield', 'memoryShield', 'tabLimit'].every((id) => new RegExp('`' + id + '`\\) \\| Included').test(DOC)) && /Twitch Rewind \(`twitchRewind`\) \| Omitted/.test(DOC));
  check('...has a row for every popup section', tool.popupSections().every((s) => DOC.includes('| ' + s + ' |')), tool.popupSections().filter((s) => !DOC.includes('| ' + s + ' |')));
  check('...and says the GitHub build is unchanged', /GitHub build is unchanged/.test(DOC));
  check('the README points at the Store package and the record', /build-store-package\.js/.test(README) && /store-single-purpose\.md/.test(README));
  check('the CHANGELOG records it', /Store package/.test(CHANGELOG) && /build-store-package/.test(CHANGELOG));
  const trackedIgnore = spawnSync('git', ['ls-files', '--error-unmatch', '.gitignore'], { cwd: ROOT, encoding: 'utf8' });
  check('ignore rules stay local', trackedIgnore.status !== 0);
  check('the default Store ZIP cannot enter either package', /^WardenOne-store\.zip export-ignore$/m.test(ATTRIBUTES)
    && tool.NON_RUNTIME.some((pattern) => pattern.test('WardenOne-store.zip')));
  check('the gate runs the tool\'s check and this suite', /build-store-package\.js', '--check'/.test(GATE) && /test-store-profile\.js/.test(GATE));
});

(async () => {
  await Promise.all(pending);
  finished = true;
  console.log('');
  if (failures.length) {
    for (const f of failures) console.log('  FAIL ' + f);
    console.log('\n' + failures.length + ' check(s) failed, ' + pass + ' passed');
    process.exit(1);
  }
  process.exitCode = 0;
  console.log('  ok  ' + pass + ' checks: the Store package carries one purpose, and the code knows which package it is in');
})();
