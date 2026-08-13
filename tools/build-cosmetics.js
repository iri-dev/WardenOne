/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
'use strict';

/*
 * Release-time cosmetic compiler.
 *
 * WardenOne used to fetch upstream filter lists at runtime and turn ##+js(...) and procedural
 * (:remove(), :style(), :xpath(), :has-text()) records into commands its content engine then
 * dispatched. Chrome's Manifest V3 rules name that pattern directly: extension logic must be
 * self-contained, and "building an interpreter to run complex commands fetched from a remote
 * source, even if those commands are fetched as data" is called out as a violation. Passive
 * domain, URL and selector data is fine; command records are not.
 *
 * So the command-bearing half is compiled here, at release time, and shipped inside the reviewed
 * package. The daily runtime refresh keeps updating passive selectors only.
 *
 * The parser is LIFTED FROM background.js rather than reimplemented. If this file had its own
 * copy, the packaged rules could silently drift from what the runtime expects to consume; lifting
 * means there is exactly one parser and the build cannot disagree with it.
 *
 *   node tools/build-cosmetics.js            compile from the live feeds
 *   node tools/build-cosmetics.js --check    verify the committed file is present and well-formed
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'cosmetic-rules.json');
const BG = fs.readFileSync(path.join(ROOT, 'background.js'), 'utf8');

// ---------------------------------------------------------------------------
// Lift the real parser out of background.js.
// ---------------------------------------------------------------------------
function liftFunction(name) {
  const at = BG.indexOf('function ' + name + '(');
  if (at < 0) throw new Error('cannot find function ' + name + ' in background.js');
  let depth = 0;
  for (let i = BG.indexOf('{', at); i < BG.length; i++) {
    if (BG[i] === '{') depth++;
    else if (BG[i] === '}') { depth--; if (depth === 0) return BG.slice(at, i + 1); }
  }
  throw new Error('cannot brace-match ' + name);
}

function liftConst(name) {
  const m = BG.match(new RegExp('^const ' + name + ' = ([^;]+);', 'm'));
  if (!m) throw new Error('cannot find const ' + name);
  return 'const ' + name + ' = ' + m[1] + ';';
}

function liftFeedList() {
  const at = BG.indexOf('const ADSHIELD_COSMETIC_LISTS = [');
  if (at < 0) throw new Error('cannot find ADSHIELD_COSMETIC_LISTS');
  const end = BG.indexOf('];', at);
  return BG.slice(at, end + 2);
}

function makeParser() {
  const sandbox = {
    Set, Map, Object, Array, String, Number, Boolean, RegExp, JSON, console,
    // Host classification is only used to scope where a rule may apply; a permissive
    // stand-in is correct here because the compiler stores rules for every domain and
    // the runtime re-applies its own host checks when it serves them.
    normalizeAllowlistHost: (h) => String(h || '').replace(/^www\./i, '').toLowerCase(),
    normalizeAllowlistHosts: (l) => Array.from(l || []),
    hostMatchesAllowlist: () => false,
    isVideoPlatformHost: () => false,
    __cosmeticHostCache: new Map(),
    COSMETIC_HOST_CACHE_MAX: 256,
  };
  vm.createContext(sandbox);
  // One contiguous region rather than cherry-picked functions. The parsing machinery -- the caps,
  // the scriptlet alias table, the storage-mutation guards and the parser itself -- is a single
  // block in background.js. Lifting it whole means a helper added in the middle cannot silently
  // go missing here, which is what happened twice while this tool was being written.
  const from = BG.indexOf('const ADSHIELD_COSMETIC_MAX');
  const at = BG.indexOf('function parseCosmeticFilters(');
  if (from < 0 || at < from) throw new Error('cannot locate the cosmetic parser region');
  let depth = 0;
  let to = -1;
  for (let i = BG.indexOf('{', at); i < BG.length; i++) {
    if (BG[i] === '{') depth++;
    else if (BG[i] === '}') { depth--; if (depth === 0) { to = i + 1; break; } }
  }
  if (to < 0) throw new Error('cannot brace-match parseCosmeticFilters');

  vm.runInContext([
    BG.slice(from, to),
    liftFeedList(),
    'this.__api = { parseCosmeticFilters, ADSHIELD_COSMETIC_LISTS };',
  ].join('\n'), sandbox, { filename: 'background.js:cosmetic-parser' });
  return sandbox.__api;
}

// ---------------------------------------------------------------------------
// --check: the release invariant. Does not touch the network.
// ---------------------------------------------------------------------------
if (process.argv.includes('--check')) {
  if (!fs.existsSync(OUT)) {
    console.error('[fail] cosmetic-rules.json is missing. Run: node tools/build-cosmetics.js');
    process.exit(1);
  }
  let doc;
  try {
    doc = JSON.parse(fs.readFileSync(OUT, 'utf8'));
  } catch (e) {
    console.error('[fail] cosmetic-rules.json is not valid JSON: ' + e.message);
    process.exit(1);
  }
  const scriptletDomains = Object.keys(doc.scriptlets || {}).length;
  const proceduralDomains = Object.keys(doc.procedural || {}).length;
  if (!scriptletDomains && !proceduralDomains) {
    console.error('[fail] cosmetic-rules.json carries no rules; the package would lose coverage.');
    process.exit(1);
  }
  if (!doc.builtAt || !Array.isArray(doc.sources) || !doc.sources.length) {
    console.error('[fail] cosmetic-rules.json has no provenance (builtAt / sources).');
    process.exit(1);
  }
  console.log('[ok] cosmetic-rules.json: ' + scriptletDomains + ' scriptlet domains, '
    + proceduralDomains + ' procedural domains, built ' + doc.builtAt);
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Compile.
// ---------------------------------------------------------------------------
(async () => {
  const { parseCosmeticFilters, ADSHIELD_COSMETIC_LISTS } = makeParser();
  console.log('  parser lifted from background.js; ' + ADSHIELD_COSMETIC_LISTS.length + ' feeds');

  const CACHE = path.join(ROOT, ".publish", "feed-cache");
  fs.mkdirSync(CACHE, { recursive: true });
  const fresh = process.argv.includes("--refresh");

  const texts = [];
  const sources = [];
  for (const url of ADSHIELD_COSMETIC_LISTS) {
    const cached = path.join(CACHE, crypto.createHash("sha1").update(url).digest("hex") + ".txt");
    process.stdout.write('  ' + url + ' ... ');
    try {
      let text;
      if (!fresh && fs.existsSync(cached)) {
        text = fs.readFileSync(cached, "utf8");
        process.stdout.write("cached ");
      } else {
        const res = await fetch(url, { redirect: 'follow' });
        if (!res.ok) { console.log('HTTP ' + res.status + ' (skipped)'); continue; }
        text = await res.text();
        fs.writeFileSync(cached, text, "utf8");
      }
      texts.push(text);
      sources.push({
        url,
        bytes: text.length,
        sha256: crypto.createHash('sha256').update(text).digest('hex'),
      });
      console.log(text.length + ' bytes');
    } catch (e) {
      console.log('failed: ' + String(e.message).slice(0, 60) + ' (skipped)');
    }
  }

  if (sources.length < ADSHIELD_COSMETIC_LISTS.length) {
    console.log('  [warn] ' + (ADSHIELD_COSMETIC_LISTS.length - sources.length)
      + ' feed(s) did not download. Compiling from what arrived would silently ship reduced');
    console.log('         coverage, so this is a hard stop. Re-run when the network is healthy.');
    process.exit(1);
  }

  const parsed = parseCosmeticFilters(texts.join('\n'));

  // Only the command-bearing halves are packaged. Passive selectors keep coming from the daily
  // refresh, which is what the policy permits and what keeps ordinary hiding rules fresh.
  const doc = {
    builtAt: new Date().toISOString().slice(0, 10),
    note: 'Compiled at release time from the feeds listed below. The runtime does not accept '
      + 'scriptlet or procedural records from network refreshes; it reads them only from here.',
    sources,
    scriptlets: parsed.scriptlets || {},
    procedural: parsed.procedural || {},
  };

  const scriptletDomains = Object.keys(doc.scriptlets).length;
  const proceduralDomains = Object.keys(doc.procedural).length;
  const scriptletRules = Object.values(doc.scriptlets).reduce((n, a) => n + a.length, 0);
  const proceduralRules = Object.values(doc.procedural).reduce((n, a) => n + a.length, 0);

  fs.writeFileSync(OUT, JSON.stringify(doc), 'utf8');

  console.log('  ---------------------------------------------');
  console.log('  scriptlets:  ' + scriptletRules + ' rules across ' + scriptletDomains + ' domains');
  console.log('  procedural:  ' + proceduralRules + ' rules across ' + proceduralDomains + ' domains');
  console.log('  written:     cosmetic-rules.json  ('
    + Math.round(fs.statSync(OUT).size / 1024) + ' KB)');
})().catch((e) => {
  console.error('[fail] ' + (e && e.stack ? e.stack : e));
  process.exit(1);
});
