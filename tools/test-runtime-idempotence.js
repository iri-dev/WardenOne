/*
 * Regression checks for repair/re-injection idempotence.
 *
 * Run: node tools/test-runtime-idempotence.js
 */
'use strict';

const fs = require('fs');

function read(file) {
  return fs.readFileSync(file, 'utf8');
}

function assert(condition, message) {
  if (!condition) {
    console.error('[fail] ' + message);
    process.exit(1);
  }
}

function compact(text) {
  return String(text || '').replace(/\s+/g, '');
}

const manifest = JSON.parse(read('manifest.json'));
const version = manifest.version;
const content = read('src/content.js');
const runtime = read('content.min.js');
const bridge = read('bridge.js');
const yt = read('yt-adblock.js');
const consent = read('consent-reject.js');
const antiRedirect = read('anti-redirect.js');
const permissionChain = read('permission-chain.js');

assert(version === '1.0.0', 'manifest version should remain 1.0.0 for the first public release');

assert(content.includes('const __WO_RUNTIME_VERSION="' + version + '"'), 'content source should use manifest-matched runtime version');
assert(compact(runtime).includes('const__WO_RUNTIME_VERSION="' + version + '"'), 'runtime bundle should include manifest-matched runtime version');
assert(content.includes('window.__wardenOneReadyVersion===__WO_RUNTIME_VERSION'), 'content should no-op same-version reinjection after successful startup');
assert(content.includes('window.__wardenOneInstalled===__WO_RUNTIME_VERSION'), 'content installed guard should be versioned');
assert(content.includes('window.__wardenOneReadyVersion=__WO_RUNTIME_VERSION'), 'content should mark same-version ready only after successful startup');
assert(content.includes('version:__WO_RUNTIME_VERSION'), 'content install log should report actual runtime version');
assert(!content.includes('if(window.__wardenOneInstalled)return'), 'content should not use stale boolean installed guard');
assert(!content.includes('version:"3.12.0"'), 'content should not log stale hard-coded runtime version');

assert(bridge.includes("const BRIDGE_VERSION = '" + version + "'"), 'bridge should use manifest-matched guard version');
assert(bridge.includes('window.__wardenOneBridgeVersion === BRIDGE_VERSION'), 'bridge should no-op same-version reinjection');
assert(bridge.includes('window.__wardenOneBridgeReplay'), 'bridge should replay handshake/config on same-version reinjection');
assert(/__wardenOneBridgeReplay[\s\S]*wardenone-handshake[\s\S]*sendConfig\(bridgeConfig\)/.test(bridge),
  'bridge replay should resend handshake and latest config without stacking listeners');
assert(bridge.includes('window.__wardenOneBridgeReadyVersion = BRIDGE_VERSION'), 'bridge should mark ready after listener setup');

assert(yt.includes('var YT_MODULE_VERSION = "' + version + '"'), 'YouTube module should use manifest-matched guard version');
assert(yt.includes('window.__wardenOneYouTubeReadyVersion === YT_MODULE_VERSION'), 'YouTube module should no-op same-version reinjection after ready');
assert(yt.includes('window.__wardenOneYouTubeReadyVersion = YT_MODULE_VERSION'), 'YouTube module should mark ready after setup');

assert(consent.includes("const CONSENT_REJECT_VERSION = '" + version + "'"), 'consent module should use manifest-matched guard version');
assert(consent.includes('window.__wardenOneConsentRejectReadyVersion === CONSENT_REJECT_VERSION'), 'consent module should no-op same-version reinjection after ready');
assert(consent.includes('window.__wardenOneConsentRejectReadyVersion = CONSENT_REJECT_VERSION'), 'consent module should mark ready after setup');

assert(antiRedirect.includes('window.__wardenOneAntiRedirectHardener'), 'anti-redirect should remain idempotent');
assert(permissionChain.includes('window.__wardenOnePermissionChainInstalled'), 'permission-chain should remain idempotent');

console.log('[ok] runtime idempotence checks passed');
