/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/*
 * The detectability budget: every page-visible marker is listed, with its reason.
 * Run: node tools/test-detectability-budget.js
 *
 * WardenOne does not promise stealth. Its MAIN-world modules share the page's realm, so a page
 * can see the globals they publish, the elements they draw, the events they dispatch and the
 * messages the bridge posts (SEC-12). Hiding that is not a security fix -- renamed markers are
 * still markers, and the protections that matter are enforced where the page cannot reach:
 * the isolated bridge, the worker, declarativeNetRequest. What CAN be kept small is the surface
 * that exists for no reason. This suite is the budget: every marker the MAIN scripts and the
 * bridge expose is enumerated from the source and must appear below with a reason, so a new
 * global, element id, event name or page-visible message fails the gate until someone writes
 * down why the page needs to see it; and a reason for a marker that no longer exists fails too.
 *
 * The second half is the part that matters: knowing WardenOne is present buys the page no
 * authority. Every path from the page's world into a privileged decision is signed, the health
 * authority is the bridge's challenge and not a page-writable marker, and the two records a page
 * would most like to replace are non-configurable.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
/* WARDENONE_CONTENT_SRC points a control run at a pre-fix copy of src/content.js. */
const read = (f) => fs.readFileSync(f === 'src/content.js' && process.env.WARDENONE_CONTENT_SRC ? process.env.WARDENONE_CONTENT_SRC : path.join(ROOT, f), 'utf8');
const MANIFEST = JSON.parse(read('manifest.json'));
const BRIDGE = read('bridge.js');
const BG = read('background.js');

let failed = 0;
let passed = 0;
function check(name, ok, extra) {
  if (ok) { passed++; console.log('  ok  - ' + name); return; }
  failed++;
  console.error('  FAIL - ' + name + (extra ? ' :: ' + extra : ''));
}

/* ---- the budget ------------------------------------------------------------------------ */
const GLOBALS = {
  /* Cross-world handles: the page can see them; nothing trusts what the page does to them. */
  __WO_CONFIG__: 'a page-visible copy of the engine config for sibling MAIN modules; the engine reads its closure-private store, never this',
  __WO_SESSION__: 'token-exfil session findings the popup reads through executeScript in MAIN; display only',
  __wardenOneCleanCopyUrl: 'the "copy clean link" menu entry asks the engine to clean a URL through it; the worker re-checks the host it gets back',
  __wardenOnePopupMatchers: 'scriptlet no-window-open matchers handed to the redirect guard; non-writable, non-configurable',
  __wardenOneRealm: 'the anti-fingerprint realm record for child frames and openers (SEC-05); a non-configurable accessor',
  __wardenOnePlayerPressAt: 'when the reader last pressed a player here, for the redirect guard in the frames around this one, which cannot see the click; a non-configurable getter, and a faked value only makes those guards stop more',
  /* Install-once flags: a second copy must not install beside a live one. Page-writable, and
     therefore never trusted for health -- the bridge\'s signed challenge is (SEC-03). */
  __wardenOneInstalled: 'engine install-once flag; cleared on dispose so re-injection can take',
  __wardenOneReadyVersion: 'engine "the script ran" flag, stamped unconditionally so the watchdog never loops on a paused site',
  __wardenOneAntiRedirectHardener: 'redirect guard install-once flag; its disposer is private, reachable only by signed message',
  __wardenOnePermissionChainInstalled: 'permission-chain guard install-once flag; disposer private',
  __woTwDisplayGuard: 'Twitch display guard install-once flag',
  /* Host-scoped ad blockers, on sites whose MAIN world only that site shares. */
  __wardenOneSpotifyAdblockReady: 'Spotify ad handling install-once flag',
  __wardenOneTwitchAdblockReady: 'Twitch ad blocker version flag; a newer copy replaces an older one',
  __wardenOneTwitchAdblockDispose: 'Twitch ad blocker release hook for that replacement (test-guard-lifecycle pins the contract)',
  __wardenOneYouTubeReadyVersion: 'YouTube ad blocker version flag',
  __wardenOneYouTubeVersion: 'YouTube ad blocker version, read by its own fallback',
  /* Native surfaces the protections themselves rewrite: the point, not a side effect. */
  Function: 'Function.prototype.toString cloak for the fingerprint noise, per realm',
  Worker: 'Twitch worker runtime hook for the ad blocker',
  onbeforeunload: 'the leave-guard rewrite of the beforeunload handler property',
};
const EVENTS = {
  'wo-event': 'engine and guard findings to the bridge; routed on the public token, authority never derived from it',
  'wo-nav-signal': 'navigation signals to the bridge; HMAC-signed (SEC-13)',
  'wo-key': 'the bridge hands the MAIN world its key at document_start, before any page script',
  'wo-ping': 'the bridge\'s liveness challenge; the engine answers with a signed pong',
  'wo-config-change': 'the engine tells its own modules the config changed',
  'wo-bridge-config-ready': 'the bridge announces the config snapshot to its isolated siblings',
  'wo-bridge-replay': 'the engine asks the bridge to replay the handshake',
  'wo-background-message': 'the bridge relays a worker message into the page world',
  'wo-frame-clickfix': 'a frame reports a ClickFix pattern to its parent guard',
  'wo-permission-signal': 'the permission-chain guard\'s signal to the bridge',
  'wo-realm-settled': 'the realm record is final (SEC-05)',
  'wo-safe-browsing-check': 'the engine asks the bridge for a reputation verdict',
};
const MESSAGE_KINDS = {
  config: 'the signed config from the bridge to the MAIN modules; verified with the key before use',
  'redirect-bootstrap': 'signed popup-only settings from the bridge while the full worker snapshot is in flight',
  'frame-clickfix': 'the bridge forwards a frame\'s ClickFix signal',
};
const DOM_IDS = {
  'rg-badge-host': 'the corner badge', 'rg-b': 'the badge button', 'rg-p': 'the badge panel', 'rg-n': 'the badge count', 'rg-list': 'the badge list',
  'rg-toast-host': 'toasts', 'rg-undo-chip': 'the overlay-removal undo chip', 'rg-dl-bar': 'the download bar',
  'rg-phish-bar': 'the phishing warning bar', 'rg-phish-block': 'the phishing block page', 'rg-hard-overlay-css': 'overlay removal styles',
  'rg-adshield-style': 'ad cosmetic styles', 'rg-google-search-cleanup-css': 'search cleanup styles', 'rg-bg-throttle': 'the background-tab throttle marker',
  'wo-clip-swap': 'the clipboard swap warning', 'wo-cmd-warn': 'the command-paste warning', 'wo-fake-window': 'the fake-window warning',
  'wo-formtrap-warn': 'the form trap warning', 'wo-fullscreen-spoof': 'the fullscreen spoof warning', 'wo-insecure-login': 'the insecure login warning',
  'wo-paste-warn': 'the paste warning', 'wo-sb-block': 'the reputation block', 'wo-scam-lock': 'the scam lock warning', 'wo-user-hidden': 'the reader\'s own hidden-element styles',
};

