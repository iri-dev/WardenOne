/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
'use strict';

// sendConfig runs in EVERY frame at EVERY page load, and it used to re-normalise host
// lists that had already been normalised when they were stored. Skipping that second
// pass is only sound because of two properties, so both are asserted here rather than
// assumed:
//
//   1. normalizeBridgeHost is idempotent on anything it accepts.
//   2. sanitizeBridgeHostList's output is therefore a fixed point.
//
// The third assertion is the one that matters most. setLearnedGrabberDomains applies a
// strict bare-hostname regex BEFORE the shared gate, and that order is load-bearing:
// the gate happily parses a hostname out of "https://evil.example/p" or ".lead.com.",
// so sanitising first would turn a malformed learned key into a live auto-block. This
// file pins the acceptance set so that ordering cannot be quietly swapped.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const BRIDGE = fs.readFileSync(path.join(ROOT, 'bridge.js'), 'utf8');

function grabFn(name) {
  const i = BRIDGE.indexOf('function ' + name);
  assert(i >= 0, 'bridge.js no longer declares ' + name);
  let depth = 0;
  let seen = false;
  for (let j = i; j < BRIDGE.length; j++) {
    const c = BRIDGE[j];
    if (c === '{') { depth++; seen = true; } else if (c === '}') {
      depth--;
      if (seen && depth === 0) return BRIDGE.slice(i, j + 1);
    }
  }
  assert.fail('could not find the end of ' + name);
}

const cacheDecl = /NORMALIZED_HOST_CACHE = new Map\(\)/.test(BRIDGE)
  ? 'const NORMALIZED_HOST_CACHE=new Map();const NORMALIZED_HOST_CACHE_MAX=12000;'
  : '';
const SRC = [
  cacheDecl,
  'let learnedGrabberDomains=[];',
  'let supplementalLists={adultDomainsExtra:[],grabberDomainsExtra:[],trustedPaymentHostsExtra:[]};',
  grabFn('bridgePrivateOrLocalHost'),
  grabFn('normalizeBridgeHostUncached'),
  grabFn('normalizeBridgeHost'),
  grabFn('sanitizeBridgeHostList'),
  grabFn('mergeBridgeHostLists'),
  grabFn('mergeNormalizedHostLists'),
  grabFn('setLearnedGrabberDomains'),
  grabFn('setSupplementalLists'),
].filter(Boolean).join('\n');

const ctx = vm.createContext({ URL, Map, Set, Number, Math, String, Array, Object, JSON });
vm.runInContext(SRC, ctx);
const run = (expr) => vm.runInContext(expr, ctx);

let failures = 0;
function check(name, cond, detail) {
  if (cond) { console.log('  [ok] ' + name); return; }
  failures++;
  console.error('  [FAIL] ' + name + (detail ? '  -> ' + detail : ''));
}

// Hostile and awkward shapes, including every form the two filters disagree about.
const PROBES = ['example.com', 'WWW.Example.COM', 'https://sub.example.co.uk/p', 'http://x.example.com:8080/',
  '.lead.com.', 'EXAMPLE.COM.', 'sub.sub.example.org', 'a-b.example.com', 'très.example.com',
  'xn--bcher-kva.example', '10.0.0.1', '127.1', '192.168.1.1', '169.254.1.1', '100.64.0.1', '203.0.113.5',
  'localhost', '[::1]', 'foo.local', 'y.test', 'z.invalid', 'w.internal', 'a'.repeat(64) + '.com',
  'a'.repeat(250) + '.com', '', '   ', '..', 'a..b.com', '-lead.com', 'trail-.com', 'has_underscore.com',
  '*.wild.com', 'a%b.com', 'sub\\.evil.com', 'evil.com/path', 'dup.example', 'DUP.example'];

// ---------------------------------------------------------------------------
// 1. The two properties that license skipping a second normalise pass.
// ---------------------------------------------------------------------------
{
  ctx.__p = PROBES;
  const bad = run('(function(){const out=[];for(const p of __p){const a=normalizeBridgeHost(p);'
    + 'if(!a)continue;const b=normalizeBridgeHost(a);if(a!==b)out.push(p+" -> "+a+" -> "+b);}return out;})()');
  check('normalizeBridgeHost is idempotent on everything it accepts', bad.length === 0, bad.join(' | '));

  const fixed = run('(function(){const once=sanitizeBridgeHostList(__p.concat(__p),5000);'
    + 'const twice=sanitizeBridgeHostList(once,5000);return JSON.stringify(once)===JSON.stringify(twice);})()');
  check('sanitizeBridgeHostList output is a fixed point', fixed === true);
}

