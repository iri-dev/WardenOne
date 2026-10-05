/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE. */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const profiles = require('../eyeshield-profiles.js');
const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

function functionSource(source, name) {
  const start = source.indexOf('function ' + name + '(');
  assert(start >= 0, name + ' exists');
  const open = source.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === '{') depth++;
    if (source[i] === '}' && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error(name + ' is unbalanced');
}

const globalConfig = {
  enabled: true, eyeShieldMode: 'dark', eyeShieldBrightness: 90,
  eyeShieldContrast: 110, eyeShieldSaturation: 100, eyeShieldWarmth: 10, eyeShieldGrayscale: 0,
};
const custom = profiles.customFromGlobal(globalConfig);
assert.deepStrictEqual(custom, {
  mode: 'custom', theme: 'dark', eyeShieldBrightness: 90, eyeShieldContrast: 110,
  eyeShieldSaturation: 100, eyeShieldWarmth: 10, eyeShieldGrayscale: 0,
});
assert.strictEqual(profiles.hostOf('WWW.YouTube.com.'), 'youtube.com');
assert.strictEqual(profiles.hostOf('__proto__'), '');
assert.strictEqual(profiles.hostOf('[::1]'), '[::1]');
assert.strictEqual(profiles.hostOf('[0:0:0:0:0:0:0:1]'), '[::1]');
assert.strictEqual(profiles.hostOf('[not-ipv6]'), '');
assert.strictEqual(profiles.hostOf('evil.com"><img'), '');
const sites = profiles.cleanSites({
  'www.youtube.com': Object.assign({}, custom, { theme: 'light', eyeShieldBrightness: 85, eyeShieldWarmth: 20 }),
  'github.com': { mode: 'off', eyeShieldBrightness: 1 },
  '__proto__.invalid': { mode: 'custom', theme: 'dark' },
  'bad host': { mode: 'off' },
});
assert.strictEqual(Object.keys(sites).length, 2);
assert.deepStrictEqual(sites['github.com'], { mode: 'off' });
assert.strictEqual(profiles.profileFor(sites, 'www.youtube.com').theme, 'light');
assert.strictEqual(profiles.profileFor(sites, 'music.youtube.com'), null);
assert.deepStrictEqual(profiles.forHost(sites, 'www.youtube.com'), { 'youtube.com': sites['youtube.com'] });
assert.deepStrictEqual(profiles.forHost(sites, 'docs.example'), {});
assert.strictEqual(profiles.resolve(Object.assign({}, globalConfig, { eyeShieldSites: sites }), 'docs.example').mode, 'inherit');
assert.strictEqual(profiles.resolve(Object.assign({}, globalConfig, { eyeShieldSites: sites }), 'github.com').config.enabled, false);
const effective = profiles.resolve(Object.assign({}, globalConfig, { eyeShieldSites: sites }), 'www.youtube.com');
assert.strictEqual(effective.config.eyeShieldMode, 'light');
assert.strictEqual(effective.config.eyeShieldBrightness, 85);
assert.strictEqual(effective.config.eyeShieldWarmth, 20);
assert.strictEqual(globalConfig.eyeShieldMode, 'dark');
assert.strictEqual(profiles.cleanSites({ 'example.com': { mode: 'custom', theme: 'dark', eyeShieldBrightness: 999 } })['example.com'].eyeShieldBrightness, 200);
const popup = vm.createContext({ WOEyeShieldProfiles: profiles, URL, REPUTATION_PROVIDERS: [] });
vm.runInContext(functionSource(read('popup.js'), 'publicConfig') + '\nthis.publicConfig = publicConfig;', popup);
assert.deepStrictEqual(Object.keys(popup.publicConfig({ eyeShieldSites: sites }, 'https://github.com/').eyeShieldSites), ['github.com']);
assert.deepStrictEqual(Object.keys(popup.publicConfig({ eyeShieldSites: sites }, 'https://docs.example/').eyeShieldSites), []);

const eyeSource = read('eyeshield.js');
const core = vm.createContext({ WOEyeShieldProfiles: profiles, URL, window: {}, location: { hostname: 'github.com' }, document: { readyState: 'complete' }, apply() {} });
core.window.top = core.window;
vm.runInContext('let cfg; const DEFAULTS = {}; ' + functionSource(eyeSource, 'eyeShieldProfileHost') + '\n' + functionSource(eyeSource, 'setConfig') + '; this.setConfig = setConfig; this.read = () => cfg;', core);
core.setConfig(Object.assign({}, globalConfig, { eyeShieldSites: sites }));
assert.strictEqual(core.read().enabled, false, 'site Off reaches the disabled branch before theme work');
core.window.top = {};
core.location.hostname = 'embed.example';
core.location.ancestorOrigins = ['https://parent.example', 'https://github.com'];
core.setConfig(Object.assign({}, globalConfig, { eyeShieldSites: sites }));
assert.strictEqual(core.read().enabled, false, 'Off on the top site also disables EyeShield in cross-origin frames');
core.window.top = core.window;
delete core.location.ancestorOrigins;
core.location.hostname = 'www.youtube.com';
core.setConfig(Object.assign({}, globalConfig, { eyeShieldSites: sites }));
assert.strictEqual(core.read().eyeShieldMode, 'light');
assert.strictEqual(core.read().eyeShieldBrightness, 85);
core.location.hostname = 'docs.example';
core.setConfig(Object.assign({}, globalConfig, { eyeShieldSites: sites }));
assert.strictEqual(core.read().eyeShieldMode, 'dark');

