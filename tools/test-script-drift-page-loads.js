/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/* Script Drift never fetches a script the page itself did not load. A 1v1 capture saw the worker
   refetch DoubleClick's gpt.js after WardenOne had blocked it for the page.
   Run: node tools/test-script-drift-page-loads.js */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const BG = fs.readFileSync(path.join(ROOT, 'background.js'), 'utf8');
const BRIDGE = fs.readFileSync(path.join(ROOT, 'bridge.js'), 'utf8');

let failures = 0;
function check(label, condition, extra) {
  if (condition) { console.log('  ok  ' + label); return; }
  failures++;
  console.log('  FAIL ' + label + (extra ? ' :: ' + extra : ''));
}

function lift(names) {
  return names.map((n) => {
    const m = new RegExp('(?:^|\\n)((?:async )?function ' + n + '\\s*\\([\\s\\S]*?\\n\\})', 'm').exec(BG);
    if (!m) throw new Error('could not lift ' + n);
    return m[1];
  }).join('\n');
}
function liftConst(name) {
  const m = new RegExp('const ' + name + ' = [^;]+;').exec(BG);
  if (!m) throw new Error('could not lift const ' + name);
  return m[0];
}

const ctx = { console: { warn() {}, log() {} }, URL, Date, Math, Object, Array, String, Number, JSON, Promise, RegExp, Map, Set };
ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext([
  ...['SCRIPT_DRIFT_TAB_LOADS', 'SCRIPT_DRIFT_TAB_LOADS_MAX', 'SCRIPT_DRIFT_FAILED_HOSTS_MAX', 'SCRIPT_DRIFT_MAX_PER_SCAN',
    'SCRIPT_DRIFT_RECHECK_MS', 'SCRIPT_DRIFT_SAFE_QUERY_KEYS', 'SCRIPT_DRIFT_DROP_QUERY_KEYS', 'SCRIPT_DRIFT_SECRET_QUERY_RE'].map(liftConst),
  'const DEFAULT_CONFIG = {};',
  'const WO_HISTORY = { epoch: 1, changing: false };',
  'let scriptDriftEraseGeneration = 0;',
  'const reg = (h) => String(h || "").toLowerCase().split(".").slice(-2).join(".");',
  'const messageCleanHost = (v) => { try { return reg(/:\\/\\//.test(v) ? new URL(v).hostname : v); } catch (_) { return ""; } };',
  'const siteIdentityBg = reg;',
  'const localGet = async () => ({ wardenone_config: {} });',
  'const hostMatchesAllowlist = () => false;',
  'const activeAllowlist = () => [];',
  'const isLocalOrPrivateHost = () => false;',
  'const loadScriptDriftBaselines = async () => ({ base: {}, pruned: 0 });',
  'const saveScriptDriftBaselines = async () => {};',
  'const scriptDriftKey = async (href) => href;',
  'globalThis.fetched = [];',
  'const fetchScriptForDrift = async (info) => { globalThis.fetched.push(info.host); return { ok: false, error: "stub" }; };',
  lift(['scriptDriftLooksVersioned', 'normalizeScriptDriftUrl', 'scriptDriftHost', 'scriptDriftNoteNavigation',
    'scriptDriftNoteFailedScript', 'scriptDriftNoteReplacement', 'handleScriptDriftScan']),
  'this.api = { scriptDriftNoteNavigation, scriptDriftNoteFailedScript, scriptDriftNoteReplacement, handleScriptDriftScan, SCRIPT_DRIFT_TAB_LOADS, SCRIPT_DRIFT_FAILED_HOSTS_MAX };',
].join('\n'), ctx);
const api = ctx.api;

const PAGE = 'https://news.example.com/story';
const sender = (url = PAGE, id = 7) => ({ tab: { id, url }, url });
const scripts = (...urls) => ({ scripts: urls.map((url) => ({ url })) });
const GPT = 'https://securepubads.g.doubleclick.net/tag/js/gpt.js';
const GTM = 'https://www.googletagmanager.com/gtm.js';
const LIB = 'https://cdn.jsdelivr.net/npm/lib/dist/lib.min.js';

