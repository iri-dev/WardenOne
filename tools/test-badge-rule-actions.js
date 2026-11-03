/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE. */
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { helpers } = require('./build-cname-data.js');
const resourceTypes = require('./lib/resource-types.js');
const source = fs.readFileSync('background.js', 'utf8');
const registry = fs.readFileSync('protection-event-settings.js', 'utf8');
const start = source.indexOf('const BADGE_RULE_EVENTS =');
const end = source.indexOf('async function siteRecoveryAction(', start);
assert(start >= 0 && end > start);
const defaultsStart = source.indexOf('const DEFAULT_CONFIG =');
const defaultsEnd = source.indexOf('\n};', defaultsStart) + 3;
const plain = value => JSON.parse(JSON.stringify(value));

function world(options = {}) {
  const state = { config: { enabled: true, blockMetaRefresh: true, blockThirdPartyCookies: true,
    blockPopupTricks: true, siteOverrides: { 'other.example.org': { removeOverlays: false },
      'shop.example.org': { blockAutoplayMedia: false } }, ...(options.config || {}) },
  saved: [], created: [], reloaded: [], cookies: [], rules: [], media: [], checks: 0, tabChecks: 0 };
  let queue = Promise.resolve();
  const ctx = {
    URL, console: { warn() {} }, __privacyEraseInProgress: false,
    normalizeAllowlistHost: host => String(host).replace(/^www\./, '').toLowerCase(),
    hostMatchesSite: (host, pattern) => host === pattern || host.endsWith('.' + pattern),
    messageSenderIsExtensionPath: (sender, path) => sender?.id === 'test' && !sender.tab && sender.url === 'chrome-extension://test/' + path,
    messageSenderIsTab: sender => !!sender && sender.id === 'test' && Number.isInteger(sender.tab?.id)
      && sender.tab.id >= 0 && /^https?:/.test(sender.url),
    messageSenderStillCurrent: async (sender, exact) => {
      assert.equal(exact, true);
      state.checks++;
      return options.stale !== true && state.checks !== options.staleOnCheck;
    },
    updateStoredConfig: fn => {
      const work = queue.then(async () => {
        const cfg = structuredClone(state.config);
        if (await fn(cfg) === false) return null;
        if (options.failSave) throw Error('storage rejected');
        state.config = cfg; state.saved.push(structuredClone(cfg)); return cfg;
      });
      queue = work.catch(() => {}); return work;
    },
    localGet: async () => ({ wardenone_config: structuredClone(state.config) }),
    applyThirdPartyCookieRule: async (enabled, cfg) => { state.cookies.push(['passive', enabled, plain(cfg)]); if (options.holdCookie) await options.holdCookie; return options.cookieFailure ? false : undefined; },
    applyTrackerCookieRule: async (enabled, cfg) => { state.cookies.push(['tracker', enabled, plain(cfg)]); return undefined; },
    applyMediaCompatibilityRules: async (enabled, _read, _submit, cfg) => { state.media.push([enabled, plain(cfg)]); if (options.holdMedia) await options.holdMedia; return options.mediaFailure ? false : undefined; },
    chrome: { runtime: { getURL: path => 'chrome-extension://test/' + path },
      tabs: { get: async id => {
        state.tabChecks++;
        return { id, active: true, url: state.tabChecks === options.staleOnTabCheck ? 'https://other.example/' : 'https://www.youtube.com/watch?v=example', ...(options.tab || {}) };
      }, reload: async id => { state.reloaded.push(id); }, create: async change => { state.created.push(change); } } },
  };
  vm.createContext(ctx);
  vm.runInContext(registry + '\n' + source.slice(defaultsStart, defaultsEnd), ctx);
  if (options.badRegistry) ctx.WardenProtectionEvents = { pauseKeysFor: () => options.badRegistry };
  vm.runInContext(source.slice(start, end) + '\nthis.action=badgeRuleAction;this.enableYoutube=enableYoutubeForSite;', ctx);
  const sender = { id: 'test', frameId: 0, documentId: 'current-document', tab: { id: 7 }, url: 'https://www.shop.example.org/item' };
  if (options.nativeCookies) {
    const { WOCname } = helpers();
    Object.assign(ctx, { WOCname, ...resourceTypes.resolveAll(source),
      THIRD_PARTY_COOKIE_RULE_ID: Number(source.match(/const THIRD_PARTY_COOKIE_RULE_ID = (\d+)/)[1]),
      TRACKER_COOKIE_ALIAS_RULE_BASE: 901000, TRACKER_COOKIE_ALIAS_RULES_BUDGET: 300,
      LOGIN_COMPAT_NEVER_BLOCK_DOMAINS: ['accounts.google.com'], MEDIA_COMPAT_DOMAINS: new Set(['youtube.com']),
      activeAllowlist: cfg => cfg.allowlist || [], isProtectedTrackerDomain: () => false, isMediaCompatDomain: () => false,
      packagedHeaderTrackerDomains: async () => ['doubleclick.net'], loadKnownAliases: async () => new Map(),
      scheduleContentConfigRefresh() {}, writeSessionRules: async change => { state.rules.push(plain(change)); },
    });
    ctx.chrome.declarativeNetRequest = { updateSessionRules: async () => {} };
    const passiveStart = source.indexOf("let __thirdPartyCookieRuleStateKey = '';");
    const passiveEnd = source.indexOf('const TRACKER_COOKIE_RULE_ID', passiveStart);
    const trackerEnd = source.indexOf('// Read the setting and apply. Called on install/startup', passiveEnd);
    vm.runInContext(source.slice(passiveStart, passiveEnd) + '\n' + source.slice(passiveEnd, trackerEnd), ctx);
  }
  return { state, ctx, sender, run: (msg, override = {}) => ctx.action(msg, { ...sender, ...override }) };
}