const background = read('background.js');
const worker = vm.createContext({ WOEyeShieldProfiles: profiles });
vm.runInContext(functionSource(background, 'eyeShieldThemingActive') + '\n' + functionSource(background, 'eyeShieldRegistrationScope')
  + '\n' + functionSource(background, 'eyeShieldActiveProfileHosts') + '\nthis.scope = eyeShieldRegistrationScope; this.active = eyeShieldThemingActive;', worker);
const globalScope = worker.scope(Object.assign({}, globalConfig, { eyeShieldSites: sites }));
assert.deepStrictEqual(Array.from(globalScope.matches), ['<all_urls>']);
assert(globalScope.excludeMatches.includes('*://github.com/*'));
assert(globalScope.excludeMatches.includes('*://www.github.com/*'));
const customScope = worker.scope({ enabled: true, eyeShieldMode: 'off', eyeShieldSites: sites });
assert.deepStrictEqual(Array.from(customScope.matches), ['*://youtube.com/*', '*://www.youtube.com/*']);
assert.deepStrictEqual(Array.from(customScope.excludeMatches), []);
assert.strictEqual(worker.active({ enabled: true, eyeShieldSites: { 'github.com': { mode: 'off' } } }), false);
assert.strictEqual(worker.active({ enabled: true, eyeShieldSites: [{ mode: 'custom', theme: 'dark' }] }), false);
const injected = [];
worker.URL = URL;
worker.woFeatureOmitted = () => false;
worker.chrome = {
  runtime: { lastError: null },
  tabs: { query: (_query, callback) => callback([
    { id: 1, url: 'https://youtube.com/' }, { id: 2, url: 'https://github.com/' }, { id: 3, url: 'https://docs.example/' },
  ]) },
  scripting: { executeScript: (spec, callback) => { injected.push(spec); if (callback) callback(); } },
};
vm.runInContext(functionSource(background, 'injectEyeShieldIntoOpenTabs') + '\nthis.inject = injectEyeShieldIntoOpenTabs;', worker);
worker.inject({ enabled: true, eyeShieldMode: 'off', eyeShieldSites: sites });
assert(injected.length > 0 && injected.every((spec) => spec.target.tabId === 1), 'open tabs outside a custom-only scope are skipped');
console.log('[ok] EyeShield site profiles resolve, validate and scope injection');

(async () => {
  const injectedFrames = [];
  let currentConfig = {};
  const frameWorker = vm.createContext({
    WOEyeShieldProfiles: profiles, URL, Number, Object, String,
    DEFAULT_CONFIG: { enabled: true, eyeShield: false, eyeShieldMode: 'off' },
    woFeatureOmitted: () => false,
    localGet: async () => ({ wardenone_config: currentConfig }),
    chrome: { scripting: { executeScript: async (spec) => { injectedFrames.push(spec); } } },
  });
  vm.runInContext([
    "const EYESHIELD_PRELOAD_MODES = ['dark', 'ultra', 'light'];",
    functionSource(background, 'eyeShieldThemingActive'),
    functionSource(background, 'eyeShieldPreloadFile'),
    functionSource(background, 'eyeShieldScriptFiles'),
    functionSource(background, 'eyeShieldUsesBootstrap'),
    'async ' + functionSource(background, 'injectEyeShieldFrame'),
    'this.injectFrame = injectEyeShieldFrame;',
  ].join('\n'), frameWorker);
  const sender = (top, frame, frameId = 3) => ({
    tab: { id: 9, url: top }, url: frame, frameId, documentId: 'document-9-' + frameId,
  });
  currentConfig = { enabled: true, eyeShieldMode: 'off', eyeShieldSites: { 'youtube.com': { mode: 'custom', theme: 'dark' } } };
  assert.strictEqual(await frameWorker.injectFrame(sender('https://youtube.com/', 'https://embed.example/')), true);
  assert.deepStrictEqual(Array.from(injectedFrames[0].target.documentIds), ['document-9-3']);
  assert(injectedFrames[0].files.includes('eyeshield.js') && injectedFrames[0].files.includes('eyeshield-preload-dark.js'));
  assert(!injectedFrames[0].files.includes('eyeshield-sites.js'));
  assert.strictEqual(await frameWorker.injectFrame(sender('https://youtube.com/', 'https://youtube.com/', 0)), true);
  assert(injectedFrames[1].files.includes('eyeshield-sites.js'));
  assert.strictEqual(await frameWorker.injectFrame(sender('https://unrelated.example/', 'https://youtube.com/')), false);
  currentConfig = { enabled: true, eyeShieldMode: 'dark', eyeShieldSites: { 'github.com': { mode: 'off' } } };
  assert.strictEqual(await frameWorker.injectFrame(sender('https://github.com/', 'https://embed.example/')), false);
  assert.strictEqual(injectedFrames.length, 2, 'Off site does not parse the full EyeShield script in cross-origin frames');
  currentConfig = { enabled: true, eyeShieldMode: 'off', eyeShieldSites: { '[::1]': { mode: 'custom', theme: 'light' } } };
  assert.strictEqual(await frameWorker.injectFrame(sender('http://[::1]:8080/', 'https://embed.example/')), true);
  assert(injectedFrames[2].files.includes('eyeshield-preload-light.js'));
  assert.strictEqual(await frameWorker.injectFrame({ ...sender('https://youtube.com/', 'https://embed.example/'), documentId: '' }), false);
  console.log('[ok] EyeShield bootstrap loads only frames of active top sites, including IPv6 profiles');
})().catch((error) => { console.error(error); process.exitCode = 1; });
