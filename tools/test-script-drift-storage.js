/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/*
 * Script Drift must keep a record of the script, never a record of where you have been.
 *
 * The baseline store was keyed by the exact third-party script URL and each record carried
 * a seenOn list of up to eight first-party sites. At 700 baselines that is 5,600 site-to-
 * script relationships -- a readable map of the reader's browsing -- and nothing in the
 * product ever read a single one of them. host, displayUrl, versioned, previousHash and
 * firstSeen were the same story: written on every check, read by nothing, because the
 * warning builds its text from the CURRENT fetch. Meanwhile PRIVACY.md said "only the hash
 * is kept" (PRIV-02).
 *
 * What is asserted here:
 *   - the record contains only fields something reads back
 *   - the key is a digest, so the file is not a list of URLs the browser fetched
 *   - old records -- legacy-keyed, stale, or carrying the graph -- are purged on read,
 *     and the purge is persisted rather than waiting for the next drift
 *   - drift detection still works, which is the thing all of this must not cost
 *
 * Run: node tools/test-script-drift-storage.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const BG = fs.readFileSync(path.join(ROOT, 'background.js'), 'utf8');
const PRIVACY = fs.readFileSync(path.join(ROOT, 'PRIVACY.md'), 'utf8');

let failures = 0;
function check(label, condition, extra) {
  if (condition) { console.log('  ok  ' + label); return; }
  failures++;
  console.log('  FAIL ' + label + (extra ? ' :: ' + extra : ''));
}

/* ---- run the shipped storage functions ------------------------------------------ */

function lift(names) {
  const parts = [];
  for (const n of names) {
    const re = new RegExp('(?:^|\\n)((?:async )?function ' + n + '\\s*\\([\\s\\S]*?\\n\\})', 'm');
    const m = re.exec(BG);
    if (!m) throw new Error('could not lift ' + n);
    parts.push(m[1]);
  }
  return parts.join('\n');
}

const ctx = {
  console: { warn() {}, log() {} },
  Date, Math, Object, Array, String, Number, JSON, Promise, RegExp,
};
ctx.globalThis = ctx;
vm.createContext(ctx);

let STORE = {};
vm.runInContext([
  'const SCRIPT_DRIFT_BASELINE_KEY = "wardenone_script_drift_baselines";',
  'const SCRIPT_DRIFT_MAX_BASELINES = 700;',
  /* Lifted from the source rather than restated, so the age this asserts is the age that
     ships. Missing it made loadScriptDriftBaselines throw into its own .catch and return
     an empty store -- which several of the checks below then passed on trivially. */
  (/const SCRIPT_DRIFT_MAX_AGE_MS = [^;]+;/.exec(BG) || [''])[0],
  'let __written = null;',
  'const localGet = (k) => Promise.resolve(globalThis.__store);',
  'const localSet = (o) => { __written = o[SCRIPT_DRIFT_BASELINE_KEY]; return Promise.resolve(); };',
  'const sha256TextHex = async (t) => { let h = 2166136261 >>> 0;'
  + ' for (let i = 0; i < t.length; i++) { h = Math.imul(h ^ t.charCodeAt(i), 16777619) >>> 0; }'
  + ' return (h.toString(16).padStart(8, "0")).repeat(8).slice(0, 64); };',
  lift(['scriptDriftKey', 'scriptDriftFresh', 'scriptDriftLegacyKey',
    'loadScriptDriftBaselines', 'saveScriptDriftBaselines']),
  'globalThis.api = { scriptDriftKey, scriptDriftFresh, scriptDriftLegacyKey,'
  + ' loadScriptDriftBaselines, saveScriptDriftBaselines, written: () => __written };',
].join('\n'), ctx);

const api = ctx.api;
const DAY = 24 * 60 * 60 * 1000;

