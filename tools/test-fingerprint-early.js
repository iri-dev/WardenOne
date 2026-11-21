/* WardenOne — Copyright (C) 2026 iri; GPL-3.0-or-later. See LICENSE. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const manifest = require('../manifest.json');

const background = fs.readFileSync('background.js', 'utf8');
const source = fs.readFileSync('src/content.js', 'utf8');
const script = fs.readFileSync('fingerprint-early-on.js', 'utf8');
assert(source.indexOf('wo-fingerprint-early-on') < source.indexOf('const __woStartRuntime='),
  'the early listener must exist before the settings dependent runtime');
assert(source.indexOf('function __woFingerprintNoise(') < source.indexOf('const __woStartRuntime='),
  'the shared fingerprint function must be callable before the page starts');
assert(script.includes("document.dispatchEvent(new Event('wo-fingerprint-early-on'))"));
assert(!/fetch\(|XMLHttpRequest|sendBeacon|new Image\(/.test(script));

const from = background.indexOf("const FINGERPRINT_EARLY_SCRIPT_ID =");
const to = background.indexOf('function eyeShieldTopRegistration(', from);
assert(from > 0 && to > from);
const registered = new Map();
const calls = [];
const chrome = {
  runtime: { getManifest: () => manifest },
  scripting: {
    getRegisteredContentScripts: async ({ ids } = {}) => [...registered.values()].filter(entry => !ids || ids.includes(entry.id)),
    registerContentScripts: async (list) => { for (const definition of list) { calls.push('register:' + definition.id); registered.set(definition.id, definition); } },
    updateContentScripts: async (list) => { for (const definition of list) { calls.push('update:' + definition.id); registered.set(definition.id, definition); } },
    unregisterContentScripts: async ({ ids }) => { for (const id of ids) { calls.push('unregister:' + id); registered.delete(id); } },
  },
};
const context = vm.createContext({ chrome, console, URL, activeAllowlist: cfg => cfg.allowlist || [],
  normalizeAllowlistHost: value => String(value || '').toLowerCase() });
vm.runInContext(fs.readFileSync('domain-utils.js', 'utf8') + '\n' + fs.readFileSync('psl-private.js', 'utf8'), context);
vm.runInContext(background.slice(from, to) + '\nthis.reconcile = reconcileFingerprintEarlyInjection;', context);

const STRONG = 'wo-fingerprint-early', STANDARD = 'wo-fingerprint-early-standard', OFF = 'wo-fingerprint-early-off';
const shapeOk = entry => entry.runAt === 'document_start' && entry.world === 'MAIN' && entry.persistAcrossSessions === true && entry.allFrames === true;
(async () => {
  await context.reconcile({ enabled: true, antiFingerprintNoise: false });
  assert(!registered.has(STRONG), 'defaults leave the stronger protection off');
  const standard = registered.get(STANDARD);
  assert(standard && shapeOk(standard), 'defaults arm the shield at document_start in every frame');
  assert.deepEqual(Array.from(standard.matches), ['<all_urls>']);
  assert.deepEqual(Array.from(standard.js), ['fingerprint-early-standard.js']);
  assert(standard.excludeMatches.includes('https://accounts.google.com/*'), 'login exemptions match the engine');
  const off = registered.get(OFF);
  assert(off && shapeOk(off) && off.js[0] === 'fingerprint-early-off.js', 'the engine arms early everywhere, so an off script undoes it where the shield is paused');
  for (const pattern of ['*://docs.google.com/*', '*://*.okta.com/*']) assert(off.matches.includes(pattern) && standard.excludeMatches.includes(pattern), pattern);
  const max = { enabled: true, antiFingerprintNoise: true, allowlist: ['paused.example'],
    siteOverrides: { 'login.example': { antiFingerprintNoise: false } } };
  await context.reconcile(max);
  assert(!registered.has(STANDARD), 'the stronger noise everywhere replaces the shield script');
  const strong = registered.get(STRONG);
  assert(strong && shapeOk(strong));
  assert.deepEqual(Array.from(strong.matches), ['<all_urls>']);
  assert.deepEqual(Array.from(strong.js), ['fingerprint-early-on.js']);
  for (const host of ['paused.example', 'login.example'])
    assert(strong.excludeMatches.includes('*://*.' + host + '/*'), host);
  assert(strong.excludeMatches.includes('https://accounts.google.com/*'), 'login exemptions match the engine');
  assert(registered.get(OFF).matches.includes('*://*.paused.example/*'), 'an allowlisted site undoes the early shield');
  assert(!registered.get(OFF).matches.includes('*://*.login.example/*'), 'a site with only the stronger noise paused keeps the standard shield');
  const before = calls.length;
  await context.reconcile(max);
  assert.equal(calls.length, before, 'unchanged settings do not rewrite the registration');
  const mark = calls.length;
  await context.reconcile({ enabled: true, antiFingerprintNoise: false,
    siteOverrides: { 'one.example': { antiFingerprintNoise: true }, 'two.example': { fingerprintShield: false } } });
  assert(calls.slice(mark).includes('register:' + STANDARD));
  assert(registered.get(OFF).matches.includes('*://*.two.example/*'), 'a site with the shield off gets the off script');
  assert.deepEqual(Array.from(registered.get(STRONG).matches), ['*://*.one.example/*']);
  assert(registered.get(STANDARD).excludeMatches.includes('*://*.one.example/*'), 'a site on the stronger noise gets no shield script');
  assert(registered.get(STANDARD).excludeMatches.includes('*://*.two.example/*'), 'a site with the shield off is left out');
  await context.reconcile({ enabled: true, antiFingerprintNoise: false, fingerprintShield: false });
  assert.deepEqual([...registered.keys()], [OFF], 'turning both off leaves only the off script');
  assert.deepEqual(Array.from(registered.get(OFF).matches), ['<all_urls>']);
  await context.reconcile({ enabled: true });
  await context.reconcile({ enabled: false, antiFingerprintNoise: true });
  /* WardenOne off also tells the engine itself, top frame only, before page code runs (P3-1). */
  const ENGINE_OFF = 'wo-engine-early-off';
  assert.deepEqual([...registered.keys()].sort(), [ENGINE_OFF, OFF].sort(), 'WardenOne off leaves only the two off scripts, everywhere');
  assert.deepEqual(Array.from(registered.get(OFF).matches), ['<all_urls>']);
  const engineOff = registered.get(ENGINE_OFF);
  assert.deepEqual(Array.from(engineOff.matches), ['<all_urls>']);
  assert(engineOff.allFrames === false && engineOff.world === 'MAIN' && engineOff.runAt === 'document_start', 'the engine off script runs where the engine does');
  assert.deepEqual(Array.from(engineOff.js), ['engine-early-off.js']);
  console.log('[ok] early fingerprint registration follows both levels, site exceptions and browser restarts');
})().catch(error => { console.error(error); process.exitCode = 1; });