/* ---- the inventory, from the source ---------------------------------------------------- */
const mainScripts = [...new Set((MANIFEST.content_scripts || []).filter((c) => c.world === 'MAIN').flatMap((c) => c.js || []))];
check('the MAIN-world scripts were found in the manifest', mainScripts.length >= 6 && mainScripts.includes('content.min.js') && mainScripts.includes('anti-redirect.js'), mainScripts.join(', '));
const sources = mainScripts.map((f) => ({ file: f, text: read(f === 'content.min.js' ? 'src/content.js' : f) }));

const found = { globals: new Map(), events: new Map(), kinds: new Map(), ids: new Map() };
const note = (map, name, where) => { if (!map.has(name)) map.set(name, new Set()); map.get(name).add(where); };
for (const s of sources) {
  for (const m of s.text.matchAll(/(?:window|globalThis)\.(__[A-Za-z_]+)\s*=(?!=)/g)) note(found.globals, m[1], s.file);
  for (const m of s.text.matchAll(/defineProperty\((?:window|globalThis),\s*["']([^"']+)["']/g)) note(found.globals, m[1], s.file);
  for (const m of s.text.matchAll(/new CustomEvent\(["'](wo-[a-z-]+)["']/g)) note(found.events, m[1], s.file);
  for (const m of s.text.matchAll(/(?:\bid[:=]\s*|getElementById\()["'](rg-[a-z0-9-]+|wo-[a-z0-9-]+|wardenone-[a-z0-9-]+)["']/g)) note(found.ids, m[1], s.file);
}
for (const m of BRIDGE.matchAll(/new CustomEvent\(["'](wo-[a-z-]+)["']/g)) note(found.events, m[1], 'bridge.js');
for (const m of BRIDGE.matchAll(/source:\s*'wardenone',\s*kind:\s*'([a-z-]+)'/g)) note(found.kinds, m[1], 'bridge.js');
for (const m of BRIDGE.matchAll(/kind:\s*'([a-z-]+)'[^\n]*source:\s*'wardenone'/g)) note(found.kinds, m[1], 'bridge.js');

check('the inventory found a realistic surface', found.globals.size >= 15 && found.events.size >= 10 && found.ids.size >= 20,
  JSON.stringify({ globals: found.globals.size, events: found.events.size, kinds: found.kinds.size, ids: found.ids.size }));

function audit(label, map, budget) {
  const unbudgeted = [...map.keys()].filter((n) => !Object.prototype.hasOwnProperty.call(budget, n)).sort();
  check('every page-visible ' + label + ' has a written reason', unbudgeted.length === 0,
    unbudgeted.map((n) => n + ' (' + [...map.get(n)].join(', ') + ')').join('; ') + ' -- a new marker needs its reason in the budget, or should not exist');
  const stale = Object.keys(budget).filter((n) => !map.has(n)).sort();
  check('no ' + label + ' in the budget has gone away unnoticed', stale.length === 0, stale.join(', ') + ' -- drop the entry so the budget stays true');
}
audit('global', found.globals, GLOBALS);
audit('event name', found.events, EVENTS);
audit('bridge message kind', found.kinds, MESSAGE_KINDS);
audit('element id', found.ids, DOM_IDS);

/* ---- what was removed, and stays removed ----------------------------------------------- */
const engine = read('src/content.js');
check('the engine publishes no "protection is on" marker (nothing read it once the bridge became the authority)',
  !found.globals.has('__wardenOneProtectionActive') && !/__wardenOneProtectionActive/.test(engine));
check('the ad-collapse marker is gone (it was set and never read)', !found.globals.has('__woAdCollapse') && !/window\.__woAdCollapse/.test(engine));
check('no MAIN module publishes a disposer except the host-scoped Twitch blocker (SEC-03)',
  [...found.globals.keys()].filter((n) => /Dispose/.test(n)).join(',') === '__wardenOneTwitchAdblockDispose');

/* ---- knowing WardenOne is there buys the page nothing ---------------------------------- */
const engineMin = read('content.min.js');
const guard = read('anti-redirect.js');
check('a navigation signal counts only with the bridge\'s signature (SEC-13)',
  /engineMac\('nav-signal', seq \+ '\\n' \+ kind \+ '\\n' \+ host\)/.test(BRIDGE));
check('an interstitial request counts only with the bridge\'s signature (SEC-15)', /interstitialRequestSigned\(d\.detail\)/.test(BRIDGE));
check('"installed" and "pong" count only signed', /engineMac\('installed', TOKEN\)/.test(BRIDGE) && /engineMac\('pong', bridgePendingPong\.nonce\)/.test(BRIDGE));
check('the engine applies a config only after verifying its signature', /__woVerify\("config",JSON\.stringify\(m\.overrides\),m\)/.test(engineMin));
check('the redirect guard applies config and dispose only after verifying their signatures',
  /woVerify\('config', JSON\.stringify\(msg\.overrides\), msg\)/.test(guard) && /woVerify\('dispose', '', msg\)/.test(guard));
{
  const probe = BG.slice(BG.indexOf('async function verifyEngineInTab'), BG.indexOf('\n}\n', BG.indexOf('async function verifyEngineInTab')));
  check('the worker\'s health authority is the bridge, not a page-writable marker (SEC-03)',
    probe.length > 0 && !/__wardenOneReadyVersion|__wardenOneProtectionActive|executeScript/.test(probe));
}
check('the realm record is a non-configurable accessor', /"__wardenOneRealm",\s*\{[^}]*configurable:!1/.test(engine.replace(/\s+/g, ' ')) || /__wardenOneRealm[\s\S]{0,200}configurable:!1/.test(engine));
check('the matcher registry is non-writable and non-configurable', /'__wardenOnePopupMatchers',\s*\{\s*configurable: false,\s*enumerable: false,\s*writable: false/.test(guard));
check('the bridge exposes its config handles on the isolated window only (the manifest pins the world)',
  (MANIFEST.content_scripts || []).some((c) => (c.js || []).includes('bridge.js') && (c.world || 'ISOLATED') === 'ISOLATED'));

if (failed) { console.error('\n' + failed + ' failed, ' + passed + ' passed'); process.exit(1); }
console.log('\ndetectability budget: ' + passed + ' checks passed -- every page-visible marker has a reason, and none of them is authority');
