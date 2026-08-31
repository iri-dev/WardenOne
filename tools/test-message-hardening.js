/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/*
 * Hostile-message regressions for the background message surface.
 *
 * Every message reaching the service worker is untrusted. A content script runs on
 * a page the attacker controls, and the MAIN-world events feeding it are forgeable,
 * so the background must decide on sender context rather than on anything the
 * message says about itself.
 *
 * This walks every msg.kind the background handles and forges senders at each one:
 * no sender, a spoofed extension id, a tab claiming to be an extension page, a tab
 * asking about somebody else's host, and floods past the rate limit.
 *
 * Run: node tools/test-message-hardening.js
 */
'use strict';

const fs = require('fs');
const vm = require('vm');

const source = fs.readFileSync('background.js', 'utf8');

let failed = 0;
function check(name, ok, extra) {
  if (ok) { console.log('  ok  - ' + name); return; }
  failed++;
  console.error('  FAIL - ' + name + (extra ? ' :: ' + extra : ''));
}

/* ---------- load the real guards into a sandbox ---------- */
const EXT_ID = 'wardenone-test-id';
const context = {
  URL, String, Boolean, Object, Date, Math, console,
  chrome: {
    runtime: { id: EXT_ID, getURL: (p) => 'chrome-extension://' + EXT_ID + '/' + String(p || '') },
  },
};
vm.createContext(context);

const from = source.indexOf('function messageSenderIsExtensionPage(sender)');
const to = source.indexOf('// Always-catch wrapper for promise-returning message handlers');
if (from < 0 || to <= from) throw new Error('guard source markers not found');

// The limiter depends on its store and pruner, so take the whole block.
const rateFrom = source.indexOf('const TAB_MESSAGE_RATE');
const rateEnd = source.indexOf('\n}', source.indexOf('function allowTabMessageRate(')) + 2;
if (rateFrom < 0 || rateEnd <= rateFrom) throw new Error('rate limiter source markers not found');
vm.runInContext(
  source.slice(rateFrom, rateEnd) + '\n'
    + source.slice(from, to)
    + '\nthis.api = { messageSenderIsExtensionPage, messageSenderIsTab, messageSenderMatchesHost,'
    + ' messageCleanHost, messageSameHost, messageIsCookiePermissionEscape, allowTabMessageRate };',
  context,
);
const api = context.api;

/* ---------- the real tables, read from source ---------- */
const slice = (start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));
const allowed = new Set(
  [...slice('TAB_CONTEXT_ALLOWED_MESSAGES = new Set([', ']);').matchAll(/'([a-z0-9-]+)'/g)].map((m) => m[1]),
);
const rateLimits = new Set(
  [...slice('TAB_CONTEXT_RATE_LIMITS = {', '\n};').matchAll(/'([a-z0-9-]+)':/g)].map((m) => m[1]),
);
const kinds = [...new Set([...source.matchAll(/msg\.kind === '([a-z0-9-]+)'/g)].map((m) => m[1]))];

/* A handler existing is not enough: the tab-context gate runs before dispatch. The
 * engine watchdog and navigation relay both spent a release in that exact state --
 * emitted by bridge.js, handled by background.js, and rejected between the two.
 * Derive the literal bridge sends so another message cannot fall into that gap. */
