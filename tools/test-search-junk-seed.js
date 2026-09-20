/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/*
 * The scraper pass's seed list arrives, and a list that cannot be read is said (BUG-10).
 * Run: node tools/test-search-junk-seed.js
 *      WARDENONE_BACKGROUND=<older background.js> WARDENONE_SEARCH_JUNK=<older search-junk.js> node tools/test-search-junk-seed.js
 *
 * search-junk.js, a content script, fetched its own packaged search-junk-domains.json through the
 * package URL. Since Chrome 85 a content script's fetch runs with the page's privileges, and a
 * packaged file that is not web-accessible is refused -- so the seed never arrived, the failure was
 * swallowed, the host set stayed empty and the pass switched itself off, while the popup toggle went
 * on reading "on" and nothing anywhere said otherwise. The manifest declares no web-accessible
 * resources, rightly: exposing the file to every page would have been the wrong fix.
 *
 * The worker reads the file now, where a packaged file can be read, and the seed travels inside the
 * content-config answer beside the runtime lists. A read that fails is remembered as a failure:
 * Protection Health names it while the switch is on, the activity record gets one entry per worker
 * life, and the next snapshot build tries again. The reader is driven here with a fake fetch through
 * every outcome, the merge is checked against the real packaged file, and the content script is held
 * to fetching nothing.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const BG_PATH = process.env.WARDENONE_BACKGROUND ? path.resolve(process.env.WARDENONE_BACKGROUND) : path.join(ROOT, 'background.js');
const SJ_PATH = process.env.WARDENONE_SEARCH_JUNK ? path.resolve(process.env.WARDENONE_SEARCH_JUNK) : path.join(ROOT, 'search-junk.js');
const BG = fs.readFileSync(BG_PATH, 'utf8');
const SEARCH_JUNK = fs.readFileSync(SJ_PATH, 'utf8');
const SEED_TEXT = fs.readFileSync(path.join(ROOT, 'search-junk-domains.json'), 'utf8');
const MANIFEST = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
const HISTORY = fs.readFileSync(path.join(ROOT, 'history.js'), 'utf8');
const POPUP_JS = fs.readFileSync(path.join(ROOT, 'popup.js'), 'utf8');
const GATE = fs.readFileSync(path.join(ROOT, 'tools', 'check-maintainability.js'), 'utf8');

let pass = 0;
const failures = [];
function check(name, cond, detail) {
  if (cond) { pass++; return; }
  failures.push(name + (detail === undefined ? '' : ' — ' + (typeof detail === 'string' ? detail : JSON.stringify(detail))));
}
let finished = false;
process.exitCode = 1;
process.on('exit', () => { if (!finished) console.log('  FAIL the suite stopped before it finished'); });

function balanced(src, start) {
  let depth = 0; let seen = false;
  for (let i = start; i < src.length; i++) {
    if (src[i] === '{') { depth++; seen = true; } else if (src[i] === '}') { depth--; if (seen && depth === 0) return src.slice(start, i + 1); }
  }
  throw new Error('unterminated block');
}
function lift(name) {
  const m = new RegExp('^[ \\t]*(?:async )?function ' + name + '\\(', 'm').exec(BG);
  return m ? balanced(BG, m.index) : null;
}
const line = (start) => { const m = new RegExp('^' + start.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[^\\n]*', 'm').exec(BG); return m ? m[0] : ''; };
const section = (name, fn) => { try { return fn(); } catch (e) { check(name, false, 'could not run: ' + (e && e.message || e)); return null; } };

/* A worker with a fake fetch that answers as told for the seed file. */
function realm(answer) {
  const state = { fetched: [], history: [], registered: [], config: null };
  const sandbox = {
    console: { warn() {} }, Object, Array, String, Number, JSON, Promise, Date, URL, Set, Map, Math,
    chrome: {
      runtime: { getURL: (p) => 'chrome-extension://wardenone/' + p, lastError: null },
      scripting: {
        getRegisteredContentScripts: async () => [],
        registerContentScripts: async (list) => { state.registered.push(...list.map((s) => s.id)); },
        updateContentScripts: async () => {}, unregisterContentScripts: async () => {},
      },
    },
    fetch: async (url) => {
      state.fetched.push(url);
      const a = typeof answer === 'function' ? answer(state.fetched.length) : answer;
      if (a === 'throw') throw new TypeError('Failed to fetch');
      if (a === '404') return { ok: false, status: 404, json: async () => ({}) };
      return { ok: true, status: 200, json: async () => JSON.parse(a) };
    },
    queueHistory: (e) => state.history.push(e),
    localGet: async () => ({ wardenone_config: state.config || {} }),
    DEFAULT_CONFIG: { enabled: true, flagSearchJunk: false, warnSearchResults: true },
    SEARCH_JUNK_MATCHES: ['*://www.google.com/search*'],
    normalizeSupplementalListDomain: (v) => { const h = String(v || '').trim().toLowerCase().replace(/^\*?\.?/, '').replace(/\/.*$/, ''); return /^[a-z0-9.-]+\.[a-z]{2,}$/.test(h) && h.indexOf('..') < 0 ? h : ''; },
    supplementalListCap: () => 5000,
  };
  vm.createContext(sandbox);
  const parts = [
    line('const SEARCH_JUNK_SEED_FILE'), line('const SEARCH_JUNK_SCRIPT_ID'), 'let __searchJunkSeed = null; let __searchJunkSeedReported = false;',
    lift('searchJunkSeed'), lift('searchJunkStoredHosts'), lift('sanitizeSupplementalBucket'), lift('sanitizeSearchJunkForContent'), lift('reconcileSearchJunkInjection'),
    'this.api = { seed: (typeof searchJunkSeed === "function" ? searchJunkSeed : null), stored: (typeof searchJunkStoredHosts === "function" ? searchJunkStoredHosts : null),'
    + ' sanitize: sanitizeSearchJunkForContent, reconcile: reconcileSearchJunkInjection };',
  ].filter(Boolean);
  vm.runInContext(parts.join('\n'), sandbox, { filename: 'seed-realm.js' });
  return { api: sandbox.api, state };
}
const SEED = JSON.parse(SEED_TEXT);

