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
assert(/onCreatedNavigationTarget\?\.addListener[\s\S]{0,400}recheckMismatchedLinkPopup\(details\)/.test(source),
  'the popup browser event retries after the signed press arrives');
assert(/tabs\.onCreated\.addListener[\s\S]{0,350}maybeCloseOverlaySpawnedPopup\(tab\)/.test(source),
  'new blank tabs are checked against the signed player-overlay signal');
assert(/windows\.onCreated\.addListener[\s\S]{0,500}maybeCloseOverlaySpawnedPopup\(tabs\[0\]\)/.test(source),
  'new popup windows provide a second creation event for the same signed-overlay check');
assert(/signal\('popup-overlay'\)/.test(fs.readFileSync(path.join(__dirname, '..', 'anti-redirect.js'), 'utf8')));
assert(/d\.kind === 'popup-overlay'/.test(fs.readFileSync(path.join(__dirname, '..', 'bridge.js'), 'utf8')));

function world(config = {}, sourceUrl = 'https://playmogo.com/d/1s8i3o0preys', windowType = 'popup') {
  const removed = [], created = [], history = [], scheduled = [], notices = [];
  let currentUrl = sourceUrl;
  let targetUrl = 'about:blank';
  const sandbox = {
    URL, Date, Object, Number, String, Promise,
    setTimeout: fn => { scheduled.push(fn); },
    DEFAULT_CONFIG: { enabled: true, blockForcedPopups: true, strictPopupShield: true },
    localGet: async () => ({ wardenone_config: config }),
    chrome: { runtime: { getURL: (name) => name }, declarativeNetRequest: {},
      webRequest: { onErrorOccurred: { addListener() {} } }, tabs: {
      get: async (id) => ({ url: id === 12 ? targetUrl : currentUrl, windowId: 20 }),
      remove: async (id) => { removed.push(id); },
      create: async (options) => { created.push(options); },
      sendMessage: (id, message, options) => {
        notices.push({ id, message, options });
        if (message && message.kind === 'open-pressed-download') {
          return sandbox.__pageNavigates ? Promise.resolve({ ok: true }) : Promise.reject(new Error('no receiver'));
        }
      },
    }, windows: { get: async () => ({ type: windowType }) } },
    siteIdentityBg: h => String(h).split('.').slice(-2).join('.'),
    activeAllowlist: c => c.allowlist || [],
    hostMatchesAllowlist: (h, list) => list.some(d => h === d || h.endsWith('.' + d)),
    hostMatchesSite: (h, d) => h === d || h.endsWith('.' + d),
    isLoginCompatibilityUrl: url => new URL(url).hostname === 'accounts.google.com',
    queueHistory: item => history.push(item),
    POPUP_OVERLAY_AT: Object.create(null),
    PLAYER_GESTURE_AT: Object.create(null),
    PRESSED_LINK_AT: Object.create(null),
    PRESSED_LINK_HOST: Object.create(null),
    PRESSED_LINK_URL: Object.create(null),
    PRESSED_LINK_SOURCE_URL: Object.create(null),
    PRESSED_LINK_TARGET_AT: Object.create(null),
    PRESSED_LINK_RESTORE_AT: Object.create(null),
  };
  vm.createContext(sandbox);
  vm.runInContext(source.slice(start, end), sandbox);
  return { sandbox, removed, created, history, notices, navigate: url => { currentUrl = url; },
    setTarget: url => { targetUrl = url; }, flushOne: async () => { await scheduled.shift()?.(); }, flush: async () => {
    while (scheduled.length) await scheduled.shift()();
  } };
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
  assert.strictEqual(w.notices.length, 1, 'a confirmed worker block reaches the source page');
  assert.strictEqual(w.notices[0].id, 11);
  assert.strictEqual(w.notices[0].message.type, 'blocked_popup');
  assert.strictEqual(w.notices[0].options.frameId, 0);
  w = world();
  await attempt(w, { url: 'https://eu2.glaza-bolyat.online/click/?campaign_id=4' });
  assert.deepStrictEqual(w.removed, [12], 'an embedded-player click broker popup is closed without relying on its TLD');
  const auctionUrl = 'https://armvupzc.in/dfulal/maxo/dz?payload=' + 'x'.repeat(1700)
    + Array.from({ length: 28 }, (_, n) => '&r' + n + '=' + n).join('');
  w = world({}, 'https://pawchive.pw/patreon/user/4618037');
  await attempt(w, { sourceFrameId: 0, url: auctionUrl }, false);
  assert.deepStrictEqual(w.removed, [12], 'a top-frame ad-auction popup closes without a player gesture');
  assert.strictEqual(w.history[0]?.detail.why, 'A page opened an ad-auction popup.');
  await w.flush();
  assert.deepStrictEqual(w.created, [], 'with no pressed download, closing the auction opens nothing');
  /* SteamRIP 2026-10-31: the ad spent the click's one popup, so the download link's own tab never opened. */
  w = world({}, 'https://steamrip.com/game');
  w.sandbox.PRESSED_LINK_AT[11] = Date.now();
  w.sandbox.PRESSED_LINK_HOST[11] = 'fileditchfiles.st';
  w.sandbox.PRESSED_LINK_URL[11] = 'https://fileditchfiles.st/balpha5/677b/Game.rar';
  w.sandbox.PRESSED_LINK_SOURCE_URL[11] = 'https://steamrip.com/game';
  const sessionWrites = [];
  w.sandbox.PRESSED_DOWNLOAD_REFERER_RULE_ID = 900009;
  w.sandbox.writeSessionRules = async (change) => { sessionWrites.push(change); };
  await attempt(w, { sourceFrameId: 0, url: auctionUrl }, false);
  await w.flush();
  assert.deepStrictEqual(w.removed, [12]);
  assert.deepStrictEqual(w.created.map(tab => tab.url), ['https://fileditchfiles.st/balpha5/677b/Game.rar'],
    'closing an ad-auction popup reopens the download the reader pressed');
  /* bzzhr.to sends a visit without SteamRIP's Referer to SteamRIP's home page. */
  const referer = sessionWrites[0] && sessionWrites[0].addRules[0];
  assert(referer && referer.action.requestHeaders[0].header === 'referer'
    && referer.action.requestHeaders[0].value === 'https://steamrip.com/'
    && referer.condition.urlFilter === '|https://fileditchfiles.st/balpha5/677b/Game.rar|'
    && JSON.stringify(referer.condition.resourceTypes) === '["main_frame"]',
    'the reopened download carries the page origin as Referer, for that one address: ' + JSON.stringify(sessionWrites));
  assert(sessionWrites.some(change => change.removeRuleIds[0] === 900009 && change.addRules.length === 0),
    'the Referer rule is removed again');
  /* 2026-10-31: a tab the worker opens carries Sec-Fetch-Site: none whatever its Referer says, and bzzhr.to
     still sent it to the home page. The page navigating itself is a navigation of the page's own. */
  w = world({}, 'https://steamrip.com/game');
  w.sandbox.__pageNavigates = true;
  w.sandbox.PRESSED_LINK_AT[11] = Date.now();
  w.sandbox.PRESSED_LINK_HOST[11] = 'fileditchfiles.st';
  w.sandbox.PRESSED_LINK_URL[11] = 'https://fileditchfiles.st/balpha5/677b/Game.rar';
  w.sandbox.PRESSED_LINK_SOURCE_URL[11] = 'https://steamrip.com/game';
  w.sandbox.writeSessionRules = async () => {};
  await attempt(w, { sourceFrameId: 0, url: auctionUrl }, false);
  await w.flush();
  const asked = w.notices.filter(note => note.message.kind === 'open-pressed-download');
  assert.strictEqual(asked.length, 1, 'the page is asked to open the download it pressed');
  assert.strictEqual(asked[0].id, 11);
  assert.strictEqual(asked[0].options.frameId, 0, 'only the top frame is asked');
  assert.strictEqual(asked[0].message.url, 'https://fileditchfiles.st/balpha5/677b/Game.rar');
  assert.deepStrictEqual(w.created, [], 'a page that navigates itself needs no tab opened for it');
  assert(/kind === 'open-pressed-download' && window === window\.top/.test(fs.readFileSync(path.join(__dirname, '..', 'bridge.js'), 'utf8')),
    'the bridge obeys it only in the top frame');
  w = world({ capReferrer: true }, 'https://steamrip.com/game');
  w.sandbox.PRESSED_LINK_AT[11] = Date.now();
  w.sandbox.PRESSED_LINK_HOST[11] = 'fileditchfiles.st';
  w.sandbox.PRESSED_LINK_URL[11] = 'https://fileditchfiles.st/balpha5/677b/Game.rar';
  w.sandbox.PRESSED_LINK_SOURCE_URL[11] = 'https://steamrip.com/game';
  const strictWrites = [];
  w.sandbox.PRESSED_DOWNLOAD_REFERER_RULE_ID = 900009;
  w.sandbox.writeSessionRules = async (change) => { strictWrites.push(change); };
  await attempt(w, { sourceFrameId: 0, url: auctionUrl }, false);
  await w.flush();
  /* 2026-10-31: strict referrer mode used to mean the reopened download carried no Referer either, and the
     download host sent it to its own home page. The reader pressed this link; it keeps the page's origin. */
  const strictReferer = strictWrites[0] && strictWrites[0].addRules[0];
  assert(w.created.length === 1 && strictReferer
    && strictReferer.action.requestHeaders[0].value === 'https://steamrip.com/'
    && strictReferer.priority > 2,
  'strict referrer mode still lets the pressed download carry the page origin, above the header shield: ' + JSON.stringify(strictWrites));
  /* 2026-10-31, the SteamRIP button, measured in Chrome and against a browser with no extension: no popup was
     involved at all. Strict cross-site referrer protection removed the Referer from the navigation itself, and
     bzzhr.to sends a visit without one to steamrip.com. Pressing a cross-site link now keeps the page's origin
     for that address, and only with that setting on. */
  {
    const pressed = 'https://bzzhr.to/hut8hw900l9a';
    const press = async (config) => {
      const p = world(config, 'https://steamrip.com/game');
      const writes = [];
      p.sandbox.PRESSED_DOWNLOAD_REFERER_RULE_ID = 900009;
      p.sandbox.writeSessionRules = async (change) => { writes.push(change); };
      await p.sandbox.keepPressedLinkReferer(pressed, 'https://steamrip.com');
      return writes;
    };
    const strict = await press({ capReferrer: true });
    const rule = strict[0] && strict[0].addRules[0];
    assert(rule && rule.action.requestHeaders[0].header === 'referer'
      && rule.action.requestHeaders[0].value === 'https://steamrip.com/'
      && rule.condition.urlFilter === '|' + pressed + '|'
      && JSON.stringify(rule.condition.resourceTypes) === '["main_frame"]'
      && rule.priority > 2,
    'a pressed cross-site link keeps the page origin, for that address, in the top frame: ' + JSON.stringify(strict));
    assert.deepStrictEqual(await press({}), [], 'with the setting off the browser already sends it, so nothing is added');
    assert.deepStrictEqual(await press({ capReferrer: true, enabled: false }), [], 'and nothing is added while WardenOne is off');
  }
  w = world({}, 'https://pawchive.pw/patreon/user/4618037');
  await attempt(w, { sourceFrameId: 0, url: 'https://accounts.google.com/o/oauth2/auth?state=' + 'x'.repeat(1100) }, false);
  assert.deepStrictEqual(w.removed, [], 'a long OAuth popup remains available');
  w = world({}, 'https://pawchive.pw/patreon/user/4618037');
  await attempt(w, { sourceFrameId: 0, url: auctionUrl.replace('armvupzc.in/dfulal/maxo/dz', 'accounts.google.com/o/oauth2/auth') }, false);
  assert.deepStrictEqual(w.removed, [], 'a dense known-auth URL remains available');
  w = world({}, 'https://pawchive.pw/patreon/user/4618037');
  await attempt(w, { sourceFrameId: 0, url: 'https://armvupzc.in/dfulal/maxo/dz?payload=short&r0=1' }, false);
  assert.deepStrictEqual(w.removed, [], 'short links do not trigger the auction backstop');
  w = world({}, 'https://pawchive.pw/patreon/user/4618037');
  await attempt(w, { sourceFrameId: 0, url: 'https://example.com/path?payload=' + 'x'.repeat(1700) }, false);
  assert.deepStrictEqual(w.removed, [], 'one long query value is not enough to close a popup');
  for (const config of [{ enabled: false }, { blockForcedPopups: false }, { strictPopupShield: false }, { allowlist: ['pawchive.pw'] }]) {
    w = world(config, 'https://pawchive.pw/patreon/user/4618037');
    await attempt(w, { sourceFrameId: 0, url: auctionUrl }, false);
    assert.deepStrictEqual(w.removed, [], 'auction backstop respects reader settings: ' + JSON.stringify(config));
  }
  w = world();
  await attempt(w, { url: 'https://example.online/watch/episode' });
  assert.deepStrictEqual(w.removed, [], 'an ordinary online-domain popup is not classified by its TLD alone');
  w = world(); await attempt(w, {}, false);
  assert.deepStrictEqual(w.removed, [], 'a domain ending alone cannot close an embedded-site popup');
  w = world(); w.sandbox.PLAYER_GESTURE_AT[11] = Date.now() - 9000; await attempt(w, {}, false);
  assert.deepStrictEqual(w.removed, [], 'an old player signal cannot close a later popup');

  const linkPopup = (environment, url, sourceFrameId = 0) => environment.sandbox.maybeCloseMismatchedLinkPopup({
    tabId: 12, sourceTabId: 11, sourceFrameId, url,
  });
  w = world({}, 'https://pawchive.pw/patreon/user/4618037/post/172291325');
  w.sandbox.PRESSED_LINK_AT[11] = Date.now();
  w.sandbox.PRESSED_LINK_HOST[11] = 'pawchive.pw';
  w.sandbox.PRESSED_LINK_SOURCE_URL[11] = 'https://pawchive.pw/patreon/user/4618037';
  assert.strictEqual(await linkPopup(w, 'https://go.clickwhore.com/pop.go?spaceid=12493721'), true,
    'an unrelated native ad tab is closed after a real same-site post click');
  assert.deepStrictEqual(w.removed, [12]);
  await w.flush();
  assert.deepStrictEqual(w.created, [], 'ordinary post links need no replacement tab');
  w = world({}, 'https://pawchive.pw/patreon/user/4618037');
  assert.strictEqual(await w.sandbox.recheckMismatchedLinkPopup({
    tabId: 12, sourceTabId: 11, sourceFrameId: 0, url: 'about:blank',
  }), false, 'an unsigned blank popup is initially ambiguous');
  w.sandbox.PRESSED_LINK_AT[11] = Date.now();
  w.sandbox.PRESSED_LINK_HOST[11] = 'pawchive.pw';
  w.sandbox.PRESSED_LINK_SOURCE_URL[11] = 'https://pawchive.pw/patreon/user/4618037';
  w.setTarget('https://www.oncehuman.game/uags/?channel=pwn&utm_source=pwngames');
  await w.flush();
  assert.deepStrictEqual(w.removed, [12], 'a late click beacon closes the popup at its eventual ad destination');
  w = world({}, 'https://pawchive.pw/patreon/user/4618037');
  assert.strictEqual(await w.sandbox.recheckMismatchedLinkPopup({
    tabId: 12, sourceTabId: 11, sourceFrameId: 0, url: 'about:blank',
  }), false);
  w.sandbox.PRESSED_LINK_AT[11] = Date.now();
  w.sandbox.PRESSED_LINK_HOST[11] = 'pawchive.pw';
  w.sandbox.PRESSED_LINK_SOURCE_URL[11] = 'https://pawchive.pw/patreon/user/4618037';
  w.setTarget('https://pawchive.pw/patreon/user/4618037/post/172291325');
  await w.flush();
  assert.deepStrictEqual(w.removed, [], 'a late beacon keeps the intended Pawchive tab');
  w = world({}, 'https://pawchive.pw/patreon/user/4618037/post/172291325');
  w.sandbox.PRESSED_LINK_AT[11] = Date.now();
  w.sandbox.PRESSED_LINK_HOST[11] = 'pawchive.pw';
  w.sandbox.PRESSED_LINK_SOURCE_URL[11] = 'https://pawchive.pw/patreon/user/4618037';
  assert.strictEqual(await linkPopup(w, 'https://pawchive.pw/patreon/user/4618037/post/172291325'), false,
    'a native tab matching the post link remains open');
  assert.strictEqual(await linkPopup(w, 'https://login.custom-idp.org/authorize'), false,
    'a sign-in destination remains open after a same-site link press');
  w.navigate('https://unrelated.example/page');
  assert.strictEqual(await linkPopup(w, 'https://go.clickwhore.com/pop.go?spaceid=12493721'), false,
    'a later page on another site cannot inherit the press');
  w = world({}, 'https://pawchive.pw/patreon/user/4618037/post/172291325');
  w.sandbox.PRESSED_LINK_AT[11] = Date.now();
  w.sandbox.PRESSED_LINK_HOST[11] = 'pawchive.pw';
  w.sandbox.PRESSED_LINK_SOURCE_URL[11] = 'https://pawchive.pw/patreon/user/4618037';
  assert.strictEqual(await linkPopup(w, 'https://go.clickwhore.com/pop.go?spaceid=12493721', 9), true,
    'an ad frame cannot spend a genuine post click on a different tab');
  w = world({}, 'https://gamedrive.org/game');
  w.sandbox.PRESSED_LINK_AT[11] = Date.now();
  w.sandbox.PRESSED_LINK_HOST[11] = 'link-vault.org';
  assert.strictEqual(await linkPopup(w, 'https://login.custom-idp.org/authorize'), false,
    'ordinary link clicks do not close an unfamiliar identity provider');
  assert.deepStrictEqual(w.removed, []);
  w.sandbox.PRESSED_LINK_URL[11] = 'https://link-vault.org/c/example#torrent';
  w.sandbox.PRESSED_LINK_SOURCE_URL[11] = 'https://gamedrive.org/game';
  assert.strictEqual(await linkPopup(w, 'https://link-file-def.ai3zxo9jn.space/download'), true);
  assert.deepStrictEqual(w.removed, [12]);
  assert.strictEqual(w.history[0]?.type, 'blocked_popup');
  assert.strictEqual(w.notices.length, 1, 'a mismatched-link popup also notifies the source page');
  await w.flush();
  assert.deepStrictEqual(w.created.map(tab => tab.url), ['https://link-vault.org/c/example#torrent'],
    'a confirmed hijack restores the exact download link once');
  assert.strictEqual(w.created[0].openerTabId, undefined,
    'a recovered external tab has no opener relationship to the source page');
  w = world({}, 'https://gamedrive.org/game');
  w.sandbox.PRESSED_LINK_AT[11] = Date.now();
  w.sandbox.PRESSED_LINK_HOST[11] = 'link-vault.org';
  w.sandbox.PRESSED_LINK_URL[11] = 'https://link-vault.org/c/example#torrent';
  w.sandbox.PRESSED_LINK_SOURCE_URL[11] = 'https://gamedrive.org/game';
  assert.strictEqual(await linkPopup(w, 'https://link-file-def.ai3zxo9jn.space/download'), true);
  w.sandbox.notePressedLinkTarget({ sourceTabId: 11, sourceFrameId: 0, url: 'https://link-vault.org/c/example#torrent' });
  await w.flush();
  assert.deepStrictEqual(w.created, [], 'the native intended tab prevents a duplicate restore');
  for (const lateBeacon of [false, true]) {
    w = world({}, 'https://gamedrive.org/game');
    const arm = () => {
      w.sandbox.PRESSED_LINK_AT[11] = Date.now();
      w.sandbox.PRESSED_LINK_HOST[11] = 'link-vault.org';
      w.sandbox.PRESSED_LINK_URL[11] = 'https://link-vault.org/c/example#torrent';
      w.sandbox.PRESSED_LINK_SOURCE_URL[11] = 'https://gamedrive.org/game';
    };
    if (!lateBeacon) arm();
    await w.sandbox.recheckMismatchedLinkPopup({
      tabId: 12, sourceTabId: 11, sourceFrameId: 0, url: 'https://link-vault.org/c/example#torrent',
    });
    if (lateBeacon) arm();
    w.setTarget('https://gofile.io/d/example');
    await w.flush();
    assert.deepStrictEqual(w.removed, [], 'the chosen tab can redirect to a file host; late beacon: ' + lateBeacon);
    assert.deepStrictEqual(w.created, [], 'following the chosen link never creates a replacement tab');
  }
  w = world({}, 'https://gamedrive.org/game');
  w.sandbox.PRESSED_LINK_AT[11] = Date.now();
  w.sandbox.PRESSED_LINK_HOST[11] = 'link-vault.org';
  w.sandbox.PRESSED_LINK_URL[11] = 'https://link-vault.org/c/example#torrent';
  w.sandbox.PRESSED_LINK_SOURCE_URL[11] = 'https://gamedrive.org/game';
  await w.sandbox.recheckMismatchedLinkPopup({
    tabId: 12, sourceTabId: 11, sourceFrameId: 0, url: 'about:blank',
  });
  w.setTarget('https://link-vault.org/c/example#torrent');
  await w.flushOne();
  w.setTarget('https://gofile.io/d/example');
  await w.flush();
  assert.deepStrictEqual(w.removed, [], 'a staged blank tab that reaches the chosen host remains open');
  assert.strictEqual(await w.sandbox.recheckMismatchedLinkPopup({
    tabId: 13, sourceTabId: 11, sourceFrameId: 0, url: 'https://fake-downloader.example/ad',
  }), true, 'matching the intended tab does not protect a separate ad tab');
  await w.flush();
  assert.deepStrictEqual(w.removed, [13]);
  assert.deepStrictEqual(w.created, [], 'closing that ad does not duplicate the intended download');
  w = world({}, 'https://gamedrive.org/game');
  w.sandbox.PRESSED_LINK_AT[11] = Date.now();
  w.sandbox.PRESSED_LINK_URL[11] = 'https://link-vault.org/c/example#torrent';
  w.sandbox.PRESSED_LINK_SOURCE_URL[11] = 'https://gamedrive.org/game';
  w.sandbox.schedulePressedDownloadRestore(11);
  w.navigate('https://gamedrive.org/other');
  await w.flush();
  assert.deepStrictEqual(w.created, [], 'a source page that changed after the click is not redirected');
  w = world({ allowlist: ['gamedrive.org'] }, 'https://gamedrive.org/game');
  w.sandbox.PRESSED_LINK_AT[11] = Date.now();
  w.sandbox.PRESSED_LINK_URL[11] = 'https://link-vault.org/c/example#torrent';
  w.sandbox.PRESSED_LINK_SOURCE_URL[11] = 'https://gamedrive.org/game';
  w.sandbox.schedulePressedDownloadRestore(11);
  await w.flush();
  assert.deepStrictEqual(w.created, [], 'an allowlisted page cannot trigger recovery');
  for (const [url, frame, config, age] of [
    ['https://link-vault.org/c/example', 0, {}, 0],
    ['https://link-file-abc.ai3zxo9jn.space/download', 2, {}, 0],
    ['https://accounts.google.com/o/oauth2/auth', 0, {}, 0],
    ['https://link-file-abc.ai3zxo9jn.space/download', 0, { blockForcedPopups: false }, 0],
    ['https://link-file-abc.ai3zxo9jn.space/download', 0, { allowlist: ['gamedrive.org'] }, 0],
    ['https://link-file-abc.ai3zxo9jn.space/download', 0, {}, 2000],
  ]) {
    w = world(config, 'https://gamedrive.org/game');
    w.sandbox.PRESSED_LINK_AT[11] = Date.now() - age;
    w.sandbox.PRESSED_LINK_HOST[11] = 'link-vault.org';
    w.sandbox.PRESSED_LINK_URL[11] = 'https://link-vault.org/c/example#torrent';
    w.sandbox.PRESSED_LINK_SOURCE_URL[11] = 'https://gamedrive.org/game';
    assert.strictEqual(await linkPopup(w, url, frame), false,
      'native popup compatibility case stays open: ' + url + ' / frame ' + frame);
  }

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
    assert.deepStrictEqual(w.notices, [], 'reader exemptions must not announce a block');
  }
  for (const config of [{ enabled: false }, { blockForcedPopups: false }, { strictPopupShield: false }, { allowlist: ['pawchive.pw'] }]) {
    w = world(config, 'https://pawchive.pw/patreon/user/4618037');
    await attempt(w, { sourceFrameId: 0, url: auctionUrl }, false);
    assert.deepStrictEqual(w.removed, [], 'top-frame auction backstop respects the reader switch: ' + JSON.stringify(config));
  }
  w = world();
  assert.strictEqual(await w.sandbox.maybeCloseOverlaySpawnedPopup({ id: 12, openerTabId: 11, url: 'about:blank' }), false,
    'ordinary staged blank windows remain open');
  w.sandbox.POPUP_OVERLAY_AT[11] = Date.now();
  assert.strictEqual(await w.sandbox.maybeCloseOverlaySpawnedPopup({ id: 12, openerTabId: 11, url: 'about:blank' }), true,
    'a blank window spawned by a confirmed transparent player overlay is closed');
  assert.deepStrictEqual(w.removed, [12]);
  assert.strictEqual(w.notices.length, 1, 'an overlay popup block notifies the source page');
  w = world();
  w.sandbox.PLAYER_GESTURE_AT[11] = Date.now();
  assert.strictEqual(await w.sandbox.maybeCloseOverlaySpawnedPopup({ id: 12, openerTabId: 11, url: 'about:blank' }), true,
    'a Playmogo player press closes a staged blank popup without an overlay signal');
  assert.deepStrictEqual(w.removed, [12]);
  w = world({}, 'https://example.com/video');
  w.sandbox.PLAYER_GESTURE_AT[11] = Date.now();
  assert.strictEqual(await w.sandbox.maybeCloseOverlaySpawnedPopup({ id: 12, openerTabId: 11, url: 'about:blank' }), false,
    'the player gesture alone does not close blank popups on unrelated players');
  w = world();
  w.sandbox.PLAYER_GESTURE_AT[11] = Date.now();
  assert.strictEqual(await w.sandbox.maybeCloseOverlaySpawnedPopup({ id: 12, openerTabId: 11, url: 'https://accounts.google.com/o/oauth2/auth' }), false,
    'a player gesture does not close a popup with a nonblank destination');
  for (const config of [{ enabled: false }, { blockForcedPopups: false }, { strictPopupShield: false },
    { allowlist: ['playmogo.com'] }, { siteOverrides: { 'playmogo.com': { strictPopupShield: false } } }]) {
    w = world(config);
    w.sandbox.PLAYER_GESTURE_AT[11] = Date.now();
    assert.strictEqual(await w.sandbox.maybeCloseOverlaySpawnedPopup({ id: 12, openerTabId: 11, url: 'about:blank' }), false,
      'Playmogo blank popup cleanup respects reader settings: ' + JSON.stringify(config));
  }
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
