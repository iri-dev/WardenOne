/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE. */
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const context = {};
vm.runInNewContext(read('protection-event-settings.js'), context);
const registry = context.WardenProtectionEvents;
const settings = vm.runInNewContext(read('settings-data.js') + ';SETTINGS_DATA');
const defaults = Object.assign({}, settings.defaults, ...settings.carried.map(section => section.defaults || {}));
const scope = new Set(Object.values(settings.siteOverrideScope).flat());
const rows = [...settings.sections, ...settings.carried].flatMap(section => section.rows || []);
const forbidden = new Set(['enabled', 'showBadge', 'showToasts', 'silentMode', 'notificationSettings']);
const sourceFiles = ['src/content.js', 'anti-redirect.js', 'bridge.js', 'background.js', 'background-downloads.js',
  'consent-wall.js', 'mail-shield.js', 'fingerprint-realm.js', 'yt-adblock.js'];
const sources = sourceFiles.map(read);
const aliases = new Set(['cookie_blocked']);

let passed = 0;
function check(label, run) { run(); passed++; console.log('[ok] ' + label); }

check('known event IDs and wrapper functions resolve the same immutable setting lists', () => {
  assert.deepEqual(Array.from(registry.keysFor('blocked_thirdparty_cookie')), ['blockThirdPartyCookies']);
  assert.deepEqual(Array.from(registry.pauseKeysFor('blocked_thirdparty_cookie')), ['blockThirdPartyCookies']);
  assert.equal(context.wardenEventProtectionKeys('blocked_thirdparty_cookie'), registry.keysFor('blocked_thirdparty_cookie'));
  assert.equal(context.wardenProtectionEventIds('blockThirdPartyCookies'), registry.eventsFor('blockThirdPartyCookies'));
  assert.ok(registry.eventIds().length >= 100);
  assert.ok(Object.isFrozen(registry));
  assert.ok(Object.isFrozen(registry.eventIds()));
});
check('all mapped keys are real boolean controls and every direct pause supports a site override', () => {
  for (const event of registry.eventIds()) {
    const keys = registry.keysFor(event), pause = registry.pauseKeysFor(event);
    assert.ok(Object.isFrozen(keys), event);
    assert.ok(Object.isFrozen(pause), event);
    assert.equal(new Set(keys).size, keys.length, event);
    assert.ok(pause.length <= 1, event + ' cannot pause a broad bundle');
    for (const key of keys) {
      assert.equal(typeof defaults[key], 'boolean', event + ': ' + key);
      assert.ok(!forbidden.has(key), event + ': ' + key);
      assert.ok(registry.eventsFor(key).includes(event), event + ': reverse lookup');
      assert.ok(registry.settingLabel(key), event + ': label');
    }
    for (const key of pause) {
      assert.ok(keys.includes(key), event + ': unrelated pause');
      assert.ok(scope.has(key), event + ': unsupported site scope');
    }
  }
});
check('labels agree with the existing settings controls without inventing switches for watch-only events', () => {
  const mappedKeys = new Set(registry.eventIds().flatMap(event => Array.from(registry.keysFor(event))));
  for (const key of mappedKeys) {
    const row = rows.find(entry => entry.key === key);
    if (row) assert.equal(registry.settingLabel(key), row.name, key);
  }
  for (const [event, key] of [['detected_beacon', 'logThirdPartyBeacons'], ['warned_device_request', 'deviceAccessGuard'], ['warned_service_worker', 'capabilityGuard']]) {
    assert.ok(registry.keysFor(event).includes(key));
    assert.equal(registry.pauseKeysFor(event).length, 0);
    assert.notEqual(registry.settingLabel(key), key);
  }
});
check('pause scope identifies mixed controls whose native network protections remain active', () => {
  const mixed = new Set(settings.siteOverrideScope.mixed);
  for (const event of registry.eventIds()) {
    const pause = registry.pauseKeysFor(event);
    const expected = pause.length ? mixed.has(pause[0]) ? 'page-part' : 'site' : '';
    assert.equal(registry.pauseScopeFor(event), expected, event);
  }
  assert.equal(registry.pauseScopeFor('blocked_grabber_fetch'), 'page-part');
  assert.equal(registry.pauseScopeFor('blocked_popup'), '');
  assert.equal(registry.pauseScopeFor('blocked_thirdparty_cookie'), 'site');
  assert.equal(registry.pauseScopeFor('blocked_media_capture'), 'site');
  assert.equal(registry.pauseScopeFor('cookie_blocked'), '');
  assert.equal(registry.pauseScopeFor('__proto__'), '');
});
check('YouTube and routine tally IDs resolve reviewed controls rather than inert badge rows', () => {
  for (const [id, key] of Object.entries({ youtube_ads_removed: 'scriptletEngine', consent_rejected: 'autoRejectConsent',
    cleaned_history_url: 'stripTrackingParams', stripped_link_ping: 'unshimLinks', cleaned_copied_link: 'cleanCopyLinks' })) {
    assert.deepEqual(Array.from(registry.pauseKeysFor(id)), [key]); assert.equal(registry.canReview(id), true);
  }
  assert.equal(registry.pauseScopeFor('youtube_ads_removed'), 'page-part');
  for (const id of ['google_search_cleanup', 'scriptlet_mutator_blocked']) {
    assert.equal(registry.canReview(id), true); assert.equal(registry.pauseKeysFor(id).length, 0);
  }
});
check('the supplied cookie ID finds the actual cookie controls without guessing which one caused a block', () => {
  assert.deepEqual(Array.from(registry.keysFor('cookie_blocked')), ['blockAllCookies', 'blockThirdPartyCookies']);
  assert.deepEqual(Array.from(registry.pauseKeysFor('cookie_blocked')), []);
  assert.ok(registry.eventsFor('blockAllCookies').includes('cookie_blocked'));
  assert.ok(registry.eventsFor('blockThirdPartyCookies').includes('cookie_blocked'));
});
check('multi-owner events and internal or manual actions cannot pause unrelated protections', () => {
  for (const event of ['blocked_popup', 'blocked_gestureless_nav', 'blocked_overlay', 'blocked_phishing',
    'blocked_safe_browsing_link', 'blocked_grabber_navigation', 'blocked_ad_resource', 'blocked_config_spoof',
    'gated_tokens_cleared', 'gated_cookies_hardened', 'detected_manual_check']) {
    assert.equal(registry.pauseKeysFor(event).length, 0, event);
  }
});
check('reviewed ownership keeps narrower controls and observations separate', () => {
  const expectations = {
    blocked_media_capture: 'blockCameraMic', blocked_screen_capture: 'blockScreenCapture',
    blocked_suspicious_webrtc: 'blockSuspiciousWebRTC', blocked_keyboard_lock: 'fullscreenGuard',
    blocked_storage_access: 'storageAccessGuard', detected_download_gate: 'removeOverlays',
    blocked_forced_redirect: 'blockPopupTricks', blocked_ad_auction_redirect: 'blockPopupTricks',
    blocked_skimmer_exfil: 'detectSkimmers', blocked_payment_card_submit: 'paymentCardGuard',
    blocked_tracker_request: 'blockFirstPartyTrackers',
  };
  for (const [event, key] of Object.entries(expectations)) assert.deepEqual(Array.from(registry.pauseKeysFor(event)), [key], event);
  assert.deepEqual(Array.from(registry.keysFor('detected_canvas_fingerprint')), ['trackerLearner']);
  assert.equal(registry.pauseKeysFor('detected_canvas_fingerprint').length, 0);
});
check('pausing Storage Access Guard bypasses all native API wrappers even with blanket storage blocking configured', () => {
  const hardener = read('anti-redirect.js');
  const lift = name => {
    const start = hardener.indexOf('  function ' + name + '(');
    const end = hardener.indexOf('\n  }', start);
    assert.ok(start >= 0 && end > start, name);
    return hardener.slice(start, end + 4);
  };
  assert.deepEqual(Array.from(registry.pauseKeysFor('blocked_storage_access')), ['storageAccessGuard']);
  for (const topFrame of [false, true]) {
    const called = [], nativeResult = {};
    function Document() {}
    for (const name of ['requestStorageAccess', 'hasStorageAccess', 'requestStorageAccessFor']) {
      Document.prototype[name] = function (...args) { called.push({ name, args }); return nativeResult; };
    }
    const config = { storageAccessGuard: false, blockAllStorageAccess: true };
    vm.runInNewContext(['storageAccessEnabled', 'refuseEveryStorageAccess', 'installStorageAccessGuard'].map(lift).join('\n')
      + '\ninstallStorageAccessGuard();', {
      window: { Document }, Document, TOP_FRAME: topFrame,
      masterEnabled: () => true, cfg: () => config, isCrossSiteFrame: () => !topFrame,
    });
    const names = topFrame ? ['requestStorageAccessFor'] : ['requestStorageAccess', 'hasStorageAccess'];
    for (const name of names) assert.equal(Document.prototype[name]('https://embedded.example'), nativeResult, name);
    assert.deepEqual(called.map(call => call.name), names);
  }
});
check('every concrete badge event ID has a reviewed entry, and non-alias entries exist in runtime sources', () => {
  const badgeStart = sources[0].indexOf('const LABELS={');
  const badgeEnd = sources[0].indexOf('if(renderBadge=', badgeStart);
  assert.ok(badgeStart >= 0 && badgeEnd > badgeStart);
  const badgeIds = [...sources[0].slice(badgeStart, badgeEnd).matchAll(/\b((?:blocked|detected|gated|warned)_[a-z0-9_]+):/g)].map(match => match[1]);
  assert.ok(badgeIds.length >= 20);
  for (const id of badgeIds) assert.ok(registry.has(id), id);
  for (const id of registry.eventIds()) {
    if (!aliases.has(id)) assert.ok(sources.some(source => source.includes('"' + id + '"') || source.includes("'" + id + "'") || source.includes(id + ':')), id);
  }
});
check('unknown, malformed and inherited names cannot select settings or invoke coercion', () => {
  const evil = { toString() { throw new Error('coercion'); } };
  for (const id of [null, undefined, evil, [], {}, 1, '__proto__', 'constructor', 'toString', 'BLOCKED_POPUP',
    'blocked_popup_suffix', ' blocked_popup', 'blocked_popup\n', 'x'.repeat(97)]) {
    assert.equal(registry.has(id), false);
    assert.equal(registry.keysFor(id).length, 0);
    assert.equal(registry.pauseKeysFor(id).length, 0);
  }
  for (const key of ['__proto__', 'constructor', 'enabled', 'unknown', evil]) {
    assert.equal(registry.eventsFor(key).length, 0);
    assert.equal(registry.settingLabel(key), '');
  }
});
check('returned arrays and metadata cannot be changed by a caller', () => {
  const typeError = error => error && error.name === 'TypeError';
  assert.throws(() => registry.keysFor('blocked_popup').push('enabled'), typeError);
  assert.throws(() => registry.pauseKeysFor('blocked_thirdparty_cookie').splice(0, 1), typeError);
  assert.throws(() => registry.eventsFor('blockThirdPartyCookies').push('fake_event'), typeError);
  assert.throws(() => { registry.keysFor = () => ['enabled']; }, TypeError);
  assert.deepEqual(Array.from(registry.pauseKeysFor('blocked_thirdparty_cookie')), ['blockThirdPartyCookies']);
});

check('web child frames skip the catalogue while embedded extension settings retain it', () => {
  for (const protocol of ['https:', 'about:']) {
    const frame = { window: { top: {} }, location: { protocol } };
    vm.runInNewContext(read('protection-event-settings.js'), frame);
    assert.equal(frame.WardenProtectionEvents, undefined);
  }
  for (const protocol of ['chrome-extension:', 'moz-extension:']) {
    const frame = { window: { top: {} }, location: { protocol } };
    vm.runInNewContext(read('protection-event-settings.js'), frame);
    assert.deepEqual(Array.from(frame.WardenProtectionEvents.keysFor('blocked_meta_refresh')), ['blockMetaRefresh']);
  }
});

console.log(passed + ' protection event ownership checks passed');
