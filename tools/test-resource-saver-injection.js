/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md */
'use strict';
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const bg = fs.readFileSync(path.join(__dirname, '..', 'background.js'), 'utf8');
const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'manifest.json'), 'utf8'));
for (const file of ['anti-redirect.js', 'fingerprint-realm.js', 'bridge.js']) {
  const script = manifest.content_scripts.find((entry) => entry.js?.includes(file));
  assert(script && script.all_frames && script.run_at === 'document_start', file + ' must keep its early frame coverage');
  assert(script.match_about_blank && script.match_origin_as_fallback, file + ' must keep inherited-frame coverage');
}
const start = bg.indexOf('function resourceSaverState(');
const end = bg.indexOf('function broadcastResourceSaverState(', start);
assert(start >= 0 && end > start);

function harness() {
  const calls = [];
  let registration = null;
  let failWrite = false;
  let omitted = false;
  const chrome = {
    scripting: {
      async getRegisteredContentScripts(filter) {
        assert.deepEqual(Array.from(filter.ids), ['wo-resource-saver']);
        return registration ? [registration] : [];
      },
      async registerContentScripts(scripts) {
        calls.push(['register', scripts]);
        if (failWrite) throw Error('registration failed');
        registration = scripts[0];
      },
      async updateContentScripts(scripts) {
        calls.push(['update', scripts]);
        if (failWrite) throw Error('update failed');
        registration = scripts[0];
      },
      async unregisterContentScripts(filter) {
        calls.push(['unregister', filter]);
        if (failWrite) throw Error('unregister failed');
        registration = null;
      },
      async executeScript(details) {
        calls.push(['inject', details]);
        if (details.target.tabId === 3) throw Error('host access withheld');
      },
    },
    tabs: { query: async () => [
      { id: 1, url: 'https://video.example/' }, { id: 2, url: 'file:///example.html' },
      { id: 3, url: 'https://withheld.example/' }, { id: 4, url: 'chrome://settings/' },
    ] },
  };
  const box = { chrome, console: { warn() {} }, woFeatureOmitted: () => omitted };
  vm.createContext(box);
  vm.runInContext(bg.slice(start, end) + '\nthis.apply = reconcileResourceSaverInjection;', box);
  return { apply: box.apply, calls, registration: () => registration,
    fail: (value) => { failWrite = value; }, omit: () => { omitted = true; } };
}

(async () => {
  for (const [cfg, files] of [
    [{}, []], [{ disableYouTubeAmbientMode: true }, ['resource-saver.js']],
    [{ stopAnimatedVideoPreviews: true }, ['resource-saver.js']],
    [{ pauseAnimatedImages: true }, ['animated-image-saver.js']],
    [{ pauseAnimatedImages: true, stopAnimatedVideoPreviews: true }, ['resource-saver.js', 'animated-image-saver.js']],
    [{ enabled: false, pauseAnimatedImages: true }, []],
    [{ pauseAnimatedImages: 'true', stopAnimatedVideoPreviews: 1 }, []],
  ]) {
    const h = harness();
    assert.notEqual(await h.apply(cfg), false);
    assert.deepEqual(Array.from(h.registration()?.js || []), files);
    if (!files.length) { assert.equal(h.calls.length, 0); continue; }
    const script = h.registration();
    assert.deepEqual(Array.from(script.matches), ['<all_urls>']);
    assert.equal(script.runAt, 'document_start');
    assert.equal(script.world, 'ISOLATED');
    assert.equal(script.allFrames, true);
    assert.equal(script.matchOriginAsFallback, true);
    assert.equal(script.persistAcrossSessions, true);
    const injections = h.calls.filter(([kind]) => kind === 'inject');
    assert.deepEqual(injections.map(([, value]) => value.target.tabId), [1, 2, 3]);
    assert(injections.every(([, value]) => value.target.allFrames && value.world === 'ISOLATED'));
    h.calls.length = 0;
    await h.apply(cfg);
    assert.equal(h.calls.length, 0, 'a worker wake must not reinject unchanged modules');
    await h.apply({});
    assert.equal(h.registration(), null);
    assert.deepEqual(h.calls.map(([kind]) => kind), ['unregister']);
  }
  const h = harness();
  await h.apply({ stopAnimatedVideoPreviews: true });
  h.calls.length = 0;
  await h.apply({ stopAnimatedVideoPreviews: true, pauseAnimatedImages: true });
  assert.equal(h.calls[0][0], 'update');
  assert(h.calls.filter(([kind]) => kind === 'inject')
    .every(([, value]) => value.files.join(',') === 'animated-image-saver.js'));
  h.fail(true);
  assert.equal(await h.apply({}), false, 'registration failure reaches Protection Health');
  assert(h.registration(), 'a failed removal must remain available for retry');
  h.fail(false);
  h.omit();
  await h.apply({ pauseAnimatedImages: true });
  assert.equal(h.registration(), null, 'a package omission removes the registration');
  assert(bg.includes("run('resourceSaver', () => reconcileResourceSaverInjection(cfg)"));
  assert(bg.includes("'reconcileResourceSaverInjection',"), 'settings changes share the serialized applier lane');
  console.log('[ok] optional Resource Saver registrations, live catch-up, failures and scope');
})().catch((error) => { console.error(error); process.exitCode = 1; });