(async () => {
  let count = 0;
  async function check(name, fn) { await fn(); count++; console.log('[ok] ' + name); }
  const popupSender = { id: 'test', url: 'chrome-extension://test/popup.html' };
  const enableMessage = { kind: 'enable-youtube-for-site', tabId: 7 };
  await check('popup YouTube restore removes the exact pause, enables the feature, and reconciles before reload', async () => {
    let release; const holdMedia = new Promise(resolve => { release = resolve; });
    const w = world({ holdMedia, config: { scriptletEngine: false, siteOverrides: {
      'youtube.com': { scriptletEngine: false, mediaShield: false }, 'other.example': { scriptletEngine: false } } } });
    let done = false;
    const pending = w.ctx.enableYoutube(enableMessage, popupSender).then(result => { done = true; return result; });
    for (let i = 0; i < 30; i++) await Promise.resolve();
    assert.equal(w.state.media.length, 1); assert.equal(done, false); assert.equal(w.state.reloaded.length, 0);
    release(); assert.deepEqual(plain(await pending), { ok: true, reloaded: true });
    assert.equal(w.state.config.scriptletEngine, true);
    assert.deepEqual(plain(w.state.config.siteOverrides), { 'youtube.com': { mediaShield: false }, 'other.example': { scriptletEngine: false } });
    assert.deepEqual(w.state.reloaded, [7]);
  });
  await check('popup restore is idempotent after the last site override was deleted', async () => {
    const w = world({ config: { siteOverrides: undefined } });
    assert.equal((await w.ctx.enableYoutube(enableMessage, popupSender)).ok, true);
    assert.equal(w.state.config.scriptletEngine, true); assert.deepEqual(w.state.reloaded, [7]);
  });
  await check('popup restore rejects foreign callers, extra fields, and caller-selected origins', async () => {
    for (const sender of [{}, { ...popupSender, id: 'foreign' }, { ...popupSender, url: 'chrome-extension://test/settings.html' }, { ...popupSender, tab: { id: 7 } }]) {
      const w = world(); assert.equal((await w.ctx.enableYoutube(enableMessage, sender)).ok, false); assert.equal(w.state.saved.length, 0);
    }
    for (const extra of [{ host: 'youtube.com' }, { tabId: -1 }, { tabId: '7' }, { kind: 'other' }]) {
      const w = world(); assert.equal((await w.ctx.enableYoutube({ ...enableMessage, ...extra }, popupSender)).ok, false); assert.equal(w.state.saved.length, 0);
    }
  });
  await check('popup restore validates the actual active regular YouTube tab', async () => {
    for (const tab of [{ active: false }, { incognito: true }, { url: 'https://youtube.com.evil.example/' }, { url: 'https://user@youtube.com/' }, { url: 'file:///youtube.com' }]) {
      const w = world({ tab }); assert.equal((await w.ctx.enableYoutube(enableMessage, popupSender)).ok, false); assert.equal(w.state.saved.length, 0);
    }
  });
  await check('popup restore preserves master-off and wider site exceptions and fails closed on malformed storage', async () => {
    for (const config of [{ enabled: false }, { siteOverrides: [] }, { siteOverrides: null },
      { siteOverrides: { 'youtube.com': { scriptletEngine: false }, 'www.youtube.com': { mediaShield: false } } }]) {
      const w = world({ config, tab: { url: 'https://music.youtube.com/' } });
      assert.equal((await w.ctx.enableYoutube(enableMessage, popupSender)).ok, false); assert.equal(w.state.saved.length, 0);
    }
  });
  await check('popup restore never reloads a changed tab or reloads after an apply failure', async () => {
    for (const options of [{ mediaFailure: true }, { failSave: true }, { staleOnTabCheck: 2 }]) {
      const w = world(options); assert.equal((await w.ctx.enableYoutube(enableMessage, popupSender)).ok, false); assert.equal(w.state.reloaded.length, 0);
    }
    const w = world({ staleOnTabCheck: 3 });
    assert.deepEqual(plain(await w.ctx.enableYoutube(enableMessage, popupSender)), { ok: true, reloaded: false }); assert.equal(w.state.reloaded.length, 0);
  });
  await check('pausing one observed rule writes only its canonical site override and never reloads', async () => {
    const w = world(), before = structuredClone(w.state.config);
    const result = await w.run({ kind: 'badge-rule-pause', type: 'blocked_meta_refresh' });
    assert.deepEqual(plain(result), { ok: true, site: 'shop.example.org', key: 'blockMetaRefresh', requiresReload: true });
    before.siteOverrides['shop.example.org'].blockMetaRefresh = false;
    assert.deepEqual(plain(w.state.config), before);
    assert.deepEqual(w.state.reloaded, []);
  });
  await check('serialized per-rule writes preserve other site settings and global flags', async () => {
    const w = world();
    await Promise.all(['blocked_meta_refresh', 'blocked_frame_top_redirect'].map(type => w.run({ kind: 'badge-rule-pause', type })));
    assert.deepEqual(plain(w.state.config.siteOverrides['shop.example.org']), { blockAutoplayMedia: false, blockMetaRefresh: false, blockPopupTricks: false });
    assert.equal(w.state.config.enabled, true); assert.equal(w.state.config.blockMetaRefresh, true); assert.equal(w.state.config.blockPopupTricks, true);
  });
  await check('restore removes only the exact site flag and preserves global and unrelated settings', async () => {
    const w = world(), before = structuredClone(w.state.config);
    await w.run({ kind: 'badge-rule-pause', type: 'blocked_meta_refresh' });
    assert.equal((await w.run({ kind: 'badge-rule-resume', type: 'blocked_meta_refresh' })).ok, true);
    assert.deepEqual(plain(w.state.config), before);
    assert.equal(w.state.reloaded.length, 0);
    const saved = w.state.saved.length;
    assert.equal((await w.run({ kind: 'badge-rule-resume', type: 'blocked_meta_refresh' })).ok, true);
    assert.equal(w.state.saved.length, saved, 'an already removed exception is an idempotent restore');
  });
  await check('restore removes an empty site entry without writing an enabling override', async () => {
    const w = world();
    await w.run({ kind: 'badge-rule-pause', type: 'youtube_ads_removed' }, { url: 'https://www.youtube.com/watch?v=example' });
    assert.equal((await w.run({ kind: 'badge-rule-resume', type: 'youtube_ads_removed' }, { url: 'https://www.youtube.com/watch?v=example' })).ok, true);
    assert.equal(w.state.config.siteOverrides['youtube.com'], undefined);
    assert.equal(w.state.config.enabled, true);
  });
  await check('a stale second tab can restore an already removed exception without writing configuration', async () => {
    const w = world({ config: { siteOverrides: undefined } });
    assert.equal((await w.run({ kind: 'badge-rule-resume', type: 'youtube_ads_removed' })).ok, true);
    assert.equal(w.state.saved.length, 0);
    assert.equal(w.state.media.length, 1, 'the current native media state is still reconciled');
  });
  await check('restore refuses global, parent, stale, framed and caller-selected authority', async () => {
    for (const options of [{ config: { enabled: false } }, { config: { blockMetaRefresh: false } },
      { config: { siteOverrides: { 'example.org': { blockMetaRefresh: false }, 'shop.example.org': { blockMetaRefresh: false } } } }, { stale: true }]) {
      const w = world(options);
      assert.equal((await w.run({ kind: 'badge-rule-resume', type: 'blocked_meta_refresh' })).ok, false);
      assert.equal(w.state.saved.length, 0);
    }
    const w = world();
    for (const extra of [{ host: 'other.example.org' }, { key: 'enabled' }, { tabId: 9 }])
      assert.equal((await w.run({ kind: 'badge-rule-resume', type: 'blocked_meta_refresh', ...extra })).ok, false);
    assert.equal((await w.run({ kind: 'badge-rule-resume', type: 'blocked_meta_refresh' }, { frameId: 1 })).ok, false);
    assert.equal(w.state.saved.length, 0);
  });
  await check('the YouTube event pauses only its reviewed control on the sender site', async () => {
    const w = world(), before = structuredClone(w.state.config);
    const result = await w.run({ kind: 'badge-rule-pause', type: 'youtube_ads_removed' }, { url: 'https://www.youtube.com/watch?v=example' });
    assert.equal(result.ok, true); assert.equal(result.key, 'scriptletEngine');
    before.siteOverrides['youtube.com'] = { scriptletEngine: false };
    assert.deepEqual(plain(w.state.config), before); assert.equal(w.state.reloaded.length, 0);
    assert.equal(w.state.media.length, 1);
    assert.equal(w.state.media[0][1].siteOverrides['youtube.com'].scriptletEngine, false);
  });
  await check('YouTube pause waits for native media rules and reports native failure', async () => {
    let release; const holdMedia = new Promise(resolve => { release = resolve; });
    const w = world({ holdMedia }); let done = false;
    const pending = w.run({ kind: 'badge-rule-pause', type: 'youtube_ads_removed' }).then(value => { done = true; return value; });
    for (let i = 0; i < 10; i++) await Promise.resolve();
    assert.equal(done, false); release(); assert.equal((await pending).ok, true);
    const fail = world({ mediaFailure: true });
    assert.equal((await fail.run({ kind: 'badge-rule-pause', type: 'youtube_ads_removed' })).ok, false);
  });
  for (const type of ['cookie_blocked', 'blocked_gestureless_nav', 'unknown_protection', 'blocked_config_spoof']) {
    await check('ambiguous or unmapped rule opens review instead of pausing: ' + type, async () => {
      const w = world();
      assert.equal((await w.run({ kind: 'badge-rule-pause', type })).ok, false);
      assert.equal(w.state.saved.length, 0);
      assert.equal((await w.run({ kind: 'badge-rule-settings', type })).ok, true);
      assert.equal(w.state.created[0].url, 'chrome-extension://test/settings.html?search=' + type);
    });
  }
  for (const extra of [{ key: 'enabled' }, { host: 'other.example.org' }, { url: 'https://evil.example/' }, { tabId: 99 }]) {
    await check('caller-supplied mutation scope is refused: ' + JSON.stringify(extra), async () => {
      const w = world();
      assert.equal((await w.run({ kind: 'badge-rule-pause', type: 'blocked_meta_refresh', ...extra })).ok, false);
      assert.equal(w.state.saved.length, 0);
    });
  }
  for (const override of [{ id: 'other-extension' }, { frameId: 1 }, { tab: { id: -1 } },
    { url: 'chrome-extension://test/popup.html' }, { url: 'https://user:pass@shop.example.org/item' }]) {
    await check('wrong, framed or invalid sender cannot change rules: ' + JSON.stringify(override), async () => {
      const w = world(); assert.equal((await w.run({ kind: 'badge-rule-pause', type: 'blocked_meta_refresh' }, override)).ok, false);
      assert.equal(w.state.saved.length, 0); assert.deepEqual(w.state.reloaded, []);
    });
  }
  await check('stale documents fail before and during the serialized storage mutation', async () => {
    for (const options of [{ stale: true }, { staleOnCheck: 2 }]) {
      const w = world(options); assert.equal((await w.run({ kind: 'badge-rule-pause', type: 'blocked_meta_refresh' })).ok, false);
      assert.equal(w.state.saved.length, 0);
    }
  });
  await check('master/UI controls and multi-owner metadata can never be paused by the worker', async () => {
    for (const badRegistry of [['enabled'], ['showBadge'], ['showToasts'], ['silentMode'], ['blockMetaRefresh', 'blockForcedPopups']]) {
      const w = world({ badRegistry });
      assert.equal((await w.run({ kind: 'badge-rule-pause', type: 'blocked_meta_refresh' })).ok, false);
      assert.equal(w.state.saved.length, 0);
    }
  });
  await check('the settings command opens a fixed extension path and rejects injected URLs/types', async () => {
    const w = world();
    assert.equal((await w.run({ kind: 'badge-rule-settings', type: 'blocked_meta_refresh', url: 'https://evil.example/' })).ok, false);
    assert.equal((await w.run({ kind: 'badge-rule-settings', type: '../enabled?url=https://evil.example/' })).ok, false);
    assert.deepEqual(w.state.created, []);
  });
  await check('reload is a separate exact-shape action limited to the current sending tab', async () => {
    const w = world();
    assert.equal((await w.run({ kind: 'badge-rule-reload', tabId: 99 })).ok, false);
    assert.equal((await w.run({ kind: 'badge-rule-reload' }, { frameId: 1 })).ok, false);
    assert.equal((await w.run({ kind: 'badge-rule-reload' })).ok, true);
    assert.deepEqual(w.state.reloaded, [7]); assert.equal(w.state.saved.length, 0);
  });
  await check('third-party cookie pause waits for both browser appliers before reporting ready', async () => {
    let release; const holdCookie = new Promise(resolve => { release = resolve; });
    const w = world({ holdCookie }); let done = false;
    const result = w.run({ kind: 'badge-rule-pause', type: 'blocked_thirdparty_cookie' }).then(value => { done = true; return value; });
    for (let i = 0; i < 10; i++) await Promise.resolve();
    assert.equal(done, false); release();
    assert.equal((await result).ok, true);
    assert.deepEqual(w.state.cookies.map(item => item[0]), ['passive', 'tracker']);
    assert.equal(w.state.cookies[0][1], true);
    assert.equal(w.state.cookies[0][2].siteOverrides['shop.example.org'].blockThirdPartyCookies, false);
    assert.equal(w.state.config.blockThirdPartyCookies, true);
  });
  await check('real passive and tracker cookie rules exempt only the selected site', async () => {
    const w = world({ nativeCookies: true });
    assert.equal((await w.run({ kind: 'badge-rule-pause', type: 'blocked_thirdparty_cookie' })).ok, true);
    assert.equal(w.state.rules.length, 2);
    for (const write of w.state.rules) {
      assert.ok(write.addRules.length);
      for (const rule of write.addRules) {
        const hosts = rule.condition.excludedInitiatorDomains || [];
        assert.ok(hosts.includes('shop.example.org'));
        assert.ok(!hosts.includes('other.example.org'));
      }
    }
  });
  await check('native cookie failure, storage failure and privacy erasure never report success', async () => {
    const native = world({ cookieFailure: true });
    assert.equal((await native.run({ kind: 'badge-rule-pause', type: 'blocked_thirdparty_cookie' })).ok, false);
    const save = world({ failSave: true });
    assert.equal((await save.run({ kind: 'badge-rule-pause', type: 'blocked_meta_refresh' })).ok, false);
    assert.equal(save.state.saved.length, 0);
    const erase = world(); erase.ctx.__privacyEraseInProgress = true;
    assert.equal((await erase.run({ kind: 'badge-rule-pause', type: 'blocked_meta_refresh' })).ok, false);
    assert.deepEqual(erase.state.saved, []);
  });
  await check('restoring cookies removes the native site exemptions as well as the stored flag', async () => {
    const w = world({ nativeCookies: true });
    await w.run({ kind: 'badge-rule-pause', type: 'blocked_thirdparty_cookie' });
    w.state.rules.length = 0;
    assert.equal((await w.run({ kind: 'badge-rule-resume', type: 'blocked_thirdparty_cookie' })).ok, true);
    assert.equal(w.state.rules.length, 2);
    for (const write of w.state.rules) for (const rule of write.addRules)
      assert.ok(!(rule.condition.excludedInitiatorDomains || []).includes('shop.example.org'));
  });
  console.log(count + ' badge-rule worker checks passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