(async () => {
  console.log('\nsearch-junk seed list\n');

  /* ---- 1. the file itself --------------------------------------------------------------- */
  check('the packaged seed is well-formed and names scraper hosts', Array.isArray(SEED.scraperHosts) && SEED.scraperHosts.length >= 10 && SEED.scraperHosts.every((h) => /^[a-z0-9.-]+\.[a-z]{2,}$/.test(h)), SEED.scraperHosts && SEED.scraperHosts.length);
  check('the manifest exposes no packaged file to pages', !MANIFEST.web_accessible_resources || !MANIFEST.web_accessible_resources.some((e) => (e.resources || []).some((r) => /search-junk/.test(r))));

  /* ---- 2. the worker reads it, and says when it cannot ------------------------------------ */
  await section('reader', async () => {
    const ok = realm(SEED_TEXT);
    check('searchJunkSeed exists in the worker', typeof ok.api.seed === 'function');
    if (!ok.api.seed) return;
    const first = await ok.api.seed();
    check('the worker reads the packaged file by its own URL', ok.state.fetched[0] === 'chrome-extension://wardenone/search-junk-domains.json' && first.ok === true && first.hosts.length === SEED.scraperHosts.length, first);
    await ok.api.seed();
    check('...once per worker life when it succeeds', ok.state.fetched.length === 1);
    const merged = ok.api.sanitize(first.hosts.concat(ok.api.stored({ scraperHosts: ['added-by-reader.com', SEED.scraperHosts[0]] })));
    check('the seed and the stored list merge into one sanitised set, deduplicated', merged.length === SEED.scraperHosts.length + 1 && merged.includes('added-by-reader.com') && merged.includes(SEED.scraperHosts[0]), merged.length);
    check('the stored list is read in either shape it was written in', JSON.stringify(ok.api.stored(['a.com'])) === '["a.com"]' && JSON.stringify(ok.api.stored({ scraperHosts: ['b.com'] })) === '["b.com"]' && JSON.stringify(ok.api.stored(null)) === '[]');
    for (const [label, answer, expectError] of [['a missing file', '404', /HTTP 404/], ['a refused fetch', 'throw', /Failed to fetch/], ['a file with no hosts', '{"version":1,"scraperHosts":[]}', /no scraperHosts/], ['a file of the wrong shape', '{"hosts":["x.com"]}', /no scraperHosts/]]) {
      const r = realm(answer);
      const got = await r.api.seed();
      check(label + ' is a failure with a reason, not an empty success', got.ok === false && got.hosts.length === 0 && expectError.test(got.error), got);
    }
    const retry = realm((n) => (n === 1 ? '404' : SEED_TEXT));
    const a = await retry.api.seed();
    await new Promise((r) => setTimeout(r, 0));
    const b = await retry.api.seed();
    check('a failed read is tried again by the next caller, and a success is kept', a.ok === false && b.ok === true && retry.state.fetched.length === 2, [a.ok, b.ok, retry.state.fetched.length]);
  });

  /* ---- 3. the snapshot carries the merged list --------------------------------------------- */
  section('snapshot', () => {
    const snap = lift('sharedContentConfigSnapshot') || '';
    check('the shared snapshot reads the seed and merges it ahead of the stored list', /const seed = await searchJunkSeed\(\);/.test(snap) && /sanitizeSearchJunkForContent\(seed\.hosts\.concat\(searchJunkStoredHosts\(/.test(snap));
    check('the answer to the pages still carries searchJunkDomains under the same name', /searchJunkDomains: want\('searchJunk'\) \? shared\.searchJunkDomains : \[\]/.test(BG));
  });

  /* ---- 4. the pass is told, and so is the reader ------------------------------------------- */
  await section('reporting', async () => {
    const broken = realm('404');
    broken.state.config = { enabled: true, flagSearchJunk: true };
    await broken.api.reconcile(broken.state.config);
    await broken.api.reconcile(broken.state.config);
    const notes = broken.state.history.filter((h) => h.type === 'search_junk_seed_unavailable');
    check('with the switch on and the list unreadable, one activity record is written, once', notes.length === 1 && /could not be read/.test(notes[0].detail.why) && /HTTP 404/.test(notes[0].detail.error), broken.state.history);
    check('...and the script is still registered, because the warning pass and any added list still run', broken.state.registered.includes('wardenone-search-junk'));
    const off = realm('404');
    off.state.config = { enabled: true, flagSearchJunk: false };
    await off.api.reconcile(off.state.config);
    check('with the switch off nothing is recorded', off.state.history.length === 0);
    const fine = realm(SEED_TEXT);
    fine.state.config = { enabled: true, flagSearchJunk: true };
    await fine.api.reconcile(fine.state.config);
    check('with the file readable nothing is recorded', fine.state.history.length === 0);
    const health = lift('buildProtectionHealthSummary') || '';
    check('Protection Health names an unreadable list while the switch is on', /cfg\.flagSearchJunk === true[\s\S]{0,200}await searchJunkSeed\(\);[\s\S]{0,300}addIssue\('warn', 'Flag scraper results is on, but its packaged list/.test(health));
    check('the activity centre labels the record (it is a record, not a toast card, so the popup\'s card map leaves it alone)', /search_junk_seed_unavailable: 'Scraper list could not be read'/.test(HISTORY) && !/search_junk_seed_unavailable/.test(POPUP_JS));
    check('the integrity check knows the pass\'s three files', /'search-junk\.js', 'search-loggers\.js', 'search-junk-domains\.json'/.test(BG));
  });

  /* ---- 5. the content script fetches nothing ---------------------------------------------- */
  section('content script', () => {
    check('search-junk.js no longer reaches for its package URL', !/getURL/.test(SEARCH_JUNK) && !/fetch\(/.test(SEARCH_JUNK));
    check('...it takes the seed from the config answer, with the runtime lists', /addHosts\(response\.searchJunkDomains\);/.test(SEARCH_JUNK) && /addHosts\(aux && aux\.searchJunkDomainsExtra\);/.test(SEARCH_JUNK));
    check('...and still stands down when the worker had nothing to send, which the worker now reports', /if \(!Object\.keys\(hosts\)\.length\) \{ doJunk = false; return; \}/.test(SEARCH_JUNK));
    check('the swallowed-failure chain is gone', !/\.catch\(function \(\) \{\}\)/.test(SEARCH_JUNK));
    check('this suite is wired into the gate', /test-search-junk-seed\.js/.test(GATE));
  });

  finished = true;
  console.log('');
  if (failures.length) {
    for (const f of failures) console.log('  FAIL ' + f);
    console.log('\n' + failures.length + ' check(s) failed, ' + pass + ' passed');
    process.exit(1);
  }
  process.exitCode = 0;
  console.log('  ok  ' + pass + ' checks: the seed arrives with the answer, and a list that cannot be read is said');
})().catch((e) => { finished = true; console.error(e); process.exit(1); });