(async () => {
  /* ---- the key is a digest, not a URL ------------------------------------------- */
  const key = await api.scriptDriftKey('https://cdn.example.test/lib/analytics.v3.js');
  check('the key is a fixed-length digest', /^[0-9a-f]{32}$/.test(key), key);
  check('and carries none of the URL', !/example|analytics|cdn/.test(key), key);
  check('the same URL keys the same record',
    key === await api.scriptDriftKey('https://cdn.example.test/lib/analytics.v3.js'));
  check('a different URL keys a different record',
    key !== await api.scriptDriftKey('https://cdn.example.test/lib/other.js'));

  /* ---- old records are purged on read ------------------------------------------- */
  const now = Date.now();
  ctx.__store = {
    wardenone_script_drift_baselines: {
      /* the old format: keyed by the raw URL, carrying the browsing graph */
      'https://cdn.example.test/a.js': {
        hash: 'aaa', bytes: 10, lastSeen: now,
        seenOn: ['bank.example', 'health.example', 'forum.example'],
        displayUrl: 'https://cdn.example.test/a.js', host: 'cdn.example.test',
      },
      /* new format but stale */
      ['b'.repeat(32)]: { hash: 'bbb', bytes: 20, lastSeen: now - (40 * DAY) },
      /* new format, fresh, clean -- the only one that should survive */
      ['c'.repeat(32)]: { hash: 'ccc', bytes: 30, lastSeen: now - DAY, indicators: [], outboundHosts: [] },
      /* new format and fresh, but still carrying a graph from a part-upgraded install */
      ['d'.repeat(32)]: { hash: 'ddd', bytes: 40, lastSeen: now, seenOn: ['shop.example'] },
    },
  };

  const loaded = await api.loadScriptDriftBaselines();
  const keys = Object.keys(loaded.base);
  check('only the clean, fresh, digest-keyed record survives',
    keys.length === 1 && keys[0] === 'c'.repeat(32), keys.join(', '));
  check('the raw-URL record is gone',
    !keys.some((k) => /[:/]/.test(k)), keys.join(', '));
  check('no surviving record carries a first-party site list',
    Object.values(loaded.base).every((v) => v.seenOn === undefined));
  check('the purge is reported so it can be persisted', loaded.pruned === 3,
    'pruned=' + loaded.pruned + ' -- without this the dropped records sit in storage'
    + ' until something else happens to write');

  /* ---- the write path drops them too -------------------------------------------- */
  await api.saveScriptDriftBaselines({
    'https://cdn.example.test/legacy.js': { hash: 'x', lastSeen: now },
    ['e'.repeat(32)]: { hash: 'eee', lastSeen: now - (60 * DAY) },
    ['f'.repeat(32)]: { hash: 'fff', lastSeen: now },
  });
  const written = api.written();
  check('saving keeps only fresh digest-keyed records',
    Object.keys(written).length === 1 && Object.keys(written)[0] === 'f'.repeat(32),
    Object.keys(written).join(', '));

  /* ---- the age cut behaves ------------------------------------------------------ */
  check('a record seen today is fresh', api.scriptDriftFresh({ hash: 'h', lastSeen: now }, now));
  check('a record not seen for a month is not',
    !api.scriptDriftFresh({ hash: 'h', lastSeen: now - (31 * DAY) }, now));
  check('a record with no hash is never fresh',
    !api.scriptDriftFresh({ lastSeen: now }, now));

  /* ---- the shape of what is written --------------------------------------------- */
  {
    const build = BG.slice(BG.indexOf('    const current = {'), BG.indexOf('base[key] = current;'));
    for (const gone of ['seenOn', 'displayUrl', 'previousHash', 'firstSeen']) {
      check('the record no longer carries ' + gone, !new RegExp('current\\.' + gone + '\\s*=').test(build)
        && !new RegExp('\\n\\s*' + gone + ':').test(build));
    }
    for (const kept of ['hash', 'bytes', 'indicators', 'outboundHosts']) {
      check('it still carries ' + kept + ', which the drift comparison reads',
        new RegExp('(^|\\n)\\s*' + kept + '[,:]').test(build), build.slice(0, 200));
    }
  }

  /* ---- detection is unchanged --------------------------------------------------- */
  check('the drift comparison still diffs the stored indicators',
    /const oldIndicators = new Set\(entry\.indicators \|\| \[\]\)/.test(BG));
  check('and the stored outbound hosts',
    /const oldHosts = new Set\(entry\.outboundHosts \|\| \[\]\)/.test(BG));
  check('and still compares the stored hash',
    /if \(entry && entry\.hash && entry\.hash !== hash\)/.test(BG));

  /* ---- the policy says what is true --------------------------------------------- */
  check('PRIVACY.md no longer claims only the hash is kept',
    !/only the hash is kept/.test(PRIVACY),
    'the store has always held more than a hash; the sentence was the finding');
  check('it names what is actually stored',
    /content hash/.test(PRIVACY) && /outbound hosts/.test(PRIVACY));
  check('it states the retention limit', /30 days/.test(PRIVACY) && /700/.test(PRIVACY));
  check('and says the first-party list is gone and deleted on upgrade',
    /first-party sites/.test(PRIVACY) && /deleted the first time/.test(PRIVACY));

  console.log('');
  if (failures) { console.log(failures + ' check(s) failed'); process.exit(1); }
  console.log('all Script Drift storage checks passed');
})();
