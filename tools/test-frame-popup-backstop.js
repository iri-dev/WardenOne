/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const source = fs.readFileSync(path.join(__dirname, '..', 'background.js'), 'utf8');
const start = source.indexOf('function chainAbuseTld(host) {');
const end = source.indexOf('// The key a chain is remembered under', start);
assert(start >= 0 && end > start, 'frame popup backstop source is present');
const bootstrapStart = source.indexOf('async function buildRedirectBootstrapSnapshot(sender) {');
const bootstrapEnd = source.indexOf('let __contentConfigRefreshTimer', bootstrapStart);
assert(bootstrapStart >= 0 && bootstrapEnd > bootstrapStart, 'the fast popup configuration reply is present');
assert(/onCreatedNavigationTarget\?\.addListener[\s\S]{0,300}maybeCloseSuspiciousFramePopup\(details\)/.test(source),
  'the popup browser event calls the backstop');
assert(/tabs\.onCreated\.addListener[\s\S]{0,350}maybeCloseOverlaySpawnedPopup\(tab\)/.test(source),
  'new blank tabs are checked against the signed player-overlay signal');
assert(/windows\.onCreated\.addListener[\s\S]{0,500}maybeCloseOverlaySpawnedPopup\(tabs\[0\]\)/.test(source),
  'new popup windows provide a second creation event for the same signed-overlay check');
assert(/signal\('popup-overlay'\)/.test(fs.readFileSync(path.join(__dirname, '..', 'anti-redirect.js'), 'utf8')));
assert(/d\.kind === 'popup-overlay'/.test(fs.readFileSync(path.join(__dirname, '..', 'bridge.js'), 'utf8')));

function world(config = {}, sourceUrl = 'https://playmogo.com/d/1s8i3o0preys', windowType = 'popup') {
  const removed = [], history = [];
  const sandbox = {
    URL, Date, Object, Number, String, Promise,
    DEFAULT_CONFIG: { enabled: true, blockForcedPopups: true, strictPopupShield: true },
    localGet: async () => ({ wardenone_config: config }),
    chrome: { tabs: {
      get: async () => ({ url: sourceUrl }),
      remove: async (id) => { removed.push(id); },
    }, windows: { get: async () => ({ type: windowType }) } },
    siteIdentityBg: h => String(h).split('.').slice(-2).join('.'),
    activeAllowlist: c => c.allowlist || [],
    hostMatchesAllowlist: (h, list) => list.some(d => h === d || h.endsWith('.' + d)),
    hostMatchesSite: (h, d) => h === d || h.endsWith('.' + d),
    queueHistory: item => history.push(item),
    POPUP_OVERLAY_AT: Object.create(null),
    PLAYER_GESTURE_AT: Object.create(null),
  };
  vm.createContext(sandbox);
  vm.runInContext(source.slice(start, end), sandbox);
  return { sandbox, removed, history };
}
const attempt = (w, overrides = {}, armed = true) => {
  if (armed) w.sandbox.PLAYER_GESTURE_AT[11] = Date.now();
  return w.sandbox.maybeCloseSuspiciousFramePopup(Object.assign({
  tabId: 12, sourceTabId: 11, sourceFrameId: 9,
  url: 'https://newsboydurance.cfd/landing?param_3=nortb_fallback',
  }, overrides));
};