(async () => {
  ctx.fetched = [];
  let res = await api.handleScriptDriftScan(sender(), scripts(GPT, LIB));
  check('a tab never seen loading is not scanned', ctx.fetched.length === 0 && res.ignored === 'unobserved', JSON.stringify(res));

  api.scriptDriftNoteNavigation({ tabId: 7, url: PAGE });
  api.scriptDriftNoteFailedScript({ tabId: 7, url: GPT });
  api.scriptDriftNoteReplacement({ tabId: 7, url: GTM, redirectUrl: 'chrome-extension://fixture/surrogate.js' });
  api.scriptDriftNoteReplacement({ tabId: 7, url: LIB, redirectUrl: 'https://cdn.jsdelivr.net/npm/lib@1.0.0/dist/lib.min.js' });
  ctx.fetched = [];
  await api.handleScriptDriftScan(sender(), scripts(GPT, GTM.replace('www.', ''), LIB));
  check('a script host blocked for the page is never fetched', !ctx.fetched.includes('securepubads.g.doubleclick.net'), ctx.fetched.join(' '));
  check('a local substitute prevents fetching the original host', !ctx.fetched.includes('googletagmanager.com'), ctx.fetched.join(' '));
  check('a script the page did load is still checked', ctx.fetched.includes('cdn.jsdelivr.net'), ctx.fetched.join(' '));

  ctx.fetched = [];
  await api.handleScriptDriftScan(sender('https://other.example.org/'), scripts(LIB));
  check('a record for another page is not trusted', ctx.fetched.length === 0, ctx.fetched.join(' '));

  api.scriptDriftNoteFailedScript({ tabId: 9, url: GPT });
  check('a failure in a tab with no navigation is not recorded', !api.SCRIPT_DRIFT_TAB_LOADS.has(9));

  api.scriptDriftNoteNavigation({ tabId: 7, url: PAGE });
  check('a new navigation starts a fresh record', api.SCRIPT_DRIFT_TAB_LOADS.get(7).failedHosts.size === 0);

  for (let i = 0; i <= api.SCRIPT_DRIFT_FAILED_HOSTS_MAX; i++) api.scriptDriftNoteFailedScript({ tabId: 7, url: 'https://t' + i + '.tracker.test/x.js' });
  ctx.fetched = [];
  res = await api.handleScriptDriftScan(sender(), scripts(LIB));
  check('past the failure cap the page is not scanned at all', ctx.fetched.length === 0 && res.ignored === 'unobserved', JSON.stringify(res));

  /* The listeners have to be registered at the top level so a worker woken by them records. */
  check('main frame navigations start the record',
    /registerListener\('script drift page navigations', \(\) => \{\s*chrome\.webRequest\.onBeforeRequest\.addListener\(scriptDriftNoteNavigation, \{ urls: \['<all_urls>'\], types: \['main_frame'\] \}\);/.test(BG));
  check('failed script requests are recorded',
    /registerListener\('script drift failed scripts', \(\) => \{\s*chrome\.webRequest\.onErrorOccurred\.addListener\(scriptDriftNoteFailedScript, \{ urls: \['<all_urls>'\], types: \['script'\] \}\);/.test(BG));

  /* bridge.js: scripts the page never requests are not offered to the worker. */
  const start = BRIDGE.indexOf('const regSite =');
  const end = BRIDGE.indexOf('const showScriptDriftWarning', start);
  const page = { console, URL, Set };
  page.siteIdentity = (h) => String(h || '').split('.').slice(-2).join('.');
  page.location = { hostname: 'news.example.com', href: PAGE, protocol: 'https:' };
  page.document = { scripts: [
    { src: LIB }, { src: 'https://cdn.consent.test/tracker.js', type: 'text/plain' },
    { src: 'https://cdn.module.test/app.js', type: 'module' }, { src: 'https://cdn.legacy.test/old.js', noModule: true },
    { src: 'https://cdn.typed.test/t.js', type: 'text/javascript' }, { src: 'https://cdn.data.test/d.json', type: 'application/json' },
  ] };
  vm.createContext(page);
  vm.runInContext(BRIDGE.slice(start, end) + '\nthis.collect = collectScriptUrls;', page);
  const offered = Array.from(page.collect(), (s) => new URL(s.url).hostname);
  check('ordinary, module and text/javascript scripts are offered',
    ['cdn.jsdelivr.net', 'cdn.module.test', 'cdn.typed.test'].every((h) => offered.includes(h)), offered.join(' '));
  check('text/plain, JSON and nomodule scripts are not offered',
    !['cdn.consent.test', 'cdn.data.test', 'cdn.legacy.test'].some((h) => offered.includes(h)), offered.join(' '));

  console.log(failures ? '\nScript Drift page loads: ' + failures + ' FAILED' : '\nScript Drift page loads: all checks passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
