/* WardenOne — Copyright (C) 2026 iri; GPL-3.0-or-later. See LICENSE. */
'use strict';
/* P3-1 (2026-11-20): where the reader switched WardenOne off, the engine hears it before page code runs. The settings
   reached a page about 150 ms after it started, worker awake or not, so the first scripts met protections the reader
   had turned off for that site. */
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const BG = fs.readFileSync(path.join(ROOT, 'background.js'), 'utf8');
const SRC = fs.readFileSync(path.join(ROOT, 'src', 'content.js'), 'utf8');
const MANIFEST = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
let checks = 0;
const ok = (cond, label) => { assert(cond, label); checks++; };

/* 1. The registration, from the worker's own planner. */
const start = BG.indexOf("const FINGERPRINT_OFF_SCRIPT_ID = 'wo-fingerprint-early-off';");
const stop = BG.indexOf('async function reconcileFingerprintEarlyInjection(');
ok(start > 0 && stop > start, 'the early registration planner is where the test expects it');
const ctx = { Object, Set, URL, activeAllowlist: (cfg) => cfg.allowlist || [], FINGERPRINT_EARLY_SCRIPT_ID: 'wo-fingerprint-early',
  FINGERPRINT_STANDARD_SCRIPT_ID: 'wo-fingerprint-early-standard', FINGERPRINT_HOSTED_APP_MATCHES: ['*://docs.google.com/*'] };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'domain-utils.js'), 'utf8') + '\n' + fs.readFileSync(path.join(ROOT, 'psl-private.js'), 'utf8'), ctx);
vm.runInContext(BG.slice(start, stop) + '\nthis.plan = fingerprintEarlyRegistrations;', ctx);
const EXCLUDES = ['*://*.excluded.example/*'];
const engineOff = (cfg) => JSON.parse(JSON.stringify(ctx.plan(cfg, EXCLUDES))).find((e) => e.id === 'wo-engine-early-off') || null;

ok(engineOff({}) === null, 'nothing is registered while WardenOne is on everywhere');
ok(engineOff({ siteOverrides: { 'shop.example': { fingerprintShield: false } } }) === null, 'one feature paused on a site does not switch the engine off there');
let r = engineOff({ allowlist: ['trusted.example'] });
ok(r && JSON.stringify(r.matches) === '["*://*.trusted.example/*"]', 'an allowlisted site gets it');
r = engineOff({ siteOverrides: { 'news.example': { enabled: false }, 'blog.example': { removeOverlays: false } } });
ok(r && JSON.stringify(r.matches) === '["*://*.news.example/*"]', 'a site switched off gets it; a site with one switch off does not');
r = engineOff({ siteOverrides: { 'myapp.local': { enabled: false }, '192.168.1.10': { enabled: false } } });
ok(r && r.matches.includes('*://*.myapp.local/*') && r.matches.includes('*://192.168.1.10/*'), 'local hosts and addresses count too');
r = engineOff({ enabled: false, allowlist: ['trusted.example'] });
ok(r && JSON.stringify(r.matches) === '["<all_urls>"]', 'WardenOne off everywhere covers every page');
ok(r.js.length === 1 && r.js[0] === 'engine-early-off.js', 'it is the one announcing file');
const engineEntry = MANIFEST.content_scripts.find((e) => (e.js || []).includes('content.min.js'));
ok(r.allFrames === (engineEntry.all_frames === true) && r.world === engineEntry.world && r.runAt === engineEntry.run_at,
  'it runs in the frames, world and moment the engine itself does');
ok(JSON.stringify(r.excludeMatches) === JSON.stringify(EXCLUDES), 'never where the engine does not run');
ok(r.persistAcrossSessions === true, 'it survives a browser restart');
ok(/const ids = \[[^\]]*ENGINE_OFF_SCRIPT_ID\]/.test(BG), 'the reconcile knows its id, so a stale one is removed');
ok(fs.readFileSync(path.join(ROOT, 'engine-early-off.js'), 'utf8').includes("document.dispatchEvent(new Event('wo-engine-early-off'));"),
  'the file only announces');

/* 2. The engine's handler, run with stand-ins. */
const at = SRC.indexOf('woOn(document,"wo-engine-early-off",');
ok(at > 0, 'the engine listens for it');
const handler = SRC.slice(at, SRC.indexOf('});', at) + 3);
function engine(opts = {}) {
  const box = { events: [], early: opts.early !== false };
  const sandbox = { box, Object, window: {}, CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init && init.detail; } },
    document: { dispatchEvent: (e) => box.events.push(e.type) } };
  vm.createContext(sandbox);
  vm.runInContext('const __woConfigStore={enabled:!0,removeOverlays:!0,__configReady:' + (opts.ready ? '!0' : '!1') + '};'
    + 'function buildConfig(o){const on=o.enabled!==!1;return{enabled:on,removeOverlays:on};}'
    + 'const __woFpEarly=()=>box.early;let fn;const woOn=(t,type,f)=>{fn=f};' + handler
    + 'box.fire=fn;box.store=__woConfigStore;box.win=window;', sandbox, { filename: 'content.js:engine-early-off' });
  return box;
}
let e = engine();
e.fire();
ok(e.store.enabled === false && e.store.removeOverlays === false, 'before page code the engine switches off');
ok(e.store.__configReady === false, 'and still waits for the real settings, which replace this');
ok(e.events.join() === 'wo-config-change' && e.win.__WO_CONFIG__ && e.win.__WO_CONFIG__.enabled === false, 'every protection is told at once');
e = engine({ early: false });
e.fire();
ok(e.store.enabled === true && e.events.length === 0, 'a page cannot fake it once its code could have run');
e = engine({ ready: true });
e.fire();
ok(e.store.enabled === true && e.events.length === 0, 'it never overrides settings that already arrived');
ok(/const __woFpEarly=\(\)=>"loading"===document\.readyState&&!__woAuth\.pageCouldHaveRun\(document\)/.test(SRC),
  'early means still loading and no page code yet');

console.log('[ok] engine early off: ' + checks + ' checks');