(async () => {
  let w = world();
  await attempt(w);
  assert.deepStrictEqual(w.removed, [12], 'the escaped embedded-player popup is closed');
  assert.strictEqual(w.history[0]?.type, 'blocked_popup');
  w = world();
  await attempt(w, { url: 'https://eu2.glaza-bolyat.online/click/?campaign_id=4' });
  assert.deepStrictEqual(w.removed, [12], 'an embedded-player click broker popup is closed without relying on its TLD');
  w = world();
  await attempt(w, { url: 'https://example.online/watch/episode' });
  assert.deepStrictEqual(w.removed, [], 'an ordinary online-domain popup is not classified by its TLD alone');
  w = world(); await attempt(w, {}, false);
  assert.deepStrictEqual(w.removed, [], 'a domain ending alone cannot close an embedded-site popup');
  w = world(); w.sandbox.PLAYER_GESTURE_AT[11] = Date.now() - 9000; await attempt(w, {}, false);
  assert.deepStrictEqual(w.removed, [], 'an old player signal cannot close a later popup');

  for (const details of [
    { sourceFrameId: 0 },
    { url: 'https://accounts.google.com/o/oauth2/auth' },
    { url: 'https://cdn.playmogo.com/video.mp4' },
    { url: 'about:blank' },
  ]) {
    w = world(); await attempt(w, details);
    assert.deepStrictEqual(w.removed, [], 'normal navigation must remain available: ' + JSON.stringify(details));
  }
  for (const config of [
    { enabled: false }, { blockForcedPopups: false }, { strictPopupShield: false },
    { allowlist: ['playmogo.com'] },
    { siteOverrides: { 'playmogo.com': { blockForcedPopups: false } } },
  ]) {
    w = world(config); await attempt(w);
    assert.deepStrictEqual(w.removed, [], 'reader exemption must be honoured: ' + JSON.stringify(config));
  }
  w = world();
  assert.strictEqual(await w.sandbox.maybeCloseOverlaySpawnedPopup({ id: 12, openerTabId: 11, url: 'about:blank' }), false,
    'ordinary staged blank windows remain open');
  w.sandbox.POPUP_OVERLAY_AT[11] = Date.now();
  assert.strictEqual(await w.sandbox.maybeCloseOverlaySpawnedPopup({ id: 12, openerTabId: 11, url: 'about:blank' }), true,
    'a blank window spawned by a confirmed transparent player overlay is closed');
  assert.deepStrictEqual(w.removed, [12]);
  w = world({ allowlist: ['playmogo.com'] });
  w.sandbox.POPUP_OVERLAY_AT[11] = Date.now();
  assert.strictEqual(await w.sandbox.maybeCloseOverlaySpawnedPopup({ id: 12, openerTabId: 11 }), false,
    'a paused site is exempt from staged-popup cleanup');
  w = world();
  w.sandbox.POPUP_OVERLAY_AT[11] = Date.now();
  assert.strictEqual(await w.sandbox.maybeCloseOverlaySpawnedPopup({ id: 12, windowId: 20, url: '' }), true,
    'a blank popup window with no openerTabId is paired with the sole signed overlay gesture');
  w = world({}, 'https://playmogo.com/d/1s8i3o0preys', 'normal');
  w.sandbox.POPUP_OVERLAY_AT[11] = Date.now();
  assert.strictEqual(await w.sandbox.maybeCloseOverlaySpawnedPopup({ id: 12, windowId: 20, url: '' }), false,
    'an ordinary new tab is never guessed to be an overlay popup');
  w = world();
  w.sandbox.POPUP_OVERLAY_AT[11] = Date.now();
  w.sandbox.POPUP_OVERLAY_AT[13] = Date.now();
  assert.strictEqual(await w.sandbox.maybeCloseOverlaySpawnedPopup({ id: 12, windowId: 20, url: '' }), false,
    'ambiguous concurrent overlay gestures do not identify an opener');
  const bootstrap = async config => {
    const context = {
      DEFAULT_CONFIG: { enabled: true, blockForcedPopups: true, strictPopupShield: true },
      localGet: async () => ({ wardenone_config: config }),
      contentConfigFrameHost: () => 'playmogo.com',
      hostMatchesSite: (host, pattern) => host === pattern,
      activeAllowlist: cfg => cfg.allowlist || [],
      Object,
    };
    vm.createContext(context);
    vm.runInContext(source.slice(bootstrapStart, bootstrapEnd), context);
    return (await context.buildRedirectBootstrapSnapshot({})).overrides;
  };
  assert.strictEqual((await bootstrap({ blockForcedPopups: false })).blockForcedPopups, false,
    'the fast reply keeps a globally disabled popup guard off');
  assert.strictEqual((await bootstrap({ siteOverrides: { 'playmogo.com': { strictPopupShield: false } } })).strictPopupShield, false,
    'the fast reply respects a per-site switch');
  assert.strictEqual((await bootstrap({ allowlist: ['playmogo.com'] })).allowlist[0], 'playmogo.com',
    'the fast reply carries the site pause');
  /* The player-frame guards run on it until the full config arrives, so it carries their switch. */
  assert.strictEqual((await bootstrap({})).blockPopupTricks, true, 'the fast reply arms the player-frame guards by default');
  assert.strictEqual((await bootstrap({ blockPopupTricks: false })).blockPopupTricks, false,
    'the fast reply keeps the player-frame guards off when they are turned off');
  assert.strictEqual((await bootstrap({ siteOverrides: { 'playmogo.com': { blockPopupTricks: false } } })).blockPopupTricks, false,
    'the fast reply respects a per-site player-frame switch');
  console.log('frame popup backstop tests passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
