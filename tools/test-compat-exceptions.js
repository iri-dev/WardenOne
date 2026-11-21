/* WardenOne — Copyright (C) 2026 iri; GPL-3.0-or-later. See LICENSE. */
'use strict';
/* P3-3 (2026-11-20): every named site exception is recorded in docs/compat-exceptions.json with what it relaxes, why,
   and the tests that prove it, and the record is held to the code. Changing, adding or retiring an exception fails
   here until the registry, and its reason, change with it. */
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const { lift, neverBlockRuntime } = require('./lib/compat-exceptions.js');

const ROOT = path.resolve(__dirname, '..');
const REGISTRY = path.join(ROOT, 'docs', 'compat-exceptions.json');
const registry = JSON.parse(fs.readFileSync(REGISTRY, 'utf8'));
const GATE = fs.readFileSync(path.join(ROOT, 'tools', 'check-maintainability.js'), 'utf8');
let checks = 0;
const ok = (cond, label) => { assert(cond, label); checks++; };

ok(registry.schema === 1 && Array.isArray(registry.groups) && registry.groups.length >= 25, 'the registry holds its groups');
const ids = registry.groups.map((g) => g.id);
ok(new Set(ids).size === ids.length, 'each group appears once');

/* What a person reads: plain words, so no em dash, and every field filled. */
for (const g of registry.groups) {
  for (const field of ['where', 'relaxes', 'reason', 'reviewed']) ok(typeof g[field] === 'string' && g[field].trim().length > 8, g.id + ' has ' + field);
  ok(/^\d{4}-\d{2}-\d{2}$/.test(g.reviewed), g.id + ' carries a review date');
  ok(!/—/.test(g.relaxes + g.reason + (g.evidence || '')), g.id + ' is written without an em dash');
  ok(Array.isArray(g.tests) && g.tests.length > 0, g.id + ' names a test that proves it');
  for (const t of g.tests) {
    ok(fs.existsSync(path.join(ROOT, t)), g.id + ': ' + t + ' exists');
    ok(GATE.split('\n').some((line) => line.startsWith('checkCommand(') && line.includes("'" + t + "'")), g.id + ': ' + t + ' is run by the gate');
  }
  const doc = /docs\/[\w./-]+\.(?:md|json)/.exec(g.evidence || '');
  if (doc) ok(fs.existsSync(path.join(ROOT, doc[0])), g.id + ': its evidence ' + doc[0] + ' exists');
}

/* The record against the code. */
const code = lift();
const missing = Object.keys(code).filter((id) => !ids.includes(id));
const stale = ids.filter((id) => !(id in code));
ok(!missing.length, 'every exception in the code is registered; unregistered: ' + missing.join(', '));
ok(!stale.length, 'every registered exception is still in the code; gone: ' + stale.join(', '));
const strings = (v) => Array.isArray(v) && v.every((x) => typeof x === 'string');
for (const g of registry.groups) {
  const now = code[g.id];
  if (JSON.stringify(now) === JSON.stringify(g.value)) { checks++; continue; }
  let detail = '';
  if (strings(now) && strings(g.value)) {
    const added = now.filter((x) => !g.value.includes(x)), removed = g.value.filter((x) => !now.includes(x));
    detail = (added.length ? ' added in the code: ' + added.join(', ') : '') + (removed.length ? ' removed from the code: ' + removed.join(', ') : '');
  }
  assert.fail(g.id + ' changed in the code.' + (detail || ' Its value now: ' + JSON.stringify(now).slice(0, 400))
    + ' Update docs/compat-exceptions.json, with the reason, in the same change.');
}

/* The never block set is assembled from five registered pieces; together they must be all of it. */
const pieces = ['never-block-core', 'never-block-apps', 'login-compat-hosts', 'consent-managers', 'adobe-fonts'];
const union = [...new Set(pieces.flatMap((id) => code[id]))].sort();
ok(JSON.stringify(union) === JSON.stringify(neverBlockRuntime()), 'the never block set is exactly its registered pieces');
/* Nothing may add to it from anywhere else in the worker, where the assembly above would not see it. */
const BG = fs.readFileSync(path.join(ROOT, 'background.js'), 'utf8');
const assemblyFrom = BG.indexOf('const NEVER_BLOCK_DOMAINS = new Set(');
const assemblyTo = BG.indexOf("NEVER_BLOCK_DOMAINS.add('use.typekit.net');") + "NEVER_BLOCK_DOMAINS.add('use.typekit.net');".length;
const outside = [...BG.matchAll(/NEVER_BLOCK_DOMAINS\.(?:add|delete|clear)\(/g)].filter((m) => m.index < assemblyFrom || m.index >= assemblyTo);
ok(!outside.length, 'the never block set changes only where it is assembled');

ok(JSON.parse(fs.readFileSync(path.join(ROOT, 'tools', 'publication-policy.json'), 'utf8')).publicDocuments.includes('docs/compat-exceptions.json'),
  'the registry is published with the tests that read it');
console.log('[ok] compatibility exceptions: ' + registry.groups.length + ' groups, ' + checks + ' checks');