const bridgeSource = fs.readFileSync('bridge.js', 'utf8');
const bridgeKinds = [...new Set(
  [...bridgeSource.matchAll(/chrome\.runtime\.sendMessage\(\s*\{\s*kind:\s*'([a-z0-9-]+)'/g)]
    .map((m) => m[1]),
)];
const SPECIAL_TAB_ESCAPES = new Set(['set-site-permission']);
const unroutableBridgeKinds = bridgeKinds.filter((kind) =>
  !allowed.has(kind) && !SPECIAL_TAB_ESCAPES.has(kind));

check('background handles a non-trivial message surface', kinds.length >= 60, kinds.length + ' kinds');
check('the tab allowlist is a strict subset of the surface',
  [...allowed].every((k) => kinds.includes(k)),
  [...allowed].filter((k) => !kinds.includes(k)).join(', '));
check('every literal bridge message can pass the tab-context gate',
  unroutableBridgeKinds.length === 0,
  'rejected before dispatch: ' + unroutableBridgeKinds.join(', '));

/* Rule: anything reachable from a web page must be rate limited. */
const unlimited = [...allowed].filter((k) => !rateLimits.has(k));
check('every tab-reachable message kind has a rate limit',
  unlimited.length === 0, 'missing: ' + unlimited.join(', '));

/* Rule: privileged kinds must NOT be reachable from a tab at all. */
const PRIVILEGED = ['clean-browser', 'clear-site-data', 'clear-learned', 'set-config',
  'apply-onboarding-recommended', 'apply-onboarding-max-privacy', 'force-list-update',
  'download-trust-add', 'download-trust-remove', 'breach-check',
  'review-extension-snapshot', 'forget-extension-review', 'import-extension-reputation',
  'clear-imported-extension-reputation', 'open-installed-extension-details',
  // Grants a temporary exemption from a malware/phishing verdict. Only the block
  // screen may ask for it; a page being able to self-exempt would defeat the block.
  'safe-browsing-allow-once'];
for (const kind of PRIVILEGED) {
  if (!kinds.includes(kind)) continue;
  check('privileged kind is not tab-reachable: ' + kind, !allowed.has(kind));
}

/* ---------- forged senders ---------- */
const extPage = { id: EXT_ID, url: 'chrome-extension://' + EXT_ID + '/popup.html' };
const realTab = { id: EXT_ID, tab: { id: 7, url: 'https://example.com/page' } };
const noSender = undefined;
const spoofedId = { id: 'some-other-extension', url: 'chrome-extension://some-other-extension/popup.html' };
const tabClaimingExtUrl = { id: EXT_ID, tab: { id: 9, url: 'https://evil.example/x' }, url: 'chrome-extension://' + EXT_ID + '/popup.html' };

check('extension page is recognised', api.messageSenderIsExtensionPage(extPage) === true);
check('a different extension id is rejected', api.messageSenderIsExtensionPage(spoofedId) === false);
check('undefined sender is not an extension page', api.messageSenderIsExtensionPage(noSender) === false);
check('undefined sender is not a tab', api.messageSenderIsTab(noSender) === false);
check('real tab is recognised as a tab', api.messageSenderIsTab(realTab) === true);
check('extension page is not treated as a tab', api.messageSenderIsTab(extPage) === false);
check('a tab cannot promote itself by claiming an extension URL',
  api.messageSenderIsTab(tabClaimingExtUrl) === false
    && api.messageSenderIsExtensionPage(tabClaimingExtUrl) === true,
  'a tab supplying sender.url must not gain tab-context bypass silently');

/* ---------- host confusion ---------- */
check('tab may ask about its own host', api.messageSenderMatchesHost(realTab, 'https://example.com/other') === true);
check('tab may not ask about another host', api.messageSenderMatchesHost(realTab, 'https://bank.example') === false);
check('suffix confusion is rejected', api.messageSenderMatchesHost(realTab, 'https://example.com.evil.test') === false);
check('prefix confusion is rejected', api.messageSenderMatchesHost(realTab, 'https://notexample.com') === false);
check('empty host is rejected', api.messageSenderMatchesHost(realTab, '') === false);
check('non-host junk is rejected',
  api.messageCleanHost('javascript:alert(1)') === '' && api.messageCleanHost('a b c') === '');
check('www. is normalised, not a bypass', api.messageSameHost('https://www.example.com', 'https://example.com') === true);

/* ---------- the cookie-permission escape hatch ---------- */
const escape = { kind: 'set-site-permission', key: 'cookies', setting: 'allow', url: 'https://example.com/x' };
check('cookie escape works only for the sender own host',
  api.messageIsCookiePermissionEscape(escape, realTab) === true);
check('cookie escape refuses another host',
  api.messageIsCookiePermissionEscape({ ...escape, url: 'https://bank.example/x' }, realTab) === false);
check('cookie escape refuses a different setting',
  api.messageIsCookiePermissionEscape({ ...escape, setting: 'block' }, realTab) === false);
check('cookie escape refuses a different key',
  api.messageIsCookiePermissionEscape({ ...escape, key: 'javascript' }, realTab) === false);
check('cookie escape refuses a non-http scheme',
  api.messageIsCookiePermissionEscape({ ...escape, url: 'javascript:alert(1)' }, realTab) === false);

/* ---------- malformed payloads must not throw ---------- */
const JUNK = [null, undefined, 0, '', [], {}, { kind: null }, { kind: 123 },
  { kind: 'x'.repeat(5000) }, { kind: '__proto__' }, { kind: 'constructor' }];
let threw = '';
for (const m of JUNK) {
  for (const s of [noSender, extPage, realTab, spoofedId]) {
    try {
      api.messageSenderIsTab(s);
      api.messageSenderIsExtensionPage(s);
      api.messageSenderMatchesHost(s, m && m.kind);
      api.messageIsCookiePermissionEscape(m, s);
    } catch (e) { threw = JSON.stringify(m) + ' :: ' + e.message; }
  }
}
check('malformed messages never throw in the guards', threw === '', threw);

/* ---------- rate limiting actually limits ---------- */
let allowedCount = 0;
for (let i = 0; i < 50; i++) if (api.allowTabMessageRate(1, 'test-bucket', 10, 60000)) allowedCount++;
check('rate limiter caps a flood', allowedCount === 10, 'allowed ' + allowedCount + '/50');
check('rate limiter is per tab', api.allowTabMessageRate(2, 'test-bucket', 10, 60000) === true);

if (failed) { console.error('\n' + failed + ' failed'); process.exit(1); }
console.log('\nmessage hardening checks passed (' + kinds.length + ' kinds audited)');
