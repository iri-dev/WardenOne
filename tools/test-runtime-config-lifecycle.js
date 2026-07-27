/*
 * Regression checks for late authenticated config delivery.
 *
 * The MAIN-world runtime starts before chrome.storage.local.get completes. DOM
 * cleanup must therefore wait for __configReady, and disabling the feature must
 * undo any changes already made during a live toggle. WebRTC privacy must also
 * leave native call setup alone unless the separate aggressive guard is enabled.
 */
'use strict';

const fs = require('fs');

const source = fs.readFileSync('src/content.js', 'utf8');
let passed = 0;

function check(name, condition) {
  if (!condition) {
    console.error('[fail] ' + name);
    process.exit(1);
  }
  passed++;
  console.log('[ok] ' + name);
}

check('main runtime starts from authenticated saved config',
  /const __woStartWhenConfigured=\(\)=>\{\s*window\.__WO_CONFIG__&&window\.__WO_CONFIG__\.__configReady&&__woStartRuntime\(\)/.test(source));
check('main runtime has a bounded bridge-failure fallback',
  /setTimeout\(__woStartRuntime,\s*1500\)/.test(source));
check('overlay cleanup waits for authenticated config',
  /overlayCleanerOn=\(\)=>!!\(window\.__WO_CONFIG__&&window\.__WO_CONFIG__\.__configReady&&WO\.enabled&&WO\.removeOverlays\)/.test(source));
check('overlay sweep refuses to mutate while cleanup is inactive',
  /sweep=\(\)=>\{\s*if\(!overlayCleanerOn\(\)\)return;/.test(source));
check('download auto-skip also respects config readiness',
  /tryAutoSkip=\(\)=>\{\s*if\(!overlayCleanerOn\(\)\|\|!WO\.autoSkipDownloadAds/.test(source));
check('disabled cleanup restores hidden or removed nodes',
  /const restoreCleanerChanges=\(\)=>\{[\s\S]*undoStack\.pop\(\)\(\)[\s\S]*rg-hard-overlay-css[\s\S]*rg-undo-chip[\s\S]*rg-dl-bar/.test(source));
check('live config changes start or restore the cleaner',
  /document\.addEventListener\("wo-config-change",\s*\(\)=>\{\s*overlayCleanerOn\(\)\?start\(\):restoreCleanerChanges\(\)/.test(source));
check('normal WebRTC transport is not rewritten by the IP lookup guard',
  /if\(WO\.blockWebRTCLeak&&!trustedMediaHost&&WO\.blockSuspiciousWebRTC\)try\{/.test(source));
check('runtime reports compatibility-preserving WebRTC behavior',
  source.includes('log("webrtc_transport_preserved"'));

console.log('[ok] runtime config lifecycle checks passed (' + passed + ')');