// ---------------------------------------------------------------------------
// 2. THE safety-critical one: the learned filter must reject anything the shared gate
//    would otherwise parse a blockable hostname out of. Sanitising first would turn
//    these into live auto-blocks, which breaks working sites.
// ---------------------------------------------------------------------------
{
  const MUST_REJECT = ['https://sub.example.co.uk/p', 'http://x.example.com:8080/', '.lead.com.',
    'EXAMPLE.COM.', 'très.example.com', 'evil.com/path', '10.0.0.1', 'localhost', 'foo.local',
    'y.test', '192.168.1.1', 'a'.repeat(64) + '.com', '*.wild.com', 'a%b.com', '..', 'a..b.com',
    '-lead.com', 'trail-.com'];
  ctx.__reject = MUST_REJECT;
  const leaked = run('(function(){const o={};for(const h of __reject)o[h]=1;'
    + 'setLearnedGrabberDomains(o);return learnedGrabberDomains.slice();})()');
  check('no malformed or private learned key becomes a blockable host',
    leaked.length === 0, 'leaked: ' + leaked.join(', '));

  // WWW.Example.COM collapses onto example.com, so four inputs yield three hosts.
  // That collapse is the point: it is what stops the same site being learned twice.
  const MUST_KEEP = ['example.com', 'WWW.Example.COM', 'sub.sub.example.org', 'a-b.example.com'];
  ctx.__keep = MUST_KEEP;
  const kept = run('(function(){const o={};for(const h of __keep)o[h]=1;'
    + 'setLearnedGrabberDomains(o);return learnedGrabberDomains.slice();})()');
  check('ordinary learned hostnames still survive',
    ['example.com', 'sub.sub.example.org', 'a-b.example.com'].every((h) => kept.includes(h)),
    JSON.stringify(kept));
  check('www-stripping and lowercasing collapse a duplicate rather than adding one',
    kept.length === 3, JSON.stringify(kept));
}

// ---------------------------------------------------------------------------
// 3. The learned list is capped, and the cap survives the extra pass.
// ---------------------------------------------------------------------------
{
  const n = run('(function(){const o={};for(let i=0;i<1400;i++)o["l"+i+".example.com"]=1;'
    + 'setLearnedGrabberDomains(o);return learnedGrabberDomains.length;})()');
  check('the learned list is still capped at 1000', n === 1000, 'got ' + n);
  const junk = run('(function(){setLearnedGrabberDomains(null);return learnedGrabberDomains.length;})()');
  check('a null learned store yields an empty list', junk === 0);
}

// ---------------------------------------------------------------------------
// 4. mergeNormalizedHostLists: dedupes, caps, drops empties, preserves order.
// ---------------------------------------------------------------------------
{
  const out = run('mergeNormalizedHostLists(5, ["a.com","b.com"], ["b.com","c.com"], ["d.com","e.com","f.com"])');
  check('merge dedupes across lists and caps', JSON.stringify(out) === JSON.stringify(['a.com', 'b.com', 'c.com', 'd.com', 'e.com']),
    JSON.stringify(out));
  const empties = run('mergeNormalizedHostLists(10, ["a.com","",null,"b.com"], null, undefined)');
  check('merge skips empty entries and non-arrays', JSON.stringify(empties) === JSON.stringify(['a.com', 'b.com']),
    JSON.stringify(empties));
}

// ---------------------------------------------------------------------------
// 5. The memo must not change any answer.
// ---------------------------------------------------------------------------
{
  ctx.__p = PROBES;
  const same = run('(function(){for(const p of __p){'
    + 'if(normalizeBridgeHost(p)!==normalizeBridgeHostUncached(p))return p;}return "";})()');
  check('the memo returns exactly what the uncached function returns', same === '', 'diverged on ' + JSON.stringify(same));
  const bounded = /NORMALIZED_HOST_CACHE.size >= NORMALIZED_HOST_CACHE_MAX/.test(BRIDGE)
    && /NORMALIZED_HOST_CACHE\.clear\(\)/.test(BRIDGE);
  check('the memo is bounded', bounded);
}

// ---------------------------------------------------------------------------
// 6. Source guards: the fast merge must never be handed unsanitised config data.
// ---------------------------------------------------------------------------
{
  const calls = [...BRIDGE.matchAll(/mergeNormalizedHostLists\(([\s\S]*?)\);/g)].map((m) => m[1].replace(/\s+/g, ' '));
  check('mergeNormalizedHostLists is actually used', calls.length >= 3, calls.length + ' call sites');
  const unsafe = calls.filter((args) => /\braw\.[A-Za-z]/.test(args) && !/sanitizeBridgeHostList\(\s*raw\./.test(args));
  check('no raw config list reaches the fast merge unsanitised', unsafe.length === 0, unsafe.join(' | '));
  check('the learned filter runs before the shared gate, not after',
    /sanitizeBridgeHostList\(\s*\n?\s*Object\.keys\(learned[\s\S]{0,400}?\.filter\(/.test(BRIDGE));
}

if (failures) {
  console.error('[fail] bridge host list tests: ' + failures + ' failure(s)');
  process.exit(1);
}
console.log('[ok] bridge host list tests');
